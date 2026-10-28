/**
 * =====================================================================
 * The `customer-register` keyword handler — bot sends the register link.
 * =====================================================================
 *
 * [FIX-20260808-CUSTREG] TRANSCRIBED, not redesigned. Source of truth:
 *   legacy-api/src/controllers/core-bot/webhookController.js  (branch dev_sec)
 *   · handleCustomerRegisterKeyword     — the block between the markers
 *     `// ==== [FEAT-20260728-CUSTREG] START` and `... END`
 *   · buildCustomerRegisterFlex         — the Flex bubble, verbatim JSON
 *   · buildCustomerRegisterUrl          — URL builder + [FEAT-20260729-LIFFURL]
 *
 * เมื่อผู้ใช้พิมพ์คำว่า "customer-register" บอทต้องตอบว่า
 *   ผูกแล้ว  → ข้อความยืนยันชื่อ (ไม่ mint token ซ้ำ)
 *   ยังไม่ผูก → mint token แล้วส่ง Flex ปุ่มลงทะเบียน
 *
 * The legacy handler's own contract, kept exactly:
 *   returns true  = handled, the caller may `return` immediately.
 *   returns false = NOT handled, fall through to the normal/assist flow.
 *   It NEVER throws — every failure is caught and turned into `false`
 *   (or, once a LINE reply has already gone out, `true`).
 *
 * ⚠️ NO SERVICE IS IMPORTED HERE. Every collaborator arrives through `deps`,
 *    mirroring assist-notification.ts, so the whole handler is drivable with
 *    faked deps and a unit test can never open a socket.
 */

import { errText } from '../logging/coerce-mask.util';
import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';

// [FEAT-20260831-QUOTESRC] the ids LINE returns for a message it accepted
import { sentMessageIds } from '@/infra/line';

import type { WebhookLogEvent } from '../logging';

const logger = new Logger('CustomerRegister');

/**
 * legacy `CUSTOMER_LANDING_DEFAULT_URL` — the central landing used only when a
 * hook has not set its own `customer_link_landing_url`. Verbatim from legacy.
 */
const CUSTOMER_LANDING_DEFAULT_URL = 'https://customer.example.comm';

/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

/**
 * legacy `buildCustomerRegisterFlex` — the register-button bubble.
 *
 * ⚠️ COPIED BYTE-FOR-BYTE from the legacy JSON. Layout, text, the stray space
 *    in "ผู้ใช้งานสามารถลงทะเบียนสมาชิก...", `spacing`, empty `contents: []`
 *    fillers — all preserved. Legacy's comment says "ห้ามแก้ layout/ข้อความ
 *    นอกจากผู้ใช้สั่ง". Only the `uri` is dynamic.
 */
export function buildCustomerRegisterFlex(
  registerUrl: string,
): Record<string, unknown> {
  return {
    type: 'bubble',
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'separator' },
        {
          type: 'text',
          text: 'ผู้ใช้งานสามารถลงทะเบียนสมาชิก โดยการกดปุ่มสีเขียวนี้',
          margin: 'md',
          size: 'lg',
          wrap: true,
          align: 'center',
          style: 'normal',
          contents: [],
        },
        { type: 'separator' },
        {
          type: 'button',
          style: 'primary',
          height: 'sm',
          action: { type: 'uri', label: 'ลงทะเบียน', uri: registerUrl },
        },
        { type: 'box', layout: 'vertical', contents: [], margin: 'sm' },
        { type: 'separator' },
      ],
      flex: 0,
    },
  };
}

/**
 * legacy `buildCustomerRegisterUrl` + `[FEAT-20260729-LIFFURL]`.
 *
 * ประกอบ URL ของปุ่ม `<landing>/?t=<token>&openExternalBrowser=0`.
 *
 * ⚠️ TWO SHAPES, decided by the landing base:
 *    · a `https://liff.line.me/...` base → LIFF already opens in the LIFF
 *      browser, so `openExternalBrowser=0` is dropped and the token rides a
 *      bare `?t=`. Legacy's comment: the param is meaningless there and may be
 *      forwarded to the page needlessly.
 *    · anything else → the original in-app-browser form with
 *      `&openExternalBrowser=0`, which forces LINE's in-app browser.
 *    Reads only the existing `customer_link_landing_url`; no schema touched.
 */
