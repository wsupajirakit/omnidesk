/**
 * [UI-20260825-WIZARD] ตารางขั้นตอนของฟอร์มบรอดแคสต์ — "ช่องไหนอยู่ขั้นไหน"
 * ===========================================================================
 * WHAT: ลิสต์เรียงลำดับของการ์ดในฟอร์ม (`FormSection`) หนึ่งใบ = หนึ่งขั้นตอน
 *       พร้อม "คีย์ error ที่เป็นของขั้นนั้น"
 *
 * WHY: เจ้าของ 25/08: *"modal boardcast ทุกอย่างทำเป็น step · ไล่จากซ้ายไปขวา
 *      จนบันทึก"* ⇒ ต้องมีลำดับที่เขียนไว้ที่เดียว ไม่ใช่ให้ JSX เป็นคนบอกลำดับ
 *
 * 🔴 ทำไมต้องมีคอลัมน์ `fields` — และทำไมมันคือหัวใจของงานนี้
 *    วิซาร์ดซ่อนขั้นที่ไม่ได้อยู่ ⇒ error ที่อยู่ขั้น 1 จะ **มองไม่เห็นเลย**
 *    ตอนผู้ใช้ยืนอยู่ขั้น 4 · ตารางนี้คือสิ่งที่ทำให้ (ก) ป้ายนับ error ขึ้นถูกขั้น
 *    (ข) กดเซฟไม่ผ่านแล้วเด้งกลับไป **ขั้นแรกที่ผิด** ไม่ใช่ปล่อยให้หาเอง
 *    ซ่อนได้ แต่ห้ามซ่อนจนไม่รู้ว่าอะไรผิด.
 *
 * 🔴 ตารางนี้ **แทน** `SECTION_FIELDS` เดิมใน `BroadcastFormModal.tsx` ซึ่งเพี้ยน
 *    ไปแล้วจริง ๆ ตอนย้ายช่องเมื่อ 24-25/08:
 *      · `target: ['assign_group','hook_ids']` — แต่สองช่องนั้นย้ายออกไปอยู่
 *        การ์ด `section-group` / `section-oa` คนละใบกันแล้ว ⇒ ป้ายแดงขึ้นผิดใบ
 *      · `section-group` อ่าน `errors.group` ซึ่ง **`validate()` ไม่เคยตั้งเลย**
 *        ⇒ เลือกกลุ่มไม่ครบ การ์ดใบนั้นไม่กางเอง ไม่มีป้าย ไม่มีอะไรบอก
 *    เทส `broadcastWizardStepMap` ปักไว้ว่าคีย์ทุกตัวที่ `validate()` ตั้งได้
 *    ต้องถูกจองโดยขั้นใดขั้นหนึ่ง **พอดีหนึ่งขั้น** ⇒ เพิ่ม validate ใหม่แล้วลืม
 *    ใส่ตรงนี้ = เทสแดงทันที ไม่ใช่เงียบแบบเดิม
 *
 * ⚠️ `id` ต้องตรงกับ `testId` ของ `<FormSection>` ใบนั้นเป๊ะ — มันคือกาวเส้นเดียว
 *    ที่ผูก "ขั้นที่ n" เข้ากับการ์ดจริงบนจอ
 * ⚠️ ลำดับในลิสต์ = ลำดับการอ่านเดิมของฟอร์ม (ซ้ายบน → ซ้ายล่าง → ขวาบน → ขวาล่าง)
 *    ห้ามสลับเพื่อความสวย: เจ้าของสั่งว่า "ไล่จากซ้ายไปขวา" คือลำดับนี้
 *
 * revert: ลบไฟล์นี้ + `BroadcastStepper.tsx` แล้วเอา `SECTION_FIELDS`/`errorsIn`
 *         เดิมกลับเข้า `BroadcastFormModal.tsx` (ดู marker เดียวกันในไฟล์นั้น)
 */

export interface BroadcastStep {
  /** ตรงกับ `testId` ของ `<FormSection>` ใบนั้น */
  readonly id: string;
  /** คีย์แปลของหัวการ์ด — ใช้ซ้ำ ไม่ตั้งชื่อขั้นใหม่ให้ผู้ใช้ต้องจำสองชื่อ */
  readonly titleKey: string;
  /** คีย์ใน `errors` ที่เป็นของขั้นนี้ */
  readonly fields: readonly string[];
}

