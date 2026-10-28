/**
 * [FEAT-20260919-SHOWORIGSRC] Step 2 — "แสดงข้อความต้นฉบับ (Original)", on its own.
 * ============================================================================
 * WHY IT MOVED OUT, 19/09. Adding the source choice pushed
 * `RoomTranslateWizardSteps.tsx` from 400 code lines to 439 and tripped the
 * `max-lines` ratchet. dev-local §6.1 is explicit that the waiver list may only
 * shrink — a new warning means a file crossed the line and must be split, not
 * excused. Step 2 was the right cut regardless: it is the only step that now
 * reads from two different places (the room and the operator's account), so it
 * is the one with something to say for itself.
 *
 * MOVED VERBATIM. The markup, class strings and element order are byte-identical
 * to what sat inline; everything the block read from the wizard's scope became a
 * prop, and nothing else changed. Its behaviour is pinned by
 * `showOriginalSourceUi.dom.test.tsx`, which passed before the move and after.
 * ย้ายทั้งก้อน ไม่แก้มาร์กอัปสักตัว
 *
 * The three values it takes answer three different questions — see the block
 * that computes them in `RoomTranslateModal.tsx`. Collapsing any two produces a
 * control that lies about its own room.
 *
 * revert: paste the returned JSX back between steps 1 and 3 in
 * `RoomTranslateWizardSteps.tsx` and delete this file.
 */
import React from 'react';

import { useI18n } from '../../../../../i18n';
import type { ShowOriginalTextSource } from '../../../../../services/chat/showOriginalText';
import { AllRoomsShowOriginalSection } from './AllRoomsShowOriginalSection';
import { ShowOriginalSourceChoice } from './ShowOriginalSourceChoice';

export interface Step2ShowOriginalProps {
  currentStep: 1 | 2 | 3 | 4;
  onStepChange: (step: 1 | 2 | 3 | 4) => void;
  /** Id shared by the label and the switch — owned by the wizard's `useId`. */
  showOriginalId: string;
  /** What will ACTUALLY be shown. Badge and the "ตอนนี้" line only. */
  isShowOriginal: boolean;
  /** The room's OWN boolean. The switch, and what a click writes. */
  roomShowOriginal: boolean;
  /** Which side this room listens to. */
  showOriginalSource: ShowOriginalTextSource;
  /** The account-wide answer, for the hint under the first option. */
  allRoomsShowOriginal: boolean | null;
  onUpdateSettings?: (settings: {
    show_original_text?: boolean;
  }) => Promise<void> | void;
  onChangeShowOriginalSource?: (next: ShowOriginalTextSource) => void;
  /** Bubbles the account-wide value up so the modal can repaint with it. */
  onAllRoomsChanged?: (value: boolean | null) => void;
}

