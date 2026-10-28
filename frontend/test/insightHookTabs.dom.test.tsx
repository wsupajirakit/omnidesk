/* [UI-20260814-INSIGHTHOOKTABS] Insight report — OA tab strip
 * ===========================================================================
 * Owner, 14/08: "if the hook (oa) tabs run past 60% of the width, cut the tail
 * into a searchable select box · remove the 'All' option entirely · default to
 * the first hook alphabetically, and if there is none, don't break — just null."
 * Follow-ups the same day: "exceed — make it 75%", then "make it 80%".
 *
 * ⚠️ The highest-stakes case here is NO HOOKS. The old code defaulted to '' and
 *    '' meant "All channels", so an empty list still rendered a working page.
 *    With the All tab removed, a careless empty-list path either crashes on
 *    `sorted[0]._id` or silently resurrects the all-channels query. Both are
 *    covered below.
 *
 * ⚠️ Width-based collapsing is NOT asserted through real layout — jsdom reports
 *    every offsetWidth/clientWidth as 0, so a ratio assertion against real layout would
 *    pass no matter what the code did. Widths are stubbed explicitly so the
 *    split is measured against numbers the test controls.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  HookTabsOverflow,
  pickDefaultHookId,
  sortHooksAlphabetically,
  hookTabLabel,
} from '../pages/insight/HookTabsOverflow';
import { HookData } from '../types';

/* jsdom has no ResizeObserver — the component observes the strip for resizes. */
beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

/* Cast to HookData (not `never`) — the schema has many more required fields,
   but only these are read here, and a typed alias keeps `h._id` usable in the
   assertions below. */
const hook = (id: string, alias: string, updated: string) =>
  ({ _id: id, alias, line_oa_name: `oa-${id}`, updated_at: updated } as unknown as HookData);

/** A hook with no alias — the tab must then fall back to `line_oa_name`. */
const hookNoAlias = (id: string, oaName: string) =>
  ({ _id: id, line_oa_name: oaName, updated_at: '' } as unknown as HookData);

/* updated_at deliberately runs OPPOSITE to alphabetical order, so a test that
   passes under the old "most recently updated" rule cannot also pass here. */
const HOOKS = [
  hook('h3', 'zulu', '2026-08-14T00:00:00Z'), // newest, but last alphabetically
  hook('h1', 'alpha', '2026-08-01T00:00:00Z'),
  hook('h2', 'mike', '2026-08-07T00:00:00Z'),
];

describe('[INSIGHT HOOK TABS] default hook = first alphabetically', () => {
  it('⭐ picks the alphabetically first hook, not the most recently updated', () => {
    expect(pickDefaultHookId(HOOKS)).toBe('h1'); // 'alpha' — h3 is newest
  });

  it('⭐⭐ no hooks → null (not "", which used to mean All channels)', () => {
    // '' would be falsy too, but it would also re-enable the removed all-channels
    // query for anyone who reads the state directly. The type must say "nothing".
    expect(pickDefaultHookId([])).toBeNull();
    expect(pickDefaultHookId(undefined as never)).toBeNull();
  });

  it('sorts by the label shown on the tab (alias first, then line_oa_name)', () => {
    const noAlias = hookNoAlias('h9', 'aaa-oa');
    expect(hookTabLabel(noAlias)).toBe('aaa-oa');
    expect(sortHooksAlphabetically([...HOOKS, noAlias]).map(h => h._id)).toEqual([
      'h9', // 'aaa-oa'
      'h1', // 'alpha'
      'h2', // 'mike'
      'h3', // 'zulu'
    ]);
  });

  it('does not mutate the caller\'s array', () => {
    const input = [...HOOKS];
    sortHooksAlphabetically(input);
    expect(input.map(h => h._id)).toEqual(['h3', 'h1', 'h2']);
  });
});

