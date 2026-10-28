/**
 * [PROG-20260905-LADDER] THE ORDER. One array, one line per step.
 *
 * This file is the answer to *"how do you add, remove or move a gate without reading a
 * 3,486-line method first"*. The order of the ladder used to exist only as physical line
 * position inside `processLockedEvent`, which meant it could only be DEFENDED in prose —
 * and that is why the method carries more comment lines than code lines.
 *
 * ADDING A STEP is: write `<name>.step.ts` next to this file, declare what it must follow
 * or precede and why, and add one line below. Nothing else in the repo changes.
 * REMOVING one is deleting its line. SWITCHING one off is `enabled: false` in its own file.
 *
 * ⚠️ THE ARRAY ORDER IS THE RUNTIME ORDER. `assertLadderOrder` proves it is a topological
 * sort of every declared constraint, so a reorder that contradicts one fails by name in
 * `gate-ladder-order.spec.ts` instead of on a customer.
 *
 * 📖 THE READER'S ENTRY POINT IS `docs/flow/webhook-flow-and-gates.md` — the whole turn,
 * every gate and its reason, the data chain, and the rules for adding one. It is GENERATED
 * from this file (`npm run gen:flow-doc`), so it cannot drift from the order below; edit
 * the steps, then regenerate.
 *
 * ⚠️ WHAT IS *NOT* HERE YET, so nobody reads this list as the whole ladder. This is the
 * tail: from the close of the big `if (userId)` block down to the reply-tag resolution.
 * The rest of the 65 guards move in later save points, patch-free segment by patch-free
 * segment — ten plug-patch boxes sit inside the method and their bytes cannot move at all
 * until Phase 5. The migration plan and the arithmetic are in
 * `todo/task/05092026/webhook_gate_ladder_design.md`.
 */

import { adminDoorDirectStep, adminDoorWithdrawStep } from './admin-doors.step';
import { aiAuditRowStep } from './ai-audit-row.step';
import { apiErrorRefusalStep } from './api-error-refusal.step';
import { apiErrorTriggerStep } from './api-error-trigger.step';
import { askModelStep } from './ask-model.step';
import { assistBypassStep } from './assist-bypass.step';
import { assistHandOffStep } from './assist-hand-off.step';
import { botChatRowStep } from './bot-chat-row.step';
import { customerRegisterStep } from './customer-register.step';
import { docRetrievalStep } from './doc-retrieval.step';
import { ensureRoomStep } from './ensure-room.step';
import { flexPcSafeTextStep } from './flex-pc-safe-text.step';
import { followUpStep } from './follow-up.step';
import { helperQrBodyStep } from './helper-qr-body.step';
import { imageAnswerTextStep } from './image-answer-text.step';
import { imageAssistHandOffStep } from './image-assist-handoff.step';
import { imageStoreStep } from './image-store.step';
import { qrPrescanStep } from './qr-prescan.step';
import { unlinkedSlipDecideStep } from './unlinked-slip-decide.step';
import { unknownProfileReviewStep } from './unknown-profile-review.step';
import { unlinkedSlipRefuseStep } from './unlinked-slip-refuse.step';
import { missingProfileReplyStep } from './missing-profile-reply.step';
import { slipCardSentStep } from './slip-card-sent.step';
import { slipFlexSendStep } from './slip-flex-send.step';
import { noticeTextGuardStep } from './notice-text-guard.step';
import { outOfHoursStep } from './out-of-hours.step';
import { registeredEventStep } from './registered-event.step';
import { requireUserTextStep } from './require-user-text.step';
import { requireSomethingToSendStep } from './require-something-to-send.step';
import { rereadEventStep } from './reread-event.step';
import { resolveReplyTagsStep } from './resolve-reply-tags.step';
import { resolveReplyTextStep } from './resolve-reply-text.step';
import { sendAiReplyStep } from './send-ai-reply.step';
import { stalenessGuardStep } from './staleness-guard.step';
import { taggedImageReplyStep } from './tagged-image-reply.step';
import { verifySignatureStep } from './verify-signature.step';
import { tagStripProbeStep } from './tag-strip-probe.step';
import { telegramNoAnswerStep } from './telegram-no-answer.step';

import type { InlineSpineStep, LadderStep } from './ladder.types';

/**
 * The tail of the ladder, in the order it runs.
 *
 * Read it top to bottom and it is the turn: is the OA switched off · does another handler
 * own this event type · is there anything to answer · did the profile fetch fail · fetch
 * the document context · ask the model · refuse an answer built on nothing · choose what
 * to say · file it · audit it · page an operator if there was no answer · hand over if the
 * answer asked for a human.
 */
export const TAIL_LADDER: readonly LadderStep[] = [
  outOfHoursStep,
  registeredEventStep,
  requireUserTextStep,
  apiErrorTriggerStep,
  docRetrievalStep,
  askModelStep,
  apiErrorRefusalStep,
  resolveReplyTextStep,
  botChatRowStep,
  aiAuditRowStep,
  telegramNoAnswerStep,
  assistHandOffStep,
  resolveReplyTagsStep,
  taggedImageReplyStep,
  helperQrBodyStep,
];

