import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// [FIX-20260818-SECAUDIT] UsersService writes a row on create/update/delete.
import { AuditModule } from '@/modules/audit';
import { Menu, MenuSchema } from '@/modules/content';
import { Group, GroupSchema, Hook, HookSchema } from '@/modules/hooks';

import { AclSeederService } from './acl-seed/acl-seeder.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { Role, RoleSchema } from './schemas/role.schema';
import { User, UserSchema } from './schemas/user.schema';
import { UsersAccessService } from './users-access.service';
import { UsersBulkService } from './users-bulk.service';
import { UsersController } from './users.controller';
import { UsersPrefsService } from './users-prefs.service';
import { UsersService } from './users.service';

/**
 * Admin management feature module (Users & Roles).
 */
@Module({
  imports: [
    AuditModule, // [FIX-20260818-SECAUDIT]
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Group.name, schema: GroupSchema },
      { name: Menu.name, schema: MenuSchema },
      // [FIX-20260808-ALLOWEDHOOKS] UsersAccessService validates allowed_hooks
      // against real hooks + their groups.
      { name: Hook.name, schema: HookSchema },
    ]),
  ],
  controllers: [UsersController, RolesController],
  providers: [
    UsersAccessService,
    UsersService,
    UsersBulkService,
    UsersPrefsService,
    RolesService,
    // [FEAT-20260808-ACLSEED] Blank-DB bootstrap seeder. Pluggable: drop this
    // line + the two other refs (import, export) to remove it with zero impact.
    AclSeederService,
  ],
  exports: [
    UsersAccessService,
    UsersService,
    UsersBulkService,
    UsersPrefsService,
    RolesService,
    AclSeederService,
  ],
})
export class AdminModule {}
