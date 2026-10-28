/**
 * [FEAT-20260826-JOBIDCELL] job id + คัดลอก + ปุ่ม info — **ทุกแถวเหมือนกัน**
 * ============================================================================
 * เจ้าของสั่ง 26/08: *"แสดง id และ [copy] ให้เหมือนกันทุกแถวเลย พร้อมปุ่ม info
 * กดแล้วเปิดแท็บ history / copy ต้องใช้ได้จริง + มี toast แจ้ง"*
 *
 * 🔴 ใช้ `utils/copyText` **ไม่ใช่ `navigator.clipboard` ตรง ๆ**
 *    `[FIX-20260816-COPYHTTP]` บันทึกไว้ว่า clipboard API มีเฉพาะ secure context
 *    ⇒ บน http (ซึ่งคือ `console.omnidesk.test:8088` พอดี) มันเป็น **no-op เงียบ ๆ**
 *    ผู้ใช้กดแล้วไม่มีอะไรเกิดขึ้นและไม่มีอะไรบอก · `copyText` มี fallback เป็น
 *    `execCommand` และ **คืนผลจริง** ให้เอาไปบอก toast ได้ว่าสำเร็จหรือล้มเหลว
 *    ⚠️ ผมเขียน `navigator.clipboard` ตรง ๆ ไปรอบหนึ่งแล้ว — ผิดแบบเดียวกับที่
 *       ไฟล์นั้นเตือนไว้เป๊ะ ห้ามกลับไปใช้อีก
 *
 * ⚠️ แสดง **ทุกแถว** ไม่ใช่เฉพาะแถวที่ล้มเหลว — เจ้าของต้องการให้หน้าตาเท่ากันหมด
 *    (เดิมโชว์เฉพาะแถวล้มเหลว ทำให้แถวอื่นคัดลอก id ไม่ได้เลย)
 *
 * revert: ลบไฟล์นี้ + การเรียกใน pages/messaging/Broadcasts.tsx
 */
import React from 'react';
import { Copy, Check, Info } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { copyText } from '../../../utils/copyText';

interface Props {
  readonly jobId: string;
  /** กดปุ่ม info → เปิดแท็บประวัติ */
  readonly onOpenHistory: () => void;
  /** บอกผลการคัดลอก — หน้าเป็นคนแสดง toast เอง ตัวนี้ไม่ผูกกับ UI ตัวใด */
  readonly onCopied: (ok: boolean) => void;
}

export const JobIdCell: React.FC<Props> = ({ jobId, onOpenHistory, onCopied }) => {
  const { t } = useI18n();
  const [done, setDone] = React.useState(false);

  const copy = (): void => {
    void copyText(jobId).then(ok => {
      onCopied(ok);
      if (!ok) return;
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    });
  };

  return (
    <div className="mt-1 flex items-center gap-1" data-testid={`jobid-${jobId}`}>
      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
        {jobId}
      </code>
      <button
        type="button"
        onClick={copy}
        data-testid={`jobid-copy-${jobId}`}
        title={t('broadcast.copy_job_id')}
        aria-label={t('broadcast.copy_job_id')}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        {done ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
      </button>
      <button
        type="button"
        onClick={onOpenHistory}
        data-testid={`jobid-info-${jobId}`}
        title={t('broadcast.failed_open_history')}
        aria-label={t('broadcast.failed_open_history')}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-sky-600"
      >
        <Info size={12} />
      </button>
    </div>
  );
};

export default JobIdCell;
