import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { type Observable, of, tap } from 'rxjs';
import type { SessionRequest } from '../security/session.guard.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TTL_MS = 24 * 60 * 60 * 1000;

interface Entry {
  fingerprint: string;
  response?: unknown;
  expiresAt: number;
}

/**
 * Idempotency-Key obligatorio en operaciones monetarias: un reintento (red
 * móvil inestable) nunca duplica un débito. Producción: Redis con SET NX.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly store = new Map<string, Entry>();

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<SessionRequest>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !UUID.test(key)) {
      throw new BadRequestException('Header Idempotency-Key (UUID) requerido');
    }
    const scoped = `${req.session?.customerId ?? 'anon'}:${req.method}:${req.path}:${key}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');
    const now = Date.now();
    const existing = this.store.get(scoped);

    if (existing && existing.expiresAt > now) {
      if (existing.fingerprint !== fingerprint)
        throw new ConflictException('Idempotency-Key reutilizada con otro payload');
      if (existing.response === undefined) throw new ConflictException('Operación en curso');
      return of(existing.response);
    }
    this.store.set(scoped, { fingerprint, expiresAt: now + TTL_MS });
    return next.handle().pipe(
      tap({
        next: (response) => this.store.set(scoped, { fingerprint, response, expiresAt: now + TTL_MS }),
        error: () => this.store.delete(scoped),
      }),
    );
  }
}
