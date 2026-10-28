/**
 * [FEAT-20260824-RUNDETAIL] One foldable section of the run-detail modal.
 *
 * Owner 24/08: *"แบ่ง section div พับ เปิดได้สวยๆ"* — so each section keeps its
 * OWN open/closed state and nothing here is an exclusive accordion: opening the
 * conditions must not fold away the counters you were comparing them against.
 *
 * ⚠️ The body is UNMOUNTED when closed rather than hidden with CSS. A closed
 *    section must not leave its text findable by search/assistive tech, which
 *    is what makes "these two sections are separate" observable at all.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  /** Stable id — drives the testids, so it must not be a translated label. */
  id: string;
  title: string;
  /** A short line of context on the header, e.g. a count. */
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const RunSection: React.FC<Props> = ({ id, title, hint, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  /* [FIX-20260826-RUNMODALSCROLL] ทุก section เลื่อนได้ด้วยตัวเอง
     `overflow-x-auto` เพราะตารางในนี้กว้างเกินกรอบได้ (LINE log มี 7 คอลัมน์ และ
     endpoint เป็นสตริงยาว) — เดิมมันไปดันให้ทั้งโมดัลกว้างเกินจอ
     `max-h-[60vh] overflow-y-auto` กัน section เดียวกินพื้นที่ทั้งใบจนหา section
     อื่นไม่เจอ · ตัวเลขต่ำกว่า `max-h-[75vh]` ของกล่องแม่ จึงยังเลื่อนระดับใบได้ปกติ */
  return (
    /* [FIX-20260828-RUNSCROLLNEST] `overflow-hidden` ⇒ `overflow-clip`? ไม่ใช่ —
       เอาออกไปเลย
       🔴 มันมีไว้ให้มุมโค้งไม่ถูกเนื้อหาทับ แต่ผลข้างเคียงคือมัน **ตัดส่วนที่ล้น
          ออกโดยไม่มีทางเลื่อนไปดู** · คู่กับ scroller ซ้อนสามชั้นที่เพิ่งยุบไป
          นี่คือครึ่งหลังของอาการ "เนื้อหาถูกตัดกลางบรรทัด"
       ⇒ ให้ body เป็นตัวจัดการ overflow เองที่เดียว · มุมโค้งยังอยู่เพราะ body
         มี `rounded-b-xl` เป็นของตัวเอง */
    <section
      className="rounded-xl border border-dark-700 bg-dark-900/40"
      data-testid={`run-section-${id}`}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-dark-800/60 transition-colors"
        data-testid={`run-section-${id}-toggle`}
      >
        {open ? (
          <ChevronDown size={16} className="text-primary-400 shrink-0" aria-hidden />
        ) : (
          <ChevronRight size={16} className="text-slate-700 shrink-0" aria-hidden />
        )}
        <span className="text-base font-semibold text-slate-900">{title}</span>
        {hint && <span className="ml-auto text-sm text-slate-700">{hint}</span>}
      </button>
      {open && (
        <div className="custom-scrollbar max-h-[60vh] overflow-x-auto overflow-y-auto rounded-b-xl border-t border-dark-700 px-4 py-3" data-testid={`run-section-${id}-body`}>
          {children}
        </div>
      )}
    </section>
  );
};
