import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';
import {
  applySearchBucketsToUpdate,
  searchBucketsForDoc,
} from './member-search-tokens';
import {
  mirrorPair,
  mirrorUpdatePair,
  type MirroringQuery,
} from './mirror-field-pair';

export type MemberDocument = HydratedDocument<Member>;

/**
 * An end customer, identified by the platform-issued user id.
 *
 * The legacy file is named `lineUserModel.js` but the model is `Member` and the
 * collection was renamed to `members` — the LINE-specific naming survives only
 * in the field names.
 */
@Schema({ collection: 'members', ...legacyTimestamps })
export class Member {
  @Prop({ type: String, required: true, unique: true, trim: true })
  line_user_id!: string;

  /**
   * Channel-neutral rename of `line_user_id`, dual-written with it.
   *
   * Not unique on purpose: it is a straight copy of an already-unique field, so
   * it adds no duplicate risk, and the real constraint stays on the legacy
   * field until the rename cuts over.
   */
  @Prop({ type: String, trim: true })
  member_user_id?: string;

  @Prop({ type: String, default: '' })
  display_name!: string;

  @Prop({ type: String, default: '' })
  picture_url!: string;

  @Prop({ type: String, default: '' })
  status_message!: string;

  @Prop({ type: String, default: '' })
  nickname!: string;

  @Prop({ type: Date, default: null })
  last_synced_at?: Date | null;

  @Prop({ type: MongooseSchema.Types.Mixed })
  meta?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  raw_profile_data?: unknown;

  /**
   * Membership tier, normalised out of `raw_profile_data` so it can be queried
   * ("how many VIP customers") — the raw blob has a different shape per vendor
   * and cannot be filtered on.
   *
   * Mixed rather than a fixed sub-schema for the same reason: one vendor sends
   * `{ code, name, level }`, another a bare string, another a number. The
   * normalised form carries the original under `raw`, so nothing is lost.
   * Written only when the profile call genuinely succeeds.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  tier?: unknown;

  /**
   * When the profile was last fetched successfully.
   *
   * Separate from `updated_at`, which moves on any write (a nickname edit, a
   * tag, a tier write) and therefore cannot answer "how fresh is this data".
   * Written in the same atomic `$set` as `raw_profile_data`, so new data with an
   * old time is impossible. `null` means never fetched since the field existed
   * — deliberately not backfilled, since a guessed timestamp is a silent lie.
   */
  @Prop({ type: Date, default: null })
  profile_data_updated_at?: Date | null;

  /**
   * [FEAT-20260825-CLEAREDAT] When an admin last wiped `raw_profile_data`
   * through the developer-only remove button.
   * ===========================================================================
   * WHAT IT IS FOR. Nothing reads it yet — owner, 25/08/2026: *"ยังไม่ใช้อะไร
   * ทำไว้เผื่อเฉย ๆ"*. It exists so that when the question "who has had their
   * profile wiped, and when?" is finally asked, the answer is already recorded.
   * A timestamp that was never written cannot be reconstructed afterwards.
   *
   * ⭐ NO DEFAULT, ON PURPOSE — the field is ABSENT until the first clear.
   * Rejected alternatives and why:
   *   · `default: ''`  — an empty string in a Date column. Mongoose would have
   *     to cast it, and one column holding two types is precisely what makes a
   *     query return the wrong rows with no error to trace. Never do this.
   *   · `default: null` — legal, but writes a null onto all rows for no gain,
   *     and it makes the partial index below pointless: `$exists` would then be
   *     true for every document, so the index would cover the whole collection
   *     instead of the handful of rows that were actually cleared.
   * Absence is also fully queryable — `{ raw_profile_cleared_at: null }` matches
   * BOTH a missing field and an explicit null, so "who has never been cleared"
   * works without a default. Verified against the live collection on 25/08.
   *
   * ⭐ THE NAME. It follows `<subject>_<past-participle>_at`, the pattern every
   * other timestamp on this model already uses — `last_synced_at`,
   * `profile_data_updated_at`, `link_registered_at`, `first_ticket_at`. The
   * name first proposed was `is_clear_raw_profile_at`, which was rejected:
   * `is_` announces a boolean while `_at` announces a timestamp, so the two
   * halves contradict each other, and `clear` is the wrong verb form. There is
   * no `is_*` field anywhere on this model, so it would also have been the only
   * one of its kind.
   *
   * WRITTEN BY: `chat/members.service.ts` → `clearRawProfile`, in the SAME
   * atomic `updateOne` as the `$unset` of `raw_profile_data`. One write means
   * there is no instant where the profile is gone but the timestamp says it is
   * still there. That route is developer-only (`assertDevRemoveAllowed`), so
   * in practice this field will be set on very few rows — which is exactly what
   * makes the partial index below almost free.
   *
   * READ BY: nobody yet. When something does read it, add it here.
   *
   * ⚠️ THIS IS NOT A REGISTRATION-STATUS COLUMN. "Has this customer
   * registered?" is answered by `raw_profile_data` being present and non-empty
   * — see [DOC-20260825-REGSTATUS] in `chat/config/member-config.registry.ts`.
   * A customer can be cleared and then register again, at which point this
   * timestamp is stale history, not current state.
   *
   * revert: delete this prop, its index below, its ledger entry in
   * member-config.registry.ts, the `$set` in clearRawProfile, and
   * z-test/unit/raw-profile-cleared-at.spec.ts. Dropping the column from
   * existing rows is not required — nothing reads it.
   */
  @Prop({ type: Date })
  raw_profile_cleared_at?: Date;

