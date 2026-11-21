const cache = new Map<string, RegExp>();

/**
 * Los patrones provienen del catálogo de convenios (fuente interna), no del
 * usuario. Aun así se rechazan construcciones propensas a ReDoS
 * (cuantificadores anidados / backreferences) y se cachean compilados.
 */
export function safeRegex(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  if (pattern.length > 100 || /\([^)]*[+*][^)]*\)[+*{]/.test(pattern) || /\\\d/.test(pattern.replace(/\\d/g, ''))) {
    throw new Error('Patrón de referencia no permitido');
  }
  const re = new RegExp(pattern);
  cache.set(pattern, re);
  return re;
}
