/**
 * [HOTFIX-20260826-THINK36] "ปิดความคิด" ต้องสั่งด้วยคำที่ Gemini 3 ยังฟัง
 * ============================================================================
 * 🔴 อาการที่ซ่อมอยู่ (วัดจากของจริง 26/08 ไม่ใช่จากเอกสาร):
 *
 *      gemini-3.6-flash + {"thinkingBudget": 0}  →  HTTP 400 INVALID_ARGUMENT
 *
 *    และ error ที่ Google ส่งกลับมามีแค่ `"Request contains an invalid argument."`
 *    **ไม่มีคำว่า "think" อยู่เลย** ⇒ ตาข่ายกู้ชีพใน `gemini-reply.transport.ts`
 *    (`st === 400 && em.includes('think')` → ถอด thinkingConfig แล้วยิงซ้ำ)
 *    **ไม่ทำงาน** ⇒ คำขอตาย ลูกค้าไม่ได้รับคำตอบเลย เงียบ ๆ
 *
 *    ตอนนี้ยังไม่ระเบิดเพราะทุก hook ใช้ `gemini-3.5-flash` ซึ่งยังรับ budget 0 อยู่
 *    แต่ **24 จาก 29 hook ตั้งค่าเป็น "ปิด" (0)** ⇒ วันไหนสลับไป 3.6 คำตอบตายทันที
 *    ทั้ง 24 ตัวพร้อมกัน โดยไม่มี log error ให้ตามด้วยซ้ำ
 *
 * ── ตารางที่วัดมาจริง (ยิง generateContent ด้วยคีย์จริง 26/08) ─────────────
 *                          3.5-flash                3.6-flash
 *   thinkingBudget 0       ✅ 200 · ไม่คิด          🔴 400 INVALID_ARGUMENT
 *   thinkingBudget -1      ✅ (doc + 3.6 ยืนยัน)    ✅ 200 · thoughts 438
 *   thinkingBudget 512     ✅ 200 · thoughts 225    ✅ 200 · thoughts 227
 *   thinkingLevel minimal  ✅ 200 · ไม่คิด (×2)     ✅ 200 · ไม่คิด (×2)
 *   ไม่ส่ง config เลย       ✅ 200 · thoughts 404    ✅ 200 · thoughts 469
 *
 *   ⇒ มีช่องเดียวที่พัง: **budget 0 บน 3.6**
 *   ⇒ `thinkingLevel:"minimal"` เป็นคำสั่งเดียวที่ทั้งสองรุ่นฟังตรงกัน และให้ผล
 *     เท่ากับ budget 0 บน 3.5 เป๊ะ (ไม่มี `thoughtsTokenCount` = ไม่คิดเลย)
 *     ยิงยืนยันซ้ำรุ่นละ 2 รอบ ผ่านทั้ง 4 ⇒ ไม่ใช่ฟลุ๊ก
 *
 * ── ขอบเขตการเปลี่ยน (จงใจให้แคบที่สุด นี่คือ hotfix) ─────────────────────
 *   เปลี่ยน**เฉพาะ**เส้นทาง "ปิด" (0/ไม่ตั้ง) เท่านั้น
 *   · `-1` และ `n > 0` ส่ง `thinkingBudget` เหมือนเดิมทุกตัวอักษร — พิสูจน์แล้วว่า
 *     ทั้ง 3.5 และ 3.6 รับได้ ⇒ ไม่มีเหตุให้แตะ และไม่ต้องรอเส้นแบ่งจากเจ้านาย
 *   · หน้าจอตั้งค่าไม่เปลี่ยน · ค่าใน DB ไม่เปลี่ยน · ไม่ backfill
 *   · ผลกับ 3.5 = เท่าเดิมเป๊ะ (ไม่คิด → ไม่คิด) ⇒ ของที่วิ่งอยู่วันนี้ไม่รู้สึกอะไร
 *
 * ⚠️ ห้ามส่ง `thinkingLevel` กับ `thinkingBudget` พร้อมกัน — ยิงจริงแล้วได้ 400
 *    ฟังก์ชันนี้จึงคืน **ก้อนเดียว มีคีย์เดียวเสมอ** ไม่มีทางออกสองคีย์
 *
 * ⚠️ `minimal` ไม่ได้แปลว่าปิดสนิท 100% — doc ของ Google เขียนเองว่า *"minimal does
 *    not guarantee that thinking is off, the model may reason very minimally for
 *    complex tasks"* · ที่วัดได้ 4/4 รอบคือ 0 แต่คำถามที่ซับซ้อนกว่านี้อาจไม่ใช่ 0
 *
 * ── จะแก้เงื่อนไขทีหลังทำยังไง (ออกแบบมาให้แก้ที่เดียว) ───────────────────
 *   · อยากเปลี่ยนคำที่ใช้แทน "ปิด"         → `OFF_LEVEL`
 *   · เจอรุ่นที่ `minimal` ใช้ไม่ได้เพิ่ม    → เติม prefix ใน `NO_MINIMAL_PREFIX`
 *     (doc ระบุว่า 3.7-flash และ 3.1-pro ตอบ error ถ้าสั่ง minimal — ใส่ดักไว้แล้ว)
 *   · อยากให้ `n > 0` กลายเป็น level ด้วย  → แก้ที่ `resolveThinkingConfig` จุดเดียว
 *     (ยังไม่ทำ เพราะรอเจ้าของเคาะเส้นแบ่ง และของเดิมไม่ได้พัง)
 *   · ตระกูล 2.5 ยังต้องใช้ `thinkingBudget` เท่านั้น — doc: *"Gemini 2.5 series
 *     models don't support thinkingLevel"* ⇒ `isGemini3OrLater` กันไว้ให้แล้ว
 *     (วันนี้ไม่มี hook ไหนใช้ 2.5 ในเส้นตอบลูกค้า แต่ `qr-vision` ใช้ 2.5-flash อยู่
 *      — คนละเส้น ไม่ได้เรียกไฟล์นี้ ไม่กระทบ)
 *
 * เอกสารอ้างอิง (ดึงหน้าเต็มมาอ่านเอง 26/08/2026):
 *   https://ai.google.dev/gemini-api/docs/generate-content/thinking
 *   https://ai.google.dev/api/generate-content   (ThinkingConfig / ThinkingLevel)
 *
 * revert: ลบไฟล์นี้ + คืน `thinkingConfig: { thinkingBudget: call.thinkingBudget ?? 0 }`
 *         ใน `gemini-reply.transport.ts` แล้ว 3.6 จะกลับไป 400 เหมือนเดิม
 */

