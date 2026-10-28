/**
 * [FEAT-20260825-POINTROUNDS] "สิทธิ์ร่วมกิจกรรมคงเหลือ" คำนวณจากเหรียญ ไม่ใช่ตัวเลขที่ส่งมา
 * ===========================================================================
 * เจ้าของ 25/08: *"รอบสะสมแต้มสิทธิ์ร่วมกิจกรรม ให้ site rule default config play amount
 * หาร จำนวนเหรียญ (profile member) · ถ้าเป็น 0 และ config ไม่มีค่า ไม่ต้องหาร
 * ออกค่าจริง และวงเล็บ N/A"*
 *
 * ── ทำไมต้องคำนวณเอง ─────────────────────────────────────────────────────
 * หนึ่งครั้งที่เล่นใช้เหรียญเท่ากับ `spend_amount` ⇒ เหรียญที่มีอยู่แปลเป็นจำนวนครั้ง
 * ที่ใช้สิทธิ์ได้ · ตัวเลขที่ปลายทางส่งมา (`point_round.rounds_available`) ไม่ได้ผูกกับเหรียญ
 * ที่เห็นบนจอ ⇒ สองตัวเลขในการ์ดเดียวกันเคยขัดกันเอง
 *
 * ── ค่าที่อ่าน อ่านจากของจริง ไม่ใช่จากเอกสาร ────────────────────────────
 * `shop.products.products[]` เป็น **อาเรย์ของสินค้าทั้งหมด** ส่วนใหญ่ `default_config: null`
 * และ `is_active: false` · ตัวรอบสะสมแต้มคือรายการที่ `id === 'POINT_ROUND'` ซึ่งมี
 * `default_config.spend_amount` (ตัวอย่างจริงจากเจ้าของ: 10, `spend_asset: "coin"`)
 * ⚠️ มี `OMNI_POINT_ROUND` อยู่ด้วยและ **ไม่ใช่ตัวนี้** — `default_config: null`
 *    และปิดอยู่ · จับด้วยชื่อสินค้าแบบหลวม ๆ (regex) จะได้ผิดตัว
 *
 * ── "0 หรือไม่มี config" ต่างจาก "หารแล้วได้ 0" ─────────────────────────
 * 🔴 `spend_amount: 0` ไม่ได้แปลว่าใช้ฟรีไม่จำกัด มันแปลว่า **ยังไม่ตั้งค่า** ⇒
 *    หารไม่ได้ (หารศูนย์) และเดาแทนเจ้าของไม่ได้ ⇒ โชว์เหรียญจริงพร้อม "(N/A)"
 *    ตามที่สั่ง · ต่างจากคนที่มีเหรียญ 5 กับ play 10 ซึ่งหมุนไม่ได้จริง ๆ = 0 ครั้ง
 *
 * revert: ลบไฟล์นี้ + สองบรรทัดใน `PersonalPanel.tsx` ที่เรียกมัน
 */

/** id ของสินค้ารอบสะสมแต้มในก้อน site rules — ชื่อตายตัวเพราะมันคือคีย์ ไม่ใช่ข้อความ */
export const POINT_ROUND_PRODUCT_ID = 'POINT_ROUND';

/**
 * ดึง `spend_amount` ของรอบสะสมแต้มจากก้อน site rules
 *
 * คืน `null` เมื่ออ่านไม่ได้ทุกกรณี (ไม่มีก้อน · ไม่มีสินค้านี้ · `default_config`
 * เป็น null · ค่าไม่ใช่ตัวเลข) ⇒ ฝั่งเรียกเจอ `null` แล้วรู้ทันทีว่า "ไม่มีค่า"
 * โดยไม่ต้องแยกแยะเองว่าพังตรงไหน
 */
export const pointRoundSpendAmount = (shop: unknown): number | null => {
  if (shop === null || typeof shop !== 'object') return null;
  /* ⚠️ ของจริงมาห่อหลายชั้นไม่แน่นอน — `{shop:…}` บ้าง `{data:{shop:…}}` บ้าง
     และเคยเจอห่อสองชั้น (`data.data.shop`) เวลาปลายทางส่ง body มาทั้งก้อน
     ⇒ คลี่ให้เองตรงนี้ แทนที่จะบังคับให้ฝั่งเรียกรู้รูปห่อ · ฝั่งเรียกส่ง
     "อะไรก็ได้ที่ได้มา" แล้วได้ตัวเลขหรือ null กลับไป ไม่มีทางพัง
     (ตัวคลี่ของการ์ด site rules อยู่คนละที่และไม่ถูกแตะ — ตั้งใจไม่ไปยุ่ง
      กับการ์ดที่ทำงานอยู่แล้ว) */
  const dig = (v: any, depth = 0): any => {
    if (v === null || typeof v !== 'object' || depth > 3) return null;
    if (Array.isArray(v?.products?.products)) return v;
    return dig(v.shop, depth + 1) ?? dig(v.data, depth + 1);
  };
  const found = dig(shop);
  const products = found?.products?.products;
  if (!Array.isArray(products)) return null;
  const round = products.find(
    (g) => g !== null && typeof g === 'object' && g.id === POINT_ROUND_PRODUCT_ID,
  );
  const raw = round?.default_config?.spend_amount;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw;
};

export interface PointRounds {
  /** ตัวเลขที่จะโชว์ */
  readonly value: number;
  /** true = หารไม่ได้ ⇒ ตัวเลขนี้คือ "เหรียญจริง" ไม่ใช่จำนวนครั้ง ⇒ ต้องมี (N/A) */
  readonly na: boolean;
}

/**
 * เหรียญ + ราคาต่อครั้ง → จำนวนครั้งที่ใช้สิทธิ์ได้
 *
 * ⚠️ ปัดลง — เล่นครึ่งครั้งไม่มีจริง · เหรียญ 25 กับ spend 10 = ใช้สิทธิ์ได้ 2 ครั้ง
 * ⚠️ เหรียญติดลบ/อ่านไม่ได้ ถือเป็น 0 ไม่ใช่ปล่อยให้ติดลบไหลออกจอ
 */
export const pointRounds = (
  coins: unknown,
  spendAmount: number | null,
): PointRounds => {
  const n = Number(coins);
  const safeCoins = Number.isFinite(n) && n > 0 ? n : 0;
  if (spendAmount === null || spendAmount <= 0) {
    return { value: safeCoins, na: true };
  }
  return { value: Math.floor(safeCoins / spendAmount), na: false };
};

/** ข้อความที่โชว์จริงบนการ์ด — ที่เดียวที่ตัดสินว่าจะมี "(N/A)" ไหม */
export const pointRoundsText = (s: PointRounds): string =>
  s.na ? `${s.value} (N/A)` : String(s.value);
