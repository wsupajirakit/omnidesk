import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Single exit point for every error leaving the API.
 *
 * Contract (must match the legacy Express backend exactly — the dashboard
 * parses these bodies):
 *   - body is `{ "error": "<message>" }` unless the thrower supplied a whole
 *     envelope (see `isPreShapedEnvelope`)
 *   - malformed JSON  -> 400 "invalid JSON body"
 *   - anything unexpected -> 500 "internal error"
 *   - stack traces are logged server-side, never sent to the client
 *
 * Leaking stack traces was a real finding in the legacy service; keeping the
 * shaping in one filter is what stops it from coming back one handler at a time.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Response already streaming — nothing safe left to do but let it finish.
    if (response.headersSent) return;

    const { status, message, body } = this.resolve(exception);

    if (Number(status) >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${status}: ${message}`,
      );
    }

    response.status(status).json(body ?? { error: message });
  }

  private resolve(exception: unknown): {
    status: number;
    message: string;
    body?: Record<string, unknown>;
  } {
    if (this.isMalformedJson(exception)) {
      return { status: HttpStatus.BAD_REQUEST, message: 'invalid JSON body' };
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      return {
        status: exception.getStatus(),
        message: this.extractMessage(exception),
        ...(this.isPreShapedEnvelope(payload) ? { body: payload } : {}),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'internal error',
    };
  }

  /**
   * True when the thrower already built the exact body legacy sends.
   *
   * A handful of legacy areas — the quick-reply CRUD is the one in use — answer
   * `{ success: false, error }` rather than the bare `{ error }` above, and the
   * dashboard branches on `success`. Flattening those would DROP A KEY the
   * frontend reads, which is worse than a differing string. Recognising the
   * envelope here keeps that knowledge with the handler that owns the contract,
   * instead of teaching this filter about individual routes.
   */
  private isPreShapedEnvelope(
    payload: unknown,
  ): payload is Record<string, unknown> {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { success?: unknown }).success === false
    );
  }

  /** body-parser marks bad payloads with `type: 'entity.parse.failed'`. */
  private isMalformedJson(exception: unknown): boolean {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { type?: string }).type === 'entity.parse.failed'
    );
  }

  /**
   * Nest wraps validation errors as `{ message: string[] }`. The dashboard shows
   * `error` verbatim, so multiple messages are joined instead of nested.
   */
  private extractMessage(exception: HttpException): string {
    const payload = exception.getResponse();

    if (typeof payload === 'string') return payload;

    if (typeof payload === 'object' && payload !== null) {
      const { message, error } = payload as {
        message?: unknown;
        error?: unknown;
      };

      if (Array.isArray(message)) return message.join('; ');
      if (typeof message === 'string') return message;
      if (typeof error === 'string') return error;
    }

    return exception.message;
  }
}
