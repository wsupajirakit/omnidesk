/**
 * [FEAT-20260824-RUNDETAIL] LINE log — what LINE actually answered.
 *
 * 🔴 A SECOND, SEPARATE TABLE — NEVER MERGED WITH สรุปรอบ. The two count
 *    different things: a history row is one (run × OA) and says what the
 *    CAMPAIGN decided; a log row is one HTTP request and says what LINE
 *    ANSWERED. One round can send one history row and three log rows (retries,
 *    chunking), so a merged table would have to invent a cardinality neither
 *    side has — and "the round succeeded but two requests were retried" would
 *    become impossible to see. คนละหน่วยนับ ⇒ วางคู่กัน ห้ามยุบรวม.
 *
 * 🔴 AN EMPTY LIST ALWAYS CARRIES A SENTENCE. `webhook_logs` expires after 45
 *    days while history rows never do, so most old rounds land here with no
 *    logs and a perfect send. Silence here reads as "this round sent nothing".
 *    log หมดอายุ ≠ ไม่ได้ส่ง.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import type { BroadcastRunLogEntry } from '../../../types';
import { RunNoticeLine } from './RunNoticeLine';
import { NOT_MEASURED, STATUS_TONE, formatWhen, logsNotice } from './runDetailFormat';

interface Props {
  logs: BroadcastRunLogEntry[];
  logsExpired: boolean;
  /** ⚠️ present only when the READ failed — a different thing from expiry. */
  logsError?: string;
}

export const RunLogSection: React.FC<Props> = ({ logs, logsExpired, logsError }) => {
  const { t } = useI18n();
  /* One decision point for both silences, so the two can never swap wording.
     The error branch wins because an expiry is normal and a failure is not. */
  const notice = logsNotice(
    {
      logsExpired,
      ...(logsError !== undefined ? { logsError } : {})
    },
    t
  );

  /* [UI-20260826-RUNMODALFONT] เจ้าของสั่ง 26/08: "ใส่ scroll ทุก div ข้างใน 3 block
     + ขยาย font ทั้ง modal นี้"
     ขนาดเดิมเล็กเกินอ่าน: ป้ายกำกับ `text-[11px]` · ค่า `text-sm` · ตาราง log `text-xs`
     ⇒ ขยับขึ้นหนึ่งขั้นทั้งชุด · ป้าย 11px → `text-xs` · ค่า `text-sm` → `text-base`
       ตาราง `text-xs` → `text-sm`
     ⚠️ ขยับ "ทั้งชุดพร้อมกัน" ไม่ใช่ทีละที่ — ถ้าขยายเฉพาะบางจุด ลำดับความสำคัญ
        ของตัวหนังสือ (ป้ายเล็กกว่าค่า) จะพังและอ่านยากกว่าเดิม
     🔴 [FIX-20260828-RUNSCROLLNEST] 28/08 — เอา `max-h` ของชั้นนี้ออก
        เจ้าของแจ้ง: *"modal ดูรายละเอียดประวัติรายรอบ สั่งหลายครั้งแล้วติดบัค
        scroll ไม่ได้ ตกขอบ"*
        ต้นเหตุคือ **scroller ซ้อนกันสามชั้น**: โมดัล `max-h-[75vh]` →
        `RunSection` body `max-h-[60vh]` → บล็อกนี้ `max-h-[55vh]`
        ⇒ ล้อเมาส์ไปกินชั้นในสุดก่อน · พอชั้นในสุดยังไม่สุด ชั้นนอกไม่ขยับเลย
          และ `<section>` ที่ครอบมี `overflow-hidden` จึงตัดส่วนเกินทิ้ง
          ผู้ใช้เห็นเนื้อหาถูกตัดกลางบรรทัดโดยไม่มีทางเลื่อนไปดู
        ⇒ เหลือ scroller ชั้นเดียวต่อ section (ที่ `RunSection` body) บล็อกนี้
          สูงตามเนื้อหาแล้วให้ชั้นนั้นเลื่อนแทน
        ⚠️ `overflow-x-auto` ยังอยู่ — ตารางกว้างเกินกรอบได้จริง และแกนนอน
           ไม่ได้ซ้อนกับใคร
        ⚠️ ห้ามใส่ `max-h-*` กลับเข้ามาที่นี่ นั่นคือการสร้างชั้นซ้อนอันเดิม
     revert: คืนคลาสตาม git history ของสามไฟล์นี้ */
  return (
    <div className="custom-scrollbar flex flex-col gap-2" data-testid="run-logs">
      {notice && <RunNoticeLine notice={notice} />}

      {logs.length > 0 && (
        <div className="custom-scrollbar overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-700">
              <tr>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_log_col_time')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_log_col_oa')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_log_col_action')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_log_col_endpoint')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_log_col_status')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_log_col_code')}</th>
                <th className="py-2 pr-3 font-medium">{t('broadcast.run_log_col_retries')}</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {logs.map((log, i) => (
                <tr key={`${log.created_at ?? 'log'}-${i}`} className="border-t border-dark-700">
                  {/* ⚠️ ISO string straight to the browser — no offset applied */}
                  <td className="py-2 pr-3 whitespace-nowrap">{formatWhen(log.created_at)}</td>
                  <td className="py-2 pr-3">{log.hook_alias || NOT_MEASURED}</td>
                  <td className="py-2 pr-3">{log.action_type ?? NOT_MEASURED}</td>
                  <td className="py-2 pr-3 break-all font-mono text-xs text-slate-600">
                    {log.method ? `${log.method} ` : ''}
                    {log.endpoint ?? NOT_MEASURED}
                  </td>
                  <td className={`py-2 pr-3 ${STATUS_TONE[log.status ?? ''] ?? 'text-slate-800'}`}>
                    {log.status ?? NOT_MEASURED}
                  </td>
                  <td className="py-2 pr-3">{log.status_code ?? NOT_MEASURED}</td>
                  {/* absent retries = the log predates the counter, not "0 retries" */}
                  <td className="py-2 pr-3">{log.retries ?? NOT_MEASURED}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.some(l => l.error_message) && (
            <ul className="mt-2 flex flex-col gap-1">
              {logs
                .filter(l => l.error_message)
                .map((l, i) => (
                  <li key={`err-${i}`} className="text-xs text-red-400 break-all">
                    {l.hook_alias || NOT_MEASURED}: {l.error_message}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
