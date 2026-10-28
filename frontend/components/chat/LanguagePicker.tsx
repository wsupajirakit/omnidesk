import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';


import { useFieldOptions } from '../../services/hook/useFieldOptions';
import { fieldOptionLabel } from '../hook/form/fieldOptionLabel';
import { useI18n } from '../../i18n';
import { translateErrorText } from '../../services/chat/aiTranslateService';
import { TranslateLoadingDots } from './TranslateLoadingDots';

/**
 * [FEAT-20260908-AITRANSLATE] Choose a language, confirm, and watch it run.
 * ===========================================================================
 * 🔴 ONE COMPONENT, TWO CALLERS, AND THE ONLY DIFFERENCE IS WHICH LANGUAGES.
 *
 * There were briefly two files — this list, and a `LanguagePickerModal` that
 * wrapped it — because the composer showed the list inline while the bubble
 * needed a modal. Then the composer became a modal too, and the wrapper's
 * reason to exist went with it. What was left was a second file plus `bare` and
 * `hideCancel`: props whose whole job was to undo styling that nothing rendered
 * any more. Owner, 09/09: *"ทำไมไม่ใช่คลาสเดียวกัน แยกทำไม สร้างหนี้ทำไม"* —
 * and *"สองจุดต่างกันแค่ option ไง"*. Both correct, so they are one file again.
 *
 * `only` and `exclude` went the same way: two words for one idea. `filter` says
 * it once.
 *
 *     bubble    filter={(c) => c === 'th'}    reading a customer, into Thai
 *     composer  filter={(c) => c !== 'th'}    writing to a customer, out of Thai
 *
 * ## 🔴 IT RENDERS IN A PORTAL, AND THAT IS A BUG FIX
 *
 * Mounted where it was called, the bubble's copy was a DOM child of the message
 * row — so a click on the dim backdrop bubbled up to that row's handler, which
 * clears the picker. The modal looked like it closed on an outside click even
 * after the backdrop's own handler was removed, because it was never the
 * backdrop closing it. A portal takes it out of that subtree entirely; no
 * ancestor can close it, clip it, or scroll it away.
 *
 * ## What it refuses to do
 *
 * Nothing dismisses it by accident. Owner: *"not allow click outside"* — the
 * backdrop is inert, and this modal can be MID-TRANSLATE, where a stray click
 * would abandon a request in flight with nothing left to report it. Escape and
 * the ยกเลิก button are the ways out, and both are deliberate acts.
 *
 * Nothing renders until it is mounted, and it is mounted only after a press:
 * `useFieldOptions` fetches on mount and says of itself "NOT CACHED,
 * deliberately", so an always-rendered picker would cost one request per room
 * opened by an operator who never translates.
 *
 * revert: delete this file and the two call sites; the chip and the composer
 *         button then have nothing to open.
 */
/* Re-exported from its new home so the many importers of this name keep
   working — the constant and the label lookup belong together. */
export { TRANSLATE_LANG_OPTION_KEY, langName } from './langName';
import { TRANSLATE_LANG_OPTION_KEY, langName } from './langName';



