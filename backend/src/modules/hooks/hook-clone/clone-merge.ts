/**
 * ==== [FEAT-20260818-CLONEFULL] เติมค่าที่ฟอร์มคัดลอกไม่ได้ ให้ Copy Item ครบ ======
 *
 * ## ปัญหาที่แก้ (ตรวจของจริง 18/08)
 * ปุ่ม **Copy Item** สร้าง OA ใหม่จากฟอร์มฝั่ง FE ทั้งหมด: เปิดฟอร์มด้วยค่าของต้นทาง
 * แล้ว `POST /hook` เป็นรายการใหม่ ⇒ ค่าที่ **ฟอร์มไม่มีในมือ** หายทุกครั้ง
 * เทียบ `omnideskdevoatwo` กับ `omnideskdevoa` แบบ field ต่อ field: เท่ากัน 75 · หาย 7 · เพี้ยน 2
 *
 *   creds 5    `channel_secret` `access_token` `custom_ai_key` `slip_verify_key`
 *              `external_password` — `GET /hook/:id` ส่ง `__SECRET_KEPT__` แทนค่าจริง
 *              (โดยเจตนา ค่าลับต้องไม่ถึงเบราว์เซอร์) ฟอร์มจึงไม่มีอะไรจะคัดลอก
 *   cache 2    `raw_site_rules_data` (5.8 KB) `site_rules_updated_at` — ไม่ได้อยู่ในฟอร์ม
 *              เป็นข้อมูลที่ระบบดึงมาเก็บ และ AI ใช้ประกอบคำตอบ
 *   เพี้ยน     `image_answer_text` หาย `\n` ท้าย 1 ตัว — `create` ตัดด้วย `trimToString`
 *              (`hooks.service.ts:1279`) ส่วน `update` ไม่ตัด ⇒ ต้นฉบับที่เคยเซฟผ่าน PUT
 *              มี `\n` แต่ของที่สร้างใหม่ไม่มี
 *
 * ## ขอบเขตของไฟล์นี้ (pure function — ไม่แตะ DB ไม่ตรวจสิทธิ์)
 * รับ **เอกสารใหม่ที่ create สร้างเสร็จแล้ว** + **เอกสารต้นทาง** แล้วคืน patch (`$set`)
 * ว่าต้องเติมอะไรบ้าง · ผู้เรียก (`hook-clone.service.ts`) เป็นคนโหลด/ตรวจสิทธิ์/เขียน
 *
 * ⚠️ **additive และแยกจากงาน creds เดิมโดยสิ้นเชิง** — ไม่แตะ `maskSecretsForDetail` ·
 * `stripKeptSecrets` · ตัวกัน sentinel · `SENSITIVE_FIELDS` · และไม่แตะ `create()`
 * ค่าลับถูกคัดลอก **ตามที่เก็บไว้ (ciphertext → ciphertext)** ไม่ถอดรหัส ไม่เข้ารหัสซ้ำ
 * (วิธีเดียวกับที่ `cloneHookSettings` ใช้อยู่แล้ว — ถ้าเข้ารหัสซ้ำจะพังตอนหมุนกุญแจ)
 * ทางเลือกที่ให้ FE ส่ง sentinel แล้วให้ BE แปลว่า "เอาจากต้นทาง" ถูกตัดออก เพราะต้อง
 * ไปแก้ความหมายของ sentinel = แก้งาน creds
 *
 * ## ทำไมไม่ใช้ NEVER_CLONE ของ `cloneHookSettings`
 * รายการนั้นออกแบบมาสำหรับ "ทับ OA ที่วิ่งอยู่" จึงกัน `channel_secret` `access_token`
 * `status` `raw_site_rules_data` ไว้ — ถ้าทับของจริงจะทำให้ปลายทางหยุดรับข้อความทันที
 * เคสนี้ปลายทางคือ **รายการที่เพิ่งเกิด ยังไม่มีตัวตนของตัวเอง** ความหมายจึงกลับกัน:
 * ต้องได้ค่าเหล่านั้นมาเป็นจุดเริ่ม แล้วผู้ใช้ไปเปลี่ยน token/secret ของ OA ใหม่เอง
 * ⇒ ไฟล์นี้มีรายการยกเว้นของตัวเอง ไม่แชร์กับของเดิม (เปลี่ยนอันหนึ่งไม่กระทบอีกอัน)
 *
 * revert: ลบโฟลเดอร์ `hook-clone/` + route/provider ที่ผูกไว้ (tag เดียวกัน)
 *         พฤติกรรมกลับไปเป็น Copy Item แบบคัดลอกจากฟอร์มอย่างเดียว
 */

import { aiPairFieldsToSkip } from './ai-pair';
import { slipPairFieldsToSkip } from './slip-pair';

