import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';

import { BlockedUsersFilter } from './blocked-users.exception';

import {
  MongooseErrorInterceptor,
  MongooseReadErrorInterceptor,
} from '@/common/interceptors/mongoose-error.interceptor';

import {
  CurrentUser,
  Public,
  RequirePermissions,
  isSuperUser,
  type AuthenticatedUser,
} from '@/common';

import {
  BulkCloneUsersDto,
  BulkUpdateActiveDto,
  BulkUpdatePermissionsDto,
  ChangePasswordDto,
  CreateUserDto,
  GenerateTempKeyDto,
  KillUserSessionsDto,
  ResetPasswordWithTempKeyDto,
  UpdatePreferencesDto,
  UpdateUserDto,
} from './dto';
import { UsersBulkService } from './users-bulk.service';
import { UsersPrefsService } from './users-prefs.service';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('api/users')
// [FIX-20260808-UBULK403] preserve the `blocked[]` list on the bulk 403s — the
// global filter would otherwise strip it to a bare `{ error }`.
@UseFilters(BlockedUsersFilter)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly bulkService: UsersBulkService,
    private readonly prefsService: UsersPrefsService,
    // [FIX-20260808-RESETPWDRL] reset-password-temp is a public, unauthenticated
    // route; legacy guards it with the SAME rateLimitLogin bucket as /login.
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.manage', 'ticket.manage')
  @ApiOperation({ summary: 'List user accounts' })
  async listUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
    @Query('role') role?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const isActive =
      active !== undefined ? active === 'true' || active === '1' : undefined;
    return this.usersService.listUsers(page, limit, isActive, role, user);
  }

  @Get('list-for-assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.manage', 'ticket.manage')
  @ApiOperation({ summary: 'List active users for ticket assignment dropdown' })
  async getUserListForAssign(
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    return this.usersService.getUserListForAssign(user);
  }

  @Get('me/preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user preferences' })
  async getMyPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> | null }> {
    return this.prefsService.getMyPreferences(user);
  }

  @Put('me/preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update current user preferences' })
  async updateMyPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<{ data: Record<string, unknown> }> {
    return this.prefsService.updateMyPreferences(user, dto);
  }

  @Patch('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change current user password' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    return this.prefsService.changePassword(user, dto);
  }

  @Public()
  @Post('reset-password-temp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using temporary key' })
  async resetPasswordWithTempKey(
    @Body() dto: ResetPasswordWithTempKeyDto,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    // [FIX-20260808-RESETPWDRL] Throttle per-IP like /login (legacy
    // apiRoutes.js:247 mounts rateLimitLogin here). Without it this public route
    // is an unthrottled temp-key guessing oracle. Same bucket, status and message
    // as the login limiter, and it fails open the same way (consume never throws).
    const clientIp = this.rateLimit.resolveClientIp(request);
    const verdict = await this.rateLimit.consume('login', clientIp);
    if (verdict.limited) {
      throw new HttpException(
        'rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.prefsService.resetPasswordWithTempKey(dto);
  }

  @Post('bulk-permissions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.manage')
  @ApiOperation({ summary: 'Bulk update user permissions' })
  async bulkUpdatePermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkUpdatePermissionsDto,
  ): Promise<Record<string, unknown>> {
    return this.bulkService.bulkUpdatePermissions(user, dto);
  }

  @Post('bulk-active')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.manage')
  @ApiOperation({ summary: 'Bulk update user active status' })
  async bulkUpdateActive(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkUpdateActiveDto,
  ): Promise<Record<string, unknown>> {
    return this.bulkService.bulkUpdateActive(user, dto);
  }

  @Post('generate-temp-key')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.manage')
  @ApiOperation({ summary: 'Generate temporary key for password reset' })
  async generateTempKey(
    @Body() dto: GenerateTempKeyDto,
    // [FIX-20260818-RANKCALLSITES] the route never received the caller, which is
    // why it could not ask whether they outrank the account being reset.
    @CurrentUser() authUser: AuthenticatedUser,
  ): Promise<{ temp_key: string; expires_at: Date }> {
    return this.prefsService.generateTempKey(dto, authUser);
  }

  @Post(':id/bulk-clone')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('user.manage')
  @ApiOperation({ summary: 'Bulk clone users from source user template' })
  async bulkCloneUsers(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkCloneUsersDto,
  ): Promise<Record<string, unknown>> {
    return this.bulkService.bulkCloneUsers(id, user, dto);
  }

  @Post(':id/kill-sessions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.manage')
  @ApiOperation({
    summary: 'Revoke user sessions by incrementing token version',
  })
  async killUserSessions(
    @Param('id') id: string,
    @Body() dto: KillUserSessionsDto,
    // [FIX-20260818-RANKCALLSITES] same omission as generateTempKey above.
    @CurrentUser() authUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    return this.prefsService.killUserSessions(id, dto, authUser);
  }

  // Legacy answers 500 + Mongoose's own text for a malformed id
  // (userController.js:325) — the read interceptor preserves that status.
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(MongooseReadErrorInterceptor)
  @ApiOperation({ summary: 'Get user detail by ObjectId' })
  async getUserById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    // Legacy route allows access if caller is inspecting their own account, or has user.manage / ticket.manage
    const isSelf = user.userId === id;
    if (!isSelf) {
      const perms = user.permissions || [];
      const isSuper = isSuperUser(user);
      const hasPerm =
        isSuper ||
        perms.includes('user.manage') ||
        perms.includes('ticket.manage') ||
        perms.includes('system.manage') ||
        perms.includes('*');
      if (!hasPerm) {
        throw new ForbiddenException('insufficient permissions');
      }
    }
    return this.usersService.getUserById(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('user.manage')
  @ApiOperation({ summary: 'Create new user account' })
  async createUser(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUserDto,
  ): Promise<Record<string, unknown> | null> {
    return this.usersService.createUser(user, dto);
  }

  // Legacy's catch here is `error.statusCode || 400`; a bare CastError has no
  // statusCode, so it lands on 400 (userController.js:637).
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.manage')
  @UseInterceptors(MongooseErrorInterceptor)
  @ApiOperation({ summary: 'Update user account' })
  async updateUser(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserDto,
  ): Promise<Record<string, unknown> | null> {
    return this.usersService.updateUser(id, user, dto);
  }

  // Legacy's catch here is 500 (userController.js:874).
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('user.manage')
  @UseInterceptors(MongooseReadErrorInterceptor)
  @ApiOperation({ summary: 'Soft delete user account' })
  async deleteUser(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.usersService.deleteUser(id, user);
  }
}
