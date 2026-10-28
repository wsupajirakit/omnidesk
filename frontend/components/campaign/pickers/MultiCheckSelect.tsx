/**
 * [FIX-20260824-PICKERSAME] One searchable picker for every multi-choice field.
 * ===========================================================================
 * Owner, 24/08: *"บางอันมี select search อันไม่มี อะไรวะ มั่วมาก"* ·
 * *"เรื่อง select ด้วยมั่วมาก รวมกันสิ ใน page boardcast"* ·
 * *"select option อย่าลืม เลือกทั้งหมดได้ ยกเลิก ได้"*.
 *
 * 🔴 THE COMPLAINT IS ABOUT CONSISTENCY, SO THE FIX IS ONE COMPONENT. The
 *    broadcast form had three different pickers for three lists: the flex card
 *    used the shared searchable combobox, "กลุ่มเว็บ" used a bare `<select>`,
 *    and "LINE OA" + the target-group list used hand-rolled checkbox panels with
 *    no search at all. Fixing them one by one is how they got out of step the
 *    first time. ⇒ both MULTI lists now render this file, and the single list
 *    renders `common/SearchableSelect` — two components, both with a search box,
 *    for the whole page. ตัวเดียวใช้ทุกที่ ไม่งั้นเดี๋ยวก็เพี้ยนอีก.
 *
 * ⚠️ WHY NOT JUST REUSE `common/SearchableSelect`. It is used, for every SINGLE
 *    choice on this page — but its contract is `value: string` / `onChange:
 *    (v: string) => void` and it closes on pick. Multi-select cannot be
 *    expressed through it, and widening that contract would touch the ~20 other
 *    screens that render it (webhook logs, audit log, slip, assign history…).
 *    So this is the MULTI sibling, deliberately wearing the same clothes: same
 *    trigger metrics, same `Search` box, same `Check` mark, same menu chrome.
 *    ไม่ได้เขียน combobox ซ้ำ — อันนั้นเลือกได้ตัวเดียว อันนี้เลือกได้หลายตัว.
 *
 * ⚠️ SELECT-ALL / CLEAR-ALL ACT ON WHAT IS *SHOWN*, not on the whole list. With
 *    an empty search box those are the same thing, which is the plain reading of
 *    the request. With a search term typed, "เลือกทั้งหมด" meaning "also tick
 *    the 200 rows you filtered away" would be a trap that cannot be undone by
 *    looking at the screen. ⇒ union-with-filtered / subtract-filtered, so the
 *    two buttons are always exact inverses of each other.
 *    กดเลือกทั้งหมดตอนค้นหาอยู่ = เลือกเฉพาะที่เห็น.
 *
 * revert: put the two inline checkbox panels back in `BroadcastFormModal` and
 * delete this file — the search box and the two bulk buttons go with it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { clippingRect, shouldDropUp } from './dropDirection';
import { Check, ChevronDown, Search } from 'lucide-react';

import { useI18n } from '../../../i18n';



export interface MultiCheckOption {
  value: string;
  label: string;
  /** Shown greyed at the end of the row — an id, so a broken send can be reported. */
  hint?: string;
}

export interface MultiCheckSelectProps {
  values: readonly string[];
  onChange: (next: string[]) => void;
  options: readonly MultiCheckOption[];
  placeholder: string;
  /** Rendered instead of the rows while the list is still being fetched. */
  loading?: boolean;
  loadingLabel?: string;
  /** Rendered when the fetch finished and there is genuinely nothing to pick. */
  emptyLabel?: string;
  disabled?: boolean;
  /** Full class string for the trigger, so the parent's `inputClass()` stays the
   *  single source of the form's field metrics. */
  triggerClassName?: string;
  /** Prefix for every `data-testid` this renders, and the trigger's `name`. */
  testId: string;
  /** [FEAT-2708-TIERUNLOCK] ยิงทุกครั้งที่เมนูเปิด (false→true) — additive:
   *  ผู้เรียกเดิมไม่ส่ง = พฤติกรรมเดิมทุกไบต์ · TagValuePicker ใช้ refetch
   *  รายการแท็กตามคำสั่ง "เก็ทใหม่ทุกครั้งเวลากด" */
  onOpen?: () => void;
}

/** How many rows the menu shows before it scrolls. Matches the `max-h-48` the
 *  hand-rolled panels used, so the menu did not grow or shrink in this change. */
const MENU_MAX_HEIGHT = '12rem';

/**
 * "A, B +3" — the same two-then-count summary both hand-rolled panels showed.
 * Exported so a test can pin it without opening the menu.
 * ⚠️ Ids with no matching option are dropped from the SUMMARY only, never from
 * the value: an OA that has not finished loading must not look deselected.
 */
