/**
 * ==== [FEAT-20260808-PAYTOOL-P2] payment runner — topup → walletpay, money-safe ====
 * branch: dev-handoff · standalone (NOT webhook-wired — that is Phase 3).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 📌 [DOC-20260810-PAYSTATES] CHANGING THIS FILE? UPDATE `docs/payment-states.md`
 * ══════════════════════════════════════════════════════════════════════════
 * That file is the single source of truth for the payment state machine: every
 * reply state, which are flex vs text, which topup answers stop before walletpay,
 * what each outcome means for the slip lock, and the direct-ticket rule. It is
 * written FROM this file, cites `file:line`, and NOTHING reads it at runtime —
 * so it drifts silently and only a human notices, usually after trusting a stale
 * claim. If you add/remove a state, change a `kind`, move a branch, or alter what
 * a state does to the lock or to tickets, update that doc in the SAME change.
 * ⚠️ If the doc and this code disagree, THE CODE IS RIGHT — fix the doc.
 * แก้ไฟล์นี้ = ต้องอัปเดต `docs/payment-states.md` ด้วย ไม่งั้นเอกสารโกหกเงียบ ๆ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔌 THE TWO EXTERNAL ENDPOINTS — owner-confirmed 2026-08-09
 * ══════════════════════════════════════════════════════════════════════════
 * These are the real contracts this runner was built against. They are recorded
 * here because "what does the far side actually expect" is the question every
 * future reader asks first, and it is answered nowhere else in the code.
 *
 *  LEG 1 topup   POST /shop-api/v1/customer/validate-slip
 *                multipart: line_user_id, web_code, payload (optional),
 *                           upload_file (the slip image)
 *                signed: HMAC_SHA256(web_code + timestamp + canonical), hex.
 *                canonical = JSON with sorted keys, no spaces, NO escaping;
 *                the file participates as `sha256:<hex>;filename:<name>`.
 *                → see validate-slip-signer.ts, which is the authority.
 *
 *  LEG 2 walletpay  POST {host}/api/v1/public/payin/{refId}/slip
 *                multipart: the slip image only. No auth.
 *                `refId` comes from the MEMBER STATEMENT, never from topup.
 *
 * ⚠️ CREDENTIALS LIVE IN THE TOOL RECORD, NEVER IN THIS REPO. `web_code` and the
 * HMAC secret are per-tool config (the secret encrypted at rest, decrypted at
 * call time). Do not paste a real secret into code, tests, .env.example, or a
 * commit message — a demo pair exists for manual testing and is not stored here.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🗺️  FLOW MAP — read this first when tracing what happens to a slip
 * ══════════════════════════════════════════════════════════════════════════
 * ไล่ flow ตามนี้ได้เลย · ทุกทางที่ payment ไม่ทำงาน = ของเดิม (Swiftcheck) ตอบเอง
 *
 *   ลูกค้าส่งสลิป
 *        │
 *        ▼
 *   Swiftcheck verifies (NOT ours — slip-flow.service.ts)
 *        │  returns: api_status (read ok?) + isDuplicate (seen before?)
 *        ▼
 *   ┌─ GATE A · payment tool ON?          resolvePaymentTool(hook)
 *   │    NO → skipped:'not_working' ──────────────► 🔵 legacy Swiftcheck flex
 *   ├─ GATE B · api_status === 'success'?  (_run)
 *   │    NO → skipped:'not_success' ──────────────► 🔵 legacy Swiftcheck flex
 *   │  [FEAT-20260815-DUPFORWARD] there is no duplicate gate. A slip Swiftcheck
 *   │  flagged `isDuplicate` is forwarded like any other — Shop-API refuses to
 *   │  credit it upstream, which is where that decision belongs.
 *   │  เราเป็นคนกลาง ปลายทางเป็นคนกัน.
 *   │
 *   ▼  all gates passed — the ONLY way into the money path
 *   LEG 1 topup ────────────────────────────────────────────────────────────
 *        • 'process-wallet' → ✅ credited → 🔒 lock 'success' → STOP (no walletpay)
 *        • any other status → ❌ not credited → fall to LEG 2
 *        • timeout/unknown  → ⚠️ REVIEW hard-stop (money may have moved)
 *   LEG 2 walletpay (per statement x) ──────────────────────────────────────────
 *        • matched + confirmed   → ✅ SUCCESS      → STOP
 *        • matched, not confirmed→ ⏳ MATCHED_PENDING → STOP (admin confirms)
 *        • no_match, x+1 exists  → ⏸️ AWAITING_RETRY → reply [ลองใหม่], PAUSE
 *        • no_match, none left   → ⚠️ REVIEW (uploaded everywhere)
 *        • error / timeout       → ⚠️ REVIEW
 *        • no statement at all   → 🔓 RELEASED ("ตรวจสอบยอดเงินไม่ได้", resend ok)
 *
 *   [ลองใหม่] tapped → payment-postback.handler → resume at x+1 with the SAME
 *   stored slip image → re-enters LEG 1. เอาสลิปเดิมมายิงใหม่กับ statement ถัดไป.
 *
 * 🔑 WHAT IS LOCKED, AND WHAT IS NOT (owner-decided):
 *   · the STATEMENT is what must never be credited twice — one statement, one
 *     credit. The cursor/ledger on the run is what enforces it.
 *   · the SLIP is deliberately NOT locked against reuse: matching a slip to the
 *     right statement is OUR job, so the same slip MUST be pairable with a new
 *     statement (x+1). A re-SENT slip image is stopped at GATE C instead, using
 *     Swiftcheck's own duplicate verdict.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Runs the fixed two-leg payment pair after a slip verifies success. topup and
 * walletpay are ALTERNATIVE credit paths — exactly ONE credits, so there is no
 * double-credit:
 *   LEG 1 topup  — POST /shop-api/v1/customer/validate-slip, multipart/form-data +
 *     slip image, Shop-API HMAC (validate-slip-signer). Outcome = data.slip_status.status.
 *       • 'process-wallet'  → ✅ TERMINAL SUCCESS. topup credited. FINALIZE the lock
 *         (lock_reason:'success'), reply the success state, and STOP — walletpay does
 *         NOT run.
 *       • 'member-not-match' → ⛔ STOP. [FEAT-20260810-MEMBERNOTMATCH] บัญชีที่โอนมา
 *         ไม่ใช่ของลูกค้าคนนี้ ⇒ walletpay ตัดสินแทนไม่ได้ ⇒ ไม่ไปต่อ · RELEASE สลิป
 *         (ลูกค้าส่งใบใหม่ได้) · needs_review + review_reason:'member_not_match'
 *       • 'fail' | 'duplicate' | 'account-not-match' → topup did NOT credit
 *         (duplicate is treated exactly like the others) → fall through to LEG 2
 *         (the other credit path). ⚠️ 'account-not-match' คนละเรื่องกับ
 *         'member-not-match': อันนี้เลขบัญชีปลายทางไม่ตรง ซึ่ง walletpay อาจจับคู่ได้.
 *       • timeout / unknown → REVIEW hard-stop (money may have moved; fail-safe).
 *   LEG 2 walletpay — POST /payin/{refId}/slip, multipart/form-data + slip image, no
 *     auth. Runs ONLY when topup did not credit. First finds the walletpay statement
 *     matching the slip amount to get refId; if none is found it CANNOT verify the
 *     amount → fallback reply + RELEASE (nothing credited/uploaded, resend ok).
 *
 * Design mirrors the LEGACY chain runner (legacy-api/src/services/handoff/*),
 * adapted to NestJS + our Mongoose schemas, with the money-safety CAS (review R2):
 * the slip lock is CLAIMED by an atomic CAS *before* LEG 1, so two concurrent runs
 * on one slip can never both POST topup (no double-topup).
 *
 * Config vs hardcode (owner: "hardcode ได้ ... แต่ต้องเหมาะสม"): the pair order
 * topup→walletpay is fixed (concrete legs, no generic N-op engine). Only the
 * genuinely-revisable knobs are config (tool.payment.*): statement path, walletpay
 * refId source, provider filter, the topup→walletpay field link (TBD), the
 * MATCHED_PENDING reply text. Everything else is concrete.
 *
 * LOG destination + shape are byte-faithful to legacy (owner's #1 concern):
 *   handoff_chain_runs — one row per run (raw_transaction, status, reply_token).
 *   handoff_jobs       — one row per leg (snapshot, outcome, attempts).
 *   handoff_results    — one row per leg (request/final/context), storeRaw shape.
 * See _createJob / _storeRaw / _finishJob / _writeContext — each cites its legacy
 * origin. No new log collection; no new log path.
 *
 * revert: delete this module (payment/) + the P2 edits tagged
 * [FEAT-20260808-PAYTOOL-P2] in slip/custom-tool schema, normalize, executor.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { realtimeConfig } from '@/config/app.config';
// [FIX-20260817-RESUMEDEDUPE] the leg log's dedupe key — see that file for why
import { buildLegDedupeKey, legTriggeredBy } from './payment-leg-dedupe';
import { maskCredsDeep } from '@/common/utils/mask-creds';
import { CryptoService } from '@/infra/crypto';
// [FIX-20260811-PAYDIVIDER] ChatMessage + writeTicketDivider: เขียน divider
// แถวจริงตอนห้องถูก claim อยู่แล้ว · [FIX-20260811-LINTBARREL] all through the
// module barrels (no internal-file imports; tickets/chat never import payment,
// so there is no cycle).
import { ChatMessage, ChatRoom, Member } from '@/modules/chat';
import { Ticket, writeTicketDivider } from '@/modules/tickets';
import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';

// [FEAT-20260903-TOPUPPERPROVIDER] revert: drop this import and restore the topup
// call site to `this.findRole(tool, 'pay_topup')`.
import { findTopupEndpoint } from './payment-endpoint.helper';
// [FEAT-20260903-RESUMEPROVIDERGUARD] revert: drop this import and the block in
// `_resume` that calls it.
import { providerChangedSinceVerification } from './payment-provider-guard';
import { openPaymentTicketIfIdle } from './payment-ticket.helper';
import { ImageStorage } from '@/modules/content';
import { Hook, PAYMENT_KNOB_DEFAULTS } from '@/modules/hooks';
import {
  CallResult,
  CustomToolFilePart,
  CustomToolService,
  pickByPath,
} from '@/modules/external';
import { SlipVerification } from '@/modules/slip';
import { providerFeatureOn } from '@/modules/customer-provider';
import { HandoffChainRun, HandoffJob, HandoffResult } from '@/modules/handoff';

import {
  buildValidateSlipHeaders,
  canonicalizePayloadField,
} from './validate-slip-signer';
// [FEAT-20260809-PAYTOOL-COPY] Every customer-facing default string lives there,
// not here. This file keeps the STRUCTURE (kind/cfgKey/actions) and the flow.
// payment-reply-copy imports only the `ReplyState` TYPE back from this file, so
// the cycle is erased at compile time and there is no runtime import loop.
import { REPLY_TEXT } from './payment-reply-copy';

/**
 * Terminal outcome of a run, surfaced to the (future) webhook caller.
 *
 * LOCK finalize/release (money-safety):
 *  • FINALIZE (stays consumed) when SOMETHING happened — topup credited
 *    (`SUCCESS` via process-wallet), walletpay credited (`SUCCESS`), walletpay
 *    `MATCHED_PENDING`, or walletpay exhausted/unclear (`REVIEW`, slip already
 *    uploaded → waiting admin). Re-delivery must not re-run and re-credit.
 *  • RELEASE (consumed:false) ONLY when NOTHING credited/uploaded (`RELEASED`):
 *    the statement-not-found fallback (topup did not credit + no statement, so
 *    walletpay was never called) or a pre-topup abort. The customer may resend.
 *  Because walletpay runs ONLY after topup did NOT credit, releasing on a walletpay
 *  path can never double-credit a topup — but once walletpay has UPLOADED we keep
 *  the lock so the same slip is not uploaded twice.
 */
export type PaymentOutcome =
  | 'SUCCESS' // topup process-wallet, OR walletpay matched+confirmed — locked success.
  | 'MATCHED_PENDING' // walletpay matched, confirmed:false — locked, admin pending.
  | 'REVIEW' // topup timeout, or walletpay unclear/exhausted (uploaded) — locked, review.
  // [FEAT-20260808-PAYTOOL-P2C] walletpay answered no_match on THIS statement and
  // more candidates remain ⇒ PAUSE and wait for the customer to tap [ลองใหม่].
  // NOT terminal for the slip (it may still match a later statement) and NOT an
  // error — it is "this statement was not the one". See NO_MATCH_PAUSE below.
  | 'AWAITING_RETRY'
  | 'RELEASED'; // nothing credited/uploaded (no statement / pre-topup abort) — RELEASED.

export interface PaymentRunResult {
  ran: boolean;
  skipped?: string;
  /**
   * [FEAT-20260810-CARDTICKET] The direct ticket this run already opened, if any.
   *
   * The helper always returned this id; both callers discarded it. Carrying it out
   * lets the DELIVERY layer retitle that row when the bound card supplies its own
   * reason, instead of the runner having to know about cards. Nothing in the flow
   * reads it — it is additive, and `undefined` on every run that opened no ticket.
   * ⚠️ Do NOT branch money decisions on this. It exists so a sentence can be
   * updated after the customer has been answered.
   */
  directTicketId?: Types.ObjectId;
  /**
   * [FIX-20260811-PAYDIVIDER] `true` เมื่อ runner เขียน divider ไปแล้วในการตรวจครั้งนี้
   * (ห้องถูก claim จึงไม่เปิด ticket แต่เขียนเส้นแทน)
   * delivery layer อ่านค่านี้เพื่อ **ไม่เขียนซ้ำ** เมื่อการ์ดที่ผูกมี flag เปิด — ไม่งั้น
   * การตรวจ 1 ครั้งจะได้ divider 2 แถว (เจอจริงตอนเทส 5 เคส 2026-08-11)
   */
  dividerDone?: boolean;
  /**
   * [FEAT-20260810-PAYSTATEFLEX] What Phase 3 needs to render a card bound to the
   * reply state, supplied ONLY by the resume path (`resumeForRetry`).
   *
   * The postback branch that answers a [ลองใหม่] tap has no slip in scope — just
   * the run id from the button — so without this it could not substitute a card's
   * `{{amount}}` and had to fall back to the built-in mint card, making one state
   * answer two different ways depending on how it was reached. The fresh-slip path
   * takes these from its own scope instead and does not set this.
   * Absent ⇒ the caller resolves no card, which is the previous behaviour.
   */
  stateFlex?: {
    boundIds: Record<string, unknown> | undefined;
    /** Swiftcheck's inner `rawSlip`. */
    vData: unknown;
    slipCreatedAt: Date | null;
  };
  outcome?: PaymentOutcome;
  chain_run_id?: Types.ObjectId;
  lock?: { consumed: boolean; lock_reason: string };
  needs_review?: boolean;
  /**
   * What the webhook SHOULD reply/push (Phase 3 sends it; the runner never does).
   * Built from the reply-per-state config map (REPLY_STATE_DEFAULTS, overridable
   * by tool.payment.*_reply_text). `kind` is the RENDER kind: 'text' for a plain
   * message, 'flex' for the mint flex (the retry + contact-admin buttons carried
   * in `actions`). `state` names the business outcome for Phase 3 routing.
   */
  reply?: {
    state: ReplyState;
    kind: 'text' | 'flex';
    text: string;
    /** For a 'flex' reply: which mint-flex action buttons to render. */
    actions?: ReplyAction[];
    /**
     * [FEAT-20260808-PAYTOOL-P2B] DETAIL text for the "mint" button, from the
     * tool's `payment.reply_detail`; always non-empty ("-" when unset) so Phase 3
     * can render it unconditionally.
     */
    detail: string;
  };
  /**
   * [P2C-2c] Where a [ลองใหม่] tap should resume, present ONLY when the run
   * paused with statements left (outcome AWAITING_RETRY). Phase 3 threads this
   * into the mint flex so the retry button carries a real target; when absent
   * the button is omitted rather than rendered dead.
   */
  resume?: {
    run_id: string;
    /** The statement index to try next (= the run's `resume_cursor`). */
    next_idx: number;
  };
}

/** [FEAT-20260808-PAYTOOL-P2C] The business states that own a customer reply. */
export type ReplyState =
  | 'topup_success' // topup process-wallet — credited.
  | 'walletpay_success' // walletpay matched + confirmed.
  | 'matched_pending' // walletpay matched, confirmed:false — awaiting admin confirm.
  // [P2C] walletpay said no_match, statements remain ⇒ ask the customer to retry
  // against the NEXT statement (FLEX, carries the [ลองใหม่] button).
  | 'no_match_retry'
  // [FEAT-20260809-PAYTOOL-NOTLINKED] the LINE has no linked web account, so
  // nothing could be credited. Actionable BY THE CUSTOMER (link, then resend),
  // so it is a plain text reply and the slip is RELEASED — not a review case.
  | 'not_linked'
  // [FEAT-20260810-MEMBERNOTMATCH] topup ตอบ `member-not-match` = บัญชีที่โอนมา
  // ไม่ใช่ของลูกค้าเอง ⇒ **หยุดที่นี่ ไม่ไป walletpay** (เจ้าของสั่ง 2026-08-10)
  // เพราะ walletpay เป็นทางเติมเงินสำรอง แต่เคสนี้ปัญหาคือ "เจ้าของบัญชีไม่ตรง"
  // ซึ่งอีกทางก็แก้ไม่ได้ ต้องให้คนดู
  | 'member_not_match'
  /* [FEAT-20260823-TOPUPDUP] topup ตอบ `slip_status.status === 'duplicate'`
     = ปลายทางบอกว่าสลิปใบนี้เคยเติมไปแล้ว ⇒ **หยุด ไม่ไป walletpay** และตอบด้วย
     การ์ด duplicate ของ Swiftcheck (`hook.flex_duplicate`) เจ้าของสั่ง 23/08/2026 */
  | 'topup_duplicate'
  | 'review' // timeout / exhausted / unclear — needs human review (FLEX).
  | 'statement_not_found'; // cannot verify the amount — released, resend ok.

/**
 * ==== [FEAT-20260810-TOPUPCARD] state ที่ "ไม่ตอบเอง" — ปล่อยการ์ดสลิปเดิมตอบ ====
 *
 * WHAT: state ในเซ็ตนี้จะไม่สร้าง reply ของตัวเอง (`_result` คืน `reply: undefined`)
 *       ⇒ `webhook.service.ts:3468` เห็นว่าไม่มี reply ⇒ คืน false
 *       ⇒ **การ์ด `flex_success` ของ Swiftcheck** ได้ตอบลูกค้าตามปกติ
 *
 * WHY: ทั้งสอง state แปลว่า "ลูกค้าได้เครดิตแล้ว" เหมือนกัน ต่างกันแค่เบื้องหลัง
 *      (topup เติมเอง / walletpay จับคู่ statement) ซึ่งลูกค้าไม่รู้และไม่ต้องรู้
 *      ⇒ ต้องเห็นการตอบแบบเดียวกัน ไม่ใช่บางครั้งการ์ด บางครั้งข้อความ
 *      เจ้าของสั่ง 2026-08-10: "ตอบเหมือน flex_success เหมือน topup wallet เลย"
 *
 * 📍 การ์ดที่ลูกค้าเห็นมาจากไหน:
 *      `flex_messages` (MongoDB) → เลือกด้วย `hook.flex_success`
 *      → ประกอบที่ `webhook/slip-flex.handler.ts` (เส้นเดียวกับ flow Swiftcheck ปกติ)
 *      เงื่อนไขที่ทำให้ได้การ์ด "สลิปถูกต้อง": Swiftcheck ตอบ success + สลิปไม่ซ้ำ +
 *      บัญชีผู้รับตรง (ถ้าไม่ตรงจะได้ `flex_success_not_match` แทน)
 *      ⇒ **แอดมินแต่งการ์ดเองได้จากหน้าเว็บ** ไม่ต้องแก้โค้ด
 *
 * ⚠️ สิ่งที่ **ไม่** เปลี่ยน: outcome ยัง 'SUCCESS' · ล็อกยัง finalize 'success' ·
 *    log/audit ทุกแถวเขียนเหมือนเดิมทุกประการ — เปลี่ยนแค่ "ใครตอบลูกค้า"
 *    ไม่ใช่ "เกิดอะไรขึ้นกับเงิน"
 *
 * HOW TO CHANGE LATER:
 *   - อยากให้ state ไหนกลับมาตอบข้อความเอง → เอาออกจากเซ็ตนี้ (บรรทัดเดียว)
 *   - อยากให้ state อื่นใช้การ์ดเดิมด้วย → ใส่เพิ่มในเซ็ตนี้
 * revert ทั้งงาน: ทำให้เซ็ตนี้ว่าง `new Set()` ⇒ ทุก state กลับไปตอบข้อความเหมือนเดิม
 *   (ข้อความใน REPLY_TEXT ยังอยู่ครบ ไม่ได้ลบ)
 */
const SLIP_CARD_STATES: ReadonlySet<ReplyState> = new Set<ReplyState>([
  'topup_success',
  'walletpay_success',
]);

export type ReplyAction = 'retry' | 'contact_admin';

/** The revisable payment knobs, with the runner's concrete fallbacks. */
interface PaymentCfg {
  statement_tx_path: string;
  statement_provider_code: string;
  statement_status: string;
  walletpay_ref_id_field: string;
  walletpay_ref_id_query_param: string;
  walletpay_file_field: string;
  topup_to_walletpay_map: Record<string, unknown>;
  /** [P2C] per-state reply overrides ('' ⇒ use REPLY_TEXT in payment-reply-copy.ts). */
  reply_success_text: string;
  pending_reply_text: string;
  review_reply_text: string;
  not_found_reply_text: string;
  /** [P2C-2c] walletpay no_match with statements left ⇒ offer [ลองใหม่]. */
  no_match_reply_text: string;
  /** [NOTLINKED] no linked account — customer links then resends. */
  not_linked_reply_text: string;
  /** [P2B] "-" when unset (seamless fallback), else the tool's reply_detail. */
  reply_detail: string;
  /**
   * Dot-path into the slip's Swiftcheck verify result for the topup `payload` text
   * field. '' ⇒ the whole Swiftcheck ENVELOPE (`slip.raw_response ?? raw_content`).
   * [FIX-20260810-PAYLOAD-ENVELOPE] Set this to `data` to send only Swiftcheck's
   * inner object, which is what we sent before the fix — the endpoint could not
   * read it. See `_swiftcheckResult`.
   */
  topup_payload_path: string;
}

/**
 * [FEAT-20260808-PAYTOOL-P2C] REPLY-PER-STATE config map — the STRUCTURE of every
 * outcome of BOTH legs. `kind` is the render kind: 'text' for a plain message,
 * 'flex' for the mint flex whose `actions` (retry + contact-admin buttons) Phase
 * 3 renders. `cfgKey` names the per-tool `payment.*_reply_text` knob that
 * overrides the copy, so operators edit wording WITHOUT touching code. The runner
 * RETURNS the resolved reply; Phase 3 owns the actual send/suppress.
 *
 * [FEAT-20260809-PAYTOOL-COPY] THE WORDS NO LONGER LIVE HERE. Every default
 * `text` was moved verbatim to REPLY_TEXT in `./payment-reply-copy.ts`, one
 * named entry per state, each with a note on when the customer sees it and
 * whether money moved. This map now holds only the wiring (kind / cfgKey /
 * actions). แก้ "คำ" ที่ payment-reply-copy.ts · แก้ "โครงสร้าง" ที่ตรงนี้.
 *
 * ══ WHERE TO EDIT WHAT (แก้ตรงไหน) ══════════════════════════════════════════
 *   ข้อความต่อ tool      → `tool.payment.<cfgKey>` (CONFIG, ไม่ต้องแก้โค้ด)
 *   ข้อความ default      → REPLY_TEXT in payment-reply-copy.ts  ← MOVED
 *   ข้อความบนปุ่ม        → BUTTON_LABELS in payment-reply-copy.ts  ← MOVED
 *   altText ของ flex     → MINT_FLEX_ALT_TEXT in payment-reply-copy.ts  ← MOVED
 *   text ↔ flex          → the `kind` field in this map
 *   ปุ่มใน state ไหน      → the `actions` field in this map
 *   สี / หน้าตาการ์ด      → MINT_COLORS in
 *                          webhook/payment-reply/payment-mint-flex.builder.ts
 *   เงื่อนไขว่า state เกิดเมื่อไหร่ → the flow below (_runWalletpay / _classifyTopup /
 *                          _classifyWalletpay), NOT this map — this map is only
 *                          "what the customer is told once the flow decided".
 *   ใครได้เข้ามาถึงตรงนี้บ้าง  → the ENTRY GATES in `_run` (see the flow map on
 *                          the class doc). A slip that fails ANY gate is skipped
 *                          entirely and answered by the LEGACY slip flow's own
 *                          flex — payment stays silent.
 *
 * เพิ่ม state ใหม่: add to ReplyState + this map → REPLY_TEXT in
 * payment-reply-copy.ts → STATE_NOTES in the builder → a knob in
 * custom-tool-normalize.ts. REPLY_TEXT and this map are both typed
 * `Record<ReplyState, …>`, so a missing entry is a compile error; a missing
 * STATE_NOTES entry fails a test.
 */
/**
 * [FIX-20260811-CFGKEYSTR] Only the STRING-valued keys of PaymentCfg. A reply
 * override must name a `*_reply_text`-style knob; `keyof PaymentCfg` also
 * admitted `topup_to_walletpay_map` (a Record), which is meaningless as reply copy
 * and forced a lossy `String()` at the read site (the '[object Object]' lint).
 * With the key set narrowed the compiler proves `cfg[def.cfgKey]` is a string.
 */
type PaymentCfgStringKey = {
  [K in keyof PaymentCfg]: PaymentCfg[K] extends string ? K : never;
}[keyof PaymentCfg];

interface ReplyStateDef {
  kind: 'text' | 'flex';
  /**
   * Key on PaymentCfg whose non-empty value overrides `text`.
   *
   * [FEAT-20260823-TOPUPDUP] เป็น optional ตั้งแต่ 23/08/2026 — state ใหม่
   * `topup_duplicate` ยังไม่มี knob ของตัวเองใน `tool.payment.*` และการไปยืม
   * คีย์ของ state อื่น (เช่น `review_reply_text`) จะทำให้ OA ที่แก้ข้อความ review
   * ไปเปลี่ยนข้อความ duplicate ด้วยโดยไม่ตั้งใจ — ผิดกติกา "1 state 1 ข้อความ".
   * ⚠️ ไม่ส่ง = ไม่มีทางให้ override ⇒ ใช้ `text` เสมอ · ทุก state เดิมยังส่งครบ
   *    เหมือนเดิมทุกตัว จึงไม่มีพฤติกรรมไหนเปลี่ยน
   * อยากให้ override ได้เมื่อไหร่: เพิ่มคีย์ใน PaymentCfg แล้วใส่ `cfgKey` ตรงนั้น
   */
  cfgKey?: PaymentCfgStringKey;
  /**
   * Default Thai copy for this state. ALWAYS `REPLY_TEXT[<state>]` — never a
   * literal. Keeping the words out of this money-path file is the whole point of
   * [FEAT-20260809-PAYTOOL-COPY]; a literal here would re-create the second copy
   * that the split removed.
   */
  text: string;
  /** Mint-flex buttons — only for kind:'flex'. */
  actions?: ReplyAction[];
}

