/** Public surface of the common layer — import from '@/common', not deep paths. */

export {
  isSuperRoleName,
  isSuperUser,
  SUPER_ROLE_NAMES,
} from './auth/super-role';
export { CurrentUser } from './decorators/current-user.decorator';
export { IS_PUBLIC_KEY, Public } from './decorators/public.decorator';
export {
  PERMISSIONS_KEY,
  RequirePermissions,
} from './decorators/require-permissions.decorator';
export { AllExceptionsFilter } from './filters/all-exceptions.filter';
export { PermissionsGuard } from './guards/permissions.guard';
export {
  MongooseErrorInterceptor,
  MongooseReadErrorInterceptor,
} from './interceptors/mongoose-error.interceptor';
export type { AuthenticatedUser, JwtPayload } from './types/authenticated-user';
