/**
 * [FEAT-20260918-ROOMTRANS] RoomTranslateWizardSteps.tsx — 4-Step Vertical Wizard for Chat Room Translation Settings.
 * ====================================================================================================================
 * Step 1: แปลภาษาออโต้ (ข้อความที่เข้ามา)
 * Step 2: แสดงข้อความต้นฉบับ (Original)
 * Step 3: ภาษาของห้องแชท (icon รูปโลกไว้หลัง label)
 * Step 4: แปลและส่งอัตโนมัติ (label: ใช้ภาษาของห้องแชท หรือ ภาษาหลัก OA (ตามลำดับ))
 *
 * Dev-local: role directory (room-header/parts/), max-lines < 400, modular extracted component.
 */
import React, { useId } from 'react';
import { Globe, Info } from 'lucide-react';
import { AutoSendConfirmPrefToggle } from './AutoSendConfirmPrefToggle';
/* [FEAT-20260919-SHOWORIGSRC] step 2's own values travel through here to its file. */
import type { ShowOriginalTextSource } from '../../../../../services/chat/showOriginalText';
import { Step2ShowOriginal } from './Step2ShowOriginal';
import { Step4LangSummary } from './Step4LangSummary';
import { TRANSLATE_LANGUAGES, TranslateLanguage } from '../../../../../config/translateLanguages';
import { ChatRoom } from '../../../../../services/chat';
import { useI18n } from '../../../../../i18n';

export interface RoomTranslateWizardStepsProps {
  currentStep: 1 | 2 | 3 | 4;
  onStepChange: (step: 1 | 2 | 3 | 4) => void;
  room: ChatRoom | null;
  hookAutoTranslate: boolean;
  hookLangObj: TranslateLanguage | undefined;
  /** What will ACTUALLY happen — room OR hook. Drives the status badge. */
  isAutoTranslate: boolean;
  /** What THIS ROOM asks for. Drives the switch and what a click writes. */
  roomAutoTranslate: boolean;
  /**
   * [FEAT-20260919-SHOWORIGSRC] What will ACTUALLY be shown — the room's own
   * boolean or the account-wide one, already resolved by the caller. Drives the
   * status badge, so the badge cannot disagree with the chat bubbles.
   */
  isShowOriginal: boolean;
  /** The room's OWN boolean. Drives the switch and what a click writes back. */
  roomShowOriginal: boolean;
  /** Which of the two the room is currently listening to. */
  showOriginalSource: ShowOriginalTextSource;
  /** The account-wide answer, for the hint under "ใช้การตั้งค่าของทุกห้อง". */
  allRoomsShowOriginal: boolean | null;
  isAutoSend: boolean;
  selectedLang: string;
  onSelectLang: (lang: string) => void;
  isLangChanged: boolean;
  onCancelLangChange: () => void;
  onConfirmLangSave: () => void;
  onUpdateSettings?: (settings: {
    translate_lang?: string | null;
    show_original_text?: boolean;
    show_original_text_source?: ShowOriginalTextSource;
    auto_translate?: boolean | null;
    auto_send_translated?: boolean;
  }) => Promise<void> | void;
  /** Called when step 2 switches the room between the two sources. */
  onChangeShowOriginalSource?: (next: ShowOriginalTextSource) => void;
  /** [FEAT-20260919-SHOWORIGSRC] step 2 now hosts the account-wide control too. */
  onAllRoomsChanged?: (value: boolean | null) => void;
}

