/**
 * ==== [FEAT-20260830-CHATFONT] ขนาดตัวอักษรของช่องแชทกลาง ====
 *
 * เจ้าของสั่ง 30/08/2026: ปุ่ม icon บนหัวแชท (ข้างแว่นขยาย) เปิด modal ที่มี
 * seekbar 6 ขั้น ลากแล้วเซฟทันที + toast · ปรับ **เฉพาะช่องกลาง** เท่านั้น
 * (ห้ามยุ่ง panel ซ้าย/ขวา, header, menu) · tray ทั้ง 3 (emoji · ตอบด่วน ·
 * สติกเกอร์) ต้องโตตามด้วย · ไม่มีค่า = ได้ขนาดปกติอัตโนมัติทุกกรณี
 *
 * ── ⚠️ ทำไมต้องเป็นค่าใหม่ ห้ามใช้ `ui.fontScale` เดิม ────────────────────────
 * `ui.fontScale` (App.tsx) เป็นคนละเรื่องกันสิ้นเชิง:
 *   · ช่วง 0.9–1.2 ไม่ใช่ 1.0–2.0
 *   · ทา `document.documentElement.style.fontSize` ⇒ กระทบ **ทั้งแอป**
 *   · มี localStorage mirror `ui_font_scale` ของตัวเอง
 * เจ้าของย้ำว่า "ค่าเดิมฟันเฟืองไม่ยุ่ง" ⇒ ค่านี้จึงอยู่คนละ path และ **ห้าม**
 * ไปแตะ `documentElement` เด็ดขาด — ถ้าแตะ สองค่าจะคูณกันแล้วเพี้ยนทั้งคู่
 *
 * ── ทำไมเก็บเป็น "ตัวคูณ" ไม่ใช่ px ──────────────────────────────────────────
 * ช่องแชทมีขนาดตัวอักษรปนกันหลายค่า (`text-[14px]` ฟองข้อความ, `text-[10px]`
 * ป้ายเวลา, `text-xs` ฯลฯ) และมีรูปสติกเกอร์/ไอคอน/ระยะห่างที่ต้องโตตามด้วย
 * การเก็บ px ตัวเดียวจึงคุมไม่ได้ทั้งหมด — ตัวคูณเดียวคูณทุกมิติได้ครบ
 * ผ่าน CSS variable `--tc-chat-scale`
 *
 * revert: ลบไฟล์นี้ + จุดเรียกใน TicketChat/ChatRoomView + บล็อก CSS ใน index.css
 */

/**
 * path ใน preferences — **ห้ามซ้ำกับ `ui.fontScale` / `ui.chatFont` ที่มีอยู่**
 * (`ui.chatFont` คือโหมด "ฟอนต์" คนละเรื่องกับ "ขนาด")
 */
export const CHAT_FONT_SCALE_PATH = 'ui.chatMessageScale';

/**
 * 6 ขั้นตามที่เจ้าของเลือก — **ขั้นแรกคือขนาดปัจจุบันเป๊ะ** (คูณ 1 = ไม่เปลี่ยน)
 * เรียงจากน้อยไปมาก และห้ามมีค่าซ้ำ (มีเทสตรึงไว้)
 */
export const CHAT_FONT_SCALE_STEPS = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0] as const;

/** ค่าที่ทุกคนได้เมื่อยังไม่เคยตั้ง — ต้องเป็นสมาชิกของ STEPS เสมอ */
export const CHAT_FONT_SCALE_DEFAULT = CHAT_FONT_SCALE_STEPS[0];

/** ชื่อ CSS variable ที่ทาลงบนช่องกลาง */
export const CHAT_FONT_SCALE_VAR = '--tc-chat-scale';

/**
 * บีบค่าที่อ่านมาให้เป็นขั้นที่ใช้ได้จริงเสมอ
 *
 * ⚠️ `usePreference` **ไม่ตรวจและไม่ clamp ค่าที่เก็บไว้เลย** — เก็บ `999` หรือ
 * `"banana"` ไว้ก็คืนมาตรง ๆ (hooks/usePreferences.ts) ⇒ การกรองเป็นหน้าที่ของ
 * ผู้ใช้ค่า เหมือนที่ `App.tsx` clamp `ui.fontScale` ที่จุดใช้งาน
 *
 * ทุกทางที่ผิดปกติ (ไม่เคยตั้ง · null · สตริง · NaN · นอกช่วง · ค่าที่ไม่ตรงขั้น)
 * ⇒ คืน **ค่าเริ่มต้น** ไม่ใช่คืนค่าที่พังต่อไป: แอดมินที่ไม่เคยตั้งอะไรจะเห็น
 * ขนาดปกติทันทีโดยไม่ต้องคลิกอะไรก่อน ตามที่เจ้าของสั่ง
 */
