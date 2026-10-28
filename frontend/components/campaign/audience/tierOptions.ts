/**
 * [FEAT-2708-TIERUNLOCK] (งาน 5.5) tier list กลาง — pure function ที่เดียวทั้ง repo
 * ===========================================================================
 * เจ้าของ 27/08: *"แสดง tier list for boardcast (แหล่งที่มาทำเป็น function pure
 * กลางๆไว้ก่อนเพื่อเพิ่มเติม)"* พร้อมรูปข้อมูลสามแถวข้างล่างคำต่อคำ
 *
 * · grep ทั้งสอง repo แล้ว **ไม่มี list silver/gold ที่ไหนมาก่อน** — ไฟล์นี้คือ
 *   แหล่งเดียวตั้งแต่เกิด · เพิ่ม tier ใหม่ = เติมแถวเดียวที่นี่
 * · DB จริงวันนี้มีแต่ `normal` (blob 3 แถว) — silver/gold คือค่าที่ระบบปลายทาง
 *   จะส่งมา ใส่ไว้ล่วงหน้าตามเจ้าของสั่ง
 * · WHERE ฝั่ง BE ใช้ **code** (registry → `raw_profile_data.data.profile.tier.code`)
 *   · `level` มีครบทุกแถวไว้เผื่อสลับไป match ด้วยตัวเลข — วิธีสลับจดไว้ที่
 *   registry ฝั่ง BE (`[FEAT-2708-TIERWHERE]`)
 * · role directory เดียวกับ `tagOptions.ts` — precedent ตรงตัว
 * revert: ลบไฟล์นี้ + TierValuePicker + entry ใน valueSource.registry
 */
import type { MultiCheckOption } from '../pickers/MultiCheckSelect';

export interface BroadcastTier {
  code: string;
  name: string;
  level: number;
}

export const BROADCAST_TIERS: readonly BroadcastTier[] = [
  { code: 'normal', name: 'Normal', level: 0 },
  { code: 'silver', name: 'Silver', level: 1 },
  { code: 'gold', name: 'Gold', level: 2 },
];

/** ตัวเลือกสำหรับ MultiCheckSelect — value = `code` (สิ่งที่ WHERE ใช้จริง) */
export const tierOptions = (): MultiCheckOption[] =>
  BROADCAST_TIERS.map((t) => ({
    value: t.code,
    label: `${t.name} (L${t.level})`,
    hint: t.code,
  }));

/** ค่า rule (string | string[]) → รายการ code ที่ติ๊กอยู่ */
export const tierCodesOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v !== '')
    : typeof value === 'string' && value !== ''
      ? [value]
      : [];
