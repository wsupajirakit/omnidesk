/**
 * [FEAT-20260919-SHOWORIGSRC] "ค่าที่ใช้กับทุกห้อง" — the other half of step 2.
 * ============================================================================
 * Owner, 19/09: *"ปิด (ทุกห้อง) > save ค่า preference · เปิด (ทุกห้อง) > save ค่า
 * preference"* with *"default ค่า preference ใหม่นี้ คือ null ไม่ปิด ไม่เปิด"* — and
 * then, after seeing the first build on screen: *"สำหรับทุกห้อง มันต้องยุใน section
 * step 2 สิ … และแสดงก็ต่อเมื่อติ๊กใช้ตั้งค่าทุกห้อง"*.
 *
 * ## Where it lives, and why it moved
 *
 * It first shipped as a section of its own below the four steps. The reasoning
 * was sound as far as it went: every other control in this modal writes to THIS
 * ROOM, this one writes to the logged-in account, and mixing them invites an
 * operator to change every conversation they have open while believing they
 * changed one. What that reasoning missed is how it reads on a screen — two
 * switches for a single setting, the room's one greyed out in step 2 and the
 * live one in a different section further down.
 *
 * It now sits INSIDE step 2, rendered only when the room is set to follow it, so
 * the control on screen is always the one in charge. The scope warning did not
 * become less true by moving, so the copy still states it twice: in the subtitle
 * here and again in the tip under the switch.
 * ค่าระดับบัญชี ไม่ใช่ค่าของห้อง ต้องบอกให้ชัดกว่าหนึ่งที่
 *
 * ## Three states, two of which look identical on screen
 *
 * The stored value is `true` / `false` / `null`, where `null` means the operator
 * has never answered. `null` and `false` both render the switch as off — and
 * both produce "no original text" — so the difference is invisible unless it is
 * spelled out. It matters, because `null` is the state every account is in right
 * now and the one a room's "ใช้การตั้งค่าของทุกห้อง" falls through to. The status
 * line therefore says which of the two it is, and "ล้างค่า" is offered only when
 * something has actually been set. ยังไม่ตั้ง กับ ตั้งว่าปิด ได้ผลเหมือนกัน แต่ไม่ใช่เรื่องเดียวกัน
 *
 * ## Saving is immediate, in every direction
 *
 * There is no save button in this modal — every other control writes on click —
 * so each press goes straight through `rememberShowOriginalAllRooms`, which
 * updates the local caches synchronously and persists behind them. `onChanged`
 * lets the modal repaint the rooms that follow this value in the same tick.
 *
 * Its own file per dev-local §6.1, and it stays one now that it is nested:
 * `Step2ShowOriginal.tsx` would be past the warn line with this inlined, and
 * this is the only piece in the modal holding account-scoped state.
 *
 * revert: delete this file and the `else` branch in `Step2ShowOriginal`. The
 * preference then has no UI and every room falls back to off.
 */
import React, { useState } from 'react';
import { Globe2, Info } from 'lucide-react';

import { useI18n } from '../../../../../i18n';
import {
  readShowOriginalAllRooms,
  rememberShowOriginalAllRooms,
} from '../../../../../services/chat/showOriginalText';

export interface AllRoomsShowOriginalSectionProps {
  /** Called after every save so the open room can re-resolve immediately. */
  onChanged?: (value: boolean | null) => void;
}

export const AllRoomsShowOriginalSection: React.FC<AllRoomsShowOriginalSectionProps> = ({
  onChanged,
}) => {
  const { t } = useI18n();
  /* Read once on mount — the modal mounts this when it opens, so it reflects the
     value as it stands at that moment. */
  const [value, setValue] = useState<boolean | null>(() => readShowOriginalAllRooms());

  const write = (next: boolean | null) => {
    setValue(next);
    rememberShowOriginalAllRooms(next);
    onChanged?.(next);
  };

  const isOn = value === true;

  return (
    <div
      data-testid="room-modal-all-rooms-section"
      className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200/80 dark:border-gray-700/60 space-y-2.5"
    >
      <div className="flex items-center gap-1.5 text-xs font-bold text-gray-800 dark:text-gray-200">
        <Globe2 size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
        <span>{t('room_translate_modal.all_rooms_title', 'ค่าที่ใช้กับทุกห้อง')}</span>
      </div>

      <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        {t(
          'room_translate_modal.all_rooms_desc',
          'ค่านี้เป็นของบัญชีคุณเอง ใช้กับทุกห้องที่เลือก "ใช้การตั้งค่าของทุกห้อง" ไว้ · ห้องที่ตั้งค่าเฉพาะห้องจะไม่สนค่านี้',
        )}
      </p>

      <div className="flex items-center justify-between p-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/60">
        <span className="min-w-0 pr-2">
          <span className="block text-xs font-medium text-gray-800 dark:text-gray-200">
            {t('room_translate_modal.all_rooms_toggle', 'แสดงข้อความต้นฉบับทุกห้อง')}
          </span>
          {/* 🔴 `null` and `false` both show an off switch — say which one it is. */}
          <span
            data-testid="room-modal-all-rooms-status"
            className="mt-0.5 block text-[10px] leading-relaxed text-gray-500 dark:text-gray-400"
          >
            {value === null
              ? t('room_translate_modal.all_rooms_unset', 'ยังไม่ได้ตั้งค่า — ห้องที่ตามค่านี้จะไม่แสดงต้นฉบับ')
              : value
                ? t('room_translate_modal.all_rooms_on', 'ตั้งไว้ว่า เปิด')
                : t('room_translate_modal.all_rooms_off', 'ตั้งไว้ว่า ปิด')}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          data-testid="room-modal-all-rooms-toggle"
          onClick={() => write(!isOn)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
            isOn ? 'bg-sky-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition mt-1 ml-1 ${
              isOn ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Offered only once there is something to clear — a "reset" on a value
          that was never set is a button that does nothing. */}
      {value !== null && (
        <button
          type="button"
          data-testid="room-modal-all-rooms-clear"
          onClick={() => write(null)}
          className="text-[10px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline underline-offset-2 cursor-pointer"
        >
          {t('room_translate_modal.all_rooms_clear', 'ล้างค่านี้ (กลับไปเป็นยังไม่ได้ตั้ง)')}
        </button>
      )}

      <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-gray-600 dark:text-gray-300 bg-sky-50/60 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 p-2 rounded-lg">
        <Info size={12} className="text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
        <span>
          {t(
            'room_translate_modal.all_rooms_scope_tip',
            'มีผลกับทุกห้องและทุกอุปกรณ์ที่ล็อกอินด้วยบัญชีนี้ · คนอื่นที่เปิดห้องเดียวกันจะใช้ค่าของเขาเอง',
          )}
        </span>
      </p>
    </div>
  );
};
