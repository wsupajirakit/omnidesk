/**
 * [REFACTOR-20261027-TCSPLIT] TicketChat's tier helpers and the tier-filter options — moved out
 * of the page verbatim. Pure: no state, no ref, no closure. The page keeps its `useMemo` for the
 * options, with the same deps, and calls `buildTierFilterOptions` from it.
 * revert: paste the two helpers back where the page imports them, and the body back into the
 * page's `tierFilterOptions` useMemo.
 */
import type { TicketEntry } from '../../../../services/chat';
import { tierOfMember } from '../../../../utils/memberTier';

// ==== [FEAT-20260801-MEMBERTIER] ตัวกรอง Tier ที่ "กรองได้จริง"
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// เดิมเป็น stub: ตัวเลือกเป็นข้อความตายตัว (VIP Tier 1 / Tier 2 / …) และไม่มี
// เงื่อนไขไหนอ่านค่าเลย เลือกแล้วรายการไม่ขยับสักแถว
// ตอนนี้ BE เก็บ tier ลง column ของ Member แล้ว (FEAT-20260801-MEMBERTIER)
// และ ticket ส่ง Member ทั้งดวงขึ้นมาอยู่แล้ว → `ud.tier` ใช้ได้เลย
//
// ⚠️ **ตัวเลือกสร้างจากข้อมูลจริงที่มีอยู่ ไม่ hardcode ชื่อ tier ของเจ้าไหน**
//    เจ้าหนึ่งใช้ normal/silver/gold อีกเจ้าใช้ VIP 1-5 — ถ้าตรึงรายการไว้
//    จะได้ตัวเลือกที่กรองแล้วว่างเปล่า และต้องตามแก้โค้ดทุกครั้งที่เพิ่ม tier = หนี้
// ⚠️ ยังไม่มีลูกค้าคนไหนมี tier → เหลือแค่ "ทั้งหมด" (ไม่หลอกว่ามีให้เลือก)
// revert: ลบบล็อกนี้ + เงื่อนไข filterTier 2 จุด แล้วเอา options ตายตัวกลับ
export const tierKeyOf = (tier: any): string => {
  if (tier === null || tier === undefined || tier === '') return '';
  if (typeof tier === 'object') {
    // ⚠️ ห้ามใช้ ?? เฉยๆ: BE ปรับรูปแล้วใส่ code/name เป็น **สตริงว่าง** เมื่อ
    //    ปลายทางไม่ได้ส่งมา (เช่นเจ้าที่ส่ง tier มาเป็นตัวเลขล้วน) — `?? ` มองว่า
    //    '' มีค่า จึงคืนคีย์ว่างแล้วกรองไม่เจอใครเลย
    // ⚠️ และห้ามใช้ || กับ level เพราะ level = 0 (Normal) เป็น falsy จะถูกกลืน
    const first = [tier.code, tier.name].find((v) => v !== null && v !== undefined && String(v) !== '');
    const k = first !== undefined ? first : tier.level;
    return k === null || k === undefined || String(k) === '' ? '' : String(k).toLowerCase();
  }
  return String(tier).toLowerCase();
};
export const tierLabelOf = (tier: any): string => {
  if (tier && typeof tier === 'object') {
    const name = tier.name || tier.code || '';
    const lv = tier.level;
    return lv === null || lv === undefined ? String(name) : `${name} (Tier ${lv})`;
  }
  return String(tier ?? '');
};
// ==== [FEAT-20260801-MEMBERTIER] END (helper) — ตัวเลือกอยู่ที่ tierFilterOptions ด้านล่าง

// [FEAT-20260801-MEMBERTIER] ตัวเลือกในกล่องกรอง Tier — สร้างจาก tier ที่มีจริง
// ในรายการที่โหลดมาแล้ว (เปิด + ปิด) ไม่ hardcode ชื่อ tier ของเจ้าไหน
// เรียงตาม level ก่อน (น้อย→มาก) แล้วค่อยตามชื่อ เพื่อให้ลำดับคงที่ทุกครั้ง
// ไม่มีใครมี tier → รายการว่าง เหลือแค่ "ทั้งหมด" (ไม่หลอกว่ามีให้เลือก)
export function buildTierFilterOptions(activeTickets: TicketEntry[], completedTickets: TicketEntry[]) {
  const seen = new Map<string, { value: string; label: string; level: number }>();
  for (const tk of [...activeTickets, ...completedTickets]) {
    // [FIX-20260810-TIERSOURCE] อ่านผ่าน helper เดียวกับป้าย ไม่งั้นคนที่มีแค่
    // raw_profile_data จะไม่โผล่ในตัวเลือก ทั้งที่ป้ายขึ้น
    const tier = tierOfMember((tk as any)?.line_user_data);
    const key = tierKeyOf(tier);
    if (!key || seen.has(key)) continue;
    const lv = tier && typeof tier === 'object' && Number.isFinite(Number(tier.level))
      ? Number(tier.level) : Number.MAX_SAFE_INTEGER;
    seen.set(key, { value: key, label: `💎 ${tierLabelOf(tier)}`, level: lv });
  }
  return [...seen.values()]
    .sort((a, b) => (a.level - b.level) || a.label.localeCompare(b.label))
    .map(({ value, label }) => ({ value, label }));
}
