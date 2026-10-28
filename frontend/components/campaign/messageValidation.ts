/**
 * [FIX-20260825-BCASTFLEXIDVALID] กฎเดียวว่า "ข้อความของแคมเปญกรอกครบหรือยัง"
 *
 * WHAT: ตอบคำถามเดียว — message ที่ฟอร์มถืออยู่ผ่านหรือไม่ · ผ่าน = `null`
 *       ไม่ผ่าน = รหัสเหตุผล ให้ผู้เรียกไปแปลงเป็นคำแปลเอง (โมดูลนี้ไม่รู้จัก i18n)
 *
 * WHY: เจ้าของแจ้ง 25/08 พร้อมภาพ — หน้า create broadcast เลือก Flex Message
 *      **ผูกการ์ดไว้แล้ว** (จอขึ้น "ผูกกับการ์ด id: 6a8c6ae…") แต่ยังฟ้อง
 *      "กรุณากรอกข้อความ" จนกดบันทึกไม่ผ่าน
 *
 *      ต้นเหตุ: ตอน [FEAT-20260824-BCASTFLEXID] เพิ่ม "ผูกการ์ดด้วย id" เข้ามา
 *      เป็นทางที่สอง แต่ตัว validate ยังตรวจเฉพาะ `flexText` (ช่อง JSON ดิบ)
 *      ซึ่งทางใหม่ไม่ได้กรอกเลย ⇒ ว่าง ⇒ ตกเงื่อนไข "ต้องกรอก"
 *      ฝั่งส่งค่าไม่ผิด — `flex/buildMessagePayload.ts:67` อ่าน `flex_id` ก่อนอยู่แล้ว
 *      และ BE ก็อ่าน `flex_id` ก่อน fallback `flex_json` ⇒ ผิดที่ตัว validate ที่เดียว
 *
 * WHY แยกไฟล์: `validate()` เดิมเป็น closure ใน `BroadcastFormModal.tsx` ที่ยาวเกิน
 *      พันบรรทัด ⇒ กฎข้อนี้ทดสอบตรงไม่ได้เลย และนั่นคือเหตุผลที่บั๊กนี้หลุดมาได้
 *      แยกออกมาแบบเดียวกับ `campaignTime.ts` ที่อยู่ข้าง ๆ ⇒ ตรึงด้วยเทสได้จริง
 *
 * ⚠️ "ผูกการ์ดแล้ว" ไม่ได้แปลว่า JSON ที่ค้างอยู่ในช่องจะเสียได้ — ถ้ามีข้อความค้าง
 *    และ parse ไม่ผ่าน ยังต้องฟ้อง ไม่งั้นคนที่แก้ JSON พังแล้วเผลอไปผูกการ์ด
 *    จะบันทึกทับของเสียไปเงียบ ๆ
 *
 * revert: ลบไฟล์นี้ + คืนบล็อก `if (type === 'text') … else if (type === 'flex')`
 *         เดิมใน BroadcastFormModal.tsx (marker เดียวกัน)
 */
import type { MessagePayload } from './flex/buildMessagePayload';

/** เหตุผลที่ไม่ผ่าน — ผู้เรียกแปลงเป็นคีย์แปลเอง (`broadcast.form_<reason>`) */
export type MessageProblem = 'required' | 'image_https' | 'flex_invalid';

const filled = (v: string | null | undefined): boolean => !!v && v.trim() !== '';

/**
 * @param message ก้อน message ที่ฟอร์มถืออยู่
 * @param flexText ข้อความในช่อง Flex JSON ดิบ (ทางเดิม) — ว่างได้ถ้าผูกด้วย id
 * @returns `null` = ผ่าน · ไม่งั้นคือรหัสเหตุผล
 */
export const validateMessage = (
  message: Pick<MessagePayload, 'type' | 'text' | 'image_url' | 'flex_id'>,
  flexText: string,
): MessageProblem | null => {
  if (message.type === 'text') {
    return filled(message.text) ? null : 'required';
  }

  if (message.type === 'image') {
    const url = (message.image_url ?? '').trim();
    if (!url) return 'required';
    // เช็คเดิมไม่เปลี่ยน: ต้องขึ้นต้น https:// เท่านั้น (LINE ไม่รับ http)
    return /^https:\/\//i.test(url) ? null : 'image_https';
  }

  if (message.type === 'flex') {
    const raw = flexText.trim();
    // ⭐ ทางที่สอง: ผูกการ์ดด้วย id แล้วไม่ต้องกรอก JSON — นี่คือบั๊กที่แก้
    const bound = filled(message.flex_id);
    if (!raw) return bound ? null : 'required';
    try {
      JSON.parse(raw);
      return null;
    } catch {
      // มี JSON ค้างอยู่แต่เสีย ⇒ ฟ้องเสมอ แม้จะผูกการ์ดไว้แล้วก็ตาม
      return 'flex_invalid';
    }
  }

  return null;
};
