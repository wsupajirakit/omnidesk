/**
 * [FEAT-20260908-AICAPLEDGER] The persisted call-ledger, written once.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md §13 SAVE POINT 5
 * ===========================================================================
 * Three decorators enforce a call cap — reply (138 lines), assist-summary (137)
 * and translate (99) — and all three carry the SAME ledger code: read the JSON,
 * treat a corrupt file as exhausted, refuse at the limit, increment BEFORE the
 * call, persist immediately. Pasted three times, and the third one already lost
 * two of the safety logs its siblings have.
 *
 * 🔴 THIS MOVES THE MECHANISM AND NOTHING ELSE. The three counters stay three
 *    separate ledgers, the three error classes stay distinct, the log strings
 *    stay byte-identical, and each decorator keeps recording its own entry shape.
 *    Merging any of that would change behaviour the operators depend on — see
 *    the table below, which is why this file is generic instead of concrete.
 *
 * ── WHAT DIFFERS BETWEEN THE THREE, AND STAYS DIFFERENT ────────────────────
 *   entry recorded   reply `{at,hookId,question}` · summary `{at,question}`
 *                    · translate `{at,target}`
 *   log prefix       `[AI-CAP]` · `[AI-CAP] assist-summary` · `[AI-TRANSLATE-CAP]`
 *   completion log   reply ✓ · summary ✓ · translate ✗ (never had one)
 *   corrupt-file log reply ✓ · summary ✓ · translate ✗ (silent, deliberately
 *                    left silent — adding a log is a change, not a move)
 *   `usage()`        reply ✓ · summary ✓ · translate ✗
 *   ledger FILE      reply and summary SHARE one · translate has its own, so a
 *                    translation budget cannot silence the customer-facing bot
 *
 * 🔴 THE LIMIT COMES FROM THE CALLER, NEVER FROM THE FILE. All three read()
 *    implementations write `limit: this.limit` and ignore the `limit` field they
 *    just parsed. That is deliberate and is preserved exactly: the ceiling is a
 *    deployment decision (env), and a ledger that could raise its own ceiling by
 *    having a number edited into it would not be a cap. The field is still
 *    WRITTEN so a human reading the file sees what it was capped at.
 *    ⚠️ Consequence worth knowing: editing `limit` in the JSON does nothing. Only
 *    the env value, read at boot, moves the ceiling.
 *
 * 🔴 CORRUPT MEANS EXHAUSTED, NEVER "0 USED". A parse error that read as zero
 *    would silently grant a whole fresh budget — the one failure mode a cap must
 *    not have. Transcribed from all three, and pinned by spec.
 *
 * revert: delete this file and inline `read`/`write` back into each decorator.
 * They were identical, so the restore is mechanical.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * One ledger on disk. Generic over the call entry, because the three seams
 * record different things and rewriting their files is not a refactor.
 */
export interface CapLedgerState<TEntry> {
  count: number;
  limit: number;
  calls: TEntry[];
}

/**
 * Read the ledger, applying the two rules every copy carried.
 *
 * @param onCorrupt invoked ONLY on a parse failure, so each caller keeps its own
 *   log line — or, for translate, keeps having none. Not defaulted to a logger:
 *   a default would give translate a log it never had.
 */
export function readCapLedger<TEntry>(
  counterFile: string,
  limit: number,
  onCorrupt?: () => void,
): CapLedgerState<TEntry> {
  const empty: CapLedgerState<TEntry> = { count: 0, limit, calls: [] };
  if (!existsSync(counterFile)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(counterFile, 'utf8')) as Partial<
      CapLedgerState<TEntry>
    >;
    return {
      count: typeof parsed.count === 'number' ? parsed.count : 0,
      /* the caller's ceiling, NOT the file's — see the header */
      limit,
      calls: Array.isArray(parsed.calls) ? parsed.calls : [],
    };
  } catch {
    onCorrupt?.();
    // Corrupt ⇒ EXHAUSTED. Reading it as "0 used" would hand out a fresh budget.
    return { count: limit, limit, calls: [] };
  }
}

/** Persist the ledger. `mkdirSync` first: all three did, for a fresh checkout. */
export function writeCapLedger<TEntry>(
  counterFile: string,
  state: CapLedgerState<TEntry>,
): void {
  mkdirSync(dirname(counterFile), { recursive: true });
  writeFileSync(counterFile, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Usage without consuming a slot. Reply and summary expose this; translate does
 * not, and that is left as-is — this helper exists so the two that DO expose it
 * stop computing `Math.max(0, …)` in two places.
 */
export function capUsage<TEntry>(
  counterFile: string,
  limit: number,
  onCorrupt?: () => void,
): { count: number; limit: number; remaining: number } {
  const s = readCapLedger<TEntry>(counterFile, limit, onCorrupt);
  return { count: s.count, limit, remaining: Math.max(0, limit - s.count) };
}
