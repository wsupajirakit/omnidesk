/**
 * [FIX-20260826-DROPUPCLIP] เมนูควรพลิกขึ้นเมื่อ **กล่องที่ตัดมันจริง ๆ** ไม่พอ
 * ===========================================================================
 * เจ้าของแจ้ง 26/08 พร้อมภาพ: ช่อง LINE OA ในฟอร์ม broadcast กางลงล่างแล้วกินขอบ
 *
 * 🔴 ต้นเหตุไม่ใช่ "ยังไม่ได้ทำ" — `[UI-20260825-DROPUP]` ทำไปแล้วเมื่อ 25/08
 * แต่วัดที่ว่างด้วย `window.innerHeight` ทั้งที่ตัวที่ตัดเมนูคือ **ฟอร์ม** ซึ่งมี
 * `overflow-y-auto` (`BroadcastFormModal.tsx:859`) ไม่ใช่ขอบจอ
 *
 *   จอสูง 1000 · ปุ่มจบที่ 700 ⇒ เทียบกับจอเหลือ 300 ⇒ "พอ" ⇒ ไม่เคยพลิก
 *   แต่ฟอร์มจบที่ 720            ⇒ เหลือจริง 20    ⇒ เมนู 256px โดนตัด
 *
 * ของที่ `absolute` อยู่ในกล่อง `overflow` จะถูกกล่องนั้นตัดเสมอ — z-index
 * ไม่เกี่ยวเลย เพิ่มเป็น z-50 ก็ยังโดนตัดเหมือนเดิม
 * กล่องที่ตัดคือใคร ต้องถามจาก DOM ไม่ใช่เดาว่าเป็นจอ
 *
 * WHY A SEPARATE FILE: การตัดสินคือส่วนที่พลาด ไม่ใช่การวาด แยกออกมาแล้วมันเป็น
 * ฟังก์ชัน pure ⇒ พิสูจน์เคส "จอเหลือแต่กล่องไม่เหลือ" ได้โดยไม่ต้อง mount โมดัล
 * ทั้งใบ และไม่ต้องหวังว่า jsdom จะคำนวณ layout ให้ (ซึ่งมันไม่ทำ)
 *
 * revert: ลบไฟล์นี้ + เทสของมัน แล้วเอา effect เดิมใน `MultiCheckSelect.tsx`
 *   ที่วัดกับ `window.innerHeight` กลับมา
 */

/**
 * ความสูงสูงสุดของเมนู
 *
 * ⚠️ ต้องเป็นค่าเดียวกับที่กล่องเมนูใช้วาดจริง (`max-h-64` = 16rem = 256px)
 * คำนวณด้วยเลขหนึ่งแล้ววาดด้วยอีกเลขหนึ่ง = วัดผิดทุกครั้งโดยไม่มีใครเห็น
 */
export const MENU_MAX_PX = 256;

type StyleReader = (el: Element) => { overflowY: string };

const defaultStyleReader: StyleReader = (el) =>
  typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
    ? window.getComputedStyle(el)
    : { overflowY: 'visible' };

/**
 * กล่องที่จะตัดเมนูจริง ๆ — ancestor ตัวแรกที่ `overflow-y` ไม่ใช่ `visible`
 *
 * คืน `null` เมื่อไม่มีใครตัดเลย (เช่นตัวเลือกที่อยู่บนหน้าเปล่า ๆ ไม่ได้อยู่ในโมดัล)
 * ⇒ คนเรียกตกกลับไปใช้ขอบจอ ซึ่งเป็นพฤติกรรมเดิมทุกประการ
 */
export function clippingRect(
  el: Element | null,
  readStyle: StyleReader = defaultStyleReader,
): DOMRect | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = readStyle(node);
    if (overflowY && overflowY !== 'visible') {
      return typeof node.getBoundingClientRect === 'function'
        ? node.getBoundingClientRect()
        : null;
    }
    node = node.parentElement;
  }
  return null;
}

export interface DropDirectionInput {
  /** กล่องของปุ่มที่กดเปิด */
  trigger: DOMRect;
  /** กล่องที่ตัด — `null` = ไม่มีใครตัด ให้ใช้ขอบจอแทน */
  clip: DOMRect | null;
  /** ใช้เมื่อ `clip` เป็น null; ปกติคือ `window.innerHeight` */
  viewportH?: number;
}

/**
 * ควรเปิดขึ้นบนไหม
 *
 * ⚠️ ไม่ได้บังคับขึ้นบนเสมอ — กติกาเดิมจาก `[UI-20260825-DROPUP]` ยังอยู่ครบ:
 * ปุ่มที่อยู่ครึ่งบนของโมดัล ถ้าบังคับพลิกขึ้นจะโดนขอบบนตัดแทน = ย้ายปัญหา
 * ไม่ใช่แก้ปัญหา ⇒ พลิกก็ต่อเมื่อ **ข้างล่างไม่พอ และข้างบนกว้างกว่า**
 */
export function shouldDropUp(input: DropDirectionInput): boolean {
  const { trigger, clip } = input;
  const bottomEdge = clip ? clip.bottom : (input.viewportH ?? 0);
  const topEdge = clip ? clip.top : 0;

  const below = bottomEdge - trigger.bottom;
  const above = trigger.top - topEdge;

  return below < MENU_MAX_PX && above > below;
}