  @Prop({ type: String, default: '' })
  phone_number!: string;

  @Prop({ type: String, default: '' })
  contract_code!: string;

  @Prop({ type: String, default: '' })
  full_name!: string;

  @Prop({ type: String, default: null })
  detail?: string | null;

  /**
   * [PERF-20260821-MEMBERSEARCH] Lowercased search tokens, one bucket per
   * searchable source field (see member-search-tokens.ts for why per field, the
   * token rules, and the seamless argument). NO DEFAULT: a legacy row carries no
   * `search` key and serialises exactly as before; buckets appear the first time
   * the row is written after deploy. Filled by the two hooks at the bottom of
   * this file, never by a writer. Indexed by ONE wildcard index below.
   * `select: false` (review finding): endpoints that return a member whole
   * (`findByIdAndUpdate` → `updated`, the profile routes) would otherwise start
   * carrying this key after the row's first write. Filtering on an unselected
   * path still works, so the tokens-mode query is unaffected.
   * revert: delete this prop, the two hooks, the index.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, select: false })
  search?: Record<string, string[]>;

  /**
   * How this customer's account link was created, and when.
   *
   * Two ways lead to the same link and they are indistinguishable afterwards:
   * the customer opened the LIFF page and filled the form in themselves
   * (`system`), or an admin pressed the button for them (`admin`). `other` is
   * reserved for a source that does not exist yet.
   *
   * Deliberately NOT a Mongoose `enum` — an unforeseen value would then THROW on
   * the registration path, the one path that must never fail. The union type
   * lives in `customer-link/registration-stamp.helper.ts` and is enforced at
   * compile time instead.
   *
   * Written in one atomic `$set` with its timestamp, first-writer-wins, so a
   * source without a time is impossible and pressing the button twice cannot
   * rewrite the original. `null` means we do not know — every member registered
   * before this field existed — and is deliberately NOT backfilled, for the same
   * reason `profile_data_updated_at` is not: a guessed source is a silent lie.
   * เดาไม่ได้ ต้องบันทึกตอนกดจริงเท่านั้น.
   *
   * `link_` and not `registered_`: the dashboard already shows a
   * `profile.registered_at` from the third-party API meaning the customer's
   * signup date at the site ("สมัครเมื่อ"). This one is when OUR link was made.
   */
  /* DESTINATION 1 of 7. The list of legal values, and the decision to have no
     Mongoose `enum`, live in `src/modules/customer-link/registration-stamp.helper.ts`.
     ⚠️ NO SECOND COLUMN IS COMING. `link_registered_support` was proposed and
     dropped on 2026-08-21 by owner decision — a new source is now a new NAME in
     `REGISTERED_BY`, not a new field here. This `@Prop` therefore stays exactly
     as it is when a source is added; nothing in this file changes.
     ⚠️ `default: null` on this one is now regarded as the wrong choice: it puts
     the key into every new document and every `toJSON()` even when it means
     nothing. `first_ticket_at` deliberately has NO default for that reason
     (`tickets/schemas/first-ticket-stamp.ts:41`). Follow that one, not this. */
  @Prop({ type: String, default: null })
  link_registered_by?: string | null;

