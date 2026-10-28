import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * [UI-20260825-DIRSELECT] ตัวเลือกที่ "เปิดขึ้นบนได้"
 * ============================================================================
 * เจ้าของ 25/08: *"แก้ให้ select option หน้านี้เปิดขึ้นข้างบน มันตกขอบล่าง
 * ให้สองอันเลย"* — คือช่อง "จำนวนต่อหน้า" ของ `TablePager` ซึ่งอยู่ล่างสุดของ
 * หน้าประวัติ และถูกใช้สองที่ (ตารางบรอดแคสต์ + ตารางประวัติ) = "ทั้งสอง select"
 *
 * 🔴 ทำไมต้องเขียนเอง: `<select>` มาตรฐานให้ **เบราว์เซอร์** เป็นคนวาดเมนู
 *    CSS บังคับทิศทางไม่ได้เลย · จะควบคุมได้ต้องวาดเมนูเอง
 *
 * ⚠️ **ยังมี `<select>` จริงซ่อนอยู่ข้างใน** ไม่ได้ถอดทิ้ง เพราะ:
 *    · เทสเดิมอ่าน `HTMLSelectElement.options` และใช้ `fireEvent.change` —
 *      ถ้าถอดออก เทสที่พิสูจน์ว่า "ตัวเลือกมาจากทะเบียนเท่านั้น" จะพังทั้งชุด
 *      ทั้งที่ของไม่ผลสุทธิ
 *    · ฟอร์มบนมือถือและเครื่องอ่านหน้าจอยังได้ตัวเลือกมาตรฐานเหมือนเดิม
 *    ⇒ `<select>` คือแหล่งความจริง · เมนูที่วาดเองเป็นแค่หน้าตา และเรียก
 *      `onChange` ตัวเดียวกัน ไม่มีสถานะซ้อน
 *
 * ⚠️ ทิศทางถูกวัด **ตอนกดเปิด** ไม่ใช่บังคับขึ้นบนเสมอ — บังคับขึ้นบนจะทำให้
 *    แถวที่อยู่ครึ่งบนของโมดัลโดนขอบบนตัดแทน คือย้ายปัญหา ไม่ใช่แก้
 *
 * revert: ลบไฟล์นี้แล้วเปลี่ยน `<DirectionalSelect>` กลับเป็น `<select>` ธรรมดา
 *         ใน `TablePager.tsx` (props ชื่อเดียวกันหมด)
 */

export interface DirectionalOption {
  readonly value: string;
  readonly label: string;
}

export interface DirectionalSelectProps {
  readonly name: string;
  readonly value: string;
  readonly options: readonly DirectionalOption[];
  readonly onChange: (next: string) => void;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly title?: string;
}

/** ความสูงสูงสุดของเมนู ใช้ตัดสินว่าข้างล่างพอไหม — ตรงกับ `max-h-56` (14rem) */
const MENU_MAX_PX = 224;

export const DirectionalSelect: React.FC<DirectionalSelectProps> = ({
  name,
  value,
  options,
  onChange,
  className,
  disabled = false,
  title,
}) => {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = boxRef.current;
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    setDropUp(below < MENU_MAX_PX && above > below);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={boxRef} className="relative">
      {/* แหล่งความจริง — ซ่อนจากสายตาแต่ยังอยู่ใน DOM เต็มรูปแบบ */}
      <select
        name={name}
        /* ⚠️ testid อยู่บน `<select>` ตัวจริง ไม่ใช่ปุ่ม — เทสเดิมคาดว่าจะได้
           `HTMLSelectElement` กลับไป (อ่าน `.options` และยิง `fireEvent.change`)
           ถ้าย้าย testid ไปไว้ที่ปุ่ม เทส 8 เคสจะพังทั้งที่ของไม่ผลสุทธิ */
        data-testid={name}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        data-testid={`${name}-button`}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((v) => !v)}
        className={`${className ?? ''} flex items-center justify-between gap-2 text-left disabled:opacity-60`}
      >
        <span className="truncate">{current?.label ?? ''}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          data-testid={`${name}-menu`}
          data-drop-up={dropUp ? 'yes' : 'no'}
          className={`absolute z-30 w-full max-h-56 overflow-y-auto rounded-lg border border-dark-700 bg-dark-800 shadow-xl ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-dark-700 ${
                o.value === value ? 'text-primary-600 font-semibold' : 'text-slate-700'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default DirectionalSelect;
