/**
 * [FEAT-20260918-ROOMTRANS] RoomTranslateModal.tsx — 4-Step Vertical Wizard Translation Settings Modal.
 * ====================================================================================================
 * Step Wizard (1 to 4) shown above, Hook settings (Read-only LINE OA defaults) shown below.
 * Amber styled notice border for LINE OA defaults per user requirement.
 * Single Source of Truth languages with full bidirectional documentation.
 *
 * Dev-local: max-lines < 400, role directories (room-header/parts/), zero bloat.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Languages, X, Info } from 'lucide-react';
import { isAutoTranslateOn, type RoomAutoTranslateFields } from '../../../../../services/chat/roomAutoTranslate';
/* [FEAT-20260918-LANGFIRST] the same resolver the SEND path uses, so the warning
   fires exactly when a reply would have gone out untranslated. */
import { outboundTargetLang } from '../../../../../services/chat/outboundTranslateTarget';
/* [FEAT-20260919-SHOWORIGSRC] the one rule that joins the room's column with the
   account-wide preference — the bubbles and the popover read the same one. */
import {
  normalizeShowOriginalSource,
  readShowOriginalAllRooms,
  resolveShowOriginalText,
  type ShowOriginalTextSource,
} from '../../../../../services/chat/showOriginalText';
import { RoomLangRequiredNotice } from './RoomLangRequiredNotice';
/* [FEAT-20260918-SCROLLHINT] the up/down guide over the scrolling body. */
import { ScrollHintArrows } from './ScrollHintArrows';
import { TRANSLATE_LANGUAGES } from '../../../../../config/translateLanguages';
import { ChatRoom } from '../../../../../services/chat';
import { useI18n } from '../../../../../i18n';
import { ConfirmModal } from '../../../../modals';
import { RoomTranslateWizardSteps } from './RoomTranslateWizardSteps';

export interface RoomTranslateModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: ChatRoom | null;
  onUpdateSettings?: (settings: {
    translate_lang?: string | null;
    show_original_text?: boolean;
    show_original_text_source?: ShowOriginalTextSource;
    auto_translate?: boolean | null;
    auto_send_translated?: boolean;
  }) => Promise<void> | void;
}

