/** Public surface of the webhook module — import '@/modules/webhook'. */

export * from './webhook.module';
export * from './webhook.service';
export * from './webhook.controller';
export * from './line-signature.guard';
export * from './line-api.service';
export * from './line-content.service';

/**
 * The AI seam. Exported so a test can assert what the ingest pipeline hands the
 * provider WITHOUT a provider existing — which is the only way to check that a
 * billed credential never crosses it.
 */
export * from './ai-reply/ai-reply.provider';
// [FEAT-20260810-DOCRETRIEVAL] the retrieval seam + its RAG adapter.
export * from './doc-retrieval/doc-retrieval.provider';

/**
 * The assist-summary seam, exported for the same reason as the reply seam: the
 * whole [[[assist]]] hand-off — room claim, ticket, Telegram card — can be
 * driven and asserted with no model behind it.
 */
export * from './ai-vendors/gemini/assist-summary.provider';
/* [FIX-20260818-STUBATBUILD] the scripted leg lives in its own file so a deploy
   build can replace it wholesale without touching the provider that answers
   real customers. Re-exported here, so every existing importer is unchanged.
   MERGE NOTE (18/08): dev put this file at the module root; this lane keeps it
   in `assist/` beside the rest of the hand-off seam, matching where the scripted
   REPLY provider already sits in `ai-reply/`. Same file, our layout. */
export * from './assist/scripted-assist-summary.provider';

/** The assist-summary call cap — exported so its ceiling can be tested directly. */
export * from './assist/assist-summary-cap.decorator';

/**
 * The hand-off itself. Exported so its concurrency behaviour can be tested
 * directly, without driving a webhook event through the model to reach it.
 */
export * from './assist/assist-notification';

/**
 * The `customer-register` keyword handler. Exported so its member-check + link
 * mint can be driven with faked deps, without a webhook event reaching it.
 */
export * from './hook-reply/customer-register.handler';

/**
 * [FEAT-20260827-PUSHCORE-B] The payment reply→push ladder, exported for its own
 * spec. `no-restricted-imports` forbids reaching into a module's internals, and
 * that rule is right: a test that deep-imports pins a path instead of a contract.
 * Only the pure function and its types leave — no service, no I/O — so nothing
 * here lets another module send LINE traffic behind the module's back.
 */
/**
 * [FEAT-20260828-PUSHCORE-G] the reply-through-the-core rule, exported for its
 * own spec — `no-restricted-imports` forbids deep-importing a module's internals
 * and that rule is right. A pure function and its types only; nothing here lets
 * another module send LINE traffic behind this one's back.
 */
export {
  flexReply,
  noticeFlexReply,
  replyViaCore,
  slipFlexReply,
  textReply,
  type CoreSend,
  type ReplySendResponse,
} from './hook-reply/reply-via-core';

export {
  deliverPaymentReply,
  type PaymentSendDeps,
  type PaymentSendOutcome,
  type PaymentSendPlan,
} from './payment-reply/payment-send.ladder';

/**
 * [FIX-20260808-SLIPFLOW] The customer-facing slip flex branch, exported so its
 * card selection + tag substitution can be driven with faked deps in a unit
 * test — no LINE socket, no Gemini call.
 */
export * from './slip-flex/slip-flex.handler';

/**
 * [FIX-20260808-CHAINPOSTBACK] The handoff-chain postback handler, exported so
 * the caller can wire it at the postback branch and tests can drive it directly.
 * Ports legacy `handoffChainPostback.handlePostback` (chain/postback.js).
 */
export * from './assist/handoff-postback.handler';

/**
 * [FIX-20260808-FLEXBUILDER] The flex profile / tag reply builders — the three
 * routes that answer with a card instead of text. Exported so the caller can
 * wire them at the `flexProfileContents` branch (webhook.service.ts, now wired)
 * and tests can drive each with faked deps, no network.
 */
export {
  buildFlexProfileReply,
  buildFlexTagReply,
  buildFlexProfileCustomReply,
  type FlexReplyArgs,
  type FlexReplyDeps,
  type FlexReplyDoc,
} from './flex/flex-profile-reply.builder';

/**
 * [FIX-20260808-FLEXVARMAP] The RUNTIME flex var-map assembly — fills flex cards
 * with REAL customer values. `buildFlexVarMaps` is the orchestrator the caller
 * injects as the reply builders' `buildDataVars` dep (closing over
 * `translationDict.translate`).
 */
export {
  buildFlexVarMaps,
  buildFlexProfileVarMap,
  buildSiteRulesVarMap,
  pickByRole,
  FLEX_VAR_SOURCES,
  type FlexBuildOpts,
  type TranslateFn,
} from './flex/flex-data-vars.util';

/**
 * [FEAT-20260814-PROMODROP] The render entry point and the promo-scoped
 * empty-bubble prune it runs — exported so tests drive the real pipeline
 * through the barrel instead of reaching into the module file.
 */
export { renderFlexDoc, dropEmptyPromoBubbles } from './flex/flex-render.util';
// [FEAT-20260821-RATELADDER] per-customer rate-limit escalation — policy + service.
export * from './rate-limit/user-rate-ladder';
export { UserRateLadderService } from './rate-limit/user-rate-ladder.service';
export type { UserRateVerdict } from './rate-limit/user-rate-ladder.service';
// [FIX-20260822-FLEXHISTORYTYPE] the history fields of a sent card, derived once.
export * from './flex/flex-history-meta';
export type { FlexReplyOut } from './flex/flex-reply-out';

// [FEAT-20260822-NOTICERUNTIME] Surface the notice-runtime checkers: the spec
// reaches them without a module-internal import (eslint no-restricted-imports),
// and they are owner-designed to be borrowed directly by other callers.
// revert: drop this line together with the notice-runtime/ folder.
export * from './notice-runtime';

// [FIX-20260822-NOTICEHARDEN] the lookback's skip list + its query fragment,
// surfaced so a spec can pin both without a module-internal import.
// [FIX-20260822-NOTICEHARDEN] the writer as well, so a spec can drive the real
// helper (both layers of the skip list) through the barrel instead of reaching
// into the module. เทสต้องเรียกผ่านประตูหน้า ไม่ใช่ลอดเข้าไฟล์ใน
export { stampAbandonTriggerOnce } from './follow-up/abandon-trigger.helper';
export {
  ABANDON_SKIPPED_REPLY_PREFIXES,
  abandonBotRowFilter,
  isSkippedReplyType,
  ABANDON_BOT_LOOKBACK,
  wasSentRegistrationCard,
} from './follow-up/abandon-trigger.rule';

// [FEAT-20261014-PROVFEATURES] two of the four provider-feature choke points (the other two
// are already on their barrels), surfaced so the spec drives them through the front door.
export { runFollowUpGate } from './follow-up/follow-up.gate';
export { helperQrBodyStep } from './gates/helper-qr-body.step';
export {
  CUSTOMER_REGISTER_KEYWORD,
  isCustomerRegisterKeyword,
} from './webhook-routing';
// [FIX-20261014-CUSTOMCIRCUIT] the profile check and the two slip rules that read its verdict,
// surfaced so the spec drives the shipped functions through the front door.
export { fetchCombinedProfile } from './room-bootstrap/combined-profile';
export {
  shouldBlockUnlinkedSlip,
  shouldReviewUnknownProfile,
} from './slip-flex/require-profile.gate';
