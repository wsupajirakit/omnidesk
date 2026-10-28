/**
 * [FEAT-20260813-WRAPAI-W1] GeminiReplyTransport — the FIRST implementation of
 * `ReplyTransport`, not "the" path. Gemini is an entry in the registry; a second
 * vendor is another entry, nothing more.
 *
 * ⚠️ This is the ONLY file in the reply funnel allowed to name Gemini or build
 *    its JSON. Assembler and interpreter never do (grep-gated).
 *
 * Transcribes, byte-for-byte, the transport half of `askGemini`
 * (`rag-engine.service.ts:1556-1650`):
 *   · the v1beta URL with the key on the query string (unencoded — legacy
 *     parity; a transcribed hazard, preserved)
 *   · `axios.post(url, body, GEMINI_HTTP_OPTS)` (the 30s STALL timeout)
 *   · the thinkingConfig 400-retry: on a 400 whose message mentions "think",
 *     strip `thinkingConfig` and re-fire once
 *   · `readGeminiText` (transcribed — the module does not export it; asked)
 *
 * The neutral → gemini body mapping preserves the exact part order the assembler
 * already produced (blocks are emitted in list order), so the W0 wire snapshot
 * still matches to the byte.
 *
 * revert: delete this file + its registry entry; the provider points back to
 *         askGemini (W1d).
 */

import {
  resolveThinkingConfig,
  type ThinkingConfigOut,
} from './thinking-config';
import { Logger } from '@nestjs/common';

/* [FEAT-20260907-AIVENDORCORE] the one door — URL, body and reader.
   🔴 THE RETRY LADDER BELOW DOES NOT MOVE. Both branches (400-on-"think", which
   DELETES a key and re-fires, and the timeout retry on a SHORTER budget with the
   `[FIX-20260901-AIRETRYLOG]` first-failure log) stay here, because they are this
   lane's contract and no other caller has them. The door owns what was
   duplicated; this file keeps what is its own.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
import {
  geminiHttpOpts,
  buildGeminiBody,
  geminiUrl,
  readGeminiText as readVendorText,
  familyModel,
  vendorFailure,
  dig,
  vendorSuccess,
  postToVendor,
} from '@/modules/ai-vendor';

import type { NeutralReplyCall } from '../../ai-reply/reply-neutral';
import type {
  ReplyTransport,
  TransportResult,
} from '../../ai-reply/reply-transport';

const logger = new Logger('GeminiReplyTransport');

/** ⚠️ TRANSCRIBED — legacy `a?.b?.c` over unknown (`rag-engine.service.ts:1255`). */
/* [FEAT-20260908-AIVENDORERR] `dig` was declared in seven transports,
   identically. It comes from the door now. */

/** The gemini request body — same shape and order askGemini builds. */
interface GeminiBody {
  system_instruction: { parts: { text: string }[] };
  contents: { parts: { text: string }[] }[];
  generationConfig: {
    temperature: number;
    topP: number;
    topK: number;
    /* [HOTFIX-20260826-THINK36] รับได้ทั้งสองแบบ แต่ตัวสร้างใส่มาทีละคีย์เสมอ
       (ส่งพร้อมกัน = 400 · ยิงจริงยืนยันแล้ว) — ดู `thinking-config.ts` */
    thinkingConfig?: ThinkingConfigOut;
  };
}

function toGeminiBody(call: NeutralReplyCall): GeminiBody {
  /* [FEAT-20260907-AIVENDORCORE] assembled by the door now. Two things stay this
     lane's own and are passed IN rather than defaulted there:
       · `systemInstruction` — only this lane sends one. Absent for summary and
         translate, and the door writes no key when it is absent, which is what
         keeps their bodies byte-identical.
       · `generationExtra` — `resolveThinkingConfig` decides, exactly as before.
     [HOTFIX-20260826-THINK36] is untouched: it used to hard-code
     `{ thinkingBudget: call.thinkingBudget ?? 0 }` here, which died with a 400 on
     gemini-3.6-flash while the rescue net below could not fire, because Google's
     error carries no "think". `thinking-config.ts` remains the single decider and
     `thinkingConfig` is still present on every request (askGemini:1624). */
  return buildGeminiBody({
    model: call.modelId ?? GEMINI_FAMILY_MODEL,
    apiKey: call.apiKey ?? '',
    systemInstruction: call.instruction,
    // blocks are already in the load-bearing order the assembler produced
    parts: call.blocks.map((b) => ({ text: b.text })),
    knobs: {
      temperature: call.knobs.temperature,
      topP: call.knobs.topP,
      topK: call.knobs.topK,
    },
    generationExtra: {
      thinkingConfig: resolveThinkingConfig(call.modelId, call.thinkingBudget),
    },
  }) as GeminiBody;
}

