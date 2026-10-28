/**
 * [FEAT-20260826-ENABLETOGGLE] ช่อง "สถานะ" — จากป้ายอ่านอย่างเดียว เป็นสวิตช์กดได้
 * ============================================================================
 * เจ้าของสั่ง 26/08 หลังคุยกันว่าสองช่องต่างกันยังไง:
 *   · **สถานะ**     = "รอบส่งซ้ำยังทำงานอยู่ไหม" → **แอดมินกดเอง** ⇒ ควรเป็นสวิตช์
 *   · **สถานะงาน**  = "งานเดินไปถึงไหน" (ส่งแล้ว/ล้มเหลว/…) → **ระบบเปลี่ยนเอง** ⇒ ห้ามกด
 * ⇒ toggle จึงอยู่ที่ช่อง "สถานะ" ไม่ใช่ย้ายข้ามช่อง
 *
 * 🔴 กฎ on/off ใช้ `resolveBroadcastEnableState` ตัวเดิม **ไม่เขียนใหม่**
 *    `null` และคีย์ที่ไม่มี = **เปิด** (ห้าม falsy check — ไฟล์นั้นเขียนกำกับไว้
 *    และงานจริงในฐานมี `enabled: null` อยู่หลายแถว ยืนยันแล้ว 26/08)
 *
 * ⚠️ `one_off` (ไม่เคยตั้งรอบซ้ำ) **กดไม่ได้** — ไม่มีรอบให้เปิดปิด
 *    แสดงเป็นป้ายเดิมเป๊ะ เพื่อให้แถวที่ไม่เกี่ยวไม่เปลี่ยนหน้าตาเลย
 * ⚠️ มี confirm ก่อนเสมอ · ข้อความบอกตาม **ค่าที่กำลังจะเป็น** ไม่ใช่ค่าปัจจุบัน
 *    เขียนผิดด้าน = ผู้ใช้กดตรงข้ามกับที่ตั้งใจ
 *
 * revert: เปลี่ยน `<BroadcastEnabledToggle>` กลับเป็น `<BroadcastEnabledBadge>`
 *         ใน pages/messaging/Broadcasts.tsx แล้วลบไฟล์นี้
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import {
  BROADCAST_ENABLE_HINT,
  BROADCAST_ENABLE_LABEL,
  resolveBroadcastEnableState,
  type ScheduleEnabledLike,
} from './broadcastEnableState';

const STYLE = {
  on: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  off: 'bg-red-500/10 text-red-500 border-red-500/25',
  one_off: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
} as const;

interface Props {
  schedule?: ScheduleEnabledLike | null;
  testId?: string;
  disabled?: boolean;
  /**
   * สถานะงาน (`draft` / `scheduled` / `sending` / `sent` / `failed` / `cancelled`)
   *
   * 🔴 ใช้ตัดสินว่า "ยังมีรอบข้างหน้าให้เปิดปิดไหม" เท่านั้น — ไม่ได้เอามาแสดง
   *    ช่องนี้ยังคงตอบเรื่องรอบซ้ำอย่างเดียวเหมือนเดิม
   */
  status?: string;
  onToggle?: (next: boolean) => void;
}

/**
 * งานที่เดินจบแล้ว — ไม่มีรอบข้างหน้าให้เปิดหรือปิด
 *
 * เจ้าของสั่ง 26/08: *"ถ้าส่งแล้ว และไม่มีรอบซ้ำ ไม่มีตั้งเวลา toggle นั้นให้เบลอกดไม่ได้"*
 * แล้วแจ้งซ้ำว่ายังกดได้อยู่ ⇒ ผมเขียนเงื่อนไขผิดรอบแรก
 *
 * 🔴 รอบแรกเขียนเป็น `state === 'one_off' && FINISHED.includes(status)` ซึ่ง
 *    **ไม่เคยทำงานเลย** เพราะ `one_off` ถูกล็อกไปตั้งแต่บรรทัดก่อนหน้าอยู่แล้ว
 *    ⇒ เงื่อนไขซ้อนกับตัวที่ล็อกไปแล้ว = โค้ดตายที่ดูเหมือนทำงาน
 *
 * ของจริงที่วัดจากฐาน 26/08:
 *   status=sent  · mode=repeat            = 8 แถว  ← พวกนี้แหละที่ยังกดได้ ต้องเบลอ
 *   status=sent  · ไม่มี schedule          = 4 แถว  ← เป็น one_off ล็อกอยู่แล้ว
 *   status=scheduled · mode=repeat        = 2 แถว  ← **ต้องกดได้** ยังมีรอบข้างหน้า
 *   status=draft · mode=repeat            = 1 แถว  ← ยังไม่ติดอาวุธ ปล่อยกดได้
 *
 * ⇒ ตัวตัดสินคือ **`status` ล้วน ๆ** ไม่ต้องผูกกับ `one_off` อีก
 *   งานที่เดินจบแล้วไม่มีรอบข้างหน้า ต่อให้กฎรอบซ้ำยังอยู่ในเอกสารก็ตาม
 *   (`next_run_at` ของแถวพวกนั้นเป็นเวลาในอดีต — scheduler ไม่หยิบอีกแล้ว)
 */