const REPLY_STATE_DEFAULTS: Record<ReplyState, ReplyStateDef> = {
  // topup credited (process-wallet). Money MOVED, slip locked. Copy + the full
  // "when is this seen" note: REPLY_TEXT.topup_success in payment-reply-copy.ts.
  topup_success: {
    kind: 'text',
    cfgKey: 'reply_success_text',
    text: REPLY_TEXT.topup_success,
  },
  // walletpay matched + confirmed — the alternative credit path succeeded. Money
  // MOVED, slip locked. Shares `reply_success_text` with topup_success by design.
  walletpay_success: {
    kind: 'text',
    cfgKey: 'reply_success_text',
    text: REPLY_TEXT.walletpay_success,
  },
  // walletpay matched but not auto-confirmed — admin will finalize. Slip LOCKED.
  matched_pending: {
    kind: 'text',
    cfgKey: 'pending_reply_text',
    text: REPLY_TEXT.matched_pending,
  },
  // [P2C] walletpay no_match with candidates left. NOT an error and NOT terminal:
  // the slip may still match a later statement, so the customer is offered
  // [ลองใหม่] which resumes at x+1 with the SAME slip image. Auto-advancing here
  // would spend every statement on one upload without the customer ever seeing
  // what happened — which is why ans23_43.md requires the pause.
  no_match_retry: {
    kind: 'flex',
    cfgKey: 'no_match_reply_text',
    text: REPLY_TEXT.no_match_retry,
    actions: ['retry', 'contact_admin'],
  },
  // [FEAT-20260809-PAYTOOL-NOTLINKED] no linked account ⇒ nothing credited, lock
  // RELEASED, customer can link and resend. TEXT, not flex: the fix is theirs,
  // and a [ลองใหม่] button would be a lie — retrying changes nothing until the
  // account is linked. Copy is overridable per tool like every other state.
  not_linked: {
    kind: 'text',
    cfgKey: 'not_linked_reply_text',
    text: REPLY_TEXT.not_linked,
  },
  /* [FEAT-20260810-MEMBERNOTMATCH] บัญชีที่โอนมาไม่ใช่ของลูกค้าเอง — ตอบข้อความ
     ธรรมดา ไม่มีปุ่ม เพราะลูกค้าทำอะไรต่อเองไม่ได้ ต้องรอแอดมิน
     ⚠️ ใช้ cfgKey เดียวกับ review ชั่วคราว — ยังไม่มี knob ของตัวเอง
        ถ้าจะให้ตั้งข้อความราย OA แยกจาก review ต้องเพิ่ม key ใหม่ใน PaymentCfg
        + custom-tool-normalize.ts ก่อน (note ไว้ที่ payment-reply-copy.ts ด้วย) */
  member_not_match: {
    kind: 'text',
    cfgKey: 'review_reply_text',
    text: REPLY_TEXT.member_not_match,
  },

  /* [FEAT-20260823-TOPUPDUP] topup ตอบ duplicate ⇒ หยุด ไม่ไป walletpay
     ⚠️ `kind: 'text'` เป็นทางสำรอง — ปกติจะถูกแทนที่ด้วย **การ์ด**
        `hook.flex_duplicate` ผ่าน default ที่ payment-state-flex.resolver.ts
     ⚠️ ไม่มี `cfgKey` โดยตั้งใจ: ยังไม่มี knob ใน tool.payment.* ให้ OA แก้
        ข้อความนี้ ถ้าวันหนึ่งอยากให้แก้ได้ ให้เพิ่มคีย์ใน cfg แล้วใส่ตรงนี้ */
  topup_duplicate: {
    kind: 'text',
    text: REPLY_TEXT.topup_duplicate,
  },
  // timeout / exhausted / unclear — money outcome UNKNOWN, slip LOCKED, human
  // must look. FLEX; the retry button is dropped at render (no resume context).
  review: {
    kind: 'flex',
    cfgKey: 'review_reply_text',
    text: REPLY_TEXT.review,
    actions: ['retry', 'contact_admin'],
  },
  // no walletpay statement matched the slip amount — cannot verify; lock RELEASED.
  statement_not_found: {
    kind: 'text',
    cfgKey: 'not_found_reply_text',
    text: REPLY_TEXT.statement_not_found,
  },
};

/**
 * [FEAT-20260809-PAYTOOL-NOTLINKED] topup error codes that mean, definitively,
 * "this LINE has no linked account, so nothing was credited".
 *
 * ONLY add a code here when the far side GUARANTEES nothing was credited. Every
 * code in this list causes the slip lock to be RELEASED, so a wrong entry is a
 * double-credit path. Matched on the code string, never on the HTTP status.
 */
const NOT_LINKED_CODES: readonly string[] = ['CUSTOMER_NOT_LINKED'];

const RAW_TEXT_CAP = 256 * 1024;

/**
 * [FIX-20260818-CTXSLOT] / [FIX-20260820-CTXCURSOR] the audit slot that means
 * "the whole walk", never one ใบ. `_context` rows are addressed by walk
 * position; an end-of-walk verdict has no position of its own, so it gets this
 * one. -1 is deliberate: it can never collide with a real statement index, and
 * walletpay-history's fallback picker (which matches a row's `stmt_idx` against a
 * statement list) can never resolve it to a statement — which is the correct
 * blank for a summary. ห้ามเปลี่ยนเป็น 0 หรือ candidates.length ทั้งสองค่าชนใบจริงได้.
 */
const WALK_SUMMARY_CURSOR = -1;

type HookLike = Partial<Hook> & {
  _id?: Types.ObjectId;
  customer_link_web_code?: string;
};

type ToolLike = {
  _id: Types.ObjectId | string;
  name?: string;
  category?: string;
  status?: boolean;
  api_key?: string;
  endpoints?: Array<Record<string, unknown>>;
  payment?: Record<string, unknown>;
};

type SlipLike = {
  _id: Types.ObjectId;
  amount?: number;
  trans_ref?: string;
  api_status?: string;
  internal_content_id?: Types.ObjectId | null;
  sender_member_user_id?: string;
  sender_line_user_id?: string;
  raw_content?: unknown;
  raw_response?: unknown;
  transaction_date?: Date;
  [k: string]: unknown;
};

/**
 * The chain-run fields the RESUME path reads. `status` and `resume_cursor` are
 * the two that gate it: only an `awaiting_retry` run may be resumed, and only at
 * the index it recorded when it paused.
 */
type RunLike = {
  _id: Types.ObjectId;
  status?: string;
  cursor?: number;
  resume_cursor?: number;
  hook_id?: Types.ObjectId | null;
  slip_record_id?: Types.ObjectId;
  [k: string]: unknown;
};

@Injectable()
export class PaymentRunnerService {
  private readonly logger = new Logger(PaymentRunnerService.name);

  constructor(
    @InjectModel(SlipVerification.name)
    private readonly slipModel: Model<SlipVerification>,
    @InjectModel(HandoffChainRun.name)
    private readonly runModel: Model<HandoffChainRun>,
    @InjectModel(HandoffJob.name)
    private readonly jobModel: Model<HandoffJob>,
    @InjectModel(HandoffResult.name)
    private readonly resultModel: Model<HandoffResult>,
    @InjectModel(Member.name)
    private readonly memberModel: Model<Member>,
    // [P2C-2c] Read-only, and ONLY for the resume path: a [ลองใหม่] postback
    // carries a runId, not a hook, so the hook must be re-read to re-check the
    // payment kill-switch before touching a money leg. Never written here —
    // hooks stay owned by the hooks module.
    @InjectModel(Hook.name)
    private readonly hookModel: Model<Hook>,
    /* [FEAT-20260810-PAYTICKET] ใช้เปิด ticket เมื่อ topup ตอบ member-not-match
       ตรรกะอยู่ใน payment-ticket.helper.ts ทั้งหมด ที่นี่แค่ส่ง model เข้าไป
       เพื่อไม่ให้ไฟล์นี้ (~2.4k บรรทัด) บวมเพิ่ม */
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<Record<string, unknown>>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<Record<string, unknown>>,
    /* [FIX-20260811-PAYDIVIDER] เขียน divider แถวจริงเมื่อห้องถูก claim อยู่แล้ว
       ⇒ ตรวจสลิปทุกครั้งมีเส้นคั่น ไม่ใช่แค่ครั้งที่เปิด ticket ใบใหม่ได้
       ใช้แค่ส่งต่อให้ `writeTicketDivider` — ไฟล์นี้ไม่ได้เขียน chat_messages เอง */
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<Record<string, unknown>>,
    /* [FEAT-20260810-PAYTICKET] ยิง ticket:new — ถ้าไม่มี ticket เข้า DB แต่
       แอดมินต้องกด refresh ถึงจะเห็น (เจอจริงตอนเทส) */
    private readonly realtimePublisher: RealtimePublisherService,
    @InjectModel(ImageStorage.name)
    private readonly imageModel: Model<ImageStorage>,
    private readonly customTool: CustomToolService,
    private readonly crypto: CryptoService,
    @Inject(realtimeConfig.KEY)
    private readonly app: { wsEnv?: string },
  ) {}

  // ───────────────────────── gate ─────────────────────────

  /**
   * "on + working" for a PAYMENT tool. Reads the SEPARATE hook binding
   * (`payment_tool_status`/`payment_tool_id`, Phase 1) — never `custom_tool_id`,
   * so the inbound profile fork (webhook.service.ts:1172) is untouched (R1).
   * Uncached tool read: a money kill-switch must not lag the 60s tool cache (R5).
   */
  async resolvePaymentTool(
    hook: Partial<Hook> | null | undefined,
  ): Promise<ToolLike | null> {
    /* [FEAT-20260815-TOOLRESOLVELOG] say WHICH tool, and WHY it was refused.
       All four exits below used to return null silently, so "payment did not
       run" looked identical whether the OA had no tool bound, the tool was
       switched off, or its category was wrong. Diagnosing that meant reading
       Mongo by hand — this line answers it from the log alone.
       Cheap: one line per inbound slip, no secrets, ids only.
       revert: delete the two logger.log calls; the returns are unchanged. */
    const alias = String(hook?.alias ?? '-');
    /* [FEAT-20261014-PROVFEATURES] no payment world on this site (loan_v1): the same null an
       unbound OA gets ⇒ `not_working`, the slip card still goes out, the postback is consumed. */
    if (!providerFeatureOn('payment')) {
      this.logger.log(
        `[TOOLCHECK] ${alias} payment: SILENCED (provider feature "payment" off)`,
      );
      return null;
    }
    if (!hook || hook.payment_tool_status !== true || !hook.payment_tool_id) {
      this.logger.log(
        `[TOOLCHECK] ${alias} payment: NOT BOUND ` +
          `(status=${String(hook?.payment_tool_status)} id=${String(hook?.payment_tool_id ?? '-')})`,
      );
      return null;
    }
    const tool = (await this.customTool.getTool(hook.payment_tool_id, {
      skipCache: true,
    })) as ToolLike | null;
    if (!tool || tool.status === false || tool.category !== 'payment') {
      this.logger.log(
        `[TOOLCHECK] ${alias} payment: REFUSED id=${String(hook.payment_tool_id)} ` +
          `reason=${!tool ? 'tool_missing' : tool.status === false ? 'tool_off' : `category=${String(tool.category)}`}`,
      );
      return null;
    }
    this.logger.log(
      `[TOOLCHECK] ${alias} payment: OK "${String(tool.name)}" ` +
        `id=${String(hook.payment_tool_id)} category=${String(tool.category)}`,
    );
    return tool;
  }

  private readCfg(tool: ToolLike): PaymentCfg {
    const p = tool.payment || {};
    // Defaults come from the SINGLE SOURCE OF TRUTH shared with normalizePayment
    // (PAYMENT_KNOB_DEFAULTS) so stored vs runtime defaults can never drift.
    const s = (v: unknown, d: string): string =>
      typeof v === 'string' && v !== '' ? v : d;
    const D = PAYMENT_KNOB_DEFAULTS;
    return {
      statement_tx_path: s(p['statement_tx_path'], D.statement_tx_path),
      statement_provider_code: s(
        p['statement_provider_code'],
        D.statement_provider_code,
      ),
      // '' is valid (filter off) — only default when the key is missing.
      statement_status:
        p['statement_status'] === undefined
          ? D.statement_status
          : ((p['statement_status'] as string | null) ?? ''),
      walletpay_ref_id_field: s(
        p['walletpay_ref_id_field'],
        D.walletpay_ref_id_field,
      ),
      walletpay_ref_id_query_param: s(
        p['walletpay_ref_id_query_param'],
        D.walletpay_ref_id_query_param,
      ),
      walletpay_file_field: s(
        p['walletpay_file_field'],
        D.walletpay_file_field,
      ),
      topup_to_walletpay_map:
        (p['topup_to_walletpay_map'] as Record<string, unknown>) || {},
      // [P2C] '' ⇒ the runner falls back to REPLY_STATE_DEFAULTS text per state.
      reply_success_text: (p['reply_success_text'] as string | null) ?? '',
      pending_reply_text: (p['pending_reply_text'] as string | null) ?? '',
      review_reply_text: (p['review_reply_text'] as string | null) ?? '',
      not_found_reply_text: (p['not_found_reply_text'] as string | null) ?? '',
      no_match_reply_text: (p['no_match_reply_text'] as string | null) ?? '',
      not_linked_reply_text:
        (p['not_linked_reply_text'] as string | null) ?? '',
      // [P2B] absent/empty ⇒ "-", so a tool without the field works seamlessly.
      reply_detail:
        typeof p['reply_detail'] === 'string' && p['reply_detail'] !== ''
          ? p['reply_detail']
          : '-',
      topup_payload_path: s(p['topup_payload_path'], D.topup_payload_path),
    };
  }

  /**
   * [FEAT-20260808-PAYTOOL-P2C] Resolve the reply for a state from the config map:
   * the tool's `payment.*_reply_text` override wins, else the state default;
   * `dynamicText` (e.g. the walletpay response `message`) is a last-resort fill only
   * when neither is set. Carries the mint-flex `actions` for a 'flex' state and
   * the P2B `detail`. The runner RETURNS this; Phase 3 sends it.
   */
  private _reply(
    state: ReplyState,
    cfg: PaymentCfg,
    dynamicText = '',
  ): NonNullable<PaymentRunResult['reply']> {
    const def = REPLY_STATE_DEFAULTS[state];
    // [FIX-20260811-CFGKEYSTR] typed string by PaymentCfgStringKey — no String()
    /* [FEAT-20260823-TOPUPDUP] `cfgKey` optional แล้ว — ไม่มีคีย์ = ไม่มี override
       (state เดิมทุกตัวยังมีคีย์ครบ พฤติกรรมเท่าเดิมทุกประการ) */
    const override = def.cfgKey ? (cfg[def.cfgKey] ?? '') : '';
    const text = override || def.text || dynamicText;
    return {
      state,
      kind: def.kind,
      text,
      ...(def.actions ? { actions: def.actions } : {}),
      detail: cfg.reply_detail,
    };
  }

  private findRole(
    tool: ToolLike,
    role: string,
  ): Record<string, unknown> | null {
    return (
      (tool.endpoints || []).find(
        (e) => e && e['status'] !== false && e['role'] === role,
      ) || null
    );
  }

  // ───────────────────────── entrypoint ─────────────────────────

  /**
   * Run the payment pair for a verified slip. Standalone + idempotent + money-safe.
   * Never throws to the caller — a failure is captured in the log and returned.
   */
  async runForSlip(input: {
    hook: Partial<Hook> & {
      _id?: Types.ObjectId;
      customer_link_web_code?: string;
    };
    slipRecordId: Types.ObjectId | string;
    replyToken?: string;
  }): Promise<PaymentRunResult> {
    try {
      return await this._run(input);
    } catch (e) {
      this.logger.error(`[PAYRUN] unexpected error: ${(e as Error).message}`);
      // Fail SAFE for money: on an unexpected error we do NOT know if a leg
      // moved money, so we never silently release — the caller sees ran:false.
      return { ran: false, skipped: 'error' };
    }
  }

  /**
   * ==== [P2C-2c] THE [ลองใหม่] RESUME ====
   *
   * Continue a run that PAUSED on `no_match`, trying the NEXT statement with the
   * SAME stored slip image. Called by the payment postback handler when the
   * customer taps the button. เอาสลิปเดิมมายิงใหม่กับ statement ถัดไป.
   *
   * WHY IT IS A SEPARATE ENTRY POINT FROM `runForSlip` (and not a flag on it):
   * `runForSlip` starts a NEW run — it claims the slip lock with the atomic CAS,
   * creates a run doc, and begins at cursor 0. A resume must do NONE of those:
   * the slip is ALREADY claimed by this very run (that is what the pause left
   * behind), so the CAS would fail and the resume would abort as
   * 'already_locked'. Threading a "resuming" boolean through the start path
   * would mean guarding the claim, the run creation, and the cursor separately —
   * three chances to get money safety wrong. Two explicit doors are safer than
   * one door with a mode.
   *
   * MONEY SAFETY — all three enforced in `_resume`:
   *  · The run must still be in `awaiting_retry`, and `nextIdx` must equal the
   *    run's own `resume_cursor`. [FIX-20260810-RESUMECLAIM] Both are conditions
   *    on a SINGLE `findOneAndUpdate` that also marks the run as resumed, so the
   *    test and the write cannot be split by a concurrent tap. A LINE card never
   *    disappears from the chat, so the customer can double-tap it or scroll back
   *    and tap an old one; the claim is what makes the button single-use. The
   *    previous version tested these in JS after a separate read and left a
   *    window where two taps both passed — see the block comment in `_resume`.
   *  · A stale or forged index can never make the runner re-POST a statement it
   *    already uploaded, because an old card's index no longer matches the cursor.
   *  · The slip lock is NOT re-claimed and NOT released — it stays held by this
   *    run for the whole pause→resume cycle.
   */
  async resumeForRetry(input: {
    runId: Types.ObjectId | string;
    nextIdx: number;
    replyToken?: string;
  }): Promise<PaymentRunResult> {
    try {
      return await this._resume(input);
    } catch (e) {
      this.logger.error(`[PAYRUN] resume error: ${(e as Error).message}`);
      return { ran: false, skipped: 'error' };
    }
  }

  private async _resume(input: {
    runId: Types.ObjectId | string;
    nextIdx: number;
    replyToken?: string;
  }): Promise<PaymentRunResult> {
    const { nextIdx, replyToken } = input;

    /* [FIX-20260810-RESUMECLAIM] ATOMIC CLAIM — the retry button is single-use.
     *
     * A LINE card never leaves the chat, so the customer can double-tap it or
     * scroll back and tap an old one. Both preconditions therefore live in the
     * FILTER and the same command marks the run resumed: first tap gets the doc,
     * any concurrent or later tap gets `null`. Splitting this into a read plus an
     * `if` (as before) let two taps pass the check before either wrote, calling
     * walletpay twice for one statement — the read-then-write gap described in
     * `payment-ticket.helper.ts:25-26`.
     *   · `status: 'awaiting_retry'` — only a paused, unclaimed run may resume.
     *   · `resume_cursor: nextIdx`   — trust the RUN, not the payload: an old
     *     card's index stops matching once the cursor moves, so a stale or forged
     *     index can never re-POST an already-uploaded statement.
     * Claimed BEFORE the hook/tool/slip reads so nothing awaits mid-decision, and
     * it carries the fresh reply token because the paused run's token is dead.
     * ⚠️ Do not fold back into read-then-check — the single command IS the
     * guarantee. ปุ่มค้างในแชตตลอด ⇒ เช็คกับเขียนต้องเป็นก้อนเดียว.
     */
    const claimed = (await this.runModel
      .findOneAndUpdate(
        {
          _id: input.runId,
          status: 'awaiting_retry',
          resume_cursor: nextIdx,
        },
        {
          $set: {
            status: 'running',
            current_step_order: 1,
            ...(replyToken ? { reply_token: replyToken } : {}),
          },
        },
        { new: true },
      )
      .lean()
      .exec()) as RunLike | null;

    if (!claimed) {
      /* Re-read only to report WHICH reason, keeping the distinct `skipped`
       * values callers and tests already rely on. Failing path only — this tap
       * is not going to run, so there is nothing left to race. */
      const seen = (await this.runModel
        .findById(input.runId)
        .lean()
        .exec()) as RunLike | null;
      if (!seen) return { ran: false, skipped: 'no_run' };
      if (seen.status !== 'awaiting_retry') {
        // The ordinary outcome of a second tap: someone got here first.
        this.logger.log(
          `[PAYRUN] resume ignored — run ${String(input.runId)} is '${String(seen.status)}', not awaiting_retry`,
        );
        return { ran: false, skipped: 'not_awaiting_retry' };
      }
      this.logger.warn(
        `[PAYRUN] resume idx mismatch (payload=${nextIdx}, run=${String(seen.resume_cursor)}) — ignored`,
      );
      return { ran: false, skipped: 'stale_retry' };
    }

    const run = claimed;

    const hook = (await this.hookModel.findById(run.hook_id).lean().exec()) as
      | (Partial<Hook> & {
          _id?: Types.ObjectId;
          customer_link_web_code?: string;
        })
      | null;
    if (!hook) return { ran: false, skipped: 'no_hook' };

    // The payment tool must still be ON: an admin may have switched it off while
    // the customer sat on the button. Money legs never run on a disabled tool.
    /* ==== [NOTE-20260902-RESUMEPROVIDERMISMATCH] the tool is re-read from the
     * hook as it stands NOW, while the payload below comes from the envelope
     * stored on the slip when it was verified. With one slip provider those two
     * can never disagree. With a second one they can, and this is where it bites.
     * Written down BEFORE the change, not applied. ยังไม่แก้ — บันทึกไว้ก่อน.
     *
     * THE WINDOW: the customer's run pauses on `no_match` and waits on [ลองใหม่].
     * An admin repoints the OA at a different provider. The customer taps. The
     * stored envelope (provider A's dialect) is then sent with provider B's tool
     * — its path, its params, its `topup_payload_path`. Nothing here notices.
     *
     * NOTE THE CLASS ALREADY EXISTS: repointing `payment_tool_id` mid-pause does
     * the same thing today, silently. A second provider only makes it likely.
     *
     * DECIDED (owner, 2026-09-02): REVIEW, not proceed. On a money path an
     * unknown outcome is worse than a stopped one — the same rule `runForSlip`
     * already follows when it returns `ran:false` on an unexpected error rather
     * than releasing the lock. A dead-ended retry an admin can see beats a
     * malformed money request nobody sees.
     *
     * SHAPE WHEN BUILT — the provider is stamped on the slip at verification time
     * (a `slip_provider` prop with NO default, so absent = unstamped and no
     * backfill is needed), and
     * this method compares it against the provider the current tool speaks:
     *
     *   const PROVIDER_MISMATCH_ON_RESUME: 'review' | 'proceed' = 'review';
     *
     * 🔴 [PLANAUDIT-20260903-RESUMEVSSTG] THIS PLAN, AS WRITTEN ABOVE, BREAKS
     * [RULE-20260903-STGSTAYSSWIFTCHECK]. Found by auditing the plan against the rule
     * on 03/09, before any of it was built. Two ways, both silent:
     *
     *   1. UNSTAMPED ROWS. Every slip verified before stamping ships has
     *      `slip_provider` absent. If "absent" is compared as a value it never
     *      equals the current provider, so EVERY paused retry on an existing slip
     *      dead-ends into `review`. Absent must mean "no opinion, proceed" — it is
     *      the reason the Prop has no default, and that reason has to survive into
     *      the comparison, not just the schema.
     *   2. NAME vs IDENTITY. On staging `hook.slip_provider` is `''`, which
     *      RESOLVES to Swiftcheck. If stamping writes the resolved name (`'swiftcheck'`)
     *      while the comparison reads the raw config value (`''`), then
     *      `'swiftcheck' !== ''` on every single resume — a staging that verifies
     *      perfectly would refuse every `[ลองใหม่]`, and the "fix" would be to
     *      write a config value that the rule says must never be required.
     *
     * ⇒ WHAT THE COMPARISON MUST DO: resolve BOTH sides through
     * `resolveSlipProvider(...) ?? DEFAULT_SLIP_PROVIDER` and compare the
     * resulting provider IDENTITY, treating absent/`null` as no-mismatch. Then
     * `''`, `'swiftcheck'` and an unregistered typo are all the same provider, an
     * untouched staging never sees a mismatch, and the switch still fires for the
     * case it was built for — a real change from one registered provider to
     * another. เทียบตัวที่ resolve แล้ว ไม่ใช่เทียบสตริงดิบ · ว่าง = ไม่มีข้อขัดแย้ง
     *
     * ⚠️ The test for this is not "the comparator works". It is: an OA that has
     * NEVER set `slip_provider`, with slips stamped and unstamped, resumes
     * successfully — run it before the mismatch case, because that is the one the
     * whole fleet is in.
     *
     * `'review'` reuses the existing terminal outcome — no new state, no new copy,
     * no new card; the customer gets REPLY_TEXT.review and the run carries
     * `needs_review: true`, which admins can already filter on.
     * ⚠️ BOTH branches must ship complete and both must be covered by tests. A
     * switch whose other side has never run is not a switch — it is a wish that
     * gets discovered on the day something is already wrong.
     *
     * COST OF 'review': a retry paused at the exact moment of a switch dead-ends
     * and the customer must contact an admin. Narrow window (a switch is a
     * deliberate admin action, and only runs paused on `no_match` are affected)
     * and the failure is VISIBLE, which is the point. */
    const tool = await this.resolvePaymentTool(hook);
    if (!tool) return { ran: false, skipped: 'not_working' };

    const slip = (await this.slipModel
      .findById(run.slip_record_id)
      .lean()
      .exec()) as SlipLike | null;
    if (!slip) return { ran: false, skipped: 'no_slip' };

    const runId = run._id;
    const userId = slip.sender_member_user_id || slip.sender_line_user_id || '';
    const cfg = this.readCfg(tool);

    /* ==== [FEAT-20260903-RESUMEPROVIDERGUARD] the switch planned above ========
     *
     * The slip in hand was verified EARLIER. If the hook's provider changed while
     * this run sat paused, the stored envelope is provider A's dialect and this
     * leg would send it with provider B's tool. Owner's decision, 02/09: REVIEW,
     * not proceed — a dead-ended retry an admin can see beats a malformed money
     * request nobody sees.
     *
     * 🔴 RULE B LIVES IN THE COMPARISON, NOT HERE. Both sides are resolved to a
     * provider IDENTITY and an absent stamp means "no opinion", so an untouched
     * staging — `hook.slip_provider` `''`, rows stamped and unstamped — never
     * reaches this branch. The guard's header records the two silent ways the
     * plain string comparison would have broken it.
     *
     * ⚠️ NOTHING IS UNLOCKED HERE. The slip is already locked — that is why a
     * retry button existed — and this outcome must keep it locked, because a
     * human has to decide. That is the entire point of `review`. */
    if (
      providerChangedSinceVerification(
        slip['slip_provider'],
        hook?.slip_provider,
      )
    ) {
      await this._endRun(runId, 'locked_review', true);
      await this._context(
        runId,
        slip,
        1,
        'pay_topup',
        0,
        {
          outcome: 'REVIEW',
          slip_locked: true,
          lock_reason: 'review',
          /* The money leg never ran, so nothing is unknown about the wallet —
             what is unknown is whether this envelope still means the same thing
             to the tool now pointed at it. `needs_review` is what puts it in
             front of a person; the reason string is free-form and nothing
             branches on it. ห้ามเอา needs_review ออก — ต้องมีคนดู */
          needs_review: true,
          review_reason: 'slip_provider_changed_mid_pause',
        },
        nextIdx,
      );
      return this._result(runId, 'REVIEW', true, cfg, 'review');
    }

    /* [FIX-20260810-RESUMECLAIM] The re-open write that used to sit here is gone:
     * the claim above already set status/step/reply token. Re-writing `status`
     * under an `{_id}`-only filter was the unguarded update that let a second tap
     * through, so the claim stays the ONLY place a run is marked resumed. */

    // Re-enter LEG 1 with the SAME stored slip image (1ans.md §3: "กลับไป
    // topup(B) ใหม่"). The image is re-read from ImageStorage, not re-uploaded
    // by the customer — the button is a server-side resume, not a re-send.
    const legs = await this._runLegs({
      tool,
      slip,
      hook,
      userId,
      cfg,
      runId,
      startCursor: nextIdx,
    });

    /* [FEAT-20260810-PAYSTATEFLEX] Hand the caller what the per-state card needs.
     *
     * WHY HERE: a resume answers a POSTBACK, and that webhook branch has no slip
     * in scope — only the run id off the button. Without this the retry path could
     * not substitute `{{amount}}`, so it had to fall back to the built-in mint card
     * while a fresh slip got the admin's card: the same state answering two
     * different ways depending on how it was reached.
     *
     * Attached HERE rather than inside `_result` because `_result` has eleven call
     * sites and neither the hook nor the slip in scope; this method already loaded
     * both, so nothing is re-read and the money path is untouched.
     * ⚠️ Additive only — a caller that ignores `stateFlex` behaves exactly as before.
     * revert: drop this block and return `this._runLegs(...)` directly. */
    return {
      ...legs,
      stateFlex: {
        boundIds: hook.payment_flex_ids as Record<string, unknown> | undefined,
        // Swiftcheck's inner `rawSlip` — the same subtree the slip card substitutes
        // from, so a card renders identically on both paths.
        vData: (slip.raw_content as { rawSlip?: unknown } | null)?.rawSlip,
        slipCreatedAt: slip.transaction_date ?? null,
      },
    };
  }

