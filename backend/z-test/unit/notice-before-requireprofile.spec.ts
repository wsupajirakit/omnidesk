/**
 * [FEAT-20260824-NOTICEFIRST] The notice guard must be asked BEFORE the
 * unlinked-slip refusal — and this file is the only thing that can say so.
 * ===========================================================================
 * On 24/08 the slip-path notice guard moved above `if (blockUnlinked)` in
 * `webhook.service.ts`. The move is the whole change: not one argument, dep or
 * inner line differs, so NOTHING that inspects behaviour can tell the two
 * versions apart except on the single event class the move exists for — a slip
 * from a customer with no linked account, during the notice window. That event
 * needs a live LINE reply token, a real profile 404 and a real jsQR verdict, so
 * an ordinary unit test cannot reach it.
 *
 * ⇒ the ORDER ITSELF is asserted here, read off the source. Move the block back
 *   and this goes red immediately; that is exactly what it is for.
 *   ย้ายกลับเมื่อไหร่ ไฟล์นี้แดงทันที.
 *
 * ⚠️ THIS IS A GUARD, NOT A PREFERENCE. If a future change genuinely wants the
 *    refusal first again, the honest move is to delete this file IN THE SAME
 *    COMMIT with a reason — never to loosen the assertion until it passes.
 *
 * Owner, 24/08: "notice ต้องใหญ่สุดไม่ใช่หรอ เพราะเคสนี้คือ ส่งรูปมา = jsqr
 * ตรวจเป็น qr แล้ว > ต้องเจอด่าน notice ก่อน slip_require_profile".
 *
 * revert: delete this file together with moving the block back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE_LADDER } from '../../src/modules/webhook/gates/ladder-order';

const SRC = join(
  __dirname,
  '..',
  '..',
  'src',
  'modules',
  'webhook',
  'webhook.service.ts',
);

/** The image-path notice guard call — `eventKind: 'image'` pins the slip one. */
const GUARD = /await this\.tryNoticeGuard\(\{\s*\n\s*eventKind: 'image'/;
/**
 * The unlinked-slip refusal gate.
 *
 * 🔴 CONVERTED 05/09 — IT WAS `if (blockUnlinked) {`, AND THE RULE IS UNCHANGED.
 * The refusal's wiring became `gates/unlinked-slip-refuse.step.ts`, so the spine statement
 * is now the one-step slice that runs it. What is pinned is still WHERE THE REFUSAL SITS
 * RELATIVE TO THE GUARD — the `when` on that step is `slip.blockUnlinked`, the same
 * condition, read at the same position. `IMAGE_REFUSAL_LADDER` is a stable name: it exists
 * only because the guard's strike-plug box splits the image lane, so a rename would mean
 * the split itself had changed and this pin SHOULD be re-read.
 */
const REFUSAL = /\n\s*if \(await runLadder\(IMAGE_REFUSAL_LADDER, /;

describe('[FEAT-20260824-NOTICEFIRST] notice guard sits above the refusal', () => {
  const src = readFileSync(SRC, 'utf8');

  it('finds exactly one image-path notice guard and one refusal gate', () => {
    /* Two of either would make "which comes first" meaningless, so the count is
       asserted before the order is. สองอันเมื่อไหร่ คำถามเรื่องลำดับหมดความหมาย. */
    expect(src.match(new RegExp(GUARD, 'g'))).toHaveLength(1);
    expect(src.match(new RegExp(REFUSAL, 'g'))).toHaveLength(1);
  });

  it('asks the notice runtime BEFORE the unlinked-slip refusal', () => {
    const guardAt = src.search(GUARD);
    const refusalAt = src.search(REFUSAL);
    expect(guardAt).toBeGreaterThan(-1);
    expect(refusalAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(refusalAt);
  });

  it('keeps the guard after the jsQR verdict it reads', () => {
    /* The guard passes `qrPrescan.reason`; moving it above the pre-scan would
       not compile, but it WOULD compile above the point the verdict is FORMED,
       and then case E's `qrFound` would read a verdict that had not been formed
       for this branch yet. ต้องอยู่หลัง jsQR เสมอ.
     *
     * 🔴 CONVERTED 05/09, AND THE RULE DID NOT CHANGE — ONLY WHERE IT IS READ.
     *   This used to search the spine for `const qrPrescanSawSlip = `. That line
     *   moved into `gates/unlinked-slip-decide.step.ts` with the image slice, so
     *   the old search returned -1 and the case failed on a SPELLING, not on the
     *   order. A pin that names a line is only as good as that line's name.
     *
     *   The rule now has two halves and both are checked, because the verdict is
     *   formed in one place and consumed in another:
     *     · IN THE SPINE — the image slice runs above the guard, so `qrPrescan`
     *       is in hand before `qrReason` is passed;
     *     · IN THE LADDER — the pre-scan step runs before the step that reads its
     *       verdict, asserted on the shipped array rather than on source text.
     *   กฎเดิม แต่ย้ายที่อ่าน ไม่ใช่ผ่อนกฎ */
    const sliceAt = src.search(/if \(await runLadder\(IMAGE_LADDER, /);
    expect(sliceAt).toBeGreaterThan(-1);
    expect(sliceAt).toBeLessThan(src.search(GUARD));

    const ids = IMAGE_LADDER.map((step) => step.id);
    expect(ids).toContain('qr-prescan');
    expect(ids).toContain('unlinked-slip-decide');
    expect(ids.indexOf('qr-prescan')).toBeLessThan(
      ids.indexOf('unlinked-slip-decide'),
    );
  });

  it('still carries the note that explains the move and how to undo it', () => {
    /* A move with no reason written next to it is a move the next person
       reverts by accident. เหตุผลต้องอยู่ติดโค้ด. */
    expect(src).toContain('[FEAT-20260824-NOTICEFIRST]');
    expect(src).toContain('[SEAM-20260824-NOPROFILEQR]');
  });
});
