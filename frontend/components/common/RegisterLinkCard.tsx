/**
 * ==== [FEAT-20260729-REGCARD] START — new file
 * 🔒 AUTO track — to_dev_auto branch only
 *
 * Preview of the "ลงทะเบียนสมาชิก" Flex card the bot sends when a customer types
 * `customer-register`.
 *
 * ── Why a dedicated component instead of FlexSlipCard ────────────────────────
 * FlexSlipCard renders a bubble by looking the template up in the flex_messages
 * collection (that's how slip cards work). This card has no row there — it is
 * built in code by webhookController.buildCustomerRegisterFlex(), so there is
 * nothing for FlexSlipCard to find. The layout also never varies, and the only
 * dynamic part is the link.
 *
 * ── The link is deliberately NOT clickable ───────────────────────────────────
 * ลิงก์ในการ์ดเป็นของลูกค้าคนนั้นคนเดียว — token ผูกกับ user id และหมดอายุใน 30 นาที
 * ถ้าแอดมินกดจะเผาลิงก์ทิ้งหรือไปผูกบัญชีทับของลูกค้าได้ · ที่นี่จึงเป็น "ดูได้ กดไม่ได้"
 * (chat history เก็บแค่ placeholder text อยู่แล้ว ตัว URL ไม่เคยถูกส่งมาฝั่งนี้)
 *
 * Keep this in sync with buildCustomerRegisterFlex() in legacy-api
 * (src/controllers/webhookController.js) if the real card ever changes.
 *
 * revert: delete this file + the branch that renders it in ChatRoomView.tsx
 * ==== [FEAT-20260729-REGCARD] END
 */
import React from 'react';

import { useI18n } from '../../i18n';

export const RegisterLinkCard: React.FC = () => {
  const { t } = useI18n();
  return (
  <div className="w-full max-w-[380px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-md overflow-hidden text-left my-1">
    <div className="flex flex-col px-4 py-3 gap-2">
      <div className="border-t border-slate-200 dark:border-slate-700" />

      {/* Same copy as the real card — size "lg", centered, wrapped */}
      <p className="text-center text-[15px] leading-relaxed text-slate-800 dark:text-slate-100 py-1">
        ผู้ใช้งานสามารถลงทะเบียนสมาชิก โดยการกดปุ่มสีเขียวนี้
      </p>

      <div className="border-t border-slate-200 dark:border-slate-700" />

      {/* Looks like the real primary button, but is inert on purpose */}
      <div
        aria-disabled="true"
        title={t('pageui.common.reg_card_tip', 'ลิงก์นี้ใช้ได้เฉพาะลูกค้าคนนี้ — แอดมินกดไม่ได้')}
        className="w-full h-9 rounded-md bg-emerald-600/90 text-white text-[14px] font-bold
                   flex items-center justify-center select-none cursor-not-allowed"
      >
        ลงทะเบียน
      </div>

      <div className="border-t border-slate-200 dark:border-slate-700" />

      <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
        {t('pageui.common.reg_card_caption', 'ตัวอย่างการ์ดที่ลูกค้าได้รับ · ลิงก์เฉพาะบุคคล กดจากหน้านี้ไม่ได้')}
      </p>
    </div>
  </div>
  );
};