export const Step2ShowOriginal: React.FC<Step2ShowOriginalProps> = ({
  currentStep,
  onStepChange,
  showOriginalId,
  isShowOriginal,
  roomShowOriginal,
  showOriginalSource,
  allRoomsShowOriginal,
  onUpdateSettings,
  onChangeShowOriginalSource,
  onAllRoomsChanged,
}) => {
  const { t } = useI18n();

  return (
    <>
      {/* Step 2: แสดงข้อความต้นฉบับ (Original) */}
      <div className={`rounded-xl border transition-all ${
        currentStep === 2
          ? 'bg-white dark:bg-gray-750 border-sky-300 dark:border-sky-600 shadow-xs'
          : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200/70 dark:border-gray-700/60'
      }`}>
        <button
          type="button"
          data-testid="room-wizard-step-2-btn"
          onClick={() => onStepChange(2)}
          className="w-full flex items-center justify-between p-3 cursor-pointer text-left"
        >
          <div className="flex items-center gap-2.5">
            <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-colors ${
              currentStep === 2 ? 'bg-sky-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            }`}>
              2
            </span>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              {t('room_translate_modal.step2_title', 'แสดงข้อความต้นฉบับ (Original)')}
            </span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isShowOriginal ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
          }`}>
            {isShowOriginal ? t('room_translate_modal.status_active', 'เปิด') : t('room_translate_modal.status_inactive', 'ปิด')}
          </span>
        </button>

        {currentStep === 2 && (
          <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3 animate-in fade-in">
            {/* [FEAT-20260919-SHOWORIGSRC] The old copy read "ค่าเริ่มต้น: ปิด -
                แสดงเฉพาะคำแปล", which stopped being the whole story the moment
                there were two places this could be decided. Owner, 19/09:
                *"อธิบายใหม่ พร้อมเงื่อนไขใหม่ ให้เข้าใจ"*. It now says what the
                feature does, then where the answer comes from, then what happens
                when nobody has answered — which is the state every room is in. */}
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              {t(
                'room_translate_modal.step2_desc',
                'แสดงข้อความเดิมของลูกค้าควบคู่กับคำแปล · เลือกได้ว่าจะใช้ค่ากลางที่ตั้งครั้งเดียวแล้วมีผลทุกห้อง หรือตั้งเฉพาะห้องนี้ — ห้องที่ตั้งเองจะไม่สนค่ากลาง ถ้าไม่ตั้งทั้งสองอย่าง = ปิด แสดงเฉพาะคำแปล',
              )}
            </p>

            {/* บนสุดของ section ตามที่เจ้าของสั่ง — ตัวเลือกมาก่อนสวิตช์ที่มันคุม */}
            <ShowOriginalSourceChoice
              value={showOriginalSource}
              allRooms={allRoomsShowOriginal}
              onChange={(next) => onChangeShowOriginalSource?.(next)}
            />

            {/* 🔴 ONE CONTROL AT A TIME, AND IT IS THE ONE THAT IS IN CHARGE.
                Owner, 19/09, after seeing the first build: *"สำหรับทุกห้อง มันต้อง
                ยุใน section step 2 สิ … และแสดงก็ต่อเมื่อติ๊กใช้ตั้งค่าทุกห้อง ///
                toggle นี้แสดงเฉพาะ ติ๊กเฉพาะห้อง"*.

                The first build showed BOTH: the room's switch greyed out, and the
                account-wide value in a section of its own further down. The idea
                was that hiding a stored value is a surprise when it comes back.
                On screen it read worse than the problem it solved — two switches
                for one setting, one of them dead, and the live one somewhere else
                entirely. Now the chosen option reveals its own control directly
                beneath it and the other is not rendered at all, so what is on
                screen is always the thing that decides.

                The room's boolean is still KEPT when it is not shown — switching
                back to "ใช้ค่าเฉพาะห้องนี้" brings it back exactly as it was.
                Nothing is cleared by hiding it. ซ่อนเฉย ๆ ไม่ได้ล้างค่า */}
            {showOriginalSource === 'room' ? (
              <div className="flex items-center justify-between p-2.5 rounded-lg border bg-gray-50 dark:bg-gray-800/80 border-gray-100 dark:border-gray-700/60">
                <label htmlFor={showOriginalId} className="text-xs font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
                  {t('room_translate_modal.step2_title', 'แสดงข้อความต้นฉบับ (Original)')}
                  <span className="mt-0.5 block text-[10px] font-normal text-gray-500 dark:text-gray-400">
                    {t('room_translate_modal.step2_room_value_hint', 'ค่าของห้องนี้ ไม่ขึ้นกับค่าของทุกห้อง')}
                  </span>
                </label>
                <button
                  id={showOriginalId}
                  type="button"
                  role="switch"
                  aria-checked={roomShowOriginal}
                  data-testid="room-modal-show-original-toggle"
                  onClick={() => onUpdateSettings?.({ show_original_text: !roomShowOriginal })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                    roomShowOriginal ? 'bg-sky-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition mt-1 ml-1 ${
                    roomShowOriginal ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            ) : (
              <AllRoomsShowOriginalSection onChanged={onAllRoomsChanged} />
            )}

            {/* What the operator will actually see, said plainly — the badge on
                the collapsed header says the same thing, from the same value. */}
            <p
              data-testid="room-modal-show-original-effective"
              className="text-[10px] leading-relaxed text-gray-600 dark:text-gray-300 bg-sky-50/60 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 p-2 rounded-lg"
            >
              {isShowOriginal
                ? t('room_translate_modal.step2_effective_on', 'ตอนนี้: ห้องนี้จะแสดงข้อความต้นฉบับควบคู่กับคำแปล')
                : t('room_translate_modal.step2_effective_off', 'ตอนนี้: ห้องนี้จะแสดงเฉพาะคำแปล ไม่แสดงต้นฉบับ')}
            </p>
            <div className="flex justify-between pt-1">
              <button
                type="button"
                onClick={() => onStepChange(1)}
                data-testid="room-wizard-prev-2-btn"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors"
              >
                {t('room_translate_modal.btn_prev', 'ย้อนกลับ')}
              </button>
              <button
                type="button"
                onClick={() => onStepChange(3)}
                data-testid="room-wizard-next-2-btn"
                className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white cursor-pointer transition-colors"
              >
                {t('room_translate_modal.btn_next', 'ต่อไป')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
