/**
 * ==== [MAP-20260903-SLIPFLOW] the way in, the way out, and the switches ======
 *
 * The front door of this module, and the ONLY place in the repository that says
 * how a customer's slip travels from LINE to a card and on into the money legs.
 * The long form is `docs/slip-spec.md` §15 — but `.gitignore` keeps every `*.md`
 * out of git, so that document does not exist for someone who only has the code.
 * This block does. Keep it here for that reason.
 *
 * ── THE WAY IN ──────────────────────────────────────────────────────────────
 *   `WebhookService.processWebhook` → `processLockedEvent` → the unlinked-customer
 *   gate → the QR pre-scan → the verify gate → `SlipFlowService.verifySlip`,
 *   which is where the path ENTERS this module, resolves the provider per call
 *   and writes the stamped `slip_verifications` row.
 *
 *   📄 The step-by-step map, with every line number resolved individually, is
 *   `docs/slip-spec.md` §15.1. It is not repeated here on purpose — a second copy
 *   drifts, and the numbers in it are the part that drifts first.
 *
 * ── THE THREE SWITCHES — independent, and each fails toward silence ─────────
 *
 *   1. VERIFY        `hook.slip_check === true && !!hook.slip_verify_key`
 *                    `SlipFlowService.isSlipVerifyEnabled`
 *                    OFF ⇒ no provider call, no row, nothing billed. Gated
 *                    TWICE — at the call site AND inside `verifySlip` itself,
 *                    which returns early and writes nothing even if the outer
 *                    gate is ever bypassed.
 *                    Pinned by `webhook-flow-matrix.spec.ts` case B1.
 *
 *   2. REQUIRE LINK  `hook.slip_require_profile`
 *                    `webhook/slip-flex/require-profile.gate.ts`
 *                    ON + customer not linked ⇒ answers "link your account
 *                    first", opens a ticket forced to category `Payment`, and
 *                    RETURNS — the provider is never called, so an unlinked
 *                    customer cannot burn a billed verification.
 *
 *   3. MOVE MONEY    `hook.payment_tool_status` (+ `payment_tool_id`)
 *                    `PaymentRunnerService.resolvePaymentTool` — GATE A
 *                    OFF ⇒ the slip is still verified and still answered by a
 *                    card; only the topup/walletpay legs are skipped.
 *
 *   ⇒ Turning any one off leaves the other two exactly as they were. There is no
 *   combined switch and there must not be one — the isolation is what lets a hook
 *   run slip-checking with payment off, which is what most of them do.
 *
 *   ⚠️ NONE OF THE THREE NEEDS CONFIGURING TO KEEP TODAY'S BEHAVIOUR. An empty
 *   `hook.slip_provider`, an absent one, and an unregistered name all resolve to
 *   `DEFAULT_SLIP_PROVIDER` — see `providers/index.ts`. Doing nothing is the
 *   supported way to stay on the current provider.
 *
 * ── THE WAY OUT — two exits, mutually exclusive ─────────────────────────────
 *   The slip answer is written TWICE inside `processLockedEvent`: once for a room
 *   an admin is holding, once for an ordinary room. Both end in `return`, so
 *   exactly one runs per event, and both do the same three things in the same
 *   order — payment suppression → the slip card → the partner callback.
 *   `z-test/unit/slip-answer-twin-sites.spec.ts` goes red the moment they diverge.
 *   📄 Why there are two, and why they are not merged: `docs/slip-spec.md` §15.2, §16.
 *
 * ── AND THEN THE MONEY ──────────────────────────────────────────────────────
 *   The row's `raw_response` holds the PROVIDER'S OWN envelope, verbatim, and the
 *   payment leg forwards it to Shop-API. Swapping the provider swaps that shape, and
 *   the failure surfaces REMOTELY — after the slip is verified, locked and
 *   answered. Nothing throws here. See `[DECISION-20260903-VERIFYFEEDSPAYMENT]`.
 *
 * ── 🔴 STANDING RULE — owner, 03/09 ─────────────────────────────────────────
 *   ANYTHING NEW ON THIS PATH GOES IN ITS OWN FUNCTION, IN ITS OWN FILE.
 *   Never another inline block inside `processLockedEvent`.
 *
 *   The existing size is deliberately NOT being refactored away — measured and
 *   closed 03/09 (`docs/slip-spec.md` §16): extracting the slip half moves ~2% of
 *   `webhook.service.ts` while touching the money path, so it is not worth it.
 *   The decision was to stop making it worse, not to pay to undo it.
 *   ของใหม่แยกไฟล์แยกฟังก์ชันเสมอ · ห้ามยัดเพิ่มในเมธอดเดิม
 */

