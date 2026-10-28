/**
 * [FEAT-20260831-MENUMAINTAG] EVERY marker family, before and after the new one.
 * ===========================================================================
 * A new member of `resolveReplyTags` is the kind of change that breaks its
 * neighbours quietly: the function reads and strips six shapes in a fixed order,
 * and one careless regex can swallow another family's text or shift the
 * precedence that decides what the customer receives.
 *
 * So this file walks the WHOLE family, one case per shape, and then walks the
 * pairs. It is not a duplicate of the per-feature specs — those prove each
 * feature; this proves they still coexist.
 *
 * 🔴 THE INVARIANT: exactly ONE card shape may win, no marker may survive into
 * the text, and the customer-helper marker decorates rather than competes.
 * ตระกูลอื่นต้องเหมือนเดิมเป๊ะ.
 */
import { resolveReplyTags } from '@/modules/webhook/hook-reply/reply-tags.util';

const LINK = 'https://example.invalid/answer';
const r = (text: string) => resolveReplyTags(text, LINK);

/** No marker of any shape may reach a customer. */
const noMarkers = (s: string) => {
  expect(s).not.toMatch(/\[\[\[?/);
  expect(s).not.toMatch(/\]\]\]?/);
};

describe('[TAGFAMILIES] each family still resolves on its own', () => {
  it('⭐⭐⭐ customer-helper — attaches buttons, keeps the sentence', () => {
    const out = r('สวัสดีค่ะ [[[customer-helper]]]');
    expect(out.wantsHelperQuickReply).toBe(true);
    expect(out.finalReplyForLine).toBe('สวัสดีค่ะ');
    noMarkers(out.finalReplyForLine);
  });

  it('⭐⭐⭐ flex_profile — the profile card', () => {
    const out = r('นี่ข้อมูลค่ะ [[[flex_profile]]]');
    expect(out.wantsFlexProfile).toBe(true);
    expect(out.wantedFlexTag).toBeNull();
    noMarkers(out.finalReplyForLine);
  });

  it('⭐⭐⭐ flex_mNNNNN — a custom card by tag', () => {
    const out = r('ดูการ์ดนี้ [[[flex_m00007]]]');
    expect(out.wantedFlexTag).toBe('flex_m00007');
    expect(out.wantsFlexProfile).toBe(false);
    noMarkers(out.finalReplyForLine);
  });

  it('⭐⭐⭐ flex_pcNNNNN — a profile-semi-custom card', () => {
    const out = r('[[[flex_pc00003]]]');
    expect(out.wantedFlexPcTag).toBe('flex_pc00003');
    expect(out.wantedFlexTag).toBeNull();
    noMarkers(out.finalReplyForLine);
  });

  it('⭐⭐⭐ img_xxx — the image carousel', () => {
    const out = r('รูปโปรโมชัน [[[img_promo]]]');
    expect(out.imageTag).toBe('img_promo');
    noMarkers(out.finalReplyForLine);
  });

  it('⭐⭐⭐ menu_main_NNNNN — the new one', () => {
    const out = r('เมนูค่ะ [[[menu_main_00001]]]');
    expect(out.wantedMenuCardTag).toBe('menu_main_00001');
    noMarkers(out.finalReplyForLine);
  });

  it('⭐⭐ the scenario marker is NOT a card tag — it belongs to the menu module', () => {
    const out = r('[[[menu-primary]]]');
    expect(out.wantedMenuCardTag).toBeNull();
    expect(out.wantedFlexTag).toBeNull();
    /* it is still erased, by the catch-all that has always removed unknown
       markers — the customer must never read one. */
    noMarkers(out.finalReplyForLine);
  });
});

describe('[TAGFAMILIES] the precedence between them is unchanged', () => {
  const CARD_SHAPES = (out: ReturnType<typeof resolveReplyTags>): number =>
    [
      out.wantsFlexProfile ? 1 : 0,
      out.wantedFlexTag ? 1 : 0,
      out.wantedFlexPcTag ? 1 : 0,
      out.wantedMenuCardTag ? 1 : 0,
      out.imageTag ? 1 : 0,
    ].reduce((a, b) => a + b, 0);

  it('⭐⭐⭐ never more than ONE shape wins, whatever is thrown at it', () => {
    const inputs = [
      '[[[flex_profile]]] [[[flex_m00001]]] [[[flex_pc00001]]] [[[menu_main_00001]]] [[[img_x]]]',
      '[[[menu_main_00001]]] [[[flex_m00001]]]',
      '[[[img_x]]] [[[menu_sub_00002]]]',
      '[[[flex_pc00001]]] [[[menu_main_00001]]]',
      '[[[customer-helper]]] [[[menu_main_00001]]]',
    ];
    for (const text of inputs) {
      const out = r(text);
      expect(CARD_SHAPES(out)).toBeLessThanOrEqual(1);
      noMarkers(out.finalReplyForLine);
    }
  });

  it('⭐⭐⭐ the order is profile → flex_m → flex_pc → menu → image', () => {
    expect(r('[[[flex_profile]]] [[[flex_m00001]]]').wantsFlexProfile).toBe(
      true,
    );
    expect(r('[[[flex_m00001]]] [[[flex_pc00001]]]').wantedFlexTag).toBe(
      'flex_m00001',
    );
    expect(r('[[[flex_pc00001]]] [[[menu_main_00001]]]').wantedFlexPcTag).toBe(
      'flex_pc00001',
    );
    expect(r('[[[menu_main_00001]]] [[[img_x]]]').wantedMenuCardTag).toBe(
      'menu_main_00001',
    );
  });

  it('⭐⭐ the helper marker never suppresses a card — it decorates', () => {
    for (const [text, read] of [
      [
        '[[[customer-helper]]] [[[flex_m00001]]]',
        (o: ReturnType<typeof resolveReplyTags>) => o.wantedFlexTag,
      ],
      [
        '[[[customer-helper]]] [[[menu_main_00001]]]',
        (o: ReturnType<typeof resolveReplyTags>) => o.wantedMenuCardTag,
      ],
      [
        '[[[customer-helper]]] [[[img_x]]]',
        (o: ReturnType<typeof resolveReplyTags>) => o.imageTag,
      ],
    ] as const) {
      const out = r(text);
      expect(out.wantsHelperQuickReply).toBe(true);
      expect(read(out)).toBeTruthy();
    }
  });

  it('⭐⭐ a plain answer is returned untouched — no family fires', () => {
    const out = r('ยอดเงินคงเหลือ 1,250 บาทค่ะ');
    expect(CARD_SHAPES(out)).toBe(0);
    expect(out.wantsHelperQuickReply).toBe(false);
    expect(out.finalReplyForLine).toBe('ยอดเงินคงเหลือ 1,250 บาทค่ะ');
  });

  it('⭐ a near-miss of the new family is not a card, and is still erased', () => {
    for (const bad of [
      '[[[menu_main_]]]',
      '[[[menu_main]]]',
      '[[[MENU_MAIN_00001]]]',
      '[[[menu_other_00001]]]',
    ]) {
      const out = r(`x ${bad}`);
      if (bad === '[[[MENU_MAIN_00001]]]') {
        /* the readers in this file are case-insensitive by the family's own
           convention, so an uppercase spelling IS accepted here — stated rather
           than asserted away, because the menu SCENARIO grammar is the opposite
           (lowercase only) and the difference is deliberate. */
        expect(out.wantedMenuCardTag).toBe('MENU_MAIN_00001');
      } else {
        expect(out.wantedMenuCardTag).toBeNull();
      }
      noMarkers(out.finalReplyForLine);
    }
  });
});
