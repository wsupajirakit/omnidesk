/**
 * [FEAT-20260909-VENDORTRANSLATE] Which vendor answers a TRANSLATION for this OA.
 * ===========================================================================
 * Owner, 09/09: translate must be able to choose its own provider, separately
 * from the webhook — which already has a field for that — while the two go on
 * sharing the same key boxes.
 *
 * One line of logic, in its own file, for two reasons that are worth the file:
 *
 *   1. it is TESTABLE without standing up a service, a Model or Nest. The
 *      question "which vendor" is a pure function of one row, and keeping it
 *      pure is what let its spec cover the fallback exhaustively.
 *   2. it is the ONLY place the fallback is written. The moment two call sites
 *      each say `?? row['ai_vendor']`, one of them is eventually updated alone
 *      and the lanes disagree about which vendor an OA is on — with nothing to
 *      report it, because both answers are individually plausible.
 *
 * 🔴 THIS FILE IS FOR THE TRANSLATE LANE ONLY. The webhook reply and assist
 *    summary lanes read `ai_vendor` directly and must keep doing so. If this
 *    function is ever called from `webhook/**`, the separation the owner asked
 *    for has been undone: translate would still work, and the webhook would
 *    silently start following a field that was never meant to steer it.
 *
 * ⚠️ AN UNSET COLUMN IS NOT A CHOICE. `null`, `''`, whitespace and a
 *    non-string all mean "follow `ai_vendor`", because that is what every hook
 *    written before this column existed contains, and their behaviour must not
 *    move by one byte. Only a real vendor name overrides.
 *
 * ⚠️ IT DOES NOT VALIDATE. An unrecognised name is impossible in a stored row —
 *    both write paths run `parseAiVendor` — and re-checking here would add a
 *    branch no input can reach while making the lane fail on any row written
 *    before the column existed. Downstream, an unknown value resolves to the
 *    default vendor by construction, the same as everywhere else in this repo.
 *
 * revert: delete this file and inline `row['ai_vendor']` at the one call site
 *         in `chat-translate.service.ts`; the translate lane then follows the
 *         webhook's vendor again, which is exactly today's behaviour for every
 *         hook that has not set the column.
 */

/** A vendor name only if the column really holds one; otherwise `null`. */
const named = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * @param row the hook document (or its `.lean()` / `toObject()` form)
 * @returns the vendor the TRANSLATE lane should use, or `null` for "the
 *   default", which is the same answer this lane gave before the column existed
 */
export function resolveTranslateVendor(
  row: Record<string, unknown>,
): string | null {
  return named(row['ai_vendor_translate']) ?? named(row['ai_vendor']);
}
