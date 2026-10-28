/**
 * [FEAT-20260918-LANGFIRST] "เลือกภาษาก่อน" — the stop between step 4 and a
 * reply that goes out untranslated.
 * ============================================================================
 * Owner, 18/09: *"ถ้าเลือกเปิดระบบแปลออโต้ (ข้อ 4) แล้วกดเปิด โดยที่ข้อ 3 ยังไม่ตั้งค่า
 * ภาษา จะต้อง modal เตือนว่าให้เลือกภาษาในข้อ 3 ก่อน แล้วจึงค่อยกลับมาเลือกเปิดข้อ 4"*.
 *
 * ## Why the switch cannot just be allowed on
 *
 * Step 4 translates every reply into the CUSTOMER's language before sending it.
 * With no language known — none on the room and none on the OA — there is
 * nothing to translate into, and the send path does the only safe thing it can:
 * it delivers the draft exactly as typed. That is correct behaviour and it is
 * tested, but as a SETTING it is a lie: the switch reads "on" while nothing is
 * ever translated, and the operator finds out only from a customer.
 * เปิดสวิตช์ทั้งที่ไม่รู้ภาษาลูกค้า = สวิตช์ที่โกหก
 *
 * ## It fires on "nobody knows", not on "the room is empty"
 *
 * Step 4's own label is *"ใช้ภาษาของห้องแชท หรือ ภาษาหลัก OA (ตามลำดับ)"*, so a room
 * that named nothing while its OA did is perfectly fine — the reply has a target.
 * The check is therefore `outboundTargetLang(room) === null`, the same function
 * the send path calls, rather than a separate "is step 3 empty" test that would
 * nag about a setting that works. ถามเฉพาะตอนไม่มีใครรู้ภาษาลูกค้าเลย
 *
 * Its own file because `RoomTranslateWizardSteps.tsx` is already past the 400-line
 * warn line; adding an overlay there would push it further the wrong way.
 *
 * revert: delete this file and the `pendingAutoSendWarning` state plus the
 * guarded handler in `RoomTranslateModal.tsx`. Step 4 then switches on with no
 * language, which is the state the owner asked to prevent.
 */
import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

import { useI18n } from '../../../../../i18n';

export interface RoomLangRequiredNoticeProps {
  /** Jump to step 3 so the operator can choose one straight away. */
  onGoToLanguage: () => void;
  onClose: () => void;
}

export const RoomLangRequiredNotice: React.FC<RoomLangRequiredNoticeProps> = ({
  onGoToLanguage,
  onClose,
}) => {
  const { t } = useI18n();
  const goRef = useRef<HTMLButtonElement>(null);

  /* Esc closes and changes nothing — the switch stays off, which is the state
     that cannot mislead anyone. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    goRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
      data-testid="room-lang-required-notice"
      role="alertdialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xs rounded-xl bg-white p-4 shadow-xl dark:bg-gray-800">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t('room_translate_modal.lang_required_title', 'เลือกภาษาของลูกค้าก่อน')}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'ปิด')}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
          {t(
            'room_translate_modal.lang_required_desc',
            'ห้องนี้ยังไม่รู้ว่าลูกค้าใช้ภาษาอะไร และ OA ก็ยังไม่ได้ตั้งไว้ — เปิดข้อ 4 ตอนนี้ ข้อความจะถูกส่งตามที่พิมพ์โดยไม่แปล กรุณาเลือกภาษาที่ข้อ 3 ก่อน แล้วค่อยกลับมาเปิดข้อ 4',
          )}
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            data-testid="room-lang-required-cancel"
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t('common.cancel', 'ยกเลิก')}
          </button>
          <button
            type="button"
            ref={goRef}
            onClick={onGoToLanguage}
            data-testid="room-lang-required-go"
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
          >
            {t('room_translate_modal.lang_required_go', 'ไปเลือกภาษา (ข้อ 3)')}
          </button>
        </div>
      </div>
    </div>
  );
};
