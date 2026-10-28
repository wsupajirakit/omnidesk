/**
 * =====================================================================
 * The customer-facing SLIP FLEX branch — the card a customer sees after
 * their transfer slip is verified.
 * =====================================================================
 *
 * [FIX-20260808-SLIPFLOW] TRANSCRIBED, not redesigned. Source of truth:
 *   legacy-api/src/controllers/core-bot/webhookController.js  (branch dev_sec)
 *   · the whole `if (slipVerifyResult) { … }` block                legacy:3473-3734
 *   · the `slipQuickReply` literal + `isFlexSent`/`flexDoc`/…       legacy:3447-3476
 *   · the flex tag map + brace substitution + send                 legacy:3556-3649
 *   · the SLIP_NOT_FOUND / VALIDATION_ERROR (QR) sub-branch         legacy:3650-3730
 *
 * Given `slipVerifyResult` (Swiftcheck's body, already produced by
 * `SlipFlowService.verifySlip` and stashed in the webhook's enclosing scope),
 * this selects ONE flex card from the hook's five payment-card ids
 * (`flex_success` / `flex_duplicate` / `flex_min_amount` / `flex_out_of_time` /
 * `flex_success_not_match`), or an error card (`flex_not_found` / `flex_error`)
 * on the QR path, substitutes the slip's data into it, and sends it.
 *
 * ── CONTRACT (kept exactly as legacy's straight-line block leaves it) ────────
 *   returns { isFlexSent, flexDoc, slipCondition, violationDetected,
 *             isQrCodeSlip, textReplyOverride }
 *   · isFlexSent true  → a card WAS sent; the caller fires the slip callback and
 *                        `return`s, SKIPPING the normal AI/image_answer reply.
 *   · isFlexSent false → nothing sent; the caller falls through to the normal
 *                        image_answer_text reply (with `textReplyOverride` used
 *                        as the text when the QR path set it).
 *   · The four other fields feed the assist-notification decision downstream
 *     (`isNormalMedia = !isQrCodeSlip`, `isSuccessfulQr`, `isPaymentFlex`).
 *
 * ── WHY A DEPS-INJECTED HELPER, NO SERVICE IMPORTED ─────────────────────────
 * Mirrors assist-notification.ts / customer-register.handler.ts: every
 * collaborator arrives through `deps`, so the branch is drivable with fakes and
 * a unit test can never open a socket NOR bill Gemini. `checkQrCode` is the seam
 * over `QrVisionService.checkIfSlipWithQrCode`; in tests it is a canned boolean,
 * so no `generateContent` request is ever possible from here.
 *
 * ── ⚠️ TWO LOAD-BEARING BEHAVIOURS A CLEANUP WOULD ERASE ────────────────────
 * 1. **Violation priority is ORDERED and short-circuits** (legacy:3496-3554).
 *    The FIRST match wins — `!violationDetected` gates every later check — and
 *    the success card is chosen ONLY when nothing violated AND no card was
 *    already picked. Reordering these changes which card a slip gets.
 *
 *    ⚠️ THERE ARE **TWO** ORDERS, AND ONLY TWO. Which one runs is decided by the
 *    `duplicateFirst` input and nothing else. Do not add a third.
 *
 *      NORMAL — every caller, unchanged since legacy
 *        1 out_of_time · 2 min_amount · 3 success_not_match · 4 duplicate · 5 success
 *
 *      LOCKED — [FEAT-20260820-LOCKDUPFIRST] `duplicateFirst: true`
 *        1 duplicate ⭐ · 2 out_of_time · 3 min_amount · 4 success_not_match · 5 success
 *
 *    WHEN IS `duplicateFirst` TRUE? Only when the payment runner reported
 *    `skipped: 'duplicate_after_success'` — one line, one condition
 *    (`payment-runner.service.ts:1026`): a PRIOR slip with the same `trans_ref`
 *    carries `consumed:true` + `lock_reason:'success'`, meaning the customer's
 *    money already arrived on an earlier send and this is a resend of the very
 *    same slip. Both webhook call sites (normal path and assist path) pass the
 *    runner's answer, so the LOCK decides — never the room's state.
 *
 *    WHY THE LOCKED ORDER EXISTS: a slip that has already paid cannot usefully
 *    be told anything about its recipient or its age. Seen in production
 *    2026-08-20 — credited 12:31:56, resent 12:33:29, and answered
 *    "ชื่อผู้รับไม่ถูกต้อง" because check 3 fired before check 4 could. Once the
 *    money is in, "already used" is the only true answer.
 *
 *    WHAT IT DOES NOT DO: it never invents a duplicate (Swiftcheck's `isDuplicate`
 *    must still be true), never skips a check, and never changes what any check
 *    decides. With `duplicateFirst` false the chain is byte-identical to before
 *    it existed — proved by lifting the new block out and diffing the remaining
 *    logic against the previous commit, line for line.
 *    สองลำดับเท่านั้น · สลับเฉพาะตอนสลิปจ่ายไปแล้วและถูกล็อก · ปิดอยู่ = เหมือนเดิมทุกบรรทัด.
 * 2. **The 404 short-circuit skips Gemini** (legacy:3656-3661): SLIP_NOT_FOUND
 *    sets `isQrCodeSlip = true` WITHOUT a vision call — Swiftcheck already saw a QR
 *    it could not verify. Only VALIDATION_ERROR (no QR seen) asks `checkQrCode`.
 */

import { errText } from '../logging/coerce-mask.util';
import { Logger } from '@nestjs/common';

// [FEAT-20260831-QUOTESRC] the ids LINE returns for a card it accepted
import { sentMessageIds } from '@/infra/line';

import { getBankInfoFromSlipCode } from './bank-logo-code.map';
// [FEAT-20260810-PAYSTATEFLEX] the tag map + brace substitution lifted out of
// this file so the payment reply path shares one implementation.
import { buildSlipTagMap, substituteSlipTags } from './flex-slip-tags.util';

import type { WebhookLogEvent } from '../logging';

const logger = new Logger('SlipFlex');

/**
 * legacy uses `dayjs.tz(vData.date, "Asia/Bangkok")` then
 * `now.diff(slipDate, "minute", true)`. This repo has no dayjs (adding one is a
 * dependency change this file must not make), so the equivalent is done with
 * native Date: Swiftcheck's slip date is a `YYYY-MM-DD HH:mm:ss` string in Bangkok
 * WALL TIME, so anchoring it to `+07:00` yields the same instant dayjs.tz would.
 *
 * @returns epoch millis, or NaN when the string is not the expected shape
 *          (legacy's `slipDate.isValid()` is the same guard).
 */
