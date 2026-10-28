/**
 * ==== [FEAT-20260810-MODALSHELL] START — the one dialog shell every modal borrows
 * 🔒 AUTO track — dev branch
 *
 * WHY THIS EXISTS
 * 52 files in this repo hand-roll the same dialog chrome: overlay, centring,
 * panel, header with a title and an X, a scrolling body, a bordered footer.
 * That is ~40-80 lines of pure markup per modal, repeated, and it is the single
 * largest duplication block measured in the codebase (jscpd, 2026-08-10).
 * This component owns that chrome so a new modal writes its content and nothing
 * else. โครง modal ซ้ำกัน 52 ไฟล์ — ย้ายมาไว้ที่เดียว
 *
 * THE HARD CONSTRAINT: THE RENDERED DOM MUST NOT CHANGE
 * A scan of every overlay in the repo found the class strings are NOT uniform —
 * z-index runs from `z-20` to `z-[9999]`, backgrounds are variously `bg-white/45`,
 * `bg-black/50`, `bg-dark-950/60`, `bg-slate-900/50`, and padding differs. A
 * primitive that hardcoded one look would silently restyle every modal it touched.
 * So every class string here is a DEFAULT that the caller can replace verbatim
 * (`overlayClassName`, `panelClassName`, `className`). Adoption is meant to be a
 * byte-for-byte swap, never a "let's make them all look alike" pass.
 *
 * VARIANTS — AND THE BAR FOR ADDING ONE
 * The same scan found the repo does not have one shell, it has FAMILIES. Two are
 * large enough to be worth naming, and they are recorded in `CHROME` below:
 *   `panel` — the `components/bulk/*` dialogs; slate panel, `z-[90]` backdrop.
 *   `form`  — five dialogs in `components/admin/` and `components/campaign/`
 *             whose overlay string is identical character for character and whose
 *             panel differs only by its `max-w-*` token.
 * A variant is added ONLY when at least three files already share the exact
 * string. One-off chrome passes `overlayClassName`/`panelClassName` instead — a
 * variant per dialog would just be the duplication again, wearing a prop name.
 * เกณฑ์: ต้องมี ≥3 ไฟล์ใช้สตริงเดียวกันอยู่แล้ว ถึงจะตั้งเป็น variant ได้
 *
 * WHAT THIS DELIBERATELY DOES *NOT* DO
 * No focus trap, no Escape-to-close, no body scroll lock, no `role="dialog"`.
 * Those are the right thing for a dialog and the reason headless libraries exist —
 * but adding them here would change behaviour on 52 screens in the same commit
 * that was supposed to change nothing. They are a follow-up with its own
 * before/after run. ไม่ใส่ a11y ตอนนี้ เพราะจะกลายเป็นเปลี่ยนพฤติกรรม ไม่ใช่ย้ายโครง
 *
 * REVERT
 * Delete this file and restore the inline markup in each adopting file — every
 * adoption is one self-contained diff, so a single modal can be reverted without
 * touching the others.
 * ==== [FEAT-20260810-MODALSHELL] END
 */
import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { X } from 'lucide-react';

import { useBodyScrollLock } from './useBodyScrollLock';

export type ModalVariant = 'panel' | 'form';

/**
 * Every string below is copied verbatim from the dialogs that already render it,
 * including class ORDER — Tailwind does not care about order but a DOM snapshot
 * does, and byte-equality is what proves an adoption changed nothing.
 * ลอกสตริงมาทั้งดุ้นรวมลำดับ เพราะ snapshot เทียบทีละไบต์
 */
/* [UI-20260825-LOCKHEIGHT] ความสูงโมดัลถูก **ล็อก** ไม่ใช่ `max-h` อีกแล้ว
 * ─────────────────────────────────────────────────────────────────────────────
 * เจ้าของ 25/08: *"lock ความสูง modal ไม่งั้นมันกินขอบ · lock modal สูงทุก ๆ หน้า"*
 *
 * 🔴 ปัญหาของ `max-h`: กล่องยืดตามเนื้อหา ⇒ โมดัลเตี้ยเมื่อเนื้อหาน้อย พอกาง
 *    dropdown ที่อยู่ใกล้ขอบล่าง เมนูจะล้นออกนอกกล่องแล้วโดนตัด · และความสูงที่
 *    เปลี่ยนไปมาระหว่างขั้นของวิซาร์ดทำให้ปุ่มล่างขยับใต้มือผู้ใช้
 * ⇒ ล็อกเป็น `h-[90vh]` / `h-[86vh]` ⇒ ทุกหน้าสูงเท่ากัน ปุ่มอยู่ที่เดิมเสมอ และ
 *   เมนูที่กางลงมีที่ว่างคาดเดาได้ (คู่กับ `[UI-20260825-DROPUP]` ที่เปิดขึ้นบน
 *   เมื่อข้างล่างยังไม่พอ)
 * ⚠️ กระทบ dialog ทุกตัวโดยตั้งใจ — เจ้าของสั่งว่า "ทุก ๆ หน้า"
 * revert: เปลี่ยน `h-[90vh]` / `h-[86vh]` กลับเป็น `max-h-` ทั้งสองที่
 */
