/**
 * [FEAT-20260820-BOTCOUNTBE] how many conversations never became a case
 * ===========================================================================
 * Owner, 2026-08-20: the บอทดูแล badge must be right from every tab, and in
 * realtime — "ข seamless ห้ามกระทบ แท็บอื่น + proof".
 *
 * WHY THE DASHBOARD CANNOT ANSWER IT ALONE. Those rows come from two places: the
 * closed cases it already holds, and the rooms that never produced a ticket. It
 * only fetches those rooms WHILE that tab is open (`TicketChat.tsx` drops them on
 * leaving, deliberately — "never a background poll"), so on any other tab the
 * badge silently lost that half and read low. Seen in production: two rows on
 * screen, the badge reading 1. หน้าเว็บโหลดห้องเฉพาะตอนเปิดแท็บ ⇒ อยู่แท็บอื่นป้ายขาดครึ่ง.
 *
 * THIS ROUTE SUPPLIES ONLY THE MISSING HALF — the number of customers with a room
 * and no ticket at all. The dashboard keeps counting the closed-case half exactly
 * as it always did, so no other tab's number is touched by this existing.
 * ให้เฉพาะครึ่งที่ขาด · ครึ่งเดิมหน้าเว็บคิดเองเหมือนเดิม ⇒ แท็บอื่นไม่ขยับ.
 *
 * It is the same shape as `getTicketedMembers` beside it: one indexed `distinct`
 * plus one `countDocuments`, no documents returned, no dates, no pagination.
 */
import { TicketsService } from '@/modules/tickets';

type Svc = {
  /* [FIX-20260829-BOTBADGEWINDOW] the optional window joined the signature — the
     alias mirrors the real method so a drift breaks compilation here first. */
  getNoCaseRoomCount: (
    hookId: string,
    withinDays?: number,
  ) => Promise<Record<string, unknown>>;
};

/** Only the two collections this method touches. */
const HOOK_ID = 'a0d000000000000000000006';

const build = (opts: {
  ticketed?: string[];
  rooms?: Array<Record<string, unknown>>;
}) => {
  const ticketed = opts.ticketed ?? [];
  const rooms = opts.rooms ?? [];
  const seen: { roomFilter?: Record<string, unknown> } = {};
  const svc = Object.create(TicketsService.prototype) as Svc & {
    ticketModel: unknown;
    chatRoomModel: unknown;
  };
  svc.ticketModel = { distinct: jest.fn().mockResolvedValue(ticketed) };
  svc.chatRoomModel = {
    countDocuments: jest
      .fn()
      .mockImplementation((f: Record<string, unknown>) => {
        seen.roomFilter = f;
        const excluded = new Set(
          (
            ((f.user_id as Record<string, unknown>)?.$nin as unknown[]) ?? []
          ).map(String),
        );
        return Promise.resolve(
          rooms.filter((r) => !excluded.has(String(r.user_id))).length,
        );
      }),
  };
  return { svc, seen };
};

describe('⭐ counting the rooms that never became a case', () => {
  it('a hook with one room and no tickets counts one', async () => {
    const { svc } = build({ rooms: [{ user_id: 'm1' }] });
    await expect(
      svc.getNoCaseRoomCount('a0d000000000000000000006'),
    ).resolves.toEqual({ success: true, data: { count: 1 } });
  });

  it('⭐ a customer who HAS a case is not counted', async () => {
    /* the moment a case exists the row stops being one of these — the same rule
       the dashboard's list uses, so the number and the list agree. */
    const { svc } = build({ ticketed: ['m1'], rooms: [{ user_id: 'm1' }] });
    await expect(
      svc.getNoCaseRoomCount('a0d000000000000000000006'),
    ).resolves.toEqual({ success: true, data: { count: 0 } });
  });

  it('counts only the ones without, when both kinds are present', async () => {
    const { svc } = build({
      ticketed: ['m1'],
      rooms: [{ user_id: 'm1' }, { user_id: 'm2' }, { user_id: 'm3' }],
    });
    await expect(
      svc.getNoCaseRoomCount('a0d000000000000000000006'),
    ).resolves.toEqual({ success: true, data: { count: 2 } });
  });

  it('it asks the database to exclude them — never filters in memory', async () => {
    /* a hook with thousands of rooms must not ship them all to the server's heap
       to be counted. ให้ฐานข้อมูลกรอง ไม่ใช่ดึงมานับเอง. */
    const { svc, seen } = build({
      ticketed: ['m1'],
      rooms: [{ user_id: 'm2' }],
    });
    await svc.getNoCaseRoomCount('a0d000000000000000000006');
    expect(seen.roomFilter?.user_id).toEqual({ $nin: expect.any(Array) });
    expect(seen.roomFilter?.hook_id).toBeDefined();
  });
});

