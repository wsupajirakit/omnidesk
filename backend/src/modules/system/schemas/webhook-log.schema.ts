import {
  WEBHOOK_LOG_TTL_INDEX_NAME,
  WEBHOOK_LOG_TTL_SECONDS,
} from '../webhook-log-ttl';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type WebhookLogDocument = HydratedDocument<WebhookLog>;

/**
 * Audit trail of inbound and outbound channel traffic.
 *
 * Several fields exist twice under different names (`channel`/`log_source`,
 * `line_event_id`/`event_id`, `line_key_mask`/`access_key_mask`). That is a
 * rename in progress: the legacy writer dual-writes both so older rows stay
 * readable. Both names are kept here — dropping one would break reads of
 * documents written before the rename.
 */
@Schema({ collection: 'webhook_logs', ...legacyTimestamps })
export class WebhookLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hook', index: true })
  hook_id?: Types.ObjectId;

  @Prop({ type: String, index: true })
  hook_alias?: string;

  /** Denormalised from the parent hook; distinct from `channel` below. */
  @Prop({ type: String, default: 'line' })
  channel_type!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Group',
    default: null,
    index: true,
  })
  group_id?: Types.ObjectId | null;

  /** Legacy name for the log source. Superseded by `log_source`. */
  @Prop({ type: String, default: 'line_api' })
  channel!: string;

  /**
   * Current name for the log source; same values as `channel`.
   *
   * [FIX-20260808-WLOGMIRROR] No `default` here on purpose. `channel` keeps the
   * 'line_api' default and the pre-save / pre-update hook below mirrors `channel`
   * onto `log_source`. If BOTH carried the default, a direct-model writer that set
   * only `channel` (e.g. 'customer_link', 'acme_api_*') would leave
   * `log_source` at the 'line_api' default and the dashboard's log-source filter
   * (which reads `log_source`) would return the wrong rows. Removing this default
   * lets the mirror fill it from `channel` for every writer, service or direct.
   * Revert: restore `default: 'line_api'` and delete the two schema hooks below.
   */
  @Prop({ type: String })
  log_source!: string;

  @Prop({ type: String, required: true })
  action_type!: string;

  @Prop({ type: String, default: 'POST' })
  method!: string;

  @Prop({ type: String })
  endpoint?: string;

  /**
   * [FIX-20260815-SUPPRESSEDENUM] `suppressed` — the card was CHOSEN but not SENT.
   *
   * THE BUG THIS CLOSES: `slip-flex.handler.ts:544` has always written
   * `status: 'suppressed'` when the payment tool answered a slip and the legacy
   * flex reply was therefore held back. The enum did not list it, so Mongoose
   * rejected the document and the row was never stored:
   *
   *     Webhook log persist failed: WebhookLog validation failed:
   *       status: `suppressed` is not a valid enum value for path `status`.
   *
   * The write is wrapped in a catch (`webhook.service.ts:624`) that logs and
   * moves on, so nothing downstream ever noticed — the audit row simply went
   * missing, on the one branch that most needs one. Seen on every slip during
   * live testing on 15/08/2026 while the whole payment flow ran normally.
   *
   * WHY A THIRD VALUE RATHER THAN REUSING `error`: nothing failed. The handler
   * deliberately suppressed the reply because the customer had already been
   * answered by the payment tool; recording that as an error would both misstate
   * what happened and inflate the failure count on the stats page. It is also
   * NOT `success`, because no request was made — a suppressed row carries no
   * `http_status`, which is how a reader tells the two apart.
   *
   * DATA EFFECT — none. This ADDS an accepted value; every existing row is
   * `success` or `error` and stays valid. No migration, no reindex: the value is
   * new, so no stored document can hold it (the writes never landed), and
   * `status_1_created_at_-1` indexes whatever is there.
   *
   * READERS ARE SAFE. `webhook-stats.service.ts:111-112` matches `success` and
   * `error` explicitly and ignores anything else, so suppressed rows are counted
   * as neither — the success/failure figures do not move.
   *
   * revert: delete `'suppressed'` from the enum and the union below. Rows already
   * written keep their value and still READ fine, but re-saving one would fail
   * validation again — so a revert is only clean before any suppressed row is
   * updated. ถอดออกได้ แต่แถวที่เขียนไปแล้วจะ save ซ้ำไม่ผ่าน.
   */
  /**
   * [FIX-20260828-SKIPSTATUS] `skipped` — OA นี้ไม่ได้ถูกส่งถึงเลย และนั่นไม่ใช่ความล้มเหลว
   *
   * 🔴 บั๊กที่ปิด: OA ที่ถูกข้ามตั้งแต่ตอนวางแผน (เช่นไม่มีผู้รับสักคน) ถูกบันทึกเป็น
   *    `status: 'error'` พร้อมข้อความ `this OA was skipped: empty` ⇒ "ถูกข้าม" กับ
   *    "ยิงแล้วพัง" อ่านเป็นเรื่องเดียวกัน · คนดูประวัติต้องไล่อ่านข้อความถึงจะแยกออก
   *
   * WHY ค่าที่สี่ ไม่ใช่ใช้ `error` ต่อ: ไม่มีอะไรพัง — ไม่มีคำขอถูกยิงด้วยซ้ำ
   *    เหตุผลเดียวกับ `suppressed` ด้านบนทุกประการ
   *
   * DATA EFFECT — none. **เพิ่ม** ค่าที่ยอมรับ · แถวเดิมทุกแถวเป็น
   *    `success`/`error`/`suppressed` และยังใช้ได้เหมือนเดิม ไม่ต้อง migrate ไม่ต้อง reindex
   *
   * 🔴 ต้องเพิ่มที่นี่ **ก่อน** ให้ใครเขียนค่านี้ — บทเรียนจาก
   *    `[FIX-20260815-SUPPRESSEDENUM]` ด้านบน: เขียนค่าที่ไม่อยู่ใน enum แล้ว
   *    Mongoose ปฏิเสธทั้ง document · ตัวเขียนถูกห่อ catch ไว้ ⇒ **แถวหายเงียบ**
   *    โดยไม่มีใครรู้ ในกิ่งที่ต้องการหลักฐานมากที่สุด
   *
   * READERS ปลอดภัย — `webhook-stats.service.ts:111-112` แมตช์ `success`/`error`
   *    ตรงตัวและเพิกเฉยค่าอื่น ⇒ ตัวเลขสถิติไม่ขยับ
   *
   * revert: ลบ `'skipped'` ออกจาก enum และ union · แถวที่เขียนไปแล้วยังอ่านได้
   *    แต่การ save ซ้ำจะไม่ผ่าน validation (เงื่อนไขเดียวกับ `suppressed`)
   */
  @Prop({
    type: String,
    enum: ['success', 'error', 'suppressed', 'skipped'],
    default: 'success',
  })
  status!: 'success' | 'error' | 'suppressed' | 'skipped';

  @Prop({ type: Number })
  http_status?: number;

  @Prop({ type: String })
  error_code?: string;

  @Prop({ type: String })
  error_message?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  payload_summary?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  response_summary?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  request_meta?: unknown;

  @Prop({ type: String })
  doc_id?: string;

  @Prop({ type: String })
  prompt_id?: string;

  @Prop({ type: String })
  reference_id?: string;

  /** Legacy name. Superseded by `event_id`. */
  @Prop({ type: String })
  line_event_id?: string;

  @Prop({ type: String })
  event_id?: string;

  /** Masked credentials — only ever the masked form reaches this collection. */
  @Prop({ type: String })
  line_key_mask?: string;

  @Prop({ type: String })
  access_key_mask?: string;

  @Prop({ type: String })
  gemini_api_key_mask?: string;

  @Prop({ type: Number })
  duration_ms?: number;

  @Prop({ type: Number, default: 0 })
  retries!: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  raw_request?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  raw_response?: unknown;
}

