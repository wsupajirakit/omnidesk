import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import {
  isSuperUser as isSuperUserShared,
  type AuthenticatedUser,
} from '@/common';
import { Group, Hook } from '@/modules/hooks';

import { Role } from './schemas/role.schema';
import { User } from './schemas/user.schema';

export const ROLE_RANKS: Record<string, number> = {
  superadmin: 3,
  admin: 2,
  assist_admin: 1.5,
  operator: 1,
};

@Injectable()
export class UsersAccessService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    // [FIX-20260808-ALLOWEDHOOKS] needed to validate an allowed_hooks payload:
    // each hook must be real, belong to the target's groups, and stay within the
    // caller's own OA access.
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
  ) {}

  /**
   * [FIX-20260808-ALLOWEDHOOKS] Port of legacy oaAccess.js:47-86
   * `resolveAllowedHooksInput`. Validates an `allowed_hooks` payload on user
   * create/update/clone. `undefined` passes through so the field stays optional
   * (legacy clients never send it); `null`/`[]` mean "no OA at all". Every id must
   * be a real hook inside one of `groupIds`, AND a non-super caller cannot grant a
   * hook they cannot reach themselves.
   *
   * Without this the write path took `allowed_hooks` straight from the DTO, so an
   * operator scoped to one tenant could `PUT /api/users/<self>` with another
   * tenant's hook ids and self-grant cross-tenant access (H-S1). `groupIds` is the
   * TARGET's groups (the create/update resolves them first).
   */
  public async resolveAllowedHooksInput(
    authUser: AuthenticatedUser | undefined,
    value: unknown,
    groupIds: (Types.ObjectId | string)[] | undefined | null,
  ): Promise<Types.ObjectId[] | undefined> {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (!Array.isArray(value)) {
      throw new BadRequestException('allowed_hooks must be an array');
    }
    const normalized = [
      ...new Set(
        value
          .map((id) => (typeof id === 'string' ? id.trim() : id))
          .filter(Boolean)
          .map((id) => String(id)),
      ),
    ];
    if (normalized.length === 0) return [];
    if (normalized.some((id) => !isValidObjectId(id))) {
      throw new BadRequestException('Invalid hook identifier');
    }
    const groupSet = new Set((groupIds ?? []).map((g) => String(g)));
    const hooks = await this.hookModel
      .find({ _id: { $in: normalized } })
      .select('_id group')
      .lean();
    if (hooks.length !== normalized.length) {
      throw new BadRequestException('Hook not found');
    }
    const outside = hooks.filter(
      (h) => !h.group || !groupSet.has(String(h.group)),
    );
    if (outside.length > 0) {
      throw new BadRequestException(
        'allowed_hooks must belong to the selected groups',
      );
    }
    const callerAllowed = await this.getCallerAllowedHookIds(authUser);
    if (callerAllowed !== null) {
      const over = normalized.filter((id) => !callerAllowed.includes(id));
      if (over.length > 0) {
        throw new ForbiddenException('allowed_hooks exceed your own OA access');
      }
    }
    return normalized.map((id) => new Types.ObjectId(id));
  }

  /**
   * [FIX-20260808-ALLOWEDHOOKS] Clone-path intersection (legacy
   * userController.js:429-435). A non-super caller may only clone hooks they can
   * reach themselves; if the source user carries no explicit `allowed_hooks`, the
   * set is derived from the (already caller-filtered) clone groups. A super caller
   * clones verbatim. Unlike create/update this INTERSECTS rather than throwing —
   * the bulk clone silently drops out-of-scope hooks, matching legacy.
   */
  public async intersectAllowedHooksForClone(
    authUser: AuthenticatedUser,
    sourceAllowedHooks: unknown,
    cloneGroups: (Types.ObjectId | string)[],
  ): Promise<Types.ObjectId[] | undefined> {
    const callerAllowed = await this.getCallerAllowedHookIds(authUser);
    if (callerAllowed === null) {
      return Array.isArray(sourceAllowedHooks)
        ? (sourceAllowedHooks as Types.ObjectId[])
        : undefined;
    }
    const callerSet = new Set(callerAllowed);
    const sourceAllowed = Array.isArray(sourceAllowedHooks)
      ? sourceAllowedHooks.map((id) => String(id))
      : (
          await this.hookModel
            .find({ group: { $in: cloneGroups } })
            .select('_id')
            .lean()
        ).map((h) => String(h._id));
    return sourceAllowed
      .filter((id) => callerSet.has(id))
      .map((id) => new Types.ObjectId(id));
  }

  /**
   * The caller's OWN reachable hooks (super → null = unrestricted). Same 3-tier
   * rule as the read-side helpers: super, then the per-user `allowedHooks`
   * whitelist, then every hook in the caller's groups.
   */
  private async getCallerAllowedHookIds(
    user: AuthenticatedUser | undefined,
  ): Promise<string[] | null> {
    if (this.isSuperUser(user)) return null;
    if (Array.isArray(user?.allowedHooks)) {
      return user.allowedHooks
        .filter((id) => isValidObjectId(id))
        .map((id) => String(id));
    }
    const groupIds = Array.isArray(user?.groups)
      ? user.groups.filter((id) => isValidObjectId(id))
      : [];
    if (groupIds.length === 0) return [];
    const hooks = await this.hookModel
      .find({ group: { $in: groupIds } })
      .select('_id')
      .lean();
    return hooks.map((h) => String(h._id));
  }

  /** Delegates to the shared predicate — see V10 in check-list.md. */
  public isSuperUser(user?: AuthenticatedUser): boolean {
    return isSuperUserShared(user);
  }

  public getRoleRank(roleName?: string): number {
    return roleName ? (ROLE_RANKS[roleName] ?? 0) : 0;
  }

  /**
   * May a caller of `requesterRank` act on a user holding `targetRoleName`?
   *
   * [FIX-20260818-RANKFAILCLOSED · plan §7.2 = C4 = T3-4, closes C1]
   * This used to open with `if (requesterRank <= 0) return true` — so the ONE
   * caller the table could not rank was handed authority over everyone,
   * superadmins included. `getRequesterRank` returns 0 both for a claim with no
   * `roleId` and for any role name outside `ROLE_RANKS`, so a custom role was an
   * escalation path rather than a restriction. Unrankable now means refused.
   *
   * ⚠️ TRADE-OFF, and it is real: role NAMES are now load-bearing. Rename the
   * `superadmin` role — or delete a role document out from under its users — and
   * those accounts drop to rank 0 and lose user management rather than gaining
   * everything. That is the correct direction, but it must be known before
   * anyone edits a role name. เปลี่ยนชื่อ role = ตัดสิทธิ์ตัวเอง ไม่ใช่ได้เพิ่ม
   *
   * The TARGET side is deliberately untouched: an unranked target ranks 0 and is
   * still allowed, because it holds no privilege this guard protects and
   * refusing it would block assigning a custom role — a real flow, broken for
   * no security gain.
   *
   * revert: restore `if (requesterRank <= 0) return true;`. The escalation
   *         returns with it.
   */
  public ensureAllowedByRank(
    requesterRank: number,
    targetRoleName?: string,
  ): boolean {
    if (requesterRank <= 0) return false;
    const targetRank = this.getRoleRank(targetRoleName);
    return targetRank <= requesterRank;
  }

  /**
   * ==== [FIX-20260818-RANKCALLSITES] May this caller act on this ACCOUNT?
   * audit_18_aug H12 (+ two doors the finding does not name)
   *
   * Eight routes under `/api/users` can change somebody else's account. Five
   * already asked this question and refused when the target outranked the
   * caller; three did not — `updateUser`, `generateTempKey` and
   * `killUserSessions`. The rule was already the house style, so this is one
   * shared answer for it rather than a sixth hand-rolled copy: the OA-scope
   * resolver in this codebase had to be de-duplicated exactly once before, after
   * three of its six copies had silently drifted apart.
   *
   * `targetRole` is taken as `unknown` on purpose. Callers hold it in two shapes
   * — `deleteUser` populates the role document, `updateUser` does not — and
   * making each caller normalise it is how the next one gets it wrong. A
   * populated document, a raw id and an absent role all resolve here.
   *
   * An UNRANKED target still passes, and that is deliberate: assigning a custom
   * role is a real flow, an unranked target holds no privilege this guard
   * protects, and `users-rank-failclosed.spec.ts` pins it. Only the REQUESTER
   * side fails closed.
   */
  public async mayActOnUser(
    authUser: AuthenticatedUser | undefined,
    targetRole: unknown,
  ): Promise<boolean> {
    const requesterRank = await this.getRequesterRank(authUser);
    return this.ensureAllowedByRank(
      requesterRank,
      await this.resolveRoleName(targetRole),
    );
  }

  /** The role's name, whether the caller holds the document or just its id. */
  private async resolveRoleName(role: unknown): Promise<string | undefined> {
    if (!role) return undefined;
    if (typeof role === 'object' && 'name' in role) {
      const name = (role as { name?: unknown }).name;
      return typeof name === 'string' && name ? name : undefined;
    }
    if (!Types.ObjectId.isValid(role as string)) return undefined;
    const doc = await this.roleModel
      .findById(role as string)
      .select('name')
      .exec();
    return doc?.name;
  }

  public async getRequesterRank(user?: AuthenticatedUser): Promise<number> {
    const roleId = user?.roleId;
    if (!roleId) return 0;
    const role = await this.roleModel.findById(roleId).select('name').exec();
    return this.getRoleRank(role?.name);
  }

  public ensurePermissionSubset(
    authUser: AuthenticatedUser | undefined,
    permissions: string[],
  ): void {
    if (this.isSuperUser(authUser)) return;
    const own = authUser?.permissions || [];
    if (own.includes('system.manage') || own.includes('*')) return;
    const over = permissions.filter((p) => !own.includes(p));
    if (over.length > 0) {
      throw new ForbiddenException('permissions exceed your own permissions');
    }
  }

  public ensureGroupSubset(
    authUser: AuthenticatedUser | undefined,
    groupIds?: Types.ObjectId[],
  ): void {
    if (this.isSuperUser(authUser)) return;
    const own = new Set(
      (Array.isArray(authUser?.groups) ? authUser.groups : []).map(String),
    );
    const over = (groupIds || []).filter((id) => !own.has(String(id)));
    if (over.length > 0) {
      throw new ForbiddenException('groups exceed your own group access');
    }
  }

  public sanitizeUser(
    user: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!user) return null;
    const roleObj = user['role'] as { _id?: unknown; name?: unknown } | null;
    const groupsArr = Array.isArray(user['groups']) ? user['groups'] : [];
    const allowedHooksArr = Array.isArray(user['allowed_hooks'])
      ? user['allowed_hooks']
      : null;

    return {
      id: user['_id'],
      username: user['username'],
      display_name: user['display_name'] || '',
      email: user['email'] || '',
      phone: user['phone'] || '',
      role: roleObj
        ? {
            id: roleObj._id,
            name: roleObj.name,
          }
        : null,
      groups: groupsArr.map((group: { _id?: unknown; group_name?: unknown }) =>
        group && group._id
          ? { id: group._id, group_name: group.group_name }
          : { id: group },
      ),
      permissions: user['permissions'] || [],
      allowed_hooks: allowedHooksArr
        ? allowedHooksArr.map((id: unknown) => String(id))
        : null,
      preferences:
        user['preferences'] && typeof user['preferences'] === 'object'
          ? user['preferences']
          : null,
      active: user['active'],
      last_login: user['last_login'],
      created_at: user['created_at'],
      updated_at: user['updated_at'],
    };
  }

  public async getSelfPayload(
    authUser?: AuthenticatedUser,
  ): Promise<Record<string, unknown> | null> {
    const userId = authUser?.userId;
    if (!userId || !Types.ObjectId.isValid(userId)) return null;
    const user = await this.userModel
      .findOne({ _id: userId, deleted_at: { $exists: false } })
      .populate('role')
      .populate('groups')
      .lean()
      .exec();
    return this.sanitizeUser(user as unknown as Record<string, unknown>);
  }

  public async resolveGroups(
    groupIds?: string[] | null,
  ): Promise<Types.ObjectId[] | undefined> {
    if (groupIds === undefined) return undefined;
    if (groupIds === null) return [];
    if (!Array.isArray(groupIds)) {
      throw new BadRequestException('groups must be an array');
    }
    const normalized = groupIds
      .map((id) => (typeof id === 'string' ? id.trim() : id))
      .filter(Boolean);
    if (normalized.length === 0) return [];
    const invalid = normalized.filter((id) => !Types.ObjectId.isValid(id));
    if (invalid.length > 0) {
      throw new BadRequestException('Invalid group identifier');
    }
    const groups = await this.groupModel
      .find({ _id: { $in: normalized } })
      .exec();
    if (groups.length !== normalized.length) {
      throw new BadRequestException('Group not found');
    }
    return groups.map((g) => g._id);
  }

  public async getRole(
    roleId?: string,
  ): Promise<Role & { _id: Types.ObjectId }> {
    if (!roleId || !Types.ObjectId.isValid(roleId)) {
      throw new BadRequestException('Invalid role provided');
    }
    const role = await this.roleModel.findById(roleId).exec();
    if (!role) {
      throw new BadRequestException('Invalid role provided');
    }
    return role;
  }
}
