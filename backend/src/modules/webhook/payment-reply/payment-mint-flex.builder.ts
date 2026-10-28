/**
 * ==== [FEAT-20260808-PAYTOOL-P3] the payment "mint" flex card ====
 *
 * 📍 [DOC-20260810-PAYSTATES] THE MAP OF ALL REPLY STATES — which are flex vs
 * text, where each string comes from, and which knob overrides it — is
 * `docs/payment-states.md` (LOCAL ONLY, not pushed: `.gitignore:46` ignores
 * `*.md` repo-wide by policy). This file renders ONE of those states' cards; it
 * does not decide which state happens. อ่านแผนที่ทั้งหมดที่ `docs/payment-states.md`.
 *
 * WHAT: builds the FLEX the payment feature sends. Which states are flex is
 * decided by `kind` in REPLY_STATE_DEFAULTS (payment-runner.service.ts) — TODAY
 * that is `no_match_retry` AND `review`; every other outcome is plain text.
 * ⚠️ An earlier version of this comment said `review` was the ONLY flex state,
 * citing handoff_final_spec.md §C — that stopped being true when `no_match_retry`
 * was added, so trust `REPLY_STATE_DEFAULTS` (and the doc above), not this prose.
 * This renders that card: the runner's resolved `text`, the DETAIL line, and the
 * action buttons the runner asked for (`retry` / `contact_admin`).
 *
 * WHY A SEPARATE FILE: `webhook.service.ts` is already ~147 KB and
 * `slip-flex.handler.ts` owns the *slip* card, a byte-faithful legacy port.
 * Putting payment rendering in either would grow a file that is hard to read and
 * would mix new feature code into verified legacy parity code. Rendering is a
 * pure function of `reply` — no I/O, no DB, no LINE call — so it isolates
 * cleanly and unit-tests without mocks. แยกไฟล์เพื่อไม่ให้ไฟล์บวมและกัน
 * feature ใหม่ปนกับโค้ด legacy ที่ verify แล้ว.
 *
 * WHY IT TAKES `PaymentRunResult['reply']` AND NOT loose args: that type is the
 * runner's published contract (state/kind/text/actions/detail). Consuming it
 * directly means a future state added to the runner is a COMPILE error here
 * rather than a silently unrendered card.
 *
 * HOW TO CHANGE IT LATER:
 *   · wording/labels        → BUTTON_LABELS / MINT_FLEX_ALT_TEXT in
 *     `payment/payment-reply-copy.ts` — NOT this file any more
 *     ([FEAT-20260809-PAYTOOL-COPY] moved every customer-facing string there).
 *   · colours / layout      → MINT_COLORS + the bubble literal in buildMintFlex
 *     (still here — styling is not wording).
 *   · a NEW button          → add to `ReplyAction` in the runner, then add one
 *     entry to BUTTON_LABELS (payment-reply-copy.ts) and one case in
 *     `buildAction` (here). Nothing else.
 *   · make a text state flex→ set `kind:'flex'` in the runner's
 *     REPLY_STATE_DEFAULTS; this builder already renders any state it is given.
 *   · buttons must DO something server-side → see the ⚠️ on `buildAction`.
 *
 * ⚠️ OPEN QUESTIONS — grep `[ASK-OWNER]` in this folder before go-live. Each one
 * marks a decision the spec does NOT settle, where the code runs on a stated
 * assumption rather than a confirmed answer. They are safe to develop and test
 * against, but must be CONFIRMED BY THE OWNER before this reaches real
 * customers. [[ask-dont-guess]] — เดาผิดบนเส้นทางเงิน = แก้ทีหลังแพง.
 *
 * revert: delete this folder + the `sendPaymentReply` seam in webhook.service.
 */
// [FEAT-20260809-PAYTOOL-COPY] The words this card shows are NOT defined here.
// Button labels, the contact-admin chat message, and the notification altText all
// live in one copy file (payment/payment-reply-copy.ts, reached through the
// payment barrel) so an operator edits wording in a single obvious place. This
// file renders; it does not author copy.
import {
  BUTTON_LABELS,
  CONTACT_ADMIN_MESSAGE,
  MINT_FLEX_ALT_TEXT,
  type PaymentRunResult,
} from '@/modules/payment';

import type { LineFlexContents } from '../line-api.service';
import { buildRetryPostbackData } from './payment-postback.handler';

/**
 * What the card needs to know BEYOND the reply text — currently only where a
 * [ลองใหม่] tap should resume.
 *
 * Present ⇒ the runner paused with statements left, so a retry is real work.
 * Absent  ⇒ there is nothing to resume to, and the retry button is omitted
 * rather than rendered as a dead control. See `buildAction`.
 */
export interface MintFlexContext {
  resume?: {
    /** The paused run to continue. */
    runId: string;
    /** The statement index to try next — the run's `resume_cursor`. */
    nextIdx: number;
  };
}

