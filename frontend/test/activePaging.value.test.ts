/**
 * [FEAT-20260826-ACTIVEPAGING] 📖 omnidesk-api docs/bottleneck_26_aug.md (S8)
 * The F-proofs, encoded — builder units (F5/F4) + TicketChat source pins
 * (F2/F3/S8b), in the house style of botCountDeps.value.test.ts.
 * ============================================================================
 * F1 (on-screen order) needs no pin here BY CONSTRUCTION: the screen's order
 * is `visibleTicketsPinned` — a client sort over whatever rows are loaded —
 * and S8 never touches it; the SERVER sequence feeding it is pinned by the BE
 * parity instrument (P3.3, prove-active-parity.mjs). What this file pins is
 * everything that could silently diverge: the request shapes, the badge
 * source, the pinned-row pull, and the float-up rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACTIVE_PAGE_SIZE,
  activeListParams,
  activePagingEnabled,
} from '../services/chat/activeListParams';

// ── F5 · [paging phase 1.2] the switch now ships ON — off is still byte-identical ──
// FLIPPED 26/08 (owner order, todo6): was `=== 'true'` default-OFF during the
// canary window; now `!== 'false'` — everyone pages, `'false'` is the per-browser
// kill switch. History: the OFF-default pins lived here until the flip.
describe('⭐ F5→1.2: default ON, and opting out is byte-identical', () => {
  it('nothing stored → ON for everyone (flipped 26/08 — was OFF)', () => {
    expect(activePagingEnabled()).toBe(true);
  });

  it("⭐ kill switch: the literal 'false' turns THIS browser off", () => {
    localStorage.setItem('TC_ACTIVE_PAGING', 'false');
    expect(activePagingEnabled()).toBe(false);
    localStorage.removeItem('TC_ACTIVE_PAGING');
  });

  it("garbage stays ON — only 'false' opts out (mirrors TC_LIST_PAGING)", () => {
    localStorage.setItem('TC_ACTIVE_PAGING', 'whatever');
    expect(activePagingEnabled()).toBe(true);
    localStorage.removeItem('TC_ACTIVE_PAGING');
  });

  it('off → the EXACT legacy object, key for key', () => {
    expect(
      activeListParams(
        { cursor: '', withinDays: 7, search: 'som', oa: 'H1', tag: 'T', tier: 'vip' },
        false,
      ),
    ).toEqual({ job_status: '0,1', limit: 'all', within_days: 7, search: 'som' });
  });

  it('⭐ a category filter forces the legacy shape EVEN WITH the switch on', () => {
    expect(
      activeListParams(
        { cursor: '', withinDays: undefined, search: undefined, categoryLabel: 'อื่นๆ' },
        true,
      ),
    ).toEqual({
      job_status: '0,1',
      limit: 'all',
      within_days: undefined,
      search: undefined,
    });
  });
});

// ── F4 · the paged request carries the layer-3 surface and never limit=all ──
describe('⭐ F4: the paged shape', () => {
  it('on → cursor + sort=activity + counts + the S5 filters, and NO limit=all', () => {
    const p = activeListParams(
      { cursor: 'tok', withinDays: 7, search: 'som', oa: 'H1', tag: 'T', tier: 'vip' },
      true,
    );
    expect(p).toEqual({
      job_status: '0,1',
      limit: ACTIVE_PAGE_SIZE,
      cursor: 'tok',
      sort: 'activity',
      counts: '',
      within_days: 7,
      search: 'som',
      oa: 'H1',
      tag: 'T',
      tier: 'vip',
    });
    expect(JSON.stringify(p)).not.toContain('"all"');
  });

  it('unset filters stay OFF the wire — absent keys, not empty strings', () => {
    const p = activeListParams(
      { cursor: '', withinDays: undefined, search: undefined },
      true,
    );
    expect('oa' in p).toBe(false);
    expect('tag' in p).toBe(false);
    expect('tier' in p).toBe(false);
  });
});

// ── TicketChat wiring pins ──────────────────────────────────────────────────
const src = readFileSync(
  resolve(__dirname, '../pages/chat/TicketChat.tsx'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

function fetchActiveBlock(): string {
  const at = src.indexOf('const fetchActive = useCallback');
  expect(at).toBeGreaterThan(-1);
  const end = src.indexOf('const fetchCompleted', at);
  return src.slice(at, end);
}

describe('⭐ fetchActive asks through the builder, both paths', () => {
  it('the literal legacy object left the component — only the builder makes requests', () => {
    const block = fetchActiveBlock();
    expect(block).toContain('activeListParams(');
    expect(block).not.toContain("limit: 'all'");
  });

  it('⭐ F2: the paged path pulls the pinned rows it did not load', () => {
    const block = fetchActiveBlock();
    expect(block).toContain('pinnedRooms');
    expect(block).toContain("uid_");
    expect(block).toContain("id_");
  });
});

describe('⭐ F3: the badges read the server truth when paging', () => {
  function countsMemo(): { body: string; deps: string } {
    const from = src.indexOf('const counts = useMemo(');
    expect(from).toBeGreaterThan(-1);
    const depsAt = src.indexOf('  }, [', from);
    const depsEnd = src.indexOf(']);', depsAt);
    return { body: src.slice(from, depsAt), deps: src.slice(depsAt, depsEnd + 3) };
  }

  it('the memo reads serverTabCounts and declares it', () => {
    const { body, deps } = countsMemo();
    expect(body).toContain('serverTabCounts');
    expect(deps).toMatch(/\bserverTabCounts\b/);
  });

  it('the orphanRooms anchor `statusTab, botRows` survives the new dep', () => {
    /* [FIX-20260902-BOTONESOURCE] the anchor was `noCaseRooms, statusTab` while
       the badge added a server COUNT on top of the rows when the operator stood on
       another tab. One box carrying two formulas is what made the same page read
       29 and 28 seconds apart, so the count term is gone and the badge is simply
       the rows. `statusTab` stays — other tabs still read it — and `botRows` is
       what this case is really guarding: the counts memo must declare the rows it
       counts, or the badge freezes at whatever it saw first. */
    expect(countsMemo().deps).toContain('statusTab, botRows');
  });

  it('waiting/active/mine fall back to the client count when the server is silent', () => {
    const { body } = countsMemo();
    for (const key of ['mine', 'waiting', 'active']) {
      const at = body.indexOf(`${key}:`);
      expect(at).toBeGreaterThan(-1);
      const line = body.slice(at, body.indexOf('\n', at));
      expect(line).toContain('filteredActive'); // the legacy half still there
    }
  });
});

