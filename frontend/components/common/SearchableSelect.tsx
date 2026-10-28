/**
 * ==== [FEAT-20260806-SEARCHSELECT] SearchableSelect ====
 * A pretty single-select dropdown with a search box. Drop-in replacement for a plain <select>
 * where the option list is long. Theme matches the app (dark-* tokens = light surfaces here).
 *
 * Usage: <SearchableSelect value={v} onChange={setV} options={[{value,label}]} placeholder="…" />
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, Check, X } from 'lucide-react';
import { useI18n } from '../../i18n';

export interface SelectOption { value: string; label: string; hint?: string }

/**
 * ==== [FEAT-20260817-SELECTROWS] taller menu + wrapping labels, BOTH opt-in ====
 *
 * Owner, 17/08: "Select option หน้า webhook log + audit log + slip ต้องเป็น select
 * แบบมี search + wrap ความยาว 15 แถว wrap scroll".
 *
 * ⚠️ WHY PROPS AND NOT NEW DEFAULTS: this component is used across the app (webhook
 * logs, handoff history, assign history, group picker, insight tabs…). Changing
 * `max-h-60` or dropping `truncate` here would resize and re-flow every one of
 * those menus while the owner asked for three pages — and nothing would fail,
 * because it is "only a CSS class". Same lesson the sibling component's spec
 * records for `menuTextClass` ([UI-20260814-FILTERMENUFONT]).
 * ค่า default ต้องเท่าเดิมเป๊ะ ใครไม่ส่ง prop ต้องไม่รู้สึกอะไรเลย.
 *
 * revert: delete the two props and their two usages below.
 */
/** One option row at the list's fixed `px-3 py-2 text-sm` metrics (20px line + 8+8 padding). */
const OPTION_ROW_PX = 36;

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;       // width/extra on the trigger button
  clearable?: boolean;      // show an X to reset to ''
  disabled?: boolean;
  size?: 'sm' | 'md';
  /**
   * [FEAT-20260817-SELECTROWS] visible rows before the menu scrolls. Omit to keep
   * the original `max-h-60` (~6 rows). Measured on the unwrapped row height, so
   * `maxRows={15}` is "about fifteen lines tall, then scroll".
   */
  maxRows?: number;
  /** [FEAT-20260817-SELECTROWS] long labels wrap instead of being cut with "…". */
  wrapLabel?: boolean;
  /**
   * [UI-20260826-DROPDIR] กางเมนู**ขึ้นบน**แทนที่จะลงล่าง · ค่าเริ่มต้นคือลงล่าง
   *
   * 🔴 ต้องขอเอง ห้ามเป็นค่าเริ่มต้น — ดูเหตุผลเต็มที่บล็อก [UI-20260826-DROPDIR]
   *    ใต้ `menuRef` · สั้น ๆ คือ: มีจุดเดียวที่ขอ แต่เคยไปแก้ที่ค่าเริ่มต้น
   *    ทั้งแอปจึงพลิกตามโดยไม่มีใครสั่ง
   *
   * ใส่เมื่อไหร่: ตัวเลือกอยู่**เหนือตารางยาว** หรืออยู่ใกล้ขอบล่างของกล่องที่ตัด
   * (โมดัลที่มี `overflow-y-auto`) ⇒ กางลงแล้วทับของที่มันกรอง หรือตกขอบ
   */
  dropUp?: boolean;
}

/* [FEAT-20260907-FLEXPICKREFRESH → removed 07/09] An `onOpen?: () => void` prop
   lived here for a few hours. Its ONLY caller was `campaign/flex/FlexCardPicker`,
   which reloaded the card library when the menu opened — and later the same day
   that picker stopped using this component entirely ([FEAT-20260907-FLEXGALLERY]
   replaced its dropdown with a gallery modal). A prop on a shared component with
   no caller is debt: it has to be read, kept working and tested by everyone who
   touches this file, in exchange for nothing. Removed the moment it went unused.
   If a second picker ever needs it, the shape is in this commit's history. */

