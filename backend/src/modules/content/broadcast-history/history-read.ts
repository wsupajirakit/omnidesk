/**
 * [FEAT-20260823-BCASTHISTREAD] Reading the record of runs back out.
 * ===========================================================================
 * Rows have been written since 22/08 and NOTHING has ever read them: there was
 * no endpoint, so the numbers a run measured lived in Mongo and reached no
 * screen. This is the shape half of the way back — pure, per this folder's
 * rule; the model lives in `broadcast-run/history.service.ts`.
 *
 * 🔴 `images_replaced` IS FORWARDED ONLY WHEN PRESENT.
 *
 *    The schema deliberately gives it NO default, and its docblock spells out
 *    why: **absent = nobody looked · 0 = looked, none broken**. A reader that
 *    writes `row.images_replaced ?? 0` destroys exactly the distinction the
 *    omission was built to protect, and every dry-run row starts claiming
 *    "every picture was fine". The `??` that looks like tidy defensive code is
 *    the bug. ไม่มีค่า ≠ ศูนย์ — เติม 0 ให้ = โกหกว่าเคยตรวจแล้ว.
 *
 * 🔴 RECIPIENT STATE NEVER LEAVES. `recipients_captured`, `resume_after_id`
 *    and `next_chunk_index` are the resume machinery's own bookkeeping. They
 *    are not answers to "what happened", and `recipients_captured` is a Mixed
 *    map that grows with the audience. Whitelisting the fields means a column
 *    added later is invisible here until someone chooses to expose it —
 *    which is the safe direction for a collection that touches recipients.
 *
 * revert: delete this file and its line in `index.ts`.
 */

/** Newest first, for one job. Served by `{broadcast_id: 1, started_at: -1}`. */
export function historyOfJobQuery(broadcastId: unknown): {
  filter: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
} {
  return {
    filter: { broadcast_id: broadcastId },
    /* `started_at` and not `_id`: a run's identity is when it STARTED, and the
       index is built on exactly this pair. เรียงตามเวลาเริ่ม ตรงกับ index ที่มี. */
    sort: { started_at: -1 },
  };
}

