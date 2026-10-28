import { Inject, Injectable, Logger } from '@nestjs/common';
import { geminiUrl } from '@/modules/ai-vendor';
import type { ConfigType } from '@nestjs/config';
import axios from 'axios';

import { aiConfig } from '@/config/app.config';

/**
 * 🔴 [NOTE-20260908-QRVISIONUNREACHED] THIS SERVICE IS NOT CALLED. READ FIRST.
 * ============================================================================
 * `checkIfSlipWithQrCode` has **zero reachable production callers** as of
 * 08/09/2026. Established by a sweep of `src/` for invocations — not by reading a
 * comment — and an adversarial check tried to refute it and could not.
 *
 * Two separate things would have to be true for it to run, and neither is:
 *   1. a caller. The seam that used to reach it is not live.
 *   2. `hook.qr_prescan_mode` set to something other than `'skip'`. It is
 *      `'skip'` on **every hook** in this database, and on the main dev database
 *      too — checked directly, both.
 *
 * ⚠️ SO IT IS ALSO THE ONE VENDOR CALL THAT BYPASSES THE DOOR. It borrows only
 *    `geminiUrl` and posts its own socket: no `postToVendor`, no
 *    `buildGeminiBody`, no `readGeminiText`, no shared success/failure envelope,
 *    and its own 15s budget instead of the shared ceiling. `send.ts`'s header
 *    claims "every AI request in the system leaves through here" — that claim is
 *    true of the six lane transports and **not** of this file.
 *
 * ⚠️ AND IT IS THE ONLY VISION REQUEST IN THE REPO. It hand-builds a two-part
 *    `contents` array with an `inlineData` base64 image, which no lane transport
 *    can currently produce — so "make it pick a vendor like the others" is not a
 *    small change, and this repo has no evidence either way that DeepSeek accepts
 *    image input at all.
 *
 * ⚠️ OWNER DECISION 08/09/2026: **left as it is, deliberately.** Wiring a dead
 *    lane to a vendor registry would be building for a caller that does not
 *    exist — the same rule that cancelled S4 on 28/08. The note exists so the
 *    next person to grep `geminiUrl` and find this file does not read it as a
 *    lane that was forgotten during the vendor consolidation. It was not
 *    forgotten; it does not run.
 *
 * "Is this image a transfer slip carrying a QR/barcode?" — asked of Gemini
 * Vision.
 *
 * PORTED line for line from
 * `legacy-api/src/services/core-bot/qrVisionService.js` (70 lines, one
 * function). Nothing here is redesigned; the odd parts below are legacy's.
 *
 * ── ⚠️ THIS FILE BILLS A REAL ACCOUNT ───────────────────────────────────────
 * `checkIfSlipWithQrCode` POSTs to `…:generateContent`. The owner's prohibition
 * on generative-AI calls is absolute and has been restated repeatedly: the key
 * bills per token with no ceiling. So this was ported and NEVER executed
 * against the real endpoint — not once, in development or in test.
 *
 * Every test against it (`z-test/unit/qr-vision.spec.ts`) replaces `axios.get`,
 * `axios.post` AND `globalThis.fetch` file-wide with implementations that
 * REJECT, so an outbound call a case did not explicitly stub fails loudly
 * instead of leaving the process. `jest.config.ts`'s `setupFiles` installs a
 * second, independent layer (`z-test/lib/no-ai-outbound.ts`) that throws on any
 * fetch to a provider host. Neither layer is defeated anywhere.
 *
 * The one branch that reaches this service in production and does NOT call it
 * is Swiftcheck answering `SLIP_NOT_FOUND` (legacy:3623-3627): a 404 already means
 * Swiftcheck saw a QR it could not verify, so the caller short-circuits
 * `isQrCodeSlip` to `true` without asking Gemini. That branch is free to
 * exercise and is covered, because it is the one that proves the call is not
 * made.
 *
 * ── WIRED ────────────────────────────────────────────────────────────────────
 * Registered on `SlipModule` and injected into `WebhookService`
 * (webhook.service.ts:348, [FIX-20260808-SLIPFLOW]), which drives the two call
 * sites (legacy:3626 normal image path, legacy:3132 assist-skip path).
 */

