/**
 * [FEAT-20260822-BCASTEXEC] The send loop's small decisions, on their own.
 * ===========================================================================
 * Pulled out of `oa-executor.ts` to keep that file readable: these are pure,
 * each answers one question, and every one of them encodes a trap that cost
 * something to find. Read them before changing the loop that calls them.
 * ⚠️ A MOVE, not a rewrite — behaviour unchanged, names unchanged.
 *
 * revert: paste this file back into `oa-executor.ts`.
 */
import type { ChunkResult, BroadcastChunkSink } from './chunk-sink';
import type { BroadcastChunk } from './chunk';
import { LINE_MULTICAST_MAX_TO } from './limits';
import { buildChunkRetryKey } from './retry-key';
import type { SendCell } from './send-matrix.registry';

/**
 * A chunk we cannot build a reproducible key for is a chunk we cannot retry
 * safely — resending it could double-send to everyone in it.
 *
 * 🔴 So it is never sent, and the OA stops rather than skipping ahead: skipping
 * would leave a hole in the middle of a list whose resume point then lies.
 * คีย์ไม่ได้ = ส่งไม่ได้ และต้องหยุด ไม่ใช่ข้าม.
 */
export const NO_KEY = Symbol('no-retry-key');

/**
 * How many recipients ride in one request under this cell.
 *
 * `0` means the pipe does not address recipients at all (`broadcast` — LINE
 * fans out to every friend of the OA), and those runs never chunk.
 */
export function perRequestSize(cell: SendCell): number {
  const n = cell.recipientsPerRequest;
  if (!Number.isFinite(n) || n <= 0) return LINE_MULTICAST_MAX_TO;
  return Math.min(Math.floor(n), LINE_MULTICAST_MAX_TO);
}

/**
 * How many pages may be read while assembling ONE chunk.
 *
 * 🔴 A SECOND, INDEPENDENT BOUND. The cursor-progress check below is the smart
 * one; this is the dumb one that cannot be reasoned wrong. A mutation that
 * removed the smart check did not turn the suite red — it HUNG it, because an
 * async loop whose promises resolve immediately starves the timer that would
 * have failed the test. A bound that only works when the other bound works is
 * one bound. ด่านที่สองต้องไม่พึ่งด่านแรก.
 *
 * Sized far above any honest run: with `LINE_MULTICAST_MAX_TO` per page, one
 * chunk needs exactly one page. Reaching 50 means the pager is broken.
 */
export const MAX_REFILL_PAGES_PER_CHUNK = 50;

/**
 * How many MEMBER ROWS one query reads.
 *
 * 🔴 NOT the same number as recipients-per-request, and conflating them was a
 * real defect: the executor passed the LINE request size as the page size, so
 * `multicast:personal` (1 recipient per request) read the database ONE ROW AT A
 * TIME. Since a page can legitimately yield zero ids — members belonging to
 * another channel — 50 consecutive misses is routine, and the run would stop
 * with `pager-not-advancing`, a reason that blames the pager for the
 * executor's mistake.
 * คนต่อ request ของ LINE กับ แถวต่อ query ของ Mongo คนละเรื่องกัน ห้ามใช้ตัวเดียวกัน.
 */
export const MEMBER_PAGE_SIZE = 500;

/**
 * One page's contribution to the buffer: its cursor, and how many of its ids
 * have not yet ridden in an ACCEPTED chunk.
 *
 * 🔴 THIS EXISTS BECAUSE THE CURSOR AND THE SEND ARE NOT THE SAME EVENT.
 *
 * An earlier version advanced the resume point the moment a page was READ.
 * An independent review measured what that costs: a 1,200-recipient OA whose
 * deadline tripped before its first send reported `sent: 0` and a cursor
 * already past recipient 500 — so the resumed run began at 501 and the first
 * 500 people were never messaged by anyone, with no counter, row or log
 * saying so. `resume.ts` states the rule in red — "only call this on success" —
 * and the executor was breaking it on every page.
 * cursor ขยับตาม "ส่งสำเร็จ" เท่านั้น ห้ามขยับตาม "อ่านมาแล้ว".
 */
