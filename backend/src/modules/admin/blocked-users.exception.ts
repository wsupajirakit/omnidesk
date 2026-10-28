import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

/** One user the caller may not touch in a bulk op, and why. */
export interface BlockedUser {
  username: string;
  reason: string;
}

/**
 * [FIX-20260808-UBULK403] The user bulk endpoints' all-or-nothing 403.
 *
 * Legacy answers `{ error, blocked: [ { username, reason } ] }` — TWO keys
 * (userController.js:712-713 for bulk-permissions, :817 for bulk-active). The
 * operator ticked N users; "forbidden" alone does not tell them WHICH one to
 * untick, so the list is part of the contract, not a nicety.
 *
 * The global AllExceptionsFilter rewrites every error body to `{ error }` unless
 * it is already a `success:false` envelope, so a plain `ForbiddenException({error,
 * blocked})` loses `blocked`. This pairs a dedicated exception with a filter bound
 * to the users controller only — exactly the pattern BlockedHooksException uses for
 * the hooks bulk routes.
 */
export class BlockedUsersException extends ForbiddenException {
  constructor(
    readonly blocked: BlockedUser[],
    message: string,
  ) {
    super(message);
  }
}

@Catch(BlockedUsersException)
export class BlockedUsersFilter implements ExceptionFilter {
  catch(exception: BlockedUsersException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(HttpStatus.FORBIDDEN)
      .json({ error: exception.message, blocked: exception.blocked });
  }
}
