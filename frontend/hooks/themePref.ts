// ==== [FIX-20260801-THEMEBOOT] แหล่งความจริงเดียวของ "ธีมที่ควรใช้ตอนนี้"
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// ── บั๊กที่แก้ ────────────────────────────────────────────────────────────────
// ผู้ใช้แจ้ง: "ธีม light แต่รูปพระจันทร์ บางครั้ง (แบบครั้งแรก login)"
// สาเหตุคือมี **สองที่เขียน class `theme-dark` แข่งกัน** โดยไม่มีลำดับที่แน่นอน
// และตัวสวิตช์บนจอก็อ่านคนละค่ากับ class ที่ใช้จริง:
//
//   ตำแหน่งสวิตช์/พระจันทร์  ← state `theme` (preference จริง โหลดจาก DB แบบ async)
//   class `.theme-dark`      ← localStorage 'ui_theme' ก่อน แล้วค่อย fallback มาที่ theme
//   ตอน <Login> unmount      ← เขียนทับอีกรอบ โดยอ่านแค่ localStorage
//
// login ครั้งแรกบนเครื่องใหม่: ยังไม่มีคีย์ 'ui_theme' → cleanup ของ Login ถอด
// theme-dark ออก จอกลายเป็น light · พอ preference จริงโหลดเสร็จทีหลังเป็น 'dark'
// สวิตช์เลื่อนไปพระจันทร์ แต่ class ถูกถอดไปแล้ว = จอขาวแต่ไอคอนบอกว่ามืด
//
// ── วิธีแก้ ───────────────────────────────────────────────────────────────────
// ยกตรรกะการหาธีมมาไว้ที่เดียว ทุกฝ่ายเรียกตัวนี้ตัวเดียวกัน จึงเป็นไปไม่ได้ที่
// "ที่แสดง" กับ "ที่ใช้จริง" จะไม่ตรงกัน · ลำดับความน่าเชื่อถือคงเดิมทุกประการ:
//   1. คีย์เฉพาะ 'ui_theme' — เขียนแบบ synchronous ทุกครั้งที่กดสลับ (เร็วและตรงที่สุด)
//   2. แคช preference ในเครื่อง 'zd_user_prefs' — เผื่อคีย์ข้อ 1 ยังไม่ถูกเขียน
//   3. ค่า preference จริงที่ผู้เรียกส่งเข้ามา (มาจาก DB ผ่าน usePreference)
//
// ⚠️ ไฟล์นี้ตั้งใจไม่ import อะไรเลย — Login กับ App เรียกได้ทั้งคู่โดยไม่วนกันเอง
// revert: ลบไฟล์นี้ + marker FIX-20260801-THEMEBOOT ใน App.tsx / pages/Login.tsx

export type ThemeName = 'light' | 'dark';

const isTheme = (v: unknown): v is ThemeName => v === 'light' || v === 'dark';

/**
 * หาธีมที่ควรใช้ ณ ตอนนี้
 * @param fromPreference ค่า preference จริง (จาก usePreference('ui.theme')) — ใช้เมื่อในเครื่องยังไม่มีอะไรเลย
 */
export const resolveTheme = (fromPreference?: ThemeName): ThemeName => {
  try {
    const fast = localStorage.getItem('ui_theme');
    if (isTheme(fast)) return fast;
  } catch { /* โหมดส่วนตัว / ปิด storage — ข้ามไปใช้ทางอื่น */ }
  try {
    const prefs = JSON.parse(localStorage.getItem('zd_user_prefs') || 'null');
    if (isTheme(prefs?.ui?.theme)) return prefs.ui.theme;
  } catch { /* JSON เสีย — ข้ามไปใช้ค่า preference */ }
  return isTheme(fromPreference) ? fromPreference : 'light';
};

/** ทาธีมลง <html> — จุดเดียวที่แตะ class นี้ (นอกจากหน้า Login ที่บังคับมืดชั่วคราว) */
export const applyTheme = (t: ThemeName) => {
  document.documentElement.classList.toggle('theme-dark', t === 'dark');
};
