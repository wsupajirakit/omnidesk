/* ==== [REFACTOR-20260803-DOCBLOCK] Training Document — 3 กล่อง 3 field ==============
 * 🔒 สาย AUTO — to_dev_auto / to_prod_auto
 *
 * WHY THIS FILE EXISTS AT ALL
 *   The parse/join formulas used to live inline inside HookFormModal.tsx. A .cjs test
 *   cannot require a .tsx, so any test had to re-type the formula — and a re-typed
 *   formula passes while the real modal is broken. That exact bug class was hit twice
 *   in one day (the dynamic-tag path reader declared in two places, and a guard test
 *   that referenced a file which had never been written).
 *   ⇒ helper อยู่ไฟล์ .ts แยก · modal กับเทสเรียกตัวเดียวกัน ห้ามมีสูตรคู่ขนาน
 *
 * ── WHAT CHANGED ────────────────────────────────────────────────────────────
 *   BEFORE  2 DB columns holding concatenated boxes, FE split on load / joined on save
 *             suggestion_text            = box1 + "[END_OF_BASIC_INFO]" + box2
 *             suggestion_text_no_profile = box1 + "[END_OF_BASIC_INFO]" + box3
 *           three bugs came from that shape, all measured before the change:
 *             · the length validator joined with a DIFFERENT formula than save, so it
 *               counted the delimiter twice — off by 20 chars on the "box 2 empty" case
 *             · save->load->save was not stable once a user pasted the tag mid-content
 *             · box1 of the no-profile field was silently overwritten from the other one
 *   AFTER   3 columns, one per box, holding the admin's text and nothing else.
 *           No join, no split, no strip-and-rewrap, no idempotency problem — the whole
 *           family of bugs stops existing rather than getting patched.
 *
 * 🔴 กล่องเก็บ "เนื้อล้วน" ห้ามมี tag — BE ห่อ [START_OF_*]/[END_OF_*] ตอนส่ง Gemini
 *    (webhookController.buildSuggestionForHook — marker เดียวกัน)
 *    FE โชว์ชื่อ tag เป็นป้าย read-only เหนือกล่อง ไม่ใช่ข้อความในช่องที่แก้ได้
 *
 * revert: ลบไฟล์นี้ + คืน parse/join เดิมใน HookFormModal.tsx (ดู git history)
 * ============================================================================ */

import { SUGGESTION_TEXT_MAX_LENGTH } from './suggestionUtils';

/** ตัวคั่นของรูปแบบเก่า — ยังต้องรู้จักเพื่ออ่าน hook ที่ยังไม่ถูก re-save */
export const LEGACY_DELIMITER = '[END_OF_BASIC_INFO]';

/** ป้ายที่โชว์เหนือกล่อง (read-only) — ชุดเดียวกับ DOC_BLOCKS ฝั่ง BE */
export const DOC_BLOCK_LABELS = {
  general: { start: '[START_OF_BASIC_INFO]', end: '[END_OF_BASIC_INFO]' },
  company: { start: '[START_OF_COMPANY_INFO]', end: '[END_OF_COMPANY_INFO]' },
  noProfile: { start: '[START_OF_NO_PROFILE_DATA]', end: '[END_OF_NO_PROFILE_DATA]' },
} as const;

const ALL_TAGS = Object.values(DOC_BLOCK_LABELS).flatMap((b) => [b.start, b.end]);

export interface TrainingBoxes {
  general: string;
  company: string;
  noProfile: string;
}

/** ลบ tag ทุกตัวออกจากข้อความ + เก็บกวาดบรรทัดว่างที่เหลือ
 *  ⚠️ ต้องยุบบรรทัดว่างด้วย ไม่งั้น save ซ้ำหลายรอบแล้วบรรทัดว่างสะสมไปเรื่อย ๆ
 *
 *  🔴 จับ "สตริงเป๊ะ ๆ พร้อมวงเล็บ" เท่านั้น — ห้ามเปลี่ยนเป็น regex ที่จับชื่อลอย ๆ
 *     แอดมินเขียนกำกับให้ AI อ่านโดยอ้างชื่อบล็อกแบบไม่มีวงเล็บอยู่จริง:
 *       "ให้ตอบจากข้อมูลใน END_OF_BASIC_INFO เท่านั้น"  -> เนื้อหา เก็บไว้
 *       "เนื้อหา [END_OF_BASIC_INFO] ต่อ"                -> ตัวคั่น ลบทิ้ง
 *     ⚠️ เป็น regex เมื่อไหร่ = กินคำสั่งที่แอดมินตั้งใจเขียน prompt เพี้ยนแบบเงียบ */
