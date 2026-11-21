import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

export interface RecaudosSession {
  customerId: string;
  parentSid: string;
  deviceId: string;
  expiresAt: number;
}

const hash = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Sesión propia del micro frontend (no reutiliza el access token de la app).
 * Solo se almacena el hash del identificador. Producción: Redis con TTL.
 */
@Injectable()
export class SessionStore {
  private readonly sessions = new Map<string, RecaudosSession>();

  create(data: Omit<RecaudosSession, 'expiresAt'>, ttlSeconds: number): string {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(hash(token), { ...data, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
  }

  /** Sliding expiration acotada por el TTL. */
  get(token: string, ttlSeconds: number): RecaudosSession | undefined {
    const key = hash(token);
    const s = this.sessions.get(key);
    if (!s) return undefined;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(key);
      return undefined;
    }
    s.expiresAt = Date.now() + ttlSeconds * 1000;
    return s;
  }

  destroy(token: string): void {
    this.sessions.delete(hash(token));
  }
}
