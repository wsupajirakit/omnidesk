import { formatCampaignTime } from '../campaignTime';
/**
 * [FEAT-20260824-RUNDETAIL] The words the run-detail modal is allowed to say.
 * ===========================================================================
 * Pure functions, no React — so the sentences that carry a MEANING (not just a
 * layout) can be tested without a DOM, and so the same wording cannot drift
 * between the three sections that use it.
 *
 * 🔴 EVERY FUNCTION HERE EXISTS TO KEEP AN "ABSENT" APART FROM AN "EMPTY".
 *    That is the whole job of this file. Each `??` that is NOT written below is
 *    deliberate. ไม่มีค่า ≠ ค่าว่าง — ทุกอันในไฟล์นี้แยกสองอย่างนี้.
 *
 * ⚠️ NO TIME ARITHMETIC ANYWHERE IN THIS FILE. Timestamps arrive as ISO strings
 *    and are handed to `toLocaleString`, which renders the viewer's own zone —
 *    that is correct and already agreed. Adding or subtracting 7 hours here is
 *    the classic double-shift bug. See `docs/TIME-RULE.md` in the API repo.
 *    ห้ามบวกลบชั่วโมงในไฟล์นี้เด็ดขาด.
 *
 * 🌐 NO WORD IS SPELLED OUT HERE ANY MORE. Every sentence is an i18n KEY and the
 *    caller hands in its own `t` — the same shape `services/admin/permissionLabels.ts`
 *    already uses (`permissionLabel(id, t)`), which is the repo's one precedent
 *    for translating outside a component. This file must stay React-free: a
 *    `useI18n()` import here would make it a hook and un-testable without a DOM.
 *    โมดูลนี้ห้าม import hook — รับ `t` เข้ามาแทน.
 *
 * revert: delete this file with the rest of `history/BroadcastRunDetail*`.
 */
import type {
  BroadcastRunDetail,
  BroadcastRunRow,
  BroadcastRunSettingsSnapshot
} from '../../../types';

/** Absent must LOOK different from zero — same dash `BroadcastHistoryTable` uses. */
export const NOT_MEASURED = '—';

/**
 * The `t` handed down from `useI18n()`. Taken as an ARGUMENT, never imported —
 * see the 🌐 note in the file header. Same signature as the i18n context's `t`,
 * so a component can pass it straight through.
 */
export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** Tone per run status, matching the existing history table so the two agree. */
export const STATUS_TONE: Record<string, string> = {
  success: 'text-emerald-400',
  partial: 'text-amber-600 dark:text-amber-300',
  error: 'text-red-400',
  refused: 'text-slate-700',
  stopped: 'text-amber-600 dark:text-amber-300'
};

/**
 * An ISO instant, rendered in **Thai time** — never the reader's own zone.
 *
 * 🔴 เดิมเป็น `toLocaleString('th-TH', …)` ซึ่งตั้งแค่ *ภาษา* ⇒ แอดมินที่เปิดจาก
 *    โซนอื่นเห็นเวลาของเครื่องตัวเองที่เขียนเป็นเลขไทย แล้วเข้าใจว่าแคมเปญยิงเวลานั้น
 *    ประวัติการยิงต้องอ่านตรงกันทุกคน ⇒ ปักโซนไว้ที่ `formatCampaignTime`
 */
export const formatWhen = (v?: string | null): string =>
  v ? formatCampaignTime(v, { second: '2-digit' }) : NOT_MEASURED;

/**
 * "board หรือ multi" — the owner asked for this by name, so it gets words and
 * not a raw enum. absent = the round predates the column, NOT "neither".
 */
export const sendKindLabel = (kind: string | undefined, t: TranslateFn): string => {
  if (kind === 'broadcast') return t('broadcast.run_send_kind_broadcast');
  if (kind === 'multicast') return t('broadcast.run_send_kind_multicast');
  /* An unknown kind is echoed RAW, not translated — it is a value the backend
     wrote that this build has no word for, and inventing one would hide it. */
  return kind && kind !== '' ? kind : NOT_MEASURED;
};

/** One card for everybody vs a card per person. absent = not recorded. */
export const cardTypeLabel = (card: string | undefined, t: TranslateFn): string => {
  if (card === 'plain') return t('broadcast.run_card_type_plain');
  if (card === 'dynamic') return t('broadcast.run_card_type_dynamic');
  return card && card !== '' ? card : NOT_MEASURED;
};

