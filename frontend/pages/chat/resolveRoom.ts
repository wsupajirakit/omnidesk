/**
 * [FIX-20260829-ROOMRESOLVE] ตั๋ว → ห้องแชท · หาห้องจริงเสมอ ไม่สร้างห้องปลอม
 * ===========================================================================
 * 🔴 บั๊กที่แก้: `ticket.chat_room_id` **ไม่มีอยู่จริง** (`ticket.schema.ts` มีคำนี้
 *    0 ครั้ง) ⇒ ห้องสำรองตกไปใช้ `ticket.line_user_id` ซึ่งคือ **member ObjectId**
 *    ไม่ใช่ room id (BE map ที่ `tickets.service.ts:171`)
 *    ⇒ ทั้งคู่เป็น 24-hex ⇒ ผ่าน `isValidObjectId` ของ BE ⇒ `findById` ไม่เจอ
 *    ⇒ **404 เงียบ**: ส่งข้อความไม่ออก · แท็ก/โน้ตเซฟไม่ลง · assist กดไม่ติด ·
 *      ประวัติรับเคสเขียนด้วย room ผิดแล้วหายไป
 *
 * 🔴 ทำไมถึงเกิดบ่อย: ห้องมาจาก `listRooms(hookId)` ซึ่ง BE จำกัด
 *    `ROOM_HARD_CAP = 200` (`chat.service.ts:162,317`) เรียงตามเวลาข้อความล่าสุด
 *    ⇒ ลูกค้าที่ไม่ได้อยู่ใน 200 ห้องล่าสุด **หาไม่เจอเสมอ**
 *    วัด prod 29/08: 3 OA เกินเพดาน (693 · 270 · 257 ห้อง) ⇒ **ราว 620 คน**
 *    และคนที่โดนคือคนที่เงียบไปนานแล้วเพิ่งกลับมาทัก — นาทีที่รอคำตอบอยู่พอดี
 *
 * ⭐ ข้อเท็จจริงที่ทำให้แก้แบบนี้ได้ (วัด prod 29/08 · 2,151 ตั๋ว):
 *      no_user_ref = 0 · dangling_member = 0 · no_hook = 0
 *      **ticket_without_room = 0** ⇒ ทุกตั๋วมีห้องจริงครบ 100%
 *    ⇒ ห้องปลอม **ไม่เคยจำเป็นเลยแม้แต่ใบเดียว** มันไม่ได้แก้อะไร มันสร้างปัญหา
 *
 * กติกา 3 ขั้น:
 *   1. หาในลิสต์ที่โหลดมาแล้ว  → เจอ = จบ · **ไม่มี request เพิ่ม**
 *   2. ไม่เจอ → ถามห้องเดียวด้วย `{ user_id, hook_id }` ผ่าน **unique index**
 *      (`chat_rooms` มี `user_id_1_hook_id_1` unique) ⇒ 1 document ไม่ใช่ 200
 *   3. ยังไม่เจอ → **คืน `null` ห้ามแกล้งว่ามีห้อง**
 *      เปลี่ยนจาก "ผิดเงียบ" เป็น "ถูกเสมอ หรือดังทันที"
 *
 * ⚠️ ไม่แตะ BE · ไม่แตะ DB · ไม่แตะ WS · ไม่ต้อง backfill
 *    `listRooms` รับ `user_id` อยู่แล้วทั้งสองฝั่ง (`chatService.ts:147` ·
 *    BE `chat.service.ts:274-275`) — ไม่ได้เพิ่ม API ใหม่
 *
 * 📖 แผนเต็ม: `omnidesk-api/todo/task/29082026/fe_resolveroom-fix_29082026.md`
 * revert: `git reset --hard lane-rr1-extract` (ในเลน)
 */
import { chatService } from '../../services/chat';
import type { ChatRoom, TicketEntry } from '../../services/chat';

/**
 * หาห้องจากลิสต์ที่มีอยู่ในมือแล้ว — ทางเร็ว ไม่มี I/O
 *
 * ตรรกะเดิมทุกไบต์จากตอนที่อยู่ใน `TicketChat.tsx` · ยังไม่เทียบ `hook_id`
 * เหมือนเดิม (ลิสต์ถูกดึงมาต่อ hook อยู่แล้ว) — มีเทสปักพฤติกรรมนี้ไว้
 */
export const findRoomInList = (
  ticket: TicketEntry,
  rooms: ChatRoom[],
): ChatRoom | null => {
  const targetUserId = ticket.line_user_data?.line_user_id || ticket.line_user_id || '';
  const targetMongoId = ticket.line_user_data?._id || ticket.line_user_id || '';
  const match = rooms.find((r: any) => {
    const uData = r.user_data as any;
    const roomLineUserId = r.line_user_id || uData?.line_user_id;
    return ((ticket as any).chat_room_id && r._id === (ticket as any).chat_room_id) ||
      r._id === targetMongoId ||
      (roomLineUserId && targetUserId && roomLineUserId === targetUserId) ||
      (uData?._id && targetMongoId && uData._id === targetMongoId);
  });
  return (match as ChatRoom) || null;
};

/**
 * ตั๋ว → ห้องจริง หรือ `null`
 *
 * ⚠️ คืน `null` ได้ — ผู้เรียกต้องเช็ค · นี่คือส่วนที่ทำให้ความผิดพลาด **ดัง**
 * แทนที่จะเงียบ ห้ามใส่ `_id` ปลอมกลับมาเด็ดขาด (นั่นคือบั๊กที่เพิ่งแก้)
 */
export const resolveRoom = async (
  ticket: TicketEntry,
  rooms: ChatRoom[],
): Promise<ChatRoom | null> => {
  const inList = findRoomInList(ticket, rooms);
  if (inList) return inList;

  /* ขั้น 2 — ถามห้องเดียว · `user_id` ต้องเป็น member ObjectId เท่านั้น
     (`line_user_data._id`) · ห้ามส่ง `Uxxx` เพราะ BE กรองด้วย `user_id`
     ซึ่งเป็น ref ไปที่ member — ส่ง id ผิด space จะได้ลิสต์ว่างเงียบ ๆ */
  const memberId = ticket.line_user_data?._id;
  const hookId = ticket.line_oa_hook_id;
  if (!memberId || !hookId) return null;

  try {
    const rows = await chatService.listRooms(String(hookId), String(memberId));
    return findRoomInList(ticket, (rows || []) as ChatRoom[]);
  } catch {
    /* เครือข่ายล้ม ≠ ห้องไม่มี — คืน null ให้ผู้เรียกจัดการ ดีกว่าคืนห้องผิด */
    return null;
  }
};
