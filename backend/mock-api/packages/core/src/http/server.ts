/**
 * The one way a service in this repo builds its HTTP server, so every service gets the same
 * security floor without re-deciding it:
 *   · helmet headers · global rate limit · body size cap · request id on every log line
 *   · auth headers / signatures / cookies / passwords redacted from logs
 *   · schema-validated input (TypeBox) — a request that fails validation never reaches a handler
 *   · errors answer a stable JSON envelope; stack traces and internals never leave the process
 *   · `GET /healthz` for orchestration (not rate limited, no data)
 */
import { randomUUID } from 'node:crypto';

import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

export interface ServerOptions {
  name: string;
  logLevel: string;
  bodyLimit: number;
  rateLimit: { max: number; timeWindow: number };
  /** test/dev only: pretty logs are not used; this just silences output in tests */
  logger?: boolean;
}

export const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-signature"]',
  'req.headers["shop-api-key"]',
  'req.headers["x-callback-token"]',
  '*.password',
  '*.secret',
  '*.access_token',
  '*.refresh_token',
];

export async function createServer(opts: ServerOptions) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: opts.logLevel, redact: { paths: REDACT, censor: '[redacted]' }, base: { service: opts.name } },
    bodyLimit: opts.bodyLimit,
    genReqId: () => randomUUID(),
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', allErrors: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(helmet, { global: true });
  await app.register(rateLimit, {
    global: true,
    max: opts.rateLimit.max,
    timeWindow: opts.rateLimit.timeWindow,
    allowList: (req) => req.url === '/healthz',
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    const message = err.validation ? 'invalid request' : status >= 500 ? 'internal error' : err.message;
    return reply.status(status).send({ success: false, error: { code: err.code || 'ERROR', message } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'route not found' } }));

  app.get('/healthz', { config: { rateLimit: false } }, () => ({ ok: true, service: opts.name }));
  return app;
}

export type App = Awaited<ReturnType<typeof createServer>>;
export type { FastifyInstance };
