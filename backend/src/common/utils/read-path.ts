/**
 * [REFACTOR-20260905-READPATH] The canonical dot-path reader.
 *
 * ## Why this file exists — a census, not a hunch
 * Looking for "is there already one of these" on 05/09 turned up SIX on the back
 * end alone, and no single truth among them:
 *
 *   readSpecPath  `webhook/flex/flex-data-vars.util.ts`          full grammar
 *   readSpecPath  `content/broadcast-var/format/value-format.ts` IDENTICAL copy
 *   readSpecPath  `content/flex-var/flex-var-guidelines.ts`      IDENTICAL copy
 *   pickByPath    `common/utils/result-rules.ts`                 dots only, null
 *   pickByPath    `modules/external/utils/result-rules.ts`       a further variant
 *   readPath      `customer-provider/providers/engine/`          dots + [k=v]
 *
 * (The dashboard has three more: `DynamicTagPreviewModal.tsx` twice in ONE file,
 * and `hooks/usePreferences.ts`.)
 *
 * ## 🔴 WHY THE THREE COPIES ARE NOT DELETED — read before "tidying"
 * They are DELIBERATE, and merging them is forbidden by decisions already made:
 *
 *   · `flex-var-guidelines.ts` is FROZEN — its exports feed the flex-save
 *     allowlist, so its surface may not move.
 *   · The broadcast copy is the owner's call, D38 on 2026-08-22 — *"clone ทั้ง
 *     สเปกและ formatter"* — precisely so the broadcast path shares NO runtime
 *     code with the var path and cannot change it by accident.
 *
 * So this file does NOT unify them. It is the canonical DEFINITION, used by new
 * code, plus a fixed reference the drift guard measures the copies against —
 * `z-test/unit/read-path-canonical.spec.ts` runs all four over the same vectors
 * and fails when any one of them diverges. That is as much single truth as those
 * two decisions allow, and the part that was missing: the copies were identical
 * by luck, with nothing holding them there.
 * รวมไม่ได้เพราะเจ้าของสั่ง clone ไว้ · แต่ต้องมีตัววัดว่ายังเหมือนกัน
 *
 * ## The grammar
 *   `finance.credit_balance`                   plain dotted lookup
 *   `finance.balances[0].amount`               array element by index
 *   `finance.balances[asset_code=cash].amount` array element by one of its fields
 *   `products[0][1]`                              repeated groups on one segment
 *
 * Lifted VERBATIM from `flex-data-vars.util.ts`, which is the version proven in
 * production against real payloads. The customer-provider engine had written a
 * weaker one (no index, no repeated groups) three hours earlier — that is what
 * "look for the existing one first" is for.
 *
 * 🔴 MISSING ⇒ `undefined`, never `null`. The two `pickByPath` variants answer
 * `null` instead, and that is NOT a style difference: `result-rules` decides
 * whether an external tool call counts as success, and `null` is a value its
 * rules compare against. Do not "align" them without reading those rules.
 *
 * revert: delete this file, its barrel line and its spec; the customer-provider
 *         engine goes back to its own local copy (git 601de46).
 */

/**
 * The value at `path` inside `root`, or `undefined` if any step is missing.
 *
 * ⚠️ The array-field comparison is by STRING (`String(item[key]) === wanted`),
 * so `balances[asset_code=1]` matches a numeric `1`. That is the production
 * behaviour of the three copies and changing it would move values on screens
 * that already work.
 */
export function readPath(root: unknown, path: string): unknown {
  let current: unknown = root;

  for (const segment of String(path).split('.')) {
    if (current === null || current === undefined) return undefined;

    const head = /^([^[]*)((?:\[[^\]]*\])*)$/.exec(segment);
    if (!head) return undefined;

    const [, name, brackets] = head;
    current = name ? (current as Record<string, unknown>)[name] : current;
    if (!brackets) continue;

    // Repeated groups, so `products[0][1]` resolves rather than silently yielding
    // nothing — a failure the original's own comment records having shipped.
    for (const group of brackets.match(/\[[^\]]*\]/g) ?? []) {
      if (current === null || current === undefined) return undefined;
      const selector = group.slice(1, -1);
      if (!Array.isArray(current)) return undefined;

      const equals = selector.indexOf('=');
      if (equals === -1) {
        current = current[Number(selector)];
      } else {
        const key = selector.slice(0, equals);
        const wanted = selector.slice(equals + 1);
        current = current.find(
          (item) =>
            item !== null &&
            item !== undefined &&
            (item as Record<string, unknown>)[key] !== undefined &&
            (item as Record<string, unknown>)[key] !== null &&
            String((item as Record<string, unknown>)[key]) === wanted,
        );
      }
    }
  }

  return current;
}
