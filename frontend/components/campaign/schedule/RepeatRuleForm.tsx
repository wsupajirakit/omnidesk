/**
 * [FEAT-20260824-BCASTREPEAT] Set the cadence a campaign repeats on.
 * ===========================================================================
 * Owner, 24/08: *"repeat ด้วยต้องตั้งค่าได้จริงใ้ชได้จริง รันทุกๆตอนไหน นาที ชั่วโมง
 * วันไหนของวีค จ - อาทิตย์"* · *"ตั้งผ่าน fe + db + be"*.
 *
 * 🔴 THE SHAPE IS THE BACKEND'S, FIELD FOR FIELD. Every name here matches
 *    `broadcast-schedule/schedule-shape.ts` exactly — `every_minutes`,
 *    `days_of_week`, `window_start_min`, `window_end_min`, `tz_offset_min`,
 *    `ends_at`, `max_runs`. A rename on either side is a field the
 *    `ValidationPipe` strips silently, with a 200 and nothing saved. Three
 *    fields in this repo have already been lost that way.
 *    ชื่อฟิลด์ต้องตรงกับ BE เป๊ะ ผิดชื่อ = หายเงียบ ไม่มี error.
 *
 * 🔴 `mode` IS THE SWITCH AND IT IS `'once' | 'repeat'`, NOTHING ELSE. The
 *    backend reads `=== 'repeat'`, so any other string means "run once" —
 *    silently. That is why this is a radio pair and not a free field.
 *    mode พิมพ์ผิด = ยิงครั้งเดียวแบบเงียบ ⇒ ต้องเป็นตัวเลือก ไม่ใช่ช่องพิมพ์.
 *
 * ⚠️ MINUTES, NOT A CRON STRING. Minutes cover hours; hours cannot cover
 *    minutes. The two convenience buttons below write minutes too — there is
 *    one unit in the system.
 *
 * ⚠️ EMITTING `null` MEANS "no repeat" and clears a stored rule. Emitting
 *    `undefined` is not this component's job: the parent decides whether the
 *    field is sent at all. ส่ง null = ล้างรอบซ้ำ.
 *
 * 🔴 ITS OWN FILE. `BroadcastFormModal.tsx` is already 1,098 lines, past the
 *    400-line cap; the waiver list may only shrink (dev-local §6.1).
 *
 * revert: delete this file and stop sending `schedule`. Jobs already carrying a
 * rule keep repeating — the backend owns that, not this form.
 */
import React from 'react';

import { openNativePicker } from '../../common/LogDateRangeFilter';

import { useI18n } from '../../../i18n';

/** Mirrors `BroadcastScheduleDto` on the backend. Names must match exactly. */
export interface RepeatRule {
  mode?: string;
  enabled?: boolean;
  /** [FEAT-20260825-ATTIME] นาทีในวัน (15:00 ⇒ 900) คู่กับ `tz_offset_min` เสมอ */
  at_time_min?: number;
  /** @deprecated ฟอร์มไม่เขียนแล้ว — ตัวอ่านฝั่ง BE ยังอยู่เพื่อแถวเก่า */
  every_minutes?: number;
  days_of_week?: number[];
  /** @deprecated เหมือน `every_minutes` */
  window_start_min?: number;
  /** @deprecated เหมือน `every_minutes` */
  window_end_min?: number;
  tz_offset_min?: number;
  starts_at?: string | null;
  ends_at?: string | null;
  max_runs?: number;
}

/**
 * The floor the backend enforces (`MIN_EVERY_MINUTES` = 60 / 6 runs-per-hour).
 * Shown here so the form cannot ask for a cadence the abuse guard refuses —
 * but the backend is still the one that decides. เพดานจริงอยู่ BE อันนี้แค่กันพิมพ์.
 */
export const MIN_EVERY_MINUTES = 10;
export const DAY_MINUTES = 1440;
/** `+07:00`. Thailand has no DST, so a number is enough. */
export const DEFAULT_TZ_OFFSET_MIN = 420;
/** 09:00 ไทย — ค่าเริ่มต้นตอนกด "ส่งซ้ำ" ครั้งแรก */
export const DEFAULT_AT_TIME_MIN = 540;

/** `0`=Sun … `6`=Sat — the order `Date#getUTCDay()` uses, so nothing converts. */
const DAY_KEYS = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat'
] as const;

