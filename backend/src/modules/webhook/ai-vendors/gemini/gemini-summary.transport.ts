/**
 * [FEAT-20260813-WRAPAI-W2] GeminiSummaryTransport — the FIRST SummaryTransport,
 * not "the" summary path. Gemini is one registry entry; a second vendor is
 * another. Mirrors `gemini-reply.transport.ts` for the summary seam.
 *
 * ⚠️ This is the ONLY summary file allowed to name Gemini or build its JSON.
 *    The interpreter never does (it only sees rawText).
 *
 * Transcribes, byte-for-byte, the TRANSPORT half of `analyzeConversationForAdmin`
 * (`rag-engine.service.ts:1787-1834`):
 *   · the URL — `/v1/` (NOT `/v1beta/`; matches findRelevantText, unlike askGemini)
 *     with the key on the query string, unencoded (transcribed hazard, preserved)
 *   · the single-part prompt with history/currentQuestion/currentAnswer
 *     interpolated EXACTLY (whitespace is load-bearing — the W2-0 wire snapshot
 *     fails on any drift)
 *   · generationConfig temperature/topP/topK HARDCODED 0.1/0.1/1 — NO hook knob
 *     resolution, NO thinkingConfig, NO 400-retry (all absent from legacy here)
 *   · `axios.post(url, body, GEMINI_HTTP_OPTS)` (the 30s STALL timeout)
 *   · `readGeminiText(res.data) || ''` → rawText (the interpreter parses it)
 *
 * The JSON extraction and the three fallback strings are NOT here — they are the
 * interpreter's job, so DeepSeek does not re-copy them. transport = call only.
 *
 * revert: delete this file + its registry entry. ⚠️ The prompt no longer lives
 * here — it moved to `../../summary-prompt.ts` (shared with DeepSeek), so
 * reverting THIS file alone leaves that one orphaned; see its own revert note; the provider points back at
 *         analyzeConversationForAdmin.
 */

import { Logger } from '@nestjs/common';

/* [FEAT-20260907-AIVENDORCORE] the URL, the body and the reader now come from the
   one door. The axios call, its timeout choice and the result mapping stay here.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
import {
  geminiHttpOpts,
  buildGeminiBody,
  geminiUrl,
  readGeminiText as readVendorText,
  familyModel,
  resolveModelId as resolveVendorModelId,
  vendorFailure,
  dig,
  vendorSuccess,
  postToVendor,
} from '@/modules/ai-vendor';

import type {
  SummaryCall,
  SummaryTransportResult,
} from '../../assist/summary-neutral';
import type { SummaryTransport } from '../../assist/summary-transport';
// [P2-20260813] prompt lives at the neutral layer now — both vendors share it.
import { buildSummaryPrompt } from '../../assist/summary-prompt';

const logger = new Logger('GeminiSummaryTransport');

/**
 * The model id — resolved the SAME place `analyzeConversationForAdmin` reads its
 * module-level `MODEL_ID` (`rag-engine.service.ts:59`), env-only, default
 * `gemini-3.5-flash`. Resolved here (not imported) because that const is
 * deliberately un-exported so the vendor name stays inside its own files — the
 * reply assembler does the identical thing (`resolveModelId`). env-only เหมือนเดิม.
 */
/**
 * [P2-20260813] The hook's model, else this vendor's family default.
 *
 * This used to read `process.env['MODEL_ID']` — a second, independent copy of
 * the assembler's env read, which meant changing one silently diverged from the
 * other. The model is per hook now; the default lives with the vendor that owns
 * it, and it is the same value the env default carried, so a hook with no model
 * hits exactly the model it hits today.
 */
/* [FEAT-20260908-AIVENDORMODELS] The value and the trim-or-fallback rule both
   live in the door now; the NAME is re-exported so nothing that imports it from
   here has to move. Same string, same behaviour. */
export const GEMINI_SUMMARY_FAMILY_MODEL = familyModel('gemini', 'summary');

function resolveModelId(modelId?: string | null): string {
  return resolveVendorModelId(modelId, GEMINI_SUMMARY_FAMILY_MODEL);
}

/** ⚠️ TRANSCRIBED — legacy `a?.b?.c` over unknown (`rag-engine.service.ts:1255`). */
/* [FEAT-20260908-AIVENDORERR] `dig` was declared in seven transports,
   identically. It comes from the door now. */

export class GeminiSummaryTransport implements SummaryTransport {
  async send(call: SummaryCall): Promise<SummaryTransportResult> {
    /* [FEAT-20260907-AIVENDORCORE] The base was `/v1/` here and `/v1beta/` in the
       reply lane — inherited from two different legacy functions, not chosen.
       Proven interchangeable by live fire before this line moved: same body, same
       model, same key, 200/200 plain and 200/200 with `thinkingLevel: minimal`.
       [FEAT-20260908-GEMINIKEYHEADER] The key is no longer in this URL — it rides
       the `x-goog-api-key` header built by `geminiHttpOpts` below. */
    const url = geminiUrl(resolveModelId(call.modelId));
    /* ⚠️ No `systemInstruction` and no `generationExtra` are passed, so neither
       key appears in the JSON — this body stays byte-identical to the one this
       transport built before the door existed. Absence is the contract. */
    const body = buildGeminiBody({
      model: resolveModelId(call.modelId),
      apiKey: call.apiKey ?? '',
      parts: [{ text: buildSummaryPrompt(call) }],
      knobs: { temperature: 0.1, topP: 0.1, topK: 1 },
    });

    try {
      // 30s STALL timeout, plus the key as a header — same value the shared
      // GEMINI_HTTP_OPTS carries; that object is spread, never mutated.
      const res = await postToVendor(
        url,
        body,
        geminiHttpOpts(call.apiKey ?? ''),
      );
      // legacy does `readGeminiText(res.data) || ''`; keep the `|| ''` in the
      // INTERPRETER so an errored call (rawText undefined) stays distinguishable
      // from an empty-but-successful call here.
      /* [FEAT-20260908-AIVENDORERR] the success envelope all six lanes shared. */
      return vendorSuccess(res, readVendorText(res.data));
    } catch (err) {
      // The outer-catch case in legacy (:1865). No fallback TEXT here — the
      // interpreter owns the "เกิดข้อผิดพลาด…" string (domain, not vendor).
      // ⚠️ TRANSCRIBED side-effect (analyzeConversationForAdmin:1866-1868): the
      //    "AI Analysis error" log line. Dropping it was divergence D2 — the
      //    request failure went silent. `stringifyErr` is inlined (it is not
      //    exported): string passthrough else JSON.stringify, same as legacy.
      const errPayload = dig(err, 'response', 'data') ?? dig(err, 'message');
      const errStr =
        typeof errPayload === 'string'
          ? errPayload
          : JSON.stringify(errPayload);
      logger.error(`AI Analysis error: ${errStr}`);

      /* [FEAT-20260908-AIVENDORERR] the mapping all six lanes shared, verbatim. */
      return vendorFailure(err);
    }
  }
}
