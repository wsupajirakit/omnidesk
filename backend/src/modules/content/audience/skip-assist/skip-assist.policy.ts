/**
 * [FEAT-20260825-BCASTSKIPASSIST] ข้ามคนที่แอดมินกำลังคุยอยู่
 * ===========================================================================
 * โจทย์ (เจ้าของ 25/08): ติ๊ก ⇒ งานใบนี้ไม่ส่งให้คนที่ `assist_status` เป็น true
 * ไม่ติ๊ก ⇒ ส่งทุกคนเหมือนเดิมทุกประการ
 *
 * ── ทำไมมันไม่ใช่ "ตัวกรองอีกอันหนึ่ง" ────────────────────────────────────
 * 🔴 **assist เป็นของ "ห้อง" ไม่ใช่ของ "คน"** — `chat_rooms.assist_status`
 *    ผูกกับคู่ (`hook_id`, `line_user_id`) · `members` ไม่มีคอลัมน์นี้ และ
 *    ตัวกรองผู้รับทั้งระบบคิวรี่ `members` อย่างเดียว
 *    ⇒ ทำเป็นกฎในลิสต์ "เลือกผู้รับ" ไม่ได้ ถ้าไม่ไปแตะอีกคอลเลกชัน
 * 🔴 ทางที่ **ไม่** เลือก: คัดลอกค่ามาไว้บน `members` (denormalize) — เร็วกว่า
 *    ตอนคิวรี่ แต่ต้องมีคนคอยซิงก์ทุกจุดที่ assist เปลี่ยน และวันที่ลืมซิงก์
 *    ระบบจะข้ามคนผิดแบบเงียบ ๆ · นั่นคือหนี้ที่เจ้าของสั่งห้ามสร้าง
 * ⇒ อ่านสด ๆ หนึ่งคิวรี่ต่อการส่งหนึ่งรอบ แล้วแปลงเป็นเงื่อนไข "ไม่เอาคนพวกนี้"
 *
 * ── ราคาที่วัดแล้ว ────────────────────────────────────────────────────────
 * `chat_rooms` มีดัชนี `hook_id_1` และ `line_user_id_1_hook_id_1` อยู่แล้ว
 * (ตรวจกับฐานจริง 25/08) ⇒ **ไม่ต้องเพิ่มดัชนีใหม่** · แถวที่ตอบกลับคือ
 * "ห้องที่มีคนกำลังดูแลอยู่" ซึ่งโดยธรรมชาติมีน้อย เพราะมีมนุษย์นั่งอยู่ตรงนั้น
 *
 * ── PLANNER ไม่ใช่ READER ────────────────────────────────────────────────
 * ไฟล์นี้ไม่ยิงคิวรี่เอง มันคืน "รูป" ของคิวรี่ ตามสไตล์เดียวกับ
 * `audience/prefilter/` และ `audience/oa-scope.ts` ⇒ ตัดสินใจทั้งหมดเทสได้
 * โดยไม่ต้องมีฐานข้อมูล และที่เดียวที่แตะ Mongo คือฝั่งรัน
 *
 * ── ปุ่มปรับ ──────────────────────────────────────────────────────────────
 * ปิดทั้งฟีเจอร์            → SKIP_ASSIST_ENABLED = false
 * เปลี่ยนขอบเขต OA         → planAssistedLookup (ดูหมายเหตุในตัวฟังก์ชัน)
 * เปลี่ยนคอลัมน์ที่ตัดสิน   → ASSIST_FIELD / ROOM_MEMBER_FIELD
 *
 * revert: ลบโฟลเดอร์นี้ + บล็อกใน `new-send.service.ts` + สองบรรทัดใน
 *         `audience-filter.ts` + ช่องติ๊กฝั่ง FE
 */

/** ปิดสวิตช์ใหญ่ — งานทุกใบกลับไปส่งทุกคนทันที โดยไม่ต้องแก้ที่อื่น */
export const SKIP_ASSIST_ENABLED = true;

/** ชื่อ model (ไม่ใช่ชื่อ collection) — ฝั่งรันหยิบ model ที่โมดูลอื่นลงทะเบียนไว้ */
export const ROOM_MODEL = 'ChatRoom';