/**
 * Ladder positions this slice constrains against that are STILL WRITTEN INLINE in
 * `webhook.service.ts`.
 *
 * This is a to-do list that fails loudly if it lies: every entry has to be named by a real
 * constraint, and `assertLadderOrder` refuses an id that is in neither list. It shrinks to
 * nothing as the remaining segments migrate.
 */
export const INLINE_ABOVE_TAIL: readonly InlineSpineStep[] = [
  {
    id: 'non-text-branch',
    relativeToLadder: 'before',
    at: 3588,
    describe:
      "if (event.type === 'message' && event.message?.type !== 'text') — the terminal " +
      'sub-ladder for media; every path inside it ends the turn',
  },
];

/**
 * THE SECOND SLICE — everything after the flex-card build.
 *
 * ⚠️⚠️ WHY THE LADDER IS IN TWO PIECES, and it is not a design preference. The flex build
 * (`flexDeps` → `flexArgs` → `flexOut` → `flexKind` → `flexProfileContents`) is ONE
 * expression whose tail is a plug-patch box: `webhook.service.ts:4449-4472` belongs to
 * `docs/menu-plug-in.patch` and contains `flexKind === 'menu'`, `tags.wantedMenuCardTag`,
 * `flexOut` and the closing `: null) ?? null) as Record<string, unknown> | null;`. Those
 * are frozen bytes, so those names must stay locals of the spine — and an expression
 * cannot be cut in half. The build stays inline until Phase 5; the ladder resumes after it.
 *
 * The same context and the same deps are reused, so the second call costs one line, not a
 * second turn's worth of wiring. บันไดขาด เพราะกล่อง patch คั่นอยู่ ไม่ใช่เพราะออกแบบให้ขาด
 */
export const REPLY_LADDER: readonly LadderStep[] = [
  tagStripProbeStep,
  flexPcSafeTextStep,
  requireSomethingToSendStep,
  stalenessGuardStep,
  sendAiReplyStep,
];

/**
 * THE PROLOGUE — the ladder's FIRST slice, run as soon as the credentials are known.
 *
 * Establishing identity: is this body really from LINE, which event is it actually about,
 * and does the customer have a room. Everything below depends on all three, which is why
 * they run before anything else the ladder owns.
 *
 * ⚠️ IT STOPS AT THE PAYMENT POSTBACK. That seat and the menu seat below it are inside
 * `docs/menu-plug-in.patch`'s box — `if (payPb.handled) return;` is a frozen byte — so the
 * ladder resumes after them. Three slices, one context, one deps object.
 */
export const PROLOGUE_LADDER: readonly LadderStep[] = [
  verifySignatureStep,
  rereadEventStep,
  ensureRoomStep,
];

/**
 * THE ASSIST-BYPASS SLICE — one step, and the split is the plug boxes again.
 *
 * An operator is holding the room. It cannot join `IMAGE_REFUSAL_LADDER` above it (the
 * video branch and the inbound chat row sit in between, and the inbound row is what makes
 * `customerMsg` final) nor `CUSTOMER_LADDER` below it (the rate limiter is between them,
 * and a `strike-plug` hunk owns bytes inside that).
 *
 * ⚠️ WHERE IT SITS IS THE FEATURE, not an arrangement: below the slip verify so a
 * customer's money is still checked and filed while an admin is in the room, above the
 * rate limiter, the keyword handler, the AI and the non-text branch so none of those
 * speak. Moving it up stops the slip being verified; moving it down lets the bot talk over
 * a human.
 */
export const ASSIST_BYPASS_LADDER: readonly LadderStep[] = [assistBypassStep];

/**
 * THE CUSTOMER SLICE — the free run inside `if (userId)`, after the rate limiter.
 *
 * ⚠️ IT RUNS INSIDE A SCOPE, and the scope is a `when` on every step rather than a nesting
 * level: `if (userId)` is not a gate, it is a precondition shared by its children. Here it
 * holds by construction — the slice is invoked from inside the block — and the day the
 * whole block becomes steps, each carries `when: (ctx) => Boolean(ctx.userId)`.
 *
 * ⚠️ THE SLICE STARTS AFTER THE RATE LIMITER because a `strike-plug` hunk owns bytes
 * inside it, and stops before the non-text branch because four `menu-plug` hunks own bytes
 * inside that. Both stay inline until Phase 5.
 */
export const CUSTOMER_LADDER: readonly LadderStep[] = [
  adminDoorDirectStep,
  adminDoorWithdrawStep,
  noticeTextGuardStep,
  followUpStep,
  customerRegisterStep,
];

