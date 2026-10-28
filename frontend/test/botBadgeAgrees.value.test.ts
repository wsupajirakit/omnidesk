/**
 * [FIX-20260902-BOTROOMCAP] the บอทดูแล badge reads the SAME number from both
 * halves — which is the defect, stated as a test.
 * ===========================================================================
 * WHAT THE OWNER SAW (02/09, staging, OA `awgallwingame`): the same page, the
 * same second, two numbers.
 *
 *     tab in focus = ปิดเคส      →  บอทดูแล  129
 *     tab in focus = บอทดูแล     →  บอทดูแล  115
 *
 * WHY. `TicketChat.tsx` computes the badge two ways on purpose:
 *
 *     bot: Math.max(k, k + (statusTab === 'bot' ? 0 : noCaseRooms))
 *
 * Off the tab the rooms are deliberately not fetched, so `k` holds the closed
 * bot-mode cases and the SERVER's uncapped `countDocuments` supplies the rooms.
 * On the tab the rooms are loaded and are already inside `k`, so the server term
 * is dropped to avoid double counting. The design is sound and the two agree —
 * as long as the client actually receives every room.
 *
 * It did not. `listRooms` sends no page/limit, and the back end answers that with
 * a silent ceiling of 200 rooms (ROOM_HARD_CAP), dropping the least recently
 * active. Past 200 rooms the client's half is short by however many fell off, and
 * the rows past the cap are missing from the LIST as well — on the tab whose only
 * job is showing customers nobody has picked up yet.
 *
 * 🔴 THE FIRST CASE BELOW FAILS ON THE OLD CODE AND PASSES ON THE NEW ONE. It is
 * the reason this file exists; the rest guard the ways a fix could be wrong in
 * the other direction (double counting, or "fixing" it by hiding rows).
 *
 * revert: delete this file; nothing then notices the two halves drifting again.
 */
import { describe, it, expect } from 'vitest';

import { botTabRows } from '../services/chat/orphanRooms';

type Tk = { id: string; uid: string; bot: boolean };

const keyOf = (r: Tk) => r.uid;
const isBotMode = (r: Tk) => r.bot;
const roomToRow = (room: { _id?: string; user_id?: unknown }) =>
  ({
    id: `orphan:${String(room._id)}`,
    uid: `uid_${String(room.user_id)}`,
    bot: true,
  }) as Tk;

/** The page's badge formula, isolated. `k` = rows this render can see. */
const badge = (k: number, onBotTab: boolean, serverRooms: number): number =>
  Math.max(k, k + (onBotTab ? 0 : serverRooms));

/**
 * One OA: `ticketed` customers who have had a case, `noCase` who never have.
 * `delivered` is how many rooms the client actually received — the cap.
 */
const world = (ticketed: number, noCase: number, delivered: number) => {
  const completed: Tk[] = Array.from({ length: ticketed }, (_, i) => ({
    id: `t${i}`,
    uid: `uid_m${i}`,
    bot: true,
  }));
  /* Rooms come back newest-first and the cap drops the OLDEST, so the no-case
     rooms — the quiet ones — are exactly what falls off the end. That ordering is
     why the bug is invisible until someone counts. */
  const allRooms = [
    ...completed.map((t, i) => ({ _id: `room-t${i}`, user_id: `m${i}` })),
    ...Array.from({ length: noCase }, (_, i) => ({
      _id: `room-n${i}`,
      user_id: `n${i}`,
    })),
  ];
  return { completed, rooms: allRooms.slice(0, delivered) };
};

const rowsFor = (w: ReturnType<typeof world>, onBotTab: boolean) =>
  botTabRows<Tk>({
    activeTickets: [],
    completedTickets: w.completed,
    // off the tab the effect clears the array — the page never holds rooms there
    rooms: onBotTab ? (w.rooms as never) : [],
    everTicketed: [],
    keyOf,
    isBotMode,
    roomToRow: roomToRow as never,
  });

describe('[FIX-20260902-BOTROOMCAP] both halves of the badge agree', () => {
  const TICKETED = 236;
  const NO_CASE = 14;
  const TOTAL = TICKETED + NO_CASE; // 250 rooms — past the 200 ceiling

  it('🔴 with EVERY room delivered, on-tab and off-tab read the same number', () => {
    const w = world(TICKETED, NO_CASE, TOTAL);
    const onTab = badge(rowsFor(w, true).length, true, NO_CASE);
    const offTab = badge(rowsFor(w, false).length, false, NO_CASE);
    expect(onTab).toBe(offTab);
    expect(onTab).toBe(TICKETED + NO_CASE);
  });

  it('🔴 with the 200-room cap, they DISAGREE — the bug, reproduced', () => {
    /* This is what shipped: the client is handed 200 of 250 rooms, so 50 no-case
       rooms never arrive. Kept as a test so the failure is a measurement rather
       than a memory, and so nobody "simplifies" the paging away. */
    const capped = world(TICKETED, NO_CASE, 200);
    const onTab = badge(rowsFor(capped, true).length, true, NO_CASE);
    const offTab = badge(rowsFor(capped, false).length, false, NO_CASE);
    expect(onTab).not.toBe(offTab);
    expect(offTab).toBeGreaterThan(onTab); // the badge reads high off its own tab
  });

  it('⭐⭐ the fix must not double count', () => {
    /* The other direction: adding the server term ON the bot tab would count the
       rooms twice, since they are already inside the rows. */
    const w = world(TICKETED, NO_CASE, TOTAL);
    const k = rowsFor(w, true).length;
    expect(badge(k, true, NO_CASE)).toBe(k);
    expect(badge(k, true, NO_CASE)).not.toBe(k + NO_CASE);
  });

  it('⭐⭐ and it must not be "fixed" by dropping rows to match a small number', () => {
    /* Making the numbers agree by showing fewer people would satisfy a naive
       equality check and defeat the entire point of the tab. */
    const w = world(TICKETED, NO_CASE, TOTAL);
    expect(rowsFor(w, true).length).toBe(TICKETED + NO_CASE);
  });

  it('⭐ an OA under the ceiling was never affected, and still is not', () => {
    const small = world(10, 4, 14);
    const onTab = badge(rowsFor(small, true).length, true, 4);
    const offTab = badge(rowsFor(small, false).length, false, 4);
    expect(onTab).toBe(offTab);
  });
});