function parseBangkokSlipDateMs(dateStr: string): number {
  const m = dateStr.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) return NaN;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+07:00`;
  return Date.parse(iso);
}

/** legacy:164 — the google-drive fallback logo when a bank code is unknown. */
const DEFAULT_BANK_LOGO_URL = 'https://images.example.com/demo/banner.png';

/* [FIX-20260824-DROPCAMERA] เจ้าของ 24/08: "ตัดปุ่ม camera ถ่ายใหม่ออกไป …
   เหลือแค่ปุ่มเลือกภาพอย่างเดียว" — ยืนยันกับ LINE doc จริงก่อนตัด (ไม่มั่ว):
     · quickReply.items ยอมรับ 1 ถึง 13 รายการ — ไม่มีการระบุ minimum มากกว่า 1
       ที่ไหนเลยใน 3 หน้าที่ตรวจ (using-quick-reply, actions, reference)
       https://developers.line.biz/en/docs/messaging-api/using-quick-reply/
       https://developers.line.biz/en/docs/messaging-api/actions/
     · action `camera` และ `cameraRoll` ต้องการแค่ `type`+`label` เท่านั้น
       (ไม่มี field บังคับอื่นที่ item ที่เหลือจะขาดไป) ⇒ ตัด item หนึ่งออกจาก
       array ที่มีสอง item **ไม่ผิดสเปกของ LINE เลย** ปลอดภัยที่จะแก้

   ⚠️ เดิม legacy:3453-3470 มีสองปุ่ม (เลือกภาพ + ถ่ายรูปใหม่) — ตอนนี้เหลือ
   ปุ่มเดียว (เลือกภาพ) ตามคำสั่งเจ้าของ พฤติกรรมที่เปลี่ยน: ลูกค้าจะไม่เห็น
   ปุ่ม "ถ่ายรูปใหม่" อีกต่อไปตอนสลิปมีปัญหา — ยังพิมพ์/แนบรูปเองได้ตามปกติ
   แค่ไม่มีปุ่มลัดเปิดกล้องให้กด

   revert: ใส่ item ที่สองกลับเข้า items array ตามที่ comment ไว้ด้านล่าง —
   { type: 'action', action: { type: 'camera', label: 'ถ่ายรูปใหม่' } } */
export const SLIP_QUICK_REPLY = {
  items: [
    {
      type: 'action',
      action: { type: 'cameraRoll', label: 'เลือกรูปภาพ' },
    },
    // เอาปุ่มกล้องออก 24/08 — ของเดิม:
    // { type: 'action', action: { type: 'camera', label: 'ถ่ายรูปใหม่' } },
  ],
} as const;

/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

/**
 * legacy:163-175 `getBankLogoUrl`. Legacy reads a `banks.json` keyed by a
 * zero-padded 3-digit `bank_code` and builds `${BASE_URL}/assets${image_path}`,
 * falling back to a fixed google-drive URL for an unknown code.
 *
 * [FIX-20260812-BANKLOGOKEY] The controlled deviation that used to live here
 * (numeric `bank.id` never matched the slug-keyed directory → EVERY real slip
 * fell back to the default image) is now fixed: lookup goes through
 * `getBankInfoFromSlipCode` (bank-logo-code.map.ts), which tries slug/short
 * first and then the numeric code, with legacy-parity aliases 011→ttb /
 * 026→icbc. Unknown / empty / no-asset codes still return the SAME legacy
 * fallback URL — that safety net is owner-mandated (กันพลาด) and must stay.
 */
/* [FEAT-20260810-PAYSTATEFLEX] exported so `flex-slip-tags.util.ts` reuses THIS
 * implementation rather than carrying a second one — the logo URL shape is part of
 * what customers see on a card. */
export function getBankLogoUrl(
  bankCode: unknown,
  baseUrl: string | null | undefined,
): string {
  if (bankCode === null || bankCode === undefined || bankCode === '') {
    return DEFAULT_BANK_LOGO_URL;
  }
  const info = getBankInfoFromSlipCode(bankCode);
  if (!info || !info.logo) return DEFAULT_BANK_LOGO_URL;
  // `info.logo` already includes the served prefix (`/bank-logos/<slug>.png`),
  // so only the base URL is prepended — no BANK_LOGO_BASE, or it would double.
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}${info.logo}`;
}

/**
 * legacy:194-230 `formatSlipDate` — Swiftcheck's `YYYY-MM-DD HH:mm:ss` string to a
 * Thai buddhist-era short date. Transcribed field for field, including the
 * two-digit BE year and the seconds-only-if-present rule.
 */
export function formatSlipDate(dateInput: unknown): string {
  if (!dateInput) return '';

  const monthNames = [
    'มกราคม',
    'กุมภาพันธ์',
    'มีนาคม',
    'เมษายน',
    'พฤษภาคม',
    'มิถุนายน',
    'กรกฎาคม',
    'สิงหาคม',
    'กันยายน',
    'ตุลาคม',
    'พฤศจิกายน',
    'ธันวาคม',
  ];

  if (typeof dateInput === 'string') {
    const parts = dateInput.match(
      /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2}(:\d{2})?)/,
    );
    if (parts) {
      const year = parseInt(parts[1] as string, 10);
      const monthIdx = parseInt(parts[2] as string, 10) - 1;
      const day = parts[3] as string;
      const timePart = parts[4] as string;
      const monthStr = monthNames[monthIdx] || 'มกราคม';
      const yearBE = (year + 543).toString().slice(-2);
      return `${day} ${monthStr} ${yearBE} ${timePart}`;
    }
  }

  const d = new Date(dateInput as string | number | Date);
  const day = d.toLocaleDateString('th-TH', {
    day: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
  const month = d.toLocaleDateString('th-TH', {
    month: 'long',
    timeZone: 'Asia/Bangkok',
  });
  const yearBE = (
    Number(
      d.toLocaleString('en-US', {
        year: 'numeric',
        timeZone: 'Asia/Bangkok',
      }),
    ) + 543
  )
    .toString()
    .slice(-2);
  const hasSeconds =
    dateInput instanceof Date ||
    (typeof dateInput === 'string' && dateInput.split(':').length > 2);
  const timeStr = d.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    ...(hasSeconds && { second: '2-digit' as const }),
    hour12: false,
    timeZone: 'Asia/Bangkok',
  });
  return `${day} ${month} ${yearBE} ${timeStr}`;
}

/** The hook fields this branch reads (legacy `.lean()` object). */
export interface SlipFlexHookLike {
  _id?: unknown;
  channel_type?: string;
  slip_check_out_of_time?: number | null;
  slip_check_min_amount?: number | string | null;
  match_account?: boolean;
  match_account_number?: string;
  flex_success?: string | null;
  flex_duplicate?: string | null;
  flex_min_amount?: string | null;
  flex_out_of_time?: string | null;
  flex_success_not_match?: string | null;
  flex_not_found?: string | null;
  flex_error?: string | null;
  qr_code_fail_anwser_text?: string | null;
}

/** A FlexMessage document as legacy reads it (`.lean()`). */
interface FlexDocLike {
  _id?: unknown;
  name?: string;
  content_json?: unknown;
}

export interface SlipFlexInput {
  /** Swiftcheck's verify body, or the error envelope. Null → branch is a no-op. */
  slipVerifyResult: unknown;
  hook: SlipFlexHookLike | null | undefined;
  /** legacy `slipCreatedAt` — the `check_datetime` tag source. */
  slipCreatedAt: Date | null;
  /** legacy `slipRecordId` — carried into the handoff plan (unported; see deps). */
  slipRecordId: unknown;
  userId: string | undefined;
  /** Public image URL — the ONLY thing the QR/Gemini seam receives. */
  mediaUrl: string | null;
  /** Gemini key override for the QR seam (mask-only in tests). */
  geminiApiKey?: string;
  accessToken: string;
  replyToken: string;
  eventId?: string;
  incomingType?: string;
  /** `req`/`meta` base url for the bank-logo tag. */
  baseUrl?: string | null;
  logContext: Record<string, unknown>;
  /**
   * [FEAT-20260808-PAYTOOL-P3] Do not SEND the success card — the payment tool
   * already answered this slip, and two cards for one slip is confusing.
   *
   * Owner-decided: while the payment tool is ON the customer sees ONLY the
   * payment reply. เปิด payment แล้วลูกค้าเห็นแค่คำตอบของ payment ใบเดียว.
   *
   * ⚠️ SUPPRESSES THE SEND ONLY — everything else in this branch still runs:
   * the card is still selected, `isFlexSent` is still set true, the log rows are
   * still written, and `handleSlipCallback` upstream still fires (it is keyed on
   * `isFlexSent`). That is deliberate: the deposit callback is the money side
   * and must NOT depend on whether a card was displayed.
   *
   * Default false ⇒ every existing caller and every hook without the payment
   * tool behaves byte-identically to before this flag existed.
   */
  suppressSlipReply?: boolean;
  /**
   * [FEAT-20260820-LOCKDUPFIRST] Promote the duplicate check to the front of the
   * priority chain — and ONLY that. Default false.
   *
   * ⚠️ WHO SETS IT: `webhook.service.ts`, from the payment runner's
   * `skipped === 'duplicate_after_success'`. The runner returns that from ONE
   * line (`payment-runner.service.ts:1026`) and only after finding a PRIOR slip
   * with the same `trans_ref` carrying `consumed:true` + `lock_reason:'success'`
   * — i.e. the customer's money already arrived on an earlier send. There is no
   * other way for this flag to become true.
   * ธงนี้เปิดได้ทางเดียว: มีใบก่อนหน้าที่เครดิตเข้าและถูกล็อกแล้ว.
   *
   * ⚠️ WHY IT EXISTS: the account-match check sits above the duplicate check, so
   * a resent slip whose receiver does not match the hook was answered
   * "ชื่อผู้รับไม่ถูกต้อง" — about a slip that had already paid. Seen in prod on
   * 2026-08-20 (12:31:56 credited, 12:33:29 resent). Once the money is in, the
   * only honest answer is "already used".
   *
   * ⚠️ WHAT IT DOES NOT DO: it never INVENTS a duplicate — Swiftcheck's
   * `isDuplicate` still has to be true — and it never changes what any other
   * check decides. With it false the chain is byte-identical to before it
   * existed. เลื่อนลำดับอย่างเดียว · ไม่ได้สร้าง duplicate เอง.
   */
  duplicateFirst?: boolean;
}