  private async _run(input: {
    hook: Partial<Hook> & {
      _id?: Types.ObjectId;
      customer_link_web_code?: string;
    };
    slipRecordId: Types.ObjectId | string;
    replyToken?: string;
  }): Promise<PaymentRunResult> {
    const { hook, slipRecordId, replyToken } = input;

    const tool = await this.resolvePaymentTool(hook);
    if (!tool) return { ran: false, skipped: 'not_working' };

    const slip = (await this.slipModel
      .findById(slipRecordId)
      .lean()
      .exec()) as SlipLike | null;
    if (!slip) return { ran: false, skipped: 'no_slip' };

    // ═══════════════════════════════════════════════════════════════════════
    // ⭐ THE ENTRY GATE — SWIFTCHECK SUCCESS IS THE ONLY WAY IN (owner-confirmed)
    // ═══════════════════════════════════════════════════════════════════════
    // STATE: `slip.api_status` — the SLIP VERIFICATION (Swiftcheck) result, decided
    // long before this runner is reached. It is NOT a payment state; payment
    // simply refuses to start unless it is 'success'.
    //
    //   api_status === 'success'  ⇒ the slip is verified real ⇒ payment MAY run
    //                               (topup first, then walletpay if topup did not
    //                               credit).
    //   anything else             ⇒ payment does NOT run AT ALL. `skipped:
    //                               'not_success'`, no lock claimed, no run
    //                               created, no reply produced by this runner.
    //
    // WHY THIS MATTERS MOST OF ALL: topup moves money. Running it on a slip
    // Swiftcheck could not verify would credit against an unproven transfer. There
    // is exactly ONE door into the money path and this is it.
    // ถ้า swiftcheck ไม่ success = ไม่เข้า topup เด็ดขาด.
    //
    // WHAT THE CUSTOMER SEES WHEN THIS GATE REJECTS: the LEGACY slip flow
    // answers, unchanged — Swiftcheck's own flex card (the slip-detail /
    // error card in slip-flex.handler.ts). Payment produces no reply here on
    // purpose, so a non-success slip behaves EXACTLY as it did before this
    // feature existed. That is also why Phase 3's suppression only applies when
    // payment actually replied: `ran:false` ⇒ nothing suppressed ⇒ the legacy
    // card still goes out. (swiftcheck ไม่ใช่ success ⇒ ตอบตาม flow เดิมของ
    // swiftcheck ซึ่งมี flex อยู่แล้ว)
    //
    // TO CHANGE THE CONDITION: it is this one line. Widening it (e.g. allowing
    // another api_status) means letting unverified slips reach a money leg —
    // do not do it without the owner. Mirrors legacy's startChain guard.
    if (slip.api_status !== 'success') {
      return { ran: false, skipped: 'not_success' };
    }

    /* ==== [FEAT-20260816-DUPSUCCESSLOCK] resend AFTER a success ⇒ duplicate card
     *
     * WHAT: if THIS slip's bank reference (`trans_ref`) was already credited —
     * an earlier `slip_verifications` row on the SAME hook is locked with
     * `consumed:true` + `lock_reason:'success'` (stamped by topup success or
     * walletpay success further down this file) — the runner STEPS ASIDE
     * (`ran:false`). With no payment reply to suppress it, the legacy slip-flex
     * layer answers with the card the admin bound at
     * hook › slip-verify tab › "Flex เมื่อตรวจ QR Code สถานะซ้ำ"
     * (`hook.flex_duplicate`, picked at slip-flex.handler.ts:462 because Swiftcheck
     * marks the resend `isDuplicate:true`). NO new reply path was built — this
     * gate only stops hiding the one that already existed.
     *
     * WHY THIS IS NOT THE TOPUP-DUPLICATE CASE (owner, 16/08: "flow นี้ไม่เกี่ยว
     * กับการที่ topup ตอบ duplicate" / "มันคือ success lock สลิป"): the decision
     * reads OUR OWN slip success-lock BEFORE any leg fires. Everything it does
     * not match — first sends, resends of never-credited slips, topup answering
     * 'duplicate' on its own — keeps the 15/08 DUPFORWARD behaviour below
     * byte-for-byte.
     *
     * SCALE: one findOne per verified slip, filter
     * {trans_ref, hook_id, consumed, lock_reason, _id≠self}. There is no
     * dedicated index on `trans_ref` yet — if `slip_verifications` grows past
     * ~1e5 rows, add {trans_ref:1, hook_id:1} as an owner-approved migration.
     * Scope is PER HOOK on purpose: a cross-OA resend still walks the legs,
     * where the upstream's own duplicate protection decides. Widening the scope
     * = drop `hook_id` from the filter (one line) — that is a MONEY decision.
     *
     * CHANGE: the matching rule lives entirely in the filter below, and test
     * (DS1) asserts the filter verbatim — widening it silently goes red.
     * Synthetic refs (`SWIFTCHECK_`/`FAIL_`/`ERR_` prefixes = verified-but-
     * unreferenced / failed rows) never gate: they are per-row unique, so a
     * match would be meaningless — guarded before the query (test DS3).
     *
     * FAIL-OPEN: a lookup error must never block money processing — on throw we
     * log a warning and forward exactly as before this gate existed (test DS4).
     *
     * Tests: [DUPSUCCESS] DS1-DS4 in paytool-p2-runner.spec.ts.
     * revert: delete this block — behaviour returns to DUPFORWARD-always.
     * ส่งซ้ำหลังเครดิตแล้ว = การ์ดสลิปซ้ำตอบ จบ ไม่เข้าเส้นเงินอีก. */
    try {
      const ref = String(slip.trans_ref ?? '');
      if (ref && !/^(SWIFTCHECK_|FAIL_|ERR_)/.test(ref)) {
        const prior = (await this.slipModel
          .findOne({
            _id: { $ne: slip._id },
            trans_ref: ref,
            hook_id: hook._id,
            consumed: true,
            lock_reason: 'success',
          })
          .lean()
          .exec()) as { _id?: unknown } | null;
        if (prior) {
          this.logger.log(
            `[PAYRUN] duplicate-after-success — trans_ref ${ref} already credited ` +
              `(slip ${String(prior._id)}); runner steps aside, the hook's ` +
              `flex_duplicate card answers.`,
          );
          return { ran: false, skipped: 'duplicate_after_success' };
        }
      }
    } catch (e) {
      this.logger.warn(
        `[PAYRUN] duplicate-after-success lookup failed (${(e as Error).message}) — forwarding as usual (fail-open)`,
      );
    }

    // ── [FEAT-20260815-DUPFORWARD] THERE IS NO DUPLICATE GATE HERE ANY MORE ──
    //
    // A gate used to sit at this exact spot: `isDuplicate === true` (Swiftcheck's
    // own verdict, inside `slip.raw_content`) returned
    // `{ ran:false, skipped:'duplicate_slip' }`, so a re-sent slip reached
    // NEITHER leg. The owner removed it on 15 Aug 2026:
    //
    //     "ใช่ให้ยิงทุกรอบ เพราะเราเป็นคนกลาง"
    //     "swiftcheck duplicate เราจะส่ง x api ตาม flow เดิม"
    //     "topup มีกัน duplicate อยู่แล้ว"
    //
    // WHY THAT IS RIGHT ON THE FACTS: Shop-API already refuses to credit a slip it
    // has seen — `_classifyTopup` maps that status to REJECT, exactly like
    // `fail` and `account-not-match` (see the note at the REJECT branch). The
    // balance lives upstream, so the "have I paid this already" decision belongs
    // upstream too. We forward; they decide. เราเป็นคนกลาง ปลายทางเป็นคนกัน.
    //
    // ⚠️ WHAT WAS GIVEN UP, ON PURPOSE — do not re-add the gate quietly if this
    // surfaces. The old comment argued that a topup REJECT is the signal that
    // falls through to walletpay, and walletpay could then pair a re-sent slip with a
    // DIFFERENT statement and credit it. That argument still stands on its own
    // terms; the owner accepted the exposure rather than keep blocking a
    // re-send from a system entitled to see it. Reopening it is a decision for
    // the owner, not a bug to fix in passing.
    //
    // WHAT IS UNCHANGED: everything after this point. A duplicate now travels
    // the SAME road as any other slip — same gates, same `_classifyTopup`, same
    // topup→walletpay fall-through, same statement matching. Nothing branches on
    // `isDuplicate` in the payment path any more. The owner's constraint
    // ("ห้ามแก้ไขเงื่อนไข x api > walletpay") is why the removal is a deletion here
    // rather than a new case anywhere downstream.
    //
    // `_isDuplicateSlip` went with it — it had no other caller. The FLAG lives
    // on: `slip-flex.handler.ts:377` still reads Swiftcheck's `isDuplicate` to pick
    // `flex_duplicate` for the customer-facing card. Only the payment path
    // stopped branching on it.
    //
    // revert: restore
    //     if (this._isDuplicateSlip(slip)) {
    //       return { ran: false, skipped: 'duplicate_slip' };
    //     }
    // here, and flip test (D12b) back to asserting `customTool.call` is never
    // called. Nothing else moved.
    //
    // ═══════════════════════════════════════════════════════════════════════
    // [RULE-20260815-DUPFORWARD-LATEST] ⭐ THE OWNER'S INTENT, RESTATED IN FULL
    // ON 15 AUG 2026 AND AUTHORITATIVE OVER EVERY OLDER NOTE IN THIS FILE.
    // ถ้าโน้ตเก่าที่ไหนขัดกับบล็อกนี้ — ยึดบล็อกนี้.
    //
    // TWO LAYERS, STATED SEPARATELY BY THE OWNER:
    //
    //   OUTER — if the topup leg is in use: Swiftcheck saying `isDuplicate` must
    //   NOT stop the slip. It still goes to topup. That is what removing the
    //   gate above achieves. ("ถ้า topup เปิดใช้ swiftcheck ตรวจแล้ว duplicate
    //   ก็ยังส่งต่อ topup")
    //
    //   INNER — if a walletpay tool is in use: after topup answers, THESE THREE
    //   `data.slip_status.status` values continue to the walletpay leg:
    //       fail · duplicate · account-not-match
    //   ("ส่งหมด ไป walletpay ต่อ")
    //
    //   ⚠️ [FIX-20260816-DUPFWDNOTE] `member-not-match` is NOT on that list.
    //   The 15 Aug note originally included it and claimed the code was
    //   "verified — needed no change"; that verification was WRONG: it saw the
    //   generic REJECT fall-through but overlooked the explicit
    //   `member-not-match` branch ([FEAT-20260810-MEMBERNOTMATCH], below) that
    //   intercepts BEFORE the fall-through and STOPS the run — release the
    //   slip, answer the state card, auto-open the admin ticket, never touch
    //   walletpay. The owner REAFFIRMED that stop on 16 Aug 2026 ("topup ตอบ
    //   การ์ดนี้แล้วจบ flow", with the settings page for state
    //   `member_not_match` / card `PAYmembernotmatch` on screen) — so the CODE
    //   was right all along and this comment is what needed the fix. Test
    //   (D5b ★) in paytool-p2-runner.spec.ts pins the stop; flipping the
    //   behaviour means flipping that test, and only on the owner's order.
    //   สรุป: 3 ตัวไปต่อ walletpay · member-not-match หยุดตอบการ์ด+เปิด ticket จบ.
    //
    // ✅ For the THREE statuses above the mechanism is as stated on 15 Aug:
    // `_classifyTopup` returns PROCEED only for `status === 'success'`; the
    // three fall to REJECT, and REJECT is the branch that falls through to
    // walletpay. The ONLY thing that was wrong on 15 Aug was the outer layer —
    // this gate — which cut the slip off before `_classifyTopup` ever ran.
    // ชั้นนอกคือตัวที่เคยผิด (ตัดจบก่อน) — แก้ไปแล้วด้วยการถอด gate ข้างบน.
    //
    // ⚠️ DO NOT "FIX" THE INNER LAYER TO MATCH THIS NOTE — it already matches.
    // Adding an explicit list of the four statuses would duplicate the REJECT
    // rule and drift from it. The owner's constraint stands unchanged:
    // "ห้ามแก้ไขเงื่อนไข x api > walletpay ไม่เกี่ยว".
    //
    // THE ONE CASE THAT STILL STOPS AT TOPUP: `success` — topup credited, so
    // running walletpay too would DOUBLE-CREDIT. See [FIX-20260811-TOPUPSUCCESS].
    // นี่คือกรณีเดียวที่ไม่ไป walletpay และห้ามเปลี่ยน.
    //
    // WHERE TO SEE IT IN A LIVE LOG: `[TOOLCHECK] <alias> walletpay: …` proves the
    // walletpay leg was reached and which tool it resolved to; the handoff result's
    // `context.reason` names why it stopped if it did.
    // ═══════════════════════════════════════════════════════════════════════

    const userId = slip.sender_member_user_id || slip.sender_line_user_id || '';
    const cfg = this.readCfg(tool);

    // Soft idempotency (legacy startChain): never start a 2nd run for a slip that
    // already has a live/terminal run. The atomic CAS below is the HARD guard.
    const existing = await this.runModel
      .findOne({
        slip_record_id: slip._id,
        status: { $in: ['running', 'succeeded', 'replied', 'locked_review'] },
      })
      .lean()
      .exec();
    if (existing) {
      return {
        ran: false,
        skipped: 'run_exists',
        chain_run_id: (existing as { _id: Types.ObjectId })._id,
      };
    }

    // Pre-generate the run id so the CAS claim can stamp `consumed_by_run` and we
    // create NO run doc when we lose the race (no orphan runs).
    const runId = new Types.ObjectId();

    // ⭐ MONEY-SAFETY CORE (R2): claim the slip lock BEFORE leg 1, atomically.
    // Two concurrent runs race this single-document CAS; exactly one gets
    // modifiedCount===1 and proceeds to topup. The loser no-ops — no double-topup.
    const claim = await this.slipModel
      .updateOne(
        { _id: slip._id, consumed: { $ne: true } },
        {
          $set: {
            consumed: true,
            lock_reason: 'processing',
            consumed_at: new Date(),
            consumed_by_run: runId,
          },
        },
      )
      .exec();
    if (!claim || claim.modifiedCount !== 1) {
      return { ran: false, skipped: 'already_locked' };
    }

    // Won the lock — create the run, capturing the whole transaction ONCE (legacy
    // loadRawTransaction: raw_transaction lives on the RUN, never in a leg log).
    // Read the member's raw profile ONCE and thread it to walletpay (was read twice).
    const rawProfile = await this._rawProfile(userId);
    const rawTx = this._pickTransaction(rawProfile, cfg);
    await this.runModel.create({
      _id: runId,
      chain_key: `payment:${String(tool.name || tool._id)}`,
      env_tag: this.app.wsEnv === 'prod' ? 'prod' : 'dev',
      hook_id: hook._id || null,
      member_user_id: userId,
      subject_type: 'slip',
      subject_id: slip._id,
      slip_record_id: slip._id,
      raw_transaction: rawTx,
      status: 'running',
      cursor: 0,
      current_step_order: 1,
      reply_token: replyToken || '',
      started_at: new Date(),
    });

    return this._runLegs({
      tool,
      slip,
      hook,
      userId,
      cfg,
      runId,
      startCursor: 0,
      rawProfile,
    });
  }

  /**
   * ==== THE TWO LEGS — shared by the first run AND by every [ลองใหม่] resume ====
   *
   * Split out of `_run` so a resume executes the SAME code as the first attempt.
   * The alternative — duplicating the legs for the resume path — would let the
   * two drift, and a drift on a money leg is a credit bug. เส้นทางเดียวกันเป๊ะ
   * ทั้งครั้งแรกและตอนกด [ลองใหม่].
   *
   * Everything before this point differs between the two entries (claim the lock
   * + create the run vs. verify and re-open an existing paused one); everything
   * from here is identical.
   *
   * @param startCursor which statement index walletpay begins at. 0 on a first run;
   *   the verified `resume_cursor` on a retry, so an already-uploaded statement
   *   is never re-POSTed.
   * @param rawProfile the member profile if the caller already read it (first
   *   run reads it to build `raw_transaction`); a resume passes nothing and it
   *   is read here — statements may legitimately have changed since the pause.
   */
  private async _runLegs(args: {
    tool: ToolLike;
    slip: SlipLike;
    hook: Partial<Hook> & {
      _id?: Types.ObjectId;
      customer_link_web_code?: string;
    };
    userId: string;
    cfg: PaymentCfg;
    runId: Types.ObjectId;
    startCursor: number;
    rawProfile?: unknown;
  }): Promise<PaymentRunResult> {
    const { tool, slip, hook, userId, cfg, runId, startCursor } = args;
    const rawProfile =
      args.rawProfile !== undefined
        ? args.rawProfile
        : await this._rawProfile(userId);

    // ───── LEG 1 topup — validate-slip (multipart/form-data + Shop-API HMAC) ─────
    /* [FEAT-20260903-TOPUPPERPROVIDER] the topup path may be bound to one slip
       provider; walletpay is deliberately NOT (see the helper's header). Matched
       against the ROW'S stamp — who actually verified this slip — because a
       resume can run after the hook's config changed. With no record carrying
       `slip_provider`, which is every tool today, this returns exactly what
       `findRole` returned: RULE B, Swiftcheck with nothing configured. */
    const topupEp = findTopupEndpoint(
      tool.endpoints,
      'pay_topup',
      slip['slip_provider'],
    );
    const topupFile = await this._loadSlipImage(slip, 'upload_file');
    if (!topupEp || !topupFile) {
      // Pre-topup ABORT: cannot even attempt topup ⇒ nothing credited/uploaded
      // ⇒ RELEASE the lock so the customer can resend (rule B).
      await this._release(slip._id, runId);
      await this._endRun(runId, 'failed', false);
      await this._context(
        runId,
        slip,
        1,
        'pay_topup',
        0,
        {
          outcome: 'FALSE',
          reason: topupEp ? 'no_slip_image' : 'no_topup_endpoint',
          slip_locked: false,
          lock_reason: '',
        },
        startCursor,
      );
      return this._result(runId, 'RELEASED', false, cfg, 'statement_not_found');
    }

    /* TEXT fields (signed): web_code + line_user_id + optional payload = the
     * verify result already on the slip (no extra provider call).
     *
     * ✅ [DECISION-20260903-SHOPAPIPIPE] OWNER DIRECTION, 03/09 — SlipGuard's Shop-API
     * shape is UNKNOWN and will stay unknown until the Shop-API owner answers, so
     * the answer is not to guess it: leave a PIPE. When this is built it must
     * accept a NEW PATH and NEW PARAM NAMES, each switchable on its own, without
     * disturbing what runs today and without a second place to edit.
     *
     * WHAT IS ALREADY A PIPE — no code change needed, ever:
     *   · host          `tool.base_url`
     *   · path          `endpoint.path`, with `{{var}}` templating resolved
     *                   against vars AND body — a v1 path can become a v2 path
     *                   by editing one config field
     *   · method / body encoding / auth / idempotency / timeout — all endpoint
     *     or tool config
     *   · which subtree of the envelope is sent — `payment.topup_payload_path`
     *
     * WHAT IS NOT, AND IS EXACTLY WHAT A PARAM RENAME WOULD HIT — the four wire
     * names below and on the `_loadSlipImage` line above are LITERALS:
     *   'upload_file' · 'web_code' · 'line_user_id' · 'payload'
     *
     * THE PRECEDENT IS ONE FILE AWAY, so this needs no new abstraction: walletpay's
     * file field is already config (`walletpay_file_field`, default `'slip'`,
     * `custom-tool-normalize.ts`). Same shape here — each name becomes a knob
     * whose DEFAULT IS TODAY'S LITERAL, so an untouched tool sends a byte-identical
     * request and only an operator who edits a knob changes anything. That is what
     * keeps it independent and debt-free: no flag, no branch, no second code path.
     * เผื่อท่อไว้เฉย ๆ · ค่า default = ของเดิม ⇒ ไม่แตะของที่ทำงานอยู่
     *
     * 🔴 TRAP, recorded so the "obvious" shortcut is not taken: `endpoint.payload`
     * looks like the place to add a param, but it is a `Mixed` config object
     * merged into the wire body by `_renderPayload` — using it would change the
     * SIGNED canonical, not just the body.
     *
     * 📄 REF: `docs/slip-spec.md` §5.9 and the 03/09 decisions section. */
    const webCode = hook.customer_link_web_code || '';
    const payloadField = canonicalizePayloadField(
      this._swiftcheckResult(slip, cfg),
    );
    const topupFields: Record<string, string> = {
      web_code: webCode,
      line_user_id: userId,
    };
    if (payloadField) topupFields.payload = payloadField;

    // Decrypt the Shop-API secret at call time; sign the multipart canonical.
    const secret = (this.crypto.safeDecrypt(tool.api_key) as string) || '';
    const signed = buildValidateSlipHeaders({
      secret,
      webCode,
      fields: topupFields,
      file: {
        field: topupFile.field,
        buffer: topupFile.buffer,
        filename: topupFile.filename || 'slip.jpg',
      },
    });

    const topupRes = await this.customTool.call(
      tool as never,
      '',
      userId,
      { ...topupFields },
      {
        role: 'pay_topup',
        fileParts: [topupFile],
        extraHeaders: signed.headers,
        idempotencyKey: slip.trans_ref ? `${slip.trans_ref}:topup` : undefined,
        // [P2D] MONEY LEG: never auto-retry. A retried validate-slip would drop
        // this per-request X-Signature (and the ~5-min X-Timestamp would be
        // stale), so a retry can't credit; a timeout is classified REVIEW instead.
        disableRetry: true,
      },
    );
    await this._logLeg({
      runId,
      slip,
      hook,
      userId,
      role: 'pay_topup',
      chainStep: 1,
      cursor: 0,
      // [FIX-20260817-RESUMEDEDUPE] LEG 1 is re-entered by every resume with the
      // same hard-coded cursor 0, so the generation is the only thing that keeps
      // one attempt's log row apart from the next.
      generation: startCursor,
      // Never store the raw image bytes in the log; record a marker instead.
      reqBody: { ...topupFields, upload_file: '<slip-image>' },
      res: topupRes,
      snapshotExtra: {},
    });

    /* [DOC-20260810-PAYSTATES] The four states that STOP the run before walletpay —
     * TIMEOUT (here), NOT_LINKED (:1073), member-not-match (:1125) and
     * process-wallet (:1102) — are tabulated with their reasons in
     * `docs/payment-states.md` §2.1. Everything else falls through
     * to LEG 2 on purpose. */
    const topup = this._classifyTopup(topupRes);
    if (topup.kind === 'TIMEOUT') {
      // HARD STOP: no response ⇒ topup MAY have credited ⇒ we must NOT fall to
      // walletpay (that could double-credit). Keep the lock, flag review (fail-safe).
      await this._stampLock(slip._id, runId, 'timeout', 0);
      await this._endRun(runId, 'locked_review', true);
      await this._context(
        runId,
        slip,
        1,
        'pay_topup',
        0,
        {
          outcome: 'TIMEOUT',
          slip_locked: true,
          lock_reason: 'timeout',
          // REVIEW CASE 1 of 4. topup gave no usable answer, so we do NOT know
          // whether the wallet was credited — the slip stays LOCKED and a human
          // decides. See the REVIEW-REASON MAP on `_context` for all four.
          // TO CHANGE: the reason string is free-form and safe to rename (nothing
          // branches on it). Do NOT drop `needs_review` here — an unknown money
          // outcome must reach a person. ห้ามเอา needs_review ออก เงินไม่รู้ผล.
          needs_review: true,
          review_reason: 'topup_timeout',
        },
        startCursor,
      );
      return this._result(runId, 'REVIEW', true, cfg, 'review');
    }
    if (topup.kind === 'NOT_LINKED') {
      // [FEAT-20260809-PAYTOOL-NOTLINKED] The account does not exist, so no
      // wallet was credited and walletpay cannot help either (it needs a member
      // statement, and there is no member). RELEASE the lock so the customer
      // can link and resend the SAME slip — that is the whole point: the fix is
      // theirs and takes seconds, versus a locked slip waiting on an admin.
      //
      // Releasing is safe here specifically because NOT_LINKED is a definite
      // "nothing was credited" (see _classifyTopup for why it is matched on the
      // error CODE and not on the 404).
      await this._release(slip._id, runId);
      await this._endRun(runId, 'stopped', false);
      await this._context(
        runId,
        slip,
        1,
        'pay_topup',
        0,
        {
          outcome: 'FALSE',
          reason: topup.status || 'CUSTOMER_NOT_LINKED',
          slip_locked: false,
          lock_reason: '',
        },
        startCursor,
      );
      return this._result(runId, 'RELEASED', false, cfg, 'not_linked');
    }
    if (topup.kind === 'PROCEED') {
      // ✅ TERMINAL SUCCESS — `process-wallet`: topup CREDITED the wallet. Do all
      // three now and STOP: FINALIZE the lock ('success'), reply the success
      // state, and DO NOT run walletpay (walletpay is the ALTERNATIVE credit path, used
      // only when topup did NOT credit — running it here would double-credit).
      await this._stampLock(slip._id, runId, 'success', 0);
      await this._endRun(runId, 'succeeded', false);
      await this._context(
        runId,
        slip,
        1,
        'pay_topup',
        0,
        {
          outcome: 'TRUE',
          reason: 'process-wallet',
          slip_locked: true,
          lock_reason: 'success',
        },
        startCursor,
      );
      // [FEAT-20260810-PAYSTATEFLEX] pass the bindings so a bound card wins.
      return this._result(
        runId,
        'SUCCESS',
        false,
        cfg,
        'topup_success',
        '',
        hook.payment_flex_ids,
      );
    }
    /* ══ [FEAT-20260810-MEMBERNOTMATCH] `member-not-match` หยุดที่นี่ ไม่ไป walletpay ══
     *
     * WHAT: topup ตอบ `slip_status.status === 'member-not-match'` = บัญชีต้นทาง
     *       ที่โอนมา **ไม่ใช่ของลูกค้าคนนี้** ⇒ จบที่นี่ ตอบข้อความ + แจ้งแอดมิน
     * WHY:  walletpay เป็น "ทางเติมเงินสำรอง" ไว้ใช้ตอน topup อ่านสลิปไม่ผ่าน
     *       แต่เคสนี้สลิปอ่านผ่านแล้ว ปัญหาคือ **ตัวตนเจ้าของเงินไม่ตรง**
     *       ซึ่ง walletpay ก็ตัดสินแทนไม่ได้ ⇒ ไปต่อก็เสียเวลาและเสี่ยงเติมผิดคน
     *       (เจ้าของสั่ง 2026-08-10)
     * SLIP: **ปล่อย** (เจ้าของเลือกข้อ ข) — ไม่มีเงินเคลื่อนและไม่มีการอัปโหลด
     *       ลูกค้าจึงส่งสลิปใบใหม่ได้ทันที ไม่ต้องรอแอดมินปลดล็อก
     * REVIEW: `needs_review: true` + `review_reason: 'member_not_match'`
     *       ⇒ ขึ้นหน้า log ให้แอดมินกรองเจอ ตรงกับที่ข้อความบอกลูกค้าว่าจะมีคนมาดู
     *
     * ⚠️ `account-not-match` **ไม่แตะ** — ยังตกไป walletpay เหมือนเดิมตามที่เจ้าของสั่ง
     *    (คนละเรื่องกัน: อันนั้นคือเลขบัญชีปลายทางไม่ตรง ซึ่ง walletpay อาจจับคู่ได้)
     * revert: ลบบล็อกนี้ทั้งก้อน ⇒ กลับไปตกลง walletpay รวมกับ reject ตัวอื่น
     */
    if (topup.status === 'member-not-match') {
      await this._release(slip._id, runId);
      await this._endRun(runId, 'failed', true);
      await this._context(
        runId,
        slip,
        1,
        'pay_topup',
        0,
        {
          outcome: 'FALSE',
          reason: 'member-not-match',
          slip_locked: false,
          lock_reason: '',
          needs_review: true,
          review_reason: 'member_not_match',
        },
        startCursor,
      );
      /* [FEAT-20260810-PAYTICKET] เปิด ticket ให้แอดมินเห็นในหน้าเคส
         WHY: ข้อความที่เพิ่งตอบลูกค้าบอกว่า "จะแจ้งพี่แอดมินให้มาดูแลต่อ" —
              ถ้าไม่เปิด ticket จริง คำพูดนั้นไม่เป็นจริง (needs_review ขึ้นแค่
              หน้า log ของ payment ซึ่งคนละหน้ากับรายการเคสที่แอดมินเฝ้าอยู่)
         กันซ้ำ: helper ใช้ atomic claim บน assist_status — ห้องที่มีคนดูแลอยู่แล้ว
              หรือมี ticket ค้าง จะไม่ถูกเปิดซ้ำ
         ⚠️ ไม่ await ผลลัพธ์แบบมีเงื่อนไข และ helper ไม่ throw — การเปิด ticket
              ล้มเหลวต้องไม่ทำให้ลูกค้าไม่ได้รับ reply (reply ถูกคืนด้านล่างเสมอ)
         revert: ลบบล็อกนี้ + payment-ticket.helper.ts + 2 model ใน payment.module */
      /* [FEAT-20260810-CARDTICKET] Capture the id the helper already returned — it
         was discarded before. Purely additive: nothing below branches on it. The
         delivery layer uses it to retitle this row when a bound card carries its own
         reason, so the runner never has to know about cards. */
      /* [FIX-20260811-PAYDIVIDER] `true` เมื่อ helper เขียน divider ในรอบนี้
         ⇒ delivery layer จะไม่เขียนซ้ำเมื่อการ์ดมี flag เปิด */
      let dividerDone = false;
      const openedTicketId = await openPaymentTicketIfIdle(
        {
          channelUserId: userId,
          hookId: hook._id,
          needDetail:
            'สลิปโอนมาจากบัญชีที่ไม่ใช่ของลูกค้า — ต้องให้แอดมินตรวจสอบ',
          /* [FEAT-20260810-DIRECTTICKET] ข้อความนี้ไปโผล่บน divider ในห้องแชต
             ("เคสนี้สร้างโดยระบบ เนื่องจาก ..." + ข้อความนี้) จึงเขียนให้แอดมิน
             อ่านรู้เรื่องทันที ไม่ใช่โค้ดภายในอย่าง 'payment:member-not-match'
             เจ้าของสั่งข้อความนี้ 2026-08-10 */
          directDetail: 'บัญชีที่โอนมา ไม่ใช่บัญชีของคุณลูกค้าเอง',
        },
        {
          chatRoomModel: this.chatRoomModel,
          ticketModel: this.ticketModel,
          memberModel: this.memberModel as never,
          publishTicketNew: (d) =>
            void this.realtimePublisher.publish('ticket:new', d as never),
          /* [FIX-20260811-PAYDIVIDER] ห้องถูก claim แล้ว = ไม่เปิด ticket ใบใหม่
             แต่แอดมินยังต้องเห็นว่ามีสลิปเข้ามาอีกใบ ⇒ เขียนเส้นคั่นแถวจริง
             `writeTicketDivider` กลืน error เองทั้งหมด จึงไม่ทำให้ flow เงินล้ม
             ตั้ง `dividerDone` ไว้ให้ delivery layer รู้ว่ารอบนี้เขียนแล้ว จะได้ไม่เขียนซ้ำ
             (การ์ดที่มี flag เปิดจะเรียก helper ตัวเดียวกันต่อจากนี้ในการตรวจเดียวกัน) */
          writeDivider: (i) => {
            dividerDone = true;
            return writeTicketDivider(i, {
              chatMessageModel: this.chatMessageModel,
              chatRoomModel: this.chatRoomModel,
              warn: (m: string) => this.logger.warn(m),
            });
          },
          log: (m: string) => this.logger.log(m),
          warn: (m: string) => this.logger.warn(m),
        },
      );

      return {
        ...this._result(runId, 'RELEASED', true, cfg, 'member_not_match'),
        // [FEAT-20260810-CARDTICKET] additive; `undefined` when no ticket was opened.
        ...(openedTicketId ? { directTicketId: openedTicketId } : {}),
        ...(dividerDone ? { dividerDone: true } : {}),
      };
    }

    /* ══ [FEAT-20260823-TOPUPDUP] `duplicate` หยุดที่นี่ ไม่ไป walletpay ═══════════
     *
     * WHAT: topup ตอบ `slip_status.status === 'duplicate'` = ปลายทาง (Shop-API)
     *   บอกว่า **สลิปใบนี้เคยถูกใช้เติมไปแล้ว** ⇒ หยุด ตอบลูกค้าด้วยการ์ด
     *   duplicate แล้วจบ ไม่ส่งต่อ walletpay.
     *
     * WHY (เจ้าของสั่ง 23/08/2026): ก่อนหน้านี้ `duplicate` เดินถนนเดียวกับ
     *   `fail`/`account-not-match` คือไหลไป walletpay ต่อ (คำสั่ง 15/08:
     *   "topup มีกัน duplicate อยู่แล้ว" — ให้ปลายทางเป็นคนกัน). ผลคือลูกค้า
     *   ที่ส่งสลิปซ้ำได้คำตอบตามผลของ walletpay ซึ่ง**ไม่ได้บอกว่าซ้ำ** เจ้าของจึง
     *   สั่งกลับคำ: เคสนี้ต้องตอบตรง ๆ ว่า "สลิปนี้ถูกใช้ไปแล้ว".
     *
     * ⚠️ นี่คือการ **กลับคำตัดสิน 15/08** — ไม่ใช่การแก้บั๊ก. คอมเมนต์ที่
     *   `:1046` (DUPFORWARD) และเทส `(D5 ★)`/`(D5e)` ถูกอัปเดตพร้อมกัน.
     *
     * ── สิ่งที่เลือกไว้ และวิธีเปลี่ยนถ้าเปลี่ยนใจ (เจ้าของ: "note ไว้ด้วย เผื่อเปลี่ยน") ──
     *
     *   (ก) **ปล่อยสลิป** (`_release` + outcome `RELEASED`) — ลูกค้าส่งใบใหม่ได้
     *       ทันทีโดยไม่ต้องรอใครปลดล็อก. เหตุผล: เงินของใบนี้เข้าไปแล้วตั้งแต่
     *       ครั้งก่อน การล็อกไว้ไม่ได้กันอะไรเพิ่ม มีแต่ทำให้ใบถัดไปติด.
     *       ⇒ **อยากล็อกแทน**: เปลี่ยน `_release(...)` เป็นไม่เรียก และเปลี่ยน
     *          outcome `'RELEASED'` เป็น `'REVIEW'` (ล็อกจะ finalize เป็น 'timeout')
     *
     *   (ข) **ไม่เปิด ticket** — ต่างจาก `member-not-match` ที่เปิด. เหตุผล:
     *       เคสนี้ระบบตอบลูกค้าได้ครบแล้วว่าเกิดอะไรขึ้น ไม่มีอะไรให้คนมาตัดสิน
     *       และเทส `(D5e)` ตรึงไว้แต่เดิมว่า duplicate ไม่เปิด ticket.
     *       ⇒ **อยากเปิด ticket**: ก๊อปบล็อก `openPaymentTicketIfIdle` จากสาขา
     *          `member-not-match` ข้างบนมาวาง แล้วส่ง `needs_review: true`
     *          (ต้องแก้เทส `(D5e)` ด้วย มันตรึงว่าไม่เปิด)
     *
     *   (ค) **ไม่ตั้ง needs_review** — ไม่ใช่เคสที่เงินหาย/ไม่รู้ผล ปลายทางตอบ
     *       ชัดเจนว่าซ้ำ ⇒ ไม่ต้องมีคนมาไล่ดู
     *
     *   (ง) **การ์ดที่ตอบ**: ใช้ `hook.flex_duplicate` ของ Swiftcheck ผ่าน default
     *       ที่ `payment-state-flex.resolver.ts` (`withSwiftcheckDuplicateFallback`)
     *       ⇒ OA ที่ตั้งการ์ด duplicate ไว้แล้วได้ใช้ทันที **ไม่ต้องตั้งอะไรเพิ่ม**
     *       และถ้าวันหนึ่งอยากได้การ์ดของตัวเอง ก็ผูก `payment_flex_ids.topup_duplicate`
     *       ทับได้เลย (ของที่ผูกเองชนะ default เสมอ)
     *       ⇒ **ไม่ตั้งการ์ดเลยทั้งคู่** = ตอบเป็นข้อความ `REPLY_TEXT.topup_duplicate`
     *
     * revert ทั้งบล็อก: ลบ `if` นี้ทั้งก้อน ⇒ `duplicate` กลับไปไหลลง REJECT
     *   ข้างล่างและไป walletpay เหมือนก่อน 23/08 (ไม่ต้องแตะที่อื่น — state,
     *   ข้อความ และ default การ์ด ที่เหลือจะกลายเป็นโค้ดที่ไม่มีใครเรียก) */
    if (topup.status === 'duplicate') {
      await this._release(slip._id, runId);
      await this._endRun(runId, 'failed', false);
      await this._context(
        runId,
        slip,
        1,
        'pay_topup',
        0,
        {
          outcome: 'FALSE',
          reason: 'duplicate',
          slip_locked: false,
          lock_reason: '',
        },
        startCursor,
      );
      return this._result(runId, 'RELEASED', false, cfg, 'topup_duplicate');
    }

    // topup REJECT — `fail` | `account-not-match`
    // [FEAT-20260823-TOPUPDUP] `duplicate` ไม่อยู่ในลิสต์นี้แล้ว — ถูกดักและหยุด
    // ที่บล็อกข้างบนตั้งแต่ 23/08/2026. เหลือสองตัวนี้ที่ยังไหลต่อ. topup
    // did NOT credit ⇒ fall through to walletpay, the alternative credit path. The
    // slip stays claimed (do NOT release here — walletpay is about to upload it).
    await this._context(
      runId,
      slip,
      1,
      'pay_topup',
      0,
      {
        outcome: 'FALSE',
        reason: topup.status || 'reject',
        slip_locked: true,
        lock_reason: 'processing',
      },
      startCursor,
    );

    // ───── LEG 2 walletpay (topup did not credit) ─────
    return this._runWalletpay({
      tool,
      slip,
      hook,
      userId,
      cfg,
      runId,
      rawProfile,
      topupFile,
      topupData: topupRes.data,
      startCursor,
    });
  }

