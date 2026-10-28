import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { TargetError } from './handoff-target.service';

/**
 * Emits the `{ error }` envelope for the target, job and callback endpoints —
 * including the `details` array the config validator attaches.
 *
 * The global `AllExceptionsFilter` reduces every error to exactly
 * `{ error: message }`. That is right for the rest of the API, but it silently
 * DROPS the `details` legacy sends alongside an invalid config:
 *
 *   legacy:    { "error": "invalid config",
 *                "details": [{ "key": "no_such_flag", "error": "unknown config key" }] }
 *   candidate: { "error": "invalid config" }
 *
 * The status and the message match, so a status check and even a structural
 * diff of the top-level keys look fine until `details` is compared — the form
 * that renders per-field errors would just stop showing them. Caught by
 * diffing against the live legacy backend.
 *
 * Scoped to the controllers that throw `TargetError`; every other failure on
 * those routes still falls through to the global filter.
 */
@Catch(TargetError, SyntaxError)
export class TargetErrorFilter implements ExceptionFilter<
  TargetError | SyntaxError
> {
  private readonly logger = new Logger(TargetErrorFilter.name);

  catch(exception: TargetError | SyntaxError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;

    /*
     * A body that is not JSON reaches the parser, not a handler.
     *
     * Legacy normalises it — `err instanceof SyntaxError` → `400 { error:
     * "invalid JSON body" }` (index.js:142-145). The global filter here only
     * recognises body-parser's `type: 'entity.parse.failed'` marker, so a raw
     * `SyntaxError` falls through to it as an unhandled error and the parser's
     * own message is echoed to the caller:
     *
     *   legacy:    { "error": "invalid JSON body" }
     *   candidate: { "error": "Unexpected token 'n', \"not json at all\"..." }
     *
     * That matters on the PUBLIC callback routes, which any unauthenticated
     * caller can reach: it is a parity break and it hands back parser internals.
     * Normalised here rather than in the shared filter, which is outside this
     * task's scope — the same fix belongs there eventually, for every route.
     */
    if (exception instanceof SyntaxError) {
      this.logger.warn(`malformed JSON body: ${exception.message}`);
      response.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid JSON body',
      });
      return;
    }

    /*
     * The status is coerced and range-checked before it is handed to express.
     *
     * `response.status()` THROWS on a non-integer ("Invalid status code:
     * undefined"), and a filter that throws is uniquely destructive: express
     * falls back to its default handler, so every error this filter was meant
     * to shape becomes an opaque 500 and the ORIGINAL error is lost. That turns
     * one bad status into a total loss of diagnosis, which is exactly how a
     * mid-edit two-argument helper here surfaced as "handoff edit ไม่ได้"
     * with no usable trace.
     *
     * `exception.status` is typed `number`, but a filter is a runtime boundary
     * and the type is only as good as every thrower — so it is validated rather
     * than trusted. Anything not a sane HTTP code degrades to 500 and is logged
     * loudly, because reaching this branch means a thrower is malformed.
     */
    const raw: unknown = exception.status;
    const status: number =
      typeof raw === 'number' &&
      Number.isInteger(raw) &&
      raw >= 100 &&
      raw <= 599
        ? raw
        : Number(HttpStatus.INTERNAL_SERVER_ERROR);

    if (raw !== undefined && status !== raw) {
      this.logger.error(
        `TargetError carried an unusable status (${String(raw)}); ` +
          `answering 500. This is a bug in whatever threw it.`,
      );
    }

    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(exception.message, exception.stack);
    }

    const body: Record<string, unknown> = { error: exception.message };
    // Only present on the invalid-config path; legacy omits the key entirely
    // otherwise, and an explicit `undefined` would serialise the same way.
    if (exception.details !== undefined) body['details'] = exception.details;

    response.status(status).json(body);
  }
}
