/**
 * [FEAT-2708-DIVIDERDISPLAY] "เฉพาะตอนแสดงผล ให้แสดงแค่ displayName แอดมิน"
 * ===========================================================================
 * เจ้าของ 27/08 หลังเห็นแถวประวัติ `"เปิดเคส โดย dev (Developer)"` บนจอ:
 * ข้อมูล **เก็บเหมือนเดิมทุกไบต์** (BE ยังประกอบคู่ `user (display)` ลง content
 * — ดู `omnidesk-api ticket-divider.helper.ts [DEC-2708-DIVIDERDISPLAY]`) ·
 * การตัดเหลือชื่อเดี่ยวเป็นเรื่องของ "ตอนวาด" ที่นี่ที่เดียว ⇒ แถวเก่าแถวใหม่
 * อ่านเหมือนกันหมดโดยไม่มี migrate
 *
 * ⚠️ ครอบเฉพาะ variant ที่ writer ฝั่ง BE ประกอบ "… โดย <u> (<d>)" จริงเท่านั้น
 *    (`tickets.service.ts` accept/assign/close · create-by-admin open/reopen ·
 *    claim ยุคเก่า) — divider ตัวอื่นถือ free text ที่มีวงเล็บได้ (ชื่อ job ฯลฯ)
 *    regex ที่ไม่ล็อก variant เคยถูกชี้ว่าเป็นความเสี่ยงไว้ใน todo9 §2.2 (ทาง ข)
 * revert: ลบไฟล์นี้ + จุดเรียกใน ChatRoomView (label={...}) กลับเป็น msg.content
 */
export const ACTOR_DIVIDER_VARIANTS: ReadonlySet<string> = new Set([
  'accept',
  'claim',
  'assign',
  'close',
  'open_by_admin',
  'reopen_by_admin',
]);

/** คู่ท้ายสตริง: "… โดย <ไม่มีวงเล็บ> (<ไม่มีวงเล็บ>)" — จับกลุ่มท้ายสุดเท่านั้น */
const TRAILING_PAIR = /^(.*โดย )([^()]+) \(([^()]+)\)\s*$/;

export function dividerActorDisplay(
  content: string,
  variant?: string | null,
): string {
  if (!variant || !ACTOR_DIVIDER_VARIANTS.has(variant)) return content;
  const m = TRAILING_PAIR.exec(content);
  if (!m) return content;
  return `${m[1]}${m[3]}`;
}