  @Prop({ type: Date, default: null })
  link_registered_at?: Date | null;

  /**
   * [FEAT-20260820-FIRSTTICKET] When this customer's FIRST ticket was created —
   * whatever opened it: the assist marker, an admin pressing "open case", the
   * REST route, or the payment runner. Written once and never again; see
   * `tickets/schemas/first-ticket-stamp.ts` for the rule and the removal steps.
   *
   * ⚠️ NOT "does this customer have a case open right now". That is
   * `tickets.job_status` and it changes constantly. Reading this one for that
   * question would answer with a date that is true for ever.
   * คนละคำถามกับ "ตอนนี้มีเคสเปิดอยู่ไหม".
   *
   * ⚠️ NO `default: null`, unlike the two fields above. A default writes the key
   * into every new document and into every `toJSON()` response even when it
   * means nothing; absent is the honest representation of "never had a ticket",
   * and it keeps the partial index below holding only real values. The two
   * fields above predate that decision and are left as they are.
   * ไม่ใส่ default · ไม่มี field = ยังไม่เคยมีเคส.
   *
   * Absent on every member that existed before 2026-08-20 and NEVER backfilled:
   * a guessed date is a silent lie, the same rule `profile_data_updated_at`
   * states. ไม่ backfill เด็ดขาด.
   */
  @Prop({ type: Date })
  first_ticket_at?: Date;

  /**
   * [FEAT-20260820-PLATE] Labels the SYSTEM puts on a customer, so a broadcast can
   * find its audience in one query. Owner, 2026-08-20: "เราจะทำ deposit tag กับ
   * member ... ใช้ broadcast function หา member ทุกคนที่มี tag deposit แล้วมาไล่ยิง
   * broadcast จาก member line user id ที่คิวรี่ได้".
   *
   *   db.members.find({ plates: 'deposit' }, { line_user_id: 1 })
   *
   * ⚠️ THIS IS NOT THE TAG SYSTEM NEXT DOOR, and the difference is the reason it
   * exists rather than reusing it. `tags` + `customer_tags` hold an ADMIN's label:
   * it has an identity (colour, group scope, `use_count`, renameable) and lives in
   * a join, so the audience costs two hops and an `$in` that grows with the
   * audience — the wrong shape for a broadcast. A plate has no identity, only a
   * word, and answers in one indexed query. Different writer, different question,
   * different cost. The owner picked the word "plate" so the two cannot be
   * confused. ป้ายของระบบ ไม่ใช่ label ที่แอดมินติดเอง.
   *
   * ⚠️⚠️ `default: undefined` IS LOad-BEARING, NOT DECORATION. Mongoose installs a
   * default of `[]` on every array path unless it is passed one explicitly —
   * `node_modules/mongoose/lib/schema/array.js:110` reads
   *   if (!('defaultValue' in this) || this.defaultValue != null) this.default(fn)
   * and that `fn` returns `[]`. Drop this option and EVERY new member is written
   * with `plates: []`, `$exists: true` becomes true for the whole collection, and
   * the partial index below silently stops being partial.
   * ถอด default: undefined ออกเมื่อไหร่ index กินทั้ง collection ทันที.
   *
   * Absent on every member that existed before 2026-08-20 and never backfilled —
   * no field means "carries no plates", which is the truth.
   *
   * revert: delete this prop and its index below. Nothing writes it yet, so there
   * is no data to undo.
   */
  @Prop({ type: [String], default: undefined })
  plates?: string[];

