/**
 * [FEAT-20260825-BCASTDIRECTTICKET] ยิง multicast แล้วเปิดเคสรอไว้ให้เลย
 * ===========================================================================
 * สิ่งที่ต้องได้: option สำหรับงาน **multicast เท่านั้น** · ติ๊กหรือไม่ติ๊กก็ได้ ·
 * ติ๊กแล้วคนที่ได้รับจะถูกเปิด direct ticket ให้ โดยเหตุผลของเคสใช้ข้อความเดียวกับ
 * ช่อง "แคมเปญนี้ทำเพื่ออะไร" และต้องมีเส้น divider ส้ม
 *
 * ⭐ ไฟล์นี้ **ไม่ได้สร้าง ticket เอง และไม่ได้เขียน divider เอง**
 * ทั้งสองอย่างมีประตูกลางอยู่แล้ว: `tickets/create-by-admin` →
 * `openTicketBySystem()` ซึ่งทำครบในคำสั่งเดียว — จองห้องแบบ atomic, สร้าง
 * ticket, เขียน divider, เขียน assign history · ที่นี่มีหน้าที่เดียวคือ
 * "แปลผลการส่ง multicast ให้เป็นคำเรียกประตูนั้น"
 *   🔴 ห้ามเขียน divider เองเด็ดขาด — จะได้เส้นซ้ำสองเส้นในห้องเดียว
 *      `ticket-divider.helper.ts` เขียนกฎ "หนึ่ง divider ต่อหนึ่งเหตุการณ์" ไว้แล้ว
 *   ⭐ divider variant ที่ประตูนั้นใช้คือ `direct_ticket` ซึ่ง **ฝั่ง FE เรนเดอร์
 *      เป็นสีส้มอยู่แล้ว** (`ChatRoomView.tsx`: "the system opened a case that
 *      needs a human (orange)") ⇒ ได้สีที่ขอมาโดยไม่ต้องเพิ่มโค้ดสีสักบรรทัด
 *
 * 🔴 IMPORT `../../tickets/create-by-admin` ตรง ๆ **ห้ามใช้ `@/modules/tickets`**
 *    `tickets.module.ts` import `@/modules/content` อยู่ ⇒ ดึง barrel ของ tickets
 *    กลับมาคือวงจร ซึ่งพังแบบ schema เป็น `undefined` ตอน boot (โหมดพังเดียวกับที่
 *    `clear-notice-on-multicast.ts` ข้าง ๆ เตือนไว้เรื่อง `@/modules/chat`)
 *    ตรวจแล้วทั้งสาย: โฟลเดอร์นั้น import แค่ `@nestjs/common`, `mongoose`,
 *    `../ticket-divider.helper` (import แค่ mongoose) และไฟล์ค่าคงที่ที่ไม่ import
 *    อะไรเลย ⇒ หยิบมาได้อย่างปลอดภัย
 *
 * ⚠️ MULTICAST เท่านั้น — `/message/broadcast` ไม่มีรายชื่อผู้รับ LINE กระจายเอง
 *    และไม่บอกว่าใครได้รับ ⇒ ไม่มีใครให้เปิดเคสให้ · ตัวเรียกส่งเฉพาะรายชื่อจาก
 *    `DeliveryCollector` ซึ่งเก็บเฉพาะ chunk ที่ LINE ตอบรับ ⇒ งาน broadcast
 *    จะได้ลิสต์ว่าง แล้วฟังก์ชันนี้ไม่ทำอะไรเลยโดยธรรมชาติ
 *
 * ⚠️ เปิดให้ **เฉพาะคนที่ได้รับจริง** ไม่ใช่ทุกคนที่เล็งไว้ — คนที่ยิงไม่ผ่านยังไม่
 *    เคยเห็นข้อความ เปิดเคสให้เขาคือเปิดเคสเรื่องที่เขาไม่รู้จัก
 *
 * ⚠️ ไม่เคยโยน — ข้อความอยู่บนมือถือลูกค้าไปแล้ว เปิดเคสไม่สำเร็จต้องไม่ทำให้
 *    แคมเปญที่สำเร็จกลายเป็นล้มเหลว (กฎเดียวกับ transcript writer และ
 *    clear-notice ข้าง ๆ) · `ConflictException` จากประตูแปลว่า "ลูกค้ารายนี้มีเคส
 *    เปิดอยู่แล้ว" ซึ่ง **เป็นผลลัพธ์ปกติ ไม่ใช่ความผิดพลาด** — นับแยกไว้ใน `skipped`
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * เปลี่ยนใจทีหลังทำยังไง — เขียนไว้ตรงนี้เพราะนี่คือไฟล์ที่คนจะเปิดตอนอยากเปลี่ยน
 * ═══════════════════════════════════════════════════════════════════════════
 * ① เลิกทำทั้งหมด
 *    · ลบไฟล์นี้ + บรรทัด export ใน `broadcast-follow-up/index.ts`
 *    · ลบบล็อก `[FEAT-20260825-BCASTDIRECTTICKET]` ใน `new-send.service.ts`
 *    · ลบ `@Prop` ใน `broadcast.schema.ts` และสองที่ใน `broadcast.dto.ts`
 *    · ลบช่องติ๊กฝั่ง FE + คีย์ i18n
 *    การส่งไม่ถูกแตะเลยไม่ว่าทางไหน — ไม่มีใครอ่านค่าที่นี่ไปตัดสินใจส่ง
 *
 * ② เปลี่ยนข้อความเหตุผลของเคส (ตอนนี้ = `description` ของแคมเปญ)
 *    · แก้ `needTextFor()` ด้านล่างที่เดียว · ตัวเรียกส่ง `broadcast` ทั้งก้อนมาให้
 *      แล้ว ⇒ จะไปหยิบ `name` แทน หรือผสมสองอย่าง หรืออ่านคอลัมน์ใหม่ก็ได้
 *
 * ③ เปลี่ยนข้อความบนเส้น divider (ตอนนี้ = ข้อความเดียวกับเหตุผลของเคส)
 *    · แก้ `dividerTextFor()` ด้านล่าง · แยกจาก ② ตั้งแต่แรกเพราะสองอย่างนี้มี
 *      โอกาสแยกทางกันสูง — เจ้าของบอกเองว่า "อาจจะเปลี่ยนใจได้"
 *
 * ④ เปลี่ยนหมวดของเคส (ตอนนี้ = `'Other'`)
 *    · แก้ `TICKET_CATEGORY` ด้านล่าง · ค่าที่คอลเลกชันถือจริงคือ `'Other'` / `'Payment'`
 *
 * ⑤ อยากให้เปิดเคสแม้ยิงไม่ถึง (ไม่แนะนำ)
 *    · ตัวเรียกใน `new-send.service.ts` ส่ง `reachedByHook` มา — เปลี่ยนไปส่ง
 *      รายชื่อที่เล็งไว้แทน · ที่นี่ไม่ต้องแก้อะไรเลย
 *
 * ⑥ อยากให้ทำงานกับ broadcast ด้วย
 *    · ทำไม่ได้ และไม่ใช่ข้อจำกัดของโค้ด — LINE ไม่บอกว่าใครได้รับ
 */
