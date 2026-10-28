import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { PermissionsGuard } from '@/common';
import { Role, RoleSchema, User, UserSchema } from '@/modules/admin';
// [FIX-20260818-SECAUDIT] AuthService writes a row on a successful sign-in.
// No cycle: AuditModule imports neither auth nor admin.
import { AuditModule } from '@/modules/audit';
import { Menu, MenuSchema } from '@/modules/content';
import { Group, GroupSchema, Hook, HookSchema } from '@/modules/hooks';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TokenService } from './token.service';
import { WsTicketService } from './ws-ticket.service';

/**
 * Authentication.
 *
 * The two global guards are registered **here**, not in AppModule: a guard bound
 * with APP_GUARD is instantiated by the module that declares it, so it can only
 * inject what that module imports. JwtAuthGuard needs the User model, which
 * lives in this module's Mongoose registration.
 *
 * Order is significant — authentication populates `request.user`, and the
 * permissions guard reads it.
 *
 * Role is registered too: login populates it to resolve effective permissions.
 */
@Module({
  imports: [
    AuditModule, // [FIX-20260818-SECAUDIT]
    JwtModule.register({}),
    /**
     * Login populates a chain — role -> menu_access -> parent_menu, plus groups
     * — and Mongoose can only resolve a `ref` to a model that is registered.
     * Menu appears twice in that chain (a menu and its parent), which is why one
     * registration covers both hops.
     */
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Group.name, schema: GroupSchema },
      { name: Menu.name, schema: MenuSchema },
      // [FEAT-20260808-HTTPONLY-S1] WsTicketService resolves the caller's OA
      // allowlist by querying hooks by group — the same fan-out set the REST
      // list endpoints use — so omnidesk-ws filters events identically.
      { name: Hook.name, schema: HookSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    // [FEAT-20260808-HTTPONLY-S1] Mints single-use WS connection tickets.
    WsTicketService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [TokenService],
})
export class AuthModule {}
