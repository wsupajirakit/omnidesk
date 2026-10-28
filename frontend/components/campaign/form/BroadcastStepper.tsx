/**
 * [UI-20260825-WIZARD] เปลือกวิซาร์ดของฟอร์มบรอดแคสต์ — แถบขั้นตอน · กล่องขั้น · ปุ่มเดินหน้า/ถอยหลัง
 * ===========================================================================
 * เจ้าของ 25/08: *"modal boardcast ทุกอย่างทำเป็น step / modal create / edit /
 * copy · ไล่จากซ้ายไปขวาจนบันทึก · <ย้อนกลับ> <ต่อไป> ปุ่มใหญ่ชัดเจน ·
 * ระวังสีแสบตา light / dark ทำสวยๆ"*
 *
 * WHY แยกไฟล์: `BroadcastFormModal.tsx` เกินเพดาน 400 บรรทัดไปนานแล้ว (อยู่ใน
 * waiver list ของ ratchet) ⇒ ห้ามโตต่อ · และเปลือกวิซาร์ดเป็น "ของเล่าเรื่อง"
 * ล้วน ไม่รู้จัก formData สักช่อง ⇒ ยกออกมาได้ทั้งก้อนโดยไม่ต้องพก state ตามมา
 *
 * 🔴 กติกาสีของไฟล์นี้ (requirement "ระวังสีแสบตา light / dark")
 *    ═══════════════════════════════════════════════════════════
 *    · ใช้เฉพาะโทเคนที่แอปนี้ **แมปธีมให้แล้วทั้งสองฝั่ง**: `bg-dark-*`,
 *      `border-dark-*`, `text-slate-*` — ดู `index.html` ที่ประกาศค่า
 *      `html.theme-dark .bg-dark-800 { … }` ฯลฯ ไว้ครบทุกตัว
 *      ⇒ เขียนครั้งเดียวได้ทั้ง light และ dark ไม่ต้องเดาเฉด
 *    · สีเน้น = LINE green (`primary-*`) แต่ **ไม่ใช้พื้นทึบ** ใช้ tint + เส้นขอบ
 *      + ring แทน (`bg-primary-500/10`) — เหตุผลเดียวกับ `activeChoiceClass.ts`
 *      ที่จดไว้ว่า เฉดอ่อนบนพื้นสว่างอ่านไม่ออก และพื้นทึบจัดจ้าน "แสบตา"
 *    · 🔴 พื้นทึบสีเดียวในฟอร์มนี้คือปุ่ม **ยืนยัน** (`bg-primary-600`) ซึ่งเป็น
 *      ของเดิม ⇒ "ต่อไป" ต้องไม่ไปแข่งกับมัน ไม่งั้นขั้นสุดท้ายจะมีปุ่มทึบสองใบ
 *      แล้วผู้ใช้แยกไม่ออกว่าอันไหนคือ "บันทึกจริง"
 *    · `primary-50` / `primary-100` **ไม่มีอยู่จริง** ในโปรเจ็กต์นี้ — `@theme`
 *      ประกาศแค่ 400/500/600/700 (`index.css:52-55`) ⇒ คลาสอย่าง `bg-primary-50`
 *      เงียบหายไปเฉย ๆ (มีของแบบนี้ค้างอยู่ในไฟล์โมดัลจริง ๆ) ห้ามเขียนเพิ่ม
 *
 * ⚠️ ปุ่ม "ย้อนกลับ/ต่อไป" ต้องเป็น `type="button"` เสมอ — มันอยู่ **ข้างใน**
 *    `<form id="broadcast-form">` และ `<button>` ที่ไม่ระบุ type คือ submit
 *    ⇒ ลืมไป = กด "ต่อไป" แล้วฟอร์มเซฟ (เด้ง ConfirmModal) ทันที
 *    เทส `broadcastWizardNav` ปักเรื่องนี้ไว้โดยตรง
 *
 * revert: ลบไฟล์นี้ + `broadcastSteps.ts` แล้วถอด `[UI-20260825-WIZARD]` ทุกบล็อก
 *         ใน `BroadcastFormModal.tsx` — ฟอร์มจะกลับไปเป็นสองคอลัมน์หน้าเดียว
 */