export interface PageSegment {
  readonly cursor: string;
  remaining: number;
}

/**
 * Consume `count` recipients from the oldest pages, and report the newest
 * cursor that is now completely spent.
 *
 * A page is committable only when every id it contributed has been accepted,
 * so a chunk that straddles two pages commits the first and keeps the second.
 * หน้าไหนใช้หมดแล้วถึง commit ได้ หน้าที่ยังเหลือคนต้องรอ.
 *
 * 🔴 IT SPENDS BY COUNT, SO IT CANNOT SEE A FAILURE — THE CALLER MUST (D3).
 *
 * A chunk that FAILED has already been shifted off the ready queue, but its
 * people are still sitting at the FRONT of this queue. Spend the next accepted
 * chunk's headcount here and it takes THEIR places, and the cursor walks over
 * recipients LINE never took. MEASURED on the old executor: 6 recipients,
 * chunks of 2, chunk 1 fails while 0 and 2 succeed ⇒ the point came back at
 * U2/U3's page, so the resumed run asked for `_id > that` and U2/U3 were
 * skipped forever, while U4/U5 — already delivered — were read again and sent
 * a second time under a fresh key. ⇒ `executeOa` stops committing at the first
 * unaccepted chunk; this function stays a pure "spend N from the front".
 * ฟังก์ชันนี้ไม่รู้จักความล้มเหลว ⇒ ผู้เรียกต้องหยุด commit ตั้งแต่ก้อนแรกที่ไม่ผ่าน.
 *
 * ⚠️ A committed cursor is therefore never AHEAD of the read point, and never
 *    behind it once the queue empties: the newest cursor drained IS the read
 *    point, because a page whose `lastId` is null contributes neither ids nor
 *    a cursor. The executor's tail used to carry an
 *    `exhausted && segments.length === 0 ? readPoint.afterId : committed`
 *    special case for a state that cannot happen — a mutant survived there for
 *    exactly that reason — and it has been deleted rather than tested.
 */
export function commitSegments(
  segments: PageSegment[],
  count: number,
  current: string | null,
): string | null {
  let left = count;
  let cursor = current;

  while (left > 0 && segments.length > 0) {
    const head = segments[0];
    if (head === undefined) break;
    const take = Math.min(left, head.remaining);
    head.remaining -= take;
    left -= take;
    if (head.remaining === 0) {
      cursor = head.cursor;
      segments.shift();
    }
  }

  // Pages that contributed nobody are spent as soon as the pages before them are.
  while (segments.length > 0 && segments[0]?.remaining === 0) {
    cursor = segments[0]?.cursor ?? cursor;
    segments.shift();
  }

  return cursor;
}

/** A pipe that does not address recipients cannot be chunked or resumed. */
export function addressesRecipients(cell: SendCell): boolean {
  return cell.recipientsPerRequest > 0;
}

export function keyFor(
  runId: string,
  hookId: string,
  index: number,
): string | typeof NO_KEY {
  const key = buildChunkRetryKey(runId, hookId, index);
  return key === null ? NO_KEY : key;
}