export interface SlipFlexResult {
  /** A card was sent — caller `return`s and skips the AI reply. */
  isFlexSent: boolean;
  /** The chosen card, for the `isPaymentFlex` test downstream. */
  flexDoc: FlexDocLike | null;
  /** legacy `slipCondition` after selection. */
  slipCondition: string | null;
  /** legacy `violationDetected`. */
  violationDetected: boolean;
  /** legacy `isQrCodeSlip` — drives `isNormalMedia`/`isSuccessfulQr` upstream. */
  isQrCodeSlip: boolean;
  /** legacy `textReplyOverride` — the QR-fail text when no error card exists. */
  textReplyOverride: string | null;
}

/**
 * The collaborators. Every one is a function so the branch never imports a
 * service — same seam discipline as assist-notification.ts.
 */
export interface SlipFlexDeps {
  /** legacy `FlexMessage.findById(id).lean()`. */
  findFlexById: (id: string) => Promise<FlexDocLike | null>;
  /** legacy `sendLineFlexReply(accessToken, replyToken, contents, alt, qr)`. */
  sendLineFlexReply: (
    accessToken: string,
    replyToken: string,
    flexContents: unknown,
    altText: string,
    quickReply: unknown,
    /* [FEAT-20260828-PUSHCORE-A1] was `Promise<AxiosResponse<unknown>>`. This
       handler never touched axios — it reads `.status` and `.data` and nothing
       else (:739, :746, :899, :905) — so the axios type was describing the
       CALLER's transport, not this file's contract, and it stopped being true
       when the send moved to the push core. Narrowed to what is actually read.
       TYPE-ONLY: no literal below changes, so the emitted JS is identical. */
  ) => Promise<{ status: number; data?: unknown }>;
  /** legacy `persistWebhookLog`. */
  /* [FEAT-20260815-WLOGDOOR] typed to the door's contract. TYPE-ONLY: the
     literals below are untouched and TypeScript erases this at compile time —
     the emitted JS is byte-identical, which is how this change is proved.
     Import is relative because `logging/` is deliberately NOT on the module
     barrel (other modules must not reach the door). */
  persistWebhookLog: (entry: WebhookLogEvent) => Promise<unknown>;
  /** legacy `chatHistoryService.logMessage`. */
  logMessage: (input: Record<string, unknown>) => Promise<unknown>;
  /**
   * legacy `qrVisionService.checkIfSlipWithQrCode(mediaUrl, geminiApiKey)` —
   * the ONE billed call. Kept as a seam so a test passes a canned boolean.
   */
  checkQrCode: (
    mediaUrl: string | null,
    geminiApiKey?: string,
  ) => Promise<boolean>;
  /** legacy `formatThaiDateTime(slipCreatedAt)` — the `check_datetime` value. */
  formatThaiDateTime: (d?: Date | string | number | null) => string;
  /** LINE reply endpoint, for the webhook_logs `endpoint` field. */
  lineReplyEndpoint: string;
}

/** Swiftcheck's success `data` shape, only the paths read here. */
interface SlipVerifyResultLike {
  success?: boolean;
  error?: { code?: string };
  data?: {
    isDuplicate?: boolean;
    matchedAccount?: boolean;
    amountInSlip?: number | string;
    rawSlip?: RawSlip;
    [k: string]: unknown;
  };
}

interface RawSlip {
  date?: string;
  transRef?: string;
  amount?: { amount?: number };
  sender?: SlipParty;
  receiver?: SlipParty;
}

interface SlipParty {
  bank?: { id?: unknown; name?: string };
  account?: {
    name?: { th?: string; en?: string };
    bank?: { account?: string };
  };
}

/**
 * The whole slip flex branch. Legacy runs it inline; this returns the six
 * enclosing variables it leaves behind, and performs every send/log inside.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ [DEBT-20260824-SLIPSPLIT] `max-lines` WARNS ON THIS FILE — ยังไม่แยก และนี่คือเหตุผล
 * ─────────────────────────────────────────────────────────────────────────
 * eslint เตือน `File has too many lines (494). Maximum allowed is 400` — เกือบทั้งหมด
 * มาจากฟังก์ชันนี้ตัวเดียว (~495 บรรทัดโค้ดจริง) **ตัดสินใจแล้วว่ายังไม่แยก** ไม่ใช่ลืม
 *
 * ⚠️ กระทบอะไรบ้าง: **ไม่กระทบอะไรเลยในทางเทคนิค** — severity เป็น `warn` ไม่ใช่ `error`
 * build ผ่าน · CI ไม่บล็อก · runtime ไม่เกี่ยว สิ่งที่กฎนี้ตั้งไว้กันคือ "ไฟล์โตจนไม่มีใคร
 * กล้าแตะ" (คอมเมนต์ที่ `eslint.config.mjs:48-50` เขียนเอง) — ซึ่งไฟล์นี้อยู่ที่ ~498
 * บรรทัดตั้งแต่วันแรกที่สร้าง (10/08) จนถึงวันนี้ 494 **ไม่โตขึ้นเลย** ความเสี่ยงที่กฎกลัว
 * ยังไม่เกิดกับไฟล์นี้
 *
 * ⛔ ทำไมไม่ใส่ waiver list: waiver สงวนไว้สำหรับ "legacy controller ยกมาทั้งไฟล์ รอ split
 * ตอน golden-green" (`eslint.config.mjs:106-118`) — ไฟล์นี้ `check-list.md:3097` ระบุเอง
 * ว่า **NEW** และเป็นแค่สาขาเดียว (legacy:3439-3798) ไม่เข้าเงื่อนไข · การใส่ = สร้างหนี้
 * ในลิสต์ที่กฎบอกเองว่าต้องสั้น
 *
 * ⛔ ทำไมยังไม่แยกไฟล์: วัดแล้ว บล็อกที่แยกได้ (`ส่งการ์ด + webhook log + chat history`,
 * ~130 บรรทัด) อ้างอิงตัวแปรนอกขอบเขต **17 ตัว** — flexDoc · vData · baseUrl ·
 * slipCreatedAt · deps · logger · suppressSlipReply · accessToken · replyToken ·
 * violationDetected · result · logContext · slipCondition · eventId · userId · hook ·
 * incomingType ⇒ แยกออกไปได้ฟังก์ชัน 17 พารามิเตอร์บน **เส้นทางเงิน** ซึ่งเป็นหนี้ก้อน
 * ใหม่ที่อ่านยากกว่าเดิม (ห่อเป็น object เดียวก็แค่ย้ายความยุ่ง ไม่ได้ลด)
 *
 * เทียบ: ตอน `5a25571` แยก `flex-slip-tags.util.ts` สำเร็จเพราะบล็อกนั้นรับแค่ **4 ตัว**
 * และเป็น pure function — บล็อกที่เหลือคือ orchestration (LINE → log → chat) ที่ผูกกับ
 * context ทั้งก้อนโดยธรรมชาติ คนละชนิดกัน
 *
 * ✅ สิ่งที่ทำแทน (ทำแล้ว 24/08): เขียน BEFORE pack
 * `z-test/unit/slip-flex-before-extract.spec.ts` (8 เทส) pin เส้นทางเงินไว้ — โดยเฉพาะ
 * `result.isFlexSent` ตอน `suppressSlipReply` ที่คอมเมนต์ข้างล่างเตือนว่า "เปลี่ยนเป็น
 * false = callback ไม่ยิง = เครดิตหาย" · mutation-verify แล้วว่าจับบั๊กนั้นได้จริง
 * (แดง 1/8 ตรงจุด) **จุดนี้ไม่เคยมีเทสคุมมาก่อนเลย** ⇒ ปลอดภัยขึ้นจริงโดยไม่แตะโค้ด
 *
 * ── ถ้าวันหนึ่งจะแยกจริง ทำแบบนี้ ────────────────────────────────────────
 * 1. BEFORE pack มีแล้ว (ข้างบน) — ห้ามแก้ไฟล์นั้นตอนแยก ถ้าแดงคือการแยกเปลี่ยนพฤติกรรม
 *    ให้ไปแก้โค้ด ไม่ใช่แก้เทสให้ผ่าน
 * 2. ขยาย BEFORE pack ให้ครอบสาขาที่ยังไม่ได้ pin ก่อน (duplicate · violation 5 เงื่อนไข ·
 *    QR/non-QR · not_found · pending) — ตอนนี้ pin แค่ success/suppress/no-card
 * 3. แยก **บล็อก "ส่งการ์ด+log+chat" (ปัจจุบัน ~L618-747)** เป็น `slip-card-send.ts`
 *    รับ object เดียว ไม่ใช่ 17 arg เรียงกัน · คืน `{ isFlexSent }` (เขียนกลับตัวเดียว)
 * 4. ⛔ **อย่าแยกบล็อก error-card (ปัจจุบัน ~L800-887)** — มันเขียนกลับ 4 ตัว
 *    (`flexDoc`, `slipCondition`, `result.isFlexSent`, `result.textReplyOverride`) และ
 *    2 ตัวแรกถูกอ่านต่อในฟังก์ชันแม่ ⇒ แยกแล้วโครงซับซ้อนขึ้น ไม่ได้ลดความยุ่ง
 * 5. AFTER: BEFORE pack ต้องเขียวทุกตัวโดยไม่แก้ + full suite ต้องได้เท่า baseline
 *    (24/08 = 5,018 ผ่าน · แดง 3 ตัวคือ `vacuity-guard` ที่ต้องมี legacy backend เท่านั้น)
 * 6. mutation-verify ตัวใหม่ด้วย — แยกแล้วต้องยังจับ `isFlexSent` เพี้ยนได้อยู่
 *
 * บันทึกเต็ม: `todo/be_todo54_24082026.md`
 */