/** ก้อน `thinkingConfig` ที่จะไปวางใน `generationConfig` — มีคีย์เดียวเสมอ */
export type ThinkingConfigOut =
  | { thinkingBudget: number; thinkingLevel?: undefined }
  | { thinkingLevel: string; thinkingBudget?: undefined };

/** คำที่ใช้แทน "ปิด" สำหรับ Gemini 3 ขึ้นไป */
export const OFF_LEVEL = 'minimal';

/**
 * รุ่นที่สั่ง `minimal` แล้ว Google ตอบ error (doc: "Not supported (error)")
 * ⇒ ใช้ `low` แทน ซึ่งเป็นระดับต่ำสุดที่รุ่นเหล่านี้รับ
 * ⚠️ เทียบแบบ **ขึ้นต้นด้วย** เพราะชื่อจริงมีหางต่อท้าย (`-preview`, `-002`, …)
 */
export const NO_MINIMAL_PREFIX: readonly string[] = [
  'gemini-3.7',
  'gemini-3.1-pro',
];

/** ระดับต่ำสุดที่รุ่นใน `NO_MINIMAL_PREFIX` ยอมรับ */
export const OFF_LEVEL_FALLBACK = 'low';

/**
 * รุ่นนี้เป็น Gemini 3 ขึ้นไปหรือไม่
 *
 * ⚠️ `null`/ว่าง = "hook ไม่ได้เลือกรุ่น" ⇒ transport จะใช้ `GEMINI_FAMILY_MODEL`
 *    (`gemini-3.5-flash`) ซึ่งเป็น Gemini 3 ⇒ ตอบ `true` ให้ตรงกับของที่ยิงจริง
 *    วันนี้ทุก hook เข้าทางนี้ (ai_model เป็น null ทั้ง 29 ตัว)
 * ⚠️ อ่านไม่ออก = ตอบ `false` ⇒ ตกกลับไปใช้ `thinkingBudget` แบบเดิม
 *    "ของแปลกที่ไม่รู้จัก ให้ทำเท่าที่เคยทำ" ปลอดภัยกว่าเดา
 */
export function isGemini3OrLater(modelId: string | null | undefined): boolean {
  if (modelId === null || modelId === undefined || modelId.trim() === '') {
    return true; // family default = gemini-3.5-flash
  }
  const m = /gemini-(\d+)(?:\.(\d+))?/i.exec(modelId.trim());
  if (!m) return false;
  return Number(m[1]) >= 3;
}

/**
 * แปลงค่าที่แอดมินตั้ง (ตัวเลขเดิมใน DB) เป็นคำสั่งที่รุ่นนั้น ๆ ฟังรู้เรื่อง
 *
 * @param modelId  รุ่นที่จะยิงจริง (`null` = ใช้ค่าเริ่มต้นของค่าย)
 * @param budget   `hook.gemini_thinking_budget` · `null`/`undefined` = ปิด (เท่ากับ 0)
 */
export function resolveThinkingConfig(
  modelId: string | null | undefined,
  budget: number | null | undefined,
): ThinkingConfigOut {
  const b = budget ?? 0;

  /* ไม่ใช่ "ปิด" ⇒ ไม่แตะเลย · `-1` (อัตโนมัติ) และ `n > 0` (กำหนดเอง)
     ยิงจริงแล้วทั้ง 3.5 และ 3.6 รับได้ปกติ ⇒ เปลี่ยนไปก็มีแต่ความเสี่ยง */
  if (b !== 0) return { thinkingBudget: b };

  /* ตระกูล 2.5 และรุ่นที่อ่านไม่ออก ⇒ ทางเดิมเป๊ะ */
  if (!isGemini3OrLater(modelId)) return { thinkingBudget: 0 };

  const id = (modelId ?? '').trim().toLowerCase();
  const noMinimal = NO_MINIMAL_PREFIX.some((p) => id.startsWith(p));
  return { thinkingLevel: noMinimal ? OFF_LEVEL_FALLBACK : OFF_LEVEL };
}
