/**
 * ==== [FEAT-20260811-HOOKFORMSPLIT] ai tab extracted from HookFormModal.tsx ====
 *
 * The "AI & Responses" tab (~959 lines of JSX) moved out of the 5,300-line parent.
 * STATE STAYS IN THE PARENT — everything the tab reads/writes arrives in one `ctx`
 * object (form context prop): formData/setFormData/handleChange/errors, the AI
 * sub-tab + training-doc state, helpers (inputClass), and the modal-openers
 * (setHelpModal/setToast/…). Nothing here holds useState; re-render behaviour is
 * identical to the old inline block.
 *
 * ⚠️ JSX moved VERBATIM (class strings + element order byte-identical). Identifiers
 * that were parent-closure vars are destructured from `ctx` at the top so the body
 * reads exactly as before — proven by the ai-tab interaction tests in
 * test/HookFormModal.value.test.tsx (open tab → edit → submit → payload).
 * 🚫 KEEP THE PARENT THIN — do not inline this back. Do NOT wrap in React.memo
 * (ctx is a fresh object each render; memo would be dead weight).
 *
 * revert: paste the block back where `<HookAiTab ctx={formCtx}/>` renders in the
 * parent, restore the parent-local constants, delete this file.
 */
import React from 'react';

// [UI-20260831-DOCEXPAND] ตัวควบคุมที่ถือ state ของตัวเอง — ดูเหตุผลในไฟล์นั้น
import { ExpandableTextarea } from '../ExpandableTextarea';
/* [FEAT-20260909-AITABVENDORSPLIT] `SecretLockButtons` + the Eye/EyeOff pair left
   with `custom_ai_key` when it moved into AiVendorSelect's Gemini box — this file
   no longer renders a secret at all. คงไว้เฉย ๆ = import ตายที่ eslint จับ */
import {
  ArrowLeft, ArrowRight, Bot, Copy, FileJson, HelpCircle,
} from 'lucide-react';
import { FlexCardMultiSelect } from '../FlexCardMultiSelect';
import { InputError } from '../../../common/InputError';
import { RawJsonRulesHelp } from '../../RawJsonRulesHelp';
import type { HookFormTabCtx } from './hookFormTabCtx';
import { AiVendorSelect } from './AiVendorSelect';
// [FEAT-20261026-RAGENGINE] doc_retrieval switch + engine modes — own file (size ceiling)
import { RagEngineSection } from './RagEngineSection';
import { SiteRulesToAiBlock } from './SiteRulesToAiBlock';
import { CustomerHelperCardPicker } from './CustomerHelperCardPicker';
import { AI_SUB_TABS, DOC_STEPS } from './aiTabConstants';
import { copyText } from '../../../../utils/copyText';

