import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type CryptoKey, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/main.js';
import { KEY_RESOLVER } from '../src/session/trusted-tokens.service.js';

const ISS = 'https://api.banco.example/mse-banca-movil';
const ORIGIN = 'http://localhost:3002';

describe('mse-recaudos (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let key: CryptoKey;

  const sign = (claims: Record<string, unknown>, typ: string, ttl = 60) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', typ, kid: 'k1' })
      .setIssuer(ISS)
      .setAudience('mse-recaudos')
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .setJti(randomUUID())
      .sign(key);

  const handoff = () => sign({ sub: 'cus-0001', sid: 'sid-1', did: 'dev-1', scope: 'recaudos' }, 'handoff+jwt');

  async function newSession() {
    const res = await request(http)
      .post('/v1/session/exchange')
      .send({ handoffToken: await handoff() })
      .expect(200);
    return {
      'X-Recaudos-Session': res.body.sessionToken as string,
      'X-Requested-With': 'recaudos-spa',
      Origin: ORIGIN,
    };
  }

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KEY_RESOLVER)
      .useValue(createLocalJWKSet({ keys: [jwk] }))
      .compile();
    app = mod.createNestApplication<NestExpressApplication>({ bodyParser: false });
    await configureApp(app);
    await app.init();
    http = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('rechaza requests sin sesión', () => request(http).get('/v1/categories').expect(401));

  it('handoff token es de un solo uso (anti-replay)', async () => {
    const t = await handoff();
    await request(http).post('/v1/session/exchange').send({ handoffToken: t }).expect(200);
    await request(http).post('/v1/session/exchange').send({ handoffToken: t }).expect(401);
  });

  it('rechaza tokens con tipo incorrecto (confusión de tokens)', async () => {
    const wrong = await sign({ sub: 'cus-0001', sid: 'sid-1', did: 'dev-1', scope: 'recaudos' }, 'at+jwt');
    await request(http).post('/v1/session/exchange').send({ handoffToken: wrong }).expect(401);
  });

  it('exige header anti-CSRF y origen permitido en métodos que cambian estado', async () => {
    const h = await newSession();
    await request(http)
      .post('/v1/billers/blr-001/debts')
      .set({ ...h, 'X-Requested-With': '' })
      .send({ reference: '123456' })
      .expect(403);
    await request(http)
      .post('/v1/billers/blr-001/debts')
      .set({ ...h, Origin: 'https://evil.example' })
      .send({ reference: '123456' })
      .expect(403);
  });

  it('valida la referencia según el convenio', async () => {
    const h = await newSession();
    await request(http).post('/v1/billers/blr-001/debts').set(h).send({ reference: 'ABC1' }).expect(422);
  });

  it('flujo completo: consulta → intent → step-up → pago → comprobante', async () => {
    const h = await newSession();
    const debts = await request(http)
      .post('/v1/billers/blr-001/debts')
      .set(h)
      .send({ reference: '123456' })
      .expect(200);
    const debt = debts.body.items[0];
    const intent = await request(http)
      .post('/v1/payment-intents')
      .set(h)
      .send({ billerId: 'blr-001', reference: '123456', debtId: debt.id, sourceAccountId: 'acc-001' })
      .expect(201);

    // Un step-up para otro monto debe fallar
    const tampered = await sign(
      { sub: 'cus-0001', sid: 'sid-1', txn: intent.body.intentHash, amt: 1, cur: 'USD' },
      'stepup+jwt',
      120,
    );
    await request(http)
      .post('/v1/payments')
      .set({ ...h, 'Idempotency-Key': randomUUID() })
      .send({ intentId: intent.body.intentId, stepUpToken: tampered })
      .expect(403);

    const intent2 = await request(http)
      .post('/v1/payment-intents')
      .set(h)
      .send({ billerId: 'blr-001', reference: '123456', debtId: debt.id, sourceAccountId: 'acc-001' })
      .expect(201);
    const stepUp = await sign(
      { sub: 'cus-0001', sid: 'sid-1', txn: intent2.body.intentHash, amt: intent2.body.total, cur: 'USD' },
      'stepup+jwt',
      120,
    );
    const paid = await request(http)
      .post('/v1/payments')
      .set({ ...h, 'Idempotency-Key': randomUUID() })
      .send({ intentId: intent2.body.intentId, stepUpToken: stepUp })
      .expect(201);
    expect(paid.body).toMatchObject({ status: 'COMPLETED', total: intent2.body.total });
    expect(paid.body.customerId).toBeUndefined();

    await request(http).get(`/v1/payments/${paid.body.paymentId}`).set(h).expect(200);
    // Otro cliente/sesión no ve el comprobante si no es suyo: aquí misma persona, nueva sesión → sí; id inexistente → 404
    await request(http).get(`/v1/payments/${randomUUID()}`).set(h).expect(404);
  });

  it('logout destruye la sesión', async () => {
    const h = await newSession();
    await request(http).delete('/v1/session').set(h).expect(204);
    await request(http).get('/v1/categories').set(h).expect(401);
  });
});
