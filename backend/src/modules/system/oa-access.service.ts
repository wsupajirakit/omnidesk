import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { isSuperUser, type AuthenticatedUser } from '@/common';
import { Hook } from '@/modules/hooks';

/**
 * Per-OA access checks for the system endpoints, ported from the legacy
 * `utils/common/oaAccess.js`.
 *
 * Only the read side is ported here — the write-side validator
 * (`resolveAllowedHooksInput`) belongs to the user endpoints and already lives
 * in the admin module.
 */
@Injectable()
export class OaAccessService {
  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
  ) {}

  /** Delegates to the shared predicate — see V10 in check-list.md. */
  private isSuperAuth(user?: AuthenticatedUser): boolean {
    return isSuperUser(user);
  }

  /**
   * Hook ids the caller may touch, or `null` for unrestricted access.
   *
   * A token minted before the allowlist existed — or a user never given one —
   * carries no `allowed_hooks` and falls back to every OA in the caller's
   * groups, which is exactly the pre-allowlist behaviour. An empty array means
   * no OA at all, and must not be confused with the absent case.
   */
  private async getAllowedHookIds(
    user?: AuthenticatedUser,
  ): Promise<string[] | null> {
    if (this.isSuperAuth(user)) return null;

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

  async ensureHookAccess(
    user: AuthenticatedUser | undefined,
    hookId?: string,
  ): Promise<void> {
    const allowed = await this.getAllowedHookIds(user);
    if (allowed === null) return;
    if (!hookId || !allowed.includes(String(hookId))) {
      throw new ForbiddenException('insufficient OA access');
    }
  }
}
