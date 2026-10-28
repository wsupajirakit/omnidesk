/**
 * The AI seam.
 *
 * ⚠️⚠️ THE ONE RULE OF THIS FILE: the outbound call to a generative model is the
 * ONLY thing on the far side of `AiReplyProvider.generate`. Request assembly and
 * response interpretation are both on THIS side, so the whole ingest pipeline —
 * prompt building, tag resolution, default-text fallback, flex routing, sending
 * — can be driven end to end in a test with a stubbed provider, without a key
 * ever leaving the process.
 *
 * That is not a testing convenience. `custom_ai_key` bills a real account per
 * token with no ceiling, and this repo is worked by several agents at once. A
 * seam that only *most* of the pipeline sits behind would not be a seam.
 *
 * No provider implementation ships here. `AI_REPLY_PROVIDER` is bound to
 * `UnavailableAiReplyProvider`, which throws. The webhook service treats that
 * throw as "no answer" and takes the same path legacy takes when the model
 * errors — so the pipeline is correct and inert until somebody deliberately
 * binds a real provider.
 */

import type { NeutralReplyCall } from './reply-neutral';

/** DI token — inject with `@Inject(AI_REPLY_PROVIDER)`. */
export const AI_REPLY_PROVIDER = Symbol('AI_REPLY_PROVIDER');

/**
 * Everything the model needs for one turn.
 *
 * Legacy passes these as SEVENTEEN positional parameters
 * (`ragEngineService.askGemini`), and its own comments record the cost: "วางผิด
 * ที่ = ค่าผิดแบบเงียบ ไม่ crash", followed by a note that the tail should have
 * been collapsed into an options object two features ago and was not, because
 * collapsing it would have meant touching every call site at once.
 *
 * There is exactly one call site here, so the debt is not carried across.
 * The FIELDS are the legacy parameters, one for one — only the calling
 * convention changed.
 */
export interface AiReplyRequest {
  /** The customer's message. Legacy `question`. */
  question: string;
  /** Retrieved document context, already variable-substituted. Legacy `docText`. */
  docText: string;
  /** The assembled Training Document. Legacy `suggestionText`. */
  suggestionText: string;
  /**
   * The combined external-API result, or null.
   * ⚠️ Legacy passes `apiErrorTrigger ? null : profileData` — when the profile
   *    fetch failed, the model is given NO data rather than partial data, so it
   *    cannot answer from a half-filled profile.
   */
  profileData: Record<string, unknown> | null;

  /** Generation settings, per hook; undefined means "fall back to env". */
  temperature?: number | null;
  topK?: number | null;
  topP?: number | null;
  /** Per-hook thinking budget; null = unset → env fallback or off. */
  thinkingBudget?: number | null;

  /**
   * [P2-20260813] The hook's AI vendor, e.g. 'gemini' | 'deepseek'.
   * `null`/absent ⇒ the default vendor. The provider hands this to the
   * transport registry, which falls back on anything it does not know, so an
   * unrecognised value can never break a reply.
   */
  aiVendor?: string | null;

  /**
   * [P2-20260813] The model id this OA asks for. `null`/absent ⇒ the chosen
   * vendor's family default, applied by that vendor's transport — the
   * assembler must not guess a default, because the right one depends on the
   * vendor. โมเดล default เป็นของค่ายไหน ค่ายนั้นตัดสิน.
   */
  aiModel?: string | null;

  /** Scoping for dynamic tags. */
  hookId?: string | null;
  hookGroupId?: string | null;

  /** Feed the raw json to the model — opt-in per OA. */
  sendRawJson: boolean;
  /** The admin-written rules that accompany the raw json. */
  rawJsonRules: string;
  /** Auto-inject the site-rules block — separate switch from the raw json. */
  sendSiteRules: boolean;
  /** The admin-written rules that accompany the site-rules block. */
  siteRulesGuide: string;

  /** Which vocabulary this OA speaks: `{ tool, scope }`. */
  dictOpts: { tool: string | null; scope: string | null };

  /**
   * [FIX-20260808-HOOKAIKEY] The per-OA Gemini key to fire this turn — the
   * decrypted `hook.custom_ai_key`, or the env fallback when the OA has none.
   * Legacy resolves this exact value at `webhookController.js:2417`
   * (`safeDecrypt(hook.custom_ai_key) || env`) and threads it into `askGemini`.
   * The real provider fires WITH this key; only when it is absent does it fall
   * back to a shared env key. Optional so the scripted mock — which never fires
   * a model — can ignore it, keeping the mock trivially key-free and safe.
   */
  apiKey?: string | null;