/** `540` ⇒ `"09:00"`. */
export const minutesToHhMm = (min: number): string => {
  const safe = Math.max(0, Math.min(DAY_MINUTES, Math.floor(min)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** `"09:00"` ⇒ `540`. Anything unparseable answers `null`, never a guess. */
export const hhMmToMinutes = (value: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
};

export interface RepeatRuleFormProps {
  /** The stored rule. `null`/`undefined` = this campaign runs once. */
  readonly value?: RepeatRule | null;
  /** `null` = clear the rule (back to a one-off campaign). */
  readonly onChange: (rule: RepeatRule | null) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

export const RepeatRuleForm: React.FC<RepeatRuleFormProps> = ({
  value,
  onChange,
  disabled = false,
  className = ''
}) => {
  const { t } = useI18n();
  const rule = value ?? null;
  const repeating = rule?.mode === 'repeat';

  const patch = (next: Partial<RepeatRule>) => {
    onChange({ ...(rule ?? {}), ...next, mode: 'repeat' });
  };

  const days = Array.isArray(rule?.days_of_week) ? rule.days_of_week : [];
  const toggleDay = (day: number) => {
    const has = days.includes(day);
    patch({
      days_of_week: has ? days.filter(d => d !== day) : [...days, day].sort()
    });
  };

  const field =
    'w-full px-3 py-2 rounded-lg bg-slate-800/60 text-slate-100 border border-slate-700';

  return (
    <div className={className} data-testid="repeat-rule-form">
      <div className="flex gap-2" role="group" aria-label={t('broadcast.repeat_mode_label')}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className={`px-3 py-2 rounded-lg border text-sm ${
            repeating
              ? 'border-slate-700 text-slate-700'
              : 'border-emerald-600 text-emerald-800 bg-emerald-50'
          }`}
          data-testid="repeat-mode-once"
        >
          {t('broadcast.repeat_mode_once')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            patch({
              /* Defaults that are legal on the first click: a daily 09:00 send
                 in Bangkok time. An admin who clicks "repeat" and saves must
                 get a working rule, not a validation error.
                 กดแล้วต้องใช้ได้เลย ไม่ใช่เด้ง error. */
              /* [FEAT-20260825-ATTIME] กดแล้วต้องใช้ได้เลย: ยิงทุกวัน 09:00 ไทย
                 ⚠️ ส่ง `tz_offset_min` คู่มาเสมอ — `at_time_min` ลอย ๆ ไม่มีความหมาย */
              at_time_min: rule?.at_time_min ?? DEFAULT_AT_TIME_MIN,
              tz_offset_min: rule?.tz_offset_min ?? DEFAULT_TZ_OFFSET_MIN
            })
          }
          className={`px-3 py-2 rounded-lg border text-sm ${
            repeating
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50'
              : 'border-slate-700 text-slate-700'
          }`}
          data-testid="repeat-mode-repeat"
        >
          {t('broadcast.repeat_mode_repeat')}
        </button>
      </div>

      {!repeating && (
        <p className="mt-2 text-xs text-slate-700" data-testid="repeat-off-hint">
          {t('broadcast.repeat_off_hint')}
        </p>
      )}

      {repeating && (
        <div className="mt-3 space-y-3" data-testid="repeat-fields">
          {/* ── สวิตช์ปิด/เปิดราย job ────────────────────────────────────
              [FIX-20260824-BCASTJOBSWITCH] เจ้าของ 24/08: "job มันแยกกันไม่เกี่ยวกัน
              แต่ละงาน … ต้องอ่านจริง ตั้งได้จริง ควบคุมได้จริง"

              🔴 ต่างจาก "ส่งครั้งเดียว/ส่งซ้ำ" ด้านบน — อันนั้นลบกฎทิ้ง อันนี้
                 **พักไว้โดยไม่ลบ**: ตารางเวลา วัน ช่วงเวลา เบรก ยังอยู่ครบ
                 เปิดกลับเมื่อไหร่ก็ทำงานต่อทันที ไม่ต้องตั้งใหม่
                 ปิด = พัก ไม่ใช่ลบ ⇒ เปิดกลับได้โดยไม่ต้องจำค่าเดิม

              ⚠️ ไม่ตั้ง = เปิด (BE: `isJobScheduleEnabled` ตอบ true ให้ undefined)
                 ⇒ แคมเปญที่มีอยู่ก่อนคอลัมน์นี้ทำงานเหมือนเดิมทุกใบ */}
          {/* [UI-20260828-ROWTOGGLE] เจ้าของ 28/08: *"กด row ตรงไหนก็ได้ เท่ากับการกด toggle"*
              🔴 เป้ากดเดิมคือเม็ดยาเล็ก ๆ มุมขวา — ต้องเล็งถึงจะโดน ทั้งที่ทั้งแถว
                 พูดถึงสวิตช์ตัวเดียวกันอยู่แล้ว
              🔴 **แถวทั้งแถวเป็น `<button>` เดียว ไม่ใช่ปุ่มซ้อนปุ่ม** — HTML ห้ามซ้อน
                 button และถ้าซ้อนจริง คลิกเดียวจะยิง handler สองครั้งแล้วสลับกลับที่เดิม
                 (สลับสองรอบ = ไม่เกิดอะไรขึ้น ผู้ใช้จะเห็นเป็นปุ่มเสีย)
                 ⇒ เม็ดยาลดบทบาทเป็น `<span>` ที่ทำหน้าที่บอกสถานะอย่างเดียว
              ⚠️ `aria-pressed` ย้ายมาอยู่ที่แถว เพราะแถวคือตัวควบคุมแล้ว
              ⚠️ `text-left` จำเป็น — `<button>` จัดข้อความกลางโดยปริยาย จะทำให้
                 ป้ายกับคำอธิบายขยับจากเดิม
              revert: คืน `<div>` ครอบ แล้วเอา onClick/aria กลับไปไว้ที่เม็ดยา */}
          <button
            type="button"
            disabled={disabled}
            aria-pressed={rule?.enabled !== false}
            onClick={() => patch({ enabled: rule?.enabled === false })}
            data-testid="repeat-enabled-toggle"
            className={`flex w-full items-center justify-between rounded-lg border border-slate-700 px-3 py-2 text-left ${
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-emerald-500'
            }`}
          >
            <span className="block">
              <span className="block text-sm font-medium text-slate-800">
                {t('broadcast.repeat_enabled_label')}
              </span>
              <span className="block text-xs text-slate-700">
                {t('broadcast.repeat_enabled_hint')}
              </span>
            </span>
            <span
              data-testid="repeat-enabled-pill"
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                rule?.enabled === false
                  ? 'border-slate-600 text-slate-700'
                  : 'border-emerald-600 text-emerald-800 bg-emerald-50'
              }`}
            >
              {rule?.enabled === false
                ? t('broadcast.repeat_enabled_off')
                : t('broadcast.repeat_enabled_on')}
            </span>
          </button>

          {rule?.enabled === false && (
            <p className="text-xs text-amber-700" data-testid="repeat-paused-hint">
              {t('broadcast.repeat_paused_hint')}
            </p>
          )}

          {/* ── ทำซ้ำ ตอนกี่โมง ─────────────────────────────────────────
              [FEAT-20260825-ATTIME] เจ้าของ 25/08: *"ทำซ้ำ ตอนกี่โมง = เลือกเวลาในวัน
              พอถึงเวลานั้นก็ยิง"* — แทนที่ "ส่งซ้ำทุก ๆ n นาที" ของเดิม

              🔴 ค่าที่ส่งขึ้นไปคือ `at_time_min` = **นาทีในวัน** (15:00 ⇒ 900)
                 ไม่ใช่ instant · มันมีความหมายได้ก็ต่อเมื่อไปคู่กับ `tz_offset_min`
                 ⇒ ส่งคู่กันเสมอ (ดู `docs/TIME-RULE.md` ฝั่ง BE)
                 BE เอาสองค่านี้ไปหา instant แล้วเก็บ `next_run_at` เป็น UTC

              🔴 เวลาที่แอดมินเห็นและกรอก = **เวลาไทย** เสมอ ไม่ใช่เวลาเครื่องคนเปิด
                 `<input type="time">` ไม่มี timezone ติดมาอยู่แล้ว ⇒ ตัวเลขที่พิมพ์
                 คือนาทีในวันตรง ๆ ไม่ต้องแปลง และห้ามเอา `getHours()` มายุ่ง
                 ซึ่งจะอ่านโซนของเบราว์เซอร์แล้วเพี้ยนเมื่อเปิดจากโซนอื่น

              ⚠️ ไม่มี "เริ่มเวลา/ถึงเวลา" อีกแล้ว — ช่องนี้แทนทั้งคู่ (เจ้าของสั่งตัด) */}
          <div>
            <label className="block text-sm font-medium text-slate-800">
              {t('broadcast.repeat_at_time_label')}
            </label>
            {/* [FEAT-20260817-DATEINPUTOPEN] กดตรงไหนของช่องก็เปิดตัวเลือกเวลา ไม่ต้องเล็งไอคอน
               เจ้าของสั่ง 26/08 ให้ขยายกติกาเดิม (ที่ทำกับ date picker ไว้แล้ว 17/08) มาถึงช่องเวลา
               ของฟอร์ม broadcast ด้วย · reuse `openNativePicker` ตัวเดิม ห้ามเขียนใหม่ —
               มันกันไว้สองชั้นแล้ว (เมธอดไม่มีบน Safari เก่า · โยน NotAllowedError เมื่อไม่ได้มาจาก
               การกดของผู้ใช้) และ **ห้ามผูกกับ focus** เพราะ focus ยิงตอนปิด picker ด้วย
               ⇒ วนเปิดไม่หยุดบน Chrome */}
            <input
              type="time"
              onClick={openNativePicker}
              value={minutesToHhMm(rule?.at_time_min ?? DEFAULT_AT_TIME_MIN)}
              disabled={disabled}
              onChange={e => {
                const min = hhMmToMinutes(e.target.value);
                /* อ่านไม่ออก = ไม่แตะค่าเดิม ห้ามเดาเป็น 0 (เที่ยงคืน) */
                if (min !== null) {
                  patch({
                    at_time_min: Math.min(min, DAY_MINUTES - 1),
                    tz_offset_min: rule?.tz_offset_min ?? DEFAULT_TZ_OFFSET_MIN
                  });
                }
              }}
              className={field}
              data-testid="repeat-at-time"
            />
            <p className="mt-1 text-xs text-slate-700" data-testid="repeat-at-time-hint">
              {t('broadcast.repeat_at_time_hint')}
            </p>
          </div>

          {/* ── วันไหนของสัปดาห์ (จ–อา) ─────────────────────────────────── */}
          <div>
            {/* [UI-20260828-DAYSRED] หัวข้อแดงตามเมื่อยังไม่เลือกวัน
                🔴 ข้อความเตือนอยู่ **ใต้แถวปุ่ม** ⇒ คนที่กวาดตาจากบนลงล่างจะเห็น
                   หัวข้อก่อนเสมอ · ถ้าหัวข้อยังดำปกติ สายตาจะอ่านผ่านไปเลย
                   ⇒ ให้หัวข้อกับข้อความใช้สัญญาณสีเดียวกัน = จุดที่ผิดถูกล้อมด้วยสีแดง
                     ทั้งบนและล่าง หาไม่ยากแม้ในฟอร์มยาว
                ⚠️ เงื่อนไขเดียวกับข้อความเตือนเป๊ะ (`days.length === 0`) — ถ้าใช้คนละ
                   เงื่อนไข จะมีสถานะที่หัวข้อแดงแต่ไม่มีข้อความบอกว่าผิดอะไร */}
            <label
              className={`block text-sm font-medium ${
                days.length === 0 ? 'text-red-600' : 'text-slate-800'
              }`}
            >
              {t('broadcast.repeat_days_label')}
            </label>
            {/* [FIX-20260825-DAYSBIGGER] เจ้าของ 25/08: *"วันที่ จ อาทิตย์ ขยายใหญ่
                + มีกดเลือกทุกวัน"* · ปุ่มเดิม px-2 py-1 text-xs เล็กจนกดพลาดง่าย
                ⇒ ขยายเป็นช่องสี่เหลี่ยมขนาดกดสบาย และสีเขียวเข้มขึ้นให้อ่านออกบนพื้นสว่าง
                (emerald-300 เป็นเฉดของธีมมืด — หน้านี้สว่างล้วน) */}
            <div className="flex gap-1.5 flex-wrap items-center" data-testid="repeat-days">
              {DAY_KEYS.map((key, index) => {
                const on = days.includes(index);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleDay(index)}
                    aria-pressed={on}
                    className={`min-w-[3rem] px-3 py-2 rounded-lg border text-sm font-semibold transition-all ${
                      on
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-400/50'
                        : 'border-slate-300 text-slate-600 hover:border-emerald-500'
                    }`}
                    data-testid={`repeat-day-${index}`}
                  >
                    {t(`broadcast.repeat_day_${key}`)}
                  </button>
                );
              })}

              {/* เลือกทุกวัน / ล้าง — สลับด้วยปุ่มเดียว ไม่ต้องกดทีละวัน
                  ⚠️ "ล้าง" ให้ลิสต์ว่าง ซึ่งระบบแปลว่า "ทุกวัน" อยู่แล้ว
                     ปุ่มนี้จึงเป็นแค่ทางลัดของหน้าจอ ไม่ได้เปลี่ยนกติกาเบื้องหลัง */}
              <button
                type="button"
                disabled={disabled}
                data-testid="repeat-days-all"
                onClick={() =>
                  onChange({
                    ...(rule ?? {}),
                    mode: 'repeat',
                    days_of_week: days.length === DAY_KEYS.length ? [] : DAY_KEYS.map((_, i) => i),
                  })
                }
                className="ml-1 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 transition-all hover:border-emerald-500 hover:text-emerald-700"
              >
                {days.length === DAY_KEYS.length
                  ? t('broadcast.repeat_days_clear')
                  : t('broadcast.repeat_days_select_all')}
              </button>
            </div>
            {/* [FIX-20260828-REPEATDAYS] ข้อความตรงนี้เปลี่ยนความหมายไปแล้ว
                🔴 เดิมเขียนว่า "ไม่เลือกวัน = ส่งทุกวัน" ซึ่ง **ขัดกับกฎใหม่**:
                   ตั้งแต่ 28/08 โหมดส่งซ้ำบังคับให้เลือกอย่างน้อยหนึ่งวัน
                   (`BroadcastFormModal.validate()`) ⇒ ปล่อยข้อความเดิมไว้คือการ
                   บอกผู้ใช้ว่าไม่ต้องเลือกก็ได้ แล้วพอกดเซฟถึงค่อยโดนปฏิเสธ
                ⇒ เอาข้อความเตือนตัวเดียวกับตอนเซฟมาไว้ตรงนี้ ⇒ อ่านเจอตั้งแต่
                  ก่อนกดเซฟ และเป็นประโยคเดียวกันทั้งสองที่ ไม่ใช่คนละคำ
                ⚠️ คง `data-testid` เดิมไว้ — เทสที่มีอยู่อ้างชื่อนี้ */}
            {days.length === 0 && (
              <p
                /* [UI-20260828-DAYSRED] แดงจริง ไม่ใช่ส้ม
                   🔴 `amber-700` (#B45309) อ่านออกก็จริง แต่มันคือโทน "เตือน"
                      ซึ่งสื่อว่า "รู้ไว้นะ" · อันนี้คือ **เซฟไม่ผ่าน** ต้องเป็นโทนเดียว
                      กับ error อื่นในฟอร์ม ไม่งั้นผู้ใช้จะจัดมันเป็นข้อความเสริม
                      แล้วกดเซฟต่อ · `red-600` คือโทนเดียวกับ `InputError` ของฟอร์มนี้ */
                className="mt-1 text-xs font-medium text-red-600"
                data-testid="repeat-days-all-hint"
              >
                {t('broadcast.form_repeat_days_required')}
              </p>
            )}
          </div>

          {/* ── เบรกตัวเดียว: จำนวนรอบ ──────────────────────────────────────
              [FEAT-20260825-ATTIME] เจ้าของ 25/08: *"หยุดซ้ำหลังวันที่ ไม่ต้องมีตัดทิ้ง"* ·
              *"หยุดหลังครบกี่รอบ > คงไว้ แต่ถ้าไม่ใส่ = ทำไปเรื่อย ๆ"*

              ⚠️ `ends_at` ถูกตัดออกจาก **หน้าจอ** เท่านั้น ตัวอ่านฝั่ง BE ยังอยู่
                 เพื่อให้แคมเปญที่เคยตั้งวันสิ้นสุดไว้ยังหยุดตามเดิม — ฟอร์มนี้แค่
                 ไม่เสนอให้ตั้งใหม่ ของเก่ายังทำงาน ไม่ต้อง migrate */}
          <div className="grid grid-cols-1 gap-2">
            <div>
              <label className="block text-xs text-slate-700">
                {t('broadcast.repeat_max_runs')}
              </label>
              <input
                type="number"
                min={1}
                value={rule?.max_runs ?? ''}
                disabled={disabled}
                onChange={e => {
                  const n = Number(e.target.value);
                  patch({
                    max_runs: e.target.value === '' || !Number.isFinite(n) ? undefined : n
                  });
                }}
                className={field}
                data-testid="repeat-max-runs"
              />
            </div>
          </div>

          {/* 🔴 Both brakes empty = it repeats until someone stops it. Said
              plainly, because a runaway campaign is the expensive mistake here.
              ไม่ใส่เบรกทั้งสองช่อง = ซ้ำไปเรื่อย ๆ จนมีคนไปปิด. */}
          {rule?.max_runs === undefined && (
            <p className="text-xs text-amber-700" data-testid="repeat-no-brake-hint">
              {t('broadcast.repeat_no_brake_hint')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default RepeatRuleForm;
