/**
 * [FEAT-20261020-TICKETSTACK] Pure rules of ticket stacking — key, fold, flag.
 * The page-level behaviour (counts unchanged, toggle, flag off = old list) is in
 * test/ticketStack.dom.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  groupTicketStacks,
  resolveTicketStackFlag,
  ticketStackKey,
  useStackExpand,
} from '../pages/chat/ticket-stack';

const tk = (id: string, oa: string | null, member: string | null, created: string, extra: Record<string, unknown> = {}) => ({
  _id: id,
  line_oa_hook_id: oa,
  line_user_id: member,
  created_at: created,
  ...extra,
});

describe('ticketStackKey — same customer AND same OA, nothing else', () => {
  it('OA + member → one key', () => {
    expect(ticketStackKey(tk('a', 'oa1', 'm1', '2026-10-20T10:00:00Z'))).toBe('oa1|m1');
  });
  it('same member on another OA is a DIFFERENT key (members are global, OAs are not)', () => {
    expect(ticketStackKey(tk('a', 'oa1', 'm1', 'x'))).not.toBe(ticketStackKey(tk('b', 'oa2', 'm1', 'x')));
  });
  it('falls back to hook_id / line_user_data._id when the primary field is absent', () => {
    expect(ticketStackKey({ _id: 'a', hook_id: 'oa9', line_user_data: { _id: 'm9' } })).toBe('oa9|m9');
  });
  it.each([
    ['no OA', tk('a', null, 'm1', 'x')],
    ['no member', tk('a', 'oa1', null, 'x')],
    ['"undefined" text', tk('a', 'undefined', 'm1', 'x')],
    ['"null" text', tk('a', 'oa1', 'null', 'x')],
    ['an object, not an id', { _id: 'a', line_oa_hook_id: { x: 1 }, line_user_id: 'm1' }],
  ])('%s → null (never guess a group)', (_label, row) => {
    expect(ticketStackKey(row as never)).toBeNull();
  });
  it('phone and name are NOT identity — two strangers with one phone stay apart', () => {
    const a = tk('a', 'oa1', 'm1', 'x', { line_user_data: { phone_number: '0812345678' } });
    const b = tk('b', 'oa1', 'm2', 'x', { line_user_data: { phone_number: '0812345678' } });
    expect(ticketStackKey(a)).not.toBe(ticketStackKey(b));
  });
});

describe('groupTicketStacks — fold the sorted list', () => {
  // input order = the page's sorted order (pinned first, newest activity first)
  const sorted = [
    tk('w3', 'oa1', 'mA', '2026-10-19T07:39:00Z'), // most active, but NOT the newest opened
    tk('x1', 'oa1', 'mB', '2026-10-20T09:00:00Z'),
    tk('w1', 'oa1', 'mA', '2026-10-20T11:16:00Z'), // newest opened of mA
    tk('y1', 'oa2', 'mA', '2026-10-20T12:00:00Z'), // same person, other OA
    tk('w2', 'oa1', 'mA', '2026-10-20T10:57:00Z'),
    tk('z1', null, 'mC', '2026-10-20T08:00:00Z'), // no key
  ];
  const { fronts, byFront } = groupTicketStacks(sorted);

  it('a stack sits where its first ticket sat — list order and pinning survive', () => {
    expect(fronts.map((t) => t._id)).toEqual(['w1', 'x1', 'y1', 'z1']);
  });
  it('front card = newest OPENED; the rest newest → oldest', () => {
    const g = byFront.get('w1')!;
    expect(g.front._id).toBe('w1');
    expect(g.rest.map((t) => t._id)).toEqual(['w2', 'w3']);
    expect(g.size).toBe(3);
  });
  it('the same customer on another OA is its own stack', () => {
    expect(byFront.get('y1')!.size).toBe(1);
  });
  it('a ticket without a key is a stack of one', () => {
    expect(byFront.get('z1')).toMatchObject({ key: 'id|z1', size: 1, rest: [] });
  });
  it('nothing dropped, nothing duplicated', () => {
    const all = [...byFront.values()].flatMap((g) => [g.front, ...g.rest].map((t) => t._id));
    expect(all.sort()).toEqual(sorted.map((t) => t._id).sort());
  });
  it('equal open times keep the incoming order (stable)', () => {
    const same = '2026-10-20T10:00:00Z';
    const r = groupTicketStacks([tk('p', 'oa1', 'm1', same), tk('q', 'oa1', 'm1', same)]);
    expect([r.fronts[0]._id, ...r.byFront.get('p')!.rest.map((t) => t._id)]).toEqual(['p', 'q']);
  });
  it('an unreadable created_at sorts as oldest instead of throwing', () => {
    const r = groupTicketStacks([tk('bad', 'oa1', 'm1', 'not-a-date'), tk('ok', 'oa1', 'm1', '2026-10-20T10:00:00Z')]);
    expect(r.fronts[0]._id).toBe('ok');
  });
  it('empty in, empty out', () => {
    expect(groupTicketStacks([])).toEqual({ fronts: [], byFront: new Map() });
  });
});

describe('resolveTicketStackFlag — default OFF, two levers', () => {
  it.each([
    [undefined, null, false],
    ['', null, false],
    ['false', null, false],
    ['yes', null, false],
    ['true', null, true],
    [' TRUE ', null, true],
    [undefined, 'true', true],
    ['true', 'false', false],
    [undefined, 'garbage', false],
    ['true', 'garbage', true],
  ])('build=%j storage=%j → %s', (build, stored, want) => {
    expect(resolveTicketStackFlag(build, stored as string | null)).toBe(want);
  });
});

describe('useStackExpand — starts folded, folds again when the list changes', () => {
  it('toggle opens and closes one stack without touching another', () => {
    const { result } = renderHook(({ k }) => useStackExpand(k), { initialProps: { k: 'waiting|g1' } });
    expect(result.current.isOpen('a')).toBe(false);
    act(() => result.current.toggle('a'));
    expect(result.current.isOpen('a')).toBe(true);
    expect(result.current.isOpen('b')).toBe(false);
    act(() => result.current.toggle('a'));
    expect(result.current.isOpen('a')).toBe(false);
  });
  it('a realtime rebuild of the SAME list keeps what is open; another list folds everything', () => {
    const { result, rerender } = renderHook(({ k }) => useStackExpand(k), { initialProps: { k: 'waiting|g1' } });
    act(() => result.current.toggle('a'));
    rerender({ k: 'waiting|g1' });
    expect(result.current.isOpen('a')).toBe(true);
    rerender({ k: 'active|g1' });
    expect(result.current.isOpen('a')).toBe(false);
  });
});
