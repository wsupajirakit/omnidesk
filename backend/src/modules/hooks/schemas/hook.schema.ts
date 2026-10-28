import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type HookDocument = HydratedDocument<Hook>;

/**
 * Messaging channels a hook may belong to.
 *
 * Deliberately a plain list validated by hand rather than a Mongoose enum, so
 * adding a channel stays a one-line change. `facebook` is accepted for
 * schema-readiness only — no Graph API adapter exists, so such a hook can be
 * stored but cannot send or receive.
 */
export const CHANNEL_TYPES = ['line', 'facebook'] as const;

/**
 * An OA / messaging endpoint: credentials, AI behaviour, slip rules and the
 * flex cards used for each outcome.
 *
 * Two rename programmes are visible here and both names are live:
 * `line_oa_name` → `display_name` and `line_url` → `oa_url`. Rows exist under
 * either name, so neither can be dropped.
 *
 * The collection is `hooks` (renamed from `line_chat_bot`).
 */
@Schema({ collection: 'hooks', ...legacyTimestamps })
export class Hook {
  /** Defaults to `line` so every hook predating the rename reads as LINE
   * without a backfill. Validated against CHANNEL_TYPES, not an enum. */
  @Prop({
    type: String,
    default: 'line',
    validate: {
      validator: (v: string | null | undefined): boolean =>
        v == null || (CHANNEL_TYPES as readonly string[]).includes(v),
      message: (props: { value: unknown }): string =>
        `invalid channel_type '${String(props.value)}' (allowed: ${CHANNEL_TYPES.join(', ')})`,
    },
  })
  channel_type!: string;

  /** Channel-neutral successor to `line_oa_name`. */
  @Prop({ type: String })
  display_name?: string;

  @Prop({ type: String })
  line_oa_name?: string;

  /** `sparse` so the many hooks without an alias do not collide on null. */
  @Prop({ type: String, unique: true, sparse: true })
  alias?: string;

  @Prop({ type: String })
  company_name?: string;

  @Prop({ type: String })
  description?: string;

  @Prop({ type: [String], default: [] })
  tag!: string[];

  @Prop({ type: String })
  doc_id?: string;

  @Prop({ type: String })
  line_url?: string;

  /** Channel-neutral successor to `line_url`. */
  @Prop({ type: String })
  oa_url?: string;

  @Prop({ type: String })
  webhook_url?: string;

  @Prop({ type: Number, default: 0 })
  status!: number;

  @Prop({ type: Number, default: 0 })
  fast_mode!: number;

  /**
   * Training document, box 1 of 3 (basic info).
   *
   * These three columns each hold exactly one box. They previously held boxes
   * concatenated with `[END_OF_BASIC_INFO]` markers that the frontend split and
   * rejoined, which produced an unstable round trip whenever an admin pasted a
   * marker mid-content. The backend now strips all markers on save, so a marker
   * still present in `suggestion_text` identifies an old-format row that has not
   * been re-saved — no version column needed.
   */
  @Prop({ type: String, default: '' })
  suggestion_text!: string;

  /** Training document, box 2 (company info). */
  @Prop({ type: String, default: '' })
  suggestion_company_text!: string;

  /** Training document, box 3 (customer has not linked an account). */
  @Prop({ type: String, default: '' })
  suggestion_text_no_profile!: string;

  @Prop({ type: String, default: '' })
  default_answer_text!: string;

  /**
   * [FIX-20260808-AIGENERROR] The line sent when the model turn fails at the
   * GENERATIVE layer — Gemini returned an error (401 bad key / 429 quota / 5xx)
   * or no key was available — as distinct from the model answering "not found"
   * (which still uses `default_answer_text`). Default null = stay silent on a
   * generative error, matching how an empty `default_answer_text` means silence.
   * Set per-OA from the dashboard. See resolveReplyText / isGenerativeError.
   */
  @Prop({ type: String, default: null })
  ai_generative_error_text!: string | null;

  /**
   * Dashboard label: **"ข้อความเมื่อไม่พบข้อมูล API"** (tab AI & Responses).
   *
   * Sent on two unrelated paths, both of which `return` straight after:
   *   · image path — `webhook.service.ts:~2150`, when `customerName === 'N/A'`
   *     (the profile lookup produced no name). This one wins over `image_answer_text`.
   *   · text path — `webhook.service.ts:~2610`, when the AI answer quotes a critical
   *     API tag while the profile fetch had failed.
   *
   * ⚠️ Cannot be blank: `normalizeMissingApiDataText` rejects an empty value with a
   *    400 on both create and update (`hook-write.helpers.ts:173-185`).
   * ⚠️ Operators often word this almost identically to `image_answer_text`, which
   *    makes a broken profile API indistinguishable from normal operation to the
   *    customer. Only the logs tell them apart.
   */
  @Prop({ type: String, default: 'api_data_missing' })
  missing_api_data_text!: string;

  /**
   * Reply behaviour when the OA is off (`status === 0`).
   *
   * `''`/`reply` reply with `status_off_text`, falling back to the legacy fixed
   * message when blank; `silent` stores the inbound message but does not reply.
   * Both defaulting to `''` reproduces the old fixed message exactly.
   */
  @Prop({ type: String, enum: ['', 'reply', 'silent'], default: '' })
  status_off_action!: string;

  @Prop({ type: String, default: '' })
  status_off_text!: string;

  @Prop({ type: String, default: '' })
  answer_link!: string;

  /** Text sent alongside the customer-helper quick reply. Blank = the shared
   * default, so hooks without the column need no backfill. */
  @Prop({ type: String, default: '' })
  customer_helper_text!: string;

  @Prop({ type: String })
  line_id?: string;

  @Prop({ type: String })
  line_secret?: string;

  @Prop({ type: String })
  line_key?: string;

  @Prop({ type: String, default: '' })
  channel_id!: string;

  @Prop({ type: String, default: '' })
  channel_secret!: string;

  @Prop({ type: String, default: '' })
  access_token!: string;

  @Prop({ type: String })
  custom_ai_key?: string;

  /**
   * [FEAT-20260904-VENDORSECCOL] The SECOND vendor's key — DeepSeek's.
   *
   * `_sec` is SECONDARY (the second vendor's slot), **not "secret"**. Both
   * columns hold a secret; what this one holds is the key of the vendor that is
   * not Gemini. ชื่อ `_sec` = ค่ายที่สอง ไม่ใช่ "ความลับ"
   *
   * WHY A SECOND COLUMN AND NOT A SECOND MEANING FOR THE FIRST. While both
   * vendors read `custom_ai_key`, "which vendor does this key belong to?" could
   * only be answered by looking at `ai_vendor` — so a row that said `deepseek`
   * while holding a Google key sent that Google key to api.deepseek.com. With
   * the value in its own column the question disappears: this field is
   * DeepSeek's by definition, and a DeepSeek hook without one has no key and
   * must refuse. See `webhook/ai-vendors/resolve-vendor-fields.ts`.
   *
   * DB-EFFECT: additive String, no default ⇒ absent on all 7 existing rows
   * (verified in Mongo 04/09: `ai_vendor` itself exists on none of them), which
   * reads as "no DeepSeek key". No migration, no backfill.
   *
   * ⚠️ Registered in `SENSITIVE_FIELDS` (`infra/crypto/crypto.service.ts`) —
   *    that one list drives encryption, the `SECRET_MASK` on read, the
   *    keep-sentinel on write and the list-view strip. Omitting it there would
   *    store a live API key in plaintext and hand it to the browser.
   *
   * revert: delete this prop + its entries in SENSITIVE_FIELDS / CHECK_FIELDS /
   *         SENSITIVE_FIELD (tab map) / ALLOWED_UPDATES. Values already written
   *         stay in the rows, unread.
   */
  @Prop({ type: String })
  custom_ai_key_sec?: string;

  @Prop({ type: String, default: '' })
  telegram_key!: string;

  @Prop({ type: String, default: null })
  telegram_chat_id?: string | null;

  @Prop({ type: Number, default: 0.0 })
  gemini_temperature!: number;

