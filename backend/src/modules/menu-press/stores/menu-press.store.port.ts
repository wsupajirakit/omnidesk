/**
 * ==== [FEAT-20260902-MENUPRESSONCE] the storage seam ====
 *
 * ONE METHOD. Everything the feature needs from a store is "count this press and
 * tell me which press it was", so a second backend is a file, not a refactor.
 *
 * WHY THE SEAM EXISTS AT ALL (owner 02/09 asked for a Redis mode and another
 * mode): the two candidates fail in OPPOSITE directions, and the difference
 * decides which one ships as the default.
 *
 *   Mongo — a TTL index deletes LATE (the reaper runs ~60 s and yields after
 *           50,000 docs). A claim lingering past its deadline keeps a button
 *           correctly spent. Over-retention is harmless.
 *   Redis — under `allkeys-lru` the keys evicted FIRST are the ones written and
 *           never read again, which is exactly what a claim is. Eviction hands
 *           the customer a free press, silently. Redis' own docs recommend a
 *           SEPARATE instance when persistent keys share a cache — ours is
 *           shared with the query cache, hook cache, rate limits and WS tickets.
 *
 * ⇒ Mongo is the default. A Redis implementation would drop in here unchanged,
 * and if one is ever written it must use `SET key val NX EX n` (one command, one
 * round trip, expiry set atomically) — NOT the existing `incrementWithTtl`,
 * whose INCR-then-EXPIRE shape has a leak documented by Redis itself: if the
 * EXPIRE never runs the key has no TTL at all and the button stays dead for ever.
 */
export const MENU_PRESS_STORE = Symbol('MENU_PRESS_STORE');

export interface MenuPressStore {
  /**
   * RESERVE one press and return which press it was: `1` for the first, `2` for
   * the second, and so on. The reservation counts immediately — it is settled by
   * doing nothing, or given back with `release` if the send never happened.
   *
   * 🔴 MUST BE ATOMIC. Two taps arriving together must produce two DIFFERENT
   * numbers — never two `1`s. There is no read-before-write in the contract for
   * exactly this reason.
   *
   * 🔴 RETURNS A COUNT, NOT A BOOLEAN. The policy owns the comparison, so
   * raising `max` from 1 to 3 changes a number in the policy and nothing here.
   *
   * @returns `null` when the store is UNREACHABLE. The caller then FAILS OPEN
   *   and allows the press. Losing a claim costs the customer one extra press;
   *   refusing every press because a database blinked would break the menu for
   *   everybody. ที่เก็บล่ม = ปล่อยให้กด ไม่ใช่ปิดปุ่มทั้งระบบ
   *   ⚠️ `null` means "I do not know", NOT "zero". Never treat it as a count.
   */
  reserve(id: string, ttlSeconds: number): Promise<number | null>;

  /**
   * Give a reservation back, because the thing it was paying for never happened.
   *
   * 🔴 WHY THIS EXISTS — it is the whole reason `charge` was not enough.
   * The press has to be claimed BEFORE the card is sent, or two taps arriving
   * together both pass the check and both send. But the send can fail: LINE can
   * refuse the reply token, the network can drop, and `coreSend` throws through
   * by design. Without this method the customer would have spent a press and
   * received NOTHING — the button dead until the TTL expires, for a failure that
   * was ours. จองก่อนส่ง · ส่งไม่สำเร็จต้องคืน
   *
   * Must be safe to call when the reservation does not exist (an already-expired
   * row, a store that lost it): doing nothing is the correct outcome there.
   * Never throws — a failed release costs one press, never the request.
   */
  release(id: string): Promise<void>;
}