export function buildCustomerRegisterUrl(
  landingBase: string | null | undefined,
  linkToken: string,
): string {
  const base = String(landingBase || CUSTOMER_LANDING_DEFAULT_URL).replace(
    /\/+$/,
    '',
  );

  // legacy [FEAT-20260729-LIFFURL] — LIFF URL already carries its liffId in the
  // path, so the query attaches directly with no trailing-slash step.
  if (/^https?:\/\/liff\.line\.me\//i.test(base)) {
    return `${base}?t=${encodeURIComponent(linkToken)}`;
  }

  return `${base}/?t=${encodeURIComponent(linkToken)}&openExternalBrowser=0`;
}

/** legacy:3336 — the endpoint string written into every custreg webhook log. */
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

/** The event fields the handler reads. Mirrors legacy's `event.*` accesses. */
export interface CustomerRegisterEvent {
  replyToken?: string;
  eventId?: string;
  message?: { type?: string; text?: string };
  [k: string]: unknown;
}

/** legacy parameter object — `{ hook, userId, accessToken, event, logContext, channelId }`. */
export interface CustomerRegisterArgs {
  userId: string | undefined;
  hook: Record<string, unknown> | null | undefined;
  event: CustomerRegisterEvent | undefined;
  accessToken: string;
  logContext?: Record<string, unknown>;
  channelId?: string;
}

/**
 * The injected collaborators. Each one maps to a bare identifier the legacy
 * handler called directly (it lived inside the controller, so `Member`,
 * `sendLineReplyMessage`, `mintLinkToken`, `persistWebhookLog`,
 * `chatHistoryService` were all in scope). Here they are passed in.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CustomerRegisterDeps {
  /** legacy `Member.findOne(...)` — read-only member lookup by channel user id. */
  memberModel: Model<any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  /** legacy `mintLinkToken({...})` — CustomerLinkService.mintLinkToken. AES-256-GCM + 30-min TTL. */
  mintLinkToken: (input: {
    hookId: unknown;
    channelUserId?: unknown;
    channelType?: string | null;
  }) => string;
  /** legacy `sendLineReplyMessage` — LineApiService, returns an object carrying `.status`/`.data`. */
  sendLineReplyMessage: (
    accessToken: string,
    replyToken: string,
    text: string,
  ) => Promise<{ status?: number; data?: unknown }>;
  /** legacy `sendLineFlexReply` — LineApiService. altText "ลงทะเบียนสมาชิก". */
  sendLineFlexReply: (
    accessToken: string,
    replyToken: string,
    flexContents: Record<string, unknown>,
    altText: string,
  ) => Promise<{ status?: number; data?: unknown }>;
  /** legacy `persistWebhookLog`. Fire-and-forget with `.catch(()=>{})` at call sites. */
  /* [FEAT-20260815-WLOGDOOR] typed to the door's contract. TYPE-ONLY: the
     literals below are untouched and TypeScript erases this at compile time —
     the emitted JS is byte-identical, which is how this change is proved.
     Import is relative because `logging/` is deliberately NOT on the module
     barrel (other modules must not reach the door). */
  persistWebhookLog: (entry: WebhookLogEvent) => Promise<void>;
  /** legacy `chatHistoryService.logMessage` — fire-and-forget, mirrors the bot bubble. */
  logMessage: (input: Record<string, unknown>) => unknown;
}

/** legacy `CUSTOMER_REGISTER_KEYWORD`. Re-exported for the caller's guard/tests. */
export const CUSTOMER_REGISTER_KEYWORD = 'customer-register';

/**
 * legacy `handleCustomerRegisterKeyword` — the whole block, one for one.
 *
 * The caller's guard (keyword match + `hook.customer_link_enabled === true`)
 * is UNCHANGED and lives at the call site, exactly as in legacy; this function
 * assumes it has already passed and does the member check + link mint itself.
 */
