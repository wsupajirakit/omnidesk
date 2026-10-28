import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { coreConfig } from '@/config/app.config';

/**
 * Structured logging.
 *
 * The legacy service logged with bare console.log, which produced unqueryable
 * text and leaked whatever happened to be in the object. Pino gives one JSON
 * line per event with a request id, and the redaction list below keeps
 * credentials out of the log stream even when a handler logs a whole request.
 *
 * ── WHAT CAN BE TUNED, AND WHAT CANNOT (asked 16/08; answered from this file) ─
 *
 * ⚠️ THERE IS NO OFF SWITCH. Nothing in `.env` silences application logging.
 *    Every knob below changes HOW MUCH detail or WHAT SHAPE — never whether the
 *    stream exists. ไม่มี env ตัวไหนปิด log ได้ ปรับได้แค่ละเอียดแค่ไหน/หน้าตาแบบไหน
 *
 *   · `DEBUG=true`  → level `debug` instead of `info` (:21). MORE lines, not
 *     fewer; `env.schema.ts` warns against it in production for that reason.
 *     There is no `silent` level wired anywhere.
 *   · `NODE_ENV=production` → drops `pino-pretty` so the output is raw JSON for
 *     a log shipper (:24). Volume is IDENTICAL either way — this is formatting.
 *     ⚠️ Its REAL bite is elsewhere: `webhook.module.ts:96,149` refuses to boot
 *        when `NODE_ENV=production` and `AI_PROVIDER=mock`, and the CLI scripts
 *        refuse to run. Setting it is a deploy decision, not a logging one.
 *   · `LOG_GEMINI_RESPONSE` (`env.schema.ts:253`, default false) → ADDS full
 *     model payloads. Declared and surfaced as `aiConfig.logResponses`, but no
 *     reader exists today — dead config, kept because the switch is intended.
 *   · `DEV_MODE` → also read into config and also unread. Dead.
 *
 * The ONLY thing this module silences is the access log of `/health` and
 * `/health/ready` (:47-49), hard-coded so health probes cannot drown the
 * stream. No env var reaches it.
 *
 * ⚠️ SEPARATE STREAM, SEPARATE RULES: the `webhook_logs` rows that the
 *    dashboard shows are NOT this logger. They go through
 *    `webhook/logging/webhook-log.emitter.ts` and are written unconditionally —
 *    that door reads no env var at all, so nothing here can turn them off or
 *    thin them out. log ที่ลง DB คนละเส้น ปิดไม่ได้เช่นกัน
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [coreConfig.KEY],
      useFactory: (config: ConfigType<typeof coreConfig>) => ({
        pinoHttp: {
          level: config.debug ? 'debug' : 'info',
          // Human-readable output locally; raw JSON in production where a log
          // shipper parses it.
          transport: config.isProduction
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-access-token"]',
              'req.headers["x-line-signature"]',
              // [FEAT-20260813-PROXYGATE] the front-proxy stamp — redact so the
              // internal secret never lands in logs in plaintext.
              'req.headers["x-internal-secret"]',
              'req.body.password',
              'req.body.new_password',
              'req.body.old_password',
              'res.headers["set-cookie"]',
              /* [FIX-20260818-AUTHKEYREDACT] the SAME token as the cookie above.
               * `auth.controller.ts` puts the full JWT in the `X-Auth-Key`
               * response header on login and on refresh; the cookie carrying that
               * token was already redacted here, so every login was still writing
               * a working credential to disk through the header instead. One line,
               * same intent as its neighbour. FE is unaffected — redaction only
               * touches what pino writes, never the response.
               * revert: delete this entry (the header goes back into the log). */
              'res.headers["x-auth-key"]',
            ],
            censor: '[redacted]',
          },
          // Health checks would otherwise dominate the log volume.
          autoLogging: {
            ignore: (req) =>
              req.url === '/health' || req.url === '/health/ready',
          },
          customProps: () => ({ service: 'omnidesk-api' }),
        },
      }),
    }),
  ],
})
export class LoggerModule {}