  /**
   * [FEAT-20260821-IGNOREABANDON] this ONE customer is never chased about
   * registering, whatever the OA's own setting says.
   *
   * ⚠️ A COLUMN, ON PURPOSE — owner, 20/08/2026: *"member column จริงไม่ใช่
   * config follow ไม่เกี่ยว"*. The `config` bag below would have been cheaper
   * (a registry line instead of a schema field), and it was rejected: this
   * setting is not part of follow-up's stored state and must not share its
   * path, its registry or its indexes. ห้ามย้ายลงถุง config.
   *
   * ⚠️ `=== true` ONLY — same lean-read trap as the hook's copy: the ticket
   * and webhook paths read members lean, so an existing row answers
   * `undefined`, never `false`.
   *
   * NOT INDEXED, deliberately: nothing queries BY this field. It is read from
   * a member document the caller already holds, exactly like `plates` above.
   * revert: delete this prop and the one reader. Rows keep their value; nothing
   * looks at it once the reader is gone.
   */
  @Prop({ type: Boolean, default: false })
  ignore_abandon_assist?: boolean;

  /**
   * Per-member settings, so a new switch costs a line in a registry instead of a
   * schema change, a migration and a deploy.
   *
   * Which keys are legal, what they hold, and how they are read and written all
   * live in `chat/config/` — nothing else should reach into this object. The bag
   * is `Mixed`, so Mongoose validates nothing inside it; that validation is the
   * registry's job and it happens before any write is built.
   *
   * ⚠️ NO `default`, deliberately. Mongoose applies defaults on the INSERT half
   * of an upsert, and this system creates members through upserts
   * (`chat.service.ts` · `chat-history.service.ts`). A `default: {}` would
   * therefore be written into the database for every new member and returned by
   * every `.lean()` read — `minimize` hides an empty object on a hydrated
   * document but NOT on a lean one, which is the path most endpoints take.
   * Measured, not assumed. Absent is the only state that means "never
   * configured", and it is what keeps this migration-free: the 850 rows that
   * predate it are untouched, and new rows gain no key either.
   * ห้ามใส่ default เด็ดขาด · ใส่เมื่อไหร่ response ขยับทันที.
   *
   * ⚠️ READ FROM A DOCUMENT YOU ALREADY HAVE. `find({ 'config.x': … })` on a
   * path with no index is a collection scan; add a partial index for that exact
   * key when a screen genuinely needs to search by it, never in advance.
   *
   * What does NOT belong in here: anything needing uniqueness, a TTL, sorting as
   * the primary axis, or an array that grows without a ceiling. Those stay real
   * columns. A member document averages 380 bytes today — keep it that way.
   *
   * revert: delete this Prop and `src/modules/chat/config/`.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  config?: Record<string, unknown>;
}

export const MemberSchema = SchemaFactory.createForClass(Member);

/**
 * Contacts-page search indexes.
 *
 * `sparse` because all three fields default to `''` and most members — everyone
 * who has not linked an account — share that empty value. Excluding it keeps
 * the index small and matches real queries: nobody searches for "".
 *
 * A non-anchored regex still scans the index rather than seeking, but scanning
 * a small in-memory index beats scanning every document. A text index is not
 * used: it cannot segment Thai, which has no word spaces.
 */
/**
 * [FIX-20260821-MUIDINDEX] `member_user_id` is READ on the live webhook path and
 * had no index — every one of those reads was a collection scan.
 *
 * CALL SITES that do `findOne({ member_user_id })` on this collection:
 *   `webhook/webhook.service.ts` · `webhook/assist/assist-notification.ts`
 *   `chat/chat-history.service.ts` · `chat/chat.service.ts`
 *   `external/external-api.service.ts`
 *
 * ⚠️ TWO CORRECTIONS, both made 2026-09-05 after the list was checked against the tree
 * rather than trusted:
 *   · The spine used to be counted "(twice)". [PROG-20260905-C3] moved the member sync
 *     into `webhook/room-bootstrap/sync-member-profile.ts`; the QUERY deliberately stayed
 *     at the call site (`member-user-id-index.spec.ts` proves the index is still used by
 *     the live path by grepping for it there), but the two reads now share ONE arrow that
 *     the handler calls twice. **The number of queries at run time did not change** — the
 *     initial read and the re-read after a brand-new member's upsert both still happen.
 *     Only the number of places the query is SPELLED did.
 *   · `external/external-api.service.ts` was never on this list and predates the move.
 *     It is named now.
 *
 * `tickets/tickets.service.ts` also filters on this field, as
 * `$or: [{ member_user_id }, { line_user_id }]` — a different query shape, listed
 * separately so nobody counts it as a sixth plain lookup.
 * They exist because `[FIX-20260808-DUALWRITE]` cut READS over to the new name
 * while the constraint stayed on the old one — the index did not follow.
 *
 * MEASURED on a throwaway collection, worst case (the row is last):
 *     1,000 rows    scan 1,000     0ms   →  with index  scan 1   0ms
 *    50,000 rows    scan 50,000    9ms   →  with index  scan 1   0ms
 *   200,000 rows    scan 200,000  39ms   →  with index  scan 1   0ms
 * The index itself costs 2.29 MB per 200,000 rows and 162ms to build; writes
 * went 115ms → 131ms for 20,000 updates (+14%). วัดจริง ไม่ได้เดา.
 *
 * ⚠️ NOT UNIQUE, AND THAT IS NOT AN OVERSIGHT. The @Prop says why: this column
 * is a straight copy of an already-unique field and the real constraint stays on
 * `line_user_id` until the rename cuts over. A unique index here would ALSO fail
 * to build the moment two legacy rows carry no value — they would collide on
 * `null`. `sparse` keeps those rows out of the index entirely.
 * ห้ามทำ unique · แถวเก่าที่ไม่มีค่าสองแถวจะชนกันที่ null ทันที.
 *
 * SEAMLESS: an index is only ever an extra option for the planner — no existing
 * query changes plan against its will, and nothing about the documents changes.
 * Every row already carries the value: the mirror at the bottom of this file
 * runs on `validate` AND on `findOneAndUpdate/updateOne/updateMany`, and nothing
 * in `src/` writes members through `bulkWrite`, `insertMany` or the raw driver,
 * so there is no path that skips it (checked 21/08/2026).
 *
 * ⚠️ BEFORE DEPLOYING TO A REAL DATABASE, count the rows that would be left out:
 *   db.members.countDocuments({ $or: [ { member_user_id: { $exists: false } },
 *                                      { member_user_id: '' },
 *                                      { member_user_id: null } ] })
 * On the dev database that is 0 of 4. A non-zero count is not a blocker for a
 * sparse non-unique index — those rows simply stay unindexed and their reads
 * keep scanning — but it tells you the mirror missed them and that is worth
 * knowing on its own.
 *
 * revert: drop this index; the five reads go back to scanning. Nothing depends
 * on it existing.
 */
MemberSchema.index({ member_user_id: 1 }, { background: true, sparse: true });

MemberSchema.index({ phone_number: 1 }, { background: true, sparse: true });
MemberSchema.index({ full_name: 1 }, { background: true, sparse: true });
MemberSchema.index({ display_name: 1 }, { background: true, sparse: true });

/*
 * [FIX-20260820-MEMBERUSERIDIDX] — SUPERSEDED, deliberately removed.
 *
 * This lane added the same index independently, without `sparse`, on the
 * measurement that all 850 rows in the local clone carry the field so sparse
 * would exclude nothing and only mislead. dev then shipped 0fb7046 with
 * `sparse: true`, reasoning about rows that may legitimately lack the field.
 *
 * Two `schema.index()` calls on the same key with different options do NOT
 * merge: Mongoose issues both createIndex calls at boot and the second fails
 * with IndexKeySpecsConflict (code 86) — reproduced on a throwaway collection
 * before this line was removed. Keeping both would fail on every start.
 *
 * dev's version stays because it is the one on the mainline and its reasoning
 * is the safer of the two: sparse costs nothing when every row has the field,
 * and protects the index if a row ever does not. เก็บของ dev · ลบของเรา.
 *
 * The index itself lives ~35 lines above. Nothing was lost.
 */

/**
 * [FEAT-20260820-ABANDONTRIGGER] find the customers who were asked to register
 * and kept talking, WITHOUT naming one — "show me everybody who is stuck".
 *
 * PARTIAL on purpose. The index holds only the members that carry the stamp, so
 * it grows with the number of people who are stuck, not with the member count.
 * Measured on a throwaway 50,000-row collection with 40 stamped: without it the
 * query scanned all 50,000 and sorted in memory (11ms); with it, 40 keys, 40
 * docs, no SORT stage (0-2ms), and the index itself was 20 KB against a 6.9 MB
 * collection. วัดจริง ไม่ได้เดา.
 *
 * SORTED BY THE STAMP ITSELF, not by `updated_at`. Measured: with `updated_at`
 * as the second field the plan still carried a SORT stage, because the predicate
 * on the leading field is `$exists` — a RANGE, not an equality — so the index
 * cannot hand back `updated_at` order. Sorting on the stamp is both index-ordered
 * and the question people actually ask of this list: who has been stuck longest.
 * เรียงด้วยวันที่ติด ไม่ใช่ updated_at · วัดแล้วว่าอันนั้นยังต้อง SORT.
 *
 * It cannot affect anybody else's query: a partial index is only eligible when
 * the query provably matches its filter expression, and no existing query
 * mentions `config` at all. Writes to members without the stamp never touch it.
 *
 * revert: drop this index; nothing depends on it existing.
 */
MemberSchema.index(
  { 'config.follow_up.line.abandon_trigger_at': 1 },
  {
    background: true,
    partialFilterExpression: {
      'config.follow_up.line.abandon_trigger_at': { $exists: true },
    },
  },
);

/**
 * [FEAT-20260820-REQUESTREG] count the customers a registration case was ever
 * opened for — "how many people did we have to ask?".
 *
 * SAME SHAPE AS THE INDEX ABOVE, and for the same measured reasons: partial, so
 * it holds only the members that carry the stamp; keyed on the stamp itself, so
 * "who was asked first" is index-ordered rather than sorted in memory.
 *
 * ⚠️ IT ANSWERS A DIFFERENT QUESTION FROM THE ONE ABOVE, which is why it is a
 * second index and not a compound one. `abandon_trigger_at` is CLEARED the
 * moment a customer registers, so that index only ever holds people who are
 * stuck right now. `request_reg_at` is never cleared, so this one accumulates
 * and stays answerable for ever. A compound index could serve neither question
 * on its own. ตัวบนคือ "ตอนนี้ใครติด" · ตัวนี้คือ "เคยถามใครไปแล้วบ้าง".
 *
 * The count it exists for:
 *   db.members.countDocuments({ 'config.follow_up.line.request_reg_at': { $exists: true } })
 *
 * It cannot affect anybody else's query, for the reason stated above: a partial
 * index is only eligible when the query provably matches its filter expression,
 * and no existing query mentions `config` at all. A member without the stamp is
 * never touched by a write to it. คนที่ไม่มีค่านี้ไม่ถูกแตะเลย.
 *
 * revert: drop this index; nothing depends on it existing.
 */
MemberSchema.index(
  { 'config.follow_up.line.request_reg_at': 1 },
  {
    background: true,
    partialFilterExpression: {
      'config.follow_up.line.request_reg_at': { $exists: true },
    },
  },
);

/**
 * [FEAT-20260822-NOTICERUNTIME] the three notice stamps — same partial shape
 * as the two above, added on the owner's standing order that everything under
 * follow_up carries an index ("ทำ index ไว้เผื่อเลย"). Partial on $exists, so a
 * member who was never noticed costs nothing; nothing queries them yet (the
 * cooldown reads the already-loaded document). Ledger entries with dates and
 * commits: member-config.registry.ts. revert: drop these three; nothing
 * depends on them existing.
 */
/**
 * [FEAT-20260825-HELPERTRIGGER] "ใครเคยถูกเสนอให้ผูกข้อมูล และล่าสุดเมื่อไหร่"
 *
 * PARTIAL on `$exists` เหมือน stamp ตัวอื่นในถุงนี้ทุกประการ — แถวที่ยังไม่เคย
 * ถูกเสนอจะไม่กินที่ใน index เลย
 * ⚠️ เป็น ROLLING stamp (ทับทุกครั้งที่เข้าเงื่อนไข) ⇒ ค่าใน index จะขยับบ่อยกว่า
 *    stamp ที่เขียนครั้งเดียว · ยอมรับได้เพราะ customer-helper ไม่ได้ส่งทุกข้อความ
 *    แต่ถ้าวันไหนเงื่อนไขถูกแก้ให้กว้างขึ้นมาก (ดู customer-helper-trigger.rule.ts)
 *    ให้กลับมาดูข้อนี้ด้วย — index ที่ถูกเขียนทับถี่ ๆ มีราคาของมัน
 * Ledger entry: member-config.registry.ts · revert: ลบ index นี้ทิ้งได้เลย
 */
MemberSchema.index(
  { 'config.follow_up.line.customer_helper_trigger_at': 1 },
  {
    background: true,
    partialFilterExpression: {
      'config.follow_up.line.customer_helper_trigger_at': { $exists: true },
    },
  },
);

MemberSchema.index(
  { 'config.follow_up.line.notice_deposit_at': 1 },
  {
    background: true,
    partialFilterExpression: {
      'config.follow_up.line.notice_deposit_at': { $exists: true },
    },
  },
);

MemberSchema.index(
  { 'config.follow_up.line.notice_withdraw_at': 1 },
  {
    background: true,
    partialFilterExpression: {
      'config.follow_up.line.notice_withdraw_at': { $exists: true },
    },
  },
);

MemberSchema.index(
  { 'config.follow_up.line.notice_payment_at': 1 },
  {
    background: true,
    partialFilterExpression: {
      'config.follow_up.line.notice_payment_at': { $exists: true },
    },
  },
);

/**
 * [FEAT-20260825-CLEAREDAT] "who has had their profile wiped, and when?"
 *
 * PARTIAL on `$exists`, like the follow-up stamps above, and here the shape
 * matters more than usual: the clear button is developer-only, so the number of
 * rows carrying this field is expected to stay near zero. A partial index over
 * near-zero rows costs almost nothing to keep and answers the question without
 * a scan.
 *
 * ⚠️ IT ONLY HELPS ONE DIRECTION. "Who WAS cleared" uses this index. The
 * opposite question — "who has NEVER been cleared" — is `$exists: false` or
 * `: null`, and no index can serve that: MongoDB has to look at every document
 * to prove a field is missing. Measured on the live collection 25/08/2026:
 * `explain()` on `{ raw_profile_data: { $exists: false } }` reported COLLSCAN
 * with docsExamined equal to the full collection count. That is a property of
 * the query, not of this index, and choosing a default would not change it.
 * ⇒ If a screen ever needs "never cleared" at scale, invert the question or
 * maintain the flag some other way; do not add a second index hoping to fix it.
 *
 * Ledger entry with date and reason: member-config.registry.ts.
 * revert: drop this index; nothing depends on it existing.
 */
MemberSchema.index(
  { raw_profile_cleared_at: 1 },
  {
    background: true,
    partialFilterExpression: { raw_profile_cleared_at: { $exists: true } },
  },
);

/**
 * [FEAT-20260820-FIRSTTICKET] count and date-range the customers who have ever
 * had a case — "how many people did we end up handling, and since when".
 *
 * PARTIAL, like the two above: it holds only members that carry the stamp, so it
 * grows with the number of customers who ever needed a case, not with the member
 * count. A member that never had one is never touched by a write to it.
 *
 * ⚠️ The field has NO schema default, so `$exists` is exactly "has ever had a
 * ticket" — with a `default: null` it would be true for everybody and the index
 * would be the collection. ไม่มี default ⇒ index ถือเฉพาะคนที่มีค่าจริง.
 *
 * SORTED BY THE STAMP so "who came first" is index-ordered rather than sorted in
 * memory — the same measured reason as the two indexes above.
 *
 *   db.members.countDocuments({ first_ticket_at: { $exists: true } })
 *   db.members.find({ first_ticket_at: { $gte: ISODate('2026-08-01') } })
 *
 * revert: drop this index; nothing depends on it existing.
 */
MemberSchema.index(
  { first_ticket_at: 1 },
  {
    background: true,
    partialFilterExpression: { first_ticket_at: { $exists: true } },
  },
);

/**
 * [FEAT-20260820-PLATE] find a broadcast's audience without touching the members
 * that are not in it.
 *
 * MULTIKEY, because the field is an array: Mongo indexes every element, so
 * `find({ plates: 'deposit' })` is a seek and not a scan.
 *
 * PARTIAL, for the reason the three indexes above give: it holds only the members
 * that carry a plate, so it grows with the plated few rather than with the
 * collection, and a member without plates is never touched by a write to it.
 *
 * ⚠️ DELIBERATELY NOT COMPOUNDED with `line_user_id`, even though the broadcast
 * reads exactly that field. A multikey index cannot cover a query — MongoDB's own
 * rule — so the documents are fetched either way and the extra key would only make
 * the index bigger. ใส่ไปก็ไม่ได้ covered query แค่ index ใหญ่ขึ้น = หนี้.
 *
 * revert: drop this index; nothing depends on it existing.
 */
MemberSchema.index(
  { plates: 1 },
  {
    background: true,
    partialFilterExpression: { plates: { $exists: true } },
  },
);

/**
 * Keeps `line_user_id` and `member_user_id` equal on every write.
 *
 * Legacy: `lineUserModel.js:96` and `:128`. Same reasoning as the chat-room
 * pair — see `mirror-field-pair.ts`. The upsert branch matters here in
 * particular: the external-API token cache filters on `line_user_id` without
 * restating it, so without the mirror an upsert-created member would carry one
 * name and not the other.
 *
 * [FIX-20260808-DUALWRITE] Phase 3.1e. Field pair: line_user_id <->
 * member_user_id. Why: reads were cut over to member_user_id; a schema that
 * declares the column but drops this mirror leaves member_user_id null, so
 * filters on the new name miss the row. Mirrors legacy `lineUserModel.js`.
 */
MemberSchema.pre('validate', function (this: Record<string, unknown>) {
  mirrorPair(this, 'line_user_id', 'member_user_id');
});

MemberSchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function (this: MirroringQuery) {
    mirrorUpdatePair(
      this.getQuery(),
      this.getUpdate(),
      Boolean(this.getOptions().upsert),
      'line_user_id',
      'member_user_id',
    );
  },
);

