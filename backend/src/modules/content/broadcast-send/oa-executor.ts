/**
 * [FEAT-20260822-BCASTEXEC] One OA, walked to its end, its ceiling or its clock.
 * ===========================================================================
 * Split out of `run-executor.ts` when that file passed 700 lines. The two
 * halves answer different questions and are read at different times: this one
 * is where every send-loop decision lives (chunking, guards, the resume
 * commit); the other decides which OAs run and in what order.
 * ⚠️ Behaviour is UNCHANGED by the split — it was a move, not a rewrite. Every
 *    exported name kept its spelling so the barrel and every caller are
 *    untouched, and the executor spec passed before and after with no edits.
 *    ย้ายอย่างเดียว ไม่แก้พฤติกรรม ชื่อ export ทุกตัวเหมือนเดิม.
 *
 * revert: paste this file back on top of `run-executor.ts` and delete it.
 */
import {
  addChunkResult,
  type RunCounters,
} from '../broadcast-history/run-counters';
import { ChunkAccumulator, type BroadcastChunk } from './chunk';
import { describeChunkFailure, type ChunkFailure } from './chunk-failure';
import type { BroadcastChunkSink } from './chunk-sink';
import type { SendCell } from './send-matrix.registry';
import {
  accepted,
  addressesRecipients,
  commitSegments,
  keyFor,
  keyForChunk,
  perRequestSize,
  sendSafely,
  MAX_REFILL_PAGES_PER_CHUNK,
  MEMBER_PAGE_SIZE,
  NO_KEY,
  type PageSegment,
} from './send-loop.helpers';
import type { OaPlan } from './run-plan';
import {
  checkOaGuard,
  checkRunGuard,
  SENDING_ENABLED,
  type GuardStopReason,
  type OaGuardState,
} from './run-guard';
import { advanceResume, FRESH_RESUME, type ResumePoint } from './resume';

/** One page of recipient ids, already scoped to ONE OA (see `oa-scope.ts`). */
export interface RecipientPage {
  readonly ids: readonly string[];
  /** `_id` of the last row, for the next keyset page. `null` = end of list. */
  readonly lastId: string | null;
}

/**
 * The read seam. Mongo in production, an array in the specs.
 *
 * ⚠️ It is handed the resume point, not a page number: a run that stops halfway
 *    and comes back must not re-walk what it already sent. See `resume.ts`.
 */
export interface RecipientPager {
  next(
    hookId: string,
    point: ResumePoint,
    pageSize: number,
  ): Promise<RecipientPage>;
}

/** Injected so a spec can march a run past its deadline without waiting. */
export interface Clock {
  now(): number;
}

export interface OaRunInput {
  readonly runId: string;
  readonly hookId: string;
  /** The type x sub-type the admin ticked. It decides the SHAPE of the run. */
  readonly cell: SendCell;
  readonly plan: OaPlan;
  readonly pager: RecipientPager;
  readonly sink: BroadcastChunkSink;
  readonly clock: Clock;
  /** When the RUN began — the deadline is measured from here, not from this OA. */
  readonly startedAt: number;
  /** Requests already made by earlier OAs in the same run. */
  readonly requestsMadeBefore: number;
  readonly counters: RunCounters;
  readonly resume?: ResumePoint;
  readonly chunkSize?: number;
  /** Member rows per database page. Defaults to `MEMBER_PAGE_SIZE`. */
  readonly pageSize?: number;
  /** Dedupe tracker size. Only a spec needs to lower it; production uses the cap. */
  readonly maxTracked?: number;
  /** Called after every chunk so a long run keeps its claim alive. */
  readonly heartbeat?: (point: ResumePoint) => Promise<void> | void;
  /**
   * [FEAT-20260823-BCASTCARDTYPE] Load this page's per-recipient values.
   *
   * 🔴 CALLED ONCE PER PAGE, NEVER PER RECIPIENT. A personal card is rendered
   *    synchronously, so its values must already be in memory — and fetching
   *    them one at a time would put a `members` read beside every LINE request
   *    on the one path that already costs a request per person.
   *    ต่อหน้า ไม่ใช่ต่อคน.
   *
   * ⚠️ OPTIONAL, so every existing caller and every plain-card run is byte-for
   *    -byte unchanged: no source, no call, no extra read.
   */
  readonly prefetchRecipients?: (
    lineUserIds: readonly string[],
  ) => Promise<void>;
}

