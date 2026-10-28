/**
 * [FEAT-20260831-MENUMAINTAG] What the list shows in the FLEX TAG column, and
 * what Copy puts on the clipboard — the two must agree.
 * ===========================================================================
 * Three things were out of step before this:
 *
 *   · the TABLE on a non-menu tab showed `[[[flex_m00001]]]` and copied the same
 *     — correct, and the shape everything else is measured against
 *   · the TABLE on the MENU tab showed the operator-typed `flex_slug` RAW, while
 *     the Copy button ran it through the same wrapper ⇒ the clipboard received
 *     `[[[menu-q6-main]]]`, a string shaped like a system marker that no grammar
 *     in this product resolves. Display and clipboard disagreed, and the
 *     clipboard was wrong.
 *   · the CAROUSEL showed the value raw on EVERY tab, so the same card read
 *     differently depending on the view. เจ้าของแจ้ง 31/08: "carousel แสดงผลผิด".
 *
 * Now a menu card has a minted `flex_tag` of its own, so the rule is one line:
 * a MARKER is displayed and copied wrapped; a SLUG is displayed and copied raw,
 * because it is a payload fragment (`menu:v1:open:<slug>`), not a marker.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { flexMarker, isFlexMarkerValue } from '../utils/flexMarker';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('[FLEXTAGDISPLAY] one spelling of the marker wrapper', () => {
  it('⭐⭐⭐ wraps a tag in the three-bracket form', () => {
    expect(flexMarker('flex_m00001')).toBe('[[[flex_m00001]]]');
    expect(flexMarker('menu_main_00001')).toBe('[[[menu_main_00001]]]');
  });

  it('⭐⭐ never double-wraps something already wrapped', () => {
    expect(flexMarker('[[[flex_m00001]]]')).toBe('[[[flex_m00001]]]');
  });

  it('⭐ an empty value yields an empty string, never bare brackets', () => {
    expect(flexMarker('')).toBe('');
    expect(flexMarker(null)).toBe('');
    expect(flexMarker(undefined)).toBe('');
  });

  it('⭐⭐ a slug is NOT a marker — it is a payload fragment, copied raw', () => {
    expect(isFlexMarkerValue('flex_m00001')).toBe(true);
    expect(isFlexMarkerValue('menu_main_00001')).toBe(true);
    expect(isFlexMarkerValue('menu_sub_00007')).toBe(true);
    expect(isFlexMarkerValue('menu-q6-main')).toBe(false);
    expect(isFlexMarkerValue('1234')).toBe(false);
  });
});

describe('[FLEXTAGDISPLAY] both views read the same rule', () => {
  const LIST = () => src('pages/content/FlexMessageList.tsx');
  const CAROUSEL = () => src('components/flex/carousel/FlexCardCarousel.tsx');

  it('⭐⭐⭐ the list no longer hand-writes the bracket form', () => {
    /* mutation: put `[[[${item.flex_tag}]]]` back → this goes red, because the
       wrapper would then exist in two spellings again. */
    expect(LIST()).not.toContain('`[[[${item.flex_tag}]]]`');
    expect(LIST()).toContain('flexMarker(');
  });

  /* UPDATED 31/08 — the rule these two cases pinned was replaced by the owner's:
     on the MENU tab a MAIN card shows its tag, a SUB card shows its slug. Every
     other tab is unchanged and is still asserted below. */
  it('⭐⭐⭐ the carousel mapping: main → tag, sub → slug, other tabs → tag', () => {
    const s = LIST();
    expect(s).toContain("x.flex_sub_type === 'main'");
    expect(s).toContain('x.flex_tag || x.flex_slug');
    expect(s).toContain(': x.flex_tag) || undefined');
  });

  it('⭐⭐⭐ the table cell shows the slug unless it is a MAIN card with a tag', () => {
    expect(LIST()).toContain("!(item.flex_sub_type === 'main' && item.flex_tag)");
  });

  it('⭐⭐ the carousel shows the marker form, not the raw value', () => {
    expect(CAROUSEL()).toContain('flexMarker(');
  });

  it('⭐⭐ the column header says what the column shows on every tab', () => {
    /* it read "Menu Slug" on the menu tab while the cell shows a Flex Tag. */
    expect(LIST()).not.toContain("tab === 'menu' ? 'Menu Slug' : 'Flex Tag'");
  });

  it('⭐ the copy handler wraps through the same helper', () => {
    expect(LIST()).not.toContain('const wrapped = `[[[${tag}]]]`');
  });
});

