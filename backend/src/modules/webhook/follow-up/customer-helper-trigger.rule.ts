/**
 * [FEAT-20260825-HELPERTRIGGER] เงื่อนไข "ตอนไหนถึงจะประทับเวลา customer_helper"
 * ===========================================================================
 * WHAT. One pure predicate, no database, no await. It answers a single
 * question: did THIS webhook event actually put the customer-helper in front of
 * the customer?
 *
 * ⭐ WHY IT IS A NAMED FUNCTION IN ITS OWN FILE AND NOT AN `if` AT THE CALL
 * SITE. Owner, 25/08/2026: *"ตรงนี้ note ด้วยเผื่อเปลี่ยนเงื่อนไข ต้องทำให้สามารถ
 * แก้ไขได้ ห้าม hard code โง่ ๆ"*. The call site is a 5,000-line method; a
 * condition buried there is one nobody can find, test, or change without
 * reading the whole reply path. Here it is three lines with a name, it has its
 * own spec, and changing the policy means editing this file only.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 📌 วิธีแก้เงื่อนไขในอนาคต — อ่านตรงนี้ก่อนแก้
 * ═══════════════════════════════════════════════════════════════════════════
 * วันนี้ประทับเมื่อ **ส่ง customer-helper ออกไปสำเร็จจริง** เท่านั้น
 * ตัวแปรที่ตัดสินมีสองตัว และทั้งคู่ถูกส่งเข้ามาเป็นพารามิเตอร์ ไม่ได้อ่านเอง:
 *
 *   `offered` — รอบนี้ระบบเสนอ customer-helper ไหม (ฝั่งเรียกส่ง `useHelperQr`)
 *   `sent`    — LINE รับไปแล้วจริงไหม (ส่งไม่ผ่าน = ลูกค้าไม่เคยเห็น)
 *
 * ตัวอย่างการเปลี่ยนที่น่าจะเกิดขึ้นได้จริง:
 *   · อยากนับ "เสนอ" แทน "ส่งสำเร็จ"  → `return offered`
 *   · อยากนับเฉพาะตอนส่งเป็นการ์ด    → เพิ่มพารามิเตอร์ `asCard` แล้ว `&&` เข้าไป
 *   · อยากหยุดประทับชั่วคราว          → `return false` (ที่เหลือทั้งระบบไม่ต้องแตะ)
 * ทุกกรณีข้างบนแก้ที่ไฟล์นี้ไฟล์เดียว · จุดเรียกไม่ต้องรู้เรื่องด้วยซ้ำ
 *
 * ⚠️ ทำไม "ส่งสำเร็จ" ถึงเป็นค่าเริ่มต้น ไม่ใช่ "เสนอ": stamp นี้จะถูกเอาไปตอบ
 *    คำถามว่า "ลูกค้าคนนี้เคยได้รับข้อเสนอให้ผูกข้อมูลเมื่อไหร่" · ถ้าประทับตอน
 *    ตั้งใจจะส่ง แล้ว LINE ปฏิเสธ (โควตาหมด / reply token หมดอายุ) เราจะบันทึกว่า
 *    ลูกค้าได้รับทั้งที่เขาไม่เคยเห็นอะไรเลย — กติกาเดียวกับ notice runtime
 *    ที่เขียน stamp หลังส่งเสมอ ("ส่งก่อน ค่อยบันทึก")
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ WHAT YOU ARE ACTUALLY CHANGING WHEN YOU CHANGE THIS PREDICATE
 * ═══════════════════════════════════════════════════════════════════════════
 * เงื่อนไขสามบรรทัดนี้ไม่ได้จบในตัวเอง — มันเป็นคนตัดสินว่าใครจะ **ติดอยู่ในกลุ่มผู้รับ
 * ของแคมเปญ** และใครจะ **ขึ้นแถวเตือนบนจอแอดมิน** สองอย่างนี้ไม่มีใครมาถามซ้ำ:
 *
 *   · ปลายทางที่ 1 — audience source `follow_up.customer_helper_at`
 *     (`content/audience/sources/audience-source.registry.ts`) ยิงคิวรี่ตรงเข้า
 *     `config.follow_up.line.customer_helper_trigger_at` · ป้ายที่แอดมินเห็นคือ
 *     *"ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน"* ⇒ **ทุกคนที่ predicate นี้ปล่อยผ่าน
 *     คือคนที่ป้ายนั้นกำลังพูดถึง** ปล่อยผ่านคนที่ไม่เคยเห็นการ์ด = ป้ายโกหก
 *   · ปลายทางที่ 2 — การ์ด "การติดตาม" ฝั่ง FE
 *     (`omnidesk-console/components/member/follow-up/followStamps.ts`)
 *     แถวเตือนใบที่สาม · แอดมินอ่านแล้วเชื่อ แล้วไปทวงลูกค้าต่อ
 *
 * ⇒ ตัวอย่างที่อันตรายที่สุดในลิสต์ข้างบนคือ `return offered` (นับ "เสนอ" แทน
 *   "ส่งสำเร็จ"): วันที่ LINE ปฏิเสธเป็นชุด (โควตาหมด / reply token หมดอายุ) จะได้
 *   คนกลุ่มใหญ่ที่ถูกประทับว่า "ได้รับการ์ดแล้ว" ทั้งที่จอลูกค้าไม่เคยขึ้นอะไรเลย
 *   แล้วแคมเปญรอบถัดไปจะทวงเขาเรื่องการ์ดที่เขาไม่เคยเห็น — ไม่มี error ให้จับ
 *   มีแต่ลูกค้าที่งง. ผ่อนเงื่อนไขที่นี่ = ขยายกลุ่มผู้รับที่โน่นแบบเงียบ ๆ
 *
 * ⚠️ stamp ที่ predicate นี้สั่งประทับเป็น **ROLLING RECORD ที่ไม่มีใครลบ** ⇒
 *   ความผิดพลาดตรงนี้ไม่หายไปเอง ต้องไล่ลบมือทีละแถว (และวันนี้ไม่มีเครื่องมือให้ลบ)
 *   ส่วนความหมาย FLAG / RECORD ทั้งหมด และกติกา "stamp ไม่ใช่สถานะ" อยู่ที่
 *   `src/modules/chat/config/member-config.registry.ts` — [DOC-20260825-REGSTATUS]
 *
 * 📖 ภาพรวมแบบอ่านคนเดียวจบ: `docs/follow-up-status-spec.md`
 *
 * revert: ลบไฟล์นี้ + `customer-helper-trigger.helper.ts` + สองบรรทัดในบาร์เรล
 *         + จุดเรียกใน webhook.service.ts (marker เดียวกัน) + คีย์ในทะเบียน
 */

/**
 * ประทับเวลาไหม
 *
 * @param offered รอบนี้เสนอ customer-helper หรือเปล่า (`useHelperQr` ที่ฝั่งเรียก)
 * @param sent    LINE รับไปแล้วจริงไหม
 */
export function shouldStampCustomerHelper(
  offered: boolean,
  sent: boolean,
): boolean {
  return offered === true && sent === true;
}