import type { Model } from 'mongoose';

import { openTicketBySystem } from '../../tickets/create-by-admin';

/** หมวดของเคสที่เปิดให้ — ค่าที่คอลเลกชันถือจริงคือ 'Other' | 'Payment' */
export const TICKET_CATEGORY = 'Other';

/**
 * เหตุผลของเคส — ใช้ข้อความช่อง "แคมเปญนี้ทำเพื่ออะไร" ของแคมเปญนั้น
 *
 * ⚠️ ว่าง = ไม่เปิดเคสเลย (ดู `openDirectTicketsForReached`) เพราะเคสที่ไม่มี
 *    เหตุผลคือเคสที่แอดมินเปิดมาแล้วไม่รู้ว่าต้องทำอะไร
 */
export const needTextFor = (
  broadcast: Record<string, unknown> | null | undefined,
): string => String(broadcast?.['description'] ?? '').trim();

/** ข้อความบนเส้น divider — วันนี้ใช้ประโยคเดียวกับเหตุผลของเคส (ดูหัวข้อ ③) */
export const dividerTextFor = (
  broadcast: Record<string, unknown> | null | undefined,
): string => needTextFor(broadcast);

/**
 * ติ๊กไว้ไหม
 *
 * ⚠️ `=== true` เท่านั้น — คอลัมน์นี้ไม่มี default แถวเก่าจึงไม่มีคีย์นี้เลย
 *    และ `undefined`/`null`/`0`/`''` ทั้งหมดต้องแปลว่า "ไม่เปิด"
 */
export const wantsDirectTicket = (
  broadcast: Record<string, unknown> | null | undefined,
): boolean => broadcast?.['is_direct_ticket'] === true;

