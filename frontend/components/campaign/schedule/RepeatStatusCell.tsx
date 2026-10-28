/**
 * [FEAT-20260826-REPEATCELL] ช่อง "สถานะ" ของตารางหลัก broadcast — กดทำงานได้
 * ============================================================================
 * เจ้าของสั่ง 26/08:
 *   · ล้มเหลว → แสดง `!` สีแดง · บรรทัดล่างแสดง job id พร้อมปุ่มคัดลอก ·
 *     กด `!` แล้วเปิดแท็บประวัติให้
 *   · งานตั้งเวลาแบบทำซ้ำ → กดได้ เปิด modal บอกว่าซ้ำวันไหน เวลาไหน ยังไง
 *     พร้อม toggle เปิด/ปิดรอบซ้ำ และ **เปิด-ปิดได้จากตารางหลักเลย**
 *
 * 🔴 สวิตช์จริงคือ `schedule.enabled` ไม่ใช่ฟิลด์ที่คิดขึ้นเอง
 *    ยืนยันจากฝั่ง BE: `broadcast-schedule/schedule-shape.ts:132,250` อ่าน
 *    `s?.enabled` เป็นตัวตัดสิน · และคอมเมนต์ที่นั่นบันทึกไว้ว่า rule ที่บันทึกโดย
 *    ไม่แตะสวิตช์จะอ่านกลับมาเป็น `enabled: null` (วัดจากงานจริง 24/08)
 *    ⇒ **`null` ต้องแปลว่า "เปิด"** ไม่ใช่ "ปิด" ไม่งั้นงานเก่าที่ตั้งไว้แล้วจะดูเหมือนถูกปิด
 *
 * ⚠️ ไม่แตะ `next_run_at` — นั่นเป็นเคอร์เซอร์ของตัวจัดตาราง ไม่ใช่ของหน้าจอ
 *    (schema เขียนกำกับว่า `scheduled_at` คือค่าที่แอดมินตั้ง ห้ามถูกเขียนทับ)
 *
 * ⚠️ แสดง toggle เฉพาะงานที่ **ตั้งเวลาและเป็นแบบทำซ้ำจริง** เท่านั้น
 *    งานส่งครั้งเดียวไม่มีรอบซ้ำให้เปิดปิด — โชว์ toggle ให้ก็ได้แค่ทำให้งง
 *
 * revert: ลบไฟล์นี้ แล้วคืน `<StatusBadge status={item.status} />` เดิมใน
 *         pages/messaging/Broadcasts.tsx
 */
import React from 'react';
import { AlertCircle, Repeat } from 'lucide-react';
import { useI18n, translateNow } from '../../../i18n';

/** รูปกฎรอบซ้ำ ตรงกับ `RepeatRuleForm` และ BE `schedule-shape.ts` */
export interface RepeatRuleLike {
  mode?: unknown;
  enabled?: unknown;
  /** นาทีตั้งแต่เที่ยงคืน — **เวลาที่ยิงจริงของแต่ละวัน** */
  at_time_min?: number | null;
  every_minutes?: number | null;
  days_of_week?: number[];
  window_start_min?: number | null;
  window_end_min?: number | null;
  tz_offset_min?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  max_runs?: number | null;
}

/**
 * งานนี้เป็น "ตั้งเวลาแบบทำซ้ำ" หรือไม่
 *
 * ⚠️ ดูที่ `mode === 'repeat'` เท่านั้น — ไม่เดาจากการมี `every_minutes`
 *    เพราะฟอร์มเก็บค่าที่พิมพ์ค้างไว้ได้แม้ผู้ใช้จะเลือกโหมด "ครั้งเดียว"
 */
export const isRepeatJob = (schedule?: RepeatRuleLike | null): boolean =>
  !!schedule && schedule.mode === 'repeat';

/**
 * รอบซ้ำเปิดอยู่ไหม
 *
 * 🔴 `null`/`undefined` = **เปิด** ตามที่ BE บันทึกไว้ว่ากฎที่ไม่เคยแตะสวิตช์
 *    จะอ่านกลับมาเป็น `enabled: null` · ตีความเป็น "ปิด" จะทำให้งานเก่าดูเหมือน
 *    ถูกปิดทั้งที่ยังทำงานอยู่
 */
export const isRepeatOn = (schedule?: RepeatRuleLike | null): boolean =>
  schedule?.enabled !== false;

/** ชื่อวันแบบเดียวกับหน้า create (`RepeatRuleForm`) · index 0 = อาทิตย์ */
export const TH_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/** วันที่ถูกเลือกจริง · ว่างหรือครบ 7 = ทุกวัน ⇒ คืนครบทั้ง 7 เพื่อให้ชิปติดครบ */
export const selectedDays = (s?: RepeatRuleLike | null): number[] => {
  const d = Array.isArray(s?.days_of_week) ? s!.days_of_week! : [];
  return d.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : d.slice().sort();
};