export async function handleSlipFlex(
  input: SlipFlexInput,
  deps: SlipFlexDeps,
): Promise<SlipFlexResult> {
  const {
    slipVerifyResult,
    hook,
    slipCreatedAt,
    // `slipRecordId` is accepted for the handoff plan (legacy:3612), which is
    // UNPORTED in this repo — see the send comments and check-list.md. It is not
    // read here yet; kept on the interface so the wire needs no signature change.
    userId,
    mediaUrl,
    geminiApiKey,
    accessToken,
    replyToken,
    eventId,
    incomingType,
    baseUrl,
    logContext,
    // [FEAT-20260808-PAYTOOL-P3] see the field doc: suppresses the SUCCESS-path
    // send only. Defaults false ⇒ legacy behaviour for every existing caller.
    suppressSlipReply = false,
    // [FEAT-20260820-LOCKDUPFIRST] see the field doc. Defaults false ⇒ the
    // priority chain below is unchanged for every caller that does not set it.
    duplicateFirst = false,
  } = input;

  // legacy:3449-3476 — the enclosing variables, in legacy's initial state.
  const result: SlipFlexResult = {
    isFlexSent: false,
    flexDoc: null,
    slipCondition: null,
    violationDetected: false,
    isQrCodeSlip: false,
    textReplyOverride: null,
  };

  // legacy:3478 — the whole branch is a no-op unless Swiftcheck produced a result.
  if (!slipVerifyResult) return result;

  const svr = slipVerifyResult as SlipVerifyResultLike;
  const isValidationError =
    svr.success === false && svr.error?.code === 'VALIDATION_ERROR';
  const isSlipNotFound =
    svr.success === false && svr.error?.code === 'SLIP_NOT_FOUND';
  /* ==== [FEAT-20260816-SLIPPENDINGCARD] SLIP_PENDING joins the card routes ====
   *
   * Swiftcheck returns `SLIP_PENDING` when the sending bank has not settled the
   * transfer yet ("please wait a few minutes and try again"). Until this change
   * the code fell into the catch-all "any other error code" branch further down,
   * which sends nothing at all: the image then continued as ordinary media, so
   * the customer was answered with `image_answer_text` and a case was opened for
   * an operator — for a condition that clears itself in minutes.
   *
   * The condition is updated so a pending slip answers with the card an OA
   * already configures for a failed verification (`hook.flex_error`, shown in the
   * dashboard as "Flex Error (on Damaged / Fake Slip)" under the slip-verify tab).
   * Observed on live traffic 2026-08-16 11:05:54 UTC, hook `demo-shop`.
   *
   * KNOCK-ON, stated so it is not a surprise: marking the image as a slip means
   * `webhook.service.ts:2679-2684` computes `isNormalMedia=false` and
   * `isSuccessfulQr=false` (the verification did not succeed), so the image-path
   * `[[[assist]]]` hand-off no longer fires for a pending slip. That follows the
   * rule already written there — a slip that did not verify does not page an
   * operator — and is the second half of the point: the customer is told to wait
   * instead of a case being opened for something that clears itself.
   *
   * ⚠️ Only the ROUTE changed. `flex_not_found` still owns 404, VALIDATION_ERROR
   * still falls through to normal media, and every other code still sends
   * nothing — all four pinned in `slip-error-card-routing.spec.ts`.
   * revert: delete this flag and the two `isSlipPending` references below. */
  const isSlipPending =
    svr.success === false && svr.error?.code === 'SLIP_PENDING';

  let flexDoc: FlexDocLike | null = null;
  let slipCondition: string | null = null;
  let violationDetected = false;

  try {
    if (svr.success && svr.data) {
      // ── SUCCESS PATH: pick a payment card (legacy:3483-3649) ────────────────
      result.isQrCodeSlip = true;
      const resultData = svr.data;
      const vData = resultData?.rawSlip || (resultData as unknown as RawSlip);
      const isDuplicate = resultData?.isDuplicate === true;
      const slipAmount = Number(
        resultData?.amountInSlip || vData?.amount?.amount || 0,
      );
      const minLimit =
        hook?.slip_check_min_amount !== null &&
        hook?.slip_check_min_amount !== undefined
          ? Number(hook.slip_check_min_amount)
          : null;

      /* ── THE PRIORITY CHAIN — read this before changing anything below ──
         legacy:3496-3548. The FIRST check to fire wins; every later one is
         gated on `!violationDetected`, so order IS the behaviour.

         NORMAL ORDER (what every caller gets, unchanged since legacy):
           1. out_of_time        slip older than `slip_check_out_of_time`
           2. min_amount         amount below `slip_check_min_amount`
           3. success_not_match  `match_account` on and the receiver differs
           4. duplicate          Swiftcheck says it has seen this trans_ref
           5. success            nothing above fired

         [FEAT-20260820-LOCKDUPFIRST] LOCKED ORDER — one case, and only one:
         the slip was ALREADY PAID on an earlier send and locked
         (`consumed:true` + `lock_reason:'success'`), and the customer sent the
         same one again. Then, and only then, duplicate is checked FIRST:
           1. duplicate       ⭐ promoted
           2. out_of_time
           3. min_amount
           4. success_not_match
           5. success

         WHY THE TWO ORDERS DIFFER — the reason, not the rule:
           A slip that has already paid cannot usefully be told anything about
           its recipient or its age. In prod on 2026-08-20 one was answered
           "ชื่อผู้รับไม่ถูกต้อง" 93 seconds after its money had arrived, because
           check 3 fired before check 4 could. Once the money is in, "already
           used" is the only answer that is true.

         WHICH ORDER RUNS is decided ENTIRELY by `duplicateFirst`, which comes
         from the payment runner and nowhere else — see the field's doc. Nothing
         here reads the database, and no other check is reordered, added or
         skipped in either mode.
         สองลำดับเท่านั้น · สลับได้เฉพาะตอนสลิปจ่ายไปแล้วและถูกล็อก · ที่เหลือเหมือนเดิมทุกบรรทัด. */
      /* ==== [NOTE-20260902-DUPFIRSTPROVIDER] `&& isDuplicate` is the provider-
       * dependent half of this condition, and a second slip provider makes it a
       * liability. Written down BEFORE the change, not applied. ยังไม่แก้ — บันทึกไว้ก่อน.
       *
       * THE TWO INPUTS ARE NOT THE SAME KIND OF FACT:
       *   `duplicateFirst` — OUR lock. A prior slip_verifications row with this
       *     `trans_ref` carries consumed:true + lock_reason:'success', i.e. our
       *     system really credited this money (payment-runner `_dupAfterSuccess`).
       *     Provider-independent.
       *   `isDuplicate`    — the PROVIDER's memory, bounded by that vendor's own
       *     retention, and empty for a provider that has never seen the slip.
       *
       * WHAT BREAKS WITH A SECOND PROVIDER: after switching, the new vendor has
       * never seen any older slip, so `isDuplicate` is false for all of them, this
       * branch does not fire, and a resend of an already-credited slip falls
       * through to `flex_success` — the customer is told the slip is fine when it
       * was NOT credited again. Money is still safe (the runner already stepped
       * aside); only the card is wrong. It is also reachable today whenever the
       * vendor's duplicate window expires but our lock, which never expires, has not.
       *
       * THE FIX WHEN IT IS TAKEN: drop `&& isDuplicate`. `duplicateFirst` alone is
       * the stronger fact and does not depend on any vendor.
       *
       * ⚠️ IT IS NOT A NO-OP, so do not slip it in as a refactor. It also changes
       * the edge where our lock matches but the provider stopped flagging: today
       * some other card answers, afterwards `flex_duplicate` does. That is more
       * correct, but it is a behaviour change and must be named as one.
       *
       * MEASURED 2026-09-02 — everything the card choice touches, and its impact:
       *   · ticket category — NONE. `isPaymentFlexCard` (end of this file) lists BOTH
       *     flex_success and flex_duplicate, so the flag is identical either way.
       *   · `direct_ticket_on_reply` — NONE. Not read on this path at all; only
       *     payment-state-flex.resolver reads it (Set B cards).
       *   · money — NONE. `_dupAfterSuccess` already returned before any leg ran.
       *   · partner callback — WOULD change `result`/`condition` (this card is
       *     tagged "duplicate", flex_success is tagged "success"), and with
       *     `callback_action:'success'` the callback would stop firing for this
       *     slip. On the checked database this is inert: 11 hooks, ALL
       *     `callback_action:'all'`, ZERO with a `callback_slip` URL, ZERO slip
       *     rows with a `callback_response` — so `handleSlipCallback` exits at the
       *     empty-URL gate before the tag is ever read.
       *   · chat log line — cosmetic; `[Flex] <name>` records the other card's name.
       *
       * ✅ [DECISION-20260903-DUPFIRSTOK] THE QUERY WAS RUN. Owner confirmed the
       * two settings are turned on together in practice, and the measurement on
       * `local_db_10_aug_26` (03/09) agrees:
       *     hooks where callback_slip is non-empty AND callback_action == 'success'
       *       -> 0 rows
       *     callback_action: 'all' x28, and 'all' is the ONLY value present
       *     callback_slip: `[]` on all 28 — it is an ARRAY, so a check written as
       *       `$nin: ['', null]` reports every row as "non-empty" and is wrong.
       *       Match on length, or this reads backwards.
       * ⇒ **DECISION 1 is impact-free on the measured data and can be taken.**
       *
       * ⚠️ WHAT GUARANTEES IT IS A HUMAN RULE, NOT CODE. Nothing pairs the two
       * settings: `hooks.service.ts` normalises `callback_action` and validates
       * `callback_slip` separately, and neither reads the other. So the pairing
       * holds because the people configuring OAs keep it that way, and it can
       * drift the moment somebody sets `callback_action:'success'` on a hook that
       * has a callback URL — no deploy required. Re-run the query above before
       * relying on this on any database that is not the one measured here.
       * กฎนี้คนคุม ไม่ใช่โค้ดคุม ⇒ ฐานอื่นต้องยิง query ซ้ำก่อนเชื่อ
       *
       * 📄 REF: `docs/slip-spec.md` §8.4 and the 03/09 decisions section. */
      if (duplicateFirst && isDuplicate && hook?.flex_duplicate) {
        violationDetected = true;
        slipCondition = `Duplicate slip detected (already paid, slip locked). transRef: ${vData?.transRef || 'n/a'}`;
        flexDoc = await deps.findFlexById(String(hook.flex_duplicate));
      }

      /* ==== [FIX-20260902-LOCKDUPOVERWRITE] the ONE check that forgot its gate ===
       *
       * THE DEFECT. This block had no `!violationDetected`, while every later
       * one has it (`:636` min_amount, `:645` success_not_match). So when
       * `duplicateFirst` had already picked the duplicate card two lines above,
       * this ran anyway and OVERWROTE it — the LOCKED order documented in the
       * header ("1 duplicate ⭐ · 2 out_of_time") did not hold whenever the slip
       * was ALSO out of time.
       *
       * WHAT IT COST. `[FEAT-20260820-LOCKDUPFIRST]` exists for exactly one
       * situation: a slip whose money ALREADY arrived, resent by the customer.
       * The honest answer is "already used". With an old slip they were told
       * "slip expired" instead — the wrong sentence about money, from the very
       * feature written to get that sentence right.
       *
       * WHY NOBODY SAW IT. `slip-flex-lock-duplicate-first.spec.ts` pits
       * `duplicateFirst` against the ACCOUNT-MATCH card, and that block already
       * had the gate. Its fixture sets `slip_check_out_of_time: null` and its
       * `rawSlip` carries no `date`, so this competitor could not fire at all.
       * Found on 02/09 by `z-test/manual/prove-slip-cards.js`, which feeds the
       * SAME slip to both orders and requires different winners.
       *
       * ⚠️ THE NORMAL ORDER IS UNCHANGED, and that is why this is safe: there,
       *    this is the FIRST check, and the only thing that can set the flag
       *    before it is the `duplicateFirst` block — which runs only when the
       *    flag is on. With `duplicateFirst: false`, `violationDetected` is
       *    always false here. ⇒ เส้นปกติไม่ขยับสักบรรทัด
       *
       * revert: drop `!violationDetected &&`. The duplicate card is overwritten
       * by out_of_time again whenever both apply. */
      if (
        !violationDetected &&
        hook?.slip_check_out_of_time !== null &&
        hook?.slip_check_out_of_time !== undefined &&
        vData?.date
      ) {
        const slipMs = parseBangkokSlipDateMs(String(vData.date));
        if (!Number.isNaN(slipMs)) {
          // legacy `now.diff(slipDate, "minute", true)` — signed float minutes.
          const diffMinutes = (Date.now() - slipMs) / 60000;
          if (diffMinutes > hook.slip_check_out_of_time) {
            violationDetected = true;
            slipCondition = `Slip date (${vData.date}) is older than ${hook.slip_check_out_of_time} minutes (diff: ${diffMinutes.toFixed(2)}m)`;
            if (hook.flex_out_of_time) {
              flexDoc = await deps.findFlexById(String(hook.flex_out_of_time));
            }
          }
        } else {
          logger.error(
            `[SLIP-TIME-DEBUG] Invalid date format received: ${vData.date}`,
          );
        }
      }

      /* ==== [NOTE-20260902-VIOLATIONCONSUMESCHAIN] a threshold without a card
       * SILENCES THE REPLY — this block and the three around it.
       *
       * `violationDetected = true` is set BEFORE the card id is tested. So when an
       * operator sets a threshold but leaves the matching card unbound:
       *   · the violation is recorded and `slipCondition` is filled
       *   · `flexDoc` stays null, so nothing is sent
       *   · the success block below is blocked by `!violationDetected`
       *   ⇒ THE CUSTOMER GETS NO CARD AT ALL, and falls through to
       *     `image_answer_text` upstream — which says nothing about the slip.
       * Same shape at out_of_time, success_not_match and the normal-order
       * duplicate. Setting a rule and forgetting its card is a silent mute.
       *
       * ⚠️ THE PROMOTED-DUPLICATE BLOCK IS THE ODD ONE OUT and is the correct
       * shape: it puts `hook?.flex_duplicate` INSIDE its own condition, so an
       * unbound card means the block never fires and the chain continues in
       * normal order (pinned by `slip-flex-lock-duplicate-first.spec.ts`).
       *
       * NOT CHANGED HERE. Making these four match it would alter which card a
       * customer receives whenever a threshold is set without its card — a real
       * behaviour change on the reply path, and one an operator may have come to
       * rely on. It needs a decision, not a tidy-up.
       *
       * ⚠️ ZERO MEANS OPPOSITE THINGS ACROSS THESE THRESHOLDS.
       * `slip_check_min_amount: 0` is inert — `slipAmount < 0` is false for any
       * real amount. `slip_check_out_of_time: 0` is near-total — any slip dated
       * even a second ago exceeds it. Neither is reachable through the hooks API
       * (the write helper maps `0` to `null`), but a script or a direct write can
       * set them. `slip_check_max_amount` and `flex_max_amount` are writable and
       * read by NOTHING — the same dead-control class as `flex_other`. */
      if (!violationDetected && minLimit !== null && slipAmount < minLimit) {
        violationDetected = true;
        slipCondition = `Amount (${slipAmount}) is less than minimum (${minLimit})`;
        if (hook?.flex_min_amount) {
          flexDoc = await deps.findFlexById(String(hook.flex_min_amount));
        }
      }

      /* ✅ [DECISION-20260903-FOLD1014] THE RECEIVER GATE STAYS EXACTLY AS IT IS.
       * Owner call, 03/09: a provider adapter must hand this gate the shape it
       * already reads. It is not a product question and nothing here changes.
       *
       * The gate is complete today and the card exists: Swiftcheck answers
       * `matchedAccount`, `hook.match_account` is the per-OA switch, and a
       * mismatch routes to `hook.flex_success_not_match` below. Working feature,
       * one vendor, no gap.
       *
       * The only difference is ENVELOPE SHAPE, not information:
       *   Swiftcheck            success envelope + `matchedAccount: false`
       *   SlipGuard (log:true)  HTTP 400 + `code: 1014` — an ERROR envelope
       *
       * ⇒ THE ADAPTER FOLDS `1014` BACK INTO THE SUCCESS SHAPE with
       * `matchedAccount: false`, and this `if` then behaves byte-identically to
       * today. Do NOT add a `1014` branch here, and do NOT teach this gate about
       * provider codes — one vendor's vocabulary must not leak into the flow.
       * ⚠️ Fold it and the wrong-receiver slip lands on `flex_success_not_match`
       * as it should. Leave it as an error and it matches none of the recognised
       * checks and falls into the catch-all, which answers the customer nothing.
       * แปลงที่ adapter ไม่ใช่ที่นี่ · เกตนี้กับการ์ดมีครบแล้ว ไม่ต้องแตะ
       *
       * 📄 REF: `docs/slip-spec.md` §2 of the 03/09 decisions. */
      if (
        !violationDetected &&
        hook?.match_account &&
        !resultData?.matchedAccount
      ) {
        violationDetected = true;
        /* [NOTE-20260902-MATCHNUMBERISDISPLAYONLY] `match_account_number` is read
         * HERE AND NOWHERE ELSE, and only to fill this log string. We never
         * compare accounts ourselves — `resultData.matchedAccount` above is the
         * provider's verdict, made against the account registered in the
         * provider's own dashboard, not against the number typed into our form.
         * An operator reasonably assumes otherwise, so do not "wire it up" as a
         * tidy-up: making it decide would turn a decorative field into a money
         * gate, and on the live data 8 of 10 slip-enabled hooks leave it empty
         * while two hold "12345". It would need validation and a backfill
         * conversation first. SlipGuard v1.13 documents the comparison recipe if
         * that day comes (masked-account normalisation) — docs/slip-spec.md §6.3. */
        slipCondition = `Account Not Match. Required: ${hook?.match_account_number || 'n/a'}`;
        if (hook?.flex_success_not_match) {
          flexDoc = await deps.findFlexById(
            String(hook.flex_success_not_match),
          );
        }
      }

      /* Position 4 in the NORMAL order. When `duplicateFirst` promoted this
         check above, `violationDetected` is already true and this is a no-op —
         the card is not looked up twice. ถูกเลื่อนขึ้นไปแล้วก็ไม่ทำซ้ำ. */
      if (!violationDetected && isDuplicate) {
        violationDetected = true;
        slipCondition = `Duplicate slip detected. transRef: ${vData?.transRef || 'n/a'}`;
        if (hook?.flex_duplicate) {
          flexDoc = await deps.findFlexById(String(hook.flex_duplicate));
        }
      }

      // Success ONLY when nothing violated AND no card already chosen
      // (legacy:3551-3554).
      if (!violationDetected && !flexDoc && hook?.flex_success) {
        flexDoc = await deps.findFlexById(String(hook.flex_success));
        slipCondition = 'Verified successfully';
      }

      if (flexDoc && flexDoc.content_json && vData) {
        /* legacy:3556-3596 — the tag map + brace substitution.
         * [FEAT-20260810-PAYSTATEFLEX] MOVED to `flex-slip-tags.util.ts` so the
         * payment reply path can substitute the SAME tags into a card bound to a
         * reply state, instead of a second copy of this block drifting from it.
         * The util is a verbatim lift; `z-test/unit/flex-slip-tags.spec.ts` pins
         * the output (15 cases) and was written before the move. */
        const tagCtx = {
          vData,
          baseUrl,
          slipCreatedAt,
          formatThaiDateTime: deps.formatThaiDateTime,
        };
        /* `tags` is still built here because the chat-history row below logs the
         * resolved map as `slip_verify_result` — dropping it would quietly empty a
         * field admins read when auditing what a card actually showed. */
        const tags = buildSlipTagMap(tagCtx);
        const { contents: flexContents, leftover } = substituteSlipTags(
          flexDoc.content_json,
          tagCtx,
          { report: true },
        ) as { contents: unknown; leftover: string[] };

        if (leftover.length) {
          logger.warn(
            `[SLIP-DEBUG] Warning: Some braced tags remain: ${JSON.stringify(
              leftover,
            )}`,
          );
        }

        // [FIX-20260808-SLIPFLOW] legacy:3609-3616 the handoff plan is UNPORTED
        // in this repo (`handoffService.planDispatch` / the slip-dispatch API
        // does not exist here). Legacy's flag-off path yields
        // `suppressSlipReply === false`, so the send below is legacy's default,
        // byte-identical to a hook with handoff off. See check-list.md.
        //
        // [FEAT-20260808-PAYTOOL-P3] `suppressSlipReply` is now REACHABLE: the
        // payment tool answers this slip itself, so sending this card too would
        // show the customer two cards for one slip. Only the SEND is skipped —
        // see below for why everything after it still runs.
        const lineResponse = suppressSlipReply
          ? null
          : await deps.sendLineFlexReply(
              accessToken,
              replyToken,
              flexContents,
              'รายละเอียดการโอนเงิน',
              violationDetected ? SLIP_QUICK_REPLY : null,
            );

        // ⚠️ SET EVEN WHEN SUPPRESSED — LOAD-BEARING, DO NOT "FIX".
        // `isFlexSent` is what the caller keys `handleSlipCallback` on, i.e. the
        // DEPOSIT CALLBACK. That is the money side and must not depend on
        // whether a card was displayed. It also means "the slip branch handled
        // this event", which is still true: the card was chosen, the customer
        // was answered — by payment instead of by this card.
        // ถ้าเปลี่ยนเป็น false ตอน suppress = callback ไม่ยิง = เครดิตหาย.
        result.isFlexSent = true;

        // legacy:3619-3635 — the slip_flex_reply webhook_logs row. Written on
        // BOTH paths so the audit trail still records which card was selected
        // and why; `status` distinguishes the two. A suppressed row carries no
        // http_status because no request was made.
        await deps.persistWebhookLog({
          ...logContext,
          channel: 'line_api',
          action_type: 'slip_flex_reply',
          method: 'POST',
          endpoint: deps.lineReplyEndpoint,
          status: lineResponse ? 'success' : 'suppressed',
          ...(lineResponse ? { http_status: lineResponse.status } : {}),
          payload_summary: {
            reply_token: replyToken,
            flex_doc_id: flexDoc?._id,
            condition: slipCondition || 'success_or_violation',
            ...(lineResponse ? {} : { suppressed_by: 'payment_tool_replied' }),
          },
          ...(lineResponse ? { response_summary: lineResponse.data } : {}),
          line_event_id: eventId,
        });

        /* legacy:3637-3648 — the bot flex row in chat history. Fire-and-forget.
         *
         * ==== [FIX-20260810-SUPPRESSHISTORY] not written when suppressed ====
         * CHAT HISTORY MUST RECORD WHAT THE CUSTOMER ACTUALLY RECEIVED. When the
         * payment tool answered this slip, THIS CARD WAS NEVER SENT (see `:517`) —
         * so writing `[Flex] สลิปถูกต้อง` here put a success card into the
         * transcript of a customer who had just been told the transfer FAILED
         * (shop-api `slip_status:"fail"`, e.g. "บัญชีผู้รับไม่ตรงบัญชีระบบ"). An admin
         * reviewing the case then reads "สลิปถูกต้อง" and concludes the top-up went
         * through. Reported by the owner 2026-08-10; see `todo/be_todo21_10082026.md`.
         *
         * WHY THIS GUARD AND NOT THE OTHER TWO NEIGHBOURS: the send (`:517`) and the
         * webhook_logs row (`:537`) already handle `suppressSlipReply` — the log row
         * deliberately still writes, with `status:'suppressed'`, because it is an
         * AUDIT of which card the branch selected. Chat history is a different thing:
         * it is the record of the conversation, so an unsent card does not belong in
         * it. `result.isFlexSent` (`:531`) stays `true` regardless — it keys the
         * deposit callback and flipping it would lose credit.
         * เก็บให้เหมือนที่ลูกค้าได้รับ — การ์ดที่ไม่ได้ส่ง ไม่ต้องบันทึก.
         *
         * revert: drop the `if (!suppressSlipReply)` wrapper.
         */
        if (!suppressSlipReply) {
          void deps
            .logMessage({
              userId,
              senderType: 'bot',
              messageType: 'flex',
              content: `[Flex] ${flexDoc.name}`,
              hookId: hook?._id,
              channelType: hook?.channel_type,
              replyToken,
              /* [FEAT-20260831-QUOTESRC] the card's own id in LINE's id-space, so a
                 customer quoting this card resolves to it later. `lineResponse` is
                 null when the reply was suppressed — then this adds no keys and the
                 row is written exactly as before. */
              ...sentMessageIds(lineResponse),
              metadata: {
                event_id: eventId,
                auto_reply_type: 'slip_flex_reply',
                incoming_type: incomingType,
                flex_json: flexContents,
                flex_doc_id: flexDoc?._id,
                slip_verify_result: tags,
              },
            })
            .catch((err: unknown) =>
              logger.error(
                `[SLIP] Failed to log Flex reply to history: ${errText(err)}`,
              ),
            );
        }
      }
    } else if (isValidationError || isSlipNotFound || isSlipPending) {
      // ── QR PATH: 404, "no QR seen", or a slip the bank has not settled yet ──
      // (legacy:3650-3727 — [FEAT-20260816-SLIPPENDINGCARD] added the third code)
      logger.log(
        `[SLIP VERIFY] ${String(
          svr.error?.code || 'UNKNOWN',
        )} encountered. Checking if it's a QR slip...`,
      );

      // legacy:3656-3661 — the ONLY billed seam, and the 404 short-circuit that
      // avoids it. 404 ⇒ true without a vision call.
      let isQrCodeSlip = false;
      /* [FEAT-20260816-SLIPPENDINGCARD] `SLIP_PENDING` joins the 404 short-circuit:
       * both mean Swiftcheck READ a slip, so the image is a slip and no vision call
       * is needed to decide it. */
      if (isSlipNotFound || isSlipPending) {
        isQrCodeSlip = true;
      } else {
        /* ==== [OFF-20260812-QRVISION] the vision call is switched off ====
         *
         * WHY: Swiftcheck has already answered this exact question. The two error
         * codes mean different things, and the code above relies on that:
         *   · SLIP_NOT_FOUND — Swiftcheck SAW a QR it could not verify ⇒ a slip
         *   · VALIDATION_ERROR — Swiftcheck saw NO QR at all
         * Only VALIDATION_ERROR reaches this branch, so asking Gemini "is there a
         * QR?" was paying to re-ask something already answered. Confirmed on a real
         * message 2026-08-12: Swiftcheck returned
         *   {"code":"VALIDATION_ERROR","message":"Please provide either a payload…"}
         * and Gemini replied "NO" — the same verdict, one API call later.
         *
         * WHAT IT COSTS US: an image Swiftcheck could not read but a human eye would
         * recognise as a slip (blurry, dark, photographed off a screen) is now
         * treated as an ordinary picture. That customer gets `image_answer_text`
         * instead of the `flex_error` card telling them to re-send, so they are not
         * told their slip failed. That is the whole trade — everything else is
         * unchanged: SLIP_NOT_FOUND still yields a slip, success still yields a card.
         *
         * ⚠️ NOT DELETED ON PURPOSE. `QrVisionService` and the `checkQrCode` seam
         *    both stay wired; only this one call is commented out, so turning the
         *    behaviour back on is a one-line edit and nothing else has to be rebuilt.
         *
         * revert: delete the `false` line below and uncomment the original call. */
        // isQrCodeSlip = await deps.checkQrCode(mediaUrl, geminiApiKey);
        isQrCodeSlip = false;
        /* Keeps `mediaUrl` / `geminiApiKey` "read" so the destructuring above does
           not have to change while the call is off — reverting stays a one-line
           edit. `void` evaluates and discards: no call, no cost, no behaviour. */
        void mediaUrl;
        void geminiApiKey;
      }
      result.isQrCodeSlip = isQrCodeSlip;

      if (isQrCodeSlip) {
        // legacy:3665-3671 — 404 → flex_not_found; otherwise flex_error.
        if (isSlipNotFound && hook?.flex_not_found) {
          flexDoc = await deps.findFlexById(String(hook.flex_not_found));
          slipCondition = 'Slip not found in bank system (404/Damaged)';
        } else if (hook?.flex_error) {
          flexDoc = await deps.findFlexById(String(hook.flex_error));
          /* [FEAT-20260816-SLIPPENDINGCARD] the same card, but the recorded
           * reason stays factual: a pending slip is not a damaged one, and this
           * string is what the callback and the audit row carry. */
          slipCondition = isSlipPending
            ? 'Slip pending at the bank (SLIP_PENDING) — not yet settled'
            : 'Slip verification failed (Invalid format/Damaged)';
        }

        if (flexDoc && flexDoc.content_json) {
          // legacy:3675-3680 — no vData, so only the check_datetime tag.
          let flexString = JSON.stringify(flexDoc.content_json);
          const checkTime = deps.formatThaiDateTime(slipCreatedAt);
          flexString = flexString.replace(
            /\{\{\s*check_datetime\s*\}\}/gi,
            checkTime,
          );
          flexString = flexString.replace(
            /\{\{\s*current_datetime\s*\}\}/gi,
            checkTime,
          );

          const flexContents = JSON.parse(flexString) as unknown;

          // [FIX-20260808-SLIPFLOW] legacy:3681-3688 handoff plan UNPORTED here;
          // flag-off ⇒ suppress false ⇒ identical send. See check-list.md.
          const lineResponse = await deps.sendLineFlexReply(
            accessToken,
            replyToken,
            flexContents,
            'แจ้งเตือนสลิปมีปัญหา',
            SLIP_QUICK_REPLY,
          );
          result.isFlexSent = true;

          // legacy:3692-3708 — the slip_error_flex_reply webhook_logs row.
          await deps.persistWebhookLog({
            ...logContext,
            channel: 'line_api',
            action_type: 'slip_error_flex_reply',
            method: 'POST',
            endpoint: deps.lineReplyEndpoint,
            status: 'success',
            http_status: lineResponse.status,
            payload_summary: {
              reply_token: replyToken,
              flex_doc_id: flexDoc?._id,
              condition: slipCondition,
            },
            response_summary: lineResponse.data,
            line_event_id: eventId,
          });

          void deps
            .logMessage({
              userId,
              senderType: 'bot',
              messageType: 'flex',
              content: `[Flex-Error] ${flexDoc.name}`,
              hookId: hook?._id,
              channelType: hook?.channel_type,
              replyToken,
              // [FEAT-20260831-QUOTESRC] same as the success card above
              ...sentMessageIds(lineResponse),
              metadata: {
                event_id: eventId,
                auto_reply_type: 'slip_error_flex',
                incoming_type: incomingType,
                flex_json: flexContents,
                flex_doc_id: flexDoc?._id,
              },
            })
            .catch((err: unknown) =>
              logger.error(
                `[SLIP] Failed to log Error Flex reply: ${errText(err)}`,
              ),
            );
        } else {
          // legacy:3723 — no error card configured → override the text reply.
          result.textReplyOverride =
            hook?.qr_code_fail_anwser_text ||
            'ไม่สามารถตรวจสอบข้อมูล QR Code ได้ กรุณาลองใหม่อีกครั้ง';
        }
      } else {
        // legacy:3726 — not a QR slip → fall through to normal media handling.
        logger.log(
          '[SLIP VERIFY] Identified as NOT a QR Code Slip. Proceeding to normal media processing.',
        );
      }
    } else if (!svr.success) {
      // legacy:3728-3729 — any other error code: nothing sent, logged only.
      /* ==== [NOTE-20260902-UNMAPPEDCODESILENCE] what this line really costs ====
       *
       * This is the CATCH-ALL, and it is the whole handling for any verify error
       * code that is not one of the three named above. It logs, and returns
       * `isFlexSent:false`, `flexDoc:null`, `slipCondition:null`,
       * `isQrCodeSlip:false`, `textReplyOverride:null`. Nothing is sent from here.
       *
       * That is legacy's behaviour and is NOT being changed. It is written down
       * because a second slip provider makes this branch load-bearing, and what
       * the customer actually experiences is not obvious from this line:
       *
       *   · assist-mode room — `webhook.service.ts` sees `isFlexSent:false` and
       *     returns. THE CUSTOMER IS ANSWERED NOTHING.
       *   · hook with an empty `image_answer_text` — the reply is sent as '',
       *     LINE 400s, the catch logs it. AGAIN NOTHING.
       *   · unregistered customer — the missing-profile guard fires first, so the
       *     customer is told their PROFILE was not found, about a slip.
       *   · registered customer — gets `image_answer_text`, a generic photo reply
       *     that says nothing about the slip, and WITHOUT the "send the photo
       *     again" quick reply, because that needs `isQrCodeSlip`.
       *
       * In no case is the deposit callback fired, and in no case is the customer
       * told the slip failed.
       *
       * ⚠️ WHY IT MATTERS NOW. The three recognised codes are one vendor's
       * vocabulary. SlipGuard answers with numeric codes, and EIGHT of its sixteen
       * have no equivalent here at all — 1000/1001/1002/1003/1004/1013/1015 and
       * 1009. Several of those are not customer verdicts: they are our own
       * misconfiguration, an expired package, or an over-quota account. Mapped
       * naively they land HERE and vanish, so an OA whose key expired would fail
       * every slip in silence.
       *
       * 🔴 [RULE-20260903-SWAPPABLE] READ THIS BEFORE IMPLEMENTING ANY DECISION
       * BELOW. Owner's standing requirement, 03/09, and it applies to EVERY choice
       * agreed today — the error-code routes, the `1014` fold, the Shop-API params and
       * the duplicate-first change alike. Every one of them is a CHOICE, and every
       * one of them WILL be revised. Build them so revising is a one-line edit.
       *
       *   1. ONE PLACE PER FACT. A code's destination is written once. If changing
       *      where `1013` goes means editing two files, the shape is wrong.
       *   2. INDEPENDENT ROWS. Changing `1009` must not move `1010`; changing a
       *      param name must not touch the path. No shared fallback that couples
       *      two decisions, no if-chain where the order of branches is the rule.
       *   3. DATA, NOT CONTROL FLOW. A mapping is a table `code -> verdict`, not a
       *      cascade of `if`s. New codes are rows; nobody edits logic to add one.
       *   4. DEFAULTS ARE TODAY'S BEHAVIOUR. Every knob's default is the literal
       *      that is hardcoded right now, so an untouched deployment is
       *      byte-identical and only a deliberate edit changes anything.
       *      (See [RULE-20260903-STGSTAYSSWIFTCHECK] in `slip/slip-flow.service.ts`.)
       *   5. NO NEW ABSTRACTION TO GET THERE. Each of these already has a
       *      precedent in this repo — `walletpay_file_field` for a config'd wire name,
       *      the provider registry for a name->implementation table. Copy the
       *      shape; do not introduce a framework for it.
       *   6. REVERSIBLE ALONE. Each decision can be undone on its own without
       *      dragging the others back, and the comment says how.
       *
       * ทุกข้อที่ตกลงกันวันนี้ต้องแก้ง่าย เป็นอิสระต่อกัน ยืดหยุ่น · ค่า default = ของเดิม
       * ⇒ ไม่ตั้งอะไร = พฤติกรรมเดิมเป๊ะ · แก้ข้อหนึ่งต้องไม่กระเทือนข้ออื่น
       *
       * ✅ [DECISION-20260903-SLIPGUARD-ERRCARD] TWO CODES ARE DECIDED. Owner call,
       * 03/09. Both `1010` and `1009` route to **`hook.flex_error`** — the same
       * card `SLIP_PENDING` already takes (`slip-error-card-routing.spec.ts`
       * pins that route).
       *
       *   1010 "slip is too fresh, wait N minutes"
       *   1009 "bank temporarily down" (transient, no quota charged)
       *
       * WHY THE ERROR CARD IS THE RIGHT HOME, and it answers the objection this
       * comment used to raise: the card is per-OA CONTENT, not a fixed verdict
       * label. The OA writes the sentence the customer actually reads — "BBL is
       * still settling, please try again in a few minutes" — so the wait/retry
       * wording lives where it can be worded, which is exactly what no code-level
       * verdict name can carry. The dashboard's own label for the slot is
       * generic; the customer never sees it.
       *
       * WHAT THE ROUTE BRINGS WITH IT — measured 03/09, not assumed:
       *   · this path sets `isQrCodeSlip = true`, so upstream
       *     `isNormalMedia = !isQrCodeSlip` is false (`webhook.service.ts:4842`)
       *     and the `[[[assist]]]` marker inside `image_answer_text` does NOT
       *     fire on it.
       *   · that is not silence. Since [FIX-20260817-QRNOTIMAGE] a slip's case is
       *     opened by the CARD's own `direct_ticket_on_reply`, which that fix made
       *     the single authority. Paging is therefore a per-card setting an
       *     operator ticks, not something this branch removes.
       *
       * 🔴 CONSTRAINT THE OWNER PUT ON THE IMPLEMENTATION — it is part of the
       * decision, not a style note. The mapping must stay SWAPPABLE and each code
       * must be INDEPENDENT: one code, one row, changed on its own, and changing
       * `1009` must not move `1010`. So when the SlipGuard adapter is written this
       * becomes ONE table `numeric code -> verdict`, not an if-chain and not a
       * shared fallback that couples two codes together. No new abstraction and
       * no second place to edit — that is what "leave no debt" means here.
       * แต่ละโค้ดต้องสลับได้อิสระ แก้ที่เดียว ไม่สร้างหนี้
       *
       * ✅ [DECISION-20260903-OPCODEERRORCARD] THE OPERATIONAL CODES ALSO GO TO
       * `hook.flex_error`. Owner call, 03/09 — final, and it SUPERSEDES the
       * pay-review answer given earlier the same day.
       *
       * Covers `1006`, `1013` and `1000`-`1004`/`1015`: our key expired, the
       * package expired, the quota ran out, our own misconfiguration. The customer
       * still gets the OA's own error wording, and **the operator watches the log**
       * — the owner said plainly they will read it themselves, which is what makes
       * a separate admin-facing state unnecessary.
       *
       * WHY THIS IS BETTER THAN THE REVIEW CARD IT REPLACES, not just simpler:
       * `review` was built for a failure AFTER a money leg ran, so it declares
       * MONEY: UNKNOWN and keeps the SLIP LOCKED. These codes fire at VERIFY time,
       * before any leg exists — nothing moved, and locking the slip would strand
       * the customer behind an outage that is ours. `flex_error` leaves that alone.
       *
       * ⇒ ONE DESTINATION FOR EVERY UNMAPPED CODE: `flex_error`. Same card as
       * `1010`/`1009` above, so the table stays one column wide and each code is
       * still switchable on its own.
       * ⚠️ The log line below is therefore load-bearing, not decoration — it is now
       * the ONLY place the specific code is visible. Keep it printing the code.
       * โค้ดฝั่งเราพัง = ออกการ์ด error · เจ้าของไปดู log เอง ⇒ บรรทัด log ห้ามหาย
       *
       * 📄 REF: `docs/slip-spec.md` → "SlipGuard error-code mapping — owner decisions"
       * carries the per-code table, the evidence, and what is still open. This
       * comment and that section must be changed together.
       *
       * ⚠️ AND THE SHAPE: the three checks above all require `svr.success === false`
       * AND the code at `svr.error.code`. An envelope carrying a top-level `code`,
       * or omitting `success:false`, matches nothing and lands here.
       *
       * Full sweep and the per-code table: `docs/slip-spec.md`. Nothing in this
       * block changed; do not "fix" the silence without deciding the above first. */
      logger.log(
        `[SLIP VERIFY] Other error encountered: ${svr.error?.code || 'Unknown'}`,
      );
    }
  } catch (innerErr) {
    // legacy:3731-3733 — result-processing failures never break the flow.
    logger.error(
      `[SLIP] Failed in result processing logic: ${errText(innerErr)}`,
    );
  }

  result.flexDoc = flexDoc;
  result.slipCondition = slipCondition;
  result.violationDetected = violationDetected;
  return result;
}

/**
 * legacy:3771-3777 — `isPaymentFlex` is true when the chosen card is one of the
 * five payment cards. Feeds the assist-notification category.
 */
export function isPaymentFlexCard(
  flexDoc: FlexDocLike | null,
  hook: SlipFlexHookLike | null | undefined,
): boolean {
  if (!flexDoc) return false;
  const ids = [
    String(hook?.flex_success || ''),
    String(hook?.flex_duplicate || ''),
    String(hook?.flex_min_amount || ''),
    String(hook?.flex_out_of_time || ''),
    String(hook?.flex_success_not_match || ''),
  ].filter(Boolean);
  return ids.includes(String(flexDoc._id));
}
