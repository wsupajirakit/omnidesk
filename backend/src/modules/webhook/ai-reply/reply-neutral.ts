/**
 * [FEAT-20260813-WRAPAI-W1] Neutral reply types — vendor-free by construction.
 *
 * Phase W1 of `todo/task/wrap-ai-design.md`. These are the ONLY shapes that
 * cross between the assembler (our side) and a transport (a vendor's side). No
 * Gemini or DeepSeek structure appears here: a block is `{ kind, text }`, order
 * lives in the array, and the moment a block carried a vendor object every
 * adapter would have to understand that vendor — the leak this file exists to
 * prevent.
 *
 * Not wired into any prod path yet (W1d does the switch). Building beside.
 */
import type { AiReplyResponse } from './ai-reply.provider';

/**
 * One ordered piece of context handed to the model.
 *
 * `kind` is documentation for a human and a stable key for a transport to log
 * or reorder-check against; the transport serialises by ARRAY ORDER, never by
 * kind. `text` is already fully built (dynamic tags substituted, block wrappers
 * applied) — a transport never re-derives it.
 */
export interface NeutralBlock {
  kind:
    | 'raw_json'
    | 'raw_json_rules'
    | 'site_rules'
    | 'site_rules_guide'
    | 'document'
    /* [FEAT-20260830-STABLEPROMPT] chat history / "Today is …" moved out of
       the instruction text so it stays byte-stable for implicit
       caching. Emitted on the stable layout — the DEFAULT since the 30/08
       flip (absent reads ON; an explicit hook.ai_stable_prompt === false is
       the per-OA opt-out that restores the old wire bytes exactly).
       Transports serialise by array order and never read kind, so widening
       this union is the whole vendor-side change.
       revert: drop these two members + the buildBlocks pushes. */
    | 'history'
    | 'today'
    /* [FEAT-20260902-NOWBLOCK] the office-hours / holiday decision, computed in
       code instead of left to the model. Emitted only when `now-block`'s switch
       (`resolveNowBlockMode`: env `AI_NOW_BLOCK` since 18/10, else the `'off'` const)
       is on; absent by default, so the block list and the wire bytes are unchanged.
       revert: drop this member + the buildBlocks push. */
    | 'now'
    | 'question';
  text: string;
}

/** Generation knobs, already resolved to numbers or left null for the vendor default. */
export interface NeutralKnobs {
  temperature: number;
  topP: number;
  topK: number;
}

/**
 * A vendor-free description of one model turn. A transport translates this into
 * its own JSON both ways; nothing here knows how.
 */
export interface NeutralReplyCall {
  /** The system instruction — training doc + the tag-protocol lines, already joined. */
  instruction: string;
  /** Context blocks in the exact order the model must read them. */
  blocks: NeutralBlock[];
  knobs: NeutralKnobs;
  /** null/absent → the transport omits it or uses its own default. */
  thinkingBudget: number | null;
  /** The per-OA key to fire with (or the env fallback the caller already resolved). */
  apiKey: string | null;
  /**
   * The model to hit; the transport places it wherever its API wants it.
   *
   * [P2-20260813] `null` means "this hook did not choose one" — the transport
   * then applies ITS OWN vendor family default. The assembler cannot pick that
   * default because it does not know which vendor will receive the call.
   */
  modelId: string | null;
  /**
   * [FEAT-20260909-DSREASONING] The OA's reasoning choice for the MAIN lane
   * (this reply path, and the assist summary, which the owner ruled shares it).
   *
   * 🔴 NO VENDOR IS NAMED HERE, AND A SPEC ENFORCES THAT — it reads this file
   *    and fails if a vendor appears in it. The first draft called this field
   *    after the vendor that reads it today and went red immediately, which is
   *    the guard doing its job: a neutral call describes a CAPABILITY, and the
   *    transport that has no equivalent simply does not read the field, exactly
   *    as one of them already ignores `topK`.
   *
   * 🔴 ABSENT/NULL MEANS ABSENT. Every hook that predates the columns resolves
   *    to null and its transport then attaches nothing, so the request body is
   *    the object it was before this field existed. `thinkingBudget` above is a
   *    different vendor's different concept and is untouched, on the path it has
   *    always taken.
   */
  reasoning?: {
    type: 'enabled' | 'disabled';
    effort?: 'low' | 'high' | 'max';
  } | null;
}

/**
 * The assembler's verdict for one request.
 *
 *   'skip' — no model call at all (fast-mode 2). The `response` is already the
 *            final `AiReplyResponse`, so the caller returns it verbatim.
 *   'call' — hand `call` to the transport, then the interpreter.
 */
export type AssembledReply =
  | { kind: 'skip'; response: AiReplyResponse }
  | { kind: 'call'; call: NeutralReplyCall };
