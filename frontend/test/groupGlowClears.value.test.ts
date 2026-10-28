/**
 * [FIX-20260824-GROUPGLOW] The group tab's orange goes out when — and only
 * when — the group truly holds no unread any more.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { groupStillHasUnread } from '../services/chat/ticketAlerts';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');
const PAGE = 'pages/chat/TicketChat.tsx';

describe('⭐ groupStillHasUnread — the pure rule', () => {
  const hooks = new Set(['h1', 'h2']);
  const rooms = new Set(['r1', 'r2']);

  it('⭐ a hook-scoped key of this group keeps it lit', () => {
    expect(groupStillHasUnread({ 'h1:Uabc': 2 }, hooks, rooms)).toBe(true);
  });
  it('⭐ a room key of this group keeps it lit', () => {
    expect(groupStillHasUnread({ r2: 1 }, hooks, rooms)).toBe(true);
  });
  it('⭐ another group\'s unread must NOT keep this one lit', () => {
    expect(groupStillHasUnread({ 'h9:Uxyz': 5, r9: 3 }, hooks, rooms)).toBe(false);
  });
  it('⭐ zero counts are read, not reasons — the owner\'s exact report', () => {
    expect(groupStillHasUnread({ 'h1:Uabc': 0, r1: 0 }, hooks, rooms)).toBe(false);
  });
  it('empty map = nothing lit', () => {
    expect(groupStillHasUnread({}, hooks, rooms)).toBe(false);
  });
  it('mixed: other-group unread + this-group zero = out', () => {
    expect(groupStillHasUnread({ 'h9:U': 4, 'h1:U': 0 }, hooks, rooms)).toBe(false);
  });
});

describe('⭐ the wiring — down direction exists, up direction untouched', () => {
  const src = read(PAGE);

  it('⭐ openTicket consults the rule and deletes the flag only when false', () => {
    const at = src.indexOf('groupStillHasUnread(next,');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at - 200, at + 400);
    expect(block).toContain('if (!groupStillHasUnread');
    expect(block).toContain('setGroupHasNew');
    expect(block).toContain('delete out[gid]');
  });

  it('⭐ the realtime LIGHTING sites are byte-untouched (ห้ามแตะ realtime)', () => {
    // message:new lighter
    expect(src).toContain(
      'setGroupHasNew(prev => (prev[msgGid] ? prev : { ...prev, [msgGid]: true }));',
    );
    // ticket:new lighter
    expect(src).toContain(
      'setGroupHasNew(prev => (prev[gid] ? prev : { ...prev, [gid]: true }));',
    );
    // selectGroup clear stays
    expect(src).toContain('// opening clears its yellow flag');
  });

  it('⭐ the unread NUMBERS pipeline is untouched — same delete loop as before', () => {
    expect(src).toContain('keys.forEach(k => delete next[k]);');
    expect(src).toContain('if (!keys.some(k => prev[k])) return prev;');
  });
});
