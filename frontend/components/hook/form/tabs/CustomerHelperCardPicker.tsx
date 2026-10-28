/**
 * [MOVE-20261018-HELPERPICKER] The OA form's customer-helper card picker — AI tab → Training
 * Doc → step "การช่วยตอบข้อมูล API". Moved verbatim out of `HookAiTab.tsx` (the file is over
 * the 400-line ratchet), the same shape as `SiteRulesToAiBlock.tsx`: reads `ctx`, owns no state.
 *
 * [FEAT-20261018-HELPERWORLD] Owner 18/10/2026: "ซ่อนการ์ดสำหรับ loan". The card is part of
 * the provider's `register` world (it invites the customer to connect data through a minted
 * landing link); a provider that silences that world (loan) has no landing to send anyone to,
 * so the picker is not offered. The BE decides per section ([FEAT-20261018-SCREENSECTIONS] —
 * world `register`, or named by the provider). Absent / shop-api / route failed or not answered
 * yet ⇒ shown.
 * The saved `flex_customerhelper_id` is never touched.
 *
 * revert: paste the block back at the call site in HookAiTab.tsx and delete this file.
 */
import React from 'react';

import { useProviderSectionHidden } from '../../../../hooks/useProviderSectionHidden';
import type { HookFormTabCtx } from './hookFormTabCtx';

export const CustomerHelperCardPicker: React.FC<{ ctx: HookFormTabCtx }> = ({ ctx }) => {
  const { formData, handleChange, isViewMode, t, inputClass, flexTemplates } = ctx;
  const off = useProviderSectionHidden('hook-form.customer-helper-card');
  if (off) return null;
  return (
    <>
    {/* ==== [FEAT-20260810-CUSHELPERTYPE] START — การ์ด customer-helper
        WHAT: การ์ดที่ตอบตอน AI ขึ้น tag [[[customer-helper]]]
        WHY : เดิม hard-code ในโค้ด แก้ข้อความต้อง deploy — ผูกการ์ดแล้ว
              แอดมินแต่งเองได้จากหน้า Flex Messages
        ⚠️ ไม่เลือก = ใช้การ์ดสำรอง hard-code เหมือนเดิม (seamless)
        ⚠️ รายการที่เลือกได้ = flex ที่อยู่ในกลุ่มตามสิทธิ (BE กรองให้ตอน list)
           **และ** type = customerhelper — ตรงนี้จึงกรองเฉพาะ type
           BE ตรวจซ้ำอีกชั้นตอนส่งจริง (การ์ดต้องอยู่กลุ่มเดียวกับ OA)
        revert: ลบบล็อกนี้ + flex_customerhelper_id ใน default/load/submit/tab-map */}
    <div>
      <label className="block text-sm font-medium text-slate-500 mb-1">
        {t('hook_form.flex_customerhelper_id')}
      </label>
      <select
        disabled={isViewMode}
        name="flex_customerhelper_id"
        value={formData.flex_customerhelper_id || ''}
        onChange={handleChange}
        className={inputClass(false, 'bg-white')}
      >
        <option value="">{t('common.none')}</option>
        {flexTemplates
          .filter(tpl => tpl.flex_type === 'customerhelper')
          .map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
      </select>
      <p className="mt-1 text-xs text-slate-500/80">
        {t('hook_form.flex_customerhelper_id_hint')}
      </p>
    </div>
    {/* ==== [FEAT-20260810-CUSHELPERTYPE] END */}
    </>
  );
};
