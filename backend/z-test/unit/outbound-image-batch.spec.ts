/**
 * [FEAT-20260816-MULTIIMG] The ONE place that knows LINE's 5-objects-per-push
 * ceiling for the admin multi-image send: `planImagePushBatches`.
 *
 * Owner's packing rule (16/08, verbatim decision): when 5 images + a caption
 * would make 6 objects, "dynamic จัดการให้ส่ง 1ข้อความ+4 ภาพ และ 1 ภาพตาม" —
 * call 1 = [text, img1..img4] (5 objects), call 2 = [img5].
 * Every NON-overflow case keeps today's order (images first, caption trailing)
 * so the single-image behaviour stays byte-identical.
 *
 * These cases pin the arrangement itself — if anyone reorders a batch or moves
 * the ceiling, this file goes red before LINE answers 400 in production.
 */
import {
  LINE_MAX_MESSAGES_PER_PUSH,
  planImagePushBatches,
} from '@/modules/chat';

const urls = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `https://cdn.test/img${i + 1}.jpg`);

describe('[FEAT-20260816-MULTIIMG] planImagePushBatches', () => {
  it('exports the LINE ceiling as 5 (the number the whole feature hangs on)', () => {
    expect(LINE_MAX_MESSAGES_PER_PUSH).toBe(5);
  });

  it('1 image, no caption → one batch, trailing-text order', () => {
    expect(planImagePushBatches(urls(1), undefined)).toEqual([
      { imageUrls: urls(1), text: undefined, textFirst: false },
    ]);
  });

  it('1 image + caption → ONE batch, caption trailing (legacy order — byte-identical single send)', () => {
    expect(planImagePushBatches(urls(1), 'hi')).toEqual([
      { imageUrls: urls(1), text: 'hi', textFirst: false },
    ]);
  });

  it('4 images + caption = 5 objects → still ONE batch, caption trailing', () => {
    expect(planImagePushBatches(urls(4), 'hi')).toEqual([
      { imageUrls: urls(4), text: 'hi', textFirst: false },
    ]);
  });

  it('5 images, no caption = 5 objects → ONE batch', () => {
    expect(planImagePushBatches(urls(5), undefined)).toEqual([
      { imageUrls: urls(5), text: undefined, textFirst: false },
    ]);
  });

  it("5 images + caption = 6 objects → owner's split: [text, img1..4] then [img5]", () => {
    const five = urls(5);
    expect(planImagePushBatches(five, 'hi')).toEqual([
      { imageUrls: five.slice(0, 4), text: 'hi', textFirst: true },
      { imageUrls: five.slice(4), text: undefined, textFirst: false },
    ]);
  });

  it('empty caption string counts as NO caption (5 images + "" stays one batch)', () => {
    expect(planImagePushBatches(urls(5), '')).toEqual([
      { imageUrls: urls(5), text: undefined, textFirst: false },
    ]);
  });

  it('every batch respects the ceiling (objects = images + text ≤ 5)', () => {
    for (let n = 1; n <= 5; n++) {
      for (const text of [undefined, 'cap']) {
        for (const b of planImagePushBatches(urls(n), text)) {
          expect(b.imageUrls.length + (b.text ? 1 : 0)).toBeLessThanOrEqual(
            LINE_MAX_MESSAGES_PER_PUSH,
          );
        }
      }
    }
  });

  it('no image is lost or duplicated across batches, order preserved', () => {
    const five = urls(5);
    const flat = planImagePushBatches(five, 'hi').flatMap((b) => b.imageUrls);
    expect(flat).toEqual(five);
  });

  it('0 images → throws (text-only sends use the text path, never this planner)', () => {
    expect(() => planImagePushBatches([], 'hi')).toThrow(/at least 1 image/);
  });

  it('more than 5 images → throws (the controller caps uploads at 5 before this runs)', () => {
    expect(() => planImagePushBatches(urls(6), undefined)).toThrow(/at most 5/);
  });
});