/**
 * [P2-20260813] This vendor's family default, applied when the hook chose no
 * model. It lives HERE, not in the assembler: the assembler is vendor-blind, so
 * it cannot know whether null should become a Gemini or a DeepSeek model.
 * The value is the same one the env default carried before the move, so a hook
 * with `ai_model: null` keeps hitting exactly the model it hits today.
 */
/* [FEAT-20260908-AIVENDORMODELS] value from the door; name kept — the URL
   builder, the body builder and a spec all read it from this path. */
export const GEMINI_FAMILY_MODEL = familyModel('gemini', 'reply');

/**
 * [FIX-20260816-WLOGVENDOR] The one place that knows Gemini's URL shape.
 *
 * `send` builds the real request with it, and the audit-log label is built with
 * the SAME function (through the registry) — so a log row can no longer claim a
 * path or a model the transport does not actually use. That drift is exactly
 * what this fix closes: the row used to be hand-written as `/v1/models/` with
 * the ENV model id while the call went to `/v1beta/` with the HOOK's model.
 *
 * `apiKey` is the caller's business: `send` passes the real key, the log passes
 * a masked one. This function never masks and never logs. ตัวสร้าง URL มีที่เดียว
 * ⇒ label กับของจริงหลุดจากกันไม่ได้อีก
 *
 * revert: inline this back into `send` and hand-write the log label again.
 */
export function geminiReplyEndpoint(
  modelId: string | null | undefined,
): string {
  /* [FEAT-20260907-AIVENDORCORE] the base moved to the door; the MODEL DEFAULT
     stays here because it is this lane's choice, not a vendor fact. Keeping this
     function is what preserves the property its own header claims — one URL
     builder, so the log label and the real request cannot drift apart.

     [FEAT-20260908-GEMINIKEYHEADER] The `apiKey` parameter was REMOVED, not left
     unused. The key is no longer part of a Gemini URL, so a builder that still
     accepted one would produce a label that no request matches — and the
     drift-proof property above is the entire reason this function exists.
     Gemini is now exactly like DeepSeek here: the key is a header, so the label
     carries no key at all. Nothing is lost from the audit row — the masked key
     has its own column, `gemini_api_key_mask` (request-credentials.ts:196). */
  return geminiUrl(modelId ?? GEMINI_FAMILY_MODEL);
}

/* ==== [FEAT-20260830-AIRETRY] one more try when the model call TIMES OUT ====
 *
 * WHY
 *   `rag-engine.service.ts:66-69` records why the ceiling is 30s: it was chosen
 *   as "7.6x the worst generate_response ever measured (max 3953ms)". Measured
 *   again on 30/08/2026 the worst is 23,022ms, so the margin is now 1.3x — the
 *   tail grew 5.8x while the ceiling stayed put, and calls fall off the edge.
 *   The rows also show a timeout at 27/08 18:56:29 followed 3 seconds later by
 *   the same question answering in 2,217ms, so a second attempt is worth having.
 *
 *   ⚠️ It is NOT a cure. 3 of the 5 observed timeouts arrived inside one
 *   55-second burst, where the retry fails too. Accepted deliberately.
 *
 * SCOPE — narrow on purpose
 *   · TIMEOUTS ONLY. A 4xx/5xx is a known outcome; repeating it wastes a call
 *     and, on a 429, makes the rate limit worse. Same rule the custom-tool
 *     retry states: "Retries apply to timeouts/network errors only."
 *   · ATTEMPT ONE IS UNTOUCHED — still `GEMINI_HTTP_OPTS` (30s), so no OA gets
 *     slower behaviour than it has today.
 *   · The shared `GEMINI_HTTP_OPTS` is NEVER mutated and never re-keyed: nine
 *     call sites across six subsystems read that exact object (assist summary,
 *     ticket translate, doc retrieval, two room-classification calls), and it is
 *     byte-pinned against the legacy checkout by rag-engine-parity.spec.ts:391.
 *     The second attempt therefore carries its OWN config object.
 *
 * BUDGET: [FEAT-20260908-AITIMEOUT] 45s + 30s = 75s, still inside
 * `REPLY_STALE_MS` (120s, webhook-routing.ts:258) — checked before the numbers
 * were raised, not after. It was 30s + 20s = 50s; both moved together on the
 * owner's decision of 08/09/2026, and the ordering rule is unchanged: the retry
 * budget stays SHORTER than the first attempt, because the second attempt is
 * there to catch a transient stall rather than to double the customer's wait.
 * 30s still clears p99 of the successful calls measured locally (18.1s) with room
 * to spare.
 *
 * revert: delete this block and the `isTimeoutError` branch in `send`.
 * ======================================================================== */
