/**
 * [FEAT-20260822-BCASTEMPTY] Every empty value becomes `N/A` — OUR side only.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock.
 *
 * 🔴 WHY `N/A` AND NOT `''` — this is a LINE constraint, not a preference.
 * A flex `text` component whose value is an empty string fails LINE's
 * validation and the ENTIRE message is rejected, so one missing value would
 * cost the whole card. (เจ้าของ 22/08: "'' กับ '-' line ส่งไม่ได้")
 *
 * 🔒 OUR SIDE ONLY. The original var path keeps its own markers exactly as
 * they are — `'-'` for most values, `''` for `{{hook_domain}}` and friends
 * (deliberate there: those get concatenated into sentences, where a stray dash
 * reads worse than a gap — `webhook/flex/flex-render.util.ts:37`). We do not
 * touch that file, that behaviour, or that reasoning. ห้ามแก้ original.
 *
 * ⚠️ KNOWN, ACCEPTED TRADE-OFF: a value that genuinely IS "-" also becomes
 *    `N/A`. `-` is the system's own "no data" marker, so a real one is
 *    vanishingly unlikely — recorded here so it is a choice, not an accident.
 *
 * revert: delete this file with the rest of `checks/`.
 */

/** The one place this string exists. Change it here, nowhere else. */
export const BROADCAST_VAR_EMPTY = 'N/A';

/** Markers the original path uses for "nothing here". */
const ORIGINAL_EMPTIES = new Set(['', '-']);

/**
 * Characters that LOOK like nothing but are not whitespace.
 *
 * 🔴 `String.prototype.trim()` does not strip these — U+200B and U+00AD are
 * format characters, not WhiteSpace — so a name field holding a zero-width
 * space passed every check and rendered as a blank where a name belongs. An
 * audit proved it in node. อักขระที่มองไม่เห็น trim() ไม่ตัดให้.
 */
const INVISIBLE = /[\u200B-\u200D\uFEFF\u00AD]/g;

/** Is this value one LINE would refuse, or one that reads as missing? */
export function isEmptyForBroadcast(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  return ORIGINAL_EMPTIES.has(value.replace(INVISIBLE, '').trim());
}

/**
 * One value → itself, or `N/A`. Never throws, never returns ''.
 *
 * 🔴 ONLY PRIMITIVES BECOME TEXT. `String({})` is '[object Object]', and that
 * string would be substituted into a card and delivered to a customer looking
 * like a real value. An object arriving here means the var map was built wrong,
 * and `N/A` is the honest answer to "we do not have a value for this".
 * (Same class of bug as the retry-key one — `String()` on `unknown` is a trap.)
 * ห้ามให้ object กลายเป็นข้อความ.
 */
export function normalizeEmptyValue(value: unknown): string {
  if (isEmptyForBroadcast(value)) return BROADCAST_VAR_EMPTY;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    // 🔴 NaN / Infinity are NOT values — caught in review. A var computed as
    // `total / 0` would otherwise deliver "ยอดเฉลี่ยของคุณ Infinity บาท" to
    // every recipient, and a missing number would deliver "NaN".
    if (!Number.isFinite(value)) return BROADCAST_VAR_EMPTY;
    // A raw float reaches the customer as 0.30000000000000004 or 1e+21.
    // Round to 2 decimals and print in full — money and counts are what these
    // are, and neither reads well in exponent form. ตัวเลขต้องอ่านออก.
    return Number.isInteger(value)
      ? value.toLocaleString('en-US', { useGrouping: false })
      : (Math.round(value * 100) / 100).toLocaleString('en-US', {
          useGrouping: false,
          maximumFractionDigits: 2,
        });
  }
  return BROADCAST_VAR_EMPTY;
}

/**
 * The whole var map, normalised in one pass.
 *
 * ⚠️ MUST run BEFORE substitution. Afterwards a blank slot is indistinguishable
 *    from one the admin deliberately left blank in the card.
 */
export function normalizeEmpties(
  vars: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    out[k] = normalizeEmptyValue(v);
  }
  return out;
}