export function stripDocBlockTags(text: string): string {
  let out = String(text ?? '');
  for (const tag of ALL_TAGS) out = out.split(tag).join('');
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * อ่านค่าจาก hook -> กล่อง 3 ใบ
 * รองรับ 2 รูปแบบพร้อมกัน โดยไม่ต้อง migrate:
 *   ใหม่  3 field แยก เนื้อสะอาด          -> map ตรง ๆ
 *   เก่า  suggestion_text มี delimiter อยู่ -> split แบบเดิมเป๊ะ
 * ⚠️ ตัวแยกคือ "มี delimiter ในข้อมูลไหม" — เป็นจริงได้เพราะตอน save เรา strip tag ทิ้ง
 */
export function parseTrainingDoc(hook: {
  suggestion_text?: string;
  suggestion_company_text?: string;
  suggestion_text_no_profile?: string;
}): TrainingBoxes {
  const text = String(hook?.suggestion_text ?? '');
  const np = String(hook?.suggestion_text_no_profile ?? '');

  if (!text.includes(LEGACY_DELIMITER)) {
    // รูปแบบใหม่ — 1 field 1 กล่อง ไม่ต้องตีความอะไร
    return {
      general: text.trim(),
      company: String(hook?.suggestion_company_text ?? '').trim(),
      noProfile: np.trim(),
    };
  }

  /* รูปแบบเก่า — สูตร split เดิมทุกประการ (HookFormModal.tsx:716-737 ก่อนแก้)
   * ⚠️ ห้ามเปลี่ยนสูตรตรงนี้ ไม่งั้นเนื้อหาของ hook เก่าจะย้ายกล่องตอนแอดมินเปิดดู */
  const i = text.indexOf(LEGACY_DELIMITER) + LEGACY_DELIMITER.length;
  const general = text.substring(0, i).replace(LEGACY_DELIMITER, '').trim();
  const company = text.substring(i).trim();
  const noProfile = np.includes(LEGACY_DELIMITER)
    ? np.substring(np.indexOf(LEGACY_DELIMITER) + LEGACY_DELIMITER.length).trim()
    : np.trim();
  return { general, company, noProfile };
}

/**
 * กล่อง 3 ใบ -> payload ที่ส่งขึ้น API
 * ⭐ จุดเดียวในระบบที่ประกอบ payload ของ Training Doc — validate ก็ต้องเรียกตัวนี้
 *    ไม่งั้นตัวนับความยาววัดคนละสตริงกับที่เซฟจริง (บั๊กเดิม วัดได้ว่าเพี้ยนถึง 20 ตัว)
 */
export function joinTrainingDoc(boxes: TrainingBoxes) {
  return {
    suggestion_text: stripDocBlockTags(boxes.general).trim(),
    suggestion_company_text: stripDocBlockTags(boxes.company).trim(),
    suggestion_text_no_profile: stripDocBlockTags(boxes.noProfile).trim(),
  };
}

/** ความยาวที่ต้องเอาไป validate — ต่อกล่อง ไม่ใช่ผลรวม (1 field 1 ลิมิต) */
export function trainingDocLengths(boxes: TrainingBoxes) {
  const p = joinTrainingDoc(boxes);
  return {
    suggestion_text: p.suggestion_text.length,
    suggestion_company_text: p.suggestion_company_text.length,
    suggestion_text_no_profile: p.suggestion_text_no_profile.length,
  };
}

export type TrainingDocField = 'suggestion_text' | 'suggestion_company_text' | 'suggestion_text_no_profile';
const TRAINING_DOC_FIELDS: readonly TrainingDocField[] = [
  'suggestion_text',
  'suggestion_company_text',
  'suggestion_text_no_profile',
];

/**
 * [FEAT-20261016-DOC60K] The boxes the SERVER would refuse for length — its rule, not a second one:
 *   · measured as saved (`joinTrainingDoc`: stripDocBlockTags + trim — what the server measures)
 *   · limit `SUGGESTION_TEXT_MAX_LENGTH` (the server's number, drift-guarded)
 *   · only a box that is SENT: `baseline === null` (create / clone) sends every box; an edit sends
 *     only boxes that differ from what the form loaded (`diffHookPayload`), so an untouched stored
 *     doc already over the limit never reaches the server and must not block the rest of the save.
 * ส่งกล่องไหน = ตรวจกล่องนั้น ด้วยเพดานเดียวกับ BE
 */
export function trainingDocOverLimit(
  boxes: TrainingBoxes,
  baseline: Partial<Record<TrainingDocField, unknown>> | null,
): TrainingDocField[] {
  const p = joinTrainingDoc(boxes);
  return TRAINING_DOC_FIELDS.filter(
    (f) =>
      p[f].length > SUGGESTION_TEXT_MAX_LENGTH && (baseline === null || p[f] !== baseline[f]),
  );
}