export const SearchableSelect: React.FC<Props> = ({
  value, onChange, options, placeholder: placeholderProp, className = '', clearable = false, disabled = false, size = 'md',
  maxRows, wrapLabel = false, dropUp = false,
}) => {
  const { t } = useI18n();
  const placeholder = placeholderProp ?? t('pageui.common.select_ph', 'เลือก…');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  /* [UI-20260826-PORTALMENU] เมนูถูกย้ายไป render ที่ `document.body`
     ─────────────────────────────────────────────────────────────────────────
     🔴 ทำไมไม่ใช่แค่ยก z-index: กล่องแม่บางใบมี `zoom` (แถวตัวกรองในแผงประวัติ
        ใช้ `zoom: 1.15`) ซึ่ง **สร้าง stacking context ใหม่** ⇒ z-index ของเมนู
        ถูกขังอยู่ในนั้น ยกเป็นเท่าไหร่ก็ไม่มีวันข้ามแถบบนของแอปได้
        ยก z-50 → z-[70] มาแล้วรอบหนึ่งและยังถูกบังอยู่ นั่นคือหลักฐาน
     ⇒ ย้ายออกไปนอกทุก context แล้ววางด้วย `position: fixed` จากพิกัดจริงของปุ่ม
     ⚠️ ปิดเมื่อคลิกนอก ต้องนับ "ในเมนู" ด้วย เพราะเมนูไม่ได้เป็นลูกของกล่องนี้แล้ว
     revert: ลบ `menuRef`/`pos`/`createPortal` แล้วคืนเมนูกลับเข้ามาใน `<div ref={ref}>` */
  /* [UI-20260826-DROPDIR] ทิศทางเป็นของ **แต่ละที่** ไม่ใช่ของคอมโพเนนต์
     ═════════════════════════════════════════════════════════════════════════
     เจ้าของ 26/08 พร้อมภาพ 5 ใบ: *"มันต้องลงข้างล่างไม่ใช่ขึ้นข้างบนแบบนี้ ·
     ระวังไปขนหน้าที่ให้ขึ้นบน · เฉพาะหน้า boardcast ที่ให้ขึ้นข้างบน"*

     🔴 นี่คือ**หนี้ออกแบบ ไม่ใช่บั๊กตรรกะ** — จำรูปนี้ไว้ให้ดี:
        `021a8ac` (26/08 00:01) ทำถูกตามที่ถูกสั่ง คือให้ "ตัวเลือกแคมเปญหน้า
        ประวัติ" กางขึ้นบน · แต่ไปแก้ที่ **ค่าเริ่มต้นของคอมโพเนนต์**
        ⇒ call site 31 จุดใน 15 ไฟล์พลิกขึ้นบนตามไปด้วย ทั้งที่มีจุดเดียวที่ขอ
        หน้าที่ไม่มีใครสั่งอะไรเลย (handoff · webhook logs · assign · chat ·
        audit · slip) เปลี่ยนพฤติกรรมเงียบ ๆ แล้วเจ้าของมาเจอเองทีหลัง
        👉 บทเรียน: คำสั่งที่มาจากจอ **จอเดียว** ห้ามลงที่ค่าเริ่มต้นของของกลาง
           รูปเดียวกับที่ `[FEAT-20260817-SELECTROWS]` เขียนเตือนไว้ข้างบนแล้ว
           (`maxRows`/`wrapLabel` เป็น prop ด้วยเหตุผลนี้เป๊ะ ๆ) — รอบนั้นทำถูก
           รอบนี้พลาด · อ่านคำเตือนที่มีอยู่แล้วก่อนแก้ของกลางเสมอ

     ── ใครใช้อะไร (26/08) ──────────────────────────────────────────────────
       ขึ้นบน (ส่ง `dropUp`) — ทั้งหมดเป็นของ broadcast เท่านั้น 4 จุด:
         · `campaign/history/BroadcastRunHistoryPanel.tsx` ตัวเลือกแคมเปญ
              เหนือตารางยาว = จุดที่ 021a8ac สั่งมาแต่แรก
         · `pages/messaging/Broadcasts.tsx`               แถวตัวกรอง (zoom 1.15)
              รูปเดียวกัน เหนือตารางยาวเหมือนกัน
         · `campaign/audience/AudienceRuleBuilder.tsx`    ตัวเลือกเงื่อนไขในโมดัล
         · `campaign/flex/FlexCardPicker.tsx`             ตัวเลือกการ์ดในโมดัล
              ⚠️ สองตัวในโมดัล **เกิดหลัง** 021a8ac จึงไม่เคยกางลงเลยสักครั้ง
                 การเปลี่ยนเป็นลงล่าง = เปลี่ยนของที่ไม่มีใครสั่ง จึงคงไว้
       ลงล่าง (ไม่ต้องส่งอะไร) — ที่เหลือทั้งหมด รวมสามหน้าที่เจ้าของส่งภาพมา

     ── จะเพิ่มที่ใหม่ทำยังไง ────────────────────────────────────────────────
       1. ไม่ต้องส่งอะไร = ลงล่าง · ถูกต้องสำหรับตัวเลือกเกือบทุกตัว
       2. ใส่ `dropUp` เมื่อ **ของมันอยู่เหนือตารางยาว** (กางลงแล้วทับแถวที่มัน
          กำลังกรอง) หรือ **ใกล้ขอบล่างของกล่องที่ตัด** (โมดัลที่มี overflow-y-auto)
       3. เพิ่มบรรทัดใน `MUST_DROP_UP` / `MUST_DROP_DOWN` ที่
          `test/searchableSelectDropDirection.dom.test.tsx` พร้อมเหตุผล
          ⇒ ใครมาลบทีหลังจะแดงทันที ไม่ใช่ไปเจอเอาตอนเจ้าของเปิดจอ

     ⚠️ ทำไมไม่วัดที่ว่างเอาเอง (auto): เคยทำแล้วโดนโยนทิ้งใน 021a8ac —
        มันคำนวณว่าข้างล่างพอ จึงไม่เคยพลิก และเจ้าของต้องสั่งซ้ำหลายรอบ
        · ฝั่ง broadcast มีตัววัดของตัวเองแล้ว (`campaign/pickers/dropDirection.ts`
          `shouldDropUp` ที่วัดกับ **กล่องที่ตัดจริง** ไม่ใช่ขอบจอ) ถ้าวันหลัง
          อยากได้ auto ที่นี่ ให้ **reuse ตัวนั้น** อย่าเขียนตัววัดใบที่สาม
     revert: ลบ prop `dropUp` + `dropUp ?` สองที่ข้างล่าง แล้วคืนเป็น `bottom` เสมอ */
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<
    { left: number; width: number; top: number; bottom?: undefined }
    | { left: number; width: number; bottom: number; top?: undefined }
    | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value) || null;
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    return options.filter(o => o.label.toLowerCase().includes(t) || o.value.toLowerCase().includes(t) || (o.hint || '').toLowerCase().includes(t));
  }, [q, options]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    const t = setTimeout(() => inputRef.current?.focus(), 30);

    /* วางเมนูจากพิกัดจริงของปุ่ม — ยึดคนละขอบตามทิศทาง [UI-20260826-DROPDIR]
       · ขึ้นบน: `bottom` นับจากขอบล่างจอ ⇒ ขอบล่างเมนูติดขอบบนปุ่ม แล้วโตขึ้นไป
       · ลงล่าง: `top` = ขอบล่างปุ่ม ⇒ ขอบบนเมนูอยู่ใต้ปุ่ม แล้วโตลงมา
       ⚠️ ยึด**ขอบเดียว** เสมอ ห้ามใส่ทั้งคู่ — ใส่สองขอบพร้อมกันจะกลายเป็นการ
          บังคับความสูง เมนูจะยืดเต็มช่องแทนที่จะสูงตามจำนวนตัวเลือก */
    const place = () => {
      const el = ref.current;
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      const r = el.getBoundingClientRect();
      setPos(
        dropUp
          ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
          : { left: r.left, width: r.width, top: r.bottom + 4 },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      clearTimeout(t);
    };
  }, [open]);

  const pad = size === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen(o => !o);
        }}
        className={`w-full flex items-center gap-2 rounded-lg border border-dark-600 bg-dark-800 px-3 ${pad} text-left text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors ${open ? 'ring-2 ring-primary-500' : ''}`}>
        <span className={`flex-1 truncate ${selected ? '' : 'text-slate-400'}`}>{selected ? selected.label : placeholder}</span>
        {clearable && value && !disabled && (
          <X size={14} className="text-slate-400 hover:text-slate-600 shrink-0" onClick={(e) => { e.stopPropagation(); onChange(''); }} />
        )}
        <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          data-drop-up={dropUp ? 'yes' : 'no'}
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            /* ขอบเดียวเท่านั้น — ตัวที่ไม่ได้ใช้เป็น `undefined` ⇒ React ไม่เขียนลง style */
            top: pos.top,
            bottom: pos.bottom,
            zIndex: 2147483000,
          }}
          className="min-w-[12rem] rounded-lg border border-dark-600 bg-white shadow-xl shadow-black/10 overflow-hidden"
        >
          <div className="p-2 border-b border-dark-600 sticky top-0 bg-white">
            <div className="relative">
              <Search size={14} className="text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder={t('pageui.common.search_ph', 'ค้นหา…')}
                className="w-full pl-8 pr-2 py-1.5 rounded-md border border-dark-600 bg-dark-800 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
          {/* [FEAT-20260817-SELECTROWS] no maxRows ⇒ the original max-h-60 class, byte-identical */}
          <div
            className={`overflow-y-auto py-1 ${maxRows ? '' : 'max-h-60'}`}
            style={maxRows ? { maxHeight: maxRows * OPTION_ROW_PX } : undefined}
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">{t('pageui.common.no_option', 'ไม่พบตัวเลือก')}</div>
            ) : filtered.map(o => {
              const on = o.value === value;
              return (
                <button key={o.value || '__empty'} type="button"
                  onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${on ? 'bg-primary-500/10 text-primary-700 font-bold' : 'text-slate-700 hover:bg-slate-100'}`}>
                  <span className={`flex-1 ${wrapLabel ? 'whitespace-normal break-words' : 'truncate'}`}>{o.label}</span>
                  {o.hint && <span className="text-[10px] text-slate-400 font-mono shrink-0">{o.hint}</span>}
                  {on && <Check size={14} className="text-primary-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default SearchableSelect;
