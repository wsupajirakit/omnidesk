/**
 * [FEAT-20260825-BCASTFOLD] การ์ดในฟอร์มบรอดแคสต์ พับได้ทุกใบ
 * ===========================================================================
 * เจ้าของ 25/08: *"ปรับ ui ด้วย ทุก card พับได้ group div นั้น ๆ"* ·
 * *"ทุกอย่างให้พับไว้ กดเซฟแล้ว validate modal เด้งเลย ค่าไหนที่ต้องกรอก"*
 *
 * 🔴 พับแล้วต้องไม่ซ่อนความผิดพลาด — นี่คือเหตุผลที่มี `forceOpen`
 *    ถ้าพับการ์ดที่มีช่องกรอกผิดไว้ แล้วกดเซฟ แอดมินจะเห็นแค่ "เซฟไม่ได้"
 *    โดยไม่รู้ว่าต้องไปแก้ตรงไหน ⇒ ตอน validate ไม่ผ่าน พ่อแม่จะสั่งกางการ์ด
 *    ที่มี error ออกเองทุกใบ · ป้ายนับ error ก็ยังโชว์ตอนพับอยู่ด้วย
 *    พับได้ แต่ห้ามพับจนมองไม่เห็นว่าอะไรผิด.
 *
 * ⚠️ เนื้อในถูก **unmount** ตอนพับ ไม่ใช่แค่ `hidden` — เพื่อให้ "ปิดอยู่จริง"
 *    เป็นสิ่งที่เทสจับได้ และไม่ให้ช่องที่มองไม่เห็นแอบ re-render อยู่เบื้องหลัง
 *    ⚠️ แปลว่า state ของช่องกรอกต้องอยู่ที่พ่อแม่ (formData) ซึ่งฟอร์มนี้ทำอยู่แล้ว
 *    ถ้าวันหนึ่งมี component ลูกที่เก็บ state ในตัวเอง การพับจะล้างค่ามันทิ้ง
 *
 * ⚠️ ไม่ใช้ `<details>` เพราะต้องคุมการกางจากข้างนอก (ตอน validate ไม่ผ่าน)
 *    ซึ่ง `<details>` ทำได้ยากและ toggle ของมันไม่ผ่าน React state
 *
 * revert: ลบไฟล์นี้ แล้วเปลี่ยน `<FormSection …>` กลับเป็น `<div className="rounded-xl …">`
 * พร้อม `<h4>` เดิม — ไม่มีอะไรอื่นอ้างถึงมัน
 */
import React from 'react';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';

/**
 * [UI-20260828-NOFOLD] ONE SWITCH: are the broadcast form's cards foldable at all?
 * ===========================================================================
 * Owner, 28/08: "take the fold arrows out of every div in the broadcast
 * create/edit modal". Rather than editing six call sites (and six more to put
 * them back), the behaviour is decided here, once.
 *
 *   false — today. Every card renders the always-open header: no button, no
 *           chevron, nothing to collapse. The card body is always mounted.
 *   true  — the previous behaviour: each card is a button with a chevron, folded
 *           by default, opened by `defaultOpen` / `revealOn` / an error.
 *
 * CHANGING YOUR MIND IS THIS ONE LINE. Nothing else has to move: every prop that
 * only matters while folding (`defaultOpen`, `revealOn`, and the auto-open
 * effects for `errorCount`) is deliberately LEFT IN PLACE and still wired, so
 * flipping this back restores the old behaviour exactly, with no call-site edits
 * and no dead code to resurrect. `alwaysOpen` also still works on its own, for
 * the two cards that were already pinned open before this switch existed.
 *
 * ⚠️ What does NOT change when this is `false`: the red error badge still shows
 * on a card with invalid fields — the reason folding was allowed to exist in the
 * first place was that it must never hide a mistake, and an always-open card
 * hides even less.
 *
 * ⚠️ Scope is exactly this component, and `FormSection` is imported only by the
 * broadcast form tree (`BroadcastFormModal`, `broadcastSteps`,
 * `BroadcastStepper`) — verified 28/08. No other form can be affected by this
 * line, which is why it was safe to put the switch here instead of at the call
 * sites.
 */
export const BROADCAST_SECTIONS_COLLAPSIBLE = false;

