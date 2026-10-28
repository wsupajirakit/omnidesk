/**
 * ==== [FEAT-20260903-SLIPGUARD] the SlipGuard adapter ==============================
 *
 * 🔴 WRITTEN BUT **NOT REGISTERED**. `../index.ts` does not list it, so today
 * nothing can select it: `resolveSlipProvider` cannot return it, the dashboard's
 * options endpoint does not offer it, and `choice_count` stays 1 so the picker
 * stays hidden. Registering it is ONE line, and it is deliberately not taken yet
 * because the owner blocked switching a second provider on until Shop-API confirms
 * it can read a new vendor's envelope (`docs/slip-spec.md` §7) — and because the
 * registry's own note requires the clone-pairing rule to be settled first, which
 * it now is. เขียนไว้แล้ว แต่ยังไม่ register — สวิตช์อยู่ที่บรรทัดเดียวใน ../index.ts
 *
 * ⚠️ EVERY FACT BELOW IS MEASURED, not read off a document. The captures live in
 * `docs/slipguard-proof/*.local.json` (gitignored — they carry slip data). Where the
 * document and the capture disagreed, the capture won; two such disagreements are
 * recorded in `slipguard-normalise.ts` and in `docs/slip-spec.md` §6.3.
 *
 * revert: delete this folder. Nothing imports it outside its own spec.
 */
import axios from 'axios';

import {
  asSlipGuardBody,
  slipGuardToSharedEnvelope,
  slipGuardToSharedError,
} from './slipguard-normalise';

import type {
  SlipProvider,
  SlipVerifyInput,
  SlipVerifyRequest,
  SlipVerifyResponse,
} from '../slip-provider.port';

/** SlipGuard's own host. No env override is declared: none exists, and declaring
 *  one nobody sets is the debt `[FIX-20260829-STRIKEENVDEAD]` had to be undone. */
const SLIPGUARD_DEFAULT_BASE_URL = 'https://api.slipguard.com';

/** Same budget as Swiftcheck's until this vendor gives a reason to differ. Owned
 *  here because a timeout is a property of the vendor, not of the flow. */
const SLIPGUARD_TIMEOUT_MS = 30_000;

/**
 * 🔴 THE ACCOUNT IS IN THE PATH, WHICH IS WHY `branchId` EXISTS ON THE INPUT.
 * SlipGuard identifies the merchant by branch, not by the key alone — and the two
 * are separate values that must both be right. A branch that does not match the
 * key answers `1002`; a branch that does not exist answers `1001`. Both fail
 * closed, which is the safe direction for a wrong pairing.
 */
const pathFor = (branchId: string) => `/api/line/apikey/${branchId}`;