export const WebhookLogSchema = SchemaFactory.createForClass(WebhookLog);

WebhookLogSchema.index({ channel: 1, action_type: 1 });
WebhookLogSchema.index({ log_source: 1, action_type: 1 });
WebhookLogSchema.index({ status: 1, created_at: -1 });
/**
 * [PERF-20260816-LOGTICKETSLIM] The two filters the log page actually offers,
 * each paired with the sort every listing uses. Before these, a filtered page
 * walked the TTL index in time order and threw non-matching rows away —
 * measured on the dev database: `action_type` filter examined 414 docs to
 * return 20. Cheap to carry: the collection takes ~40-220 writes per DAY.
 *
 * ⚠️ Mongoose builds missing indexes at boot. On a large production collection
 * prefer creating them manually (background) before deploying this schema.
 * revert: drop the two lines and remove the indexes with dropIndex().
 */
WebhookLogSchema.index({ log_source: 1, created_at: -1 });
WebhookLogSchema.index({ action_type: 1, created_at: -1 });

/**
 * [PERF-20260824-LOGSCOPEDATE] The two SCOPE filters, each paired with the sort.
 *
 * WHAT THEY SERVE: `webhook-log.service.ts` puts `group_id: { $in: [...] }` on
 * EVERY request from a non-superuser (their OA scope) and `hook_id` whenever the
 * page is filtered to one hook; both list with `sort({ created_at: -1 })`.
 * `webhook-stats.service.ts` aggregates on the same two fields plus a date range.
 *
 * WHY THEY ARE NEEDED: `group_id` and `hook_id` each carry only a single-field
 * index, and every compound declared above leads with `status`/`log_source`/
 * `action_type` — never with the scope. So the default page for a scoped user
 * either sorts in memory or walks the TTL index in time order and discards
 * non-matching rows. The 3-day date cap in the service is currently the only
 * thing keeping that set small enough not to matter.
 *
 * Equality first, sort key second — the order the planner can seek with.
 *
 * BEHAVIOUR: none — same rows, same order.
 * DB-EFFECT: two additive indexes; no document written, no migration.
 * ⚠️ Mongoose builds missing indexes at boot (same warning as the block above):
 * on a large production collection create them manually in the background first.
 * revert: delete this block —
 *         db.webhook_logs.dropIndex('group_id_1_created_at_-1')
 *         db.webhook_logs.dropIndex('hook_id_1_created_at_-1')
 */