  @Prop({ type: Number, default: 1 })
  gemini_top_k!: number;

  @Prop({ type: Number, default: 0.1 })
  gemini_top_p!: number;

  /** Per-hook thinking budget: 0 off, -1 dynamic, 1..24576 explicit. `null`
   * (no column) falls back to off, so existing hooks are unaffected. */
  @Prop({ type: Number, default: null })
  gemini_thinking_budget?: number | null;

  /**
   * [P2-20260813] Which AI vendor answers for this OA.
   *
   * DB-EFFECT: additive String, default `null` ⇒ every existing hook keeps its
   * exact behaviour with no migration — the transport registry resolves an
   * absent/null/unknown value to the default vendor by construction, so a row
   * written before this column existed answers identically.
   *
   * Plain text, NOT a secret: it is a name, so it is not encrypted and not in
   * SENSITIVE_FIELD. String rather than an enum because `enum` + `null`
   * requires null inside the enum array (see `telegram_noti_type`), and the
   * value list is enforced at the write instead (`ai-vendor/parse-ai-vendor.ts`).
   *
   * revert: drop this Prop, its ALLOWED_UPDATES / FIELD_TAB entries and the
   *         parser; values already written become inert, no data loss.
   */
  @Prop({ type: String, default: null })
  ai_vendor?: string | null;

  /**
   * [P2-20260813] The model id this OA asks for, e.g. `gemini-3.5-flash` or
   * `deepseek-v4-flash`.
   *
   * DB-EFFECT: additive String, default `null` ⇒ null means "use the vendor's
   * family default", which is exactly what every hook gets today. No migration.
   *
   * ⚠️ The family default depends on the vendor, so this field is only
   *    meaningful together with `ai_vendor` — they were approved as one pair.
   *
   * revert: same as ai_vendor above.
   */
  @Prop({ type: String, default: null })
  ai_model?: string | null;

  /**
   * [FEAT-20260904-VENDORSECCOL] The SECOND vendor's model id — DeepSeek's.
   *
   * `_sec` is SECONDARY, the second vendor's slot. Same reasoning as
   * `custom_ai_key_sec` above: a model id belongs to a vendor family, and while
   * both vendors read `ai_model` the Training-Doc lane (which posts to
   * `generativelanguage.googleapis.com`) could be handed `deepseek-chat` and
   * ask Google for a model that does not exist there.
   *
   * DB-EFFECT: additive String, default `null` ⇒ null means "use DeepSeek's
   * family default" (`deepseek-v4-flash`, see `ai-vendor/models.ts`), which is
   * what a DeepSeek hook resolves to today. No migration.
   *
   * ⚠️ Plain text, NOT a credential — a model id is a name. It therefore goes
   *    in `FIELD_TAB` (tab `ai`) like `ai_model`, never in `SENSITIVE_FIELD`.
   *
   * revert: same as `custom_ai_key_sec` above.
   */
  @Prop({ type: String, default: null })
  ai_model_sec?: string | null;

  /**
   * [FEAT-20260909-VENDORTRANSLATE] Which vendor answers TRANSLATION for this
   * OA — chosen independently of `ai_vendor`, which keeps serving the webhook.
   *
   * `null` (and no column at all) means **follow `ai_vendor`**, so every hook
   * written before this existed behaves exactly as it does today. That is the
   * whole compatibility story: there is no second default and no migration.
   *
   * WHY A SEPARATE COLUMN AND NOT A FLAG ON `ai_vendor`. The two lanes have
   * different economics and different failure modes: an OA may want the cheap
   * vendor answering customers all day and the better one translating the few
   * messages an admin actually presses. One column cannot hold two answers.
   *
   * 🔴 IT DOES NOT GET ITS OWN KEY, AND MUST NOT. The key columns are per
   * VENDOR, not per lane — `custom_ai_key` is Gemini's, `custom_ai_key_sec` is
   * DeepSeek's — so translate pointed at DeepSeek reads the same
   * `custom_ai_key_sec` the webhook would. That is what the owner meant by
   * "the key boxes can be shared": the sharing already existed, and this column
   * only chooses which side of it to read. A third key column would re-create
   * the "whose key is this?" question `custom_ai_key_sec` was added to delete.
   *
   * ⚠️ A hook pointed at a vendor it holds no key for RESOLVES TO NO KEY AND
   *    REFUSES — it does not borrow the other vendor's. That is inherited
   *    behaviour, not new code here: `resolveVendorPair(row, vendor)` picks the
   *    column by vendor (`webhook/ai-vendors/request-credentials.ts`).
   *
   * DB-EFFECT: additive String, default `null` ⇒ absent on all existing rows,
   * read as "follow `ai_vendor`". No migration, no backfill.
   *
   * Plain text, NOT a secret: it is a vendor NAME. It belongs in `FIELD_TAB`
   * (tab `ai`) beside `ai_vendor`, never in the sensitive map. The value list
   * is enforced at the write by the same parser `ai_vendor` uses.
   *
   * revert: drop this Prop, its ALLOWED_UPDATES / FIELD_TAB entries and the two
   *         parser calls; values already written become inert, no data loss.
   */
  @Prop({ type: String, default: null })
  ai_vendor_translate?: string | null;

  /**
   * [FEAT-20260918-HOOKTRANS] Default chat translation language for this OA.
   * Default null (unspecified / follow system default).
   */
  @Prop({ type: String, default: null })
  translate_lang?: string | null;

  /**
   * [FEAT-20260918-HOOKTRANS] Whether automatic chat translation is enabled for this OA.
   * Default false.
   */
  @Prop({ type: Boolean, default: false })
  auto_translate?: boolean;

  /**
   * [FEAT-20260909-DSREASONING] ── the reasoning knobs ──────────────────────
   *
   * Owner's matrix, 09/09: Gemini's main bot already has one and must not be
   * disturbed; the other three cells become settable. Summary shares the main
   * bot's — there are TWO lanes, not three.
   *
   * NAMING: `<vendor>_<knob>` is the MAIN lane, `<vendor>_<knob>_translate` is
   * the translate lane. The absent suffix marks main because
   * `gemini_thinking_budget` already carries that name on a live path, and the
   * owner ruled out any backfill for OAs on the Gemini bot. Same convention as
   * `ai_vendor` / `ai_vendor_translate`.
   *
   * 🔴 EVERY ONE DEFAULTS TO `null` = SAY NOTHING TO THE VENDOR. That is the
   *    whole compatibility story: an OA that sets none of these produces a
   *    request body byte-identical to the one it produced before the columns
   *    existed. No migration, no backfill, nothing to undo.
   *
   * ⚠️ `null` is NOT `'disabled'`. Unset leaves the vendor's own default in
   *    force; `disabled` is an instruction. Two different requests.
   *
   * The column names live in `hooks/ai-reasoning/reasoning-columns.ts` — that
   * map is the only place a read site may learn them, so a lane cannot end up
   * reading the other lane's value.
   */

  /**
   * Gemini's token budget for the TRANSLATE lane. Same units and same meaning
   * as `gemini_thinking_budget` above — `0` off, `-1` dynamic, `1..24576`
   * explicit — and it runs through the SAME parser and the SAME resolver.
   *
   * 🔴 THE HOTFIX APPLIES HERE TOO, AND THAT IS THE POINT. Owner, 09/09:
   *    *"gemini ทำแบบเดียวกับ hotfix ไม่งั้นจะงง"*. `[HOTFIX-20260826-THINK36]`
   *    is what makes "off" work on Gemini 3 — the family needs a `thinkingLevel`
   *    where 2.5 needs `thinkingBudget: 0`, and sending both is a 400. A second
   *    rule for this column would mean the same number behaving differently in
   *    two boxes on the same screen.
   *
   * ⚠️ UNSET IS STILL DIFFERENT FROM `0`. Unset sends no thinking config at all,
   *    which is exactly what this lane has always sent; `0` is an instruction to
   *    turn thinking off, resolved by the hotfix for the model in play. Existing
   *    OAs are unset, so nothing on the wire moves for them.
   *
   * A separate column because an OA may want the bot thinking hard for a
   * customer and the translator not thinking at all, or the reverse.
   */
  @Prop({ type: Number, default: null })
  gemini_thinking_budget_translate?: number | null;