import React from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, List } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { BROADCAST_STEPS, LAST_STEP, STEP_COUNT, isStepVisible } from './broadcastSteps';

/* ── สีเน้น: tint + ขอบ + ring ไม่ใช่พื้นทึบ (ดูกติกาสีหัวไฟล์) ─────────────── */

/** "ต่อไป" — ใหญ่ ชัด แต่ยังเบากว่าปุ่มยืนยันทึบ ⇒ ขั้นสุดท้ายไม่มีปุ่มแย่งกันเด่น */
export const WIZARD_NEXT_CLASS =
  'inline-flex items-center gap-2 rounded-xl border-2 border-primary-600 bg-primary-500/10 ' +
  'px-8 py-3 text-base font-semibold text-primary-700 dark:text-primary-400 ' +
  'ring-2 ring-primary-500/25 transition-colors hover:bg-primary-500/20 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/** "ย้อนกลับ" — โทนกลาง ๆ เดียวกับปุ่ม "ไม่ได้เลือก" ที่ฟอร์มใช้อยู่ (CHOICE_IDLE) */
export const WIZARD_BACK_CLASS =
  'inline-flex items-center gap-2 rounded-xl border-2 border-dark-700 ' +
  'px-8 py-3 text-base font-semibold text-slate-700 transition-colors ' +
  'hover:bg-dark-700 disabled:opacity-40 disabled:cursor-not-allowed';

/* ── ป้ายขั้นตอนบนแถบ ──────────────────────────────────────────────────────── */
const CHIP_BASE =
  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors';
const CHIP_ACTIVE =
  'border-primary-600 bg-primary-500/10 text-primary-700 dark:text-primary-400 font-semibold ring-2 ring-primary-500/25';
const CHIP_DONE = 'border-dark-700 bg-dark-900/40 text-slate-700';
const CHIP_TODO = 'border-dark-700 text-slate-600 hover:border-primary-500/40';
/** มี error = แดงเสมอ ทับสถานะอื่น — ห้ามให้ "ผ่านมาแล้ว" กลบ "ยังผิดอยู่" */
const CHIP_ERROR =
  'border-red-500/70 bg-red-500/10 text-red-600 dark:text-red-300 font-semibold';

export interface BroadcastStepRailProps {
  readonly activeIndex: number;
  /** จำนวน error ของแต่ละขั้น เรียงตามลำดับขั้น (จาก `stepErrorCounts`) */
  readonly errorCounts: readonly number[];
  readonly showAll: boolean;
  readonly onPick: (index: number) => void;
  readonly onToggleShowAll: () => void;
}

/**
 * แถบบอกว่า "อยู่ขั้นไหน เหลืออีกกี่ขั้น" + กระโดดข้ามขั้นได้
 *
 * 🔴 กระโดดได้ทุกขั้นโดยตั้งใจ — ดูเหตุผลเต็มเรื่อง "ต่อไป ไม่บล็อก" ที่
 *    `BroadcastFormModal.tsx` marker `[UI-20260825-WIZARD]` · สรุปสั้น ๆ:
 *    โหมดดูอย่างเดียว (`view`) และงานที่ copy มาจากใบเก่าต้องเดินดูได้ทุกขั้น
 *    ถ้าล็อกไว้ ผู้ใช้จะติดอยู่ขั้น 1 ของงานที่ตัวเองแก้อะไรไม่ได้เลย
 *
 * ⚠️ ป้ายแดงบนขั้นคือสิ่งที่ทำให้ error ของขั้น 1 ไม่หายไปตอนยืนอยู่ขั้น 4
 *    ห้ามถอดออกเพื่อความสวย
 */
