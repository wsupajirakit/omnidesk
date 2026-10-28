import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * "Hook not found" — the one error in this module whose body is NOT the
 * service-wide `{ error }` envelope.
 *
 * Legacy answers `res.status(404).json({ message: "Hook not found" })` on
 * /hook/:id, /hook/:id/quota and /hook/:id/bot-info, while every other failure
 * in the same handler uses `{ error }`. That inconsistency is not a bug to fix
 * here: the dashboard branches on the `message` key to tell "this OA is gone"
 * apart from "the request was rejected", so normalising the shape would be a
 * breaking API change dressed up as a cleanup (R3e — parity is field names, not
 * just status codes).
 *
 * The global AllExceptionsFilter rewrites every error to `{ error }`, so the
 * shape cannot be expressed by throwing alone. This pairs the exception with a
 * filter bound only to the hooks controller, which writes the legacy body and
 * leaves every other error in the module on the standard path.
 */
export class HookNotFoundException extends NotFoundException {
  constructor(message = 'Hook not found') {
    super(message);
  }
}

@Catch(HookNotFoundException)
export class HookNotFoundFilter implements ExceptionFilter {
  catch(exception: HookNotFoundException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.NOT_FOUND).json({ message: exception.message });
  }
}