WebhookLogSchema.index({ group_id: 1, created_at: -1 }, { background: true });
WebhookLogSchema.index({ hook_id: 1, created_at: -1 }, { background: true });

/**
 * [FEAT-20260815-WLOGTTL30] 45-day TTL — retention cut from 90 days.
 *
 * Owner's decision 15/08: 30 days first, revised to **45** the same day after the
 * dry run showed only 296 rows and none older than a month — the wider window is
 * effectively free here. The tag keeps its original `TTL30` name so the feature's
 * history stays greppable across commits; the NUMBER below is the source of truth,
 * not the tag. (แท็กคือชื่อฟีเจอร์ ไม่ใช่ค่าปัจจุบัน — ดูเลขจริงข้างล่าง)
 *
 * webhook logs are operational noise, not records. The
 * dashboard cannot even ask for a window wider than 3 days (FE
 * `LogDateRangeFilter.MAX_RANGE_DAYS = 3`, mirrored by the backend's
 * `date-range.ts`), so nothing in the product reads a log older than a month.
 *
 * ⚠️ EDITING THIS NUMBER DOES NOT CHANGE A LIVE DATABASE. Mongo refuses to
 * alter `expireAfterSeconds` on an existing index, and Mongoose's `ensureIndex`
 * silently keeps the OLD value when the key pattern already exists — the code
 * would say 30 while the database still expired at 90, with nothing to warn
 * anyone. Changing retention therefore ALWAYS needs a step against the real
 * database.
 *
 * ⚠️ AND THE INDEX MUST BE DROPPED BEFORE THE NEW ONE IS CREATED — verified the
 * hard way on 15/08. Creating first (to avoid a gap) fails outright:
 *   "An equivalent index already exists with a different name and options"
 * Mongo allows only ONE index per key pattern, so a brief window without it is
 * unavoidable. `status_1_created_at_-1` still serves status-filtered queries in
 * the meantime, and the rebuild takes a fraction of a second at this size.
 *
 * ⇒ Use the CLI, which does the count, the drop and the create in that order
 *   and prints a recovery command if the create ever fails:
 *
 *     node dist/cli/set-log-retention.js          # dry run — counts only
 *     node dist/cli/set-log-retention.js --yes    # apply
 *     node dist/cli/set-log-retention.js --revert --yes   # back to 90 days
 *
 * The count is not optional: TTL deletions are unrecoverable.
 *
 * ⚠️ CHANGING THE NUMBER HERE MEANS CHANGING THE NAME TOO — they must always
 *    agree. The name carries the day count precisely so nobody has to trust a
 *    comment, and the CLI derives both from one `--days` value for that reason.
 *    An index called `_ttl30` holding 45 days is exactly the trap this avoids.
 *
 * ⚠️ `hook_audit_logs` is deliberately NOT touched: it has no TTL at all and
 *    records who changed what, which is evidence rather than noise.
 *    `handoff_callbacks` also carries a 30-day TTL — a DIFFERENT collection with
 *    a partial filter. Same number, unrelated policy: never edit them together.
 *
 * revert: set this back to 7_776_000 with the name `created_at_1`, then run the
 *         CLI with `--revert --yes` (it drops whatever holds the key pattern).
 *         Documents already expired are gone.
 */
