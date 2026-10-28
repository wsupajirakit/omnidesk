import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import type { HookFormData } from '../../../../types/hook';
import type { HookFormTabCtx } from './hookFormTabCtx';
import {
  AI_VENDORS,
  asAiVendor,
} from '../../../../config/aiVendors';
import { SecretLockButtons } from '../secretLock';
import {
  DeepSeekReasoningFields,
  GeminiTranslateBudgetField,
} from './AiReasoningFields';
import { GeminiKnobsFields } from './GeminiKnobsFields';
import { VendorBox } from './VendorBox';
import { HookTranslateFields } from './HookTranslateFields';

/**
 * [P2-20260813] Per-hook AI vendor + model.
 *
 * Its own file rather than more markup inside HookAiTab.tsx, which is already
 * well over the 400-line ceiling and on the eslint waiver list, which may only
 * shrink. แยกไฟล์ตั้งแต่แรก ไม่ยัดไฟล์ที่เต็มแล้ว.
 * ⚠️ ห้ามเขียนจำนวนบรรทัดเป๊ะ ๆ ลงคอมเมนต์อีก — เลข "1,027" ที่เคยอยู่ตรงนี้ค้างมา
 *    ตั้งแต่ 13/08 ทั้งที่ไฟล์โตไปถึง 1,128 แล้ว · ตัวเลขที่ผิดแย่กว่าไม่มีตัวเลข
 *
 * Empty option = "use the default", stored as null. The BE resolves null to the
 * default vendor and that vendor's family model, which is what every hook does
 * today, so leaving both untouched changes nothing.
 *
 * ⚠️ Uses an inline setFormData rather than the shared handleChange: that
 *    helper writes the raw event value, so an empty option would store `''`
 *    instead of null and the BE would reject it as an unknown vendor.
 *
 * revert: delete this file and its two lines in HookAiTab.tsx.
 */

/**
 * [FIX-20260828-AIVENDORTRUTH] รายชื่อ vendor ย้ายไป `config/aiVendors.ts` แล้ว
 *
 * 🔴 เดิมประกาศไว้ในไฟล์นี้แบบ module-private ⇒ หน้าจออื่นที่ต้องให้เลือก vendor
 *    (เช่น bulk) เอาไปใช้ไม่ได้ ต้องก๊อปรายชื่อไปวางเอง · เจ้าของสั่ง 28/08 ให้มี
 *    แหล่งเดียว ไม่งั้นวันที่เพิ่ม vendor ตัวที่สามจะมีที่ต้องแก้หลายที่ และที่ที่ลืม
 *    จะกลายเป็นเมนูที่ขาดตัวเลือกโดยไม่มีอะไรฟ้อง
 * ⚠️ ห้ามประกาศรายชื่อ vendor กลับมาที่ไฟล์นี้อีก — import จากที่เดียวเท่านั้น
 *
 * เหตุผลเดิมที่ต้องล็อก type ยังอยู่ (ย้ายไปกับรายชื่อ): `ctx.formData` เป็น `any`
 * การผูกกับ union ของ `HookFormData['ai_vendor']` คือสิ่งเดียวที่ทำให้ชื่อ vendor
 * ที่พิมพ์ผิดเป็น error ตอน compile แทนที่จะไปโผล่ตอนผู้ใช้กดเซฟ
 */

/**
 * [FEAT-20260904-VENDORSECCOL] The DeepSeek pair renders HERE, not in HookAiTab.
 *
 * HookAiTab is over the 400 ceiling and on the eslint waiver list, which may only
 * shrink, so nothing new may be added to it. This file already owns "which vendor,
 * and what does that vendor need", which is exactly what the second pair is.
 * ของใหม่ห้ามยัดไฟล์ที่เต็มแล้ว
 * (09/09 การย้าย custom_ai_key ออกมาทำให้ HookAiTab หดจริง 848 → 800 บรรทัดที่ eslint นับ)
 *
 * ⚠️ (ยกเลิกแล้ว 09/09 — ดู AITABVENDORSPLIT ข้างล่าง) เดิมบล็อกนี้โผล่เฉพาะตอนเลือก
 *    deepseek เท่านั้น และนั่นเป็นกติกา "การแสดงผล" ไม่ใช่ "ข้อมูล": สลับกลับไป gemini
 *    แล้วมันแค่ถูกซ่อน ไม่ได้ถูกล้าง · ซ่อน ≠ ลบ
 */

