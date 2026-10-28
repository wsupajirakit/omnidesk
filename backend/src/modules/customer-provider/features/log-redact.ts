/**
 * [FEAT-20261014-LOGREDACT] Personal data out of the prefetch audit log — per provider, opt-in.
 *
 * The custom-tool prefetch writes one `webhook_logs` row per endpoint with the partner's whole
 * answer in `raw_response`. The loan partner's answers carry a national id (`identityNumber`),
 * phone numbers, names, the LINE uid, a profile photo URL and device ids — stored verbatim in a
 * collection every operator can read (measured on the local loan clone, 14/10). The legacy
 * system never logged this line at all.
 *
 * A provider declares `logRedactPaths`: `parent.key` suffixes (array indices are transparent,
 * so `history.slip` matches every row). A matching leaf keeps its KEY and its TYPE slot but
 * its value becomes `[redacted]` — the row still shows the answer's shape, which is what an
 * incident needs. Nothing else is touched: money, terms, dates, statuses, contract codes stay.
 *
 * 🔴 NO DECLARATION = THE SAME OBJECT BACK, not a copy — shop-api's log rows stay byte-identical.
 * 🔴 LOG ONLY. `raw_profile_data` (what the panel draws) is not passed through here.
 *
 * Pure. revert: drop the call at `custom-tool.service.ts` (the `raw_response:` line), the
 * port field, the bind line in `active-provider.ts`, and this file — after first removing
 * the SCREENHIDE use of `redactByPaths` in `slip/slip-verification.service.ts`, which
 * shares this implementation.
 */
export const REDACTED = '[redacted]';

/* [FEAT-20261014-SCREENHIDE] the same rule, used for a raw-answer admin screen (slip detail).
   One implementation: a screen and a log hide fields the same way. */
export const redactByPaths = (
  value: unknown,
  paths: readonly string[],
): unknown => redactForLog(value, paths);

export function redactForLog(
  value: unknown,
  paths: readonly string[],
): unknown {
  if (paths.length === 0) return value;
  const wanted = new Set(paths);
  const walk = (node: unknown, parent: string): unknown => {
    if (Array.isArray(node)) return node.map((v) => walk(v, parent));
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const hit = wanted.has(`${parent}.${k}`) || wanted.has(k);
      out[k] =
        hit && (v === null || typeof v !== 'object')
          ? v === null
            ? null
            : REDACTED
          : walk(v, k);
    }
    return out;
  };
  return walk(value, '');
}
