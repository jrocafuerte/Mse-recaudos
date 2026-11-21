# mse-recaudos

**BFF** del micro frontend de *Pago de servicios* (`spa-recaudos`) — NestJS 12 (ESM), arquitectura hexagonal.

Arquitectura completa: [`spa-banca-movil/docs/ARCHITECTURE.md`](https://github.com/jrocafuerte/spa-banca-movil/blob/main/docs/ARCHITECTURE.md) · Seguridad: [`docs/SECURITY.md`](docs/SECURITY.md) · Contrato: [`openapi.yaml`](openapi.yaml)

> No se expone a Internet: solo el servidor Next de `spa-recaudos` lo invoca por red privada.

## Responsabilidades

- **Sesión propia**: canjea el *handoff token* (ES256, emitido por `mse-banca-movil`, verificado vía JWKS, un solo uso) por una sesión opaca de 10 min.
- **Catálogo**: categorías, empresas (convenios) y consulta de deuda por referencia validada según el convenio.
- **Pago en dos fases**: `payment-intents` fija monto/cuenta y calcula un hash canónico; `payments` exige un *step-up token* cuyo `txn` y `amt` coinciden con ese intent (firmado tras la biometría nativa). Idempotente.
- **Anti-CSRF**: `X-Requested-With: recaudos-spa` + validación de `Origin` en métodos que cambian estado.

## Estructura

```
src/
  session/        # TrustedTokensService (JWKS, typ, aud, jti anti-replay), SessionStore, /v1/session
  billers/        # catálogo y deudas (regex de convenio protegida contra ReDoS)
  payments/       # intents, pagos con step-up, comprobantes (BOLA)
  core/           # puertos BillersPort / AccountsPort + adaptadores en memoria
  common/         # SessionGuard, filtro RFC 9457, request-id, idempotencia
```

## Desarrollo

```bash
cp .env.example .env
npm ci
npm run start:dev           # http://localhost:3001 (requiere mse-banca-movil en :3000 para el JWKS)
npm test && npm run test:e2e
npm run lint && npm run build
```
