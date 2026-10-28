import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { ChainError } from './handoff-chain.service';

/**
 * Emits the `{ message }` error envelope for the chain endpoints.
 *
 * WHY THIS EXISTS. The legacy handoff feature answers two different error
 * shapes, per controller:
 *
 *   `{ error }`   — targets, jobs, callbacks
 *   `{ message }` — chains, overrides, chain-runs ("bad id", "not found", …)
 *
 * The dashboard reads both, so the split is contract and must not be unified.
 *
 * The global `AllExceptionsFilter` re-shapes EVERY error to `{ error: msg }`
 * unconditionally. Throwing an `HttpException({ message })` from the chain
 * controller is therefore not enough — the global filter catches it and
 * rewrites the body, and the endpoint silently answers the wrong envelope with
 * the right status and text. That defect was caught by diffing against the live
 * legacy backend, not by reading the controller, which looked correct.
 *
 * Binding this filter to the chain controller keeps the shaping local: it
 * handles `ChainError` and nothing else, so every other failure on those routes
 * still falls through to the global filter and the one-envelope rule holds
 * everywhere it should.
 */
@Catch(ChainError)
export class ChainErrorFilter implements ExceptionFilter<ChainError> {
  private readonly logger = new Logger(ChainErrorFilter.name);

  catch(exception: ChainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;

    const status: number =
      exception.status || Number(HttpStatus.INTERNAL_SERVER_ERROR);
    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(exception.message, exception.stack);
    }

    response.status(status).json({ message: exception.message });
  }
}
