/**
 * [FIX-20260820-BOTCOUNT] the บอทดูแล tab counted one thing and listed another
 * ===========================================================================
 * Owner, 2026-08-20, with a screenshot: a customer wrote in, their card appeared
 * in the bot-care tab, and the tab's number stayed 0.
 *
 * THE CAUSE — two rules for one question. The LIST built its rows from the
 * completed tickets PLUS the rooms that never became a case; the COUNT was
 * computed separately from the tickets alone and never learned about the rooms.
 * A customer with a room and no ticket therefore showed as a row nobody counted.
 * รายการบวกห้องที่ไม่เคยมีเคส · ตัวนับไม่ได้บวก ⇒ การ์ดขึ้นแต่เลขเป็น 0.
 *
 * `orphanRooms.ts` warned about exactly this when it was written — "writing a
 * second 'which customer is this' rule here is how the two drift apart" — and
 * the drift happened in the counter instead.
 *
 * THE FIX these cases pin: ONE function builds the rows, and both the list and
 * the count read what it returns. They cannot disagree because there is nothing
 * left to disagree about. หนึ่งกฎ สองคนอ่าน · ไม่มีอะไรให้ drift.
 */
import { describe, expect, it } from 'vitest';

import { botTabRows } from '../services/chat/orphanRooms';

type Tk = { id: string; key: string; bot: boolean; updated_at?: string };

const keyOf = (t: Tk) => t.key;
const isBotMode = (t: Tk) => t.bot;
const room = (id: string, key: string, at?: string) =>
  ({ _id: id, line_user_id: key, user_data: { _id: key }, last_message: { timestamp: at } }) as never;

const build = (over: Record<string, unknown> = {}) =>
  botTabRows<Tk>({
    activeTickets: [],
    completedTickets: [],
    rooms: [],
    everTicketed: [],
    keyOf,
    isBotMode,
    roomToRow: (r) => ({
      id: `orphan:${(r as { _id: string })._id}`,
      key: (r as { line_user_id: string }).line_user_id,
      bot: true,
      updated_at: (r as { last_message?: { timestamp?: string } }).last_message?.timestamp,
    }),
    ...over,
  } as never);

describe('⭐ a room with no ticket is a row — and therefore countable', () => {
  it('the customer from the screenshot appears exactly once', () => {
    /* they had a room and no case at all. Before the fix the list showed them
       and the count did not. ต้องนับได้ ไม่ใช่โชว์เฉย ๆ. */
    const rows = build({ rooms: [room('r1', 'Ucbf2e07a')] });
    expect(rows).toHaveLength(1);
    expect(keyOf(rows[0]!)).toBe('Ucbf2e07a');
  });

  it('a customer who HAS a case is not doubled', () => {
    /* the same person must not be both a closed-case row and an orphan row. */
    const rows = build({
      completedTickets: [{ id: 't1', key: 'U1', bot: true }],
      rooms: [room('r1', 'U1')],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('t1');
  });

  it('a customer with an ACTIVE case is in neither part of this tab', () => {
    /* they belong to กำลังคุย, not บอทดูแล. */
    const rows = build({
      activeTickets: [{ id: 'a1', key: 'U1', bot: true }],
      completedTickets: [{ id: 't1', key: 'U1', bot: true }],
      rooms: [room('r1', 'U1')],
    });
    expect(rows).toHaveLength(0);
  });

  it('everTicketed removes a room even when its ticket is off-window', () => {
    /* "has this customer EVER had a case" is a different question from "is their
       card on screen now", and the list already honoured that.
       ⚠️ `everTicketed` holds MEMBER ids, and the page's key for a member is
       `uid_<memberId>` — the function adds that prefix itself. Passing a raw key
       here would silently match nothing, which is how this case first passed for
       the wrong reason. everTicketed เก็บ member id · คีย์จริงมี uid_ นำหน้า. */
    const rows = build({
      rooms: [room('r1', 'uid_M9')],
      everTicketed: ['M9'],
    });
    expect(rows).toHaveLength(0);
  });

  it('a closed case whose room is NOT bot-controlled stays out', () => {
    const rows = build({ completedTickets: [{ id: 't1', key: 'U1', bot: false }] });
    expect(rows).toHaveLength(0);
  });
});

describe('the date window applies to rooms, exactly as it does to rows', () => {
  const now = Date.parse('2026-08-20T10:00:00Z');
  const dayAgo = new Date(now - 86400000).toISOString();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();

  it('ทั้งหมด (no window) keeps every room', () => {
    const rows = build({ rooms: [room('r1', 'U1', weekAgo)], now });
    expect(rows).toHaveLength(1);
  });

  it('a 2-day window drops a week-old room and keeps a day-old one', () => {
    expect(
      build({ rooms: [room('r1', 'U1', weekAgo)], withinDays: 2, now }),
    ).toHaveLength(0);
    expect(
      build({ rooms: [room('r2', 'U2', dayAgo)], withinDays: 2, now }),
    ).toHaveLength(1);
  });

  it('a room with no activity date is outside any window', () => {
    expect(build({ rooms: [room('r1', 'U1')], withinDays: 2, now })).toHaveLength(0);
    // …but present when there is no window at all
    expect(build({ rooms: [room('r1', 'U1')], now })).toHaveLength(1);
  });
});

describe('⭐ the count and the list can no longer disagree', () => {
  it('⭐ the number counts CUSTOMERS, measured over the very rows shown', () => {
    /* The tab's badge has always been distinct customers, not rows: one person
       with two closed cases is two cards but one number. That is unchanged — the
       fix is only that ROOMS now reach the counter at all, because both sides
       read this one array. หนึ่งคนสองเคส = สองการ์ด แต่นับหนึ่ง. */
    const rows = build({
      completedTickets: [
        { id: 't1', key: 'U1', bot: true },
        { id: 't2', key: 'U1', bot: true },
        { id: 't3', key: 'U2', bot: true },
      ],
      rooms: [room('r1', 'U3'), room('r2', 'U4')],
    });
    expect(rows).toHaveLength(5); // 3 cases + 2 orphan rooms
    expect(new Set(rows.map(keyOf)).size).toBe(4); // U1 U2 U3 U4
  });

  it('⭐ a room-only customer is INSIDE that number — the reported bug', () => {
    /* before the fix this returned 0 while a card was on screen. */
    const rows = build({ rooms: [room('r1', 'Ucbf2e07a')] });
    expect(new Set(rows.map(keyOf)).size).toBe(1);
  });
});
