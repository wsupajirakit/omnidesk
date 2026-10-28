/**
 * Customer-Link service — port of `legacy-api/src/customer-link/`
 * (`config.js`, `controllers/customerLinkController.js`,
 * `adapter/customerLinkAdapter.js`), minus the HTTP plumbing.
 *
 * SECURITY BOUNDARY. The customer-facing routes are PUBLIC by design: the
 * caller is an end customer inside the messaging app's in-app browser with no
 * dashboard credential. What replaces auth is the `link_token` — an opaque blob
 * encrypted with the service's existing ENCRYPTION_KEY (AES-256-GCM, random IV,
 * auth-tagged). Only this backend can mint or open one, so:
 *
 *   - the hook id and the customer's channel id are unreadable on the URL
 *   - a token altered by one character fails to decrypt and falls out as 400
 *   - `channel_user_id` is ALWAYS taken from the token; any value in the body
 *     is ignored, so a client can never submit as someone else
 *   - `web_code` always comes from the hook, so a request cannot be aimed at
 *     another OA
 *   - `ts` inside the token expires the link (30 min customer / 15 min admin)
 *
 * That is the whole boundary, and it is reproduced here exactly.
 *
 * ── Field names, and where each was confirmed (V13) ───────────────────────
 * All read against the live `hooks` collection (7 documents, read-only) AND
 * present in the legacy source:
 *   customer_link_enabled · customer_link_landing_url · customer_link_web_code
 *   custom_tool_status · custom_tool_id · channel_type · alias · group_id
 * On `custom_tools`: name · base_url · auth_type · timeout_ms · status ·
 * endpoints. On `members`: line_user_id · raw_profile_data · full_name ·
 * phone_number · contract_code.
 */
import { createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';

import { CryptoService } from '@/infra/crypto';
/* ==== [FEAT-20260827-PUSHCORE-F] candidate F — this module's LINE send now
   goes through the ONE core (`src/infra/line/`) instead of its private copy.
   `buildLinkedNoticeMessage` is the pure builder that already existed for this
   exact call site (build-payload.customer-link.ts:14) and is already proven
   byte-equal to the old sender by execution, not by copy
   (z-test/unit/line-push-parity.spec.ts:197).
   revert: import LineApiService again + the two call sites below. */
import {
  buildLinkedNoticeMessage,
  LinePushDispatcher,
  // [FEAT-20260831-QUOTESRC] the ids LINE returns for a push it accepted
  sentMessageIds,
} from '@/infra/line';
import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';
// [FEAT-20260811-SUCCESSPUSH] ChatHistoryService — บันทึก push notice ลง chat history
import {
  ChatHistoryService,
  Member,
  type MemberDocument,
} from '@/modules/chat';
import { providerFeatureOn } from '@/modules/customer-provider';
import { CustomToolService, type CallResult } from '@/modules/external';
import type { AuthenticatedUser } from '@/common';
import {
  Hook,
  getAllowedHookIds,
  isHookOutOfScope,
  type HookDocument,
} from '@/modules/hooks';
import { WebhookLogWriter } from '@/modules/system';

import {
  ADMIN_TOKEN_TTL_MS,
  CANONICAL_LINK_ERRORS,
  CAPABILITY_ROLES,
  EXPIRED_LINK_TOKEN,
  INVALID_LINK_TOKEN,
  LINK_TOKEN_TTL_MS,
  OP_TO_ENDPOINT,
  OP_TO_ROLE,
  ROLE_FALLBACK_KEY,
  type LinkError,
  type LinkResult,
} from './customer-link.constants';
import { clearFollowUpOnLinkRegistered } from './clear-follow-up-on-register.helper';
import { stampLinkRegistration } from './registration-stamp.helper';

/** A hook as this module reads it — always `.lean()`, never written. */
type LeanHook = Record<string, unknown> | null;

/**
 * `String(...)` for values Mongo hands back as `unknown` — ObjectId, string, or
 * absent. Nullish becomes '' so a missing field never stringifies to "undefined"
 * and ends up inside an idempotency key or a URL.
 */
const asText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  // Everything else that reaches here is an ObjectId, a number or a Date, all
  // of which carry a meaningful toString(). The rule cannot see that through
  // `unknown`, and narrowing further would mean enumerating Mongo's types here.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(v);
};

interface ParsedToken {
  hookId: string;
  channelUserId: string | null;
  channelType: string | null;
  mode?: string | null;
  adminUserId?: string | null;
  expired: boolean;
}

interface ResolvedHook {
  hook?: LeanHook;
  channelUserId?: string | null;
  channelType?: string | null;
  mode?: string | null;
  adminUserId?: string | null;
  invalid?: boolean;
  expired?: boolean;
}

/** The five values customer-link itself owns — legacy `config.js#resolveConfig`. */
interface LinkConfig {
  webCode: string | null;
  enabled: boolean;
  toolId: string | null;
  hasTool: boolean;
}

