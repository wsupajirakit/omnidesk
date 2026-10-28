import { flexHistoryMeta, type FlexCardKind } from '../flex/flex-history-meta';
import type { FlexReplyOut } from '../flex/flex-reply-out';
import type { ScopedEventData } from '@/infra/realtime/realtime-publisher.service';

import { stripHelperUriForHistory } from '../hook-reply/customer-helper-flex';

type Doc = Record<string, unknown>;

/**
 * [PROG-20260905-G44] Rewriting the bot's history row when a CARD was sent.
 *
 * THE PROBLEM IT SOLVES. The bot's chat row is written the moment the reply goes out, and
 * at that moment the flow only knows it sent *something*. When what actually went out was
 * a flex card, the row has to be rewritten to say so — otherwise the admin history shows a
 * line of text where the customer saw a card, and the two disagree about what happened.
 *
 * THE FOUR RULES IT ENFORCES, each of which cost a real incident to learn:
 *   1. Store the card that was SENT, not a hardcoded profile reference.
 *   2. The profile card takes precedence over the helper card, mirroring the send order —
 *      if both exist, the customer saw the profile one.
 *   3. Tag the row so every card kind stays distinguishable, from ONE derivation that both
 *      the `$set` and the realtime publish read. Two derivations drift.
 *   4. Publish the same card that was stored. Screen and database must not disagree.
 *
 * ⚠️ THE HELPER URI IS STRIPPED BEFORE STORING. A minted single-use link in history is a
 * lie the moment it is used — the row would show a working button that no longer works.
 *
 * ⚠️ NOTHING LEAVES THIS FUNCTION. It writes two documents and publishes; the spine reads
 * none of its locals afterwards. Verified before extraction, not assumed.
 */

export interface FlexHistoryArgs {
  /** The bot chat row written when the reply was sent; null when there was none. */
  botChatMsgId: unknown;
  /** The profile card, if one was sent. Takes precedence — see rule 2. */
  flexProfileContents: unknown;
  /** The helper card, if one was sent. */
  helperCardForHistory: unknown;
  /** The ONE derivation both the `$set` and the realtime publish read — see rule 3. */
  /* `null` is a real value here — the send half uses it for "no kind resolved",
     and the fallback to 'profile' below depends on it. Widened deliberately. */
  flexKind: FlexCardKind | null | undefined;
  /** The card actually sent, as the send half resolved it. */
  flexOut: FlexReplyOut;
  hook: Doc | null | undefined;
  /** The room the bot row belongs to, from the row itself. */
  botRoomId: unknown;
  /** `replyBodyForLine` — what actually went to LINE. */
  replyBody: unknown;
  /** The text the room preview currently shows, so only THAT row is corrected. */
  replyText: unknown;
  /**
   * ⚠️ ORDER, not decoration: the rewrite waits on the category settlement so the room
   * preview is corrected AFTER the category is known. Its rejection is swallowed — a
   * failed categorisation must not stop history from being made truthful.
   */
  categorySettled: Promise<unknown>;
}

export interface FlexHistoryDeps {
  logger: { warn: (m: string) => void };
  /**
   * Optional at the seam, as everywhere else in this module.
   *
   * ⚠️ THE PAYLOAD TYPE IS `ScopedEventData`, NOT A LOOSE `Doc`, AND THAT IS A GUARD RATHER
   * THAN A PREFERENCE. `ScopedEventData` requires `hook_id`, because an event published
   * without one is broadcast to EVERY connected operator in the environment — including
   * operators of other tenants. Its own header says the compiler is what stops a new call
   * site from forgetting.
   *
   * Declared as `Doc` here until 05/09, this file's publish already supplied `hook_id`, so
   * nothing leaked — but the loose type meant the real `RealtimePublisherService` could not
   * satisfy it, and every caller passed the service with an `as never` that switched the
   * guard off for the whole argument. A cast that exists only because a type is too loose
   * is a guard being disabled to make the loose type compile. ปิดการ์ดเพื่อให้ผ่าน = ไม่ใช่ทางแก้
   */
  realtimePublisher?: {
    publish: (event: string, payload: ScopedEventData) => Promise<unknown>;
  };
  chatMessageModel: {
    updateOne: (filter: Doc, update: Doc) => { exec: () => Promise<unknown> };
  };
  chatRoomModel: {
    updateOne: (filter: Doc, update: Doc) => { exec: () => Promise<unknown> };
  };
}