  /* [FEAT-20260830-STABLEPROMPT] set when the stable layout runs — the DEFAULT
     for every OA since the 30/08 flip (hook.ai_stable_prompt !== false).
     historyBlockText = formatHistory(...) already wrapped in
     [start-of-history]…[end-of-history]; timeContextText = the "Today is …
     (Bangkok Time)" line. Both become contents blocks before `question`
     instead of living inside suggestionText, so system_instruction stays
     byte-stable for implicit caching. Optional ⇒ every existing caller and
     spec literal (member-info at webhook.service.ts:3376 included) compiles
     and behaves unchanged. revert: drop both fields + their readers. */
  historyBlockText?: string;
  timeContextText?: string;

  /* [FEAT-20260902-NOWBLOCK] the `[START_OF_NOW]` block — office hours, holiday
     and a finished `status` the model only has to read. Set only when the switch
     is on; `undefined` on every existing caller and every spec literal, so
     buildBlocks emits nothing and the wire bytes are byte-identical to before.
     revert: drop this field + its reader in reply-prompt-assembler.ts. */
  nowBlockText?: string;

  /* [FIX-20261014-DSREASONINGMAIN] The OA's reasoning choice for the main lane
     (`ask-model.step.ts` sets it from the hook's reasoning columns). It always rode on the
     request at run time but was never declared, so `assembleReply` never copied it and
     the main lane sent no `thinking` at all — proven on the wire 14/10 (ft17). Null /
     absent = the OA chose nothing ⇒ nothing is sent, exactly as before.
     revert: drop this field + its copy in reply-prompt-assembler.ts. */
  reasoning?: NeutralReplyCall['reasoning'];
}

/**
 * What the model turn produced. Field names are legacy's, so the handling code
 * below reads the same as the code it was ported from.
 */
export interface AiReplyResponse {
  /** The answer, or null when there is nothing to say. */
  text: string | null;
  /** True when the answer was the fallback rather than grounded content. */
  noData: boolean;
  /** `'found'` | `'not_found'` | null — the dynamic-tag verdict. */
  tagStatus: 'found' | 'not_found' | null;
  error_message?: string | null;
  http_status?: number | null;
  /** The raw provider payload, for the webhook log. */
  response_data?: unknown;
}

export interface AiReplyProvider {
  generate(request: AiReplyRequest): Promise<AiReplyResponse>;
}

/** Thrown when no provider is bound. Caught by the pipeline, never propagated. */
export class AiProviderUnavailableError extends Error {
  constructor() {
    super('no AI reply provider is bound');
    this.name = 'AiProviderUnavailableError';
  }
}

/**
 * The default binding.
 *
 * Deliberately not a Gemini client. Writing one would mean writing code whose
 * only correct behaviour is a billed outbound request that must never be run to
 * check it — so it could not be verified here, and its existence would be a
 * loaded gun in a repo with a hard prohibition on firing it. The seam is the
 * deliverable; the provider is a separate, deliberate act.
 */
