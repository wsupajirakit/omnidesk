/**
 * [PROG-20260905-G45] Send the AI answer, then make the record match it.
 *
 * WHAT MOVED. The `try { … } catch (axiosErr) { … }` that sat at the bottom of the spine:
 * mint the customer-helper link, choose between the profile card / the helper card / plain
 * text, send it, and then reconcile four separate records with what actually went out.
 * The guards ABOVE it stayed in the spine — the empty-reply return and the staleness guard
 * decide WHETHER to send, and when a gate fires is a gate-order fact, not this file's.
 *
 * ⚠️ THE ORDER AFTER THE SEND IS LOAD-BEARING, and every step says why:
 *      send → helper-trigger stamp → sent-id stamp → quick-reply history → flex history
 *      → success row
 *   Everything after the send is fire-and-forget EXCEPT the flex-history rewrite and the
 *   log row, and that asymmetry is deliberate: the customer already has the message, so a
 *   failed record must cost a record and never a reply.
 *
 * ⚠️ TWO OF THE REWRITES ARE CHAINED OFF `categorySettled`, NOT WRITTEN AT LOG TIME. The
 *   category analyser reads the bot's own rows and filters on `message_type === 'text'`;
 *   rewriting content or flipping the type before it runs would silently change which
 *   category it assigns — a change to a different feature. Chaining off the real promise is
 *   not a timing guess, it removes the race.
 *
 * ⚠️ THE CATCH RETHROWS, AND THAT IS THE CONTRACT. `legacy:4946` — the error row is written
 *   here, then the exception continues to the spine's outer catch, which logs it again as
 *   `handle_webhook` and answers OK. A handler that swallowed it would lose the second row
 *   and change what the caller sees.
 *
 * ⚠️ Collaborators arrive through `deps`; the pure builders and the sibling role files are
 * imported directly, because they are not the service.
 */

import type { Model } from 'mongoose';

import { sentMessageIds } from '@/infra/line';

import { stampCustomerHelperTrigger } from '../follow-up';
import {
  buildSendErrorRow,
  buildSendSuccessRow,
} from '../logging/send-outcome-rows';
import { rewriteFlexHistory } from '../post-send/flex-history-rewrite';
import type { FlexCardKind } from '../flex/flex-history-meta';
import type { FlexReplyOut } from '../flex/flex-reply-out';
import type { ScopedEventData } from '@/infra/realtime/realtime-publisher.service';

import { buildCustomerHelperQuickReply } from '../hook-reply/reply-tags.util';
import { buildCustomerRegisterUrl } from '../hook-reply/customer-register.handler';
import { resolveCustomerHelperFlex } from '../hook-reply/customer-helper-flex';

type Doc = Record<string, unknown>;

/** What a send returns, as the spine's own senders shape it. */
export interface AiSendResponse {
  status?: number;
  data?: unknown;
  /** [FEAT-20260830-REPLYPUSH] set only by the ladder — see `send-outcome-rows.ts`. */
  via?: string;
}

