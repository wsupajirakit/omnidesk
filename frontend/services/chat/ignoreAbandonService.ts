/**
 * ==== [FEAT-20260821-ABANDONSHIELD] โล่ปิด/เปิดระบบช่วยเหลือลงทะเบียน ====
 *
 * เจ้าของสั่ง (20/08/2026): โล่บน avatar ฝั่งขวาของ panel ticket support
 * **"สามารถคลิกแล้วเลือกได้"** · กดแล้วมี modal ยืนยัน · **"audit log เซฟด้วย"**
 *
 * ## BE ทำอะไรให้แล้วบ้าง — ฝั่งนี้ไม่ต้องทำซ้ำ
 * · route เดียวที่เขียนค่าได้: `PATCH /api/line-users/:id/ignore-abandon`
 *   (มี alias `api/channel-users/:id/…` ชี้ handler เดียวกัน)
 * · **audit เขียนที่ BE** ไม่ใช่ที่นี่ — `member-abandon-audit.helper.ts`
 *   บันทึกทุกครั้งที่ค่าเปลี่ยน ไม่ว่าใครเรียก route ⇒ **หน้าจอไม่ต้องยิง audit เอง**
 *   (ต่างจาก precedent เดิม `pages/chat/TicketSupport.tsx:1625` ที่เขียนจาก browser)
 * · scope: BE เช็คว่าผู้เรียกมีห้องร่วมกับ member คนนี้ไหม ก่อนเขียนเสมอ
 *
 * ## ⚠️ ต้องส่ง boolean แท้เท่านั้น
 * BE ตั้งใจไม่ใช้ DTO ที่มี `@IsBoolean()` เพราะ `main.ts` เปิด
 * `enableImplicitConversion` ⇒ class-transformer แปลง `"false"` เป็น `true`
 * **ก่อน** validator ทำงาน (วัดจริงแล้ว) · BE จึงเช็ค `typeof` เอง
 * ⇒ ส่งสตริง `'true'` / `'false'` มาจะได้ **400** ไม่ใช่ 200 เงียบ ๆ
 * ดู `omnidesk-api/todo/be_todo42_21082026.md` §8a
 *
 * ## ทำไมไฟล์นี้แยกออกมา
 * `TicketChat.tsx` 4,700+ บรรทัด เกินเพดาน `max-lines: 400` ไปไกล
 * เจ้าของสั่ง **"ห้ามยัด ห้ามบวม จัดระเบียบ"** ⇒ การเรียก API อยู่ที่นี่
 * หน้าจอเหลือแค่เรียกใช้
 *
 * revert: ลบไฟล์นี้ + `components/chat/IgnoreAbandonShield.tsx` + จุดเรียกใน
 *         `TicketChat.tsx` · ค่าที่เขียนไปแล้วใน DB ไม่มีใครอ่านนอกจาก BE gate
 */
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

export interface IgnoreAbandonResponse {
  success: boolean;
  data?: { ignore_abandon_assist?: boolean } | null;
}

/**
 * อ่านค่าจาก member row ที่หน้าจอถืออยู่แล้ว — ไม่ยิง request
 *
 * ⚠️ `=== true` เท่านั้น ห้าม truthy: แถว member ที่มีก่อน column นี้จะอ่านได้
 * `undefined` (API ส่งแถวมาตามที่เป็น) ⇒ เขียน `!== false` เมื่อไหร่ = ทุกคน
 * กลายเป็น "ปิดอยู่" ทันที ซึ่งเป็นกฎเดียวกับที่ BE gate ใช้
 * ค่าเดิมอ่านได้ undefined ไม่ใช่ false
 */
export function isAbandonShieldOff(userData: unknown): boolean {
  if (!userData || typeof userData !== 'object') return false;
  return (userData as { ignore_abandon_assist?: unknown }).ignore_abandon_assist === true;
}

/**
 * เขียนค่าใหม่ · `memberId` คือ `_id` ของ member ไม่ใช่ LINE user id
 *
 * โยน error เมื่อ BE ตอบไม่ 2xx (`handleApiResponse` จัดการ) ⇒ ผู้เรียกต้อง
 * catch แล้วคงสถานะเดิมไว้บนจอ ห้ามเปลี่ยน state ก่อนรู้ผล
 */
export const ignoreAbandonService = {
  setIgnoreAbandon: async (
    memberId: string,
    value: boolean,
  ): Promise<IgnoreAbandonResponse> => {
    const res = await authFetch(
      `${API_BASE_URL}/api/line-users/${memberId}/ignore-abandon`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // boolean แท้ — ดูหมายเหตุหัวไฟล์
        body: JSON.stringify({ ignore_abandon_assist: value }),
      },
    );
    return handleApiResponse<IgnoreAbandonResponse>(
      res,
      'update ignore_abandon_assist',
    );
  },
};