/**
 * ==== STATE REFERENCE — every reply state, in one place ====
 *
 * OWNER-DECIDED 2026-08-08: identifiers are ENGLISH and match the runner's
 * `ReplyState` exactly, so a state in a log, in the runner, in the config map,
 * and in this file are all the SAME word — greppable, easy to change.
 *
 * Each state's TEXT lives in REPLY_TEXT (payment/payment-reply-copy.ts) and is
 * config-overridable per tool via `tool.payment.*_reply_text`; the `kind`/
 * `actions` wiring lives in REPLY_STATE_DEFAULTS (payment-runner.service.ts).
 * This table documents what each state MEANS so a maintainer editing copy knows
 * what they are describing — it is documentation, deliberately NOT a second copy
 * of the strings.
 *
 * state                | kind | money moved?          | customer should do
 * ---------------------|------|-----------------------|--------------------------
 * topup_success        | text | YES — credited        | nothing, wait for credit
 * walletpay_success       | text | YES — credited        | nothing, wait for credit
 * matched_pending      | text | matched, admin to     | wait for admin
 *                      |      | confirm               |
 * no_match_retry       | FLEX | NO — paused, slip     | tap [ลองใหม่] to try the
 *                      |      | still claimed         | next statement
 * not_linked           | text | NO — lock RELEASED    | link the account, resend
 * review               | FLEX | UNKNOWN — human must  | contact admin (no retry:
 *                      |      | check (slip locked)   | nothing to advance to)
 * statement_not_found  | text | NO — released         | may resend the slip
 *
 * `no_match_retry` and `review` render this flex; the rest are plain text. If a
 * state is ever switched to `kind:'flex'` in the runner, this builder renders it
 * as-is.
 *
 * ══ WHERE TO EDIT WHAT (แก้ตรงไหน) ══════════════════════════════════════════
 * ทุกอย่างต่อ state แก้ได้จากที่เดียว ไม่ต้องไล่หาในโค้ด:
 *
 *   WHAT you want to change          WHERE (one place only)
 *   ────────────────────────────────────────────────────────────────────────
 *   ข้อความที่ลูกค้าเห็น (ต่อ tool)   `tool.payment.<state>_reply_text` — CONFIG,
 *                                     ไม่ต้องแก้โค้ด. Keys: reply_success_text,
 *                                     pending_reply_text, no_match_reply_text,
 *                                     review_reply_text, not_found_reply_text,
 *                                     not_linked_reply_text.
 *   ข้อความ default (ทุก tool)        REPLY_TEXT in
 *                                     payment/payment-reply-copy.ts   ← MOVED
 *   ข้อความบนปุ่ม                      BUTTON_LABELS in
 *                                     payment/payment-reply-copy.ts   ← MOVED
 *   ข้อความที่ปุ่มติดต่อแอดมินส่งเข้าแชท  CONTACT_ADMIN_MESSAGE in
 *                                     payment/payment-reply-copy.ts   ← MOVED
 *   altText (ที่โผล่ใน noti)           MINT_FLEX_ALT_TEXT in
 *                                     payment/payment-reply-copy.ts   ← MOVED
 *   text ↔ flex ของ state             `kind` in REPLY_STATE_DEFAULTS
 *                                     (payment-runner.service.ts)
 *   ปุ่มไหนโผล่ใน state ไหน            `actions` in REPLY_STATE_DEFAULTS
 *   ปุ่มกดแล้วทำอะไร                   buildAction (this file)
 *   สี / หน้าตาการ์ด                   MINT_COLORS + the bubble (this file —
 *                                     styling stayed, wording left)
 *   เงื่อนไขว่า state ไหนเกิดเมื่อไหร่   the runner's flow — _runWalletpay /
 *                                     _classifyTopup / _classifyWalletpay
 *   detail ใต้ข้อความ                  `tool.payment.reply_detail` (CONFIG)
 *
 * เพิ่ม state ใหม่: ReplyState + REPLY_STATE_DEFAULTS (runner) → REPLY_TEXT
 * (payment-reply-copy.ts) → STATE_NOTES (ที่นี่) → knob ใน
 * custom-tool-normalize.ts. เทสต์จะ fail ถ้าลืม STATE_NOTES.
 */
export const STATE_NOTES = {
  topup_success: 'credited via topup process-wallet',
  walletpay_success: 'credited via walletpay matched + confirmed',
  matched_pending: 'walletpay matched, awaiting admin confirm',
  // [NOTLINKED] no linked account — customer links then resends. Lock RELEASED.
  not_linked:
    'LINE has no linked web account — nothing credited, lock released',
  // [2c] the ONLY state that carries a working retry button.
  no_match_retry:
    'walletpay said no_match, statements remain — paused for [ลองใหม่] at x+1',
  review: 'unknown outcome, slip locked, needs human review',
  statement_not_found: 'no statement matched, lock released, resend allowed',
} as const;

/**
 * Card colours, named so the bubble literal below stays readable.
 * "mint" is the owner's name for this card, hence the module name.
 *
 * OWNER-DECIDED 2026-08-08: design it now, keep it easy to restyle later.
 * No design reference exists in the repo or the spec, so this is a deliberate,
 * conservative choice rather than a brand match:
 *   · `accent` — a calm green for the money context. The ONLY saturated colour;
 *     used for the header strip so the card is identifiable at a glance.
 *   · `text` / `muted` — near-black and grey, so the body reads as information,
 *     not as an alarm. A `review` card is not an error card: the money may still
 *     be fine, a human just has to look.
 *   · `line` — hairline separator between message and detail.
 *
 * TO RESTYLE: change these four values and nothing else — every colour in the
 * bubble below references this object, there are no inline hex literals. To swap
 * in OA brand colours later, `accent` is the one to change first.
 */