describe('⭐ S8b: a message for an unloaded customer floats the card in', () => {
  it('message:new schedules the float-up fetch behind the switch', () => {
    const at = src.indexOf("e.type === 'message:new'");
    expect(at).toBeGreaterThan(-1);
    const branch = src.slice(at, src.indexOf("e.type !== 'ticket:new'", at));
    expect(branch).toContain('scheduleFloatUp(');
    expect(branch).toContain('activePagingEnabled()');
  });

  it('the float-up fetch narrows to ONE member — never a full-list reload', () => {
    const at = src.indexOf('const scheduleFloatUp');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 2500);
    /* [FIX-20260827-TKTMEMBERPARAM] the param was renamed `line_user_id` →
       `member_id`: the value has always been the member's Mongo `_id`, and the
       old name (inherited from the ticket schema's legacy column) tricked
       callers into sending LINE ids that the BE silently dropped. The property
       THIS test protects is unchanged — the fetch narrows to one customer and
       is never a full-list reload. `ticketMemberParam.test.ts` pins the name. */
    expect(block).toContain('member_id: ');
    expect(block).toContain('mergePartialTickets(');
  });
});

describe('⭐ the open tab gets its load-more button', () => {
  it('rendered for non-ended, non-bot tabs when the server holds more', () => {
    expect(src).toContain('loadMoreActive');
    expect(src).toContain('activeHasMore');
    expect(src).toContain('โหลดเคสก่อนหน้า');
  });
});