  /**
   * DeepSeek's reasoning switch for the MAIN lane (reply + summary).
   * `'enabled'` / `'disabled'`, or `null` to say nothing.
   */
  @Prop({ type: String, default: null })
  deepseek_thinking?: string | null;

  /**
   * How hard DeepSeek should think on the MAIN lane: `'low'` / `'high'` /
   * `'max'`, or `null` to send no effort at all.
   *
   * 🔴 `'medium'` IS ABSENT ON PURPOSE. It was asked about specifically, the
   *    vendor's documentation does not list it, and no live call has settled
   *    it. Adding it because a similarly-shaped API accepts it would be the
   *    guess this work was told twice not to make. When a probe answers, it is
   *    one word in the parser's array and one in the FE options.
   */
  @Prop({ type: String, default: null })
  deepseek_reasoning_effort?: string | null;

  /** DeepSeek's reasoning switch for the TRANSLATE lane. */
  @Prop({ type: String, default: null })
  deepseek_thinking_translate?: string | null;

  /** DeepSeek's effort for the TRANSLATE lane. Same allow-list as above. */
  @Prop({ type: String, default: null })
  deepseek_reasoning_effort_translate?: string | null;

  /**
   * How many past messages the bot sees when answering a customer.
   *
   * `null` rather than `5` on purpose: it distinguishes "never configured" from
   * "configured to 5", leaving room to change the shared default later. Counts
   * all senders, since the query does not filter by `sender_type`.
   */
  @Prop({ type: Number, default: null, min: 1, max: 30 })
  ai_history_limit?: number | null;

  /**
   * How many messages the AI summarises into a ticket's `need_detail`.
   *
   * Accepts 0 or 5–30; 1–4 is excluded as too little context to summarise.
   * `null` keeps the previous fixed 10. `0` skips the AI call entirely, which
   * also narrows the auto-assigned category to Payment/Other because the same
   * call produced both.
   */
  @Prop({ type: Number, default: null, min: 0, max: 30 })
  ai_need_detail_limit?: number | null;

  /**
   * Send the raw third-party profile JSON to the model.
   *
   * Off for every hook that predates the field: the check is `=== true`, so
   * both `undefined` and `null` read as off. It stays opt-in per hook because
   * enabling it exports customer data on every message, which the system never
   * did before.
   */
  @Prop({ type: Boolean, default: false })
  ai_raw_json_analysis!: boolean;

  /** Independent switch for sending the raw site-rules block to the model. */
  @Prop({ type: Boolean, default: false })
  ai_raw_site_rules!: boolean;

  /**
   * [FEAT-20260810-DOCRETRIEVAL] Per-OA switch for Training-Document retrieval.
   *
   * OFF (the default, and the value every pre-feature row reads as): the reply
   * path hands the model `docText: ''`, which is byte-for-byte what it does
   * today for every OA — including one that has a `doc_id` set, because
   * retrieval was ported but never wired in. ON: the retrieval seam runs and the
   * matching passage becomes `docText`.
   *
   * ⚠️ SEPARATE FROM `doc_id` ON PURPOSE. Keying off `doc_id` alone would flip
   * every OA that already stores one the moment this deploys — a behaviour
   * change nobody asked for, on OAs nobody tested. A dedicated flag makes the
   * switch per-OA and reversible without a deploy.
   *
   * ⚠️ Turning this ON can add a model call per message: retrieval searches
   * locally first and only asks the model when that is not confident (fast mode
   * never asks). Owner accepted that cost 2026-08-10.
   *
   * DB-EFFECT: additive, `default: false`; an absent field reads as false, so
   * existing rows keep working with no migration and nothing is backfilled.
   * revert: drop this @Prop and the block at `webhook.service.ts` that reads it.
   * ค่าเริ่มต้นปิด = พฤติกรรมเดิมเป๊ะ.
   */
  @Prop({ type: Boolean, default: false })
  doc_retrieval!: boolean;

  /**
   * [FEAT-20261026-RAGENGINE] How the RAG engine feeds the prompt when `doc_retrieval` is on:
   * `'add'` (full Training Doc + the matching passages) or `'replace'` (pinned + matching chunks
   * stand in for the full doc — fewer tokens). Null ⇒ the engine's code default (`'add'`).
   * DB-EFFECT (approved 26/10): additive, default null, no migration — an absent or null value
   * reads as the default, and with `doc_retrieval` off it is never read at all.
   * The allowed values are enforced on write (`hook-write.helpers.ts`), not by a Mongoose enum,
   * so a legacy null always validates. revert: drop this @Prop (stored values become inert).
   */
  @Prop({ type: String, default: null })
  rag_prompt_mode!: string | null;

  /**
   * [FEAT-20261026-RAGENGINE] How the engine searches: `'bm25'` (words only — no AI call, no
   * spend) or `'hybrid'` (embeddings + words — the OA's own key pays). Null ⇒ `'bm25'`.
   * Same DB-EFFECT and revert as `rag_prompt_mode` above. ค่าเริ่มต้น = ไม่เสียเงิน
   */
  @Prop({ type: String, default: null })
  rag_search_mode!: string | null;

  /**
   * [FEAT-20260830-STABLEPROMPT] move "Today is …" + [[[history]]] out of
   * system_instruction and into contents blocks, so the instruction is
   * byte-stable across calls and Gemini implicit caching can hit.
   *
   * [FLIP-20260830] Owner order: the stable layout is the DEFAULT. The gate
   * reads `!== false`, so an absent field (every pre-flip row) means ON and
   * this @Prop default only decides what a NEWLY CREATED hook persists — set
   * to true so create and legacy rows agree. Explicit `false` is the per-OA
   * emergency opt-out that restores the old prepend/inject path without a
   * deploy.
   *
   * DB-EFFECT: additive; absent = ON (by the reader, not by backfill), no
   * migration, nothing rewritten. revert: reader back to `=== true` +
   * default back to false. ค่าเริ่มต้นเปิดทั้งระบบ · false = ถอยราย OA.
   */
  @Prop({ type: Boolean, default: true })
  ai_stable_prompt!: boolean;

  /**
   * [FEAT-20260821-IGNOREABANDON] this OA does not chase customers who stop
   * registering — the abandon check answers "leave them alone" for every room
   * on this hook. Owner's words: *"ไม่ใช่ follow up มันเปน column ใหม่"* — the
   * value lives here as a column of its own, NOT in a settings bag and NOT
   * under any `follow_up.*` path, so it can be read, cloned and removed on its
   * own terms.
   *
   * ⚠️ READ IT AS `=== true`, NEVER `!== false` OR `?? true`. The hot path
   * reads hooks with `.lean()` (`hook-cache.service.ts`, `webhook.service.ts`),
   * and Mongoose does NOT apply `default:` to a lean result — every existing
   * row answers `undefined`, not `false`. A truthy-flavoured test would switch
   * this ON for every OA the moment it deploys, silently. อ่านผิด = เปิดทั้งระบบเงียบ ๆ.
   *
   * DB-EFFECT: additive, `default: false`; an absent field reads as false, so
   * existing rows keep working with no migration and nothing is backfilled.
   * revert: drop this @Prop, its `FIELD_TAB` line, its `ALLOWED_UPDATES` entry,
   * its two parse call sites and the one reader. ค่าเริ่มต้นปิด = พฤติกรรมเดิมเป๊ะ.
   */
  @Prop({ type: Boolean, default: false })
  ignore_abandon_assist!: boolean;

