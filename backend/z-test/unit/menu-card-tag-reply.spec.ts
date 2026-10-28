/**
 * [FEAT-20260831-MENUMAINTAG] `[[[menu_main_00001]]]` in a reply summons THAT card.
 * ===========================================================================
 * A main menu card had no way to be named in an answer. The scenario marker
 * (`[[[menu-primary]]]`) names a DEFINITION, and the card behind it is matched
 * by `flex_slug` — operator-typed, nullable, renameable. The minted tag names
 * one card for life, which is what an AI prompt or a value slot needs.
 *
 * 🔴 IT JOINS THE EXISTING FAMILY, IT DOES NOT START A NEW ONE.
 * `resolveReplyTags` is the ONE place that decides which shape a reply takes,
 * with a precedence chain written into its own comments (a flex card beats the
 * image carousel; the customer-helper marker does not compete because it
 * decorates rather than replaces). The menu card tag is a card, so it obeys the
 * same rule: detected before stripping, and it loses to the shapes above it.
 * ⚠️ THE MARKER MUST NEVER REACH A CUSTOMER — and that is owned by the catch-all
 *    at the end of `resolveReplyTags`, which removes ANY `[[[…]]]` it does not
 *    know. This family therefore adds no strip of its own (the `imageTag` block
 *    states the same rule for the same reason). Proven, not assumed: deleting a
 *    dedicated strip left every case green, so the property is guarded exactly
 *    once. กวาดที่เดียวพอ ห้ามซ้ำ.
 */
import {
  resolveReplyTags,
  findMenuCardTagRef,
} from '@/modules/webhook/hook-reply/reply-tags.util';

const LINK = 'https://example.invalid/answer';

describe('[MENUCARDTAG] the reader', () => {
  it('⭐⭐⭐ finds a main card tag anywhere in the sentence', () => {
    expect(findMenuCardTagRef('ดูเมนูได้เลยค่ะ [[[menu_main_00001]]]')).toBe(
      'menu_main_00001',
    );
  });

  it('⭐⭐ finds a sub card tag too — the series exists, so the reader accepts it', () => {
    expect(findMenuCardTagRef('[[[menu_sub_00011]]]')).toBe('menu_sub_00011');
  });

  it('⭐⭐⭐ does NOT mistake the scenario marker for a card tag', () => {
    /* `menu-primary` uses hyphens and names a definition; `menu_main_1` uses
       underscores and names a card. Two grammars, and this reader owns one. */
    expect(findMenuCardTagRef('[[[menu-primary]]]')).toBeNull();
    expect(findMenuCardTagRef('[[[menu-second-a]]]')).toBeNull();
  });

  it('⭐⭐ does not answer for the other families', () => {
    expect(findMenuCardTagRef('[[[flex_m00001]]]')).toBeNull();
    expect(findMenuCardTagRef('[[[customer-helper]]]')).toBeNull();
  });

  /* No stripper of its own: the catch-all at the end of `resolveReplyTags`
     removes any `[[[…]]]` it does not know, so a second pass would change
     nothing — a mutation proved exactly that. What matters is the PROPERTY, and
     it is asserted where it is observable: on the resolved text below and across
     every family in `reply-tag-families.spec.ts`. */
  it('⭐ the marker never survives into the text the customer reads', () => {
    const out = resolveReplyTags(
      'ก่อน [[[menu_main_00001]]] หลัง [[[menu_sub_00002]]]',
      'https://example.invalid/a',
    );
    expect(out.finalReplyForLine).not.toContain('menu_main_00001');
    expect(out.finalReplyForLine).not.toMatch(/\[\[\[/);
  });
});

describe('[MENUCARDTAG] inside the one resolution sequence', () => {
  it('⭐⭐⭐ the tag is reported and the text no longer carries it', () => {
    const r = resolveReplyTags('เมนูหลักค่ะ [[[menu_main_00001]]]', LINK);
    expect(r.wantedMenuCardTag).toBe('menu_main_00001');
    expect(r.finalReplyForLine).not.toContain('menu_main_00001');
    expect(r.finalReplyForLine).not.toContain('[[[');
  });

  it('⭐⭐⭐ a flex card still wins — only one shape can be sent', () => {
    const r = resolveReplyTags('[[[flex_m00001]]] [[[menu_main_00001]]]', LINK);
    expect(r.wantedFlexTag).toBe('flex_m00001');
    expect(r.wantedMenuCardTag).toBeNull();
    expect(r.finalReplyForLine).not.toContain('menu_main');
  });

  it('⭐⭐ the profile card also wins', () => {
    const r = resolveReplyTags(
      '[[[flex_profile]]] [[[menu_main_00001]]]',
      LINK,
    );
    expect(r.wantsFlexProfile).toBe(true);
    expect(r.wantedMenuCardTag).toBeNull();
  });

  it('⭐⭐ a menu card beats the image carousel, like every other card does', () => {
    const r = resolveReplyTags('[[[menu_main_00001]]] [[[img_promo]]]', LINK);
    expect(r.wantedMenuCardTag).toBe('menu_main_00001');
    expect(r.imageTag).toBeNull();
  });

  it('⭐⭐ the customer-helper marker does NOT compete — it decorates', () => {
    const r = resolveReplyTags(
      '[[[customer-helper]]] [[[menu_main_00001]]]',
      LINK,
    );
    expect(r.wantsHelperQuickReply).toBe(true);
    expect(r.wantedMenuCardTag).toBe('menu_main_00001');
  });

  it('⭐ a reply with no menu tag is untouched — null, and the text as before', () => {
    const r = resolveReplyTags('สวัสดีค่ะ', LINK);
    expect(r.wantedMenuCardTag).toBeNull();
    expect(r.finalReplyForLine).toBe('สวัสดีค่ะ');
  });
});
