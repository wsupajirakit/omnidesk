import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'omnidesk:permissions';

/**
 * Declares the permissions a route needs. Holding ANY one of them is enough,
 * which matches how the legacy `authorize()` middleware behaved.
 *
 * Enforced by PermissionsGuard, which additionally treats `system.manage` and
 * `*` as override permissions — same as the legacy implementation.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
