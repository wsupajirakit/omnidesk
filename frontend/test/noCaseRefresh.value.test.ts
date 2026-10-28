/**
 * [PERF-20260826-NOCASEDEPS] 📖 omnidesk-api docs/bottleneck_26_aug.md (S4)
 * The no-case effect refires on MEMBERSHIP, and the search-limited flag is read.
 * ============================================================================
 * Two halves:
 *  1. `ticketIdsKey` policy — pure, tested directly (same pattern as
 *     `partialTicketMerge`): identical content in a NEW array must not change
 *     the key; membership changes must.
 *  2. TicketChat wiring — the page is ~5k lines and cannot be rendered here,
 *     so this reads the source with comments stripped, exactly like
 *     `botCountDeps.value.test.ts`. It pins (a) the effect keyed on
 *     `noCaseRefreshKey`, never on raw array identity, and (b)
 *     [FEAT-20260826-SEARCHLIMITNOTE] `search_truncated` being READ from both
 *     list fetches and rendered — the field existed on the BE and nothing in
 *     the FE ever looked at it (grep was empty on 26/08).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ticketChatPageWithPieces } from './ticketChatSource';

import { ticketIdsKey } from '../services/chat/noCaseRefresh';

describe('⭐ ticketIdsKey — membership in, identity out', () => {
  const rows = [{ _id: 'a' }, { _id: 'b' }];

  it('a NEW array with the same rows keeps the same key', () => {
    expect(ticketIdsKey([...rows])).toBe(ticketIdsKey(rows));
    expect(ticketIdsKey(rows.map((r) => ({ ...r })))).toBe(ticketIdsKey(rows));
  });

  it('adding, removing, or swapping a member changes the key', () => {
    const base = ticketIdsKey(rows);
    expect(ticketIdsKey([...rows, { _id: 'c' }])).not.toBe(base);
    expect(ticketIdsKey([rows[0]!])).not.toBe(base);
    expect(ticketIdsKey([{ _id: 'a' }, { _id: 'x' }])).not.toBe(base);
  });

  it('rows without an _id do not throw and stay stable', () => {
    expect(ticketIdsKey([{}, null, { _id: 'a' }])).toBe(
      ticketIdsKey([{}, undefined, { _id: 'a' }]),
    );
  });
});

// [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
const src = ticketChatPageWithPieces()
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** the effect that fetches the no-case ROWS, anchored by its own call.
 *  [FIX-20260902-BOTONESOURCE] anchored on `getNoCaseRooms`, not the old
 *  `getNoCaseRoomCount`. The tab no longer fetches a number and the rooms
 *  separately — one route answers WHICH rooms and the count is `rows.length`,
 *  because a badge computed from what a browser managed to load can never be the
 *  same number twice. What this file pins is UNCHANGED: the effect is keyed on
 *  ticket MEMBERSHIP, so identity churn cannot re-ask per OA per event. */
function noCaseEffect(): { body: string; deps: string } {
  const call = src.indexOf('getNoCaseRooms');
  expect(call).toBeGreaterThan(-1);
  const from = src.lastIndexOf('useEffect(', call);
  expect(from).toBeGreaterThan(-1);
  const depsAt = src.indexOf('}, [', from);
  const depsEnd = src.indexOf(']);', depsAt);
  return {
    body: src.slice(from, depsAt),
    deps: src.slice(depsAt, depsEnd + 3),
  };
}

describe('⭐ TicketChat: the no-case effect is keyed on membership', () => {
  it('deps carry noCaseRefreshKey', () => {
    expect(noCaseEffect().deps).toMatch(/\bnoCaseRefreshKey\b/);
  });

  it('⭐ and NOT the raw arrays — identity churn must not refire N requests per OA', () => {
    const { deps } = noCaseEffect();
    expect(deps).not.toMatch(/\bactiveTickets\b/);
    expect(deps).not.toMatch(/\bcompletedTickets\b/);
  });

  it('the key is built from BOTH lists through ticketIdsKey', () => {
    const at = src.indexOf('const noCaseRefreshKey');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf(']);', at) + 3);
    expect(block).toContain('ticketIdsKey(activeTickets)');
    expect(block).toContain('ticketIdsKey(completedTickets)');
  });
});

describe('⭐ TicketChat reads search_truncated instead of shelving it', () => {
  it('both list fetches read the flag off the response', () => {
    const reads = src.match(/search_truncated/g) ?? [];
    // fetchActive + fetchCompleted at minimum (render may add more)
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  it('the flag reaches the screen', () => {
    expect(src).toContain('activeSearchLimited || completedSearchLimited');
    expect(src).toContain('ผลค้นหาแสดงบางส่วน');
  });
});
