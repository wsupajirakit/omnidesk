/**
 * [FIX-20261014-DSEFFORTTOP] DeepSeek's reasoning fields, spelled where DeepSeek reads them.
 * ===========================================================================
 * DeepSeek takes the switch as `thinking: { type: "enabled" | "disabled" }` and the effort as
 * a TOP-LEVEL `reasoning_effort` (api-docs.deepseek.com/guides/thinking_mode, read 14/10/2026).
 * All three DeepSeek lanes — reply, summary, translate — used to build
 * `thinking: { type, reasoning_effort }` themselves, effort nested, three copies.
 *
 * MEASURED, not read: 14/10/2026 on the wire (`z-test/tmp/deepseek-wire-log.js`,
 * `todo/flow_test/ft17_14102026_deepseek_reasoning_wire.md`) the nested effort was ignored —
 * "low" reasoned MORE than "max" on 2 of 3 questions (6,564 / 7,502 vs 827 / 525 tokens).
 * The switch itself (`type`) was honoured: `disabled` came back with no `reasoning_content`.
 *
 * 🔴 NOTHING CHOSEN IS NOT THIS FILE'S CASE. Callers keep their own `if (!r) return base`, so
 *    an OA that set nothing still sends the very same four-key object as before.
 * ⚠️ NOT inside `buildDeepSeekBody` (`./transport.ts`): that door promises four keys, always,
 *    for every lane. This only spells the two optional fields; each lane decides to add them.
 *
 * revert: delete this file and put `thinking: r.effort === undefined ? { type } :
 *         { type, reasoning_effort }` back in the three transports.
 */

/** The neutral choice, as every lane carries it. `effort` absent ⇒ the vendor's default. */
export interface DeepSeekReasoningChoice {
  type: 'enabled' | 'disabled';
  effort?: string;
}

/** The two fields as they go on the wire. `reasoning_effort` OMITTED, never null, when unset. */
export interface DeepSeekReasoningWire {
  thinking: { type: string };
  reasoning_effort?: string;
}

export function deepSeekReasoningWire(
  choice: DeepSeekReasoningChoice,
): DeepSeekReasoningWire {
  return choice.effort === undefined
    ? { thinking: { type: choice.type } }
    : { thinking: { type: choice.type }, reasoning_effort: choice.effort };
}
