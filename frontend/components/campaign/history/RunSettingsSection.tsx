/**
 * [FEAT-20260824-RUNDETAIL] เงื่อนไขตอนนั้น — what the job was set to when it ran.
 *
 * Owner 24/08: *"พร้อมบอก job detail ที่รัน เงื่อนไขทั้งหมด ว่าตอนนั้น job ตั้งอะไรไว้"*.
 *
 * 🔴 THESE ARE THE FROZEN SETTINGS, NOT THE CAMPAIGN'S CURRENT ONES. The whole
 *    value of the panel is that it still reads correctly after somebody edits
 *    the job — so nothing here may fall back to the live campaign object.
 *    ต้องอ่านจาก snapshot เท่านั้น ห้ามไปดึงค่าปัจจุบันมาเติม.
 *
 * 🔴 A MISSING SNAPSHOT GETS A SENTENCE, NOT A BLANK PANEL. Rounds that ran
 *    before the capture existed have none, and an empty area reads either as a
 *    bug or as "this job had no conditions" — which is a different and false
 *    statement. `absent ≠ ไม่ได้ตั้งเงื่อนไข`.
 *
 * ⚠️ `tz_offset_min` is rendered as a LABEL beside the window numbers and is
 *    never applied to any instant on this screen. See `docs/TIME-RULE.md`.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import type { BroadcastRunRow } from '../../../types';
import { RunNoticeLine } from './RunNoticeLine';
import {
  missingSnapshotNotice,
  NOT_MEASURED,
  daysLabel,
  minuteOfDay,
  ruleLabel,
  snapshotOf,
  tzLabel
} from './runDetailFormat';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs text-slate-700">{label}</span>
    <span className="text-base text-slate-700 break-all">{children}</span>
  </div>
);

export const RunSettingsSection: React.FC<{ rows: BroadcastRunRow[] }> = ({ rows }) => {
  const { t } = useI18n();
  const snapshot = snapshotOf(rows);

  /* 🔴 `undefined`, not `{}` — the service and the backend both keep the field
     absent on purpose, and this is the branch that turns that into words. */
  if (snapshot === undefined) {
    return <RunNoticeLine notice={missingSnapshotNotice(t)} testId="run-snapshot-missing" />;
  }

  const target = snapshot.target ?? undefined;
  const schedule = snapshot.schedule ?? undefined;
  const rules = target?.rules ?? [];

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
    <div className="custom-scrollbar flex flex-col gap-4 overflow-x-auto" data-testid="run-settings">
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-600">{t('broadcast.run_settings_target_title')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label={t('broadcast.run_settings_mode')}>{target?.mode ?? NOT_MEASURED}</Field>
          <Field label={t('broadcast.run_settings_match')}>{target?.match ?? NOT_MEASURED}</Field>
          <Field label={t('broadcast.run_settings_groups')}>
            {target?.group_ids && target.group_ids.length > 0
              ? target.group_ids.join(', ')
              : /* [] = ไม่ได้เจาะกลุ่ม · absent = ไม่มีข้อมูลกลุ่มในรอบนั้น */
                target?.group_ids
                ? t('broadcast.run_settings_no_group_filter')
                : NOT_MEASURED}
          </Field>
        </div>
        {rules.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1" data-testid="run-settings-rules">
            {rules.map((rule, i) => (
              <li
                key={`${rule.key ?? 'rule'}-${i}`}
                className="rounded-lg bg-dark-800/60 px-3 py-1.5 font-mono text-sm text-slate-700"
              >
                {ruleLabel(rule)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-700">{t('broadcast.run_settings_no_rules')}</p>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-600">{t('broadcast.run_settings_schedule_title')}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="run-settings-schedule">
          <Field label={t('broadcast.run_settings_mode')}>{schedule?.mode ?? NOT_MEASURED}</Field>
          <Field label={t('broadcast.run_settings_every_minutes')}>
            {typeof schedule?.every_minutes === 'number' ? schedule.every_minutes : NOT_MEASURED}
          </Field>
          <Field label={t('broadcast.run_settings_days')}>{daysLabel(schedule?.days_of_week, t)}</Field>
          {/* ⚠️ ตัวเลขนาทีในหน้าต่างนี้อยู่ในเขตเวลาของ snapshot เอง — ไม่แปลงซ้ำ */}
          <Field label={t('broadcast.run_settings_window')}>
            {`${minuteOfDay(schedule?.window_start_min)} – ${minuteOfDay(schedule?.window_end_min)}`}
          </Field>
          <Field label={t('broadcast.run_settings_tz')}>{tzLabel(schedule?.tz_offset_min)}</Field>
          <Field label={t('broadcast.run_settings_max_runs')}>
            {typeof schedule?.max_runs === 'number' ? schedule.max_runs : NOT_MEASURED}
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t('broadcast.run_settings_flex_id')}>{snapshot.message_flex_id ?? NOT_MEASURED}</Field>
        <Field label={t('broadcast.run_settings_hook_ids')}>
          {snapshot.hook_ids && snapshot.hook_ids.length > 0
            ? snapshot.hook_ids.join(', ')
            : NOT_MEASURED}
        </Field>
      </div>
    </div>
  );
};
