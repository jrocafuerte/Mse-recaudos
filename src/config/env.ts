import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  /** Audiencia esperada en los tokens emitidos por mse-banca-movil. */
  AUDIENCE: z.string().default('mse-recaudos'),
  /** Emisor de confianza (iss) y su JWKS. */
  TRUSTED_ISSUER: z.string().url().default('https://api.banco.example/mse-banca-movil'),
  TRUSTED_JWKS_URL: z.string().url().default('http://localhost:3000/.well-known/jwks.json'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
  /** Orígenes del micro frontend autorizados (validación de Origin anti-CSRF). */
  ALLOWED_ORIGINS: z.string().default('http://localhost:3002'),
  /** Secreto compartido BFF ↔ servidor Next (canje de handoff servidor a servidor). */
  INTERNAL_CLIENT_SECRET: z.string().min(32).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Configuración inválida: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.INTERNAL_CLIENT_SECRET) {
    throw new Error('Configuración inválida: INTERNAL_CLIENT_SECRET');
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