const CHROME: Record<
  ModalVariant,
  {
    overlay: string;
    panel: (maxWidth: string) => string;
    header: string;
    title: string;
    close: string;
    closeSize: number;
    /** `panel` dialogs title with an h2, `form` dialogs with an h3 — kept as-is
     *  rather than unified, because changing a heading level changes the DOM. */
    TitleTag: 'h2' | 'h3';
  }
> = {
  panel: {
    overlay: 'fixed inset-0 z-[90] flex items-center justify-center overscroll-contain p-4 bg-slate-900/50 backdrop-blur-sm',
    panel: (mw) =>
      `w-full ${mw} h-[86vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl`,
    header: 'flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700',
    title: 'font-black text-slate-800 dark:text-slate-100',
    close: 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
    closeSize: 18,
    TitleTag: 'h2',
  },
  form: {
    /* [FIX-20260829-BGSCROLLCHAIN] `overscroll-contain` — the page behind a dialog
       must not move, and locking `body` does not achieve that here.
       ───────────────────────────────────────────────────────────────────────
       This app's scroller is `<main class="flex-1 overflow-y-auto">` in
       `App.tsx`, NOT `<body>`, and `Modal` is not portalled — the overlay sits
       inside that `<main>`. So when the overlay reaches its own scroll end the
       browser hands the rest of the delta to `<main>`, a path the `body` lock in
       `useBodyScrollLock` never touches. That is why the 28/08 lock did not fix
       the reported symptom. `overscroll-behavior: contain` stops the hand-off at
       this container, whichever ancestor would otherwise have received it.
       ⚠️ The `body` lock stays — it is right for a page that really does scroll
          the document, and dropping it would open that case instead.

       [FIX-20260828-FORMSCROLLREACH] `items-start` + `my-auto` — NEVER
       `items-center` + `my-8`, however tidy that reads.
       🔴 `items-center` on a box that scrolls pushes a too-tall child's TOP EDGE
          above the scroll origin. A browser cannot scroll to a negative offset,
          so that strip is unreachable, not merely hidden.
       🔴 It fires on ordinary laptops — measured, not guessed:
              overlay offers  100vh - 2rem  (`p-4`)
              panel wants      90vh + 4rem  (`h-[90vh]` + `my-8`)
              overflows when   6rem > 10vh  ⇒  viewport shorter than 960px
       `my-auto` keeps the panel visually centred while there is room and gives
       the space back when there is not, so the top edge never leaves reach.
       📌 Same bug, same fix, already proven on `BroadcastRunDetailModal` (26/08,
          `[FIX-20260826-RUNMODALSCROLL]`) — applied to that one dialog only, so
          the six dialogs on this shared chrome kept it until now.

       Locked by `test/modalNoBackgroundScroll.dom.test.tsx` and
       `test/modalFormScrollReach.dom.test.tsx`.
       revert: restore `items-center` / `my-8` and drop `overscroll-contain`. */
    overlay:
      'fixed inset-0 z-50 flex items-start justify-center overscroll-contain p-4 w-screen h-screen bg-white/45 backdrop-blur overflow-y-auto !m-0',
    panel: (mw) =>
      `bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full ${mw} my-auto flex flex-col h-[90vh]`,
    header:
      'flex justify-between items-center p-5 border-b border-dark-700 sticky top-0 bg-dark-800 z-10 rounded-t-xl',
    title: 'text-xl font-semibold text-slate-900',
    close: 'text-slate-500 hover:text-slate-900 transition-colors',
    closeSize: 20,
    TitleTag: 'h3',
  },
};

