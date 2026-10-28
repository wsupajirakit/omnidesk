/**
 * [FEAT-20260826-PAGINGCOUNTS] 📖 omnidesk-api todo/task/26082026/todo6_26082026_paging-default-on.md (paging phase 1.1)
 * The badge must follow the cards even when realtime PATCHES instead of fetching.
 * ============================================================================
 * THE HOLE (proven red-first on the pre-fix code): `setServerTabCounts` had ONE
 * set-site — inside fetchActive — while ws-patch mode deliberately avoids
 * fetchActive. Cards moved live, badges froze at the last fetch snapshot.
 * THE FIX: `scheduleCountsRefresh` — one debounced, counts-only request
 * (`limit: 1` + `counts: ''`, current filter set), called from the two wiring
 * points every list-mutating path funnels through:
 *   W1  the injected setActiveTickets of usePartialTicketFetch (ticket:new,
 *       updates for unloaded rows, selected-ticket refresh) + the float-up merge
 *   W2  the ticket:updated in-place patch branch (covers cross-browser AND the
 *       ws echo of the operator's own accept/close/reopen)
 * Every call is `if (activePagingEnabled()) scheduleCountsRefresh();` — switch
 * off ⇒ zero extra requests, byte-identical behaviour (pinned below).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../pages/chat/TicketChat.tsx'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('⭐ 1.1-P1 the counts-only refresher exists and is light', () => {
  function defBlock(): string {
    const at = src.indexOf('const scheduleCountsRefresh');
    expect(at).toBeGreaterThan(-1);
    return src.slice(at, at + 1600);
  }

  it('debounced (setTimeout) and writes serverTabCounts from tab_counts', () => {
    const b = defBlock();
    expect(b).toContain('setTimeout');
    expect(b).toContain('setServerTabCounts');
    expect(b).toContain('tab_counts');
  });

  it('⭐ reads its scope AT FIRE TIME through a ref — a scope switch inside the debounce window must not paint the old scope\'s numbers', () => {
    // no-bias round 26/08: the first cut captured activeGroupId/scopeForQuery in
    // the setTimeout closure — switch OA within 1.5s and stale numbers land.
    // Same cure as usePartialTicketFetch's scopeRef (house precedent).
    const b = defBlock();
    expect(b).toContain('countsScopeRef.current');
    expect(b).toContain('}, []);'); // stable callback — nothing captured by closure
  });

  it('⭐ asks for NUMBERS not rows: limit 1 + counts flag + the current filter set', () => {
    const b = defBlock();
    expect(b).toContain('limit: 1');
    expect(b).toContain("counts: ''");
    expect(b).toContain('within_days');
    expect(b).toContain('search');
    expect(b).toContain('f.oa');
    expect(b).toContain('f.tag');
    expect(b).toContain('f.tier');
  });
});

describe('⭐ 1.1-P1 the two wiring points (W1 + W2)', () => {
  it('W1a: the setActiveTickets injected into usePartialTicketFetch also schedules counts', () => {
    const at = src.indexOf('usePartialTicketFetch<TicketEntry>(');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf('pagedHelpersRef', at));
    expect(block).toContain('scheduleCountsRefresh()');
  });

  it('W1b: the float-up merge schedules counts too', () => {
    const at = src.indexOf('const scheduleFloatUp');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 2600);
    expect(block).toContain('mergePartialTickets(');
    expect(block).toContain('scheduleCountsRefresh()');
  });

  it('W2: the ticket:updated in-place patch branch schedules counts before its early return', () => {
    const at = src.indexOf("e.type === 'ticket:updated' && id && typeof status === 'number'");
    expect(at).toBeGreaterThan(-1);
    const end = src.indexOf('if (found) return;', at);
    expect(end).toBeGreaterThan(at);
    const block = src.slice(at, end);
    expect(block).toContain('scheduleCountsRefresh()');
  });
});

describe('⭐ 1.1-P2 switch off = inert — every call site sits behind activePagingEnabled()', () => {
  it('call-site count equals guarded-idiom count (no unguarded caller can exist)', () => {
    const calls = (src.match(/scheduleCountsRefresh\(\)/g) || []).length;
    const guarded = (src.match(
      /if \((?:found && )?activePagingEnabled\(\)\) scheduleCountsRefresh\(\);/g,
    ) || []).length;
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(guarded).toBe(calls);
  });
});
