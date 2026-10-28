/**
 * Environment → typed config. Every value the services read comes through here.
 * Secrets have NO usable default outside development: `assertSecrets` refuses to start a
 * production process whose secret is missing, the documented placeholder, or too short.
 */
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';

export const PLACEHOLDER_SECRET = 'change-me-in-env';

export const BaseEnv = Type.Object({
  NODE_ENV: Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')], {
    default: 'development',
  }),
  HOST: Type.String({ default: '127.0.0.1' }),
  LOG_LEVEL: Type.Union(
    [Type.Literal('fatal'), Type.Literal('error'), Type.Literal('warn'), Type.Literal('info'), Type.Literal('debug'), Type.Literal('trace'), Type.Literal('silent')],
    { default: 'info' },
  ),
  RATE_LIMIT_MAX: Type.Number({ default: 300, minimum: 1 }),
  RATE_LIMIT_WINDOW_MS: Type.Number({ default: 60_000, minimum: 1000 }),
  BODY_LIMIT_BYTES: Type.Number({ default: 1_048_576, minimum: 1024 }),
});

/** Parse + coerce + default + validate. Throws one readable error listing every bad key. */
export function loadConfig<S extends TSchema>(schema: S, env: NodeJS.ProcessEnv = process.env): Static<S> {
  const raw = Value.Default(schema, Value.Convert(schema, { ...env }));
  const cleaned = Value.Clean(schema, raw);
  if (!Value.Check(schema, cleaned)) {
    const errs = [...Value.Errors(schema, cleaned)].map((e) => `${e.instancePath || '/'} ${e.message}`);
    throw new Error(`invalid environment: ${errs.join('; ')}`);
  }
  return cleaned;
}

/** Outside development/test a secret must be set, not the placeholder, and >= 32 chars. */
export function assertSecrets(nodeEnv: string, secrets: Record<string, string | undefined>): void {
  if (nodeEnv !== 'production') return;
  const bad = Object.entries(secrets)
    .filter(([, v]) => !v || v === PLACEHOLDER_SECRET || v.length < 32)
    .map(([k]) => k);
  if (bad.length) throw new Error(`refusing to start: weak or missing secret(s): ${bad.join(', ')}`);
}
