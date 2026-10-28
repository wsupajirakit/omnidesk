/**
 * [FEAT-2708-GRIDPICK] (งาน 5.3) ตาราง checkbox กางตลอด — แทน dropdown
 * ===========================================================================
 * เจ้าของ 27/08: step 3 กลุ่มเว็บ + step 4 LINE OA *"ไม่ต้องกาง select option
 * อีก ให้ออกมาเป็นตาราง 2x2 แล้วไล่ติ๊กง่ายๆ มีปุ่มเลือกทั้งหมด และปุ่มยกเลิก"*
 *
 * นี่คือพี่น้องร่าง "กางแบน" ของ `MultiCheckSelect` — **contract ค่าเดียวกันเป๊ะ**
 * (`values`/`onChange(next: string[])`/`options`) ⇒ ฟอร์มสลับตัว render โดย
 * `setAssignGroupIds`/`setHookIds` + cascade `pruneHookIds` ไม่ถูกแตะสักบรรทัด
 *
 * ⚠️ เลือกทั้งหมด/ยกเลิก กระทำเฉพาะ **แถวที่แสดง** (union / subtract กับผลค้น) —
 *    สัญญาเดียวกับเมนูเดิมคำต่อคำ (ดูหัวไฟล์ MultiCheckSelect): สองปุ่มต้องเป็น
 *    inverse ของกันเสมอ และห้ามแตะแถวที่ผู้ใช้มองไม่เห็นอยู่
 * ⚠️ กลุ่มจริงใน DB ~100 แถว ⇒ กรอบ scroll (`max-h`) จำเป็น ไม่ใช่ของประดับ
 * ⚠️ ช่องค้นหาคงไว้ทั้งที่โจทย์ไม่ได้สั่ง — 100 แถวไล่ตาหายาก และมันไม่ขัด
 *    "ไล่ติ๊กได้เลย" (ตารางโชว์ครบตั้งแต่แรก ค้นแค่ช่วยหา)
 *
 * revert: คืนสองจุดใช้ใน BroadcastFormModal เป็น `MultiCheckSelect` + ลบไฟล์นี้
 */
import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { useI18n } from '../../../i18n';
import type { MultiCheckOption } from './MultiCheckSelect';
import { GRID_ROW_PICKED, GRID_ROW_TINT } from './gridColumnTint';

export interface MultiCheckGridProps {
  values: readonly string[];
  onChange: (next: string[]) => void;
  options: readonly MultiCheckOption[];
  loading?: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /** Prefix for every `data-testid` this renders. */
  testId: string;
}

/** ~11 แถวกริด (22 ตัวเลือก) ก่อนเริ่ม scroll — เห็นเยอะพอไล่ตา ไม่กินทั้งจอ */
const GRID_MAX_HEIGHT = '22rem';

