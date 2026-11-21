import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { ENV, type Env } from '../config/env.js';

export const KEY_RESOLVER = Symbol('KEY_RESOLVER');
export const HANDOFF_TYPE = 'handoff+jwt';
export const STEP_UP_TYPE = 'stepup+jwt';

export interface HandoffClaims extends JWTPayload {
  sub: string;
  sid: string;
  did: string;
  scope: string;
}
export interface StepUpClaims extends JWTPayload {
  sub: string;
  sid: string;
  txn: string;
  amt: number;
  cur: string;
}

/**
 * Verifica tokens firmados por mse-banca-movil (JWKS remoto, ES256) y
 * garantiza un solo uso por `jti` (anti-replay). Producción: Redis SET NX EX.
 */
@Injectable()
export class TrustedTokensService {
  private readonly usedJti = new Map<string, number>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(KEY_RESOLVER) private readonly keys: JWTVerifyGetKey,
  ) {}

  verifyHandoff(token: string): Promise<HandoffClaims> {
    return this.verifyOnce<HandoffClaims>(token, HANDOFF_TYPE, 60);
  }

  verifyStepUp(token: string): Promise<StepUpClaims> {
    return this.verifyOnce<StepUpClaims>(token, STEP_UP_TYPE, 120);
  }

  private async verifyOnce<T extends JWTPayload>(token: string, typ: string, maxAgeSeconds: number): Promise<T> {
    let payload: T;
    try {
      ({ payload } = await jwtVerify<T>(token, this.keys, {
        issuer: this.env.TRUSTED_ISSUER,
        audience: this.env.AUDIENCE,
        algorithms: ['ES256'],
        typ,
        maxTokenAge: maxAgeSeconds,
        clockTolerance: 5,
        requiredClaims: ['jti', 'sub', 'exp', 'iat'],
      }));
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
    this.purge();
    if (this.usedJti.has(payload.jti!)) throw new UnauthorizedException('Token ya utilizado');
    this.usedJti.set(payload.jti!, (payload.exp ?? 0) * 1000);
    return payload;
  }

  private purge(): void {
    const now = Date.now();
    for (const [jti, exp] of this.usedJti) if (exp < now) this.usedJti.delete(jti);
  }
}
