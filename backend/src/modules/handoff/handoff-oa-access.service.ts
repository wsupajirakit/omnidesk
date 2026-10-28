import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { isSuperUser, type AuthenticatedUser } from '@/common';
import { Hook } from '@/modules/hooks';

/**
 * Per-OA scoping for the handoff endpoints.
 *
 * LIFTED from legacy-api/src/utils/common/oaAccess.js (`getAllowedHookIds`,
 * `ensureHookAccess`). Only the read side is used by handoff; the write-side
 * validator (`resolveAllowedHooksInput`) belongs to the user endpoints.
 *
 * The super check comes from the shared `isSuperUser` in `@/common` and is NOT
 * re-declared here. Legacy's own `isSuperAuth` is `superadmin || superuser`,
 * but `superuser` has no role document and no user holding it — a dead branch,
 * recorded in `src/common/auth/super-role.ts`. Hand-copying that predicate is
 * exactly the defect lesson V10 exists for.
 */
@Injectable()
export class HandoffOaAccessService {
  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
  ) {}

  /**
   * Hook ids the caller may touch, or `null` for unrestricted access.
   *
   * A token minted before the allowlist existed — or a user never given one —
   * carries no `allowed_hooks` and falls back to every OA in the caller's
   * groups, which is the pre-allowlist behaviour. An empty array means no OA at
   * all and must not be confused with the absent case: `[]` scopes every query
   * to nothing, whereas absent means "fall back to groups".
   */
  async getAllowedHookIds(user?: AuthenticatedUser): Promise<string[] | null> {
    if (isSuperUser(user)) return null;

    if (Array.isArray(user?.allowedHooks)) {
      return user.allowedHooks
        .filter((id) => Types.ObjectId.isValid(id))
        .map(String);
    }

    const groupIds = (user?.groups ?? []).filter((id) =>
      Types.ObjectId.isValid(id),
    );
    if (groupIds.length === 0) return [];

    const hooks = await this.hookModel
      .find({ group: { $in: groupIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id')
      .lean<Array<{ _id: Types.ObjectId }>>()
      .exec();
    return hooks.map((hook) => String(hook._id));
  }

  /**
   * Throws 403 when the caller may not touch `hookId`.
   *
   * Legacy raises an error carrying `statusCode: 403` and the calling
   * controller answers `{ error: message }` with that status — so the message
   * string is contract, not cosmetic.
   */
  async ensureHookAccess(
    user: AuthenticatedUser | undefined,
    hookId?: Types.ObjectId | string | null,
  ): Promise<void> {
    const allowed = await this.getAllowedHookIds(user);
    if (allowed === null) return;
    if (!hookId || !allowed.includes(String(hookId))) {
      throw new ForbiddenException('insufficient OA access');
    }
  }
}
