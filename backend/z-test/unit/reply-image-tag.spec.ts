/* [FIX-20260815-IMGTAGSTRIPPED] the image carousel tag never survives to its reader
 * ===========================================================================
 * THE FEATURE. An operator binds a tag — `[[[img_promo]]]` — to a set of images
 * and teaches the model to answer with it. The bot is then supposed to send that
 * carousel INSTEAD of the text.
 *
 * THE DEFECT. `resolveReplyTags` detects every OTHER marker BEFORE stripping —
 * customer-helper, flex_profile, flex_m, flex_pc — because "the tag is what
 * selects the reply shape" (its own comment). The image tag is the one that was
 * never given that treatment: `[FIX-20260807-NOMARKERLEAK]`'s catch-all removes
 * any `[[[…]]]` it does not recognise, and its comment even lists
 * `[[[img_promo]]]` among the shapes it strips. The consumer then calls
 * `findImageTag(tags.finalReplyForLine)` — i.e. it searches the text the tag has
 * already been deleted from, and always finds nothing.
 *
 * So the carousel branch has been unreachable since the catch-all landed on
 * 7 Aug 2026. No error, no log: the customer simply gets the plain sentence.
 *
 * WHAT THESE PIN
 *   1. the tag is READ BEFORE the strip — same treatment as its four siblings
 *   2. the customer still never sees the marker (the whole point of the catch-all)
 *   3. precedence: a card wins over a carousel, because a flex reply REPLACES the
 *      text and only one shape can be sent per answer
 *   4. no tag ⇒ null, and ordinary bracketed prose is not mistaken for one
 *
 * These run against `resolveReplyTags` directly — the resolver is pure, so the
 * defect and the fix are both visible without a webhook, a hook or a database.
 */
import {
  findImageTag,
  resolveReplyTags,
} from '@/modules/webhook/hook-reply/reply-tags.util';

const resolve = (text: string) =>
  resolveReplyTags(text, 'https://link.example');

describe('[IMGTAG] the carousel tag survives long enough to be read', () => {
  /* THE REGRESSION. Before the fix `imageTag` did not exist and the consumer
     re-scanned the stripped text, finding nothing. */
  it('reports the tag the model emitted', () => {
    const r = resolve('ดูโปรโมชั่นนะคะ [[[img_promo]]]');

    expect(r.imageTag).toBe('img_promo');
  });

  it('still removes the marker from what the customer reads', () => {
    const r = resolve('ดูโปรโมชั่นนะคะ [[[img_promo]]]');

    expect(r.finalReplyForLine).not.toContain('[[[');
    expect(r.finalReplyForLine).not.toContain('img_promo');
    expect(r.finalReplyForLine).toContain('ดูโปรโมชั่น');
  });

  it.each([
    ['img_promo', '[[[img_promo]]]'],
    ['img_bank_list', '[[[img_bank_list]]]'],
    ['img_2', '[[[img_2]]]'],
  ])('reads %s', (expected, marker) => {
    expect(resolve(`ข้อความ ${marker}`).imageTag).toBe(expected);
  });

  it('is null when the answer carries no image tag', () => {
    expect(resolve('สวัสดีค่ะ').imageTag).toBeNull();
  });

  /* The catch-all deliberately spares ordinary bracketed prose; the image
     matcher must not be greedier than the marker it is looking for. */
  it.each(['[ดูรูป]', '[1]', 'ราคา [500]'])(
    'does not treat %s as an image tag',
    (text) => {
      expect(resolve(text).imageTag).toBeNull();
    },
  );

  /* ── PRECEDENCE ──────────────────────────────────────────────────────────
     A flex reply REPLACES the text, so only one shape can win. The card wins:
     it is the more specific instruction, and this mirrors how flex_profile
     already beats flex_m and flex_pc in the same resolver. */
  it.each([
    ['flex_profile', '[[[flex_profile]]] [[[img_promo]]]'],
    ['flex_m', '[[[flex_m00001]]] [[[img_promo]]]'],
    ['flex_pc', '[[[flex_pc00001]]] [[[img_promo]]]'],
  ])('a %s card wins over the carousel', (_label, text) => {
    const r = resolve(text);

    expect(r.imageTag).toBeNull();
    expect(
      r.wantsFlexProfile || r.wantedFlexTag || r.wantedFlexPcTag,
    ).toBeTruthy();
  });

  it('the carousel wins when no card was requested', () => {
    const r = resolve('[[[img_promo]]]');

    expect(r.imageTag).toBe('img_promo');
    expect(r.wantsFlexProfile).toBe(false);
    expect(r.wantedFlexTag).toBeNull();
    expect(r.wantedFlexPcTag).toBeNull();
  });

  /* The helper quick reply is not a card — it attaches TO a text reply — so it
     does not compete with the carousel. */
  it('the customer-helper tag does not suppress the carousel', () => {
    const r = resolve('[[[customer-helper]]] [[[img_promo]]]');

    expect(r.imageTag).toBe('img_promo');
    expect(r.wantsHelperQuickReply).toBe(true);
  });

  /* `findImageTag` stays exported and unchanged — the fix moves WHERE it is
     called, not what it does. */
  it('findImageTag itself is untouched', () => {
    expect(findImageTag('x [[[img_promo]]] y')).toBe('img_promo');
    expect(findImageTag('no tag here')).toBeNull();
    expect(findImageTag(null)).toBeNull();
  });
});