  private async _runWalletpay(args: {
    tool: ToolLike;
    slip: SlipLike;
    hook: HookLike;
    userId: string;
    cfg: PaymentCfg;
    runId: Types.ObjectId;
    /** Member raw profile read ONCE in _run (statement source). */
    rawProfile: unknown;
    /** The slip image already loaded for topup, re-fielded for walletpay's part. */
    topupFile: CustomToolFilePart;
    topupData: unknown;
    /**
     * [P2C-2c] Where the statement walk BEGINS. 0 on a first run; on a
     * [ลองใหม่] resume it is the verified `resume_cursor`, so statements already
     * uploaded are skipped rather than re-POSTed. Money safety: this is the
     * single value that prevents a retry from paying the same statement twice.
     */
    startCursor?: number;
  }): Promise<PaymentRunResult> {
    const { tool, slip, hook, userId, cfg, runId, rawProfile, topupFile } =
      args;
    const { topupData } = args;

    // Reached ONLY because topup did NOT credit. walletpay is the alternative credit
    // path. First we must find the walletpay statement matching the slip amount to
    // get a refId; if we cannot even attempt walletpay (no endpoint / no statement /
    // no image) then NOTHING was credited or uploaded ⇒ fallback reply + RELEASE
    // the lock so the customer can resend (rule B: statement-not-found).
    // ══════════════════════════════════════════════════════════════════════
    // [FEAT-20260809-PAYTOOL-WALLETPAYTOOL] walletpay may live in its OWN tool
    // ══════════════════════════════════════════════════════════════════════
    // WHY: topup is a sub-endpoint of the Shop-API tool the OA already has —
    // `shop-api/v1/customer/validate-slip` sits beside `shop-api/v1/customer`, same
    // host, same HMAC secret. There is no reason to duplicate that tool.
    // walletpay is a DIFFERENT system on a DIFFERENT host with no auth, so it is a
    // separate tool, bound per OA. topup = ลูกของ Shop-API เดิม · walletpay = แยก tool.
    //
    // ⭐ SEAMLESS WHEN UNSET — most OAs will never set this.
    // The separate tool is used ONLY when the operator did BOTH: switched
    // `walletpay_tool_status` on AND bound a `walletpay_tool_id`. Anything else —
    // flag off, no id, neither, or an OA created before this field existed —
    // falls through to the original single-tool layout with no behaviour change
    // at all. ไม่ตั้ง = ทำงานเหมือนเดิมทุกอย่าง.
    //
    // RESOLUTION ORDER (first match wins):
    //   1. the dedicated walletpay tool — flag ON *and* id set.
    //   2. the payment tool itself — a `pay_walletpay` endpoint on the SAME tool.
    //
    // WHY THE FLAG IS READ FIRST, not just "is the id truthy": it mirrors
    // `custom_tool_status`/`payment_tool_status`, so all three bindings behave
    // identically, and it lets an operator switch the separate tool off WITHOUT
    // losing which tool they had picked. It also kills a class of bug where an
    // empty string or a stale id silently redirects a money leg.
    //
    // ⚠️ The walletpay tool is NOT category-gated. `resolvePaymentTool` requires
    // `category:'payment'` because that flag guards the MONEY KILL SWITCH; the
    // walletpay tool is only reached AFTER that gate has already passed, and
    // forcing the category here would make an ordinary tool row unusable as a
    // walletpay target for no safety gain.
    let walletpayTool: ToolLike = tool;
    let walletpayEp = this.findRole(tool, 'pay_walletpay');

    const h = hook as {
      walletpay_tool_status?: unknown;
      walletpay_tool_id?: unknown;
    };
    // BOTH required. `!== true` (not a truthy test) so the string 'false', 0 or
    // any junk value can never switch a money leg to a different host.
    const useSeparateWalletpay =
      h.walletpay_tool_status === true && !!h.walletpay_tool_id;
    const walletpayToolId = h.walletpay_tool_id;
    if (useSeparateWalletpay) {
      const separate = (await this.customTool.getTool(
        walletpayToolId as never,
        {
          skipCache: true,
        },
      )) as ToolLike | null;
      const ep = separate ? this.findRole(separate, 'pay_walletpay') : null;
      if (separate && separate.status !== false && ep) {
        walletpayTool = separate;
        walletpayEp = ep;
        /* [FEAT-20260815-TOOLRESOLVELOG] the other half of the pair — the
           payment leg logs its own line in `resolvePaymentTool`. Together they
           answer "which tool is this OA actually using, and is it allowed to"
           for BOTH legs, from the log alone. LOG ONLY: the branch, the
           fallback below and every return are byte-identical to before. */
        this.logger.log(
          `[TOOLCHECK] ${String((hook as { alias?: unknown })?.alias ?? '-')} ` +
            `walletpay: OK "${String(separate.name)}" ` +
            `id=${String(walletpayToolId)} category=${String(separate.category)} (separate tool)`,
        );
      } else {
        // Bound but unusable (deleted / disabled / no pay_walletpay endpoint).
        // Do NOT silently fall back to the payment tool: an operator who bound a
        // walletpay tool expects THAT one to be used, and quietly POSTing the slip
        // somewhere else is a money-path surprise. Fail into the normal
        // "cannot attempt walletpay" path, which RELEASES the lock (nothing was
        // uploaded) so the customer can resend.
        this.logger.error(
          `[PAYRUN] walletpay_tool_id ${String(walletpayToolId)} is bound but unusable`,
        );
        return this._statementFallback(
          runId,
          slip,
          cfg,
          'walletpay_tool_invalid',
          args.startCursor,
          { hook, userId, rawProfile },
        );
      }
    }

    if (!walletpayEp) {
      /* [FEAT-20260815-TOOLRESOLVELOG] the third outcome, previously silent:
         no separate tool bound AND the payment tool has no pay_walletpay line. */
      this.logger.log(
        `[TOOLCHECK] ${String((hook as { alias?: unknown })?.alias ?? '-')} ` +
          `walletpay: NO ENDPOINT (separate=${useSeparateWalletpay ? 'yes' : 'no'}, ` +
          `payment tool "${String(tool.name)}" has no pay_walletpay line)`,
      );
      return this._statementFallback(
        runId,
        slip,
        cfg,
        'no_walletpay_endpoint',
        args.startCursor,
        { hook, userId, rawProfile },
      );
    }

    /* [FEAT-20260815-TOOLRESOLVELOG] and the fallback case: no separate walletpay
       tool, so the payment tool's own pay_walletpay line is used. Logged so the
       reader never has to guess which of the two shapes is in play. */
    if (!useSeparateWalletpay) {
      this.logger.log(
        `[TOOLCHECK] ${String((hook as { alias?: unknown })?.alias ?? '-')} ` +
          `walletpay: OK "${String(walletpayTool.name)}" (same tool as payment leg)`,
      );
    }

    // Statements this slip could match: walletpay + (status) + slip amount.
    //
    // ── INTERNAL STATE — this is OUR decision, not an external answer ──────────
    // We are NOT calling walletpay/topup here. We read the member's OWN statements
    // (already stored in `member.raw_profile_data`, from the earlier profile
    // fetch) and match locally: statement.amount === slip.amount, provider
    // 'walletpay', status 'waiting-deposit'. walletpay needs a refId, and the refId
    // lives on the matching pending statement — so "no match" means we have
    // nothing to POST to walletpay with, and we STOP BEFORE ever touching walletpay.
    //
    // WHY THERE IS NO PENDING STATEMENT (customer-side, not a system fault):
    //   • the paid amount differs from any pending deposit (paid 100, pending 300)
    //   • the customer never opened a deposit request before sending the slip
    //   • the statement has not synced yet (slip sent seconds after transfer)
    // All three are self-correctable by the customer — so the fallback RELEASES
    // the slip (no money moved, nothing uploaded) and replies "ตรวจยอดไม่ได้"
    // rather than locking it for an admin. See `_statementFallback`.
    // ยอดในสลิปไม่ตรงกับรายการรอฝากของลูกค้าเอง = จบก่อนยิง walletpay, ปล่อยให้ส่งใหม่.
    /* ══════════════════════════════════════════════════════════════════════
     * [NOTE-20260810-NOMATCHSTATEMENT] THE AMOUNT MATCH — read this before
     * changing the condition, because the rule here is the whole feature.
     * ══════════════════════════════════════════════════════════════════════
     * IN PLAIN LANGUAGE, this branch is the symptom:
     *     **"ยอดในสลิปไม่ตรงกับยอดรายการรอฝากของลูกค้า"**
     *     (the amount on the slip does not equal the amount on any pending
     *      deposit in the customer's own statements)
     *
     * WHAT IS COMPARED (`_matchStatements`), all three must hold:
     *   1. `statement.amount === slip.amount`   ← EXACT equality, no tolerance
     *   2. `provider === cfg.statement_provider_code`      (default 'walletpay')
     *   3. `status   === cfg.statement_status`   (default 'waiting-deposit')
     * The statements come from `member.raw_profile_data` at
     * `cfg.statement_tx_path` — data WE already hold, not a live call. Nothing
     * outside this process is contacted to make this decision.
     *
     * WHY A MISS STOPS EVERYTHING: walletpay is addressed by `refId`, and the refId
     * lives ON the matching pending statement. No match ⇒ no refId ⇒ there is
     * literally nothing to POST. We stop BEFORE walletpay rather than guessing.
     *
     * WHERE IT SURFACES: `_statementFallback('no_matching_statement')` →
     * outcome RELEASED → the customer reads
     * `REPLY_TEXT.statement_not_found` = "ไม่สามารถตรวจสอบยอดเงินได้"
     * (overridable per tool via `payment.not_found_reply_text`). No money moved,
     * no file uploaded, slip NOT locked — resending is safe and expected.
     *
     * ⚠️ IF THIS RULE IS EVER LOOSENED — the obvious request is a tolerance
     * ("±1 baht", "ignore decimals") or matching a different status. Both are
     * MONEY decisions, not cleanups: a tolerance lets a 2,094 slip settle a
     * 2,093 deposit, and a wider status can pair a slip with a deposit that was
     * already handled. Change `_matchStatements`, keep the exact-equality
     * default, and put the tolerance in `tool.payment.*` so it is per-OA config
     * with an audit trail — never a hardcoded constant here.
     * แก้เงื่อนไขนี้ = แตะเงิน ต้องผ่าน config ไม่ใช่ฮาร์ดโค้ด.
     */
    /* [NOTE-20260815-WALLETPAYARMED] Reached only with the walletpay leg ARMED — the
       tool checks above (`walletpay_tool_invalid`, `no_walletpay_endpoint`) have
       already returned for the unarmed shapes, so a zero-candidate result here
       genuinely means "walletpay could have verified this, and no pending deposit
       matches the slip amount". เงื่อนไขคือมี walletpay tool เปิดอยู่ด้วย.
       ⚠️ All three reasons still surface as the SAME customer text — the
       breakdown lives in payment-reply-copy.ts on `statement_not_found`. */
    const candidates = this._matchStatements(rawProfile, slip, cfg);
    if (!candidates.length) {
      /* [FEAT-20260815-NOCANDIDATELOG] Say WHY there was no candidate, on the
         one path that used to go quiet. Owner-requested 15/08/2026: "ถ้าไม่ทำ
         walletpay เพราะไม่เข้า ก็ยังต้อง log เก็บ … ต้องโชว์เงื่อนไข candidate ของเราด้วย".
         Until now the handoff result for step 2 carried `reason` alone with an
         EMPTY `final`, so "no match" and "never ran" looked identical and the
         inputs behind the decision were unrecoverable after the fact.
         LOG ONLY — the matching itself is untouched; this reads the same values
         `_matchStatements` just read and prints them. ห้ามกระทบการตรวจ walletpay. */
      this._logNoCandidate(hook, slip, cfg, rawProfile);
      // [FEAT-20260810-AMOUNTTICKET] pass the ticket context for THIS reason only.
      return this._statementFallback(
        runId,
        slip,
        cfg,
        'no_matching_statement',
        args.startCursor,
        {
          hook,
          userId,
          // [FEAT-20260810-TICKETAMOUNTS] so the ticket can name the real amounts.
          rawProfile,
        },
      );
    }

    // Reuse the slip image bytes already loaded for topup — just re-field it to
    // walletpay's file field (avoids a second ImageStorage read).
    const file: CustomToolFilePart = {
      ...topupFile,
      field: cfg.walletpay_file_field,
    };

    const total = candidates.length;
    // [P2C-2c] Begin at the resume index, not at 0 — statements before it were
    // already uploaded on an earlier attempt and must never be re-POSTed.
    // Clamped so a corrupt/oversized cursor can only end the walk (⇒ the
    // exhaustion path below), never wrap around to statement 0.
    const from = Math.max(0, args.startCursor ?? 0);
    if (from >= total) {
      // Every candidate was already tried across the pause/retry cycles: the
      // slip was uploaded everywhere and nothing matched ⇒ same terminal state
      // as walking off the end of a first run.
      return this._walletpayReview(
        runId,
        slip,
        total,
        cfg,
        'walletpay_exhausted',
        from,
        { hook, rawProfile },
      );
    }
    // [FEAT-20260811-WALLETPAY4040] How many POSTs walletpay actually ACCEPTED an
    // upload for in THIS walk. A `no_match` counts (the slip was uploaded and
    // the statement is spent); a 4040/4001 reject does NOT (walletpay answered
    // before consuming anything). Decides the exhaustion ending below: zero
    // uploads ⇒ releasing is safe, any upload ⇒ must stay locked.
    let uploaded = 0;
    // [FEAT-20260811-WALLETPAY4040] statements whose refId walletpay called malformed
    // (`400 code:4000`). Skipped like 4040, but if the whole walk ends with
    // ZERO uploads and ≥1 of these, the release is FLAGGED for review instead
    // of silent — a malformed ref_id is upstream data / integration damage that
    // resending will never fix, and someone must see it.
    let invalidRefs = 0;
    for (let cursor = from; cursor < total; cursor++) {
      const entry = candidates[cursor];
      if (!entry) continue;
      const refId = this._extractRefId(entry, cfg);
      // Money-safety: never POST `.../payin//slip`. No refId → skip this entry.
      if (!refId) {
        /* ==== [FEAT-20260818-NOREFLOG] say WHY this statement was skipped ====
         *
         * This skip used to be SILENT — the only per-statement outcome in the
         * walk that left no trace, while its two siblings below (`4040`
         * expired, `4000` malformed) each write a row. So a walk that ended
         * `walletpay_exhausted` looked identical whether every candidate had been
         * uploaded or every candidate had been dropped here without walletpay ever
         * being called.
         *
         * That is not hypothetical. On production run 6a83e019…1131 the second
         * candidate's `info` was `null`, so `walletpay_ref_id_field` ('info.*')
         * resolved to nothing, the statement was skipped here, and the customer
         * was told the slip had been checked against every statement. Nothing
         * anywhere recorded that one had never been sent.
         *
         * The row names the configured PATH, not just "missing": the same
         * statement carries a usable top-level `ref_id`, so "which field did we
         * read" is the question an operator actually needs answered.
         * ห้ามข้ามเงียบ — ต้องบอกว่าอ่าน field ไหนแล้วไม่เจอ.
         *
         * NOT a money decision: the skip itself is unchanged, and a failed log
         * write must never cost the walk. revert: drop this block, keep `continue`. */
        await this._context(
          runId,
          slip,
          2,
          'pay_walletpay',
          cursor,
          {
            outcome: 'FALSE',
            reason: 'walletpay_no_ref_id',
            statement_ref: '',
            statement_total: total,
            ref_id_field: cfg.walletpay_ref_id_field,
          },
          from,
        );
        continue;
      }

      await this.runModel
        .updateOne({ _id: runId }, { $set: { cursor, current_step_order: 2 } })
        .exec();

      const walletpayBody = this._walletpayBody(
        slip,
        hook,
        userId,
        refId,
        cfg,
        topupData,
      );
      const res = await this.customTool.call(
        // [WALLETPAYTOOL] `walletpayTool`, NOT `tool` — this is what makes the
        // separate binding actually take effect. The URL is built from the
        // tool's own `base_url`, so using the payment tool here would POST the
        // slip to the TOPUP host (the exact misconfiguration that produced 404s
        // during the live test).
        walletpayTool as never,
        '',
        userId,
        walletpayBody,
        {
          role: 'pay_walletpay',
          fileParts: [file],
          // [P2D] MONEY LEG: never auto-retry (an unclear walletpay → REVIEW, not a
          // blind re-upload of the same slip).
          disableRetry: true,
        },
      );
      await this._logLeg({
        runId,
        slip,
        hook,
        userId,
        role: 'pay_walletpay',
        chainStep: 2,
        // [FIX-20260817-RESUMEDEDUPE] carried for the same reason as LEG 1. In
        // practice `cursor` already differs per statement, so this only matters
        // if a future change ever re-visits an index.
        generation: from,
        cursor,
        reqBody: walletpayBody,
        res,
        snapshotExtra: {
          walletpay_ref_id: refId,
          statement_ref: refId,
          stmt_idx: cursor,
          statement_total: total,
        },
      });

      const b = this._classifyWalletpay(res);
      // Money-audit anchors from the walletpay body (captured into the chain-log,
      // matching the legacy log's statement_ref + outcome capture).
      const mr = this._readMatchResult(res.data);
      const respMsg = this._walletpayMessage(res);
      const anchors = {
        statement_ref: refId,
        statement_total: total,
        transaction_id: mr.transactionId || '',
        bank_expect_id: mr.bankExpectId || '',
      };

      if (b === 'TXN_NOT_FOUND') {
        // ==== [FEAT-20260811-WALLETPAY4040] stale statement — skip, don't stop ====
        //
        // walletpay: `404 {"code":4040}` = the payin transaction behind THIS
        // statement's refId no longer exists (expired/purged on walletpay's side —
        // the member statement is stale). DEFINITE answer: nothing was uploaded,
        // nothing credited, and no retry can revive a dead refId — so unlike
        // `no_match` there is nothing to pause and ask the customer about.
        // Walk on to the next candidate exactly like the no-refId skip above.
        // The context row makes each dead statement visible in the payment log.
        // statement ค้าง/หมดอายุฝั่ง walletpay — ข้ามไปใบถัดไป ไม่ล็อค ไม่ถามลูกค้า.
        await this._context(
          runId,
          slip,
          2,
          'pay_walletpay',
          cursor,
          {
            outcome: 'FALSE',
            reason: 'walletpay_txn_not_found',
            ...anchors,
          },
          from,
        );
        continue;
      }
      if (b === 'INVALID_REF') {
        // ==== [FEAT-20260811-WALLETPAY4040] malformed refId — skip, remember ====
        //
        // walletpay: `400 {"code":4000,"message":"Invalid refId"}` — the refId
        // FORMAT failed validation before any processing (caught live: a
        // member statement carried a 13-char final UUID segment). Nothing was
        // uploaded. Per-statement like 4040 — the next candidate may carry a
        // valid refId — but counted separately so a zero-upload ending can be
        // FLAGGED (see the exhaustion split below): bad ref data is not
        // routine expiry. refId เพี้ยนจากข้อมูลต้นทาง — ข้ามใบนี้ แต่จดไว้เตือนแอดมิน.
        invalidRefs++;
        await this._context(
          runId,
          slip,
          2,
          'pay_walletpay',
          cursor,
          {
            outcome: 'FALSE',
            reason: 'walletpay_invalid_ref',
            ...anchors,
          },
          from,
        );
        continue;
      }
      if (b === 'BAD_REQUEST') {
        // ==== [FEAT-20260811-WALLETPAY4040] our request is malformed — config fault
        //
        // walletpay: `400 {"code":4001,"message":"Missing slip file (field name:
        // slip)"}` = OUR multipart was rejected before processing (file part
        // missing or `walletpay_file_field` misconfigured). Every later statement
        // would fail identically, so walking on is pointless. Nothing was
        // uploaded ⇒ releasing is safe; but the customer cannot fix this by
        // resending ⇒ it must reach an admin — exactly the CONFIG-FAULT family
        // handled by `_statementFallback` (release + needs_review).
        // request ฝั่งเราพัง (ไฟล์/ชื่อ field) — ปล่อยสลิป + เตือนแอดมิน ไม่วนต่อ.
        return this._statementFallback(
          runId,
          slip,
          cfg,
          'walletpay_bad_request',
          from,
          { hook, userId, rawProfile },
        );
      }
      if (b === 'NO_MATCH') {
        // ==== [P2C-2c] NO AUTO-LOOP — PAUSE AND ASK THE CUSTOMER ====
        //
        // WHAT CHANGED: this used to `continue`, walking every statement on a
        // single upload. Per ans23_43.md the runner now STOPS here and waits for
        // the customer to tap [ลองใหม่], which resumes at x+1 with the same slip
        // image (2c-3). retry เกิดเฉพาะหลัง walletpay ตอบ no_match เท่านั้น.
        //
        // WHY: walletpay is the matcher, and `no_match` means only "this slip is
        // not THIS statement" — not an error, and not terminal for the slip. The
        // system cannot know which statement is right, so it offers the next one
        // rather than silently burning through all of them: auto-looping POSTs
        // the slip once per statement, so the customer sees one late answer
        // after N uploads and an operator reading the log cannot tell which
        // attempt was meaningful.
        //
        // MONEY SAFETY: nothing was credited on a no_match, but the slip WAS
        // uploaded to this statement, so the statement is spent — the resume
        // must continue at cursor+1 and never re-POST this one. That is the
        // statement-level lock (2c-2); until it lands the cursor below is the
        // record of how far we got.
        uploaded++; // [FEAT-20260811-WALLETPAY4040] a no_match DID consume an upload
        // [FIX-20260811-PAYLOG] owner's log convention (2026-08-11): the step
        // outcome records whether the CALL succeeded, not the business polarity
        // — walletpay's own body says "Slip uploaded successfully". 200 +
        // SINGLE_NOT_MATCHED ⇒ outcome TRUE; the business answer stays visible
        // in `reason: no_match`. FALSE is reserved for definite rejects
        // (4000/4001/4040 and topup's business rejects).
        // 200 = ยิงสำเร็จ จดเป็น TRUE · คำตอบธุรกิจอยู่ที่ reason.
        await this._context(
          runId,
          slip,
          2,
          'pay_walletpay',
          cursor,
          {
            outcome: 'TRUE',
            reason: 'no_match',
            ...anchors,
          },
          from,
        );
        /* ══ [FIX-20260818-RETRYSENDABLE] only offer the button if a statement
         * AHEAD OF US CAN ACTUALLY BE SENT ══════════════════════════════════
         *
         * This counted SLOTS: `cursor + 1 < total`. But the walk skips any
         * candidate whose `walletpay_ref_id_field` resolves to nothing, so a run
         * could pause and show [ลองใหม่] for a statement it already knew it
         * would never POST. The tap then walked straight into the exhaustion
         * path and answered with the terminal `review` card — no retry button,
         * slip locked, admin required.
         *
         * MEASURED, not theorised: in one production log window the button was
         * tapped 5 times and 4 of those taps made no walletpay call at all. Run
         * 6a83e019…1131 is the worked example — two candidates matched the slip
         * amount, the second carried `info: null`, and its refId could never be
         * read. Owner-reported 18/08/2026.
         *
         * ⚠️ THIS CHANGES WHAT THE CUSTOMER SEES, deliberately and in one
         * direction only: a button that could not have worked is no longer
         * shown. Where a sendable statement remains the answer is unchanged —
         * same pause, same card, same `resume_cursor`. Nothing is offered that
         * was not offered before; only an empty promise is withdrawn.
         * ปุ่มที่กดแล้วยังไงก็ไม่สำเร็จ ไม่ต้องยื่นให้ลูกค้า.
         *
         * MONEY: untouched. This decides whether to PAUSE, never what to POST;
         * `_extractRefId` is the same read the loop already performs on each
         * entry, so no statement can become eligible that was not before.
         * revert: `const hasMore = cursor + 1 < total;` */
        const hasMore = candidates
          .slice(cursor + 1)
          .some((e) => e && this._extractRefId(e, cfg));
        if (hasMore) {
          // PAUSE: keep the run open (no _endRun) so the retry can resume it,
          // and keep the slip claimed so a re-delivered webhook cannot start a
          // second run on the same slip while we wait.
          //
          // ══ [DEC-20260811-PAUSENOREVIEW] NO review flag on a pause — owner-
          // confirmed twice (2026-08-10 ans23_43 "a pause is not an incident",
          // reaffirmed 2026-08-11 against the provider's three 200 shapes).
          // The general rule IS "200 + SINGLE_NOT_MATCHED = success + review",
          // but while statements REMAIN the customer can still resolve this
          // alone by tapping [ลองใหม่]; flagging every pause would queue an
          // admin for cases that finish by themselves seconds later. The review
          // flag is raised only at the TERMINAL no_match (walletpay_exhausted, in
          // `_walletpayReview`) — and any abandoned pause still surfaces there or
          // stays visible as an `awaiting_retry` run.
          //
          // HOW TO CHANGE (if the owner ever wants pauses reviewed too): add
          // `needs_review: true` to the $set below AND a non-empty
          // review_reason (e.g. 'walletpay_no_match_paused') via a `_context`
          // write here, then register the new reason in the REVIEW-REASON MAP
          // and update test (D7), which pins `needs_review === false` today.
          // A review row with an empty reason is invisible to reason filters —
          // that bug already happened once (matched_pending, 2026-08-10).
          await this.runModel
            .updateOne(
              { _id: runId },
              {
                $set: {
                  status: 'awaiting_retry',
                  cursor,
                  // The index the [ลองใหม่] tap must resume FROM (2c-3).
                  resume_cursor: cursor + 1,
                  awaiting_retry_at: new Date(),
                },
              },
            )
            .exec();
          return {
            ...this._result(
              runId,
              'AWAITING_RETRY',
              false,
              cfg,
              'no_match_retry',
              respMsg,
            ),
            // Carried so Phase 3 can render a retry button that actually
            // resumes — the ONLY outcome that produces one.
            resume: { run_id: String(runId), next_idx: cursor + 1 },
          };
        }
        /* Nothing sendable ahead ⇒ walk on rather than break. The remaining
           entries are unusable, and visiting them is what makes each one say so
           ([FEAT-20260818-NOREFLOG]); breaking here would end the run with the
           same verdict but no record of WHICH statements were unusable. The
           loop then ends on its own and falls to the exhaustion path below.
           เดินต่อให้ครบเพื่อให้ทุกใบมี log ผลลัพธ์ปลายทางเท่าเดิม. */
        continue;
      }
      if (b === 'REVIEW') {
        // Ambiguous 200 / transport failure — the walletpay POST already went out
        // (slip uploaded), so KEEP locked + flag review. Never inferred SUCCESS.
        await this._stampLock(slip._id, runId, 'timeout', cursor);
        await this._endRun(runId, 'locked_review', true);
        await this._context(
          runId,
          slip,
          2,
          'pay_walletpay',
          cursor,
          {
            outcome: 'TIMEOUT',
            slip_locked: true,
            lock_reason: 'timeout',
            // REVIEW CASE 2 of 4. walletpay answered 200 but the body could not be
            // read as matched / not-matched, so the outcome is unknown AND the
            // slip was already uploaded ⇒ keep it locked, ask a human.
            // TO CHANGE: renaming the reason is safe. Do NOT release here — the
            // upload already happened, so releasing risks a second credit.
            // ห้ามปล่อยสลิป อัปโหลดไปแล้ว.
            needs_review: true,
            review_reason: 'walletpay_unclear',
            ...anchors,
          },
          from,
        );
        return this._result(runId, 'REVIEW', true, cfg, 'review');
      }
      if (b === 'MATCHED_PENDING') {
        await this._stampLock(slip._id, runId, 'matched_pending', cursor);
        await this._endRun(runId, 'replied', true);
        await this._context(
          runId,
          slip,
          2,
          'pay_walletpay',
          cursor,
          {
            outcome: 'TRUE',
            slip_locked: true,
            lock_reason: 'matched_pending',
            needs_review: true,
            /**
             * [FEAT-20260810-PENDINGREASON] WHY THIS LINE EXISTS: this branch set
             * `needs_review: true` while leaving `review_reason` at its default
             * `''`, so an admin screen that filtered by the KNOWN reason strings
             * silently dropped these rows — the one review case with no reason at
             * all. Every other `needs_review: true` site names its cause; this one
             * did not. เคสนี้เคยหายจากหน้ากรอง เพราะไม่มีเหตุผลติดมา.
             *
             * ⚠️ NOT AN ERROR CASE. walletpay matched the statement and the money
             * side is fine — it is waiting on an admin to confirm, unlike the
             * `timeout` family which means "we do not know what happened". Keep
             * them visually separate on any review screen.
             *
             * HOW TO CHANGE: the string is free-form (no enum, no index, nothing
             * branches on it — it is read by humans and by dashboard filters), so
             * renaming it is safe. If you do, update the admin filter/labels that
             * display it. แก้ชื่อได้ ไม่มีโค้ดไหน branch จากค่านี้.
             */
            review_reason: 'awaiting_admin_confirm',
            ...anchors,
          },
          from,
        );
        return this._result(
          runId,
          'MATCHED_PENDING',
          true,
          cfg,
          'matched_pending',
          respMsg,
        );
      }
      // SUCCESS — walletpay matched + confirmed (the alternative credit path took).
      await this._stampLock(slip._id, runId, 'success', cursor);
      await this._endRun(runId, 'succeeded', false);
      await this._context(
        runId,
        slip,
        2,
        'pay_walletpay',
        cursor,
        {
          outcome: 'TRUE',
          slip_locked: true,
          lock_reason: 'success',
          ...anchors,
        },
        from,
      );
      return this._result(
        runId,
        'SUCCESS',
        false,
        cfg,
        'walletpay_success',
        respMsg,
        // [FEAT-20260810-PAYSTATEFLEX] same rule as topup_success above.
        hook.payment_flex_ids,
      );
    }

    // [FEAT-20260811-WALLETPAY4040] Walked off the end — the ending depends on
    // whether anything was actually UPLOADED in this walk:
    //
    //   · `uploaded === 0` AND this walk started at 0 (not a resume): every
    //     candidate was skipped (no refId) or answered 4040 — walletpay never
    //     accepted a single upload. Nothing uploaded + nothing credited is the
    //     `_statementFallback` invariant, so releasing is safe and correct; the
    //     customer opens a fresh deposit request and resends. (Before this
    //     change an all-4040/all-skip walk fell through to `walletpay_exhausted`
    //     and LOCKED a slip that walletpay never received — over-locking.)
    //     สลิปไม่เคยถูกอัปโหลดเลย ⇒ ปล่อยได้ ลูกค้าเปิดรายการฝากใหม่แล้วส่งซ้ำ.
    //
    //   · otherwise: at least one statement in this run consumed an upload
    //     (`no_match` here, or an earlier attempt when resuming — a pause only
    //     ever happens AFTER a no_match upload, so `from > 0` proves a prior
    //     upload even though this walk's counter is 0). "Uploaded, awaiting
    //     admin": KEEP locked + flag review; do NOT release, do NOT blind-retry.
    if (uploaded === 0 && from === 0) {
      // ≥1 malformed refId ⇒ the flagged reason wins: expiry is routine, bad
      // ref data is not, and a mixed walk still deserves the louder signal.
      return this._statementFallback(
        runId,
        slip,
        cfg,
        invalidRefs > 0
          ? 'walletpay_invalid_ref'
          : 'walletpay_stale_statements',
        from,
        { hook, userId, rawProfile },
      );
    }
    return this._walletpayReview(
      runId,
      slip,
      total,
      cfg,
      'walletpay_exhausted',
      from,
      { hook, rawProfile },
    );
  }

