/** Public surface of the admin module — import '@/modules/admin'. */

export { AdminModule } from './admin.module';
// [FEAT-20260808-ACLSEED] ACL bootstrap seeder surface.
export {
  AclSeederService,
  type AclSeedSummary,
} from './acl-seed/acl-seeder.service';
export {
  DEFAULT_MENUS,
  DEFAULT_ROLES,
  type SeedMenu,
  type SeedRole,
} from './acl-seed/acl-seed.data';
export * from './dto';
export { RolesController } from './roles.controller';
export { RolesService } from './roles.service';
export { Role, RoleSchema, type RoleDocument } from './schemas/role.schema';
export { User, UserSchema, type UserDocument } from './schemas/user.schema';
export { UsersAccessService } from './users-access.service';
export { UsersBulkService } from './users-bulk.service';
export { UsersController } from './users.controller';
export { UsersPrefsService } from './users-prefs.service';
export { UsersService } from './users.service';