export async function handleCustomerRegisterKeyword(
  args: CustomerRegisterArgs,
  deps: CustomerRegisterDeps,
): Promise<{ handled: boolean }> {
  const { userId, hook, event, accessToken, logContext, channelId } = args;

  // legacy:3055 — `if (!userId || !event?.replyToken) return false;`
  if (!userId || !event?.replyToken) return { handled: false };

  // ── 1) ผูกไปแล้วหรือยัง ──────────────────────────────────────────────
  // legacy:3060-3070 — a Member counts as registered ONLY when it has BOTH
  // `full_name` and `raw_profile_data`. Read-only, looked up by `line_user_id`.
  // legacy swallows a lookup failure and treats it as "not linked yet" so the
  // link still goes out rather than the customer getting silence.
  let member: { full_name?: unknown; raw_profile_data?: unknown } | null = null;
  try {
    member = await deps.memberModel
      .findOne({ line_user_id: userId })
      .select('full_name raw_profile_data')
      .lean<{ full_name?: unknown; raw_profile_data?: unknown }>()
      .exec();
  } catch (err) {
    logger.warn(`[CUSTREG] member lookup failed: ${errText(err)}`);
    // อ่าน Member ไม่ได้ → ถือว่ายังไม่ผูก แล้วส่งลิงก์ต่อ ดีกว่าเงียบ
  }

  const alreadyRegistered = !!(member?.full_name && member?.raw_profile_data);

  if (alreadyRegistered) {
    // legacy:3074-3095 — confirm-message branch. The copy is EXACT, including
    // the spaces around "ได้ลงทะเบียน เรียบร้อยแล้ว".
    const text = `คุณ ${String(member?.full_name)} ได้ลงทะเบียน เรียบร้อยแล้ว`;
    const lineResponse = await deps.sendLineReplyMessage(
      accessToken,
      event.replyToken,
      text,
    );
    await deps
      .persistWebhookLog({
        ...logContext,
        channel: 'line_api',
        action_type: 'custreg_already_linked',
        method: 'POST',
        endpoint: LINE_REPLY_ENDPOINT,
        status: 'success',
        http_status: lineResponse?.status,
        payload_summary: { reply_token: event.replyToken, text },
        response_summary: lineResponse?.data,
        line_event_id: event.eventId,
      })
      .catch(() => {});
    // legacy fires logMessage WITHOUT awaiting it — same here (fire-and-forget).
    deps.logMessage({
      userId,
      senderType: 'bot',
      messageType: 'text',
      content: text,
      hookId: hook?.['_id'],
      channelType: hook?.['channel_type'],
      channelId,
      replyToken: event.replyToken,
      // [FEAT-20260831-QUOTESRC] the ids LINE returned; none when it refused
      ...sentMessageIds(lineResponse),
      metadata: {
        event_id: event.eventId,
        reason: 'custreg_already_linked',
      },
    });
    return { handled: true };
  }

  // ── 2) ยังไม่ผูก → mint token แล้วส่ง Flex ปุ่ม ──────────────────────
  // legacy:3099-3113 — mint the opaque link token. legacy lazy-`require`s the
  // customer-link module; here it is injected as `deps.mintLinkToken`. A mint
  // failure returns false so the customer still reaches the AI flow (not silent).
  let linkToken: string;
  try {
    linkToken = deps.mintLinkToken({
      hookId: hook?.['_id'],
      channelUserId: userId, // LINE "U..." — matches members.line_user_id
      channelType: (hook?.['channel_type'] as string) || 'line',
    });
  } catch (err) {
    logger.error(`[CUSTREG] mintLinkToken failed: ${errText(err)}`);
    return { handled: false }; // ไหลลง flow ปกติ — ลูกค้ายังได้คำตอบจาก AI
  }
  // legacy:3113 — `if (!linkToken) return false;`
  if (!linkToken) return { handled: false };

  const registerUrl = buildCustomerRegisterUrl(
    hook?.['customer_link_landing_url'] as string | null | undefined,
    linkToken,
  );
  const flexContents = buildCustomerRegisterFlex(registerUrl);

  // legacy:3117-3122 — altText "ลงทะเบียนสมาชิก", passed explicitly.
  const lineResponse = await deps.sendLineFlexReply(
    accessToken,
    event.replyToken,
    flexContents,
    'ลงทะเบียนสมาชิก',
  );

  await deps
    .persistWebhookLog({
      ...logContext,
      channel: 'line_api',
      action_type: 'custreg_send_link',
      method: 'POST',
      endpoint: LINE_REPLY_ENDPOINT,
      status: 'success',
      http_status: lineResponse?.status,
      // legacy:3134 — the token is a secret, so ONLY the landing base (before
      // "?") is logged, never the token itself.
      payload_summary: {
        reply_token: event.replyToken,
        landing: String(registerUrl).split('?')[0],
      },
      response_summary: lineResponse?.data,
      line_event_id: event.eventId,
    })
    .catch(() => {});

  // legacy:3138-3145 — fire-and-forget history bubble, content is the fixed
  // placeholder "[ส่งลิงก์ลงทะเบียนสมาชิก]" (NOT the URL — the token is secret).
  deps.logMessage({
    userId,
    senderType: 'bot',
    messageType: 'text',
    content: '[ส่งลิงก์ลงทะเบียนสมาชิก]',
    hookId: hook?.['_id'],
    channelType: hook?.['channel_type'],
    channelId,
    replyToken: event.replyToken,
    // [FEAT-20260831-QUOTESRC] same spread as the already-linked branch above
    ...sentMessageIds(lineResponse),
    metadata: { event_id: event.eventId, reason: 'custreg_send_link' },
  });

  return { handled: true };
}