/**
 * [FEAT-20260909-AITABVENDORSPLIT] ค่ายละกล่อง และทั้งสองกล่องโผล่ตลอดเวลา
 * ===========================================================================
 * เจ้าของ 09/09: *"แท็บ ai > advance ให้แบ่ง div deepseek + div gemini (ขึ้นบน)
 * แบ่งให้แสดงตลอดเวลาเลย แบ่งค่าใครค่ามันให้เข้าใจง่าย"*
 *
 * 🔴 ทำไมกติกา `isDeepSeek &&` เดิมต้องหายไป — ไม่ใช่เรื่องความสวยงาม:
 *    ตอนที่ hook หนึ่งตัว = ค่ายเดียว การซ่อนคู่ของ DeepSeek ตอนเลือก gemini นั้นถูกต้อง
 *    แต่พอเริ่มมี "ค่ายหลัก" กับ "ค่ายที่ใช้แปลภาษา" แยกกัน (ดู §12 ของแผน chattrans)
 *    คู่ที่พบบ่อยที่สุดคือ **หลัก = gemini · แปล = deepseek** ⇒ ต้องกรอกคีย์ทั้งสองค่าย
 *    แต่จอเดิม **ไม่มีช่องให้วางคีย์ DeepSeek เลย** เพราะมันถูกซ่อนตาม ai_vendor
 *    ⇒ ตั้งค่าให้ถูกจากหน้าจอไม่ได้ · การเอากติกาซ่อนออกคือ "ตัวฟีเจอร์" ไม่ใช่ผลข้างเคียง
 *
 * 🔴 โผล่ ≠ เขียน · เหมือนที่ ซ่อน ≠ ลบ
 *    กล่อง DeepSeek ที่โผล่ขึ้นมาทั้งที่เลือก gemini อยู่ ต้องยัง **ไม่ส่งอะไรเลย**
 *    ถ้าคนใช้ไม่ได้พิมพ์ลงไป · ตัวตัดสินเรื่องนี้ไม่ได้อยู่ในไฟล์นี้ — เป็น diff ตอน submit
 *    (`buildHookPayload`) ที่ส่งเฉพาะ field ที่ค่าเปลี่ยนจากตอนโหลด และมันไม่เคยดู
 *    ai_vendor ประกอบเลย ⇒ การเรนเดอร์เพิ่มจึงไม่ทำให้ payload โตขึ้นแม้แต่ key เดียว
 *    ⚠️ ปักหมุดไว้ที่ `hookFormPayload.test.ts` — เคส `'custom_ai_key_sec' in out === false`
 *
 * ⚠️ `custom_ai_key` (คีย์ของ Gemini) **ย้ายมาจาก `HookAiTab.tsx`** ทั้งก้อน มาอยู่ในกล่อง
 *    Gemini · ย้ายทั้งบล็อกแบบยกมา ไม่ได้พิมพ์ใหม่ — ข้างในมีไอคอนตา 2 ฝั่ง (`pl-10 pr-10`),
 *    `SecretLockButtons` พร้อม `offsetClass` ที่คำนวณจากสถานะปลดล็อก, คลาส error และ `*`
 *    บังคับกรอก · ก๊อปด้วยมือแล้วตกปุ่มล็อกไป = คีย์ที่เสียเงินจริงถูกเขียนทับ ซึ่งเป็น
 *    อุบัติเหตุที่ [FEAT-20260817-SECRETLOCK] ถูกสร้างขึ้นมาเพื่อกัน
 *
 * ⚠️ หัวข้อกล่องใช้คีย์ i18n ที่ **มีอยู่แล้ว** (`hook_form.ai_vendor_gemini` /
 *    `..._deepseek` — ตัวเดียวกับที่เมนูด้านบนใช้เป็นชื่อตัวเลือก) ไม่ได้ตั้งคีย์ใหม่
 *    ⇒ ชื่อค่ายบนหัวกล่องกับในเมนูจะเพี้ยนกันไม่ได้ตลอดไป
 *
 * revert: ใส่ `{isDeepSeek && ( … )}` กลับคลุมกล่อง DeepSeek, ย้ายบล็อก custom_ai_key
 *   กลับไปที่ marker [FIX-20260731-AIKEYTOP] ใน HookAiTab.tsx แล้วลบกล่องทั้งสอง
 */
