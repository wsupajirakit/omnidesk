/**
 * [FEAT-20260826-REPEATCELL] modal "สถานะการส่งรอบซ้ำ"
 * ============================================================================
 * เจ้าของสั่ง 26/08 รอบสอง: *"modal สถานะรอบซ้ำใหญ่กว่านี้ ขยาย font ด้วย
 * + บอกวันให้ครบ เป็นกรอบสีเขียววันที่เลือก (เหมือนใน create) + บอกเวลาที่ทำซ้ำด้วย"*
 *
 * 🔴 เวลาที่ยิงจริงอยู่ที่ `at_time_min` **ไม่ใช่ `window_start_min`**
 *    ตรวจงานจริงในฐาน 26/08 ได้ `{"at_time_min":994,"window_start_min":null,
 *    "every_minutes":null,"days_of_week":[0..6]}` ⇒ รอบแรกผมอ่านแต่ `window_*`
 *    จึงไม่มีเวลาโผล่เลย เหลือแต่ "ทำซ้ำทุกวัน" ตามที่เจ้าของเจอ
 *
 * ⚠️ ชิปวันทำแบบเดียวกับหน้า create — **แสดงครบ 7 วันเสมอ** วันที่เลือกเป็นกรอบเขียว
 *    วันที่ไม่ได้เลือกเป็นสีจาง · ถ้าโชว์เฉพาะวันที่เลือก ผู้ใช้จะอ่านไม่ออกว่าวันที่
 *    หายไปคือ "ไม่ได้เลือก" หรือ "ระบบไม่รู้"
 * ⚠️ ข้อความสรุปมาจาก `describeRepeat()` ตัวเดียวกับที่ช่องในตารางใช้
 * ⚠️ ค่าที่ไม่มีในกฎจะ **ไม่ถูกแสดง** ไม่เดาเป็น 0 หรือ "ทุกวัน"
 *
 * revert: ลบไฟล์นี้ + การเรียกใน pages/messaging/Broadcasts.tsx
 */
import React from 'react';

import { openNativePicker } from '../../common/LogDateRangeFilter';
import { X, Repeat, CalendarDays } from 'lucide-react';
import { useI18n } from '../../../i18n';
import {
  describeRepeat, isRepeatOn, isRepeatJob, selectedDays, TH_DAYS,
  type RepeatRuleLike,
} from './RepeatStatusCell';
import { minToHHMM } from './RepeatStatusCell';

/* index 0 = Sunday, same order as TH_DAYS — names the existing broadcast.repeat_day_* keys */
const DAY_KEYS_FOR_CHIPS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

interface Props {
  readonly open: boolean;
  readonly name: string;
  readonly jobId: string;
  readonly schedule?: RepeatRuleLike | null;
  readonly nextRunAt?: string | null;
  readonly busy?: boolean;
  readonly onToggle: (next: boolean) => void;
  /** บันทึกเวลาที่ยิงใหม่ (นาทีตั้งแต่เที่ยงคืน) — ไม่ส่งมา = แก้เวลาไม่ได้ */
  readonly onSaveTime?: (atTimeMin: number) => void;
  readonly onClose: () => void;
}

