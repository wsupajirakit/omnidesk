/**
 * [UI-20260831-DOCEXPAND] A textarea with its own expand / collapse button.
 * ===========================================================================
 * เจ้าของสั่ง 31/08: กล่อง Training Doc สองใบต้องขยายความสูงได้ **+200% ของเดิม**
 * และย่อกลับได้ · **ปุ่มของใครของมัน** — กดกล่องบนแล้วกล่องล่างต้องไม่ขยับ
 *
 * ── ทำไมเป็นไฟล์แยก ไม่ใช่ useState ใน HookAiTab ────────────────────────────
 * `HookAiTab` ประกาศไว้ที่หัวไฟล์ตัวเองว่า *"Nothing here holds useState"* —
 * state ทั้งหมดอยู่ที่ parent ผ่าน `ctx` เพื่อให้พฤติกรรม re-render เหมือนตอนยัง
 * inline อยู่ใน HookFormModal เป๊ะ ๆ · การเติม `useState` เข้าไปในนั้นคือการผิดคำ
 * ที่ไฟล์นั้นเขียนไว้เอง และเป็นหนี้ที่คนอ่านทีหลังจะไม่รู้ตัว
 * ทางออกคือให้ **ตัวควบคุมถือ state ของตัวเอง**: parent ไม่ต้องรู้ ไม่ต้องส่งอะไรลงมา
 * และ tab ก็ยังไม่มี useState ตามที่ประกาศไว้ (กฎ §6.1 ของ repo: ตัวควบคุมที่จบในตัว
 * แยกไฟล์ตั้งแต่แรก)
 *
 * ⚠️ เป็น state ของ **หน้าจอล้วน** ไม่แตะ formData ⇒ ไม่มีอะไรถูกส่งขึ้น BE และ
 *    การกดปุ่มไม่ทำให้ฟอร์ม dirty
 * ⚠️ ปุ่มเป็น `type="button"` เสมอ — ปุ่มใน <form> ที่ไม่ระบุ type จะกลายเป็น
 *    submit และกดขยายกล่องแล้วฟอร์มจะถูกส่งทันที
 * ⚠️ ไม่ล็อกความสูงเป็น px: ใช้ `rows` เหมือนเดิม เพื่อให้สเกลตามขนาดฟอนต์ของผู้ใช้
 *
 * revert: ลบไฟล์นี้ แล้วเปลี่ยนสองที่ใน HookAiTab กลับเป็น <textarea rows={6}>
 *         พร้อมแถวป้าย tag แบบเดิม
 */
import React from 'react';

/** ขยายแล้วสูงขึ้น 200% ของเดิม = 3 เท่า (เดิม 100% + เพิ่ม 200%) */
export const EXPAND_FACTOR = 3;

interface Props {
  /** แถวป้าย `[START_OF_…]` … `[END_OF_…]` ที่โชว์เหนือกล่อง */
  chips: React.ReactNode;
  /** ความสูงตั้งต้น (จำนวนบรรทัด) — ค่าเดิมของทั้งสองกล่องคือ 6 */
  rows?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** ข้อความปุ่มสองสถานะ — ผู้เรียกส่งมาจาก i18n ตัวคอมโพเนนต์ไม่ผูกภาษา */
  expandLabel: string;
  collapseLabel: string;
  /** ไว้ให้เทสจับปุ่มของกล่องที่ต้องการได้ตรงใบ */
  testId?: string;
}

export const ExpandableTextarea: React.FC<Props> = ({
  chips,
  rows = 6,
  value,
  onChange,
  disabled,
  className,
  placeholder,
  expandLabel,
  collapseLabel,
  testId,
}) => {
  const [tall, setTall] = React.useState(false);
  /* [FIX-20260901-DOCEXPANDDRAG] needed to undo what a manual drag leaves behind */
  const boxRef = React.useRef<HTMLTextAreaElement>(null);

  /**
   * [FIX-20260901-DOCEXPANDDRAG] Dragging the textarea's own resize handle makes
   * the browser write an inline `style.height` onto the element, and an inline
   * height BEATS `rows` — `rows` only decides the height while nothing else has
   * set one. So after a drag the button kept flipping `tall` (the state really
   * did change) while the box never moved, and it read as a dead button.
   * Clearing the inline height here hands control back to `rows`.
   *
   * ⚠️ NOT fixed with `resize-none`: dragging is a thing admins use on these two
   * boxes, and removing it would trade their capability for our convenience.
   * ลากได้เหมือนเดิม แค่ให้ปุ่มมีอำนาจคืน
   *
   * revert: delete `boxRef`, this handler and the `ref`, and put
   * `onClick={() => setTall((v) => !v)}` back on the button.
   */
  const toggle = () => {
    const el = boxRef.current;
    if (el) el.style.height = '';
    setTall((v) => !v);
  };

  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] text-violet-600 select-all">
        {chips}
        <button
          type="button"
          data-testid={testId}
          aria-expanded={tall}
          onClick={toggle}
          /* [UI-20260831-DOCEXPAND] เจ้าของสั่งให้ปุ่มใหญ่ขึ้น 31/08 — จาก
             px-2/py-0.5/11px เป็นขนาดที่กดง่ายจริงบนจอสูง */
          className="ml-auto shrink-0 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 font-sans text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {tall ? collapseLabel : expandLabel}
        </button>
      </div>
      <textarea
        ref={boxRef}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={tall ? Math.round(rows * EXPAND_FACTOR) : rows}
        className={className}
        placeholder={placeholder}
      />
    </>
  );
};
