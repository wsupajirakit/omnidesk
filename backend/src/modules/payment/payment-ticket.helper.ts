import type { Model, Types } from 'mongoose';

// [REFACTOR-20260819-DIVIDERDOOR] one place builds the direct_ticket divider's
// sentence and one place updates it — see ticket-divider.helper.ts for why.
import {
  directTicketDividerText,
  updateLatestDirectTicketDivider,
} from '../tickets/ticket-divider.helper';

/**
 * ==== [FEAT-20260810-PAYTICKET] เปิด ticket ให้ลูกค้าเองเมื่อ topup ตอบ member-not-match ====
 *
 * ## ทำอะไร
 * เมื่อ topup ตอบ `member-not-match` (บัญชีที่โอนมาไม่ใช่ของลูกค้าคนนี้) ระบบจะ
 * **เปิด ticket ให้เลย** โดยไม่ต้องรอ AI ขึ้น tag `[[[assist]]]` และไม่ต้องรอลูกค้าทักซ้ำ
 *
 * ## ทำไมต้องมี
 * ข้อความที่ตอบลูกค้าบอกว่า "เดี๋ยวน้องลัคกี้จะแจ้งพี่แอดมินให้มาดูแลต่อนะคะ"
 * ถ้าไม่เปิด ticket จริง คำพูดนั้นก็ไม่เป็นจริง — แอดมินไม่มีอะไรให้เห็นในหน้าเคส
 * (`needs_review` ขึ้นในหน้า log ของ payment แต่คนละหน้ากับรายการ ticket ที่แอดมินเฝ้า)
 *
 * ## ⚠️ ทำไมแยกไฟล์
 * `webhook.service.ts` โตถึง ~3.7k บรรทัดแล้ว และ `payment-runner.service.ts` ~2.4k
 * เจ้าของกำชับว่าอย่าให้บวมเพิ่ม ตรรกะทั้งหมดจึงอยู่ที่นี่ ผู้เรียกเหลือบรรทัดเดียว
 *
 * ## 🔑 กันซ้ำด้วย atomic claim (ลอกวิธีจาก assist-notification.ts:427-436)
 * ใช้ `findOneAndUpdate` ที่มี `assist_status: { $ne: true }` อยู่ใน **filter**
 * ⇒ MongoDB จับคู่และเขียนเป็นก้อนเดียว: ถ้ามีหลาย event เข้ามาพร้อมกัน
 *   มีแค่ตัวเดียวที่ได้ document กลับมา ที่เหลือได้ null แล้วออกไป
 * ⇒ ได้ทั้ง **กันซ้ำ** และ **กัน race** ในคำสั่งเดียว
 *
 * อ่านแล้วค่อยเขียน (read-then-write) ใช้ไม่ได้ เพราะมีช่องว่างระหว่างสองคำสั่ง
 * ที่ทำให้ทั้งสองฝั่งคิดว่าตัวเองมาก่อน แล้วเปิด ticket ซ้ำ 2 ใบ
 *
 * ## Seamless
 * - ไม่แตะ reply — ลูกค้าได้ข้อความเดิมทุกประการ
 * - ห้องที่ `assist_status: true` อยู่แล้ว (มีคนดูแล/มี ticket ค้าง) ⇒ ไม่ทำอะไรเลย
 * - ทุก error ถูกกลืน (log แล้วไปต่อ) — **การเปิด ticket ต้องไม่ทำให้ flow เงินล้ม**
 *
 * ## revert
 * ลบไฟล์นี้ + ลบการเรียกใน `payment-runner.service.ts` (`[FEAT-20260810-PAYTICKET]`)
 * ⇒ กลับไปตอบข้อความอย่างเดียวโดยไม่เปิด ticket เหมือนก่อนหน้า
 */