  /**
   * [FEAT-20260822-NOTICEMODE] The "notice" settings mode — seven standalone
   * columns, same shape as `ignore_abandon_assist` above: additive, no
   * settings bag, each removable on its own. Owner rules: "ห้ามสร้างหนี้ …
   * ถอดได้ แยกชิ้นได้" + "seamless to stg additive".
   *
   * WRITTEN ONLY by the dedicated routes `PUT /hook/notice/:id` and
   * `PATCH /hook/notice/bulk` — deliberately NOT in `ALLOWED_UPDATES` or
   * `BULK_SETTING_FIELDS` (both echo into golden-pinned messages; see
   * `notice-settings/notice-settings.fields.ts` header). Runtime senders come
   * in a later phase; nothing reads these on the webhook path yet.
   *
   * ⚠️ READ TOGGLES AS `=== true` and scopes via `readNoticeScope()` — hooks
   * travel through `.lean()`, defaults are NOT applied, every existing row
   * answers `undefined`. absent = ปิด/แคบสุด เสมอ (กฏเดียวกับ column บนบรรทัด 295).
   *
   * DB-EFFECT: additive · defaults false / null / 'text' · absent field on an
   * existing row behaves identically to the default · no migration, nothing
   * backfilled. revert: drop these seven @Prop, the notice-settings/ folder,
   * the two service methods and the two routes that write them.
   */
  @Prop({ type: Boolean, default: false })
  notice_deposit_status!: boolean;