/** Public surface of the slip module — import '@/modules/slip'. */

export { SlipModule } from './slip.module';
export { SlipVerificationService } from './slip-verification.service';

/**
 * The ported inbound slip flow. Exported so `src/modules/webhook/` can wire it
 * without reaching into this module's internal files (lint-blocked), and so its
 * unit tests can build it in isolation with a stubbed HTTP client.
 *
 * ⚠️ `QrVisionService.checkIfSlipWithQrCode` calls Gemini and bills per token.
 * Read its file header before writing any code that reaches it.
 */
export { QrVisionService } from './qr-vision.service';
export {
  SlipFlowService,
  type CallbackResultEntry,
  type SlipCallbackInput,
  type SlipHookLike,
  type SlipStorageLike,
  type VerifySlipInput,
  type VerifySlipResult,
} from './slip-flow.service';

export {
  SlipVerification,
  SlipVerificationSchema,
  type SlipVerificationDocument,
} from './schemas/slip-verification.schema';

/**
 * [FEAT-20260902-SLIPPROVIDER] The slip-verification seam.
 *
 * Exported for its specs, which must reach it through the barrel — a deep path
 * into a module's internals is an eslint error by this repo's layering rule
 * (`eslint.config.mjs` `no-restricted-imports`), tests included.
 *
 * ⚠️ These are NOT Nest providers and must not be added to `slip.module.ts`.
 * `SlipFlowService` holds one directly, because the port takes `apiKey` and
 * `baseUrl` as plain values (decrypted and resolved by the caller) and so needs
 * no injection. Making it a constructor dependency would break every suite that
 * builds the service with a fixed provider list — the three slip specs — and the
 * three e2e boots that go through `AppModule`, all in the same commit that
 * touches the money path.
 */
export {
  BINARY_PLACEHOLDER,
  /* [FEAT-20260903-PROVIDERSWITCH] the switchboard — one line per provider, one
     word to switch. Exported for its spec, which drives the switch rather than
     describing it. */
  buildProviderRegistry,
  resolveDefaultProvider,
  SLIP_PROVIDER_ENTRIES,
  type SlipProviderEntry,
  DEFAULT_SLIP_PROVIDER,
  SLIP_PROVIDERS,
  SWIFTCHECK_TIMEOUT_MS,
  redactImageField,
  /* [FEAT-20260903-BASEURLPERPROVIDER] exported for its spec — the registry is
     the single truth for hosts and this is the one function that reads it. */
  resolveBaseUrl,
  resolveSlipProvider,
  /* [FEAT-20260903-CATCHSEAM] exported so its spec can drive it without a deep
     path into this module's internals, which the layering rule forbids. */
  sendWithRecovery,
  swiftcheckProvider,
  /* [FEAT-20260903-SLIPGUARD] written and tested, NOT registered — see the note in
     `providers/index.ts`. Exported for its spec only. */
  slipguardProvider,
  slipGuardBangkokDate,
  slipGuardVerdictFor,
  SLIPGUARD_ERROR_VERDICTS,
  type SlipProvider,
  type SlipVerifyInput,
  type SlipVerifyRequest,
  type SlipVerifyResponse,
} from './providers';

/**
 * [FEAT-20260903-FIELDOPTIONS] slip's own answer to "what may `slip_provider` be
 * set to?", built from the live registry. Read by `@/modules/options`, which is a
 * leaf and holds one line pointing here — slip is a SUB-entry of that pipe, not
 * its subject, so the vendor knowledge stays in this module.
 */
export {
  SLIP_PROVIDER_LABEL_NS,
  slipProviderOptions,
} from './providers/slip-provider.options';
