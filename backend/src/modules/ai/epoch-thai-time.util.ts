/**
 * ==== [FEAT-20260829-EPOCHTHAI] epoch → เวลาไทย ในก้อนที่ส่งให้ AI ====
 *
 * ปัญหา: ก้อน raw profile ส่ง epoch ดิบให้ AI (เช่น `"date": 1788012184136`)
 * แต่บรรทัดวันที่ปัจจุบันที่ AI ได้รับคือ
 *   `Today is วันเสาร์ที่ 29 สิงหาคม 69 21:11:07 (Bangkok Time)`
 * ⇒ โมเดลต้องแปลง epoch เองในหัวแล้วเทียบกับ พ.ศ. สองหลัก ซึ่งเป็นงานที่มันพลาดง่าย
 * เวลาลูกค้าถามว่า "ฝากล่าสุดเมื่อไหร่" / "ถอนไปกี่วันแล้ว"
 *
 * วิธีแก้: **เพิ่มคู่ ไม่แทนที่** — `date` เดิมยังอยู่ครบ และเติม `date_th` ที่เป็น
 * ข้อความไทยรูปแบบเดียวกับ `Today is` เป๊ะ ⇒ โมเดลเทียบสองบรรทัดตรง ๆ ได้เลย
 *
 *   "date": 1788012184136,
 *   "date_th": "วันเสาร์ที่ 29 สิงหาคม 69 21:03:04"
 *
 * ── ขอบเขต (แก้ที่เดียว: ค่าคงที่ข้างล่าง) ─────────────────────────────────
 * · `EPOCH_FIELDS`  — ชื่อ field ที่จะแปลง เพิ่ม/ลบได้อิสระ
 * · `SUFFIX`        — ชื่อ field ที่เติม
 * · `EPOCH_MIN_MS`  — เกณฑ์ว่าเลขไหน "ใหญ่พอจะเป็นเวลา"
 * ไม่ต้องแตะตัวเดินก้อนเลย
 *
 * ── ทำไมไม่เดาจากค่าอย่างเดียว ─────────────────────────────────────────────
 * สแกนก้อนจริงทั้งไฟล์เมื่อ 29/08/2026: มีตัวเลข 72 ตัว เป็น epoch 24 ตัว
 * (`date` 15 · `updated_at` 6 · `created_at` 3) ที่เหลือ 48 ตัวไม่ใช่
 * ตัวที่ใหญ่สุดที่ไม่ใช่เวลาคือ `total_deposit` = 168,924 ซึ่งห่างจากเกณฑ์
 * ~5,900 เท่า ⇒ ปลอดภัย แต่ยัง**บังคับว่าต้องชื่อตรงกับ EPOCH_FIELDS ด้วย**
 * เพราะวันหนึ่ง API อาจส่งยอดเงินหลักพันล้านมา แล้วมันจะกลายเป็นวันที่เงียบ ๆ
 *
 * ── หน่วยเวลา: ก้อนนี้ปนกันสองแบบ ──────────────────────────────────────────
 * `date` = 13 หลัก (มิลลิวินาที) · `created_at`/`updated_at` = 10 หลัก (วินาที)
 * ถ้าตีหน่วยผิดจะได้ปี 1970 หรือปี 58000 โดยไม่ error ⇒ ตัดสินจากขนาดของค่า
 * ไม่ใช่จากชื่อ field เพราะชื่อไม่ได้การันตีหน่วย
 *
 * ── ห้ามพัง ────────────────────────────────────────────────────────────────
 * ทุกทางออกมี fallback: อ่านไม่ได้/แปลงไม่ได้/โครงสร้างไม่ตรง ⇒ คืนก้อนเดิม
 * ไม่มี throw ออกจากไฟล์นี้ เพราะปลายทางคือคำตอบที่ลูกค้ารอ
 *
 * revert: ลบไฟล์นี้ + จุดเรียกใน rag-engine.service.ts
 *         (`z-test/unit/epoch-thai-time.spec.ts` ไปด้วย)
 */