export const LanguagePicker: React.FC<{
  /** May be async. Awaited, so the spinner and the retry mean something. */
  onPick: (lang: string) => void | Promise<void>;
  onClose: () => void;
  /** Which codes this caller may offer. Absent ⇒ all of them. */
  filter?: (code: string) => boolean;
  /** Ask again, naming the language, before `onPick` runs. */
  confirm?: boolean;
}> = ({ onPick, onClose, filter, confirm }) => {
  const { t } = useI18n();
  /* mounted == open, so the fetch happens on open and nowhere else */
  const { options: all } = useFieldOptions(TRANSLATE_LANG_OPTION_KEY);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  /* 🔴 The registry is the source; `filter` narrows what THIS caller offers.
     A hardcoded list here would be a second language truth, which is the one
     thing this component was written to avoid. */
  const options = filter ? all.filter((o) => filter(o.value)) : all;

  /* Nothing to offer ⇒ nothing at all. Not an empty box, not a hardcoded
     fallback: an empty list means the BE has not shipped or the request failed,
     and every choice this could invent would be a guess. */
  if (options.length === 0 && !busy && !failed) return null;

  const run = async (lang: string) => {
    setBusy(true);
    setFailed(null);
    try {
      await onPick(lang);
    } catch (err) {
      /* One wording, one place. `translateErrorText` knows the timeout sentence
         and passes every server message through verbatim — a 429 says how long
         to wait, a 502 says the OA has no key. */
      setFailed(translateErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const ghost =
    'flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-[14px] text-slate-600 hover:bg-slate-50 transition-colors';
  const primary =
    'flex-1 rounded-lg bg-sky-600 px-4 py-2.5 text-[14px] font-bold text-white hover:bg-sky-700 transition-colors';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      /* No handler: the backdrop does not close. See the header. */
      role="presentation"
      data-testid="language-picker-modal"
    >
      <div className="flex w-[22rem] flex-col items-stretch rounded-2xl bg-white p-5 shadow-2xl">
        {busy ? (
          /* [FIX-20260909-LOADINGLOOK] The wait is the longest part of this
             feature — a vendor call with thinking enabled runs for seconds — so
             it gets a real panel rather than one grey line. Owner, 09/09: make
             it look like the AI loading elsewhere.
             ⚠️ The three dots are decoration; the spinner is the only thing that
             says "still running". Animation alone would be a lie if the request
             had already died, which is why the 20s deadline exists beside it. */
          <div
            className="flex flex-col items-center gap-3 px-2 py-8"
            data-testid="translate-busy"
          >
            {/* the four balls moved to ./TranslateLoadingDots — the composer
                strip waits for the same call and must look the same doing it */}
            <TranslateLoadingDots />
            <div className="text-sm font-bold text-slate-700">{t('ticketui.lang.translating', 'กำลังแปล…')}</div>
            <p className="px-2 text-center text-[12px] leading-relaxed text-slate-400">
              {t('ticketui.lang.wait_hint', 'ใช้เวลาสักครู่ · ถ้าเกิน 20 วินาทีจะขึ้นให้ลองใหม่')}
            </p>
          </div>
        ) : failed ? (
          <div data-testid="translate-failed">
            <div className="px-1 text-base font-bold text-rose-600">
              {t('ticketui.lang.failed', 'แปลไม่สำเร็จ')}
            </div>
            <p className="mt-2 px-1 text-[13px] leading-relaxed text-slate-600 break-words whitespace-pre-wrap">
              {failed}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className={primary}
                data-testid="translate-failed-ok"
              >
                {t('ticketui.room.lang_ok', 'ตกลง')}
              </button>
              {chosen && (
                <button
                  type="button"
                  onClick={() => void run(chosen as string)}
                  data-testid="translate-retry"
                  className={ghost}
                >
                  {t('ticketui.common.retry', 'ลองใหม่')}
                </button>
              )}
            </div>
          </div>
        ) : chosen !== null && confirm ? (
          <div data-testid="translate-confirm">
            <div className="px-1 text-base font-bold text-slate-700">
              {t('ticketui.lang.confirm_title', 'ยืนยันการแปล')}
            </div>
            <p className="mt-2 px-1 text-[13px] leading-relaxed text-slate-600">
              {t('ticketui.lang.confirm_pre', 'แปลเป็น')}{' '}
              <span className="font-bold text-slate-800">
                {langName(chosen, t)}
              </span>{' '}
              {t('ticketui.lang.confirm_post', 'ใช่ไหม')}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                /* back to the list, not out — a wrong pick costs one press */
                onClick={() => setChosen(null)}
                className={ghost}
              >
                {t('ticketui.common.back', 'ย้อนกลับ')}
              </button>
              <button
                type="button"
                onClick={() => void run(chosen)}
                data-testid="translate-confirm-ok"
                className={primary}
              >
                {t('common.confirm', 'ยืนยัน')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-1 pb-3 text-base font-bold text-slate-700">
              {t('ticketui.lang.pick_title', 'แปลเป็นภาษา')}
            </div>
            <div
              role="listbox"
              aria-label={t('ticketui.lang.pick_aria', 'เลือกภาษาที่จะแปล')}
              className="max-h-72 w-full overflow-y-auto"
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setChosen(o.value);
                    if (!confirm) void run(o.value);
                  }}
                  /* a border each, so a row looks pressable before the pointer
                     arrives — a hover tint alone does not */
                  className="mb-2 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-left text-[14px] text-slate-700 transition-colors hover:border-sky-300 hover:bg-sky-50"
                >
                  {fieldOptionLabel(o, t)}
                </button>
              ))}
            </div>
            {/* separated and bordered: as the last ROW of the list this read as
                one more language, and it is now the only way out. */}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-2.5 text-[14px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              {t('common.cancel', 'ยกเลิก')}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default LanguagePicker;
