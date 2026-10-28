// ==== [FEAT-20260801-ONEROW] "แถบบนใช้โหมดไหน" — แหล่งความจริงเดียว
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// ── การจัดวางแถบบนตัดสินด้วย "ค่าเดียว" เท่านั้น ─────────────────────────────
// `ui.forceTicketOnly` (preference) = จริง → แถบบนเป็นแถวเดียว
//
// เดิมออกแบบเป็น "สิทธิ์ ∪ ความชอบ" แล้วผู้ใช้สั่งให้ยกเลิก เพราะสับสน:
// มีสองอย่างที่ทำให้หน้าตาเปลี่ยนได้ ไล่เหตุยากว่าตอนนี้เป็นแถวเดียวเพราะอะไร
// → ตอนนี้เหลือตัวเดียว · ส่วนคนที่มีแค่สิทธิ์ ticket จะถูก **บังคับค่านี้ให้เป็น
//   true ตอน login** (ดู handleLogin ใน App.tsx) แล้วซ่อนปุ่มสลับไม่ให้เปลี่ยน
//   ผลลัพธ์เหมือนเดิมทุกประการ แต่ "เหตุผล" มีทางเดียวคืออ่านจาก preference
//
// ⚠️ `isTicketOnly()` ยังใช้อยู่ แต่เหลือแค่ 2 หน้าที่ และ **ไม่ใช่โหมด**:
//     1. ตอน login → บังคับ preference ให้เป็น true
//     2. ซ่อนหัวข้อตั้งค่า "เมนูหลัก" (เลือกไปก็ไม่มีเมนูให้ดู)
//    ห้ามเอาไปตัดสินการจัดวางโดยตรงอีก
//
// ── ทำไมต้องมีไฟล์นี้ ────────────────────────────────────────────────────────
// `App.tsx` กับ `pages/TicketChat.tsx` ต่างคนต่างคำนวณโหมดของตัวเอง
// ถ้าคิดไม่ตรงกันจะพังทันที: App เรนเดอร์แถบแบบกะทัดรัด (มีช่องรอแท็บ OA)
// แต่ TicketChat ไม่ portal แท็บมาให้ → แถบว่างเปล่า
// → ทั้งคู่ต้องอ่านจากที่นี่ที่เดียว
//
// revert: ลบไฟล์นี้ + marker FEAT-20260801-ONEROW ใน App.tsx / TicketChat.tsx
//         แล้วให้ทั้งสองที่กลับไปเรียก isTicketOnly() ตรงๆ เหมือนเดิม

import { getInitialPreferences } from '../services/admin';

/** path ของ preference — ใช้ที่เดียวกันทุกที่ ไม่พิมพ์สตริงซ้ำ */
export const ONE_ROW_PREF_PATH = 'ui.forceTicketOnly';

/** ค่าเริ่มต้นตามที่ผู้ใช้กำหนด: คนที่ยังไม่เคยตั้ง = แถวเดียว */
export const ONE_ROW_DEFAULT = true;

/** ผู้ใช้เคยตั้งค่านี้ไว้หรือยัง (ใช้ตัดสินว่าต้องเขียนค่า default ลง DB ตอน login ไหม) */
export const hasOneRowPreference = (): boolean => {
  const prefs = getInitialPreferences();
  return typeof (prefs as any)?.ui?.forceTicketOnly === 'boolean';
};

/**
 * role ที่ให้เริ่มต้นเป็น **mega menu** แทน (ผู้ใช้สั่งเป็นข้อยกเว้นเฉพาะกลุ่มนี้)
 * เหตุผล: คนกลุ่มนี้ทำงานหลายหน้า ไม่ได้อยู่แต่หน้า ticket การเริ่มด้วยแถบเมนูเต็ม
 * ใช้งานง่ายกว่า · หลังจากนั้นเปลี่ยนเองได้ตามปกติ (บังคับแค่ครั้งแรกครั้งเดียว)
 * ⚠️ ตรวจจาก DB จริงแล้วมี role 4 ตัว: superadmin · admin · operator · assist_admin
 *    → กลุ่มที่ได้ข้อยกเว้นนี้คือ superadmin กับ admin เท่านั้น
 * ⚠️ เทียบแบบตัวพิมพ์เล็กเสมอ — ชื่อ role ใน DB ไม่ได้บังคับรูปแบบ
 */
export const MEGA_MENU_FIRST_ROLES = ['superadmin', 'admin'];

/** ค่าเริ่มต้นของ role นี้ตอน login ครั้งแรก (ยังไม่เคยมี preference) */
export const defaultOneRowForRole = (roleName?: string | null): boolean =>
  MEGA_MENU_FIRST_ROLES.includes(String(roleName || '').toLowerCase().trim())
    ? false            // เริ่มด้วย mega menu
    : ONE_ROW_DEFAULT; // นอกนั้นเริ่มด้วยแถวเดียว

/** ค่าที่ตั้งไว้ · ไม่เคยตั้ง → ค่าเริ่มต้น */
export const readOneRowPreference = (): boolean => {
  const prefs = getInitialPreferences();
  const v = (prefs as any)?.ui?.forceTicketOnly;
  return typeof v === 'boolean' ? v : ONE_ROW_DEFAULT;
};

/**
 * แถบบนควรเป็นแบบ "แถวเดียว" หรือไม่ — **ใช้กับการจัดวางเท่านั้น**
 *
 * ตัดสินจาก preference ตัวเดียว ไม่มีเงื่อนไขอื่นมาผสม
 * (คนที่มีแค่สิทธิ์ ticket ถูกบังคับค่านี้ให้เป็น true ตั้งแต่ login แล้ว)
 *
 * @param forceOneRow ค่าจาก preference (ส่งเข้ามาได้ถ้าผู้เรียกถืออยู่แล้ว
 *                    เพื่อให้ re-render ทันทีตอนกดสลับ) — ไม่ส่ง = อ่านจากแคช
 */
export const isCompactTopBar = (forceOneRow?: boolean): boolean =>
  typeof forceOneRow === 'boolean' ? forceOneRow : readOneRowPreference();
