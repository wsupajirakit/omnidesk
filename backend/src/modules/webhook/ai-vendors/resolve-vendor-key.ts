/**
 * [P2-20260813] Which key a vendor may use — and which it may never touch.
 *
 * ⚠️ OWNER RULE (12 Aug, restated 13 Aug): **everything is per hook.** The only
 * server-level AI config is `AI_PROVIDER` (mock/real, a TEST seam — not a vendor
 * choice). Keys belong to the OA: `hook.custom_ai_key` is the key of whichever
 * vendor that hook selected. ทุกอย่าง per hook · env มีแค่ AI_PROVIDER.
 *
 * Gemini's `GEMINI_TEST_KEY → GEMINI_API_KEY` ladder is the ONE exception, and
 * only because it already exists: a keyless OA still answers today by riding it,
 * and removing that is the master plan's phase K (a staged cut with its own
 * evidence gate), not P2's business. It is transcribed here, not extended.
 *
 * ⚠️ DeepSeek therefore gets **NO env fallback at all** — a DeepSeek hook without
 * its own `custom_ai_key` must REFUSE, not borrow. Two reasons, both hard:
 *   1. per-hook is the rule, and a new vendor must not arrive already breaking it;
 *   2. the alternative found in review was worse — the providers resolve the
 *      GEMINI ladder unconditionally, so wiring `ai_vendor` without this function
 *      would have sent the **Google key to api.deepseek.com**: a guaranteed 401
 *      and one vendor's credential handed to another.
 * คีย์ค่ายหนึ่งห้ามหลุดไปอีกค่ายเด็ดขาด · ไม่มีคีย์ = ปฏิเสธ ไม่ใช่ยืม.
 *
 * Placement: `ai-vendors/` because the answer is per vendor and vendor #3 edits
 * exactly this file — never the providers.
 *
 * revert: delete this file and inline the Gemini ladder back into the two
 *         providers; DeepSeek then has no fallback either way.
 */

/** Vendor names as they appear in `hook.ai_vendor` — registry keys, not code. */
export const VENDOR_DEEPSEEK = 'deepseek';
export const VENDOR_GEMINI = 'gemini';

/**
 * The shared env fallback for a vendor, or undefined when that vendor has none.
 *
 * @param vendor `hook.ai_vendor` — absent/unknown means the default vendor,
 *   matching how the transport registries resolve (an unknown value never
 *   breaks a reply, it falls back).
 */
export function resolveVendorEnvKey(
  vendor: string | null | undefined,
): string | undefined {
  // DeepSeek: per-hook only, by design. No env rung exists to fall back to.
  if (vendor === VENDOR_DEEPSEEK) return undefined;
  // Gemini (and every unknown value) — the legacy ladder, order preserved.
  return process.env['GEMINI_TEST_KEY'] ?? process.env['GEMINI_API_KEY'];
}

/**
 * Full key resolution for one turn: the OA's own key first, then that vendor's
 * shared fallback if it has one. Returns undefined when neither exists, so the
 * caller throws its own KeyMissing error — this helper never gives up silently.
 */
export function resolveVendorKey(
  hookKey: string | null | undefined,
  vendor: string | null | undefined,
): string | undefined {
  const own = hookKey && hookKey.trim() ? hookKey.trim() : undefined;
  return own ?? resolveVendorEnvKey(vendor);
}