export const BroadcastStepRail: React.FC<BroadcastStepRailProps> = ({
  activeIndex,
  errorCounts,
  showAll,
  onPick,
  onToggleShowAll,
}) => {
  const { t } = useI18n();
  const current = Math.min(activeIndex, LAST_STEP);
  const remaining = LAST_STEP - current;
  const activeTitle = t(BROADCAST_STEPS[current]?.titleKey ?? '');

  return (
    <div
      className="rounded-xl border border-dark-700 bg-dark-900/40 px-4 py-3"
      data-testid="wizard-rail"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900" data-testid="wizard-position">
          {t('broadcast.wizard_step_of', { current: current + 1, total: STEP_COUNT })}
          <span className="ml-2 font-normal text-slate-700">{activeTitle}</span>
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600" data-testid="wizard-remaining">
            {remaining > 0
              ? t('broadcast.wizard_remaining', { count: remaining })
              : t('broadcast.wizard_last_step')}
          </span>
          {/*
            [UI-20260825-WIZARD] สวิตช์ "แสดงทุกขั้นตอน"
            🔴 ไม่ใช่ของประดับ — วิซาร์ดซ่อนขั้นอื่นด้วย `display:none` จริง ๆ
               ⇒ ถ้าไม่มีทางกางทั้งหมด จะไม่มีทาง "ตรวจทานทั้งใบก่อนกดบันทึก"
               และงานตรวจ (โหมด view) จะต้องกดหกครั้งเพื่ออ่านงานหนึ่งใบ
            ⚠️ `aria-expanded` + testid ลงท้าย `-toggle` ไม่ใช่เรื่องบังเอิญ:
               `test/setup.ts#openAllFormSections` กางทุกอย่างที่ปิดอยู่ด้วยสองสิ่งนี้
               และ `test/broadcastFormVisible.dom.test.tsx` ใช้มันพิสูจน์ว่า
               "ทุกช่องที่ BE รองรับ ยังมองเห็นได้จริง" — สวิตช์นี้คือทางที่ทำให้
               คำรับประกันข้อนั้นยังจริงอยู่หลังกลายเป็นวิซาร์ด
               เปลี่ยนชื่อ/ถอด aria-expanded = เทสชุดนั้นแดง และของก็เข้าถึงไม่ได้จริง
          */}
          <button
            type="button"
            name="wizard_view_all"
            data-testid="wizard-viewall-toggle"
            aria-expanded={showAll}
            onClick={onToggleShowAll}
            className="flex items-center gap-1.5 rounded-lg border border-dark-700 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-dark-700"
          >
            <List size={14} aria-hidden />
            {showAll ? t('broadcast.wizard_show_steps') : t('broadcast.wizard_show_all')}
          </button>
        </div>
      </div>

      {/* แถบความคืบหน้า — เส้นบาง ๆ ไม่ใช่แผงสีเต็มกล่อง */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-dark-700">
        <div
          className="h-full rounded-full bg-primary-500/70 transition-all"
          style={{ width: `${((current + 1) / STEP_COUNT) * 100}%` }}
          data-testid="wizard-progress"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {BROADCAST_STEPS.map((step, i) => {
          const bad = errorCounts[i] ?? 0;
          const tone = bad > 0 ? CHIP_ERROR : i === current ? CHIP_ACTIVE : i < current ? CHIP_DONE : CHIP_TODO;
          return (
            <button
              key={step.id}
              type="button"
              data-testid={`wizard-step-${step.id}`}
              aria-current={i === current ? 'step' : undefined}
              onClick={() => onPick(i)}
              className={`${CHIP_BASE} ${tone}`}
            >
              <span className="tabular-nums">{i + 1}.</span>
              <span>{t(step.titleKey)}</span>
              {bad > 0 && (
                <span
                  className="flex items-center gap-0.5"
                  data-testid={`wizard-step-badge-${step.id}`}
                >
                  <AlertCircle size={12} aria-hidden />
                  {bad}
                </span>
              )}
              {bad === 0 && i < current && <Check size={12} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export interface BroadcastStepPaneProps {
  readonly stepId: string;
  readonly activeIndex: number;
  readonly showAll: boolean;
  readonly children: React.ReactNode;
}

/**
 * กล่องครอบหนึ่งขั้น — **ซ่อน ไม่ใช่ถอดออก**
 *
 * 🔴 นี่คือข้อต่างที่สำคัญที่สุดของไฟล์นี้ · ถ้า render แบบ `{active && <…>}`
 *    ช่องกรอกของขั้นที่ไม่ได้อยู่จะถูก **unmount** ⇒ component ลูกที่เก็บ state
 *    ในตัวเอง (ตัวสร้างเงื่อนไขผู้รับ · ฟอร์มกฎส่งซ้ำ · ช่องค้นหาในตัวเลือก)
 *    จะโดนล้างค่าทุกครั้งที่เดินผ่าน แล้วผู้ใช้จะเห็นของที่ตั้งไว้หายไปเอง
 *    — อาการเดียวกับบั๊ก "เปิด edit มาแล้วช่องว่าง" ที่ไฟล์โมดัลจดไว้หลายจุด
 *    ซ่อนปลอดภัย ถอดออกไม่ปลอดภัย.
 *    (`FormSection` ข้างในยัง unmount ตอน "พับ" เหมือนเดิม — คนละเรื่องกัน
 *     นั่นคือการกดพับของผู้ใช้เอง ไม่ใช่ผลข้างเคียงของการเดินขั้น)
 *
 * ⚠️ ซ่อนสองชั้นโดยตั้งใจ: `hidden` (attribute จริงของ HTML — jsdom/เทสเห็น)
 *    และคลาส `hidden` ของ Tailwind (เบราว์เซอร์จริงเห็น เพราะ jsdom ไม่โหลด CSS)
 *    เทสในโปรเจ็กต์นี้เคยเขียวทั้งที่ของหายจากจอมาแล้ว เพราะเช็คแค่ทางเดียว
 */
export const BroadcastStepPane: React.FC<BroadcastStepPaneProps> = ({
  stepId,
  activeIndex,
  showAll,
  children,
}) => {
  /* [FEAT-20260907-FLEXPICKREFRESH] The exact same expression, moved into
     `broadcastSteps.ts` because FlexCardPicker has to ask the same question.
     See `isStepVisible` for the reasoning. */
  const visible = isStepVisible(stepId, activeIndex, showAll);
  return (
    <div
      data-testid={`wizard-pane-${stepId}`}
      data-step-visible={visible ? 'yes' : 'no'}
      hidden={!visible}
      className={visible ? '' : 'hidden'}
    >
      {children}
    </div>
  );
};

export interface BroadcastStepNavProps {
  readonly activeIndex: number;
  /** ซ่อนปุ่มเดินขั้นตอนตอนกาง "แสดงทุกขั้นตอน" — ไม่มีขั้นให้เดินแล้ว */
  readonly showAll: boolean;
  readonly onBack: () => void;
  readonly onNext: () => void;
}

/**
 * ปุ่มคู่ ย้อนกลับ / ต่อไป — "ปุ่มใหญ่ชัดเจน" ตามที่สั่ง (`px-8 py-3 text-base`)
 *
 * ⚠️ ขั้นสุดท้าย **ไม่มี "ต่อไป"** — ที่ตรงนั้นคือปุ่ม "ยืนยัน" เดิมของฟอร์ม
 *    (โจทย์: ห้ามเพิ่มปุ่มบันทึกใบที่สาม) · ปุ่มยืนยันยังยิง `handleSubmit`
 *    ตัวเดิม ⇒ ชั้นยืนยันสองจังหวะ (ConfirmModal) ยังครบเหมือนเดิมทุกโหมด
 */
export const BroadcastStepNav: React.FC<BroadcastStepNavProps> = ({
  activeIndex,
  showAll,
  onBack,
  onNext,
}) => {
  const { t } = useI18n();
  if (showAll) return null;
  return (
    <>
      <button
        type="button"
        name="wizard_back"
        data-testid="wizard-back"
        onClick={onBack}
        disabled={activeIndex <= 0}
        className={WIZARD_BACK_CLASS}
      >
        <ChevronLeft size={20} aria-hidden />
        {t('broadcast.wizard_back')}
      </button>
      {activeIndex < LAST_STEP && (
        <button
          type="button"
          name="wizard_next"
          data-testid="wizard-next"
          onClick={onNext}
          className={WIZARD_NEXT_CLASS}
        >
          {t('broadcast.wizard_next')}
          <ChevronRight size={20} aria-hidden />
        </button>
      )}
    </>
  );
};
