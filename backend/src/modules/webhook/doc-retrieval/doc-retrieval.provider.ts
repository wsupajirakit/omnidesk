/**
 * 🟢 [FEAT-20261026-RAGENGINE] BOUND SINCE 26/10/2026 — TO THE RAG ENGINE (`@/modules/rag`).
 * ============================================================================
 * `webhook.module.ts` now has the one line this seam was missing:
 *   { provide: DOC_RETRIEVAL_PROVIDER, useExisting: RagRetrievalService }
 * Per hook nothing changes unless `doc_retrieval === true`. The engine retrieves from the
 * Training Doc boxes (no `doc_id` needed), answers `retrieve()` with `add`-mode passages and the
 * optional `retrieveContext()` with a `replace`-mode override. Delete that line and every hook
 * gets empty context again — the `@Optional()` injection falls back to `NoDocRetrievalProvider`.
 *
 * HISTORY (kept so the next reader knows why the old adapter is gone): until 26/10 the token was
 * bound in no module (`[NOTE-20260908-DOCRETRIEVALUNBOUND]`, established 08/09 against `src/` and
 * `dist/`), so the old `RagDocRetrievalProvider` → `findRelevantText` lane never ran in
 * production. Both were removed with the overhaul; recover them from tag
 * `ckpt-before-rag-engine-demo-26102026`. `rag-engine-wiring.spec.ts` now asserts the binding.
 * ผูกแล้วตั้งแต่ 26/10 กับ engine ใหม่ · ถอดบรรทัดผูก = กลับเป็นแบบเดิม
 *
 * ==== [FEAT-20260810-DOCRETRIEVAL] the Training-Document retrieval seam ====
 *
 * The same rule as `ai-reply.provider.ts`, for the same reason: the outbound
 * generative call that retrieval MAY make sits behind
 * `DocRetrievalProvider.retrieve`, and nothing else does. The webhook decides
 * WHETHER to retrieve; it never learns HOW, and it never learns which vendor
 * answered.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `webhook.service.ts` reaches the model with `docText: ''` for every OA, even
 * one that has a `doc_id` — retrieval was ported into `src/modules/ai/` but
 * never wired into the reply path. This seam is that wiring, kept behind a
 * per-hook flag so the switch is a decision, not a deployment.
 *
 * ── SEAMLESS IS THE CONTRACT ───────────────────────────────────────────────
 * `hook.doc_retrieval` defaults to false and a hook that has never seen the
 * field reads as false, so the DEFAULT PATH IS EXACTLY TODAY'S: no retrieval,
 * `docText: ''`, no extra model call, no extra spend. Turning the flag on is the
 * only thing that changes behaviour, and turning it back off restores the old
 * behaviour with no deploy. ค่าเริ่มต้น = ไม่ใช้ retrieval เหมือนเดิมเป๊ะ.
 *
 * ── FALLBACK IS ALSO THE CONTRACT ──────────────────────────────────────────
 * Retrieval is an ENHANCEMENT, never a dependency. Every failure — no provider
 * bound, no doc id, a throw, a timeout, a rejected key — resolves to `''`, which
 * is precisely the value the pipeline uses today. A customer must never lose an
 * answer because a document lookup failed; they simply get the answer the OA
 * would have given before this feature existed. เส้นนี้พังได้ ลูกค้าต้องยังได้คำตอบ.
 *
 * revert: unbind `DOC_RETRIEVAL_PROVIDER` (one line in `webhook.module.ts`) — every hook then
 * gets empty context, exactly the pre-26/10 behaviour.
 */

/** DI token — inject with `@Inject(DOC_RETRIEVAL_PROVIDER)`. */
export const DOC_RETRIEVAL_PROVIDER = Symbol('DOC_RETRIEVAL_PROVIDER');

/**
 * The input wrapper. Named after the domain, not after any vendor or engine signature — any
 * adapter satisfies it without adopting a positional argument list.
 */