export interface OaRunResult {
  readonly counters: RunCounters;
  /** Tags nothing knew about. Reported for logging; no column stores them. */
  readonly unknownTags: readonly string[];
  /** false ⇒ nothing looked at the pictures, so `imagesReplaced` means nothing. */
  readonly imagesMeasured: boolean;
  readonly resume: ResumePoint;
  readonly requestsMade: number;
  /**
   * [FEAT-20260824-BCASTWHYFAILED] What LINE said the FIRST time this OA failed.
   *
   * Absent means no chunk failed — which is a different fact from "it failed
   * and we do not know why", and the reader must be able to tell them apart.
   * See `chunk-failure.ts` for why first-and-not-last, and for why nothing in
   * the send path is allowed to read this. ไม่มีค่า = ไม่เคยพัง ไม่ใช่ พังแล้วไม่รู้สาเหตุ.
   */
  readonly firstFailure?: ChunkFailure;
  /** Absent means the OA finished its list. */
  readonly stoppedBy?:
    | GuardStopReason
    | 'no-retry-key'
    | 'overflow'
    /** The cursor stopped moving — see the refill loop. */
    | 'stalled-pager'
    /** Too many pages for one chunk; the backstop for a pager that lies. */
    | 'pager-not-advancing';
}

/**
 * Walk ONE OA's recipient list to its end, its ceiling, or its deadline.
 *
 * The guards are asked BEFORE every chunk, never after: asking afterwards means
 * the request that crossed the line has already been made. ถามก่อนยิงเสมอ.
 */
