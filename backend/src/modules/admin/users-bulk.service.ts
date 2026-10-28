import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { hashPassword } from '@/common/utils/password';

import { BlockedUsersException } from './blocked-users.exception';

import type {
  BulkCloneUsersDto,
  BulkUpdateActiveDto,
  BulkUpdatePermissionsDto,
} from './dto';
import { User } from './schemas/user.schema';
import { UsersAccessService } from './users-access.service';

const BULK_CLONE_MAX = 10;

@Injectable()
export class UsersBulkService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly accessService: UsersAccessService,
  ) {}

  async bulkCloneUsers(
    sourceUserId: string,
    authUser: AuthenticatedUser,
    dto: BulkCloneUsersDto,
  ): Promise<Record<string, unknown>> {
    const source = await this.userModel
      .findOne({ _id: sourceUserId, deleted_at: { $exists: false } })
      .populate('role', 'name')
      .exec();

    if (!source) {
      throw new NotFoundException('Source user not found');
    }

    const requesterRank = await this.accessService.getRequesterRank(authUser);
    const sourceRoleObj = source.role as unknown as { name?: string } | null;
    if (
      !this.accessService.ensureAllowedByRank(
        requesterRank,
        sourceRoleObj?.name,
      )
    ) {
      throw new ForbiddenException('insufficient role level');
    }

    let cloneGroups = source.groups || [];
    let clonePermissions = source.permissions || [];
    let cloneAllowedHooks: Types.ObjectId[] | undefined = Array.isArray(
      source.allowed_hooks,
    )
      ? source.allowed_hooks
      : undefined;

    if (!this.accessService.isSuperUser(authUser)) {
      const ownGroups = new Set(
        (Array.isArray(authUser.groups) ? authUser.groups : []).map(String),
      );
      cloneGroups = cloneGroups.filter((id) => ownGroups.has(String(id)));
      const ownPerms = authUser.permissions || [];
      if (!ownPerms.includes('system.manage') && !ownPerms.includes('*')) {
        clonePermissions = clonePermissions.filter((p) => ownPerms.includes(p));
      }
      // [FIX-20260808-ALLOWEDHOOKS] restrict the cloned OAs to the caller's own
      // access (H-S1) — legacy userController.js:429-435. Without this a non-super
      // caller could clone a source user carrying hooks outside their tenant.
      cloneAllowedHooks =
        await this.accessService.intersectAllowedHooksForClone(
          authUser,
          source.allowed_hooks,
          cloneGroups,
        );
    }

    const rows = Array.isArray(dto.users) ? dto.users : [];
    if (rows.length === 0) {
      throw new BadRequestException('users is required and must not be empty');
    }
    if (rows.length > BULK_CLONE_MAX) {
      throw new BadRequestException(
        `too many users: ${rows.length} (max ${BULK_CLONE_MAX} per request)`,
      );
    }

    const prepared: Array<{
      index: number;
      username: string;
      password: string;
      display_name: string;
      email: string;
      phone: string;
    }> = [];
    const errors: Array<{
      index: number;
      username?: string;
      field: string;
      error: string;
    }> = [];
    const seen = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || { username: '', password: '' };
      const username = (row.username || '').trim().toLowerCase();
      const password = typeof row.password === 'string' ? row.password : '';

      if (!username) {
        errors.push({
          index: i,
          field: 'username',
          error: 'username is required',
        });
        continue;
      }
      if (!password) {
        errors.push({
          index: i,
          username,
          field: 'password',
          error: 'password is required',
        });
        continue;
      }
      if (seen.has(username)) {
        errors.push({
          index: i,
          username,
          field: 'username',
          error: 'duplicate username in this request',
        });
        continue;
      }
      seen.add(username);

      prepared.push({
        index: i,
        username,
        password,
        display_name:
          typeof row.display_name === 'string' ? row.display_name.trim() : '',
        email: typeof row.email === 'string' ? row.email.trim() : '',
        phone: typeof row.phone === 'string' ? row.phone.trim() : '',
      });
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        error: 'validation failed',
        details: errors,
      });
    }

    const taken = await this.userModel
      .find({
        username: { $in: prepared.map((p) => p.username) },
        deleted_at: { $exists: false },
      })
      .select('username')
      .lean()
      .exec();

    if (taken.length > 0) {
      const takenSet = new Set(taken.map((u) => u.username));
      throw new ConflictException({
        error: 'username already exists',
        details: prepared
          .filter((p) => takenSet.has(p.username))
          .map((p) => ({
            index: p.index,
            username: p.username,
            field: 'username',
            error: 'username already exists',
          })),
      });
    }

    const creatorId = authUser.userId ? authUser.userId : null;

    const created = await this.userModel.insertMany(
      prepared.map((p) => ({
        username: p.username,
        password_hash: hashPassword(p.password),
        display_name: p.display_name,
        email: p.email,
        phone: p.phone,
        role: source.role,
        groups: cloneGroups,
        permissions: clonePermissions,
        ...(cloneAllowedHooks !== undefined
          ? { allowed_hooks: cloneAllowedHooks }
          : {}),
        created_by: creatorId,
        active: true,
      })),
      { ordered: true },
    );

    const users = await this.userModel
      .find({ _id: { $in: created.map((u) => u._id) } })
      .populate('role')
      .populate('groups')
      .lean()
      .exec();

    return {
      created: users.length,
      source: { id: String(source._id), username: source.username },
      users: users.map((u) =>
        this.accessService.sanitizeUser(
          u as unknown as Record<string, unknown>,
        ),
      ),
    };
  }

  async bulkUpdatePermissions(
    authUser: AuthenticatedUser,
    dto: BulkUpdatePermissionsDto,
  ): Promise<Record<string, unknown>> {
    const roleName = authUser.roleName;
    if (!this.accessService.isSuperUser(authUser) && roleName !== 'admin') {
      throw new ForbiddenException(
        'bulk permission edit requires admin or superadmin',
      );
    }

    const ids = Array.isArray(dto.user_ids) ? dto.user_ids.filter(Boolean) : [];
    if (ids.length === 0) {
      throw new BadRequestException('user_ids is required');
    }

    const permissions = Array.isArray(dto.permissions)
      ? dto.permissions.map((p) => (p ? String(p).trim() : '')).filter(Boolean)
      : [];

    this.accessService.ensurePermissionSubset(authUser, permissions);

    const users = await this.userModel
      .find({
        _id: { $in: ids },
        deleted_at: { $exists: false },
      })
      .populate('role')
      .exec();

    if (users.length === 0) {
      throw new NotFoundException('no matching users');
    }

    if (!this.accessService.isSuperUser(authUser)) {
      const own = new Set(authUser.permissions || []);
      const callerRank = this.accessService.getRoleRank(roleName || undefined);
      const blocked: Array<{ username: string; reason: string }> = [];

      for (const u of users) {
        const targetRole = (u.role as unknown as { name?: string })?.name;
        if (this.accessService.getRoleRank(targetRole) > callerRank) {
          blocked.push({ username: u.username, reason: 'role outranks yours' });
          continue;
        }
        const exceeds = (u.permissions || []).filter((p) => !own.has(p));
        if (exceeds.length > 0) {
          blocked.push({
            username: u.username,
            reason: `holds permissions you do not: ${exceeds.join(', ')}`,
          });
        }
      }

      if (blocked.length > 0) {
        // [FIX-20260808-UBULK403] dedicated exception + scoped filter preserve the
        // `blocked[]` list (the global filter strips a plain {error,blocked} body).
        throw new BlockedUsersException(
          blocked,
          'some users hold access beyond yours',
        );
      }
    }

    const PRESERVED = ['role.manage', 'Roles'];
    const writes = users.map((u) => {
      const keep = (u.permissions || []).filter((p) => PRESERVED.includes(p));
      const next = [...new Set([...permissions, ...keep])];
      return {
        updateOne: {
          filter: { _id: u._id },
          /*
           * ==== [FIX-20260820-BULKPERMREVOKE] the bump legacy forgot
           *
           * Permissions ride in the JWT, so rewriting the row alone leaves the
           * old set live in every token already issued — up to JWT_EXPIRES_IN.
           * `token_version` is what jwt-auth.guard.ts:67 compares on EVERY
           * request, so bumping it refuses the next call from an affected
           * operator and the dashboard shows its session-timeout modal
           * (App.tsx `auth:invalid` -> setIsSessionTimeoutOpen). Signing in
           * again is the entire cost.
           * ถอนสิทธิ์แบบเลือกหลายคน ต้องมีผลทันที ไม่ใช่รอถึงชั่วโมง.
           *
           * The single-user path has always bumped, and so does
           * `bulkUpdateActive` eighty lines below when it deactivates someone.
           * This route was the only one that did not — a faithful port of
           * legacy-api `userController.js:736`, which omits it too.
           *
           * ⚠️ DELIBERATE LEGACY DIVERGENCE. `clone-bulk-parity.golden-spec.ts`
           * compares raw user rows between the two backends and token_version
           * sits inside that comparison, so its bulk-permissions case now
           * excludes this one field and asserts the divergence on purpose.
           * Change one without the other and the parity suite reports a
           * difference nobody can explain.
           *
           * revert: drop the `$inc` and the exclusion in that spec.
           */
          update: {
            $set: { permissions: next },
            $inc: { token_version: 1 },
          },
        },
      };
    });
    const result = await this.userModel.bulkWrite(writes);

    return {
      success: true,
      matched: result.matchedCount ?? users.length,
      modified: result.modifiedCount ?? users.length,
      usernames: users.map((u) => u.username),
    };
  }

  async bulkUpdateActive(
    authUser: AuthenticatedUser,
    dto: BulkUpdateActiveDto,
  ): Promise<Record<string, unknown>> {
    const roleName = authUser.roleName;
    if (!this.accessService.isSuperUser(authUser) && roleName !== 'admin') {
      throw new ForbiddenException(
        'bulk status change requires admin or superadmin',
      );
    }

    const ids = Array.isArray(dto.user_ids) ? dto.user_ids.filter(Boolean) : [];
    if (ids.length === 0) {
      throw new BadRequestException('user_ids is required');
    }
    if (typeof dto.active !== 'boolean') {
      throw new BadRequestException('active must be true or false');
    }
    const nextActive = dto.active;

    const users = await this.userModel
      .find({
        _id: { $in: ids },
        deleted_at: { $exists: false },
      })
      .populate('role')
      .exec();

    if (users.length === 0) {
      throw new NotFoundException('no matching users');
    }

    const requesterRank = await this.accessService.getRequesterRank(authUser);
    const myId = String(authUser.userId || '');
    const blocked: Array<{ username: string; reason: string }> = [];

    for (const u of users) {
      if (String(u._id) === myId) {
        blocked.push({
          username: u.username,
          reason: 'cannot change your own status',
        });
        continue;
      }
      const targetRole = (u.role as unknown as { name?: string })?.name;
      if (!this.accessService.ensureAllowedByRank(requesterRank, targetRole)) {
        blocked.push({ username: u.username, reason: 'role outranks yours' });
      }
    }

    if (blocked.length > 0) {
      // [FIX-20260808-UBULK403] see the bulk-permissions throw above.
      throw new BlockedUsersException(blocked, 'some users cannot be changed');
    }

    const targets = users.filter((u) => u.active !== nextActive);
    if (targets.length === 0) {
      return {
        success: true,
        matched: users.length,
        modified: 0,
        usernames: users.map((u) => u.username),
      };
    }

    const update = nextActive
      ? { $set: { active: true } }
      : { $set: { active: false }, $inc: { token_version: 1 } };

    const result = await this.userModel.updateMany(
      { _id: { $in: targets.map((u) => u._id) } },
      update,
    );

    return {
      success: true,
      matched: users.length,
      modified: result.modifiedCount ?? targets.length,
      usernames: targets.map((u) => u.username),
    };
  }
}
