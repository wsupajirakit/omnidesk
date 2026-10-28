import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model, Types } from 'mongoose';
import { readFileSync } from 'node:fs';

import { integrationConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto/crypto.service';
import { slipCallbackContractSource } from '@/modules/customer-provider';
import { WebhookLogService } from '@/modules/system';

import {
  DEFAULT_SLIP_PROVIDER,
  redactImageField,
  // [FEAT-20260903-BASEURLPERPROVIDER] revert: drop this import and restore
  // `baseUrlFor` to `this.integration.swiftcheckApiBaseUrl || provider.defaultBaseUrl`.
  resolveBaseUrl,
  resolveSlipProvider,
  // [FEAT-20260903-CATCHSEAM] revert: drop this import and call
  // `slipProvider.send(verifyRequest)` directly at the one call site below.
  sendWithRecovery,
  type SlipProvider,
} from './providers';
import { callbackContractNumber } from './slip-callback-contract';
import {
  SlipVerification,
  type SlipVerificationDocument,
} from './schemas/slip-verification.schema';

/**
 * The slip half of the inbound-image path: ask Swiftcheck to verify the slip, and
 * fan the outcome out to the hook's configured callbacks.
 *
 * PORTED line for line from
 * `legacy-api/src/controllers/core-bot/webhookController.js`:
 *   · `verifySlip`          ← 2800-2944 (inline in the image branch)
 *   · `handleSlipCallback`  ← 2044-2155
 *
 * ── WIRED ────────────────────────────────────────────────────────────────────
 * Registered on `SlipModule` and injected into `WebhookService`
 * (webhook.service.ts:347, [FIX-20260808-SLIPFLOW]), which drives both call
 * sites (legacy:3626 normal image path, legacy:3132 assist-skip path). This file
 * stays free of that wiring so the seam is testable with a faked service.
 *
 * ── THREE BEHAVIOURS A TIDY-UP WOULD ERASE ──────────────────────────────────
 * All three were found by reading the legacy lines, and all three are load-
 * bearing. They are called out here because each looks like a bug and is not
 * safe to "fix" in a transcription:
 *
 * 1. **Swiftcheck fires on ANY image at a slip-enabled hook, regardless of what
 *    the router decides.** Legacy:2800-2944 sits ABOVE the silent-type gate and
 *    ABOVE the non-text branch, so a hook with no `image_answer_text` — one
 *    that will send the customer nothing at all — still bills a Swiftcheck call
 *    and still writes a `slip_verifications` row. The cost and the row are not
 *    conditional on a reply happening. Moving this call below the routing gate
 *    would look like an obvious cleanup and would silently stop billing (and
 *    stop recording) for every such hook.
 *
 * 2. **Three distinct `SlipVerification.create` shapes**, not one shape with a
 *    varying status. They differ in which fields exist at all, and their
 *    `trans_ref` prefixes (`SWIFTCHECK_` / `FAIL_` / `ERR_`) are how an operator
 *    tells a slip the bank could not match from one the API rejected from one
 *    that threw. See each branch below.
 *
 * 3. **The callback fan-out is sequential and total.** Every URL in
 *    `hook.callback_slip` is POSTed in order, 15s each, and a failure does not
 *    stop the loop — the per-URL result map is written to
 *    `callback_response` (legacy:2147) whatever happened. It is `await`ed on
 *    the assist-skip path (legacy:3145) and fire-and-forget on the normal path
 *    (legacy:3749); that difference belongs to the callers, not here.
 *
 * ── NO AI CALL LIVES IN THIS FILE ───────────────────────────────────────────
 * `QrVisionService` is the file that bills Gemini; it is a sibling and this one
 * never invokes it. The `SLIP_NOT_FOUND` short-circuit that skips Gemini
 * entirely (legacy:3623-3627) is reproduced as `resolveQrDecision` below so it
 * can be pinned by test without any call being possible.
 */

/* [FEAT-20260903-PROVIDEROWNSITSNAMES] `SWIFTCHECK_DEFAULT_BASE_URL` moved to
 * `providers/swiftcheck/swiftcheck.provider.ts` as `defaultBaseUrl`. It was a module
 * const here that the flow handed to WHATEVER provider it resolved, so a second
 * provider would have had its path appended to Swiftcheck's host — a valid URL
 * pointing at the wrong company, carrying a real slip image. The env override
 * stays below, because only the caller can read config. */

/* [FEAT-20260902-SLIPPROVIDER] `SWIFTCHECK_TIMEOUT_MS` moved to
 * `providers/swiftcheck/swiftcheck.provider.ts`. It is a property of that provider, not of
 * this flow — a second vendor has its own budget. Keeping a copy here would let
 * the two drift while only the provider's value reached the wire. The callback
 * timeout below is unrelated and stays. */

/** legacy:2121 — every callback URL gets its own 15s budget. */
const CALLBACK_TIMEOUT_MS = 15_000;

/* legacy:2853 — the image is stripped before the request is stored. The
 * placeholder and the stripping both moved to `providers/redact-image.ts`: the
 * KEY holding the image is the provider's to name, and spelling it out here
 * three times meant three chances to leak a whole slip image into the logs the
 * day a second provider named it something else. */

/** Offset matching legacy's `dayjs().tz("Asia/Bangkok")` in the payload stamp. */
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** [FEAT-20261019-CALLBACKLINEPROFILE] one non-empty string off the turn's LINE profile,
 *  else `undefined` — the profile is typed `unknown` upstream, so nothing is assumed. */
const lineProfileText = (
  profile: unknown,
  key: 'displayName' | 'pictureUrl',
): string | undefined => {
  const v =
    profile && typeof profile === 'object'
      ? (profile as Record<string, unknown>)[key]
      : undefined;
  return typeof v === 'string' && v ? v : undefined;
};

/**
 * The hook fields this flow reads. Structural rather than the `Hook` document
 * type, so `SlipModule` does not have to depend on `HooksModule` — legacy
 * passes a `.lean()` object here and reads exactly these.
 */
export interface SlipHookLike {
  _id?: Types.ObjectId | string | null;
  alias?: string;
  display_name?: string;
  line_oa_name?: string;
  slip_check?: boolean;
  slip_verify_key?: string;
  /** [FEAT-20260902-SLIPPROVIDER] `''`/absent = the current provider. */
  slip_provider?: string;
  /** [FEAT-20260903-VENDORBRANCH] the hook's sub-account at its provider, for
   *  vendors that put the account in the endpoint. `''`/absent for the rest. */
  slip_verify_branch?: string;
  /* [FIX-20260903-HOSTNOTAFIELD] `slip_verify_base_url` sat here for a few hours
     and is deliberately absent now — the host is not hook data. See `baseUrlFor`. */
  match_account?: boolean;
  match_account_number?: string;
  callback_slip?: string[] | string | null;
  callback_token?: string;
  callback_action?: string;
}

/** The stored-image row legacy reads `file_path` off (legacy:2827). */
export interface SlipStorageLike {
  file_path: string;
}

export interface VerifySlipInput {
  hook: SlipHookLike | null | undefined;
  storage: SlipStorageLike;
  /** The `image_storages` `_id`, written onto the slip row. */
  storageId: Types.ObjectId | string | null;
  userId: string;
  /** LINE message id — used only for log correlation, as legacy does. */
  messageId?: string;
}

/**
 * What legacy leaves behind in the enclosing scope after the block runs. Each
 * field maps to one outer variable the downstream flex/callback code reads.
 */
export interface VerifySlipResult {
  /** legacy `slipVerifyResult` — Swiftcheck's body, or the error envelope. */
  slipVerifyResult: unknown;
  /** legacy `slipRecordId` — null when nothing was written. */
  slipRecordId: Types.ObjectId | null;
  /** legacy `slipCreatedAt`. */
  slipCreatedAt: Date | null;
  /** legacy `slipCondition` — set ONLY by the exception branch (legacy:2917). */
  slipCondition: string | null;
  /** False when the `slip_check`/key gate was not met (legacy:2936). */
  attempted: boolean;
}

export interface SlipCallbackInput {
  hook: SlipHookLike | null | undefined;
  flexDoc?: {
    callback_tag?: string;
    callback_detail?: string;
    [key: string]: unknown;
  } | null;
  condition?: string | null;
  slipVerifyResult?: unknown;
  profileData?: Record<string, unknown> | null;
  userId?: string | null;
  /** [FEAT-20261019-CALLBACKLINEPROFILE] the turn's LINE profile as the spine already built
   *  it (`ctx.profileForLog`: `{displayName, pictureUrl, nickname}`, or `{}` when LINE gave
   *  none) — fresh from LINE or the member row's stored copy, see `syncMemberProfile`.
   *  No fetch happens for the callback. */
  lineProfile?: unknown;
  customerName?: string | null;
  customerTel?: string | null;
  /** [FEAT-20261014-CALLBACKCONTRACT] the turn's resolved customer code (`profile_map.code`
   *  on a custom-tool hook). Read only when the provider declares it a contract number. */
  contractCode?: string | null;
  /** Accepted and unused — legacy takes it and never reads it (legacy:2042). */
  storagePath?: string | null;
  mediaUrl?: string | null;
  slipRecordId?: Types.ObjectId | string | null;
}

/** One entry of the map written to `callback_response`. */
export interface CallbackResultEntry {
  status: 'success' | 'error';
  http_status?: number;
  data?: unknown;
  message?: string;
  duration_ms: number;
}

@Injectable()
export class SlipFlowService {
  private readonly logger = new Logger(SlipFlowService.name);

  constructor(
    @InjectModel(SlipVerification.name)
    private readonly slipModel: Model<SlipVerification>,
    private readonly crypto: CryptoService,
    private readonly webhookLogService: WebhookLogService,
    @Inject(integrationConfig.KEY)
    private readonly integration: ConfigType<typeof integrationConfig>,
  ) {}

  /**
   * legacy config.js:36-38 — `SWIFTCHECK_API_BASE_URL` with a hardcoded fallback.
   * The fallback lives here rather than in `env.schema.ts` because the schema
   * declares the variable optional with no default; without this line an unset
   * variable would produce `undefined/verify/bank`.
   */
  /**
   * [FEAT-20260902-SLIPPROVIDER] Who verifies THIS hook's slip.
   *
   * ⚠️ RESOLVED PER CALL, NOT HELD AS A FIELD, because the choice is per-hook. It
   * is also not a constructor dependency: three specs build this service with a
   * fixed provider list and four e2e suites boot it through `AppModule`, so a new
   * parameter would fail `.compile()` and take the parity net and both money-path
   * baselines down in the same commit. The port takes `apiKey` and `baseUrl` as
   * plain values, so nothing needs injecting.
   *
   * ⚠️ AN UNKNOWN NAME FALLS BACK TO THE CURRENT PROVIDER, deliberately.
   * `resolveSlipProvider` returns null for anything unregistered, and a typo in a
   * config field must not stop slips being verified. Failing safe here means
   * failing toward today's behaviour.
   *
   * 🔴 [RULE-20260903-STGSTAYSSWIFTCHECK] STANDING OWNER RULE — STAGING KEEPS USING
   * SWIFTCHECK, AND IT MUST COST NOTHING TO DO SO. SlipGuard is not wanted yet. So an
   * environment that sets NO value anywhere must keep verifying through Swiftcheck,
   * byte for byte, with **no config to write, no env var to set, no migration and
   * no deploy step**. Doing nothing is the supported way to stay on Swiftcheck.
   *
   * ⚠️ THE POINT THE OWNER MADE, and it is the part that is easy to lose: THE
   * VALUES ARE ALREADY THERE. Staging is not "unconfigured and needs setting up"
   * — it is CONFIGURED AND WORKING. `slip_verify_key`, the base URL, the cards,
   * the payment tools: all of it is in place and verifying slips today. This
   * feature must not turn a working environment into one that needs a migration
   * pass before it works again.
   *
   * WHAT THAT FORBIDS, concretely, because each of these is a normal-looking step
   * someone would take without noticing it breaks the rule:
   *   · a required field — anything that makes verification fail, warn, or take a
   *     different branch because `slip_provider` is empty
   *   · a backfill or migration that writes `'swiftcheck'` onto existing hooks "to
   *     make the data consistent". Empty ALREADY means Swiftcheck; writing it down
   *     changes nothing except creating rows that must now be maintained
   *   · a validation rule that rejects `''` on save, which would make the next
   *     unrelated edit to any hook fail until someone picks a provider
   *   · a comparison anywhere that treats `''` as different from `'swiftcheck'` —
   *     see [PLANAUDIT-20260903-RESUMEVSSTG] in `payment/payment-runner.service.ts`,
   *     where the planned resume comparator would have done exactly that
   *   · reading the provider from `NODE_ENV` or any per-environment switch: the
   *     choice is per-hook data, and an env fork means staging and production stop
   *     exercising the same path
   * stg ตั้งค่าครบและใช้งานอยู่แล้ว ⇒ ฟีเจอร์นี้ห้ามทำให้ต้องมาตั้งใหม่ · ว่าง = Swiftcheck อยู่แล้ว
   *
   * This is what upholds it, and each one has to stay true:
   *   · `hooks.slip_provider` is `@Prop({ default: '' })` — every existing row and
   *     every new row reads as `''`
   *   · `''` and any unregistered name both resolve to `DEFAULT_SLIP_PROVIDER`,
   *     which IS Swiftcheck (`providers/index.ts`)
   *   · nothing else selects a provider — no env var, no boot-time factory, no
   *     per-tool knob (the payment-tool version was reverted in `fd664f0`)
   *
   * ⇒ WHAT WOULD BREAK THE RULE, so it is refused on sight: making SlipGuard the
   * registry default, selecting from an env var, requiring a value to be written
   * before verification works, or a backfill that stamps a provider onto existing
   * hooks. Registering a second provider is fine — MAKING IT THE DEFAULT IS NOT.
   * stg ต้องอยู่กับ Swiftcheck ต่อได้โดยไม่ต้องตั้งค่าอะไรเลย · ไม่ตั้ง = ของเดิมเป๊ะ
   */
  private providerFor(hook: SlipHookLike | null | undefined) {
    return resolveSlipProvider(hook?.slip_provider) ?? DEFAULT_SLIP_PROVIDER;
  }

  /**
   * [FEAT-20260903-BASEURLPERPROVIDER] the host, resolved from the REGISTRY.
   *
   * 🔴 CORRECTION. This method used to be
   * `this.integration.swiftcheckApiBaseUrl || provider.defaultBaseUrl`, and the note
   * above it claimed that "an unconfigured provider correctly uses its own
   * default and nothing silently points at Swiftcheck". **That was only true while
   * the env was unset.** With `SWIFTCHECK_API_BASE_URL` set — which any deployment
   * may do — that one Swiftcheck-named value was handed to EVERY provider, so a
   * second vendor's path would have been appended to Swiftcheck's host: a
   * customer's slip image and that vendor's API key posted to the wrong company,
   * with no error, because the URL still parses. The claim is corrected rather
   * than deleted, because it is the kind of note a reader trusts.
   *
   * Now each provider states its own host and names the override it accepts, in
   * its own file, and `resolveBaseUrl` is the single place that reads either.
   * ⇒ **NO VENDOR IS NAMED IN THIS FILE ANY MORE**, and a provider registered
   * tomorrow cannot inherit another one's host by construction rather than by
   * everyone remembering. Swiftcheck is byte-identical: it declares
   * `baseUrlConfigKey: 'swiftcheckApiBaseUrl'`, so the same field is read and the
   * same default applies.
   *
   * The parameter type narrows `this.integration` to the base-URL fields, so the
   * resolver cannot see the secrets that config also carries.
   */
  /* 🔴 [FIX-20260903-HOSTNOTAFIELD] THE PER-HOOK HOST IS GONE, AND THE REASON IS
     WORTH KEEPING. It existed for a few hours on 03/09 because the host had been
     read from env and the owner ruled env out — "per hook" was the first place to
     put it instead. Seeing the form, the owner ruled again: an operator must not
     TYPE the host at all, and it does not belong in the database; the back end is
     the single source of truth and a vendor changing its URL should be a one-line
     edit in that vendor's own file. Which is exactly `provider.defaultBaseUrl`.
     So the hook parameter is removed here, the field is removed from the schema,
     the whitelist, the tab map, the form and the types — nothing carries it any
     more. Measured before deleting: 0 of 7 hooks held a value, in BOTH databases,
     so no data was lost and no migration is needed.
     ⇒ host ไม่ใช่ค่าที่คนกรอก · อยู่ในไฟล์ของ provider บรรทัดเดียว
     revert: put `slip_verify_base_url` back on the schema + ALLOWED_UPDATES +
     FIELD_TAB, and pass `hook?.slip_verify_base_url` as the third argument. */
  private baseUrlFor(provider: SlipProvider): string {
    return resolveBaseUrl(provider, this.integration);
  }

  /**
   * legacy:55-60 `maskToken` — used only in a log line, so the verify key
   * cannot reach the log intact. Transcribed exactly, including `null` for a
   * falsy input and returning a ≤4-char value UNMASKED (legacy:58); the local
   * `maskString` in `common/utils` has different behaviour and is not a
   * substitute.
   */
  private maskToken(token: string | undefined | null): string | null {
    if (!token) return null;
    const trimmed = String(token).trim();
    if (trimmed.length <= 4) return trimmed;
    return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
  }

  /**
   * The gate legacy applies before doing anything (legacy:2822).
   *
   * `slip_check === true` is an identity check, not truthiness: a hook whose
   * `slip_check` is the string `"true"` does NOT verify. Kept as found.
   */
  isSlipVerifyEnabled(hook: SlipHookLike | null | undefined): boolean {
    return hook?.slip_check === true && !!hook?.slip_verify_key;
  }

  /**
   * legacy:3623-3627 — the branch that decides whether Gemini is asked at all.
   *
   * On `SLIP_NOT_FOUND` (Swiftcheck's 404) the answer is `true` WITHOUT a vision
   * call: a 404 already means Swiftcheck found a QR and could not verify it, so
   * there is nothing left to ask. Only `VALIDATION_ERROR` (Swiftcheck saw no QR)
   * reaches `QrVisionService`.
   *
   * Extracted as a predicate rather than left inline so the short-circuit is
   * directly testable — it is the one assertion that proves no AI call is made
   * on the 404 path.
   *
   * @returns `{ isQrCodeSlip }` when decided outright, or `askVision: true`
   *          when the caller must consult `QrVisionService`.
   */
  resolveQrDecision(isSlipNotFound: boolean): {
    askVision: boolean;
    isQrCodeSlip: boolean;
  } {
    if (isSlipNotFound) return { askVision: false, isQrCodeSlip: true };
    return { askVision: true, isQrCodeSlip: false };
  }

  /**
   * Reads the stored slip, POSTs it to Swiftcheck `/verify/bank`, and writes
   * exactly one `slip_verifications` row — one of three shapes.
   *
   * Legacy runs this inline inside the image branch and assigns four enclosing
   * variables; this returns them instead. Nothing else changed.
   */
  async verifySlip(input: VerifySlipInput): Promise<VerifySlipResult> {
    const { hook, storage, storageId, userId, messageId } = input;

    const result: VerifySlipResult = {
      slipVerifyResult: null,
      slipRecordId: null,
      slipCreatedAt: null,
      slipCondition: null,
      attempted: false,
    };

    // legacy:2817-2818 — the two lines an operator greps for when a hook
    // "isn't verifying". Kept verbatim, key masked.
    this.logger.log(`[SLIP-DEBUG] [${messageId}] Image storage found.`);
    this.logger.log(
      `[SLIP-DEBUG] [${messageId}] Hook Settings - slip_check: ${hook?.slip_check}, ` +
        `slip_verify_key: ${hook?.slip_verify_key ? 'PRESENT' : 'MISSING'}`,
    );

    if (!this.isSlipVerifyEnabled(hook)) {
      // legacy:2936 — the skip is logged, and nothing is written.
      this.logger.log(
        `[SLIP-DEBUG] [${messageId}] Slip verification skipped. ` +
          `(slip_check: ${hook?.slip_check}, hasKey: ${!!hook?.slip_verify_key})`,
      );
      return result;
    }

    result.attempted = true;
    this.logger.log(
      `[SLIP-DEBUG] [${messageId}] Conditions met. Starting verify flow.`,
    );

    let verifyPayload: Record<string, unknown> = {};
    try {
      this.logger.log(
        `[SLIP VERIFY] [${messageId}] Starting verification. ` +
          `Key: ${this.maskToken(hook?.slip_verify_key)}`,
      );
      /* legacy:2827 — synchronous read, on the webhook's own thread. Preserved:
       * making it async changes the ordering of everything after it.
       *
       * [NOTE-20260810-IMAGEPIPELINE] WHOSE FILE THIS IS.
       * `storage` is the `image_storages` row created by
       * `line-content.service.ts:downloadAndSaveImage` when the customer's image
       * first arrived — the SAME row the chat message points at through
       * `internal_content_id`. Nothing is copied for the slip: the bytes read
       * here are the bytes the customer sent, read back off disk.
       *
       * ⚠️ THE FILE IS NEEDED TWICE, AND THE SECOND TIME IS AFTER THIS.
       * Swiftcheck gets it as base64 here; the payment runner then re-attaches the
       * FILE ITSELF to the Shop-API topup leg. So a file that vanishes between the
       * two reads leaves a slip that verified successfully and a topup that
       * fails with `no_slip_image` — money that never arrives, with nothing on
       * the customer's screen to say why. Never treat the file as consumable
       * once verification passes. ไฟล์ต้องอยู่ต่อจนจบ topup ไม่ใช่แค่ตรวจเสร็จ.
       */
      const imageBuffer = readFileSync(storage.file_path);
      const base64Image = imageBuffer.toString('base64');

      /* ==== [NOTE-20260902-PROVIDERSEAM] THIS IS THE ONLY PLACE A SLIP PROVIDER
       * IS CONTACTED — and as of 03/09 it no longer names one. The path, the
       * host fallback, the log channel and action, and the success test all moved
       * into the provider ([FEAT-20260903-PROVIDEROWNSITSNAMES]); what is left
       * here is the flow, the env override and the decrypt.
       * The original note said the seam "exists physically but is not named as
       * one yet". It is named now — kept rather than deleted because it records
       * that the split was written down before it was applied.
       *
       * WHAT IS SWIFTCHECK-SHAPED IN THE THREE LINES BELOW, measured against
       * SlipGuard v1.13 + 11 live calls on 2026-09-02:
       *
       *   `base64`         → SlipGuard's field is `files`, and it accepts EITHER a
       *                      file OR a base64 string. So the bytes do not fork:
       *                      one buffer, two field names. (SlipGuard also accepts
       *                      `data` = the QR payload string, which qr-prescan
       *                      already decodes, and `url`. One only, never two.)
       *   `checkDuplicate` +
       *   `matchAccount`   → SlipGuard has NEITHER. It bundles both behind a single
       *                      `log: boolean`: log:true = check the receiver against
       *                      the account bound at the vendor AND check duplicates;
       *                      log:false = read the slip and nothing else.
       *                      ⇒ there is no SlipGuard setting that reproduces today's
       *                      split (duplicate always on, matchAccount per-hook).
       *
       * DECIDED (owner, 2026-09-02): force `log: true` as a constant in the SlipGuard
       * adapter — we want the receiver check, and registering the account at the
       * vendor is the same setup already done for Swiftcheck. Keep it one word to change.
       *
       * ⚠️ THE RULE THAT MAKES FORCING IT SAFE: with log:true SlipGuard reports its
       * business verdicts as HTTP 400 (`1012` duplicate, `1014` wrong receiver)
       * while still returning the whole slip in `data`. Swiftcheck reports the same
       * two as `success:true` plus a flag. So the adapter MUST fold them back:
       *     1012 → { success:true, data:{ …, isDuplicate:true } }
       *     1014 → { success:true, data:{ …, matchedAccount:false } }
       *     other 4xx → { success:false, error:{ code } }
       * Without that fold, three things break at once: `api_status` becomes
       * 'failed' so payment GATE B refuses to run; `match_account:false` (which
       * every hook here is set to) stops meaning anything because the vendor's
       * check becomes mandatory; and `flex_duplicate` — bound on every hook here —
       * can never be selected. Also: never read `data.success`, it is `true` even
       * inside a 1014. Derive success from the HTTP status.
       *
       * ⚠️ AND THE FAILURE-VARIANT TRAP: a 4xx makes axios THROW, which lands in
       * VARIANT 3 below (`ERR_` prefix, "we never got an answer") instead of
       * VARIANT 2 (`FAIL_`, "the provider answered no"). That distinction is an
       * operator's only way to tell an outage from a rejection — see the comment
       * on the `ERR_` branch. The adapter must catch 4xx and return, never throw.
       *
       * Full spec, live evidence and the proof plan: docs/slip-spec.md §6.3. */
      /* ==== [FEAT-20260902-SLIPPROVIDER] the call now goes through the port ===
       * The url, the two headers, the three body keys and the 30s budget all
       * moved to `providers/swiftcheck/swiftcheck.provider.ts` UNCHANGED. What stays here is
       * everything the caller owns: reading the file, decrypting the key,
       * resolving the base URL, and recording the request afterwards.
       *
       * ⚠️ `buildRequest` IS CALLED ONCE and the object is reused. `verifyPayload`
       * must be the very object that went on the wire, because the three
       * `raw_request` sites below spread it. Building twice is harmless for
       * Swiftcheck and wrong for any provider that stamps a nonce or a timestamp.
       *
       * ⚠️ `String(...)` around the decrypt, not `?? ''`. `safeDecrypt` is typed
       * `string | null | undefined`, and today the value goes through a template
       * literal — so a null would produce the header `Bearer null`. `?? ''` would
       * quietly turn that into `Bearer `. The gate above makes it unreachable
       * today; the coercion keeps it unreachable AND unchanged.
       *
       * ⚠️ `hook?.match_account === true` stays an identity check, not `!!`.
       * A hook storing the STRING `'yes'` must send `matchAccount: false`
       * (legacy:2833) — `slip-flow-parity.spec.ts` drives exactly that case.
       *
       * ⚠️ `startTime` stays ABOVE the decrypt and the URL build, because that is
       * where it effectively sat before: `Date.now()` ran before the whole
       * `axios.post(...)` statement, and JS evaluates the argument expressions —
       * `baseUrlFor()` (`swiftcheckBaseUrl()` when this was written) and
       * `safeDecrypt()` — as part of it. Those two were
       * already inside the old window; what is newly inside is only object
       * construction: the input literal, the `String()` call, the `buildRequest`
       * frame and the three literals it returns. (An earlier version of this note
       * said "one object literal and no more" — an undercount, corrected.)
       * MEASURED, so this is a choice and not superstition: **no consumer renders
       * or sorts on `webhook_logs.duration_ms`.** Two endpoints do RETURN it —
       * the list projects by exclusion so every scalar flows, and the detail read
       * is unprojected — and the dashboard's type declares it; but no component
       * renders it, no aggregation touches it, and it is explicitly refused as a
       * sort key for lacking an index. (An earlier version of this note said "no
       * endpoint" reads it, which was wrong.) The decrypt it covers
       * is single-digit microseconds against a whole-millisecond integer that
       * ranges to 30_000. Narrowing would harm nothing; the line is kept only so
       * "this is a move, not a rewrite" stays literally true. The LINE reply path
       * already times the narrow way with its decrypt hoisted thousands of lines
       * away, so either form is house-consistent.
       *
       * PROOF THIS IS A MOVE, NOT A REWRITE: the request is compared against a
       * golden recorded before the provider existed —
       * `z-test/unit/slip-provider-swiftcheck-move.spec.ts` and
       * `z-test/unit/slip-outbound-baseline.spec.ts`. `slip-flow-parity.spec.ts`
       * additionally compares every axios argument against legacy's own source. */
      const startTime = Date.now();
      const slipProvider = this.providerFor(hook);
      const verifyRequest = slipProvider.buildRequest({
        imageBase64: base64Image,
        checkDuplicate: true,
        // Identity check again, not truthiness (legacy:2833).
        matchAccount: hook?.match_account === true,
        apiKey: String(this.crypto.safeDecrypt(hook?.slip_verify_key)),
        baseUrl: this.baseUrlFor(slipProvider),
        /* [FEAT-20260903-VENDORBRANCH] per-hook data, so only the hook can carry
           it. Passed to every provider; the ones that do not put an account in
           their endpoint — Swiftcheck — ignore it, which is why the port field is
           optional and why Swiftcheck's request is byte-identical either way. */
        branchId: hook?.slip_verify_branch,
      });
      verifyPayload = verifyRequest.body;

      /* [FEAT-20260903-RESPONSESEAM] send, then let the PROVIDER translate its own
         reply. Everything below this line — the row builder, the card router, the
         Shop-API hand-off — reads the shared envelope and never a vendor's private
         vocabulary. Swiftcheck's `normaliseResponse` is the identity, so this line
         changes nothing today; it is the seam a second provider needs, and it
         belongs here rather than in the flow's branches, which is where a vendor
         `if` would otherwise grow.
         [FEAT-20260903-CATCHSEAM] `sendWithRecovery` closes the half this comment
         used to say was unbuilt. A vendor that reports a business verdict as an
         HTTP error (SlipGuard returns 400 for `1012`/`1014` under `log:true` while
         still sending the whole slip) gets to claim its own rejection, and the
         claimed reply continues down THIS path instead of becoming an `ERR_` row
         that means "we never got an answer". A rejection no provider claims is
         re-thrown UNCHANGED, so the catch below reads exactly what it reads
         today — Swiftcheck recovers nothing, so nothing moves for it.
         revert: drop both wrappers, keep `await slipProvider.send(...)`. */
      const verifyResponse = slipProvider.normaliseResponse(
        await sendWithRecovery(slipProvider, verifyRequest),
      );

      result.slipVerifyResult = verifyResponse.data;
      const duration = Date.now() - startTime;

      // --- Log Swiftcheck API call to WebhookLog (legacy:2857-2872) ---
      // Fire-and-forget with a `.catch` — legacy does NOT await this, and
      // awaiting it would add a database round-trip to the webhook's latency.
      void this.webhookLogService
        .createLog({
          hook_id: hook?._id ? String(hook._id) : undefined,
          hook_alias: hook?.alias,
          /* [FEAT-20260903-PROVIDEROWNSITSNAMES] these four were Swiftcheck
             literals, so every provider's call would have been logged as
             Swiftcheck's, against Swiftcheck's path, judged by Swiftcheck's success
             field. `method` stays a literal: it is HTTP, not a vendor fact, and
             every provider on this seam posts. Values are unchanged for Swiftcheck,
             which is what the inbound and outbound baselines pin. */
          channel: slipProvider.logChannel,
          action_type: slipProvider.logAction,
          method: 'POST',
          endpoint: verifyRequest.endpoint,
          status: slipProvider.isSuccess(verifyResponse.data)
            ? 'success'
            : 'error',
          http_status: verifyResponse.status,
          raw_request: redactImageField(
            verifyPayload,
            verifyRequest.imageField,
          ),
          raw_response: verifyResponse.data,
          duration_ms: duration,
          reference_id: messageId,
        })
        .catch((err: Error) =>
          this.logger.error(
            `[SLIP] Failed to create WebhookLog: ${err.message}`,
          ),
        );

      this.logger.log(
        `[slip-log-verify] [${messageId}] Response Status: ${verifyResponse.status}`,
      );

      const body = verifyResponse.data as
        { success?: boolean; data?: SwiftcheckData } | undefined;

      if (body?.success) {
        // ── VARIANT 1 of 3: success (legacy:2876-2895) ───────────────────────
        // The full `rawSlip` mapping. Every account/name/bank field has a two
        // or three step fallback, and those fallbacks are the mapping: Swiftcheck
        // returns Thai and English name blocks and either a bank account or a
        // proxy account, and which one is present varies per bank.
        const vData = body.data;
        const rawSlip = vData?.rawSlip;

        const slipRecord = await this.createSlipRow({
          hook_id: hook?._id || null,
          /* [FEAT-20260903-SLIPPROVSTAMP] which provider actually answered for
             THIS row. Provenance only — nothing reads it yet, and the resume
             comparator that will is specified in `payment-runner.service.ts`
             [PLANAUDIT-20260903-RESUMEVSSTG], which requires absent to mean "no
             opinion". `slipProvider` is the instance that made the call above, so
             the stamp cannot disagree with what was used.
             ⚠️ NOT a config echo: it records the RESOLVED provider, so a hook
             holding `''` (the whole fleet) stamps `'swiftcheck'`, not `''`. That is
             the point — the raw config value is not a fact about this row.
             revert: delete this line here and at the two sites below. */
          slip_provider: slipProvider.name,
          transaction_date: rawSlip?.date ? new Date(rawSlip.date) : new Date(),
          api_status: 'success',
          // `SWIFTCHECK_<ms>` only when the bank gave no reference. A row with
          // this prefix means "verified, but unreferenced" — do not change it.
          trans_ref: rawSlip?.transRef || `SWIFTCHECK_${Date.now()}`,
          sender_account_no: rawSlip?.sender?.account?.bank?.account || '',
          sender_account_name:
            rawSlip?.sender?.account?.name?.th ||
            rawSlip?.sender?.account?.name?.en ||
            '',
          sender_bank:
            rawSlip?.sender?.bank?.short || rawSlip?.sender?.bank?.name || '',
          // Receiver falls back to the PROXY account (PromptPay); sender does
          // not. That asymmetry is legacy's and is correct — a sender is always
          // a real account, a receiver may be a proxy.
          receiver_account_no:
            rawSlip?.receiver?.account?.bank?.account ||
            rawSlip?.receiver?.account?.proxy?.account ||
            '',
          receiver_account_name:
            rawSlip?.receiver?.account?.name?.th ||
            rawSlip?.receiver?.account?.name?.en ||
            '',
          receiver_bank:
            rawSlip?.receiver?.bank?.short ||
            rawSlip?.receiver?.bank?.name ||
            '',
          slip_type: 'Bank Transfer',
          amount: rawSlip?.amount?.amount || 0,
          // Phase B read-cutover: display_name first, OA name second.
          branch: hook?.display_name || hook?.line_oa_name || 'Main Branch',
          internal_content_id: storageId,
          sender_line_user_id: userId,
          // The whole data object — includes amountInSlip, isDuplicate, rawSlip.
          raw_content: vData,
          raw_response: verifyResponse.data,
          raw_request: redactImageField(
            verifyPayload,
            verifyRequest.imageField,
          ),
        });
        result.slipRecordId = slipRecord._id;
        result.slipCreatedAt = this.createdAtOf(slipRecord);
        this.logger.log(
          `[SLIP VERIFY] Success. Record created: ${String(slipRecord._id)}`,
        );
      } else {
        // ── VARIANT 2 of 3: API answered, not success (legacy:2901-2911) ─────
        // A DIFFERENT shape, not the same one with a flag flipped: no sender,
        // no receiver, no `slip_type`, no `branch`, `amount` forced to 0, and
        // no `raw_content` at all. `FAIL_<ms>` is the reference, because there
        // is no slip reference to record.
        this.logger.warn(
          `[SLIP VERIFY] API returned non-success: ${JSON.stringify(
            verifyResponse.data,
          )}`,
        );
        const slipRecord = await this.createSlipRow({
          hook_id: hook?._id || null,
          transaction_date: new Date(),
          api_status: 'failed',
          // [FEAT-20260903-SLIPPROVSTAMP] see the note on the success row above.
          slip_provider: slipProvider.name,
          trans_ref: `FAIL_${Date.now()}`,
          amount: 0,
          internal_content_id: storageId,
          sender_line_user_id: userId,
          raw_response: verifyResponse.data,
          raw_request: redactImageField(
            verifyPayload,
            verifyRequest.imageField,
          ),
        });
        result.slipRecordId = slipRecord._id;
        result.slipCreatedAt = this.createdAtOf(slipRecord);
      }
    } catch (err) {
      // ── VARIANT 3 of 3: the call threw (legacy:2913-2935) ──────────────────
      const error = err as Error & { response?: { data?: unknown } };
      this.logger.error(`[SLIP VERIFY] Flow failed: ${error.message}`);
      result.slipVerifyResult = error.response
        ? error.response.data
        : { success: false, error: { message: error.message } };
      // The ONLY branch that sets slipCondition here; the other two leave it
      // for the flex-selection code downstream to fill in.
      result.slipCondition = `API Error: ${error.message}`;

      try {
        const slipRecord = await this.createSlipRow({
          hook_id: hook?._id || null,
          transaction_date: new Date(),
          api_status: 'failed',
          // `ERR_` — distinct from `FAIL_`. FAIL_ means Swiftcheck replied and
          // said no; ERR_ means we never got an answer (timeout, DNS, 5xx,
          // an unreadable file). Collapsing the two prefixes would destroy an
          // operator's only way to tell an outage from a rejection.
          /* [FEAT-20260903-SLIPPROVSTAMP] re-resolved rather than reused: this
             row is written from the CATCH, and `slipProvider` is declared inside
             the try, so it is not in scope here. `providerFor` is the single
             source either way, so both paths stamp the same provider — an ERR_
             row still records who we were talking to when it failed, which is the
             one case where knowing the provider matters most. */
          slip_provider: this.providerFor(hook).name,
          trans_ref: `ERR_${Date.now()}`,
          amount: 0,
          internal_content_id: storageId,
          sender_line_user_id: userId,
          raw_response: error.response
            ? error.response.data
            : { error: error.message },
          // Only this variant carries metadata, and only these two keys.
          metadata: { error_type: 'exception', message: error.message },
        });
        result.slipRecordId = slipRecord._id;
        result.slipCreatedAt = this.createdAtOf(slipRecord);
      } catch (dbErr) {
        // A failed error-record write is swallowed: the customer's message must
        // still be processed (legacy:2933).
        this.logger.error(
          `[SLIP VERIFY] Failed to save error record to DB: ${
            (dbErr as Error).message
          }`,
        );
      }
    }

    return result;
  }

  /**
   * One insert, three shapes.
   *
   * The three variants below deliberately supply DIFFERENT field sets — that is
   * the behaviour, not an oversight — so the argument is an open record rather
   * than a `SlipVerification`. A structurally-typed parameter would force every
   * variant to name every field and quietly erase the difference between them.
   * `internal_content_id` is also nullable at the call site while the schema
   * types it as present, which is legacy's shape, not a widening introduced
   * here.
   */
  private createSlipRow(
    doc: Record<string, unknown>,
  ): Promise<SlipVerificationDocument> {
    return this.slipModel.create(doc as unknown as SlipVerification);
  }

  /** legacy:2896 — `created_at || createdAt || new Date()`, in that order. */
  private createdAtOf(doc: SlipVerificationDocument): Date {
    const loose = doc as unknown as {
      created_at?: Date;
      createdAt?: Date;
    };
    return loose.created_at || loose.createdAt || new Date();
  }

  /** The Bangkok-stamped `created_at` legacy puts in the callback payload. */
  private bangkokStamp(now: number = Date.now()): string {
    return `${new Date(now + BANGKOK_OFFSET_MS).toISOString().slice(0, 19)}+07:00`;
  }

  /**
   * Builds the callback payload. Split out from the fan-out only so it can be
   * diffed against legacy's without any HTTP happening — the field list, the
   * order and every `|| "n/a"` are legacy:2076-2101 verbatim, with ONE addition:
   * `display_name` + `picture_url` after `line_user_id` (owner 19/10/2026,
   * [FEAT-20261019-CALLBACKLINEPROFILE]). `slip-flow-parity.spec.ts` still compares
   * every other key against legacy's own source.
   */
  buildCallbackPayload(
    input: SlipCallbackInput,
    now: number = Date.now(),
  ): Record<string, unknown> {
    const {
      flexDoc,
      condition,
      slipVerifyResult,
      profileData,
      userId,
      lineProfile,
      customerName,
      customerTel,
      mediaUrl,
    } = input;

    const resultData =
      ((slipVerifyResult as { data?: Record<string, unknown> } | undefined)
        ?.data as Record<string, unknown>) || {};
    // `rawSlip` when present, otherwise `data` ITSELF — so a Swiftcheck response
    // shaped without a rawSlip still yields transRef/amount/sender/receiver
    // from the top level (legacy:2073).
    const vData =
      (resultData as { rawSlip?: Record<string, unknown> })?.rawSlip ||
      resultData;

    return {
      // Always 200: this reports "the callback ran", not the slip's verdict.
      // The verdict is `result`/`condition`.
      status: 200,
      transRef: vData?.['transRef'] || resultData?.['transRef'] || 'n/a',
      result: flexDoc?.callback_tag || 'n/a',
      detail: flexDoc?.callback_detail || 'n/a',
      condition: condition || 'n/a',
      amount:
        resultData?.['amountInSlip'] ||
        (vData?.['amount'] as { amount?: number } | undefined)?.amount ||
        null,
      sender: vData?.['sender'] || null, // Moved here after amount
      receiver: vData?.['receiver'] || null, // Moved here after sender
      line_user_id: userId || 'n/a',
      /* [FEAT-20261019-CALLBACKLINEPROFILE] owner 19/10/2026 — the customer's LINE name and
         picture, beside the LINE id they belong to. Not legacy: added keys only, nothing
         before or after moved. No profile ⇒ the neighbours' sentinels: 'n/a' for text (as
         line_user_id), null for a URL (as slip_img_url) — the callback still goes out.
         revert: delete these two lines and `lineProfile` from SlipCallbackInput + callers. */
      display_name: lineProfileText(lineProfile, 'displayName') || 'n/a',
      picture_url: lineProfileText(lineProfile, 'pictureUrl') || null,
      full_name: customerName || 'n/a',
      phone_number: customerTel || 'n/a', // Renamed from contact_number
      // New contact_number — the CONTRACT number, not a phone number. The two
      // names crossed over in the rename and the partner reads them this way.
      // [FEAT-20261014-CALLBACKCONTRACT] legacy key first, then the provider's
      // declared source — see slip-callback-contract.ts.
      contact_number: callbackContractNumber({
        profileData,
        contractCode: input.contractCode,
        source: slipCallbackContractSource(),
      }),
      datetime_on_slip: vData?.['date'] || 'n/a',
      created_at: this.bangkokStamp(now),
      slip_img_url: mediaUrl || null,
      slip_check_raw_response: slipVerifyResult || null, // Moved to bottom
      // The WHOLE partner profile response travels in the callback body — this
      // is what makes the payload large, and the partner depends on it.
      external_api_response: profileData || null, // Moved to bottom
    };
  }

  /**
   * POSTs the slip outcome to every URL in `hook.callback_slip`, in order, and
   * records the per-URL result on the slip row.
   *
   * Sequential by construction (legacy:2107). Not parallelised: partners
   * receive these as an ordered feed, and the loop must not stop early — a URL
   * that fails is recorded as `status: "error"` and the next one is still sent.
   */
  async handleSlipCallback(input: SlipCallbackInput): Promise<void> {
    const { hook, flexDoc, slipRecordId } = input;

    this.logger.log(
      `[CALLBACK-DEBUG] Entering handleSlipCallback. Hook Alias: ${hook?.alias}, ` +
        `Action: ${hook?.callback_action}, callback_slip: ${JSON.stringify(
          hook?.callback_slip,
        )}`,
    );

    // Three gates, in legacy's order (legacy:2058-2071).
    const callbackAction = hook?.callback_action || 'all';
    if (callbackAction === 'none') {
      this.logger.log(
        '[CALLBACK-DEBUG] Skipping callback: callback_action is "none".',
      );
      return;
    }

    if (!hook?.callback_slip || hook.callback_slip.length === 0) {
      this.logger.log(
        '[CALLBACK-DEBUG] Skipping callback: callback_slip is empty or undefined.',
      );
      return;
    }

    if (callbackAction === 'success') {
      // Compared lowercased and trimmed, so a tag stored as " Success " still
      // matches (legacy:2066).
      const currentTag = (flexDoc?.callback_tag || '').toLowerCase().trim();
      if (currentTag !== 'success') {
        this.logger.log(
          `[CALLBACK-DEBUG] Skipping callback: action is "success" but current tag is "${currentTag}".`,
        );
        return;
      }
    }

    const callbackUrls = Array.isArray(hook.callback_slip)
      ? hook.callback_slip
      : [hook.callback_slip];
    const callbackToken = hook.callback_token || '';

    const payload = this.buildCallbackPayload(input);

    this.logger.log(
      `[CALLBACK-DEBUG] Payload Prepared. transRef: ${String(
        payload['transRef'],
      )}, result: ${String(payload['result'])}, status: ${String(
        payload['status'],
      )}`,
    );
    this.logger.log(
      `[CALLBACK-DEBUG] Target URLs: ${JSON.stringify(callbackUrls)}`,
    );

    // Keyed by 1-based position as a STRING ("1", "2", …), not by URL — that is
    // the shape already stored in `callback_response` on live rows.
    const results: Record<string, CallbackResultEntry> = {};
    for (let i = 0; i < callbackUrls.length; i++) {
      const url = callbackUrls[i];
      // A blank slot is skipped WITHOUT producing a result entry, so the keys
      // can be non-contiguous. Legacy:2110.
      if (!url) continue;

      const callbackStart = Date.now();
      this.logger.log(
        `[CALLBACK] [${i + 1}/${callbackUrls.length}] Sending POST to: ${url}`,
      );
      try {
        const response = await axios.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Type': 'slip_verification',
            'X-Callback-Token': callbackToken,
          },
          timeout: CALLBACK_TIMEOUT_MS,
        });
        const duration = Date.now() - callbackStart;
        this.logger.log(
          `[CALLBACK] [${i + 1}] Success! Status: ${response.status} (${duration}ms)`,
        );
        results[String(i + 1)] = {
          status: 'success',
          http_status: response.status,
          data: response.data,
          duration_ms: duration,
        };
      } catch (err) {
        const error = err as Error & {
          response?: { status?: number; data?: unknown };
        };
        const duration = Date.now() - callbackStart;
        this.logger.error(
          `[CALLBACK] [${i + 1}] Failed! URL: ${url} | Error: ${error.message} (${duration}ms)`,
        );
        results[String(i + 1)] = {
          status: 'error',
          http_status: error.response?.status,
          message: error.message,
          data: error.response?.data,
          duration_ms: duration,
        };
      }
    }

    if (slipRecordId) {
      try {
        // legacy:2147 — the whole map in one field, written once after the
        // loop. Not per-URL, so a crash mid-loop records nothing.
        await this.slipModel.findByIdAndUpdate(slipRecordId, {
          callback_response: results,
        });
        const okCount = Object.values(results).filter(
          (r) => r.status === 'success',
        ).length;
        this.logger.log(
          `[CALLBACK] SlipVerification ${String(slipRecordId)} updated. ` +
            `Total successful callbacks: ${okCount}/${callbackUrls.length}`,
        );
      } catch (err) {
        this.logger.error(
          `[CALLBACK] DB Update Failed: ${(err as Error).message}`,
        );
      }
    }
  }
}

/** Only the paths the success variant reads off Swiftcheck's `data`. */
interface SwiftcheckData {
  rawSlip?: {
    date?: string;
    transRef?: string;
    amount?: { amount?: number };
    sender?: SwiftcheckParty;
    receiver?: SwiftcheckParty;
  };
  [key: string]: unknown;
}

interface SwiftcheckParty {
  account?: {
    name?: { th?: string; en?: string };
    bank?: { account?: string };
    proxy?: { account?: string };
  };
  bank?: { short?: string; name?: string };
}
