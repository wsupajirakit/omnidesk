/**
 * [FIX-20260819-DIVIDERHELPERLABEL] what the suppressed-check divider shows
 * ===========================================================================
 * WHAT. Decides the BODY of the `🔎 ผลตรวจสลิป: …` divider — the row written when
 * an unlinked customer's slip is refused while an admin is holding the room. The
 * customer receives nothing in that case ([FIX-20260812-REFUSEDSILENTWHENASSISTED]),
 * so this row is the operator's only view of what the bot would have replied.
 *
 * WHY. Owner, 19/08, seeing `ผลตรวจสลิป: [[[customer-helper]]]` on the admin
 * screen: a marker is markup, not an answer — it tells an operator nothing about
 * why the slip stopped. For that one case the divider must read a sentence a
 * human can act on. divider มีไว้ให้แอดมินอ่าน ไม่ใช่ให้เห็น markup.
 *
 * SCOPE — deliberately one case, by instruction ("เราแค่ทำ flow นี้เป๊ะๆเท่านั้น"):
 *   · ONLY the customer-helper marker is relabelled. `[[[assist]]]` and every other
 *     copy passes through byte-for-byte — it is the operator's own wording.
 *   · Detection reuses `hasCustomerHelperTag`, the SAME predicate the card builder
 *     uses (`hook-helper-flex.ts:87`), so the divider and the card can never
 *     disagree about whether a field asked for the helper.
 *   · This is admin-facing text only. Nothing here reaches a customer: the reply,
 *     the card and its minted button are built from `text` / `refusalCard` at the
 *     call site and are untouched by this file.
 *
 * WHY ITS OWN FILE. The rule lived as a ternary inside `webhook.service.ts`, where
 * the only way to pin it was asserting on the file's source text. As a pure
 * function it is testable with real inputs and outputs — the same reason
 * `refusal-reply-mode.ts` was extracted earlier the same day.
 *
 * revert: inline the ternary at the single call site in `webhook.service.ts`
 *         (grep the tag) and delete this file with its spec.
 */
import { hasCustomerHelperTag } from './reply-tags.util';

/** Exact wording the owner asked for, 19/08. */
export const SUPPRESSED_CHECK_HELPER_LABEL = 'ไม่พบข้อมูลการลงทะเบียนของสมาชิก';

/**
 * @param rawText      the operator's field, markers included (`slip_require_profile_text`)
 * @param resolvedText what would have gone to the customer, markers already resolved
 * @returns the divider body: the operator label for a customer-helper field,
 *          otherwise `resolvedText` exactly as given.
 */
export function resolveSuppressedCheckText(
  rawText: string | null | undefined,
  resolvedText: string,
): string {
  return hasCustomerHelperTag(rawText ?? '')
    ? SUPPRESSED_CHECK_HELPER_LABEL
    : resolvedText;
}
