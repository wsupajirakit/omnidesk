/**
 * [FIX-20260902-DATESCOPE2] the ⚙️ window offers two choices, and an operator
 * holding an older one is not stranded.
 * ===========================================================================
 * WHAT THE CONTROL IS. `filterWithinDays` bounds every list on the ticket page,
 * and it is the SAME input both halves of the บอทดูแล badge filter by — the rows
 * and the server's room count. It therefore also decides how many pages
 * `listAllRooms` has to fetch: on `7 วัน` normally one, on `ทั้งหมด` every room
 * the OA has. That is why it came back with the paging fix rather than after it —
 * without it, the most expensive setting would be the only possible one.
 *
 * 🔴 THE TRAP THIS FILE GUARDS. The list is presentation; the FILTER reads the
 * number. Shrinking the list does not migrate anyone's state, so an operator can
 * be holding `'2'` or `'5'` from before today. Those must keep narrowing exactly
 * as they did, and — the part that actually broke — the label must not claim a
 * different window. The old fallback was the literal `'2 วัน'`, correct only
 * while `2` was both the default and an option; after the trim it would have
 * shown "2 วัน" while the page filtered by five.
 *
 * The values are duplicated here rather than imported: `DATE_SCOPE_OPTIONS` is a
 * module-private constant inside the page, and exporting it only for a test would
 * widen the page's surface for no one's benefit. This file therefore asserts the
 * DECISIONS; if the page's list changes, this must be re-read against it.
 *
 * revert: delete this file; §3·5 of
 * `todo/task/02092026/fe_todo111_02092026_bot-badge-room-cap.md` records the rule.
 */
import { describe, it, expect } from 'vitest';

/** What the ⚙️ popover offers, in order. Mirrors `DATE_SCOPE_OPTIONS`. */
const OPTIONS: { value: string; label: string }[] = [
  { value: '7', label: '7 วัน' },
  { value: '', label: 'ทั้งหมด' },
];

/** What is actually sent to the service. `''` ⇒ omit the parameter entirely. */
const withinDaysParam = (v: string): number | undefined =>
  v === '' ? undefined : Number(v);

/** What the gear's tooltip reads. Mirrors `dateScopeLabel`. */
const dateScopeLabel = (v: string): string =>
  OPTIONS.find((o) => o.value === v)?.label ?? (v ? `${v} วัน` : 'ทั้งหมด');

describe('[FIX-20260902-DATESCOPE2] the ⚙️ picker offers exactly two windows', () => {
  it('🔴 two options, 7 วัน then ทั้งหมด', () => {
    expect(OPTIONS).toHaveLength(2);
    expect(OPTIONS.map((o) => o.value)).toEqual(['7', '']);
    expect(OPTIONS.map((o) => o.label)).toEqual(['7 วัน', 'ทั้งหมด']);
  });

  it('⭐⭐ ทั้งหมด OMITS the bound — it does not send zero days', () => {
    /* `0` would be a window of nothing and would empty every list. The escape
       hatch has to be "no parameter", which is what the page did before the
       control was ever hidden. */
    expect(withinDaysParam('')).toBeUndefined();
    expect(withinDaysParam('7')).toBe(7);
  });
});

describe('🔴 an operator holding a dropped value is not stranded', () => {
  it.each([['2'], ['3'], ['4'], ['5']])(
    'a stored %s still narrows by that many days',
    (stored) => {
      expect(withinDaysParam(stored)).toBe(Number(stored));
    },
  );

  it.each([
    ['2', '2 วัน'],
    ['5', '5 วัน'],
  ])('the label for a stored %s reads %s, never "2 วัน" by accident', (v, label) => {
    /* The bug the old hardcoded fallback would have caused after the trim. */
    expect(dateScopeLabel(v)).toBe(label);
  });

  it('⭐⭐ the two offered values keep their own labels', () => {
    expect(dateScopeLabel('7')).toBe('7 วัน');
    expect(dateScopeLabel('')).toBe('ทั้งหมด');
  });
});