/** One run, as a reader outside this module is allowed to see it. */
export interface HistoryReadRow {
  readonly run_id: string;
  /**
   * [FIX-20260824-HISTORYJOBNAME] WHICH CAMPAIGN THIS RUN WAS.
   *
   * 🔴 IT WAS STORED AND NEVER RETURNED. `broadcast-history.schema.ts:66` has
   *    carried `broadcast_name` since the collection existed, and the read
   *    whitelist below simply never listed it — so a history table could show
   *    counters and a status for a run and not say what it was a run OF. One job
   *    sends many times, so the run is the unit that matters and the name is the
   *    only thing that makes a row identifiable.
   *    เก็บไว้ตั้งแต่แรกแต่ไม่เคยคืนออกมา ⇒ ตารางประวัติบอกไม่ได้ว่าเป็นงานอะไร.
   *
   * ⚠️ The name AT RUN TIME, not the campaign's current one — the row is a
   *    historical record and must still read correctly after a rename.
   */
  readonly broadcast_id?: unknown;
  readonly broadcast_name?: string;
  readonly hook_id: unknown;
  readonly hook_alias: string;
  readonly send_kind?: string;
  readonly card_type?: string;
  readonly matched: number;
  readonly targeted: number;
  readonly sent: number;
  readonly failed: number;
  readonly unsent: number;
  readonly requests_planned: number;
  readonly requests_made: number;
  readonly chunks_planned: number;
  readonly chunks_done: number;
  /** ⚠️ ABSENT means nobody looked. Never fill it in. */
  readonly images_replaced?: number;
  /**
   * Tags that rendered `N/A`. ⚠️ Same rule: **absent = nothing was rendered**,
   * `[]` = rendered and every tag resolved. Never default it to `[]`.
   */
  readonly unknown_tags?: readonly string[];
  readonly status: string;
  readonly stop_reason?: string;
  readonly error_message?: string;
  readonly triggered_by?: string;
  readonly triggered_by_name?: string;
  readonly started_at?: Date | null;
  readonly finished_at?: Date | null;
  readonly site_rules_age_days?: number;
  /**
   * [FEAT-20260824-RUNSNAPSHOT] What the campaign was set to for THIS round.
   *
   * `{ target, schedule, message_flex_id, hook_ids }` as they were when the
   * round started. `send_kind` / `card_type` are NOT in here — they have their
   * own columns above, and two answers to one question is how a log starts
   * contradicting itself.
   *
   * ⚠️ ABSENT means the round ran before this was captured, NOT "the campaign
   * had no settings". A reader must say so rather than render a blank.
   * ไม่มี = รอบนั้นเก่ากว่าฟีเจอร์นี้ ไม่ใช่ว่าไม่ได้ตั้งอะไร.
   */
  readonly settings_snapshot?: Record<string, unknown>;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined;

/**
 * Shape one stored row for a reader.
 *
 * The counters DO default to 0 — the schema gives them `default: 0`, so a row
 * without one predates the field rather than declining to answer, and 0 is the
 * honest reading. `images_replaced` is the single exception, and it is the one
 * the schema went out of its way to leave undefined.
 */
export function toHistoryReadRow(raw: Record<string, unknown>): HistoryReadRow {
  return {
    run_id: str(raw['run_id']) ?? '',
    /* [FIX-20260824-HISTORYJOBNAME] spread, not `?? null`/`?? ''` — a run row
       written before the name was stored has NO name, and an empty string would
       claim the campaign was called nothing. absent ≠ ''. */
    ...(raw['broadcast_id'] ? { broadcast_id: raw['broadcast_id'] } : {}),
    /* Spread, so "not captured" stays absent instead of becoming `{}` — the
       reader shows the two differently. absent ≠ ตั้งค่าว่าง. */
    ...(raw['settings_snapshot']
      ? {
          settings_snapshot: raw['settings_snapshot'] as Record<
            string,
            unknown
          >,
        }
      : {}),
    ...(str(raw['broadcast_name'])
      ? { broadcast_name: str(raw['broadcast_name']) }
      : {}),
    hook_id: raw['hook_id'] ?? null,
    hook_alias: str(raw['hook_alias']) ?? '',
    ...(str(raw['send_kind']) ? { send_kind: str(raw['send_kind']) } : {}),
    ...(str(raw['card_type']) ? { card_type: str(raw['card_type']) } : {}),
    matched: num(raw['matched']),
    targeted: num(raw['targeted']),
    sent: num(raw['sent']),
    failed: num(raw['failed']),
    unsent: num(raw['unsent']),
    requests_planned: num(raw['requests_planned']),
    requests_made: num(raw['requests_made']),
    chunks_planned: num(raw['chunks_planned']),
    chunks_done: num(raw['chunks_done']),
    /* 🔴 The `??` that is NOT written here is the whole point of this file. */
    ...(typeof raw['images_replaced'] === 'number'
      ? { images_replaced: raw['images_replaced'] }
      : {}),
    /* 🔴 An ARRAY check, not a truthiness one: `[]` is falsy-ish to a careless
       reader and would be dropped, turning "rendered, all tags fine" back into
       "never measured". [] ต้องผ่าน ห้ามตกเพราะว่าง. */
    ...(Array.isArray(raw['unknown_tags'])
      ? { unknown_tags: (raw['unknown_tags'] as unknown[]).map(String) }
      : {}),
    status: str(raw['status']) ?? 'unknown',
    ...(str(raw['stop_reason'])
      ? { stop_reason: str(raw['stop_reason']) }
      : {}),
    ...(str(raw['error_message'])
      ? { error_message: str(raw['error_message']) }
      : {}),
    ...(str(raw['triggered_by'])
      ? { triggered_by: str(raw['triggered_by']) }
      : {}),
    ...(str(raw['triggered_by_name'])
      ? { triggered_by_name: str(raw['triggered_by_name']) }
      : {}),
    started_at: (raw['started_at'] as Date) ?? null,
    finished_at: (raw['finished_at'] as Date) ?? null,
    ...(typeof raw['site_rules_age_days'] === 'number'
      ? { site_rules_age_days: raw['site_rules_age_days'] }
      : {}),
  };
}

/** Only these leave the collection — see the header on why it is a whitelist. */
export const HISTORY_READ_COLUMNS = {
  run_id: 1,
  /* [FIX-20260824-HISTORYJOBNAME] see `HistoryReadRow` — stored since day one,
     never returned, so no history view could name the campaign it belonged to. */
  broadcast_id: 1,
  broadcast_name: 1,
  hook_id: 1,
  hook_alias: 1,
  send_kind: 1,
  card_type: 1,
  matched: 1,
  targeted: 1,
  sent: 1,
  failed: 1,
  unsent: 1,
  requests_planned: 1,
  requests_made: 1,
  chunks_planned: 1,
  chunks_done: 1,
  images_replaced: 1,
  unknown_tags: 1,
  status: 1,
  stop_reason: 1,
  error_message: 1,
  triggered_by: 1,
  triggered_by_name: 1,
  started_at: 1,
  finished_at: 1,
  site_rules_age_days: 1,
  /* [FEAT-20260824-RUNSNAPSHOT] the frozen settings — see `HistoryReadRow` */
  settings_snapshot: 1,
} as const;