/**
 * Legacy's literal fallback, `qrVisionService.js:5`
 * (`process.env.MODEL_ID || "gemini-2.5-flash"`).
 *
 * ⚠️ KNOWN CONFIG DIVERGENCE, not introduced here: this repo's `env.schema.ts`
 * gives `MODEL_ID` a *different* default (`gemini-3.5-flash`), so with the
 * variable unset the two backends would ask two different models. The fallback
 * below only applies when `aiConfig.modelId` is itself empty. Left as found —
 * changing either default is a config decision, not a transcription one.
 */
const DEFAULT_MODEL_ID = 'gemini-2.5-flash';

/** legacy:29 — verbatim, including the "Answer only YES or NO." instruction. */
const PROMPT =
  'Is this image a money transfer slip containing a QR Code or Barcode? Answer only YES or NO.';

/** legacy:19 — the fallback when the download reports no content-type. */
const DEFAULT_MIME_TYPE = 'image/jpeg';

/**
 * [FIX-20260809-QRTIMEOUT] Budget for BOTH outbound calls in this file.
 *
 * ⚠️ THIS IS A DELIBERATE BREAK FROM LEGACY PARITY, not a missed detail. The
 * previous comments here recorded that legacy sets no timeout and that the
 * omission was preserved on purpose. It is now set, because "no timeout" on an
 * axios call means waiting FOREVER on a dead socket: the webhook task stays
 * alive, holding its slot, for as long as the upstream hangs. This is the only
 * genuinely unbounded outbound path left in the service.
 * ยอมเลิก parity ตรงนี้ เพราะ socket ค้าง = งาน webhook ค้างไปด้วยไม่มีวันจบ.
 *
 * ⚠️ WHAT CHANGES FOR CALLERS: a Gemini/image request slower than this now
 * FAILS instead of eventually succeeding. `checkIfSlipWithQrCode` already
 * catches everything and returns `false` on error, so a timeout degrades to
 * "not a QR slip" — the same answer it gives for any other failure. No new
 * error path reaches the webhook.
 *
 * 15s matches LINE_HTTP_TIMEOUT_MS in line-api.service.ts, so every outbound
 * call on the webhook path shares one budget rather than each picking its own.
 * HOW TO CHANGE: one number, here — it covers the image download and the
 * Gemini call alike.
 */
const QR_HTTP_TIMEOUT_MS = 15_000;

@Injectable()
export class QrVisionService {
  private readonly logger = new Logger(QrVisionService.name);

  constructor(
    @Inject(aiConfig.KEY)
    private readonly ai: ConfigType<typeof aiConfig>,
  ) {}

  /**
   * Downloads the image, base64s it, and asks Gemini Vision whether it is a
   * slip with a QR/barcode.
   *
   * @param imageUrl  Public URL of the image. Falsy → `false`, no request.
   * @param geminiKey Key override. Defaults to the configured key, exactly as
   *                  legacy's default parameter does (`= GEMINI_API_KEY`).
   * @returns `true` only when the model's text contains YES or TRUE.
   *
   * ── WHY EVERY FAILURE IS `false` AND NOT A THROW (legacy:61-65) ────────────
   * A download failure, a non-2xx from Gemini, a malformed body and a missing
   * url are all indistinguishable to the caller. That is deliberate: `false`
   * means "fall through to standard `image_answer_text` handling", so a broken
   * vision call degrades to the ordinary reply path rather than dropping the
   * customer's message. Do not widen the return type to carry a reason without
   * changing both call sites in the same diff.
   */
  async checkIfSlipWithQrCode(
    imageUrl: string | null | undefined,
    geminiKey: string | undefined = this.ai.geminiApiKey,
  ): Promise<boolean> {
    try {
      if (!imageUrl) return false;

      // 1. Download image and convert to base64.
      //
      // [FIX-20260809-QRTIMEOUT] A timeout is now set — see QR_HTTP_TIMEOUT_MS
      // for why this deliberately breaks legacy parity here.
      const response = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer',
        timeout: QR_HTTP_TIMEOUT_MS,
      });
      const mimeType =
        (response.headers as Record<string, string | undefined>)[
          'content-type'
        ] || DEFAULT_MIME_TYPE;
      // legacy:20 — `Buffer.from(response.data, "binary")`. The encoding
      // argument is ignored for a non-string input, which is what an
      // arraybuffer response is, so this is a plain byte copy in both.
      const base64Data = Buffer.from(response.data).toString('base64');

