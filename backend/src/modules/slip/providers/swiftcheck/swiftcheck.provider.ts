/**
 * ==== [FEAT-20260902-SLIPPROVIDER] Swiftcheck — the current provider, MOVED =====
 *
 * ⚠️ THIS IS A MOVE, NOT A REWRITE. Every value below was lifted from the inline
 * call in `slip-flow.service.ts` unchanged: the same path, the same two headers
 * in the same order, the same body keys, the same 30s budget. If any of it is
 * "tidied", it stops being a refactor of the money path and becomes a change to
 * it. `z-test/unit/slip-outbound-baseline.spec.ts` holds the bytes and will say
 * so — that golden was recorded BEFORE this file existed, for this reason.
 *
 * SHAPE: a plain object, no Nest, importing nothing from the app. That is the
 * discipline `webhook/qr-prescan/qr-reader.adapter.ts` already applies to the QR
 * library ("Nothing library-specific may leak"), and it is what lets a spec use
 * the real thing without a container.
 *
 * NOT a Nest provider bound by Symbol token. The repo does use that shape for
 * swappable vendors (`AI_REPLY_PROVIDER`, `DOC_RETRIEVAL_PROVIDER`), but those
 * pick ONCE AT BOOT from env. A slip provider is chosen per hook — the key and
 * base URL already arrive per call — so a container binding would fix the wrong
 * lifetime.
 *
 * revert: delete `providers/` and inline `buildRequest`'s body back at the call
 * site. The two baseline specs prove the revert is exact.
 */
import axios from 'axios';

import type {
  SlipProvider,
  SlipVerifyInput,
  SlipVerifyRequest,
  SlipVerifyResponse,
} from '../slip-provider.port';

/**
 * legacy:2846 — the verify call's own timeout, distinct from the callback's.
 * Owned here because it is a property of THIS provider, not of the flow: a
 * second vendor has its own budget. Value unchanged from the inline call.
 */
export const SWIFTCHECK_TIMEOUT_MS = 30_000;

/** legacy config.js:37 — `SWIFTCHECK_API_BASE_URL || "https://api.swiftcheck.example.com/v2"`.
 *  [FEAT-20260903-PROVIDEROWNSITSNAMES] moved out of `slip-flow.service.ts`,
 *  where it was a module const the flow handed to whatever provider it resolved.
 *  The fallback half of that expression belongs to Swiftcheck; the env override
 *  stays in the caller, which is the only thing that can read config. */
const SWIFTCHECK_DEFAULT_BASE_URL = 'https://api.swiftcheck.example.com/v2';

/** The path this provider verifies against — also the webhook log's `endpoint`. */
const SWIFTCHECK_VERIFY_PATH = '/verify/bank';