/**
 * THE IMAGE SLICE — the top of the image branch, inside `if (userId)`.
 *
 * ⚠️ THE ORDER IS THE FEATURE, not an implementation detail (owner, 12/08): store the
 * picture → ask whether it carries a QR at all → only then consult "รับสลิปเฉพาะลูกค้าที่
 * ผูกบัญชีแล้ว". Reading the account setting first refuses an ordinary photo with "please
 * link your account first", which is a defect that reached live traffic on 12/08 before
 * `qrPrescanSawSlip` existed. Each step names the one before it, so this is now checked.
 *
 * ⚠️ NONE OF THE THREE REPLIES. The refusal `blockUnlinked` earns sits past the notice
 * guard, because the notice runtime gets the first turn (owner, 24/08). A step here that
 * sent the refusal itself would silently reverse that decision.
 *
 * ⚠️ IT STOPS AT THE NOTICE GUARD because that guard's `consumeQuota` closure holds a
 * `docs/strike-plug-in.patch` box. The guard, the refusal and the slip verify below it are
 * frozen inline until Phase 5.
 */
export const IMAGE_LADDER: readonly LadderStep[] = [
  imageStoreStep,
  qrPrescanStep,
  unlinkedSlipDecideStep,
];

/**
 * THE IMAGE SLICE, RESUMED — the far side of the notice guard.
 *
 * ⚠️ ONE STEP, AND THE SPLIT IS NOT A DESIGN CHOICE. `unlinked-slip-refuse` belongs with
 * the three steps above it: same branch, same feature, same decision. What separates them
 * is the slip-path notice guard, whose `consumeQuota` closure holds a
 * `docs/strike-plug-in.patch` box — frozen bytes that cannot move until Phase 5.
 *
 * ⚠️ AND THE GUARD MUST KEEP ITS PLACE BETWEEN THEM. `[FEAT-20260824-NOTICEFIRST]`: a slip
 * from a customer with no linked account meets the off-hours card BEFORE it meets "please
 * link your account" (owner, 24/08). Merging this step back into `IMAGE_LADDER` would put
 * the reply above the guard again and undo that silently — no test would fail on
 * behaviour, which is why `notice-before-requireprofile.spec.ts` asserts the order on the
 * source. ที่มันแยก เพราะ notice ต้องได้พูดก่อน
 */
export const IMAGE_REFUSAL_LADDER: readonly LadderStep[] = [
  unlinkedSlipRefuseStep,
  /* [FEAT-20260907-UNKNOWNPROFILEREVIEW] The third answer to the same probe, so
     it sits with the refusal rather than anywhere else: both are replies that
     `unlinked-slip-decide` computed and the notice guard had to speak before.
     ⚠️ ORDER WITHIN THIS SLICE IS NOT ARBITRARY EITHER. The refusal is first
        because its verdict is the stronger one — "this customer does not exist"
        is knowledge, "we could not find out" is the absence of it. The two flags
        are mutually exclusive by construction, so this is belt and braces rather
        than a live race; putting the weaker answer first would still be wrong
        the day that construction is edited. */
  unknownProfileReviewStep,
];

/**
 * THE MEDIA SLICE — inside the non-text branch, inside `if (userId)`.
 *
 * Every path through the branch this runs in ENDS THE TURN — that is what makes it a
 * terminal sub-ladder rather than a detour. Five steps: run payment and send the slip
 * card, hand off to an operator when the OA's media reply carries the marker, exit if a
 * card went out, answer an unregistered customer, and resolve the media reply text.
 *
 * ⚠️ IT STOPS AT THE SEND. The `try` that follows it in the spine belongs to
 * `docs/menu-plug-in.patch` — four hunks own the menu card, the stamp, the wlog row and
 * the history row inside it — so the send stays inline and this slice hands it
 * `media.cleanImageAnswer`. Phase 5 or nothing.
 */
export const MEDIA_LADDER: readonly LadderStep[] = [
  slipFlexSendStep,
  imageAssistHandOffStep,
  slipCardSentStep,
  missingProfileReplyStep,
  imageAnswerTextStep,
];

/**
 * All slices, in the order the turn actually runs them.
 *
 * ⚠️ THIS IS WHAT THE ORDER AND DATA-CHAIN FENCES CHECK, not the two arrays separately.
 * The slices are one ladder interrupted by a patch box, so a constraint from the reply
 * slice back to the model lane (`send-ai-reply` mustFollow `bot-chat-row`) is a real,
 * checkable edge — and checking each slice alone would silently drop every such edge,
 * which is the failure mode a fence must never have.
 */
export const FULL_LADDER: readonly LadderStep[] = [
  ...PROLOGUE_LADDER,
  /* ⚠️ BEFORE the customer slice, which reads as backwards until you look at the spine:
     the image branch opens at `webhook.service.ts:2686` and the customer slice runs at
     `:3560`, both inside the same `if (userId)`. This array is the RUNTIME order, and the
     data-chain fence is only worth anything while that stays true. */
  ...IMAGE_LADDER,
  ...IMAGE_REFUSAL_LADDER,
  ...ASSIST_BYPASS_LADDER,
  ...CUSTOMER_LADDER,
  ...MEDIA_LADDER,
  ...TAIL_LADDER,
  ...REPLY_LADDER,
];
