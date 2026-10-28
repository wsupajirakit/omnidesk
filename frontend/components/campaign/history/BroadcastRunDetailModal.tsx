/**
 * [FEAT-20260824-RUNDETAIL] One round of one campaign, opened on demand.
 * ===========================================================================
 * Owner 24/08:
 *   *"history ต้องจอย webhook log มาใช้ไหม ต้องแสดงทั้ง history + webhook log
 *    จะได้ครบ แต่ว่าทำเป็น modal กดดู แบ่ง section div พับ เปิดได้สวยๆ"*
 *   *"ประวัติต้องบอกว่า board หรือ multi พร้อมบอก job detail ที่รัน เงื่อนไขทั้งหมด
 *    ว่าตอนนั้น job ตั้งอะไรไว้"*
 *
 * 🔴 THREE SECTIONS, NOT ONE TABLE.
 *      1. สรุปรอบ        — one card per (round × OA): what the campaign decided
 *      2. เงื่อนไขตอนนั้น — the settings FROZEN at run time
 *      3. LINE log       — one row per HTTP request: what LINE answered
 *    (1) and (3) have different cardinalities on purpose — see `RunLogSection`.
 *    Merging them would invent a unit neither side has. ห้ามยุบรวมสองส่วนนี้.
 *
 * 🔴 READ-ONLY, ALWAYS. The round already happened; nothing in this modal can
 *    resend, retry or edit anything. There is no button here that writes.
 *
 * ⚠️ Fetched WHEN OPENED, never as part of the list. The log read is a
 *    collection scan on the backend today (measured: 8,369 docs examined to
 *    return 1) — cheap once per click, ruinous per list row.
 *    ดึงตอนกดเปิดเท่านั้น ห้ามยิงพร้อมลิสต์.
 *
 * revert: delete `components/campaign/history/Run*`,
 *         `BroadcastRunDetailModal.tsx`, `runDetailFormat.ts`, their exports in
 *         `index.ts`, `getBroadcastRunDetail` in the service, and the panel's
 *         use in `pages/messaging/Broadcasts.tsx`.
 */
import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { broadcastService } from '../../../services/messaging';
import type { BroadcastRunDetail } from '../../../types';
import { NOT_MEASURED } from './runDetailFormat';
import { RunSection } from './RunSection';
import { RunSummarySection } from './RunSummarySection';
import { RunSettingsSection } from './RunSettingsSection';
import { RunLogSection } from './RunLogSection';

interface Props {
  isOpen: boolean;
  broadcastId?: string;
  runId?: string;
  onClose: () => void;
}