/** FNV-1a, 32 bits, one seed. Small, fast, and well spread for short ids. */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A number that names EXACTLY this set of people — 52 bits, so it is a safe
 * integer and `buildChunkRetryKey` takes it as-is.
 *
 * 🔴 WHY A FINGERPRINT AND NOT THE CHUNK INDEX (D4)
 * `retry-key.ts` states the trap in its own header: "the key is only as stable
 * as the CHUNK MEMBERSHIP". An index is stable; membership is NOT. The audience
 * is selected live (`resume.ts` documents an unfollow as EXPECTED), so a
 * resumed run re-forms its chunks over a shorter list and index 2 carries
 * different people than it did an hour ago. LINE recognises the key it already
 * recorded, answers 409, `accepted()` reads 409 as delivered — and a whole
 * chunk of people is written into history as sent while their phones stayed
 * quiet. MEASURED: a 5-person audience reporting `sent: 7` with two of them
 * never messaged.
 *
 * Keying on the membership makes the key mean what the 409 assumes it means:
 * "this run has already sent to exactly these people on this OA".
 *   · same people, any index, any attempt ⇒ same key ⇒ 409 ⇒ nobody twice
 *   · different people ⇒ different key ⇒ LINE actually sends ⇒ nobody skipped
 * คีย์ผูกกับ "คนกลุ่มนี้" ไม่ใช่ "ก้อนที่เท่าไหร่".
 *
 * ⚠️ WHAT THIS COSTS. A chunk whose membership changed between attempts gets a
 *    NEW key, so if LINE had in fact delivered the first attempt, its survivors
 *    receive it twice. That is the trade: a visible duplicate for the people
 *    who stayed, instead of a silent non-delivery for the people who shifted
 *    into the chunk. The alternative that avoids both is D52 (snapshot every
 *    chunk's ids at send time), which `resume.ts` rejected for its storage.
 *
 * ⚠️ TWO independent seeds, not one hash doubled: a collision means two
 *    different groups share a key, which is the very failure above. 52 bits
 *    keeps that near one in a million even for a 100,000-chunk run, where 32
 *    bits alone would collide about two times in three. n²/2^53 — do the sum
 *    before narrowing anything here.
 * ⚠️ SORTED, so it names a SET. LINE's `to` order changes nothing about who
 *    receives, and a resumed run must not be defeated by a reordering.
 *
 * revert: pass `chunk.index` to `keyFor` again and delete this function — and
 * expect D4 back with it.
 */
export function audienceFingerprint(to: readonly string[]): number {
  // The count is in the body so that no separator trick can make two different
  // groups canonicalise the same way.
  const body = `${String(to.length)}\u0001${[...to].sort().join('\u0000')}`;
  const hi = fnv1a(body, 0x811c9dc5);
  const lo = fnv1a(body, 0x9e3779b1);
  // hi < 2^32, so hi * 2^20 + 20 bits stays below 2^53 — a safe integer, which
  // is exactly what `buildChunkRetryKey` refuses to work without.
  return hi * 0x100000 + (lo & 0xfffff);
}

/**
 * The retry key for a chunk that addresses recipients.
 *
 * ⚠️ NOT the same question as `keyFor`. The broadcast pipe carries no recipient
 *    list at all, so its one request per OA is still keyed by index 0 — there
 *    is no membership to fingerprint, and the OA id already makes it unique.
 */
export function keyForChunk(
  runId: string,
  hookId: string,
  chunk: BroadcastChunk,
): string | typeof NO_KEY {
  return keyFor(runId, hookId, audienceFingerprint(chunk.to));
}

/**
 * LINE's 409 means an earlier attempt with the same retry key already landed.
 * That is a SUCCESS — the recipients got the message once. Counting it as a
 * failure would make a resumed run report worse than it did.
 * 409 = ของเดิมส่งสำเร็จไปแล้ว ไม่ใช่ความล้มเหลว.
 */
export function accepted(r: ChunkResult): boolean {
  return r.ok || r.status === 409;
}

/**
 * A sink must never throw (see its contract), but a runner that trusts a
 * promise not to reject is one bad implementation away from killing a campaign
 * mid-list with no history row. Treated as a plain failed chunk.
 */
export async function sendSafely(
  sink: BroadcastChunkSink,
  chunk: BroadcastChunk,
  retryKey: string,
  hookId: string,
  runId: string,
): Promise<ChunkResult> {
  try {
    return await sink.send({ chunk, retryKey, hookId, runId });
  } catch (e) {
    return {
      ok: false,
      sent: 0,
      error: e instanceof Error ? e.message : 'sink threw',
    };
  }
}
