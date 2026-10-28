// ==== [FEAT-20260801-CHATFONT] "เว็บใช้ฟอนต์ไหน" — แหล่งความจริงเดียว
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// ── ทำไมต้องมีไฟล์นี้ ────────────────────────────────────────────────────────
// เขียนตามแบบ hooks/topBarMode.ts เป๊ะ (path + default + ตัวอ่านค่า อยู่ที่เดียว)
// ถ้าปล่อยให้ App.tsx พิมพ์สตริง 'ui.chatFont' เองแล้วที่อื่นพิมพ์ซ้ำ พอพิมพ์ผิด
// ตัวหนึ่งจะกลายเป็น preference คนละตัวเงียบๆ — หาเหตุยากมาก
//
// ── ค่าที่เป็นไปได้ ──────────────────────────────────────────────────────────
//   'default' = ฟอนต์เดิมทั้งเว็บ (Inter/Kanit) เหมือนก่อนที่จะมี Sarabun
//   'chat'    = Sarabun เฉพาะกล่องข้อความแชทหน้า ticket-support · นอกนั้นเหมือนเดิม
//   'all'     = Sarabun ทั้งเว็บ
//
// ตัวเลือกถูกเขียนลง `data-font` บน <html> แล้ว CSS ใน index.html เป็นคนตัดสินหน้าตา
// (marker เดียวกัน) — ที่นี่ไม่รู้จักคลาส/สไตล์อะไรเลย รู้แค่ค่ากับการเขียน attribute
//
// ⚠️ 'default' **ลบ attribute ทิ้ง** ไม่ใช่เขียน data-font="default"
//    เพื่อให้ "ไม่เคยตั้งค่า" กับ "ตั้งเป็นค่าเริ่มต้น" ได้ DOM หน้าตาเดียวกัน
//    ไม่ต้องมีกฎ CSS เผื่อสองแบบ
//
// revert: ลบไฟล์นี้ + บล็อก CHATFONT ใน index.html + จุดเรียกใน App.tsx

import { getInitialPreferences } from '../services/admin';

/** path ของ preference — ใช้ที่เดียวกันทุกที่ ไม่พิมพ์สตริงซ้ำ */
export const FONT_PREF_PATH = 'ui.chatFont';

export type FontMode = 'default' | 'chat' | 'all';

/**
 * ค่า "กลาง" ที่แปลว่า **ลบ attribute ทิ้ง** (ฟอนต์เดิมทั้งเว็บ)
 * ⚠️ ห้ามเปลี่ยนค่านี้เป็นอย่างอื่น — applyFontMode() ใช้ค่านี้เป็นตัวเทียบว่า
 *    "โหมดไหน = ไม่ต้องเขียน data-font" ถ้าเปลี่ยนเป็น 'chat' จะทำให้ 'chat'
 *    กลายเป็นลบ attribute แทนที่จะเขียน → Sarabun ไม่ทำงาน
 * คนละความหมายกับ "ค่าเริ่มต้นของ user ใหม่" ด้านล่าง
 */
export const FONT_DEFAULT: FontMode = 'default';

// ==== [FIX-20260801-FONTNEWUSER] ค่าเริ่มต้นของ "คนที่ยังไม่เคยตั้ง preference"
// ผู้ใช้สั่ง: default = th sarabun เฉพาะแชท สำหรับทุก login ที่ยังไม่มี preference
// (คนที่เคยเลือกไว้แล้ว — รวมถึงคนที่เลือก 'default' เอง — ต้องไม่ถูกทับ)
// แยกจาก FONT_DEFAULT ('default' = sentinel ลบ attribute) เพราะเป็นคนละบทบาท
// revert: เปลี่ยนค่านี้กลับเป็น 'default' (หรือใช้ FONT_DEFAULT แทนทุกจุดที่อ้างถึง)
export const FONT_NEW_USER_DEFAULT: FontMode = 'chat';

/** ค่าที่ยอมรับ — กันค่าเพี้ยนจาก DB ทำให้เขียน attribute มั่วๆ ลง <html> */
export const FONT_MODES: FontMode[] = ['default', 'chat', 'all'];

export const isFontMode = (v: unknown): v is FontMode =>
  typeof v === 'string' && (FONT_MODES as string[]).includes(v);

/** ผู้ใช้เคยตั้งค่านี้ไว้หรือยัง (ใช้ตัดสินว่าต้องเขียน default ลง DB ตอน login ไหม) */
export const hasFontPreference = (): boolean => {
  const prefs = getInitialPreferences();
  return isFontMode((prefs as any)?.ui?.chatFont);
};

/** ค่าที่ตั้งไว้ · ไม่เคยตั้ง/ค่าเพี้ยน → ค่าเริ่มต้นของ user ใหม่ (Sarabun เฉพาะแชท) */
export const readFontPreference = (): FontMode => {
  const prefs = getInitialPreferences();
  const v = (prefs as any)?.ui?.chatFont;
  // [FIX-20260801-FONTNEWUSER] no-pref → 'chat' ไม่ใช่ 'default'
  return isFontMode(v) ? v : FONT_NEW_USER_DEFAULT;
};

/**
 * เขียนโหมดลง <html data-font="..."> ให้ CSS หยิบไปใช้
 *
 * ⚠️ เรียกได้ทั้งตอนบูตและตอนผู้ใช้กดเปลี่ยน — idempotent
 * ⚠️ กัน SSR/สภาพแวดล้อมที่ไม่มี document ไว้ด้วย (เทสรันใน node)
 */
export const applyFontMode = (mode?: FontMode | null): void => {
  if (typeof document === 'undefined') return;
  const m = isFontMode(mode) ? mode : FONT_DEFAULT;
  const root = document.documentElement;
  if (m === FONT_DEFAULT) root.removeAttribute('data-font');
  else root.setAttribute('data-font', m);
};
