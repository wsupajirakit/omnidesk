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
// [FIX-20260818-SECAUDIT] plan §2.2b M3 — account changes reach the audit trail.
import {
  AuditLogService,
  PASSWORD_CHANGED,
  actorFromUser,
  recordUserSecurityEvent,
  type AuditChangedFieldInput,
} from '@/modules/audit';

import type { CreateUserDto, UpdateUserDto } from './dto';
import { Role } from './schemas/role.schema';
import { User } from './schemas/user.schema';
import { ROLE_RANKS, UsersAccessService } from './users-access.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
    private readonly accessService: UsersAccessService,
    // [FIX-20260818-SECAUDIT] see the writes in create/update/deleteUser
    private readonly auditLogService: AuditLogService,
  ) {}

  async listUsers(
    page = 1,
    limit = 25,
    active?: boolean,
    roleId?: string,
    authUser?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 25, 1), 200);

    const filters: Record<string, unknown> = { deleted_at: { $exists: false } };
    if (authUser?.userId && Types.ObjectId.isValid(authUser.userId)) {
      filters['_id'] = { $ne: new Types.ObjectId(authUser.userId) };
    }
    if (active !== undefined) {
      filters['active'] = active;
    }
    if (roleId && Types.ObjectId.isValid(roleId)) {
      filters['role'] = roleId;
    }

    if (!this.accessService.isSuperUser(authUser)) {
      const groupIds = Array.isArray(authUser?.groups)
        ? authUser.groups.filter((id) => Types.ObjectId.isValid(id))
        : [];
      if (groupIds.length === 0) {
        throw new ForbiddenException('group access is required');
      }
      const objectIds = groupIds.map((id) => new Types.ObjectId(id));
      filters['$or'] = [
        { groups: { $in: objectIds } },
        { groups: { $in: groupIds } },
      ];
    }

    const requesterRank = await this.accessService.getRequesterRank(authUser);
    if (requesterRank > 0) {
      const roles = await this.roleModel
        .find({ name: { $in: Object.keys(ROLE_RANKS) } })
        .select('_id name')
        .lean()
        .exec();
      const allowedRoleIds = roles
        .filter((r) => this.accessService.getRoleRank(r.name) <= requesterRank)
        .map((r) => r._id);

      if (filters['role']) {
        const matches = allowedRoleIds.some(
          (id) => String(id) === String(filters['role']),
        );
        if (!matches) {
          throw new ForbiddenException('insufficient role level');
        }
      } else {
        filters['role'] = { $in: allowedRoleIds };
      }
    }

    const total = await this.userModel.countDocuments(filters).exec();
    const users = await this.userModel
      .aggregate([
        { $match: filters },
        {
          $lookup: {
            from: 'roles',
            localField: 'role',
            foreignField: '_id',
            as: 'role',
          },
        },
        { $unwind: { path: '$role', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'groups',
            localField: 'groups',
            foreignField: '_id',
            as: 'groups',
          },
        },
        {
          $addFields: {
            role_rank: {
              $switch: {
                branches: [
                  { case: { $eq: ['$role.name', 'superadmin'] }, then: 3 },
                  { case: { $eq: ['$role.name', 'admin'] }, then: 2 },
                  { case: { $eq: ['$role.name', 'operator'] }, then: 1 },
                ],
                default: 0,
              },
            },
          },
        },
        { $sort: { role_rank: -1, created_at: -1 } },
        { $skip: (pageNum - 1) * limitNum },
        { $limit: limitNum },
      ])
      .exec();

    const self = await this.accessService.getSelfPayload(authUser);
    return {
      data: users.map((u) =>
        this.accessService.sanitizeUser(u as Record<string, unknown>),
      ),
      self,
      meta: { total, page: pageNum, limit: limitNum },
    };
  }

  /**
   * ⚠️ No `ObjectId.isValid` guard, deliberately — legacy has none
   * (legacy-api/src/controllers/admin/userController.js:308-326). A malformed
   * id must reach Mongoose so its `CastError` surfaces; the controller's
   * `MongooseReadErrorInterceptor` answers 500 carrying Mongoose's own message,
   * matching legacy's catch at userController.js:325. A guard would report
   * "User not found" and hide which field was actually rejected.
   */
  async getUserById(
    id: string,
    authUser?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const user = await this.userModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .populate('role')
      .populate('groups')
      .exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isSelf = authUser?.userId === id;
    if (!isSelf) {
      const requesterRank = await this.accessService.getRequesterRank(authUser);
      const roleObj = user.role as unknown as { name?: string } | null;
      const allowed = this.accessService.ensureAllowedByRank(
        requesterRank,
        roleObj?.name,
      );
      if (!allowed) {
        throw new ForbiddenException('insufficient role level');
      }
    }

    const self = await this.accessService.getSelfPayload(authUser);
    return {
      data: this.accessService.sanitizeUser(
        user.toObject() as unknown as Record<string, unknown>,
      ),
      self,
    };
  }

  async createUser(
    authUser: AuthenticatedUser,
    dto: CreateUserDto,
  ): Promise<Record<string, unknown> | null> {
    const username = (dto.username || '').trim().toLowerCase();
    const password = dto.password;
    if (!username || !password) {
      throw new BadRequestException('username and password are required');
    }

    const role = dto.role_id
      ? await this.accessService.getRole(dto.role_id)
      : null;
    if (role) {
      const requesterRank = await this.accessService.getRequesterRank(authUser);
      if (!this.accessService.ensureAllowedByRank(requesterRank, role.name)) {
        throw new ForbiddenException(
          'insufficient role level to assign this role',
        );
      }
    }

    const groups = await this.accessService.resolveGroups(
      dto.groups ?? dto.group_ids,
    );
    this.accessService.ensureGroupSubset(authUser, groups);

    const permissions = Array.isArray(dto.permissions)
      ? dto.permissions.map((p) => p.trim()).filter(Boolean)
      : [];
    this.accessService.ensurePermissionSubset(authUser, permissions);

    // [FIX-20260808-ALLOWEDHOOKS] validate the allowed_hooks payload instead of
    // trusting it (H-S1) — must be real hooks inside the target's groups and
    // within the caller's own OA access.
    const allowedHooks = await this.accessService.resolveAllowedHooksInput(
      authUser,
      dto.allowed_hooks ?? dto.hook_ids,
      groups,
    );
    const hashed = hashPassword(password);
    const creatorId = authUser.userId ? authUser.userId : null;

    const payload: Record<string, unknown> = {
      username,
      password_hash: hashed,
      display_name: dto.display_name || '',
      email: typeof dto.email === 'string' ? dto.email.trim() : '',
      phone: typeof dto.phone === 'string' ? dto.phone.trim() : '',
      role: role ? role._id : undefined,
      groups: groups || [],
      created_by: creatorId,
      permissions,
    };

    if (allowedHooks !== undefined) {
      // Already normalised to ObjectId[] by resolveAllowedHooksInput.
      payload['allowed_hooks'] = allowedHooks;
    }

    try {
      const created = await this.userModel.create(payload);

      // [FIX-20260818-SECAUDIT] M3 — who created this account, and when.
      recordUserSecurityEvent(this.auditLogService, {
        action: 'create',
        targetUserId: created._id,
        actor: actorFromUser(authUser),
        groupId: Array.isArray(groups) ? groups[0] : null,
        note: `Created user: ${username}`,
      });

      const user = await this.userModel
        .findById(created._id)
        .populate('role')
        .populate('groups')
        .lean()
        .exec();

      return this.accessService.sanitizeUser(
        user as unknown as Record<string, unknown>,
      );
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: number }).code === 11000
      ) {
        throw new ConflictException('username already exists');
      }
      throw err;
    }
  }

  /**
   * ⚠️ No id guard — see `getUserById`. Legacy's catch here answers
   * `error.statusCode || 400` (userController.js:637), and a bare `CastError`
   * carries no `statusCode`, so it lands on **400** — hence the 400-mapping
   * `MongooseErrorInterceptor` on this handler rather than the read one.
   */
  async updateUser(
    id: string,
    authUser: AuthenticatedUser,
    dto: UpdateUserDto,
  ): Promise<Record<string, unknown> | null> {
    const user = await this.userModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    /**
     * [FIX-20260818-RANKCALLSITES] audit_18_aug H12 — the target's rank decides.
     *
     * Without this, an `admin` could set a `superadmin`'s password and sign in
     * as them; `deleteUser` a few lines below has always refused the same move,
     * so this route was the odd one out rather than a deliberate exception.
     *
     * After the existence check, so a bad id still answers 404 unchanged, and
     * before the first field is assigned, so a refused edit writes nothing.
     */
    if (!(await this.accessService.mayActOnUser(authUser, user.role))) {
      throw new ForbiddenException('insufficient role level');
    }

    /**
     * [FIX-20260818-SECAUDIT] plan §2.2b M3 — snapshot taken BEFORE the
     * field-by-field assignment below, because that assignment overwrites the
     * document in place and the previous values are gone by the time it ends.
     *
     * Only the fields that change what an account CAN DO are watched. An edit to
     * a display name or a phone number writes no row: a trail padded with
     * routine edits is a trail nobody reads, and the finding this closes asks
     * for role changes and password resets specifically.
     */
    const before = {
      role: user.role ? String(user.role) : null,
      active: Boolean(user.active),
    };

    if (dto.username) {
      const normalized = dto.username.trim().toLowerCase();
      if (normalized) {
        const conflict = await this.userModel
          .findOne({
            username: normalized,
            _id: { $ne: user._id },
            deleted_at: { $exists: false },
          })
          .exec();
        if (conflict) {
          throw new ConflictException('username already in use');
        }
        user.username = normalized;
      }
    }

    if (typeof dto.display_name === 'string') {
      user.display_name = dto.display_name;
    }
    if (typeof dto.email === 'string') {
      user.email = dto.email.trim();
    }
    if (typeof dto.phone === 'string') {
      user.phone = dto.phone.trim();
    }
    if (dto.password) {
      user.password_hash = hashPassword(dto.password);
    }
    if (dto.active !== undefined) {
      user.active = Boolean(dto.active);
    }

    if (dto.role_id) {
      const role = await this.accessService.getRole(dto.role_id);
      const requesterRank = await this.accessService.getRequesterRank(authUser);
      if (
        role &&
        !this.accessService.ensureAllowedByRank(requesterRank, role.name)
      ) {
        throw new ForbiddenException(
          'insufficient role level to assign this role',
        );
      }
      user.role = role ? role._id : undefined;
    }

    if (dto.groups !== undefined || dto.group_ids !== undefined) {
      const groups = await this.accessService.resolveGroups(
        dto.groups ?? dto.group_ids,
      );
      this.accessService.ensureGroupSubset(authUser, groups);
      user.groups = groups || [];
    }

    if (Array.isArray(dto.permissions)) {
      const permissions = dto.permissions
        .map((p) => (p ? p.trim() : ''))
        .filter(Boolean);
      this.accessService.ensurePermissionSubset(authUser, permissions);
      user.permissions = permissions;
    }

    // [FIX-20260808-ALLOWEDHOOKS] validate against the target's (possibly just
    // updated) groups + the caller's own OA access (H-S1). `user.groups` already
    // holds the effective groups by this point.
    const allowedHooks = await this.accessService.resolveAllowedHooksInput(
      authUser,
      dto.allowed_hooks ?? dto.hook_ids,
      user.groups,
    );
    if (allowedHooks !== undefined) {
      user.allowed_hooks = allowedHooks;
    }

    user.token_version = (user.token_version || 0) + 1;
    await user.save();

    /**
     * [FIX-20260818-SECAUDIT] M3 — the three changes worth a row.
     *
     * The password records `[changed]`, never the value and never the hash: the
     * audit list carries no permission by design, so anything written here is
     * readable by every authenticated operator.
     */
    const changed: AuditChangedFieldInput[] = [];
    const afterRole = user.role ? String(user.role) : null;
    if (afterRole !== before.role) {
      changed.push({ field: 'role', from: before.role, to: afterRole });
    }
    if (dto.password) {
      changed.push({ field: 'password', from: null, to: PASSWORD_CHANGED });
    }
    if (Boolean(user.active) !== before.active) {
      changed.push({
        field: 'active',
        from: before.active,
        to: Boolean(user.active),
      });
    }
    if (changed.length > 0) {
      recordUserSecurityEvent(this.auditLogService, {
        action: 'update',
        targetUserId: user._id,
        actor: actorFromUser(authUser),
        groupId: (user.groups as unknown[] | undefined)?.[0] ?? null,
        note: `Updated user: ${user.username} (${changed
          .map((c) => c.field)
          .join(', ')})`,
        changedFields: changed,
      });
    }

    const updated = await this.userModel
      .findById(user._id)
      .populate('role')
      .populate('groups')
      .lean()
      .exec();

    return this.accessService.sanitizeUser(
      updated as unknown as Record<string, unknown>,
    );
  }

  /**
   * ⚠️ No id guard — see `getUserById`. Legacy's catch here is 500
   * (userController.js:874), so this handler takes the read interceptor.
   */
  async deleteUser(id: string, authUser: AuthenticatedUser): Promise<void> {
    const user = await this.userModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .populate('role')
      .exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // [FIX-20260818-RANKCALLSITES] unchanged behaviour, asked through the shared
    // check so this file holds one idiom rather than two. `user.role` is
    // populated here and a raw id in updateUser; mayActOnUser takes both.
    if (!(await this.accessService.mayActOnUser(authUser, user.role))) {
      throw new ForbiddenException('insufficient role level');
    }

    user.active = false;
    user.deleted_at = new Date();
    await user.save();

    // [FIX-20260818-SECAUDIT] M3 — a removed account is the change most worth
    // being able to look up afterwards. Soft delete, so the row's ref_id still
    // resolves to a readable document.
    recordUserSecurityEvent(this.auditLogService, {
      action: 'delete',
      targetUserId: user._id,
      actor: actorFromUser(authUser),
      groupId: (user.groups as unknown[] | undefined)?.[0] ?? null,
      note: `Deleted user: ${user.username}`,
    });
  }

  async getUserListForAssign(
    authUser?: AuthenticatedUser,
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    const filters: Record<string, unknown> = {
      deleted_at: { $exists: false },
      active: true,
    };
    if (authUser?.userId && Types.ObjectId.isValid(authUser.userId)) {
      filters['_id'] = { $ne: new Types.ObjectId(authUser.userId) };
    }

    if (!this.accessService.isSuperUser(authUser)) {
      const groupIds = Array.isArray(authUser?.groups)
        ? authUser.groups.filter((id) => Types.ObjectId.isValid(id))
        : [];
      if (groupIds.length === 0) {
        throw new ForbiddenException('group access is required');
      }
      const objectIds = groupIds.map((id) => new Types.ObjectId(id));
      filters['$or'] = [
        { groups: { $in: objectIds } },
        { groups: { $in: groupIds } },
      ];
    }

    const requesterRank = await this.accessService.getRequesterRank(authUser);
    if (requesterRank > 0) {
      const roles = await this.roleModel
        .find({ name: { $in: Object.keys(ROLE_RANKS) } })
        .select('_id name')
        .lean()
        .exec();
      const allowedRoleIds = roles
        .filter((r) => this.accessService.getRoleRank(r.name) <= requesterRank)
        .map((r) => r._id);
      filters['role'] = { $in: allowedRoleIds };
    }

    const users = await this.userModel
      .find(filters)
      .select('_id username display_name')
      .sort({ username: 1 })
      .lean()
      .exec();

    const formattedUsers = users.map((u) => ({
      user_id: u._id,
      username: u.username,
      display_name: u.display_name,
    }));

    return { data: formattedUsers };
  }
}
