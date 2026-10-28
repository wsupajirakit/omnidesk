/**
 * [FIX-20260829-ORANGENEEDSCOUNT] a zero never wears the orange
 * ===========================================================================
 * Owner 29/08: when the number reads 0 the orange must stop by itself — on the
 * tab, on the "อื่นๆ" trigger, and on the rows inside its dropdown.
 *
 * 🔴 THE CAUSE: all three paint from the FLAG `groupHasNew[gid]` and never look
 *    at the number sitting on the very next line. The flag is cleared when the
 *    admin opens that group, or when no unread remains — but nothing clears it
 *    when the count itself falls to 0 (the case closed, or moved elsewhere). So
 *    the badge reads 0 while the ring keeps pulsing, which is what was reported.
 *
 * 🔴 GATED AT THE PAINT, NOT AT THE FLAG — and that is load-bearing.
 *    `test/groupTabMessageGlow.value.test.ts` COUNTS `setGroupHasNew(` calls and
 *    requires exactly 4. Clearing the flag from a new place would break that
 *    spec and, worse, the notify/chime path it guards. The flag keeps its exact
 *    current meaning ("something new landed here"); only the drawing now also
 *    asks whether there is still anything to show.
 *
 * ⚠️ REALTIME IS UNTOUCHED BY CONSTRUCTION: no socket handler, no fetch, no
 *    effect and no state setter is involved — the gate is a boolean AND at the
 *    three render sites. The moment a count goes back above 0 the orange returns
 *    on the next render, with no extra round trip.
 *
 * revert: drop the `count > 0` half of each condition in `TicketChat.tsx` and
 *         delete this spec.
 */
import { readFileSync } from 'node:fs';
import { ticketChatPageWithPieces } from './ticketChatSource';
import { describe, expect, it } from 'vitest';

import { showsNewGlow } from '../utils/groupTabGlow';

// [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
const src = ticketChatPageWithPieces();

describe('[ORANGENEEDSCOUNT] the rule itself', () => {
  it('⭐⭐ 🔴 flag set but the number is 0 ⇒ no orange', () => {
    expect(showsNewGlow(true, 0)).toBe(false);
  });

  it('⭐⭐ flag set and the number is above 0 ⇒ orange, exactly as before', () => {
    expect(showsNewGlow(true, 1)).toBe(true);
    expect(showsNewGlow(true, 12)).toBe(true);
  });

  it('⭐⭐ no flag ⇒ never orange, whatever the number says', () => {
    /* A count alone must not light anything — the orange means "new since you
       last looked", not "has open work". Losing that distinction would light
       every busy group permanently. */
    expect(showsNewGlow(false, 9)).toBe(false);
    expect(showsNewGlow(false, 0)).toBe(false);
  });

  it('⭐ junk counts read as nothing to show, never as something', () => {
    expect(showsNewGlow(true, undefined)).toBe(false);
    expect(showsNewGlow(true, null)).toBe(false);
    expect(showsNewGlow(true, Number.NaN)).toBe(false);
    expect(showsNewGlow(true, -3)).toBe(false);
  });
});

describe('[ORANGENEEDSCOUNT] all three paint sites go through it', () => {
  it('⭐⭐ 🔴 the tab badge', () => {
    expect(src).toContain('const hasNew = showsNewGlow(!!groupHasNew[g._id], c)');
  });

  it('⭐⭐ 🔴 the "อื่นๆ" trigger ring', () => {
    expect(src).toContain('showsNewGlow(!!groupHasNew[g._id] && g._id !== activeGroupId, groupCounts[g._id])');
  });

  it('⭐⭐ 🔴 the rows inside the dropdown', () => {
    expect(src.split('showsNewGlow(').length - 1).toBe(3);
  });

  it('⭐⭐ the flag logic itself was not touched — the notify path is counted elsewhere', () => {
    /* Mirrors `groupTabMessageGlow.value.test.ts`.
       [FEAT-20260907-TABSEEN] 4 → 5: the added writer CLEARS — acknowledging the last
       lit status tab takes the open group's orange with it. The claim in this test's
       title is about the FLAG LOGIC, which is the line below, and it did not move. */
    expect(src.split('setGroupHasNew(').length - 1).toBe(5);
    /* Exactly two sites write `true`, and both are the realtime handlers. A clearing
       site deletes a key and can never match this shape, so this is the assertion that
       actually says "the flag logic was not touched". */
    expect(src.split('? prev : { ...prev, [').length - 1).toBe(2);
  });
});
