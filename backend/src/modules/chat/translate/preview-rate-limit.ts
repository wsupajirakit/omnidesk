/**
 * [FEAT-20260908-CHATTRANS] the composer preview's own throttle — 6 a minute,
 * per admin, per room.
 * ===========================================================================
 * Owner, 09/09: *"ทำตัว limit สำหรับ translate ข้อสองไว้ด้วย 1 นาทีแปลได้ 6 ครั้ง แต่ต้อง
 * สเกลและแก้ไขได้ง่าย ไม่ fix ตาย — เฉพาะสำหรับข้อสองเท่านั้น ไม่กระทบส่วนอื่น"*
 *
 * ## Why only the preview needs one
 *
 * A press on a CUSTOMER'S message is free after the first: the answer is stored
 * on the message and a second press reads it. A composer preview cannot be
 * cached that way — the draft has not been sent, so there is no row to hang a
 * translation on — and every press is a billed vendor call. The limit is the
 * cache's stand-in on that side.
 * ฝั่งอ่านมี cache กันซ้ำ · ฝั่งพิมพ์ไม่มีอะไรให้เก็บ เลยต้องมีลิมิตแทน.
 *
 * ## 🔴 IT EDITS ZERO LINES OF `src/infra/rate-limit/`
 *
 * The natural-looking move — adding a `RateLimitBucket` value — is the wrong
 * one: `limitsFor()` (`rate-limit.service.ts:190-228`) is an exhaustive `switch`
 * with NO `default:` clause, so a new bucket does not compile until that file is
 * edited, and that file is what login, the global limiter and the webhook's
 * per-user ladder all read.
 *
 * The seam that touches nothing is the caller-supplied override.
 * `rate-limit.service.ts:98` reads
 *
 *     const { limit, windowSeconds } = override ?? this.limitsFor(bucket);
 *
 * so when an override is passed `limitsFor` is never consulted at all, and
 * `RateLimitOverride`'s own doc comment describes exactly this use: the caller
 * "decides the numbers and names the window with `keySuffix`, so an escalated
 * window never shares a counter with the base one."
 *
 * Isolation therefore runs BOTH ways and on three independent layers:
 *   · the key    — ours is `ratelimit:<env>:default:<admin>:<room>:aitr`; the
 *                  ladder's is `…:default:<lineUserId>`; login's is
 *                  `…:login:<ip>`. Redis matches keys whole, never by prefix.
 *   · the numbers— we pass an override, so `RATE_LIMIT_DEFAULT_MAX` has no
 *                  effect on us and our numbers have none on the ladder.
 *   · the files  — zero lines changed under `src/infra/rate-limit/`.
 *
 * The one cosmetic cost, accepted deliberately: the bucket segment of our key
 * says `default`, which does not say "translate". `keySuffix: 'aitr'` is what
 * makes it identifiable in Redis. A misleading word in a key is a smaller price
 * than an edit to shared infrastructure.
 *
 * ## 🔴 THE GUARD THIS FILE EXISTS FOR
 *
 * `consume()` opens with
 *
 *     if (!identifier) return { limited: false, … };     // :100-102
 *
 * — an EMPTY identifier means NO LIMITING AT ALL. A naive
 * `` `${adminId}:${roomId}` `` with a missing admin id produces
 * `"undefined:abc123"`, which is **not empty**, sails straight past that guard,
 * and puts every admin whose id went missing on ONE SHARED COUNTER. That is
 * worse than no limit: admin A presses twice and admin B is refused without
 * having pressed at all. So the identifier is built by a function that returns
 * `null` unless BOTH ids are really there, and the caller refuses the request
 * on `null` rather than falling through to unlimited.
 * ต้องเช็คให้ครบทั้งสอง id ก่อนสร้างคีย์ ไม่งั้นสองแอดมินใช้ตัวนับใบเดียวกัน.
 *
 * revert: delete this file and the `consume` call in `chat-translate.service.ts`.
 */

/** The bucket we borrow. See the header: the numbers never come from it. */
export const PREVIEW_RATE_LIMIT_BUCKET = 'default' as const;

/**
 * Names OUR window inside the borrowed bucket, so the counter can never be the
 * one the webhook's per-user ladder or the global limiter is using.
 */
export const PREVIEW_RATE_LIMIT_KEY_SUFFIX = 'aitr';

/**
 * The per-admin-per-room identifier, or `null` when either half is missing.
 *
 * Counted as admin + room, chosen against the alternatives: admin alone
 * throttles someone working five rooms across unrelated conversations; room
 * alone lets two admins in one room steal each other's budget. Admin + room is
 * the real unit of work — one draft, one conversation — and it is the thing
 * actually worth stopping: hammering translate on a single draft.
 *
 * 🔴 Returning `null` is not a convenience. See the header: a half-built key is
 * a SHARED counter, and `consume()` cannot tell one from a real identifier.
 */
export function buildPreviewRateLimitIdentifier(
  adminId: string | null | undefined,
  roomId: string | null | undefined,
): string | null {
  const admin = typeof adminId === 'string' ? adminId.trim() : '';
  const room = typeof roomId === 'string' ? roomId.trim() : '';
  /* Both, or neither. `'undefined'` and `'null'` are the two spellings a
     missing id arrives as once it has been through a template literal, and
     both are non-empty strings that would pass `consume`'s own guard. */
  if (!admin || !room) return null;
  if (admin === 'undefined' || admin === 'null') return null;
  if (room === 'undefined' || room === 'null') return null;
  return `${admin}:${room}`;
}

/**
 * What the admin is told when they hit it.
 *
 * It must not name a file, a counter, an env var or a Redis key — it reaches a
 * browser. It says how long to wait, because "try again later" is the version
 * of this message that makes people press harder.
 */
export function previewRateLimitMessage(windowSeconds: number): string {
  return `Too many translations in a row. Wait about ${windowSeconds} seconds and try again.`;
}
