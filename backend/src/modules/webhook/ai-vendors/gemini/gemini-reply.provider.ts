/**
 * The real Gemini reply provider — RAW, no call cap of its own.
 *
 * This is the inner provider the AI switch wraps (or not) with `AiCapDecorator`:
 *
 *   real + cap on  (dev)   → AiCapDecorator(GeminiReplyProvider)
 *   real + cap off (prod)  → GeminiReplyProvider
 *
 * The cap is a separate layer now (option A, 2026-08-08), so this class does one
 * thing: turn an `AiReplyRequest` into a real model call and map the result. All
 * counting lives in the decorator.
 *
 * ── [FEAT-20260813-WRAPAI-W1D] THE SWITCH ───────────────────────────────────
 * This provider USED to call `ragEngine.askGemini(...17 args)` directly. It now
 * drives the wrapped, vendor-swappable funnel instead:
 *
 *   substituteDynamicTags → assembleReply → resolveReplyTransport().send →
 *   interpretReply
 *
 * Every piece is byte/response-equal to askGemini (proven by the W0 BEFORE pack
 * and the W1a-d specs), so THIS SWITCH CHANGES NO BEHAVIOUR — it only re-routes
 * the same computation through pieces a second vendor (DeepSeek) can slot into
 * (add one transport + one registry line; this provider does not change again).
 * askGemini stays in place, now unused by this path; removing it is a later,
 * separate act. The DB-backed tag step reads through `ragEngine.dyntagDeps`, the
 * exact `dynamicTagModel` + `formatDeps` askGemini itself used — no second
 * injection, no ai/ logic touched.
 *
 * THE KEY — [FIX-20260808-HOOKAIKEY] now the OA's own, matching legacy. The key
 * is resolved HERE (as before) and threaded onto the neutral call as
 * `call.apiKey`; the transport puts it on the query string exactly where
 * askGemini's fourth positional argument used to land. Only a keyless OA falls
 * back to a shared env key (GEMINI_TEST_KEY → GEMINI_API_KEY); with neither we
 * still throw GeminiKeyMissingError BEFORE any funnel step, so a keyless OA
 * never reaches the transport. The scripted mock never fires a model, so it
 * ignores the key entirely — the seam still keeps the key out of the mock path.
 *
 * revert: restore the direct `askGemini(...)` call below (git show the pre-W1d
 *         version) and drop the funnel imports; the reply-* files then have no
 *         prod importer again, exactly as at commit 791089d.
 */

import { Injectable, Logger } from '@nestjs/common';

// eslint-disable-next-line no-restricted-imports
import {
  RagEngineService,
  findUnknownTagMarkers,
  reportTagMismatch,
} from '@/modules/ai/rag-engine.service';

import {
  type AiReplyProvider,
  type AiReplyRequest,
  type AiReplyResponse,
} from '../../ai-reply/ai-reply.provider';
import { describeBlocks } from '../../ai-reply/prompt-log.util';
import { assembleReply } from '../../ai-reply/reply-prompt-assembler';
import { substituteDynamicTags } from '../../ai-reply/reply-dyntag';
import { interpretReply } from '../../ai-reply/reply-interpreter';
import { resolveReplyTransport } from '../../ai-reply/reply-transport.registry';
import { resolveVendorKey } from '../resolve-vendor-key';

/** Thrown when neither a usable key is configured — never silently no-key. */
export class GeminiKeyMissingError extends Error {
  constructor() {
    super(
      'No AI key available for the real provider. GEMINI_TEST_KEY is unset and ' +
        'the per-hook custom_ai_key path is not yet wired. Refusing to call.',
    );
    this.name = 'GeminiKeyMissingError';
  }
}

@Injectable()
export class GeminiReplyProvider implements AiReplyProvider {
  private readonly logger = new Logger(GeminiReplyProvider.name);

  constructor(private readonly ragEngine: RagEngineService) {}