export const slipguardProvider: SlipProvider = {
  name: 'slipguard',
  defaultBaseUrl: SLIPGUARD_DEFAULT_BASE_URL,
  logChannel: 'slipguard_api',
  logAction: 'verify_bank_slip',

  buildRequest(input: SlipVerifyInput): SlipVerifyRequest {
    /* An empty branch still builds a URL — `…/apikey/` — and SlipGuard answers
       `1001 branch not found`. That is deliberate: refusing here would throw
       inside `buildRequest`, which is pure and whose caller has no catch for it,
       and it would turn a misconfiguration into a crash on a live conversation.
       A vendor error is visible in the log and on the row; a throw is not. */
    const branch = String(input.branchId ?? '').trim();
    const path = pathFor(branch);

    return {
      url: `${input.baseUrl}${path}`,
      headers: {
        'Content-Type': 'application/json',
        /* 🔴 NOT `Authorization: Bearer`. SlipGuard uses its own header name, and a
           bearer token here answers `1002`. */
        'x-authorization': input.apiKey,
      },
      body: {
        // measured: the field is `files`, and it takes a base64 STRING as well
        // as a file. An earlier probe used `base64` and got `1000 no data`,
        // which was misread as "SlipGuard does not accept base64".
        files: input.imageBase64,
        /* 🔴 `log` IS NOT A LOGGING FLAG — it selects whether SlipGuard performs the
           business checks at all, and it changes the response envelope. With it
           ON, SlipGuard checks the receiver against the account bound to the branch
           and detects duplicates, and reports both as HTTP 400. With it OFF there
           is no check to fail, and WE would have to detect duplicates ourselves —
           which this flow has no store for.
           ⇒ It is ON, and that is what `recoverFromError` below exists to absorb.
           It also matters commercially: with `log:true` a resend is free and only
           a valid, matching slip is charged; with `log:false` every valid read is
           charged including every resend. */
        log: true,
        /* `checkDuplicate` and `matchAccount` from the input are BOTH folded into
           `log` — this vendor has no separate switches. The caller's
           `matchAccount` is therefore not forwarded; see the note in the spec on
           why the receiver check is the vendor's here and ours nowhere. */
      },
      timeoutMs: SLIPGUARD_TIMEOUT_MS,
      endpoint: path,
      // the key redaction strips before `raw_request` is persisted. Naming it
      // `base64` here would leave the whole image in the logs.
      imageField: 'files',
    };
  },

  async send(request: SlipVerifyRequest): Promise<SlipVerifyResponse> {
    /* ⚠️ NO try/catch, same rule as every provider: the caller's catch reads
       `error.response` and `error.message` off the original rejection. The 4xx
       that carries a business verdict is claimed in `recoverFromError`, which is
       a separate, explicit decision — not a swallowed error. */
    const response = await axios.post(request.url, request.body, {
      headers: request.headers,
      timeout: request.timeoutMs,
    });
    return { status: response.status, data: response.data };
  },

  /**
   * ==== the fold table, in ONE place ========================================
   *
   *   HTTP 200            → success, isDuplicate:false, matchedAccount:true
   *   HTTP 4xx code 1012  → success, isDuplicate:true
   *   HTTP 4xx code 1014  → success, matchedAccount:false
   *   anything else       → failure carrying the vendor's own code
   *
   * 🔴 BOTH FLAGS ARE SYNTHESISED. A SlipGuard success carries NEITHER — measured:
   * `isDuplicate` and `matchedAccount` exist only as absences. Swiftcheck sends them,
   * so the flow reads them, so this has to supply them.
   *
   * 🔴 SUCCESS COMES FROM THE HTTP STATUS, NEVER FROM A BODY FIELD. SlipGuard sends
   * `data.success: true` INSIDE an error envelope — reading it would report a
   * wrong-account slip as verified, on the money path.
   *
   * ⚠️ `1012` DOES NOT SET `matchedAccount`, and that is the spec's table rather
   * than an oversight: SlipGuard does not tell us whether the receiver matched on a
   * duplicate, so claiming it did would be inventing a money-path fact. The
   * consequence, stated so nobody is surprised: on a hook with `match_account`
   * ON and `duplicateFirst` OFF, a duplicate is answered with the wrong-account
   * card rather than the duplicate card (`slip-flex.handler.ts:792` runs before
   * `:820`). Wrong card, never a wrong verdict — and `duplicateFirst` orders it
   * correctly for OAs that enable it. ไม่รู้ = ไม่เดา ยอมได้การ์ดผิด ดีกว่าตัดสินเงินผิด
   */
  normaliseResponse(raw: SlipVerifyResponse): SlipVerifyResponse {
    const body = asSlipGuardBody(raw.data);

    if (raw.status >= 200 && raw.status < 300) {
      return {
        status: raw.status,
        data: slipGuardToSharedEnvelope(body, {
          isDuplicate: false,
          matchedAccount: true,
        }),
      };
    }
    if (body.code === 1012) {
      return {
        status: raw.status,
        data: slipGuardToSharedEnvelope(body, { isDuplicate: true }),
      };
    }
    if (body.code === 1014) {
      return {
        status: raw.status,
        data: slipGuardToSharedEnvelope(body, { matchedAccount: false }),
      };
    }
    return { status: raw.status, data: slipGuardToSharedError(body) };
  },

  /**
   * Read from the SHARED envelope this provider just produced, not from SlipGuard's
   * own body — by the time the flow calls this, `normaliseResponse` has already
   * run. So the `data.success`-inside-an-error trap cannot reach here: that field
   * lives under `data.slipguard`, where nothing reads it as ours.
   */
  isSuccess(data: unknown): boolean {
    return (data as { success?: boolean } | undefined)?.success === true;
  },

  /**
   * ==== [FEAT-20260903-CATCHSEAM] the 4xx that is really an answer ===========
   *
   * SlipGuard reports a duplicate (`1012`) and a wrong receiver (`1014`) as HTTP
   * 400 while still returning the whole slip. axios throws on 4xx, so without
   * this they would land on the `ERR_` branch — "we never got an answer" — which
   * stops payment GATE B, makes `match_account:false` meaningless because the
   * vendor's "no" becomes indistinguishable from an outage, and makes
   * `flex_duplicate` unselectable.
   *
   * ⚠️ RETURNS THE RAW REPLY, NOT A TRANSLATED ONE. `sendWithRecovery` hands the
   * result straight to `normaliseResponse`, so translating here would run the
   * fold twice. One translation point, and this member only decides WHETHER the
   * rejection was an answer.
   *
   * ⚠️ ONLY THE TWO CODES ARE CLAIMED. Everything else — `1001` branch not found,
   * `1002` bad key, `1004` over quota, a 500, a timeout — is a real failure and
   * must keep its `ERR_` meaning. Claiming an unknown code would fold it into the
   * success shape and tell the payment leg a slip is good on a verdict nobody has
   * read. โค้ดที่ไม่รู้จัก = ไม่รับ ปล่อยให้เป็น error ตามเดิม
   *
   * ⚠️ TOTAL. Reads defensively and returns `null` for anything it cannot
   * understand — a throw here would replace the vendor's error with ours.
   */
  recoverFromError(err: unknown): SlipVerifyResponse | null {
    const response = (err as { response?: { status?: number; data?: unknown } })
      ?.response;
    if (!response || typeof response.status !== 'number') return null;

    const body = asSlipGuardBody(response.data);
    if (body.code !== 1012 && body.code !== 1014) return null;

    return { status: response.status, data: response.data };
  },
};

export { SLIPGUARD_TIMEOUT_MS };
