import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Injects the authenticated caller into a handler parameter.
 *
 * Reading `req.user` by hand in every controller is how untyped `any` spreads
 * through a codebase; this keeps the shape in one place and typed.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    return request.user;
  },
);
