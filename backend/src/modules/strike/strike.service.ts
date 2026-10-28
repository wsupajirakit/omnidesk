import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import {
  STRIKE_TRACKING,
  STRIKE_TRACKING_CONFIG,
  type StrikeTrackingConfig,
} from './strike.config';
import {
  ROLLUP_SESSION_CAP,
  foldLevelRows,
  foldSessions,
} from './strike-rollup.helper';
import type { StrikeRecordInput, StrikeSink } from './strike-sink.port';
import {
  MemberStrikeEvent,
  type MemberStrikeEventDocument,
} from './schemas/member-strike-event.schema';
import {
  MemberStrikeSession,
  type MemberStrikeSessionDocument,
} from './schemas/member-strike-session.schema';

/* [FEAT-20260827-ADMINBLOCK] lives in its own file now (ratchet — its header
   says why); re-exported here so no existing import moves an inch. */
export type { StrikeSessionView } from './strike-session-view';
import type { StrikeSessionView } from './strike-session-view';

/**
 * [FEAT-20260826-STRIKEROLLUP] One customer's whole record, folded into one answer.
 *
 * WHY THIS EXISTS: every read that came before it answers about ONE session.
 * `currentFor` returns the ledger that is counting right now, and the moment an
 * admin clears it that number restarts at zero — while the strikes it counted
 * stay on the closed session for ever. So "how many times has this customer been
 * blocked, in total, at which levels" had no answer in one call: the caller had
 * to pull `sessionsFor` and add the sessions up by hand, and nothing in this
 * codebase did. เส้นนี้ตอบ "ทั้งชีวิต" ไม่ใช่ "รอบที่กำลังนับอยู่"
 */
export interface StrikeRollupView {
  line_user_id: string;
  /** Which of the two paths answered. The caller never has to infer it. */
  scope: 'lifetime' | 'range';
  /** Echoed back on the lifetime path; `null` on the ranged one, which has no session. */
  session_status: 'all' | 'open' | 'closed' | null;
  total: number;
  by_level: Record<string, number>;
  /**
   * How many sessions were folded. `null` — never `0` — on the ranged path,
   * because that path counts EVENTS and genuinely did not look at a session.
   * Zero there would be a number that reads as a measurement and is not one.
   */
  sessions_counted: number | null;
  /** Always present, always a boolean. See ROLLUP_SESSION_CAP for why. */
  truncated: boolean;
  first_strike_at?: Date;
  last_strike_at?: Date;
  range: { from: Date; to: Date } | null;
}

/** Duplicate-key error code. A first-strike race hits this and is expected. */
const MONGO_DUPLICATE_KEY = 11000;

/**
 * [FEAT-20260824-STRIKESESSION] Reads and writes the two strike collections.
 * ===========================================================================
 * 📖 HANDOVER DOC: `docs/strike-session.md` — read that first; it is the operating
 *    manual (what it is, the API, permissions, how to switch it on and off).
 *    Design + measurements: `docs/strike-count-design.md`.
 *
 * This is the whole feature's I/O. It has no clock of its own, no counter of
 * its own, and it never decides that somebody deserves a strike — the rate
 * ladder decides that, and this service records what was decided. It is an
 * observer, not a judge. ตัวนี้เป็นผู้สังเกตการณ์ ไม่ใช่ผู้ตัดสิน
 *
 * WHAT IT MUST NEVER DO, in order of how badly it would hurt:
 *   1. throw out of `record()` — it runs on the live webhook path (see
 *      `strike-sink.port.ts`). Everything is caught here.
 *   2. delete anything. Clearing a session closes it and opens the next one;
 *      the events of the closed session are the history the owner asked for.
 *   3. read or write any other module's collection. It stores the ids it is
 *      handed and joins nothing.
 *
 * revert: delete `src/modules/strike/` and the two imports that reference it.
 */
@Injectable()
export class StrikeService implements StrikeSink {
  private readonly logger = new Logger(StrikeService.name);
  private readonly cfg: StrikeTrackingConfig;

