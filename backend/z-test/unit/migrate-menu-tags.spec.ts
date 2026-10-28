/**
 * [FEAT-20260901-MENUTAGMIGRATE] The tag arithmetic behind the migration CLI.
 *
 * The CLI's own steps touch a database, so what is pinned here is the part that
 * decides the ANSWER: which number the target hands out next once the five rows
 * land. Getting it wrong means the owner is told "the next menu will be 00011"
 * when it will not be, and they find out from a failed save days later.
 *
 * These mirror `nextMenuTag` (`flex-messages.service.ts:1121-1138`) on purpose —
 * if that function's rule changes, this suite should go red and the migration
 * plan should be re-read rather than silently drifting.
 */
import { MENU_TAGS, highestTag, nextTagAfter } from '@/cli/migrate-menu-tags';

/** The main-family tags that exist locally, minus the five being migrated. */
const WITHOUT_MIGRATION = [
  'menu_main_00001',
  'menu_main_00002',
  'menu_main_00009',
  'menu_sub_00001',
  'menu_sub_00019',
];

describe('highestTag', () => {
  it('reads the MAX, not the count — a gap must not shift the answer', () => {
    expect(
      highestTag(['menu_main_00001', 'menu_main_00009'], 'menu_main_'),
    ).toBe(9);
  });

  it('answers 0 when the family is empty, so the first tag is 00001', () => {
    expect(highestTag(['menu_sub_00004'], 'menu_main_')).toBe(0);
    expect(nextTagAfter(['menu_sub_00004'], 'menu_main_')).toBe(
      'menu_main_00001',
    );
  });

  it('ignores the other family entirely', () => {
    expect(
      highestTag(['menu_sub_00019', 'menu_main_00002'], 'menu_main_'),
    ).toBe(2);
  });

  /* The regex is anchored at both ends in the service, and must be here too:
     `menu_sub_00011x` is not tag 11, and a suffix must not be read as one. */
  it('refuses a tag that only starts like one', () => {
    expect(highestTag(['menu_main_00099x'], 'menu_main_')).toBe(0);
    expect(highestTag(['xmenu_main_00099'], 'menu_main_')).toBe(0);
  });

  it('refuses the wrong number of digits', () => {
    expect(
      highestTag(['menu_main_0001', 'menu_main_000100'], 'menu_main_'),
    ).toBe(0);
  });
});

describe('nextTagAfter — what the target will hand out', () => {
  it('pads to five digits', () => {
    expect(nextTagAfter(['menu_main_00009'], 'menu_main_')).toBe(
      'menu_main_00010',
    );
  });

  /* The whole point of the migration, stated as a test: with the five rows in
     place, the next main menu created is 00011. */
  it('after the migration the next main tag is 00011', () => {
    const after = [...WITHOUT_MIGRATION, ...MENU_TAGS];
    expect(nextTagAfter(after, 'menu_main_')).toBe('menu_main_00011');
  });

  it('before the migration it would have been 00010', () => {
    expect(nextTagAfter(WITHOUT_MIGRATION, 'menu_main_')).toBe(
      'menu_main_00010',
    );
  });

  /* The sub numbers are deliberately non-contiguous — 12 is the soft-deleted
     duplicate and 15-18 never existed — so the next sub follows the MAX, 19. */
  it('the sub family follows its own max, gaps and all', () => {
    const after = [...WITHOUT_MIGRATION, ...MENU_TAGS];
    expect(nextTagAfter(after, 'menu_sub_')).toBe('menu_sub_00020');
  });
});

describe('the tag list itself', () => {
  it('names five rows, by tag', () => {
    expect(MENU_TAGS).toHaveLength(5);
  });

  /* Selecting by slug would drag in `menu_sub_00012`, the copy that was
     soft-deleted on 31/08. The list is tags precisely so that cannot happen. */
  it('does NOT include the soft-deleted sub-register twin', () => {
    expect(MENU_TAGS).toContain('menu_sub_00011');
    expect(MENU_TAGS).not.toContain('menu_sub_00012');
  });

  it('is one main and four subs', () => {
    const mains = MENU_TAGS.filter((t) => t.startsWith('menu_main_'));
    expect(mains).toEqual(['menu_main_00010']);
    expect(MENU_TAGS.filter((t) => t.startsWith('menu_sub_'))).toHaveLength(4);
  });
});