const FINISHED_STATUSES: readonly string[] = ['sent', 'cancelled', 'failed'];

export const BroadcastEnabledToggle: React.FC<Props> = ({
  schedule, testId, disabled = false, status, onToggle,
}) => {
  const { t } = useI18n();
  const [confirming, setConfirming] = React.useState(false);
  const state = resolveBroadcastEnableState(schedule);

  /* กดไม่ได้เมื่อ · `one_off` ไม่เคยตั้งรอบซ้ำ · หรือ งานเดินจบแล้ว
     🔴 `status` **ต้อง destructure จาก props** — ถ้าลืม TypeScript ยังผ่าน
        เพราะ DOM lib ประกาศ `declare var status: string` (คือ `window.status`)
        ⇒ โค้ดจะไปอ่านสตริงว่างของเบราว์เซอร์แทน prop และเงื่อนไขนี้จะไม่ทำงานเลย
        เกิดขึ้นจริง 26/08 · จับได้ด้วย `broadcastEnabledToggle.dom.test.tsx` เท่านั้น */
  const finished = FINISHED_STATUSES.includes(status ?? '');
  const locked = state === 'one_off' || finished || !onToggle;

  if (locked) {
    return (
      <span
        data-testid={testId}
        data-enable-state={state}
        data-locked="yes"
        title={t(`pageui.messaging.enable_hint_${state}`, BROADCAST_ENABLE_HINT[state])}
        className={`inline-flex cursor-not-allowed items-center rounded-full border px-2.5 py-0.5 text-xs font-medium opacity-50 ${STYLE[state]}`}
      >
        {t(`pageui.messaging.enable_label_${state}`, BROADCAST_ENABLE_LABEL[state])}
      </span>
    );
  }

  const on = state === 'on';

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => setConfirming(true)}
        data-testid={testId}
        data-enable-state={state}
        title={on ? t('broadcast.repeat_on_hint') : t('broadcast.repeat_off_hint')}
        className={`inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-xs font-medium transition-all active:scale-95 disabled:opacity-50 ${STYLE[state]}`}
      >
        <span
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
            on ? 'bg-emerald-500' : 'bg-red-400'
          }`}
          aria-hidden
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
              on ? 'translate-x-[0.9rem]' : 'translate-x-[0.15rem]'
            }`}
          />
        </span>
        {t(`pageui.messaging.enable_label_${state}`, BROADCAST_ENABLE_LABEL[state])}
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-white/50 p-4 backdrop-blur"
          data-testid={testId ? `${testId}-confirm` : undefined}
        >
          <div className="my-auto w-full max-w-sm rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-2xl">
            <h4 className="text-lg font-bold text-slate-900">
              {on ? t('broadcast.repeat_confirm_off_title') : t('broadcast.repeat_confirm_on_title')}
            </h4>
            <p className="mt-2 text-sm text-slate-600">
              {on ? t('broadcast.repeat_confirm_off_body') : t('broadcast.repeat_confirm_on_body')}
            </p>
            <div className="mt-4 flex flex-row-reverse gap-2">
              <button
                type="button"
                data-testid={testId ? `${testId}-confirm-ok` : undefined}
                onClick={() => { setConfirming(false); onToggle(!on); }}
                className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-colors ${
                  on ? 'bg-slate-500 hover:bg-slate-600' : 'bg-emerald-500 hover:bg-emerald-600'
                }`}
              >
                {on ? t('broadcast.repeat_confirm_off_ok') : t('broadcast.repeat_confirm_on_ok')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:border-slate-300"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BroadcastEnabledToggle;