export interface FormSectionProps {
  /** [FEAT-2708-GRIDPICK] กางตลอด — ไม่มีปุ่มพับ ไม่มี chevron (งาน 5.3 ใช้กับ
   *  การ์ดกลุ่มเว็บ/LINE OA เท่านั้น) · ไม่ส่ง = พฤติกรรมเดิมทุกตัวอักษร */
  alwaysOpen?: boolean;
  readonly title: string;
  /** เปิดไว้ตอนแรกไหม — เจ้าของสั่งให้ "พับไว้" ⇒ ค่าเริ่มต้นคือปิด */
  readonly defaultOpen?: boolean;
  /**
   * จำนวนช่องที่กรอกผิดในการ์ดนี้ · `> 0` จะบังคับกางและโชว์ป้ายแดง
   *
   * ⚠️ เป็น "จำนวน" ไม่ใช่ boolean — แอดมินอยากรู้ว่าเหลือกี่ช่อง ไม่ใช่แค่ว่ามีหรือไม่มี
   */
  readonly errorCount?: number;
  /**
   * [UI-20260825-WIZARD] "ตอนนี้การ์ดใบนี้คือขั้นที่ผู้ใช้ยืนอยู่"
   *
   * 🔴 WHY: พอฟอร์มกลายเป็นวิซาร์ด หนึ่งขั้นเห็นการ์ดใบเดียว — ถ้าเดินมาถึงขั้นนั้น
   *    แล้วเจอการ์ด **พับอยู่** ผู้ใช้จะเห็นแค่หัวข้อเปล่า ๆ แล้วต้องกดอีกทีทุกขั้น
   *    ⇒ พอกลายเป็นขั้นที่ active ให้กางให้เอง
   *
   * ⚠️ ทำไมไม่ไปตั้ง `defaultOpen` ให้ทุกใบแทน — เพราะ `defaultOpen` แปลว่า
   *    "กางตั้งแต่ mount" ซึ่งเป็นคำสั่งคนละข้อของเจ้าของ (25/08: ซ้าย+สถานะการส่ง
   *    กางไว้ · ที่เหลือพับไว้) และมีเทสปักไว้สามที่ · ตัวนี้กางตอน **เดินมาถึง**
   *    ไม่ใช่ตอนเปิดฟอร์ม ⇒ ค่าเริ่มต้นของทุกใบยังเป็นค่าเดิมเป๊ะ ไม่ต้องพลิกเทสใคร
   *
   * ⚠️ กางให้ครั้งเดียวต่อการ "เดินมาถึง" ไม่ใช่ล็อกเปิด — ผู้ใช้ยังกดพับเองได้
   *    ตามคำสั่งเดิม (กติกาเดียวกับ `errorCount` ด้านบน)
   */
  readonly revealOn?: boolean;
  readonly rightAction?: React.ReactNode;
  readonly testId: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export const FormSection: React.FC<FormSectionProps> = ({
  title,
  defaultOpen = false,
  errorCount = 0,
  revealOn = false,
  rightAction,
  testId,
  children,
  className = '',
  alwaysOpen = false,
}) => {
  /* [UI-20260828-NOFOLD] `locked` = this card cannot be folded, either because
     the caller pinned it open or because folding is switched off form-wide. */
  const locked = alwaysOpen || !BROADCAST_SECTIONS_COLLAPSIBLE;
  const [open, setOpen] = React.useState(defaultOpen);

  /**
   * 🔴 มี error เมื่อไหร่ กางทันที และ "จำ" ว่ากางแล้ว
   *
   * ใช้ effect ไม่ใช่ `open || errorCount > 0` ตอน render เพราะถ้าคำนวณสด ๆ
   * แอดมินจะ **พับการ์ดที่ยังผิดอยู่ไม่ได้เลย** — มันจะเด้งกางกลับทุกครั้ง
   * แบบนี้คือกางให้ครั้งเดียวตอนเจอ error แล้วปล่อยให้เขาคุมต่อเอง
   * เด้งกางให้ครั้งเดียว ไม่ใช่ล็อกไว้ไม่ให้พับ.
   */
  React.useEffect(() => {
    if (errorCount > 0) setOpen(true);
  }, [errorCount]);

  /**
   * [UI-20260825-WIZARD] เดินมาถึงขั้นนี้ = กางให้
   *
   * รูปแบบเดียวกับ effect ของ `errorCount` ข้างบนเป๊ะ และด้วยเหตุผลเดียวกัน:
   * ถ้าคำนวณสด ๆ ตอน render (`open || revealOn`) ผู้ใช้จะ **พับการ์ดของขั้นที่
   * ตัวเองยืนอยู่ไม่ได้เลย** — มันจะเด้งกางกลับทุกครั้ง
   * ⚠️ dependency เป็น `revealOn` ⇒ ยิงตอนค่ามันเปลี่ยนเท่านั้น
   *    (เดินออกไปขั้นอื่นแล้วเดินกลับมา = กางให้ใหม่ ซึ่งคือสิ่งที่ต้องการ)
   */
  React.useEffect(() => {
    if (revealOn) setOpen(true);
  }, [revealOn]);

  return (
    <div
      className={`rounded-xl border bg-dark-900/40 ${
        errorCount > 0 ? 'border-red-500/60' : 'border-dark-700'
      } ${className}`}
      data-testid={testId}
    >
      {locked ? (
        /* [FEAT-2708-GRIDPICK] Always-open header — not a button, no chevron.
           [UI-20260828-NOFOLD] every card takes this branch while folding is off. */
        <div className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-700">{title}</span>
            {rightAction}
          </div>
          {errorCount > 0 && (
            <span
              className="flex items-center gap-1 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-400"
              data-testid={`${testId}-error-count`}
            >
              <AlertCircle size={13} aria-hidden />
              {errorCount}
            </span>
          )}
        </div>
      ) : (
      <div
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="flex items-center gap-2"
          data-testid={`${testId}-toggle`}
        >
          {open ? (
            <ChevronDown size={18} className="shrink-0 text-slate-700" aria-hidden />
          ) : (
            <ChevronRight size={18} className="shrink-0 text-slate-700" aria-hidden />
          )}
          <span className="text-sm font-semibold text-slate-700">{title}</span>
        </button>

        <div className="flex items-center gap-2">
          {rightAction}
          {errorCount > 0 && (
            <span
              className="flex items-center gap-1 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-400"
              data-testid={`${testId}-error-count`}
            >
              <AlertCircle size={13} aria-hidden />
              {errorCount}
            </span>
          )}
        </div>
      </div>
      )}

      {/* Folded = the body is not rendered at all — see the file header for why.
          [UI-20260828-NOFOLD] `locked` cards are always rendered. */}
      {(locked || open) && (
        <div
          className="flex flex-col gap-4 px-4 pb-4"
          data-testid={`${testId}-body`}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default FormSection;
