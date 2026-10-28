/**
 * Ticket alert rules — sound / toast / unread badge.
 * ===========================================================================
 * Pure value tests. The rules live in `services/chat/ticketAlerts.ts` on
 * purpose: `pages/chat/TicketSupport.tsx` is 4,000+ lines and on the max-lines
 * waiver, so nothing new is added to it that can be tested on its own.
 *
 * revert: delete this file together with `services/chat/ticketAlerts.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  ALERT_SOUND_WINDOW_MS,
  shouldAlert,
  inboundMessageKey,
  bumpUnread,
  clearUnread,
  markMessageAt,
  activityAt,
} from '../services/chat/ticketAlerts';

const msg = (over: Record<string, unknown> = {}) => ({
  type: 'message:new',
  data: { sender_type: 'customer', line_user_id: 'U1', hook_id: 'h1', ...over },
});

describe('which events alert', () => {
  it('a new case alerts', () => {
    expect(shouldAlert({ type: 'ticket:new', data: { hook_id: 'h1' } })).toBe(true);
  });

  it('an inbound customer message alerts', () => {
    expect(shouldAlert(msg())).toBe(true);
  });

  it('a WAITING case still alerts — assist_status must not be used to mute', () => {
    /* A case nobody has claimed has assist_status false. An earlier attempt to
       silence ticket-less rooms with that flag muted exactly the customers who
       are waiting for a human, on every tab. Pinned so it cannot come back. */
    expect(shouldAlert(msg({ assist_status: false }))).toBe(true);
  });

  it('our own outbound messages do not alert', () => {
    expect(shouldAlert(msg({ sender_type: 'admin' }))).toBe(false);
    expect(shouldAlert(msg({ sender_type: 'bot' }))).toBe(false);
    expect(shouldAlert(msg({ sender_type: 'system' }))).toBe(false);
  });

  it('a ticket that merely changed does not alert', () => {
    expect(shouldAlert({ type: 'ticket:updated', data: { hook_id: 'h1' } })).toBe(false);
  });

  it('survives a malformed event instead of throwing', () => {
    expect(shouldAlert({ type: 'message:new' })).toBe(false);
    expect(shouldAlert({ type: '' })).toBe(false);
  });
});

describe('the burst window', () => {
  it('is 4 seconds — one chime per burst, owner-set', () => {
    expect(ALERT_SOUND_WINDOW_MS).toBe(4000);
  });
});

describe('which card an inbound message belongs to', () => {
  it('is the LINE user id the event carries', () => {
    expect(inboundMessageKey(msg())).toBe('U1');
  });

  it('is null when the message is not inbound', () => {
    expect(inboundMessageKey(msg({ sender_type: 'admin' }))).toBeNull();
  });

  it('is null when the BE sent no line_user_id — no badge rather than a wrong one', () => {
    expect(inboundMessageKey(msg({ line_user_id: null }))).toBeNull();
    expect(inboundMessageKey({ type: 'ticket:new', data: { line_user_id: 'U1' } })).toBeNull();
  });
});

describe('the per-card counter', () => {
  it('counts up per card and keeps the cards apart', () => {
    let counts = bumpUnread({}, 'U1');
    counts = bumpUnread(counts, 'U1');
    counts = bumpUnread(counts, 'U2');
    expect(counts).toEqual({ U1: 2, U2: 1 });
  });

  it('never mutates the map it was given (React state must stay immutable)', () => {
    const before = { U1: 1 };
    const after = bumpUnread(before, 'U1');
    expect(before).toEqual({ U1: 1 });
    expect(after).not.toBe(before);
  });

  it('clears one card when its chat is opened, leaving the others alone', () => {
    const counts = clearUnread({ U1: 3, U2: 1 }, 'U1');
    expect(counts).toEqual({ U2: 1 });
  });

  it('clearing a card that has no count changes nothing and keeps the same object', () => {
    const before = { U2: 1 };
    expect(clearUnread(before, 'U1')).toBe(before);
  });
});