/** นาทีตั้งแต่เที่ยงคืน → `HH:MM` · ค่าที่ไม่ใช่ตัวเลขคืน `null` ไม่ใช่เดาเป็น 0 */
export const minToHHMM = (v: unknown): string | null => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  const h = Math.floor(v / 60) % 24;
  const m = Math.floor(v % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * สรุปกฎรอบซ้ำเป็นบรรทัดข้อความ · ส่วนที่ไม่มีข้อมูลจะถูกข้าม **ไม่เดา**
 *
 * 🔴 เวลาที่ยิงจริงอยู่ที่ `at_time_min` — ไม่ใช่ `window_start_min`
 *    ตรวจจากงานจริงในฐาน 26/08: `{"at_time_min":994, "window_start_min":null,
 *    "every_minutes":null}` ⇒ ถ้าอ่านแต่ `window_*` จะไม่มีเวลาโผล่เลยสักงาน
 *    ซึ่งเป็นอาการที่เจ้าของเจอ ("บอกแค่ทำซ้ำทุกวัน")
 */
export const describeRepeat = (s?: RepeatRuleLike | null): string[] => {
  if (!isRepeatJob(s)) return [];
  const out: string[] = [];

  const at = minToHHMM(s?.at_time_min);
  if (at) out.push(translateNow('pageui.campaign.repeat_at', 'ยิงเวลา {at} น. ของทุกวันที่เลือก', { at }));

  const from = minToHHMM(s?.window_start_min);
  const to = minToHHMM(s?.window_end_min);
  if (from && to) out.push(translateNow('pageui.campaign.repeat_window', 'เฉพาะช่วง {from} – {to} น.', { from, to }));

  if (typeof s?.every_minutes === 'number' && s.every_minutes > 0) {
    out.push(translateNow('pageui.campaign.repeat_every', 'ยิงซ้ำทุก {n} นาทีในช่วงนั้น', { n: s.every_minutes }));
  }
  if (typeof s?.max_runs === 'number' && s.max_runs > 0) {
    out.push(translateNow('pageui.campaign.repeat_max_runs', 'หยุดเองเมื่อครบ {n} รอบ', { n: s.max_runs }));
  }
  if (typeof s?.tz_offset_min === 'number') {
    const h = s.tz_offset_min / 60;
    out.push(translateNow('pageui.campaign.repeat_tz', 'เวลาอ้างอิง GMT{offset}', { offset: `${h >= 0 ? '+' : ''}${h}` }));
  }
  return out;
};

interface Props {
  readonly status: string;
  readonly jobId: string;
  readonly schedule?: RepeatRuleLike | null;
  readonly statusLabel: React.ReactNode;
  /** กด `!` → เปิดแท็บประวัติ */
  readonly onOpenHistory: () => void;
  /** กดป้ายงานทำซ้ำ → เปิด modal รายละเอียด */
  readonly onOpenRepeat: () => void;
  /** สลับรอบซ้ำจากตารางหลักโดยตรง */
  readonly onToggleRepeat: (next: boolean) => void;
  readonly toggleBusy?: boolean;
}

export const RepeatStatusCell: React.FC<Props> = ({
  status,
  jobId,
  schedule,
  statusLabel,
  onOpenHistory,
  onOpenRepeat,
  onToggleRepeat,
  toggleBusy = false,
}) => {
  const { t } = useI18n();

  const repeat = isRepeatJob(schedule);
  const on = isRepeatOn(schedule);

  return (
    <div className="flex flex-col gap-1" data-testid={`status-cell-${jobId}`}>
      <div className="flex items-center gap-1.5">
        {/* งานทำซ้ำ: ป้ายสถานะเดิมกดได้ → เปิด modal รายละเอียด
            ⚠️ งานอื่น ๆ ป้ายยังเป็นป้ายเฉย ๆ **เหมือนเดิมทุกประการ** ไม่ห่อปุ่ม
               ไม่เปลี่ยนสี ไม่เพิ่มขอบ — เจ้าของสั่งว่า "นอกนั้นเหมือนเดิม" */}
        {isRepeatJob(schedule) ? (
          <button
            type="button"
            onClick={onOpenRepeat}
            data-testid={`repeat-status-${jobId}`}
            title={t('broadcast.repeat_detail_title')}
            className="transition-transform active:scale-95"
          >
            {statusLabel}
          </button>
        ) : (
          statusLabel
        )}

        {/* ── งานล้มเหลว: `!` แดง กดแล้วไปแท็บประวัติ ───────────────────────
            ⚠️ เป็น `<button>` จริง ไม่ใช่ icon เฉย ๆ — คีย์บอร์ดต้องกดถึง */}
        {status === 'failed' && (
          <button
            type="button"
            onClick={onOpenHistory}
            data-testid={`status-failed-${jobId}`}
            title={t('broadcast.failed_open_history')}
            aria-label={t('broadcast.failed_open_history')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-red-300 bg-red-50 text-red-600 transition-colors hover:border-red-500 hover:bg-red-100 active:scale-95"
          >
            <AlertCircle size={15} />
          </button>
        )}

      </div>

    </div>
  );
};

export default RepeatStatusCell;
