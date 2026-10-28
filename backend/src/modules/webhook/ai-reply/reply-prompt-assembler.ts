/**
 * [FEAT-20260813-WRAPAI-W1] ReplyPromptAssembler — our side of the reply funnel.
 *
 * Turns an `AiReplyRequest` into either a `NeutralReplyCall` (hand to a
 * transport) or a `skip` verdict (fast-mode 2 — no model call at all). It owns
 * everything that is DOMAIN, not vendor:
 *   · fast-mode verdict          (imports resolveFastMode)
 *   · knob + thinking resolution (transcribes parse*Loose verbatim; imports
 *                                 resolveThinkingBudget)
 *   · instruction + block order  (delegates to reply-blocks.ts)
 *
 * ⚠️ ZERO BEHAVIOUR CHANGE. Every quirk of the resolution — the `?? process.env`
 *    middle layer, the `Number.isFinite` fallbacks (0.0 / 0.1 / 1), the loose
 *    parsers — is copied from `askGemini` (`rag-engine.service.ts:1363-1372`)
 *    exactly. Removing any of them is a later phase's job (K/M/T of the main
 *    plan), never W's. The W0 wire snapshots fail on any drift.
 *
 * ⚠️ DYNAMIC TAGS are substituted BEFORE this, and the substituted suggestion is
 *    passed in. That substitution is a DB read; keeping it out of this pure
 *    assembler is the "inject the dyntag step" decision (plan §W1a). The step is
 *    supplied by the caller (W1d) so this file stays testable without a model,
 *    a DB, or a key.
 *
 * revert: delete this file; nothing imports it until W1d points the provider here.
 */
import {
  resolveFastMode,
  resolveThinkingBudget,
  FALLBACK_TEXT,
} from '@/modules/ai/rag-engine.service';

import type { AiReplyRequest, AiReplyResponse } from './ai-reply.provider';
import { buildBlocks, buildInstruction } from './reply-blocks';
import type { AssembledReply, NeutralKnobs } from './reply-neutral';

/**
 * ⚠️ TRANSCRIBED verbatim from `rag-engine.service.ts:1266-1273`. These are
 *    thin wrappers whose only job is to type the loose coercion legacy relied
 *    on. `Number.parseFloat(undefined as string)` is `NaN`, which the
 *    `Number.isFinite` guard below then turns into the default — that NaN path
 *    is load-bearing and must be preserved.
 */
function parseFloatLoose(v: unknown): number {
  return Number.parseFloat(v as string);
}
function parseIntLoose(v: unknown): number {
  return Number.parseInt(v as string, 10);
}

/**
 * Resolve the three knobs exactly as `askGemini` does (`:1363-1372`).
 *
 * ⚠️ TWO LAYERS — the per-hook value is the PRIMARY source, env is only its
 *    fallback (verified 2026-08-13):
 *      layer 1 (hook)  webhook.service.ts:968-970 reads `hook.gemini_temperature`
 *                      / `gemini_top_k` / `gemini_top_p` and threads them onto the
 *                      request as `temperature`/`topK`/`topP`.
 *      layer 2 (env)   here: `request.<knob> ?? process.env['GEMINI_*']` — env is
 *                      consulted ONLY when the hook did not set the knob.
 *      layer 3 (const) a hard default when neither is finite (0.0 / 0.1 / 1).
 *    So on a real OA these come from the DB, not the environment. The `??` (not
 *    `||`) matters — a legitimate hook value of 0 must survive.
 *    (Model id is the exception: it is env-only, `MODEL_ID`, no hook override —
 *    see resolveModelId below.)
 */
function resolveKnobs(request: AiReplyRequest): NeutralKnobs {
  // request.<knob> is the hook value (layer 1); env is the fallback (layer 2)
  const t = parseFloatLoose(
    request.temperature ?? process.env['GEMINI_TEMPERATURE'],
  );
  const p = parseFloatLoose(request.topP ?? process.env['GEMINI_TOP_P']);
  const k = parseIntLoose(request.topK ?? process.env['GEMINI_TOP_K']);
  return {
    temperature: Number.isFinite(t) ? t : 0.0,
    topP: Number.isFinite(p) ? p : 0.1,
    topK: Number.isFinite(k) ? k : 1,
  };
}

