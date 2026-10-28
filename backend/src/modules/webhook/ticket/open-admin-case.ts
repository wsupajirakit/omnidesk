import { contactAdminTicketDivider } from '@/modules/payment';
import { openTicketBySystem } from '../../tickets/create-by-admin';

import { sentMessageIds } from '@/infra/line';

import {
  CONTACT_ADMIN_ACK_TEXT,
  CONTACT_ADMIN_TICKET_CATEGORY,
  CONTACT_ADMIN_TICKET_NEED,
} from '@/modules/payment';
import { asString, errText } from '../logging/coerce-mask.util';

type Doc = Record<string, unknown>;

/* Redeclared rather than imported from the service — importing back would be a cycle. */
/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

/**
 * [PROG-20260905-G27] "Contact admin" — the door that opens a case, every time.
 *
 * WHAT IT GUARANTEES, and the order is the guarantee:
 *   1. The customer is acknowledged FIRST. They pressed a button; silence is the one
 *      outcome that makes them press it again.
 *   2. The history row is written BETWEEN the reply and the case, so the operator opening
 *      the case sees what the customer was told.
 *   3. The case opens LAST — and it opens even if the acknowledgement failed. Losing the
 *      reply is bad; losing the case as well is worse than never having had the door.
 *
 * ⚠️ EVERY FAILURE INSIDE IS SWALLOWED, one at a time, each with its own log line naming
 * what was lost and what still happened ("case still opens"). A single try around the
 * whole thing would let a history failure cancel the case.
 *
 * ⚠️ IT CATCHES A BUTTON PRESS, NOT A TYPED PHRASE. Comparing the message text could not
 * tell a press from a customer typing the same words, and the two need different answers.
 *
 * ⚠️ NO ROOM ⇒ NO CASE, logged and returned. A case without a room has nowhere to be read.
 */

export interface AdminCaseArgs {
  userId?: string;
  hook: Doc | null | undefined;
  accessToken: string;
  replyToken?: string;
  channelId?: string;
  logContext: Doc;
  /** `event.postback?.data` — recorded on the row, since postbacks are not stored. */
  postbackData?: string;
  /** `event.eventId`, copied onto the rows. */
  eventId?: string;
  /** The room the case belongs to. No room ⇒ no case. */
  inboundRoom: Doc | null | undefined;
}

