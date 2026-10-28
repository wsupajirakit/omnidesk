/**
 * [FEAT-20260824-RUNDETAIL] The clickable list of ROUNDS in the ประวัติ tab.
 * ===========================================================================
 * Why this exists at all: the ประวัติ tab of `pages/messaging/Broadcasts.tsx`
 * shows `webhook_logs` — one row per HTTP request, across every campaign. Those
 * rows carry no `run_id`, so there was nothing on that screen that COULD open a
 * per-round modal. The rounds themselves were only ever visible inside
 * `BroadcastFormModal`. This panel puts the rounds on the tab where the owner
 * expects them, above the raw log table.
 *
 * 🔴 ONE LINE = ONE ROUND, gathered from that round's per-OA rows. The unit the
 *    owner speaks about is the ROUND ("ตอนนั้น job ตั้งอะไรไว้"), and the modal
 *    is keyed by `run_id`. The per-OA rows are NOT lost — the modal shows them
 *    unaggregated, because a round that succeeded on one OA and failed on
 *    another has no single honest status. See `groupRuns`.
 *
 * ⚠️ THE CAMPAIGN PICKER IS NOT A NICETY. The endpoint is per campaign
 *    (`/api/broadcasts/:id/history`); there is no "all rounds" read, and firing
 *    one request per listed campaign to fake one would be a request storm on a
 *    tab that also polls. เลือกงานก่อน แล้วค่อยดึงรอบของงานนั้น.
 *
 * ⚠️ Holds its OWN modal state so the page needs no new state and no change to
 *    its polling guard. ไม่ไปยุ่ง state ของหน้า.
 */
import { SearchableSelect } from '../../common/SearchableSelect';
import { LogDateRangeFilter, type LogDateRange } from '../../common/LogDateRangeFilter';
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { broadcastService } from '../../../services/messaging';
import type { BroadcastEntry, BroadcastRunRow } from '../../../types';
import { BroadcastRunDetailModal } from './BroadcastRunDetailModal';
import { NOT_MEASURED, STATUS_TONE, formatWhen, groupRuns, sendKindLabel } from './runDetailFormat';

interface Props {
  /** The campaigns already loaded by the page — no extra list request. */
  broadcasts: BroadcastEntry[];
  /* [FEAT-20260825-BCASTDATEFILTER] ช่วงวันที่ชุดเดียวกับตารางล่าง — ตัวแม่ถือ state
     ไว้ตัวเดียว ⇒ เลือกทีเดียวคุมทั้งสองตาราง (เจ้าของสั่ง "ต้องมีทั้งสองตาราง") */
  dateRange?: LogDateRange;
  onDateRangeChange?: (next: LogDateRange) => void;
}

