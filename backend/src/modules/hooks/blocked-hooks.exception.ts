import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

/** One OA the caller may not touch, and why. */
export interface BlockedHook {
  alias: string;
  reason: string;
}

/**
 * The bulk endpoints' all-or-nothing 403.
 *
 * Legacy answers `{ error: "some OA are outside your group access", blocked: [
 * { alias, reason } ] }` — TWO keys (hookController.js:2023 and :2131). The
 * operator ticked twenty OAs; "forbidden" on its own does not tell them which
 * one to untick, which is why the list is part of the contract and not a nicety.
 *
 * The global AllExceptionsFilter rewrites every error body to `{ error }`, so
 * the second key cannot survive a plain throw. This pairs the exception with a
 * filter bound to the hooks controller only, exactly as HookNotFoundException
 * does for its `{ message }` body.
 */
export class BlockedHooksException extends ForbiddenException {
  constructor(readonly blocked: BlockedHook[]) {
    super('some OA are outside your group access');
  }
}

@Catch(BlockedHooksException)
export class BlockedHooksFilter implements ExceptionFilter {
  catch(exception: BlockedHooksException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(HttpStatus.FORBIDDEN)
      .json({ error: exception.message, blocked: exception.blocked });
  }
}