  /**
   * walletpay exhausted — every statement answered a REAL 200 no_match. The slip
   * HAS been uploaded to walletpay ⇒ keep it locked, flag for human review, no
   * retry. (REVIEW = mint flex.)
   *
   * [FIX-20260811-PAYLOG] owner's log convention (2026-08-11): "200 +
   * SINGLE_NOT_MATCHED = success + review". Every leg that lands here COMPLETED
   * its HTTP exchange (walletpay's own body says "Slip uploaded successfully.
   * Waiting for admin to confirm"), so the log says outcome TRUE with the
   * review flag — NOT TIMEOUT, which this log reserves for "outcome unknown"
   * (transport failure / unreadable answer, see the REVIEW branch in the loop).
   * The slip lock word is 'review' (locked because a human must look), not
   * 'timeout' (locked because we do not know) — additive value, no schema enum,
   * old rows keep their old strings. ยิงสำเร็จแต่ไม่ match = TRUE + review.
   */
  private async _walletpayReview(
    runId: Types.ObjectId,
    slip: SlipLike,
    stmtIdx: number,
    cfg: PaymentCfg,
    reason: string,
    /** [FIX-20260818-CTXATTEMPT] which pass is ending — routed to `_context` so a
     *  resume's verdict cannot land on the first pass's row. */
    generation?: number,
    /**
     * [FIX-20260818-DIAGEVERYREASON] the same inputs `_statementFallback`
     * records. This ending — every candidate walked, none matched — used to be
     * the only stop-before-reply outcome carrying no diagnosis at all, which is
     * backwards: it is the one an admin must act on, because the slip stays
     * LOCKED. Optional, so a caller that cannot supply it still works.
     */
    diagCtx?: { hook: HookLike; rawProfile?: unknown },
  ): Promise<PaymentRunResult> {
    await this._stampLock(slip._id, runId, 'review', stmtIdx);
    await this._endRun(runId, 'locked_review', true);
    await this._context(
      runId,
      slip,
      2,
      'pay_walletpay',
      /* [FIX-20260820-CTXCURSOR] the AUDIT row goes to the summary slot, not to
         `stmtIdx`. Both call sites hand this method `candidates.length` — one
         PAST the last real index — so this row could never name a real ใบ, and
         being out of range it also slipped past the -1 guard on the lookup and
         landed on the newest leg of the pass. Measured on the local db before
         this change: 12 of 53 joinable `handoff_results` rows sat on a leg whose
         own `stmt_idx` was one lower, every one of them 'walletpay_exhausted' —
         i.e. this line, every time a walk ran out of candidates.
         ⚠️ `_stampLock` above deliberately still receives `stmtIdx`: it writes
         `consumed_stmt_idx` on the SLIP, a different field with a different
         meaning (how far the walk got), and changing it is not this fix's job.
         แก้เฉพาะแถว audit · ค่าบนสลิปคงเดิม. revert: pass `stmtIdx` here again. */
      WALK_SUMMARY_CURSOR,
      {
        outcome: 'TRUE',
        slip_locked: true,
        lock_reason: 'review',
        // REVIEW CASE 4 of 4 — currently only ever `walletpay_exhausted`: every
        // candidate statement was tried and none matched. The slip WAS uploaded
        // to each of them, so it must stay locked even though nothing matched.
        // TO CHANGE: this one takes its reason as a PARAMETER, so a new caller can
        // introduce a new reason string without touching this line — add it to the
        // REVIEW-REASON MAP on `_context` when you do, or it will not be
        // documented anywhere. เพิ่มเหตุผลใหม่ = ต้องไปเติมในตารางด้วย.
        needs_review: true,
        review_reason: reason,
        ...(diagCtx?.rawProfile !== undefined
          ? {
              diag: this._buildMatchDiag(
                slip,
                cfg,
                diagCtx.rawProfile,
                diagCtx.hook,
              ),
            }
          : {}),
      },
      generation,
    );
    return this._result(runId, 'REVIEW', true, cfg, 'review');
  }

  /**
   * Cannot even attempt walletpay after a topup that did NOT credit (no walletpay
   * endpoint / no matching statement to get a refId) ⇒ NOTHING credited or
   * uploaded ⇒ reply "cannot verify the amount" and RELEASE the lock so the
   * customer can resend (rule B: statement-not-found fallback).
   */
  private async _statementFallback(
    runId: Types.ObjectId,
    slip: SlipLike,
    cfg: PaymentCfg,
    reason: string,
    /** [FIX-20260818-CTXATTEMPT] which pass is ending — routed to `_context` so a
     *  resume's verdict cannot land on the first pass's row. Placed BEFORE
     *  `ticketCtx` so the five callers that pass no ticket context are unchanged
     *  apart from one extra argument. */
    generation?: number,
    /**
     * [FEAT-20260810-AMOUNTTICKET] Supplied ONLY by the `no_matching_statement`
     * caller, so a ticket is opened for the AMOUNT MISMATCH and not for the two
     * config faults that share this method. Optional, so those two callers are
     * untouched. ส่งมาแค่เคสยอดไม่ตรง ไม่ใช่ทุก reason ที่ลงมาที่นี่.
     */
    ticketCtx?: {
      hook: HookLike;
      userId: string;
      rawProfile?: unknown;
    },
  ): Promise<PaymentRunResult> {
    /**
     * [FEAT-20260810-CONFIGREVIEW] Which of the three reasons is an OUR-SIDE
     * CONFIGURATION FAULT, as opposed to an ordinary data outcome.
     *
     * WHY THE SPLIT: every reason lands here and releases the slip, but they
     * mean very different things to an operator.
     *   · `no_walletpay_endpoint` / `walletpay_tool_invalid` — WE set the tool up
     *     wrong (no pay_walletpay endpoint, or the bound walletpay tool was deleted
     *     or disabled). The customer cannot fix this by resending; they will
     *     hit the same wall every time until somebody corrects the config. So
     *     it must reach an admin. ลูกค้าแก้เองไม่ได้ ต้องให้แอดมินเห็น.
     *   · `walletpay_bad_request` — [FEAT-20260811-WALLETPAY4040] walletpay rejected our
     *     multipart before processing (`400 {"code":4001}` — file part missing
     *     or `walletpay_file_field` misnamed). Same family: OUR fault, customer
     *     resending changes nothing, an admin must fix the config/code.
     *   · `no_matching_statement` — NOT a fault at all. The statement simply
     *     has not landed yet, or the amount differs. This is the common case
     *     and resolves itself; raising a review row for it would bury the admin
     *     in noise. Deliberately left silent.
     *   · `walletpay_stale_statements` — [FEAT-20260811-WALLETPAY4040] every candidate
     *     statement answered `404 {"code":4040}` (payin transaction expired /
     *     purged) or carried no refId — walletpay never accepted one upload. Also
     *     NOT our fault and self-correctable (customer opens a fresh deposit
     *     request and resends) ⇒ silent like `no_matching_statement`.
     *   · `walletpay_invalid_ref` — [FEAT-20260811-WALLETPAY4040] zero uploads AND ≥1
     *     statement whose refId walletpay rejected as MALFORMED (`400 code:4000`,
     *     caught live: 13-char final UUID segment in the member statement).
     *     Released (nothing uploaded) but FLAGGED: broken ref data upstream is
     *     not something the customer can clear by resending.
     *
     * HOW TO CHANGE: add or remove a reason from this list — nothing else. The
     * flag below is derived from it, so the two can never drift apart.
     */
    const CONFIG_FAULT_REASONS: readonly string[] = [
      'no_walletpay_endpoint',
      'walletpay_tool_invalid',
      'walletpay_bad_request',
      'walletpay_invalid_ref',
    ];
    const isConfigFault = CONFIG_FAULT_REASONS.includes(reason);
    // ══════════════════════════════════════════════════════════════════════
    // [FEAT-20260810-FALLBACKNOLOCK] owner-confirmed 2026-08-10: NO LOCK for
    // every reason that lands here.
    // ══════════════════════════════════════════════════════════════════════
    // WHICH REASONS: `no_walletpay_endpoint`, `walletpay_tool_invalid`,
    // `no_matching_statement`, and [FEAT-20260811-WALLETPAY4040]
    // `walletpay_bad_request` / `walletpay_stale_statements` / `walletpay_invalid_ref`.
    //
    // WHY RELEASING IS SAFE — the invariant is "NOTHING WAS UPLOADED AND
    // NOTHING WAS CREDITED", proven one of two ways: the first three reasons
    // fire BEFORE any walletpay POST; the two 20260811 reasons fire AFTER a POST
    // that walletpay definitively rejected before processing (`400 code:4001` /
    // `404 code:4040` — verified live, log_error/walletpay-real-response.md), so
    // no upload was consumed either way. There is no double-credit path to
    // protect against — this is the one family of outcomes where releasing is
    // unambiguously correct. (Contrast `_walletpayReview`, which is reached only
    // AFTER a consumed upload and therefore must keep the lock.)
    //
    // WHY NO `needs_review`: the customer can act immediately — they resend the
    // slip and it goes through. Locking would trap them behind an admin for a
    // problem they can clear themselves, and would bury the admin in rows for
    // the most common case (`no_matching_statement`: the statement simply has
    // not landed yet, and will in a moment). ไม่ล็อคสลิป ลูกค้าส่งใหม่ได้เลย.
    //
    // ⚠️ THE CONFIG-FAULT REASONS RAISE A REVIEW ROW (2026-08-10, +20260811):
    // `no_walletpay_endpoint`, `walletpay_tool_invalid` and `walletpay_bad_request` are
    // OUR faults, so they set `needs_review: true` + `review_reason` while
    // STILL releasing the slip. `no_matching_statement` and
    // `walletpay_stale_statements` stay silent — see CONFIG_FAULT_REASONS for the
    // split and how to change it.
    await this._release(slip._id, runId);
    /**
     * ⚠️ THE FLAG MUST REACH THE **RUN**, not just the context row.
     *
     * REVIEW POINT caught 2026-08-10, and it was a real defect: the admin list
     * (`handoff-chain.service.ts` → `listRuns`) filters
     * `handoff_chain_runs.needs_review`, i.e. the RUN document. An earlier
     * version set the flag only on the context row, so a config fault raised a
     * flag that the dashboard could never see — the feature would have looked
     * done while being invisible. ต้องติดที่ run ไม่ใช่แค่ context row.
     *
     * Both are now set on purpose, and they answer different questions:
     *   · run.needs_review      → "does this run belong in the admin queue?"
     *   · context.review_reason → "why, and at which leg?"
     *
     * The run's `status` stays `'stopped'` — nothing is pending or resumable;
     * an admin fixes the config and the customer resends. Only the review flag
     * differs between a config fault and an ordinary release.
     */
    await this._endRun(runId, 'stopped', isConfigFault);
    await this._context(
      runId,
      slip,
      2,
      'pay_walletpay',
      /* [FIX-20260818-CTXSLOT] -1 = "the whole walk", deliberately never a real
         statement index: the old hard-coded 0 landed the summary on ใบแรก's
         slot and overwrote its per-statement row. -1 also never matches a
         statement in walletpay-history's stmt_idx fallback picker — the correct
         blank for a row that is not about any single ใบ. revert: 0. */
      -1,
      {
        outcome: 'FALSE',
        reason,
        /* [FEAT-20260815-MATCHDIAG] the full matching diagnosis, stored so the
         AUDIT PAGE can answer "why did this stop" — not just the console.
         Owner, reading that screen: "ทำไมมันมีแต่การ์ดกับ reason โง่ๆ".

         [FIX-20260818-DIAGEVERYREASON] built for EVERY reason that lands here,
         not only the amount mismatch. The old restriction assumed the config
         faults were "already fully explained by their reason", which is true of
         the WORD and false of the SETTINGS: `walletpay_tool_invalid` does not say
         which tool was bound or whether its switch was off, and
         `walletpay_stale_statements` does not say which field the refIds were read
         from. Those answers live in `tools` and `rule`, and both are cheap.
         Owner-asked 18/08: "ทำไมบางอันบอกละเอียด บางอันไม่บอก … รวมกันเลย".

         Every section degrades on its own (`_buildMatchDiag` never throws), so a
         reason with nothing to read still yields a shaped object rather than an
         absent field — absent would read as "not applicable", which is a claim.
         ⚠️ This is the leg that is NOT calling walletpay — a real upload never
         reaches here and stores its request/response exactly as before. */
        ...(ticketCtx?.rawProfile !== undefined
          ? {
              diag: this._buildMatchDiag(
                slip,
                cfg,
                ticketCtx.rawProfile,
                ticketCtx.hook,
              ),
            }
          : {}),
        // ⭐ RELEASED **and** flagged, at the same time — the only combination in
        // this runner that does both, so it is worth stating why it is safe:
        // releasing is about MONEY (nothing was uploaded or credited here, so the
        // customer may resend freely), while the review flag is about a BROKEN
        // SETTING that only an admin can clear. The two are independent
        // decisions. ปล่อยสลิปได้ แต่ยังต้องเตือนแอดมิน.
        slip_locked: false,
        lock_reason: '',
        // Config faults raise a review row; `no_matching_statement` stays silent
        // (see CONFIG_FAULT_REASONS above for the reasoning).
        needs_review: isConfigFault,
        // Reuses the SAME string as `reason` on purpose: an admin screen filtering
        // on `review_reason` and a log reader following `reason` then see the same
        // word for the same event. Only set when it is actually a review case —
        // an empty reason on a flagged row would be invisible to a reason filter
        // (the bug that hid `matched_pending` until 2026-08-10).
        ...(isConfigFault ? { review_reason: reason } : {}),
      },
      generation,
    );
    /* ══ [FEAT-20260810-AMOUNTTICKET] ยอดไม่ตรง ⇒ เปิด ticket ให้แอดมิน ══════════
     * WHY: the reply for this state now says "เดี๋ยวน้องลัคกี้จะแจ้งพี่แอดมินให้มาดูแล
     *      ต่อนะคะ" (owner wording, 2026-08-10). Without a ticket that sentence is
     *      not true — `needs_review` is deliberately NOT raised here, and it shows
     *      on the payment log page anyway, which is not the queue admins watch.
     *      Same reasoning as `member-not-match` (`:1248`), same helper, same atomic
     *      claim, so a room already being handled is not ticketed twice.
     * ⚠️ ONLY for `no_matching_statement`. The other two reasons that land here
     *    (`no_walletpay_endpoint`, `walletpay_tool_invalid`) are OUR config faults and
     *    already raise `needs_review`; ticketing them too would double-report.
     * ⚠️ Never throws and its result is not branched on — a failed ticket must not
     *    cost the customer their reply. ข้อความสัญญาว่าจะแจ้งแอดมิน ⇒ ต้องเปิดจริง.
     * revert: delete this block + the `ticketCtx` param and its one argument. */
    /* [FEAT-20260810-CARDTICKET] declared outside the block because the return
       below is shared by all three reasons; only the amount-mismatch one sets it. */
    let ticketOpened: Types.ObjectId | null = null;
    /* [FIX-20260811-PAYDIVIDER] `true` เมื่อ helper เขียน divider ในรอบนี้
       ⇒ delivery layer จะไม่เขียนซ้ำเมื่อการ์ดมี flag เปิด */
    let dividerDone = false;

    if (reason === 'no_matching_statement' && ticketCtx) {
      /* [FEAT-20260810-TICKETAMOUNTS] Name the ACTUAL numbers on the ticket.
       * The admin's divider reads "เคสนี้สร้างโดยระบบ เนื่องจาก <this>", and
       * "ยอดไม่ตรงกัน" alone still leaves them opening two screens to find out
       * which amounts. Reading the pending list the SAME way `_matchStatements`
       * does (`pickByPath` + `cfg.statement_tx_path`) so the two can never
       * disagree about what "waiting" means.
       * ⚠️ Presentation only — no filter, no decision, nothing here changes which
       * statement matches. Every value is defensive: a missing/!Array profile
       * yields '-' rather than throwing, because this sits on the money path and a
       * label must never cost the customer their reply.
       * บอกยอดจริงให้แอดมินเห็นทันที ไม่ต้องเปิดหลายหน้า. */
      const slipAmt = Number(slip.amount);
      const pendingTx = pickByPath(
        ticketCtx.rawProfile,
        cfg.statement_tx_path,
      ) as { statement?: unknown } | undefined;
      const pendingList =
        pendingTx && Array.isArray(pendingTx.statement)
          ? (pendingTx.statement as Array<Record<string, unknown>>)
          : [];
      const pendingAmts = pendingList
        .filter(
          (x) =>
            x &&
            x['provider_code'] === cfg.statement_provider_code &&
            // [FEAT-20260816-MULTISTATUS] same rule as the matcher — one helper
            this._statusAllowed(cfg, x['status']),
        )
        .map((x) => Number(x['amount']))
        .filter((n) => Number.isFinite(n));
      const fmt = (n: number) => n.toLocaleString('en-US');
      const amountsForAdmin =
        `ยอดในสลิป ${Number.isFinite(slipAmt) ? fmt(slipAmt) : '-'} บาท · ` +
        `รายการรอฝาก ${pendingAmts.length ? pendingAmts.map(fmt).join(' / ') + ' บาท' : 'ไม่มี'}`;

      /* [FEAT-20260810-CARDTICKET] see the note at the member-not-match site. */
      /* [FIX-20260811-PAYDIVIDER] ดูคำอธิบายที่ member-not-match site */
      /* ─────────────────────────────────────────────────────────────────────
       * [NOTE-20260815-DIVIDERSOURCE] WHICH TEXT AN ADMIN ACTUALLY READS, and
       * why it is sometimes the line above instead of the card's own wording.
       * INVESTIGATED 2026-08-15 after the owner asked where the divider text
       * came from. NOTHING WAS CHANGED — this records the finding.
       *
       * There are TWO admin-facing sources, and BOTH are already configured
       * correctly on the live OA. They are not rivals; they fire in sequence:
       *
       *   A. THIS runner line — `amountsForAdmin`, hardcoded shape, real
       *      numbers. Written FIRST, while the reply is still being built.
       *   B. the bound flex card's `direct_ticket_text` (schema:
       *      flex-message.schema.ts:132), applied LATER by `cardTicket()` at
       *      webhook.service.ts:4874 — but only through `retitleDirectTicket`,
       *      which needs `ctx.directTicketId`.
       *
       * ⇒ WHEN THE ROOM IS ALREADY CLAIMED, `openPaymentTicketIfIdle` cannot
       * open a ticket, so it returns null, `ctx.directTicketId` stays null, and
       * there is nothing for (B) to retitle. The divider therefore keeps (A)'s
       * wording. `[FIX-20260811-PAYDIVIDER]` then suppresses a second divider
       * (`ctx.dividerDone`), which is deliberate — one divider per check.
       * ห้องถูก claim อยู่แล้ว = ไม่มี ticket ให้เปลี่ยนชื่อ ⇒ ได้ข้อความบรรทัดนี้.
       *
       * SO THIS IS NOT A MISCONFIGURATION. Verified on `omnideskdevoa`:
       * `payment_flex_ids.statement_not_found` → card `PAYstatementnotfound`,
       * `flex_type:'slip'`, `content_json` present, `direct_ticket_on_reply`
       * true, `direct_ticket_text` filled in — and NO `[PAYFLEX]` warning was
       * ever logged, i.e. the resolver never rejected the card. An idle room
       * would have produced the card's wording.
       *
       * ⚠️ IF THE OWNER LATER WANTS THE CARD'S WORDING EVEN ON A CLAIMED ROOM:
       * the fix belongs at the delivery site (webhook.service.ts:4874), by
       * letting `cardTicket()` rewrite the divider it did not open — NOT by
       * moving `direct_ticket_text` into this function. This code runs BEFORE
       * the card is resolved and has no access to it; reading the card here
       * would mean a second lookup on the money path for a cosmetic string.
       * Note that the two texts carry DIFFERENT information — this one has the
       * real amounts, the card has the human explanation — so the likely answer
       * is to JOIN them (which `retitleDirectTicket` already does, keeping the
       * amounts) rather than to replace one with the other.
       * ───────────────────────────────────────────────────────────────────── */
      ticketOpened = await openPaymentTicketIfIdle(
        {
          channelUserId: ticketCtx.userId,
          hookId: ticketCtx.hook?._id,
          needDetail: `ยอดในสลิปไม่ตรงกับรายการรอฝากของลูกค้า — ${amountsForAdmin}`,
          /* [FEAT-20260810-DIRECTTICKET] Shown on the chat divider an admin reads,
             so it is a sentence, not an internal code like
             'payment:no_matching_statement'. Same rule as the member-not-match
             ticket above. */
          directDetail: amountsForAdmin,
        },
        {
          chatRoomModel: this.chatRoomModel,
          ticketModel: this.ticketModel,
          memberModel: this.memberModel as never,
          publishTicketNew: (d) =>
            void this.realtimePublisher.publish('ticket:new', d as never),
          /* [FIX-20260811-PAYDIVIDER] ห้องถูก claim แล้ว = ไม่เปิด ticket ใบใหม่
             แต่แอดมินยังต้องเห็นว่ามีสลิปเข้ามาอีกใบ ⇒ เขียนเส้นคั่นแถวจริง
             `writeTicketDivider` กลืน error เองทั้งหมด จึงไม่ทำให้ flow เงินล้ม
             ตั้ง `dividerDone` ไว้ให้ delivery layer รู้ว่ารอบนี้เขียนแล้ว จะได้ไม่เขียนซ้ำ
             (การ์ดที่มี flag เปิดจะเรียก helper ตัวเดียวกันต่อจากนี้ในการตรวจเดียวกัน) */
          writeDivider: (i) => {
            dividerDone = true;
            return writeTicketDivider(i, {
              chatMessageModel: this.chatMessageModel,
              chatRoomModel: this.chatRoomModel,
              warn: (m: string) => this.logger.warn(m),
            });
          },
          log: (m: string) => this.logger.log(m),
          warn: (m: string) => this.logger.warn(m),
        },
      );
    }

    return {
      ...this._result(runId, 'RELEASED', false, cfg, 'statement_not_found'),
      // [FEAT-20260810-CARDTICKET] additive; absent for the two config-fault reasons.
      ...(ticketOpened ? { directTicketId: ticketOpened } : {}),
      ...(dividerDone ? { dividerDone: true } : {}),
    };
  }