/* eslint-disable-next-line @typescript-eslint/require-await --
   `async` here is the CONTRACT, not an oversight. The caller awaits this, and the two
   writes inside are deliberately fire-and-forget (`void … .catch(…)`) so a failed history
   patch can never cost the customer their reply — see the notes on each. Dropping `async`
   would change the declared return type at a seam the spine awaits; adding an `await` to
   satisfy a linter would change the fire-and-forget behaviour this file exists to keep. */
export async function rewriteFlexHistory(
  args: FlexHistoryArgs,
  deps: FlexHistoryDeps,
): Promise<void> {
  /* Destructured, not renamed through the body: a blind rename has twice turned an object
     property into a positional argument on earlier cuts, and only the compiler noticed. */
  const { flexProfileContents, helperCardForHistory, flexKind, hook, flexOut } =
    args;
  const { replyText, categorySettled } = args;
  if ((flexProfileContents || helperCardForHistory) && args.botChatMsgId) {
    /* [FIX-20260822-FLEXHISTORYTYPE] ONE derivation for the three history
     fields, read by the `$set` below AND the realtime publish — they can
     no longer disagree, and a flex_m / flex_pc card is stored as itself
     (its own doc id, its own name) instead of as the profile card. */
    const flexHist = flexHistoryMeta({
      kind: helperCardForHistory ? 'helper' : (flexKind ?? 'profile'),
      hook,
      out: flexOut,
      replyBody: args.replyBody as never,
    });
    const flexDocId = flexHist.flex_doc_id;
    const botMsgId = args.botChatMsgId;
    const botRoomId = args.botRoomId;
    /* [FIX-20260810-HELPERHISTORYURI] the helper card's button carries the
     member's own mint token. An admin clicking it from the chat page
     would consume the token and link data AS the customer, and the real
     customer's button would then be dead. Store a COPY whose uri points
     at google.com instead — the card already SENT to LINE is untouched
     (stripHelperUriForHistory deep-copies before editing).
     ⚠️ helper only. The profile card has no minted link. */
    const historyCard = flexProfileContents
      ? flexProfileContents
      : stripHelperUriForHistory(
          helperCardForHistory as Record<string, unknown>,
        );
    /* [FIX-20260821-ROOMPREVIEW] ประกอบสตริงครั้งเดียว ใช้สองที่ — แถวข้อความกับ
     ข้อความล่าสุดของห้องต้องไม่มีทางไม่ตรงกัน ซึ่งจะเกิดทันทีถ้าปล่อยเป็น literal
     สองตัวแล้ววันหนึ่งมีคนแก้ตัวเดียว. */
    const historyContentForRow = flexHist.content;
    void categorySettled
      .catch(() => {})
      .then(() =>
        deps.chatMessageModel
          .updateOne(
            { _id: botMsgId },
            {
              $set: {
                message_type: 'flex',
                content: historyContentForRow,
                'metadata.flex_json': historyCard,
                'metadata.flex_doc_id': flexDocId ?? null,
                'metadata.auto_reply_type': flexHist.auto_reply_type,
              },
            },
          )
          .exec(),
      )
      /* [FIX-20260821-ROOMPREVIEW] แก้ "ข้อความล่าสุด" ของห้องด้วย
       ==================================================
       `chat_rooms.last_message.text` ถูกเขียนจาก `replyText` — คำตอบดิบของ AI —
       ตอน log แถวบอทเมื่อ ~380 บรรทัดก่อนหน้า แล้วคำตอบนั้นถูก **ทิ้งทั้งก้อน**
       ที่ `replyBodyForLine` (ใช้ `customer_helper_text` แทน) · แถวข้อความถูก patch
       ตรงนี้ แต่แถวห้องไม่เคยถูกแตะ และผู้เขียน `last_message` มี **จุดเดียวในทั้ง
       backend** (`chat/chat-history.service.ts:358-374`) ⇒ ไม่มีใครมาแก้ให้เลย
  
       สิ่งที่แอดมินเห็น: ลิสต์ห้องซ้ายอ้างข้อความสุภาพยาว ๆ ที่ลูกค้า **ไม่เคยได้รับ**
       พร้อมป้าย `[[[customer-helper]]]` ติดท้ายมา (ป้ายถูกถอดที่ :4303 ลงตัวแปรคนละตัว)
       แล้วอ่านว่า "ตอบไปแล้ว" ทั้งที่ลูกค้าได้การ์ดลงทะเบียนและกำลังรออยู่
       วัดบน dev 21/08: แถวข้อความที่ถูก patch 52 · แถวห้องที่ถูก patch 0
  
       ⚠️ filter คือ **ตัวกันการชน** ไม่ใช่แค่ตัวหา — ระหว่างที่ log แถวไว้กับตอนนี้
       ลูกค้าอาจพิมพ์อะไรมาแล้ว ข้อความล่าสุดจะเป็นของลูกค้า การทับ = ลบข้อเท็จจริง
       ที่ใหม่กว่า · เทียบกับข้อความที่กำลังจะแทน ⇒ เลื่อนไปแล้วก็ไม่แมตช์
       ไม่ต้องอ่านก่อนเขียน ไม่มีช่องว่างให้ชน
  
       ⚠️ ทำไมสำคัญกว่าที่เห็น: บรรทัดผิดถูกทับด้วยข้อความถัดไป ⇒ อาการค้าง**เฉพาะ
       ตอนการ์ดยังเป็นสิ่งสุดท้ายที่พูด** ซึ่งคือลูกค้าที่ถูกขอให้ลงทะเบียนแล้วเงียบไป
       พอดี — ห้องที่ค้างผิดคือห้องที่ต้องตามที่สุด
  
       ⚠️ แก้แค่ค่าที่เก็บ · จอที่เปิดค้างยังเห็นของเก่าจนกว่าจะโหลดใหม่ เพราะ FE ไม่มี
       branch `message:updated` เลย (grep `pages/chat/` = 0) ทั้งที่ BE ยิง event นี้
       มาตั้งแต่ 07/2026 · เพิ่มตัวรับเป็นงานฝั่ง FE **จงใจไม่แอบใส่มาในงานนี้**
  
       ต่อ **หลัง** patch แถวข้อความเสมอ — ข้อความล่าสุดต้องไม่บรรยายแถวที่ยังไม่ถูกแก้
       fire-and-forget มี catch ของตัวเอง: ลูกค้าได้การ์ดไปแล้ว preview ค้างต้องไม่
       ทำให้คำตอบที่ส่งสำเร็จกลายเป็น error
  
       revert: ลบบล็อก `.then(...)` นี้ + const `historyContentForRow` ข้างบน */
      .then(() =>
        deps.chatRoomModel
          .updateOne(
            { _id: botRoomId, 'last_message.text': replyText },
            { $set: { 'last_message.text': historyContentForRow } },
          )
          .exec()
          .catch((err: Error) =>
            deps.logger.warn(
              `[ROOMPREVIEW] แก้ข้อความล่าสุดของห้องไม่สำเร็จ: ${err.message}`,
            ),
          ),
      )
      // legacy:4954-4977 — after the DB patch SUCCEEDS, emit
      // `message:updated` so an admin holding the room sees the row become
      // a card without a refresh. Fired only after updateOne resolves, so
      // the screen never leads the DB (a refresh would otherwise snap it
      // back). Nested fire-and-forget: a realtime failure must not undo the
      // history patch that already succeeded.
      .then(() => {
        void deps.realtimePublisher
          ?.publish('message:updated', {
            /* eslint-disable-next-line @typescript-eslint/no-base-to-string -- a Mongo `_id`; `String()` on an ObjectId is its hex, which is what every consumer reads. Ported verbatim, and the three sites in this program guard differently (`? :`, none, `?? ''`), so one shared helper would flatten three behaviours into one. */
            hook_id: hook?.['_id'] ? String(hook['_id']) : '',
            /* eslint-disable-next-line @typescript-eslint/no-base-to-string -- same as above: a Mongo `_id`. */
            _id: String(botMsgId),
            /* eslint-disable-next-line @typescript-eslint/no-base-to-string -- same as above: a Mongo `_id`. */
            room_id: botRoomId ? String(botRoomId) : '',
            message_type: 'flex',
            metadata: {
              // [FIX-20260810-HELPERFLEXHISTORY] must mirror the `$set`
              // above — publishing a different card than the one stored
              // would make the live screen and a refresh disagree.
              flex_json: historyCard,
              flex_doc_id: flexDocId ? String(flexDocId) : null,
              auto_reply_type: flexHist.auto_reply_type,
            },
          })
          .catch((pubErr: Error) =>
            deps.logger.warn(
              `[FLEXPROFILE] realtime publish ล้มเหลว (ประวัติแก้สำเร็จแล้ว): ${pubErr.message}`,
            ),
          );
      })
      .catch((err: Error) =>
        deps.logger.warn(
          `[FLEXPROFILE] แก้ประวัติแชทเป็น flex ไม่สำเร็จ: ${err.message}`,
        ),
      );
  }
}