  constructor(
    @InjectModel(MemberStrikeSession.name)
    private readonly sessionModel: Model<MemberStrikeSessionDocument>,
    @InjectModel(MemberStrikeEvent.name)
    private readonly eventModel: Model<MemberStrikeEventDocument>,
    // Code-level config (see strike.config.ts). Injectable only so a spec can
    // hand in a variant; production binds nothing and gets the default.
    @Optional()
    @Inject(STRIKE_TRACKING_CONFIG)
    cfg?: StrikeTrackingConfig,
  ) {
    this.cfg = cfg ?? STRIKE_TRACKING;
  }

  /* ══════════════════════════════════════════════════════════════════════
     WRITE — the pipe
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Records one strike into the customer's open session, creating that session
   * if this is their first strike since the last clear.
   *
   * NEVER THROWS. A failure here must not cost the customer their reply, so
   * every path ends in a log line, not an exception.
   *
   * ⚠️ ORDER IS LOAD-BEARING: the EVENT IS WRITTEN BEFORE THE COUNTER MOVES.
   * The first version did it the other way round and that was a real defect,
   * caught while reviewing rather than by a test: the `$inc` succeeded, the
   * event insert was then rejected, and the session was left reporting a strike
   * with nothing in the log to explain it — visible only as one ERROR line.
   * A counter cannot be reconstructed from nothing, but it CAN be recounted from
   * the log, so the log has to be the thing that survives. Now the worst case is
   * a counter one behind the log, which is recoverable and self-corrects on the
   * next strike. เขียน log ก่อนเสมอ · ตัวนับตามหลัง เพราะนับใหม่จาก log ได้ แต่ย้อนกลับไม่ได้
   *
   * The counter update itself is still ONE atomic command:
   *   `$inc`  strike_total and the level's own tally
   *   `$min`  first_strike_at  — sets a MISSING field, keeps the earliest after
   *   `$max`  last_strike_at   — always moves forward
   * so two strikes landing together cannot lose one.
   *
   * ⚠️ `$min` only works because `first_strike_at` has NO default. A stored
   * `null` would win every comparison (null sorts below dates) and the field
   * would stay null for ever. See the schema note before touching it.
   */
  public async record(input: StrikeRecordInput): Promise<void> {
    /* ⚠️ EVERYTHING lives inside the try, including the switch check. This method
       is fired with `void` on the live webhook path, so a rejected promise is an
       UNHANDLED REJECTION — which Node terminates the process for. One line
       above the try, added innocently later, would turn a strike-tracking
       hiccup into the whole webhook going down.
       ห้ามมีโค้ดบรรทัดไหนอยู่นอก try ในเมธอดนี้ · หลุดบรรทัดเดียว = process ตาย */
    try {
      if (!this.cfg.enabled) return;

      const hookId = toObjectId(input.hookId);
      if (!input.lineUserId || !hookId) {
        // Not an error worth a stack trace: a webhook event with no OA or no
        // user id has nothing to attribute a strike to.
        this.logger.warn(
          `[STRIKE] skipped — lineUserId=${String(input.lineUserId)} hookId=${String(input.hookId)}`,
        );
        return;
      }

      const memberId = toObjectId(input.memberId);

      // 1. the ledger this strike belongs to must exist before it can be logged
      const open =
        (await this.currentFor(input.lineUserId)) ??
        (await this.openSessionThenRead(input.lineUserId, memberId));

      if (!open) {
        this.logger.error(
          `[STRIKE] could not attach a session for ${input.lineUserId} — strike not recorded`,
        );
        return;
      }

      // 2. the log — first, so a failure here counts nothing at all
      await this.eventModel.create({
        session_id: open._id,
        hook_id: hookId,
        line_user_id: input.lineUserId,
        ...(memberId ? { member_id: memberId } : {}),
        level: input.level,
        limit: input.limit,
        window_seconds: input.windowSeconds,
        ...(input.messageType ? { message_type: input.messageType } : {}),
        // [FEAT-20260826-STRIKESUSPEND] display-only snapshot; see the schema note.
        ...(input.hookAlias ? { hook_alias: input.hookAlias } : {}),
        occurred_at: input.occurredAt,
      });

      // 3. the counter, derived from the log and recountable from it
      const session = await this.applyStrike(input);

      this.logger.log(
        `[STRIKE] ${input.lineUserId} session#${session?.seq ?? open.seq} total=${session?.strike_total ?? '?'} level=${input.level}`,
      );
    } catch (err) {
      // Swallowed on purpose — see the class header and strike-sink.port.ts.
      this.logger.error(
        `[STRIKE] record failed for ${String(input.lineUserId)}: ${errText(err)}`,
      );
    }
  }