WebhookLogSchema.index(
  { created_at: 1 },
  // [FEAT-20260821-WLOGTTLDRIFT] both values come from webhook-log-ttl.ts, so the
  // number, the name and the boot-time drift check can never disagree.
  {
    expireAfterSeconds: WEBHOOK_LOG_TTL_SECONDS,
    name: WEBHOOK_LOG_TTL_INDEX_NAME,
  },
);

/**
 * [FIX-20260808-WLOGMIRROR] Three pairs of names for the same field, mid-rename.
 * Whichever side a writer supplies is copied onto the other so readers of either
 * name agree. Exported so `WebhookLogService` reuses this ONE definition rather
 * than keeping its own copy.
 */
export const MIRRORED_WEBHOOK_LOG_FIELDS: ReadonlyArray<
  readonly [string, string]
> = [
  ['line_event_id', 'event_id'],
  ['line_key_mask', 'access_key_mask'],
  ['channel', 'log_source'],
];

export function mirrorWebhookLogFields(target: Record<string, unknown>): void {
  for (const [oldName, newName] of MIRRORED_WEBHOOK_LOG_FIELDS) {
    const hasOld = target[oldName] !== undefined && target[oldName] !== null;
    const hasNew = target[newName] !== undefined && target[newName] !== null;
    if (hasOld && !hasNew) target[newName] = target[oldName];
    else if (hasNew && !hasOld) target[oldName] = target[newName];
  }
}

/**
 * [FIX-20260808-WLOGMIRROR] The mirror used to live only in
 * `WebhookLogService.createLog/updateLog`, so the ~6 modules that write a
 * `webhook_logs` row straight through the model (customer-link, custom-tool,
 * external-api acme endpoints) bypassed it — their rows kept `log_source`
 * at the schema default while `channel` held the real source, and the dashboard
 * filter (keyed on `log_source`) then missed them. Enforcing the mirror in the
 * schema closes every writer, present and future, at one point.
 * Revert: delete these two hooks and restore `log_source`'s `default: 'line_api'`.
 */
WebhookLogSchema.pre('save', function () {
  mirrorWebhookLogFields(this as unknown as Record<string, unknown>);
});

WebhookLogSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate'],
  function () {
    const query = this as unknown as {
      getUpdate: () => Record<string, unknown> | null;
    };
    const update = query.getUpdate();
    if (update) {
      // Cover both a flat update document and a `$set` operator.
      mirrorWebhookLogFields(update);
      const set = update['$set'];
      if (set && typeof set === 'object') {
        mirrorWebhookLogFields(set as Record<string, unknown>);
      }
    }
  },
);
