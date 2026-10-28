/**
 * [FEAT-20260909-DSREASONING] What a hook row says about reasoning, for one
 * vendor and one lane — as a neutral value a transport can act on.
 * ===========================================================================
 * A pure function of a row. No DI, no Mongoose, no HTTP, no knowledge of chat,
 * tickets or the webhook. That is what lets the same answer serve the reply
 * lane and the translate lane without either importing the other.
 *
 * 🔴 THE ANSWER FOR AN UNCONFIGURED OA IS `null`, NOT A DEFAULT OBJECT.
 *    `null` means "say nothing to the vendor", and every caller must attach
 *    nothing at all when it sees one — not a field set to undefined, not a
 *    field set to the vendor's documented default. An OA that never opened the
 *    box must produce the request it produced before this feature existed.
 *
 * ⚠️ `null` IS NOT `'disabled'`. Unset leaves the vendor's own default in
 *    force; `disabled` is an instruction to turn thinking off. Two different
 *    requests, and collapsing them would make every existing OA start sending a
 *    field nobody chose.
 *
 * ⚠️ IT DOES NOT VALIDATE. Both write paths run the parsers, so a stored value
 *    is already one of the allowed words. Re-checking here would add a branch no
 *    input can reach and would make the lane fail on a row written before the
 *    column existed — the same reasoning `resolve-translate-vendor.ts` records.
 *
 * revert: delete this file with its directory.
 */
import type { ReasoningLane } from './reasoning-columns';
import { reasoningColumns } from './reasoning-columns';

/**
 * DeepSeek's shape, in neutral words.
 *
 * `effort` is this repo's name for the vendor's `reasoning_effort`; the
 * translation to the wire spelling belongs in the transport, which is the only
 * file allowed to know how a vendor spells things.
 */
export interface DeepSeekReasoning {
  type: 'enabled' | 'disabled';
  effort?: 'low' | 'high' | 'max';
}

/** Gemini's shape: a token budget. `-1` is the vendor's "dynamic". */
export interface GeminiReasoning {
  budget: number;
}

/** Read a string column, treating blank and non-string as "not set". */
const str = (
  row: Record<string, unknown>,
  field: string | null,
): string | null =>
  field !== null && typeof row[field] === 'string' && row[field].trim() !== ''
    ? row[field].trim()
    : null;

/**
 * DeepSeek's reasoning for this row, or `null` for "say nothing".
 *
 * ⚠️ An EFFORT ALONE, with no `type`, still produces an answer — with `type`
 *    omitted. Whether the vendor honours an effort without a type is one of the
 *    open probe questions, and this function's job is to report what the
 *    operator chose, not to complete it on their behalf. The transport omits
 *    what is absent; the vendor decides.
 */
export function resolveDeepSeekReasoning(
  row: Record<string, unknown>,
  lane: ReasoningLane,
): DeepSeekReasoning | null {
  const cols = reasoningColumns('deepseek', lane);
  const type = str(row, cols.thinkingField);
  const effort = str(row, cols.effortField);
  if (type === null && effort === null) return null;
  const out: DeepSeekReasoning = {
    /* No type but an effort ⇒ the operator asked for effort while leaving the
       switch alone. `enabled` is the vendor's own documented default, so this
       is reporting their intent, not inventing one. */
    type: type === 'disabled' ? 'disabled' : 'enabled',
  };
  if (effort !== null) out.effort = effort as DeepSeekReasoning['effort'];
  return out;
}

/**
 * Gemini's reasoning for this row, or `null` for "say nothing".
 *
 * 🔴 FOR `lane: 'main'` THIS IS INFORMATIONAL ONLY — the reply lane reads
 *    `gemini_thinking_budget` through `request-credentials.ts` and must go on
 *    doing so. This function exists so the TRANSLATE lane has an answer, and so
 *    the map of six is complete. Routing the live path through here would be a
 *    refactor of a working customer-facing lane that buys nothing.
 */
export function resolveGeminiReasoning(
  row: Record<string, unknown>,
  lane: ReasoningLane,
): GeminiReasoning | null {
  const { budgetField } = reasoningColumns('gemini', lane);
  if (budgetField === null) return null;
  const raw = row[budgetField];
  /* A number, and only a number. `null`, absent and a non-number all mean the
     OA did not choose — which is every row that predates the column. */
  return typeof raw === 'number' && Number.isFinite(raw)
    ? { budget: raw }
    : null;
}