export async function executeOa(input: OaRunInput): Promise<OaRunResult> {
  const {
    runId,
    hookId,
    plan,
    pager,
    sink,
    clock,
    startedAt,
    requestsMadeBefore,
    heartbeat,
  } = input;

  /**
   * 🔴 THE CELL DECIDES, not LINE's cap.
   *
   * `multicast:personal` says `recipientsPerRequest: 1` because a personal card
   * is rendered for ONE person. An earlier version defaulted to LINE's 500 and
   * ignored the cell, which would have packed 500 people into one multicast
   * carrying ONE person's card — everybody reading a stranger's name, balance
   * and history. Not a rate-limit bug: a data-leak bug.
   * การ์ดรายคนต้องหนึ่ง request ต่อหนึ่งคน — เพดาน 500 ของ LINE ไม่เกี่ยว.
   */
  const size = input.chunkSize ?? perRequestSize(input.cell);
  const pageSize = input.pageSize ?? MEMBER_PAGE_SIZE;
  let counters = input.counters;

  /**
   * TWO cursors, deliberately.
   *
   * `readPoint` is where the pager has got to. `point` is what this OA PROMISES
   * it has finished — the thing a resumed run starts from. They are only ever
   * equal when every id read so far has ridden in an accepted chunk.
   * อ่านถึงไหน กับ ส่งสำเร็จถึงไหน ไม่ใช่ตัวเดียวกัน.
   */
  let readPoint = input.resume ?? FRESH_RESUME(hookId);
  let point = readPoint;
  /** Pages read but not yet fully spent. See `commitSegments`. */
  const segments: PageSegment[] = [];
  /**
   * Tags nothing knew about, across the whole OA.
   *
   * ⚠️ REPORTED, NOT STORED. `broadcasts_histories` has no column for them and
   * adding one is a schema change that needs the owner's approval, so they ride
   * out on `OaOutcome` where a service can log them. A card quietly rendering
   * `N/A` in ten places is worth knowing about the first time, not the tenth.
   */
  const unknownTags = new Set<string>();
  /**
   * Did ANY chunk report an image measurement?
   *
   * The dry-run sink renders nothing and measures nothing, so a row from it
   * must not claim "0 broken pictures". เคยมีใครวัดไหม ต้องตอบได้.
   */
  let imagesMeasured = false;
  let requestsMade = requestsMadeBefore;
  let oaState: OaGuardState = {
    requestsMade: 0,
    recipientsAttempted: 0,
    consecutiveFailures: 0,
    sawRateLimit: false,
  };

  /**
   * [FEAT-20260824-BCASTWHYFAILED] Keep the FIRST failure only.
   *
   * ⚠️ `firstFailure ??=` and not `=`: a later chunk must never overwrite the
   *    answer that explains why the OA started failing. See `chunk-failure.ts`.
   * ⚠️ An OBSERVER — no guard, counter, resume point or retry key reads it, so
   *    every line here can be deleted without changing who receives what.
   */
  let firstFailure: ChunkFailure | undefined;
  const noteFailure = (result: {
    readonly status?: number;
    readonly error?: string;
  }): void => {
    firstFailure ??= describeChunkFailure(result);
  };

  const done = (stoppedBy?: OaRunResult['stoppedBy']): OaRunResult => ({
    counters,
    resume: point,
    requestsMade,
    unknownTags: [...unknownTags],
    imagesMeasured,
    ...(firstFailure === undefined ? {} : { firstFailure }),
    ...(stoppedBy ? { stoppedBy } : {}),
  });

  if (!SENDING_ENABLED) return done('disabled');
  if (!plan.sendable) return done('disabled');

  /**
   * ⚠️ THE BROADCAST PIPE IS A DIFFERENT SHAPE, not a chunk size of infinity.
   *
   * `/message/broadcast` takes no recipient list: LINE fans out to every friend
   * of the OA. So there is nothing to page, nothing to chunk, nothing to dedupe
   * and nothing to resume — one request per OA, and the guards still apply to
   * it. Forcing it through the multicast loop would page an audience the
   * request never uses. ท่อ broadcast ไม่รับรายชื่อ จึงไม่มีอะไรให้แบ่งหรือ resume.
   *
   * The recipient count is the PLAN's estimate: LINE reports no per-person
   * outcome for a broadcast, so a history row from this path is an estimate by
   * nature and must be read as one.
   */
  if (!addressesRecipients(input.cell)) {
    const runVerdict = checkRunGuard({
      elapsedMs: clock.now() - startedAt,
      totalRequestsMade: requestsMade,
    });
    if (runVerdict.stop) return done(runVerdict.reason);

    const key = keyFor(runId, hookId, 0);
    if (key === NO_KEY) return done('no-retry-key');

    const result = await sendSafely(
      sink,
      { index: 0, to: [] },
      key,
      hookId,
      runId,
    );
    if (!accepted(result)) noteFailure(result);
    counters = addChunkResult(counters, plan.recipients, accepted(result));
    requestsMade += 1;
    point = { ...point, nextChunkIndex: 1 };
    if (heartbeat) await heartbeat(point);
    return done();
  }

  /**
   * 🔴 SEEDED FROM THE RESUME POINT. Starting at 0 on a resumed run reuses a
   * retry key that LINE has already recorded — it answers 409, 409 counts as
   * delivered, and a whole chunk of people is marked sent without being sent.
   * Proven by review, not theorised. See `chunk.ts`.
   */
  const acc = new ChunkAccumulator(
    size,
    input.maxTracked,
    point.nextChunkIndex,
  );
  /**
   * Chunks the accumulator has already completed but that have not been sent.
   *
   * ⚠️ `ChunkAccumulator.push()` HANDS BACK a full chunk the moment one closes;
   *    `chunkCount` counts what it has emitted, not what is waiting. Reading it
   *    as "is a chunk ready?" would send nothing at all. อ่าน API ให้ตรง ไม่ใช่เดา.
   */
  const ready: BroadcastChunk[] = [];
  let exhausted = false;
  let tailFlushed = false;
  /**
   * 🔴 THE FIRST UNACCEPTED CHUNK IS THE FURTHEST THIS OA MAY EVER PROMISE.
   * One cursor + one index cannot say "done, except those two", so a failure
   * freezes the point for good. Later chunks still go (the failure ceiling is
   * `run-guard.ts`'s, not this flag's) — they just stop moving the promise.
   * `commitSegments` carries the measurement. ก้อนที่ไม่ตอบรับ = เพดานของ cursor.
   */
  let unackedGap = false;

  for (;;) {
    // Refill until a chunk is ready, or the recipient list runs out.
    let pagesForThisChunk = 0;
    while (ready.length === 0 && !exhausted) {
      pagesForThisChunk += 1;
      if (pagesForThisChunk > MAX_REFILL_PAGES_PER_CHUNK) {
        return done('pager-not-advancing');
      }
      /**
       * 🔴 THE GUARD IS ASKED HERE TOO, not only before a send.
       *
       * Found by a mutation that hung the suite instead of failing it: every
       * other guard sits on the SEND path, so a pager that keeps answering
       * without ever completing a chunk never reaches one. A loop no ceiling
       * can see is a hung worker holding its claim until the lease expires.
       * ลูปที่ guard มองไม่เห็น = process ค้าง ไม่ใช่แค่ช้า.
       */
      const refillVerdict = checkRunGuard({
        elapsedMs: clock.now() - startedAt,
        totalRequestsMade: requestsMade,
      });
      if (refillVerdict.stop) return done(refillVerdict.reason);

      const before = readPoint.afterId;
      const acceptedBefore = acc.acceptedCount;
      const page = await pager.next(hookId, readPoint, pageSize);

      /* [FEAT-20260823-BCASTCARDTYPE] The page's values, in one read, BEFORE
         any of its chunks is rendered. A plain run passes no prefetch and this
         line does nothing at all. */
      if (input.prefetchRecipients && page.ids.length > 0) {
        await input.prefetchRecipients(page.ids);
      }

      for (const id of page.ids) {
        const full = acc.push(id);
        if (full) ready.push(full);
      }
      // Only ids the accumulator ACCEPTED count — duplicates and blanks were
      // dropped and must not hold the cursor back.
      const fresh = acc.acceptedCount - acceptedBefore;

      /**
       * 🔴 `lastId === null` IS THE ONLY END. An empty page is not the end.
       *
       * The pager reads MEMBERS and returns the LINE ids of the ones that
       * belong to this OA, so a page can legitimately yield zero ids — 500
       * members in a row who all belong to a different channel. Treating that
       * as the end stopped the OA mid-list and reported success, which is the
       * silent-partial-send failure this whole design exists to prevent.
       * หน้าว่างไม่ใช่จบ — จบคือ cursor บอกว่าไม่มีต่อแล้ว.
       *
       * The round risk this opens is covered twice over: the cursor-progress
       * check below, and `MAX_REFILL_PAGES_PER_CHUNK`.
       */
      if (page.lastId === null) {
        exhausted = true;
        // Nothing further can be read, so anything still buffered is the tail;
        // its cursor is the end of the list and commits with the last chunk.
        continue;
      }
      segments.push({ cursor: page.lastId, remaining: fresh });
      readPoint = advanceResume(readPoint, page.lastId);

      /**
       * 🔴 NO PROGRESS = THE END, not "try again".
       *
       * A cursor that does not move means the pager is handing back the same
       * rows — a broken keyset query, a stalled cursor, or ids the accumulator
       * has already seen and dropped. Reading on would round forever on a page
       * that can never complete a chunk. Treated as the end of the list, and
       * reported, because a run that stopped early must never look finished.
       * cursor ไม่ขยับ = จบ ไม่ใช่วนอ่านซ้ำ.
       */
      if (readPoint.afterId === before) return done('stalled-pager');
    }

    // The last chunk is short by definition — flush it once, at the very end.
    if (ready.length === 0 && exhausted && !tailFlushed) {
      tailFlushed = true;
      const tail = acc.flush();
      if (tail) ready.push(tail);
    }

    const chunk = ready.shift();
    if (chunk === undefined) return done();

    // ⚠️ Refusing beyond `maxTracked` is what keeps dedupe honest (see chunk.ts).
    // A run that overflowed its tracker cannot promise "no duplicates", so it
    // stops instead of quietly sending someone the same card twice.
    if (acc.didOverflow) return done('overflow');

    const runVerdict = checkRunGuard({
      elapsedMs: clock.now() - startedAt,
      totalRequestsMade: requestsMade,
    });
    if (runVerdict.stop) return done(runVerdict.reason);

    const oaVerdict = checkOaGuard(oaState);
    if (oaVerdict.stop) return done(oaVerdict.reason);

    // 🔴 KEYED BY WHO IS IN IT, NOT BY WHICH NUMBER IT IS (D4): the audience is
    // live, so index 2 on a resumed run is not the people index 2 held an hour
    // ago, and LINE answers 409 to the key — not to the list it carries.
    // See `audienceFingerprint`. คีย์ผูกกับคนในก้อน ไม่ใช่เลขก้อน.
    const key = keyForChunk(runId, hookId, chunk);
    if (key === NO_KEY) return done('no-retry-key');

    const result = await sendSafely(sink, chunk, key, hookId, runId);
    const ok = accepted(result);
    if (!ok) noteFailure(result);

    counters = addChunkResult(counters, chunk.to.length, ok, {
      imagesReplaced: result.imagesReplaced,
    });
    if (result.imagesReplaced !== undefined) imagesMeasured = true;
    for (const t of result.unknownTags ?? []) unknownTags.add(t);
    requestsMade += 1;
    oaState = {
      requestsMade: oaState.requestsMade + 1,
      recipientsAttempted: oaState.recipientsAttempted + chunk.to.length,
      consecutiveFailures: ok ? 0 : oaState.consecutiveFailures + 1,
      sawRateLimit: oaState.sawRateLimit || result.status === 429,
    };

    /**
     * 🔴 THE COMMIT. An accepted chunk moves the resume point only while every
     * chunk before it was accepted too.
     *
     * The old comment said "on failure nothing advances". True only until the
     * NEXT success: the failed chunk had left the ready queue but its people
     * were still at the front of `segments`, so the next accepted chunk spent
     * them and the cursor stepped over people LINE never took. A failure now
     * freezes the whole point — both fields, since half a truth here is a lie.
     * ล้มเหลว = แช่แข็งจุด resume ทั้งคู่ ไม่ใช่แค่ "รอบนี้ไม่ขยับ".
     */
    if (!ok) unackedGap = true;
    else if (!unackedGap) {
      point = {
        hookId,
        afterId: commitSegments(segments, chunk.to.length, point.afterId),
        nextChunkIndex: chunk.index + 1,
      };
    }
    if (heartbeat) await heartbeat(point);
  }
}