  async generate(request: AiReplyRequest): Promise<AiReplyResponse> {
    // [FIX-20260808-HOOKAIKEY] Fire with the OA's OWN key — the decrypted
    // `hook.custom_ai_key` the webhook service resolved and passed on `request`,
    // matching legacy `webhookController.js:2417`. Only when the OA has no key
    // do we fall back to a shared env key (GEMINI_TEST_KEY, then GEMINI_API_KEY),
    // so a keyless OA still answers instead of throwing. This is the production
    // wiring that was previously stubbed to the env test key.
    /* [P2-20260813] The key now depends on the vendor. `resolveVendorKey`
     * keeps the OA's own key first for every vendor, and only Gemini has a
     * shared env rung to fall back to — DeepSeek has none by rule, so a
     * DeepSeek hook without its own key REFUSES here rather than firing with
     * another vendor's credential. คีย์ค่ายหนึ่งห้ามหลุดไปอีกค่าย. */
    const key = resolveVendorKey(request.apiKey, request.aiVendor);
    if (!key || !key.trim()) throw new GeminiKeyMissingError();

    /* [FIX-20260910-VENDORLOG] the line names the VENDOR THAT WILL ACTUALLY RUN,
       not this class. This provider has served every vendor since the door was
       built — the name is historical — so a DeepSeek hook printed "Gemini
       request" and a live mega test read it as proof of the wrong routing until
       `[P2-DEEPSEEK]` two lines later said otherwise. A log that has to be
       cross-checked against another log is not evidence.
       ⚠️ `?? 'gemini'` because an absent column IS Gemini (the registry default),
          which is what every OA that never chose a vendor has. */
    this.logger.warn(
      `[AI-REAL] ${request.aiVendor ?? 'gemini'} request — hook=${request.hookId ?? '(none)'}`,
    );

    // The resolved key travels on the neutral call, so thread it onto the request
    // the funnel reads. Same value askGemini received as its 4th positional arg.
    const keyedRequest: AiReplyRequest = { ...request, apiKey: key };

    // 1) DYNAMIC TAGS — the one DB-backed step. Reads through the deps the
    //    RagEngineService owns (dynamicTagModel + formatDeps + logSink), so tag
    //    resolution is byte-identical to askGemini's inline block. fastModeOverride
    //    is undefined here (hook decides), matching legacy.
    const { finder, formatDeps, logSink } = this.ragEngine.dyntagDeps;
    const {
      substitutedSuggestion,
      tagsLoaded,
      mismatchedMarkers,
      knownTagNames,
      // [FIX-20260901-TAGESCAPE] the same pass, reusable on the model's answer
      substituteEscapedTags,
    } = await substituteDynamicTags(
      {
        suggestionText: request.suggestionText,
        profileData: request.profileData,
        hookId: request.hookId ?? null,
        hookGroupId: request.hookGroupId ?? null,
        dictOpts: request.dictOpts,
      },
      finder,
      formatDeps,
      logSink, // D2 — write the dynamic_tag_calculation_error row as askGemini did
    );

    // 2) ASSEMBLE — pure. fast-mode 2 returns a ready response (skip); otherwise
    //    a neutral call to transport. Byte-equal to the W0 wire body.
    const assembled = assembleReply({
      request: keyedRequest,
      substitutedSuggestion,
      fastModeOverride: undefined, // hook decides, as in legacy
    });
    if (assembled.kind === 'skip') {
      // ⚠️ TRANSCRIBED (askGemini fast-mode :1570): fast mode skips the AI but
      //    STILL reports the INBOUND scan. No outbound scan — there is no reply.
      reportTagMismatch(
        mismatchedMarkers,
        tagsLoaded,
        request.hookId,
        request.hookGroupId,
        logSink,
      );
      return assembled.response;
    }

    /* [FEAT-20260822-AIPROMPTLOG] per-block sizes of the call that is about to
       fire — `site_rules` length plus `!TRUNC` is the truncation signal that
       previously required patching dist to observe. Log-only and total; the
       existing `[AI-REAL]` line above is untouched (run-full-flow.sh greps it). */
    try {
      // info, not warn: this fires on EVERY call; `!TRUNC` inside it is the
      // signal to grep for, not the line's level. (review 22/08 on merge to dev)
      this.logger.log(
        `[AI-BLOCKS] hook=${request.hookId ?? '(none)'} ${describeBlocks(
          assembled.call.blocks,
        )}`,
      );
    } catch {
      /* log-only — never let diagnostics touch the reply */
    }

    // 3) TRANSPORT — vendor call, chosen per hook. Gemini is the FALLBACK for an
    //    absent or unknown name, not a hard default.
    //    [FIX-20260908-STALECOMMENT] this used to read "the default provider is
    //    Gemini until the master plan's P2 wires per-hook ai_vendor" — it was
    //    already wired on the line below, and the two comments contradicted each
    //    other in the same paragraph.
    /* [P2-20260813] Per-hook vendor. The registry falls back on an absent or
     * unknown name, so a typo in hook.ai_vendor can never break a reply. */
    const transport = resolveReplyTransport(request.aiVendor);
    const transportResult = await transport.send(assembled.call);

    // 4) INTERPRET — shared, vendor-blind. Produces the AiReplyResponse the
    //    pipeline expects, byte/response-equal to askGemini's own mapping.
    const response = interpretReply(transportResult);

    /* ==== [FIX-20260901-TAGESCAPE] the model echoed a tag — substitute it ====
     *
     * THE DEFECT THIS CLOSES. The Training Document teaches the tag syntax by
     * example ("ถูก — ฝากขั้นต่ำอยู่ที่ [[odk_s_00001]] บาทค่ะ"), so a model that is
     * following instructions will sometimes write the TAG instead of the value it
     * was shown. Nothing downstream could rescue that: `resolveReplyTags` sweeps
     * every unrecognised `[[…]]` out of the reply, so the tag was DELETED and the
     * customer read the sentence with the number missing. Measured on the real
     * collection, 01/09 — `ฝากขั้นต่ำ [[odk_s_00001]] บาท` reached a customer as
     * `ฝากขั้นต่ำ ␣ บาท`, with the fetch having SUCCEEDED (801 tags, tagsLoaded=true).
     *
     * `docs/train_docs/spec-ai.md:279` describes this substitution as already
     * existing ("ถูกแทนค่า **หลัง** โมเดลตอบเสร็จ … ทำได้แค่พิมพ์ลงคำตอบให้ระบบแทนค่า").
     * It did not. This is the step the spec assumed was there.
     *
     * ⚠️ COSTS NOTHING EXTRA. `substituteEscapedTags` closes over the rows fetched
     *    at step 1, so there is no second query, no second scope decision, and no
     *    way for the answer to resolve against a different tag set than the
     *    document did.
     *
     * ⚠️ PLACED BEFORE THE OUTBOUND SCAN ON PURPOSE. A tag we just resolved is not
     *    a mismatch and must not be reported as one; what survives this line is a
     *    marker no loaded tag answers to, which is exactly what the scan is for.
     *
     * ⚠️ SUCCESS PATH ONLY, like the scan below it. On the error path the model
     *    produced no reply, and the fallback sentence carries no tags.
     *
     * ⚠️ DOES NOT REPLACE THE CATCH-ALL. Anything still unresolved after this is
     *    stripped later, as before — a marker must never reach a customer either
     *    way. This changes DELETED into SUBSTITUTED wherever a value exists.
     *    ⇒ ป้ายที่หลุดออกมา ต้องอ่านออกและแทนค่าได้ ไม่ใช่โดนลบเงียบ ๆ
     *
     * revert: delete this block. The reply then loses any tag the model echoed,
     * silently, which is the 01/09 production behaviour. */
    if (response.error_message == null && typeof response.text === 'string') {
      response.text = substituteEscapedTags(response.text);
    }

    // 5) TAG-MISMATCH REPORT — the operational side-effect askGemini runs at the
    //    end of BOTH the success and the error path (:1718-1727 / :1746). It never
    //    touches the reply text; it writes the `dynamic_tag_marker_mismatch` log
    //    row so a broken marker in the Training Doc (or one the model copied out
    //    of chat history) is still recorded. Keeping it here — not in the shared
    //    interpreter — matches legacy's placement and keeps the interpreter
    //    vendor-blind and side-effect-free.
    //    ⚠️ OUTBOUND scan runs ONLY on success: askGemini scans `cleanText`
    //       (:1718), which is exactly `response.text` on the success path. On the
    //       error path the model produced no reply, so only the inbound markers
    //       are reported — the same as askGemini's catch block.
    if (response.error_message == null) {
      mismatchedMarkers.push(
        ...findUnknownTagMarkers(response.text ?? '', knownTagNames),
      );
    }
    reportTagMismatch(
      mismatchedMarkers,
      tagsLoaded,
      request.hookId,
      request.hookGroupId,
      logSink,
    );

    return response;
  }
}