describe('[INSIGHT HOOK TABS] the "All" tab is gone', () => {
  it('⭐ renders no All / ทั้งหมด tab', () => {
    render(<HookTabsOverflow hooks={HOOKS} value="h1" onChange={vi.fn()} />);
    expect(screen.queryByText('ทั้งหมด')).toBeNull();
    expect(screen.queryByText('All')).toBeNull();
  });

  it('⭐ zero hooks → renders nothing at all, and does not throw', () => {
    const { container } = render(
      <HookTabsOverflow hooks={[]} value={null} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('clicking a tab reports that hook id', () => {
    const onChange = vi.fn();
    render(<HookTabsOverflow hooks={HOOKS} value="h1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'mike' }));
    expect(onChange).toHaveBeenCalledWith('h2');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Width-based split. Every tab is stubbed at 100px wide; the strip's clientWidth
 * is what each case varies. Budget = clientWidth * 0.8.
 * ──────────────────────────────────────────────────────────────────────────── */
function renderWithWidths(stripWidth: number, tabWidth = 100) {
  const offset = vi
    .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
    .mockReturnValue(tabWidth);
  const client = vi
    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockReturnValue(stripWidth);
  const r = render(<HookTabsOverflow hooks={HOOKS} value="h1" onChange={vi.fn()} />);
  return {
    ...r,
    restore: () => {
      offset.mockRestore();
      client.mockRestore();
    },
  };
}

describe('[INSIGHT HOOK TABS] tabs past 80% collapse into a search dropdown', () => {
  it('⭐ everything fits → all 3 inline, no overflow trigger', () => {
    // 3 tabs × 100px = 300 ≤ 500×0.8 = 400
    const { restore } = renderWithWidths(500);
    for (const label of ['alpha', 'mike', 'zulu']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    restore();
  });

  it('⭐⭐ budget fits only 1 → the other 2 move into the dropdown', () => {
    /* 200×0.8 = 160 ⇒ tab #1 (100) fits, #2 would reach 200 > 160.
       Proves the ratio is below 100%: at 100% the budget would be 200 and
       two tabs would stay inline. */
    const { restore } = renderWithWidths(200);
    expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
    restore();
  });

  it('⭐⭐ the ratio is exactly 0.8 — pinned by a case only 0.8 satisfies', () => {
    /* THE BOUNDARY CASE. Strip 250px:
         0.75 → budget 187.5 ⇒ tab #2 reaches 200 > 187.5 ⇒ only 1 inline, "+2"
         0.80 → budget 200.0 ⇒ tab #2 reaches 200, NOT > 200 ⇒ 2 inline, "+1"
       So this single assertion separates 80% from the previous 75%, which the
       200px case above cannot do (1 tab fits under both). Without it, walking
       the ratio back to 0.75 would leave the whole suite green. */
    const { restore } = renderWithWidths(250);
    expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'mike' })).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    restore();
  });

  it('⭐⭐ …and not any higher — a case only ratios ≤ 0.8 satisfy', () => {
    /* THE UPPER BOUND. The 250px case above pins the ratio from BELOW (0.75
       fails it) but not from above: 0.85 satisfies it too, and initially did —
       caught by mutating 0.8 → 0.85 and watching the suite stay green.

       Strip 375px, tabs 100px each:
         0.80 → budget 300.0 ⇒ tab #3 reaches 300, NOT > 300 ⇒ all 3 inline
         0.85 → budget 318.75 ⇒ same 3 inline … so width alone cannot separate
       Instead use a tab width where the two ratios diverge — strip 350px:
         0.80 → budget 280 ⇒ tab #3 reaches 300 > 280 ⇒ 2 inline, "+1"
         0.85 → budget 297.5 ⇒ tab #3 reaches 300 > 297.5 ⇒ 2 inline …also same.
       The clean separator is strip 360px:
         0.80 → budget 288 ⇒ 300 > 288 ⇒ 2 inline, "+1"
         0.85 → budget 306 ⇒ 300 ≤ 306 ⇒ 3 inline, no overflow
       So "+1" here means the ratio is at most 0.8. */
    const { restore } = renderWithWidths(360);
    expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'mike' })).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'zulu' })).toBeNull();
    restore();
  });

  it('⭐ selecting from the dropdown reports the hook id', () => {
    const onChange = vi.fn();
    const offset = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(100);
    const client = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(200);
    render(<HookTabsOverflow hooks={HOOKS} value="h1" onChange={onChange} />);

    fireEvent.click(screen.getByText('+2'));
    fireEvent.click(screen.getByRole('button', { name: /zulu/ }));
    expect(onChange).toHaveBeenCalledWith('h3');
    offset.mockRestore();
    client.mockRestore();
  });

  it('⭐ the search box filters the overflow list', () => {
    const offset = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(100);
    const client = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(200);
    render(<HookTabsOverflow hooks={HOOKS} value="h1" onChange={vi.fn()} />);

    fireEvent.click(screen.getByText('+2'));
    const box = screen.getByPlaceholderText('ค้นหา OA...');
    fireEvent.change(box, { target: { value: 'zul' } });
    expect(screen.getByRole('button', { name: /zulu/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /mike/ })).toBeNull();

    fireEvent.change(box, { target: { value: 'nothing-matches' } });
    expect(screen.getByText('ไม่พบรายการ')).toBeTruthy();
    offset.mockRestore();
    client.mockRestore();
  });

  it('⭐ a selection hidden in the overflow is still named on the trigger', () => {
    /* Without this the page would show a selected OA with no visible sign of
       which one — the trigger would just read "+2". */
    const offset = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(100);
    const client = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(200);
    render(<HookTabsOverflow hooks={HOOKS} value="h3" onChange={vi.fn()} />);
    expect(screen.queryByText('+2')).toBeNull();
    expect(screen.getAllByText('zulu').length).toBeGreaterThan(0);
    offset.mockRestore();
    client.mockRestore();
  });

  it('at least one tab always stays inline even with no room', () => {
    const { restore } = renderWithWidths(10);
    expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy();
    restore();
  });
});
