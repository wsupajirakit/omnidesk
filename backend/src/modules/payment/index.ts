/**
 * [FEAT-20260808-PAYTOOL-P2] Public surface — import '@/modules/payment'.
 *
 * 📍 [DOC-20260810-PAYSTATES] `ReplyState` below is the state machine's leaf set.
 * All of them — flex vs text, where each string lives, which knob overrides it —
 * are mapped in `docs/payment-states.md` (LOCAL ONLY, not pushed: `.gitignore:46`
 * ignores `*.md` repo-wide by policy). แผนที่ state ทั้งหมด: `docs/payment-states.md`.
 */
export { PaymentModule } from './payment.module';
export {
  PaymentRunnerService,
  type PaymentOutcome,
  type PaymentRunResult,
  // [FEAT-20260809-PAYTOOL-COPY] Exposed so callers can type against the state
  // set through the barrel instead of reaching into the service file.
  type ReplyState,
} from './payment-runner.service';
export {
  buildValidateSlipHeaders,
  canonicalizePayloadField,
} from './validate-slip-signer';
/**
 * [FEAT-20260809-PAYTOOL-COPY] Every customer-facing string of the payment
 * feature. แก้คำที่ลูกค้าเห็น = แก้ไฟล์เดียว. See payment-reply-copy.ts for what
 * each state means and which `tool.payment.*` key overrides it.
 */
export {
  REPLY_TEXT,
  BUTTON_LABELS,
  CONTACT_ADMIN_MESSAGE,
  // [FEAT-20260831-ADMINVIAWITHDRAW] its sibling — see the copy file
  CONTACT_ADMIN_WITHDRAW_MESSAGE,
  // [FEAT-20260831-ADMINDIRECT] how the direct case is filed
  CONTACT_ADMIN_ACK_TEXT,
  CONTACT_ADMIN_TICKET_CATEGORY,
  CONTACT_ADMIN_TICKET_NEED,
  // [FIX-20260902-ADMINDIVIDER] the sentence the ADMIN reads when this case opens
  contactAdminTicketDivider,
  MINT_FLEX_ALT_TEXT,
} from './payment-reply-copy';
// [FEAT-20260811-PAYRESPEXAMPLES] display-only central spec + its route.
export {
  PAYMENT_REPLY_STATE_RESPONSE_EXAMPLES,
  type ReplyStateResponseExample,
} from './payment-reply-response-examples';
/* [FIX-20260817-RESUMEDEDUPE] leg log key + who triggered the leg. */
export { buildLegDedupeKey, legTriggeredBy } from './payment-leg-dedupe';
/* [FEAT-20260903-TOPUPPERPROVIDER] which Shop-API path a slip's topup call goes to.
   Exported for its spec — a deep path into a module's internals is an eslint
   error by this repo's layering rule, tests included. */
export {
  findTopupEndpoint,
  type EndpointLike,
} from './payment-endpoint.helper';
/* [FEAT-20260903-RESUMEPROVIDERGUARD] did the hook's provider change while a
   retry sat paused? Exported for its spec — the layering rule forbids a deep
   path into a module's internals, tests included. */
export {
  providerChangedSinceVerification,
  resolveForCompare,
  type ProviderRef,
} from './payment-provider-guard';
export { PaymentController } from './payment.controller';

// [FEAT-20260823-TOPUPDUP] default การ์ด duplicate ให้ state topup_duplicate
export { withSwiftcheckDuplicateFallback } from './payment-state-flex.resolver';
// [FEAT-20260907-UNKNOWNPROFILEREVIEW] `resolveStateFlex` gains a second caller —
// the webhook's unknown-profile review — so it is exported HERE rather than
// reached for inside the module. Its neighbour above already goes through this
// barrel, and `no-restricted-imports` bans deep paths into a module precisely so
// a second consumer cannot quietly grow a second import path to the same rule.
// (Line comments on purpose: the pattern that rule matches contains the
// characters that end a block comment, and writing it inside one truncates the
// file — which is exactly what happened here first.)
// ผู้ใช้คนที่สอง = ต้องออกทางประตูหน้า ไม่ใช่ลัดเข้าไฟล์ใน
export {
  resolveStateFlex,
  type PaymentStateFlexInput,
  type PaymentStateFlexResult,
} from './payment-state-flex.resolver';
