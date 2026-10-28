/**
 * [FIX-20260829-TABWINS] the tab must decide what the table lists.
 *
 * Reported from the real UI on 29/08: "fe มั่วมากไม่ where query ตามแท็บ".
 *
 * ⚠️ THE ASYMMETRY THAT MAKES THIS DANGEROUS: on the server `flex_type`
 * OUTRANKS `tab` — the tab clause runs only `if (!query['flex_type'])`
 * (flex-messages.service.ts). So a `flex_type` sent alongside `tab=menu`
 * silently WINS, and the table lists slip cards while the Flex Menu button
 * still looks selected. Nothing errors; the operator simply sees wrong rows.
 *
 * The tab button also clears the filter, but that is a convention a future edit
 * can forget. These cases pin the structural rule instead: on the menu tab the
 * parameter is never sent AT ALL, whatever the filter state happens to hold.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The rule as the page computes it. */
const flexTypeParam = (tab: 'normal' | 'menu', typeFilter: string) =>
  (tab === 'normal' && typeFilter) || undefined;

describe('[TABWINS] what the page sends as flex_type', () => {
  it('⭐⭐⭐ the menu tab NEVER sends flex_type, even with a stale filter', () => {
    expect(flexTypeParam('menu', 'slip')).toBeUndefined();
    expect(flexTypeParam('menu', 'custom')).toBeUndefined();
    expect(flexTypeParam('menu', '')).toBeUndefined();
  });

  it('the normal tab still sends the operator’s chosen type', () => {
    expect(flexTypeParam('normal', 'slip')).toBe('slip');
    expect(flexTypeParam('normal', 'custom')).toBe('custom');
  });

  it('an empty filter is omitted, never sent as an empty string', () => {
    // '' would be falsy on the server too, but sending it is still a lie about
    // what the operator asked for.
    expect(flexTypeParam('normal', '')).toBeUndefined();
  });
});

describe('[TABWINS] the page really implements it', () => {
  const page = () =>
    readFileSync(join(__dirname, '..', 'pages/content/FlexMessageList.tsx'), 'utf8');

  it('⭐ flex_type is gated on the tab at the call site', () => {
    expect(page()).toContain("flex_type: (tab === 'normal' && typeFilter) || undefined");
  });

  it('⭐ the bare unguarded form is gone — that is the bug itself', () => {
    expect(page()).not.toContain('flex_type: typeFilter || undefined');
  });

  it('the tab is always sent, so the server can scope every request', () => {
    /* ⚠️ An earlier version used a loose `listFlexMessages({...tab...}` regex and
       stayed GREEN when `tab` was deleted outright — the surrounding text still
       matched. Pin the property itself: without it the server cannot scope
       anything and BOTH tabs list every card.
       [FEAT-20261027-TANSTACK] FLIPPED, not deleted: the page now hands these params to
       `useFlexListPageQuery(...)`, which passes them to listFlexMessages unchanged
       (services/media/queries/useFlexQueries.ts) — so pin both halves. */
    const params = /useFlexListPageQuery\(\s*\{([\s\S]*?)\n\s*\},/.exec(page())?.[1] ?? '';
    expect(params).toMatch(/(^|[\s,])tab\s*[,}\n]/);
    const hook = readFileSync(join(__dirname, '..', 'services/media/queries/useFlexQueries.ts'), 'utf8');
    expect(hook).toContain('queryFn: () => flexMessageService.listFlexMessages(params)');
  });

  it('switching tabs still clears the filter (belt as well as braces)', () => {
    expect(page()).toContain('setTypeFilter(\'\')');
  });

  it('the type filter is hidden on the menu tab — no control that does nothing', () => {
    expect(page()).toContain("{tab === 'normal' && (");
  });
});
