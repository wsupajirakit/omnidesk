/**
 * [FEAT-20260816-TAGSHOW] — the 🏷 dropdown on the ticket page lists real tags
 * again
 * ============================================================================
 * Supersedes [FIX-20260814-TAGLISTHIDE] (dropdown reduced to the clear-filter
 * option only). The list must reflect what the BE returns on every load.
 *
 * Two layers:
 *  1) a real unit test on `buildTagFilterOptions` (pure — value must be the
 *     tag id, label goes through thLabel)
 *  2) source-asserts on TicketChat.tsx that the page "really uses the helper +
 *     limit 50" — the page is ~3k lines and cannot be rendered in vitest, so
 *     this pins it at source level, same approach as
 *     webhookLogsStatusFilter.ui.test.tsx (guards against a silent re-hide
 *     with no red test).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ticketChatPageWithPieces } from './ticketChatSource';

import { buildTagFilterOptions } from '../pages/chat/ticketTagFilterOptions';

describe('[TAGSHOW] buildTagFilterOptions', () => {
  it('⭐ no tags → only the clear-filter option (never pretend there is a choice)', () => {
    expect(buildTagFilterOptions([])).toEqual([
      { value: '', label: '🏷 ป้ายทั้งหมด' },
    ]);
  });

  it('⭐ value must be the tag id, not the label (labels repeat across groups — [FEAT-20260801-TAGGROUP])', () => {
    const out = buildTagFilterOptions([
      { _id: 'id-a', label: '123123', color: null },
      { _id: 'id-b', label: 'vip', color: 'red' },
    ]);
    expect(out).toEqual([
      { value: '', label: '🏷 ป้ายทั้งหมด' },
      { value: 'id-a', label: '🏷 123123' },
      // through thLabel, same as the card chips — 'vip' renders as 'VIP'
      { value: 'id-b', label: '🏷 VIP' },
    ]);
  });
});

describe('[TAGSHOW] TicketChat really uses the helper (source-assert)', () => {
  // [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
  const src = ticketChatPageWithPieces();

  it('⭐ the 🏷 options come from buildTagFilterOptions(filterPopularTags)', () => {
    expect(src).toMatch(/buildTagFilterOptions\(filterPopularTags\)/);
  });

  it('⭐ loads with limit 50 (the BE cap) — the old 20 could drop a freshly applied tag, i.e. "added but not shown"', () => {
    expect(src).toMatch(/popularTags\(50\)/);
    expect(src).not.toMatch(/popularTags\(20\)/);
  });

  it('placeholder is back to the pre-hide original', () => {
    /* [FEAT-20261022-I18NTICKETEN] flipped 22/10: the owner asked for an English Ticket page, so the
       literal Thai now sits as the t() fallback (th.json holds the same text) */
    expect(src).toContain("placeholder={t('ticketui.filter.all_tags', '🏷 ป้ายทั้งหมด')}");
  });
});
