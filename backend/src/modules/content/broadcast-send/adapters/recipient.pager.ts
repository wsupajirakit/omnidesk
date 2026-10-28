/**
 * [FEAT-20260822-BCASTPAGER] Reading the recipient list, one page at a time.
 * ===========================================================================
 * 🔴 `members` HAS NO `hook_id`. This is the single fact the whole file exists
 *    for. Selecting recipients straight from `members` mixes people across
 *    every OA the system talks to, and LINE ids are per channel — so the ids
 *    would not merely be the wrong people, they would be ids that mean nothing
 *    on the channel being sent to. Every page therefore goes through
 *    `chat_rooms {user_id, hook_id}`. members ไม่มี hook_id — ต้องผ่าน chat_rooms เสมอ.
 *
 * TWO STEPS, and the second is not optional:
 *   1. page `members` by the audience filter, keyset by `_id`
 *   2. turn that page's member ids into THIS OA's LINE ids via `chat_rooms`
 *
 * ⚠️ A page can legitimately return ZERO ids — 500 members in a row who all
 *    belong to another channel. That is not the end of the list, and the
 *    executor is written to know the difference (`lastId === null` is the end).
 *
 * revert: delete this file and drop it from `adapters/index.ts`.
 */
import {
  buildOaScopeQueries,
  type OaScopeQuery,
} from '../../audience/oa-scope';
import type { RecipientPage, RecipientPager } from '../oa-executor';
import type { ResumePoint } from '../resume';

/** One page of member rows, already filtered by the audience rules. */
export interface MemberPageRow {
  readonly _id: unknown;
}

export interface RecipientPagerDeps {
  /**
   * Turn the STORED cursor string back into whatever the `_id` column holds.
   *
   * 🔴 WITHOUT THIS THE CURSOR NEVER MOVES. `resume_after_id` is persisted as a
   * string (a history row must be readable), but `members._id` is an ObjectId,
   * and in BSON's comparison order every ObjectId sorts ABOVE every string —
   * so `{ _id: { $gt: "<hex>" } }` matches the whole collection, page 2 returns
   * page 1's rows, and the OA stops with `stalled-pager` after two pages. Every
   * OA larger than one page would send its first chunk and quit, blaming the
   * pager. Found by an independent review; invisible to specs whose fake pager
   * uses numeric strings, where string comparison happens to work.
   * เก็บเป็น string ได้ แต่ตอน query ต้องแปลงกลับเป็น ObjectId ไม่งั้น cursor ไม่ขยับ.
   *
   * Production passes `(id) => new Types.ObjectId(id)`; a spec passes identity.
   * It must never throw — an unconvertible cursor is a run that starts over,
   * not a crash.
   */
  toCursor(id: string): unknown;
  /**
   * Page `members` with the audience filter AND the keyset clause, ordered by
   * `_id`. The caller owns the filter; this adapter only adds the cursor.
   */
  findMemberPage(
    filter: Record<string, unknown>,
    limit: number,
  ): Promise<MemberPageRow[]>;
  /** Run one `chat_rooms` lookup and return the `line_user_id` values it found. */
  findLineIds(query: OaScopeQuery): Promise<string[]>;
}

/**
 * ⚠️ `$gt` and NOT `$gte`: a keyset that includes its own cursor re-reads the
 * last row of the previous page forever. The accumulator would dedupe it, the
 * chunk would never fill, and the run would round — which is exactly the hang
 * `MAX_REFILL_PAGES_PER_CHUNK` was added to catch. Better not to cause it.
 */
export function withCursor(
  filter: Record<string, unknown>,
  point: ResumePoint,
  toCursor: (id: string) => unknown = (id) => id,
): Record<string, unknown> {
  if (point.afterId === null) return { ...filter };
  return { ...filter, _id: { $gt: toCursor(point.afterId) } };
}

export class MongoRecipientPager implements RecipientPager {
  constructor(
    private readonly deps: RecipientPagerDeps,
    /** The audience filter, built once for the run by `buildAudienceFilter`. */
    private readonly baseFilter: Record<string, unknown>,
  ) {}

  /**
   * A cursor that cannot be converted means the stored value is not an id this
   * collection knows. Falling back to the raw string would match everything;
   * `null` restarts the OA from the beginning instead, which re-sends rather
   * than skips — the safe direction, and visible in the counts.
   */
  private safeCursor(id: string): unknown {
    try {
      return this.deps.toCursor(id);
    } catch {
      return null;
    }
  }

  async next(
    hookId: string,
    point: ResumePoint,
    pageSize: number,
  ): Promise<RecipientPage> {
    const rows = await this.deps.findMemberPage(
      withCursor(this.baseFilter, point, (id) => this.safeCursor(id)),
      pageSize,
    );
    if (rows.length === 0) return { ids: [], lastId: null };

    const lastRow = rows[rows.length - 1];
    const lastId = lastRow === undefined ? null : String(lastRow._id);

    const queries = buildOaScopeQueries(
      rows.map((r) => r._id),
      hookId,
    );

    /**
     * 🔴 FAIL CLOSED. `null` means the scoping could not be built — a missing
     * hook id, which would otherwise produce a query matching EVERY OA. The
     * end-of-list answer stops this OA instead of sending to everyone.
     * ขอบเขตอ่านไม่ได้ = ไม่ส่ง ไม่ใช่ส่งทั้งหมด.
     */
    if (queries === null) return { ids: [], lastId: null };

    const ids: string[] = [];
    for (const q of queries) {
      const found = await this.deps.findLineIds(q);
      for (const id of found) {
        if (typeof id === 'string' && id !== '') ids.push(id);
      }
    }

    return { ids, lastId };
  }
}
