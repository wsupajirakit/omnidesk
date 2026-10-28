/**
 * ==== [FEAT-20260815-WLOGDOOR] the shape a webhook_logs row is written in ====
 *
 * Types only — no imports, no runtime. Handlers and specs can take this without
 * dragging Nest or Mongoose behind it.
 *
 * WHY IT EXISTS: 21 write sites across four files each hand-built their own
 * object literal, sharing no contract. Key counts ran 8 → 21 and no two sites
 * agreed; `action_type` and `channel` were free strings, so a typo produced a row
 * nobody could filter for and nothing failed. This type is what a call site is
 * checked against once it has been migrated.
 *
 * ⚠️ AN INDEX SIGNATURE IS PRESENT ON PURPOSE, and it is not laziness. Nineteen
 * keys are used by exactly ONE site each (`flex_json`, `img_count`, `question`,
 * `landing`, `chat_id`, `payment_state`, …). Promoting all of them to named
 * optional fields would make this file a 40-field bag that describes nothing,
 * which is the bloat the owner forbade. Required + common are named and checked;
 * the long tail passes through. คีย์ที่ใช้ที่เดียวไม่ต้องมีชื่อในสัญญา.
 *
 * ⚠️ THE FIELD SET IS THE ROW, FLAT. Everything here lands as a top-level key on
 * the document. Never nest a real column under a wrapper "for tidiness" — the
 * dashboard reads these names directly, and [RULER-20260815-WLOGGOLDEN] freezes
 * them byte-for-byte.
 *
 * SOURCE OF THE NAMES: derived by parsing all 21 live call sites on 15/08, then
 * checked against a REAL row in Mongo (`webhook_logs`, hook `omnideskdevoa`), which
 * also confirmed what the writer does NOT send: `_id`, `__v`, `created_at`,
 * `updated_at`, `retries`, `channel_type` and `log_source` are added downstream
 * by the schema and by `WebhookLogService.createLog`. Do not send them.
 *
 * ⚠️ WHAT THIS BRANCH TOOK FROM `dev`, AND WHY — read before "unifying" anything.
 *
 * While this door was being built, `dev` fixed two defects it had also found, and
 * reached the same conclusions independently:
 *   · `5272bed` (tag `ckpt-be-undelivered-15082026`) — `payment_reply_undelivered`
 *     writes `'error'`, and the payment helper's `status` parameter is narrowed to
 *     the enum spelled INLINE
 *   · `7513555` (tag `ckpt-be-imgtag-15082026`) — the carousel tag is resolved
 *     inside `resolveReplyTags` before the catch-all strip, ranked last so a card
 *     still wins, and the call site reads `tags.imageTag`
 *
 * On the merge, EVERY overlapping hunk was resolved to dev's text byte for byte —
 * its comments and its `[FIX-20260815-UNDELIVEREDSTATUS]` /
 * `[FIX-20260815-IMGTAGSTRIPPED]` tags included — and this branch's duplicate
 * `imageTag` block was deleted rather than merged. The changes were identical in
 * effect, so keeping two spellings of one fix would collide on every future merge
 * for no gain.
 *
 * ⇒ THE RULE FOR THIS FOLDER: notes about that decision live HERE, in files `dev`
 * does not have. Writing them onto the shared lines would re-create the very
 * divergence the merge just removed. อธิบายไว้ในไฟล์ของเรา ไม่ไปเขียนทับบรรทัดที่ยึดมาจาก dev.
 *
 * revert: delete this file; `persistWebhookLog` still accepts a plain record, so
 *         a migrated site only needs its `wlogEmit` call renamed back.
 */

/**
 * The log source. `channel` is the legacy name; `WebhookLogService.createLog`
 * mirrors it onto `log_source`, which is the field the dashboard actually
 * filters on (`webhook-log.service.ts:136`) — verified against live rows.
 * A writer must therefore never set `log_source` itself.
 *
 * ⚠️ THIS UNION COVERS THE WRITERS THAT GO THROUGH THIS DOOR, NOT THE WHOLE
 * COLLECTION. Live rows carry nine values: `customer_link` (1753),
 * `line_api` (917), `webhook` (963), `gemini` (751), `log_operation` (365),
 * `swiftcheck_api` (51), `reg_push` (12), `system` (2) and
 * `acme_api_get_profile` (1). The five listed here are the ones written
 * through this module; the rest come from services that still write the model
 * directly (`external-api`, `custom-tool`, `customer-link`, `hook-outbound`,
 * `broadcasts` — 11 sites) and would join the union only if they ever move
 * behind this door.
 *
 * `'system'` earns its place because `ticket-category-upgrade.helper.ts` writes
 * through this door from the tickets module. `'telegram'` is declared and has
 * ZERO rows so far — no hook in this database has Telegram credentials, so the
 * assist notification path has never written one. Declared, not dead.
 *
 * ⚠️ The first version of this union had four values and was derived from the
 * webhook module's own call sites alone. `tsc` rejected a legitimate writer the
 * moment the last dep was rewired. นับจากไฟล์ที่เห็น ≠ ความจริงทั้งระบบ.
 */
