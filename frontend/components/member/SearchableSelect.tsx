import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, ChevronDown, Star, Check } from 'lucide-react';
import { useI18n } from '../../i18n';

/**
 * ==== [FEAT-20260731-CONTACTS] START — ไฟล์ใหม่ (ย้ายโค้ดมา ไม่ได้เขียนใหม่)
 * 🔒 งานสาย AUTO — to_dev_auto / to_prod_auto เท่านั้น
 *
 * dropdown ที่มีช่องค้นหาในตัว — เดิมอยู่ใน pages/TicketChat.tsx ไม่ได้ export
 *
 * หน้า Contacts ต้องใช้ตัวเดียวกันสำหรับเลือกกลุ่ม/OA (โจทย์สั่งว่า "selectoption
 * สวยๆ + search") · ก็อปไปอีกชุด = สอง dropdown ที่หน้าตาเริ่มเพี้ยนจากกันวันใดวันหนึ่ง
 * จึงย้ายออกมาไว้ที่เดียว ให้ทั้งสองหน้า import เหมือนกรณีการ์ดข้อมูลลูกค้า
 *
 * MOVED VERBATIM — ต่างจากเดิมแค่เติม `export` กับแก้ path ของ import
 * สไตล์ยังผูกกับ .tc scope เหมือนเดิมทุกคลาส (ห้ามแก้ ไม่งั้นหน้า ticket เพี้ยน)
 *
 * revert: ย้ายกลับเข้า TicketChat.tsx ตำแหน่งเดิม แล้วลบไฟล์นี้ + import 2 หน้า
 * ==== [FEAT-20260731-CONTACTS] END
 */

// ── SearchableSelect — a prettier dropdown with a built-in search box. ────────
// Replaces the native <select> for OA / category / group pickers. Styling lives
// in the .tc scope (light + dark) so it matches the chat palette in both themes.
/* [FEAT-20260903-TABNAMEGLOW] `isNameGlow` tints the option's NAME, and is a
   SEPARATE question from `isNew`, which colours the count pill. The two are not
   interchangeable: the pill's number counts รอรับเคส, while the name answers
   "a message arrived". Both are optional and default to off, so every other
   SearchableSelect in the app renders exactly as before. */