export const AiVendorSelect: React.FC<{ ctx: HookFormTabCtx }> = ({ ctx }) => {
  const {
    formData,
    setFormData,
    isViewMode,
    t,
    inputClass,
    errors,
    handleChange,
    secretLock,
    showCustomAiKey,
    setShowCustomAiKey,
  } = ctx;

  /* กล่องหนึ่งค่าย — คลาสเดียวกับกล่องปุ่มหมุน (temperature/top_k/…) ใน HookAiTab
     เพื่อให้แท็บนี้มีสำนวนกล่องเดียว ไม่ใช่กรอบใหม่ต่อฟีเจอร์ */
  const boxClass =
    'md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 bg-dark-900/50 p-6 rounded-2xl border border-dark-700';
  const boxTitleClass =
    'md:col-span-2 text-sm font-bold text-slate-700 border-b border-dark-700 pb-2';

  return (
    <>
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-slate-500 mb-1">
          {t('hook_form.ai_vendor')}
        </label>
        <select
          disabled={isViewMode}
          name="ai_vendor"
          value={formData.ai_vendor || ''}
          onChange={(e) => {
            /* 🔴 READ THE VALUE NOW, NOT INSIDE THE UPDATER.
               `setFormData`'s callback runs later, and by then React has already
               reset a controlled select's DOM value — so `e.target.value` read
               in there can be `''` when the operator picked a vendor. It
               happens to work today because React runs the updater inside the
               same batch, but nothing guarantees that, and it is invisible
               until it isn't: the save silently clears the field.
               Measured while writing this file's spec — the DOM value was `''`
               immediately after the change event. */
            const next = asAiVendor(e.target.value);
            // '' → null so the BE reads it as "use the default vendor".
            setFormData((prev: Record<string, unknown>) => ({
              ...prev,
              ai_vendor: next,
            }));
          }}
          className={inputClass(false, 'bg-white')}
        >
          <option value="">{t('hook_form.ai_vendor_default')}</option>
          {AI_VENDORS.map((v) => (
            <option key={v.value} value={v.value}>
              {t(v.labelKey)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500/80">
          {t('hook_form.ai_vendor_hint')}
        </p>
      </div>

      {/* [FEAT-20260909-VENDORTRANSLATE] The TRANSLATE lane's own vendor.
          Sits directly under the main one and above both vendor boxes, because
          the two selects are the question ("which AI?") and the boxes are the
          answers ("and here is that AI's key").

          🔴 EMPTY MEANS "FOLLOW THE MAIN ONE", NOT "THE SYSTEM DEFAULT". Those
             are different answers: every OA that predates this column reads as
             empty and must keep translating on whatever it already answers
             with. `asAiVendor` turns '' into null and the BE reads null as
             "follow `ai_vendor`".

          ⚠️ INLINE setFormData, NOT the shared `handleChange` — the same reason
             the select above it does so. That helper writes the raw event
             value, so the empty option would store '' and the BE would reject
             it as an unknown vendor name.

          ⚠️ NO SEPARATE VENDOR LIST. `AI_VENDORS` is the one source
             (`config/aiVendors.ts` says so at :31-37 and a test guards it), so
             a third vendor appears in both selects from one edit.

          revert: delete this block; the lane falls back to `ai_vendor`, which
                  is what every hook does today. */}
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-slate-500 mb-1">
          {t('hook_form.ai_vendor_translate')}
        </label>
        <select
          disabled={isViewMode}
          name="ai_vendor_translate"
          value={formData.ai_vendor_translate || ''}
          onChange={(e) => {
            /* Read now, not inside the updater — see the note on the select
               above. Same hazard, same cure. */
            const next = asAiVendor(e.target.value);
            setFormData((prev: Record<string, unknown>) => ({
              ...prev,
              ai_vendor_translate: next,
            }));
          }}
          className={inputClass(false, 'bg-white')}
        >
          <option value="">
            {t('hook_form.ai_vendor_translate_default')}
          </option>
          {AI_VENDORS.map((v) => (
            <option key={v.value} value={v.value}>
              {t(v.labelKey)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500/80">
          {t('hook_form.ai_vendor_translate_hint')}
        </p>
      </div>

      {/* [FEAT-20260918-HOOKTRANS] Chat translation settings (primary language & auto-translate toggle) */}
      <HookTranslateFields ctx={ctx} />

      {/* ══ กล่องที่ 1 · Gemini — ai_model + custom_ai_key · โผล่เสมอ ══════════ */}
      <VendorBox
        title={t('hook_form.ai_vendor_gemini')}
        testId="ai-vendor-box-gemini"
      >

        <div>
          <label className="block text-sm font-medium text-slate-500 mb-1">
            {t('hook_form.ai_model')}
          </label>
          <input
            type="text"
            disabled={isViewMode}
            name="ai_model"
            value={formData.ai_model || ''}
            placeholder={t('hook_form.ai_model_placeholder')}
            onChange={(e) =>
              setFormData((prev: Record<string, unknown>) => ({
                ...prev,
                // Blank means "this OA has no preference" → the vendor's default.
                // Trimmed: the vendor matches model ids exactly, so stray padding
                // would fail at the API with an unhelpful error.
                ai_model: e.target.value.trim() || null,
              }))
            }
            className={inputClass(false)}
          />
          <p className="mt-1 text-xs text-slate-500/80">
            {t('hook_form.ai_model_hint')}
          </p>
        </div>

        {/* ==== [FIX-20260731-AIKEYTOP] · ย้ายมาจาก HookAiTab.tsx ทั้งบล็อก 09/09
            เนื้อในไม่ถูกแก้แม้แต่ตัวอักษรเดียว — ย้ายที่วางอย่างเดียว เหมือนตอนที่มัน
            ถูกย้ายมาจากท้ายแท็บเมื่อ 31/07 · เปลี่ยนแค่คลาสของ div นอกสุด จาก
            `md:col-span-2` (เต็มแถวในกริดของแท็บ) เป็นไม่มี = 1 ช่องในกริดของกล่องนี้
            ⚠️ ที่ห้ามแตะคือข้างใน: ปุ่มตา 2 ฝั่ง, `pl-10 pr-10`, SecretLockButtons
               พร้อม offsetClass และ `*` บังคับกรอก
            revert: ย้าย div นี้กลับไปที่ marker เดียวกันใน HookAiTab.tsx */}
        <div>
          <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.custom_ai_key')} <span className="text-red-500">*</span></label>
          {/* [FEAT-20260803-AIKEYMASK] ปิดบังค่า + ปุ่มตาเปิดดู
              WHY  This is an API key that costs money if it leaks, and it sat in a
              plain text input — fully readable to anyone glancing at the screen
              during a screen-share or standing behind the desk. Every other secret
              on this form (channel secret, access token, external password) was
              already masked; this one was simply missed.
              ⚠️ ใช้กติกาเดียวกับ channel_secret (type สลับ + โหมดดูอย่างเดียวไม่โชว์ปุ่ม)
                 ต่างกันแค่ **มีปุ่มตา 2 ฝั่ง** ตามที่ผู้ใช้สั่ง 2026-08-03:
                 ช่องนี้กินเต็มแถว (md:col-span-2) ตาที่ขวาสุดจึงอยู่ไกลจากจุดที่
                 สายตาอยู่ตอนอ่านค่า — กดฝั่งไหนก็ได้ ผลเหมือนกันทั้งคู่
              ⚠️ pl-10 + pr-10 กันตัวหนังสือวิ่งไปทับปุ่มทั้งสองข้าง
              ⚠️ ปุ่มซ้ายต้อง aria-hidden + tabIndex -1 — เป็นปุ่มซ้ำของปุ่มขวา
                 ถ้าไม่กัน คนใช้คีย์บอร์ด/screen reader จะเจอปุ่มเดียวกัน 2 รอบ
              revert: คืน <input> บรรทัดเดียวแบบเดิม + ลบ state showCustomAiKey */}
          <div className="relative">
            {!isViewMode && (
              <button
                type="button"
                onClick={() => setShowCustomAiKey(prev => !prev)}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                aria-hidden="true"
                tabIndex={-1}
              >
                {showCustomAiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
            <input
              disabled={isViewMode}
              readOnly={secretLock.isLocked('custom_ai_key')}
              name="custom_ai_key"
              value={secretLock.displayValue('custom_ai_key', formData.custom_ai_key || '')}
              onChange={handleChange}
              className={inputClass(!!errors.custom_ai_key, isViewMode ? '' : (secretLock.isLocked('custom_ai_key') ? 'pl-10 pr-16 opacity-80' : 'pl-10 pr-10'))}
              type={showCustomAiKey ? 'text' : 'password'}
            />
            {/* [FEAT-20260817-SECRETLOCK] this key wiped demo-shop when its
                editable box carried the placeholder — locked until แก้ไข */}
            {!isViewMode && (
              <SecretLockButtons field="custom_ai_key" lock={secretLock}
                editLabel={t('common.edit')} cancelLabel={t('common.cancel')}
                offsetClass={secretLock.isUnlocked('custom_ai_key') ? 'right-10' : 'right-2'} />
            )}
            {!isViewMode && (
              <button
                type="button"
                onClick={() => setShowCustomAiKey(prev => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                aria-label={showCustomAiKey ? t('user.form_password_hide') : t('user.form_password_show')}
              >
                {showCustomAiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
          </div>
        </div>
        {/* ==== [FIX-20260731-AIKEYTOP] END */}

        {/* [FEAT-20260909-DSREASONING] Gemini's TRANSLATE-lane thinking budget.
            Its MAIN-lane twin (`gemini_thinking_budget`) stays where it is, in
            `HookAiTab.tsx`, on the live reply path — moving it would be a
            migration on a running system for symmetry alone. */}
        {/* [FEAT-20260909-AITABVENDORSPLIT] Gemini's four generation knobs moved
            here from `HookAiTab.tsx` — they are Gemini values (DeepSeek has no
            top_k at all) and belong beside Gemini's model and key.
            Owner, 09/09: the GENERAL section comes before the translate one. */}
        <GeminiKnobsFields ctx={ctx} />
        <GeminiTranslateBudgetField ctx={ctx} />
      </VendorBox>

      {/* ══ กล่องที่ 2 · DeepSeek — ai_model_sec + custom_ai_key_sec ═══════════
          [FEAT-20260904-VENDORSECCOL] คู่ของ DeepSeek
          🔴 [FEAT-20260909-AITABVENDORSPLIT] ไม่มี `{isDeepSeek && …}` คลุมแล้ว —
             กล่องนี้ต้องโผล่แม้ตอนที่ ai_vendor เป็น gemini เพราะนั่นคือเคสที่
             "หลัก gemini · แปล deepseek" ต้องใช้ · ดูเหตุผลเต็มที่หัวไฟล์ */}
      <VendorBox
        title={t('hook_form.ai_vendor_deepseek')}
        testId="ai-vendor-box-deepseek"
      >

        <div>
          <label className="block text-sm font-medium text-slate-500 mb-1">
            {t('hook_form.ai_model_sec')}
          </label>
          <input
            type="text"
            disabled={isViewMode}
            name="ai_model_sec"
            value={formData.ai_model_sec || ''}
            placeholder={t('hook_form.ai_model_sec_placeholder')}
            onChange={(e) =>
              setFormData((prev: Record<string, unknown>) => ({
                ...prev,
                // Blank ⇒ DeepSeek's family default (`deepseek-v4-flash`
                // since [FIX-20260909-DSMODELID]; `deepseek-chat` turned out to
                // be an undocumented alias for it).
                ai_model_sec: e.target.value.trim() || null,
              }))
            }
            className={inputClass(false)}
          />
          <p className="mt-1 text-xs text-slate-500/80">
            {t('hook_form.ai_model_sec_hint')}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-500 mb-1">
            {t('hook_form.custom_ai_key_sec')}
          </label>
          {/* Masked + locked exactly like `custom_ai_key`: it is a paid API key,
              and an editable box carrying the stored placeholder is what wiped a
              live key once already ([FEAT-20260817-SECRETLOCK]). */}
          <div className="relative">
            <input
              disabled={isViewMode}
              readOnly={secretLock.isLocked('custom_ai_key_sec')}
              name="custom_ai_key_sec"
              value={secretLock.displayValue(
                'custom_ai_key_sec',
                formData.custom_ai_key_sec || '',
              )}
              onChange={handleChange}
              className={inputClass(
                !!errors.custom_ai_key_sec,
                isViewMode
                  ? ''
                  : secretLock.isLocked('custom_ai_key_sec')
                    ? 'pr-16 opacity-80'
                    : 'pr-2',
              )}
              type="password"
            />
            {!isViewMode && (
              <SecretLockButtons
                field="custom_ai_key_sec"
                lock={secretLock}
                editLabel={t('common.edit')}
                cancelLabel={t('common.cancel')}
              />
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500/80">
            {t('hook_form.custom_ai_key_sec_hint')}
          </p>
        </div>

        {/* [FEAT-20260909-DSREASONING] BOTH lanes, because DeepSeek had neither.
            Main first — it is the one that answers customers. The two write
            different columns; the component computes the suffix so no call site
            can name one and get it wrong. */}
        <DeepSeekReasoningFields ctx={ctx} lane="main" />
        <DeepSeekReasoningFields ctx={ctx} lane="translate" />
      </VendorBox>
    </>
  );
};

export default AiVendorSelect;