export const RoomTranslateWizardSteps: React.FC<RoomTranslateWizardStepsProps> = ({
  currentStep,
  onStepChange,
  room,
  hookAutoTranslate,
  hookLangObj,
  isAutoTranslate,
  roomAutoTranslate,
  isShowOriginal,
  roomShowOriginal,
  showOriginalSource,
  allRoomsShowOriginal,
  isAutoSend,
  selectedLang,
  onSelectLang,
  isLangChanged,
  onCancelLangChange,
  onConfirmLangSave,
  onUpdateSettings,
  onChangeShowOriginalSource,
  onAllRoomsChanged,
}) => {
  const { t, isEnglish } = useI18n();
  /* [FEAT-20261022-I18NPAGESEN] language names follow the UI (English UI → nameEn) */
  const langName = (l: { nameTh: string; nameEn: string }) => (isEnglish ? l.nameEn : l.nameTh);
  const autoTranslateId = useId();
  const showOriginalId = useId();
  const langSelectId = useId();
  const autoSendId = useId();

  const selectedTargetLangObj = TRANSLATE_LANGUAGES.find((l) => l.code === selectedLang);

  return (
    <div className="space-y-3">
      {/* Step 1: แปลภาษาออโต้ (ข้อความที่เข้ามา) */}
      <div className={`rounded-xl border transition-all ${
        currentStep === 1
          ? 'bg-white dark:bg-gray-750 border-sky-300 dark:border-sky-600 shadow-xs'
          : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200/70 dark:border-gray-700/60'
      }`}>
        <button
          type="button"
          data-testid="room-wizard-step-1-btn"
          onClick={() => onStepChange(1)}
          className="w-full flex items-center justify-between p-3 cursor-pointer text-left"
        >
          <div className="flex items-center gap-2.5">
            <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-colors ${
              currentStep === 1 ? 'bg-sky-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            }`}>
              1
            </span>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              {t('room_translate_modal.step1_title', 'แปลภาษาออโต้ (ข้อความที่เข้ามา)')}
            </span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isAutoTranslate ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
          }`}>
            {isAutoTranslate ? t('room_translate_modal.status_active', 'เปิด') : t('room_translate_modal.status_inactive', 'ปิด')}
          </span>
        </button>

        {currentStep === 1 && (
          <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3 animate-in fade-in">
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('room_translate_modal.step1_desc', 'แปลข้อความภาษาต่างประเทศของลูกค้าให้อัตโนมัติ (ข้อความไทยจะแสดงปกติโดยไม่ส่งแปล)')}
            </p>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/80 border border-gray-100 dark:border-gray-700/60">
              <div>
                <label htmlFor={autoTranslateId} className="text-xs font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
                  {t('room_translate_modal.step1_title', 'แปลภาษาออโต้ (ข้อความที่เข้ามา)')}
                </label>
                {/* [FIX-20260918-AUTOTRANSOR] shown whenever THIS ROOM's switch is
                    off — which is the only time the OA's setting decides. It used
                    to appear only for a `null` room, a value that barely exists
                    now that the column defaults to `false`, so the one case an
                    operator needs this sentence for was the one case without it:
                    switch off, OA on, messages translating anyway.
                    ปิดที่ห้อง = ใช้ค่าของ OA · ต้องบอกให้เห็นว่า OA เปิดหรือปิดอยู่ */}
                {!roomAutoTranslate ? (
                  <span
                    data-testid="room-modal-auto-translate-fallback-hint"
                    className={`block text-[10px] font-medium mt-0.5 ${
                      hookAutoTranslate
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {hookAutoTranslate
                      ? t(
                          'room_translate_modal.step1_fallback_hook_on',
                          'ปิดที่ห้องนี้ = ใช้การตั้งค่าระดับ OA ซึ่งเปิดอยู่ ⇒ ยังแปลให้อัตโนมัติ',
                        )
                      : t(
                          'room_translate_modal.step1_fallback_hook_off',
                          'ปิดที่ห้องนี้ = ใช้การตั้งค่าระดับ OA ซึ่งปิดอยู่ ⇒ ไม่แปล',
                        )}
                  </span>
                ) : null}
              </div>
              <button
                id={autoTranslateId}
                type="button"
                role="switch"
                aria-checked={roomAutoTranslate}
                data-testid="room-modal-auto-translate-toggle"
                onClick={() => onUpdateSettings?.({ auto_translate: !roomAutoTranslate })}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                  roomAutoTranslate ? 'bg-sky-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition mt-1 ml-1 ${
                  roomAutoTranslate ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => onStepChange(2)}
                data-testid="room-wizard-next-1-btn"
                className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white cursor-pointer transition-colors"
              >
                {t('room_translate_modal.btn_next', 'ต่อไป')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* [FEAT-20260919-SHOWORIGSRC] Step 2 lives in its own file — see its header
          for why it moved (the max-lines ratchet, and the fact that it is the one
          step reading from two places). Markup unchanged. */}
      <Step2ShowOriginal
        currentStep={currentStep}
        onStepChange={onStepChange}
        showOriginalId={showOriginalId}
        isShowOriginal={isShowOriginal}
        roomShowOriginal={roomShowOriginal}
        showOriginalSource={showOriginalSource}
        allRoomsShowOriginal={allRoomsShowOriginal}
        onUpdateSettings={onUpdateSettings}
        onChangeShowOriginalSource={onChangeShowOriginalSource}
        onAllRoomsChanged={onAllRoomsChanged}
      />

      {/* Step 3: ภาษาของห้องแชท (icon รูปโลกไว้หลัง label) */}
      <div className={`rounded-xl border transition-all ${
        currentStep === 3
          ? 'bg-white dark:bg-gray-750 border-sky-300 dark:border-sky-600 shadow-xs'
          : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200/70 dark:border-gray-700/60'
      }`}>
        <button
          type="button"
          data-testid="room-wizard-step-3-btn"
          onClick={() => onStepChange(3)}
          className="w-full flex items-center justify-between p-3 cursor-pointer text-left"
        >
          <div className="flex items-center gap-2.5">
            <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-colors ${
              currentStep === 3 ? 'bg-sky-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            }`}>
              3
            </span>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
              {t('room_translate_modal.step3_title', 'ภาษาของห้องแชท')}
              <Globe size={14} className="text-sky-600 dark:text-sky-400" />
            </span>
          </div>
          <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
            {selectedTargetLangObj ? `${selectedTargetLangObj.flag} ${langName(selectedTargetLangObj)}` : t('room_translate_modal.step3_use_oa_default', 'ตาม LINE OA')}
          </span>
        </button>

        {currentStep === 3 && (
          <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3 animate-in fade-in">
            {/* [FIX-20260918-NOAUTOHINT] the "อัปเดตอัตโนมัติเมื่อตรวจพบ" note is gone
                (owner, 18/09). It described the DETECTED language, which is now its
                own field and its own line in step 4's summary — next to a picker
                that stores a person's DECLARATION it read as a promise that this
                choice would be overwritten. คนละค่ากัน ไม่ควรอยู่ข้างช่องที่คนเลือกเอง */}
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              <span>{t('room_translate_modal.step3_desc', 'ระบุภาษาของลูกค้าในห้องนี้ เพื่อใช้แปลและตอบกลับ')}</span>
            </div>
            <select
              id={langSelectId}
              value={selectedLang}
              data-testid="room-modal-lang-select"
              onChange={(e) => onSelectLang(e.target.value)}
              className="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-sky-500"
            >
              <option value="">
                {t('room_translate_modal.step3_use_oa_default', '(ใช้ตามค่าเริ่มต้นของ LINE OA)')}
                {hookLangObj ? ` : ${hookLangObj.flag} ${langName(hookLangObj)}` : ''}
              </option>
              {TRANSLATE_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {isEnglish ? lang.nameEn : <>{lang.nameTh} ({lang.nameEn})</>}
                </option>
              ))}
            </select>

            {isLangChanged && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
                <span className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                  {t('room_translate_modal.unsaved_changes', 'มีการเปลี่ยนภาษา กรุณากดยืนยันบันทึก')}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="room-modal-cancel-lang-btn"
                    onClick={onCancelLangChange}
                    className="text-xs px-2.5 py-1 rounded-md text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700"
                  >
                    {t('room_translate_modal.btn_cancel', 'ยกเลิก')}
                  </button>
                  <button
                    type="button"
                    data-testid="room-modal-save-lang-btn"
                    onClick={onConfirmLangSave}
                    className="text-xs font-semibold px-3 py-1 rounded-md bg-sky-600 hover:bg-sky-700 text-white"
                  >
                    {t('room_translate_modal.btn_save', 'บันทึก')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-1">
              <button
                type="button"
                onClick={() => onStepChange(2)}
                data-testid="room-wizard-prev-3-btn"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors"
              >
                {t('room_translate_modal.btn_prev', 'ย้อนกลับ')}
              </button>
              <button
                type="button"
                onClick={() => onStepChange(4)}
                data-testid="room-wizard-next-3-btn"
                className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white cursor-pointer transition-colors"
              >
                {t('room_translate_modal.btn_next', 'ต่อไป')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step 4: แปลและส่งอัตโนมัติ */}
      <div className={`rounded-xl border transition-all ${
        currentStep === 4
          ? 'bg-white dark:bg-gray-750 border-sky-300 dark:border-sky-600 shadow-xs'
          : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200/70 dark:border-gray-700/60'
      }`}>
        <button
          type="button"
          data-testid="room-wizard-step-4-btn"
          onClick={() => onStepChange(4)}
          className="w-full flex items-center justify-between p-3 cursor-pointer text-left"
        >
          <div className="flex items-center gap-2.5">
            <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-colors ${
              currentStep === 4 ? 'bg-sky-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            }`}>
              4
            </span>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              {t('room_translate_modal.step4_title', 'แปลและส่งออโต้')}
            </span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isAutoSend ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
          }`}>
            {isAutoSend ? t('room_translate_modal.status_active', 'เปิด') : t('room_translate_modal.status_inactive', 'ปิด')}
          </span>
        </button>

        {currentStep === 4 && (
          <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/80 border border-gray-100 dark:border-gray-700/60">
              <label htmlFor={autoSendId} className="text-xs font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
                {t('room_translate_modal.step4_switch', 'เปิดระบบแปลและส่งออโต้')}
              </label>
              <button
                id={autoSendId}
                type="button"
                role="switch"
                aria-checked={isAutoSend}
                data-testid="room-modal-auto-send-toggle"
                onClick={() => onUpdateSettings?.({ auto_send_translated: !isAutoSend })}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                  isAutoSend ? 'bg-sky-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition mt-1 ml-1 ${
                  isAutoSend ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>

            {/* [FEAT-20260918-LANGSUMMARY] was one sentence describing the RULE
                ("ใช้ภาษาของห้องแชท หรือ ภาษาหลัก OA ตามลำดับ") — true, and it answered
                none of the one question an operator has here: what language will
                my replies leave in. Now it names both levels with their flags and
                the resolved answer. Own file: this one is past 400 lines. */}
            <Step4LangSummary room={room as never} />

            {/* [FEAT-20260918-CONFIRMPREFUI] the account-level "ไม่ต้องถามอีก".
                It belongs here because this is the step whose send raises that
                confirm, and because the tick inside the confirm hides the confirm
                — leaving nowhere else to undo it. */}
            <AutoSendConfirmPrefToggle />

            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed flex items-start gap-1">
              <Info size={13} className="shrink-0 mt-0.5 text-sky-500" />
              <span>
                {t('room_translate_modal.step4_desc', 'เมื่อเปิดใช้งาน ทุกข้อความที่คุณพิมพ์จะถูกแปลเป็นภาษาของห้องแชทและส่งให้ลูกค้าทันที')}
              </span>
            </p>

            <div className="flex justify-start pt-1">
              <button
                type="button"
                onClick={() => onStepChange(3)}
                data-testid="room-wizard-prev-4-btn"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors"
              >
                {t('room_translate_modal.btn_prev', 'ย้อนกลับ')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