export type SelOpt = { value: string; label: string; count?: number; isNew?: boolean; isNameGlow?: boolean };
export const SearchableSelect: React.FC<{
  value: string;
  options: SelOpt[];
  onChange: (v: string) => void;
  placeholder?: string;   // shown when value === '' (the "all" state)
  searchPlaceholder?: string;
  className?: string;
  align?: 'left' | 'right';
  // Optional favourite-star column (slider overflow only). isFav(value) →
  // rendered filled; clicking calls onToggleFav(value,label) without picking.
  isFav?: (v: string) => boolean;
  onToggleFav?: (v: string, label: string) => void;
  /* [FEAT-20260903-TABNAMEGLOW] tint the TRIGGER's own label when a collapsed
     option has a new message. Opt-in and default off, so the other 10 call sites
     render byte-identically. ⚠️ Not the same thing as the `tc-select-new` ring
     the caller may also pass through `className`: that ring follows the count
     rule, this follows the message rule, and they can be on at different times. */
  triggerNameGlow?: boolean;
  /* [UI-20260814-FILTERMENUFONT] Font size of the OPEN MENU only.
     Owner, 14/08: the three ticket-page filters must render 20% larger text
     once the dropdown is open.

     ⚠️ Why an opt-in prop instead of just changing the default in this file:
        this component has 11 call sites (TicketChat 8 · Contact 3). Editing the
        default would restyle every dropdown in the app when only 3 were asked
        for — and nothing would fail, since it is "just a CSS class".
     ⇒ Omitting the prop yields text-xs exactly as before (a true no-op).

     Scope: menu text only (search box · option rows · the empty-state line).
            The closed trigger button stays text-xs — growing it would change the
            filter row height and crowd the 3-column grid.
     revert: delete this prop, then drop `menuTextClass` from the 3 call sites
             in TicketChat.tsx. */
  menuTextClass?: string;
}> = ({ value, options, onChange, placeholder, searchPlaceholder, className = '', align = 'left', isFav, onToggleFav, triggerNameGlow = false, menuTextClass = 'text-xs' }) => {
  /* [FEAT-20261022-I18NTICKETEN] the defaults follow the UI language (th text unchanged) */
  const { t } = useI18n();
  const allLabel = placeholder ?? t('ticketui.member.select_all', 'ทั้งหมด');
  const searchLabel = searchPlaceholder ?? t('ticketui.member.select_search', 'ค้นหา...');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = options.find(o => o.value === value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter(o => o.label.toLowerCase().includes(s)) : options;
  }, [q, options]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  return (
    <div ref={rootRef} className={`tc-select relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="tc-select-trigger w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs font-semibold text-left transition-colors"
        title={selected?.label || allLabel}
      >
        {/* [FEAT-20260903-TABNAMEGLOW] the collapsed groups have no visible name
            of their own, so the trigger's label stands in for all of them. */}
        <span className={`truncate ${triggerNameGlow ? 'tc-unread-text' : ''}`}>{selected ? selected.label : allLabel}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`tc-select-menu absolute z-50 mt-1 w-full min-w-[180px] rounded-xl border shadow-lg overflow-hidden flex flex-col max-h-[min(360px,60vh)] ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="tc-select-search flex items-center gap-1.5 px-2.5 py-2 border-b shrink-0">
            <Search size={13} className="shrink-0 opacity-60" />
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={searchLabel}
              className={`w-full bg-transparent border-none outline-none ${menuTextClass} placeholder:opacity-50`}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-1">
            {filtered.length ? filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => pick(o.value)}
                className={`tc-select-opt w-full flex items-center gap-2 px-3 py-1.5 ${menuTextClass} text-left transition-colors ${o.value === value ? 'tc-select-opt-active font-bold' : ''}`}
              >
                {/* [FEAT-20260729-FAVGATE] รายการใน dropdown ไม่ใช่ tab ที่ active
                    → ห้ามติดดาวจากตรงนี้ แสดงดาวเฉพาะตัวที่ติดไว้แล้ว (กดเพื่อ
                    เอาออกได้เสมอ) ตัวที่ไม่มีดาวใส่ spacer กันคอลัมน์เบี้ยว
                    revert: render ดาวทุกแถวแบบเดิม */}
                {onToggleFav && (isFav?.(o.value) ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onToggleFav(o.value, o.label); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleFav(o.value, o.label); } }}
                    className="shrink-0 p-0.5 rounded-full hover:bg-black/10"
                  >
                    <Star size={13} className="fill-yellow-400 text-yellow-400" />
                  </span>
                ) : (
                  <span className="shrink-0 p-0.5" aria-hidden="true"><Star size={13} className="opacity-0" /></span>
                ))}
                {!onToggleFav && <Check size={13} className={`shrink-0 ${o.value === value ? 'opacity-100' : 'opacity-0'}`} />}
                {/* [FEAT-20260903-TABNAMEGLOW] the NAME carries the "new message"
                    signal; the count pill below is untouched. */}
                <span className={`truncate flex-1 ${o.isNameGlow ? 'tc-unread-text' : ''}`}>{o.label}</span>
                {/* per-choice count + yellow when that group has new (0 → hidden) */}
                {(o.count ?? 0) > 0 && (
                  <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${o.isNew ? 'tc-unread-badge' : 'bg-gray-200 text-gray-600'}`}>
                    {o.count}
                  </span>
                )}
              </button>
            )) : (
              <div className={`px-3 py-2 ${menuTextClass} opacity-50`}>{t('ticketui.member.select_empty', 'ไม่พบรายการ')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