/**
 * [P2-20260813] The model id is now PER HOOK, and the assembler deliberately
 * does not pick a default.
 *
 * It used to read `process.env['MODEL_ID']` here — the last AI setting a hook
 * could not override. The owner's rule is that every value shaping an answer
 * comes from the hook, so the value is threaded in instead, and `null` is
 * passed through untouched: the RIGHT default depends on the vendor
 * (`gemini-3.5-flash` vs `deepseek-chat`), and this file is vendor-blind by
 * design. Each transport applies its own family constant when it sees null.
 * assembler ไม่รู้จักค่าย จึงห้ามเดา default ของค่ายไหน.
 */
function resolveModelId(request: AiReplyRequest): string | null {
  return request.aiModel ?? null;
}

export interface AssembleInput {
  request: AiReplyRequest;
  /**
   * The training-document text with dynamic tags ALREADY substituted. The caller
   * (W1d) runs the DB-backed substitution; the assembler stays pure.
   * Falls back to the raw suggestion when the caller does not substitute.
   */
  substitutedSuggestion: string;
  /**
   * The fast-mode override to honour, matching `askGemini`'s 3rd argument. The
   * production provider passes `undefined` here (env/boot decides). Kept
   * explicit so a test can drive the skip branch — see [FAST-MODE-PAIR] in
   * webhook.service.ts for why prod is effectively always full mode.
   */
  fastModeOverride?: unknown;
}

/**
 * Decide what to do with one reply request.
 *
 * Pure and synchronous: no I/O, no model, no vendor word. Returns `skip` with a
 * ready `AiReplyResponse` for fast-mode 2, otherwise `call` with the neutral
 * call to be transported then interpreted.
 */
export function assembleReply(input: AssembleInput): AssembledReply {
  const { request, substitutedSuggestion, fastModeOverride } = input;

  // ── fast-mode 2 — no AI, byte-identical to askGemini:1538-1552 ─────────────
  if (resolveFastMode(fastModeOverride) === 2) {
    const noData = !request.docText || !request.docText.trim();
    // ⚠️ NO `tagStatus` key in legacy's fast-mode return. The provider maps the
    //    absence to null; here we produce the already-mapped AiReplyResponse so
    //    the caller returns it verbatim. text = docText unless empty.
    const response: AiReplyResponse = {
      text: noData ? FALLBACK_TEXT : request.docText,
      noData,
      tagStatus: null,
      http_status: null,
      error_message: null,
      response_data: undefined,
    };
    return { kind: 'skip', response };
  }

  // ── full mode — build the neutral call ─────────────────────────────────────
  const instruction = buildInstruction(substitutedSuggestion);
  const blocks = buildBlocks({
    question: request.question,
    docText: request.docText,
    substitutedSuggestion,
    profileData: request.profileData,
    sendRawJson: request.sendRawJson,
    rawJsonRules: request.rawJsonRules,
    sendSiteRules: request.sendSiteRules,
    siteRulesGuide: request.siteRulesGuide,
    // [FEAT-20260830-STABLEPROMPT] absent on the default path → no new blocks.
    historyBlockText: request.historyBlockText,
    timeContextText: request.timeContextText,
    // [FEAT-20260902-NOWBLOCK] absent unless the switch is on → no new block.
    nowBlockText: request.nowBlockText,
  });

  return {
    kind: 'call',
    call: {
      instruction,
      blocks,
      knobs: resolveKnobs(request),
      thinkingBudget: resolveThinkingBudget(request.thinkingBudget),
      apiKey: request.apiKey ?? null,
      modelId: resolveModelId(request),
      /* [FIX-20261014-DSREASONINGMAIN] the OA's reasoning choice — copied only when set,
         so an OA that chose nothing gets the same call (and the same wire body) as
         before. Before this line it was never copied at all (ft17). revert: delete it. */
      ...(request.reasoning ? { reasoning: request.reasoning } : {}),
    },
  };
}
