/**
 * [FEAT-20260918-AUTOSENDCONFIRM] The last look before a reply is translated and
 * sent to a customer.
 * ============================================================================
 * Owner, 18/09: *"ถ้าตั้งให้แปลตอนส่ง ต้องมี confirm ก่อนส่ง"*.
 *
 * ## Why this one screen is not optional
 *
 * With `auto_send_translated` on, pressing send does something the operator
 * cannot check: the draft is translated and the TRANSLATION — not what they
 * typed — is what the customer receives, in a language they may not read. There
 * is no preview of it (owner: *"ไม่ต้องพรีวิว แล้วส่งเลย"*) and no draft state to
 * come back to. So the confirm is the only moment the operator can still stop,
 * and it has to say plainly what is about to happen and in which language.
 * ส่งแล้วเรียกคืนไม่ได้ · จังหวะนี้คือจังหวะสุดท้ายที่ยังหยุดได้
 *
 * ## It shows the ORIGINAL, deliberately
 *
 * Showing a translation here would be a preview by another name — it would cost
 * a vendor call before the operator has agreed to spend one, and the owner asked
 * for no preview. What it shows is the text they typed and the language it will
 * leave in.
 *
 * Its own file from the start, per the FE anti-bloat rule: a self-contained
 * overlay that reads one piece of state and owns no form.
 *
 * revert: delete this file, its import, and the `autoSendConfirm` state and gate
 * in `ChatInputBox.tsx` — the send then translates without asking, which is the
 * behaviour the owner rejected.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Languages, X } from 'lucide-react';

import { useI18n } from '../../../i18n';
import { TRANSLATE_LANGUAGES } from '../../../config/translateLanguages';

export interface AutoSendConfirmProps {
  /** The draft exactly as typed — never a translation. */
  text: string;
  /** Language code the reply will be translated into, or null when unknown. */
  targetLang: string | null;
  /** @param remember — the operator ticked "จำค่านี้ไว้" on THIS confirm. */
  onConfirm: (remember: boolean) => void;
  onCancel: () => void;
}

export const AutoSendConfirm: React.FC<AutoSendConfirmProps> = ({
  text,
  targetLang,
  onConfirm,
  onCancel,
}) => {
  const { t } = useI18n();
  const okRef = useRef<HTMLButtonElement>(null);
  /* Local and unread from storage — see the checkbox's note below. */
  const [remember, setRemember] = useState(false);

  /* Esc cancels — the same escape hatch every other overlay here gives, and the
     safe direction: the default of doing nothing never sends anything. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    okRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /* The human name, not the code — `zh-Hant` tells an operator nothing. Read
     through i18n with the registry's own fallback, the same way every other
     language label in this app is resolved, and fall back to the raw code rather
     than hiding an unknown one. */
  const entry = TRANSLATE_LANGUAGES.find((l) => l.code === targetLang);
  const langName = entry
    ? t(entry.labelKey, entry.fallbackLabel)
    : (targetLang ?? null);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      data-testid="auto-send-confirm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-gray-800">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <Languages className="h-4 w-4 text-blue-500" />
            {t('composer_auto_send.confirm_title', 'แปลแล้วส่งให้ลูกค้าเลย?')}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('common.close', 'ปิด')}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-2 text-xs text-gray-600 dark:text-gray-300">
          {langName
            ? t(
                'composer_auto_send.confirm_desc',
                'ข้อความนี้จะถูกแปลเป็น {{lang}} แล้วส่งให้ลูกค้าทันที',
              ).replace('{{lang}}', String(langName))
            : t(
                'composer_auto_send.confirm_desc_nolang',
                'ยังไม่ทราบภาษาของลูกค้าในห้องนี้ ข้อความจะถูกส่งตามที่พิมพ์ไว้',
              )}
        </p>

        {/* What they typed — not a translation. See the header. */}
        <div
          className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200"
          data-testid="auto-send-confirm-text"
        >
          {text}
        </div>

        {/* [FEAT-20260918-AUTOSENDREMEMBER] beside ยกเลิก, per the owner's layout.
            🔴 UNCHECKED ON EVERY OPEN, by construction: the state is local to this
               component and the component is unmounted between confirms, so there
               is no way for a previous tick to pre-arm the next one. The box asks
               "remember MY answer", and the only answer worth remembering is the
               one about to be given — reading the saved value back into it would
               make an already-remembering operator see a ticked box in a dialog
               they should not be seeing at all.
            ⚠️ Ticking it alone changes nothing. It is consumed by แปลและส่ง, so
               ticking and then cancelling remembers NOTHING — cancel must stay a
               way out, not a way to configure something.
               ติ๊กแล้วกดยกเลิก = ไม่จำอะไรเลย */}
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              data-testid="auto-send-confirm-remember"
              className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t('composer_auto_send.confirm_remember', 'จำค่านี้ไว้ ไม่ต้องถามอีก')}
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              data-testid="auto-send-confirm-cancel"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {t('common.cancel', 'ยกเลิก')}
            </button>
            <button
              type="button"
              ref={okRef}
              onClick={() => onConfirm(remember)}
              data-testid="auto-send-confirm-ok"
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              {t('composer_auto_send.confirm_ok', 'แปลและส่ง')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