export function normalizeChatFontScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CHAT_FONT_SCALE_DEFAULT;
  }
  /* จับขั้นที่ใกล้ที่สุดแทนการปฏิเสธ — ค่าที่เพี้ยนเพราะ float (1.4000000000000001)
     ยังใช้ได้ ส่วนค่าที่หลุดช่วงจริง ๆ จะถูกดึงกลับมาที่ขั้นสุดขอบ */
  const min = CHAT_FONT_SCALE_STEPS[0];
  const max = CHAT_FONT_SCALE_STEPS[CHAT_FONT_SCALE_STEPS.length - 1]!;
  if (value <= min) return min;
  if (value >= max) return max;
  let best: number = min;
  let bestGap = Infinity;
  for (const step of CHAT_FONT_SCALE_STEPS) {
    const gap = Math.abs(step - value);
    if (gap < bestGap) {
      bestGap = gap;
      best = step;
    }
  }
  return best;
}

/** ลำดับขั้น (0-5) ของค่าหนึ่ง — ใช้ผูกกับ seekbar ที่เดินทีละ 1 */
export function chatFontScaleIndex(value: unknown): number {
  const scale = normalizeChatFontScale(value);
  const i = CHAT_FONT_SCALE_STEPS.indexOf(scale as never);
  return i < 0 ? 0 : i;
}

/** ค่าที่ขั้นนั้น — index นอกช่วงคืนค่าเริ่มต้น ไม่ throw */
export function chatFontScaleAt(index: number): number {
  if (!Number.isInteger(index)) return CHAT_FONT_SCALE_DEFAULT;
  return CHAT_FONT_SCALE_STEPS[index] ?? CHAT_FONT_SCALE_DEFAULT;
}

/**
 * ป้ายบอกขนาดสำหรับ UI — คืน **คีย์ i18n** ไม่ใช่ข้อความ เพื่อให้ผู้เรียกแปลเอง
 * (ไฟล์นี้จึงไม่ต้องรู้จัก hook ของ i18n และเทสได้โดยไม่ต้อง mount React)
 */
export function chatFontScaleLabelKey(value: unknown): string {
  return `ticket.chat_font_step_${chatFontScaleIndex(value) + 1}`;
}

/* ==== [FEAT-20260830-TRAYFIXEDSCALE] locked scales for the emoji / sticker trays ====
 *
 * Owner, 30/08/2026: the sticker tray must ALWAYS render at the largest step and
 * the emoji tray ALWAYS at step 3, no matter what the admin picked in the font
 * modal. Everything else in the centre column keeps following the preference.
 *
 * Why these are derived from CHAT_FONT_SCALE_STEPS instead of literals:
 * the ladder is one array and the tests pin it. Writing `2.0` / `1.4` here would
 * silently desync the day someone re-tunes a step — these two constants move with
 * the ladder by construction, and there is no second copy to forget.
 *
 * Why a scale value rather than fixed px: the whole feature is ONE multiplier
 * consumed by the `.tc-col-center` rules in index.css (`.w-12`, `.text-xl`, svg…).
 * Re-declaring `--tc-chat-scale` on the tray element re-uses every one of those
 * rules unchanged; hardcoding px in the markup would fork the ladder in two places
 * and only cover the sizes we remembered to list.
 *
 * The lock is total by construction: these do not read the preference at all, so
 * "never set", null, "banana" and out-of-range all land on the same value.
 *
 * revert: drop these two constants + the inline style on the two tray panels.
 */

/** Step 6 (top of the ladder) — the sticker tray is pinned here. */
export const STICKER_TRAY_FIXED_SCALE =
  CHAT_FONT_SCALE_STEPS[CHAT_FONT_SCALE_STEPS.length - 1]!;

/** Step 3 (1-based, as the owner counts the seekbar) — the emoji tray is pinned here. */
export const EMOJI_TRAY_FIXED_SCALE = CHAT_FONT_SCALE_STEPS[2]!;