      // 2. Prepare Gemini Vision request payload.
      //
      // ⚠️ The key travels in the query string, unencoded — legacy:23. Kept
      // verbatim so the request byte-matches; encoding it would be a change to
      // what goes on the wire, and this file is not the place to make one.
      const modelId = this.ai.modelId || DEFAULT_MODEL_ID;
      /* [FEAT-20260908-AIVENDORHOSTS] The URL comes from the door. This is a
         BYTE-IDENTICAL swap: this lane already ran on `v1beta`, already used
         `:generateContent`, and already put the key on the query string
         UNENCODED — exactly what `geminiUrl` builds. Nothing about the request
         changes; the literal simply stops being one more place that decides
         where Gemini lives.
         ⚠️ `DEFAULT_MODEL_ID` (gemini-2.5-flash) stays HERE. It is a capability
         pin — that model rejects a thinking config — and it is this lane's
         choice, not a vendor fact. `ai-vendor/models.ts` records the capability;
         moving the pin itself is a separate decision.
         ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
      /* [FEAT-20260908-GEMINIKEYHEADER] key moved out of the URL into the
         x-goog-api-key header — see the axios options below. */
      const url = geminiUrl(modelId);
      const payload = {
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inlineData: { mimeType: mimeType, data: base64Data } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1, // Low temperature for factual binary answers
          topK: 1,
          topP: 0.1,
        },
      };

      // 3. Request logic.
      //
      // Legacy sends no headers (legacy:48) — preserved.
      // [FIX-20260809-QRTIMEOUT] The timeout is NOT preserved; see the constant.
      /* [FEAT-20260908-GEMINIKEYHEADER] ⚠️ This lane keeps its OWN timeout — it
         does NOT adopt `geminiHttpOpts`, whose 30s would silently undo
         QR_HTTP_TIMEOUT_MS. Only the header is taken. */
      const aiRes = await axios.post<GeminiVisionResponse>(url, payload, {
        timeout: QR_HTTP_TIMEOUT_MS,
        headers: { 'x-goog-api-key': geminiKey ?? '' },
      });
      const textOutput =
        aiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      this.logger.log(
        `[qrVisionService] Analyzed ${imageUrl}. Output: "${textOutput.trim()}"`,
      );

      // 4. Parse the output (YES/NO boolean mapping).
      //
      // `includes`, not equality — legacy:55. "YES, it is" passes; so does
      // "NO, this is not a YES case", which is a real false positive legacy
      // lives with. Transcribed, not corrected.
      const normalizedOutput = textOutput.trim().toUpperCase();
      if (
        normalizedOutput.includes('YES') ||
        normalizedOutput.includes('TRUE')
      ) {
        return true;
      }

      return false;
    } catch (err) {
      // legacy:62 uses `||`, not `??` — a falsy `response.data` (empty string,
      // `null`) falls through to the message there, and must here too.
      const detail =
        (err as { response?: { data?: unknown } })?.response?.data ||
        (err as Error)?.message;
      this.logger.error(
        `[qrVisionService] Error calling Gemini API: ${
          typeof detail === 'string' ? detail : JSON.stringify(detail)
        }`,
      );
      // If it fails, default to false to let standard image_answer_text
      // handling take over.
      return false;
    }
  }
}

/** Only the path legacy actually reads off the Gemini response. */
interface GeminiVisionResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}