/** สิ่งที่ helper ต้องใช้ — ฉีดเข้ามาเพื่อให้เทสสลับได้ ไม่ผูกกับ Nest container */
export interface PaymentTicketDeps {
  chatRoomModel: Model<Record<string, unknown>>;
  ticketModel: Model<Record<string, unknown>>;
  /** ใช้หา `_id` ของ member จาก LINE user id — ผู้เรียกไม่ต้องหาเอง */
  memberModel: Model<Record<string, unknown>>;
  /**
   * ยิง `ticket:new` ให้หน้าแอดมินเด้งเอง
   *
   * ⚠️ ถ้าไม่ยิง ticket จะเข้า DB จริงแต่ **แอดมินต้องกด refresh ถึงจะเห็น**
   * (เจอจริงตอนเทส) — `ticketsService.createTicket` ยิงให้เองเพราะเรียกผ่าน API
   * แต่ helper นี้เขียน DB ตรง จึงต้องยิงเอง
   */
  publishTicketNew?: (data: Record<string, unknown>) => void;
  /**
   * [FIX-20260811-PAYDIVIDER] เขียน divider แถวจริงลง transcript
   *
   * ใช้เฉพาะเส้นทาง "ห้องถูก claim แล้วจึงไม่เปิด ticket" — ถ้าเปิด ticket ได้
   * FE ปั้น divider สังเคราะห์ให้เองอยู่แล้ว จึงไม่เขียนซ้ำ
   *
   * **optional โดยเจตนา** — ผู้เรียกที่ไม่ส่งมาจะได้พฤติกรรมเดิมทุกอย่าง
   * (ไม่มีเส้นตอนห้องถูก claim) ⇒ seamless ไม่ต้องแก้ call site ที่ไม่เกี่ยว
   * ตัวจริงคือ `writeTicketDivider` ใน `tickets/ticket-divider.helper.ts`
   * ⚠️ ต้องกลืน error เองทั้งหมด — ผู้เรียกอยู่บนเส้นทางเงิน
   */
  // [FIX-20260817-REOPENDIVIDER] the return type is `unknown` because
  // `writeTicketDivider` now RESOLVES the written row's ids (additive — the
  // reopen path publishes message:new with them). This port ignores the value
  // entirely; widening it keeps every existing call site byte-identical
  // instead of forcing wrappers that discard the result.
  writeDivider?: (input: {
    memberId: unknown;
    hookId: unknown;
    variant: 'direct_ticket';
    content: string;
  }) => Promise<unknown>;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface OpenPaymentTicketInput {
  /** LINE user id ของลูกค้า (ไม่ใช่ `_id` ของเรา) — ใช้หาห้องแชตและหา member */
  channelUserId: string;
  /** `_id` ของ hook (OA) */
  hookId: unknown;
  /** ข้อความที่แอดมินเห็นเป็นหัวเรื่องของเคส */
  needDetail: string;
  /**
   * เหตุผลที่เปิด ticket ตรง — ลงใน `direct_ticket_detail`
   * ตั้งชื่อเป็น `<โมดูล>:<สาเหตุ>` เช่น `'payment:member-not-match'`
   */
  directDetail: string;
}

/**
 * ห้องแชตอาจถูกบันทึกด้วย `channel_user_id` หรือ `line_user_id` แล้วแต่ยุคของข้อมูล
 * — เหมือน `buildRoomFilter` ใน assist-notification.ts ที่ต้องรองรับทั้งสองชื่อ
 * คัดลอกมาแทนการ import ข้ามโมดูล เพราะ payment ไม่ควรพึ่งภายในของ webhook
 * (ถ้ารูปข้อมูลเปลี่ยน ต้องแก้ทั้งสองที่ — note ไว้ตรงนี้แล้ว)
 */
/**
 * [FEAT-20260810-PAYTICKET] กันหัวเรื่อง/เหตุผลว่างในหน้าแอดมิน
 *
 * ถ้าผู้เรียกส่งค่าว่าง (หรือช่องว่างล้วน) มา ticket จะขึ้นเป็นแถวเปล่าในรายการเคส
 * ซึ่งแอดมินอ่านไม่ออกว่าเรื่องอะไร — แย่กว่าใส่ขีดไว้
 * ใช้ `'-'` ตามแบบเดียวกับ `reply_detail` ของ payment ที่ตกเป็น "-" เมื่อไม่ตั้งค่า
 */
const orDash = (v: unknown): string => {
  const t = String(v ?? '').trim();
  return t === '' ? '-' : t;
};

const roomFilter = (channelUserId: string, hookId: unknown) => ({
  $or: [{ channel_user_id: channelUserId }, { line_user_id: channelUserId }],
  hook_id: hookId,
});

/**
 * เปิด ticket ให้ลูกค้า **เฉพาะเมื่อห้องยังไม่ถูก claim**
 *
 * @returns `_id` ของ ticket ที่เพิ่งสร้าง · `null` เมื่อไม่ได้สร้าง
 *          (ห้องถูก claim อยู่แล้ว / ข้อมูลไม่ครบ / เกิด error)
 *
 * ⚠️ ไม่ throw เด็ดขาด — ผู้เรียกอยู่บนเส้นทางเงิน การโยน error จะทำให้
 * ลูกค้าไม่ได้รับคำตอบ ทั้งที่เรื่อง ticket เป็นงานรอง
 */
export async function openPaymentTicketIfIdle(
  input: OpenPaymentTicketInput,
  deps: PaymentTicketDeps,
): Promise<Types.ObjectId | null> {
  const { channelUserId, hookId, needDetail, directDetail } = input;

  // ไม่มี id ครบ = สร้าง ticket ที่ไม่รู้เจ้าของ/ไม่รู้ OA ⇒ แอดมินเปิดห้องไม่ได้
  if (!channelUserId || !hookId) {
    deps.warn('[PAYTICKET] ไม่มี channelUserId/hookId — ไม่เปิด ticket');
    return null;
  }

  try {
    /* หา member เอง (รูปแบบเดียวกับ payment-runner `_rawProfile`)
       ⚠️ ticket.line_user_id ต้องเป็น `_id` ของ member ไม่ใช่ LINE id
       ถ้าใส่ LINE id ลงไป ticket จะชี้ไปที่ไม่มีอยู่จริง แอดมินเปิดห้องไม่ได้
       ⚠️ ไม่มี member = **ไม่สร้าง** (ต่างจาก assist-notification ที่ upsert ให้)
       ตั้งใจ: เคสนี้ลูกค้าเคยส่งสลิปมาแล้ว จึงต้องมี member อยู่ก่อนเสมอ
       ถ้าไม่มีแปลว่าข้อมูลผิดปกติ — สร้าง member ผีขึ้นมาจะแย่กว่าไม่สร้าง */
    const member = await deps.memberModel
      .findOne({
        $or: [
          { member_user_id: channelUserId },
          { line_user_id: channelUserId },
        ],
      })
      .select('_id')
      .lean<{ _id?: unknown } | null>()
      .exec();

    const memberMongoId = member?._id;
    if (!memberMongoId) {
      deps.warn(
        `[PAYTICKET] ไม่พบ member ของ ${channelUserId} — ไม่เปิด ticket (ไม่สร้าง member ใหม่)`,
      );
      return null;
    }

    /* claim ห้อง — `assist_status: { $ne: true }` อยู่ใน filter จึงเป็น atomic
       ได้ document = เราเป็นคนแรก · ได้ null = มีคนอื่น/รอบก่อน claim ไปแล้ว */
    const claimed = await deps.chatRoomModel
      .findOneAndUpdate(
        { ...roomFilter(channelUserId, hookId), assist_status: { $ne: true } },
        { $set: { assist_status: true, last_assist_changed_at: new Date() } },
      )
      .exec();

    if (!claimed) {
      /* ==== [FIX-20260811-PAYDIVIDER] ห้องถูก claim แล้ว → ยังต้องมี divider ====
       * เจ้าของแจ้ง 2026-08-11: "divider ไม่เก็บ เฉพาะตอนที่ ticket เปิดอยู่ …
       * ต้องการให้สร้างทุกครั้งที่ตรวจสลิป"
       *
       * ต้นเหตุ: divider ที่เห็นบนหน้าแอดมินเป็น **แถวสังเคราะห์** ที่ FE ปั้นจาก
       * `ticket.direct_ticket` + `direct_ticket_detail` (`ChatRoomView.tsx:306`)
       * ⇒ ผูกกับ "การมี ticket ใบใหม่" ⇒ ห้องที่ `assist_status: true` ทำให้ claim
       * ข้างบนคืน null ⇒ ไม่มี ticket ⇒ **ไม่มี divider เลย** ทั้งที่ตรวจสลิปสำเร็จ
       * และแอดมินก็ยังต้องรู้ว่ามีสลิปใบใหม่เข้ามาระหว่างที่ตัวเองถือเคสอยู่
       *
       * ทางแก้: เขียน divider **แถวจริง** ลง `chat_messages` ด้วยท่อเดียวกับ
       * "รับเคส/ปิดเคส" (`writeTicketDivider`) แทนที่จะพึ่งของสังเคราะห์
       * ⇒ ตรวจกี่ครั้งก็มีเส้นครบทุกครั้ง ไม่ใช่ใบเดียวต่อเคส
       *
       * ⚠️ ไม่แตะ atomic claim — ticket ยังไม่เปิดซ้ำเหมือนเดิมทุกอย่าง
       *    เปลี่ยนแค่ "เมื่อไม่เปิด ticket ก็ยังบันทึกร่องรอย"
       * ⚠️ ไม่ throw / ไม่ await ผลลัพธ์เป็นเงื่อนไข — `writeTicketDivider` กลืน error
       *    เองอยู่แล้ว และเส้นคั่นเป็นของประกอบ ห้ามทำให้เส้นทางเงินล้ม
       * ⚠️ variant `direct_ticket` ใช้สไตล์ที่ FE มีอยู่แล้ว จึงไม่ต้องแก้ฝั่ง FE
       *
       * revert: ลบบล็อกนี้ + `writeTicketDivider` ที่ import — กลับไปไม่มีเส้นตอน
       * ห้องถูก claim (พฤติกรรมก่อน 2026-08-11) */
      if (deps.writeDivider) {
        await deps.writeDivider({
          memberId: memberMongoId,
          hookId,
          variant: 'direct_ticket',
          // ข้อความเดียวกับที่ FE ปั้นให้ของสังเคราะห์ ⇒ แอดมินอ่านได้เหมือนกันทั้งสองทาง
          // [REFACTOR-20260819-DIVIDERDOOR] the wording comes from the door, so the
          // row written here and the row retitled later can never diverge.
          content: directTicketDividerText(orDash(directDetail)),
        });
      }
      // ปกติมาก ไม่ใช่ error: ห้องมีคนดูแลอยู่แล้ว หรือมี ticket ค้าง
      deps.log(
        '[PAYTICKET] ห้องถูก claim อยู่แล้ว — ไม่เปิด ticket ซ้ำ (เขียน divider แทน)',
      );
      return null;
    }

    /* ฟิลด์ชุดเดียวกับที่ webhook สร้าง ticket จริง
       (assist-notification.ts:520-527) เพื่อให้ ticket จาก 2 ทางหน้าตาเหมือนกัน
       - category 'Payment' : เคสนี้มาจากสลิปแน่นอน
       - chat_status 'bot'  : ยังไม่มีแอดมินรับ
       - job_status 0       : รอรับเคส
       - ไม่มี chat_msg_id  : เราเปิดเอง ไม่ได้ผูกกับข้อความไหน (schema เป็น optional) */
    const ticket = await deps.ticketModel.create({
      line_oa_hook_id: hookId,
      line_user_id: memberMongoId,
      category: 'Payment',
      need_detail: orDash(needDetail),
      chat_status: 'bot',
      job_status: 0,
      /* [FEAT-20260810-PAYTICKET] ทำเครื่องหมายว่าระบบเปิดให้เอง
         ticket จากทางปกติ (assist) ไม่มี 2 field นี้ ⇒ อ่านเป็น false/null
         ตาม default ใน schema ⇒ seamless ไม่ต้อง migrate */
      direct_ticket: true,
      direct_ticket_detail: orDash(directDetail),
    });

    /* ยิง realtime ให้หน้าแอดมินเด้งเอง — payload ใช้รูปเดียวกับ
       `ticketsService.publishScopedTicketEvent` (`hook_id` เป็น string
       ไม่งั้น publisher จะ drop เพราะเช็ค `!data.hook_id`)
       ⚠️ ไม่ throw — ยิงไม่ออกก็ยังถือว่าเปิด ticket สำเร็จ แค่ต้อง refresh เอง */
    try {
      deps.publishTicketNew?.({
        _id: ticket._id,
        hook_id: String(hookId),
        line_oa_hook_id: String(hookId),
        line_user_id: memberMongoId,
        category: 'Payment',
        need_detail: orDash(needDetail),
        chat_status: 'bot',
        job_status: 0,
      });
    } catch (pubErr) {
      deps.warn(
        `[PAYTICKET] ยิง realtime ไม่สำเร็จ: ${(pubErr as Error).message}`,
      );
    }

    deps.log(`[PAYTICKET] เปิด ticket แล้ว: ${String(ticket._id)}`);
    return ticket._id as Types.ObjectId;
  } catch (err) {
    // เปิด ticket ไม่สำเร็จต้องไม่ทำให้ลูกค้าไม่ได้คำตอบ — log แล้วปล่อยผ่าน
    deps.warn(`[PAYTICKET] เปิด ticket ล้มเหลว: ${(err as Error).message}`);
    return null;
  }
}

/**
 * ==== [FEAT-20260810-CARDTICKET] retitle a ticket the runner just opened ====
 *
 * WHY THIS EXISTS: a card bound to a reply state can carry its own reason for the
 * admin. Two states (`member_not_match`, `statement_not_found`) already open their
 * ticket inside the runner, BEFORE the reply is delivered — and the atomic claim
 * above means the first writer wins, so the card's wording could never beat them.
 *
 * Rather than teach the runner about cards — which would drag a flex lookup and a
 * presentation concern into the money path — the delivery layer retitles the row
 * that already exists. The flow is untouched; only the sentence changes.
 * ไม่แตะ flow เงิน แค่เปลี่ยนข้อความบน ticket ที่เปิดไปแล้ว.
 *
 * ⚠️ APPENDS, never discards. `statement_not_found` puts the real amounts in
 * `direct_ticket_detail`, and those amounts cannot be recomputed here (they come
 * from `rawProfile`, which only the runner holds). Overwriting would delete
 * information an admin was just shown, so the card's reason goes FIRST and the
 * existing detail is kept after it.
 *
 * ⚠️ Never throws — the caller has already delivered the customer's reply, and a
 * failed cosmetic update must not turn a completed run into an error.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [FIX-20260815-DIVIDERRETITLE] THE DIVIDER NOW FOLLOWS THE TICKET.
 * ══════════════════════════════════════════════════════════════════════════
 * THE BUG, reported by the owner 15/08/2026 ("divider ยังไม่ยอมอ่าน text ticket")
 * and confirmed against live data before writing a line of this:
 *
 *   tickets.direct_ticket_detail  "ยอดที่โอนมา กับยอดเงิน ในสลิป ไม่ถูกต้อง ·
 *                                  ยอดในสลิป 3,022 บาท · รายการรอฝาก ไม่มี"   ← card's
 *                                                                               wording,
 *                                                                               joined ✅
 *   chat_messages (divider)       "เคสนี้สร้างโดยระบบ เนื่องจาก ยอดในสลิป 2,354
 *                                  บาท · รายการรอฝาก ไม่มี"                     ← runner's
 *                                                                               wording ❌
 *
 * The retitle was working; it just wrote to the WRONG PLACE for the admin. The
 * ticket row is a record — the divider inside the chat transcript is what an
 * admin actually reads while handling the case. They are separate collections
 * and this function only ever touched the first, so the two drifted apart on
 * every run: the more specific reason existed but was invisible.
 *
 * WHAT CHANGED: after the ticket row is updated, the LATEST `direct_ticket`
 * divider in that member's room is updated to the SAME sentence. One source of
 * truth, both surfaces.
 *
 * ⚠️ FALLBACK IS THE DEFAULT, NOT THE EXCEPTION (owner: "ถ้า text จาก ticket
 * null empty fallback เดิม"). Every step below bails out and LEAVES THE EXISTING
 * DIVIDER UNTOUCHED when anything is missing — blank reason, no `chatMessageModel`
 * wired in, no room, no divider row, or an unchanged sentence. Nothing is ever
 * cleared or blanked: the worst case is exactly the behaviour before this fix.
 *
 * ⚠️ Deliberately does NOT create a divider when none exists. Creating one is
 * `writeTicketDivider`'s job and is governed by `[FIX-20260811-PAYDIVIDER]`
 * (one divider per check). Writing here too would resurrect the double-divider
 * bug that fix exists to prevent. ที่นี่ "แก้ข้อความ" เท่านั้น ไม่ "สร้างเส้นใหม่".
 *
 * ⚠️ MONEY PATH UNTOUCHED. This runs after the customer's reply was delivered,
 * inside a function that already could not throw. It changes one string on one
 * chat row — no state, no lock, no leg.
 *
 * revert: delete this function and its single call in `sendPaymentReply`. To keep
 * the ticket retitle but drop the divider half, delete the `chatMessageModel`
 * block below and the optional dep — the ticket update above is unchanged.
 */
export async function retitleDirectTicket(
  input: {
    ticketId: unknown;
    /** The admin-facing reason from the card. Ignored when blank. */
    reason: string;
  },
  deps: {
    ticketModel: Model<Record<string, unknown>>;
    /* [FIX-20260815-DIVIDERRETITLE] BOTH OPTIONAL on purpose: a caller that does
       not pass them keeps the previous behaviour exactly (ticket only), so this
       cannot break an existing call site. Both are needed together — the room
       model resolves WHICH transcript, the message model does the update. */
    chatMessageModel?: Model<Record<string, unknown>>;
    chatRoomModel?: Model<Record<string, unknown>>;
    warn: (msg: string) => void;
  },
): Promise<boolean> {
  const reason = String(input.reason ?? '').trim();
  if (!input.ticketId || !reason) return false;

  try {
    const existing = await deps.ticketModel
      .findById(input.ticketId as never)
      .select('direct_ticket_detail')
      .lean<{ direct_ticket_detail?: string } | null>()
      .exec();
    if (!existing) return false;

    const prev = String(existing.direct_ticket_detail ?? '').trim();
    // Card reason first (it is the more specific "why"), existing detail kept
    // after it so the amounts line survives. Skip the join when there is nothing
    // to keep, or when the reason is already in there (a re-delivery).
    const detail =
      !prev || prev === reason
        ? reason
        : prev.startsWith(reason)
          ? prev
          : `${reason} · ${prev}`;

    await deps.ticketModel
      .updateOne(
        { _id: input.ticketId },
        { $set: { direct_ticket_detail: detail } },
      )
      .exec();

    /* [FIX-20260815-DIVIDERRETITLE] carry the SAME sentence onto the divider the
       admin actually reads. See the block above the signature for why.

       ⚠️ FIELD NAMES READ OFF LIVE ROWS (15/08/2026), NOT GUESSED — the two ids
       here look interchangeable and are NOT:
         tickets.line_user_id   = the MEMBER `_id`   (6a6de682…33d)
         chat_messages.room_id  = the ROOM `_id`     (6a6de682…33e)
       Matching a divider on the ticket's `line_user_id` would find nothing and
       fail silently, so the room is resolved from (member, hook) exactly the way
       `writeTicketDivider` does it. ห้ามเอาสองค่านี้มาสลับกัน.

       Every exit below leaves the existing divider untouched — the fallback the
       owner asked for. */
    if (deps.chatMessageModel) {
      const existingRoomTicket = await deps.ticketModel
        .findById(input.ticketId as never)
        .select('line_user_id hook_id')
        .lean<{ line_user_id?: unknown; hook_id?: unknown } | null>()
        .exec();

      const memberId = existingRoomTicket?.line_user_id;
      const hookId = existingRoomTicket?.hook_id;
      /* ⚠️ THE ROOM IS REQUIRED, NOT AN OPTIMISATION. Narrowing only by
         `hook_id` would match the newest `direct_ticket` divider ON THE WHOLE
         OA — i.e. another customer's transcript — and rewrite their reason with
         this customer's amounts. `room_id` is what makes the update belong to
         this member. No room ⇒ skip, never widen the filter. */
      const room =
        memberId && hookId && deps.chatRoomModel
          ? await deps.chatRoomModel
              .findOne({ user_id: memberId as never, hook_id: hookId as never })
              .select('_id')
              .lean<{ _id?: unknown } | null>()
              .exec()
          : null;

      if (room?._id) {
        /* [REFACTOR-20260819-DIVIDERDOOR] this block used to be a verbatim copy of
           the one in ticket-divider.helper — same filter, same sort, same wording,
           same comment. Both go through the one door now, so the divider cannot say
           two different things depending on which path retitled it. Room resolution
           stays here: this caller already holds the member id and would pay an extra
           query to go through the LINE-id path.
           ตรรกะ/ผลลัพธ์เท่าเดิมเป๊ะ ย้ายที่ประกอบข้อความอย่างเดียว. */
        await updateLatestDirectTicketDivider(
          { roomId: room._id, reason: detail },
          { chatMessageModel: deps.chatMessageModel, warn: deps.warn },
        );
      }
    }
    return true;
  } catch (err) {
    deps.warn(
      `[CARDTICKET] could not retitle ticket ${String(input.ticketId)}: ${
        (err as Error)?.message
      }`,
    );
    return false;
  }
}