export class UnavailableAiReplyProvider implements AiReplyProvider {
  generate(): Promise<AiReplyResponse> {
    return Promise.reject(new AiProviderUnavailableError());
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Response handling — legacy webhookController.js:4257-4314
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tags that must never be answered from stale or missing API data.
 * Legacy:4260-4266.
 */
export const CRITICAL_API_TAGS = [
  'ins_number',
  'ins_due_date',
  'ins_current_amount',
  'Total_terms_remain',
  'total_due_amount',
];

/**
 * The model answered using a critical tag while the profile fetch had failed.
 * Legacy:4267-4269 — the answer is BLOCKED and `missing_api_data_text` is sent
 * instead, because a number quoted from nothing is worse than no number.
 */
export function shouldBlockForApiError(
  apiErrorTrigger: unknown,
  replyTextRaw: string | null | undefined,
): boolean {
  if (!apiErrorTrigger) return false;
  const raw = replyTextRaw ?? '';
  return CRITICAL_API_TAGS.some((tag) => raw.includes(`[[[${tag}]]]`));
}

/**
 * [FIX-20260808-AIGENERROR] True when the model turn failed at the GENERATIVE
 * layer — the request reached (or tried to reach) Gemini and it errored — as
 * opposed to the model answering "not found". Two shapes qualify:
 *   · Gemini returned an HTTP error (401 bad key, 403, 429 quota, 5xx) —
 *     `http_status` is a non-2xx code (rag-engine.service.ts:1719-1730).
 *   · the key was missing so no call was made — the provider throws and the
 *     webhook service maps it to `http_status: 0` WITH an `error_message`
 *     (webhook.service.ts catch). `http_status: 0` alone is not enough — a
 *     successful fast-mode turn has no http_status — so an error_message must
 *     accompany the 0 to count. A normal success is `http_status: 200`,
 *     `error_message: null` and never matches.
 */
export function isGenerativeError(
  response: Pick<AiReplyResponse, 'http_status' | 'error_message'>,
): boolean {
  const status = response.http_status;
  const hasErrMsg = !!response.error_message;
  if (typeof status === 'number' && status >= 400) return true;
  if (status === 0 && hasErrMsg) return true;
  return false;
}

/**
 * Resolve the text to actually use. Legacy:4308-4314.
 *
 * ⚠️ `tagStatus === null && noData` counts as not-found too — a fallback answer
 *    with no tag verdict is still "we did not find it".
 * ⚠️ null out means SKIP REPLYING ENTIRELY, which is different from replying
 *    with an empty string. The hook having no `default_answer_text` is how an
 *    operator chooses silence over a canned line.
 *
 * [FIX-20260808-AIGENERROR] A GENERATIVE error (Gemini 401/429/…, or a missing
 * key) is answered with the OA's `ai_generative_error_text`, NOT the not-found
 * `default_answer_text` — an operator wants "the AI is down" worded differently
 * from "I looked and did not find it". This branch is checked FIRST and is the
 * only new behaviour; the not-found and success paths below are unchanged, so a
 * hook that never sets `ai_generative_error_text` (default null → silence on a
 * generative error) sees no difference on any other path. Seamless by design.
 */
export function resolveReplyText(
  response: Pick<
    AiReplyResponse,
    'text' | 'noData' | 'tagStatus' | 'http_status' | 'error_message'
  >,
  hookDefaultAnswerText: string | null | undefined,
  hookAiGenerativeErrorText?: string | null,
): string | null {
  const { text, noData, tagStatus } = response;
  // Generative error first — a failed model call is neither a real answer nor a
  // grounded "not found", so it must not borrow the not-found line.
  if (isGenerativeError(response)) {
    /* [FEAT-20260823-GENERRFALLBACK] Owner, 23/08, after allingame's 429 spend
     * cap answered customers with SILENCE: "ถ้า gemini error อีก ให้ใช้ค่าจาก
     * fe label 'ข้อความตอบกลับเริ่มต้น (กรณีไม่พบคำตอบ)' … ให้ webhook ใช้ตอน
     * gemini error" — that label IS `hooks.default_answer_text`
     * (i18n th.json:498 → HookAiTab.tsx:964 → hooks.service.ts:1221).
     *
     * The ladder, in order — only the LAST rung changed:
     *   1. ai_generative_error_text   the OA's own "AI is down" line — still
     *                                 wins whenever it is set (FIX-20260808's
     *                                 "AI พัง ≠ หาไม่เจอ" separation stands)
     *   2. default_answer_text        NEW — the not-found line steps in when
     *                                 rung 1 was never written, instead of
     *                                 silence. ผู้ใช้ส่วนใหญ่ "ไม่ตั้ง" เพราะ
     *                                 ไม่รู้ว่ามีช่อง ไม่ใช่เลือกเงียบ
     *   3. null                       both empty = the OA really chose quiet —
     *                                 unchanged, so silence is still choosable
     *
     * Proof: z-test/fixtures/resolver-before-20260823.json holds all 1,920
     * input combinations captured BEFORE this line; the spec
     * reply-gen-error-fallback.spec.ts replays every cell and allows exactly
     * the rung-2 cells to differ. FE mirrors this as hints under both fields
     * (HookAiTab, same tag) — change one side, update the other.
     * revert: delete `hookDefaultAnswerText ||` below, flip the spec back. */
    return hookAiGenerativeErrorText || hookDefaultAnswerText || null;
  }
  if (tagStatus === 'not_found' || (tagStatus === null && noData)) {
    return hookDefaultAnswerText ? hookDefaultAnswerText : null;
  }
  return text;
}
