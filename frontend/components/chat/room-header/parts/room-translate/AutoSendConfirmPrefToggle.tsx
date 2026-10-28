/**
 * [FEAT-20260918-CONFIRMPREFUI] The only place "ไม่ต้องถามอีก" can be turned back ON.
 * ============================================================================
 * Owner, 18/09: *"step 4 เพิ่มการติ๊ก save preference ค่าจำค่าตอนส่ง (และต้องบันทึกด้วย
 * ถ้าติ๊กเข้าออกตรงนี้)"*.
 *
 * The confirm dialog that appears when step 4 sends offers "จำค่านี้ไว้ ไม่ต้องถามอีก".
 * Ticking it works — and then the dialog never appears again, which means the tick
 * that turned it off is somewhere the operator can never reach. One-way switches
 * are a trap: the only way back was clearing site data. This is the way back.
 * ติ๊กไปแล้วต้องเอากลับได้ ไม่งั้นคือประตูทางเดียว
 *
 * ## It is NOT a room setting, and the copy says so
 *
 * Every other control in this modal writes to THIS ROOM. This one writes to the
 * logged-in account and applies everywhere — so it sits visually apart and its
 * hint spells that out. Putting it in the room modal without saying so would
 * teach an operator that "ไม่ต้องถามอีก" was scoped to the room they were looking
 * at, and the first surprise would be a translated message leaving another room
 * with no confirm. เป็นค่าระดับบัญชี ไม่ใช่ค่าของห้อง ต้องบอกให้ชัด
 *
 * ## Saving is immediate, both directions
 *
 * There is no "save" button in this step and adding one for a single checkbox
 * would be its own kind of surprise, so each tick writes straight through
 * `rememberAutoSendConfirm` — which updates the local cache synchronously and
 * persists to the account behind it. The local state is optimistic; a failed
 * server write leaves the operator being asked again on another device, which is
 * the safe direction.
 *
 * Its own file: `RoomTranslateWizardSteps.tsx` is already past the 400-line warn
 * line, and this owns state the wizard has no other reason to hold.
 *
 * revert: delete this file and its one line in step 4. The preference then has no
 * UI again and can only be set from the send confirm.
 */
import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { useI18n } from '../../../../../i18n';
import {
  rememberAutoSendConfirm,
  skipAutoSendConfirm,
} from '../../../../../services/chat/autoSendConfirmPref';

export const AutoSendConfirmPrefToggle: React.FC = () => {
  const { t } = useI18n();
  /* 🔴 THE LABEL IS WORDED SO THE TICK MATCHES THE STORED VALUE — deliberately.
     Owner, 18/09, after trying the other wording: *"ใช้คำว่า ไม่ต้องยืนยันก่อนการส่ง
     ทุกครั้ง จะได้ไม่ต้องกลับ"*. A ticked box therefore means `skip_auto_send_confirm:
     true`, exactly what is saved — no inversion anywhere between the screen and
     the preference. A label phrased the positive way ("ให้ยืนยันทุกครั้ง") would
     have forced a `!` on read AND on write, and a later reader has to hold both
     in their head to tell whether a tick means yes or no.
     ติ๊ก = ข้ามการยืนยัน = ค่าที่เก็บตรง ๆ ไม่มีกลับขั้วตรงไหนเลย

     Read once on mount — the component mounts when step 4 opens, so it reflects
     the value as it stands at that moment. */
  const [skip, setSkip] = useState<boolean>(() => skipAutoSendConfirm());

  const toggle = (next: boolean) => {
    setSkip(next);
    rememberAutoSendConfirm(next);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2.5 dark:border-gray-700/60 dark:bg-gray-800">
      <label className="flex cursor-pointer select-none items-start gap-2">
        <input
          type="checkbox"
          checked={skip}
          onChange={(e) => toggle(e.target.checked)}
          data-testid="step4-skip-confirm-pref"
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-sky-600 focus:ring-sky-500"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-800 dark:text-gray-200">
            <ShieldCheck size={13} className="shrink-0 text-gray-400" />
            {t('room_translate_modal.step4_skip_confirm', 'ไม่ต้องยืนยันก่อนการส่งทุกครั้ง')}
          </span>
          {/* The scope, stated where it cannot be missed — see the header. */}
          <span className="mt-0.5 block text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
            {t(
              'room_translate_modal.step4_skip_confirm_hint',
              'ติ๊กไว้ = กดส่งแล้วส่งเลย ไม่ถามยืนยัน · เอาติ๊กออก = ถามยืนยันทุกครั้ง · เป็นค่าของบัญชีคุณเอง มีผลกับทุกห้อง ไม่ใช่เฉพาะห้องนี้',
            )}
          </span>
        </span>
      </label>
    </div>
  );
};
