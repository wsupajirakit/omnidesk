import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import { PlainTextHttpException } from './line-signature.guard';

/**
 * Writes webhook rejections as plain text, the way the legacy backend does.
 *
 * The rest of this API answers errors as `{ "error": "..." }` via
 * `AllExceptionsFilter`, and the dashboard depends on that. The LINE webhook
 * routes are the exception: their only caller is LINE, and legacy rejects them
 * with `res.status(n).send("Invalid signature" | "Unknown alias")` — a bare
 * string, `text/html`, no envelope (`lineSignature.js:45,59`,
 * `webhookController.js:2358`).
 *
 * Scoped to `WebhookController` with `@UseFilters` rather than registered
 * globally: it must override the envelope for these three routes and for
 * nothing else. Anything that is not a `PlainTextHttpException` is left alone
 * and falls through to the global filter, so the JSON contract is untouched.
 */
@Catch(PlainTextHttpException)
export class WebhookPlainTextFilter implements ExceptionFilter<PlainTextHttpException> {
  catch(exception: PlainTextHttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;

    // `res.send(string)` in Express sets text/html — matching legacy exactly,
    // including the content-type, so the diff is on the same bytes LINE sees.
    response.status(exception.getStatus()).send(exception.text);
  }
}
