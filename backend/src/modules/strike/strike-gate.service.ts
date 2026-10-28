import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  STRIKE_TRACKING,
  STRIKE_TRACKING_CONFIG,
  type StrikeTrackingConfig,
} from './strike.config';
import {
  DEFAULT_SUSPEND_AT,
  DEFAULT_SUSPEND_WINDOW_HOURS,
  buildSuspendedPipeline,
  shouldSuspend,
  suspendWindowStart,
} from './strike-suspend.helper';
import type { StrikeGate, SuspendedSession } from './strike-gate.port';
import {
  MemberStrikeEvent,
  type MemberStrikeEventDocument,
} from './schemas/member-strike-event.schema';
import {
  MemberStrikeSession,
  type MemberStrikeSessionDocument,
} from './schemas/member-strike-session.schema';

/**
 * [FEAT-20260826-STRIKESUSPEND] The read side of strike tracking.
 * ===========================================================================
 * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * WHY THIS IS ITS OWN SERVICE AND NOT ANOTHER METHOD ON `StrikeService`.
 * Two reasons, and the second is the one that matters:
 *
 *   1. `strike.service.ts` crossed the repo's 400-line warning the moment this
 *      landed in it, and §6.1's rule is that the waiver list may only SHRINK.
 *   2. More importantly, the gate and the sink are different features with
 *      different lifetimes. The sink RECORDS; this DECIDES. A deployment can run
 *      one without the other — this repo recorded strikes for two days before
 *      anything read them — and "remove the gate and nothing changes" is a much
 *      easier thing to prove when the gate is a file you delete.
 *      ถอดได้จริงคือถอดไฟล์ทิ้ง ไม่ใช่ไล่ลบเมธอดออกจากไฟล์ที่คนอื่นใช้อยู่
 *
 * It shares no state with `StrikeService` — it reads the same two collections
 * through its own injected models, so neither can break the other by changing a
 * private field.
 *
 * revert: delete this file, its token binding in `strike.module.ts`, and the
 * webhook call site (which the plug-in patch does in one command).
 */
@Injectable()
export class StrikeGateService implements StrikeGate {
  private readonly logger = new Logger(StrikeGateService.name);
  private readonly cfg: StrikeTrackingConfig;

  constructor(
    @InjectModel(MemberStrikeSession.name)
    private readonly sessionModel: Model<MemberStrikeSessionDocument>,
    @InjectModel(MemberStrikeEvent.name)
    private readonly eventModel: Model<MemberStrikeEventDocument>,
    @Optional()
    @Inject(STRIKE_TRACKING_CONFIG)
    cfg?: StrikeTrackingConfig,
  ) {
    this.cfg = cfg ?? STRIKE_TRACKING;
  }

