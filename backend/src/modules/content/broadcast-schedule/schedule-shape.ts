/**
 * [FEAT-20260822-BCASTSCHED] The column names the scanner reads, and the
 * repeat-rule shape it is handed — with provenance for every single one.
 * ===========================================================================
 * 🔴 THE RULE THIS FILE EXISTS TO ENFORCE: a field name is never typed twice
 * and never guessed. Each constant below carries the LINE of
 * `content/schemas/broadcast.schema.ts` it was read from (verified 2026-08-22).
 * A rename in the schema breaks one line here, not eleven scattered filters.
 * ชื่อคอลัมน์ต้องมีที่มา ห้ามเดา.
 *
 * 🔴🔴 READ THIS BEFORE USING `BroadcastSchedule` — IT IS NOT PERSISTED YET.
 * The four scheduling columns the plan designs (§11b.3.2) — `schedule`,
 * `next_run_at`, `last_run_at`, `run_count` — and the `broadcast_due` index
 * (§11b.5.2) DO NOT EXIST in `broadcast.schema.ts` today. Adding a DB field
 * needs the owner's explicit approval, so this folder does NOT add them.
 * What it does instead: express the CONTRACT the owner already wrote in the
 * plan, as pure types and pure functions, so that the day the columns are
 * approved the wiring is a schema edit — not a redesign.
 * ⇒ every function here takes the rule as an ARGUMENT. Nothing reads a column
 *   that does not exist. สัญญามาก่อน คอลัมน์มาทีหลัง.
 *
 * revert: delete this file with the rest of `broadcast-schedule/`.
 */

/* ── columns that REALLY EXIST in broadcasts today ─────────────────────── */

/** `broadcast.schema.ts:108` — the enum column the scan keys on. */
export const STATUS_FIELD = 'status';

/**
 * `broadcast.schema.ts:111` — `scheduled_at?: Date`.
 *
 * 🔑 WHY THE SCAN KEYS ON THIS AND NOT ON `next_run_at`
 * `next_run_at` is what the plan wants (§11b.3.1 separates three questions:
 * `scheduled_at` = the admin's INTENT · `schedule` = the repeat RULE ·
 * `next_run_at` = the computed STATE). It does not exist yet, so keying on it
 * would mean inventing a column — forbidden. `scheduled_at` is the only real
 * date the scanner can ask about today, and for a `mode:'once'` job it is
 * exactly the right one.
 *
 * ⚠️ IT IS NOT RIGHT FOR A REPEAT JOB, and that is the whole reason
 * `next_run_at` is being asked for: §11b.3.1 measures the cost of overwriting
 * `scheduled_at` each round — "ค่าที่แอดมินตั้งไว้หายทันทีที่ยิงรอบแรก", the
 * admin reopens the form and sees a time the system computed instead of the one
 * they typed. ⇒ nothing in this folder ever WRITES `scheduled_at`.
 * ⇒ `computeNextRun` returns the next instant and hands it back to the caller;
 *   where that instant is stored is the owner's decision, not this file's.
 */
export const DUE_AT_FIELD = 'next_run_at';

/**
 * ✅ SWITCHED 22/08 — the owner approved `next_run_at` after the seamless dive
 * (แผน §PH.31). Until then this pointed at `scheduled_at`, the only date column
 * that existed, with the trap above written out in full.
 *
 * 🔴 WHAT CHANGED FOR EXISTING ROWS: nothing, and deliberately. Every row
 * created before today has NO `next_run_at`, and a missing value is not due —
 * so no job that predates this feature can be picked up by the scan. It can
 * still only be sent by somebody pressing send, exactly as before.
 * ของเก่าไม่มีค่านี้ ⇒ ไม่มีวันถึงกำหนดเอง ⇒ พฤติกรรมเดิมทุกประการ.
 *
 * ⚠️ That is also D22 restated: a legacy job someone MEANT to be scheduled is
 * invisible to the scan until something writes `next_run_at` to it. On dev the
 * count of such rows is 0 (measured); stg and prod must be counted before the
 * switch is turned on — §S.3 step 1.
 *
 * `scheduled_at` keeps its old meaning: what the admin typed. Nothing in this
 * folder writes it, then or now.
 */
export const ADMIN_SET_AT_FIELD = 'scheduled_at';

/** `broadcast.schema.ts:124` — soft delete. See the trap note in `due-query.ts`. */
export const DELETED_AT_FIELD = 'deleted_at';

/** `broadcast.schema.ts:147` — set by `buildClaimQuery`. */
export const CLAIMED_AT_FIELD = 'claimed_at';

/** `broadcast.schema.ts:158` — when a claim goes stale. The sweep's only key. */
export const LEASE_UNTIL_FIELD = 'lease_until';

/** `broadcast.schema.ts:162` — which process holds the claim. */
export const CLAIMED_BY_FIELD = 'claimed_by';