/* [FEAT-20260831-MENUMAINTAG] the table must say WHAT it is showing.
   ────────────────────────────────────────────────────────────────────────────
   เจ้าของ 31/08, looking at the live page: *"ประเภทให้บอกด้วย sub หรือ main / ช่องแรก
   ให้บอกด้วยว่า tag หรือ slug"*.

   Both are the same complaint: the column shows a value whose KIND the operator
   has to infer. `sub-register` and `[[[menu_sub_00010]]]` sit in one column and
   behave differently (one is a payload fragment, the other a marker), and every
   menu row says "เมนู (menu)" whether it is the card a customer lands on or one
   of its children. */
describe('[FLEXTAGDISPLAY] the table names the kind of what it shows', () => {
  const LIST = () => src('pages/content/FlexMessageList.tsx');

  it('⭐⭐⭐ the first column labels the value as a tag or a slug', () => {
    const s = LIST();
    expect(s).toContain('flex.kind_tag');
    expect(s).toContain('flex.kind_slug');
  });

  it('⭐⭐ the kind label stays ENGLISH in every locale', () => {
    /* owner, 31/08: "column แรกใช้ eng บอกสิ มาใช้ไทยทำไม" — `tag` and `slug` are the
       words the rest of the product already uses (FLEX TAG, Menu Slug); a translated
       one reads like a third concept. */
    for (const lang of ['th', 'en', 'it', 'zh']) {
      const dict = JSON.parse(
        readFileSync(join(__dirname, '..', `i18n/translations/${lang}.json`), 'utf8'),
      ) as Record<string, string>;
      expect(dict['flex.kind_tag']).toBe('tag');
      expect(dict['flex.kind_slug']).toBe('slug');
    }
  });

  it('⭐⭐⭐ the type column carries main / sub for a menu card', () => {
    expect(LIST()).toContain('item.flex_sub_type');
  });

  it('⭐ a non-menu card gets no sub-type chip — it has none', () => {
    /* the chip is rendered from the row's own value, so a type that never sets
       `flex_sub_type` cannot grow one. */
    expect(LIST()).toMatch(/item\.flex_sub_type\s*&&/);
  });
});

/* [FEAT-20260831-MENUMAINTAG] SUB cards must not show a tag at all.
   ────────────────────────────────────────────────────────────────────────────
   Owner, 31/08: *"sub ห้ามออก tag"*. The number is still MINTED for a sub card —
   decision 3, "ทำเผื่อไว้แต่ไม่ใช้ก็ได้" — but showing it invites an operator to
   paste it, and a sub card is not summoned that way: it is opened by the postback
   its parent carries. A visible id for a route that does not exist is a promise
   the product cannot keep, so the column falls back to the slug for a sub. */
describe('[FLEXTAGDISPLAY] only a MAIN menu card shows its tag', () => {
  const LIST = () => src('pages/content/FlexMessageList.tsx');
  const CAROUSEL = () => src('components/flex/carousel/FlexCardCarousel.tsx');

  it('⭐⭐⭐ the table decides on the sub-type, not merely on "has a tag"', () => {
    expect(LIST()).toContain("item.flex_sub_type === 'main'");
  });

  it('⭐⭐⭐ the carousel mapping applies the same rule', () => {
    expect(LIST()).toContain("x.flex_sub_type === 'main'");
  });

  it('⭐⭐ a non-menu card is unaffected — it still shows its own flex_tag', () => {
    /* the sub-type test may only narrow the MENU tab; every other type has no
       sub-type at all and must keep the behaviour it always had. */
    const s = LIST();
    expect(s).toMatch(/tab === 'menu'/);
    expect(s).toContain('flexMarker(item.flex_tag)');
  });

  it('⭐ the carousel still renders the marker form for whatever it is given', () => {
    expect(CAROUSEL()).toContain('flexMarker(item.tag)');
  });
});