  /**
   * [FEAT-20260826-STRIKESUSPEND] Should the webhook stay silent for this
   * customer? Arms the latch when they have just crossed the line.
   * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`
   *
   * THREE OUTCOMES, AND THEIR COSTS — the order is the design, not an accident:
   *
   *   already locked  → 1 indexed findOne, then return. **No counting at all.**
   *                     A locked customer is the CHEAPEST case in the system,
   *                     which is what makes a flood harmless: the more they
   *                     send, the less each message costs us.
   *   never blocked   → 1 indexed findOne, then return. No open session, nothing
   *                     to count.
   *   counting        → that findOne plus one indexed `countDocuments` over the
   *                     window. Only this branch touches the events collection.
   *
   * ⚠️ CHECK AND ARM ARE ONE CALL, deliberately. Splitting them would leave a gap
   * two concurrent events could both pass through, and the webhook holds no lock
   * across a pair of calls. The `$set` is guarded by `suspended_at: null` in its
   * own filter, so a race writes the stamp once and the loser is a no-op.
   *
   * ⚠️ NEVER THROWS. A read that fails answers `false`: one customer answered who
   * should not have been is a smaller wrong than a webhook that drops real
   * traffic because Mongo hiccuped. ถามไม่ได้ = ตอบปกติ ไม่ใช่เงียบใส่ทุกคน
   */
  public async isSuspended(
    lineUserId: string | undefined | null,
  ): Promise<boolean> {
    if (!lineUserId) return false;

    try {
      const open = await this.sessionModel
        .findOne({ line_user_id: lineUserId, status: 'open' })
        .lean<{ _id: Types.ObjectId; suspended_at?: Date } | null>()
        .exec();

      if (!open) return false;
      // Already armed — answer and stop. This is the branch a flood lands in.
      if (open.suspended_at) return true;

      const threshold = this.cfg.suspendAt ?? DEFAULT_SUSPEND_AT;
      const since = suspendWindowStart(
        new Date(),
        this.cfg.suspendWindowHours ?? DEFAULT_SUSPEND_WINDOW_HOURS,
      );

      /* Counted on the EVENTS, not on `strike_total`: that column is a running
         total that only ever grows, so it cannot answer "how many recently".
         Served by `{session_id, occurred_at:-1}` — measured 1 ms at 1.2M rows. */
      const recent = await this.eventModel.countDocuments({
        session_id: open._id,
        occurred_at: { $gte: since },
      });

      if (!shouldSuspend(recent, threshold)) return false;

      await this.sessionModel.updateOne(
        // the guard lives in the FILTER, so a concurrent arm is a no-op rather
        // than a second write with a later timestamp
        { _id: open._id, suspended_at: null },
        { $set: { suspended_at: new Date() } },
      );

      this.logger.warn(
        `[STRIKESUSPEND] ${lineUserId} locked — ${recent} strikes in the window (threshold ${threshold})`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `[STRIKESUSPEND] check failed for ${lineUserId}: ${errText(err)}`,
      );
      return false;
    }
  }

  /**
   * Everyone the bot is currently ignoring, newest lock first.
   *
   * Served by the PARTIAL index on `suspended_at` — it holds only the rows that
   * carry the field, so this reads 50 documents whether the collection has two
   * or two million. Measured on a throwaway 400,000-session collection (26/08):
   * without that index the same query is a COLLSCAN, 123 ms; with it, 1 ms.
   * ต้นทุนผูกกับจำนวนแถวบนจอ ไม่ใช่ขนาดฐาน
   *
   * ⚠️ NOT PAGINATED, and capped instead. This is a glance-at-it tray, not a
   * report: a header dropdown that needs a second page is a screen that should
   * have been a page. If the cap is ever reached in practice, that is a signal
   * to build the page, not to raise the number quietly.
   *
   * ⚠️ Never rejects. A header that throws takes the whole app down with it, and
   * the cost of an empty tray is that an admin has to look at a customer to see
   * they are locked — which is where they were before this existed.
   */
  public async listSuspended(limit = 50): Promise<SuspendedSession[]> {
    try {
      const rows = await this.sessionModel
        .aggregate<SuspendedSession>(
          // the builder owns the clamp — see its note on NaN
          buildSuspendedPipeline(limit) as unknown as Parameters<
            typeof this.sessionModel.aggregate
          >[0],
        )
        .exec();
      return rows ?? [];
    } catch (err) {
      this.logger.error(`[STRIKESUSPEND] tray read failed: ${errText(err)}`);
      return [];
    }
  }

  /**
   * The two numbers the screen must never hold itself.
   *
   * 🔴 The modal tells an admin "two more strikes and the bot stops answering
   * this customer". If the dashboard owned that threshold, changing
   * `STRIKE_SUSPEND_AT` on the server would make the screen lie — and no test on
   * either side would notice, because both would still be internally consistent.
   * เลขต้องมาจากที่เดียวกับที่ตัดสิน ไม่งั้นหน้าจอโกหกโดยไม่มีใครรู้
   */
  public suspendPolicy(): { suspend_at: number; window_hours: number } {
    return {
      suspend_at: this.cfg.suspendAt ?? DEFAULT_SUSPEND_AT,
      window_hours: this.cfg.suspendWindowHours ?? DEFAULT_SUSPEND_WINDOW_HOURS,
    };
  }
}

/** Message of an unknown throw, without assuming it is an Error. */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