export interface DocRetrievalRequest {
  /** The customer's message. Legacy `question`. */
  question: string;
  /** The OA's Training Document id. Empty/absent ⇒ nothing to retrieve. */
  docId: string | null | undefined;
  /** `hook.fast_mode` — mode 2 retrieves locally only, with no model call. */
  fastMode?: unknown;
  /** The OA's own key, already decrypted. Absent ⇒ the adapter's own fallback. */
  apiKey?: string | null;
  /** Model knobs, passed through unchanged. */
  temperature?: unknown;
  topK?: unknown;
  topP?: unknown;
  /**
   * [FEAT-20260826-DOCMODEL] `hook.ai_model` — the model this OA chose.
   *
   * Absent/null/empty ⇒ the adapter falls back to the system-wide `MODEL_ID`,
   * which is what every OA gets today, so a hook that never set one sees no
   * change at all. It sits next to the knobs above because it travels the same
   * way: the webhook reads it off the hook and passes it through unjudged.
   *
   * ⚠️ NOT the same default as the reply path. There, a null model resolves to
   *    the vendor's family constant (`GEMINI_FAMILY_MODEL`); here it resolves to
   *    the env value this seam has always used. Two defaults on purpose — the
   *    reply path is vendor-aware, this seam is not.
   */
  modelId?: string | null;
  /*
   * [FEAT-20261026-RAGENGINE] Additive, optional — what the RAG engine (`@/modules/rag`) needs.
   * An adapter that ignores them is unaffected; a hook with the flag off never builds them.
   *   hookId   — the engine keys its index and vector cache per hook
   *   hook     — the engine reads its own per-hook settings (`rag_prompt_mode`, `rag_search_mode`)
   *   sections — the Training Doc boxes (`buildSuggestionSections`), the text it retrieves from
   */
  hookId?: string | null;
  hook?: Record<string, unknown> | null;
  sections?: readonly { start: string; end: string; text: string }[];
}

/**
 * [FEAT-20261026-RAGENGINE] The richer answer — `docText` for the `Document:` block (`add`
 * mode) and/or a reduced Training Doc that stands in for the full one (`replace` mode).
 * Both empty/null ⇒ the prompt is exactly what it is without retrieval.
 */
export interface DocContext {
  docText: string;
  suggestionOverride?: string | null;
}

/**
 * The output wrapper: the passage to hand the model, or `''`.
 *
 * ⚠️ A STRING, not an object with an error field, and deliberately so. Every
 * caller wants the same thing on every failure — the empty string — so widening
 * this would invite a branch at the call site for a case that has exactly one
 * correct handling. `''` already means "answer without document context", which
 * is what the majority of OAs do today.
 */
export interface DocRetrievalProvider {
  retrieve(request: DocRetrievalRequest): Promise<string>;
  /**
   * [FEAT-20261026-RAGENGINE] Optional. Present ⇒ the caller uses it and can receive a
   * `suggestionOverride`; absent ⇒ `retrieve()` exactly as before (its string is the docText).
   */
  retrieveContext?(request: DocRetrievalRequest): Promise<DocContext>;
}

/**
 * The inert binding — used when the feature is not wired for an environment.
 *
 * It resolves `''` rather than rejecting: an unbound retrieval provider is not
 * an error condition, it is the state every OA is in today. Compare
 * `UnavailableAssistSummaryProvider`, which DOES reject because a missing
 * summary is a degraded hand-off an operator should hear about; a missing
 * document passage is not.
 */
export class NoDocRetrievalProvider implements DocRetrievalProvider {
  retrieve(): Promise<string> {
    return Promise.resolve('');
  }
}

/**
 * Shared inert instance — stateless, so one is enough for every unbound case.
 * [FEAT-20261026-RAGENGINE] moved here from `webhook.service.ts` together with the function
 * below: the spine may not grow (`code-line-census.spec.ts` ratchet, owner order 03/09).
 */
export const NO_DOC_RETRIEVAL: DocRetrievalProvider =
  new NoDocRetrievalProvider();

/**
 * [FEAT-20261026-RAGENGINE] The ladder's ONE retrieval call. The richer `retrieveContext` when
 * the bound provider has it (the RAG engine does), else `retrieve()` exactly as before — so a
 * provider written against the original seam keeps working unchanged. `fetchDocContext`
 * normalises both answers.
 */
export function retrieveDocContext(
  provider: DocRetrievalProvider,
  request: DocRetrievalRequest,
): Promise<string | DocContext> {
  return provider.retrieveContext
    ? provider.retrieveContext(request)
    : provider.retrieve(request);
}