/**
 * 🔴 THE `unknown_tags` DISTINCTION, in one place.
 *    · absent → nothing was rendered or measured this round
 *    · `[]`   → it WAS rendered and every tag resolved
 *    Defaulting absent to `[]` would award a clean bill of health to a round
 *    nobody checked. ไม่มี = ไม่ได้เรนเดอร์ · [] = เรนเดอร์แล้วครบทุกแท็ก.
 */
export const unknownTagsLabel = (
  tags: readonly string[] | undefined,
  t: TranslateFn
): string => {
  if (tags === undefined) return NOT_MEASURED;
  if (tags.length === 0) return t('broadcast.run_unknown_tags_all_resolved');
  return tags.join(', ');
};

/** The notice a section shows instead of a blank panel, or `null` for none. */
export interface RunNotice {
  readonly kind: 'expired' | 'error' | 'missing';
  readonly text: string;
}

/**
 * 🔴 THE TWO LOG SILENCES, WHICH ARE NOT THE SAME SILENCE.
 *
 *   · `logsError` present → THE READ ITSELF FAILED. Nothing is known about the
 *     traffic. Checked FIRST precisely because it must never be reported as an
 *     expiry — an expiry is a normal, healthy state and this is not.
 *   · `logsExpired: true` → the read SUCCEEDED and found nothing, because
 *     `webhook_logs` carries a 45-day TTL (`created_at_ttl45`) while history
 *     rows carry none. Every round older than 45 days lands here and MOST OF
 *     THEM SENT PERFECTLY. Rendering an empty list with no sentence reads as a
 *     bug — or worse, as "this round sent nothing", which is a false claim
 *     about the customer's campaign.
 *     🔴 log หมดอายุแล้ว ≠ รอบนี้ไม่ได้ส่ง — ห้ามแสดงเป็นลิสต์ว่างเฉย ๆ.
 *
 * Returns `null` when there are logs to show and nothing to explain.
 */
export const logsNotice = (
  detail: Pick<BroadcastRunDetail, 'logsExpired' | 'logsError'>,
  t: TranslateFn
): RunNotice | null => {
  if (typeof detail.logsError === 'string' && detail.logsError !== '') {
    /* ⚠️ `{message}` carries the backend's own reason INTO the sentence — every
       locale must keep the placeholder or the admin loses the only clue. */
    return { kind: 'error', text: t('broadcast.run_logs_read_failed', { message: detail.logsError }) };
  }
  if (detail.logsExpired) {
    return { kind: 'expired', text: t('broadcast.run_logs_expired') };
  }
  return null;
};

/**
 * 🔴 WHICH SNAPSHOT THIS ROUND ACTUALLY HAD.
 *
 * Rows are one per OA and all of a round's rows are written from the same
 * settings, so the first row that HAS one is the round's. Returning `undefined`
 * rather than `{}` is the load-bearing part: `{}` would render as an
 * empty-but-present configuration.
 *
 * ⚠️ absent = the round ran BEFORE this capture existed. It is NOT
 *    "ไม่ได้ตั้งเงื่อนไข" — a job with no conditions still stores a snapshot
 *    saying so. absent ≠ ไม่ได้ตั้งเงื่อนไข.
 */
export const snapshotOf = (
  rows: readonly BroadcastRunRow[]
): BroadcastRunSettingsSnapshot | undefined =>
  rows.find(r => r.settings_snapshot !== undefined)?.settings_snapshot;

/**
 * The sentence shown in place of the conditions panel when there is none.
 * A FUNCTION, not a const, because the words are now resolved per locale.
 */
export const missingSnapshotNotice = (t: TranslateFn): RunNotice => ({
  kind: 'missing',
  text: t('broadcast.run_snapshot_missing')
});

/**
 * `0..6` → the weekday keys the repeat-schedule form ALREADY ships
 * (`broadcast.repeat_day_*`), so the round detail and the form that produced it
 * can never spell a day differently. ใช้คีย์เดียวกับฟอร์มตั้งเวลา.
 */
const DAY_KEYS = [
  'broadcast.repeat_day_sun',
  'broadcast.repeat_day_mon',
  'broadcast.repeat_day_tue',
  'broadcast.repeat_day_wed',
  'broadcast.repeat_day_thu',
  'broadcast.repeat_day_fri',
  'broadcast.repeat_day_sat'
];