export const BroadcastRunDetailModal: React.FC<Props> = ({
  isOpen,
  broadcastId,
  runId,
  onClose
}) => {
  const { t } = useI18n();
  const [detail, setDetail] = useState<BroadcastRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !broadcastId || !runId) {
      setDetail(null);
      setError(null);
      return;
    }
    /* Guards a late answer from a round the user already navigated away from —
       otherwise clicking two rows quickly can paint the wrong round's numbers
       under the right round's title. รอบเก่าตอบช้า ต้องไม่ทับรอบใหม่. */
    let alive = true;
    setLoading(true);
    setError(null);
    broadcastService
      .getBroadcastRunDetail(broadcastId, runId)
      .then(res => {
        if (!alive) return;
        setDetail(res);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setDetail(null);
        setError(e instanceof Error ? e.message : t('broadcast.run_detail_load_failed'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, broadcastId, runId, t]);

  if (!isOpen) return null;

  const rows = detail?.rows ?? [];
  const name = rows.find(r => r.broadcast_name)?.broadcast_name;

  /* [FIX-20260826-RUNMODALSCROLL] "modal รายละเอียดรอบการส่ง ใส่ scroll ให้ด้วยทุก div
     (มันบัคเลื่อนดูไม่ได้)" — เจ้าของแจ้ง 26/08
     ────────────────────────────────────────────────────────────────────────
     ต้นเหตุคือ `flex items-center` **คู่กับ** `overflow-y-auto` บนกล่องนอก
     ซึ่งเป็นบั๊กคลาสสิกของ flexbox: พอลูกสูงกว่าจอ การจัดกึ่งกลางดันขอบบนของลูก
     **ขึ้นไปเหนือจุดเริ่มของ scroll** เบราว์เซอร์จึงเลื่อนขึ้นไปถึงไม่ได้
     ⇒ เห็นเนื้อหาโดนตัดหัวและเลื่อนดูไม่ได้ ตรงกับที่แจ้งมาเป๊ะ

     สามอย่างที่แก้ (คลาสล้วน ไม่มีอะไรอื่นเปลี่ยน):
       1. กล่องนอก `items-center` → `items-start`
       2. ตัวใบ `my-8` → `my-auto` ⇒ จอสูงพอยังลอยกลางเหมือนเดิม จอเตี้ยเลื่อนได้ครบ
       3. กล่องเนื้อหาเติม `min-h-0` — ลูกของ flex column มี `min-height: auto`
          โดยปริยาย จึงปฏิเสธที่จะหด ทำให้ `overflow-y-auto` ไม่ทำงานจนกว่าจะปลดล็อก

     ⚠️ ห้ามกลับไปใช้ `items-center` บนกล่องที่ scroll ได้ ไม่ว่าจะดูเป็นระเบียบแค่ไหน
     revert: คืนคลาสทั้งสามจุดตาม git history */
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-white/45 p-4 backdrop-blur">
      <div
        className="my-auto w-full max-w-4xl rounded-2xl border border-dark-700 bg-dark-800 shadow-2xl"
        data-testid="broadcast-run-detail-modal"
      >
        <div className="flex items-start justify-between border-b border-dark-700 px-5 py-4">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">{t('broadcast.run_detail_title')}</h3>
            <p className="text-sm text-slate-700 break-all">
              {/* the name AT RUN TIME — a later rename must not rewrite history */}
              {name ? `${name} · ` : ''}
              {t('broadcast.run_detail_subtitle', { runId: runId ?? NOT_MEASURED })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-slate-700 transition-colors hover:text-slate-900"
          >
            <X size={20} />
          </button>
        </div>

        <div className="custom-scrollbar flex max-h-[75vh] min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 py-6 text-base text-slate-700" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t('broadcast.run_detail_loading')}
            </div>
          )}

          {error && !loading && (
            <p className="py-4 text-sm text-red-500" role="alert" data-testid="run-detail-error">
              {error}
            </p>
          )}

          {detail && !loading && (
            <>
              {/* [UI-20260828-RUNFOLDED] เจ้าของ 28/08: *"ทุกอย่างให้พับเก็บไว้ default
                  เฉพาะ modal นี้"* ⇒ ส่งค่าที่ **จุดเรียก** ไม่ไปแก้ค่าเริ่มต้นของ
                  `RunSection` เอง — คอมโพเนนต์ยัง export ออกจาก `history/index.ts`
                  ผู้ใช้รายอื่นในอนาคตต้องยังได้ "กางไว้" แบบเดิม
                  ⚠️ body ถูก unmount ตอนพับ (ไม่ใช่ซ่อนด้วย CSS) ⇒ เปิดโมดัลมาครั้งแรก
                     จะไม่มีตาราง log อยู่ใน DOM เลย เทสที่หาแถวต้องกดเปิด section ก่อน */}
              <RunSection
                id="summary"
                defaultOpen={false}
                title={t('broadcast.run_section_summary')}
                hint={t('broadcast.run_summary_hint', { count: rows.length })}
              >
                <RunSummarySection rows={rows} />
              </RunSection>

              <RunSection id="settings" defaultOpen={false} title={t('broadcast.run_section_settings')}>
                <RunSettingsSection rows={rows} />
              </RunSection>

              {/* 🔴 its own section — never folded into สรุปรอบ above */}
              <RunSection
                id="logs"
                defaultOpen={false}
                title={t('broadcast.run_section_logs')}
                hint={t('broadcast.run_logs_hint', { count: detail.logs.length })}
              >
                <RunLogSection
                  logs={detail.logs}
                  logsExpired={detail.logsExpired}
                  {...(detail.logsError !== undefined ? { logsError: detail.logsError } : {})}
                />
              </RunSection>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
