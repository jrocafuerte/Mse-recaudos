import { SessionStore } from '../session/session.store.js';
import { safeRegex } from './safe-regex.js';

describe('safeRegex', () => {
  it('compila patrones simples del catálogo', () => {
    expect(safeRegex('^\\d{6,10}$').test('123456')).toBe(true);
  });

  it('rechaza patrones propensos a ReDoS', () => {
    expect(() => safeRegex('^(a+)+$')).toThrow();
    expect(() => safeRegex('(a)\\1')).toThrow();
  });
});

describe('SessionStore', () => {
  it('no guarda el token en claro y lo invalida al destruir', () => {
    const store = new SessionStore();
    const token = store.create({ customerId: 'c', parentSid: 's', deviceId: 'd' }, 60);
    expect(store.get(token, 60)?.customerId).toBe('c');
    expect(JSON.stringify([...(store as unknown as { sessions: Map<string, unknown> }).sessions.keys()])).not.toContain(
      token,
    );
    store.destroy(token);
    expect(store.get(token, 60)).toBeUndefined();
  });
});