/** คอลัมน์ที่บอกว่าห้องนี้มีแอดมินดูแลอยู่ */
export const ASSIST_FIELD = 'assist_status';

/** คอลัมน์บนห้องที่เก็บ LINE user id — ตัวเชื่อมไปหา `members.line_user_id` */
export const ROOM_MEMBER_FIELD = 'line_user_id';

export interface AssistedLookup {
  readonly model: string;
  readonly filter: Record<string, unknown>;
  readonly projection: Record<string, 0 | 1>;
  /** คอลัมน์บนแถวที่ตอบกลับ ที่ต้องอ่านค่าออกมา */
  readonly field: string;
}

/**
 * งานใบนี้ต้องถามเรื่อง assist ไหม
 *
 * ⚠️ เทียบกับ `=== true` ตรง ๆ ไม่ใช่ truthy — งานเก่าที่ไม่มีคีย์นี้เลย
 *    ต้องได้คำตอบเดียวกับงานที่ติ๊กออก คือ "ไม่ต้องถาม"
 */
export const shouldSkipAssisted = (broadcast: unknown): boolean => {
  if (!SKIP_ASSIST_ENABLED) return false;
  if (broadcast === null || typeof broadcast !== 'object') return false;
  return (broadcast as Record<string, unknown>)['skip_assist'] === true;
};

/**
 * รูปคิวรี่: "ห้องของ OA เหล่านี้ ที่มีแอดมินกำลังดูแลอยู่"
 *
 * ⚠️ **ขอบเขตที่เลือกไว้ และเหตุผล** — ถูกดูแลอยู่ที่ OA ใด OA หนึ่งของงานใบนี้
 *    = ข้ามทั้งใบ · เพราะ assist ผูกกับห้อง คนคนหนึ่งจึงอาจถูกดูแลที่ OA หนึ่ง
 *    และไม่ถูกดูแลที่อีก OA หนึ่ง
 *    ⇒ เลือกฝั่ง "ข้ามเกินไปหนึ่งคน" มากกว่า "ส่งแทรกเข้าไปในห้องที่คนกำลังคุยกันอยู่"
 *      ซึ่งคือความเสียหายที่เจ้าของขอให้กัน
 *    ถ้าวันหนึ่งอยากได้แบบราย OA จริง ๆ ให้ย้ายการเรียกไปไว้ในลูปต่อ OA แล้วส่ง
 *    `hookIds` ทีละตัว — ตัวฟังก์ชันนี้ไม่ต้องแก้เลย
 *
 * ⚠️ `hookIds` ว่าง ⇒ คืน `null` ไม่ใช่คิวรี่ที่ไม่มีเงื่อนไข OA · คิวรี่แบบหลังจะ
 *    กวาดห้องของ OA ที่ไม่เกี่ยวกับงานใบนี้มาข้ามด้วย
 */
export const planAssistedLookup = (
  hookIds: readonly string[],
): AssistedLookup | null => {
  const ids = hookIds.filter((h) => typeof h === 'string' && h.length > 0);
  if (ids.length === 0) return null;
  return {
    model: ROOM_MODEL,
    filter: { hook_id: { $in: [...ids] }, [ASSIST_FIELD]: true },
    /* อ่านคอลัมน์เดียวพอ · `_id: 0` สำคัญ ไม่งั้นทุกแถวลาก ObjectId ของตัวเอง
       กลับมาฟรี ๆ ทั้งที่ไม่มีใครใช้ */
    projection: { [ROOM_MEMBER_FIELD]: 1, _id: 0 },
    field: ROOM_MEMBER_FIELD,
  };
};

/**
 * แปลงแถวที่อ่านได้เป็นรายชื่อ LINE id ที่ต้องข้าม
 *
 * ⚠️ ตัดซ้ำ — คนคนเดียวมีห้องได้หลาย OA ⇒ ได้หลายแถว · `$nin` ที่มี id ซ้ำ
 *    ให้ผลเหมือนกันแต่เอกสารคิวรี่ใหญ่ขึ้นเปล่า ๆ
 */
export const assistedIdsFrom = (
  rows: readonly unknown[],
  field: string = ROOM_MEMBER_FIELD,
): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const raw = (row as Record<string, unknown>)[field];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
};