export interface OpenDirectTicketDeps {
  ticketModel: Model<Record<string, unknown>>;
  chatRoomModel: Model<Record<string, unknown>>;
  chatMessageModel: Model<Record<string, unknown>>;
  assignHistoryModel: Model<Record<string, unknown>>;
  warn: (msg: string) => void;
}

export interface OpenDirectTicketResult {
  /** เปิดเคสใหม่ได้กี่คน */
  readonly opened: number;
  /** ข้ามเพราะมีเคสเปิดอยู่แล้ว — ผลลัพธ์ปกติ ไม่ใช่ความผิดพลาด */
  readonly skipped: number;
  /** พังจริงกี่คน (เปิดไม่ได้ด้วยเหตุอื่น) */
  readonly failed: number;
}

const NOTHING: OpenDirectTicketResult = { opened: 0, skipped: 0, failed: 0 };

/**
 * เปิดเคสให้ทุกคนที่ได้รับ multicast ใบนี้จริง
 *
 * @param reachedByHook hook id → รายชื่อ LINE user id ที่ยิงถึงจริง
 */
export async function openDirectTicketsForReached(
  broadcast: Record<string, unknown> | null | undefined,
  reachedByHook: ReadonlyMap<string, readonly string[]>,
  deps: OpenDirectTicketDeps,
): Promise<OpenDirectTicketResult> {
  if (!wantsDirectTicket(broadcast)) return NOTHING;

  const need = needTextFor(broadcast);
  /* ไม่มีเหตุผล = ไม่เปิด · เคสที่เปิดมาโดยไม่บอกว่าให้ทำอะไร คือเคสที่แอดมิน
     ต้องไปไล่ถามเองว่ามันมาจากไหน ซึ่งแย่กว่าไม่มีเคส
     (ฟอร์มบังคับกรอก description อยู่แล้ว นี่คือชั้นกันพลาดชั้นที่สอง) */
  if (!need) {
    deps.warn(
      '[BCASTDIRECTTICKET] ติ๊กเปิดเคสไว้ แต่แคมเปญไม่มีข้อความ "แคมเปญนี้ทำเพื่ออะไร" ⇒ ไม่เปิดเคสให้ใครเลย',
    );
    return NOTHING;
  }
  const dividerContent = dividerTextFor(broadcast);

  let opened = 0;
  let skipped = 0;
  let failed = 0;

  for (const [hookId, lineIds] of reachedByHook) {
    if (!hookId || lineIds.length === 0) continue;
    /* ห้องเป็นตัวบอกว่าใครคือ member และอยู่ OA ไหน — ทางเดียวกับที่ตัวเขียน
       สำเนาแชทข้าง ๆ ใช้ ⇒ ถ้าวันหนึ่งรูปห้องเปลี่ยน สองที่นี้พังพร้อมกัน
       ไม่ใช่พังทีละที่แบบเงียบ ๆ */
    const rooms = (await deps.chatRoomModel
      .find({ hook_id: hookId, line_user_id: { $in: [...lineIds] } })
      .select({ _id: 1 })
      .lean()
      .exec()) as unknown as Array<{ _id: unknown }>;

    for (const room of rooms) {
      const roomId = String(room?._id ?? '');
      if (!roomId) continue;
      try {
        await openTicketBySystem(
          {
            roomId,
            category: TICKET_CATEGORY,
            needDetail: need,
            dividerContent,
          },
          {
            ticketModel: deps.ticketModel,
            chatRoomModel: deps.chatRoomModel,
            chatMessageModel: deps.chatMessageModel,
            assignHistoryModel: deps.assignHistoryModel,
            warn: deps.warn,
          },
        );
        opened += 1;
      } catch (e) {
        /* ⭐ "มีเคสเปิดอยู่แล้ว" ไม่ใช่ความผิดพลาด — เป็นตัวกันเคสซ้ำของประตูนั้น
           ทำงานถูกต้อง · แยกนับไว้เพื่อให้คนอ่าน log แยกออกจากของที่พังจริง
           ⚠️ ดูจาก **ข้อความ** ไม่ใช่ชนิดของ exception เพื่อไม่ต้อง import
              `@nestjs/common` เข้ามาที่ไฟล์นี้ · ประโยคนั้นถูกปักไว้ในเทสแล้ว */
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('มีเคสเปิดอยู่แล้ว')) skipped += 1;
        else {
          failed += 1;
          deps.warn(
            `[BCASTDIRECTTICKET] เปิดเคสไม่สำเร็จ (ห้อง ${roomId}): ${msg}`,
          );
        }
      }
    }
  }

  return { opened, skipped, failed };
}