/**
 * ==== จุดที่อนุญาตให้แปลง — ล็อกทั้ง "อยู่ในกล่องไหน" และ "ชื่ออะไร" ====
 *
 * ⚠️ จงใจไม่ใช้ชื่อ field ลอย ๆ อย่างเดียว. `date` / `updated_at` เป็นชื่อสามัญ
 * มาก — ถ้าวันหนึ่ง API เพิ่ม `promotion.current_promotion_info.updated_at`
 * หรือ `tier.date` ขึ้นมา มันจะถูกแปลงทันทีโดยไม่มีใครตัดสินใจ. ล็อกคู่กับ
 * **กล่องแม่** จึงเป็นการบอกว่า "แปลงเฉพาะ 9 จุดที่เราตรวจแล้วเมื่อ 29/08/2026"
 *
 * key = ชื่อ array/object แม่ที่อยู่ชั้นบนสุดของรายการนั้น
 * value = ชื่อ field เวลาในแต่ละรายการ
 *
 * path จริงที่สแกนได้จากก้อน raw profile (9 จุด):
 *   finance.transactions.deposit[].date
 *   finance.transactions.withdraw[].date
 *   finance.balances[].updated_at
 *   bonus.cashback_history[].date
 *   activity.coin_received[].date
 *   activity.coin_spent[].date
 *   activity.point_round_history[].date
 *   promotion.recent_products[].created_at
 *   promotion.recent_products[].updated_at
 *
 * เพิ่มจุดใหม่ = เพิ่มบรรทัดเดียวตรงนี้ · ไม่ต้องแตะตัวเดินก้อน
 */
export const EPOCH_SCOPE: Readonly<Record<string, readonly string[]>> = {
  deposit: ['date'],
  withdraw: ['date'],
  balances: ['updated_at'],
  cashback_history: ['date'],
  coin_received: ['date'],
  coin_spent: ['date'],
  point_round_history: ['date'],
  recent_products: ['created_at', 'updated_at'],
};

/** ชื่อ field เวลาทั้งหมดที่รู้จัก — ได้มาจาก EPOCH_SCOPE ไม่เขียนซ้ำ */
export const EPOCH_FIELDS: readonly string[] = Object.freeze([
  ...new Set(Object.values(EPOCH_SCOPE).flat()),
]);

/** ต่อท้ายชื่อ field เดิมเป็นตัวใหม่ */
export const SUFFIX = '_th';

/**
 * เล็กกว่านี้ถือว่าไม่ใช่เวลา = 2001-09-09 (วินาที) หรือ 1970-01-12 (มิลลิวินาที)
 * ตั้งไว้เพื่อกัน `0`, `-1`, ยอดเงิน และค่าที่ยังไม่ถูกเซ็ต
 */
export const EPOCH_MIN = 1_000_000_000;

/** ลึกเกินนี้ไม่เดินต่อ — กันโครงสร้างวนลูปทำให้ค้าง */
const MAX_DEPTH = 20;

/** ขอบบน: ปี ~2286 ในหน่วยวินาที · เกินนี้ถือว่าเป็นมิลลิวินาที */
const SECONDS_MAX = 10_000_000_000;

/**
 * เพดานบนของ "ค่าที่ยอมรับว่าเป็นเวลา" — 1 ม.ค. **ค.ศ.** 2100
 *
 * ⚠️ ตัวเลขนี้ไม่เกี่ยวกับปีที่แสดงผลเลย. ผลลัพธ์ที่โมเดลเห็นเป็น **พ.ศ. สองหลัก**
 * เสมอ (`วันเสาร์ที่ 29 สิงหาคม 69`) เพราะ `toThaiText` บวก 543 ให้อยู่แล้ว —
 * ค่านี้ทำหน้าที่เดียวคือ **กรองขาเข้า**: เลขที่ใหญ่จนแปลออกมาเป็นปีเกิน 2100
 * แปลว่าไม่ใช่วันที่ของลูกค้า (เจอจริง: 99999999999999 แปลได้ปี 5138 แล้วผ่าน
 * ฉลุยตอนเพดานยังเป็นปี 9999). ข้อมูลจริงล่าสุดในก้อน = ค.ศ. 2026 จึงห่างมาก.
 */
const MAX_MS = Date.UTC(2100, 0, 1);

/**
 * เดาหน่วยจากขนาด แล้วคืนเป็นมิลลิวินาที
 * `null` = ไม่ใช่เวลาที่ใช้ได้ (ผู้เรียกต้องไม่เติมอะไรเลย)
 */
export function toMillis(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < EPOCH_MIN) return null;
  const ms = value < SECONDS_MAX ? value * 1000 : value;
  /* เกินปี 2100 แปลว่าตีหน่วยพลาด (เช่นเลข 14 หลักที่ไม่ใช่เวลา) — ยอมไม่เติม
     ดีกว่าเติมผิด. เพดานเดิมตั้งไว้ที่ปี 9999 ซึ่งหลวมเกินไป: 99999999999999
     แปลเป็นปี 5138 แล้วผ่านฉลุย ทั้งที่ชัดว่าไม่ใช่วันที่ของลูกค้า. */
  if (ms > MAX_MS) return null;
  return ms;
}