describe('seamless — it cannot disturb anything that exists', () => {
  it('⭐ a bad hook id answers zero, never throws', async () => {
    /* a badge is decoration; it must not be able to fail a page.
       ป้ายพังไม่ได้ทำให้หน้าเว็บพัง. */
    const { svc } = build({ rooms: [{ user_id: 'm1' }] });
    for (const bad of ['', 'not-an-id', 'all']) {
      await expect(svc.getNoCaseRoomCount(bad)).resolves.toEqual({
        success: true,
        data: { count: 0 },
      });
    }
  });

  it('⭐ it READS only — no write of any kind', async () => {
    /* asserted on the models it was handed: the only methods it may call are the
       two read ones. Anything else would be a side effect on a counter route. */
    const { svc } = build({ rooms: [{ user_id: 'm1' }] });
    await svc.getNoCaseRoomCount('a0d000000000000000000006');
    for (const m of ['updateOne', 'deleteOne', 'create', 'insertMany']) {
      expect((svc.ticketModel as Record<string, unknown>)[m]).toBeUndefined();
      expect((svc.chatRoomModel as Record<string, unknown>)[m]).toBeUndefined();
    }
  });

  it('a hook with no rooms at all is zero', async () => {
    const { svc } = build({});
    await expect(
      svc.getNoCaseRoomCount('a0d000000000000000000006'),
    ).resolves.toEqual({ success: true, data: { count: 0 } });
  });
});

/**
 * [FIX-20260829-BOTBADGEWINDOW] the count must honour the SAME date window the
 * dashboard's own rows use.
 * ===========================================================================
 * Reported 29/08 with two screenshots: the บอทดูแล badge read 160 from another
 * tab and 150 once that tab was opened — ten rooms of disagreement.
 *
 * 🔴 TWO RULES, ONE BADGE. On its own tab the number is counted from the rows on
 *    screen, and those rows are filtered by the ⚙️ window
 *    (`services/chat/orphanRooms.ts`, the `withinDays` filter). From every OTHER
 *    tab the rows are not loaded at all and this route's number is used instead —
 *    and it counted every room ever, with no window. Rooms older than the window
 *    were therefore counted by the server and dropped by the client.
 *
 * ⚠️ THE PARAMETER IS OPTIONAL AND ABSENT MEANS UNBOUNDED — byte-identical to
 *    today for any caller that does not pass it. That is what keeps this from
 *    being a behaviour change for anything else that may call the route.
 * ⚠️ Filtered in the QUERY, never in memory: the route's whole reason to exist is
 *    that it must not load room documents.
 *
 * revert: drop the `withinDays` parameter here, in the controller, and the
 *         argument the dashboard passes.
 */
describe('[BOTBADGEWINDOW] the same window the rows use', () => {
  it('⭐⭐ 🔴 with a window, the query bounds the rooms by activity date', async () => {
    const { svc, seen } = build({ ticketed: [], rooms: [] });
    await svc.getNoCaseRoomCount(HOOK_ID, 7);
    const f = seen.roomFilter as Record<string, unknown>;
    expect(f).toHaveProperty('updated_at');
    const gte = (f['updated_at'] as Record<string, unknown>)['$gte'];
    expect(gte).toBeInstanceOf(Date);
    /* 7 days back, to the minute — a wrong unit (hours, seconds) lands nowhere
       near and this is what catches it. */
    const ms = Date.now() - (gte as Date).getTime();
    expect(Math.round(ms / 86_400_000)).toBe(7);
  });

  it('⭐⭐ 🔴 without a window the query is UNBOUNDED — today, unchanged', async () => {
    const { svc, seen } = build({ ticketed: [], rooms: [] });
    await svc.getNoCaseRoomCount(HOOK_ID);
    expect(seen.roomFilter).not.toHaveProperty('updated_at');
  });

  it('⭐⭐ the exclusion of ticketed customers still applies WITH a window', async () => {
    /* the window must narrow the count, never replace the rule that a customer
       with any case at all is not a bot-care row. */
    const { svc, seen } = build({ ticketed: ['u1'], rooms: [] });
    await svc.getNoCaseRoomCount(HOOK_ID, 30);
    const f = seen.roomFilter as Record<string, unknown>;
    expect(f).toHaveProperty('user_id');
    expect(f).toHaveProperty('updated_at');
  });

  it('⭐ junk windows are ignored rather than trusted', async () => {
    /* a bad value must not become `new Date(NaN)` in a query — that matches
       nothing and would silently zero the badge. */
    for (const junk of [0, -1, Number.NaN, 'abc' as unknown as number]) {
      const { svc, seen } = build({ ticketed: [], rooms: [] });
      await svc.getNoCaseRoomCount(HOOK_ID, junk);
      expect(seen.roomFilter).not.toHaveProperty('updated_at');
    }
  });
});