/** The variant travels by context so a caller writes it once on <Modal> instead of
 *  repeating it on every slot — and so a slot can never disagree with its panel. */
const VariantContext = React.createContext<ModalVariant>('panel');

interface ModalProps {
  isOpen: boolean;
  /** Which chrome family this dialog belongs to — see the note above `CHROME`. */
  variant?: ModalVariant;
  /** Tailwind width token, inserted verbatim into the variant's panel template so
   *  the final class string matches the hand-written one exactly. */
  maxWidth?: string;
  /** Full replacement for the overlay classes — use when the dialog needs its own
   *  z-index or backdrop rather than a family default. */
  overlayClassName?: string;
  /** Full replacement for the panel classes, bypassing `maxWidth`. */
  panelClassName?: string;
  /**
   * Rendered inside the overlay but OUTSIDE the panel, after it.
   *
   * Several dialogs (UserFormModal, BroadcastFormModal) mount a nested
   * AlertModal/ConfirmModal as a SIBLING of the panel rather than a child of it.
   * Folding those into `children` would reparent them — a real DOM change, and one
   * a class-string assertion would not catch because the classes stay the same.
   * They render `null` while closed, so a snapshot taken in the resting state
   * cannot prove the open case either; this slot removes the question instead of
   * arguing about it. อย่าย้ายลูกไปอยู่ใต้ panel — ให้ที่ยืนเดิมไปเลย ปลอดภัยกว่าเถียงกับเทส
   */
  afterPanel?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Renders nothing when closed — same guard the inline versions used, kept here so
 * callers do not each repeat `if (!isOpen) return null`.
 */
const ModalRoot: React.FC<ModalProps> = ({
  isOpen,
  variant = 'panel',
  maxWidth = 'max-w-lg',
  overlayClassName,
  panelClassName,
  afterPanel,
  children,
}) => {
  /* [UI-20260828-BGSCROLLLOCK] พื้นหลังต้องไม่เลื่อนตอนโมดัลกางอยู่
     ⚠️ ต้องอยู่ **เหนือ** `if (!isOpen) return null` — hook เรียกใต้ early return ไม่ได้
        จึงส่ง `isOpen` เข้าไปเป็นเงื่อนไขแทนที่จะครอบด้วย if
     ⚠️ แก้ที่ตัวกลาง ไม่ใช่ที่ฟอร์มบรอดแคสต์ใบเดียว — 10 โมดัลใช้ตัวนี้ร่วมกัน
        และ "พื้นหลังเลื่อนได้ตอนโมดัลเปิด" เป็นบั๊กเหมือนกันหมดทุกใบ */
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;
  const chrome = CHROME[variant];

  return (
    <VariantContext.Provider value={variant}>
      <div className={overlayClassName ?? chrome.overlay}>
        <div className={panelClassName ?? chrome.panel(maxWidth)}>
          {children}
        </div>
        {afterPanel}
      </div>
    </VariantContext.Provider>
  );
};

interface HeaderProps {
  title: React.ReactNode;
  onClose: () => void;
  /**
   * Optional controls rendered between the title and the X — a header-level
   * save for a long form, so the primary action is reachable without scrolling
   * to the footer. Renders nothing when omitted, so every existing header keeps
   * its exact markup.
   *
   * ⚠️ Do NOT put a cancel here: the X already closes the dialog, and two
   * controls that do the same thing side by side only make the operator pause.
   */
  actions?: React.ReactNode;
  /** Dialogs that must not be dismissed from the corner (mid-write, confirming)
   *  drop the X rather than rendering a dead one. */
  hideClose?: boolean;
  className?: string;
}

const ModalHeader: React.FC<HeaderProps> = ({ title, onClose, hideClose = false, className, actions }) => {
  const chrome = CHROME[React.useContext(VariantContext)];
  const TitleTag = chrome.TitleTag;
  return (
    <div className={className ?? chrome.header}>
      <TitleTag className={chrome.title}>{title}</TitleTag>
      {actions}
      {!hideClose && (
        <button onClick={onClose} className={chrome.close}>
          <X size={chrome.closeSize} />
        </button>
      )}
    </div>
  );
};

/** The scrolling middle. `flex-1` + `overflow-y-auto` is what keeps a long body
 *  from pushing the footer buttons off-screen.
 *
 * [UI-20260825-SCROLLHINT] ลูกศรบอกว่ายังเลื่อนลงได้
 * ─────────────────────────────────────────────────────────────────────────────
 * เจ้าของ 25/08: *"modal ถ้ามี scroll ลงล่างได้ให้ guide arrow บอก"*
 *
 * 🔴 ปัญหาจริง: ฟอร์มยาวที่ถูกตัดพอดีขอบล่างดูเหมือนจบแล้ว ⇒ คนกดบันทึกโดยไม่รู้
 *    ว่ายังมีช่องข้างล่างอีก · โมดัลนี้ไม่มีเงาหรือขอบบอกเลย
 * ⚠️ **สองทาง** ตามที่เจ้าของสั่ง 25/08: ลูกศรลงโผล่เมื่อยังเลื่อนลงได้ หายเมื่อถึง
 *    ล่างสุด · ลูกศรขึ้นโผล่เมื่อเลื่อนขึ้นได้ หายเมื่อถึงบนสุด
 *    ลูกศรที่ค้างอยู่ตลอดจะกลายเป็นของประดับที่ไม่มีใครเชื่อ
 * ⚠️ `pointer-events-none` เพราะมันเป็นป้ายบอกทาง ไม่ใช่ปุ่ม · ห้ามไปบังการคลิก
 *    ของช่องกรอกที่อยู่ใต้มัน
 * ⚠️ **ห้ามห่อ div เพิ่ม** — ลองแล้วครั้งหนึ่ง snapshot ของ dialog 5 ตัวแดงทันที
 *    เพราะโครงของโมดัลกลางเปลี่ยนไปทั้งแอป · ใช้ `sticky` ในกล่องเลื่อนเดิมแทน
 * ⚠️ วัดใหม่ทุกครั้งที่เลื่อนและตอน mount · เผื่อเนื้อหาโตทีหลัง (เช่นกางการ์ด)
 *    ก็ใช้ ResizeObserver ถ้าเบราว์เซอร์มี — ไม่มีก็ยังทำงานได้จากการเลื่อน
 * revert: ลบ state/effect/ตัวลูกศร แล้วคืน <div> บรรทัดเดียวแบบเดิม
 */
const ModalBody: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [hint, setHint] = React.useState<{ up: boolean; down: boolean }>({ up: false, down: false });

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      /* เผื่อ 4px กันเศษทศนิยมของความสูงจริง ไม่งั้นลูกศรจะกระพริบตอนถึงสุด */
      setHint({
        up: el.scrollTop > 4,
        down: el.scrollHeight - el.scrollTop - el.clientHeight > 4,
      });
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, []);

  const pill =
    'pointer-events-none sticky z-10 flex justify-center';
  const badge =
    'flex items-center rounded-full bg-slate-900/70 px-2.5 py-1 text-white shadow-lg backdrop-blur-sm animate-bounce';

  return (
    <div
      ref={ref}
      className={className ?? 'flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4'}
    >
      {/* 🔴 อยู่ **ใน** กล่องเลื่อน ไม่ได้ห่อ div เพิ่ม — ห่อเพิ่มจะเปลี่ยนโครงของ
          dialog ทุกตัวในแอป (ลองแล้ว snapshot 5 เคสแดงพร้อมกัน) ⇒ ใช้ `sticky`
          ซึ่งเกาะขอบของกล่องเลื่อนได้โดยไม่แตะโครง
          ⚠️ ไม่มีอะไรให้เลื่อน = ไม่ render เลย ⇒ dialog เนื้อหาสั้น markup เดิมเป๊ะ */}
      {hint.up && (
        <div data-testid="modal-scroll-hint-up" aria-hidden className={`${pill} top-0 -mb-2`}>
          <span className={badge}>
            <ChevronUp size={13} aria-hidden />
          </span>
        </div>
      )}
      {children}
      {hint.down && (
        <div data-testid="modal-scroll-hint" aria-hidden className={`${pill} bottom-0 -mt-2`}>
          <span className={badge}>
            <ChevronDown size={13} aria-hidden />
          </span>
        </div>
      )}
    </div>
  );
};

/** Footer layout varies per dialog (some right-align a button row, some stack a
 *  confirmation block), so only the border and padding are shared. */
const ModalFooter: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <div
    className={`px-5 py-4 border-t border-slate-200 dark:border-slate-700${className ? ` ${className}` : ''}`}
  >
    {children}
  </div>
);

export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
});

export default Modal;
