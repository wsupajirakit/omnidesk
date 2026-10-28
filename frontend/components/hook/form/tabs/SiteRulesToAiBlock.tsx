/**
 * [FEAT-20261018-SITERULESWORLD] The OA form's Site Rules block — the switch "ส่ง Site Rules เข้า AI
 * อัตโนมัติ…" (+ help, "ตัวอย่าง json", auto-inject hint) and the box "กฏการใช้ข้อมูล Site Rules".
 *
 * MOVED VERBATIM from `HookAiTab.tsx` (step "การช่วยตอบข้อมูล API", `docStep === 'flexTag'`) on
 * 18/10/2026 so the provider's site-rules world can decide it here, not by growing a 1,000-line
 * tab. Same `ctx` as every other child of the tab (`AiVendorSelect`, …): values, handlers and
 * modals all stay owned by the form — this file holds no state of its own.
 *
 * The provider's world decides whether the block exists at all: loan_v1 declares `siteRules:
 * false` (its partner has no site rules — legacy legacy-console had none either), so the option is
 * not offered there; the saved values stay untouched in the hook and the BE ignores them anyway.
 * shop-api / any provider that declares nothing / a failed route ⇒ drawn exactly as before.
 *
 * revert (world rule): drop the hook call + the `if (off) return null` line.
 * revert (move): paste the JSX back where `<SiteRulesToAiBlock ctx={ctx} />` renders in
 *         HookAiTab.tsx and delete this file.
 */
import React from 'react';
import { FileJson, HelpCircle } from 'lucide-react';

import { useProviderSectionHidden } from '../../../../hooks/useProviderSectionHidden';
import type { HookFormTabCtx } from './hookFormTabCtx';

export const SiteRulesToAiBlock: React.FC<{ ctx: HookFormTabCtx }> = ({ ctx }) => {
  const {
    formData, setFormData, handleChange, isViewMode, t, inputClass,
    setHelpModal, openSiteRulesExample,
  } = ctx;
  /* [FEAT-20261018-SITERULESWORLD] hidden by the provider ⇒ not offered (loan) — the BE says so
     per section ([FEAT-20261018-SCREENSECTIONS], world `siteRules`) */
  const off = useProviderSectionHidden('hook-form.site-rules');
  if (off) return null;
  return (
    <>
    {/* ==== [MOVE-20260810-SITERULESGUIDE] START — ชุด Site Rules ทั้งก้อน
        Owner order 2026-08-10: the whole Site Rules set moved here, last in the
        Tag-API step. It used to sit at the top of the Training Doc step.
        Moved together, deliberately: the switch, its [ตัวอย่าง json] button, the
        auto-inject hint and the guide input are one control and one explanation —
        splitting them across two steps leaves a greyed-out box whose enabling
        switch is nowhere on screen.
        ⚠️ Markup copied verbatim — no field, no handler, no validation changed.
           `ai_raw_site_rules` / `ai_site_rules_guide` load and save exactly as before.
        revert: ย้ายทั้ง 2 บล็อกนี้กลับไปหัว step trainingDoc (ดู marker ชื่อเดียวกันที่นั่น)
        ย้ายที่วางอย่างเดียว ค่าที่เคยกรอกไว้ไม่กระทบ ==== */}



    {/* [FEAT-20260803-SITERULESEX] สวิตช์ "ส่ง Site Rules เข้า AI"
        ⚠️ ปุ่ม [ตัวอย่าง json] ใช้กลไกเดียวกับฝั่งข้อมูลลูกค้าเป๊ะ (เปิด Blob แท็บใหม่)
           ไม่ได้ทำ modal ชุดใหม่ซ้อน — เพิ่มแค่ "ก้อนข้อมูลที่จะโชว์" เท่านั้น
        ⚠️ อยู่ใน <label> → ต้อง preventDefault + stopPropagation ไม่งั้นกดดูตัวอย่าง
           แล้วสวิตช์ติ๊กตามไปด้วย */}
    <div className="md:col-span-2">
      <label className="inline-flex w-fit items-start gap-2 cursor-pointer group">
        <input
          type="checkbox"
          disabled={isViewMode}
          checked={!!formData.ai_raw_site_rules}
          onChange={(e) => setFormData(prev => ({ ...prev, ai_raw_site_rules: e.target.checked }))}
          className="accent-primary-500 rounded w-6 h-6 mt-0 shrink-0"
        />
        <span className="text-sm font-medium text-slate-500 group-hover:text-slate-300 flex items-center gap-1 flex-wrap">
          {t('hook_form.site_rules_to_ai')}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setHelpModal({ isOpen: true, title: t('hook_form.site_rules_to_ai'), message: t('hook_form.site_rules_to_ai_help') }); }}
            className="text-blue-500/60 hover:text-blue-500 shrink-0"
          >
            <HelpCircle size={14} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSiteRulesExample(); }}
            title={t('hook_form.json_example_open')}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold text-blue-500/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/30 transition-colors"
          >
            <FileJson size={12} />
            {t('hook_form.json_example')}
          </button>
        </span>
      </label>
      {/* [FEAT-20260804-AUTOINJECTHINT] บอกให้ชัดว่าเปิดแล้วระบบแทรกให้เอง
          ไม่ต้องไปพิมพ์อ้าง tag ใน Training Doc — เคยมีคนเข้าใจผิดว่าต้องระบุเอง
          pl-8 = เยื้องให้ตรงกับข้อความข้าง checkbox (กว้าง 6 + gap 2) */}
      <p className="mt-1 text-xs text-slate-400 pl-8">{t('hook_form.auto_inject_hint')}</p>
    </div>

    {/* [FEAT-20260804-SITERULESGUIDE] กติกาการใช้ข้อมูล site rules
        คู่แฝดของช่อง "กฏการใช้ข้อมูล RAW JSON" แต่คุมคนละก้อน
        ⚠️ ปิดสวิตช์ = ช่องจางลง (disabled) แบบเดียวกับฝั่ง raw json
           กันคนกรอกทิ้งไว้แล้วงงว่าทำไมบอทไม่ทำตาม
        ⚠️ ไม่มี * แดง เพราะ "ว่างได้" — ต่างจาก raw json ที่บังคับกรอก
           (เหตุผล: สวิตช์นี้มีคนเปิดใช้อยู่แล้ว บังคับย้อนหลัง = เซฟไม่ผ่าน) */}
    <div className="md:col-span-2">
      <label className="block text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
        {t('hook_form.ai_site_rules_guide')}
        <button
          type="button"
          onClick={() => setHelpModal({
            isOpen: true,
            title: t('hook_form.ai_site_rules_guide'),
            message: t('hook_form.ai_site_rules_guide_help'),
          })}
          className="text-blue-500/60 hover:text-blue-500 shrink-0"
        >
          <HelpCircle size={14} />
        </button>
      </label>
      <textarea
        rows={6}
        name="ai_site_rules_guide"
        disabled={isViewMode || !formData.ai_raw_site_rules}
        value={formData.ai_site_rules_guide ?? ''}
        onChange={handleChange}
        placeholder={t('hook_form.ai_site_rules_guide_placeholder')}
        className={`${inputClass(false)} font-mono text-xs leading-relaxed disabled:opacity-50`}
      />
    </div>
    </>
  );
};