@Injectable()
export class CustomerLinkService {
  private readonly logger = new Logger(CustomerLinkService.name);

  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<HookDocument>,
    @InjectModel(Member.name)
    private readonly memberModel: Model<MemberDocument>,
    private readonly crypto: CryptoService,
    private readonly customToolService: CustomToolService,
    /* [FEAT-20260827-WLOGONEDOOR] was `@InjectModel(WebhookLog)` — this service
     * writes two rows (reg_push, and the upstream-call audit) and reads none.
     * CustomerLinkModule already imports SystemModule (customer-link.module.ts:64). */
    private readonly wlog: WebhookLogWriter,
    private readonly realtime: RealtimePublisherService,
    /* [FEAT-20260811-SUCCESSPUSH] ยิง push text แจ้งลูกค้าหลังผูกบัญชีสำเร็จ
     * [FEAT-20260827-PUSHCORE-F] was `LineApiService` (this module's own copy of
     * a LINE sender). Now the shared wrapper — bind to the DISPATCHER, never to
     * `LinePushService`, so the day a real queue lands it swaps in one place
     * (`line.module.ts`) and nothing here changes. ต้องผูกกับตัวห่อเสมอ. */
    private readonly linePush: LinePushDispatcher,
    // [FEAT-20260811-SUCCESSPUSH] เขียน push notice ลง chat_messages (sender_type:'bot')
    // เพื่อให้ admin เห็นในไทม์ไลน์แชต. best-effort — ล้มไม่กระทบ match/push.
    // revert: ลบ dep นี้ + logMessage ใน pushLinkedNotice + provider ใน module.
    private readonly chatHistory: ChatHistoryService,
  ) {}

  // ==== [FEAT-20260811-SUCCESSPUSH] ข้อความแจ้งลูกค้าเมื่อผูกบัญชีสำเร็จ ====
  // เจ้าของสั่ง 2026-08-11: หน้า landing ตอน success ไม่โชว์ modal แล้ว แต่ให้ push
  // ข้อความนี้เข้าแชต LINE ของลูกค้าแทน (landing กำลังปิดตัวเอง).
  //
  // 🔧 เผื่อทำ DYNAMIC อนาคต: ตอนนี้เป็น const default. ถ้าต้องการให้แต่ละ OA ตั้ง
  //   ข้อความเองจาก UI — เพิ่ม field `customer_link_success_text` ที่ hook แล้วให้
  //   `linkedNoticeText(hook)` อ่านจาก hook ก่อน fallback const นี้ (โครงรองรับแล้ว
  //   ด้านล่าง — แก้ที่เดียว). ไม่ต้องแก้ call site.
  // revert: ลบ const + linkedNoticeText + pushLinkedNotice + จุดเรียกใน match()
  private static readonly LINKED_NOTICE_DEFAULT =
    'ตอนนี้น้องลั๊คกี้เชื่อมต่อข้อมูลกับคุณลูกค้าได้แล้ว ' +
    'รบกวนคุณลูกค้าแจ้งความต้องการมาอีกครั้งนะคะ ' +
    'เดี๋ยวหนูจะรีบดำเนินการให้ทันทีเลยค่ะ';

  /** ข้อความแจ้งผูกสำเร็จ — อ่านจาก hook ก่อน (เผื่อ dynamic) แล้ว fallback const. */
  private linkedNoticeText(hook: LeanHook | null): string {
    const fromHook = hook?.['customer_link_success_text'];
    return typeof fromHook === 'string' && fromHook.trim()
      ? fromHook.trim()
      : CustomerLinkService.LINKED_NOTICE_DEFAULT;
  }

  /* ==== [FEAT-20260827-PUSHCORE-F] the caller's own "failed send throws" rule ====
   *
   * WHY THIS EXISTS AT ALL: the core never throws — a failure comes back as
   * `{ok:false}` (line-push.ts:39-40). Both push sites in this file are wrapped
   * in a try/catch that is LOAD-BEARING: it is what writes the `status:'error'`
   * webhook_logs row, and what stops a failed push from being mirrored into the
   * admin's chat timeline as if the customer had received it. Without a throw
   * those two behaviours silently disappear while every existing test stays green.
   *
   * WHY NOT `LinePushService.sendOrThrow`, which does exactly this: callers must
   * bind to `LinePushDispatcher` (the wrapper) and NEVER to the service — that is
   * the seam a real queue slots into later (line-push-dispatcher.ts:24-27), and
   * `grep -rnE "import[^;]*(LinePushService|InlineLinePushQueue)" src --exclude-dir=infra`
   * is pinned at ZERO by docs/core-push.md. The wrapper deliberately has no
   * method but `dispatch` — it is a glass pipe by contract.
   *
   * WHY NOT WIDEN THE WRAPPER: adding `sendOrThrow` there would give one caller's
   * business rule a permanent home in shared infra, and the core's own guide says
   * the opposite — "ladders/dedupe/suppress belong to callers … ตัวกลางต้องโง่เรื่อง
   * business เสมอ" (line-push.ts:70-72).
   *
   * So the rule lives HERE, four lines, next to the code that depends on it.
   * `result.raw` is the untouched axios error the old sender used to throw, so
   * `(err as Error).message` downstream reads exactly what it read before.
   * revert: delete this method; the two call sites go back to `this.lineApi.
   *         sendLinePushMessage(accessToken, userId, text)`.
   */
  private async pushOrThrow(
    accessToken: string,
    to: string,
    text: string,
    /* [FEAT-20260831-QUOTESRC] `data` was always on the object this returns
       (`LineSendResult`); the annotation simply did not say so, and the two
       callers now read the ids LINE put there. Widening a private method's
       declared shape — no runtime change, nothing else reads it. */
  ): Promise<{ status?: number; data?: unknown }> {
    const result = await this.linePush.dispatch({
      kind: 'push',
      token: accessToken,
      to,
      messages: [buildLinkedNoticeMessage(text)],
    });
    if (!result.ok) {
      if (result.raw instanceof Error) throw result.raw;
      throw new Error(result.reason ?? 'LINE push failed');
    }
    return result;
  }

  /**
   * BEST-EFFORT push แจ้งลูกค้า — เจ้าของเลือก: match สำเร็จ = success เสมอ,
   * push ล้ม (token หมดอายุ / เน็ตหลุด) ต้องไม่ทำให้ผลลัพธ์เป็น fail.
   * จึงห่อ try/catch กลืน error เองทั้งหมด + log ไว้ให้ตามได้.
   */
  private async pushLinkedNotice(
    hook: LeanHook | null,
    userId: string,
  ): Promise<void> {
    try {
      const accessToken =
        this.crypto.safeDecrypt(hook?.['access_token'] as string) || '';
      if (!accessToken || !userId) {
        this.logger.warn(
          '[CUSTOMER-LINK] push แจ้งผูกสำเร็จข้าม — ไม่มี access_token/userId',
        );
        return;
      }
      const noticeText = this.linkedNoticeText(hook);
      /* [FEAT-20260827-PUSHCORE-F] the send goes through `pushOrThrow` below, NOT a bare `dispatch` — and that choice
       * is the whole migration, not a detail.
       *
       * The old `sendLinePushMessage` let the axios rejection escape, and the
       * `catch` at the bottom of this method is what turns that into the
       * `status:'error'` webhook_logs row an admin reads when a customer says
       * "the bot never messaged me". The core deliberately NEVER throws — it
       * returns `{ok:false}` (line-push.ts:39-40). Swapping in `dispatch` would
       * therefore make a failed push fall THROUGH to `chatHistory.logMessage`
       * below, mirroring into the admin's timeline a message the customer never
       * received, and the error row would stop being written at all.
       * `pushOrThrow` rethrows the RAW axios error, so every
       * `(err as Error).message` read downstream behaves exactly as before.
       * ⚠️ เรียก dispatch ตรง ๆ เมื่อไหร่ = log หายและแอดมินเห็นข้อความที่ลูกค้าไม่ได้รับ
       *
       * Parity of the request itself: body is byte-equal (pinned by execution in
       * line-push-parity.spec.ts:197) and the timeout is the same 15s — the core
       * default (line-endpoints.ts:40) equals the old constant
       * (line-api.service.ts:62), so no `timeoutMs` override is needed.
       * ONE difference on the wire, deliberate and inherited from candidates C/E:
       * the core attaches `X-Line-Retry-Key` on the push family. It does NOT add
       * a retry (maxAttempts still defaults to 1) — it tells LINE not to deliver
       * twice if the same key ever arrives again.
       * `res.status` carries the HTTP status just like the axios response did, so
       * `logSuccessPushWebhook` below reads it unchanged. */
      const pushRes = await this.pushOrThrow(accessToken, userId, noticeText);

      // [FEAT-20260811-PUSHWHLOG] เจ้าของสั่ง: เก็บ push แจ้งผูกสำเร็จลง webhook_logs ด้วย
      // (แอดมินเห็นในหน้า "บันทึกการเรียกใช้งาน" ว่ามี push ออกไปจริง).
      // channel='reg_push' · action_type='reg_push' (เจ้าของสั่งใช้ 'reg_push' แยกช่องทาง
      // ให้เห็นชัดว่าเป็น register-push ไม่ปนกับ customer_link ปกติ). SEPARATE try/catch =
      // best-effort: log ล้มต้องไม่กระทบ push/match. DB effect: +1 webhook_logs row (additive).
      // revert: ลบ block นี้ (push/history เดิมยังทำงาน).
      void this.logSuccessPushWebhook(hook, userId, noticeText, pushRes);

      // [FEAT-20260811-SUCCESSPUSH] เจ้าของสั่ง: ข้อความที่ push ต้องโผล่ในไทม์ไลน์แชต
      // ของ admin ด้วย → เขียนลง chat_messages เป็น sender_type:'bot' (แบบเดียวกับที่
      // webhook reply path เรียก logMessage). SEPARATE try/catch = best-effort: ถ้า
      // history write ล้ม (room resolve พลาด/DB หลุด) match ยังสำเร็จ และ push ยิงไปแล้ว.
      // logMessage เองก็ resolve room + set field ให้ครบ เราแค่ส่ง user/sender/text/hook.
      // DB effect: เพิ่ม 1 chat_messages row (additive) — ไม่แตะ schema/index.
      // revert: ลบ block นี้ทิ้ง (push เดิมยังทำงานปกติ).
      try {
        await this.chatHistory.logMessage({
          userId,
          senderType: 'bot',
          messageType: 'text',
          content: noticeText,
          hookId: hook?.['_id'] as string | undefined,
          channelType: 'line',
          // [FEAT-20260831-QUOTESRC] the push's own LINE id, so this bubble can be
          // quoted back later. Nothing is added when LINE returned nothing.
          ...sentMessageIds(pushRes),
        });
      } catch (histErr) {
        this.logger.warn(
          `[CUSTOMER-LINK] บันทึก push notice ลง chat history ล้มเหลว (ไม่กระทบ match/push): ${(histErr as Error).message}`,
        );
      }
    } catch (err) {
      // best-effort: ผูกบัญชีสำเร็จไปแล้ว — push ล้มไม่กระทบผลลัพธ์
      this.logger.warn(
        `[CUSTOMER-LINK] push แจ้งผูกสำเร็จล้มเหลว (ไม่กระทบ match): ${(err as Error).message}`,
      );
      // [FEAT-20260811-PUSHWHLOG] push ล้ม → ก็ยังเก็บ log ว่า "พยายาม push แล้วพลาด"
      // (แอดมินจะได้เห็นว่าทำไมลูกค้าไม่ได้ข้อความ). กลืน error เองเช่นกัน.
      void this.logSuccessPushWebhook(hook, userId, '', null, err as Error);
    }
  }

  // [FEAT-20260811-PUSHWHLOG] BEST-EFFORT: บันทึก push แจ้งผูกสำเร็จลง webhook_logs.
  // แยกเป็น method + ห่อ try/catch กลืน error ทั้งหมด — เขียน log ล้มต้องไม่ทำให้
  // push/match พัง. field mirror callUpstream (channel/action_type/request_meta).
  // revert: ลบ method นี้ + 2 จุดเรียกใน pushLinkedNotice.
  private logSuccessPushWebhook(
    hook: LeanHook | null,
    userId: string,
    noticeText: string,
    pushRes: { status?: number } | null,
    err?: Error,
  ): void {
    const warn = (e: unknown) =>
      this.logger.warn(
        `[CUSTOMER-LINK] เขียน webhook log ของ push ล้มเหลว (ไม่กระทบ): ${(e as Error).message}`,
      );
    try {
      const h = hook || {};
      const ok = !err;
      // `.catch` บน promise ด้วย (นอกจาก try/catch synchronous) — `create()` reject
      // แบบ async, try/catch เปล่าจับไม่ได้ ⇒ unhandled rejection. best-effort เต็มรูป.
      void Promise.resolve(
        this.wlog.persist({
          hook_id: h['_id'] ?? undefined,
          hook_alias: h['alias'] ?? undefined,
          // [FIX-20260818-GROUPFIELD] read `group` — the Hook has no `group_id`,
          // so this stamped null on every row. The column here is real; the
          // value was not.
          group_id: h['group'] ?? null,
          // [FEAT-20260811-PUSHWHLOG] เจ้าของสั่ง: channel = 'reg_push' (แยกช่องทางให้เห็นชัด
          // ว่าเป็น register-push ไม่ปนกับ customer_link ปกติ). channel เป็น free string
          // (ไม่ใช่ enum ใน webhook-log.schema) จึงตั้งค่าใหม่ได้ ไม่แตะ schema. pre-save hook
          // จะ mirror log_source จาก channel ให้เอง. revert: กลับเป็น 'customer_link'.
          channel: 'reg_push',
          action_type: 'reg_push',
          method: 'POST',
          endpoint: 'https://api.line.me/v2/bot/message/push',
          status: ok ? 'success' : 'error',
          http_status:
            typeof pushRes?.status === 'number' ? pushRes.status : undefined,
          error_message: err ? err.message : undefined,
          raw_request: { to: userId, text: noticeText || '(push failed)' },
          request_meta: {
            op: 'success_push',
            line_user_id: userId || null,
            actor: 'system',
            outcome: ok ? 'success' : 'error',
          },
          reference_id: userId || undefined,
        }),
      ).catch(warn);
    } catch (logErr) {
      warn(logErr);
    }
  }
  // ==== [FEAT-20260811-SUCCESSPUSH] END ====

  // ───────────────────────────────────────────────────────────────────────
  // CONFIG  (legacy config.js)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Values customer-link owns directly on the hook. Everything about the
   * destination (url, credentials, paths) lives in `custom_tools` instead.
   */
  public resolveConfig(hook: LeanHook): LinkConfig {
    const h = hook || {};
    // A hook-set web_code always beats whatever the client sent — that is what
    // stops a caller aiming its request at another OA.
    const webCode = (h['customer_link_web_code'] as string) || null;
    const toolId = h['custom_tool_id'] ? asText(h['custom_tool_id']) : null;

    return {
      webCode,
      enabled: h['customer_link_enabled'] === true,
      toolId,
      // Both are required: the switch on AND a tool bound.
      hasTool: h['custom_tool_status'] === true && !!toolId,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // LINK TOKEN
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Mints the opaque `?t=` token that goes on a landing link. Server-side only;
   * never exposed as a route. `mode`/`adminUserId` are optional and, when
   * absent, are omitted from the JSON entirely — so a token minted before those
   * fields existed still reads identically.
   */
  /**
   * ==== [FEAT-20260814-MINTBLOCKLINKED] Already-registered guard for the mint button ====
   *
   * WHAT: answers "does this member already have a linked profile?" and, when it
   * does, tells the customer so over LINE and records that message in the room.
   *
   * WHY: an admin pressing "ลงทะเบียนให้ลูกค้า" for someone who is already linked
   * would mint a landing token and send them through registration a second time.
   * The upstream would reject it at the end, but only after the customer had
   * filled the form — so refuse at the door and answer them instead.
   * ลงทะเบียนไว้แล้วไม่ต้องส่งไปกรอกซ้ำ ตอบกลับไปเลย
   *
   * ⚠️ REGISTER ONLY. `mode: 'edit'` exists precisely FOR linked members, so this
   *    must never run on that path — gating it wrongly would break the edit
   *    button for every customer who has an account. โหมดแก้ไขห้ามโดนบล็อก
   *
   * ⚠️ The "already registered" rule is NOT invented here. It is the one legacy
   *    uses (`customer-register.handler.ts:212`, ported from legacy:3060-3070):
   *    a member counts as registered only when it has BOTH `full_name` and
   *    `raw_profile_data`. Verified against the live rows — the two linked
   *    members in the local DB carry both. Re-deriving it would risk the two
   *    paths disagreeing about who is registered. ใช้เกณฑ์เดียวกับของเดิม
   *
   * ⚠️ A member lookup that THROWS is treated as "not registered", the same way
   *    legacy does: failing open sends the admin a working link, failing closed
   *    would block a legitimate registration because Mongo hiccuped.
   *
   * The notice itself is best-effort — modelled on `pushLinkedNotice` below.
   * Neither the LINE push nor the chat-history write can turn this into an
   * error; the block already happened, and the admin is told either way.
   *
   * revert: delete this method + `LINKED_ALREADY_NOTICE` + the call in
   *         `adminToken` (customer-link.controller.ts).
   */
  private static readonly LINKED_ALREADY_NOTICE =
    'ลูกค้าได้ทำการลงทะเบียนไว้ในระบบเรียบร้อยแล้วนะคะ :)';

  // [FIX-20260818-BODYOPERATOR] same sink, same bare cast upstream — see
  // `alreadyLinked`. `unknown` is what actually arrives.
  public async findLinkedMember(
    channelUserId: unknown,
  ): Promise<{ linked: boolean; fullName: string | null }> {
    try {
      const member = await this.memberModel
        .findOne({ line_user_id: asText(channelUserId) })
        .select('full_name raw_profile_data')
        .lean<{ full_name?: unknown; raw_profile_data?: unknown }>()
        .exec();
      const linked = !!(member?.full_name && member?.raw_profile_data);
      return {
        linked,
        fullName:
          typeof member?.full_name === 'string' ? member.full_name : null,
      };
    } catch (err) {
      // อ่าน Member ไม่ได้ → ถือว่ายังไม่ผูก (fail-open เหมือน legacy)
      this.logger.warn(
        `[CUSTOMER-LINK] member lookup ล้มเหลว ถือว่ายังไม่ผูก: ${(err as Error).message}`,
      );
      return { linked: false, fullName: null };
    }
  }

  /**
   * Tell an already-registered customer over LINE, and mirror it into the room.
   *
   * Best-effort throughout: a dead access token or a failed history write must
   * not turn the admin's refusal into a 500. Mirrors `pushLinkedNotice`, which
   * made the same choice for the success path.
   */
  public async notifyAlreadyRegistered(
    hook: LeanHook | null,
    channelUserId: string,
  ): Promise<void> {
    const text = CustomerLinkService.LINKED_ALREADY_NOTICE;
    try {
      const accessToken =
        this.crypto.safeDecrypt(hook?.['access_token'] as string) || '';
      if (!accessToken || !channelUserId) {
        this.logger.warn(
          '[CUSTOMER-LINK] แจ้ง "ลงทะเบียนแล้ว" ข้าม — ไม่มี access_token/userId',
        );
        return;
      }
      /* [FEAT-20260827-PUSHCORE-F] same reasoning as `pushLinkedNotice` — see the
       * long note there. `sendOrThrow` keeps the throw this method's own catch
       * relies on, so a dead token still SKIPS the chat-history mirror below
       * instead of recording a bubble the customer never got. */
      /* [FEAT-20260831-QUOTESRC] the result was discarded; it is kept only to read
         the ids LINE returns. Same call, same await, same throw on failure. */
      const alreadyRes = await this.pushOrThrow(
        accessToken,
        channelUserId,
        text,
      );

      // เก็บเข้าไทม์ไลน์แชตเป็น sender_type:'bot' แบบเดียวกับ pushLinkedNotice
      // — แยก try/catch เพื่อให้ push ที่ยิงไปแล้วไม่ถูกกลบด้วย history ที่ล้ม
      try {
        await this.chatHistory.logMessage({
          userId: channelUserId,
          senderType: 'bot',
          messageType: 'text',
          content: text,
          hookId: hook?.['_id'] as string | undefined,
          channelType: 'line',
          // [FEAT-20260831-QUOTESRC] see the sibling site in `pushLinkedNotice`
          ...sentMessageIds(alreadyRes),
        });
      } catch (histErr) {
        this.logger.warn(
          `[CUSTOMER-LINK] บันทึกข้อความ "ลงทะเบียนแล้ว" ลง chat history ล้มเหลว: ${(histErr as Error).message}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[CUSTOMER-LINK] push "ลงทะเบียนแล้ว" ล้มเหลว (ไม่กระทบการปฏิเสธ): ${(err as Error).message}`,
      );
    }
  }

  public mintLinkToken(input: {
    hookId: unknown;
    channelUserId?: unknown;
    channelType?: string | null;
    mode?: string | null;
    adminUserId?: string | null;
  }): string {
    const { hookId, channelUserId, channelType, mode, adminUserId } = input;
    return (
      this.crypto.encrypt(
        JSON.stringify({
          h: asText(hookId),
          u: channelUserId ? asText(channelUserId) : undefined,
          c: channelType || undefined,
          m: mode || undefined,
          a: adminUserId ? String(adminUserId) : undefined,
          ts: Date.now(),
        }),
      ) || ''
    );
  }

  /**
   * Opens a token. Returns null when it cannot be trusted — tampered,
   * malformed, or carrying no usable hook id. Never throws; callers turn null
   * into a 400. Expiry is evaluated at READ time, so changing a TTL does not
   * invalidate tokens already in the wild, it just re-scores them.
   */
  public readLinkToken(linkToken: unknown): ParsedToken | null {
    const decoded = this.crypto.safeDecrypt(asText(linkToken));
    // Tokens minted before the payload existed are the bare hook id, and carry
    // no `ts` — so no expiry applies to them.
    if (typeof decoded === 'string' && isValidObjectId(decoded)) {
      return {
        hookId: decoded,
        channelUserId: null,
        channelType: null,
        expired: false,
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(asText(decoded)) as Record<string, unknown>;
    } catch {
      return null; // not our token
    }
    if (!payload || !isValidObjectId(payload['h'])) return null;

    // Admin links (mode=edit/register) get the shorter TTL: they grant the
    // power to edit another customer's linkage.
    const ttl = payload['m'] ? ADMIN_TOKEN_TTL_MS : LINK_TOKEN_TTL_MS;
    const ts = Number(payload['ts']);
    const expired = Number.isFinite(ts) && Date.now() - ts > ttl;

    return {
      hookId: String(payload['h']),
      channelUserId: (payload['u'] as string) || null,
      channelType: (payload['c'] as string) || null,
      mode: (payload['m'] as string) || null,
      adminUserId: (payload['a'] as string) || null,
      expired,
    };
  }

  /**
   * Resolution: link_token -> null, which leaves the caller with `hook: null`
   * and the not-ready rejection below. `isValidObjectId` runs before any lookup
   * so a malformed id can never become a CastError 500.
   *
   * ==== [FIX-20260818-ALIASORACLE] the alias fallback is gone. audit_18_aug H6
   *
   * It resolved an OA BY NAME for an unauthenticated caller on three public
   * routes — `health`, `profile` and `match` — and `health` is the one route in
   * the controller without a rate limit, on a prefix the proxy gate exempts. A
   * name that existed answered differently from one that did not, so the customer
   * list could be enumerated with a shell loop and no account, and `describe()`
   * then handed over the OA's tool id, upstream target and endpoint list.
   *
   * Removed rather than guarded: this branch's own docstring called it
   * "dev/testing only", `admin/edit` already took `link_token` and nothing else,
   * nothing in either repo ever passed an alias, and no spec covered it. The
   * smallest surface is no surface. ทางเข้าที่ไม่มีใครใช้ ปิดทิ้งดีกว่าเฝ้า
   *
   * revert: restore the `alias` input and the lookup below, and pass it again
   *         from the three controller handlers.
   */
  public async resolveHook(input: {
    linkToken?: unknown;
  }): Promise<ResolvedHook> {
    const { linkToken } = input;

    if (linkToken) {
      const parsed = this.readLinkToken(linkToken);
      if (!parsed) return { invalid: true }; // no DB call spent on a bad token
      if (parsed.expired) return { expired: true };
      try {
        const hook = (await this.hookModel
          .findById(parsed.hookId)
          .lean()
          .exec()) as LeanHook;
        if (hook) {
          const hookChannel = hook['channel_type'] as string | undefined;
          // A token minted for one channel must not be replayed against a hook
          // that has since become another channel.
          if (
            parsed.channelType &&
            hookChannel &&
            parsed.channelType !== hookChannel
          ) {
            this.logger.warn(
              `[CUSTOMER-LINK] channel mismatch: token='${parsed.channelType}' hook='${hookChannel}'`,
            );
            return { invalid: true };
          }
          return {
            hook,
            channelUserId: parsed.channelUserId,
            channelType: parsed.channelType || hookChannel || null,
            mode: parsed.mode,
            adminUserId: parsed.adminUserId,
          };
        }
        this.logger.warn(
          `[CUSTOMER-LINK] link_token resolved to unknown hook — falling back to default target`,
        );
      } catch (err) {
        this.logger.warn(
          `[CUSTOMER-LINK] hook resolve failed for link_token: ${(err as Error).message}`,
        );
      }
    }

    return { hook: null };
  }

  /** Maps resolveHook's rejection flags onto their responses. */
  public tokenRejection(resolved: ResolvedHook): LinkResult | null {
    if (resolved.invalid) return INVALID_LINK_TOKEN;
    if (resolved.expired) return EXPIRED_LINK_TOKEN;
    return null;
  }

  /**
   * The gate before anything is fired at the third party. An OA that has not
   * finished its setup is a configuration problem, not the customer's fault, so
   * the message says where to go and fix it instead of leaking a raw upstream
   * error to the landing page.
   */
  public notReadyRejection(hook: LeanHook): LinkResult | null {
    const h = hook || {};
    /* [FEAT-20261014-PROVFEATURES] no register world on this site (loan_v1): every route behind
       this gate (landing profile, match, admin token, admin edit) refuses like a disabled OA.
       Admin unlink is not behind it and stays. */
    if (!providerFeatureOn('register')) {
      return {
        ok: false,
        status: 503,
        error: {
          code: 'CUSTOMER_LINK_DISABLED',
          message: 'ระบบนี้ไม่มีการลงทะเบียนผ่านแชท (ผูกบัญชีที่ระบบต้นทาง)',
        },
      };
    }
    if (h['customer_link_enabled'] !== true) {
      return {
        ok: false,
        status: 503,
        error: {
          code: 'CUSTOMER_LINK_DISABLED',
          message: 'OA นี้ยังไม่ได้เปิดใช้งานการลงทะเบียนผ่านแชท',
        },
      };
    }
    if (h['custom_tool_status'] !== true || !h['custom_tool_id']) {
      return {
        ok: false,
        status: 503,
        error: {
          code: 'CUSTOMER_LINK_NO_TOOL',
          message:
            'OA นี้ยังไม่ได้ผูก Custom Tool (ตั้งค่าที่หน้า Hook → Customer Link)',
        },
      };
    }
    return null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // ADAPTER  (legacy customerLinkAdapter.js)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Loads the tool bound to a hook.
   *
   * ⚠️ Deliberately NOT `CustomToolService.getToolForHook`. That shared method
   * rejects on `custom_tool_status === false`, whereas legacy customer-link
   * rejects on `!== true` — so a hook with the flag absent resolves to a tool
   * there and to null here. Legacy behaviour wins on this surface, and the
   * shared service is left untouched because other modules depend on it.
   * (`legacy-api/src/services/core-bot/customToolService.js:96-100`.)
   */
  private async getToolForHook(hook: LeanHook): Promise<CustomToolLike | null> {
    const h = hook || {};
    if (!hook) return null;
    if (h['custom_tool_status'] !== true) return null;
    return await this.customToolService.getTool(h['custom_tool_id'] as string);
  }

  /**
   * THE channel edge — the one place that knows channel names. Everything else
   * speaks the neutral `channel_user_id`; the upstream contract still calls it
   * `line_user_id`, so the rename happens here and nowhere else.
   */
  private channelIdField(channelType?: string | null): {
    field?: string;
    error?: LinkError;
  } {
    const c = channelType || 'line'; // legacy tokens carry no channel → LINE
    if (c === 'line') return { field: 'line_user_id' };
    // Refuse loudly rather than silently sending a PSID in a field the upstream
    // reads as a LINE id.
    return {
      error: {
        code: 'CUSTOMER_LINK_CHANNEL_UNSUPPORTED',
        message: `ช่องทาง '${c}' ยังไม่รองรับการผูกบัญชี`,
      },
    };
  }

  private toUpstreamPayload(
    p: Record<string, unknown>,
    channelType?: string | null,
  ): { payload?: Record<string, unknown>; error?: LinkError } {
    const { field, error } = this.channelIdField(channelType);
    if (error) return { error };
    const { channel_user_id, ...rest } = p;
    return { payload: { ...rest, [field as string]: channel_user_id } };
  }

  /**
   * Contract validation, run BEFORE an upstream call is spent. `line_user_id`
   * and `web_code` are always supplied by code, never typed by the customer.
   */
  public validateMatchPayload(p: Record<string, unknown>): LinkError | null {
    if (!p['line_user_id'] || !p['web_code']) {
      return {
        code: 'CUSTOMER_LINK_MISSING_IDENTITY',
        message: 'ต้องมีข้อมูลผู้ใช้และ web_code ที่ระบบแนบมา',
      };
    }
    if (!p['phone_number']) {
      return {
        code: 'CUSTOMER_LINK_MISSING_PHONE',
        message: 'phone_number เป็นฟิลด์บังคับ',
      };
    }
    if (!p['first_name'] && !p['account_number']) {
      return {
        code: 'CUSTOMER_LINK_MISSING_SECOND_FACTOR',
        message:
          'ต้องมี first_name หรือ account_number (4 ตัวท้าย) อย่างน้อย 1 อย่าง',
      };
    }
    return null;
  }

  /** The hook's web_code always beats the client's. */
  private effectiveWebCode(
    cfg: LinkConfig,
    clientWebCode: unknown,
  ): string | null {
    return cfg.webCode || (clientWebCode as string) || null;
  }

  /**
   * Idempotency key bound to an INTENT, not to a request: linking this person,
   * with this data, at this OA, within this hour. Pressing the button twice
   * therefore produces the same key — which a random uuid would not.
   */
  private buildIdempotencyKey(input: {
    hook: LeanHook;
    op: string;
    payload: Record<string, unknown>;
  }): string {
    const { hook, op, payload } = input;
    const h = hook || {};
    const identity: Record<string, string> = {
      op,
      hook: asText(h['_id']),
      user: asText(payload['line_user_id'] || payload['channel_user_id']),
      web_code: asText(payload['web_code']),
      phone: asText(payload['phone_number']),
      name: asText(payload['first_name']),
      account: asText(payload['account_number']),
      // Coarse hourly window: same intent inside an hour, new intent across one
      // (so unlink-then-relink tomorrow is not rejected as a duplicate).
      window: new Date().toISOString().slice(0, 13),
    };
    const canonical = Object.keys(identity)
      .sort()
      .map((k) => `${k}=${identity[k]}`)
      .join('|');
    return `zl_${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
  }

  /**
   * One upstream call, translated back into the adapter's
   * `{ ok, status, data | error }`. Never throws for an upstream failure.
   *
   * ⚠️ R10: every path through here fires a real HTTP request at a third party
   * using credentials read from the database. No test in this repo exercises it
   * — see the report's R9 section. Only the rejections ABOVE it are covered.
   */
  private async callUpstream(
    hook: LeanHook,
    op: string,
    payload: Record<string, unknown> = {},
    meta: { adminUserId?: string | null } = {},
  ): Promise<LinkResult> {
    const key = OP_TO_ENDPOINT[op];
    if (!key) {
      return {
        ok: false,
        status: 500,
        error: {
          code: 'CUSTOMER_LINK_UNKNOWN_OP',
          message: `unknown op: ${op}`,
        },
      };
    }

    const tool = await this.getToolForHook(hook);
    if (!tool) {
      return {
        ok: false,
        status: 503,
        error: {
          code: 'CUSTOMER_LINK_NO_TOOL',
          message: 'OA นี้ยังไม่ได้เปิด/ผูก custom tool (หรือ tool ถูกปิดอยู่)',
        },
      };
    }

    const userId = asText(
      payload['line_user_id'] || payload['channel_user_id'],
    );
    // Idempotency keys go on WRITE ops only — a lookup is a read and repeating
    // it has no side effect. The service only uses the key when the endpoint
    // has idempotency switched on.
    const isWriteOp = op !== 'lookup';

    const r = await this.customToolService.call(
      tool as never,
      key,
      userId,
      payload,
      {
        role: OP_TO_ROLE[op],
        ...(isWriteOp
          ? { idempotencyKey: this.buildIdempotencyKey({ hook, op, payload }) }
          : {}),
      },
    );

    let out: LinkResult;
    if (!r?.success) {
      const body = (r?.data || {}) as Record<string, unknown>;
      if (r?.outcome_unknown) {
        // "No answer" must NOT be reported as "failed": the upstream may have
        // done the work. Saying otherwise invites a duplicate retry.
        out = {
          ok: false,
          status: r?.status || 0,
          error: {
            code: 'LINK_TIMEOUT',
            message:
              CANONICAL_LINK_ERRORS['LINK_TIMEOUT'] ||
              'หมดเวลารอปลายทาง (ผลลัพธ์ไม่แน่นอน)',
            failure_type: 'transient',
            outcome_unknown: true,
            retried: r?.idempotent_retry || 0,
          },
        };
      } else if (r?.error && CANONICAL_LINK_ERRORS[r.error]) {
        // The endpoint's result_rules produced a verdict, which this service's
        // CustomToolService already folded into `error` as the canonical code.
        out = {
          ok: false,
          status: r?.status || 0,
          error: {
            code: r.error,
            message:
              ((body['error'] as Record<string, unknown>)?.[
                'message'
              ] as string) ||
              (body['message'] as string) ||
              CANONICAL_LINK_ERRORS[r.error] ||
              r.error,
            failure_type: 'business',
          },
        };
      } else {
        out = {
          ok: false,
          status: r?.status || 0,
          error: {
            code:
              ((body['error'] as Record<string, unknown>)?.[
                'code'
              ] as string) || 'CUSTOMER_LINK_UPSTREAM_ERROR',
            message:
              ((body['error'] as Record<string, unknown>)?.[
                'message'
              ] as string) ||
              (body['message'] as string) ||
              r?.error ||
              'upstream error',
          },
        };
      }
    } else {
      // 2xx with `success:false` in the body = a business rejection.
      const d = r.data as Record<string, unknown> | null;
      out = {
        ok: d?.['success'] !== false,
        status: r.status,
        data: d?.['data'] ?? d,
        ...(d?.['success'] === false
          ? {
              error: {
                code:
                  ((d['error'] as Record<string, unknown>)?.[
                    'code'
                  ] as string) || 'CUSTOMER_LINK_UPSTREAM_ERROR',
                message:
                  ((d['error'] as Record<string, unknown>)?.[
                    'message'
                  ] as string) ||
                  (d['message'] as string) ||
                  'upstream rejected',
              },
            }
          : {}),
      };
    }

    // Log every call, success and error alike. On error the id is awaited so it
    // can be shown on the landing page; on success it is fire-and-forget so the
    // customer is not made to wait for a log write.
    const logId = await this.logUpstreamCall({
      hook,
      op,
      payload,
      toolName: (tool as { name?: string }).name,
      result: r,
      out,
      adminUserId: meta.adminUserId || null,
      awaitWrite: !out.ok,
    });
    if (!out.ok && logId && out.error) out.error.log_id = logId;

    return out;
  }

  /**
   * One webhook-log row per upstream call. Raw request and response are stored
   * unredacted on purpose — only `webhook_log.manage` can read them — and a
   * failure here is swallowed: a broken log must never stop a customer linking.
   */
  private async logUpstreamCall(input: {
    hook: LeanHook;
    op: string;
    payload: Record<string, unknown>;
    toolName?: string;
    result: CallResult;
    out: LinkResult;
    adminUserId: string | null;
    awaitWrite: boolean;
  }): Promise<string | null> {
    const { hook, op, payload, toolName, result, out, adminUserId } = input;
    const h = hook || {};
    const isOk = out.ok === true;

    const write = async (): Promise<string | null> => {
      try {
        /* [FEAT-20260827-WLOGONEDOOR] the `as never` casts here are gone, not
           lost: they existed only to satisfy `Model<WebhookLog>`'s typed
           `create`. The door takes `Record<string, unknown>`, so eslint now
           calls them unnecessary assertions. TYPE-ONLY — the values written are
           byte-identical, pinned by webhook-log-door-parity. */
        const doc = (await this.wlog.persist({
          hook_id: h['_id'],
          hook_alias: h['alias'],
          // [FIX-20260818-GROUPFIELD] read `group` — the Hook has no `group_id`,
          // so this stamped null on every row. The column here is real; the
          // value was not.
          group_id: h['group'] ?? null,
          channel: 'customer_link',
          action_type: `customer_link_${op}`,
          method: 'POST',
          endpoint: result?.url || '',
          status: isOk ? 'success' : 'error',
          http_status:
            typeof result?.status === 'number' ? result.status : undefined,
          error_code: isOk ? undefined : out.error?.code,
          error_message: isOk ? undefined : out.error?.message,
          duration_ms:
            typeof result?.duration === 'number' ? result.duration : undefined,
          raw_request: payload,
          raw_response: result?.data,
          retries:
            typeof result?.idempotent_retry === 'number'
              ? result.idempotent_retry
              : undefined,
          request_meta: {
            tool_name: toolName || null,
            op,
            line_user_id:
              payload['line_user_id'] || payload['channel_user_id'] || null,
            admin_user_id: adminUserId || null,
            actor: adminUserId ? 'admin' : 'customer',
            outcome: isOk
              ? 'success'
              : out.error?.outcome_unknown
                ? 'unknown'
                : 'failed',
            failure_type: isOk ? undefined : out.error?.failure_type,
            idempotency_enabled: result?.idempotency_enabled === true,
          },
          reference_id:
            payload['line_user_id'] || payload['channel_user_id'] || undefined,
        })) as unknown as { _id?: unknown } | null;
        return doc?._id ? asText(doc._id) : null;
      } catch (e) {
        this.logger.error(
          `[CLINKLOG] เขียน webhook log ไม่สำเร็จ (flow ลูกค้าไม่กระทบ): ${(e as Error).message}`,
        );
        return null;
      }
    };

    if (!input.awaitWrite) {
      void write();
      return null;
    }
    return write();
  }

  /** Read-only lookup by the linking key pair. */
  public async lookup(
    input: { channel_user_id?: unknown; web_code?: unknown },
    ctx: { hook?: LeanHook; channelType?: string | null } = {},
  ): Promise<LinkResult> {
    const cfg = this.resolveConfig(ctx.hook ?? null);
    const wc = this.effectiveWebCode(cfg, input.web_code);
    if (!input.channel_user_id || !wc) {
      return {
        ok: false,
        status: 400,
        error: {
          code: 'CUSTOMER_LINK_MISSING_IDENTITY',
          message: 'ต้องมีข้อมูลผู้ใช้และ web_code',
        },
      };
    }
    const hookChannel = (ctx.hook as Record<string, unknown> | null)?.[
      'channel_type'
    ] as string | undefined;
    const { payload, error } = this.toUpstreamPayload(
      { channel_user_id: input.channel_user_id, web_code: wc },
      ctx.channelType || hookChannel,
    );
    if (error) return { ok: false, status: 400, error };
    return this.callUpstream(ctx.hook ?? null, 'lookup', payload);
  }

  /** Bind a channel id to one exact person. */
  public async match(
    input: Record<string, unknown>,
    /* [FIX-20260819-MATCHACTOR] `adminUserId` belongs here, exactly as it does on
       `edit()` and `adminUnlinkUpstream()`. The controller has always passed it
       (`customer-link.controller.ts` builds one ctx and hands it to whichever of
       the two runs) — this signature just never named it, so it was dropped in
       silence and every admin-made registration was logged as the customer's own.
       TypeScript could not catch it: the controller passes a variable, not an
       object literal, so excess-property checking never fires.
       admin กดให้ = ต้องรู้ว่าใครกด · ตกหล่นแล้วย้อนหลังไม่ได้. */
    ctx: {
      hook?: LeanHook;
      channelType?: string | null;
      adminUserId?: string | null;
    } = {},
  ): Promise<LinkResult> {
    const cfg = this.resolveConfig(ctx.hook ?? null);
    const hookChannel = (ctx.hook as Record<string, unknown> | null)?.[
      'channel_type'
    ] as string | undefined;
    const { payload, error } = this.toUpstreamPayload(
      { ...input, web_code: this.effectiveWebCode(cfg, input['web_code']) },
      ctx.channelType || hookChannel,
    );
    if (error) return { ok: false, status: 400, error };
    const invalid = this.validateMatchPayload(payload!);
    if (invalid) return { ok: false, status: 400, error: invalid };

    const userId = asText(
      payload!['line_user_id'] || payload!['channel_user_id'],
    );
    // [FIX-20260812-PUSHDEDUP] เช็ค "ผูกอยู่ก่อนแล้วไหม" **ก่อน** callUpstream/refresh
    //   เพื่อกัน push ซ้ำ (review H1/H2): member `/match` มี alreadyLinked guard ที่
    //   controller (409 ก่อนถึงที่นี่) แต่ **register `/admin/edit` ไม่มี** — admin กด
    //   register 2 ครั้ง / token replay ใน TTL ⇒ upstream idempotent (ไม่ผูกซ้ำ) แต่
    //   pushLinkedNotice เดิมยิงทุก res.ok ⇒ ลูกค้าได้ 2 ข้อความ + 2 bot row + 2 reg_push.
    //   แก้: push เฉพาะ **first-link** (raw_profile ยังว่างก่อน match นี้). เช็คก่อน
    //   refreshStoredProfile ด้านล่างที่จะเขียน raw_profile (หลังจากนั้น alreadyLinked=true เสมอ).
    //   flow ไม่พัง: member ปกติ raw_profile ว่าง ⇒ push เหมือนเดิม · เฉพาะกดซ้ำถึง skip.
    //   best-effort: เช็คล้ม (DB) ⇒ alreadyLinked คืน false ⇒ push (fail-open, ยอมซ้ำดีกว่าเงียบ).
    const wasLinkedBefore = userId ? await this.alreadyLinked(userId) : false;

    // [FIX-20260819-MATCHACTOR] same 4th argument `edit()` passes — this is what
    // decides `actor: 'admin' | 'customer'` on the webhook-log row.
    const res = await this.callUpstream(ctx.hook ?? null, 'match', payload, {
      adminUserId: ctx.adminUserId ?? null,
    });

    // On a successful link, refresh the stored profile immediately so the admin
    // panel is not blank until the customer happens to chat again. Wrapped so
    // that a failure here stays invisible — the link already happened upstream.
    const h = ctx.hook || {};
    if (res?.ok && h['custom_tool_status'] === true && h['custom_tool_id']) {
      if (userId) {
        await this.refreshStoredProfile(userId, ctx.hook ?? null);
        void this.publishProfileEvent(h['_id'], userId, 'linked', false);
      }
    }
    // [FEAT-20260811-SUCCESSPUSH] ผูกสำเร็จ → push แจ้งลูกค้าในแชต LINE (best-effort).
    // เจ้าของสั่ง: landing ไม่โชว์ modal แล้ว ข้อความจึงมาทางนี้แทน. ยิงเมื่อ res.ok
    //   เท่านั้น (match จริงสำเร็จ) และไม่ผูกกับ custom_tool (ต่างจาก refresh ข้างบน
    //   ที่ต้องมี tool) — push แค่ต้องมี access_token ของ hook. void = ไม่รอผล,
    //   helper กลืน error เอง จึงไม่ยืดเวลา response และไม่ทำให้ match กลายเป็น fail.
    // [FIX-20260812-PUSHDEDUP] + `!wasLinkedBefore` — push เฉพาะครั้งแรกจริง (กันซ้ำ).
    if (res?.ok && userId && !wasLinkedBefore) {
      void this.pushLinkedNotice(ctx.hook ?? null, userId);
    }

    /* [FEAT-20260819-REGSOURCE] record WHO registered this customer, once.
       Placed here and not inside `refreshStoredProfile` on purpose: that method
       is gated on the hook having a custom tool (`custom_tool_status` /
       `custom_tool_id`) and only writes when the upstream profile actually
       yielded something, so a hook without a tool would never be stamped — and
       `edit()` calls it too, which would stamp a link that already existed.
       This is the only line reached by BOTH registration paths and by neither
       edit nor unlink. เส้นเดียวที่ทั้งลูกค้ากดเองและแอดมินกดให้ ผ่านแน่นอน.
       `void` + best-effort inside: the link already exists upstream, so a failed
       label must never turn a successful registration into an error. */
    if (res?.ok && userId) {
      void stampLinkRegistration(
        { channelUserId: userId, adminUserId: ctx.adminUserId ?? null },
        {
          memberModel: this.memberModel as never,
          warn: (msg) => this.logger.warn(msg),
        },
      );
      /* [FEAT-20260820-CLEARONLINK] a customer who just registered is not stuck
         any more, so the follow-up mark comes off HERE rather than waiting for
         their next message to reach the webhook's gate. Same `void` + best-effort
         rule as the stamp above: the link already exists upstream, and failing to
         tidy a mark must never turn a successful registration into an error.
         Deliberately NOT told which key to remove — the helper owns that list,
         and it never touches the `request_reg_at` record.
         revert: delete this call and `clear-follow-up-on-register.helper.ts`;
         the webhook gate goes on clearing the mark on the next event exactly as
         it did before. ถอด = ลบบรรทัดนี้กับไฟล์เดียว ระบบกลับเป็นเหมือนเดิม. */
      void clearFollowUpOnLinkRegistered(
        { channelUserId: userId },
        {
          memberModel: this.memberModel as never,
          warn: (msg) => this.logger.warn(msg),
        },
      );
    }
    return res;
  }

  /** Admin re-binds an existing link to the person who just verified. */
  public async edit(
    input: Record<string, unknown>,
    ctx: {
      hook?: LeanHook;
      channelType?: string | null;
      adminUserId?: string | null;
    } = {},
  ): Promise<LinkResult> {
    const cfg = this.resolveConfig(ctx.hook ?? null);
    const hookChannel = (ctx.hook as Record<string, unknown> | null)?.[
      'channel_type'
    ] as string | undefined;
    const { payload, error } = this.toUpstreamPayload(
      { ...input, web_code: this.effectiveWebCode(cfg, input['web_code']) },
      ctx.channelType || hookChannel,
    );
    if (error) return { ok: false, status: 400, error };
    // Same rules as match — an admin must fill in what a customer would have.
    const invalid = this.validateMatchPayload(payload!);
    if (invalid) return { ok: false, status: 400, error: invalid };
    return this.callUpstream(ctx.hook ?? null, 'edit', payload, {
      adminUserId: ctx.adminUserId ?? null,
    });
  }

  /** Admin unlinks. The channel id always goes along, even where unused. */
  public async adminUnlinkUpstream(
    input: Record<string, unknown>,
    ctx: {
      hook?: LeanHook;
      channelType?: string | null;
      adminUserId?: string | null;
    } = {},
  ): Promise<LinkResult> {
    const cfg = this.resolveConfig(ctx.hook ?? null);
    const hookChannel = (ctx.hook as Record<string, unknown> | null)?.[
      'channel_type'
    ] as string | undefined;
    const { payload, error } = this.toUpstreamPayload(
      { ...input, web_code: this.effectiveWebCode(cfg, input['web_code']) },
      ctx.channelType || hookChannel,
    );
    if (error) return { ok: false, status: 400, error };
    if (!payload!['phone_number']) {
      return {
        ok: false,
        status: 400,
        error: {
          code: 'CUSTOMER_LINK_MISSING_PHONE',
          message: 'phone_number เป็นฟิลด์บังคับ',
        },
      };
    }
    return this.callUpstream(ctx.hook ?? null, 'unlink', payload, {
      adminUserId: ctx.adminUserId ?? null,
    });
  }

  /**
   * Config visibility for `/health`. No secret value ever appears here — only
   * the shape of what is configured.
   */
  public async describe(hook: LeanHook): Promise<Record<string, unknown>> {
    const cfg = this.resolveConfig(hook);
    const base = {
      enabled: cfg.enabled,
      has_tool: cfg.hasTool,
      tool_id: cfg.toolId,
      web_code_source: cfg.webCode ? 'hook' : 'client',
      credential_source: 'custom_tool',
    };

    if (!cfg.hasTool) {
      return { ...base, target: '(ยังไม่ได้ผูก custom tool)', endpoints: [] };
    }

    const tool = await this.getToolForHook(hook);
    if (!tool) {
      return { ...base, target: '(tool ถูกปิดหรือถูกลบ)', endpoints: [] };
    }

    return {
      ...base,
      tool_name: tool.name,
      target: tool.base_url,
      auth_type: tool.auth_type,
      timeout_ms: tool.timeout_ms,
      // Which routes this tool has — nothing secret in any of these.
      endpoints: (tool.endpoints || [])
        .filter((e) => e.status !== false)
        .map((e) => ({
          key: e.key,
          method: e.method,
          path: e.path,
          purpose: e.purpose,
          require_jwt: e.require_jwt,
          is_login: e.is_login,
          is_refresh: e.is_refresh,
          is_profile: e.is_profile,
        })),
    };
  }

  /**
   * true/false per role for the Ticket-page buttons. Deliberately NOT
   * `CustomToolService.describeRoles` — that one returns `role -> key` and does
   * no fallback, while legacy's returns `{role, configured}` resolved by role
   * with a fallback key. Reproduced here from `findByRole`, which IS shared.
   */
  public async capabilities(hook: LeanHook): Promise<Record<string, boolean>> {
    const tool = await this.getToolForHook(hook);
    if (!tool) {
      // Not an error — "this OA can do nothing yet" is the correct answer.
      return {
        has_tool: false,
        profile: false,
        link: false,
        edit: false,
        unlink: false,
      };
    }
    const caps: Record<string, boolean> = { has_tool: true };
    for (const role of CAPABILITY_ROLES) {
      caps[role] = !!this.customToolService.findByRole(
        tool as never,
        role,
        ROLE_FALLBACK_KEY[role] ?? null,
      );
    }
    return caps;
  }

  // ───────────────────────────────────────────────────────────────────────
  // MEMBER-SIDE SIDE EFFECTS
  // ───────────────────────────────────────────────────────────────────────

  /**
   * `raw_profile_data` alone means "we fetched this customer's profile from
   * upstream at least once". `full_name` is deliberately excluded: an admin can
   * type that by hand, which does not prove a successful link.
   *
   * Read-only, and a failure falls through to the normal path — better to let a
   * duplicate attempt reach upstream than to block someone who never linked.
   */
  /**
   * ==== [FIX-20260818-BODYOPERATOR] audit_18_aug M20 — the value is coerced HERE.
   *
   * `POST /customer-link/match` is `@Public()`, and its channel id reached this
   * method through a bare TypeScript cast, which does nothing at runtime. A JSON
   * body carries real nested objects, so `{"channel_user_id":{"$regex":"^U1a2b"}}`
   * arrived as an object and Mongo read it as an operator expression against a
   * plain String property. The 409-vs-anything-else answer then walked LINE user
   * ids one character at a time, with no account at all.
   *
   * The coercion sits at the SINK rather than in the controller for two reasons:
   * `asText` is module-local here, so guarding upstream would have meant
   * exporting a helper purely to reach it; and any future caller of this method
   * is protected without having to remember. `asText` turns an object into a
   * harmless string, which matches nothing — the query still runs, and finds
   * no one.
   *
   * The parameter is `unknown` on purpose: it says what actually arrives, so the
   * next reader cannot mistake the old cast for a guarantee.
   *
   * revert: take the parameter back to `string` and drop the `asText` call.
   */
  public async alreadyLinked(channelUserId: unknown): Promise<boolean> {
    try {
      const existing = await this.memberModel
        .findOne({ line_user_id: asText(channelUserId) })
        .select('raw_profile_data')
        .lean()
        .exec();
      return !!(existing as { raw_profile_data?: unknown } | null)
        ?.raw_profile_data;
    } catch (err) {
      this.logger.warn(
        `[CUSTOMER-LINK] already-linked check failed (continuing): ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Pull the newest profile over the stored one. Never fails the request. */
  public async refreshStoredProfile(
    channelUserId: string,
    hook: LeanHook,
  ): Promise<void> {
    const h = hook || {};
    if (!h['custom_tool_status'] || !h['custom_tool_id']) return;
    try {
      const combined = await this.customToolService.getCombinedData(
        channelUserId,
        hook,
      );
      const tool = await this.getToolForHook(hook);
      const p = this.customToolService.extractProfile(
        combined as never,
        tool as never,
      );
      const set: Record<string, string> = {};
      // "N/A" means extractProfile found nothing — never write it over real data.
      if (p.name && p.name !== 'N/A') set['full_name'] = p.name;
      if (p.phone && p.phone !== 'N/A') set['phone_number'] = p.phone;
      if (p.code && p.code !== 'N/A') set['contract_code'] = p.code;
      if (Object.keys(set).length) {
        await this.memberModel
          .updateOne({ line_user_id: channelUserId }, { $set: set })
          .exec();
      }
    } catch (err) {
      this.logger.warn(
        `[CUSTOMER-LINK] refresh profile after admin action failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Clear what the link produced: raw profile, phone, real name, contract code.
   * `nickname` / `detail` are left alone — an admin typed those, different
   * source of truth.
   */
  /**
   * [FIX-20260818-BODYOPERATOR] The most serious of the three sinks: this one
   * WRITES. An operator reaching the filter would `$unset` the stored profile of
   * rows the caller never named, not merely read them.
   */
  public async clearStoredProfile(channelUserId: unknown): Promise<void> {
    try {
      await this.memberModel
        .updateOne(
          { line_user_id: asText(channelUserId) },
          {
            $unset: {
              raw_profile_data: '',
              full_name: '',
              phone_number: '',
              contract_code: '',
              /* [FEAT-20260819-REGSOURCE] the stamp describes THIS link, so it
                 goes when the link goes. Leaving it would make a customer who
                 unlinks and registers again keep the first registration's source
                 and time for ever — and the second one would be silently
                 refused, because the stamp is first-writer-wins.
                 ปลดแล้วต้องล้าง ไม่งั้นลงทะเบียนใหม่จะติดค่าเก่า. */
              /* DESTINATION 2 of 7 — the one that is forgotten, because
                 nothing fails when it is. EVERY column the stamp writes must be
                 cleared here too; one left behind survives the unlink and
                 stamps the next registration with the previous answer. The full
                 list is in `src/modules/customer-link/registration-stamp.helper.ts`. */
              link_registered_by: '',
              link_registered_at: '',
            },
          },
        )
        .exec();
    } catch (err) {
      this.logger.warn(
        `[CUSTOMER-LINK] clear stored profile failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Push to open screens. Always fired AFTER the write it announces — firing
   * first lets the FE re-read stale data, a race that shows up immediately.
   * No hook id means no scope, so nothing is published (never fan out).
   */
  public async publishProfileEvent(
    hookId: unknown,
    channelUserId: string,
    action: string,
    cleared: boolean,
  ): Promise<void> {
    try {
      if (!hookId || !channelUserId) return;
      await this.realtime.publish('customer:profile_updated', {
        hook_id: asText(hookId),
        channel_user_id: asText(channelUserId),
        action: action || 'updated',
        cleared: cleared === true,
        actor_name: null,
      });
    } catch (err) {
      // Realtime failing must never break account linking.
      this.logger.error(
        `[wsPublisher] customer profile publish error: ${(err as Error).message}`,
      );
    }
  }

  /** Read a hook by id for the admin routes. Malformed id → null, never a 500. */
  /**
   * [FIX-20260818-LINKSCOPE · plan §8 = T3-3, closes audit C2.3] May this admin
   * mint a customer-link token for this OA?
   *
   * `POST /customer-link/admin/token` reads `hook_id` from the REQUEST BODY, and
   * the token it mints lets the holder register or EDIT that customer's identity
   * with the OA's upstream. Without this, an operator of one OA could name
   * another OA's hook and take over its customers' profiles. The check lives here
   * because the Hook model is already injected in this service.
   */
  public async adminMayUseHook(
    auth: AuthenticatedUser | undefined,
    hookId: unknown,
  ): Promise<boolean> {
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    return !isHookOutOfScope(allowed, hookId);
  }

  public async findHookById(hookId: unknown): Promise<LeanHook> {
    if (!isValidObjectId(hookId)) return null;
    try {
      return (await this.hookModel
        .findById(asText(hookId))
        .lean()
        .exec()) as LeanHook;
    } catch (err) {
      this.logger.warn(
        `[CUSTOMER-LINK] hook lookup failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}

/** The slice of a custom tool this module reads. */
interface CustomToolLike {
  name?: string;
  base_url?: string;
  auth_type?: string;
  timeout_ms?: number;
  endpoints?: Array<{
    key?: string;
    method?: string;
    path?: string;
    purpose?: string;
    require_jwt?: boolean;
    is_login?: boolean;
    is_refresh?: boolean;
    is_profile?: boolean;
    status?: boolean;
    role?: string;
  }>;
}