/**
 * ตัวตนของ "รายการใหม่" — ห้ามรับมาจากต้นทางเด็ดขาด
 *
 * ทุกตัวเป็นค่าที่ผู้ใช้กรอกในฟอร์มหรือระบบออกให้ตอนสร้าง · ถ้าเผลอคัดลอกมาจะได้ OA
 * ที่ชี้ทับกัน (alias ซ้ำ = webhook ไปเข้าตัวเดิม) หรือประวัติเวลาผิด
 */
const NEW_ROW_IDENTITY: ReadonlySet<string> = new Set([
  '_id',
  '__v',
  'alias',
  'webhook_url',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'deleted_at',
]);

/** ค่าที่ถือว่า "ยังไม่มีอะไรอยู่" ⇒ เติมได้ */
const isBlank = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0);

export interface CloneMergeReport {
  /** patch ที่ต้อง `$set` ลงเอกสารใหม่ */
  patch: Record<string, unknown>;
  /** creds ที่สืบทอดมา — **ชื่อ field เท่านั้น ห้าม log ค่า** */
  inherited: string[];
  /** field ปกติที่เติมเพราะเอกสารใหม่ยังว่าง */
  copied: string[];
  /** field ที่คืนค่าต้นทางแบบตรงบิต เพราะต่างกันแค่ช่องว่างหัวท้าย */
  preserved: string[];
  /**
   * [FIX-20260818-CLONEAIPAIR] field ที่ "ตั้งใจไม่เติม" เพราะกฎคู่ผูก AI
   * มีค่าเมื่อผู้ใช้สลับ vendor ตอน copy เท่านั้น · ผู้เรียกเอาไปบอกใน log ได้ว่า
   * ทำไม OA ใหม่จึงยังไม่มีคีย์ (ไม่ใช่การคัดลอกพลาด แต่กันคีย์ข้ามค่าย)
   */
  skipped: string[];
}

/**
 * คำนวณ patch สำหรับเอกสารที่ clone มา
 *
 * กฎ (เรียงตามลำดับการตัดสิน):
 *  0. คู่ผูก AI (`ai-pair.ts`) — ค่ายย้าย = ห้ามสืบทอดคีย์/ชื่อรุ่นของค่ายเดิม
 *  1. `NEW_ROW_IDENTITY` — ข้ามทุกกรณี
 *  2. เอกสารใหม่ยังว่าง + ต้นทางมีค่า → เติม (creds เข้าทางนี้ เพราะฟอร์มส่งว่างมาเสมอ)
 *  3. มีค่าทั้งคู่ ต่างกันแค่ช่องว่างหัวท้าย → คืนค่าต้นทางตรงบิต
 *  4. นอกนั้นไม่แตะ — ค่าที่ผู้ใช้พิมพ์/สลับในฟอร์มชนะเสมอ (ชื่อ บริษัท กลุ่ม สถานะ)
 *
 * กฎ 0 เป็นข้อยกเว้นเดียวที่ "รู้จักชื่อ field" และถูกแยกไปอยู่ไฟล์ของตัวเอง เพื่อให้
 * ลูปข้างล่างยังเป็นตัวเติมค่าแบบไม่รู้จัก field ตามเจตนาเดิมของไฟล์นี้
 */
export const buildClonePatch = (
  created: Record<string, unknown>,
  source: Record<string, unknown>,
  secretFields: readonly string[],
): CloneMergeReport => {
  const secrets = new Set(secretFields);
  // กฎ 0 — ตัดสินครั้งเดียวก่อนเข้าลูป: ว่างเปล่าเมื่อค่ายไม่ได้ย้าย (กรณีปกติทั้งหมด)
  /* [FEAT-20261016-SLIPGUARDLOAN] + the slip provider's key/branch when the form moved the provider
     (loan only — on shop-api it is always []) */
  const pairSkip = [
    ...aiPairFieldsToSkip(created, source),
    ...slipPairFieldsToSkip(created, source),
  ];
  const report: CloneMergeReport = {
    patch: {},
    inherited: [],
    copied: [],
    preserved: [],
    skipped: [...pairSkip],
  };

  for (const key of Object.keys(source)) {
    if (NEW_ROW_IDENTITY.has(key)) continue;
    if (pairSkip.includes(key)) continue;

    const from = source[key];
    if (from === undefined) continue;
    const now = created[key];

    if (isBlank(now)) {
      if (isBlank(from)) continue;
      report.patch[key] = from;
      (secrets.has(key) ? report.inherited : report.copied).push(key);
      continue;
    }

    if (
      typeof now === 'string' &&
      typeof from === 'string' &&
      now !== from &&
      now.trim() === from.trim()
    ) {
      report.patch[key] = from;
      report.preserved.push(key);
    }
  }

  return report;
};
