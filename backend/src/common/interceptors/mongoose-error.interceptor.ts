import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { catchError, throwError, type Observable } from 'rxjs';

/**
 * Lets a Mongoose `CastError` / `ValidationError` leave a WRITE handler as the
 * 400 the legacy backend answers, carrying Mongoose's own message.
 *
 * Legacy wraps each of these handlers in `try { … } catch (error) {
 * res.status(400).json({ error: error.message }) }`, so a malformed id or a
 * missing required field is reported by the LAYER THAT FOUND IT — e.g.
 * ``Cast to ObjectId failed for value "not-an-id" … for model "Menu"`` or
 * ``Menu validation failed: label: Path `label` is required.`` Those strings are
 * shown to the operator verbatim by the dashboard.
 *
 * Without this, the same error reaches `AllExceptionsFilter` unrecognised and
 * becomes `500 internal error` — a wrong status AND a lost message. Re-throwing
 * as a `BadRequestException` keeps ONE place shaping the response body: the
 * global filter still owns the envelope and the logging.
 *
 * ── where to apply it, and why not globally ─────────────────────────────────
 * Only on handlers whose legacy counterpart answers 400 from that catch. The
 * legacy read handlers (list/get, and `deleteMenu`/`deleteCategory`) answer
 * **500** for the very same error, so mounting this globally would trade one
 * divergence for another. Method-level `@UseInterceptors` keeps the mapping
 * exactly where legacy has it. Hardcoding the strings instead would be the
 * tech debt: they are generated from the schema and follow it when it changes.
 */
@Injectable()
export class MongooseErrorInterceptor implements NestInterceptor {
  public intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          throwError(() =>
            error instanceof MongooseError.CastError ||
            error instanceof MongooseError.ValidationError
              ? new BadRequestException(error.message)
              : error,
          ),
        ),
      );
  }
}

/**
 * Same idea as `MongooseErrorInterceptor`, but keeps the status at **500**.
 *
 * For the legacy READ handlers the `catch` is
 * `res.status(500).json({ error: error.message })`, not 400 — see
 * legacy-api/src/controllers/hook/dynamicTagController.js:135-137
 * (`listDynamicTags`). So a malformed id there is a 500 that still carries
 * Mongoose's own text, e.g.
 * ``Cast to ObjectId failed for value "notanid" (type string) at path
 * "hook_ids" for model "DynamicTag"``.
 *
 * ⚠️ Reusing the 400 interceptor above on those handlers would trade one
 * divergence for another: the status would start disagreeing instead of the
 * body. Two interceptors is the honest encoding of the fact that legacy really
 * does answer 400 from its write handlers and 500 from its read handlers.
 *
 * ⚠️ This deliberately forwards a Mongoose message the global filter would
 * otherwise replace with "internal error". It is not a stack trace — it is the
 * message the dashboard already shows for this case on legacy. Do NOT widen it
 * to non-Mongoose errors, which is exactly what the "internal error" default is
 * protecting.
 */
@Injectable()
export class MongooseReadErrorInterceptor implements NestInterceptor {
  public intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          throwError(() =>
            error instanceof MongooseError.CastError ||
            error instanceof MongooseError.ValidationError
              ? new InternalServerErrorException(error.message)
              : error,
          ),
        ),
      );
  }
}