describe('the last-message clock that drives the live re-sort', () => {
  it('remembers when a card last heard from its customer', () => {
    expect(markMessageAt({}, 'U1', 1000)).toEqual({ U1: 1000 });
  });

  it('keeps the LATER time — an out-of-order event must not drag a card down', () => {
    expect(markMessageAt({ U1: 2000 }, 'U1', 1000)).toEqual({ U1: 2000 });
    expect(markMessageAt({ U1: 2000 }, 'U1', 3000)).toEqual({ U1: 3000 });
  });

  it('never mutates the map it was given', () => {
    const before = { U1: 1000 };
    expect(markMessageAt(before, 'U1', 3000)).not.toBe(before);
    expect(before).toEqual({ U1: 1000 });
  });

  it('ignores a missing or unusable timestamp instead of writing NaN', () => {
    expect(markMessageAt({ U1: 2000 }, 'U1', undefined as any)).toEqual({ U1: 2000 });
    expect(markMessageAt({}, 'U1', Number.NaN)).toEqual({});
  });

  it('raises a row to its newest message, and leaves an untouched row exactly as it was', () => {
    expect(activityAt(1000, 5000)).toBe(5000);
    expect(activityAt(1000, undefined)).toBe(1000);
    // An older message never lowers a row that the BE updated more recently.
    expect(activityAt(9000, 5000)).toBe(9000);
  });
});

/**
 * Wiring — the rules above are worthless if nobody calls them, and that failure
 * is invisible to a value test: every function stays green while the badge
 * never appears. These read the real sources, the same way the BE specs pin
 * their call sites. เทสว่าโดนเรียกจริง ไม่ใช่แค่ฟังก์ชันถูก.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the rules are actually wired in', () => {
  it('App.tsx decides with shouldAlert and shares ONE cooldown clock', () => {
    const app = src('App.tsx');
    expect(app).toContain('if (!shouldAlert(event as any)) return;');
    expect(app).toContain('const SOUND_COOLDOWN_MS = ALERT_SOUND_WINDOW_MS;');
    /* The SOUND must not be behind a ticket:new check, or customer messages stay
       silent — that was the original bug. The CORNER TOAST is behind one on
       purpose (owner, 2026-08-19: a toast per chat message was too noisy), so the
       assertion is on the ORDER: the gate for the toast sits before the sound,
       and the sound is reached whatever the event type.
       เสียงต้องไม่ติดเงื่อนไข ticket:new · toast ติดได้ ตามที่เจ้าของสั่ง. */
    const gate = app.indexOf('if (!shouldAlert(event as any)) return;');
    const toastGate = app.indexOf("if (event.type === 'ticket:new') {", gate);
    const sound = app.indexOf('playNotiSound();', gate);
    expect(toastGate).toBeGreaterThan(gate);
    expect(sound).toBeGreaterThan(toastGate);
  });

  it('the ticket page counts message:new, scoped to the active group', () => {
    const page = src('pages/chat/TicketSupport.tsx');
    expect(page).toContain("if (event.type === 'message:new') {");
    expect(page).toContain('activeGroupHookIds.includes(msgHookId)');
    expect(page).toContain('setUnreadByUser((prev) => bumpUnread(prev, key));');
  });

  it('the ticket page clears a card when its chat opens, and renders the number', () => {
    const page = src('pages/chat/TicketSupport.tsx');
    expect(page).toContain('setUnreadByUser((prev) => clearUnread(prev, String(key)));');
    expect(page).toContain('const unreadCount = unreadByUser[');
    expect(page).toContain('{unreadCount > 99 ? \'99+\' : unreadCount}');
  });

  it('the live re-sort is fed by the clock and recomputes when a message lands', () => {
    const page = src('pages/chat/TicketSupport.tsx');
    expect(page).toContain('setLastMsgAtByUser((prev) => markMessageAt(prev, key,');
    // the helper both comparators go through
    expect(page).toContain("activityAt(rowTime, lastMsgAtByUser[t.line_user_data?.line_user_id || ''])");
    // without the dep the memo would keep the old order until something else changed
    expect(page).toContain('sortKey, sortAsc, lastMsgAtByUser]);');
  });

  it('the waiting queue is NOT reordered by a live message — FIFO stays FIFO', () => {
    const page = src('pages/chat/TicketSupport.tsx');
    // the job_status === 0 leg must still read created_at raw, unwrapped
    expect(page).toContain('const timeA = a.job_status === 0 \n            ? (a.created_at ? new Date(a.created_at).getTime() : 0)');
  });

  it('the page does NOT beep on its own — the sound is app-wide only', () => {
    const page = src('pages/chat/TicketSupport.tsx');
    expect(page).not.toContain('playNotiSound');
  });
});