const AI_RETRY_HTTP_OPTS = { timeout: 30000 };

/**
 * The repo's own timeout test, written the same way in two other places
 * (`custom-tool.service.ts:953-955`, `external-api.service.ts:602-606`).
 * Both halves matter: axios does not always set `ECONNABORTED`, and the message
 * is what carries the budget that expired.
 *
 * ⚠️ [FIX-20260901-AIRETRYLOG] The line above used to claim `webhook_logs`
 * receives "timeout of 30000ms exceeded". It does not. That row is built from
 * what `send` RETURNS, so on a double timeout it carries the RETRY's message —
 * "timeout of 20000ms exceeded". Measured over 24h on production: 7 timeout
 * rows, all 20s, zero 30s. A `20000ms` row therefore means Gemini was silent
 * for roughly 50 seconds (30 + 20), not 20.
 */
function isTimeoutError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '');
}

export class GeminiReplyTransport implements ReplyTransport {
  async send(call: NeutralReplyCall): Promise<TransportResult> {
    /* [FEAT-20260908-GEMINIKEYHEADER] The key left the URL. It used to ride the
       query string UNENCODED for legacy parity (askGemini:1556); it now rides the
       x-goog-api-key header, built once here and reused by all three attempts so
       the retry cannot silently drop it. */
    const url = geminiReplyEndpoint(call.modelId);
    const auth = geminiHttpOpts(call.apiKey ?? '');
    const body = toGeminiBody(call);

    try {
      let res;
      /* [FIX-20260901-AIRETRYLOG] Started before the first attempt so the log
         below can say how long that attempt actually burned. */
      const firstStartedAt = Date.now();
      try {
        res = await postToVendor(url, body, auth); // [FIX-20260727-STALL] arg 3
      } catch (thinkErr) {
        // thinkingConfig 400 → re-fire once without it (askGemini:1632-1648)
        const st = dig(thinkErr, 'response', 'status');
        const em = JSON.stringify(
          dig(thinkErr, 'response', 'data') || '',
        ).toLowerCase();
        if (
          st === 400 &&
          body.generationConfig.thinkingConfig &&
          em.includes('think')
        ) {
          logger.warn(
            '[PERF-20260802-THINKBUDGET] endpoint ไม่รับ thinkingConfig → ยิงซ้ำแบบไม่มี (ตอบได้ปกติ)',
          );
          delete body.generationConfig.thinkingConfig;
          res = await postToVendor(url, body, auth);
        } else if (isTimeoutError(thinkErr)) {
          /* [FEAT-20260830-AIRETRY] the SAME body, once more, on its own
             shorter budget. A second timeout is not retried again — it falls
             through to the vendor error path exactly as before, so the error
             contract the interpreter reads is unchanged. */
          /* [FIX-20260901-AIRETRYLOG] Name the FIRST failure out loud.
             It used to be swallowed here: `thinkErr` was neither rethrown nor
             logged, and the row that reaches `webhook_logs` is built from what
             `send` RETURNS — which is the second attempt's error. So a reader
             saw "timeout of 20000ms exceeded" and had no way to tell whether
             one attempt had failed or two. Measured on production over 24h:
             7 timeout rows, all of them the 20s retry, none of them the 30s
             first try — the first attempt had never been recorded at all.

             Log only. The retry, the budgets and the returned error contract
             are untouched.
             revert: delete this logger.warn and `firstStartedAt`. */
          logger.warn(
            `[FEAT-20260830-AIRETRY] Gemini timed out after ${Date.now() - firstStartedAt}ms ` +
              `(${(thinkErr as Error)?.message ?? 'no message'}) — retrying once, and only once`,
          );
          res = await postToVendor(url, body, {
            ...auth,
            ...AI_RETRY_HTTP_OPTS,
          });
        } else {
          throw thinkErr; // any other error → the vendor error path below
        }
      }

      /* [FEAT-20260908-AIVENDORERR] the success envelope all six lanes shared.
         The RETRY LADDER above is untouched — only the envelope moved. */
      return vendorSuccess(res, readVendorText(res.data));
    } catch (err) {
      // Vendor error: surface the status + message; the interpreter maps this to
      // the legacy fallback shape. No fallback TEXT here — that is domain, not
      // vendor, so the interpreter owns it.
      /* [FEAT-20260908-AIVENDORERR] the mapping all six lanes shared, verbatim. */
      return vendorFailure(err);
    }
  }
}
