import React from 'react';
import { Check } from 'lucide-react';

import { useI18n } from '../../../i18n';
import type { ChatRoom } from '../../../services/chat/chatService';
import { ABANDON_ROW, REQUEST_REG_ROW, followStampRaw } from './followStamps';

/**
 * [FEAT-20260826-CLOSECLEARFU] ตอนปิดเคส — จะตามการสมัครของลูกค้าคนนี้ต่อไหม
 * ===========================================================================
 * เจ้าของสั่ง 26/08/2026: ถ้า member ที่กำลังปิดเคสมี **ครบทั้งสอง** stamp
 * (`abandon_trigger_at` + `request_reg_at`) ให้กล่องยืนยันขึ้นสองตัวเลือก
 * เลือกได้อันเดียว ไม่เลือกเลยกดยืนยันไม่ได้
 *
 * 🔴 ทำไมไม่ใช้ `ConfirmConsentCheck` สองใบ — มันเป็น "consent" คือติ๊กหรือไม่ติ๊ก
 * สองใบวางคู่กันจะติ๊กพร้อมกันได้ทั้งคู่ ซึ่งเป็นสถานะที่ไม่มีความหมาย (จะตามต่อ
 * และไม่ตามต่อพร้อมกัน?) ที่นี่คือ **ทางเลือกที่แยกกันขาด** จึงเป็น radiogroup
 * ไม่ใช่ checkbox สองอัน — และ ARIA ก็ต้องบอกความจริงข้อนี้ให้ screen reader ด้วย
 * สองอย่างนี้ไม่เหมือนกัน อย่ายืมของผิดชนิดมาใช้เพราะหน้าตาคล้าย
 *
 * 🔴 ผลของการเลือก "หยุดตาม" ไม่ใช่แค่เรื่อง UI — BE จะ `$unset` ทั้งสองคีย์
 * ของ member คนนั้นถาวร และแถวนั้นจะย้ายบัคเก็ตในการ์ดรายงานการสมัคร
 * เหตุผลเต็มอยู่ที่ `omnidesk-api/src/modules/tickets/close-case-follow-up.helper.ts`
 * และที่ registry ของคีย์ — อ่านก่อนแก้ข้อความในนี้ เพราะข้อความคือสิ่งเดียวที่
 * บอกแอดมินว่ากำลังจะทำอะไรลงไป
 *
 * revert: ลบไฟล์นี้ + การเรียกใน `pages/chat/TicketChat.tsx` + คีย์แปล 4 ภาษา
 */

/** อะไรที่แอดมินเลือกได้ — `null` = ยังไม่เลือก ซึ่งเป็นสถานะเริ่มต้นเสมอ */
export type CloseCaseFollowUpAnswer = 'stop' | 'keep';

/** stamp มีค่าจริงหรือไม่ — `null`/ว่าง นับว่าไม่มี */
const hasStamp = (room: ChatRoom | null, key: string): boolean => {
  const v = followStampRaw(room, key as never);
  return v !== null && v !== undefined && v !== '';
};

/**
 * ต้องขึ้นตัวเลือกไหม
 *
 * ⚠️ `targetStatus` ต้องเป็น 2 ด้วยเสมอ — กล่องยืนยันใบนี้ถูกใช้ร่วมกันระหว่าง
 * "รับเคส" (1) กับ "ปิดเคส" (2) โดยสลับแค่หัวเรื่อง ถ้าเช็คแต่ว่ามี stamp ครบไหม
 * ช่องเลือกจะไปโผล่ตอนกดรับเคสด้วย ซึ่งไม่มีใครสั่ง และ BE ก็ไม่ทำอะไรกับมัน
 *
 * ⚠️ ต้องมี **ครบทั้งสอง** ไม่ใช่อย่างใดอย่างหนึ่ง — เพราะสิ่งที่ BE ทำคือเคลียร์
 * เป็นคู่ ถ้าขึ้นให้เลือกทั้งที่มีค่าเดียว แอดมินจะสั่งสิ่งที่ปลายทางไม่ยอมทำ
 * (helper ฝั่ง BE ปฏิเสธเคสนั้นอยู่แล้ว) ⇒ กลายเป็นปุ่มที่กดแล้วเงียบ
 */