  /* [FEAT-20260815-DUPFORWARD] `_isDuplicateSlip` was deleted with the gate it
     served. It read Swiftcheck's `isDuplicate` off `slip.raw_content` and had no
     other caller, so leaving it would be dead code the compiler flags
     (TS6133).

     The flag itself is NOT gone: `slip-flex.handler.ts:377` still reads the same
     Swiftcheck field to choose `flex_duplicate` for the customer-facing card. Only
     the payment path stopped branching on it.

     revert: restore this helper together with the gate — the two are one unit.
       private _isDuplicateSlip(slip: SlipLike): boolean {
         const raw = slip.raw_content as { isDuplicate?: unknown } | null | undefined;
         return !!raw && raw.isDuplicate === true;
       } */

  // ───────────────────────── outcome classification ─────────────────────────

  /**
   * topup validate-slip: classify by the RESPONSE BODY `data.slip_status.status`
   * (owner-confirmed contract). A missing response (timeout/unknown) is TIMEOUT
   * (money may have moved ⇒ review).
   *
   * ⚠️ READ THE KIND NAMES CAREFULLY — they describe the TOPUP RESULT, not the
   * next leg:
   *   · `PROCEED` = topup CREDITED (`process-wallet`) ⇒ TERMINAL SUCCESS. The
   *     caller STOPS and does NOT run walletpay. (An earlier version of this
   *     comment said "PROCEED to walletpay" — that was wrong and is exactly the
   *     misreading that would create a DOUBLE CREDIT: topup already moved the
   *     money, so running walletpay after it credits twice. Fixed 2026-08-08.)
   *   · `REJECT`  = every other status (fail / duplicate / member-not-match /
   *     account-not-match) with `data.slip_status.message` ⇒ topup did NOT
   *     credit ⇒ the caller FALLS THROUGH to walletpay.
   *   · `TIMEOUT` = unknown ⇒ hard stop, review (never fall to walletpay).
   *
   * กรณีเดียวที่จบที่ topup = process-wallet · นอกนั้นไหลไป walletpay ทันที.
   */
  /* [RULE-20260815-DUPFORWARD-LATEST] READ THE BLOCK OF THE SAME NAME at the
   * old duplicate-gate site (~:1021) before changing anything here. It records
   * the owner's 15 Aug 2026 rule that `fail` / `duplicate` / `member-not-match`
   * / `account-not-match` must ALL reach the walletpay leg — and the finding that
   * this function ALREADY does exactly that, because every one of them lands on
   * REJECT and REJECT is the fall-through. ห้ามเพิ่มลิสต์ซ้ำ ของเดิมถูกอยู่แล้ว.
   * 🔒 Owner constraint, unchanged: "ห้ามแก้ไขเงื่อนไข x api > walletpay ไม่เกี่ยว". */
  private _classifyTopup(res: CallResult): {
    kind: 'PROCEED' | 'REJECT' | 'TIMEOUT' | 'NOT_LINKED';
    status?: string;
    message?: string;
  } {
    /* [DOC-20260810-PAYSTATES] This function is where every topup answer becomes
     * one of four kinds, and therefore where "does walletpay run?" is decided.
     * A read-only map of all of them — including the `member-not-match` vs
     * `account-not-match` trap, which behave oppositely — lives in
     * `docs/payment-states.md` §2. Update that file when a branch
     * here changes; nothing reads it at runtime, so it drifts silently otherwise. */
    if (res.timed_out === true || res.outcome_unknown === true) {
      return { kind: 'TIMEOUT' };
    }

    // ══════════════════════════════════════════════════════════════════════
    // [FEAT-20260809-PAYTOOL-NOTLINKED] the customer has no linked account
    // ══════════════════════════════════════════════════════════════════════
    // WHEN THIS HAPPENS: a customer who has never linked their LINE to a web
    // account transfers money and sends the slip anyway. Common for new
    // customers — they join the OA and pay immediately.
    //
    // WHAT THE SERVER SAYS (verified live 2026-08-09):
    //   HTTP 404 {"error":{"code":"CUSTOMER_NOT_LINKED",
    //             "message":"LINE นี้ยังไม่ผูกบัญชี"},"success":false}
    //
    // WHY IT GETS ITS OWN KIND: without this branch the 404 falls to the
    // "non-2xx and no slip_status" rule below and is classified TIMEOUT —
    // i.e. "we do not know whether money moved" — which LOCKS the slip for
    // human review. But this answer is DEFINITE: the account does not exist,
    // so no wallet could possibly have been credited. Locking it buries the
    // admin in tickets that all have the same one-line fix, and the customer
    // is told to contact support when they could simply link and resend.
    // ลูกค้าใหม่ที่ยังไม่ผูกบัญชี = เคสที่รู้ผลแน่นอน ไม่ควรค้างรอแอดมิน.
    //
    // ⚠️ MATCHED ON THE ERROR CODE, NOT ON THE 404. This is the whole safety
    // argument: a 404 by itself is ambiguous — a moved path, a bad base_url or
    // a proxy can all produce one, and in those cases we genuinely do NOT know
    // what happened, so they must keep the fail-safe TIMEOUT. Only the explicit
    // `CUSTOMER_NOT_LINKED` contract is treated as knowledge. Widening this to
    // "any 404" would release slips on unknown outcomes — the exact shape of a
    // double-credit bug. ห้ามขยายเป็น "404 ทุกตัว".
    //
    // HOW TO CHANGE LATER: add another code to NOT_LINKED_CODES only if the far
    // side guarantees it means "nothing was credited". To revert entirely,
    // delete this block and the NOT_LINKED branch in the caller — the 404 then
    // returns to TIMEOUT/review.
    const errCode = pickByPath(res.data, 'error.code');
    if (typeof errCode === 'string' && NOT_LINKED_CODES.includes(errCode)) {
      const errMsg = pickByPath(res.data, 'error.message');
      return {
        kind: 'NOT_LINKED',
        status: errCode,
        message: typeof errMsg === 'string' ? errMsg : '',
      };
    }
    const ss = pickByPath(res.data, 'data.slip_status') as
      { status?: string; message?: string } | undefined;
    const status = ss?.status;
    const message = ss?.message || '';
    // ==== [FIX-20260811-TOPUPSUCCESS] terminal-success ย้ายจาก 'process-wallet' → 'success'
    // 🔒 MONEY LEG — เจ้าของยืนยัน 2026-08-11: Shop-API เปลี่ยน spec แล้ว
    //
    // WHAT: ค่าที่ topup ตอบเมื่อ "เติมเครดิตสำเร็จ" เปลี่ยนจาก `process-wallet` เป็น
    //   `success` (message เดิมทุกอย่าง: "ตรวจสอบถูกต้อง (อยู่ในขั้นตอนเพิ่มเครดิต)").
    //   ⇒ `success` = PROCEED = TERMINAL SUCCESS: topup เครดิตแล้ว, ล็อก 'success',
    //   ตอบ state สำเร็จ, และ **ไม่ไป walletpay** (walletpay คือทางเติมสำรอง — วิ่งซ้ำ
    //   ตอน topup เติมไปแล้ว = double-credit).
    //
    // WHY THIS IS A BUG-FIX, NOT A TWEAK: ก่อนแก้ code เช็คแค่ `process-wallet`
    //   ⇒ `success` ตกเข้า REJECT (บรรทัดล่าง) → ไหลไป walletpay → **เสี่ยงเติมซ้ำ**.
    //   ตรงกับอาการที่เจ้าของเจอ: step `pay_topup FALSE + processing` ทั้งที่สลิปผ่าน.
    //
    // เจ้าของสั่ง "ใช้ success อย่างเดียว (เลิก process-wallet)" — จึง**แทนที่** ไม่ใช่
    //   รับทั้งคู่. ถ้า Shop-API เก่าที่ไหนยังส่ง `process-wallet` มา มันจะตกเป็น REJECT
    //   → ไป walletpay (พฤติกรรม fail-safe เดิม ไม่ double-credit เพราะ topup ไม่ได้เครดิต
    //   จริงในโลกที่ `process-wallet` เลิกใช้แล้ว). ถ้าต้องรองรับทั้งคู่ชั่วคราว ให้
    //   เปลี่ยนเงื่อนไขเป็น `status === 'success' || status === 'process-wallet'`.
    // revert: เปลี่ยน 'success' กลับเป็น 'process-wallet'
    if (status === 'success') return { kind: 'PROCEED', status, message };
    // ==== [FIX-20260811-TOPUPSUCCESS] END
    if (status) return { kind: 'REJECT', status, message };
    // No slip_status: a 2xx-but-unrecognised body ⇒ reject (server said not-ok);
    // a non-2xx transport error ⇒ TIMEOUT (unknown ⇒ review, money may have moved).
    if (
      typeof res.status === 'number' &&
      res.status >= 200 &&
      res.status < 300
    ) {
      return { kind: 'REJECT', message };
    }
    return { kind: 'TIMEOUT' };
  }

  /**
   * walletpay: classify by the RESPONSE BODY per the real /payin/{refId}/slip
   * contract (owner-confirmed). ⚠️ ALL three business cases return HTTP 200 — so
   * we parse `messageType` + `uploadResult[0].matchResult`, NOT the HTTP status
   * (treating no_match as an HTTP error would be wrong). A genuine transport
   * failure (timeout / non-2xx) is still REVIEW (fail-safe for money).
   *
   * Contract (handoff_final_spec.md §walletpay-response):
   *   SUCCESS         — messageType==='SINGLE_MATCHED' AND matchResult.confirmed===true
   *   MATCHED_PENDING — matchResult.status==='matched' AND confirmed===false (PROCESSING)
   *   NOT_MATCHED     — messageType==='SINGLE_NOT_MATCHED' OR matchResult.status==='no_match'
   *
   * [FEAT-20260811-WALLETPAY4040] Two non-2xx answers are DEFINITE, verified live
   * 2026-08-11 against the real host (`api.walletpay.example.com`, allow-listed IP,
   * captures in `log_error/walletpay-real-response.md`):
   *   TXN_NOT_FOUND — HTTP 404 `{"code":4040,"message":"PayIn transaction not
   *     found"}`. The route ran, parsed the refId, and the payin transaction does
   *     not exist (expired/purged). Nothing was uploaded, nothing credited.
   *   BAD_REQUEST   — HTTP 400 `{"code":4001,"message":"Missing slip file (field
   *     name: slip)"}`. walletpay rejected the request BEFORE processing — our
   *     multipart was malformed (missing/renamed file field). Nothing uploaded.
   *   INVALID_REF   — HTTP 400 `{"code":4000,"message":"Invalid refId"}` (caught
   *     live 2026-08-11 in the full-flow run: the member statement carried a
   *     MALFORMED ref_id — a 13-char final UUID segment — and walletpay validates
   *     the format before anything else). Definite pre-processing reject:
   *     nothing uploaded. Per-STATEMENT, not per-request: other statements may
   *     carry valid refIds, so the walk continues.
   * ⚠️ MATCHED ON THE BODY CODE, NOT THE HTTP STATUS — same safety argument as
   * topup's CUSTOMER_NOT_LINKED: a bare 404 is ambiguous (wrong host answers an
   * Express HTML 404 with NO `code` field — the exact bug that produced the 27
   * historical failures) and ambiguity must stay fail-safe REVIEW.
   * ห้ามขยายเป็น "404/400 ทุกตัว" — ต้องมี code 4040/4001 ในบอดี้เท่านั้น.
   */
  private _classifyWalletpay(
    res: CallResult,
  ):
    | 'SUCCESS'
    | 'MATCHED_PENDING'
    | 'NO_MATCH'
    | 'TXN_NOT_FOUND'
    | 'BAD_REQUEST'
    | 'INVALID_REF'
    | 'REVIEW' {
    if (res.timed_out === true || res.outcome_unknown === true) {
      return 'REVIEW';
    }
    // [FEAT-20260811-WALLETPAY4040] definite non-2xx answers — see the doc above.
    // `code` may serialize as number or string; both mean the same app error.
    const bodyCode = Number(
      (res.data as Record<string, unknown> | null | undefined)?.['code'],
    );
    if (res.status === 404 && bodyCode === 4040) return 'TXN_NOT_FOUND';
    if (res.status === 400 && bodyCode === 4001) return 'BAD_REQUEST';
    if (res.status === 400 && bodyCode === 4000) return 'INVALID_REF';
    if (
      typeof res.status !== 'number' ||
      res.status < 200 ||
      res.status >= 300
    ) {
      return 'REVIEW';
    }
    const d = (res.data || {}) as Record<string, unknown>;
    const messageType = d['messageType'];
    const mr = this._readMatchResult(res.data);

    if (mr.status === 'matched' && mr.confirmed === true) return 'SUCCESS';
    if (messageType === 'SINGLE_MATCHED' && mr.confirmed === true) {
      return 'SUCCESS';
    }
    if (mr.status === 'matched' && mr.confirmed === false) {
      return 'MATCHED_PENDING';
    }
    if (messageType === 'SINGLE_NOT_MATCHED' || mr.status === 'no_match') {
      return 'NO_MATCH';
    }
    // 2xx but nothing decisive (confirmed omitted, messageType ERROR/unknown,
    // empty matchResult) → AMBIGUOUS → REVIEW. NEVER inferred as SUCCESS from the
    // 2xx `res.success` flag — all walletpay business cases are HTTP 200, so that
    // flag proves nothing (this was review bug #1: a false SUCCESS hiding a leg
    // that needs a human).
    return 'REVIEW';
  }

  /**
   * Read the walletpay matchResult from `uploadResult[0].matchResult` (real shape),
   * with `matchResult` / `data.matchResult` fallbacks. Captures the money-audit
   * anchors (transactionId, bankExpectId) for the chain-log context.
   */
  private _readMatchResult(data: unknown): {
    status?: string;
    confirmed?: boolean;
    transactionId?: string;
    bankExpectId?: string;
    message?: string;
  } {
    const d = (data || {}) as Record<string, unknown>;
    const inner = (d['data'] || {}) as Record<string, unknown>;
    const up = d['uploadResult'] || inner['uploadResult'];
    let mr =
      (d['matchResult'] as Record<string, unknown>) ||
      (inner['matchResult'] as Record<string, unknown>);
    if (!mr && Array.isArray(up) && up[0]) {
      mr = (up[0] as Record<string, unknown>)['matchResult'] as Record<
        string,
        unknown
      >;
    }
    if (!mr) return {};
    return {
      status: mr['status'] as string | undefined,
      confirmed: mr['confirmed'] as boolean | undefined,
      transactionId: mr['transactionId'] as string | undefined,
      bankExpectId: mr['bankExpectId'] as string | undefined,
      message: (mr['message'] ?? d['message']) as string | undefined,
    };
  }

  /** Response-level message (multilingual), for a reply when no config text set. */
  private _walletpayMessage(res: CallResult): string {
    const d = (res.data || {}) as Record<string, unknown>;
    return typeof d['message'] === 'string' ? d['message'] : '';
  }

  // ───────────────────────── body builders ─────────────────────────

  /**
   * The Swiftcheck verify result already stored on the slip, feeding the topup
   * `payload` field (no extra Swiftcheck call). Config path selects a subtree;
   * default '' = the whole result.
   *
   * ==== [FIX-20260810-PAYLOAD-ENVELOPE] send the FULL envelope, not `data` ====
   * WHAT CHANGED: `raw_response` (Swiftcheck's whole reply —
   * `{success,message,data}`) is now preferred over `raw_content` (the inner
   * `data` alone). The order used to be the reverse, so we sent the inner object.
   *
   * WHY — MEASURED, not guessed (`todo/topup/topup_20260810_1550_test.md`,
   * 2026-08-10 15:48–15:53 ICT). Same slip, same bytes, same account; only this
   * shape differed:
   *   inner `data`      → slip_status "fail" · "สลิปไม่ถูกต้อง หรือ ไม่สามารถอ่านสลิปได้"
   *   full envelope     → slip_status "fail" · "บัญชีผู้รับไม่ตรงบัญชีระบบ"
   * The second message proves the endpoint PARSED the transfer and got as far as
   * comparing the receiver account; the first was it failing to find the fields at
   * all and reporting a generic read error. So the endpoint expects the envelope,
   * exactly as the reference `todo/topup/spec/fixtures/payload.json` shows, and
   * `spec/dev.spec.md:41` ("payload คือตัวที่ได้มาจาก swiftcheck") means the whole
   * reply. Sending `data` made a well-formed request look like an unreadable
   * image — and that wrong diagnosis was nearly reported to the provider.
   *
   * NO SCHEMA CHANGE: both fields already exist on `slip_verifications`.
   * `raw_response` is present on all 51 rows of the local staging clone while
   * `raw_content` is on 38, so preferring it also reaches MORE rows, and the
   * `?? raw_content ?? null` tail keeps any row that somehow lacks it working.
   * `topup_payload_path` still selects a subtree for an agent that wants one — set
   * it to `data` to restore the old inner-object behaviour without a code change.
   * ส่ง envelope เต็ม server จึงอ่านสลิปเจอ — ไม่แตะ schema ไม่ต้อง migrate.
   * revert: swap the two fields back.
   */
  /* 🔴 [DECISION-20260903-VERIFYFEEDSPAYMENT] VERIFICATION DOES NOT END AT THE
   * CARD — IT FEEDS THIS LEG. Owner's reminder, 03/09, and it is the constraint a
   * second provider is most likely to break silently.
   *
   * THE CHAIN, re-traced 03/09 after the response seam landed:
   *   slip-flow.service.ts   writes `raw_response: verifyResponse.data`
   *                          🔴 CORRECTION: this said "the PROVIDER'S OWN
   *                          envelope, verbatim". It is the **NORMALISED** one.
   *                          `verifyResponse = provider.normaliseResponse(...)`
   *                          (`slip-flow.service.ts`, the three `raw_response`
   *                          sites), so every provider hands the flow — and this
   *                          leg — the SHARED shape. Swiftcheck's normaliser is the
   *                          identity, so nothing moved for it.
   *   here                   reads it back and applies `topup_payload_path`
   *   default is `''`        ⇒ NO subtree is picked and the WHOLE envelope is
   *                            forwarded as the Shop-API `payload` field
   *
   * So when an OA has the payment custom tool switched on, whatever the provider
   * answered travels on to Shop-API unchanged. Swiftcheck's shape is what Shop-API has
   * always been fed and what it was built to read.
   *
   * ⚠️ HOW MUCH A SECOND PROVIDER CAN STILL MOVE HERE — re-measured 03/09, and
   * it is LESS than this note used to claim. The old text said the path "points
   * into Swiftcheck's tree, `pickByPath` finds nothing in SlipGuard's, and `payload` is
   * dropped". That was written before `normaliseResponse` existed. A provider
   * that normalises hands this leg the shared shape, so both the default path
   * (whole envelope) and the common `'data'` path still resolve to the tree Shop-API
   * was built to read — proven in `slip-provider-slipguard.spec.ts`.
   *
   * WHAT IS LEFT, stated without inflating it:
   *   · a provider whose `normaliseResponse` is INCOMPLETE — a field Shop-API reads
   *     that the vendor cannot supply arrives absent, not wrong. Absent is the
   *     safer failure, and it is why the normaliser is where the risk now lives
   *   · a provider that does NOT normalise would still swap the shape wholesale.
   *     The port requires the member, so that is a written choice, not a slip
   *   · the vendor's own untranslated reply is kept at `data.slipguard` for whoever
   *     wants it — `topup_payload_path` already reaches it, per custom-tool
   *     record, with no code change
   * ⇒ nothing throws here either way; a mismatch surfaces REMOTELY and LATE.
   * เปลี่ยน provider ที่ normalise แล้ว = ทรงยังเป็นของ Swiftcheck ⇒ ความเสี่ยงอยู่ที่ normaliser ไม่ใช่ที่นี่
   *
   * 🔴 THE RULE, and the owner restated it as a rule rather than a caution:
   * WITH THE PAYMENT CUSTOM TOOL ON, A HOOK MUST BEHAVE EXACTLY AS IT DOES WITH
   * SWIFTCHECK TODAY — same continuation, same legs, same wire body, same result.
   * "The card looked right" is not evidence: the card is rendered before this leg
   * runs and says nothing about it.
   *
   * WHAT "EXACTLY" COVERS, spelled out so it can be checked rather than assumed:
   *   · this method still returns something Shop-API can parse — with the default
   *     `topup_payload_path` that means the WHOLE envelope, so the envelope shape
   *     itself is part of the contract, not an implementation detail
   *   · an OA that HAS set `topup_payload_path` still resolves to the same value;
   *     a path that silently misses now yields `payload` dropped, not an error
   *   · the walletpay leg reads `topupData` downstream (`_walletpayBody`), so a changed
   *     shape travels one hop further than this line
   *   · none of it throws here. The failure is REMOTE and LATE — after the slip
   *     is verified, after it is locked, after the customer has been answered
   *
   * ⇒ CONSEQUENCE FOR A SECOND PROVIDER: it may not be switched on for a hook
   * whose payment tool is ON until either Shop-API has confirmed it reads that
   * envelope, or that OA's `topup_payload_path` / the param pipe
   * ([DECISION-20260903-SHOPAPIPIPE]) is set so Shop-API still receives what it expects.
   * A hook with payment OFF is free — the leg never runs.
   * เปิด custom tool payment = ต้องไหลต่อได้เหมือน Swiftcheck ทุกอย่าง ไม่ใช่แค่การ์ดถูก
   *
   * Same family as [RULE-20260903-STGSTAYSSWIFTCHECK] in `slip/slip-flow.service.ts`:
   * the reason "do nothing = stay on Swiftcheck" has to keep holding is THIS leg, not
   * the card. Break either one and staging stops being a safe place to stand.
   *
   * 📄 REF: `docs/slip-spec.md` §7 of the 03/09 decisions. */
  private _swiftcheckResult(slip: SlipLike, cfg: PaymentCfg): unknown {
    const base = slip.raw_response ?? slip.raw_content ?? null;
    return cfg.topup_payload_path
      ? pickByPath(base, cfg.topup_payload_path)
      : base;
  }

