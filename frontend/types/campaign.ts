// [REFACTOR-20260808-TYPESPLIT] Outbound-messaging domain: auto-replies + broadcasts.
import type { MessageType, Pagination, ReplyMatchType } from './common';

export interface AutoReplyResponse {
  type: MessageType;
  text?: string;
  image_url?: string;
  flex_json?: any;
}

export interface AutoReplyEntry {
  id: string;
  name: string;
  hook_ids: string[];
  assign_group?: string | null;
  keyword: string;
  mode?: 'push' | 'reply' | 'single_reply';
  match_type: ReplyMatchType;
  response: AutoReplyResponse;
  priority: number;
  active: boolean;
  created_by?: string;
  updated_by?: string;
  /**
   * [FEAT-20260823-BCASTACTOR] Who set this campaign up, as a person reads it.
   *
   * 🔴 `null` = the id could not be resolved (the account was removed, or the
   *    lookup was unavailable) — **not** "nobody made this". `created_by`
   *    above still holds the id, and it is what a support ticket traces, so
   *    the name never replaces it. แปลไม่ออก ≠ ไม่มีคนสร้าง.
   */
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AutoReplyFormData {
  name: string;
  hook_ids: string[];
  assign_group?: string | null;
  keyword: string;
  mode?: 'push' | 'reply' | 'single_reply';
  match_type: ReplyMatchType;
  response: AutoReplyResponse;
  priority: number;
  active: boolean;
}

export interface AutoReplyListResponse {
  data: AutoReplyEntry[];
  pagination: Pagination;
}

/**
 * [FEAT-20260823-BCASTAUDFE] One condition on who receives a broadcast.
 * ===========================================================================
 * 🔌 THE SEAM. `key` must be one the BACKEND's registry knows
 * (`omnidesk-api/src/modules/content/audience/sources/audience-source.registry.ts`).
 * An unknown key does NOT get ignored — `buildAudienceFilter` refuses the whole
 * job, on purpose: dropping a condition it cannot build would make the audience
 * WIDER than the admin asked for, which is the one failure that cannot be
 * undone once the messages are out. key ที่ BE ไม่รู้จัก = ปฏิเสธทั้งงาน ไม่ใช่เมินเงียบ.
 *
 * ⇒ Never hard-code a key here. Read the list from `getAudienceSources()` and
 *   offer only what came back.
 */
export interface AudienceRule {
  /** From `getAudienceSources()`, never invented on this side. */
  key: string;
  /** Must be one of that source's own `ops` — the BE rejects any other. */
  /* [FEAT-20260825-HASVALUE] `has_value` / `no_value` = "มีค่า" / "ไม่มีค่า"
     สองตัวนี้ **ไม่ใช้ค่า** — BE เมิน `value` ทิ้งโดยตั้งใจ เพื่อให้กฎที่เพิ่ง
     สลับ op มาจากตัวอื่นแล้วยังมีค่าเก่าติดอยู่ ยังสร้างคิวรี่ได้ปกติ
     ⚠️ ยูเนียนนี้ถูกเทียบกับ `AudienceOp` ฝั่ง BE แบบตรงตัวโดย
        `test/audienceSeamDrift.value.test.ts` ⇒ เพิ่มฝั่งเดียวจะแดง */
  op: 'lte' | 'gte' | 'eq' | 'in' | 'contains' | 'has_value' | 'no_value';
  value: unknown;
}

/** One entry of the backend's audience registry, as it arrives on the wire. */
export interface AudienceSourceInfo {
  key: string;
  label_th: string;
  label_en: string;
  type: string;
  ops: string[];
  /**
   * ⚠️ RENAMED ON THE WIRE. The backend calls this `scope_by_hook` internally
   * and sends it as `requires_hook_scope`. Mirroring the internal name here
   * would read `undefined` for every source with no error anywhere.
   * ชื่อบนสายกับชื่อในโค้ด BE ไม่เหมือนกัน ต้องใช้ชื่อบนสาย.
   */
  requires_hook_scope: boolean;
  /** [FEAT-2708-GUARDWINDOW] true = the per-job guard window governs this
   *  source — BE's policy file owns the set, FE only reads the flag. */
  guard_window?: boolean;
  /** `false` = the question is answerable but slow. Worth warning about. */
  indexed: boolean;
  /** Present only when retired: keep showing it on saved jobs, never offer it. */
  deprecated?: boolean;
}

export interface BroadcastTarget {
  mode: 'all' | 'group';
  group_ids?: string[];
  /**
   * [FEAT-20260823-BCASTAUDFE] 🔌 PREPARED, NOT YET USED BY ANY UI.
   *
   * The backend has accepted these since 22/08 and nothing has ever sent them
   * — `{mode:'all'}` becomes "no rules", which is every broadcast today. They
   * are declared now so that adding the picker later is a UI change only, with
   * no type, service or contract work in the way.
   *
   * ⚠️ OPTIONAL ON PURPOSE. Every stored job predates them, so a required
   *    field here would make every existing broadcast fail to type-check on
   *    read. งานเก่าทุกใบไม่มีสองฟิลด์นี้.
   */
  match?: 'and' | 'or';
  rules?: AudienceRule[];
}

/**
 * [FEAT-20260823-BCASTSENDKIND] Which LINE endpoint a job goes out on.
 *
 * 🔴 `null` / absent = **the sender this job has always used**, and that is the
 *    normal state — every campaign saved before 23/08 is in it, and none of
 *    them may change because a field appeared. Only a job that names a kind
 *    moves. เจ้าของสั่ง: "ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด".
 */
export type BroadcastSendKind = 'broadcast' | 'multicast';

export interface BroadcastMessage {
  type: MessageType;
  text?: string;
  image_url?: string;
  flex_json?: any;
  /**
   * [FEAT-20260824-BCASTFLEXID] The library card this job SENDS, by reference.
   *
   * 🔴 The backend reads this FIRST and only falls back to `flex_json`, so a job
   *    carrying both sends the library's version. `null`/absent = a campaign
   *    saved before 24/08, which keeps sending its own copy.
   *    เก็บ id ไม่เก็บสำเนา ⇒ แก้การ์ดที่ต้นทาง job เดิมตามด้วย · ของเก่ายังส่งได้ปกติ.
   */
  flex_id?: string | null;
}

export interface BroadcastEntry {
  id: string;
  name: string;
  hook_ids: string[];
  /** @deprecated [FEAT-20260825-MULTIGROUP] กลุ่มแรกของ `assign_group_ids` */
  assign_group?: string | null;
  /**
   * [FEAT-20260825-MULTIGROUP] กลุ่มเว็บทั้งหมด — **ตัวหลักที่ BE คืนมา**
   * ⚠️ optional เพราะแคมเปญที่เขียนก่อน 25/08 ไม่มีคีย์นี้ · absent ≠ []
   */
  assign_group_ids?: string[];
  target: BroadcastTarget;
  message: BroadcastMessage;
  status: string;
  scheduled_at?: string | null;
  sent_at?: string | null;
  /** [FEAT-20260823-BCASTTITLE] What the API sends back — `null` = none set. */
  title_detail?: string | null;
  /** [FEAT-20260823-BCASTSENDKIND] `null` = the sender this job always used. */
  send_kind?: string | null;
  /** [FEAT-2708-GUARDWINDOW] freshness window in hours (1-72) · null = none */
  guard_window_hours?: number | null;
  /** [FEAT-20260823-BCASTCARDTYPE] `null` = one card for everybody. */
  card_type?: string | null;
  /**
   * [FEAT-20260824-BCASTREPEAT] The repeat rule. `null`/absent = runs once,
   * which is what every campaign saved before 24/08 does.
   *
   * 🔴 Field names must match `broadcast-schedule/schedule-shape.ts` on the
   *    backend EXACTLY — `ValidationPipe` strips a mismatched name silently,
   *    with a 200 and nothing stored. ชื่อผิด = หายเงียบ ไม่มี error.
   */
  schedule?: {
    mode?: string;
    enabled?: boolean;
    every_minutes?: number;
    days_of_week?: number[];
    window_start_min?: number;
    window_end_min?: number;
    tz_offset_min?: number;
    starts_at?: string | null;
    ends_at?: string | null;
    max_runs?: number;
  } | null;
  /**
   * [FEAT-20260824-BCASTREPEAT] What the scheduler wrote back. READ-ONLY —
   * shown so an admin can see a repeat is armed. No request accepts them.
   */
  next_run_at?: string | null;
  last_run_at?: string | null;
  run_count?: number | null;

