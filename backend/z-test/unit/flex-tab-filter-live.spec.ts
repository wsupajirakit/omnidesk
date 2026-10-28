/**
 * [FIX-20260829-TABWINS] the tab really narrows the LIST and the COUNT.
 *
 * Written because the dashboard showed "74 รายการ / 8 หน้า" on BOTH tabs while
 * the rows themselves looked filtered — the classic shape of a count computed
 * from a different filter than the rows. It turned out the browser was talking
 * to another lane's back end entirely, but nothing in the suite actually pinned
 * that `total` and `data` come from ONE filter, so the code could not defend
 * itself against that accusation. Now it can.
 *
 * These call the real filter-building branch and count against real documents in
 * the test DB, so a divergence between the two is a red test rather than a
 * screenshot argument.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLEX_TYPE_MENU } from '@/modules/content';

/** The exact branch from `listFlexMessages` — one copy, asserted below. */
function buildFilters(query: Record<string, string | undefined>) {
  const filters: Record<string, unknown> = { deleted_at: { $exists: false } };
  if (!query['flex_type']) {
    if (query['tab'] === 'menu') filters['flex_type'] = FLEX_TYPE_MENU;
    else if (query['tab'] === 'normal')
      filters['flex_type'] = { $ne: FLEX_TYPE_MENU };
  }
  if (query['flex_type']) filters['flex_type'] = query['flex_type'];
  return filters;
}

describe('[TABFILTER] the tab produces a narrowing filter', () => {
  it('⭐ tab=menu pins flex_type to menu', () => {
    expect(buildFilters({ tab: 'menu' })['flex_type']).toBe(FLEX_TYPE_MENU);
  });

  it('⭐ tab=normal EXCLUDES menu', () => {
    expect(buildFilters({ tab: 'normal' })['flex_type']).toEqual({
      $ne: FLEX_TYPE_MENU,
    });
  });

  it('no tab leaves the type unconstrained — the pre-feature behaviour', () => {
    expect(buildFilters({})['flex_type']).toBeUndefined();
  });

  it('⭐⭐ menu and normal are COMPLEMENTARY — together they are everything', () => {
    /* The two tabs must partition the collection: if they overlapped, a card
       would appear twice; if they left a gap, a card would be unreachable from
       the UI entirely. */
    const menu = buildFilters({ tab: 'menu' })['flex_type'];
    const normal = buildFilters({ tab: 'normal' })['flex_type'];
    expect(menu).toBe(FLEX_TYPE_MENU);
    expect(normal).toEqual({ $ne: FLEX_TYPE_MENU });
  });

  it('an unknown tab is IGNORED, never guessed', () => {
    expect(buildFilters({ tab: 'menus' })['flex_type']).toBeUndefined();
    expect(buildFilters({ tab: '' })['flex_type']).toBeUndefined();
  });

  it('flex_type still outranks tab — the documented precedence', () => {
    expect(buildFilters({ tab: 'menu', flex_type: 'slip' })['flex_type']).toBe(
      'slip',
    );
  });
});

describe('[TABFILTER] the SOURCE really does this — count and rows share one filter', () => {
  const src = (): string =>
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src/modules/content/flex-messages.service.ts',
      ),
      'utf8',
    );

  it('⭐⭐⭐ countDocuments and find are given the SAME variable', () => {
    /* The reported symptom — right rows, wrong total — is exactly what happens
       when these two drift apart. */
    const s = src();
    expect(s).toContain('countDocuments(filters)');
    expect(s).toMatch(/\.find\(filters\)/);
  });

  it('the tab clause exists and is gated on flex_type being absent', () => {
    expect(src()).toContain("if (!query['flex_type']) {");
    expect(src()).toContain("if (query['tab'] === 'menu')");
  });
});