export const RoomTranslateModal: React.FC<RoomTranslateModalProps> = ({
  isOpen,
  onClose,
  room,
  onUpdateSettings,
}) => {
  const { t, isEnglish } = useI18n();
  /* [FEAT-20261022-I18NPAGESEN] language names follow the UI (English UI → nameEn) */
  const langName = (l: { nameTh: string; nameEn: string }) => (isEnglish ? l.nameEn : l.nameTh);

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const currentLang = room?.translate_lang ?? '';
  const [selectedLang, setSelectedLang] = useState<string>(currentLang);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    setSelectedLang(currentLang);
  }, [currentLang, isOpen]);

  useEffect(() => {
    if (!isOpen || showConfirmModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showConfirmModal, onClose]);

  /* 🔴 EVERY HOOK MUST SIT ABOVE `if (!isOpen) return null` BELOW.
     These three lived under it for one build and took the chat page down with
     React #310 ("Rendered more hooks than during the previous render"): a closed
     modal ran five hooks, an open one ran eight, and the first open threw.
     A conditional return is a hook boundary — anything added to this component
     goes here, above it. hook ทุกตัวต้องอยู่เหนือ early return เสมอ */
  /* [FEAT-20260918-LANGFIRST] open while step 4 was switched on with no language
     anywhere. Nothing is saved until the operator has one. */
  const [langRequired, setLangRequired] = useState(false);
  /* [FEAT-20260918-SCROLLHINT] the body is what scrolls, so the arrows watch it
     rather than the window. */
  const bodyRef = useRef<HTMLDivElement>(null);

  /* [FEAT-20260919-SHOWORIGSRC] The account-wide "แสดงข้อความต้นฉบับ" answer.
     Held in state rather than read at render because section 5 can change it
     while the modal is open, and step 2 above it must repaint in the same tick —
     the two halves of one setting cannot be allowed to disagree on screen even
     for a moment. Seeded on mount; `isOpen` in the dependency list re-seeds it
     when the modal is reopened after another device changed it.
     ⚠️ This hook sits here, ABOVE the early return, for the reason spelled out
     in the block above. */
  const [allRoomsShowOriginal, setAllRoomsShowOriginal] = useState<boolean | null>(
    () => readShowOriginalAllRooms(),
  );
  useEffect(() => {
    if (isOpen) setAllRoomsShowOriginal(readShowOriginalAllRooms());
  }, [isOpen]);

  /* Guards ONLY the step-4 switch turning ON; every other setting — including
     turning it OFF — passes straight through untouched, so the warning can never
     trap an operator who is trying to undo it.
     ดักเฉพาะตอน "เปิด" ข้อ 4 · ปิดหรือแก้อย่างอื่นผ่านได้ตามปกติ */
  const guardedUpdateSettings = useCallback(
    async (settings: Parameters<NonNullable<typeof onUpdateSettings>>[0]) => {
      const turningAutoSendOn = settings?.auto_send_translated === true;
      if (turningAutoSendOn && !outboundTargetLang(room as never)) {
        setLangRequired(true);
        return;
      }
      await onUpdateSettings?.(settings);
    },
    [onUpdateSettings, room],
  );

  if (!isOpen) return null;

  const hookAutoTranslate = Boolean((room as any)?.hook_auto_translate);
  const hookTranslateLangCode = (room as any)?.hook_translate_lang || null;
  const hookLangObj = TRANSLATE_LANGUAGES.find((l) => l.code === hookTranslateLangCode);

  /* [FIX-20260918-AUTOTRANSOR] TWO different questions, and they must not be
     collapsed into one value:
       · `roomAutoTranslate` — what THIS ROOM asks for. It drives the switch, and
         it is what a click writes back. Binding the switch to the effective
         answer instead makes a dead control: with the room off and the OA on it
         would render ON, and turning it "off" would change nothing visible.
       · `isAutoTranslate`   — what will ACTUALLY happen, shared with the chat
         header so the badge and the room screen always agree.
     สวิตช์ = ค่าของห้อง · ป้ายสถานะ = ผลจริง */
  const roomAutoTranslate = Boolean(room?.auto_translate);
  const isAutoTranslate = isAutoTranslateOn(room as RoomAutoTranslateFields);
  /* [FEAT-20260919-SHOWORIGSRC] Three values, and they answer three different
     questions — collapsing any two of them produces a control that lies:
       · `showOriginalSource`  — which side this room listens to. Drives the
         radio pair at the top of step 2.
       · `roomShowOriginal`    — the room's OWN boolean. Drives the switch, and
         it is what a click writes back. It keeps its value while the room
         follows the shared setting, so switching back restores it.
       · `isShowOriginal`      — what the operator will ACTUALLY see, shared with
         the bubbles through `resolveShowOriginalText`. Drives the badge only.
     สามค่านี้ตอบคนละคำถาม ห้ามยุบรวม */
  const showOriginalSource = normalizeShowOriginalSource(
    (room as any)?.show_original_text_source,
  );
  const roomShowOriginal = room?.show_original_text === true;
  const isShowOriginal = resolveShowOriginalText({
    source: showOriginalSource,
    roomValue: room?.show_original_text,
    allRooms: allRoomsShowOriginal,
  });
  const isAutoSend = Boolean(room?.auto_send_translated);
  const isLangChanged = selectedLang !== currentLang;
  const selectedTargetLangObj = TRANSLATE_LANGUAGES.find((l) => l.code === selectedLang);

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-translate-modal-title"
      data-testid="room-translate-modal-backdrop"
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
      /* [FEAT-20260919-NOOUTSIDECLOSE] Owner, 19/09: *"not allow outside click"*.
         The backdrop used to close on click. This modal is a five-section form
         whose body scrolls, so a press that lands just outside the panel — or a
         drag that starts inside a control and releases on the backdrop — used to
         throw the whole thing away mid-edit. Nothing here is unsaved (each
         control writes on change), but losing your place in a wizard is its own
         cost, and the language step has a confirm dialog that a stray backdrop
         click could dismiss underneath.
         Deliberately still closeable, in the two ways that are unambiguous: the
         ✕ button in the header, the "เสร็จสิ้น" button in the footer, and Esc
         (a key press is a decision, a click near the edge often is not).
         ปิดได้ด้วยปุ่ม X / เสร็จสิ้น / Esc เท่านั้น คลิกนอกไม่ปิด
         revert: put the `onClick` that compared `e.target === e.currentTarget`
         back on this element. */
    >
      <div
        /* The `onClick` that used to stop propagation here went with the
           backdrop's close handler above — with nothing listening on the parent,
           it only made clicks inside the panel harder to reason about. */
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden my-auto"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-800/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400">
              <Languages size={18} />
            </div>
            <div>
              <h2 id="room-translate-modal-title" className="text-sm font-bold text-gray-900 dark:text-white">
                {t('room_translate_modal.title', 'ตั้งค่าแปลภาษาห้องแชท')}
              </h2>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {t('room_translate_modal.subtitle', 'การตั้งค่าเฉพาะของห้องนี้ (ห้องแชท)')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body.
            🔴 THE SCROLLER KEEPS THE EXACT SIZING IT ALWAYS HAD: a flex child
            with `flex-1 overflow-y-auto`. Two earlier attempts changed it and
            each broke the modal in a different way —
              · `overflow-hidden` wrapper + `h-full` scroller ⇒ nothing overflowed
                at all, so it could not be scrolled and the arrows correctly
                stayed hidden while the bottom was clipped;
              · `absolute inset-0` scroller ⇒ the body left the flow entirely and
                the modal collapsed to header + footer.
            The wrapper added here only takes over that same flex role
            (`flex-1 min-h-0 flex flex-col`) and exists for one reason: the arrows
            must sit OUTSIDE the scrolling element, or they scroll away with the
            content they point at. ของเดิมสัมพันธ์กันยังไง ต้องคงไว้เป๊ะ */}
        <div className="relative flex-1 min-h-0 flex flex-col">
        <ScrollHintArrows targetRef={bodyRef} />
        <div ref={bodyRef} className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
          {/* Vertical Step Wizard (Above) */}
          <RoomTranslateWizardSteps
            currentStep={currentStep}
            onStepChange={setCurrentStep}
            room={room}
            hookAutoTranslate={hookAutoTranslate}
            hookLangObj={hookLangObj}
            isAutoTranslate={isAutoTranslate}
            roomAutoTranslate={roomAutoTranslate}
            isShowOriginal={isShowOriginal}
            roomShowOriginal={roomShowOriginal}
            showOriginalSource={showOriginalSource}
            allRoomsShowOriginal={allRoomsShowOriginal}
            onChangeShowOriginalSource={(next) =>
              guardedUpdateSettings({ show_original_text_source: next })
            }
            /* [FEAT-20260919-SHOWORIGSRC] the account-wide control moved INSIDE
               step 2 on 19/09 (owner: it belongs with the option that reveals
               it), so the modal no longer renders a section of its own — it only
               keeps the value, because step 2's hint and the effective line both
               read it. */
            onAllRoomsChanged={setAllRoomsShowOriginal}
            isAutoSend={isAutoSend}
            selectedLang={selectedLang}
            onSelectLang={setSelectedLang}
            isLangChanged={isLangChanged}
            onCancelLangChange={() => setSelectedLang(currentLang)}
            onConfirmLangSave={() => setShowConfirmModal(true)}
            onUpdateSettings={guardedUpdateSettings}
          />

        {/* [FEAT-20260918-LANGFIRST] shown instead of saving when step 4 was
            switched on with no language on the room and none on the OA. "ไปเลือก
            ภาษา" jumps to step 3; closing leaves the switch exactly as it was. */}
        {langRequired && (
          <RoomLangRequiredNotice
            onClose={() => setLangRequired(false)}
            onGoToLanguage={() => {
              setLangRequired(false);
              setCurrentStep(3);
            }}
          />
        )}

          {/* Section: LINE OA (Hook) - อยู่ด้านล่างของ Step Wizard */}
          <div
            data-testid="room-modal-hook-section"
            className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200/80 dark:border-gray-700/60 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-gray-800 dark:text-gray-200">
                <Info size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
                <span>{t('room_translate_modal.hook_section_title', 'การตั้งค่า LINE OA (Hook)')}</span>
              </div>
            </div>

            {/* Warning note with nice amber/orange border */}
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-800 dark:text-amber-200">
              <Info size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed font-medium">
                {t('room_translate_modal.hook_section_desc', 'ค่าเริ่มต้น OA (แสดงอย่างเดียว หากต้องการแก้ไขให้ไปที่หน้าจัดการ Hook)')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200/70 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400 block text-[10px]">
                  {t('room_translate_modal.hook_auto_translate', 'แปลภาษาออโต้ OA')}
                </span>
                <span
                  data-testid="room-modal-hook-auto-status"
                  className={`inline-flex items-center gap-1 font-semibold mt-0.5 ${
                    hookAutoTranslate ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${hookAutoTranslate ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                  {hookAutoTranslate ? t('room_translate_modal.status_active', 'เปิดใช้งาน') : t('room_translate_modal.status_inactive', 'ปิดใช้งาน')}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200/70 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400 block text-[10px]">
                  {t('room_translate_modal.hook_lang', 'ภาษาหลัก OA')}
                </span>
                <span data-testid="room-modal-hook-lang-status" className="font-semibold text-gray-800 dark:text-gray-200 mt-0.5 block truncate">
                  {hookLangObj ? `${hookLangObj.flag} ${langName(hookLangObj)}` : t('room_translate_modal.hook_lang_unset', 'ยังไม่ได้ตั้งค่า')}
                </span>
              </div>
            </div>

            <p className="text-[10px] text-gray-600 dark:text-gray-300 leading-relaxed bg-sky-50/60 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 p-2 rounded-lg">
              {t(
                'room_translate_modal.priority_tip',
                'ลำดับความสำคัญ: การตั้งค่าเฉพาะห้องแชทจะมีความสำคัญสูงสุด หากห้องแชทไม่ได้กำหนดไว้ ระบบจะใช้ค่าเริ่มต้นจาก LINE OA นี้โดยอัตโนมัติ',
              )}
            </p>
          </div>
        </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-5 py-3.5 border-t border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-800/80 shrink-0">
          <button
            type="button"
            onClick={onClose}
            data-testid="room-modal-close-btn"
            className="text-sm font-semibold px-6 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white shadow-sm hover:shadow-md transition-all active:scale-95 cursor-pointer"
          >
            {t('room_translate_modal.done', 'เสร็จสิ้น')}
          </button>
        </div>
      </div>

      {/* Confirm Save Modal */}
      <ConfirmModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={async () => {
          await onUpdateSettings?.({ translate_lang: selectedLang ? selectedLang : null });
          setShowConfirmModal(false);
        }}
        title={t('room_translate_modal.confirm_title', 'ยืนยันเปลี่ยนภาษาของห้องแชท')}
        message={t(
          'room_translate_modal.confirm_message',
          'คุณต้องการเปลี่ยนภาษาของห้องแชทนี้เป็น "{lang}" ใช่หรือไม่?',
        ).replace(
          '{lang}',
          selectedTargetLangObj
            ? `${selectedTargetLangObj.flag} ${langName(selectedTargetLangObj)}`
            : t('room_translate_modal.step3_use_oa_default', 'ตามค่าเริ่มต้นของ LINE OA'),
        )}
        confirmLabel={t('room_translate_modal.confirm_btn', 'ยืนยันบันทึก')}
        cancelLabel={t('room_translate_modal.btn_cancel', 'ยกเลิก')}
        type="info"
      />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