  /**
   * [FEAT-20260823-BCASTDESC] Why this campaign exists.
   *
   * 🔴 REQUIRED WHEN CREATING, optional on an existing one. Every campaign
   *    saved before the column has none, and blocking an edit on a field the
   *    campaign never had would make renaming an old broadcast impossible.
   *    ⚠️ The backend decides — `ensureValidDescription`. CHANGE ONE, CHANGE BOTH.
   */
  description?: string | null;
  /** [FEAT-20260825-BCASTDIRECTTICKET] multicast เท่านั้น — ยิงถึงใครแล้วเปิดเคสรอให้ */
  is_direct_ticket?: boolean;
  /** [FEAT-20260825-BCASTSKIPASSIST] ข้ามคนที่แอดมินกำลังคุยอยู่ */
  skip_assist?: boolean;
  created_by?: string;
  updated_by?: string;
  /**
   * [FEAT-20260823-BCASTACTOR] Who set this campaign up, as a person reads it.
   *
   * 🔴 `null` = the id could not be resolved (the account was removed, or the
   *    lookup was unavailable) — **not** "nobody made this". `created_by`
   *    above still holds the id, and it is what a support ticket traces, so
   *    the name never replaces it. แปลไม่ออก ≠ ไม่มีคนสร้าง.
   */
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BroadcastFormData {
  name: string;
  hook_ids: string[];
  /**
   * @deprecated [FEAT-20260825-MULTIGROUP] ไม่ใช่ทางหลักแล้ว
   * คือ **กลุ่มแรก** ของ `assign_group_ids` · ส่งคู่ไปเพื่อให้ตัวกรองการมองเห็น
   * ฝั่ง BE ที่ยังอ่านคีย์เก่า เห็นแถวที่เขียนใหม่ด้วย — ไม่ใช่เพราะยังใช้มันอยู่
   */
  assign_group?: string | null;
  /** [FEAT-20260825-MULTIGROUP] กลุ่มเว็บทั้งหมดของ job นี้ — **ตัวหลัก** */
  assign_group_ids: string[];
  target: BroadcastTarget;
  message: BroadcastMessage;
  status: string;
  scheduled_at?: string | null;
  /**
   * [FEAT-20260823-BCASTTITLE] The line a recipient reads in their chat list
   * and on their lock screen, before opening anything. Becomes the flex
   * `altText`.
   *
   * ⚠️ FLEX ONLY — a text or image message has no `altText`, so the field must
   *    not be offered for those types. Rules live in `utils/broadcastTitle.ts`
   *    and are enforced for real by the backend.
   *    ⇒ ไม่กรอก = ใช้ค่าเริ่มต้น "line messages"
   */
  title_detail?: string | null;
  /** [FEAT-20260823-BCASTSENDKIND] `null`/absent ⇒ unchanged behaviour. */
  send_kind?: string | null;
  /** [FEAT-2708-GUARDWINDOW] freshness window in hours (1-72) · null = none */
  guard_window_hours?: number | null;
  /** [FEAT-20260823-BCASTCARDTYPE] `null`/absent ⇒ one card for everybody. */
  card_type?: string | null;
  /**
   * [FEAT-20260824-BCASTREPEAT] The repeat rule. `null`/absent = runs once,
   * which is what every campaign saved before 24/08 does.
   *
   * 🔴 Field names must match `broadcast-schedule/schedule-shape.ts` on the
   *    backend EXACTLY — `ValidationPipe` strips a mismatched name silently,
   *    with a 200 and nothing stored. ชื่อผิด = หายเงียบ ไม่มี error.
   */
  schedule?: {
    mode?: string;
    enabled?: boolean;
    every_minutes?: number;
    days_of_week?: number[];
    window_start_min?: number;
    window_end_min?: number;
    tz_offset_min?: number;
    starts_at?: string | null;
    ends_at?: string | null;
    max_runs?: number;
  } | null;

  /**
   * [FEAT-20260823-BCASTDESC] Why this campaign exists — required when
   * CREATING one, optional when editing a campaign that predates the column.
   */
  description?: string | null;
  /** [FEAT-20260825-BCASTDIRECTTICKET] multicast เท่านั้น — ยิงถึงใครแล้วเปิดเคสรอให้ */
  is_direct_ticket?: boolean;
  /** [FEAT-20260825-BCASTSKIPASSIST] ข้ามคนที่แอดมินกำลังคุยอยู่ */
  skip_assist?: boolean;
}

export interface BroadcastListResponse {
  data: BroadcastEntry[];
  pagination: Pagination;
}

/**
 * [FEAT-20260823-BCASTPREVIEW] One OA's card, exactly as its followers get it.
 */
export interface BroadcastPreviewCard {
  hook_id: string;
  hook_name: string;
  /** A LINE message object — hand it to `<FlexBubble json={...} />` as-is. */
  message: any;
  /** Tags nothing could fill; they rendered `N/A`. The only place these show. */
  unknownTags: string[];
}

export interface BroadcastPreview {
  /**
   * 🔴 Which sender this reflects — always show it.
   *
   * `legacy` = the running backend substitutes NOTHING and ignores
   * `title_detail`, so `{{tags}}` come back intact because that is what the
   * customer would receive. Without this label the admin reads it as a bug.
   * `new` = variables filled per OA; `member.*`/`profile.*` are `N/A` because
   * a broadcast is one request with no recipient list.
   */
  mirrors: 'new' | 'legacy';
  cards: BroadcastPreviewCard[];
  /**
   * The job names more OAs than one run may reach; this preview shows the
   * first N. Present only when it happened — a silent cap would read as
   * "these are all your OAs" while the send refuses the job outright.
   */
  truncatedToHooks?: number;
}

/**
 * [FEAT-20260823-BCASTHISTREAD] One run of a broadcast, as the API returns it.
 *
 * 🔴 `images_replaced` IS OPTIONAL AND MUST STAY OPTIONAL.
 *    **absent = nobody looked · 0 = looked, none broken.** The backend schema
 *    deliberately omits the field rather than defaulting it, and a `?? 0`
 *    anywhere on this side throws that away — every dry-run row would then
 *    read as "every picture was fine". Show a dash for absent, the number for
 *    0. ไม่มีค่า ≠ ศูนย์ ห้ามเติม.
 */
export interface BroadcastHistoryRow {
  run_id: string;
  hook_id: string | null;
  hook_alias: string;
  send_kind?: string;
  /** [FEAT-2708-GUARDWINDOW] freshness window in hours (1-72) */
  guard_window_hours?: number | null;
  card_type?: string;
  matched: number;
  targeted: number;
  sent: number;
  failed: number;
  unsent: number;
  requests_planned: number;
  requests_made: number;
  chunks_planned: number;
  chunks_done: number;
  /** ⚠️ absent = never measured. Do NOT default it. */
  images_replaced?: number;
  status: string;
  stop_reason?: string;
  error_message?: string;
  triggered_by?: string;
  triggered_by_name?: string;
  started_at?: string | null;
  finished_at?: string | null;
  site_rules_age_days?: number;
}

export interface BroadcastHistoryPage {
  data: BroadcastHistoryRow[];
  meta: { total: number; page: number; limit: number };
}

/**
 * [FEAT-20260824-RUNDETAIL] One round of one campaign, in full.
 * ===========================================================================
 * Owner 24/08: *"history ต้องจอย webhook log มาใช้ไหม ต้องแสดงทั้ง history +
 * webhook log จะได้ครบ แต่ว่าทำเป็น modal กดดู"*.
 *
 * 🔴 THESE ARE ADDITIONS, NOT EDITS. `BroadcastHistoryRow` above is what the
 *    LIST endpoint returns and is consumed by `BroadcastHistoryTable`; the RUN
 *    endpoint returns the same row plus three fields the list view never asked
 *    for. Widening the old interface would make every list consumer look as if
 *    it could read them. เพิ่มชนิดใหม่ ไม่แก้ของเดิม.
 */

/**
 * What the campaign was set to WHEN THIS ROUND RAN — frozen, not current.
 *
 * 🔴 `send_kind` / `card_type` are deliberately NOT in here: they have their own
 *    columns on the row, and two answers to one question is how a record starts
 *    contradicting itself. Mirrors `history-read.ts` on the backend.
 *
 * The index signature is forward-compatibility only: the backend stores this as
 * a free-form object, so a key added later must survive the trip rather than be
 * silently dropped by a field-by-field copy.
 */
export interface BroadcastRunSettingsSnapshot {
  target?: {
    mode?: string;
    group_ids?: string[];
    match?: string;
    rules?: Array<{ key?: string; op?: string; value?: unknown }>;
  } | null;
  schedule?: {
    mode?: string;
    enabled?: boolean;
    every_minutes?: number;
    days_of_week?: number[];
    window_start_min?: number;
    window_end_min?: number;
    /**
     * ⚠️ A LABEL, NEVER A CONVERSION. It records which zone the window numbers
     *    were written in. No screen may add or subtract it from a timestamp —
     *    see `docs/TIME-RULE.md` in the API repo. ห้ามเอาไปบวกลบกับเวลาจริง.
     */
    tz_offset_min?: number;
    starts_at?: string | null;
    ends_at?: string | null;
    max_runs?: number;
  } | null;
  message_flex_id?: string | null;
  hook_ids?: string[];
  [key: string]: unknown;
}

/**
 * A history row as the RUN-DETAIL endpoint returns it.
 *
 * 🔴 `settings_snapshot` ABSENT = the round ran before the capture existed —
 *    **not** "the campaign had no conditions". A blank panel reads as a broken
 *    screen, so the reader must say which one it is.
 *    ไม่มี = รอบนั้นเก่ากว่าฟีเจอร์นี้ ไม่ใช่ว่าไม่ได้ตั้งเงื่อนไข.
 *
 * 🔴 `unknown_tags` ABSENT = nothing was rendered or measured · `[]` = rendered
 *    and every tag resolved. Two different facts; never default one to the
 *    other. Same family of trap as `images_replaced` on the row above.
 *    ไม่มี ≠ ว่าง.
 */
export interface BroadcastRunRow extends BroadcastHistoryRow {
  broadcast_id?: string;
  /** The campaign's name AT RUN TIME — survives a later rename, by design. */
  broadcast_name?: string;
  /** ⚠️ absent = never rendered · `[]` = rendered, all tags resolved. */
  unknown_tags?: string[];
  /** ⚠️ absent = round predates the capture. Do NOT default it to `{}`. */
  settings_snapshot?: BroadcastRunSettingsSnapshot;
}

/**
 * One HTTP request this run made to LINE.
 *
 * ⚠️ NOT the same unit as a history row. A history row is one (run × OA) and
 *    says what the CAMPAIGN decided; this is one request and says what LINE
 *    ANSWERED. คนละหน่วยนับ — ห้ามยุบรวมเป็นตารางเดียว.
 */
export interface BroadcastRunLogEntry {
  hook_id?: string | null;
  hook_alias?: string;
  action_type?: string;
  endpoint?: string;
  method?: string;
  status?: string;
  status_code?: number;
  error_message?: string;
  retries?: number;
  created_at?: string | null;
}

/**
 * The whole modal payload.
 *
 * 🔴 `logsExpired` AND `logsError` ARE DIFFERENT THINGS and must never be
 *    collapsed into one "no logs" branch:
 *      · `logsExpired: true`  → the read SUCCEEDED and found nothing, because
 *        `webhook_logs` has a 45-day TTL while history rows have none. The
 *        round almost certainly DID send. log หมดอายุ ≠ ไม่ได้ส่ง.
 *      · `logsError` present  → the read itself failed. Absent ≠ no error only
 *        in the sense that the field simply isn't sent on success.
 */
export interface BroadcastRunDetail {
  run_id: string;
  rows: BroadcastRunRow[];
  logs: BroadcastRunLogEntry[];
  logsExpired: boolean;
  /** Present ONLY when reading the logs threw. Not the same as expiry. */
  logsError?: string;
}
