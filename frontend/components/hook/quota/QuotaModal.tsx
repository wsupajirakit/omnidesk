/* [FEAT-20260815-LINEQUOTA] "how many push messages does this OA have left?"
 * ===========================================================================
 * Owner, 15/08: "กดตรง info icon line oa ชื่อไลน์ oa นั้นแหละ ส่ง hook id ไป get
 * ข้อมูล … แสดงจำนวนโควต้า line push x/99".
 *
 *   120 / 200 Credits used                              80 left
 *   ███████████████████████░░░░░░░░░░░░░░░░
 *
 * WHY A DIALOG AND NOT A LINE IN THE PANEL
 * Reading this costs a real LINE API call. Inline would mean one call per
 * ticket the operator opens; behind a button it is one call per actual
 * question asked.
 *
 * ⚠️ TWO THINGS THIS SCREEN MUST NEVER GET WRONG — both mislead about money:
 *   1. An unlimited plan (`type:'none'`) is written "ไม่จำกัด", never 0/0.
 *      LINE sends no `value` at all for those accounts.
 *   2. The figure counts PUSH-type messages only — push, multicast and
 *      broadcast. Replies are free and never counted, so the footnote says so;
 *      otherwise an operator reads a small number and thinks the OA has barely
 *      been used. The API words themselves stay OUT of the UI and live here,
 *      where the next reader of the code needs them.
 *      ⚠️ WORDING, owner-set 15/08/2026 (second pass): the footnote now reads
 *      "ถูก push (ส่งโดยแอดมิน)". The earlier "บอทส่งออกเอง — ข้อความที่ตอบกลับ
 *      ลูกค้าไม่ถูกนับ" described the same rule but pointed at the wrong actor:
 *      an operator reading "บอท" looks for automated traffic, when what consumes
 *      this quota is a human pushing a message. Keep the actor, not the
 *      mechanism, if this is ever reworded again.
 *   3. It is NOT live. The footnote states "ข้อมูลไม่ realtime" outright rather
 *      than hedging: LINE's counters lag, and an operator who treats this as a
 *      running total will send past the cap believing they had headroom.
 *
 * The dialog holds no secret: the channel access token never leaves the
 * backend, and the proxied response carries only these counters.
 *
 * revert: delete this folder, the ⓘ button in TicketChat.tsx (same tag), and
 *         webhookService.getHookQuota.
 */
import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Modal } from '../../common/Modal';
import { useI18n } from '../../../i18n';
import { useHookQuota, readQuota, fmt } from './useHookQuota';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The OA whose allowance to read — the ticket's `line_oa_hook_id`. */
  hookId: string | null;
  /** Shown in the header so the operator knows WHICH OA they are looking at. */
  oaName?: string | null;
}

/* [FEAT-2708-HEADERQUOTA] `fmt` moved to useHookQuota — the header gauge shares it. */

export const QuotaModal: React.FC<Props> = ({ isOpen, onClose, hookId, oaName }) => {
  const { t } = useI18n();
  const { data, loading, error, reload } = useHookQuota(hookId, isOpen);
  const q = readQuota(data);

  return (
    <Modal
      isOpen={isOpen}
      maxWidth="max-w-md"
      /* [FIX-2708-QUOTAMODALFIT] เจ้าของ 27/08: "modal เดิมของโควต้ามันใหญ่ไป" —
         เปลือก Modal ล็อก h-[86vh] ไว้เพื่อฟอร์มหลายแท็บ ([UI-20260825-LOCKHEIGHT])
         แต่กล่องนี้มีการ์ดเดียวรูปตายตัว จึงส่ง panel ของตัวเอง: template เดิม
         byte-copy เปลี่ยนแค่ h-[86vh] → max-h-[86vh] ให้สูงตามเนื้อหา
         revert: ลบ prop นี้บรรทัดเดียว */
      panelClassName="w-full max-w-md max-h-[86vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl"
    >
      <Modal.Header title={t('pageui.hookform.quota_title', 'โควตาข้อความ · {name}', { name: oaName || 'LINE OA' })} onClose={onClose} />
      <Modal.Body>
        {loading && (
          <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-300">{t('pageui.hookform.quota_loading', 'กำลังอ่านจาก LINE…')}</div>
        )}

        {!loading && error && (
          <div className="py-5 text-center">
            <p className="text-sm font-semibold text-rose-500">{t('pageui.hookform.quota_failed', 'อ่านโควตาไม่สำเร็จ')}</p>
            {/* the raw message is kept — it is what distinguishes an expired
                token from a network blip, and hiding it just moves the
                debugging to the server log */}
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 break-words">{error}</p>
            <button
              type="button"
              onClick={reload}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw size={13} /> {t('common.retry', 'ลองใหม่')}
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <div className="py-1">
            {q.unlimited ? (
              <>
                <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('hook_quota.unlimited', 'ไม่จำกัด')}</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {t('pageui.hookform.quota_sent', 'ส่งไปแล้ว')} <span className="font-bold text-slate-800 dark:text-slate-100">{fmt(q.used)}</span> {t('pageui.hookform.quota_msgs_month', 'ข้อความเดือนนี้')}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-end justify-between gap-3">
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                    {fmt(q.used)}
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-300">
                      /{q.limit === null ? '-' : fmt(q.limit)} {t('pageui.hookform.quota_used', 'ใช้ไปแล้ว')}
                    </span>
                  </p>
                  <p className="shrink-0 text-xs font-bold text-slate-700 dark:text-slate-200">
                    {q.remaining === null ? '-' : t('pageui.hookform.quota_left', 'เหลือ {n}', { n: fmt(q.remaining) })}
                  </p>
                </div>
                <div className="mt-2.5 h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  {/* colour is a warning, not decoration: amber past 75%, red
                      past 90% — the operator should notice before it runs out */}
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      q.percent >= 90 ? 'bg-rose-500' : q.percent >= 75 ? 'bg-amber-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${q.percent}%` }}
                  />
                </div>
                <p className="mt-1.5 text-right text-[11px] font-semibold text-slate-600 dark:text-slate-300">{q.percent}%</p>
              </>
            )}

            {/* [FIX-20260815-QUOTANOTE] Owner, 15/08: darker text — the note was
                slate-400 and read as disabled rather than as information the
                operator must actually take in. The closing clause now says
                "ข้อมูลไม่ realtime" plainly instead of the softer "อาจอัปเดตช้า":
                the figure genuinely lags, and hedging invites someone to treat
                it as a live counter. */}
            <p className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              {t('pageui.hookform.quota_note_a', 'นับเฉพาะข้อความที่')} <span className="font-bold">{t('pageui.hookform.quota_note_b', 'ถูก push (ส่งโดยแอดมิน)')}</span> ·{' '}
              <span className="font-bold text-slate-700 dark:text-slate-200">{t('pageui.hookform.quota_note_c', 'ข้อมูลไม่ realtime')}</span>
            </p>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={13} /> {t('common.refresh', 'รีเฟรช')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 hover:bg-blue-50"
        >
          <X size={13} /> {t('common.close', 'ปิด')}
        </button>
      </Modal.Footer>
    </Modal>
  );
};