  /** Owner 22/08: scope covers BOTH deposit and withdraw — text | all | slip. */
  @Prop({ type: String, enum: ['text', 'all', 'slip'], default: 'text' })
  notice_deposit_scope!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  notice_deposit_flex_id?: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false })
  notice_withdraw_status!: boolean;

  @Prop({ type: String, enum: ['text', 'all', 'slip'], default: 'text' })
  notice_withdraw_scope!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  notice_withdraw_flex_id?: Types.ObjectId | null;

  /**
   * [FEAT-20260822-NOTICERUNTIME] R2 — the four cards the full 13:21 spec
   * added: off-service-time cards for cases A (deposit) and C (withdraw), and
   * the two slip-path cards for cases E (all off-time) and F (all disable).
   * Same additive contract as their two siblings above: default null, absent
   * = not configured, no migration. The D6 gate (notice-settings.fields.ts,
   * NOTICE_CARD_PAIRS) requires them per side — the slip pair only when the
   * deposit scope is EFFECTIVELY 'slip' (D15/D16, owner 22/08).
   * revert: drop these four @Prop + their NOTICE_FLEX_FIELDS / FIELD_TAB /
   * NOTICE_CARD_PAIRS entries.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  notice_deposit_offtime_flex_id?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  notice_withdraw_offtime_flex_id?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  notice_all_offtime_flex_id?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  notice_all_disable_flex_id?: Types.ObjectId | null;

  /* [FEAT-20260823-NOTICECHECKFLAGS] Four flags that WRAP the notice checks —
   * per side, per check. They do not alter any condition; they decide whether
   * the condition is READ at all (owner, 23/08: "เอา flag ครอบ ว่าจะอ่านไหม …
   * ลำดับยังเหมือนเดิม").
   *
   *   …_time_check        wraps the off-time window read  → case A (dep) / C (wd)
   *   …_sitestatus_check  wraps the site-rules read       → case B (dep) / D (wd)
   *   (the slip cases E/F ride the DEPOSIT flags — E=time, F=sitestatus)
   *
   * ⚠️ POLARITY IS THE OPPOSITE OF THE OTHER NOTICE TOGGLES, ON PURPOSE.
   * `notice_*_status` reads absent as OFF; these read absent as ON — because
   * absent must mean "behave exactly as before this column existed", and before
   * it existed every check ran. A row that predates the column, a lean read, a
   * junk value: all mean ON. Only an explicit `false` turns a check off.
   * That read lives in ONE place: `readNoticeCheckFlag` (notice-settings.fields).
   * ห้ามอ่านด้วย readNoticeToggle เด็ดขาด — ขั้วกลับกัน แถวเก่าจะเงียบทั้ง prod.
   *
   * Proof pack: z-test/fixtures/notice-before-20260823.json (1,538 decisions +
   * 12 mixed-account cells captured BEFORE this change) — asserted byte-equal
   * with flags absent by notice-flags-parity.spec.ts.
   * revert: drop the four columns + their entries in notice-settings.fields /
   * hook-field-tabs / notice-context / the case guards. */
  @Prop({ type: Boolean, default: true })
  notice_deposit_time_check!: boolean;

  @Prop({ type: Boolean, default: true })
  notice_deposit_sitestatus_check!: boolean;

  @Prop({ type: Boolean, default: true })
  notice_withdraw_time_check!: boolean;

  @Prop({ type: Boolean, default: true })
  notice_withdraw_sitestatus_check!: boolean;

  /* [FEAT-20260829-STATUSFIRST] "ให้ความสำคัญกับสถานะก่อน ถ้าอยู่ในช่วงเวลา
     23:00–02:00" — one per side. ON = inside the night window, a side that still
     has an account OPEN sends NO off-time notice; the message flows on normally.
     ═══════════════════════════════════════════════════════════════════════
     🔴 POLARITY IS THE OPPOSITE OF THE `_check` FLAGS ABOVE — deliberately.
        `default: false`, read by `readNoticeToggle` (`=== true`): absent, junk,
        a lean row, a cloned legacy row — ALL mean OFF = today's behaviour.
        Owner's order: "default ปิดห้ามเป็นหนี้". Reading these with
        `readNoticeCheckFlag` (`!== false`) would switch every existing OA on
        the day this deploys. ห้ามอ่านด้วย readNoticeCheckFlag เด็ดขาด.
     🔴 Named `sitestatus_first`, not `status_first`: `status` alone already
        means the OA kill switch on this schema, and `sitestatus` is the token
        the sibling flags above use for the same account-state concept.
     Where they act: the three off-time cases only (A, C, and slip E — E's "off"
     is F's slip expression). B/D/E/F site-rule behaviour is untouched.
     Proof: z-test/unit/notice-status-first.spec.ts (decision table) +
     notice-flags-parity.spec.ts (absent ⇒ byte-identical to the 1,538-row
     fixture).
     revert: drop these two props + the two NOTICE_TOGGLE_FIELDS entries + the
     two hook-field-tabs rows + the two ctx fields + the three case clauses. */
  @Prop({ type: Boolean, default: false })
  notice_deposit_sitestatus_first!: boolean;

  @Prop({ type: Boolean, default: false })
  notice_withdraw_sitestatus_first!: boolean;

  /** No flex card belongs to this one — it is a plain follow switch. */
  @Prop({ type: Boolean, default: false })
  follow_player_status!: boolean;

  /**
   * Usage rules accompanying the site-rules block.
   *
   * A second field rather than reuse of `ai_raw_json_rules` because the two
   * blocks are sent separately and answer different questions — sharing one box
   * is how a model ends up quoting a deposit minimum as a customer balance.
   * May stay blank even with the switch on; making it required would break
   * form saves for admins who enabled the switch earlier.
   */
  @Prop({ type: String, default: '' })
  ai_site_rules_guide!: string;

  @Prop({ type: String, default: null, trim: true })
  domain_name?: string | null;

  /**
   * Last successfully fetched site rules, kept with the time they arrived.
   *
   * The timestamp does double duty: freshness label in the panel, and the
   * cache's own clock (under 30 minutes = no upstream call), so there is no
   * separate TTL that could drift. Written only on a non-empty success — a 404,
   * 500, timeout or empty body leaves both the data and the time untouched.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  raw_site_rules_data?: unknown;

  @Prop({ type: Date, default: null })
  site_rules_updated_at?: Date | null;

  /** Admin-authored rules sent ahead of the raw JSON block. Required-when-
   * enabled is enforced in the controller: a schema validator sees one field
   * and cannot express a cross-field condition cleanly. */
  @Prop({ type: String, default: '' })
  ai_raw_json_rules!: string;

  @Prop({
    type: String,
    enum: ['all', 'text', 'image', null],
    default: 'all',
  })
  telegram_noti_type?: string | null;

  @Prop({ type: String, default: '' })
  /**
   * Dashboard label: **"ค่าตอบกลับเมื่อพบรูปภาพ"** (tab AI & Responses).
   *
   * Two jobs in one field, which is easy to miss:
   *   1. **A GATE.** Empty ⇒ `webhook.service.ts:~1950` skips the whole non-text
   *      branch: the image gets no reply, no assist, no ticket — and
   *      `missing_api_data_text` never runs either, because its guard sits inside
   *      this block.
   *   2. **The reply text**, sent at `webhook.service.ts:~2230` unless
   *      `missing_api_data_text` or a slip card answered first.
   *
   * ⚠️ An `[[[assist]]]` marker inside this text is what pages an operator and
   *    creates the ticket (`assist-notification.ts:307`). The marker is stripped
   *    before the customer sees it, so editing this copy can silently switch ticket
   *    creation off.
   * ⚠️ Despite living on the AI tab it never reaches the AI path — the non-text
   *    branch returns first.
   * ⚠️ Only a real `image` gets here; sticker/file/video/audio return earlier at the
   *    silent-type guard even though `NON_TEXT_AUTO_REPLY_TYPES` also lists them.
   */
  image_answer_text!: string;

  @Prop({ type: String, default: '' })
  slip_verify_key!: string;

  @Prop({ type: Boolean, default: false })
  match_account!: boolean;

  /**
   * `MongooseSchema.Types.ObjectId` for the same reason as `custom_tool_id`
   * below: a Mixed path cannot be `.populate()`d, so the usage endpoint returned
   * a bare id where legacy returns the populated `{ _id }` group object.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Group', default: null })
  group?: Types.ObjectId | null;

  /** Card answering the profile tag. `null` = tag inactive, plain text reply. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_profile_id?: Types.ObjectId | null;

  /**
   * [FEAT-20260810-CUSHELPERTYPE] การ์ดที่ตอบตอน AI ขึ้น tag `[[[customer-helper]]]`
   *
   * `null` (ค่าเริ่มต้น / OA เก่าที่ไม่มี field นี้) = ใช้การ์ด hard-code จาก
   * `webhook/customer-helper-flex.ts` เหมือนเดิมทุกประการ ⇒ **seamless**
   * ไม่ต้อง migrate ไม่มี OA ไหนพฤติกรรมเปลี่ยนจนกว่าจะตั้งค่าเอง
   *
   * ต้องเป็นการ์ด `flex_type: 'customerhelper'` เท่านั้น (FE กรอง dropdown ให้)
   * revert: ลบ prop นี้ — ค่าที่ตั้งไว้ค้างใน DB แต่ไม่มีใครอ่าน ระบบกลับไปใช้
   * การ์ด hard-code เหมือนก่อนหน้า
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_customerhelper_id?: Types.ObjectId | null;

  /** Cards of type `custom` this hook may use. A missing column reads as empty,
   * so behaviour is unchanged for older hooks. */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'FlexMessage' }] })
  flex_custom_ids?: Types.ObjectId[];

  /** Cards of type `profile-semi-custom` — a separate list from
   * `flex_custom_ids`, with its own tag prefix and webhook condition. */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'FlexMessage' }] })
  flex_profile_custom_ids?: Types.ObjectId[];

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_success?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_fail?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_other?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_duplicate?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_not_found?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_min_amount?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_error?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_success_not_match?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlexMessage',
    default: null,
  })
  flex_out_of_time?: Types.ObjectId | null;

  /**
   * ==== [FEAT-20260810-PAYSTATEFLEX] one flex card per PAYMENT REPLY STATE ====
   *
   * Owner's rule, 2026-08-10: **1 state = 1 card**, chosen per OA from a select of
   * `flex_type: 'slip'` cards. Keys are `ReplyState` values
   * (`topup_success` … `statement_not_found`); the value is the card's `_id`.
   *
   * A MISSING KEY MEANS "NOT SET", and not-set means the state keeps its CURRENT
   * behaviour — the plain reply text, or for the two success states the Swiftcheck
   * `flex_success` card. So `{}` (every existing hook, all 7 verified to have no
   * such field) changes nothing anywhere: seamless by absence, no migration.
   *
   * WHY ONE OBJECT AND NOT EIGHT FLAT PROPS: this schema already carries ten
   * `flex_*` columns; eight more would make eighteen and the owner asked that files
   * not bloat. A map also means adding a ninth reply state later touches no schema,
   * no DTO and no migration. The trade-off accepted: `Object` cannot declare
   * `ref: 'FlexMessage'`, so mongoose will not populate it — which costs nothing
   * here, because the payment path resolves cards itself by id (the same way
   * `slip-flex.handler.ts` does) and never relied on populate.
   *
   * ⚠️ Ids arrive from the dashboard, so the WRITE PATH must verify each one really
   * is a `flex_type: 'slip'` card — never trust the client. A stale id (card
   * deleted later) must resolve to "not set" and fall back, never throw: this sits
   * on the money path and a missing card is not a reason to leave a customer with
   * no reply at all.
   *
   * revert: delete this prop. Values stay in the documents but nothing reads them,
   * and every state returns to its previous reply. No customer data is involved —
   * these are card ids. ไม่ตั้ง = พฤติกรรมเดิมทุกอย่าง ไม่ต้อง migrate.
   */
  @Prop({ type: Object, default: {} })
  payment_flex_ids?: Record<string, Types.ObjectId | string | null>;

  @Prop({ type: String, default: '' })
  qr_code_fail_anwser_text!: string;

  @Prop({ type: String, default: '' })
  match_account_number!: string;

  /**
   * ==== [FEAT-20260902-SLIPPROVIDER] which service verifies this hook's slips ===
   *
   * `''` = the one the system uses today. Every existing hook reads as `''`
   * (schema default) or `undefined` (a `.lean()` read of a row written before
   * this Prop), and **both must mean the same thing** — that is what makes this
   * additive with no migration and no backfill.
   *
   * ⚠️ IT LIVES HERE, NEXT TO `slip_verify_key`, AND THAT IS THE POINT.
   * It was first put on the payment tool and moved on 02/09. A payment-tool
   * setting is unreachable exactly when payment is switched OFF — and slip
   * verification runs for payment-off hooks, which is most of them. Worse, the
   * NAME of the provider and the KEY it authenticates with would have lived on
   * different documents with nothing reconciling them: a hook naming provider B
   * while still holding provider A's token 401s on every slip, and the failure
   * is recorded as "we never got an answer" rather than "the provider said no".
   * Name and credential now sit on one tab and move together.
   *
   * ⚠️ AN UNRECOGNISED NAME FALLS BACK, IT DOES NOT DISABLE. `resolveSlipProvider`
   * trims, lower-cases and returns null for anything unregistered, and the caller
   * treats null as "use the current provider". A typo must never stop slips being
   * verified.
   *
   * ⚠️ NOT A SECRET. Do not add it to the encrypted-field lists or to the
   * dashboard's secret-lock; it is a vendor name, not a credential.
   *
   * ⚠️ CLONE PAIRING — read before a second provider is registered. This field
   * clones with the slip tab by default, while `slip_verify_key` only travels
   * when its tick is opted in. So a slip-tab clone can write this hook's provider
   * onto a target that still holds a different provider's key. Harmless today,
   * because only one provider is registered and any other value resolves back to
   * it — but the day a second one exists, this needs the same
   * drags-its-credential-along rule that `ai_vendor`/`custom_ai_key` already has.
   *
   * ⚠️ NAME COLLISION: `slip_verifications.slip_provider` is a DIFFERENT field —
   * a per-row record of who actually verified that slip. This one is the hook's
   * configured choice. Do not conflate them; the resume comparator exists to
   * compare exactly these two.
   *
   * DB-EFFECT: additive string, `default: ''`, existing rows untouched, no
   * migration. revert: drop this Prop, its `ALLOWED_UPDATES` entry and its
   * field-tab entry; every hook returns to the current provider.
   */
  @Prop({ type: String, default: '' })
  slip_provider!: string;

  /**
   * ==== [FEAT-20260903-VENDORBRANCH] the hook's sub-account at its provider =====
   *
   * `''` = not set, which is correct for every provider that does not need one —
   * including the only registered provider today. Existing rows read as `''`
   * (schema default) or `undefined` (a `.lean()` read of a row written before
   * this Prop) and **both mean the same thing**, which is what makes this
   * additive with no migration and no backfill.
   *
   * WHY IT EXISTS AT ALL. Some vendors do not identify the merchant by the API
   * key alone — the account is part of the ENDPOINT. SlipGuard posts to
   * `…/api/line/apikey/<BRANCH_ID>`, so a hook needs a key AND a branch number.
   * The key already lives one field away; the branch had nowhere to live, and
   * without it a SlipGuard adapter cannot build a valid URL for any real hook.
   *
   * 🔴 IT DOES NOT ISOLATE ANYTHING, and that was measured rather than assumed.
   * Two SlipGuard branches with two different keys share ONE duplicate history and
   * ONE quota pool: a slip first seen by branch A returns `1012` on branch B
   * quoting branch A's timestamp, and both report the same remaining quota. So
   * this selects which account is billed and checked — it is not a sandbox.
   * แยก branch ไม่ได้แยกประวัติหรือโควตา วัดมาแล้วทั้งสองทาง
   *
   * ⚠️ NOT A SECRET. An account number, not a credential — keep it out of the
   * encrypted-field lists and out of the dashboard's secret-lock, exactly like
   * `slip_provider` beside it.
   *
   * ⚠️ CLONE PAIRING, same hazard as `slip_provider` above. This travels with the
   * slip TAB while `slip_verify_key` only travels when its tick is opted in, so a
   * half-ticked clone can pair one hook's branch with another hook's key. That
   * combination **fails closed at the vendor** — SlipGuard answers `1002` for a key
   * that does not belong to the branch — which is the safe direction, and it is
   * why this is recorded rather than guarded with code that cannot fire today.
   *
   * DB-EFFECT: additive string, `default: ''`, existing rows untouched, no
   * migration, no backfill. revert: drop this Prop, its `ALLOWED_UPDATES` entry
   * and its field-tab entry; the only reader is the SlipGuard adapter.
   */
  @Prop({ type: String, default: '' })
  slip_verify_branch!: string;

  /* 🔴 [FIX-20260903-HOSTNOTAFIELD] `slip_verify_base_url` WAS A PROP HERE AND
     WAS REMOVED THE SAME DAY. It carried this hook's own provider host, added
     because the value had been read from a Swiftcheck-named env and the owner ruled
     env out. Seeing the form, the owner ruled again: an operator must not TYPE a
     host, and it is not database data — the back end is the single source of
     truth and a vendor changing its URL should be one line in that vendor's own
     file, which is `provider.defaultBaseUrl`.

     DB-EFFECT: field REMOVED. Measured first — 0 of 7 hooks held a value, in both
     `local_db_10_aug_26` and its p2 copy — so no data was lost and no migration
     runs. Rows written while it existed simply carry an ignored `''`.
     revert: restore this Prop plus its `ALLOWED_UPDATES` and field-tab entries,
     and the third argument of `resolveBaseUrl` — see the note on that function.
     ⇒ host ไม่ใช่ค่าที่คนกรอก · อยู่ในไฟล์ของ provider บรรทัดเดียว */

  @Prop({ type: Boolean, default: false })
  slip_check!: boolean;

  /**
   * [FEAT-20260809-REQUIREPROFILE] Refuse to verify a slip from a customer who
   * has no account with the hook.
   *
   * WHAT IT DOES when `true`: if the profile lookup answers "this customer does
   * not exist", the Swiftcheck slip verification is SKIPPED entirely and the
   * customer is told to link their account first. No Swiftcheck call, no billed
   * verification, no SlipVerification row.
   *
   * WHY IT IS ITS OWN FLAG, not tied to payment: a hook may want this rule even
   * with no topup/walletpay configured at all — "do not spend a slip check on
   * somebody who is not a customer" is a slip-checking policy, which is why it
   * lives next to `slip_check`. เป็น gate ที่ต้องมี ต่อให้ไม่มี topup ก็ตาม.
   *
   * ⚠️ DEFAULT false = TODAY'S BEHAVIOUR, EXACTLY. Every existing hook keeps
   * verifying every slip, including from strangers. This never turns itself on.
   *
   * ⚠️⚠️ THE DANGEROUS MISREADING — read before touching the gate:
   * "no profile data" is NOT the same as "no account". A profile lookup can come
   * back empty because the upstream is DOWN, timed out, hit the circuit breaker,
   * returned 401/403 on a bad tool token, or because the tool has no endpoint
   * flagged `is_profile`. If the gate treated those as "not a customer", then on
   * the day the upstream has a 5-minute outage EVERY customer — including
   * long-standing ones — would be told they have no account and NO slip would be
   * verified at all. That is far worse than the wasted call this flag exists to
   * prevent. The gate therefore fires ONLY on an explicit "not found" answer and
   * FAILS OPEN on everything else. See `shouldBlockUnlinkedSlip`.
   *
   * DB-EFFECT: additive boolean, default false. revert: drop this Prop + the
   * gate in webhook.service; slip verification returns to running for everyone.
   */
  @Prop({ type: Boolean, default: false })
  /**
   * Dashboard label: **"รับสลิปเฉพาะลูกค้าที่ผูกบัญชีแล้ว"** (tab Slip Verification).
   * Paired copy: `slip_require_profile_text` below.
   *
   * Checked at `webhook.service.ts:~1570` via `shouldBlockUnlinkedSlip`. When it
   * blocks, the flow replies with the paired text and `return`s — no Swiftcheck call,
   * no slip row, no ticket, and neither `missing_api_data_text` nor
   * `image_answer_text` gets a turn.
   *
   * ⚠️ Works independently of `slip_check`: a hook with slip verification off but this
   *    flag on still refuses images from a customer the upstream reports as unknown.
   * ⚠️ Tested with `=== true`, never a truthy check, so a string `"true"` written by a
   *    sloppy client reads as ON in the dashboard and OFF here.
   */
  slip_require_profile!: boolean;

  /**
   * [FEAT-20260809-REQUIREPROFILE] What the customer is told when the gate above
   * refuses their slip. Empty ⇒ a sensible Thai default, so an operator who
   * switches the flag on without writing copy still gets a usable message.
   * Editable per hook — no code change. revert: drop with the flag.
   */
  @Prop({ type: String, default: '' })
  slip_require_profile_text!: string;

  /**
   * ==== [FEAT-20260812-QRPRESCAN] read a QR locally before paying for a slip check ====
   *
   * Dashboard label suggestion: "ตรวจ QR ในเครื่องก่อนส่งตรวจสลิป" (Slip Verification tab).
   *
   *   'off'  — never runs. Byte-identical to the behaviour before this existed.
   *   'log'  — scans and records what it found, but still sends every image for
   *            verification. Use this to watch real traffic before trusting the gate.
   *   'skip' (default) — scans, and when the image definitely contains no QR the
   *            verification call is skipped. The flow then continues exactly as it does
   *            today when the provider answers 400 VALIDATION_ERROR for that image.
   *
   * WHY: an image with no QR costs one paid verification and comes back
   * VALIDATION_ERROR every time — confirmed on live traffic 2026-08-12.
   *
   * ⚠️ Fail-open by design: only a confident "no QR" skips. An image we could not decode,
   *    one too large to read, or a timeout is still sent for verification. The reverse
   *    would mean a customer transfers money and their slip is never checked.
   * ⚠️ Anything other than the three strings above reads as 'off', so a typo cannot
   *    switch on a customer-visible change.
   *
   * ==== [FEAT-20260815-QRPRESCANDEFAULT] the default is 'skip', not 'off' ====
   *
   * Owner decision, 15/08/2026. A new hook stops paying for slip checks on images
   * that plainly are not slips, from its very first message, instead of having to
   * be switched on by someone who knows the setting exists.
   *
   * ⚠️ THIS IS THE ONE MODE THAT CHANGES BEHAVIOUR, so the safety argument has to
   * hold on its own: only a CONFIDENT "no QR" withholds the verification call.
   * An image that could not be decoded, one too large to read, or a timeout is
   * still sent — see the fail-open note below. A real slip therefore cannot be
   * skipped by a reader that simply failed; it can only be skipped by a reader
   * that positively found no QR at all. สลิปจริงไม่มีทางถูกข้ามเพราะอ่านไม่ออก.
   *
   * ⚠️ WHO ACTUALLY GETS IT — verified against the code, not assumed:
   *   · a brand-new hook                 ✅ `hookModel.create()` (hooks.service.ts:1348)
   *                                       applies schema defaults
   *   · clone WITH the slip tab ticked ✅ copies the SOURCE hook's value, whatever
   *                                       it is — `qr_prescan_mode` sits in the
   *                                       'slip' tab (hook-field-tabs.ts:87) and
   *                                       that tab is cloneable (:38)
   *   · clone WITHOUT the slip tab     ✅ the new hook was created first, so it
   *                                       carries this default
   *   · a hook THAT ALREADY EXISTS      ❌ UNCHANGED. `webhook.service.ts:905` reads
   *                                       hooks with `.lean()`, which skips
   *                                       hydration and therefore skips defaults —
   *                                       a document with no such field stays
   *                                       `undefined`, which `resolveQrPrescanMode`
   *                                       reads as 'off'. Changing the default does
   *                                       NOT reach them; that needs a deliberate
   *                                       `updateMany`, which is a separate decision.
   *   ของเดิมไม่ขยับ ต้องสั่ง update เองถ้าอยากให้เปลี่ยน.
   *
   * DB-EFFECT: none on existing rows — no migration, no reindex. A new document
   * simply stores 'skip' where it used to store 'off'.
   * revert: change this default back to 'off'. Hooks created while it was 'skip'
   * keep their stored value; set them back explicitly if that is not wanted.
   */
  @Prop({ type: String, enum: ['off', 'log', 'skip'], default: 'skip' })
  qr_prescan_mode!: 'off' | 'log' | 'skip';

  /**
   * ==== [FIX-20260812-HELPERMARKERLEAK] how hook-field replies handle markers ====
   *
   * `missing_api_data_text` and `image_answer_text` are routinely set to the marker
   * `[[[customer-helper]]]`, but the sites that send those fields never ran the tag
   * resolver, so the customer received the literal brackets. This switch controls how
   * far the fix goes, so a rollout can stop at any step and be reversed without a
   * deploy.
   *
   *   'off'    (default) — send the field exactly as stored, brackets and all. This is
   *                        the behaviour every OA had before the fix; nothing changes.
   *   'strip'  — remove markers. When the field was nothing but a marker the customer
   *              gets `customer_helper_text` instead of an empty message.
   *   'button' — same text, plus the register quick reply.
   *   'flex'   — [FEAT-20260812-HOOKHELPERFLEX] send the customer-helper CARD instead
   *              of text: the card bound to `flex_customerhelper_id` (falling back to
   *              the hard-coded one) with a freshly minted register URL on its button —
   *              i.e. exactly what the AI-reply path already sends for this marker.
   *              Only applies when the field actually contains the marker; a field
   *              without it is sent as text as always.
   *
   * ⚠️ Anything other than those three strings is read as 'off'
   *    (`hook-text-reply.ts`), so a typo can never switch a customer-visible change on.
   *
   * ⚠️ Why 'strip' cannot simply send the stripped text: a marker-only field strips to
   *    an empty string, and empty text makes LINE answer 400 — the customer then gets
   *    silence, which is worse than brackets. That bug already happened once
   *    (`[FIX-20260801-HELPEREMPTY]`).
   *
   * DB-EFFECT: additive string, default 'off' ⇒ every existing OA keeps its exact
   * behaviour with no migration. revert: drop this Prop, the `hook-text-reply.ts`
   * helper and the `[FIX-20260812-HELPERMARKERLEAK]` call sites in webhook.service.
   */
  /* [FIX-20260829-FLEXDEFAULT] default 'off' → 'flex' — เจ้าของสั่ง 29/08
     ─────────────────────────────────────────────────────────────────────────
     🔴 ทำไม: OA ที่ตอบถูกอยู่ 3 ตัว (`demo-oa-three`, `omnideskdevoatwo`,
        `omnideskdevoathree`) ถูกตั้ง `'flex'` ทีละตัวด้วยมือ เพราะ **หน้าเว็บไม่มี
        สวิตช์ให้ตั้งค่านี้เลย** (grep FE ทั้ง repo เจอแค่ในเทส clone) ⇒ OA ที่
        สร้างใหม่จึงได้ `'off'` และส่ง `[[[customer-helper]]]` เป็นวงเล็บดิบ
        ให้ลูกค้าเห็น จนกว่าจะมีคนไปตั้งให้ทาง API หรือ clone แท็บมา

     ⚠️ แถวเก่าไม่กระทบแม้แต่แถวเดียว — mongoose ใส่ default ตอน **insert**
        เท่านั้น · วัดจริงบน local 29/08: 25 แถวไม่มี field · 1 แถวเป็น `'off'`
        · 3 แถวเป็น `'flex'` อยู่แล้ว ⇒ ทั้ง 29 แถวคงเดิมทุกตัว

     ⚠️ **ห้ามแก้ `HOOK_TEXT_REPLY_DEFAULT_MODE` ใน `hook-text-reply.ts` ตาม**
        ค่านั้นคือ fallback ตอนอ่านแถวที่ **ไม่มี field** ⇒ ถ้าเปลี่ยนเป็น
        `'flex'` ด้วย จะไปเปลี่ยนพฤติกรรมของ OA เก่าทั้ง 25 ตัวย้อนหลังทันที
        ซึ่งตรงข้ามกับเจตนาของการแก้ครั้งนี้ · สองค่านี้ตอบคนละคำถาม

     📌 สิ่งที่เปลี่ยนสำหรับ OA ที่สร้าง **หลัง** จากนี้ (แค่นี้ ไม่มีมากกว่านี้):
        · field ที่มี `[[[customer-helper]]]` → ได้การ์ด แทนวงเล็บดิบ
        · field ที่มี `[[link]]` → ถูกแทนด้วย `answer_link`
        · field ที่มีแต่ marker ล้วน → ใช้ `customer_helper_text` แทนสตริงว่าง
          (สตริงว่างทำให้ LINE ตอบ 400 = ลูกค้าเงียบ ซึ่งแย่กว่าวงเล็บ)
        · ข้อความธรรมดาที่ไม่มี marker และไม่มี `[[link]]` → **เหมือนเดิมทุกไบต์**
          และ `buildHookHelperFlex` คืน `null` เมื่อไม่มี marker ⇒ ไม่มีการ์ด
          โผล่มาแทรกข้อความธรรมดา

     revert: เปลี่ยนคำเดียวกลับเป็น `'off'` · OA ที่ถูกสร้างไประหว่างนั้นจะยังถือ
     `'flex'` อยู่ ต้องแก้ข้อมูลแยกถ้าจะย้อนจริง */
  /* [FIX-20260901-OFFMENUTAG] 'flex' → 'off' — the 29/08 note above is now HISTORY
     ─────────────────────────────────────────────────────────────────────────
     Everything it says was true when it was written. Read it for the reasoning,
     not for the current value.

     WHY IT FLIPS BACK. 29/08 chose `'flex'` for one reason, stated above: a new
     OA would otherwise send `[[[customer-helper]]]` and `[[link]]` raw, because
     `'off'` did not resolve them. On 01/09 `'off'` was taught to resolve exactly
     those two, plus the menu marker. The reason for `'flex'` is therefore spent.

     WHY IT MUST NOT STAY 'flex'. Measured on the live OA on 01/09, both ways:
       `off`   the menu marker went out RAW, to the admin row and the customer,
               while `[[odk_s_*]]` resolved correctly
       `flex`  the menu card was sent, but `[[odk_s_*]]` was DELETED — a customer
               was told the deposit minimum was nothing at all
     `flex` routes the reply through `resolveReplyTags`, whose catch-all deletes
     every `[[…]]`. So a hook created today lands in the mode that eats amounts.
     The owner's decision: `off` only, and `off` has to be right on its own.

     ⚠️ SAME GUARANTEE AS 29/08 — existing rows are untouched. Mongoose applies a
        default on INSERT only. Measured 01/09: all 28 local hooks and all 8 on
        the deployed environment now read `off` anyway.

     ⚠️ STILL DO NOT TOUCH `HOOK_TEXT_REPLY_DEFAULT_MODE`. The 29/08 warning holds
        for the same reason it always did: that constant answers "how do I read a
        row with no value", and this one answers "what do I write on a new row".
        They happen to agree now; they are still different questions.

     📌 What a hook created after this gets, versus one created between 29/08 and
        today: the menu marker now yields its CARD instead of raw brackets, and
        `[[odk_s_*]]` survives instead of being deleted. `[[[customer-helper]]]`
        and `[[link]]` behave the same as they did under `'flex'`.

     revert: change the one word back to `'flex'`. Rows created in between keep
     `'off'`, which is now the correct value anyway, so no data fix is needed —
     the opposite of the 29/08 revert note. */
  @Prop({
    type: String,
    enum: ['off', 'strip', 'button', 'flex'],
    default: 'off',
  })
  hook_text_reply_mode!: 'off' | 'strip' | 'button' | 'flex';

  @Prop({ type: Number, default: null })
  slip_check_min_amount?: number | null;

  @Prop({ type: Number, default: null })
  slip_check_max_amount?: number | null;

  @Prop({ type: Number, default: null })
  slip_check_out_of_time?: number | null;

  @Prop({ type: [String], default: [] })
  callback_slip!: string[];

  @Prop({ type: String, default: '' })
  callback_token!: string;

  @Prop({ type: String, default: '' })
  external_api_url!: string;

  @Prop({ type: String, default: '' })
  external_user!: string;

  @Prop({ type: String, default: '' })
  external_password!: string;

  /** Customer account linking, off unless configured — the keyword behaves as
   * if the feature did not exist for hooks without these values. */
  @Prop({ type: Boolean, default: false })
  customer_link_enabled!: boolean;

  /** Blank = the shared landing page. */
  @Prop({ type: String, default: '' })
  customer_link_landing_url!: string;

  /** Wins over any web_code supplied by the client. */
  @Prop({ type: String, default: '' })
  customer_link_web_code!: string;

  @Prop({ type: Boolean, default: false })
  custom_tool_status!: boolean;

  /**
   * The tool this hook uses. This is the single side of the hook↔tool link —
   * the tool intentionally stores no reverse list. Indexed so "which OAs use
   * this tool" stays a cheap query rather than a denormalised copy.
   */
  /**
   * ⚠️ `MongooseSchema.Types.ObjectId`, NOT `Types.ObjectId`.
   *
   * `Types.ObjectId` is the BSON *value* class; the SchemaType is
   * `MongooseSchema.Types.ObjectId`. Passed through `@Prop`, the value class is
   * not recognised and the path silently degrades to **Mixed** — which casts
   * nothing, so `find({ custom_tool_id: '<24-hex string>' })` compares a string
   * against stored ObjectIds and matches zero documents. That is exactly how
   * `GET /api/custom-tools/:id/usage` came to answer `count: 0` against a tool
   * legacy reports 7 hooks for. Verified with `HookSchema.path(...).instance`.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'CustomTool',
    default: null,
    index: true,
  })
  custom_tool_id?: Types.ObjectId | null;

  /**
   * [FEAT-20260808-PAYTOOL-P1] SEPARATE payment-tool binding (R1, mandatory).
   *
   * Mirrors `custom_tool_status`/`custom_tool_id` 1:1 (same types/defaults/
   * index) but is a DISTINCT pair on purpose: the payment tool must NOT reuse
   * `custom_tool_id`, or enabling it would flip the inbound profile fork
   * (`webhook.service.ts:1172` — `useCustomTool = custom_tool_status===true &&
   * !!custom_tool_id`) and route profile through a POST-only payment tool ⇒
   * empty profile. Keeping the binding separate means payment never touches
   * that fork. No runtime reads these fields yet (Phase 2).
   *
   * ⚠️ `MongooseSchema.Types.ObjectId`, NOT `Types.ObjectId` — same reason as
   * `custom_tool_id` above: the value class degrades to Mixed and
   * `find({ payment_tool_id })` would match zero documents.
   *
   * DB-EFFECT: additive — `payment_tool_id` default null + `payment_tool_status`
   * default false; existing rows read as unbound/off, no migration.
   * revert: delete both @Prop blocks.
   */
  @Prop({ type: Boolean, default: false })
  payment_tool_status!: boolean;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'CustomTool',
    default: null,
    index: true,
  })
  payment_tool_id?: Types.ObjectId | null;

  /**
   * [FEAT-20260809-PAYTOOL-WALLETPAYTOOL] The walletpay tool, when walletpay lives in a
   * tool of its own.
   *
   * WHY A SECOND BINDING: topup is a SUB-ENDPOINT of the Shop-API tool the OA
   * already has (`shop-api/v1/customer/validate-slip` sits beside
   * `shop-api/v1/customer` — same host, same HMAC secret), so it needs no new tool.
   * walletpay is a different system on a different host with no auth, so it is its
   * own tool. A tool carries exactly ONE `base_url`, and the URL is built as
   * `base_url + '/' + endpoint.path`, so one tool physically cannot address two
   * hosts. topup = ลูกของ Shop-API เดิม · walletpay = คนละ host ต้องแยก tool.
   *
   * ⭐ EXPLICIT FLAG + id, exactly like `custom_tool_*` and `payment_tool_*`.
   * The separate tool is used only when `walletpay_tool_status === true` AND the id
   * is set — the presence of an id is NOT by itself the switch.
   *
   * WHY A FLAG RATHER THAN "id is non-empty": every other binding in this schema
   * pairs a boolean with an id, and the runtime gates read the boolean first
   * (`custom_tool_status === true && custom_tool_id`,
   * `payment_tool_status === true && payment_tool_id`). Inferring on/off from
   * "is the id truthy" would make this the ONE binding that behaves differently,
   * and it conflates two questions an operator asks separately: "which tool?"
   * and "is it in use?". With a flag an operator can turn the separate walletpay
   * tool OFF for a moment WITHOUT losing which tool they had chosen — the same
   * reason the other two pairs exist. It also removes a class of bug where an
   * empty string, a whitespace id or a stale value silently turns a money path
   * on or off. มี flag แยก ไม่ใช่ไปเดาจากว่า id ว่างหรือไม่ว่าง.
   *
   * OPTIONAL AND ADDITIVE. `false` (the default, and every existing row) means
   * "look for a `pay_walletpay` endpoint on the payment tool itself" — the original
   * single-tool layout, unchanged. No migration, no behaviour change until an
   * operator both binds a tool and switches this on. Bound per OA, so different
   * OAs may use different walletpay tools/hosts.
   *
   * ⚠️ NOT a second kill switch for the FEATURE: `payment_tool_status` alone
   * turns payment on and off. This only says WHERE the walletpay leg is sent.
   * DB-EFFECT: additive boolean (default false) + ObjectId (default null).
   * revert: drop both Props — the runner falls back to the payment tool's own
   * endpoint.
   */
  @Prop({ type: Boolean, default: false })
  walletpay_tool_status!: boolean;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'CustomTool',
    default: null,
    index: true,
  })
  walletpay_tool_id?: Types.ObjectId | null;

  @Prop({ type: String, enum: ['all', 'none', 'success'], default: 'all' })
  callback_action!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  external_endpoints!: Record<string, unknown>;

  @Prop({ type: Number, default: 30 })
  auto_unassist_minutes!: number;

  @Prop({ type: String, default: '' })
  chat_bot_id!: string;
}

export const HookSchema = SchemaFactory.createForClass(Hook);

// Group-scoped ticket lists and meta polls run Hook.find({ group }); without
// this index every such request is a full collection scan.
HookSchema.index({ group: 1 }, { background: true });
