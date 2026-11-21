import { Body, Controller, Delete, Headers, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ENV, type Env } from '../config/env.js';
import { CurrentSession, Public, type SessionRequest } from '../common/security/session.guard.js';
import { SessionStore } from './session.store.js';
import { TrustedTokensService } from './trusted-tokens.service.js';

const ExchangeSchema = z.strictObject({ handoffToken: z.string().min(20).max(4096) });

@Controller('v1/session')
export class SessionController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TrustedTokensService,
    private readonly sessions: SessionStore,
  ) {}

  /**
   * Canje servidor-a-servidor (Next → BFF): handoff token de un solo uso
   * emitido por mse-banca-movil → sesión propia del micro frontend.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('exchange')
  @HttpCode(200)
  async exchange(
    @Body({ schema: ExchangeSchema }) body: z.infer<typeof ExchangeSchema>,
    @Headers('x-internal-client-secret') secret?: string,
  ) {
    this.assertInternalClient(secret);
    const claims = await this.tokens.verifyHandoff(body.handoffToken);
    if (claims.scope !== 'recaudos') throw new UnauthorizedException();
    const sessionToken = this.sessions.create(
      { customerId: claims.sub, parentSid: claims.sid, deviceId: claims.did },
      this.env.SESSION_TTL_SECONDS,
    );
    return { sessionToken, expiresIn: this.env.SESSION_TTL_SECONDS };
  }

  @Delete()
  @HttpCode(204)
  logout(@CurrentSession() session: NonNullable<SessionRequest['session']>): void {
    this.sessions.destroy(session.token);
  }

  private assertInternalClient(secret?: string): void {
    const expected = this.env.INTERNAL_CLIENT_SECRET;
    if (!expected) return; // solo dev/test (en prod es obligatorio por configuración)
    const a = Buffer.from(secret ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
  }
}