export interface SendAiReplyInput {
  hook: Doc | null | undefined;
  /** `event.source?.userId` — the LINE id a push needs. */
  userId?: string;
  replyToken?: string;
  eventId?: string;
  /** The AI text as it will be SENT (markers stripped). */
  replyBody: string;
  /**
   * The AI text as it was WRITTEN, markers and all — the history rewrite reads it.
   *
   * ⚠️ Required KEY, nullable VALUE. The spine holds it as `string | null`, and typing it
   * `?: string` compiled only until the call site was written. Optional would also let a
   * future edit drop it entirely, which is the omission this shape refuses.
   */
  replyText: string | null | undefined;
  /** `[[[customer-helper]]]` fired: offer the register button. */
  useHelperQr: boolean;
  /** The profile/menu card the AI produced, when it produced one. */
  flexProfileContents: Doc | null;
  /**
   * Which kind of card `flexProfileContents` is — `'menu'` changes the altText.
   *
   * ⚠️ Typed as the REAL union, not `string`. This value is forwarded to
   * `rewriteFlexHistory`, whose own contract takes `FlexCardKind | null | undefined`, and
   * the first version of this file widened it to `string` and then cast the whole args
   * object `as never` at the call. That cast turns off checking for EVERY field at once —
   * a renamed or missing property would have compiled silently. Narrow types here, no cast
   * there. อย่ากลบด้วย never ทั้งก้อน
   */
  flexKind: FlexCardKind | null | undefined;
  /** The rendered card's own operator-facing name, already captured upstream. */
  flexOut: FlexReplyOut;
  /** The bot's chat row, written BEFORE the send so a refused reply still leaves a trace. */
  botChatMsg: { _id?: unknown; room_id?: unknown } | null;
  /** The category analyser's promise. Two rewrites wait on it — see the header. */
  categorySettled: Promise<unknown>;
  /** The AI answer carried into `response_summary` on the success row. */
  responseAi?: unknown;
  /** Built by the caller, shared by both log rows verbatim. */
  linePayload: unknown;
  logContext: Doc;
  /** `LINE_REPLY_ENDPOINT` and `HELPER_ALT_TEXT` — passed so this file redeclares nothing. */
  endpoint: string;
  helperAltText: string;
}

export interface SendAiReplyDeps {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  errText: (err: unknown) => string;
  /** `this.customerLink.mintLinkToken(...)` — throwing is expected and handled. */
  mintLinkToken: (args: {
    hookId: unknown;
    channelUserId: unknown;
    channelType: string;
  }) => string | null;
  /** `this.flexModel.findById(id).lean().exec()`. */
  findFlexById: (id: unknown) => Promise<Doc | null>;
  sendFlexReply: (
    replyToken: string,
    contents: Doc,
    altText: string,
    quickReply: unknown,
    userId: string | undefined,
  ) => Promise<AiSendResponse>;
  sendTextReply: (
    replyToken: string,
    text: string,
    quickReply: unknown,
    userId: string | undefined,
  ) => Promise<AiSendResponse>;
  /** Awaited: both rows must exist before the turn ends. */
  emitWlog: (row: Doc) => Promise<void>;
  /**
   * The models the stamps and the history rewrite drive.
   *
   * 🔴 THESE WERE ALL TYPED `never` IN THE FIRST VERSION, WHICH CHECKS NOTHING. `never` is
   * the bottom type: it is assignable to every parameter, so a dep of the wrong shape —
   * or of no shape at all — satisfied the contract silently, and the calls downstream then
   * needed `as never` casts of their own to compile. Two wrongs reading as one convention.
   * Typed structurally instead, to the minimum each collaborator actually uses; `Model` is
   * imported from mongoose because `stampCustomerHelperTrigger` genuinely wants one.
   */
  memberModel: Model<Record<string, unknown>>;
  chatMessageModel: {
    updateOne: (filter: Doc, update: Doc) => { exec: () => Promise<unknown> };
  };
  chatRoomModel: {
    updateOne: (filter: Doc, update: Doc) => { exec: () => Promise<unknown> };
  };
  /** Optional at the seam, as everywhere else in this module. */
  realtimePublisher?: {
    publish: (event: string, payload: ScopedEventData) => Promise<unknown>;
  };
}