export const HookAiTab: React.FC<{ ctx: HookFormTabCtx }> = ({ ctx }) => {
  const {
    formData, setFormData, handleChange, errors, isViewMode, t, inputClass,
    flexTemplates, groups,
    aiSubTab, setAiSubTab, docStep, setDocStep,
    /* [FEAT-20260909-AITABVENDORSPLIT] showCustomAiKey / secretLock ไม่ได้ถูกอ่านที่นี่แล้ว
       ทั้งคู่ยังอยู่บน ctx เหมือนเดิม — `AiVendorSelect` เป็นคนดึงไปใช้แทน
       ⚠️ ห้ามลบออกจาก `hookFormTabCtx.ts` หรือจากที่แม่ประกอบ formCtx: ลูกยังต้องใช้ */
    trainingDocGeneral, setTrainingDocGeneral,
    trainingDocCompany, setTrainingDocCompany,
    trainingDocNoProfile, setTrainingDocNoProfile,
    setHelpModal, setDocTestOpen, setToast,
    openRawJsonExample, openSiteRulesExample,
  } = ctx;
  return (
    <>
            <div className="flex flex-col gap-6 animation-slide-in">
              {/* ==== [FEAT-20260803-AISUBTABS] START — แท็บแถวสองในแท็บ AI
                  🔒 สาย AUTO — to_dev_auto / to_prod_auto
                  ผู้ใช้สั่ง 2026-08-03: "ย้าย div training กับ div advance เป็น tab แถวสอง
                  training ก่อน default select เปิด ไม่มี collapse expand แล้ว"

                  BEFORE  two independent collapses stacked vertically. Both could be shut at
                          once, leaving the AI tab looking empty, and both could be open at
                          once, making it a long scroll with no sense of where you were.
                  AFTER   one row of pills, exactly one section visible at a time, Training
                          selected on open — เปิดมาเห็นของที่ใช้บ่อยที่สุดทันที ไม่ต้องกดอะไรก่อน

                  ⚠️ ลำดับบนจอมาจาก AI_SUB_TABS (training มาก่อน) ไม่ได้มาจากลำดับใน DOM
                     บล็อก "ขั้นสูง" ยังวางอยู่ก่อนในไฟล์ตามเดิมเพื่อให้ diff เล็ก — แสดงทีละอัน
                     อยู่แล้วจึงไม่เห็นความต่าง · จะสลับตำแหน่งในไฟล์ก็ได้ ไม่กระทบอะไร
                  revert: คืนปุ่ม toggle 2 อัน + useState showAiAdvanced/showDocSetup
                          แล้วเปลี่ยน {aiSubTab === 'x' && ...} กลับเป็น {showX && ...} */}
              <div className="md:col-span-2 flex items-center gap-2 border-b border-slate-100 pb-4">
                {AI_SUB_TABS.map((s) => {
                  const active = aiSubTab === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setAiSubTab(s.key)}
                      className={`px-4 py-2 rounded-full text-sm font-bold transition-all inline-flex items-center gap-2 ${
                        active
                          ? 'bg-slate-800 text-white shadow-md'
                          : 'bg-white text-slate-500 border border-slate-200 hover:text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <s.icon size={15} />
                      {t(s.i18n)}
                    </button>
                  );
                })}
              </div>

              {aiSubTab === 'advanced' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animation-fade-in">
                {/* [MOVE-20260831-AIADVANCE] ย้ายมาจาก step "ทั่วไป" ของ Training Doc
                    ตามที่เจ้าของสั่ง 31/08: วิธีส่ง Training Document ให้ AI +
                    ผู้ให้บริการ AI + โมเดล AI เป็นเรื่องตั้งค่าเครื่อง ไม่ใช่เนื้อเอกสาร
                    ⚠️ ย้ายที่วางอย่างเดียว — ชื่อ field, ค่าเดิม และ payload ตอนบันทึก
                       ไม่เปลี่ยนสักตัวอักษร */}
                  {/* [FEAT-20261026-RAGENGINE] the doc_retrieval switch moved VERBATIM into
                      RagEngineSection.tsx, which also holds the two engine modes (shown only
                      while the switch is on). revert: paste that file's first block back here. */}
                  <RagEngineSection ctx={ctx} />
                  {/* [P2-20260813] per-hook AI vendor + model — own file, this
                      one is past the size ceiling and off the waiver list.
                      ⚠️ Deliberately AFTER the DOCRETRIEVAL END marker: inside it,
                         that feature's own revert ("ลบบล็อกนี้") would take this
                         unrelated block with it.
                      revert: delete this line + AiVendorSelect.tsx */}
                  <AiVendorSelect ctx={ctx} />
                  {/* ==== [FEAT-20260909-AITABVENDORSPLIT] ============================
                      The four Gemini knobs (temperature / top_k / top_p / thinking)
                      USED TO RENDER HERE. They moved into the Gemini box in
                      `AiVendorSelect.tsx` — see `GeminiKnobsFields.tsx`.
                      WHY  they are GEMINI values. DeepSeek has no `top_k` at all and
                           its transport logs the knob as ignored, so a row of Gemini
                           sliders sitting under both vendors said something untrue.
                           ค่าใครค่ามัน — owner, 09/09.
                      ⚠️ Removing them here is not optional bookkeeping: the block was
                         COPIED, and leaving both would render every slider twice and
                         give two controls the same `name`.
                      revert: see the header of GeminiKnobsFields.tsx
                      ==== [FEAT-20260909-AITABVENDORSPLIT] END ==================== */}

                  {/* ==== [FIX-20260731-AIKEYTOP] · [FEAT-20260909-AITABVENDORSPLIT]
                      `custom_ai_key` ไม่ได้อยู่ตรงนี้แล้ว — ย้ายไปอยู่ในกล่อง Gemini
                      ของ `AiVendorSelect.tsx` (เรนเดอร์ที่บรรทัด :133 ข้างบน)
                      WHY  ค่าใครค่ามัน: คีย์ของ Gemini ต้องอยู่ติดกับโมเดลของ Gemini
                           ไม่ใช่ลอยอยู่ใต้สไลเดอร์คนละกลุ่มกัน · และไฟล์นี้ 1,128 บรรทัด
                           อยู่เหนือเพดาน 400 ที่ "หดได้อย่างเดียว" ⇒ ย้ายออกเท่านั้น
                      ⚠️ ตัวปุ่มตา (`showCustomAiKey`) ยังเป็น state ของแม่เหมือนเดิม
                         ส่งผ่าน ctx ไปให้ AiVendorSelect ใช้ — ไม่ได้ย้าย state ตามไป
                      revert: ดู marker เดียวกันใน AiVendorSelect.tsx แล้วย้ายบล็อกกลับมา
                              ตรงนี้ (ใต้บล็อกสไลเดอร์ เหนือ </div> ปิด advanced) */}

                </div>
              )}
              {/* ==== [FEAT-20260802-AITABGROUPS] จบ "AI ขั้นสูง" (เหลือแค่ slider + Custom AI Key)
                  RAW JSON + flex ย้ายไปกลุ่ม "Tag - API Profile" · 3 ช่องล่างย้ายไปกลุ่ม "ทั่วไป"
                  ตามที่ผู้ใช้สั่ง (เอา api profile + ทั่วไป ออกจาก ai advance) */}

              {/* ==== [FEAT-20260803-DOCSTEPS] START — สารบัญซ้าย 3 step
                  ชื่อกลุ่มข้างในยังเป็น "ทั่วไป / Tag-API / Training Doc" เหมือนเดิมทุกที่
                  [FEAT-20260803-AISUBTABS] เลิกพับแล้ว — เป็นเนื้อหาของแท็บแถวสอง "Training Doc"
                  revert: ดูหัวข้อ marker เดียวกันที่ประกาศ state ด้านบนไฟล์ */}
              {aiSubTab === 'training' && (
              <div className="md:col-span-2 animation-fade-in">
                <div className="flex flex-col md:flex-row gap-5">

                  {/* ── สารบัญซ้าย (stepper) — เส้นเชื่อมวิ่งหลังไอคอน ────────────────
                      ⚠️ เส้นวาดด้วย ::before ของแต่ละแถว ไม่ใช่เส้นยาวเส้นเดียว
                         เพราะความสูงแต่ละ step ไม่เท่ากันเมื่อข้อความขึ้น 2 บรรทัด
                         (เส้นเดียวจะยาวเกิน/สั้นเกินทันทีที่ภาษาเปลี่ยน) */}
                  <div className="md:w-60 shrink-0">
                    <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-3">
                      {DOC_STEPS.map((s, i) => {
                        const active = docStep === s.key;
                        const done = DOC_STEPS.findIndex(x => x.key === docStep) > i;
                        return (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => setDocStep(s.key)}
                            className="relative w-full flex items-center gap-3 py-2.5 text-left group/step"
                          >
                            {/* เส้นเชื่อมไป step ถัดไป (ตัวสุดท้ายไม่มี) */}
                            {i < DOC_STEPS.length - 1 && (
                              <span className={`absolute left-[19px] top-[38px] bottom-[-10px] w-px ${done ? 'bg-primary-500/60' : 'bg-slate-200'}`} />
                            )}
                            <span className={`relative z-10 shrink-0 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                              active
                                ? 'bg-gradient-to-br from-violet-500 to-primary-600 border-transparent text-white shadow-lg shadow-primary-500/25 scale-105'
                                : done
                                  ? 'bg-primary-500/10 border-primary-500/40 text-primary-600'
                                  : 'bg-white border-slate-200 text-slate-300 group-hover/step:border-slate-300 group-hover/step:text-slate-400'
                            }`}>
                              <s.icon size={16} />
                            </span>
                            <span className={`text-sm leading-snug transition-colors ${
                              active ? 'font-bold text-slate-700' : done ? 'font-medium text-slate-500' : 'text-slate-400 group-hover/step:text-slate-500'
                            }`}>
                              {t(s.i18n)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── เนื้อหาของ step ที่เลือก ────────────────────────────────── */}
                  <div className="flex-1 min-w-0">
                    <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-5">
                      {/* แถบความคืบหน้า + ชื่อ step ปัจจุบัน */}
                      <div className="mb-1 flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-primary-600 transition-all duration-500"
                            style={{ width: `${((DOC_STEPS.findIndex(x => x.key === docStep) + 1) / DOC_STEPS.length) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-400 tabular-nums">
                          {DOC_STEPS.findIndex(x => x.key === docStep) + 1}/{DOC_STEPS.length}
                        </span>
                      </div>
                      <h4 className="text-lg font-bold text-slate-700 mb-1">{t(DOC_STEPS.find(x => x.key === docStep)!.i18n)}</h4>
                      <p className="text-xs text-slate-400 mb-5">{t('hook_form.doc_setup_hint')}</p>

              {/* ==== [FEAT-20260802-AITABGROUPS] กลุ่มพับ #3 — ทั่วไป (history / need-detail / re-assist)
                  ⚠️ ชื่อกลุ่มคงเดิม · เปลี่ยนแค่ "อะไรเป็นตัวสั่งให้แสดง"
                     เดิม showGeneralGroup (พับเอง) → ตอนนี้ docStep === 'general' (step ที่ 1) */}
              {docStep === 'general' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animation-fade-in">

                  {/* ==== [FEAT-20260730-HISTLIMIT] START — จำนวน history ที่บอทใช้ตอบ
                      🔒 branch to_dev_custom_adapter

                      ตั้งได้ 5-30 · ไม่ตั้ง = 5 (ค่าเดิมที่ hardcode อยู่ก่อนหน้า)
                      มีผลกับ tag [[[history]]] ตอนบอทตอบลูกค้าเท่านั้น —
                      เส้นสรุปให้แอดมิน (10) และจัดหมวด (5) ไม่ถูกแตะ
                      revert: ลบ block นี้ + ai_history_limit ใน default/load/validate */}
                  {/* [FIX-20260731-AIROW] เดิม 2 ช่องนี้เป็น md:col-span-2 คนละแถว
                      ย้ายมาอยู่แถวเดียวกันแบ่งครึ่ง (ช่องละ 1 คอลัมน์ของ grid แม่)
                      revert: คืน className="md:col-span-2" ให้ทั้งสอง div แล้วย้าย
                      บล็อก auto_unassist_minutes กลับไปไว้เหนือ Training Document */}
                  {/* [FEAT-20260801-NEEDDETAIL] แถวนี้เพิ่มจาก 2 เป็น 3 ช่อง
                      grid แม่เป็น 2 คอลัมน์ตายตัว → ครอบ sub-grid 3 คอลัมน์ไว้ชั้นเดียว
                      แทนการไปแก้ grid แม่ (ซึ่งจะพาแถวอื่นทั้งแท็บเพี้ยนตามไปด้วย)
                      revert: ลบ div ครอบนี้ + ช่องกลาง แล้วอีก 2 ช่องกลับไปเรียงตาม grid แม่ */}
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                      {t('hook_form.ai_history_limit')}
                      <button
                        type="button"
                        onClick={() => setHelpModal({ isOpen: true, title: t('hook_form.ai_history_limit'), message: t('hook_form.ai_history_limit_help') })}
                        className="text-blue-500/60 hover:text-blue-500 shrink-0"
                      >
                        <HelpCircle size={14} />
                      </button>
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={30}
                      step={1}
                      disabled={isViewMode}
                      name="ai_history_limit"
                      /* [FIX-20260731-AIROW] เดิม `?? 5` — handleChange แปลงช่องว่าง
                         เป็น null ทำให้พอลบเลขออกจะเด้งกลับเป็น 5 ทันที พิมพ์ทับ
                         ไม่ได้ · ปล่อยให้ว่างระหว่างพิมพ์ได้ แล้วไปตรวจตอน submit
                         (ว่าง = ไม่ตั้งค่า ใช้ค่าเริ่มต้น 5 ตามเดิม)
                         revert: เปลี่ยนกลับเป็น formData.ai_history_limit ?? 5 */
                      value={formData.ai_history_limit ?? ''}
                      onChange={handleChange}
                      className={inputClass(!!errors.ai_history_limit)}
                    />
                    {errors.ai_history_limit
                      ? <p className="mt-1 text-xs font-semibold text-red-500">{errors.ai_history_limit}</p>
                      : <p className="mt-1 text-xs text-slate-400">5 - 30 · {t('hook_form.ai_history_limit_hint')}</p>}
                  </div>
                  {/* ==== [FEAT-20260730-HISTLIMIT] END */}

                  {/* ==== [FEAT-20260801-NEEDDETAIL] START — จำนวนข้อความสรุปความต้องการลูกค้า
                      🔒 สาย AUTO — to_dev_auto / to_prod_auto

                      ตั้งได้ 0 หรือ 5-30 · ไม่ตั้ง = 10 (ค่าเดิมที่ hardcode อยู่ก่อนหน้า)
                      มีผลกับ need_detail บนบัตรงานเท่านั้น — คนละเส้นกับ [[[history]]]
                      ข้างซ้ายซึ่งคุมตอนบอทตอบลูกค้า
                      ⚠️ ตั้ง 0 = ไม่เรียก AI → หมวดหมู่เหลือแค่ Payment/Other
                         (อธิบายไว้ในปุ่ม info แล้ว ไม่ต้องเดา)
                      revert: ลบ block นี้ + ai_need_detail_limit ใน default/load/validate */}
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                      {t('hook_form.ai_need_detail_limit')}
                      <button
                        type="button"
                        onClick={() => setHelpModal({ isOpen: true, title: t('hook_form.ai_need_detail_limit'), message: t('hook_form.ai_need_detail_limit_help') })}
                        className="text-blue-500/60 hover:text-blue-500 shrink-0"
                      >
                        <HelpCircle size={14} />
                      </button>
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      step={1}
                      disabled={isViewMode}
                      name="ai_need_detail_limit"
                      /* ปล่อยให้ว่างระหว่างพิมพ์ได้ แล้วไปตรวจตอน submit เหมือนช่องซ้าย
                         (ว่าง = ไม่ตั้งค่า ใช้ค่าเริ่มต้น 10) · ใช้ ?? ไม่ใช่ ||
                         ไม่งั้นตั้ง 0 แล้วช่องจะโชว์ว่างเพราะ 0 เป็น falsy */
                      value={formData.ai_need_detail_limit ?? ''}
                      onChange={handleChange}
                      className={inputClass(!!errors.ai_need_detail_limit)}
                    />
                    {errors.ai_need_detail_limit
                      ? <p className="mt-1 text-xs font-semibold text-red-500">{errors.ai_need_detail_limit}</p>
                      : <p className="mt-1 text-xs text-slate-400">{t('hook_form.ai_need_detail_limit_hint')}</p>}
                  </div>
                  {/* ==== [FEAT-20260801-NEEDDETAIL] END */}

                  {/* [FIX-20260731-AIROW] ย้ายมาจากด้านล่าง (เหนือ Training Document)
                      ให้อยู่แถวเดียวกับ "จำนวนข้อความ ที่ใช้กับ tag" แบ่งครึ่งซ้าย-ขวา
                      เนื้อในไม่ถูกแก้เลย ย้ายตำแหน่งอย่างเดียว
                      revert: ย้ายบล็อกนี้กลับไปไว้เหนือ Training Document พร้อม
                      คืน className="md:col-span-2" */}
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">
                      {t('hook_form.auto_unassist_minutes')}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        disabled={isViewMode}
                        name="auto_unassist_minutes"
                        value={formData.auto_unassist_minutes ?? ''}
                        onChange={handleChange}
                        className={inputClass(false, 'w-32')}
                        placeholder="30"
                      />
                      <span className="text-sm font-semibold text-slate-600">
                        {t('hook_form.auto_unassist_minutes_suffix')}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 italic">
                      ({t('hook_form.auto_unassist_minutes_help')})
                    </p>
                  </div>
                  {/* [FEAT-20260801-NEEDDETAIL] ปิด sub-grid 3 คอลัมน์ */}
                  </div>
              </div>
              )}
              {/* ==== [FEAT-20260802-AITABGROUPS] จบกลุ่มพับ #3 (ทั่วไป) */}

              {/* ==== [FEAT-20260802-AITABGROUPS] กลุ่มพับ #1 — Tag / API Profile ช่วยตอบ
                  รวม RAW JSON + flex profile + flex ปรับแต่ง + ข้อความปุ่มลงทะเบียน
                  ⚠️ ชื่อกลุ่มคงเดิม · ตัวสั่งให้แสดงเปลี่ยนจาก showFlexTagGroup เป็น step ที่ 2 */}
              {docStep === 'flexTag' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animation-fade-in">

                  {/* ==== [FEAT-20260731-RAWJSON] START — ส่ง JSON ดิบเข้า AI
                      🔒 สาย AUTO — to_dev_auto / to_prod_auto

                      Off by default and off for every existing hook. Turning it on
                      sends the customer's data to Gemini on every message, which the
                      system never did before — hence the warning under the box.
                      ข้อความกติกาการใช้ข้อมูลไม่ได้อยู่ในโค้ด แอดมินพิมพ์เองใน Training Doc
                      โดยอ้างตัวคั่น [RAW_JSON_PROFILE_START] / [RAW_JSON_PROFILE_END]
                      revert: ลบ block นี้ + ai_raw_json_analysis ใน default/load */}
                  <div className="md:col-span-2">
                    {/* [FIX-20260803-CBHIT] พื้นที่กดต้องเป็นแค่ checkbox + ตัวหนังสือ ไม่ใช่ทั้งแถว
                        WHY  the label was a block-level flex container inside a full-width
                        column, so its hit area stretched to the right edge of the form.
                        Clicking empty space far from the control toggled it, which reads as
                        the form randomly changing a setting you never touched.
                        → inline-flex + w-fit = กว้างเท่าเนื้อหาจริง · ที่ว่างข้าง ๆ กดไม่ติดแล้ว
                        ⚠️ ใช้กับ checkbox ทั้ง 2 ตัวในบล็อกนี้ (raw json + site rules)
                        revert: เปลี่ยน className กลับเป็น "flex items-start gap-2 cursor-pointer group" */}
                    <label className="inline-flex w-fit items-start gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        disabled={isViewMode}
                        checked={!!formData.ai_raw_json_analysis}
                        onChange={(e) => setFormData(prev => ({ ...prev, ai_raw_json_analysis: e.target.checked }))}
                        /* [FIX-20260801-RAWJSONBOX] ผู้ใช้สั่ง "ขยาย checkbox +50%"
                           เบราว์เซอร์เรนเดอร์ checkbox ที่ ~16px (1rem) เป็นค่าเริ่มต้น
                           → w-6 h-6 = 24px = ใหญ่ขึ้น 50% พอดี (ไม่ใช้ scale เพราะ
                             scale ไม่กินพื้นที่จริง ตัวกล่องจะไปทับข้อความข้างๆ)
                           mt-0 แทน mt-0.5 เพราะกล่องสูงขึ้นแล้ว ไม่ต้องดันลงอีก
                           revert: กลับเป็น "accent-primary-500 rounded mt-0.5 shrink-0" */
                        className="accent-primary-500 rounded w-6 h-6 mt-0 shrink-0"
                      />
                      <span className="text-sm font-medium text-slate-500 group-hover:text-slate-300 flex items-center gap-1">
                        {t('hook_form.ai_raw_json_analysis')}
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setHelpModal({ isOpen: true, title: t('hook_form.ai_raw_json_analysis'), message: t('hook_form.ai_raw_json_analysis_help') }); }}
                          className="text-blue-500/60 hover:text-blue-500 shrink-0"
                        >
                          <HelpCircle size={14} />
                        </button>
                        {/* [FEAT-20260801-RAWJSONEXAMPLE] ปุ่มดูตัวอย่างโครง JSON แบบเต็ม
                            เปิดหน้าเปล่า (แท็บใหม่) โชว์ JSON pretty · ไม่มี header/menu
                            ⚠️ อยู่ใน <label> → preventDefault กันคลิกไปติ๊ก checkbox
                            revert: ลบปุ่มนี้ */}
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRawJsonExample(); }}
                          title={t('hook_form.json_example_open')}
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold text-blue-500/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/30 transition-colors"
                        >
                          <FileJson size={12} />
                          {t('hook_form.json_example')}
                        </button>
                      </span>
                    </label>
                    {/* [FIX-20260801-RAWJSONBOX] ผู้ใช้สั่งเอาคำเตือนใต้ checkbox ออก
                        (เนื้อหาเดียวกันยังอยู่ในปุ่ม info ข้างชื่อหัวข้อ ไม่ได้หายไปจากระบบ)
                        revert: คืนบรรทัดนี้
                        <p className="mt-1 text-xs text-amber-500/80 pl-8">{t('hook_form.ai_raw_json_analysis_warn')}</p> */}
                    {/* [FEAT-20260804-AUTOINJECTHINT] บรรทัดเดียวกับฝั่ง site rules — คนละคำเตือน
                        กับ _warn ที่ถูกเอาออกไป (อันนั้นเตือนเรื่องข้อมูลหลุด อันนี้บอกว่าไม่ต้องระบุเอง) */}
                    <p className="mt-1 text-xs text-slate-400 pl-8">{t('hook_form.auto_inject_hint')}</p>
                  </div>


                  {/* [FEAT-20260731-RAWJSONRULES] กติกาที่แอดมินเขียนเอง
                      ส่งเป็นก้อนแยกต่อจากข้อมูลดิบ ก่อน Document
                      ปิดสวิตช์ = ช่องนี้จางลง กันคนกรอกแล้วงงว่าทำไมไม่มีผล */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                      {t('hook_form.ai_raw_json_rules')}
                      {formData.ai_raw_json_analysis && <span className="text-red-500">*</span>}
                      {/* [FEAT-20260731-RAWJSONSAMPLE] เดิม message เป็น string ของ
                          _help เฉยๆ · ตอนนี้เป็น component ที่พ่วงตัวอย่าง+ปุ่มคัดลอก
                          revert: คืนเป็น message: t('hook_form.ai_raw_json_rules_help') */}
                      <button
                        type="button"
                        onClick={() => setHelpModal({
                          isOpen: true,
                          title: t('hook_form.ai_raw_json_rules'),
                          message: (
                            <RawJsonRulesHelp
                              onCopied={() => setToast({ message: t('hook_form.ai_raw_json_rules_copied'), type: 'success' })}
                              onCopyFailed={() => setToast({ message: t('common.copy_failed_message'), type: 'error' })}
                            />
                          ),
                        })}
                        className="text-blue-500/60 hover:text-blue-500 shrink-0"
                      >
                        <HelpCircle size={14} />
                      </button>
                    </label>
                    <textarea
                      rows={6}
                      name="ai_raw_json_rules"
                      disabled={isViewMode || !formData.ai_raw_json_analysis}
                      value={formData.ai_raw_json_rules ?? ''}
                      onChange={handleChange}
                      placeholder={t('hook_form.ai_raw_json_rules_placeholder')}
                      className={`${inputClass(!!errors.ai_raw_json_rules)} font-mono text-xs leading-relaxed disabled:opacity-50`}
                    />
                    {/* [FEAT-20260731-RAWJSONSAMPLE] เดิมมีบรรทัด hint สีเทาใต้ช่อง
                        ("ส่งต่อจากก้อนข้อมูลดิบ ก่อน Document · บังคับกรอก...")
                        ผู้ใช้สั่งตัดออก — รายละเอียดอ่านได้จากปุ่ม ? อยู่แล้ว
                        error ยังโชว์เหมือนเดิม เพราะเป็นตัวบอกว่าเซฟไม่ผ่าน
                        revert: คืน ternary เดิมที่ fallback เป็น ai_raw_json_rules_hint */}
                    {errors.ai_raw_json_rules && (
                      <p className="mt-1 text-xs font-semibold text-red-500">{errors.ai_raw_json_rules}</p>
                    )}
                  </div>
                  {/* ==== [FEAT-20260731-RAWJSON] END */}

                  {/* ==== [FEAT-20260801-FLEXPROFILE] START — flex สำหรับตอบข้อมูลโปรไฟล์
                      🔒 สาย AUTO — to_dev_auto / to_prod_auto

                      ผู้ใช้สั่งให้วาง "ต่อท้ายกฏการใช้ข้อมูล RAW JSON"
                      ไม่บังคับเลือก · ไม่เลือก = null = tag [[[flex_profile]]] ไม่ทำงาน
                      ตอบเป็นข้อความปกติเหมือนเดิมทุกประการ

                      ⚠️ รายการที่เลือกได้ = flex ที่ "อยู่ในกลุ่มตามสิทธิ" (BE กรองให้แล้ว
                         ตอน list: filters.group_ids ตาม req.auth.groups) **และ** type = profile
                         ตรงนี้จึงกรองเฉพาะ type ไม่ต้องกรองสิทธิ์ซ้ำ
                      ⚠️ ใช้ flexTemplates ก้อนเดิมที่ฟอร์มโหลดไว้แล้ว ไม่ยิง API เพิ่ม
                      revert: ลบบล็อกนี้ + flex_profile_id ใน default/load/submit/tab-map + types */}
                  {/* [FIX-20260802-FLEXROW] รวม 2 อินพุต (flex profile + flex ปรับแต่ง) ไว้แถวเดียว
                      ครอบ sub-grid 2 คอลัมน์ชั้นเดียว ไม่แตะ grid แม่
                      revert: คืนแต่ละบล็อกเป็น md:col-span-2 แยกแถว แล้วเอา div ครอบนี้ออก */}
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    {/* [FEAT-20260802-FLEXPROFILECOPY] ปุ่ม copy tag [[[flex_profile]]] ข้าง label */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <label className="block text-sm font-medium text-slate-500">
                        {t('hook_form.flex_profile_id')}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          // [FIX-20260830-COPYHTTP2] see utils/copyText
                          void copyText('[[[flex_profile]]]').then((ok) => setToast(
                            ok ? { message: t('hook_form.flex_profile_copied'), type: 'success' }
                               : { message: t('common.copy_failed_message'), type: 'error' }));
                        }}
                        className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 border border-primary-200 text-[11px] font-bold transition-all"
                        title={t('hook_form.flex_profile_copy')}
                      >
                        <Copy size={12} />
                        copy tag
                      </button>
                    </div>
                    <select
                      disabled={isViewMode}
                      name="flex_profile_id"
                      value={formData.flex_profile_id || ''}
                      onChange={handleChange}
                      className={inputClass(false, 'bg-white')}
                    >
                      <option value="">{t('common.none')}</option>
                      {flexTemplates
                        .filter(tpl => tpl.flex_type === 'profile')
                        .map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-slate-500/80">
                      {t('hook_form.flex_profile_id_hint')}
                    </p>
                  </div>
                  {/* ==== [FEAT-20260801-FLEXPROFILE] END */}

                  <CustomerHelperCardPicker ctx={ctx} />

                  {/* ==== [FEAT-20260802-FLEXCUSTOMLIST] START — flex ที่ปรับแต่งไว้ (เลือกได้หลายใบ)
                      🔒 สาย AUTO — to_dev_auto / to_prod_auto

                      ผู้ใช้สั่งให้วาง "ต่อท้ายบล็อกตอบข้อมูล profile ด้วย flex"
                      เก็บเป็น array ของ id · ไม่เลือก = [] = ไม่มีผลกับอะไรทั้งสิ้น

                      ⚠️ รายการที่เลือกได้ = flex ที่ "อยู่ในกลุ่มตามสิทธิ" (BE กรองให้แล้ว
                         ตอน list: filters.group_ids ตาม req.auth.groups) **และ** type = custom
                      ⚠️ ใช้ flexTemplates ก้อนเดิมที่ฟอร์มโหลดไว้แล้ว ไม่ยิง API เพิ่ม
                      [FEAT-20260802-FLEXCUSTOMDROPDOWN] เปลี่ยนจาก checkbox list ที่โชว์ตลอด
                         → เป็น select box: โชว์ "[ชื่อใบแรก +N]" กดแล้วค่อยเปิด dropdown ติ๊กเลือก
                         มี select all / clear all · ปิดเมื่อคลิกนอกกล่อง (customFlexRef)
                      revert: ลบบล็อกนี้ + flex_custom_ids ใน default/load/submit/tab-map + types */}
                  <FlexCardMultiSelect
                    label={t('hook_form.flex_custom_label')}
                    hint={t('hook_form.flex_custom_hint')}
                    emptyText={t('hook_form.flex_custom_empty')}
                    placeholder={t('hook_form.flex_custom_placeholder')}
                    tagModalTitle={t('hook_form.flex_custom_tag_title')}
                    tagModalFooter={t('hook_form.flex_custom_tag_footer')}
                    templates={flexTemplates.filter(tpl => tpl.flex_type === 'custom')}
                    picked={formData.flex_custom_ids || []}
                    onChange={(ids) => setFormData(prev => ({ ...prev, flex_custom_ids: ids }))}
                    isViewMode={isViewMode}
                    onCopyToast={(message, type) => setToast({ message, type })}
                    copyFailMsg={t('common.copy_failed_message')}
                  />
                  {/* [FEAT-20260802-FLEXPCTAG] flex profile กึ่งปรับแต่ง (profile-semi-custom) — เส้นแยกของตัวเอง
                      tag prefix flex_pc · perm/group + type คัดฝั่ง BE · view tag + copy เหมือน custom */}
                  <FlexCardMultiSelect
                    label={t('hook_form.flex_pc_label')}
                    hint={t('hook_form.flex_pc_hint')}
                    emptyText={t('hook_form.flex_pc_empty')}
                    placeholder={t('hook_form.flex_pc_placeholder')}
                    tagModalTitle={t('hook_form.flex_pc_tag_title')}
                    tagModalFooter={t('hook_form.flex_pc_tag_footer')}
                    templates={flexTemplates.filter(tpl => tpl.flex_type === 'profile-semi-custom')}
                    picked={formData.flex_profile_custom_ids || []}
                    onChange={(ids) => setFormData(prev => ({ ...prev, flex_profile_custom_ids: ids }))}
                    isViewMode={isViewMode}
                    onCopyToast={(message, type) => setToast({ message, type })}
                    copyFailMsg={t('common.copy_failed_message')}
                  />
                  </div>

                  {/* ==== [FEAT-20260801-HELPERTEXT] START — ข้อความคู่กับปุ่ม customer-helper
                      🔒 สาย AUTO — to_dev_auto / to_prod_auto

                      ผู้ใช้สั่งให้วางต่อจากบล็อก raw json (เดิมวางเหนือ "ลิงก์คำตอบ")
                      ไม่บังคับกรอก · ว่าง = ใช้ข้อความกลางของระบบ (ฝั่ง BE เป็นคนเติมให้)
                      ⚠️ มีผลเฉพาะตอนบอทตอบพร้อม quick reply ของ tag [[[customer-helper]]]
                         ไม่กระทบคำตอบปกติของ AI เส้นอื่นเลย
                      revert: ลบบล็อกนี้ + customer_helper_text ใน default/load/submit + i18n */}
                  {/* [UI-20260810-HIDEHELPERTEXT] Owner order 2026-08-10: hide this block —
                      label + input + hint. Hide ONLY: state still loads/saves
                      customer_helper_text, so values already in DB survive every save and the
                      BE keeps using them for [[[customer-helper]]] exactly as before.
                      revert: change `false &&` back to a plain block.
                      ซ่อนเฉย ๆ ค่าที่เคยกรอกยังอยู่ครบ */}
                  {false && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-500 mb-1">
                      {t('hook_form.customer_helper_text')}
                    </label>
                    <input
                      disabled={isViewMode}
                      name="customer_helper_text"
                      value={formData.customer_helper_text || ''}
                      onChange={handleChange}
                      className={inputClass(false)}
                      placeholder={t('hook_form.customer_helper_text_placeholder')}
                    />
                    <p className="mt-1 text-xs text-slate-500/80">
                      {t('hook_form.customer_helper_text_hint')}
                    </p>
                  </div>
                  )}
                  {/* ==== [FEAT-20260801-HELPERTEXT] END */}

                  {/* [FEAT-20261018-SITERULESWORLD] the Site Rules set — moved to its own file, verbatim */}
                  <SiteRulesToAiBlock ctx={ctx} />
                  </div>
                  )}
              {/* ==== [FEAT-20260802-AITABGROUPS] จบกลุ่มพับ #1 (Tag - API Profile) */}

              {/* ==== [FEAT-20260802-AITABGROUPS] กลุ่มพับ #2 — Training Doc ทั่วไป
                  รวมเอกสารเทรน + ข้อความตอบมาตรฐาน + ลิงก์คำตอบ
                  ⚠️ ชื่อกลุ่มคงเดิม · ตัวสั่งให้แสดงเปลี่ยนจาก showTrainingDocGroup เป็น step ที่ 3 */}
              {docStep === 'trainingDoc' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animation-fade-in">

              {/* [FIX-20260731-AIROW] บล็อก auto_unassist_minutes เดิมอยู่ตรงนี้
                  ย้ายขึ้นไปอยู่แถวเดียวกับ ai_history_limit ตามที่ผู้ใช้กำหนด */}

              {/* [MOVE-20260810-SITERULESGUIDE] ทั้งชุด Site Rules เคยอยู่ตรงนี้ — ย้ายออกไปแล้ว
                  สวิตช์ "ส่ง Site Rules เข้า AI" + ปุ่ม [ตัวอย่าง json] + hint แทรกอัตโนมัติ
                  + ช่อง "กฏการใช้ข้อมูล Site Rules" ทั้งหมดไปอยู่ล่างสุดของ step "ตั้งค่าการช่วยตอบข้อมูล API"
                  ตามที่ผู้ใช้สั่ง 2026-08-10 (ยกไปทั้งก้อน ไม่ได้แยกสวิตช์กับช่องกรอกออกจากกัน) */}

              <div className="md:col-span-2 relative">
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.training_doc_general')} <span className="text-red-500">*</span></label>
                {/* [REFACTOR-20260803-DOCBLOCK] ป้ายชื่อบล็อก — read-only โดยตั้งใจ
                    แอดมินต้องเห็นชื่อ tag เพื่อเอาไปอ้างใน Training Doc
                    แต่ห้ามพิมพ์ลงในกล่อง เพราะ DB เก็บเนื้อล้วน BE เป็นคนห่อให้ */}
                {/* [UI-20260831-DOCEXPAND] ปุ่มขยาย/ย่อของกล่องนี้โดยเฉพาะ — state
                    อยู่ในตัวคอมโพเนนต์เอง ไฟล์นี้จึงยังไม่มี useState ตามที่หัวไฟล์
                    ประกาศไว้ · กล่องล่างมีปุ่มของตัวเองแยกกัน */}
                <ExpandableTextarea
                  testId="doc-expand-general"
                  chips={
                    <>
                      <span className="px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200">[START_OF_BASIC_INFO]</span>
                      <span className="text-slate-300">…</span>
                      <span className="px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200">[END_OF_BASIC_INFO]</span>
                    </>
                  }
                  disabled={isViewMode}
                  value={trainingDocGeneral}
                  onChange={setTrainingDocGeneral}
                  rows={6}
                  className={inputClass(!!errors.suggestion_text)}
                  placeholder={t('hook_form.suggestion_placeholder')}
                  expandLabel={t('hook_form.doc_expand')}
                  collapseLabel={t('hook_form.doc_collapse')}
                />
                <InputError error={errors.suggestion_text} />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.training_doc_company')}</label>
                {/* [REFACTOR-20260803-DOCBLOCK] ป้ายชื่อบล็อก — read-only โดยตั้งใจ
                    แอดมินต้องเห็นชื่อ tag เพื่อเอาไปอ้างใน Training Doc
                    แต่ห้ามพิมพ์ลงในกล่อง เพราะ DB เก็บเนื้อล้วน BE เป็นคนห่อให้ */}
                <ExpandableTextarea
                  testId="doc-expand-company"
                  chips={
                    <>
                      <span className="px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200">[START_OF_COMPANY_INFO]</span>
                      <span className="text-slate-300">…</span>
                      <span className="px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200">[END_OF_COMPANY_INFO]</span>
                    </>
                  }
                  disabled={isViewMode}
                  value={trainingDocCompany}
                  onChange={setTrainingDocCompany}
                  rows={6}
                  className={inputClass(false)}
                  expandLabel={t('hook_form.doc_expand')}
                  collapseLabel={t('hook_form.doc_collapse')}
                />
              </div>

              {/* [UI-20260813-HIDENOPROFILE] Owner order 2026-08-13 (เย็น): ซ่อน
                  "Training Document (no ProfileData)" อีกครั้ง — ย้อน
                  [UI-20260813-SHOWNOPROFILE] ที่เพิ่งเปิดเมื่อเช้าวันเดียวกัน.
                  คู่กับฝั่ง BE `90329b8` ที่เลิกส่งกล่องนี้เข้า prompt แล้ว ⇒ กล่องที่
                  กรอกได้แต่ไม่มีผลกับคำตอบ จะทำให้แอดมินเข้าใจผิด.
                  ⚠️ ซ่อนด้วย `false &&` เหมือนรอบก่อน ไม่ลบ markup/state:
                     · ค่าที่เคยกรอกยังอยู่ครบใน DB (BE ไม่ได้ลบคอลัมน์)
                     · trainingDocNoProfile ยังถูก load/save ตามปกติ ไม่มี field หาย
                     · เปิดคืน = เปลี่ยน `false &&` เป็นเงื่อนไขเดิม บรรทัดเดียว
                  revert: ลบ `{false && (` และ `)}` ที่ปิดท้ายบล็อกนี้ */}
              {false && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  {t('hook_form.training_doc_no_profile')}
                </label>
                {/* [REFACTOR-20260803-DOCBLOCK] ป้ายชื่อบล็อก — read-only โดยตั้งใจ
                    แอดมินต้องเห็นชื่อ tag เพื่อเอาไปอ้างใน Training Doc
                    แต่ห้ามพิมพ์ลงในกล่อง เพราะ DB เก็บเนื้อล้วน BE เป็นคนห่อให้ */}
                <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] text-violet-600 select-all">
                  <span className="px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200">[START_OF_NO_PROFILE_DATA]</span>
                  <span className="text-slate-300">…</span>
                  <span className="px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200">[END_OF_NO_PROFILE_DATA]</span>
                </div>
                <textarea
                  disabled={isViewMode}
                  value={trainingDocNoProfile}
                  onChange={(e) => setTrainingDocNoProfile(e.target.value)}
                  rows={6}
                  className={inputClass(false)}
                  placeholder="Enter custom document for non-registered users (Appended to General Info)..."
                />
                <InputError error={errors.suggestion_text_no_profile} />
              </div>
              )}

              {/* [UI-20260806-2COL] จับคู่ 2 input/แถว — ข้อความตอบกลับเริ่มต้น + เมื่อไม่พบข้อมูล API */}
              <div>
                {/* [FEAT-20260823-GENERRFALLBACK] rung 1 of the BE ladder
                    (ai-reply.provider.ts, same tag): THIS → default_answer_text →
                    silence. Added 23/08 on the owner's order — until then the column
                    existed on the hook but had no input anywhere in the panel. */}
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.ai_generative_error_text')}</label>
                <textarea disabled={isViewMode} name="ai_generative_error_text" value={formData.ai_generative_error_text || ''} onChange={handleChange} rows={2} className={inputClass(false)} />
                <p className="mt-1 text-xs text-slate-500/80">{t('hook_form.ai_generative_error_text_hint')}</p>
              </div>

              <div>
              {/* [FEAT-20260823-GENERRFALLBACK] rung 2 — answers a generative
                  error when the field ABOVE is empty. BE ladder, same tag:
                  ai_generative_error_text → THIS → silence.
                  แก้บันไดฝั่ง BE เมื่อไหร่ ต้องมาแก้ hint ทั้งสองช่องด้วย */}
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.default_answer_text')}</label>
                <textarea disabled={isViewMode} name="default_answer_text" value={formData.default_answer_text || ''} onChange={handleChange} rows={2} className={inputClass(false)} />
                <p className="mt-1 text-xs text-slate-500/80">{t('hook_form.default_answer_text_hint')}</p>
              </div>

              <div>
                {/* "ข้อความเมื่อไม่พบข้อมูล API" = hooks.missing_api_data_text.
                    BE sends it on two paths, each returning right after:
                    (a) an image arrives and the profile lookup produced no customer
                        name — this WINS over image_answer_text, which is then never
                        sent; (b) an AI answer quotes API data that failed to load.
                    Cannot be saved empty (BE answers 400).
                    ⚠️ Wording this like image_answer_text makes a broken profile API
                    look identical to normal operation to the customer. */}
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.missing_api_data_text')}</label>
                <textarea disabled={isViewMode} name="missing_api_data_text" value={formData.missing_api_data_text || ''} onChange={handleChange} rows={2} className={inputClass(false)} />
              </div>

              {/* [FEAT-20260806-STATUSOFF] OA-off reply behavior (optional). "" default = legacy message.
                  silent = ไม่ตอบ แต่ webhook ยังเก็บแชท. */}
              {/* [UI-20260806-2COL] status-off — select + ข้อความ อยู่แถวเดียว 2 คอลัมน์ */}
              <div className="md:col-span-2 rounded-lg border border-slate-200 dark:border-dark-700 p-3">
                <label className="block text-sm font-medium text-slate-500">{t('hook_form.status_off_action')}</label>
                <p className="text-xs text-slate-400 mb-2">{t('hook_form.status_off_hint')}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                  <select disabled={isViewMode} name="status_off_action" value={formData.status_off_action || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('hook_form.status_off_default')}</option>
                    <option value="reply">{t('hook_form.status_off_reply')}</option>
                    <option value="silent">{t('hook_form.status_off_silent')}</option>
                  </select>
                  {formData.status_off_action !== 'silent' && (
                    <textarea disabled={isViewMode} name="status_off_text" value={formData.status_off_text || ''} onChange={handleChange} rows={2}
                      placeholder={t('hook_form.status_off_text_ph')} className={inputClass(false)} />
                  )}
                </div>
              </div>

              {/* [MOVE-20260831-ABANDONPLACE] ย้ายมาจาก sub-tab "ขั้นสูง" มาอยู่ข้าง
                  "การตอบเมื่อ OA ปิด" ตามที่เจ้าของสั่ง 31/08
                  ⚠️ คอมเมนต์เดิมของบล็อกนี้เคยเขียนไว้ว่า *ต้อง* อยู่ในขั้นสูง
                     "ไม่ใช่ Training Doc … วางผิดที่แล้วคนหาไม่เจอ" — เจ้าของกลับคำ
                     เอง เก็บข้อความเดิมไว้ในบล็อกด้านล่างเพื่อไม่ให้บันทึกหาย
                  ⚠️ ย้ายที่วางอย่างเดียว ชื่อ field/ค่า/ตัวตัดสินฝั่ง BE ไม่แตะ */}
                  {/* ==== [FEAT-20260821-IGNOREABANDON] START
                      อยู่แท็บ AI เพราะเจ้าของสั่งให้ clone ได้ (20/08/2026) —
                      `CLONEABLE_TABS` ฝั่ง BE ไม่รวมแท็บ "ทั่วไป" โดยตั้งใจ
                      ⚠️ ค่าเริ่มต้นต้องเป็น "ตามปกติ" — hook เก่าไม่มี column นี้
                         อ่านเป็น false ทั้ง FE (`?? false` ตอน load) และ BE (`=== true`)
                      ⚠️ BE เป็นตัวตัดสินจริงที่ `follow-up.gate.ts` ตรงนี้แค่ตั้งค่า
                      ⚠️ ฝั่ง member มี column ชื่อเดียวกันแยกต่างหาก ปิดรายคนได้
                         ฝั่งไหนปิดก็คือปิด ไม่มีฝั่งไหนเปิดกลับ
                      ⚠️ อยู่ใน sub-tab "ขั้นสูง" ไม่ใช่ "Training Doc" — ตัวนั้นถูกกั้น
                         สามชั้น (ai → training → flexTag) และเป็นเรื่องเอกสาร ไม่ใช่
                         พฤติกรรมการตามลูกค้า วางผิดที่แล้วคนหาไม่เจอ
                      revert: ลบบล็อกนี้ + `ignore_abandon_assist` ใน default/load/types */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-500 mb-1">
                      {t('hook_form.ignore_abandon_assist')}
                    </label>
                    <select
                      disabled={isViewMode}
                      name="ignore_abandon_assist"
                      value={formData.ignore_abandon_assist ? 'true' : 'false'}
                      onChange={(e) =>
                        setFormData(prev => ({ ...prev, ignore_abandon_assist: e.target.value === 'true' }))
                      }
                      className={inputClass(false, 'bg-white')}
                    >
                      <option value="false">{t('hook_form.ignore_abandon_assist_off')}</option>
                      <option value="true">{t('hook_form.ignore_abandon_assist_on')}</option>
                    </select>
                    <p className="mt-1 text-xs text-slate-500/80">
                      {t('hook_form.ignore_abandon_assist_hint')}
                    </p>
                  </div>
                  {/* ==== [FEAT-20260821-IGNOREABANDON] END */}

              {/* [UI-20260806-2COL] จับคู่ 2 input/แถว — ค่าตอบกลับเมื่อพบรูปภาพ + ลิงก์คำตอบ */}
              <div>
                {/* "ค่าตอบกลับเมื่อพบรูปภาพ" = hooks.image_answer_text.
                    Two jobs in one field: it is also the GATE for the whole inbound
                    image branch — leave it empty and an image gets no reply, no
                    operator hand-off and no ticket, and missing_api_data_text stops
                    working for images too.
                    ⚠️ An [[[assist]]] marker in this text is what creates the ticket
                    and pages an operator; it is stripped before the customer sees it,
                    so removing it while editing the copy silently disables tickets.
                    Only a real image reaches this — stickers/video/audio return
                    earlier on the BE. */}
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.image_answer_text')}</label>
                <textarea disabled={isViewMode} name="image_answer_text" value={formData.image_answer_text || ''} onChange={handleChange} rows={2} className={inputClass(false)} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.answer_link')}</label>
                <input disabled={isViewMode} name="answer_link" value={formData.answer_link || ''} onChange={handleChange} className={inputClass(!!errors.answer_link)} placeholder={t('hook_form.answer_link_placeholder')} />
                <p className="mt-1 text-xs text-slate-400">{t('hook_form.answer_link_help')}</p>
                <InputError error={errors.answer_link} />
              </div>
            </div>
            )}
            {/* ==== [FEAT-20260802-AITABGROUPS] จบกลุ่มพับ #2 */}

                      {/* ── ปุ่มท้าย step: ย้อนกลับ + ต่อไป + ทดสอบขั้นตอนนี้ ──────────
                          ⚠️ ต้องระบุชนิดปุ่มเป็น button ทุกอัน — อยู่ใน <form> เดียวกับปุ่มบันทึก
                             ถ้าไม่ระบุ เบราว์เซอร์จะถือว่าเป็น submit แล้วเซฟทั้งฟอร์ม
                             ตอนผู้ใช้แค่กดเดินหน้า/ถอยหลัง step
                          ⚠️ ปุ่มหลักใช้ bg-primary-600 ทึบ (ชุดเดียวกับปุ่ม "บันทึก" ของ modal)
                             เดิมใช้ gradient violet→primary แล้วออกมาจางมาก ตัวหนังสือขาว
                             บนพื้นจางอ่านไม่ออก — คุมโทนให้ตรงกับปุ่มหลักอื่นของหน้านี้ */}
                      <div className="mt-6 pt-4 border-t border-slate-100 flex items-center gap-3">
                        {(() => {
                          const i = DOC_STEPS.findIndex(x => x.key === docStep);
                          const isFirst = i === 0;
                          const isLast = i === DOC_STEPS.length - 1;
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() => { if (!isFirst) setDocStep(DOC_STEPS[i - 1].key); }}
                                disabled={isFirst}
                                className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all inline-flex items-center gap-2"
                              >
                                <ArrowLeft size={16} />
                                {t('hook_form.doc_step_prev')}
                              </button>
                              <button
                                type="button"
                                onClick={() => { if (!isLast) setDocStep(DOC_STEPS[i + 1].key); }}
                                disabled={isLast}
                                className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 shadow-lg shadow-primary-500/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all inline-flex items-center gap-2"
                              >
                                {t('hook_form.doc_step_next')}
                                <ArrowRight size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDocTestOpen(true)}
                                className="px-4 py-2 rounded-lg border border-primary-500/30 bg-primary-500/5 text-primary-700 text-sm font-medium hover:bg-primary-500/10 transition-all inline-flex items-center gap-2"
                              >
                                <Bot size={16} />
                                {t('hook_form.doc_step_test')}
                              </button>
                            </>
                          );
                        })()}
                      </div>

                    </div>
                  </div>
                </div>
              </div>
              )}
              {/* ==== [FEAT-20260803-DOCSTEPS] END — จบ collapse "ตั้งค่า Training Doc" */}
          </div>

    </>
  );
};

export default HookAiTab;
