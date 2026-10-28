/**
 * [FEAT-20260919-SHOWORIGSRC] "ค่านี้เอามาจากไหน" — the choice that sits above the switch.
 * ============================================================================
 * Owner, 19/09: *"fe ยุใน section เดียวกันกับข้อสอง และขึ้นบนสุดค่าใหม่"* — this
 * goes at the TOP of step 2, above the on/off switch, because it decides whether
 * that switch means anything at all. Putting it underneath would show an
 * operator a control, let them flip it, and only then explain that the room was
 * not listening to it. ตัวเลือกต้องมาก่อนสวิตช์ที่มันคุม
 *
 * ## Why the switch stays visible when the room follows the shared value
 *
 * Hiding it would be tidier and worse. The room keeps its own boolean either
 * way, and an operator who switches back to "เฉพาะห้องนี้" gets that value
 * again — so hiding it makes a stored setting invisible and its later return
 * surprising. It is dimmed and disabled instead, with the shared value shown
 * beside it, which says "this exists, it is just not the one in charge".
 * ปิดการใช้งานให้เห็น ดีกว่าซ่อนแล้วโผล่มาทีหลัง
 *
 * Its own file: `RoomTranslateWizardSteps.tsx` is well past the 400-line warn
 * line (dev-local §6.1) and this owns a self-contained piece of markup with no
 * state of its own.
 *
 * revert: delete this file and its use in step 2. Step 2 then shows only the
 * switch, which is the 18/09 layout.
 */
import React from 'react';
import { Check, Globe2, Home } from 'lucide-react';

import { useI18n } from '../../../../../i18n';
import type { ShowOriginalTextSource } from '../../../../../services/chat/showOriginalText';

export interface ShowOriginalSourceChoiceProps {
  /** Normalised already by the caller — this component does not guess. */
  value: ShowOriginalTextSource;
  /** What the account-wide setting currently says, for the hint line. */
  allRooms: boolean | null;
  onChange: (next: ShowOriginalTextSource) => void;
}

export const ShowOriginalSourceChoice: React.FC<ShowOriginalSourceChoiceProps> = ({
  value,
  allRooms,
  onChange,
}) => {
  const { t } = useI18n();

  const allRoomsSummary =
    allRooms === true
      ? t('room_translate_modal.step2_all_rooms_on', 'ตอนนี้ตั้งไว้ว่า "เปิด"')
      : allRooms === false
        ? t('room_translate_modal.step2_all_rooms_off', 'ตอนนี้ตั้งไว้ว่า "ปิด"')
        : t('room_translate_modal.step2_all_rooms_unset', 'ยังไม่ได้ตั้ง = ปิด');

  const options: Array<{
    key: ShowOriginalTextSource;
    icon: React.ReactNode;
    label: string;
    hint: string;
    testId: string;
  }> = [
    {
      key: 'all_rooms',
      icon: <Globe2 size={14} className="shrink-0" />,
      label: t('room_translate_modal.step2_source_all_rooms', 'ใช้การตั้งค่าของทุกห้อง'),
      hint: allRoomsSummary,
      testId: 'room-modal-show-original-source-all',
    },
    {
      key: 'room',
      icon: <Home size={14} className="shrink-0" />,
      label: t('room_translate_modal.step2_source_room', 'ใช้ค่าเฉพาะห้องนี้'),
      hint: t(
        'room_translate_modal.step2_source_room_hint',
        'ตั้งเองด้านล่าง ไม่สนค่าของทุกห้อง',
      ),
      testId: 'room-modal-show-original-source-room',
    },
  ];

  return (
    <div role="radiogroup" aria-label={t('room_translate_modal.step2_source_group', 'แหล่งที่มาของค่า')} className="space-y-1.5">
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={opt.testId}
            onClick={() => onChange(opt.key)}
            className={`w-full flex items-start gap-2 p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
              active
                ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/40'
            }`}
          >
            <span
              className={`mt-0.5 flex items-center justify-center w-4 h-4 rounded-full border shrink-0 ${
                active
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'border-gray-300 dark:border-gray-600'
              }`}
            >
              {active && <Check size={10} strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`flex items-center gap-1.5 text-xs font-medium ${
                  active
                    ? 'text-sky-800 dark:text-sky-200'
                    : 'text-gray-800 dark:text-gray-200'
                }`}
              >
                {opt.icon}
                {opt.label}
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                {opt.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
};