export async function sendAiReply(
  input: SendAiReplyInput,
  deps: SendAiReplyDeps,
): Promise<void> {
  const { hook, userId, useHelperQr, flexProfileContents, botChatMsg } = input;
  const lineStart = Date.now();

  try {
    /* ─────────────────────────────────────────────────────────────────
     * [FEAT-20260810-HELPERFLEX] BLOCK 1 of 2 — mint URL + สร้างการ์ด
     *
     * WHAT: เมื่อ AI ตอบพร้อม tag `[[[customer-helper]]]` (= `useHelperQr`) ให้ตอบเป็น
     *       **การ์ด flex** แทนข้อความ+quick reply แบบเดิม
     * WHY:  เจ้าของสั่งว่าเคสนี้ต้องตอบ flex เพราะปุ่มบนการ์ดเห็นชัดกว่า quick reply
     *       ที่ลอยอยู่ล่างจอและหายไปเมื่อลูกค้าพิมพ์อย่างอื่น
     * HOW:  ใช้เส้น mint เดิมทั้งหมด — `mintLinkToken` + `buildCustomerRegisterUrl`
     *       ตัวเดียวกับ customer-register.handler.ts ⇒ token/TTL/รูปแบบ URL เหมือนกันเป๊ะ
     * FAIL-SAFE: mint พังหรือ OA ไม่ได้ตั้ง landing url ⇒ ยังส่งการ์ด แต่ปุ่มชี้
     *       HELPER_FALLBACK_URI ตามที่เจ้าของสั่ง — ตั้งใจให้ "ดูออกว่าลืมตั้งค่า"
     * ───────────────────────────────────────────────────────────────── */
    let helperFlexContents: Doc | null = null;
    if (useHelperQr) {
      let helperUri: string | null = null;
      try {
        const helperToken = deps.mintLinkToken({
          hookId: hook?.['_id'],
          channelUserId: userId,
          channelType: 'line',
        });
        if (helperToken) {
          helperUri = buildCustomerRegisterUrl(
            hook?.['customer_link_landing_url'] as string | null,
            helperToken,
          );
        }
      } catch (mintErr) {
        // mint พังต้องไม่ทำให้ลูกค้าไม่ได้คำตอบ — ปล่อยเป็น null แล้วให้
        // การ์ดใช้ fallback URI แทน
        deps.warn(`[HELPERFLEX] mint failed: ${(mintErr as Error).message}`);
      }
      /* [FEAT-20260810-CUSHELPERTYPE] ใช้การ์ดที่ OA ผูกไว้ก่อน
         (hook.flex_customerhelper_id) ไม่มี/ใช้ไม่ได้ ⇒ ตกกลับการ์ด hard-code
         ตรรกะการเลือก + perm gate อยู่ใน customer-helper-flex.ts ทั้งหมด */
      helperFlexContents = await resolveCustomerHelperFlex(hook, helperUri, {
        findFlexById: (id) => deps.findFlexById(id),
        warn: (m: string) => deps.warn(m),
      });
    }

    /* โค้ดเดิม: quick reply. ยังอยู่ครบและยังทำงานเมื่อ tag ไม่ติด — เก็บไว้เพื่อ revert
       ได้ทันทีโดยไม่ต้องกู้โค้ด.
       UNPORTED — `buildCustomerHelperRegisterUri` (legacy:4776) minted the token for this
       button's URI. `buildCustomerHelperQuickReply` is ported and handles a null URI, which
       is legacy's own behaviour when the mint fails. */
    const helperQuickReply = useHelperQr
      ? buildCustomerHelperQuickReply(null)
      : null;

    /* [FEAT-20260810-HELPERFLEX] BLOCK 2 of 2 — เลือกว่าจะส่งอะไร
     *
     * ลำดับความสำคัญ (บนสุดชนะ):
     *   1. flexProfileContents  — การ์ดโปรไฟล์ที่ AI สร้าง (ของเดิม ไม่แตะ)
     *   2. helperFlexContents   — การ์ด customer-helper (ของใหม่)
     *   3. ข้อความธรรมดา        — ของเดิม
     *
     * ⚠️ ทำไมการ์ดโปรไฟล์ต้องมาก่อน: มันคือ "คำตอบ" ของคำถามลูกค้าโดยตรง ส่วน helper เป็น
     * แค่ข้อเสนอให้เชื่อมข้อมูล ถ้าสลับลำดับ ลูกค้าจะไม่ได้คำตอบที่ถาม — และในเคสนั้น quick
     * reply เดิมยังพ่วงไปกับการ์ดโปรไฟล์อยู่ ⇒ ปุ่มเชื่อมข้อมูลไม่หายไปไหน
     *
     * [FEAT-20260830-REPLYPUSH] THE ONE SITE THAT OPTS INTO THE LADDER. Passing `userId`
     * turns the send into reply → (only if LINE refuses) push. Every other send omits it and
     * is unchanged. WHY HERE: this is the seam that answers the customer's question, and a
     * refused reply token used to end as a throw with nothing sent — the rows show LINE
     * answering `400 Invalid reply token` on exactly this path. */
    const lineResponse = flexProfileContents
      ? await deps.sendFlexReply(
          input.replyToken ?? '',
          flexProfileContents,
          /* [FIX-20260901-MENUKINDMISSING] `'ข้อมูลของคุณ'` is the PROFILE card's label, and
             until the menu rung became reachable it was the only card that could arrive here
             with an empty body. A menu card now can — a field holding only the marker strips
             to `''` — and it would go out announced as "your information", which is what the
             customer reads in the chat list and in the push notification.
             ⚠️ Scoped to `'menu'` ONLY; the other kinds keep the literal byte-for-byte. */
          (
            input.replyBody ||
            (input.flexKind === 'menu'
              ? input.flexOut.name || input.helperAltText
              : 'ข้อมูลของคุณ')
          ).slice(0, 400),
          helperQuickReply,
          userId,
        )
      : helperFlexContents
        ? await deps.sendFlexReply(
            input.replyToken ?? '',
            helperFlexContents,
            (input.replyBody || input.helperAltText).slice(0, 400),
            null,
            userId,
          )
        : await deps.sendTextReply(
            input.replyToken ?? '',
            input.replyBody,
            helperQuickReply,
            userId,
          );

    /* [FEAT-20260825-HELPERTRIGGER] ประทับเวลาที่เสนอ customer-helper
       🔴 SEAMLESS — บล็อกนี้ต้องไม่ทำให้ลูกค้าเสียคำตอบเด็ดขาด: อยู่ **หลัง** ส่งเสร็จแล้ว ·
       `void` ⇒ ไม่ await ⇒ ช้าแค่ไหนก็ไม่กระทบเวลาตอบ · error ถูกกลืนในตัว helper ⇒ จดไม่
       สำเร็จ = เสียบันทึก ไม่ใช่เสียคำตอบ.
       ⚠️ **เงื่อนไขไม่ได้อยู่ที่นี่** — อยู่ที่ `customer-helper-trigger.rule.ts` ตามที่เจ้าของ
          สั่งว่าต้องแก้ไขได้ ไม่ใช่ hard code · ที่นี่ทำหน้าที่เดียวคือส่งข้อเท็จจริงสองอย่างให้
          กฎตัดสิน: เสนอไหม (`useHelperQr`) และ LINE รับไหม (2xx)
       ⚠️ ทับเวลาเดิมทุกครั้งโดยตั้งใจ ⇒ ตอบคำถาม "เสนอครั้งล่าสุดเมื่อไหร่" */
    void stampCustomerHelperTrigger({
      memberModel: deps.memberModel,
      channelUserId: userId ?? '',
      offered: useHelperQr,
      sent:
        typeof lineResponse?.status === 'number' &&
        lineResponse.status >= 200 &&
        lineResponse.status < 300,
      warn: (m: string) => deps.warn(m),
    });

    /* [FEAT-20260831-QUOTESRC] stamp the AI reply's row with the ids LINE just returned —
       the one bot path whose row is written BEFORE the send (deliberately: a refused reply
       must still leave a transcript), so it cannot pass them into `logMessage` the way its
       siblings do.
       ⚠️ NOT chained off `categorySettled`, unlike the two rewrites below: the analyser reads
          `content` and `message_type`, neither of which this touches.
       ⚠️ `$set` is built from what came back — a refused send yields no keys and no write at
          all. ส่งไม่ผ่าน = ไม่เขียนอะไรเพิ่มเลย. */
    const aiSentIds = sentMessageIds(lineResponse);
    if (botChatMsg?._id) {
      const stamp: Doc = {
        ...(aiSentIds.providerMsgId
          ? { provider_msg_id: aiSentIds.providerMsgId }
          : {}),
        ...(aiSentIds.quoteToken ? { quote_token: aiSentIds.quoteToken } : {}),
      };
      if (Object.keys(stamp).length > 0) {
        void deps.chatMessageModel
          .updateOne({ _id: botChatMsg._id }, { $set: stamp })
          .exec()
          .catch((e: Error) =>
            deps.warn(`[QUOTESRC] sent ids not stamped: ${e.message}`),
          );
      }
    }

    /* [FIX-20260801-HELPERHISTORY] make the stored history match what the customer actually
       received.
       ⚠️ Chained off `categorySettled` rather than written at log time: the analyser reads
          the BOT's messages too, so rewriting the content first would change the category it
          assigns — a change to a different feature.
       [FIX-20260810-HELPERFLEXHISTORY] `&& !helperFlexContents` — a QUICK REPLY cannot be
       stored, so the admin reading history would never know buttons went out. When the reply
       went as a CARD the buttons ARE on the card and the flex-history block below stores it,
       so appending "ปุ่มลงทะเบียน quick reply" would both be untrue and overwrite that row. */
    if (useHelperQr && !helperFlexContents && botChatMsg?._id) {
      const historyContent = `${input.replyBody} ปุ่มลงทะเบียน quick reply `;
      void input.categorySettled
        .catch(() => {})
        .then(() =>
          deps.chatMessageModel
            .updateOne(
              { _id: botChatMsg?._id },
              { $set: { content: historyContent } },
            )
            .exec(),
        )
        .catch((err: Error) =>
          deps.error(`[HELPERQR] แก้ประวัติแชทไม่สำเร็จ: ${err.message}`),
        );
    }

    /* [FIX-20260810-HELPERFLEXHISTORY] the customer-helper card rides the same rewrite.
       ⚠️ Profile keeps PRECEDENCE, mirroring the send order above — whichever card the
       customer actually received is the one stored. */
    const helperCardForHistory = flexProfileContents
      ? null
      : helperFlexContents;
    /* [PROG-20260905-G44] Body in post-send/flex-history-rewrite.ts. The four rules it
       enforces — store the card that was SENT, profile card takes precedence, ONE kind
       derivation read by both the $set and the publish, publish what was stored — are
       written down there, next to the code that keeps them. */
    if ((flexProfileContents || helperCardForHistory) && botChatMsg?._id) {
      await rewriteFlexHistory(
        {
          botChatMsgId: botChatMsg._id,
          botRoomId: botChatMsg.room_id,
          flexProfileContents,
          helperCardForHistory,
          flexKind: input.flexKind,
          flexOut: input.flexOut,
          hook,
          replyBody: input.replyBody,
          replyText: input.replyText,
          categorySettled: input.categorySettled,
        },
        {
          logger: { warn: (m: string) => deps.warn(m) },
          realtimePublisher: deps.realtimePublisher,
          chatMessageModel: deps.chatMessageModel,
          chatRoomModel: deps.chatRoomModel,
        },
      );
    }

    await deps.emitWlog(
      buildSendSuccessRow({
        logContext: input.logContext,
        endpoint: input.endpoint,
        linePayload: input.linePayload,
        eventId: input.eventId,
        replyToken: input.replyToken,
        durationMs: Date.now() - lineStart,
        // The response goes across WHOLE. Splitting it into status/data is how
        // `via` was lost at SP16 — see the builder's header.
        response: lineResponse,
        responseAi: input.responseAi,
      }),
    );
  } catch (axiosErr) {
    await deps.emitWlog(
      buildSendErrorRow({
        logContext: input.logContext,
        endpoint: input.endpoint,
        linePayload: input.linePayload,
        eventId: input.eventId,
        replyToken: input.replyToken,
        durationMs: Date.now() - lineStart,
        error: axiosErr,
        errorMessage: deps.errText(axiosErr),
      }),
    );
    // legacy:4946 — rethrown into the spine's outer catch, which logs it again as
    // `handle_webhook` and then answers OK. Swallowing it here would lose that row.
    throw axiosErr;
  }
}