export const RepeatDetailModal: React.FC<Props> = ({
  open, name, jobId, schedule, nextRunAt, busy = false, onToggle, onSaveTime, onClose,
}) => {
  const { t } = useI18n();

  /* [FEAT-20260826-REPEATEDIT] เจ้าของสั่ง 26/08: *"toggle ตัวนี้ต้องใส่ confirm ด้วย
     (with checkbox) + แก้ไขเวลาได้จากใน modal นี้ด้วย"*
     ⚠️ hook ต้องอยู่ **เหนือ** `if (!open) return null` เสมอ — ไม่งั้นจำนวน hook
        ที่ React เห็นเปลี่ยนไปมาตอนเปิด/ปิด แล้วพังทั้งหน้า */
  const [confirming, setConfirming] = React.useState<null | boolean>(null);
  const [ack, setAck] = React.useState(false);
  const [timeDraft, setTimeDraft] = React.useState<string>('');

  const atNow = React.useMemo(() => minToHHMM(schedule?.at_time_min) ?? '', [schedule?.at_time_min]);
  React.useEffect(() => { setTimeDraft(atNow); }, [atNow, open]);
  React.useEffect(() => { if (confirming === null) setAck(false); }, [confirming]);

  if (!open) return null;

  const lines = describeRepeat(schedule);
  const on = isRepeatOn(schedule);
  const days = selectedDays(schedule);
  const repeat = isRepeatJob(schedule);

  return (
    /* items-start + my-auto — บั๊ก flexbox เดียวกับ [FIX-20260826-RUNMODALSCROLL]:
       จัดกึ่งกลางบนกล่องที่ scroll ได้ทำให้เลื่อนขึ้นไปดูหัวไม่ได้ */
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-white/45 p-4 backdrop-blur">
      <div
        className="my-auto w-full max-w-2xl rounded-2xl border border-dark-700 bg-white shadow-2xl"
        data-testid="repeat-detail-modal"
      >
        <div className="flex items-start justify-between border-b border-dark-700 px-6 py-5">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
              <Repeat size={22} className={on ? 'text-emerald-600' : 'text-slate-400'} />
              {t('broadcast.repeat_detail_title')}
            </h3>
            <p className="mt-1 truncate text-base text-slate-600">{name || jobId}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}
            className="text-slate-500 transition-colors hover:text-slate-900">
            <X size={24} />
          </button>
        </div>

        <div className="custom-scrollbar flex max-h-[65vh] min-h-0 flex-col gap-5 overflow-y-auto px-6 py-5">
          {!repeat ? (
            <p className="text-lg text-slate-600">{t('broadcast.repeat_detail_none')}</p>
          ) : (
            <>
              {/* ── วันที่ทำซ้ำ: ชิปครบ 7 วัน กรอบเขียว = เลือกไว้ ─────────── */}
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-base font-bold text-slate-700">
                  <CalendarDays size={18} className="text-slate-400" />
                  {t('broadcast.repeat_days_title')}
                </p>
                <div className="flex flex-wrap gap-2" data-testid="repeat-detail-days">
                  {TH_DAYS.map((label, i) => {
                    const picked = days.includes(i);
                    return (
                      <span
                        key={i}
                        data-testid={`repeat-day-${i}${picked ? '-on' : ''}`}
                        className={`inline-flex h-11 min-w-[3rem] items-center justify-center rounded-xl border-2 px-3 text-base font-bold transition-colors ${
                          picked
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-slate-50 text-slate-300'
                        }`}
                      >
                        {/* [FEAT-20261022-I18NPAGESEN] same Thai as broadcast.repeat_day_* (the create form) */}
                        {t(`broadcast.repeat_day_${DAY_KEYS_FOR_CHIPS[i]}`, label)}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* ── เวลา / กฎการทำซ้ำ ─────────────────────────────────────── */}
              {lines.length > 0 && (
                <ul className="flex flex-col gap-2" data-testid="repeat-detail-lines">
                  {lines.map((l, i) => (
                    <li key={i} className="rounded-xl bg-slate-50 px-4 py-3 text-lg text-slate-800">{l}</li>
                  ))}
                </ul>
              )}

              {nextRunAt && (
                <div className="rounded-xl border-2 border-sky-200 bg-sky-50 px-4 py-3">
                  <p className="text-sm font-bold text-sky-700">{t('broadcast.repeat_next_run')}</p>
                  <p className="mt-0.5 text-lg text-sky-900" data-testid="repeat-next-run">{nextRunAt}</p>
                </div>
              )}

              {/* ── แก้เวลาที่ยิงได้จากใน modal นี้ ───────────────────────────
                  ⚠️ แก้เฉพาะ `at_time_min` — ไม่แตะวัน ไม่แตะ `next_run_at`
                     (เคอร์เซอร์ของ scheduler · schema เขียนกำกับว่าห้ามเขียนทับ
                      ค่าที่แอดมินตั้ง) · scheduler จะคำนวณรอบถัดไปเองจากกฎใหม่ */}
              {onSaveTime && (
                <div className="flex flex-wrap items-end gap-3 rounded-xl border-2 border-slate-200 p-4">
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-bold text-slate-700">{t('broadcast.repeat_edit_time')}</span>
                    <input
                      type="time"
                      onClick={openNativePicker}
                      value={timeDraft}
                      onChange={e => setTimeDraft(e.target.value)}
                      data-testid="repeat-time-input"
                      className="rounded-lg border-2 border-slate-200 px-3 py-2 text-lg text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || timeDraft === '' || timeDraft === atNow}
                    onClick={() => {
                      const [h, m] = timeDraft.split(':').map(Number);
                      if (Number.isFinite(h) && Number.isFinite(m)) onSaveTime(h * 60 + m);
                    }}
                    data-testid="repeat-time-save"
                    className="rounded-xl bg-sky-500 px-5 py-2.5 text-base font-bold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('common.save')}
                  </button>
                </div>
              )}

              {/* ── สวิตช์ (ตัวใน modal — คนละตัวกับในช่องสถานะ ตามที่สั่ง) ── */}
              <label className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl border-2 border-slate-200 p-5 transition-colors hover:border-slate-300">
                <span className="text-lg font-bold text-slate-700">
                  {on ? t('broadcast.repeat_state_on') : t('broadcast.repeat_state_off')}
                </span>
                <button
                  type="button" role="switch" aria-checked={on} disabled={busy}
                  onClick={() => setConfirming(!on)}
                  data-testid="repeat-detail-toggle"
                  className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
                    on ? 'border-emerald-400 bg-emerald-400' : 'border-slate-300 bg-slate-200'
                  }`}
                >
                  <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                    on ? 'translate-x-[1.6rem]' : 'translate-x-[0.15rem]'
                  }`} />
                </button>
              </label>
            </>
          )}
        </div>
      </div>

      {/* ── confirm พร้อม checkbox ─────────────────────────────────────────
          ⚠️ ปุ่มยืนยัน **กดไม่ได้จนกว่าจะติ๊ก** — ปิดรอบซ้ำคืองานหยุดยิงเงียบ ๆ
             ซึ่งกว่าจะรู้ตัวก็หลายวัน · ติ๊กหนึ่งครั้งบังคับให้เกิดการตั้งใจ
          ⚠️ ข้อความบอกตาม **ค่าที่กำลังจะเป็น** ไม่ใช่ค่าปัจจุบัน */}
      {confirming !== null && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-white/55 p-4 backdrop-blur"
             data-testid="repeat-detail-confirm">
          <div className="my-auto w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-2xl">
            <h4 className="text-xl font-bold text-slate-900">
              {confirming ? t('broadcast.repeat_confirm_on_title') : t('broadcast.repeat_confirm_off_title')}
            </h4>
            <p className="mt-2 text-base text-slate-600">
              {confirming ? t('broadcast.repeat_confirm_on_body') : t('broadcast.repeat_confirm_off_body')}
            </p>

            <label className={`mt-4 flex cursor-pointer select-none items-center gap-3 rounded-xl border-2 p-4 transition-colors ${
              ack ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
            }`}>
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}
                     data-testid="repeat-confirm-ack" className="h-5 w-5 accent-emerald-500" />
              <span className="text-base font-bold text-slate-700">
                {confirming ? t('broadcast.repeat_ack_on') : t('broadcast.repeat_ack_off')}
              </span>
            </label>

            <div className="mt-5 flex flex-row-reverse gap-2">
              <button type="button" disabled={!ack || busy}
                data-testid="repeat-detail-confirm-ok"
                onClick={() => { const n = confirming; setConfirming(null); if (n !== null) onToggle(n); }}
                className={`flex-1 rounded-xl px-4 py-3 text-base font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  confirming ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-slate-500 hover:bg-slate-600'
                }`}>
                {confirming ? t('broadcast.repeat_confirm_on_ok') : t('broadcast.repeat_confirm_off_ok')}
              </button>
              <button type="button" onClick={() => setConfirming(null)}
                className="flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-bold text-slate-600 transition-colors hover:border-slate-300">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RepeatDetailModal;
