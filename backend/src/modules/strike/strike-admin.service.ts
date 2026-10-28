import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import {
  MemberStrikeSession,
  type MemberStrikeSessionDocument,
} from './schemas/member-strike-session.schema';
import type { StrikeSessionView } from './strike-session-view';
import { StrikeService } from './strike.service';

/**
 * [FEAT-20260827-ADMINBLOCK] The admin write side — "Block จำกัดการคุย".
 * ===========================================================================
 * 📖 PLAN: `todo/task/27082026/todo8_27082026_admin-block-suspend.md`
 *
 * WHY ITS OWN SERVICE AND NOT A METHOD ON `StrikeService` — the same two
 * reasons that split the gate out on 26/08, in the same order:
 *
 *   1. `strike.service.ts` sat at 399 countable lines, ONE under the repo's
 *      max-lines ratchet, and the waiver list only shrinks. Any method added
 *      there mints a brand-new warning.
 *   2. The block is its own feature with its own lifetime: a deployment can
 *      run strike tracking without ever letting an admin mint a lock, and
 *      "remove the block feature and nothing changes" is easiest to prove when
 *      the feature is a file you delete. ถอดได้จริงคือถอดไฟล์ทิ้ง
 *
 * WHAT IT WRITES: the SAME latch the gate writes (`suspended_at`), plus two
 * fields the gate never touches — `suspended_by`, `suspended_reason` — whose
 * PRESENCE is the data-level answer to "did an admin order this". No strike
 * events are invented: `strike_total`, rollup and insight keep reporting only
 * what really happened, which is why this is option (ก) of the plan and not
 * "fake strikes until the cap". ประทับ field เดียวกับ gate · ไม่เสก event ปลอม
 *
 * UNLIKE the gate it DOES inject `StrikeService` — deliberately, for the
 * ensure step alone: a customer who has never been struck has no session to
 * stamp, and the seq/race machinery for opening one exists in exactly one
 * place (`openSessionThenRead`). Duplicating it here would be two owners of
 * the same invariant. The gate stays state-free; this one borrows the door.
 *
 * revert: delete this file, its provider line in `strike.module.ts`, the POST
 * route, and the two schema props. Rows already stamped are read by nobody
 * beyond display and stay valid.
 */
@Injectable()
export class StrikeAdminService {
  private readonly logger = new Logger(StrikeAdminService.name);

  constructor(
    @InjectModel(MemberStrikeSession.name)
    private readonly sessionModel: Model<MemberStrikeSessionDocument>,
    private readonly strike: StrikeService,
  ) {}

  /**
   * Admin mints the latch. Creates the open session first when the customer
   * never earned one, then stamps it — armed exactly like a ceiling hit.
   *
   * ⚠️ THE GUARD LIVES IN THE FILTER (`suspended_at: null`), the same shape the
   * gate's own arm uses: two admins pressing together, or an admin racing the
   * gate, resolve to one stamp and one loser who gets `null` (→ 409 upstream).
   *
   * ⚠️ AN UNATTRIBUTABLE BLOCK IS REFUSED. Without a valid `suspendedBy` the
   * row would be indistinguishable from a gate row — the exact lie this
   * feature must not tell. Unreachable over HTTP (the guard always supplies
   * the caller's id); defensive against future in-process callers.
   *
   * The release path is `StrikeService.closeSession`, unchanged — closing
   * opens a fresh session carrying none of the three fields.
   * ปลดด้วยเคลียร์เดิม ไม่มีปุ่มแยก
   *
   * @returns the stamped session, or null when it was already suspended
   *          (or the admin id was invalid — see above).
   */
  public async suspendSession(
    lineUserId: string,
    suspendedBy: string | null | undefined,
    reason?: string | null,
  ): Promise<StrikeSessionView | null> {
    if (!lineUserId || !suspendedBy || !isValidObjectId(suspendedBy)) {
      return null;
    }
    const by = new Types.ObjectId(String(suspendedBy));

    // the ledger must exist before it can be stamped — the ensure step is
    // StrikeService's, reused rather than re-implemented (see the header)
    const open =
      (await this.strike.currentFor(lineUserId)) ??
      (await this.strike.openSessionThenRead(lineUserId, null));
    if (!open) return null;

    const stamped = await this.sessionModel
      .findOneAndUpdate(
        { _id: open._id, status: 'open', suspended_at: null },
        {
          $set: {
            suspended_at: new Date(),
            suspended_by: by,
            ...(reason ? { suspended_reason: reason } : {}),
          },
        },
        { new: true },
      )
      .lean<StrikeSessionView | null>()
      .exec();

    if (!stamped) return null; // already armed (gate or another admin) — 409

    this.logger.warn(
      `[ADMINBLOCK] ${lineUserId} blocked by ${String(suspendedBy)} — session#${stamped.seq}`,
    );
    return toView(stamped);
  }
}

/** Ids as strings — the same casts `strike.service.ts`'s own `view()` applies. */
function toView(doc: StrikeSessionView): StrikeSessionView {
  return {
    ...doc,
    _id: String(doc._id),
    ...(doc.member_id ? { member_id: String(doc.member_id) } : {}),
    ...(doc.suspended_by ? { suspended_by: String(doc.suspended_by) } : {}),
    by_level: doc.by_level ?? {},
  };
}
