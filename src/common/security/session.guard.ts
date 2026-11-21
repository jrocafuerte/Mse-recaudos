import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENV, type Env } from '../../config/env.js';
import { type RecaudosSession, SessionStore } from '../../session/session.store.js';

export const SESSION_HEADER = 'x-recaudos-session';
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'recaudos-spa';

const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface SessionRequest extends Request {
  session?: RecaudosSession & { token: string };
}

export const CurrentSession = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<SessionRequest>().session!,
);

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * El servidor Next (mismo origen que el navegador del WebView) guarda la sesión
 * en una cookie `__Host-` HttpOnly/Secure/SameSite=Strict y la reenvía a este
 * BFF en el header interno `X-Recaudos-Session`. Además, para métodos que
 * cambian estado se exige un header custom y un Origin permitido (anti-CSRF).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly origins: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionStore,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.origins = new Set(env.ALLOWED_ORIGINS.split(',').filter(Boolean));
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<SessionRequest>();

    if (!SAFE.has(req.method)) {
      if (req.headers[CSRF_HEADER] !== CSRF_VALUE) throw new ForbiddenException('CSRF');
      const origin = req.headers.origin;
      if (origin && !this.origins.has(origin)) throw new ForbiddenException('Origen no permitido');
    }

    const token = req.headers[SESSION_HEADER];
    if (typeof token !== 'string' || token.length < 20) throw new UnauthorizedException();
    const s = this.sessions.get(token, this.env.SESSION_TTL_SECONDS);
    if (!s) throw new UnauthorizedException('Sesión expirada');
    req.session = { ...s, token };
    return true;
  }
}
