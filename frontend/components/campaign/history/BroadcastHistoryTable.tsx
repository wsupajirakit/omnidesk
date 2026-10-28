import { formatCampaignTime } from '../campaignTime';
import React from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../../../i18n';
import type { BroadcastHistoryRow } from '../../../types';

/**
 * [FEAT-20260823-BCASTHISTREAD] What every run of this job actually did.
 * ===========================================================================
 * The backend has written a row per OA per run since 22/08 and nothing has
 * ever displayed one — the numbers a run measured lived in Mongo and reached
 * no screen.
 *
 * 🔴 `images_replaced`: **absent = nobody looked · 0 = looked, none broken**.
 *    The schema omits the field rather than defaulting it, and this is the
 *    LAST of three layers that must resist writing `?? 0`. An em dash for
 *    absent, the number for 0 — a reader can then tell "not measured" from
 *    "measured, clean". เติม 0 = โกหกว่าเคยตรวจแล้ว.
 *
 * ⚠️ `sent` is what LINE ACCEPTED, not what was delivered or read. LINE gives
 *    no per-recipient delivery receipt on broadcast, so no column here can
 *    honestly claim delivery. ยอมรับคำขอ ≠ ส่งถึงคน.
 *
 * revert: delete this folder and its use in the form.
 */
interface Props {
  loading: boolean;
  error?: string;
  rows?: BroadcastHistoryRow[];
}

/** Absent must LOOK different from zero, or the distinction is decoration. */
const NOT_MEASURED = '—';

/* [FEAT-20260825-THAIDISPLAY] เวลาไทยเสมอ ไม่ใช่เวลาเครื่องคนเปิด
   `toLocaleString('th-TH')` เดิมตั้งแค่ *ภาษา* ไม่ได้ตั้ง *โซน* ⇒ แอดมินที่เปิด
   จากโซนอื่นเห็นเวลาผิดโดยไม่มีอะไรฟ้อง · `formatCampaignTime` ส่ง timeZone ให้ */
const when = (v?: string | null): string =>
  v ? formatCampaignTime(v) : NOT_MEASURED;

/**
 * [UI-20260828-STATUSBADGE] สถานะเป็น **ป้าย** ไม่ใช่ตัวหนังสือสีลอย ๆ
 *
 * เจ้าของ 28/08: *"ใส่ badge ด้วย ลดสีมันสว่างไปดูยาก"*
 *
 * 🔴 `emerald-400` / `red-400` เขียนไว้สำหรับพื้นมืด · ตารางนี้อยู่บนพื้นสว่าง
 *    (#EDF1F6) ⇒ ตัวหนังสือจางจนต้องเพ่ง · ลดลงมาหนึ่งขั้นครึ่งเป็นโทน 700
 *    ซึ่งอ่านออกชัดบนพื้นสว่าง และคงค่าเดิมไว้ในธีมมืดผ่าน `dark:`
 * 🔴 พื้นอ่อน + ขอบ ทำให้มันอ่านเป็น "สถานะ" ไม่ใช่ข้อความธรรมดาในตาราง —
 *    ตาไล่คอลัมน์เจอทันทีว่ารอบไหนพัง โดยไม่ต้องอ่านคำ
 * ⚠️ คีย์ยังเป็นค่าสถานะดิบชุดเดิมทุกตัว — ไม่ได้เปลี่ยนว่า BE ส่งอะไรมา
 *    สถานะที่ไม่รู้จักตกไปที่โทนกลาง (ดูที่จุดใช้) ไม่ใช่หายไปเฉย ๆ
 * revert: คืนแมปเป็น `text-*` เดี่ยว ๆ แล้วเอา `BADGE_BASE` ออกจากจุดใช้
 */
const STATUS_TONE: Record<string, string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300',
  partial: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300',
  error: 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300',
  refused: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-300',
  stopped: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300'
};

/** รูปทรงของป้าย — เหมือนกันทุกสถานะ ต่างกันแค่สี */
const BADGE_BASE =
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold';

export const BroadcastHistoryTable: React.FC<Props> = ({ loading, error, rows }) => {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-700" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t('broadcast.history_loading')}
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-4 text-sm text-red-500" role="alert" data-testid="history-error">
        {error}
      </p>
    );
  }

  if (!rows) return null;

  if (rows.length === 0) {
    /* 🔴 "never ran" — NOT "no such job". The API answers 404 for a missing
       job precisely so this message can mean only one thing. */
    return (
      <p className="py-4 text-sm text-slate-700" data-testid="history-empty">
        {t('broadcast.history_empty')}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="broadcast-history">
      <table className="w-full text-left text-xs">
        <thead className="text-slate-700">
          <tr>
            <th className="py-2 pr-3 font-medium">{t('broadcast.history_when')}</th>
            <th className="py-2 pr-3 font-medium">{t('broadcast.history_oa')}</th>
            <th className="py-2 pr-3 font-medium">{t('broadcast.history_status')}</th>
            <th className="py-2 pr-3 font-medium">{t('broadcast.history_sent')}</th>
            <th className="py-2 pr-3 font-medium">{t('broadcast.history_failed')}</th>
            <th className="py-2 pr-3 font-medium">{t('broadcast.history_images')}</th>
            <th className="py-2 pr-3 font-medium">{t('broadcast.history_reason')}</th>
          </tr>
        </thead>
        <tbody className="text-slate-200">
          {rows.map(row => (
            <tr key={row.run_id + String(row.hook_id)} className="border-t border-dark-700">
              <td className="py-2 pr-3 whitespace-nowrap">{when(row.started_at)}</td>
              <td className="py-2 pr-3">{row.hook_alias || NOT_MEASURED}</td>
              <td className="py-2 pr-3">
                <span
                  className={`${BADGE_BASE} ${
                    STATUS_TONE[row.status] ??
                    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-300'
                  }`}
                  data-testid={`status-badge-${row.run_id}`}
                >
                  {row.status}
                </span>
              </td>
              <td className="py-2 pr-3">{row.sent}</td>
              <td className="py-2 pr-3">{row.failed}</td>
              {/* 🔴 the dash is the point — see the header */}
              <td className="py-2 pr-3" data-testid={`images-${row.run_id}`}>
                {row.images_replaced === undefined ? NOT_MEASURED : row.images_replaced}
              </td>
              <td className="py-2 pr-3 text-slate-700">
                {row.stop_reason ?? row.error_message ?? NOT_MEASURED}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-700">{t('broadcast.history_sent_note')}</p>
    </div>
  );
};
