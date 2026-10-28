import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Checks the permissions declared by @RequirePermissions on the handler.
 *
 * Semantics are copied from the legacy `authorize()` middleware and must not
 * drift, or existing operator accounts start losing access:
 *   - holding ANY of the listed permissions grants access
 *   - `system.manage` and `*` act as global overrides
 *   - a route with no declared permissions passes (authentication still ran)
 *
 * Runs after the authentication guard, so `request.user` is already populated.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  /** Permissions that satisfy any requirement. */
  private static readonly OVERRIDE_PERMISSIONS = ['system.manage', '*'];

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const granted = request.user?.permissions ?? [];

    const allowed =
      granted.some((permission) =>
        PermissionsGuard.OVERRIDE_PERMISSIONS.includes(permission),
      ) || required.some((permission) => granted.includes(permission));

    if (!allowed) throw new ForbiddenException('insufficient permissions');

    return true;
  }
}
