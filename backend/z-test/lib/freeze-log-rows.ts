/**
 * [RULER-20260815-WLOGGOLDEN] Shared freezer for `webhook_logs` payload rulers.
 *
 * Used by the golden blocks in `webhook-ingest-flow.spec.ts` and
 * `webhook-flow-matrix.spec.ts`. One definition on purpose: two private copies
 * of the scrubber would drift, and a drifted scrubber makes the two rulers
 * disagree about what "byte-identical" means.
 *
 * WHAT IT MASKS — nothing else:
 *   · `timestamp` / `duration_ms` / `thai_time` values (wall clock —
 *     `thai_time` is [FEAT-20260822-AIPROMPTLOG]'s HH:mm inside payload_summary)
 *   · Date instances
 * Everything else is kept verbatim; keys are sorted so a snapshot diff means a
 * MEANING change, never map ordering.
 *
 * revert: delete this file + the two describe blocks that import it + their
 *         entries in __snapshots__.
 */

const VOLATILE_KEYS = new Set(['timestamp', 'duration_ms', 'thai_time']);

/** Deep-clone with sorted keys and wall-clock values masked. */
export function scrubLogRow(v: unknown): unknown {
  if (v instanceof Date) return '<date>';
  if (Array.isArray(v)) return v.map(scrubLogRow);
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      out[k] = VOLATILE_KEYS.has(k) ? '<volatile>' : scrubLogRow(src[k]);
    }
    return out;
  }
  return v;
}

/** The string a ruler snapshot freezes: every row, order kept, keys sorted. */
export function freezeLogRows(rows: Array<Record<string, unknown>>): string {
  return JSON.stringify(rows.map(scrubLogRow), null, 2);
}

/** Flush the pipeline's fire-and-forget writes (`void x()`, `.catch()`). */
export async function settleLogWrites(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 25));
}
