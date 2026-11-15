export function configFromEnv(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const token = env.API_TOKEN ?? '';
  if (production && token.length < 32) throw new Error('Production API_TOKEN must contain at least 32 characters');
  if (token && token.length < 32) throw new Error('API_TOKEN must contain at least 32 characters');
  const host = env.HOST || '127.0.0.1';
  if (!token && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Non-loopback binding requires API_TOKEN');
  if (production && !env.APP_ORIGIN) throw new Error('Production APP_ORIGIN is required');
  let origin = env.APP_ORIGIN || null;
  if (origin) { const u = new URL(origin); if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin) throw new Error('APP_ORIGIN must be an exact HTTP(S) origin without a path'); }
  const integer = (key, fallback, min, max) => { const n = Number(env[key] ?? fallback); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`); return n; };
  return { production, token, host, origin, port: integer('PORT', 3000, 0, 65535), dbPath: env.DB_PATH || 'data/incidents.db', demoEnabled: env.DEMO_ENABLED === 'true' || (!production && env.DEMO_ENABLED !== 'false'), maxIncidents: integer('MAX_INCIDENTS', 500, 1, 10000), retentionDays: integer('RETENTION_DAYS', 7, 1, 365), rateLimit: integer('RATE_LIMIT', 120, 1, 10000) };
}