/** `0..6` → day initials. Out-of-range values are shown raw, not dropped. */
export const daysLabel = (days: readonly number[] | undefined, t: TranslateFn): string => {
  if (days === undefined) return NOT_MEASURED;
  /* 🔴 absent vs [] again: no days chosen is a REAL setting, not missing data. */
  if (days.length === 0) return t('broadcast.run_days_none');
  if (days.length === 7) return t('broadcast.run_days_all');
  const keys = DAY_KEYS;
  return days.map(d => (keys[d] !== undefined ? t(keys[d] as string) : String(d))).join(' ');
};

/**
 * Minutes-from-midnight → `HH:MM`.
 *
 * ⚠️ This is NOT a timezone conversion — it is a clock reading of a number the
 *    snapshot already stored in its own zone (`schedule.tz_offset_min` says
 *    which). Nothing is added to or subtracted from an instant.
 *    แปลงนาที→นาฬิกา ไม่ใช่แปลง timezone.
 */
export const minuteOfDay = (m?: number): string => {
  if (typeof m !== 'number') return NOT_MEASURED;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

/**
 * `420` → `UTC+07:00`. A LABEL for the window numbers above, nothing more.
 * ⚠️ Never applied to `started_at` / `finished_at`. ห้ามเอาไปใช้กับเวลาจริง.
 */
export const tzLabel = (offsetMin?: number): string => {
  if (typeof offsetMin !== 'number') return NOT_MEASURED;
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

/** One audience rule, as a person reads it. Values are shown, never summarised. */
export const ruleLabel = (rule: { key?: string; op?: string; value?: unknown }): string => {
  const value = Array.isArray(rule.value)
    ? rule.value.map(v => String(v)).join(', ')
    : rule.value === undefined || rule.value === null
      ? NOT_MEASURED
      : String(rule.value);
  return `${rule.key ?? NOT_MEASURED} ${rule.op ?? NOT_MEASURED} ${value}`;
};

/**
 * One clickable line in the history tab = ONE ROUND, gathered from its per-OA
 * rows.
 *
 * 🔴 THIS GROUPING IS A LIST CONVENIENCE ONLY. The modal shows the rows
 *    UNAGGREGATED, because a round that succeeded on one OA and failed on
 *    another has no single honest status. `statuses` is therefore a SET, not a
 *    winner: nothing here invents a "partial" the backend never wrote.
 *    รวมเพื่อให้กดง่าย ไม่ได้รวมเพื่อสรุปแทน BE.
 *
 * 🔴 `images_replaced` IS NOT SUMMED. Summing it would have to decide what an
 *    absent one contributes, and every available answer is a lie. The modal
 *    shows it per OA, where the dash still means "nobody looked".
 */
export interface RunGroup {
  readonly run_id: string;
  readonly broadcast_name?: string;
  readonly started_at?: string | null;
  readonly send_kind?: string;
  readonly oa_count: number;
  readonly sent: number;
  readonly failed: number;
  readonly statuses: readonly string[];
}

export const groupRuns = (rows: readonly BroadcastRunRow[]): RunGroup[] => {
  const order: string[] = [];
  const byRun = new Map<string, RunGroup>();
  for (const row of rows) {
    const prev = byRun.get(row.run_id);
    if (!prev) {
      order.push(row.run_id);
      byRun.set(row.run_id, {
        run_id: row.run_id,
        ...(row.broadcast_name ? { broadcast_name: row.broadcast_name } : {}),
        started_at: row.started_at ?? null,
        ...(row.send_kind ? { send_kind: row.send_kind } : {}),
        oa_count: 1,
        sent: row.sent,
        failed: row.failed,
        statuses: [row.status]
      });
      continue;
    }
    byRun.set(row.run_id, {
      ...prev,
      // keep the first non-empty name/kind: a later row cannot un-name the round
      ...(prev.broadcast_name === undefined && row.broadcast_name
        ? { broadcast_name: row.broadcast_name }
        : {}),
      ...(prev.send_kind === undefined && row.send_kind
        ? { send_kind: row.send_kind }
        : {}),
      oa_count: prev.oa_count + 1,
      sent: prev.sent + row.sent,
      failed: prev.failed + row.failed,
      statuses: prev.statuses.includes(row.status)
        ? prev.statuses
        : [...prev.statuses, row.status]
    });
  }
  return order.map(id => byRun.get(id) as RunGroup);
};
