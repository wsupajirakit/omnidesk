/**
 * [FIX-20260829-BOTBADGEWINDOW] both halves of the บอทดูแล badge count the same rooms
 * ===========================================================================
 * Reported 29/08 with two screenshots: the badge read 160 while another tab was
 * open and 150 once บอทดูแล itself was opened.
 *
 * 🔴 TWO RULES FOR ONE NUMBER. On its own tab the badge is counted from the rows
 *    on screen, which `botTabRows` filters by the ⚙️ window. From every other tab
 *    those rows are not loaded, so the server's count is used instead — and it
 *    counted rooms of any age. The gap was exactly the rooms older than the
 *    window: counted by one half, dropped by the other.
 *
 * 🔴 THE FIX IS TO SHARE THE INPUT, not to add a second correction. The same
 *    `withinDaysParam` that filters the rows is now sent to the route, so the
 *    two halves cannot drift again by construction.
 *
 * ⚠️ REALTIME UNTOUCHED: no socket handler, no timer, no new state — the same
 *    effect, one more argument, with the window in its deps because it now
 *    decides the request.
 *
 * revert: drop the argument here and in `TicketChat.tsx`, and the parameter on
 *         the BE route.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const calls: string[] = [];

vi.mock('../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, API_BASE_URL: 'http://x' };
});

import { ticketService } from '../services/chat/ticketService';

const okCount = (n: number) => ({
  ok: true,
  json: async () => ({ success: true, data: { count: n } }),
});

beforeEach(() => {
  calls.length = 0;
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    calls.push(String(url));
    return okCount(7) as never;
  });
});
afterEach(() => vi.restoreAllMocks());

describe('[BOTBADGEWINDOW] the request carries the window', () => {
  it('⭐⭐ 🔴 a window becomes within_days on the query string', async () => {
    await ticketService.getNoCaseRoomCount('HOOK1', 7);
    expect(calls[0]).toContain('/no-case-room-count?within_days=7');
  });

  it('⭐⭐ 🔴 no window ⇒ no query string — byte-identical to the old call', async () => {
    await ticketService.getNoCaseRoomCount('HOOK1');
    expect(calls[0]).toMatch(/\/no-case-room-count$/);
  });

  it('⭐⭐ junk windows are dropped, never sent as NaN', async () => {
    /* `?within_days=NaN` would reach the server and be ignored there, but the
       request would still lie about what it asked for. */
    for (const junk of [0, -3, Number.NaN, undefined]) {
      calls.length = 0;
      await ticketService.getNoCaseRoomCount('HOOK1', junk as number);
      expect(calls[0]).toMatch(/\/no-case-room-count$/);
    }
  });

  it('⭐ a failed request still answers 0 — a badge must not break the page', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false }) as never);
    await expect(ticketService.getNoCaseRoomCount('HOOK1', 7)).resolves.toBe(0);
  });
});

describe('[BOTBADGEWINDOW] the page passes the same window its rows use', () => {
  it('⭐⭐ 🔴 TicketChat sends withinDaysParam, the very value botRows filters by', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('pages/chat/TicketChat.tsx', 'utf8');
    expect(src).toContain('getNoCaseRooms(id, withinDaysParam)');
    /* and the same name is what the rows are filtered by */
    expect(src).toContain('withinDays: withinDaysParam');
  });

  it('⭐⭐ the window is in the effect deps — a change must refetch', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('pages/chat/TicketChat.tsx', 'utf8');
    expect(src).toContain('orphanTick, noCaseRefreshKey, withinDaysParam]');
  });
});