/**
 * [PERF-20260821-MEMBERSEARCH] The two doors that fill `search.*` — the same two
 * `mirrorPair` uses, so every writer in the codebase is covered without being
 * touched: `validate` for save/create, the update family for `$set` partials.
 * The update hook rewrites ONLY the buckets whose source field is in the update
 * (dotted paths), so a `$set: { nickname }` cannot wipe `search.full_name`.
 */
MemberSchema.pre('validate', function (this: Record<string, unknown>) {
  const buckets = searchBucketsForDoc(this);
  // only write the key when something derives to a token — an empty row stays
  // key-less, which is what keeps a bare upsert byte-identical to before.
  if (Object.values(buckets).some((b) => b.length > 0))
    this['search'] = buckets;
});

MemberSchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function (this: MirroringQuery) {
    const update = this.getUpdate();
    if (update && typeof update === 'object' && !Array.isArray(update)) {
      applySearchBucketsToUpdate(update);
    }
  },
);

/**
 * [PERF-20260821-MEMBERSEARCH] ONE wildcard index over every bucket. Multikey,
 * so a prefix-anchored regex on any `search.<bucket>` is an index range scan —
 * the query shape tickets/member-search.util.ts builds in `tokens` mode.
 * Additive; no other index changes. DB-EFFECT: one new index, no document changes.
 */
MemberSchema.index({ 'search.$**': 1 }, { background: true });
