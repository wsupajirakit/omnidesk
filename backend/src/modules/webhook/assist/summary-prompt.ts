/**
 * [P2-20260813] The assist-summary PROMPT — domain, not vendor.
 *
 * Lifted verbatim out of `ai-vendors/gemini/gemini-summary.transport.ts` when
 * DeepSeek became the second summary vendor. The text is business language (Thai
 * copy, the three allowed categories) that every vendor must send identically —
 * leaving it inside one vendor's file would mean editing the same prompt twice
 * and letting the two vendors drift. ย้ายมาที่กลาง เพื่อไม่ให้ prompt แตกเป็นสองชุด.
 *
 * ⚠️ BYTE-FROZEN. Every newline, label and the `${history || 'ไม่มีประวัติ'}`
 *    default is copied character for character from legacy
 *    (`rag-engine.service.ts:1803-1822`); the W2-0 before-pack snapshots compare
 *    the wire bytes, so changing any whitespace here breaks them by design.
 *
 * Placement: this sits beside the other vendor-neutral summary files
 * (`summary-neutral.ts`, `summary-interpreter.ts`) rather than under
 * `ai-vendors/` — it is shared domain. If a second prompt file ever appears,
 * group them then; one file does not earn a directory.
 *
 * revert: inline this function back into the Gemini transport and delete this
 *         file (DeepSeek's transport imports it too, so it goes first).
 */

import type { SummaryCall } from './summary-neutral';

/**
 * Build the summary prompt EXACTLY as legacy (`:1803-1822`). The template literal
 * — every newline, every label, the `${history || 'ไม่มีประวัติ'}` default — is
 * copied character for character. Changing any whitespace changes the bytes the
 * model reads and breaks the W2-0 snapshot. ห้ามแก้ whitespace แม้แต่ตัวเดียว.
 */
export function buildSummaryPrompt(call: SummaryCall): string {
  return `
วิเคราะห์บทสนทนาระหว่างลูกค้าและบอท สรุปความต้องการของลูกค้าให้กระชับที่สุด และจัดหมวดหมู่ปัญหา
ตอบกลับเป็น JSON format เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "summary": "รายละเอียดความต้องการของลูกค้าสั้นๆ 1-2 บรรทัด (เช่น ต้องการปลดระบบ 'ติดกำกับ' หลังผ่อนชำระครบถ้วน)",
  "category": "หมวดหมู่ (ต้องเป็นหนึ่งในค่าภาษาอังกฤษที่กำหนดเท่านั้น)"
}

หมวดหมู่ที่อนุญาตให้ใช้มีดังนี้เท่านั้น (ห้ามใช้ค่าอื่นนอกจากนี้ ถ้าไม่เข้าเงื่อนไขใดเลยให้ลง Other ทันที):
- Collection (สำหรับ ทวงถาม: เช่น สอบถามยอดค้างชำระ, ถามยอดค่างวดของสัญญาเดิม, ต้องการจ่ายเงิน/ชำระค่างวด, ขอเลื่อนหรือต่อรองการจ่ายเงิน, การประนอมหนี้)
- IT (สำหรับ ไอที: เช่น อุปกรณ์มีปัญหา, หน้าจอโดนล็อค/เครื่องล็อค, ปัญหาเข้าแอพไม่ได้, ปัญหาเทคนิคและอุปกรณ์)
- Other (สำหรับ อื่นๆ หรือกรณีที่ไม่เข้าเงื่อนไขด้านบนเลย)

บทสนทนาย้อนหลัง:
${call.history || 'ไม่มีประวัติ'}

เหตุการณ์ล่าสุด:
- ลูกค้า: "${call.currentQuestion}"
- ระบบ (บอท): "${call.currentAnswer}"
`;
}