/**
 * The one status a job must be in to be picked up.
 *
 * From the enum at `broadcast.schema.ts:105`. `draft` is excluded because it was
 * never scheduled, and `sent`/`failed`/`cancelled` are finished — the same set
 * `broadcast-send/claim.ts:29` calls `CLAIMABLE_FROM`, and it is deliberately
 * the same set: a job the scanner surfaces must be a job the claim can take,
 * or the scanner hands the runner work it will always be refused.
 */
export const DUE_STATUS = 'scheduled';

/**
 * [FIX-20260823-BCASTSCANKIND] The column that decides whether a due job may be
 * run automatically at all.
 *
 * 🔴 IT HAS TO BE IN THE SCAN'S PROJECTION. `runJob` refuses a job with no
 *    `send_kind`, because the legacy sender has no claim and two instances
 *    would send it twice — but the scan projects three columns on purpose
 *    (`flex_json` is `Mixed` and tens of KB per row), so the field was simply
 *    ABSENT from every scanned row and every job was refused as "not opted in".
 *
 *    Found by running the real scheduler, not by a unit test: the fake handed
 *    the runner a FULL document, which the real scan never does.
 *    เทสปลอมส่งเอกสารเต็มให้ ของจริงส่งแค่ 3 คอลัมน์ ⇒ ปฏิเสธทุกงาน.
 *
 * ⚠️ A string column, so adding it to the projection costs nothing — unlike
 *    the message body the projection exists to keep out.
 */
export const SEND_KIND_FIELD = 'send_kind';

/* ── the repeat rule — CONTRACT ONLY, not a schema ─────────────────────── */

/**
 * The repeat rule, exactly as แผน §11b.3.2 specifies it.
 *
 * ⚠️ Every field is optional and every field is `unknown`-tolerant at the
 * reader, because `.lean()` DOES NOT APPLY DEFAULTS: a row written before this
 * feature reads back as `undefined` here, and a row written by a script can
 * hold anything at all. §S-3 of the plan is blunt about the consequence — read
 * with `=== <the value you want>`, NEVER with `!==`, or an `undefined` from an
 * old row walks straight into the wrong branch. That trap has already been paid
 * for twice in this repo (`send_kind`, `ignore_abandon_assist`).
 * ค่าที่หายไปต้องแปลว่า "พฤติกรรมเดิม" เสมอ.
 */
export interface BroadcastSchedule {
  /** `'once' | 'repeat'`. Missing ⇒ `'once'` ⇒ there is no next round. */
  mode?: unknown;
  /** Per-job kill switch (level 2 of §11b.6.5). Only `false` means off. */
  enabled?: unknown;
  /**
   * [FEAT-20260825-ATTIME] "ทำซ้ำ ตอนกี่โมง" — minutes from local midnight.
   *
   * 🔴 THE CANONICAL FIELD FOR EVERY NEW REPEAT RULE. `15:00` = `900`. When it
   *    is set the job fires ONCE on each selected day at exactly that time, and
   *    `every_minutes` / `window_start_min` / `window_end_min` are IGNORED.
   *    เจ้าของ 25/08: *"ส่งซ้ำทุก ๆ ให้แก้เป็น ทำซ้ำ ตอนกี่โมง (เมื่อถึงเวลานี้) ให้ทำ"* ·
   *    *"เริ่มเวลา กับถึงเวลาไม่ต้องมี"*.
   *
   * ⚠️ THE THREE FIELDS BELOW ARE KEPT, AND THAT IS NOT INDECISION. Rows written
   *    before today hold a cadence + window and nothing else; deleting the
   *    readers would make `computeNextRun` answer `null` for them, and a live
   *    repeat would stop with no error anywhere. So: new rows write
   *    `at_time_min`, old rows keep working, nothing migrates.
   *    ของเก่ายังอ่านได้ ⇒ ไม่ต้อง migrate และไม่มีงานไหนหยุดเงียบ ๆ.
   *
   * ⚠️ absent ≠ 0. `0` is a real time (midnight); absent means "this is a legacy
   *    cadence rule, read the window instead".
   */
  at_time_min?: unknown;
  /** Cadence in MINUTES — §11b.3.3: minutes cover hours, hours cannot cover minutes. */
  every_minutes?: unknown;
  /** `0`=Sun … `6`=Sat, matching `Date#getUTCDay()` exactly so nothing converts. */
  days_of_week?: unknown;
  /** Minutes from local midnight, inclusive. `09:00` = 540. */
  window_start_min?: unknown;
  /** Minutes from local midnight, EXCLUSIVE. `18:00` = 1080. */
  window_end_min?: unknown;
  /** `+07:00` = 420. A number, not "Asia/Bangkok" — Thailand has no DST. */
  tz_offset_min?: unknown;
  /** Nothing fires before this instant. */
  starts_at?: unknown;
  /** Nothing fires after this instant. The brake on a runaway repeat. */
  ends_at?: unknown;
  /** Stop after this many rounds. The other brake. */
  max_runs?: unknown;
}