export const MultiCheckGrid: React.FC<MultiCheckGridProps> = ({
  values,
  onChange,
  options,
  loading = false,
  loadingLabel,
  emptyLabel,
  disabled = false,
  testId,
}) => {
  const { t } = useI18n();
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        (o.hint ?? '').toLowerCase().includes(needle),
    );
  }, [options, q]);

  const picked = useMemo(() => new Set(values), [values]);

  const toggle = (value: string) => {
    if (disabled) return;
    onChange(
      picked.has(value) ? values.filter((v) => v !== value) : [...values, value],
    );
  };

  /* union-with-shown / subtract-shown — inverse คู่กันเสมอ (สัญญาเดิม) */
  const selectShown = () => {
    if (disabled) return;
    const union = new Set(values);
    for (const o of shown) union.add(o.value);
    onChange([...union]);
  };
  const clearShown = () => {
    if (disabled) return;
    const drop = new Set(shown.map((o) => o.value));
    onChange(values.filter((v) => !drop.has(v)));
  };

  return (
    <div data-testid={testId} className="rounded-xl border border-dark-600 bg-white/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={`${testId}-select-all`}
          onClick={selectShown}
          disabled={disabled || loading}
          className="rounded-lg border border-primary-500/40 bg-primary-500/10 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-500/20 disabled:opacity-50"
        >
          {t('common.select_all')}
        </button>
        <button
          type="button"
          data-testid={`${testId}-clear`}
          onClick={clearShown}
          disabled={disabled || loading}
          className="rounded-lg border border-dark-600 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          {t('broadcast.grid_clear')}
        </button>
        <span className="relative ml-auto min-w-[10rem] flex-1 sm:flex-none">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="text"
            data-testid={`${testId}-search`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('broadcast.picker_search')}
            disabled={disabled}
            className="w-full rounded-lg border border-dark-600 py-1.5 pl-8 pr-2 text-xs"
          />
        </span>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-slate-500">{loadingLabel ?? '…'}</p>
      ) : shown.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500" data-testid={`${testId}-empty`}>
          {emptyLabel ?? '-'}
        </p>
      ) : (
        <div
          className="custom-scrollbar mt-3 overflow-y-auto pr-1"
          style={{ maxHeight: GRID_MAX_HEIGHT }}
        >
          {/* 2 คอลัมน์ตามสั่ง — จอแคบพับเหลือ 1 เพื่อไม่บีบป้ายจนอ่านไม่ออก */}
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2" data-testid={`${testId}-grid`}>
            {shown.map((o) => (
              <label
                key={o.value}
                /* [FEAT-2708-GRIDROWS] เส้นแบ่งทุกแถว — เจ้าของ 27/08: สองคอลัมน์
                   ติดกันจนแยกไม่ออกว่าบรรทัดไหนคู่กับโดเมนไหน
                   [UI-20260828-GRIDSIDES] + พื้นสีอ่อนโทนเดียวทุกแถว (ดู gridColumnTint.ts)
                   ⚠️ `hover` มาจากคลาสสีนั้น ห้ามใส่ hover:bg-slate-100 กลับมา
                      เทาจะลบสีพื้นทิ้งตอนเมาส์ชี้พอดี */
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${GRID_ROW_TINT} ${
                  picked.has(o.value) ? GRID_ROW_PICKED : ''
                } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  data-testid={`${testId}-opt-${o.value}`}
                  checked={picked.has(o.value)}
                  onChange={() => toggle(o.value)}
                  disabled={disabled}
                  className="h-4 w-4 shrink-0 accent-primary-500"
                />
                {/* [UI-20260828-HINTINLINE] โดเมนต่อท้ายชื่อ ไม่ใช่ชิดขวา
                    เจ้าของ 28/08: *"ย้ายชื่อโดเมนไปต่อท้ายชื่อ hook เลย"*
                    🔴 เดิม `ml-auto` ดันโดเมนไปติดขอบขวาสุด ⇒ ชื่อ OA สั้น ๆ กับโดเมน
                       ของมันห่างกันเกือบเต็มคอลัมน์ ตาต้องกระโดดข้ามที่ว่างไปอ่าน
                       แล้วเดาเอาว่าอันไหนคู่กับอันไหน — ยิ่งสองคอลัมน์ยิ่งสลับกันง่าย
                    ⚠️ ข้อความในวงเล็บประกอบมาจาก **ผู้เรียก** ไม่ใช่ที่นี่ — กริดตัวนี้
                       ใช้ทั้ง "LINE OA" (hint = โดเมน) และ "กลุ่มเว็บ" (ไม่มี hint เลย)
                       ถ้าเขียนคำว่า "อยู่ในเว็บ" ลงตรงนี้ วันที่มีคนส่ง hint ที่ไม่ใช่
                       โดเมนมา ข้อความจะโกหกทันที ⇒ ที่นี่วาดแค่ `(…)` รอบสิ่งที่ได้มา */}
                <span className="min-w-0 truncate text-slate-800">
                  {o.label}
                  {o.hint && (
                    <span className="ml-1 text-xs font-normal text-slate-500">({o.hint})</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