export type WebhookLogChannel =
  | 'webhook'
  | 'line_api'
  | 'gemini'
  /* [FIX-20260816-WLOGVENDOR] Vendor #2 earns a value because the AI row now
   * names the vendor that ACTUALLY answered (`resolveReplyVendorName`), instead
   * of hard-coding 'gemini' for every hook. A DeepSeek OA used to be filed under
   * Gemini in the operator's audit trail and counted as Gemini by the
   * dashboard's log-source filter.
   *
   * SAFE FOR EXISTING DATA: `channel` and `log_source` are plain strings in the
   * schema (webhook-log.schema.ts:34,49) — no Mongo enum to widen, no migration,
   * and not one existing row changes. Rows only start carrying 'deepseek' after
   * an OA is switched to that vendor. แถวเก่าไม่ขยับ ไม่ต้อง migrate
   *
   * FE PAIR: the dashboard's channel dropdown is a hard-coded list
   * (omnidesk-console `pages/hook/WebhookLogs.tsx`), so it needs the matching
   * option or these rows are reachable only under "All Channels".
   *
   * revert: drop this member, and `describeReplyEndpoint`/`resolveReplyVendorName`
   *         with it — the writer then falls back to the frozen Gemini label. */
  | 'deepseek'
  | 'telegram'
  | 'system';

/**
 * The values `status` may hold. Must stay in step with the schema's own enum
 * (`system/schemas/webhook-log.schema.ts` — `['success','error','suppressed']`).
 *
 * ⚠️ `suppressed` is NOT a failure and NOT a success: it means a reply was
 * deliberately held back because the payment tool had already answered the
 * customer, so the row carries no `http_status` (that absence is how a reader
 * tells the two apart). It was added to the enum on 15/08 (`40ac596`) after
 * Mongoose had been rejecting — and silently losing — every such row.
 *
 * ⚠️ THIS UNION WAS WRONG WHEN FIRST WRITTEN: it listed only success/error, and
 * `tsc` caught it the moment `slip-flex.handler.ts:551` was typed. Keep it equal
 * to the schema; a value the schema accepts but this type rejects blocks a
 * legitimate write, and the reverse loses the row at validation.
 *
 * ⚠️ NOT USED BY `sendPaymentReply`, ON PURPOSE — do not "tidy" that call site to
 * import this alias. `dev` fixed the same defect in parallel (`5272bed`, tag
 * `ckpt-be-undelivered-15082026`) and narrowed that helper's parameter by
 * spelling the union INLINE:
 *
 *     const log = (action: string, status: 'success' | 'error' | 'suppressed', …)
 *
 * Same three values, same protection. This branch had written
 * `status: WebhookLogStatus` for it and, on the merge, took dev's line verbatim
 * instead: one fix written two ways collides on every future merge and buys
 * nothing, while identical text merges silently forever. Replacing it with this
 * alias would re-open that conflict for a cosmetic gain. ยึดข้อความของ dev เพื่อไม่ให้ชนซ้ำ.
 *
 * The alias stays because it still names the union for anything that takes a
 * whole `WebhookLogEvent`.
 */
export type WebhookLogStatus = 'success' | 'error' | 'suppressed';

/**
 * One `webhook_logs` row as a webhook write site produces it.
 *
 * REQUIRED — all 21 sites already send these four, so requiring them cannot
 * break a migration, and a missing one is a row the dashboard cannot group.
 * NAMED OPTIONAL — sent by many sites; typed so a rename or a wrong type is a
 * compile error rather than a column that silently stops being written.
 */
export interface WebhookLogEvent {
  /** What happened, e.g. `'line_reply'`. Free string: the vocabulary is open
   *  (new features add actions) and the dashboard groups on whatever is here. */
  action_type: string;
  channel: WebhookLogChannel;
  /** HTTP verb of the call being recorded — `'POST'` for an inbound webhook. */
  method: string;
  /**
   * The URL or path this row is about.
   *
   * ⚠️ OPTIONAL, and that is a correction: it was `required` in the first
   * version because all 21 webhook-module sites send it. Live rows disagree —
   * **367 have no `endpoint` at all**: 365 `dynamic_tag_marker_mismatch` and 2
   * `ticket_category_upgrade`. Both are INTERNAL actions where nothing was
   * called, and the writer says so in its own comment ("No endpoint: nothing was
   * called"). Requiring it would have forced a fake URL onto rows that describe
   * no request. ไม่มีการเรียก = ไม่มี endpoint ให้ใส่.
   */
  endpoint?: string;

  status?: WebhookLogStatus;
  /** HTTP status of the outbound call, when one was made. */
  http_status?: number;
  error_message?: string;
  /** What was sent. Free-shaped: every site summarises differently. */
  payload_summary?: unknown;
  /** What came back. */
  response_summary?: unknown;
  request_meta?: unknown;
  /** LINE's event id. `createLog` mirrors it onto `event_id`. */
  line_event_id?: string;
  event_id?: string;
  reply_token?: string;
  duration_ms?: number;
  /** The text actually sent to the customer, on reply rows. */
  text?: string;
  hook_id?: string;
  hook_alias?: string;
  group_id?: string;

  /** The one-site tail — see the index-signature note in the header. */
  [key: string]: unknown;
}