const MINT_COLORS = {
  accent: '#16A34A',
  text: '#111827',
  muted: '#6B7280',
  line: '#E5E7EB',
} as const;

/**
 * One flex button.
 *
 * ==== BUTTON BEHAVIOUR — OWNER-ANSWERED 2026-08-08 (1ans.md §3) ====
 *
 * `retry` is a SERVER-SIDE resume, not a re-upload:
 *   กด [ลองใหม่] = ส่งภาพสลิปเดิม + statement ตัวถัดไป (x+1)
 * The customer does NOT photograph anything again. The saved slip image is
 * re-sent to walletpay against the NEXT statement in the list, because the
 * statement already tried is locked and must never be retried.
 *
 * ⚠️ THIS IS NOT YET IMPLEMENTED — it needs Phase 2c (statement-level lock +
 * per-statement loop + a run cursor to resume from) AND a postback handler,
 * neither of which exists today. Until 2c lands, `buildAction` below still
 * renders the interim CLIENT-SIDE actions, which are WRONG per the answer
 * above and are marked as such at the call site. Do not treat the current
 * render as the agreed behaviour.
 *
 * `contact_admin` → `message`: posts a Thai phrase into the chat, which is what
 * an operator sees and answers (it also trips the existing assist/handoff path).
 * No admin URL field exists on the hook schema, so a link would be a schema
 * change. This one is unaffected by 2c.
 */
function buildAction(
  action: string,
  ctx: MintFlexContext,
): Record<string, unknown> | null {
  const label = BUTTON_LABELS[action];
  if (!label) return null; // unknown action ⇒ render nothing rather than a broken button

  switch (action) {
    case 'retry': {
      // [2c] The agreed behaviour (1ans.md §3): a POSTBACK that resumes the SAME
      // run at the NEXT statement with the SAME stored slip image. The customer
      // does not re-photograph anything.
      //
      // ⚠️ A retry button is only meaningful when there IS somewhere to resume
      // to. `resume` is supplied only for the `no_match_retry` state, where the
      // runner paused with statements left. On `review` — timeout / exhausted /
      // ambiguous — there is nothing to advance to, and offering "ลองใหม่" there
      // would be a lie that re-opens a money-unknown case. So: no resume context
      // ⇒ NO retry button (the card still renders with contact-admin).
      if (!ctx.resume) return null;
      return {
        type: 'postback',
        label,
        data: buildRetryPostbackData(ctx.resume.runId, ctx.resume.nextIdx),
        // The tap leaves no trace in the chat: the customer sees the new reply,
        // not a raw `pay:resume:...` payload echoed back at them.
        displayText: label,
      };
    }
    case 'contact_admin':
      // Both strings are copy, both live in payment-reply-copy.ts: `label` is what
      // the button says, CONTACT_ADMIN_MESSAGE is what gets posted into the chat.
      return { type: 'message', label, text: CONTACT_ADMIN_MESSAGE };
    default:
      return null;
  }
}

/**
 * Build the mint flex bubble from the runner's `reply`.
 *
 * `detail` is always non-empty ("-" when the tool has no `payment.reply_detail`,
 * guaranteed by the runner at P2B), so the detail row renders unconditionally —
 * no empty-string branch is needed here.
 */
export function buildMintFlex(
  reply: NonNullable<PaymentRunResult['reply']>,
  ctx: MintFlexContext = {},
): LineFlexContents {
  const buttons = (reply.actions ?? [])
    .map((a) => buildAction(a, ctx))
    .filter((a): a is Record<string, unknown> => a !== null)
    .map((action) => ({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action,
    }));

  const body: Record<string, unknown>[] = [
    {
      type: 'text',
      text: reply.text,
      wrap: true,
      weight: 'bold',
      size: 'md',
      color: MINT_COLORS.text,
    },
    { type: 'separator', margin: 'lg', color: MINT_COLORS.line },
    {
      type: 'text',
      text: reply.detail,
      wrap: true,
      size: 'sm',
      margin: 'lg',
      color: MINT_COLORS.muted,
    },
  ];

  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: body,
    },
    // A footer with zero buttons would render as an empty grey strip, so the
    // whole footer is omitted when nothing survives `buildAction`.
    ...(buttons.length > 0
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: buttons,
          },
        }
      : {}),
    styles: { footer: { separator: true } },
  };
}

/**
 * Re-exported so the delivery layer and its tests keep importing one alt text
 * from the render layer, unchanged by [FEAT-20260809-PAYTOOL-COPY]. The VALUE now
 * comes from payment/payment-reply-copy.ts; this is only the same door it was
 * always behind. Edit the word there, not here.
 */
export { MINT_FLEX_ALT_TEXT };
