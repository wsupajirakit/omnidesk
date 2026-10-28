/**
 * [FEAT-20260816-MULTIIMG] Batch planner for the admin multi-image push.
 *
 * LINE's push endpoint accepts AT MOST 5 message objects per call, and billing
 * counts per CALL per recipient — so the cheapest correct shape is "as few
 * calls as possible, never more than 5 objects in one". This file is the ONE
 * place that knows that ceiling and how to pack around it; the adapter only
 * validates, the service only iterates.
 *
 * Packing rules (owner decision 16/08 — todo/task/16082026/3.md §8):
 *   · images + caption fit in 5   → ONE call, images first, caption trailing
 *     (identical to the legacy single-image order, so nothing existing moves)
 *   · 5 images + caption (6 objs) → TWO calls: [text, img1..img4] then [img5]
 *     — the owner's exact arrangement: "ส่ง 1ข้อความ+4 ภาพ และ 1 ภาพตาม"
 *     (text leads ONLY in this overflow call; nowhere else)
 *
 * Pure and DI-free on purpose: `z-test/unit/outbound-image-batch.spec.ts` pins
 * every arrangement. Consumed by chat-media.service only — deliberately NOT
 * exported from the module barrel.
 *
 * revert: delete this file + its spec, and drop the multi-image branch in
 * chat-media.service.ts (single-image sends never reach the overflow rule).
 */

/** LINE hard limit: message objects per push call (the 6th → HTTP 400). */
export const LINE_MAX_MESSAGES_PER_PUSH = 5;

/**
 * One LINE push call: which images ride in it, whether the caption rides too,
 * and where the caption sits. `textFirst` is true only for the overflow call.
 */
export interface ImagePushBatch {
  imageUrls: string[];
  text?: string;
  textFirst: boolean;
}

/**
 * Split N images (1..5) + an optional caption into LINE push batches.
 * Empty-string captions count as absent — same as the legacy single send.
 * ตัวเดียวที่ตัดสินการแบ่ง call — ห้าม copy กติกา 5 ไปไว้ที่อื่น
 */
export const planImagePushBatches = (
  imageUrls: string[],
  text: string | undefined,
): ImagePushBatch[] => {
  if (imageUrls.length < 1) {
    throw new Error('planImagePushBatches: at least 1 image is required');
  }
  if (imageUrls.length > LINE_MAX_MESSAGES_PER_PUSH) {
    throw new Error(
      `planImagePushBatches: at most ${LINE_MAX_MESSAGES_PER_PUSH} images per send`,
    );
  }

  const caption = text || undefined;
  const total = imageUrls.length + (caption ? 1 : 0);

  if (total <= LINE_MAX_MESSAGES_PER_PUSH) {
    return [{ imageUrls, text: caption, textFirst: false }];
  }

  // Only reachable as 5 images + caption. Owner's split: the caption leads a
  // full first call of [text, 4 images]; the 5th image follows alone.
  const lead = LINE_MAX_MESSAGES_PER_PUSH - 1;
  return [
    { imageUrls: imageUrls.slice(0, lead), text: caption, textFirst: true },
    { imageUrls: imageUrls.slice(lead), text: undefined, textFirst: false },
  ];
};