export const BroadcastRunHistoryPanel: React.FC<Props> = ({ broadcasts, dateRange, onDateRangeChange }) => {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState('');
  const [rows, setRows] = useState<BroadcastRunRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setRows(null);
      setError(null);
      return;
    }
    // Same late-answer guard as the modal: a slow campaign must not paint over
    // a faster one the user switched to. เลือกงานใหม่แล้วของเก่าห้ามทับ.
    let alive = true;
    setLoading(true);
    setError(null);
    broadcastService
      .getBroadcastHistory(selectedId)
      .then(page => {
        if (!alive) return;
        setRows(page.data);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setRows(null);
        setError(e instanceof Error ? e.message : t('broadcast.run_history_load_failed'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedId, t]);

  const runs = useMemo(() => groupRuns(rows ?? []), [rows]);

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-dark-700 bg-dark-800 px-4 py-4 shadow-lg shadow-black/20"
      data-testid="broadcast-run-history-panel"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-slate-700">{t('broadcast.run_history_eyebrow')}</p>
          <h3 className="text-xl font-semibold text-slate-900">{t('broadcast.run_history_title')}</h3>
        </div>
        {/* [FEAT-20260825-RUNHISTSEARCH] เจ้าของ 25/08: *"ทำเป็น select search สวย ๆ
            (ใช้เหมือนหน้าอื่นอย่าทำใหม่)"* — เดิมเป็น <select> ธรรมดา ซึ่งพอแคมเปญเยอะ
            ต้องไล่หาเอง · ใช้ `SearchableSelect` ตัวเดียวกับที่หน้าอื่นใช้อยู่แล้ว
            (พิมพ์ค้นได้ทั้งชื่อและ id · `clearable` ล้างกลับเป็น "ยังไม่เลือก" ได้)
            ⚠️ `data-testid` เดิมคงไว้ที่กล่องครอบ เพื่อให้เทสที่มีอยู่ยังจับได้
            revert: กลับไปใช้ <select> เดิม + ลบ import */}
        {/* [FEAT-20260825-FILTERBIGGER] ขยายชุดเดียวกับตารางล่าง ให้ขนาดเท่ากันทั้งหน้า */}
        <div className="flex flex-wrap items-center gap-3" style={{ zoom: 1.15 }}>
        {dateRange && onDateRangeChange && (
          <LogDateRangeFilter value={dateRange} onChange={onDateRangeChange} />
        )}
        <div className="min-w-[16rem]" data-testid="run-history-broadcast-select">
          {/* [UI-20260826-DROPDIR] `dropUp` — ตัวนี้คือ **ต้นเรื่อง** ของกฎขึ้นบน
              (`021a8ac`): มันอยู่เหนือตารางยาว กางลงแล้วทับแถวที่มันกำลังกรอง
              และตกขอบการ์ดทุกครั้ง · เจ้าของสั่งซ้ำหลายรอบว่า "ขึ้นข้างบน"
              ไม่ใช่ "ขึ้นเมื่อจำเป็น" ⇒ บังคับที่นี่ ไม่ใช่ที่ค่าเริ่มต้นของของกลาง
              revert: ลบ `dropUp` แล้วมันจะกางลงเหมือนตัวเลือกอื่นทั้งแอป */}
          <SearchableSelect
            dropUp
            value={selectedId}
            onChange={v => {
              setSelectedId(v);
              setOpenRunId(null);
            }}
            /* [UI-20260826-NOIDINLABEL] โชว์แต่ชื่อแคมเปญ ไม่ต้องโชว์ id
               เจ้าของ 26/08 · `hint` เดิมคือตัวที่ทำให้ id โผล่ต่อท้ายทุกบรรทัด
               ⚠️ `label` ยังตกไปใช้ `b.id` ได้ถ้าแคมเปญไม่มีชื่อ — ตัวเลือกที่ว่าง
                  เปล่ากดไม่ถูกยิ่งแย่กว่าเห็น id
               revert: ใส่ `hint: b.id` กลับเข้าไป */
            options={broadcasts.map(b => ({ value: b.id, label: b.name || b.id }))}
            placeholder={t('broadcast.run_history_select_placeholder')}
            clearable
          />
        </div>
        </div>
      </div>

      {!selectedId && (
        <p className="py-3 text-sm text-slate-700">{t('broadcast.run_history_pick_hint')}</p>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-700" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('broadcast.run_history_loading')}
        </div>
      )}

      {error && !loading && (
        <p className="py-3 text-sm text-red-500" role="alert" data-testid="run-history-error">
          {error}
        </p>
      )}

      {rows && !loading && runs.length === 0 && (
        /* "ยังไม่เคยรัน" — NOT "ไม่มีงานนี้". The API answers 404 for a missing
           job, so this message can only ever mean the one thing. */
        <p className="py-3 text-sm text-slate-700" data-testid="run-history-empty">
          {t('broadcast.run_history_empty')}
        </p>
      )}

      {runs.length > 0 && !loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-700">
              <tr>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_history_col_started')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_history_col_send_kind')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_history_col_oa_count')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_history_col_sent')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_history_col_failed')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_history_col_status')}</th>
                <th className="py-2 pr-3 font-medium" />
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {runs.map(run => (
                <tr
                  key={run.run_id}
                  onClick={() => setOpenRunId(run.run_id)}
                  className="cursor-pointer border-t border-dark-700 hover:bg-dark-900/50"
                  data-testid={`run-row-${run.run_id}`}
                >
                  {/* ⚠️ ISO string handed to the browser — no offset applied */}
                  <td className="py-2 pr-3 whitespace-nowrap">{formatWhen(run.started_at)}</td>
                  <td className="py-2 pr-3">{sendKindLabel(run.send_kind, t)}</td>
                  <td className="py-2 pr-3">{run.oa_count}</td>
                  <td className="py-2 pr-3">{run.sent}</td>
                  <td className="py-2 pr-3">{run.failed}</td>
                  <td className="py-2 pr-3">
                    {/* a SET of statuses, not a winner — see `groupRuns` */}
                    {run.statuses.map(s => (
                      <span key={s} className={`mr-1 ${STATUS_TONE[s] ?? 'text-slate-800'}`}>
                        {s}
                      </span>
                    ))}
                  </td>
                  <td className="py-2 pr-3 text-primary-400">{t('broadcast.run_history_open')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-700">{t('broadcast.run_history_note')}</p>
        </div>
      )}

      <BroadcastRunDetailModal
        isOpen={!!openRunId}
        {...(selectedId ? { broadcastId: selectedId } : {})}
        {...(openRunId ? { runId: openRunId } : {})}
        onClose={() => setOpenRunId(null)}
      />
    </div>
  );
};
