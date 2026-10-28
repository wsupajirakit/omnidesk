/**
 * ==== [FEAT-20260903-SLIPGUARD] SlipGuard's OWN error numbering ====================
 *
 * WHY THIS IS A PER-PROVIDER FILE AND NOT A CENTRAL TABLE. Vendors do not share a
 * numbering space. Swiftcheck answers STRINGS (`SLIP_PENDING`), SlipGuard answers
 * NUMBERS, and a third could nest them or use HTTP status alone. Two vendors can
 * both define `1010` meaning different things, and a central table could not tell
 * them apart without being re-keyed per vendor — which is the same thing as this
 * file, with an extra indirection. ตารางโค้ดเป็นของเจ้านั้น ไม่ใช่ตารางกลาง
 *
 * 🔴 THE ONLY THING READ AT RUNTIME IS THE VERDICT. The human meaning beside each
 * line is a comment, deliberately, so nothing here is declared-but-unread — the
 * debt rule this repo already had to undo in production
 * (`[FIX-20260829-STRIKEENVDEAD]`).
 *
 * Source: SlipGuard API doc v1.13 (28 Feb 2026) plus live calls captured 02/09.
 *
 * revert: delete this folder and the line that registers it in `../index.ts`.
 */

/**
 * What the flow should make of a SlipGuard failure code.
 *
 * `'duplicate'` and `'wrong_receiver'` are BUSINESS ANSWERS the vendor happens to
 * deliver as HTTP 400. Swiftcheck reports the same two inside a 200 with a flag, so
 * folding them is what makes the two vendors mean the same thing downstream —
 * see `slipguard-normalise.ts`.
 *
 * `'failure'` is everything else: the slip genuinely was not verified.
 */
export type SlipGuardVerdict = 'duplicate' | 'wrong_receiver' | 'failure';

/**
 * code -> verdict. Every documented code is listed, including the ones that map
 * to `'failure'`, because "this code exists and we decided it is a failure" and
 * "we have never heard of this code" are different states and the next reader
 * needs to tell them apart.
 */
export const SLIPGUARD_ERROR_VERDICTS: Readonly<
  Record<number, SlipGuardVerdict>
> = {
  1000: 'failure', // no data / files / url in the request — our bug, not the slip's
  1001: 'failure', // branch not found ⇒ `hook.slip_verify_branch` is wrong or empty
  1002: 'failure', // bad auth ⇒ the key does not belong to that branch
  1003: 'failure', // package expired
  1004: 'failure', // over quota
  1005: 'failure', // not an image file
  1006: 'failure', // unreadable image
  1007: 'failure', // no QR in the image
  1008: 'failure', // the QR is not a payment QR
  1009: 'failure', // bank temporarily down — NO quota charged
  1010: 'failure', // the bank requires a wait of N minutes; the slip is too FRESH
  1011: 'failure', // QR expired, or the bank has no such transaction
  1012: 'duplicate', // 🔴 folded — Swiftcheck reports this inside a 200 with a flag
  1013: 'failure', // amount mismatch (only when `amount` is sent, which we do not)
  1014: 'wrong_receiver', // 🔴 folded — Swiftcheck reports this as `matchedAccount:false`
  1015: 'failure', // package not found
};

/**
 * @returns the verdict for a code, or `'failure'` for anything unrecognised.
 *
 * ⚠️ TOTAL, AND IT FAILS TOWARD `'failure'` ON PURPOSE. A code this table has
 * never seen must not be folded into the success envelope: folding is what tells
 * the payment leg the slip is good, and inventing that for an unknown code would
 * move money on a verdict nobody has read. An unrecognised code is reported as a
 * failure, which is the direction that costs a customer a resend rather than
 * costing the hook a deposit. โค้ดที่ไม่รู้จัก = ล้มเหลว ห้ามเดาว่าผ่าน
 */
export const slipGuardVerdictFor = (code: unknown): SlipGuardVerdict => {
  const n = typeof code === 'number' ? code : Number(code);
  return Number.isFinite(n)
    ? (SLIPGUARD_ERROR_VERDICTS[n] ?? 'failure')
    : 'failure';
};

/* 🔴 CHECK ORDER, MEASURED 02/09: `1014` BEATS `1013`. A wrong-receiver slip sent
 * with a deliberately wrong amount answered `1014`, not `1013`.
 *
 * ⇒ A wrong-account slip NEVER reports whether it was also a duplicate, and a hook
 * whose account is not registered at its SlipGuard branch would see `1014` on every
 * slip forever. That is a configuration failure wearing a customer failure's
 * clothes, and it is the first thing to check when a hook reports "every slip says
 * wrong account".
 *
 * A COMMENT AND NOT A CONSTANT, on purpose: nothing would read it, and this file
 * says three paragraphs above that a declared-but-unread value is debt. */