export const swiftcheckProvider: SlipProvider = {
  name: 'swiftcheck',
  defaultBaseUrl: SWIFTCHECK_DEFAULT_BASE_URL,
  /* [FEAT-20260903-BASEURLPERPROVIDER] `SWIFTCHECK_API_BASE_URL` is SWIFTCHECK's
     override, and now it says so. The flow used to apply that one env to every
     provider, so a second vendor would have had its path appended to Swiftcheck's
     host — a customer's slip and that vendor's key posted to the wrong company,
     with no error because the URL still parses. Declaring the key here keeps
     Swiftcheck's behaviour byte-identical (`resolveBaseUrl` reads the same field
     and falls back to the same default) while making the override reach nobody
     else. A provider that names none simply uses its own host. */
  baseUrlConfigKey: 'swiftcheckApiBaseUrl',
  /* [FEAT-20260903-PROVIDEROWNSITSNAMES] both were literals in the flow's
     `createLog` call, so every provider's call would have been recorded as
     Swiftcheck's. Values unchanged — the inbound/outbound baselines pin them. */
  logChannel: 'swiftcheck_api',
  logAction: 'verify_bank_slip',

  buildRequest(input: SlipVerifyInput): SlipVerifyRequest {
    return {
      url: `${input.baseUrl}${SWIFTCHECK_VERIFY_PATH}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: {
        base64: input.imageBase64,
        checkDuplicate: input.checkDuplicate,
        // Identity check again, not truthiness (legacy:2833) — the caller does
        // the `=== true` and hands the result over already decided.
        matchAccount: input.matchAccount,
      },
      timeoutMs: SWIFTCHECK_TIMEOUT_MS,
      endpoint: SWIFTCHECK_VERIFY_PATH,
      // The key the caller redacts before writing `raw_request`. Swiftcheck's
      // image field; a second provider names its own.
      imageField: 'base64',
    };
  },

  async send(request: SlipVerifyRequest): Promise<SlipVerifyResponse> {
    /* ⚠️ NO try/catch, deliberately. `verifySlip`'s catch reads `error.response`
     * and `error.message` off whatever axios raised, and turns them into
     * `slipVerifyResult` and `slipCondition`. Catching here — even to re-throw
     * something friendlier — would change both, and with them the row written
     * on the failure path. The rejection must travel untouched. */
    const response = await axios.post(request.url, request.body, {
      headers: request.headers,
      timeout: request.timeoutMs,
    });
    return { status: response.status, data: response.data };
  },

  /* [FEAT-20260903-RESPONSESEAM] IDENTITY, and that is the whole point.
   *
   * The flow was written against Swiftcheck, so Swiftcheck's envelope IS the shared
   * envelope: `success`, `error.code` as a STRING, `data.matchedAccount`, and the
   * `sender`/`receiver` tree the slip row and the Shop-API hand-off read. Returning
   * the object unchanged states that relationship instead of leaving it implicit.
   *
   * ⚠️ NOT a stub to be filled in later. Any translation added here would move
   * Swiftcheck's behaviour, which is the one thing this whole seam exists to keep
   * still — `slip-flow-parity.spec.ts` compares this path against legacy's own
   * compiled source and would go red. The next provider translates in ITS file.
   *
   * ⚠️ RETURNS THE SAME OBJECT, not a copy. A copy would be safer in the
   * abstract and wrong here: `raw_response` is written from this value and the
   * inbound golden pins it, so cloning would risk changing key order or dropping
   * a prototype for no gain. Nothing downstream mutates it.
   * ของ Swiftcheck = รูปกลางอยู่แล้ว ⇒ คืนตัวเดิม ห้ามแปลงอะไรทั้งสิ้น */
  normaliseResponse(raw: SlipVerifyResponse): SlipVerifyResponse {
    return raw;
  },

  /* [FEAT-20260903-PROVIDEROWNSITSNAMES] the exact expression the flow used to
     inline: `(data as {success?: boolean})?.success`. Truthiness, not identity —
     legacy wrote the log status that way and the outbound baseline pins it, so
     tightening it to `=== true` here would be a behaviour change wearing a
     cleanup's clothes. Total: anything that is not a truthy `success` is an
     error, and nothing throws. */
  isSuccess(data: unknown): boolean {
    return !!(data as { success?: boolean } | undefined)?.success;
  },

  /* ==== [FEAT-20260903-CATCHSEAM] Swiftcheck recovers NOTHING, and that is a =====
   * ==== measured fact about this vendor, not a stub ===========================
   *
   * Swiftcheck reports its business verdicts INSIDE a 200: a duplicate comes back
   * as `success:true` with a flag, a wrong receiver as `success:true` with
   * `matchedAccount:false`, and its refusals as `success:false` with a STRING
   * code. So every rejection this provider can produce is a genuine transport
   * failure — a timeout, DNS, a 5xx, an unreadable response — and every one of
   * them belongs on the `ERR_` branch, which is exactly where it goes today.
   *
   * 🔴 RETURNING `null` UNCONDITIONALLY IS THEREFORE THE CORRECT ANSWER, not a
   * placeholder to be filled in later. Anything else would move Swiftcheck's
   * behaviour on the failure path of the money flow — the one thing this whole
   * seam exists to keep still — and `slip-flow-parity.spec.ts` plus the inbound
   * baseline would say so.
   *
   * ⚠️ The member is REQUIRED by the port on purpose: the next provider's author
   * has to answer "does my vendor do this?" in writing rather than inherit an
   * absence. SlipGuard's answer is the opposite one (400 for `1012`/`1014` while
   * still returning the slip) — see `docs/slip-spec.md` §6.3.
   * Swiftcheck ตอบผลธุรกิจใน 200 เสมอ ⇒ ที่ throw ออกมาคือพังจริงทุกกรณี */
  recoverFromError(): null {
    return null;
  },
};