  /**
   * walletpay body — refId (for the `{{refId}}` path) + the configurable
   * topup→walletpay field link (TBD, default empty). The slip image is a file part,
   * not a body field.
   */
  private _walletpayBody(
    slip: SlipLike,
    hook: { customer_link_web_code?: string },
    userId: string,
    refId: string,
    cfg: PaymentCfg,
    topupData: unknown,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      refId,
      member_user_id: userId,
      line_user_id: userId,
      amount: slip.amount,
    };
    if (hook.customer_link_web_code)
      body.web_code = hook.customer_link_web_code;
    // ── OWNER-DECIDED 2026-08-08 — WHAT WE OWN vs WHAT Shop-API OWNS ───────────
    // OUR job is matching a slip to the RIGHT statement. The system cannot know
    // which statement a given slip belongs to, so it must try them one at a
    // time — which is exactly why the SAME slip is allowed to be paired with a
    // NEW statement (x+1) on a retry. หน้าที่เรา = จับคู่ สลิป ↔ statement ให้
    // ถูกตัว จึงยอมให้สลิปเดิม + x ใหม่ได้.
    //
    // ⇒ The lock therefore belongs on the STATEMENT (refId/x), not on the slip:
    //   the thing that must never happen twice is "this statement was credited",
    //   not "this slip was seen twice". A slip that has not matched anything yet
    //   SHOULD be retried. (Phase 2c moves the lock to match this; today's code
    //   still locks the slip — see 1ans.md §4/§6.)
    //
    // ⇒ DUPLICATE SLIP IMAGES ARE NOT OUR GUARD: re-sending the same image to
    //   topup is caught by Shop-API itself, which answers `duplicate` automatically
    //   (owner-confirmed 2026-08-08). We deliberately do NOT add a second
    //   image-level dedupe here — it would block the legitimate retry above.
    //   ⚠️ Stated so it is not mistaken for an oversight: this is an ACCEPTED
    //   dependency on an external system's behaviour, and the real topup Shop-API
    //   is still on the go-live "รอค่าจริง" list — verify `duplicate` really is
    //   returned before trusting it in production.
    //
    // ✅ RESOLVED 2026-08-09 — EMPTY IS THE CORRECT VALUE, not a missing config.
    // walletpay does NOT consume anything from the topup response: it identifies
    // the transaction by `refId`, which comes from the MEMBER STATEMENT, and it
    // receives the slip IMAGE as a file part. Those are its only two inputs.
    // ตอนไป walletpay เราใช้ refId จาก statement + ภาพสลิป ไม่ได้พึ่งค่าจาก topup.
    //
    // ⇒ Leave `topup_to_walletpay_map` empty. An operator does NOT need to fill it
    // in for go-live, and this loop is a deliberate no-op in the normal case.
    // It stays only as an escape hatch: if a future walletpay build ever needs a
    // value carried over from topup, set `tool.payment.topup_to_walletpay_map`
    // (config only, no code change).
    // `topupData` is threaded (not instance state) so concurrent runs never mix.
    for (const [walletField, srcPath] of Object.entries(
      cfg.topup_to_walletpay_map,
    )) {
      if (typeof srcPath === 'string' && srcPath) {
        const v = pickByPath(topupData, srcPath);
        if (v !== undefined && v !== null) body[walletField] = v;
      }
    }
    return body;
  }

  // ───────────────────────── statement / refId / image ─────────────────────────

  private async _rawProfile(userId: string): Promise<unknown> {
    if (!userId) return null;
    const m = await this.memberModel
      .findOne({
        $or: [{ member_user_id: userId }, { line_user_id: userId }],
      })
      .lean()
      .exec();
    return (
      (m as { raw_profile_data?: unknown } | null)?.raw_profile_data ?? null
    );
  }

  /** Pick the transaction subtree from an ALREADY-read raw profile (no re-read). */
  private _pickTransaction(rawProfile: unknown, cfg: PaymentCfg): unknown {
    try {
      const tx = pickByPath(rawProfile, cfg.statement_tx_path);
      return tx && typeof tx === 'object' ? tx : null;
    } catch {
      return null;
    }
  }

  /** walletpay statements matching this slip: provider_code + status + amount.
   *
   * [DOC-20260810-PAYSTATES] The three-part match and what a miss means for the
   * customer are written up in `docs/payment-states.md` §4. */
  /* ==== [FEAT-20260816-MULTISTATUS] `statement_status` accepts a CSV list ====
   *
   * WHAT: the config value is now read as a comma-separated list — e.g.
   * "waiting-deposit,fail" accepts BOTH statuses; "waiting-deposit" alone keeps
   * the exact single-value behaviour byte-for-byte; empty still means "no
   * status filter" (unchanged). Owner order 16/08: "ค่าเดียวได้ สองค่าได้
   * seamless ห้ามพัง" — the site's new statement shape needs fail rows matched.
   *
   * WHY ONE HELPER: FOUR sites apply this rule (the money matcher below, the
   * TICKETAMOUNTS admin line, and two narrowing passes in `_logNoCandidate`).
   * The old code repeated `!cfg.statement_status || status === cfg.…` at each —
   * a CSV change applied to fewer than all four would make the numbers an admin
   * sees disagree with what the matcher did. One predicate = they cannot drift.
   *
   * PARSED AT READ TIME, not at save: the stored config stays exactly what the
   * operator typed; tokens are trimmed ("a, b" works) and empties dropped
   * (",,fail" ⇒ ["fail"]). Comparison stays EXACT + case-sensitive per token.
   *
   * Tests: [MULTISTATUS] MS1-MS6 in paytool-p2-runner.spec.ts (MS4/MS5 pin the
   * old single/empty behaviour). revert: delete this method and restore the
   * inline comparison at the four call sites.
   */
  private _statusAllowed(cfg: PaymentCfg, status: unknown): boolean {
    const raw = String(cfg.statement_status ?? '').trim();
    if (!raw) return true; // empty = no filter — pre-existing meaning, unchanged
    const allowed = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!allowed.length) return true;
    return typeof status === 'string' && allowed.includes(status);
  }

  private _matchStatements(
    rawProfile: unknown,
    slip: SlipLike,
    cfg: PaymentCfg,
  ): Array<Record<string, unknown>> {
    const tx = pickByPath(rawProfile, cfg.statement_tx_path) as
      { statement?: unknown } | undefined;
    const list = tx && Array.isArray(tx.statement) ? tx.statement : [];
    const amount = Number(slip.amount);

    /* [NOTE-20260818-NOLOCALBYPASS] The amount comparison below is the ONLY
     * rule here, and there is no switch that can waive it.
     *
     * A pair of local-only test flags used to sit at this spot; they were
     * deleted on 18/08/2026 by owner's rule: simulation and bypass code must
     * not exist in the repository at all, however carefully it is gated,
     * because a file in git reaches every environment the repo reaches.
     * The developer capability they provided is preserved OUTSIDE git — see
     * `local-only/README.md` (untracked) for how to switch it on locally.
     * ⚠️ Do not re-add a flag here. อย่าเอา bypass กลับเข้า git อีก. */

    const matched = (list as Array<Record<string, unknown>>).filter((s) => {
      if (!s || s['provider_code'] !== cfg.statement_provider_code)
        return false;
      // [FEAT-20260816-MULTISTATUS] was a single exact compare — now the CSV
      // predicate (single value behaves identically; empty still = no filter).
      if (!this._statusAllowed(cfg, s['status'])) {
        return false;
      }
      return Number(s['amount']) === amount;
    });

    return matched;
  }

  /**
   * [FEAT-20260815-NOCANDIDATELOG] Explain a zero-candidate walletpay stop.
   *
   * WHY THIS EXISTS — owner-requested 15/08/2026. When `_matchStatements`
   * returns nothing, the run stops before walletpay and the step-2 handoff result
   * is written with a `reason` and an EMPTY `final`. From that alone you cannot
   * tell "the customer has no pending deposit" from "the tx path is misspelled
   * and we read an empty list", nor what `info.trade_no` actually held. This
   * prints the DECISION INPUTS so the log answers it without a DB dig:
   *
   *   · OUR RULE   — the three conditions a statement must satisfy, with the
   *                  configured values, so the reader sees what we asked for
   *   · WHAT CAME  — how many rows the tx path yielded, and how each condition
   *                  narrowed them (provider → status → amount)
   *   · REF ID     — per surviving row, whether `walletpay_ref_id_field` resolved
   *                  to a value, was empty, or the field was absent entirely
   *
   * ⚠️ LOG ONLY, AND DELIBERATELY RE-DERIVED. It re-reads the same inputs
   * rather than having `_matchStatements` hand back diagnostics, because that
   * function sits ON the money path and its return shape is consumed by the
   * walletpay leg — widening it to carry debug data is how a logging change turns
   * into a behaviour change. Cost is one extra pass over a short array, only on
   * the failing path. อ่านซ้ำ ไม่แตะตัวคัดกรอง.
   *
   * SAFETY: every read is defensive and the whole body is wrapped, so a shape
   * this code did not expect can never break a payment run — the worst case is
   * one warn line instead of the detail. Amounts are already visible to the
   * admin on the ticket divider, so nothing new is exposed.
   *
   * revert: delete this method and its single call site above the
   * `no_matching_statement` fallback. Nothing else reads it.
   */
  /**
   * [FEAT-20260815-MATCHDIAG] The SAME diagnosis, as data instead of a log line.
   *
   * WHY IT EXISTS: `_logNoCandidate` prints the full picture to the console, but
   * the audit page reads the database — where step 2 carried only a short
   * `reason`. The owner, looking at that screen: "ทำไมมันมีแต่การ์ดกับ reason
   * โง่ๆ". So the same facts are built once here and used twice: printed by
   * `_logNoCandidate`, and stored on `final.parsed.diag` by `_statementFallback`.
   * One builder means the screen can never drift from the log.
   *
   * WHAT IT ANSWERS — every question the owner asked, by name:
   *   · `data.profile.transaction` → `tx_path` + `path_state` + `rows_total`
   *   · `fail`                     → `rule.status`, and `after_status`
   *   · `info.trade_no`            → per row: the value, `EMPTY`, or `ABSENT`
   *   · `refid`                    → `rule.ref_query_param`
   *   · why no candidate           → `narrowing` + `rows_seen`
   * Anything unreadable falls back to an empty string rather than being omitted,
   * so a missing value is visible as missing. ไม่มีก็ต้องบอกว่าไม่มี.
   *
   * ⚠️ PURE READ. It re-derives from `rawProfile` and touches nothing. It runs
   * ONLY on the no-candidate path — the leg that, by definition, is not going to
   * call walletpay. The real send path (`_runWalletpay` past the candidate check) never
   * reaches this code, so a normal walletpay upload is byte-for-byte unaffected.
   * ห้ามชนกับ flow ส่ง walletpay ปกติ — เส้นนี้คือเส้นที่ไม่ยิงอยู่แล้ว.
   *
   * revert: delete this method, the `diag` field in `_statementFallback`, and
   * have `_logNoCandidate` inline its own reads again.
   */
  /**
   * [FEAT-20260815-RAWPROFILEDIAG] A profile response that is SAFE to store.
   *
   * The raw profile is the one field here whose size and shape we do not
   * control — it is whatever the customer's tool returned. Three ways it can go
   * wrong, each handled rather than hoped away:
   *
   *   1. HUGE. A profile with hundreds of statements would bloat every audit row
   *      and slow the page that renders them. Over the cap it is replaced by a
   *      short marker, never truncated mid-structure (a half-object is worse
   *      than an honest "too big" — it looks like data and cannot be trusted).
   *   2. UNSERIALISABLE. A cycle or an exotic value makes `JSON.stringify`
   *      throw, and it would throw inside the Mongo write, not here — so the
   *      size probe doubles as a serialisability check.
   *   3. CREDENTIALS. Masked with `maskCredsDeep`, the same helper the rest of
   *      the audit trail uses.
   *
   * ⚠️ ALWAYS RETURNS SOMETHING. Every failure path yields a marker object
   * explaining what happened; the field is never silently dropped, because
   * "absent" would read as "the profile was empty" — a different diagnosis
   * altogether. ล้มเหลวก็ต้องบอกว่าล้มเหลว ไม่ใช่หายเงียบ.
   *
   * ⚠️ Never throws. It runs on a money path, inside a diagnostic that must not
   * be able to fail a run.
   */
  private _safeProfileSnapshot(rawProfile: unknown): unknown {
    /** ~256 KB serialised. Well above a normal profile, well below a problem. */
    const MAX_CHARS = 262_144;
    try {
      if (rawProfile === undefined || rawProfile === null) {
        return { note: 'no profile response was available at this point' };
      }
      const masked = maskCredsDeep(rawProfile);
      // Doubles as the cycle / unserialisable check — see (2) above.
      const size = JSON.stringify(masked)?.length ?? 0;
      if (size > MAX_CHARS) {
        return {
          note: 'profile omitted — too large to store in the audit row',
          approx_chars: size,
          limit_chars: MAX_CHARS,
        };
      }
      return masked;
    } catch (err) {
      return {
        note: 'profile could not be serialised for the audit row',
        error: (err as Error)?.message ?? 'unknown',
      };
    }
  }

  private _buildMatchDiag(
    slip: SlipLike,
    cfg: PaymentCfg,
    rawProfile: unknown,
    hook?: Record<string, unknown>,
  ): Record<string, unknown> {
    const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
    try {
      const amount = Number(slip.amount);
      const tx = pickByPath(rawProfile, cfg.statement_tx_path) as
        { statement?: unknown } | undefined;
      const list = (
        tx && Array.isArray(tx.statement) ? tx.statement : []
      ) as Array<Record<string, unknown>>;

      const pathState =
        tx === undefined || tx === null
          ? 'PATH_NOT_FOUND'
          : !Array.isArray(tx.statement)
            ? 'PATH_FOUND_BUT_NOT_ARRAY'
            : 'PATH_OK';

      const byProvider = list.filter(
        (r) => r && r['provider_code'] === cfg.statement_provider_code,
      );
      const byStatus = byProvider.filter(
        // [FEAT-20260816-MULTISTATUS] same helper as the matcher
        (r) => this._statusAllowed(cfg, r['status']),
      );
      /* [FIX-20260818-DIAGEVERYREASON] the third condition, measured here rather
         than taken from the caller. It used to be hard-coded `0`, which was true
         on the one path this ran on (no candidates) and a lie on every other —
         and "0 matched the amount" is a different diagnosis from "the amount was
         never evaluated". Computing it locally also means no call site can pass
         a stale count. Mirrors `_matchStatements`; LOG ONLY, so the local-only
         amount bypass is deliberately NOT reflected — this reports the RULE. */
      const byAmount = byStatus.filter((r) => Number(r['amount']) === amount);

      /** How `walletpay_ref_id_field` resolved on a row — the `info.trade_no` question. */
      const refState = (row: Record<string, unknown>) => {
        const v = pickByPath(row, cfg.walletpay_ref_id_field);
        if (v === undefined) return 'ABSENT';
        if (v === null || v === '') return 'EMPTY';
        return s(v);
      };

      const CAP = 10; // a long statement list must not bloat the audit row
      const rawProfileSnapshot = this._safeProfileSnapshot(rawProfile);
      return {
        slip_amount: Number.isFinite(amount) ? amount : null,
        /* [FEAT-20260815-MATCHDIAG] WHICH TOOLS THIS OA HAD BOUND AT THE MOMENT
           OF THE DECISION. Owner-requested: the diagnosis is incomplete without
           it, because the same statement data gives a different verdict
           depending on which tool supplied `cfg`. All three bindings are
           recorded, each with its on/off switch, so a reader can tell "walletpay is
           off" from "walletpay is on but nothing matched" — the two produced
           identical-looking rows before. The ids are the same ones printed on
           the `[TOOLCHECK]` log lines, so screen and log can be cross-checked.
           `-` means unbound; the status is the hook's own flag, untouched. */
        tools: {
          custom_tool_id: s(hook?.['custom_tool_id']) || '-',
          custom_tool_status: hook?.['custom_tool_status'] === true,
          payment_tool_id: s(hook?.['payment_tool_id']) || '-',
          payment_tool_status: hook?.['payment_tool_status'] === true,
          walletpay_tool_id: s(hook?.['walletpay_tool_id']) || '-',
          walletpay_tool_status: hook?.['walletpay_tool_status'] === true,
          /* Which tool the walletpay leg would have used: a separate tool needs the
             id AND the switch; otherwise the payment tool's own endpoint. */
          walletpay_uses:
            hook?.['walletpay_tool_status'] === true &&
            hook?.['walletpay_tool_id']
              ? 'separate walletpay tool'
              : 'payment tool (same tool, pay_walletpay endpoint)',
        },
        rule: {
          tx_path: s(cfg.statement_tx_path),
          provider_code: s(cfg.statement_provider_code),
          status: cfg.statement_status ? s(cfg.statement_status) : '(any)',
          amount_match: 'exact (statement.amount === slip.amount)',
          ref_id_field: s(cfg.walletpay_ref_id_field),
          ref_query_param: s(cfg.walletpay_ref_id_query_param),
          file_field: s(cfg.walletpay_file_field),
        },
        path_state: pathState,
        narrowing: {
          rows_total: list.length,
          after_provider: byProvider.length,
          after_status: byStatus.length,
          after_amount: byAmount.length,
        },
        /* Rows that passed provider+status — the ones a matching amount WOULD
           have selected, so their amounts and ref ids are the useful ones. */
        passed_rows: byStatus.slice(0, CAP).map((r) => ({
          amount: s(r['amount']),
          status: s(r['status']),
          ref_id: refState(r),
        })),
        /* When nothing passed, `passed_rows` is empty and explains nothing —
           show what the rows actually carried instead. */
        rows_seen: list.slice(0, CAP).map((r) => ({
          provider_code: s(r?.['provider_code']),
          status: s(r?.['status']),
          amount: s(r?.['amount']),
          ref_id: r ? refState(r) : 'ABSENT',
        })),
        truncated: list.length > CAP,
        /* [FEAT-20260815-RAWPROFILEDIAG] The WHOLE profile response, as it came
           back from the tool. Owner-requested: the derived views above answer
           "why no candidate" only within the shape we EXPECT — when the answer
           is that the shape itself is different (a renamed field, a nested
           envelope, a status never seen before), nothing above can show it.
           This is the raw material to check the rest against.

           ⚠️ MASKED with `maskCredsDeep` — the same helper already applied to
           every stored request/response (`_storeRaw`, and the slip in
           `handoff-chain.service.ts`). Tokens, secrets and `web_code` are
           redacted by key name. No new redaction rule is invented here; a
           different one would drift from the rest of the audit trail.

           ⚠️ Written ONLY on this no-candidate path. A leg that really ran
           stores its own request/response and never reaches this code, so a real
           walletpay upload records exactly what it did before. */
        raw_profile: rawProfileSnapshot,
        /* [FEAT-20260815-MATCHDIAG] One line an operator can act on. English with
           the field names kept verbatim (`statement`, `provider`, `status`,
           `tx_path`) so it reads the same as the config screen and the log. */
        summary:
          pathState !== 'PATH_OK'
            ? `Cannot read statement: ${pathState} at tx_path '${s(cfg.statement_tx_path)}'`
            : list.length === 0
              ? 'Statement list is empty — nothing to match against'
              : byProvider.length === 0
                ? `No statement from provider '${s(cfg.statement_provider_code)}'`
                : byStatus.length === 0
                  ? `Statements exist, but none with status '${s(cfg.statement_status)}'`
                  : byAmount.length === 0
                    ? `Status matched, but no statement amount equals the slip (${Number.isFinite(amount) ? amount : '?'})`
                    : `${byAmount.length} statement(s) matched the slip amount — the walk stopped for the reason on this row, not for lack of a candidate`,
      };
    } catch (err) {
      // A diagnostic must never be able to fail a payment run.
      return { error: `diag failed: ${(err as Error)?.message ?? 'unknown'}` };
    }
  }

  private _logNoCandidate(
    hook: Record<string, unknown> | undefined,
    slip: SlipLike,
    cfg: PaymentCfg,
    rawProfile: unknown,
  ): void {
    try {
      const alias = String(
        (hook as { alias?: unknown } | undefined)?.alias ?? '-',
      );
      const amount = Number(slip.amount);

      // Same two reads `_matchStatements` performs, in the same order.
      const tx = pickByPath(rawProfile, cfg.statement_tx_path) as
        { statement?: unknown } | undefined;
      const rawList = tx && Array.isArray(tx.statement) ? tx.statement : [];
      const list = rawList as Array<Record<string, unknown>>;

      // Distinguish "path missing" from "path found, list empty" — a misspelled
      // `statement_tx_path` is the single most likely config fault here, and the
      // two look identical once you only have the candidate count.
      const pathState =
        tx === undefined || tx === null
          ? 'PATH NOT FOUND'
          : !Array.isArray(tx.statement)
            ? 'PATH OK but `.statement` is not an array'
            : `PATH OK, ${list.length} row(s)`;

      this.logger.log(
        `[WALLETPAYMATCH] ${alias} NO CANDIDATE — slip=${Number.isFinite(amount) ? amount : '?'} · ` +
          `rule: provider_code='${String(cfg.statement_provider_code)}' AND ` +
          `status=${cfg.statement_status ? `'${String(cfg.statement_status)}'` : '(any — not filtered)'} AND ` +
          `amount===slip · tx_path='${String(cfg.statement_tx_path)}' → ${pathState}`,
      );

      if (!list.length) {
        // Nothing to narrow — the rule never got a chance to reject anything.
        this.logger.log(
          `[WALLETPAYMATCH] ${alias} → the statement list is EMPTY, so no row could match. ` +
            `ref_field='${String(cfg.walletpay_ref_id_field)}' query_param='${String(cfg.walletpay_ref_id_query_param)}' (unused — nothing to read it from)`,
        );
        return;
      }

      // Which condition did the narrowing — the reader can see whether the
      // provider filter, the status filter or the amount was the blocker.
      const byProvider = list.filter(
        (s) => s && s['provider_code'] === cfg.statement_provider_code,
      );
      const byStatus = byProvider.filter(
        // [FEAT-20260816-MULTISTATUS] same helper as the matcher
        (s) => this._statusAllowed(cfg, s['status']),
      );
      this.logger.log(
        `[WALLETPAYMATCH] ${alias} → narrowing: ${list.length} total → ` +
          `${byProvider.length} after provider → ${byStatus.length} after status → ` +
          `0 after amount`,
      );

      // The rows that passed provider+status are the ones a matching amount
      // WOULD have selected — so their amounts and refIds are what the operator
      // needs to see. Capped: a long statement list must not flood the log.
      const SHOWN = 5;
      byStatus.slice(0, SHOWN).forEach((s, i) => {
        const rawRef = pickByPath(s, cfg.walletpay_ref_id_field);
        const refState =
          rawRef === undefined
            ? `field '${String(cfg.walletpay_ref_id_field)}' ABSENT`
            : rawRef === null || rawRef === ''
              ? `field present but EMPTY`
              : `'${String(rawRef)}'`;
        this.logger.log(
          `[WALLETPAYMATCH] ${alias} →   passed[${i}] amount=${String(s['amount'])} ` +
            `status='${String(s['status'])}' ref_id=${refState}`,
        );
      });
      if (byStatus.length > SHOWN) {
        this.logger.log(
          `[WALLETPAYMATCH] ${alias} →   … and ${byStatus.length - SHOWN} more not shown`,
        );
      }

      // When provider+status left nothing, the passed[] list above is empty and
      // says nothing about WHY. Show what the rows actually carried instead.
      if (!byStatus.length) {
        const seen = list
          .slice(0, SHOWN)
          .map(
            (s) =>
              `provider='${String(s?.['provider_code'])}' status='${String(s?.['status'])}' amount=${String(s?.['amount'])}`,
          )
          .join(' | ');
        this.logger.log(
          `[WALLETPAYMATCH] ${alias} →   no row passed provider+status. rows seen: ${seen || '(none readable)'}`,
        );
      }
    } catch (err) {
      // A diagnostic must never be able to fail a payment run.
      this.logger.warn(
        `[WALLETPAYMATCH] diagnostic failed (payment flow unaffected): ${
          (err as Error)?.message
        }`,
      );
    }
  }

  private _extractRefId(
    entry: Record<string, unknown>,
    cfg: PaymentCfg,
  ): string {
    const v = pickByPath(entry, cfg.walletpay_ref_id_field);
    const raw =
      typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
    if (!raw) return '';
    // A slipUploadUrl like https://slipupload.walletpay.example.com/?refid=<uuid> → refid.
    if (/^https?:\/\//i.test(raw) && raw.includes('?')) {
      try {
        const q = new URL(raw).searchParams.get(
          cfg.walletpay_ref_id_query_param,
        );
        if (q) return q;
      } catch {
        /* fall through to the raw value */
      }
    }
    return raw;
  }

  /** Load the slip image bytes as a multipart file part under `field`. */
  private async _loadSlipImage(
    slip: SlipLike,
    field: string,
  ): Promise<CustomToolFilePart | null> {
    if (!slip.internal_content_id) return null;
    try {
      const img = (await this.imageModel
        .findById(slip.internal_content_id)
        .lean()
        .exec()) as { file_path?: string | null } | null;
      if (!img?.file_path) return null;
      const buffer = readFileSync(img.file_path);
      return {
        field,
        buffer,
        filename: 'slip.jpg',
        contentType: 'image/jpeg',
      };
    } catch (e) {
      this.logger.error(
        `[PAYRUN] slip image load failed: ${(e as Error).message}`,
      );
      return null;
    }
  }

  // ───────────────────────── slip lock writers ─────────────────────────

  /** Stamp the (already-claimed) lock with a terminal reason; keep it consumed. */
  private async _stampLock(
    slipId: Types.ObjectId,
    runId: Types.ObjectId,
    reason: string,
    stmtIdx: number,
  ): Promise<void> {
    await this.slipModel
      .updateOne(
        { _id: slipId, consumed_by_run: runId },
        { $set: { lock_reason: reason, consumed_stmt_idx: stmtIdx } },
      )
      .exec();
  }

  /**
   * Release a lock THIS run placed (nothing moved). Mirrors legacy unlockSlip:
   * guarded by consumed_by_run so it never frees someone else's lock.
   */
  private async _release(
    slipId: Types.ObjectId,
    runId: Types.ObjectId,
  ): Promise<void> {
    await this.slipModel
      .updateOne(
        { _id: slipId, consumed: true, consumed_by_run: runId },
        {
          $set: {
            consumed: false,
            lock_reason: '',
            consumed_at: null,
            consumed_by_run: null,
            consumed_stmt_idx: null,
          },
        },
      )
      .exec();
  }

  // ───────────────────────── chain-log writers (legacy-faithful) ─────────────

  private genJobRef(): string {
    return (
      'hj_c_' +
      Date.now().toString(32) +
      '_' +
      Math.random().toString(16).slice(2, 12)
    );
  }

  /** Create leg job → storeRaw the request/response → finishJob. */
  private async _logLeg(a: {
    runId: Types.ObjectId;
    slip: SlipLike;
    hook: { _id?: Types.ObjectId };
    userId: string;
    role: string;
    chainStep: number;
    cursor: number;
    /**
     * [FIX-20260817-RESUMEDEDUPE] Attempt generation = the run's `startCursor`.
     * 0/undefined on a first run, the resume index on a [ลองใหม่]. Without it a
     * resume re-logged LEG 1 under the first attempt's key and threw E11000,
     * which is what made the retry tap answer with silence.
     */
    generation?: number;
    reqBody: Record<string, unknown>;
    res: CallResult;
    snapshotExtra: Record<string, unknown>;
  }): Promise<void> {
    // handoff_jobs — HandoffJob.create (legacy runner.js:88 / index.js:127).
    const job = await this.jobModel.create({
      job_ref: this.genJobRef(),
      target_id: null,
      target_key: a.role,
      subject_type: 'slip',
      subject_id: a.slip._id,
      hook_id: a.hook._id || null,
      member_user_id: a.userId,
      status: 'queued',
      next_attempt_at: new Date(),
      locked_until: new Date(0),
      chain_run_id: a.runId,
      chain_step: a.chainStep,
      snapshot: { stmt_idx: a.cursor, ...a.snapshotExtra },
      // [FIX-20260817-RESUMEDEDUPE] see payment-leg-dedupe.ts — a first run's key
      // is byte-identical to what this line produced before.
      dedupe_key: buildLegDedupeKey(
        String(a.runId),
        a.chainStep,
        a.cursor,
        a.generation,
      ),
      // [FIX-20260817-RETRYTRIGGER] 'auto' for the run the slip started, 'manual'
      // for a leg the customer asked for with [ลองใหม่] — the handoff history
      // already renders this field. See payment-leg-dedupe.ts.
      triggered_by: legTriggeredBy(a.generation),
      // [FIX-20260818-CTXATTEMPT] the same number as a QUERYABLE field, so
      // `_context` can find the job belonging to THIS pass. `dedupe_key` carries
      // it too but is keyed on the cursor, which two `_context` callers do not
      // supply faithfully. เลขรอบต้อง query ได้ ไม่ใช่ฝังอยู่ในสตริง.
      attempt: a.generation ?? 0,
    });
    const jobId = (job as { _id: Types.ObjectId })._id;

    // handoff_results — storeRaw shape (legacy index.js:355). request(masked) + final.
    const rawStr =
      typeof a.res.data === 'string'
        ? a.res.data
        : JSON.stringify(a.res.data ?? '');
    const rawBytes = Buffer.byteLength(rawStr);
    const bodyStr = JSON.stringify(a.reqBody ?? {});
    await this.resultModel
      .updateOne(
        { _id: jobId },
        {
          $setOnInsert: {
            _id: jobId,
            job_ref: (job as { job_ref: string }).job_ref,
            target_key: a.role,
            subject_type: 'slip',
            subject_id: a.slip._id,
            member_user_id: a.userId,
            chain_run_id: a.runId,
            chain_step: a.chainStep,
          },
          $set: {
            request: {
              method: a.res.method || 'POST',
              url: a.res.url || '',
              // We never hold the signed headers, so nothing secret is stored.
              headers_redacted: {},
              body: maskCredsDeep(a.reqBody),
              body_bytes: Buffer.byteLength(bodyStr),
              redacted_fields: [],
              sent_at: new Date(),
            },
            final: {
              received_via: 'sync',
              received_at: new Date(),
              http_status: a.res.status,
              raw:
                typeof a.res.data === 'object'
                  ? maskCredsDeep(a.res.data)
                  : undefined,
              raw_text:
                typeof a.res.data === 'string'
                  ? rawStr.slice(0, RAW_TEXT_CAP)
                  : undefined,
              raw_bytes: rawBytes,
              raw_sha256: createHash('sha256').update(rawStr).digest('hex'),
              truncated: rawBytes > RAW_TEXT_CAP,
              adapter_version: 1,
            },
          },
        },
        { upsert: true },
      )
      .exec();

    // handoff_jobs finishJob (legacy index.js:399): terminal status + attempt.
    const ok = a.res.success === true;
    const code = ok ? a.res.error || 'OK' : a.res.error || 'UPSTREAM_FAIL';
    const set: Record<string, unknown> = {
      status: ok ? 'succeeded' : a.res.outcome_unknown ? 'unknown' : 'failed',
      outcome_code: String(code).slice(0, 120),
      outcome_message: String(
        (a.res.data as { message?: string })?.message || '',
      ).slice(0, 500),
      lock_owner: '',
      locked_until: new Date(0),
    };
    if (ok) {
      set['result_meta.received_via'] = 'sync';
      set['result_meta.has_raw'] = true;
      if (typeof a.res.status === 'number') {
        set['result_meta.http_status'] = a.res.status;
      }
    }
    await this.jobModel
      .updateOne(
        { _id: jobId },
        {
          $set: set,
          $inc: { attempt_count: 1 },
          $push: {
            attempts: {
              $each: [
                {
                  no: 1,
                  started_at: new Date(),
                  duration_ms: a.res.duration,
                  http_status:
                    typeof a.res.status === 'number' ? a.res.status : undefined,
                  error_code: String(code).slice(0, 120),
                },
              ],
              $slice: -20,
            },
          },
        },
      )
      .exec();
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * 📋 REVIEW-REASON MAP — every reason an admin can see, and what causes it
   * ══════════════════════════════════════════════════════════════════════════
   * ทุกค่าที่ `review_reason` เป็นได้ อยู่ตรงนี้ที่เดียว · แก้ชื่อได้อิสระ
   *
   * ⭐ ALL OF THESE STRINGS ARE FREE-FORM AND SAFE TO RENAME. Nothing in `src/`
   * branches on `review_reason` — it is written for humans and for dashboard
   * filters, never read back as a decision. If you rename one, update whatever
   * displays it; nothing else breaks. แก้ชื่อได้ ไม่มีโค้ดไหน branch จากค่านี้.
   *
   *  reason                  | fires when                        | slip | line
   *  ------------------------|-----------------------------------|------|------
   *  awaiting_admin_confirm  | walletpay matched, confirmed:false   | 🔒   | 1317
   *  topup_timeout           | topup gave no usable answer       | 🔒   | 959
   *  walletpay_unclear          | walletpay 200 but undecipherable     | 🔒   | 1286
   *  walletpay_exhausted        | statements tried, ≥1 uploaded,    | 🔒   | 1144,1351
   *                          |   nothing matched · log outcome   |      |
   *                          |   TRUE + lock 'review' — the 200s |      |
   *                          |   SUCCEEDED ([FIX-20260811-PAYLOG])|     |
   *  no_walletpay_endpoint      | tool has no pay_walletpay endpoint   | 🔓   | fallback
   *  walletpay_tool_invalid     | bound walletpay tool unusable        | 🔓   | fallback
   *  walletpay_bad_request      | walletpay 400 code:4001 — our        | 🔓   | fallback
   *                          |   multipart rejected (file field) |      |
   *  walletpay_invalid_ref      | zero uploads, ≥1 refId walletpay     | 🔓   | fallback
   *                          |   called malformed (400 code:4000)|      |
   *  ''  (empty)             | NOT a review case — normal flow   | —    | below
   *
   * ⚠️ TWO FAMILIES ABOVE (corrected 2026-08-11; the 🔓 rows were added to this
   * table because since [FEAT-20260810-FALLBACKNOLOCK] they DO set
   * `needs_review:true` + `review_reason` on the run while releasing the slip —
   * the previous note here claiming they leave `needs_review:false` described
   * the pre-2026-08-10 behaviour). `no_matching_statement` and
   * `walletpay_stale_statements` are NOT review reasons: `_statementFallback`
   * releases them silently — the string lands only in the context `reason`
   * field, a DIFFERENT field from `review_reason`. `walletpay_txn_not_found` is
   * also NOT a review reason: it is a per-statement context `reason` written
   * while the walk continues ([FEAT-20260811-WALLETPAY4040]).
   *
   * ⭐ A SUCCESSFUL CREDIT NEVER PRODUCES A REVIEW ROW. Both money-in outcomes —
   * topup `process-wallet` and walletpay matched+confirmed — write
   * `lock_reason:'success'` and leave `needs_review:false` / `review_reason:''`
   * untouched, so they never appear on a review screen at all. เงินเข้าปกติ =
   * ไม่มีรีวิว. The same is true of the in-flight and released states
   * (`processing`, and every 🔓 release) — only the seven rows above ask for a
   * human.
   *
   * 🔒 = slip stays LOCKED (something was uploaded or credited — releasing it
   *      risks a double credit). 🔓 = RELEASED, the customer may resend.
   *
   * THREE GROUPS, and they need different handling on an admin screen:
   *   · awaiting_admin_confirm → routine. Money is fine, someone just confirms.
   *   · topup_timeout / walletpay_unclear / walletpay_exhausted → URGENT: we do not
   *     know whether money moved. Never bulk-release these.
   *   · no_walletpay_endpoint / walletpay_tool_invalid / walletpay_bad_request /
   *     walletpay_invalid_ref → configuration or upstream-data fault (slip
   *     already released). Fix the setting/code/data, customer resends.
   *     (`no_matching_statement` and `walletpay_stale_statements` are the
   *     no-review siblings of this group — data outcomes the customer clears
   *     themselves.)
   *
   * ⚠️ HOW TO ADD A NEW REVIEW CASE (สำคัญ — ทำครบ 3 ขั้น):
   *   1. write BOTH `needs_review: true` AND a non-empty `review_reason` at the
   *      new site. A review row with an empty reason is invisible to a
   *      reason-based filter — that exact bug hid `matched_pending` until
   *      2026-08-10.
   *   2. add a row to the table above.
   *   3. tell whoever owns the admin screen, so the new reason gets a label.
   *
   * ⚠️ FOR THE ADMIN SCREEN: filter on `needs_review: true`, NOT on a hardcoded
   * list of these strings. A list goes stale silently — the row disappears
   * instead of failing loudly. Show `review_reason` as a COLUMN, not a filter.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Per-step audit context (legacy auditContext.js) on handoff_results.context.
   * `needs_review:false` + `review_reason:''` are the DEFAULTS below: a step
   * that finishes normally simply does not override them.
   */
  private async _context(
    runId: Types.ObjectId,
    slip: SlipLike,
    chainStep: number,
    role: string,
    cursor: number,
    extra: Record<string, unknown>,
    /**
     * [FIX-20260818-CTXATTEMPT] Which PASS of the chain is reporting — the run's
     * `startCursor`, the same number `_logLeg` stamps as `generation`.
     * `undefined` is read as `0` (the pass the slip started), so a caller that
     * does not know it behaves exactly as before rather than throwing on a money
     * path. ไม่ส่งมา = รอบแรก = พฤติกรรมเดิม.
     */
    generation?: number,
  ): Promise<void> {
    /* ══════════════════════════════════════════════════════════════════════
     * [FIX-20260818-CTXATTEMPT] report onto THIS pass's row, never another's
     * ══════════════════════════════════════════════════════════════════════
     * WHAT WAS WRONG: the lookup was `{chain_run_id, chain_step}` newest-first —
     * "the latest job for this step, whichever pass made it" — and the no-job
     * upsert below keyed on `(chain_run_id, chain_step, target_key)`. Neither
     * knew about passes, and a run re-enters a leg every time the customer taps
     * [ลองใหม่]. On production run 6a83e019…1131 the resume's `walletpay_exhausted`
     * therefore overwrote the FIRST pass's `context`, on a row whose stored
     * request was a walletpay POST that had answered 200 — and the resume, which
     * never POSTed at all, left no row of its own. The page showed a `review`
     * verdict sitting on a successful upload. Owner-reported 18/08/2026.
     *
     * NARROWING BOTH HALVES BY `attempt` is the whole fix. `$in: [n, null]`
     * rather than `attempt: n` so a row written BEFORE the field existed (an
     * in-flight run that resumes across the deploy) is still recognised as the
     * first pass instead of being duplicated — `null` matches a missing field in
     * MongoDB, `0` does not. `attempt` is in `$set`, so an upsert that inserts
     * still stores the real number.
     *
     * ⚠️ SAME OUTCOME AS BEFORE FOR EVERY FIRST-PASS RUN. `generation` is 0 or
     * undefined there, the filters match exactly what they matched before, and
     * the extra `$set` writes the value the default would have given. Only a
     * SECOND pass — which previously had nowhere of its own to write — behaves
     * differently, and "differently" means it stops destroying the first one.
     * รอบแรกได้ผลเท่าเดิมทุกประการ · เปลี่ยนเฉพาะรอบที่กดปุ่ม.
     *
     * ⚠️ Filter and audit only. Nothing here reads or writes the money decision:
     * no statement is chosen, no HTTP call is made, no slip lock moves, and the
     * customer's reply is built elsewhere from `_result`. เส้นเงินไม่ถูกแตะ.
     * revert: drop the `generation` param, the two `attempt` clauses and the
     * `attempt` key in `$set`. */
    const attempt = generation ?? 0;
    /** Also matches rows written before `attempt` existed — see above. */
    const attemptFilter = attempt === 0 ? { $in: [0, null] } : attempt;
    /* [FIX-20260818-CTXSLOT] cursor -1 = the end-of-walk SUMMARY, which is not
       about any leg. A summary must always take the no-job path and sit in its
       own slot. revert: drop the ternary, keep the plain lookup.

       [FIX-20260820-CTXCURSOR] …and the lookup itself now carries the walk
       position. It used to select by (run, step, attempt) alone and sort newest
       first, so it answered "the newest leg of this pass" to EVERY caller —
       including one reporting about a ใบ that never got a leg of its own, whose
       context then landed on someone else's row. `snapshot.stmt_idx` is the
       value `_logLeg` writes for exactly this purpose (see the snapshot it
       builds in `_logLeg`), so a leg is now found only by the caller reporting
       about THAT leg; anyone else falls through to the no-job upsert, which has
       keyed on the position since CTXSLOT. Older rows written before `_logLeg`
       stamped the snapshot simply miss and take the no-job path — they get an
       audit row of their own instead of overwriting a leg, which is the safe
       direction. ไม่ต้อง backfill.
       revert: delete the one `snapshot.stmt_idx` line below. */
    const job =
      cursor === WALK_SUMMARY_CURSOR
        ? null
        : await this.jobModel
            .findOne({
              chain_run_id: runId,
              chain_step: chainStep,
              attempt: attemptFilter,
              'snapshot.stmt_idx': cursor,
            })
            .sort({ created_at: -1 })
            .lean()
            .exec();
    const jobId = (job as { _id?: Types.ObjectId } | null)?._id;

    /**
     * ══════════════════════════════════════════════════════════════════════
     * [FEAT-20260810-CTXNOJOB] write the row even when the leg never ran
     * ══════════════════════════════════════════════════════════════════════
     * WHAT CHANGED: this used to `return` silently when no job row existed for
     * (run, step). That is correct for a leg that HAS run — the context belongs
     * on that leg's result row. But three outcomes abort BEFORE the walletpay job
     * is created (`no_walletpay_endpoint`, `walletpay_tool_invalid`,
     * `no_matching_statement` — all raised from `_statementFallback` at ~:1119,
     * ~:1124, ~:1147, while the walletpay job is written at ~:1206), so those runs
     * produced NO audit row at all. The outcome was invisible: nothing in the
     * chain-log said why the slip was released. เคสพวกนี้เคยไม่มี log เลย.
     *
     * That also silently swallowed the `needs_review` flag those cases now set,
     * so a config fault could never have reached an admin screen.
     *
     * HOW: with no job to attach to, key the row on (chain_run_id, chain_step,
     * target_key) and upsert. The shape stays identical — same `context`
     * object — so anything reading these rows is unaffected.
     *
     * ⚠️ WHY THE KEY INCLUDES target_key: a run can legitimately write more
     * than one row for the same step (walletpay walks several statements), so
     * keying on (run, step) alone would let a later write overwrite an earlier
     * one. In practice only the no-job path lands here and it writes once, but
     * the key is chosen so it stays correct if that changes.
     *
     * ⚠️ [FIX-20260809-CTXUPSERT] The field is `target_key` — the name this
     * collection already uses (handoff-result.schema.ts:117). An earlier version
     * wrote `step_target_key`, which does not exist on the schema. Mongoose drops
     * unknown paths silently on a plain update, but with `upsert: true` it THROWS
     * (`Path "…" is not in schema, strict mode is true, and upsert is true`), so
     * the whole run aborted with `skipped:'error'` before any leg could run.
     * Found by running the real Swiftcheck-success flow end to end — no unit test
     * covered this branch because it only fires when there is no job row.
     * ห้ามเปลี่ยนกลับเป็นชื่ออื่นที่ schema ไม่มี ไม่งั้น upsert จะพังทั้ง run.
     *
     * ⚠️ NOT a behaviour change for the normal path: when `jobId` exists the
     * query is byte-identical to before. Only the previously-dropped case is
     * new. HOW TO REVERT: restore `if (!jobId) return;` — the three fallback
     * outcomes then go back to leaving no trace.
     */
    const ctx = {
      member_user_id:
        slip.sender_member_user_id || slip.sender_line_user_id || '',
      slip_record_id: slip._id,
      chain_run_id: runId,
      chain_step: chainStep,
      target_key: role,
      stmt_idx: cursor,
      actor: 'auto',
      outcome: '',
      reason: '',
      slip_locked: false,
      lock_reason: '',
      needs_review: false,
      review_reason: '',
      ...extra,
    };
    /* [FIX-20260818-DIAGONCE] `diag` belongs to `final.parsed`, not here.
     *
     * `extra` is spread into the context row, so the diagnosis — which carries a
     * masked copy of the whole profile response, up to 256 KB — was stored TWICE
     * on every row that had one. Nothing reads `context.diag`: the audit page
     * renders `final.parsed.diag` (HandoffHistory.tsx), and no service or spec
     * touches the context copy. Deleting it shrinks the row and changes nothing
     * a reader can see. Old rows keep whatever they already hold.
     * revert: drop this line. diag เก็บที่เดียวพอ */
    delete (ctx as Record<string, unknown>)['diag'];
    // Normal path: attach to the leg's own result row (unchanged).
    // No-job path: key on the run + step + role instead, so the outcome is still
    // recorded. Both upsert, both write the same `context` shape.
    const filter = jobId
      ? { _id: jobId }
      : {
          chain_run_id: runId,
          chain_step: chainStep,
          target_key: role,
          // [FIX-20260818-CTXATTEMPT] without this a resume's row lands on the
          // first pass's row and overwrites it. See the block at the top.
          attempt: attemptFilter,
          /* [FIX-20260818-CTXSLOT] one walk position = one row. Without this,
             every no-job row of a pass (each per-statement skip AND the
             end-of-walk summary) upserted into the SAME document — found live
             when a planted statement's 4040 row vanished under the summary.
             `context` is declared Mixed (handoff-result.schema.ts:228), so the
             dotted path is legal in a strict-mode upsert, and `$set: context`
             below writes the whole object, so an inserted row always carries
             the value this filter will look for next time. Legacy rows keep
             their merged shape — display-only, no migration.
             ตำแหน่งเดินคนละใบ = คนละแถว · แถวเก่าไม่ต้องแตะ. */
          'context.stmt_idx': cursor,
        };
    /* ══════════════════════════════════════════════════════════════════════
     * [FEAT-20260815-STEPNORUNLOG] the step must SAY it did not run
     * ══════════════════════════════════════════════════════════════════════
     * OWNER-REPORTED 15/08/2026, twice: "step 2 ไม่เก็บถ้าไม่มี candidate",
     * "มันต้องมี log บอกว่า walletpay step 2 ปิด".
     *
     * `[FEAT-20260810-CTXNOJOB]` above already creates the row for a leg that
     * never ran — but it writes `context` ONLY. `final` stays at its schema
     * default `{redacted_fields:[]}`, and the chain-log UI reads `final` to
     * decide it has something to show, so step 2 rendered as if it did not
     * exist. Verified on run 6a802c00…62e9: the row WAS in Mongo with
     * `reason:'no_walletpay_endpoint'`, and the screen still showed step 1 alone.
     *
     * WHAT IS WRITTEN NOW — only on the no-job path, and only when `final` is
     * still absent: a small self-describing record that the step was skipped,
     * carrying the reason and a human sentence. No HTTP fields are faked —
     * `http_status` is deliberately absent, which is exactly how a reader can
     * tell "never sent" from "sent and answered".
     *
     * ⚠️ THE NORMAL PATH IS UNTOUCHED. When a job exists (`jobId` set) the leg
     * really ran and `_storeRaw` owns `final` with the true request/response;
     * writing here would overwrite an audit record of a real money call. Hence
     * the guard is `!jobId` — not "final looks empty". ห้ามทับของจริง.
     *
     * ⚠️ `$setOnInsert` for `final`, so a re-delivery of the same (run, step)
     * cannot rewrite what was recorded the first time.
     *
     * revert: delete the `skipInfo` const and the `$setOnInsert` block — the
     * row then goes back to `context`-only, exactly as before this change. */
    /* ⚠️ FIELD NAMES CHECKED AGAINST THE SCHEMA, NOT INVENTED. `final` is a
       typed subdocument (handoff-result.schema.ts:166-183): a key that is not
       declared there is DROPPED SILENTLY by Mongoose — the write would report
       success and store nothing, which is the exact class of bug this change
       exists to fix. So the payload rides in `parsed` (declared `Mixed`) and
       `received_via` (declared `String`); no schema change, no migration, and
       old rows keep reading fine. ห้ามเดาชื่อ field — ของที่ไม่มีใน schema จะหายเงียบ. */
    const skipReason = String((extra as { reason?: unknown })?.reason ?? '');
    const skipInfo = !jobId
      ? {
          final: {
            received_via: 'not_sent',
            received_at: new Date(),
            redacted_fields: [],
            parsed: {
              skipped: true,
              reason: skipReason || 'unspecified',
              /* A sentence, not a code — read by a human in the chain log,
                 sitting next to steps that show a real HTTP answer. */
              note:
                `Not sent — stopped before the request. Reason: ${skipReason || 'unspecified'}. ` +
                `No request/response recorded (the endpoint was never called).`,
              /* [FEAT-20260815-MATCHDIAG] the decision inputs, when the caller
                 supplied them: our matching rule, what the statement list
                 actually held, and how each condition narrowed it. Absent for
                 reasons that have nothing to diagnose. */
              ...((extra as { diag?: unknown })?.diag
                ? { diag: (extra as { diag?: unknown }).diag }
                : {}),
            },
          },
        }
      : {};

    await this.resultModel
      .updateOne(
        filter,
        {
          $set: {
            context: ctx,
            // Only meaningful on the no-job path — on the normal path these
            // already live on the row the job created. Harmless there because
            // they are set to the values that row already holds.
            chain_run_id: runId,
            chain_step: chainStep,
            target_key: role,
            /* [FIX-20260818-CTXATTEMPT] written on BOTH paths on purpose. The
               filter above may match with `$in: [0, null]`, and MongoDB does not
               build a field from an `$in` clause on insert — so without this a
               newly inserted row would carry no `attempt` and the next pass
               would match it again. On the job path it re-states the value the
               job already stored, which is why it is safe there. */
            attempt,
            /* [FIX-20260820-CTXCURSOR] keep the walk verdict VISIBLE.
             *
             * `walletpay-history.service.ts:134` scopes the page with
             * `{ chain_step: 2, member_user_id }` — the TOP-LEVEL field. The
             * no-job upsert never wrote it (only `context.member_user_id`), so
             * a no-job row keeps the schema default `''` and the page cannot
             * see it: measured on the dev db, 83 of 134 step-2 rows are
             * invisible there today. That gap predates this change.
             *
             * It matters here because this change MOVES the end-of-walk verdict
             * off the leg row (which carries the id) and onto a no-job row
             * (which does not). Without this line the fix would trade a
             * corrupted-but-visible row for a clean-but-INVISIBLE one — the
             * operator would simply stop seeing `walletpay_exhausted`. ไม่ยอมให้หาย.
             *
             * SCOPED TO THE SUMMARY ROW ON PURPOSE. Filling it for every no-job
             * row would also surface the other 83 (skips, `no_matching_statement`
             * …) on a page that has never shown them — a display change nobody
             * asked for. This writes only the row that was visible before, so
             * the page keeps showing exactly what it shows today, minus the
             * corruption. หน้าจอเหมือนเดิม ยกเว้นแถวที่เคยปนกันถูกแยกออก.
             *
             * Safe on the job path because it is never reached there (`jobId`
             * is set ⇒ `cursor !== WALK_SUMMARY_CURSOR` is what put us here),
             * and the two fields hold the same value on every row that has
             * both — checked on all 51 joinable rows.
             * revert: delete this spread; the verdict row goes back to being
             * written but unreadable on that page. */
            /* [FIX-20260821-SKIPVISIBLE] ทุกแถวที่ไม่มี job ได้ id ระดับบน ไม่ใช่แค่แถวสรุป
               ===================================================================
               เดิมมีเงื่อนไข `cursor === WALK_SUMMARY_CURSOR` คั่นอยู่ พร้อมโน้ตว่า
               การเติมให้ทุกแถวจะ "ดัน 83 แถวขึ้นหน้าที่ไม่เคยแสดงมัน"

               ⚠️ วัดใหม่ 21/08 แล้ว **โน้ตนั้นหมดอายุ** — 83 แถวนั้นมีแค่ 2 reason
               (`no_matching_statement` 82 · `no_walletpay_endpoint` 1) และเป็น **แถวสรุป**
               ที่เขียนไว้ก่อน `FIX-20260818-CTXSLOT` กับ `a04ff4b` จะลง
               แถวสรุปมองเห็นตั้งแต่ 20/08 แล้ว และไม่มีแถวมองไม่เห็นเกิดใหม่อีกเลย

               เส้นเดียวที่ guard นี้ยังบังอยู่คือ `walletpay_no_ref_id` (`:1869`) ซึ่งรัน
               **ก่อน** `_logLeg` ของ walk (`:1909`) จึงไม่มี job — และเส้นนั้น
               **ยังไม่เคยเกิดสักครั้ง** (0 แถวถือ reason นี้) ⇒ ถอด guard แล้ว
               จำนวนแถวที่โผล่เพิ่มวันนี้ = **ศูนย์**

               อีกสาม reason ที่ข้ามเหมือนกัน (`walletpay_txn_not_found` :1962 ·
               `walletpay_invalid_ref` :1988 · `no_match` :2052) รัน **หลัง** `_logLeg`
               จึงมี job และมองเห็นอยู่แล้ว ไม่ถูกกระทบไม่ว่าจะมี guard หรือไม่

               ⚠️ 83 แถวเก่าไม่ถูกแตะ — มันมี id ระดับบนว่างไปแล้ว มีแต่ backfill
               เท่านั้นที่จะดันขึ้นมา ซึ่งเป็นการแก้ข้อมูลจริงและต้องขออนุมัติแยก

               `ctx.member_user_id` ยังต้องมีค่า — แถวที่ไม่รู้จักเจ้าของก็ยังไม่ถูกเติม
               revert: ใส่ `cursor === WALK_SUMMARY_CURSOR &&` กลับเข้าไป */
            ...(!jobId && ctx.member_user_id
              ? { member_user_id: ctx.member_user_id }
              : {}),
          },
          ...(Object.keys(skipInfo).length ? { $setOnInsert: skipInfo } : {}),
        },
        { upsert: true },
      )
      .exec();
  }

  private async _endRun(
    runId: Types.ObjectId,
    status: string,
    needsReview: boolean,
  ): Promise<void> {
    await this.runModel
      .updateOne(
        { _id: runId },
        { $set: { status, ended_at: new Date(), needs_review: needsReview } },
      )
      .exec();
  }

  private _result(
    runId: Types.ObjectId,
    outcome: PaymentOutcome,
    needsReview: boolean,
    cfg: PaymentCfg,
    state: ReplyState,
    dynamicText = '',
    /**
     * [FEAT-20260810-PAYSTATEFLEX] `hook.payment_flex_ids`, supplied ONLY by the
     * two call sites that emit a SUCCESS state. Everything else omits it and keeps
     * its previous behaviour exactly — that is why this is a trailing optional
     * rather than a required parameter threaded through all eleven call sites of
     * this method. ส่งมาแค่ 2 จุดที่ต้องใช้ ที่เหลือไม่แตะ.
     */
    boundFlexIds?: Record<string, unknown> | null,
  ): PaymentRunResult {
    // RELEASE only when NOTHING credited/uploaded (RELEASED); every other outcome
    // FINALIZES the lock (topup credited, or walletpay uploaded/credited).
    const released = outcome === 'RELEASED';
    return {
      ran: true,
      outcome,
      chain_run_id: runId,
      lock: {
        // [P2C-2c] AWAITING_RETRY stays CLAIMED but is NOT finalized: the run is
        // paused mid-flight waiting for [ลองใหม่], so the slip must stay claimed
        // (a re-delivered webhook must not start a second run on it) while the
        // reason still reads 'processing' — it is in flight, not terminal.
        // Marking it 'timeout' here would make a normal pause look like a
        // money-unknown incident to anyone reading the lock.
        consumed: !released,
        lock_reason: released
          ? ''
          : outcome === 'SUCCESS'
            ? 'success'
            : outcome === 'MATCHED_PENDING'
              ? 'matched_pending'
              : outcome === 'AWAITING_RETRY'
                ? 'processing'
                : 'timeout',
      },
      needs_review: needsReview,
      /* ─────────────────────────────────────────────────────────────────────
       * [FEAT-20260810-TOPUPCARD] `topup_success` ไม่ตอบเอง — ปล่อยการ์ดสลิปเดิม
       *
       * WHAT: เมื่อ topup ได้ `process-wallet` (เครดิตเข้าแล้ว) runner จะ **ไม่**
       *       สร้าง reply ของตัวเอง คืน `reply: null` แทน
       * WHY:  เจ้าของสั่งว่าเคสนี้ให้ตอบ `flex_success` ของ Swiftcheck เหมือน flow ปกติ
       *       การ์ดนั้นมีอยู่แล้วและแอดมินแต่งเองได้จากหน้าเว็บ (flex_messages)
       *       การให้ payment สร้างข้อความของตัวเองจะไปกลบการ์ดที่แอดมินตั้งใจแต่ง
       * HOW:  `webhook.service.ts:3468` อ่านว่า `!result.reply` ⇒ คืน false ⇒
       *       การ์ดสลิปเดิมได้ตอบตามปกติ — ใช้กลไกที่มีอยู่แล้ว ไม่ต้องเพิ่ม flag
       *       (คืน `undefined` ไม่ใช่ `null` เพราะ type ของ PaymentRunResult.reply
       *        เป็น optional อยู่แล้ว — ไม่ต้องแก้ type ให้กระทบที่อื่น)
       *
       * 📍 การ์ดที่ลูกค้าจะเห็นมาจากไหน:
       *    `flex_messages` ใน MongoDB → เลือกด้วย `hook.flex_success`
       *    → ประกอบที่ `webhook/slip-flex.handler.ts` (ตัวเดียวกับ flow Swiftcheck ปกติ)
       *    เงื่อนไขที่ทำให้ได้การ์ด "สลิปถูกต้อง": Swiftcheck ตอบ success + ไม่ซ้ำ +
       *    บัญชีผู้รับตรง (ถ้าไม่ตรงจะได้ `flex_success_not_match` แทน)
       *    ⇒ แอดมินแก้ข้อความ/หน้าตาการ์ดเองได้จากหน้าเว็บ ไม่ต้องแก้โค้ดนี้
       *
       * ⚠️ สิ่งที่ **ไม่** เปลี่ยน: outcome ยังเป็น 'SUCCESS' · ล็อกยัง finalize
       *    เป็น 'success' · log/audit ทุกแถวเขียนเหมือนเดิมทุกประการ
       *    เปลี่ยนแค่ "ใครเป็นคนตอบลูกค้า" ไม่ใช่ "เกิดอะไรขึ้นกับเงิน"
       *
       * revert: ลบเงื่อนไข ternary นี้ เหลือ `this._reply(state, cfg, dynamicText)`
       *         ⇒ กลับไปตอบข้อความของ payment เองเหมือนเดิม
       *         (REPLY_TEXT.topup_success ยังอยู่ครบ ไม่ได้ลบ)
       * ───────────────────────────────────────────────────────────────────── */
      /* [FEAT-20260810-PAYSTATEFLEX] …UNLESS THIS OA BOUND A CARD TO THIS STATE.
       * Owner's rule is 1 state = 1 card, and Q3 (2026-08-10) settled that binding
       * one to a success state must WIN over the Swiftcheck card. Not bound ⇒ the
       * `undefined` above still stands and the Swiftcheck card answers as before, so
       * every OA that never sets this is untouched.
       * ตั้งการ์ด = ใช้การ์ดนั้น · ไม่ตั้ง = การ์ด Swiftcheck เหมือนเดิม. */
      reply:
        SLIP_CARD_STATES.has(state) && !boundFlexIds?.[state]
          ? undefined
          : this._reply(state, cfg, dynamicText),
    };
  }
}