export const closeCaseNeedsFollowUpChoice = (
  room: ChatRoom | null,
  targetStatus: number,
): boolean =>
  targetStatus === 2 &&
  hasStamp(room, ABANDON_ROW.key) &&
  hasStamp(room, REQUEST_REG_ROW.key);

interface Props {
  value: CloseCaseFollowUpAnswer | null;
  onChange: (next: CloseCaseFollowUpAnswer) => void;
  /** จริงเมื่อผู้เรียกบอกว่ามีการพยายามกดยืนยันทั้งที่ยังไม่เลือก */
  showMissing?: boolean;
}

const Option: React.FC<{
  testId: string;
  checked: boolean;
  danger: boolean;
  missing: boolean;
  label: string;
  hint: string;
  onPick: () => void;
}> = ({ testId, checked, danger, missing, label, hint, onPick }) => (
  <div
    data-testid={testId}
    role="radio"
    aria-checked={checked}
    tabIndex={0}
    onClick={onPick}
    onKeyDown={(e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onPick();
      }
    }}
    className={`flex cursor-pointer select-none items-start gap-3 rounded-xl border-2 p-4 transition-colors ${
      checked
        ? danger
          ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
          : 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
        : missing
          ? 'border-red-500 bg-slate-50 dark:bg-dark-900/40'
          : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-dark-700 dark:bg-dark-900/40'
    }`}
  >
    <span
      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors ${
        checked
          ? danger
            ? 'border-red-600 bg-red-600 text-white'
            : 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-slate-300 bg-white dark:bg-dark-800'
      }`}
      aria-hidden
    >
      {checked && <Check size={16} strokeWidth={3} />}
    </span>
    <span className="flex flex-col gap-1">
      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
        {label}
      </span>
      {/* เหตุผลอยู่ใต้หัวข้อเสมอ — แอดมินกำลังตัดสินใจแทนลูกค้า จึงต้องเห็นว่า
          ผลของแต่ละทางคืออะไร ไม่ใช่เดาจากชื่อ */}
      <span className="text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
        {hint}
      </span>
    </span>
  </div>
);

export const CloseCaseFollowUpChoice: React.FC<Props> = ({
  value,
  onChange,
  showMissing = false,
}) => {
  const { t } = useI18n();
  // แดงเฉพาะตอนที่พยายามกดยืนยันแล้วยังไม่ได้เลือก — กล่องที่แดงตั้งแต่เปิด
  // อ่านเหมือนมีอะไรพังอยู่ก่อนแล้ว
  const missing = showMissing && value === null;

  return (
    <div
      role="radiogroup"
      aria-label={t('ticket.close_follow_up_title')}
      className="mt-4 flex flex-col gap-2"
    >
      <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
        {t('ticket.close_follow_up_title')}
      </p>

      <Option
        testId="close-case-stop-follow"
        checked={value === 'stop'}
        danger
        missing={missing}
        label={t('ticket.close_follow_up_stop')}
        hint={t('ticket.close_follow_up_stop_hint')}
        onPick={() => onChange('stop')}
      />

      <Option
        testId="close-case-keep-follow"
        checked={value === 'keep'}
        danger={false}
        missing={missing}
        label={t('ticket.close_follow_up_keep')}
        hint={t('ticket.close_follow_up_keep_hint')}
        onPick={() => onChange('keep')}
      />

      {missing && (
        <p className="text-xs font-bold text-red-600 dark:text-red-400">
          {t('ticket.close_follow_up_required')}
        </p>
      )}
    </div>
  );
};

export default CloseCaseFollowUpChoice;