  /** The `$inc`. Returns null when the customer has no open session yet. */
  private async applyStrike(
    input: StrikeRecordInput,
  ): Promise<StrikeSessionView | null> {
    const updated = await this.sessionModel
      .findOneAndUpdate(
        { line_user_id: input.lineUserId, status: 'open' },
        {
          $inc: { strike_total: 1, [`by_level.${input.level}`]: 1 },
          $min: { first_strike_at: input.occurredAt },
          $max: { last_strike_at: input.occurredAt },
        },
        { new: true },
      )
      .lean<StrikeSessionView | null>()
      .exec();

    return updated ? view(updated) : null;
  }

  /**
   * First strike since the last clear: open a session and hand it back.
   *
   * The insert can lose a race with a concurrent first strike. That is expected
   * and harmless — the partial unique index rejects the loser with E11000, and
   * the read below then returns the winner's session. Both strikes then land in
   * the same ledger, which is exactly what we want.
   */
  /* [FEAT-20260827-ADMINBLOCK] was `private`; `StrikeAdminService` reuses this
     exact ensure step for block-before-first-strike rather than duplicating the
     seq/race machinery below. Public visibility is the whole diff. */
  public async openSessionThenRead(
    lineUserId: string,
    memberId: Types.ObjectId | null,
  ): Promise<StrikeSessionView | null> {
    await this.openSession(lineUserId, memberId);
    return this.currentFor(lineUserId);
  }

  /**
   * Creates the next session for a customer. Also used by the PATCH route right
   * after it closes one, so the admin screen shows "round 2, 0 strikes" instead
   * of a gap until the customer floods again.
   *
   * `seq` is read from the newest row rather than counted, so a purge of old
   * rows (should one ever be added) cannot make numbers repeat.
   */
  private async openSession(
    lineUserId: string,
    memberId: Types.ObjectId | null,
  ): Promise<void> {
    const last = await this.sessionModel
      .findOne({ line_user_id: lineUserId })
      .sort({ seq: -1 })
      .select({ seq: 1 })
      .lean<{ seq?: number } | null>()
      .exec();

    try {
      await this.sessionModel.create({
        line_user_id: lineUserId,
        ...(memberId ? { member_id: memberId } : {}),
        seq: (last?.seq ?? 0) + 1,
        status: 'open',
        strike_total: 0,
        by_level: {},
        opened_at: new Date(),
      });
    } catch (err) {
      if (isDuplicateKey(err)) return; // someone else opened it first — fine
      throw err;
    }
  }