export const BROADCAST_STEPS: readonly BroadcastStep[] = [
  { id: 'section-basic', titleKey: 'broadcast.section_basic', fields: ['name', 'description'] },
  { id: 'section-message', titleKey: 'broadcast.section_message', fields: ['message', 'title_detail'] },
  { id: 'section-group', titleKey: 'broadcast.form_assign_group_label', fields: ['assign_group'] },
  { id: 'section-oa', titleKey: 'broadcast.form_hooks_label', fields: ['hook_ids'] },
  /* [FEAT-2708-NOSTEPSKIP] `guard_window_hours` (งาน 4) สังกัดขั้นนี้ — ไม่อยู่ใน
     ตารางนี้ = error ลอยไร้ขั้น: ทั้งการเด้งตอนเซฟและด่านกันข้ามจะมองไม่เห็นมัน */
  { id: 'section-target', titleKey: 'broadcast.section_target', fields: ['target', 'guard_window_hours'] },
  /* [FIX-20260825-PICKSENDMODE] `status` อยู่ในลิสต์นี้ด้วย ไม่งั้นการไม่เลือก
     วิธีส่งจะไม่พาผู้ใช้มายืนที่ขั้นนี้ และป้ายจำนวน error บนการ์ดก็จะไม่ติด */
  /* [FIX-20260828-REPEATDAYS] `schedule_days` อยู่ขั้นเดียวกับตารางเวลา
     ⚠️ คีย์ใหม่ทุกตัวที่ `validate()` ตั้งได้ ต้องมาลงทะเบียนที่นี่ — ไม่งั้นป้ายแดง
        ไม่ขึ้นและการ์ดไม่กาง (มีเทสปักไว้ว่าทุกคีย์ต้องถูกจองพอดีหนึ่งขั้น) */
  { id: 'section-send', titleKey: 'broadcast.section_send_status', fields: ['scheduled_at', 'status', 'schedule_days'] },
];

export const STEP_COUNT = BROADCAST_STEPS.length;

/** ขั้นสุดท้ายอยู่ที่ไหน — ที่เดียว ไม่ให้ `length - 1` กระจายไปทั่ว */
export const LAST_STEP = STEP_COUNT - 1;

/** ที่เดียวที่แปลง "id การ์ด" → "ลำดับขั้น" · คืน -1 ถ้าไม่รู้จัก */
export const stepIndexOf = (sectionId: string): number =>
  BROADCAST_STEPS.findIndex(s => s.id === sectionId);

/**
 * [FEAT-20260907-FLEXPICKREFRESH] Is this step visible right now?
 *
 * 🔴 MOVED HERE FROM `BroadcastStepPane`, which worked the expression out inline
 *    — and that was fine while the pane was the only thing that needed to know.
 *    `FlexCardPicker` now needs the same answer (it reloads the card library
 *    when the admin arrives on the step), which left two options: repeat the
 *    expression in the form, or move it somewhere both can ask. A repeated
 *    formula is one that gets edited in one place and not the other, and then
 *    the pane is hidden while the picker believes it is on screen — which is
 *    the class of drift this file exists to prevent. One formula, one owner.
 *
 * ⚠️ `showAll` ("show every step") always wins: expanded means all steps visible.
 * ⚠️ An unknown id resolves to -1, which never equals `activeIndex`, so the
 *    answer is `false` rather than a throw.
 *
 * revert: inline the expression back into `BroadcastStepPane` and delete this.
 */
export const isStepVisible = (
  sectionId: string,
  activeIndex: number,
  showAll: boolean,
): boolean => showAll || stepIndexOf(sectionId) === activeIndex;

/**
 * จำนวน error ในการ์ดใบนั้น
 *
 * ⚠️ รับ `sectionId` ไม่ใช่เลขขั้น เพราะ call site คือ `<FormSection testId=...>`
 *    ซึ่งถือ id อยู่แล้ว — ส่ง id ไปตรง ๆ ทำให้ "การ์ดกับขั้น" ผูกกันด้วยค่าเดียว
 *    ไม่ใช่ด้วยเลขลำดับที่คนอ่านต้องนับเอง
 */
export const errorsOnStep = (
  sectionId: string,
  errors: Readonly<Record<string, string>>,
): number => {
  const step = BROADCAST_STEPS.find(s => s.id === sectionId);
  if (!step) return 0;
  return step.fields.filter(k => errors[k]).length;
};

/** ป้ายนับ error ของทุกขั้น เรียงตามลำดับขั้น — ใช้วาดแถบขั้นตอน */
export const stepErrorCounts = (
  errors: Readonly<Record<string, string>>,
): number[] => BROADCAST_STEPS.map(s => errorsOnStep(s.id, errors));

/**
 * ขั้น **แรก** ที่มีช่องผิด — คืน -1 ถ้าไม่มีเลย
 *
 * 🔴 "แรก" ไม่ใช่ "ใกล้ที่สุด" โดยตั้งใจ: กดเซฟแล้วพลาด ผู้ใช้ควรถูกพากลับไป
 *    จุดเริ่มของปัญหาแล้วไล่ลงมาตามลำดับเดิม — เหมือนที่แถบสรุปด้านบนไล่ให้
 */
export const firstStepWithError = (
  errors: Readonly<Record<string, string>>,
): number => BROADCAST_STEPS.findIndex(s => s.fields.some(k => errors[k]));

/** กันเลขขั้นหลุดขอบ (เช่นเด้งจาก error map ที่ไม่มีใครจอง) */
export const clampStep = (n: number): number =>
  n < 0 ? 0 : n > LAST_STEP ? LAST_STEP : n;
