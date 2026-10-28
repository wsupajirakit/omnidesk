/**
 * ==== [FIX-20261014-CUSTOOLUNGATE] the OA's Custom Tool binding — extracted from HookFormModal.tsx ====
 *
 * WHAT: the "Custom Tool (ปลายทาง + credential + path)" box — on/off switch + tool picker. It
 * used to render ONLY inside the Customer Link box's enabled branch, so an OA had to switch
 * Customer Link on just to bind a tool. The back end never couples the two: a hook uses a tool
 * when `custom_tool_status && custom_tool_id` (BE `webhook.service.ts` usesCustomTool). The
 * loan site needs exactly that — data from a tool, no registration through chat (its register
 * world is off, BE `LOAN_V1_FEATURES`).
 *
 * WHERE IT RENDERS (HookFormModal): unchanged inside the Customer Link box when Customer Link
 * is ON — byte-identical markup, pinned by a snapshot taken on the old code — and under the
 * "ปิดอยู่" note when it is OFF. Same precedent as `[FEAT-20260809-PAYUNGATE]`.
 *
 * ⚠️ JSX COPIED VERBATIM — class strings and element order are the inline version's. State
 * stays in the parent: this receives values and calls back, it owns nothing.
 *
 * Original note: URL / creds / path ทุกเส้น ย้ายไปอยู่ในตาราง custom_tools แล้ว (จัดการที่เมนู
 * Custom Tools) · OA แค่ติ๊กว่าจะใช้ tool ตัวไหน → 1 tool ใช้ได้หลาย OA · JWT ผูกกับ tool ·
 * ความสัมพันธ์เก็บทางเดียวที่ hook.custom_tool_id (ไม่มีสำเนาที่ tool) [FEAT-20260729-CUSTOOL]
 *
 * [FEAT-20261018-EXTAPICARDS] owner 18/10/2026: now its OWN card at the Customer Link card's level,
 * placed BEFORE it, foldable (open by default), white in the light theme — `ExtApiFoldCard`.
 * Same switch, same select, same callbacks: the saved fields did not change.
 *
 * revert: paste this JSX back inside the Customer Link enabled branch (after Web Code), with
 * the original `formData`/`setFormData`/`isViewMode`/`customToolOptions`/`inputClass(false)`
 * expressions, drop the OFF-branch render, delete this file.
 */
import React from 'react';
import { Terminal } from 'lucide-react';

import { ExtApiFoldCard } from './ExtApiFoldCard';
import { useI18n } from '../../../i18n';

import type { CustomToolEntry } from '../../../services/hook/customToolService';

export const CustomToolBindingSection: React.FC<{
  status: boolean;
  toolId: string | null;
  options: CustomToolEntry[];
  disabled: boolean;
  /** the parent's `inputClass(false)` — passed in so the select keeps the form's exact style */
  selectClassName: string;
  onStatusChange: (on: boolean) => void;
  onToolChange: (id: string | null) => void;
}> = ({ status, toolId, options, disabled, selectClassName, onStatusChange, onToolChange }) => {
  // `tr`, not `t`: the option map below names each tool `t`
  const { t: tr } = useI18n();
  return (
    <ExtApiFoldCard
      icon={<Terminal className="text-indigo-600" size={20} />}
      title={<h5 className="font-bold text-slate-800">{tr('pageui.hookform.ctool_title', 'Custom Tool (ปลายทาง + credential + path)')}</h5>}
      right={
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            disabled={disabled}
            checked={status}
            onChange={e => onStatusChange(e.target.checked)}
            className="w-4 h-4 accent-indigo-600"
          />
          <span className="text-[11px] font-black text-indigo-700">{tr('pageui.hookform.ctool_enable', 'เปิดใช้ tool')}</span>
        </label>
      }
    >

      <select
        disabled={disabled}
        value={toolId || ''}
        onChange={e => onToolChange(e.target.value || null)}
        className={selectClassName}
      >
        <option value="">{tr('pageui.hookform.no_tool_selected', '— ยังไม่เลือก tool —')}</option>
        {options.map(t => (
          <option key={t.id} value={t.id}>
            {t.name} · {t.base_url} {tr('pageui.hookform.ctool_routes', '({n} เส้น)', { n: t.endpoints.length })}
          </option>
        ))}
      </select>

      {status && !toolId && (
        <p className="mt-2 text-[11px] font-bold text-amber-700">
          {tr('pageui.hookform.ctool_on_no_tool', '⚠️ เปิดใช้แล้วแต่ยังไม่ได้เลือก tool — จะยิงปลายทางไม่ได้')}
        </p>
      )}
      <p className="mt-2 text-[11px] text-indigo-900/70">
        {tr('pageui.hookform.ctool_hint_a', 'สร้าง/แก้ tool ได้ที่เมนู')} <b>Custom Tools</b> {tr('pageui.hookform.ctool_hint_b', '· เลือกแล้วได้ทุก endpoint ในนั้น')}{' '}
        {tr('pageui.hookform.ctool_hint_c', '(เลือกทีละ path ไม่ได้ เพราะ login ต้องมาคู่กับเส้นที่ใช้ JWT)')}
      </p>
    </ExtApiFoldCard>
  );
};