  /**
   * [FEAT-20260824-STRIKESESSION] THE PLUG. Hand it a rate-limit verdict and it
   * decides whether that verdict was a strike and records it. Nothing else.
   *
   * ⚠️ THIS LIVES HERE, NOT IN THE WEBHOOK, ON PURPOSE (owner, 24/08:
   * *"ต้องพร้อมเสียบ ... เทสแล้วเอาออกจากการเสียบจริงด้วย"*). The feature is finished and
   * proven but **deliberately not wired**: `webhook.service.ts` and
   * `webhook.module.ts` are byte-identical to `dev`. Keeping the translation from
   * "a verdict" to "a strike row" in this module means plugging it in later costs
   * ONE line per call site instead of a method, an import and an injection — and
   * means the logic below is under test today rather than the day someone wires
   * it. จุดเสียบอยู่ในโมดูลนี้ · ตอนเสียบจริงเติมบรรทัดเดียวที่ webhook
   *
   * WHERE IT PLUGS IN — the three places `webhook.service.ts` already holds a
   * verdict (line numbers as of `3eff8f4`; re-check them, they move):
   *
   *   :2200  inside the qr-prescan `consumeQuota` callback   → `const v`
   *   :3159  the silent-type charge on the assist path       → `const v`
   *   :3351  the main limiter block                          → `const rateVerdict`
   *
   * and at each one the whole edit is:
   *
   *   void this.strike?.recordFromVerdict(v, userId, asString(hook?.['_id']), event.message?.type);
   *
   * plus `@Optional() @Inject(STRIKE_SINK) private readonly strike?: StrikeSink`
   * as the LAST constructor parameter, and `StrikeModule` in
   * `webhook.module.ts`'s `imports`. Nothing in `webhook/rate-limit/` or
   * `infra/rate-limit/` is touched — the verdict already carries everything.
   *
   * ⚠️ `void` alone is not enough at the call site: a rejected promise is an
   * unhandled rejection and Node terminates for one. This method therefore never
   * rejects — every path is inside `record()`'s try — but add `?.catch(() => {})`
   * anyway, so the webhook does not depend on that staying true.
   *
   * revert: nothing to revert; it is not connected to anything.
   */
  public async recordFromVerdict(
    verdict:
      | {
          strikeAdded?: boolean;
          level?: number;
          limit?: number;
          windowSeconds?: number;
        }
      | null
      | undefined,
    lineUserId: string | undefined,
    hookId: string | undefined,
    messageType?: string,
    memberId?: string | null,
    // [FEAT-20260826-STRIKESUSPEND] display-only; see the port's note.
    hookAlias?: string | null,
  ): Promise<void> {
    // An ordinary message stops here: one property read, no I/O at all.
    if (!verdict?.strikeAdded || !lineUserId || !hookId) return;

    /* ⚠️ NO `?? 0` FALLBACKS. An earlier draft defaulted a missing limit/window to
       zero, which the event schema rejects (`min: 1`) — the log was refused while
       the counter had already moved. A verdict that reached `strikeAdded` always
       carries both; if one is missing that is a bug upstream, and dropping the
       strike is the honest answer, not inventing a number.
       ห้ามเดาค่าที่ schema ไม่ยอมรับ · ทิ้ง strike ดีกว่าเสกเลข */
    if (!verdict.limit || !verdict.windowSeconds) return;

    await this.record({
      hookId,
      lineUserId,
      level: verdict.level ?? 1,
      limit: verdict.limit,
      windowSeconds: verdict.windowSeconds,
      messageType,
      occurredAt: new Date(),
      memberId: memberId ?? null,
      hookAlias: hookAlias ?? null,
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     READ — nothing on the webhook path calls these
     ══════════════════════════════════════════════════════════════════════ */

  /** The session that is counting right now, or null if there is none yet. */
  public async currentFor(
    lineUserId: string,
  ): Promise<StrikeSessionView | null> {
    const doc = await this.sessionModel
      .findOne({ line_user_id: lineUserId, status: 'open' })
      .lean<StrikeSessionView | null>()
      .exec();
    return doc ? view(doc) : null;
  }

  /** Every session this customer has ever had, newest first. */
  public async sessionsFor(
    lineUserId: string,
    limit = 50,
  ): Promise<StrikeSessionView[]> {
    const docs = await this.sessionModel
      .find({ line_user_id: lineUserId })
      .sort({ seq: -1 })
      .limit(clampLimit(limit))
      .lean<StrikeSessionView[]>()
      .exec();
    return docs.map(view);
  }

  /** One session's strikes, newest first — level and datetime, one row each. */
  public async eventsFor(
    sessionId: string,
    limit = 200,
  ): Promise<Record<string, unknown>[]> {
    const id = toObjectId(sessionId);
    if (!id) return [];
    return this.eventModel
      .find({ session_id: id })
      .sort({ occurred_at: -1 })
      .limit(clampLimit(limit, 500))
      .lean<Record<string, unknown>[]>()
      .exec();
  }

  /**
   * Strikes per level over a date range, optionally for one OA.
   *
   * ⚠️ The caller owns the dates. This service does no timezone arithmetic on
   * purpose: `tickets/insight-reports.service.ts:24-70` is the single place that
   * turns Bangkok wall-clock into UTC instants in this codebase, and a second
   * implementation is how the day-boundary bug it documents comes back.
   * เรื่องวันที่ตัดที่เดียว ที่ insight เท่านั้น
   */
  public async summarize(options: {
    from: Date;
    to: Date;
    hookId?: string | null;
  }): Promise<{ total: number; by_level: Record<string, number> }> {
    const hookId = toObjectId(options.hookId);
    const rows = await this.eventModel
      .aggregate<{ _id: number; n: number }>([
        {
          $match: {
            ...(hookId ? { hook_id: hookId } : {}),
            occurred_at: { $gte: options.from, $lte: options.to },
          },
        },
        { $group: { _id: '$level', n: { $sum: 1 } } },
      ])
      .exec();

    const by_level: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      by_level[String(r._id)] = r.n;
      total += r.n;
    }
    return { total, by_level };
  }

  /**
   * [FEAT-20260826-STRIKEROLLUP] The whole record for one customer.
   *
   * TWO PATHS, because two genuinely different questions are being asked and the
   * data that answers them lives in two places:
   *
   *   no from/to  → SESSIONS. `strike_total` and `by_level` are already totalled
   *                 on each session document by the atomic `$inc` in `applyStrike`,
   *                 so the answer is a sum of a handful of small documents. Served
   *                 by the existing `{line_user_id, seq:-1}` index.
   *   with from/to → EVENTS. A session cannot answer "in this window" — it does not
   *                 know when any individual strike inside it happened. Served by
   *                 the existing `{line_user_id, occurred_at:-1}` index.
   *
   * Neither path needs a new index and neither writes anything.
   *
   * ⚠️ WHY THE FOLD IS PLAIN JAVASCRIPT AND NOT AN AGGREGATION. `by_level` is a
   * `Mixed` map, so merging it server-side needs `$objectToArray` + `$unwind` +
   * `$group` — measured working against the real collection on 26/08, and about
   * twenty lines of pipeline nobody can read, to add up five documents. The loop
   * below says the same thing in five. Reach for the pipeline only if session
   * counts ever stop being small, which would mean something else went wrong.
   */
  public async rollupFor(
    lineUserId: string,
    options: {
      from?: Date | null;
      to?: Date | null;
      sessionStatus?: 'all' | 'open' | 'closed';
    },
  ): Promise<StrikeRollupView> {
    const { from, to } = options;
    if (from || to) return this.rollupFromEvents(lineUserId, from, to);

    const status = options.sessionStatus ?? 'all';
    const docs = await this.sessionModel
      .find({
        line_user_id: lineUserId,
        ...(status === 'all' ? {} : { status }),
      })
      .select({
        strike_total: 1,
        by_level: 1,
        first_strike_at: 1,
        last_strike_at: 1,
        _id: 0,
      })
      // one more than the cap, so "there were more" is observable rather than
      // indistinguishable from "there were exactly this many"
      .limit(ROLLUP_SESSION_CAP + 1)
      .lean<
        Array<{
          strike_total?: number;
          by_level?: Record<string, number>;
          first_strike_at?: Date;
          last_strike_at?: Date;
        }>
      >()
      .exec();

    const truncated = docs.length > ROLLUP_SESSION_CAP;
    const folded = truncated ? docs.slice(0, ROLLUP_SESSION_CAP) : docs;
    // the arithmetic lives in the helper — pure, so its rules are provable
    // without a model. `foldSessions` is where the `+=` merge is enforced.
    const { total, by_level, first_strike_at, last_strike_at } =
      foldSessions(folded);

    return {
      line_user_id: lineUserId,
      scope: 'lifetime',
      session_status: status,
      total,
      by_level,
      sessions_counted: folded.length,
      truncated,
      ...(first_strike_at ? { first_strike_at } : {}),
      ...(last_strike_at ? { last_strike_at } : {}),
      range: null,
    };
  }

  /**
   * The ranged half — strikes this customer earned between two instants.
   *
   * ⚠️ DO NOT REPLACE THIS WITH `summarize()`. That method's `$match` carries no
   * `line_user_id` at all (see it above), so reusing it here and filtering after
   * the fact would read every customer's events on every request — a per-person
   * question answered by a whole-collection scan. The one line that differs is
   * the one that matters.
   *
   * ⚠️ BOTH BOUNDS ARE ALWAYS EMITTED, even when the caller supplied one. An
   * open-ended range is expressed as epoch..now rather than by dropping a key,
   * which keeps the filter shape identical on every call — and the test double
   * `z-test/lib/strike-fakes.ts:55` only recognises a range when `$gte` is
   * present, so a `$lte`-only filter would quietly match nothing there.
   */
  private async rollupFromEvents(
    lineUserId: string,
    from?: Date | null,
    to?: Date | null,
  ): Promise<StrikeRollupView> {
    const gte = from ?? new Date(0);
    const lte = to ?? new Date();

    const rows = await this.eventModel
      .aggregate<{ _id: number; n: number }>([
        {
          $match: {
            line_user_id: lineUserId,
            occurred_at: { $gte: gte, $lte: lte },
          },
        },
        { $group: { _id: '$level', n: { $sum: 1 } } },
      ])
      .exec();

    const { total, by_level } = foldLevelRows(rows);

    return {
      line_user_id: lineUserId,
      scope: 'range',
      session_status: null,
      total,
      by_level,
      sessions_counted: null,
      // the events path reads every matching row; there is nothing to cut
      truncated: false,
      range: { from: gte, to: lte },
    };
  }

  /**
   * Does a session with this id exist at all?
   *
   * Only used to tell "no such session" (404) apart from "already closed" (409)
   * after `closeSession` returns null. Projected to `_id`, so it is an index
   * lookup with no document fetched, on a route an admin presses by hand.
   */
  public async sessionsExists(sessionId: string): Promise<boolean> {
    const id = toObjectId(sessionId);
    if (!id) return false;
    const found = await this.sessionModel
      .findOne({ _id: id })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();
    return found !== null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     ADMIN — close a session, start the next one
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Closes an open session and opens the next one. This is "เคลียร์ session".
   *
   * NOTHING IS DELETED. The closed row keeps its totals for ever and its events
   * keep pointing at it, which is the whole point of the split.
   *
   * ⚠️ THE GUARD IS IN THE FILTER, NOT IN AN `if` ABOVE IT. Two admins pressing
   * the button together must not both succeed: the second `findOneAndUpdate`
   * matches nothing and returns null, and the caller answers 409. Reading first
   * and then writing is the exact race `webhook/assist/assist-notification.ts:454-468`
   * documents having already been hit in this codebase.
   *
   * ⚠️ CLOSE BEFORE OPEN, always. The partial unique index allows one open row
   * per customer, so inserting first would collide with the row being replaced.
   *
   * @returns the closed session, or null when there was no open one to close.
   */
  public async closeSession(
    sessionId: string,
    closedBy?: string | null,
    reason?: string | null,
  ): Promise<StrikeSessionView | null> {
    const id = toObjectId(sessionId);
    if (!id) return null;

    const closerId = toObjectId(closedBy);
    const closed = await this.sessionModel
      .findOneAndUpdate(
        { _id: id, status: 'open' },
        {
          $set: {
            status: 'closed',
            closed_at: new Date(),
            ...(closerId ? { closed_by: closerId } : {}),
            ...(reason ? { closed_reason: reason } : {}),
          },
        },
        { new: true },
      )
      .lean<StrikeSessionView | null>()
      .exec();

    if (!closed) return null;

    // Best effort: the next strike would create it anyway (`record` handles a
    // missing open session), so a failure here costs a screen row, not data.
    try {
      await this.openSession(
        closed.line_user_id,
        toObjectId(closed.member_id ?? null),
      );
    } catch (err) {
      this.logger.error(
        `[STRIKE] closed session ${sessionId} but could not open the next one: ${errText(err)}`,
      );
    }

    return view(closed);
  }
}

/* ── small local helpers · none of them touch another module ──────────────── */

/** Casts only what is really an ObjectId; anything else becomes null, never a throw. */
function toObjectId(value?: string | null): Types.ObjectId | null {
  if (!value || !isValidObjectId(value)) return null;
  return new Types.ObjectId(String(value));
}

/** Keeps a caller-supplied page size sane without rejecting the request. */
function clampLimit(limit: number, max = 200): number {
  if (!Number.isFinite(limit) || limit <= 0) return max;
  return Math.min(Math.floor(limit), max);
}

/** Ids as strings, and `by_level` always an object so the FE never sees undefined. */
function view(doc: StrikeSessionView): StrikeSessionView {
  return {
    ...doc,
    _id: String(doc._id),
    ...(doc.member_id ? { member_id: String(doc.member_id) } : {}),
    ...(doc.closed_by ? { closed_by: String(doc.closed_by) } : {}),
    // [FEAT-20260827-ADMINBLOCK] same string-cast rule as closed_by above
    ...(doc.suspended_by ? { suspended_by: String(doc.suspended_by) } : {}),
    by_level: doc.by_level ?? {},
  };
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === MONGO_DUPLICATE_KEY
  );
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