/** The columns of a candidate row the scan/sweep decisions actually read. */
export interface BroadcastScheduleRow {
  readonly status?: unknown;
  /**
   * The scheduler's cursor — the column `DUE_AT_FIELD` names.
   *
   * 🔴 READ THROUGH `DUE_AT_FIELD`, never by this literal name. A version of
   * `isDueNow` read `row.scheduled_at` directly while the QUERY selected on
   * `next_run_at`, so the scan would pick a job up and the in-memory recheck
   * would immediately call it "not due" — every round, forever, with no error.
   * Two names for one idea is how that happens. อ่านผ่านค่าคงที่เสมอ ห้ามพิมพ์ชื่อตรง ๆ.
   */
  readonly next_run_at?: unknown;
  /** What the ADMIN typed. Never the due cursor; see `ADMIN_SET_AT_FIELD`. */
  readonly scheduled_at?: unknown;
  readonly deleted_at?: unknown;
  readonly lease_until?: unknown;
}

/* ── readers — every one of them fails CLOSED ──────────────────────────── */

/**
 * A usable `Date`, or null.
 *
 * 🔴 A STRING IS REFUSED ON PURPOSE, and this is not pedantry. Mongoose types
 * these paths as `Date`, so a `.lean()` read of a row written through the schema
 * ALWAYS yields a `Date`. A string in that column means the row was written by
 * something that bypassed the schema — a migration, a shell, a bug. Coercing it
 * would mean firing a campaign on the say-so of data we cannot vouch for.
 * ⇒ unreadable = not due. NEVER unreadable = run it.
 * อ่านไม่ออก = ไม่ยิง ห้ามเดาแล้วยิง.
 */
export function readDate(value: unknown): Date | null {
  if (!(value instanceof Date)) return null;
  const ms = value.getTime();
  return Number.isNaN(ms) ? null : value;
}

/** A finite integer inside [min,max], or null. NaN, `Infinity`, `'5'` ⇒ null. */
export function readInt(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/**
 * Is this rule a repeating one?
 *
 * 🔴 `=== 'repeat'` and nothing else — §S-3. Writing `!== 'once'` would make
 * every legacy row (which reads `undefined`) a repeating job, and a `once`
 * broadcast would start firing forever. ห้าม `!==` เด็ดขาด.
 */
export function isRepeatRule(s: BroadcastSchedule | null | undefined): boolean {
  return s?.mode === 'repeat';
}

/**
 * Is the per-job switch on?
 *
 * Three-way on purpose:
 *   `false`     ⇒ off (the level-2 kill switch)
 *   `true`/absent ⇒ on
 *   anything else ⇒ off, because a non-boolean here is corrupt data and the
 *                   safe reading of corrupt data is "do not send".
 *
 * ⚠️ Absent means ON, which looks like it contradicts fail-closed — it does not.
 * This is only ever reached for a rule that already said `mode === 'repeat'`,
 * i.e. one somebody deliberately created; a rule with no `enabled` key has
 * simply never been switched off. A legacy row never gets here at all, because
 * `isRepeatRule` already answered false for it.
 */
export function isJobScheduleEnabled(
  s: BroadcastSchedule | null | undefined,
): boolean {
  const v = s?.enabled;
  if (v === false) return false;
  /**
   * 🔴 `null` IS ABSENT, NOT "OFF" — and this line is why a repeat never came
   *    back. Mongoose materialises a DECLARED-but-unset path as `null`, so a
   *    rule saved without touching this switch reads back as `enabled: null`,
   *    never `undefined`. The old `v === true || v === undefined` let `null`
   *    fall through to the `return false` below, which told `computeNextRun`'s
   *    Gate 2 that the job was switched off — so every repeating campaign ran
   *    exactly ONCE and quietly stopped.
   *    Measured 24/08 on a real job: stored `{"mode":"repeat", "enabled":null,
   *    "every_minutes":10, …}`, `computeNextRun` answered `null`, and
   *    `next_run_at` was cleared after the first round.
   *    Mongo เขียน null ให้ field ที่ประกาศแต่ไม่ได้ตั้ง ⇒ null ต้องแปลว่า "ไม่ได้ตั้ง" = เปิด.
   *
   * ⚠️ ONLY AN EXPLICIT `false` TURNS ANYTHING OFF. Anything else that is not a
   *    boolean is still refused below — a rule holding a string or a number in
   *    this slot is a row nobody wrote on purpose, and guessing which way it
   *    meant is how a campaign keeps sending after someone stopped it.
   */
  if (v === true || v === undefined || v === null) return true;
  return false;
}