/**
 * รูปแบบเดียวกับ `formatThaiDateTime()` ใน rag-engine (บรรทัด `Today is …`)
 * — วันในสัปดาห์ + วันที่ + เดือนไทย + พ.ศ. สองหลัก + เวลา 24 ชม.
 *
 * ⚠️ จงใจไม่ import ตัวนั้นมาใช้ซ้ำ เพราะมันรับเฉพาะ "เวลาปัจจุบัน" ไม่รับ
 * argument การแก้ให้รับ argument คือการแตะโค้ดที่ AI ทุกคำตอบพึ่งอยู่
 * ⇒ ถ้าวันหนึ่งมันถูกแก้ให้รับ Date ได้ ค่อยมาเรียกใช้แทนบล็อกนี้
 */
export function toThaiText(ms: number): string | null {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const tz = { timeZone: 'Asia/Bangkok' } as const;
    const weekday = d.toLocaleDateString('th-TH', { weekday: 'long', ...tz });
    const day = d.toLocaleDateString('th-TH', { day: '2-digit', ...tz });
    const month = d.toLocaleDateString('th-TH', { month: 'long', ...tz });
    const yearBE = (
      Number(d.toLocaleString('en-US', { year: 'numeric', ...tz })) + 543
    )
      .toString()
      .slice(-2);
    const time = d.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      ...tz,
    });
    return `${weekday}ที่ ${day} ${month} ${yearBE} ${time}`;
  } catch {
    return null;
  }
}

/**
 * เดินทั้งก้อน เติม `<field>_th` ข้าง epoch ทุกจุดที่แปลงได้
 *
 * · **ไม่แก้ของเดิม** — คัดลอกก่อนเสมอ ก้อนต้นทางถูกใช้ที่อื่นด้วย
 * · ค่าที่แปลงไม่ได้ (null / 0 / string / NaN / เล็กเกิน) ⇒ ข้ามเงียบ ๆ ไม่เติม
 * · มี `<field>_th` อยู่แล้ว ⇒ ไม่ทับ (ของต้นทางชนะ)
 * · พังตรงไหนก็ได้ ⇒ คืนก้อนเดิมทั้งอัน
 */
export function withThaiTime<T>(input: T): T {
  try {
    if (!input || typeof input !== 'object') return input;
    const copy = JSON.parse(JSON.stringify(input)) as unknown;

    const walk = (node: unknown, depth: number): void => {
      if (depth > MAX_DEPTH || !node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      const rec = node as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        /* ชื่อกล่องแม่ตรงกับที่ล็อกไว้ ⇒ ลูก ๆ ของมันคือรายการที่แปลงได้.
           รูปทรงอะไรก็ได้ (array หรือ object เดี่ยว) — `stampList` รับทั้งคู่ */
        const allowed = EPOCH_SCOPE[key];
        if (allowed) {
          stampList(rec[key], allowed);
          continue;
        }
        walk(rec[key], depth + 1);
      }
    };

    /**
     * เติมเวลาไทยให้รายการในกล่องที่ล็อกไว้
     * รับได้ทั้ง array, object เดี่ยว, null, และค่าที่ไม่ใช่ object — อย่างหลัง
     * ข้ามเงียบ ๆ เพราะ "ไม่มีข้อมูล" ไม่ใช่ข้อผิดพลาด (ลูกค้าที่ยังไม่เคยฝาก
     * จะได้ `deposit: []` หรือไม่มี key นี้เลย)
     */
    const stampList = (list: unknown, fields: readonly string[]): void => {
      if (!list || typeof list !== 'object') return;
      const items = Array.isArray(list) ? list : [list];
      for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const row = item as Record<string, unknown>;
        for (const f of fields) {
          const target = f + SUFFIX;
          if (target in row) continue; // ของต้นทางชนะ ไม่ทับ
          const ms = toMillis(row[f]);
          if (ms === null) continue; // null / 0 / string / NaN ⇒ ไม่เติม
          const text = toThaiText(ms);
          if (text) row[target] = text;
        }
      }
    };

    walk(copy, 0);
    return copy as T;
  } catch {
    return input; // กันพัง — ตกกลับก้อนเดิมทั้งหมด
  }
}
