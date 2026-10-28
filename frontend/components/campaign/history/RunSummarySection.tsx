/**
 * [FEAT-20260824-RUNDETAIL] สรุปรอบ — what this round did, per OA.
 *
 * Owner 24/08: *"ประวัติต้องบอกว่า board หรือ multi"* — so `send_kind` is the
 * first thing on the card, in words, not an enum tucked into a table cell.
 *
 * 🔴 ONE CARD PER (ROUND × OA), NEVER SUMMED INTO ONE. A round that succeeded
 *    on one OA and failed on another has no single honest set of counters, and
 *    the backend deliberately writes a row per OA for exactly that reason.
 *    หนึ่งรอบมีหลาย OA ⇒ แสดงแยก ไม่รวบเป็นตัวเลขเดียว.
 *
 * 🔴 `images_replaced` — absent = nobody looked · 0 = looked, none broken. The
 *    dash is the point; a `?? 0` here would be the fourth and final place this
 *    feature could throw the distinction away. เติม 0 = โกหกว่าเคยตรวจแล้ว.
 *
 * ⚠️ `sent` is what LINE ACCEPTED, not what was delivered or read — LINE gives
 *    no per-recipient receipt on a broadcast. The note under the counters says
 *    so, because "ส่งแล้ว 500" is otherwise read as 500 people.
 *    ยอมรับคำขอ ≠ ส่งถึงคน.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import type { BroadcastRunRow } from '../../../types';
import {
  NOT_MEASURED,
  STATUS_TONE,
  cardTypeLabel,
  formatWhen,
  sendKindLabel,
  unknownTagsLabel
} from './runDetailFormat';

/** One labelled number. `undefined` renders the dash, never a zero. */
const Counter: React.FC<{ label: string; value?: number; testId?: string }> = ({
  label,
  value,
  testId
}) => (
  <div className="rounded-lg bg-dark-800/60 px-3 py-2">
    <p className="text-xs text-slate-700">{label}</p>
    <p className="text-base font-semibold text-slate-900" data-testid={testId}>
      {value === undefined ? NOT_MEASURED : value}
    </p>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs text-slate-700">{label}</span>
    <span className="text-base text-slate-700">{children}</span>
  </div>
);

export const RunSummarySection: React.FC<{ rows: BroadcastRunRow[] }> = ({ rows }) => {
  /* 🌐 the words come from here and are handed DOWN into the pure formatters —
     `runDetailFormat.ts` never imports a hook. See its header. */
  const { t } = useI18n();
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
    <div className="custom-scrollbar flex flex-col gap-3 overflow-x-auto" data-testid="run-summary">
      {rows.map(row => (
        <div
          key={row.run_id + String(row.hook_id)}
          className="rounded-lg border border-dark-700 p-3 flex flex-col gap-3"
          data-testid={`run-summary-row-${String(row.hook_id)}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary-500/15 px-2.5 py-1 text-xs font-semibold text-primary-300"
                  data-testid={`run-send-kind-${String(row.hook_id)}`}>
              {sendKindLabel(row.send_kind, t)}
            </span>
            <span className="rounded-full bg-dark-800 px-2.5 py-1 text-xs text-slate-600">
              {cardTypeLabel(row.card_type, t)}
            </span>
            <span className={`ml-auto text-xs font-semibold ${STATUS_TONE[row.status] ?? 'text-slate-800'}`}>
              {row.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Counter label={t('broadcast.run_counter_matched')} value={row.matched} />
            <Counter label={t('broadcast.run_counter_targeted')} value={row.targeted} />
            <Counter label={t('broadcast.run_counter_sent')} value={row.sent} />
            <Counter label={t('broadcast.run_counter_failed')} value={row.failed} />
            <Counter label={t('broadcast.run_counter_unsent')} value={row.unsent} />
            <Counter label={t('broadcast.run_counter_requests_planned')} value={row.requests_planned} />
            <Counter label={t('broadcast.run_counter_requests_made')} value={row.requests_made} />
            <Counter label={t('broadcast.run_counter_chunks_planned')} value={row.chunks_planned} />
            <Counter label={t('broadcast.run_counter_chunks_done')} value={row.chunks_done} />
            {/* 🔴 the dash is the point — see the header of this file */}
            <Counter
              label={t('broadcast.run_counter_images_replaced')}
              value={row.images_replaced}
              testId={`run-images-${String(row.hook_id)}`}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('broadcast.run_field_oa')}>{row.hook_alias || NOT_MEASURED}</Field>
            <Field label={t('broadcast.run_field_triggered_by')}>
              {row.triggered_by_name || row.triggered_by || NOT_MEASURED}
            </Field>
            <Field label={t('broadcast.run_field_unknown_tags')}>
              <span data-testid={`run-unknown-tags-${String(row.hook_id)}`}>
                {unknownTagsLabel(row.unknown_tags, t)}
              </span>
            </Field>
            {/* ⚠️ printed straight from the ISO string — no offset is applied */}
            <Field label={t('broadcast.run_field_started')}>{formatWhen(row.started_at)}</Field>
            <Field label={t('broadcast.run_field_finished')}>{formatWhen(row.finished_at)}</Field>
            <Field label={t('broadcast.run_field_reason')}>
              {row.stop_reason ?? row.error_message ?? NOT_MEASURED}
            </Field>
          </div>
        </div>
      ))}
      {/* ⚠️ the sentence that stops “sent 500” being read as 500 people */}
      <p className="text-[11px] text-slate-700">{t('broadcast.run_sent_note')}</p>
    </div>
  );
};