export function summariseChoices(
  values: readonly string[],
  options: readonly MultiCheckOption[],
): string {
  if (!values.length) return '';
  const labels = new Map(options.map(o => [o.value, o.label]));
  const named = values.map(v => labels.get(v)).filter(Boolean) as string[];
  if (named.length <= 2) return named.join(', ');
  return `${named.slice(0, 2).join(', ')} +${named.length - 2}`;
}

export const MultiCheckSelect: React.FC<MultiCheckSelectProps> = ({
  values,
  onChange,
  options,
  placeholder,
  loading = false,
  loadingLabel,
  emptyLabel,
  disabled = false,
  triggerClassName = '',
  testId,
  onOpen,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  /* [UI-20260825-DROPUP] เปิดขึ้นบนเมื่อข้างล่างไม่พอ
     ─────────────────────────────────────────────────────────────────────────
     เจ้าของ 25/08: *"select option ที่อยู่ภายใน modal ให้เปิดขึ้นข้างบน"*
     🔴 ไม่ได้บังคับขึ้นบนเสมอ — **วัดที่ว่างจริงตอนกดเปิด** เพราะตัวเลือกที่อยู่
        ครึ่งบนของโมดัลถ้าบังคับเปิดขึ้นบนจะโดนขอบบนตัดแทน กลายเป็นย้ายปัญหา
        ไม่ใช่แก้ปัญหา
     ⚠️ วัดตอน `open` เปลี่ยนเป็น true เท่านั้น ไม่ผูกกับ scroll — รายการที่กาง
        อยู่แล้วไม่ควรกระโดดสลับข้างใต้มือผู้ใช้
     revert: ลบ state นี้ + effect ข้างล่าง + เงื่อนไขคลาสในกล่องเมนู */
  const [dropUp, setDropUp] = useState(false);

  /* Same match rule as the shared combobox: label, value and hint all count, so
     an admin who only remembers the id can still find the row. */
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      o =>
        o.label.toLowerCase().includes(needle) ||
        o.value.toLowerCase().includes(needle) ||
        (o.hint || '').toLowerCase().includes(needle),
    );
  }, [q, options]);

  /* Close on an outside click, and reset the search so the next open starts
     clean — a stale filter looks exactly like "the list lost its rows". */
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  /* [UI-20260825-DROPUP] ตัดสินทิศทางตอนกดเปิด โดยดูที่ว่างใต้ปุ่มเทียบกับความสูง
     สูงสุดของเมนู · ถ้าข้างล่างไม่พอ **และข้างบนพอกว่า** จึงเปิดขึ้น */
  useEffect(() => {
    if (!open) return;
    const el = boxRef.current;
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    /* [FIX-20260826-DROPUPCLIP] 26/08 — เดิมวัดกับ `window.innerHeight` ซึ่งเป็น
       กล่องผิด: เมนูถูกตัดโดยฟอร์มที่มี `overflow-y-auto` ไม่ใช่โดยขอบจอ
       ⇒ จอเหลือที่ (เลยไม่พลิก) แต่ฟอร์มจบไปแล้ว = เมนูโดนกิน ตามภาพที่เจ้าของส่ง
       ถามกล่องที่ตัดจริงจาก DOM แทนการเดา · ไม่มีใครตัด = ตกกลับไปใช้จอเหมือนเดิม */
    setDropUp(
      shouldDropUp({
        trigger: el.getBoundingClientRect(),
        clip: clippingRect(el),
        viewportH: window.innerHeight,
      }),
    );
  }, [open]);

  const chosen = useMemo(() => new Set(values), [values]);

  const toggle = (value: string) => {
    if (disabled) return;
    onChange(chosen.has(value) ? values.filter(v => v !== value) : [...values, value]);
  };

  /* Union with what is on screen — anything filtered away keeps its state. */
  const selectAllShown = () => {
    if (disabled) return;
    const next = [...values];
    for (const o of filtered) if (!chosen.has(o.value)) next.push(o.value);
    onChange(next);
  };

  /* Exact inverse of the button above: subtract what is on screen. */
  const clearAllShown = () => {
    if (disabled) return;
    const shown = new Set(filtered.map(o => o.value));
    onChange(values.filter(v => !shown.has(v)));
  };

  const summary = summariseChoices(values, options);

  return (
    <div ref={boxRef} className="relative" data-testid={`${testId}-box`}>
      <button
        type="button"
        name={testId}
        data-testid={`${testId}-trigger`}
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen(o => {
            if (!o) onOpen?.();
            return !o;
          });
        }}
        disabled={disabled}
        /* [UI-20260828-TRIGGERROW] ปุ่มนี้ต้องเป็นแถวเดียวเสมอ — เจ้าของ 28/08:
           *"หน้าตา select active tag มันไม่สวย"* + *"ทำเป็นแถวเดียว xxxx,xxx +7 พอ"*
           🔴 ต้นเหตุ: layout ของ trigger ถูกปล่อยให้ผู้เรียกเป็นคนใส่ผ่าน
              `triggerClassName` แต่ตัวไฟล์นี้ **วาดลูกสอง span โดยสมมติว่ามี flex**
              ผู้เรียกสองรายในหน้า audience (`TagValuePicker` / `TierValuePicker`)
              ส่งมาแค่ขอบ+สี+ระยะ ไม่มี flex ⇒ สองก้อนตกคนละบรรทัด กลายเป็น
              สรุปแท็กอยู่บรรทัดบน เลขนับ+ลูกศรห้อยอยู่บรรทัดล่าง
           ⇒ **layout เป็นของคอมโพเนนต์ ไม่ใช่ของผู้เรียก** ย้ายมาไว้ที่นี่และวางไว้
             ข้างหน้าเพื่อให้ `triggerClassName` ยังทับได้ถ้าวันหนึ่งมีคนต้องการจริง
           ⚠️ `min-w-0` บนก้อนสรุปคือสิ่งที่ทำให้ `truncate` ทำงาน — flex item
              มีความกว้างขั้นต่ำ = เนื้อหา ถ้าไม่ปลดล็อกมันจะดันปุ่มบานแทนที่จะตัดคำ
           revert: เอาคลาสชุดนี้ออก แล้วปุ่มกลับไปตกบรรทัดเหมือนภาพที่เจ้าของส่ง */
        className={`flex w-full items-center justify-between gap-2 text-left ${triggerClassName}`.trim()}
      >
        <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
          {summary || placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-slate-700" data-testid={`${testId}-count`}>
            {values.length}
          </span>
          <ChevronDown
            size={16}
            className={`text-slate-700 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open && (
        <div
          data-testid={`${testId}-menu`}
          data-drop-up={dropUp ? 'yes' : 'no'}
          className={`absolute z-20 w-full rounded-lg border border-dark-700 bg-dark-800 shadow-xl overflow-hidden ${
            dropUp ? 'bottom-full mb-1' : 'mt-1'
          }`}
        >
          <div className="p-2 border-b border-dark-700 flex flex-col gap-2">
            <div className="relative">
              <Search
                size={14}
                className="text-slate-700 absolute left-2.5 top-1/2 -translate-y-1/2"
              />
              <input
                data-testid={`${testId}-search`}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={t('broadcast.picker_search')}
                className="w-full pl-8 pr-2 py-1.5 rounded-md border border-dark-600 bg-dark-800 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid={`${testId}-select-all`}
                onClick={selectAllShown}
                disabled={disabled}
                className="px-2.5 py-1 rounded-lg border border-primary-500/40 bg-primary-500/10 text-xs font-semibold text-primary-700 hover:bg-primary-500/20 disabled:opacity-60 transition-colors"
              >
                {t('common.select_all')}
              </button>
              <button
                type="button"
                data-testid={`${testId}-clear-all`}
                onClick={clearAllShown}
                disabled={disabled}
                className="px-2.5 py-1 rounded-lg border border-dark-600 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60 transition-colors"
              >
                {t('common.clear_all')}
              </button>
              <button
                type="button"
                data-testid={`${testId}-done`}
                onClick={() => {
                  setOpen(false);
                  setQ('');
                }}
                className="ml-auto px-3 py-1 rounded-lg border border-emerald-500 bg-emerald-50 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                {t('common.ok')}
              </button>
            </div>
          </div>

          <div
            className="overflow-y-auto custom-scrollbar p-3 flex flex-col gap-2"
            style={{ maxHeight: MENU_MAX_HEIGHT }}
          >
            {loading ? (
              <div className="text-xs text-slate-700">{loadingLabel}</div>
            ) : options.length === 0 ? (
              <div className="text-xs text-slate-700">{emptyLabel}</div>
            ) : filtered.length === 0 ? (
              /* 🔴 "nothing matches your search" is a different fact from "this
                 list is empty" — saying the wrong one sends an admin off to
                 create a duplicate OA. ค้นแล้วไม่เจอ ≠ ไม่มีของ. */
              <div className="text-xs text-slate-700" data-testid={`${testId}-no-match`}>
                {t('broadcast.picker_no_match')}
              </div>
            ) : (
              filtered.map(o => {
                const on = chosen.has(o.value);
                return (
                  <label
                    key={o.value}
                    data-testid={`${testId}-option-${o.value}`}
                    className={`flex items-center gap-2 text-sm rounded-md px-1 py-0.5 transition-colors ${
                      on ? 'text-emerald-700 font-semibold' : 'text-slate-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(o.value)}
                      disabled={disabled}
                      className="accent-primary-500"
                    />
                    <span className="flex-1 whitespace-normal break-words">{o.label}</span>
                    {o.hint && (
                      <span className="text-[10px] text-slate-700 font-mono shrink-0">{o.hint}</span>
                    )}
                    {on && <Check size={14} className="text-emerald-600 shrink-0" />}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiCheckSelect;