export interface AdminCaseDeps {
  logger: {
    log: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
  chatRoomModel: unknown;
  chatMessageModel: unknown;
  ticketModel: unknown;
  assignHistoryModel: unknown;
  chatHistory: { logMessage: (row: Doc) => Promise<unknown> };
  /** `via` is present on the ladder's result and recorded on the row. */
  sendTextReply: (
    ...a: unknown[]
  ) => Promise<{ status?: number; data?: unknown; via?: string }>;
  publishTicketCreated: (...a: unknown[]) => unknown;
}

/**
 * @param displayed the acknowledgement text the customer is shown.
 * @returns true when a case was opened; false only when there was no room to open it in.
 */
export async function openAdminCaseDirect(
  displayed: string,
  args: AdminCaseArgs,
  deps: AdminCaseDeps,
): Promise<boolean> {
  const { userId, hook, accessToken, replyToken, channelId, inboundRoom } =
    args;
  /* eslint-disable-next-line @typescript-eslint/no-base-to-string -- a Mongo `_id`; `String()` on an ObjectId is its hex, which is what every consumer reads. Ported verbatim, and the three sites in this program guard differently (`? :`, none, `?? ''`), so one shared helper would flatten three behaviours into one. */
  const adminRoomId = String(inboundRoom?.['_id'] ?? '');
  if (!adminRoomId) {
    /* A case needs a room. Loud, because the tap is otherwise invisible:
       postbacks are not stored, so silence here would leave no trace
       anywhere that the customer pressed anything. */
    deps.logger.warn(
      `[ADMINDIRECT] no room for ${String(userId ?? '')} — case not opened`,
    );
    return false;
  }
  /* The history row the postback did not write. `displayed` is the sentence
     LINE showed on the customer's phone (`displayText`), so the admin reads
     the conversation exactly as before the button became a postback — and
     never a machine payload. Its own try: history is worth less than the case. */
  try {
    await deps.chatHistory.logMessage({
      userId,
      senderType: 'customer',
      messageType: 'text',
      content: displayed,
      hookId: asString(hook?.['_id']),
      channelType: hook?.['channel_type'],
      channelId,
      replyToken: replyToken,
      metadata: {
        event_id: args.eventId,
        postback_data: args.postbackData,
      },
    });
  } catch (err) {
    deps.logger.warn(`[ADMINDIRECT] history row failed: ${errText(err)}`);
  }
  {
    try {
      /* ⚠️ ขา "ตอบ" มี try ของตัวเอง: ส่งไม่ออก (โควต้าหมด · reply token
         หมดอายุ · LINE ล่ม) **เคสต้องยังเปิด** — เคสคือสิ่งที่สำคัญ
         ข้อความเป็นของแถม ถ้าอยู่ try ก้อนเดียวกัน ส่งพลาดครั้งเดียว
         ลูกค้าจะไม่ได้ทั้งข้อความและไม่ได้เคส ซึ่งแย่กว่าตอนยังไม่มีประตูนี้ */
      try {
        const ackRes = await deps.sendTextReply(
          accessToken,
          replyToken ?? '',
          CONTACT_ADMIN_ACK_TEXT,
          null,
          userId,
        );
        /* [FIX-20260902-ACKROW] the ack has to appear in the chat, or the
           operator picking up this case cannot see what the customer was
           already told and answers as if nothing had been said. Every other
           bot reply in this file writes a row (11 sites); this door was the
           only one that sent without recording.

           ⚠️ AFTER the send, never before. A row written first would record
              a sentence the customer may never receive — the same defect as
              `[FIX-20260901-FALLBACKMARKERROW]`, where the admin answered for
              words that were stripped on the way out.
           ⚠️ BEFORE `openTicketBySystem` below, which sets `assist_status:true`.
              Opening first would file this as a bot message inside a room an
              operator already holds — the same ordering the ⚠️ above protects
              for the send itself.
           ⚠️ Its own catch: a failed history write must not cost the case.
              The case is what matters; the row is the record of it.
           ⇒ ส่งสำเร็จก่อน ค่อยบันทึก · บันทึกก่อนเปิดเคส · ล้มแล้วเคสต้องยังเปิด */
        await deps.chatHistory
          .logMessage({
            userId,
            senderType: 'bot',
            messageType: 'text',
            content: CONTACT_ADMIN_ACK_TEXT,
            hookId: asString(hook?.['_id']),
            channelType: hook?.['channel_type'],
            channelId,
            replyToken: replyToken,
            // [FEAT-20260831-QUOTESRC] LINE refused ⇒ no keys ⇒ the row of today
            ...sentMessageIds(ackRes),
            metadata: {
              event_id: args.eventId,
              reason: 'admin_direct_ack',
              // which leg carried it — the ladder pushes when a reply token
              // is refused, and an operator reading the row should know.
              via: ackRes?.via,
            },
          })
          .catch((e: Error) =>
            deps.logger.warn(
              `[ADMINDIRECT] ack row not written (case still opens): ${e.message}`,
            ),
          );
      } catch (err) {
        deps.logger.warn(
          `[ADMINDIRECT] ack not delivered (case still opens): ${errText(err)}`,
        );
      }
      const opened = await openTicketBySystem(
        {
          roomId: adminRoomId,
          category: CONTACT_ADMIN_TICKET_CATEGORY,
          /* [FEAT-20260902-ADMINPOSTBACK] filed under WHAT WAS PRESSED, so
             the two buttons are told apart in the queue — an operator picking
             up a withdraw case knows the customer already passed the withdraw
             screens. For the plain button `displayed` IS
             `CONTACT_ADMIN_TICKET_NEED`, so nothing changes there.
             `||` not `??`: blank copy would file a case with no title. */
          needDetail: displayed || CONTACT_ADMIN_TICKET_NEED,
          /* [FIX-20260902-ADMINDIVIDER] NOT "เคสนี้สร้างโดยระบบ" any more.
             Owner, 02/09: this case is not the system deciding something on
             its own — the customer pressed a button and asked. The two read
             very differently to whoever picks the case up: a system-opened
             case sends them hunting for what triggered it, a pressed button
             says the customer asked outright. The wording lives with the rest
             of this door's copy so it is edited in one place.
             ⚠️ Only THIS door changes. `openTicketBySystem` lets every caller
                own its own sentence, so register scenario-A and the money path
                ("…เนื่องจาก…") still read exactly as before — checked, and
                nothing anywhere parses these strings. */
          dividerContent: contactAdminTicketDivider(
            displayed || CONTACT_ADMIN_TICKET_NEED,
          ),
        },
        {
          ticketModel: deps.ticketModel as never,
          chatRoomModel: deps.chatRoomModel as never,
          chatMessageModel: deps.chatMessageModel as never,
          assignHistoryModel: deps.assignHistoryModel as never,
          warn: (m: string) => deps.logger.warn(m),
        },
      );
      deps.publishTicketCreated(
        opened.ticket['_id'],
        opened.ticket['hook_id'],
        0,
        opened.ticket['category'] ?? null,
      );
      deps.logger.log(
        `[ADMINDIRECT] case opened ticket=${String(opened.ticket['_id'])} room=${adminRoomId} user=${String(userId ?? '')} via="${displayed}"`,
      );
      return true;
    } catch (err) {
      /* Never rethrow: the tap must not 500 the webhook. LINE retries a
         non-2xx delivery, and a retried tap would open a SECOND case for
         one press. Report and answer false. */
      deps.logger.error(`[ADMINDIRECT] failed: ${errText(err)}`);
      return false;
    }
  }
}
