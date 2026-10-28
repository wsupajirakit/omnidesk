/**
 * [FEAT-20260829-FLEXMENUSLUGCOL] the menu tab must identify its cards.
 *
 * Reported from the real UI on 29/08: every row on the Flex Menu tab showed "-"
 * under FLEX TAG. The filter was right — only `menu` rows were listed — but a
 * menu card has no flex tag, so the column that identified a card was empty on
 * every row and the list was unusable for telling them apart.
 *
 * The slug is the identifier that matters: it is what an operator names the card
 * AND what a button's `menu:v1:open:<slug>` postback points at, so it must be
 * visible and copyable rather than retyped from memory.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

/** The header cell rule, isolated from the page's data loading. */
const Header: React.FC<{ tab: 'normal' | 'menu' }> = ({ tab }) => (
  <table>
    <thead>
      <tr>
        <th>{tab === 'menu' ? 'Menu Slug' : 'Flex Tag'}</th>
      </tr>
    </thead>
  </table>
);

/** The cell rule, same shape as the page's ternary. */
const Cell: React.FC<{
  tab: 'normal' | 'menu';
  flex_slug: string | null;
  flex_tag: string | null;
}> = ({ tab, flex_slug, flex_tag }) => (
  <div data-testid="cell">
    {tab === 'menu' ? (
      flex_slug ? (
        <>
          <span>{flex_slug}</span>
          <button type="button">Copy</button>
        </>
      ) : (
        <span>-</span>
      )
    ) : flex_tag ? (
      <span>{`[[[${flex_tag}]]]`}</span>
    ) : (
      <span>-</span>
    )}
  </div>
);

describe('[MENUSLUGCOL] the header names what the column holds', () => {
  it('⭐ the menu tab says Menu Slug', () => {
    render(<Header tab="menu" />);
    expect(screen.getByText('Menu Slug')).toBeTruthy();
  });

  it('the normal tab still says Flex Tag — nothing else changed', () => {
    render(<Header tab="normal" />);
    expect(screen.getByText('Flex Tag')).toBeTruthy();
  });
});

describe('[MENUSLUGCOL] the cell shows the slug, not an empty flex tag', () => {
  it('⭐⭐ a menu card shows its slug', () => {
    render(<Cell tab="menu" flex_slug="menu-q6-main" flex_tag={null} />);
    expect(screen.getByText('menu-q6-main')).toBeTruthy();
  });

  it('⭐⭐ and offers Copy — the payload must never be retyped', () => {
    render(<Cell tab="menu" flex_slug="menu-q6-main" flex_tag={null} />);
    expect(
      within(screen.getByTestId('cell')).getByRole('button', { name: 'Copy' }),
    ).toBeTruthy();
  });

  it('a menu card with no slug still renders (slug is optional)', () => {
    render(<Cell tab="menu" flex_slug={null} flex_tag={null} />);
    expect(screen.getByText('-')).toBeTruthy();
  });

  it('⭐ a menu card never shows a flex tag, even if the row carries one', () => {
    render(<Cell tab="menu" flex_slug="sub-a" flex_tag="promo" />);
    expect(screen.queryByText('[[[promo]]]')).toBeNull();
    expect(screen.getByText('sub-a')).toBeTruthy();
  });

  it('⭐ a NORMAL card is untouched — still the flex tag, never a slug', () => {
    render(<Cell tab="normal" flex_slug="should-not-show" flex_tag="promo" />);
    expect(screen.getByText('[[[promo]]]')).toBeTruthy();
    expect(screen.queryByText('should-not-show')).toBeNull();
  });
});

/**
 * ==== SOURCE CENSUS — the rules above must live in the REAL page ====
 *
 * The cases above test the RULE in isolation, which would keep passing if the
 * page never adopted it. These read the page itself, so the two cannot drift.
 */
describe('[MENUSLUGCOL] the page really implements it', () => {
  const page = () =>
    readFileSync(
      join(__dirname, '..', 'pages/content/FlexMessageList.tsx'),
      'utf8',
    );

  /* [FEAT-20260831-MENUMAINTAG] UPDATED, not deleted. The header WAS tab-dependent
     because a menu card had no flex tag to show — the column really did carry a
     different thing on that tab. Menu cards are now minted `menu_main_NNNNN` /
     `menu_sub_NNNNN` like every other tagged type, so the column shows a Flex Tag
     on every tab and the slug is only the fallback for a row created before the
     tag existed. The rule this case defends — the header must say what the column
     shows — is unchanged and is what the assertion below now measures.
     หัวคอลัมน์ต้องตรงกับของที่โชว์ · กฎเดิม ความจริงใหม่ */
  it('the header says what the column shows — a Flex Tag on every tab', () => {
    const src = page();
    expect(src).not.toContain("tab === 'menu' ? 'Menu Slug' : 'Flex Tag'");
    expect(src).toContain('Flex Tag');
  });

  it('the cell can still fall back to flex_slug and copy it', () => {
    /* still true, and still needed: a menu card made before the tag existed has
       no `flex_tag`, and its slug is what the column shows for it. */
    const src = page();
    expect(src).toContain('item.flex_slug');
    expect(src).toContain('handleCopyFlexTag(item.flex_slug as string)');
  });

  it('⭐ the group filter is the searchable component, not a bare <select>', () => {
    /* A raw <select> is unusable once the list is long — this deployment has
       dozens of bulk20-group-* entries. */
    const src = page();
    expect(src).toContain('<SearchableSelect');
    expect(src).toContain("options={groups.map((g) => ({ value: g._id, label: g.group_name }))}");
    /* ⚠️ An earlier version of this assertion searched for any `<select>` within
       400 characters of `groups.map` and failed on the unrelated TYPE filter
       that sits nearby — the census was over-broad, not the page. Pin the exact
       thing instead: the group options must not be rendered as <option> rows. */
    expect(src).not.toMatch(/<option[^>]*>\{g\.group_name\}/);
  });
});
