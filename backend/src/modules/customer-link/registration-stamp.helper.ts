/**
 * Who registered this customer, and when.
 * ===========================================================================
 * A link can be created two ways and the difference matters afterwards: the
 * customer opened the LIFF page and filled the form in themselves, or an admin
 * pressed "ลงทะเบียนให้ลูกค้า" and did it for them. Once the link exists the two
 * are indistinguishable — same upstream call, same stored profile — so the
 * answer has to be written at the moment it happens or it is gone for good.
 * ตอนผูกสำเร็จเท่านั้นที่ยังรู้ว่าใครกด · ไม่บันทึกตอนนั้น = ย้อนหลังไม่ได้เลย.
 *
 * WHY A SEPARATE FILE
 *   `customer-link.service.ts` is already large and this is one small job with
 *   one write. Keeping it here means the storage decision — two fields on
 *   `members` — can change without the service knowing, and the service gains
 *   one import instead of another private method.
 *
 * WHY `link_` AND NOT `registered_`
 *   `registered_at` on its own was already taken by something else entirely: the
 *   dashboard shows `profile.registered_at` from the third-party API, meaning the
 *   customer's signup date at the site ("สมัครเมื่อ"). Both would have sat on the
 *   same panel with the same name and different meanings. `link_` says which fact
 *   this is — when OUR account link was created, not when they joined the site.
 *   คนละเรื่องกับ "สมัครเมื่อ" ของ shop-api ที่หน้าเดียวกันโชว์อยู่แล้ว.
 *
 * WHY NO MONGOOSE `enum`
 *   `agent_auto` and `other` are reserved for sources that do not exist yet, and
 *   whatever comes after them does not exist either. `system` is a name no
 *   longer written but still held by real rows. A schema-level enum turns
 *   the first unforeseen value into a THROW on the customer's registration path —
 *   the one path that must never fail. The union type below gives the same safety
 *   at compile time and costs nothing at run time.
 *   It is also what made renaming `system` → `member` on 2026-08-20 a code change
 *   with no schema migration behind it. ไม่มี enum ⇒ เปลี่ยนชื่อค่าได้โดยไม่ต้องแก้ schema.
 *
 * ⚠️ SEAMLESS BY CONSTRUCTION
 *   Both fields are optional and absent on every existing member (verified on a
 *   real row: 850 members, 831 registered, zero carrying either key). Absent and
 *   `null` both mean "we do not know how this one was registered" — they are
 *   NEVER backfilled, because a guessed source is a silent lie, the same rule
 *   `member.schema.ts` already states for `profile_data_updated_at`.
 *   A failure here is swallowed: the link already exists upstream, and losing a
 *   label must not turn a successful registration into an error.
 *
 * revert: delete this file, its two `@Prop`s in `member.schema.ts`, the call in
 * `customer-link.service.ts` and the two names in `clearStoredProfile`'s
 * `$unset`. Written rows can be removed with a plain `$unset`; nothing reads
 * these fields for a decision, only for display.
 */
import type { Model } from 'mongoose';

import { withStamp } from '../../common/utils/raw-data-stamp';

/**
 * Every source a registration can come from.
 *
 * WRITTEN TODAY
 * - `admin`      — an admin pressed the button on the customer's behalf
 * - `member`     — the customer opened the LIFF page and did it themselves
 *
 * RESERVED — accepted, produced by nobody
 * - `agent_auto`  — for a registration completed by an automation acting for the
 *                   customer rather than by either person
 * - `semi_admin`  — reserved 2026-08-21 on owner order. Between `admin` and
 *                   `member`: the customer completed the form themselves, but
 *                   only after an operator or an assistant walked them to it.
 *                   Neither existing name is honest about that — `admin` claims
 *                   somebody else filled it in, `member` claims nobody helped.
 * - `other`       — the catch-all for a source nobody has thought of
 *
 * ⚠️ IT WAS `semi-admin` FOR ONE AFTERNOON, AND THE HYPHEN WAS A MISTAKE.
 * Two things came out of measuring it rather than arguing about it:
 *   1. Every enum-like value in this repo uses an underscore — counted, not
 *      assumed: 260 underscore, ZERO hyphen. It would have been the first, and
 *      the odd one out is the one that gets mistyped.
 *   2. Reading a value list out of source with `/'([a-z_]+)'/g` is a HABIT
 *      here, not a one-off — the same class appears in
 *      `z-test/unit/webhook-log-emitter.spec.ts:146` (status values) and
 *      `z-test/unit/log-ticket-slim.spec.ts:155`. The cross-repo guard in
 *      `omnidesk-console` used it too, so while the value carried a hyphen the
 *      guard returned FIVE values for a list of SIX and went on reporting that
 *      every value had a label. Proven by running both expressions, not read.
 * The guard was widened to `[a-z_-]` AND KEPT that way — it costs nothing and
 * catches the next person who does reach for a hyphen. Changing the value was
 * free only because nothing had written it yet; a day later it would not have
 * been. ค่าใหม่ใช้ขีดล่างให้เหมือนอีก 260 ตัว · ตัวกันยังกว้างไว้เผื่ออนาคต.
 *
 * LEGACY — never written again, still valid
 * - `system`     — what `member` was called before 2026-08-20
 *
 * A reserved value needs no migration to adopt: it is already legal, so taking
 * it up is one line that starts writing it. ประกาศไว้ก่อน ⇒ วันหน้าใช้ได้ทันที.
 *
 * ⚠️ RENAMED 2026-08-20: `system` → `member`. Owner: "ลูกค้ากดเองเปลี่ยนเป็น
 * member". `system` read as "the software did it", which is the opposite of what
 * it meant — a person registering themselves.
 *
 * ⚠️ AND `system` STAYS ON THIS LIST, DELIBERATELY. Rows written between
 * 2026-08-19 and the rename hold it, and dropping the name would leave real data
 * carrying a value the code no longer admits exists — undeclared, unexplainable
 * to whoever reads it next, and a trap for any future `enum` or validator.
 * Keeping it costs one entry and makes the rename need NO migration at all:
 * old rows stay valid and keep meaning exactly what they meant.
 * Owner, on being told the rename was not fully seamless: "ถ้ามันกระทบก็จองใหม่ไป
 * เลยเป็น 5 คนเดิมช่างมัน".
 *
 * Migrating is therefore OPTIONAL, and only for tidiness:
 *     db.members.updateMany(
 *       { link_registered_by: 'system' },
 *       { $set: { link_registered_by: 'member' } })
 * เก็บชื่อเก่าไว้ ⇒ ไม่ต้อง migrate · ข้อมูลเดิมยังถูกต้องทุกแถว.
 */
/* ===========================================================================
 * ADDING A NEW VALUE, OR A NEW COLUMN NEXT TO THESE — WHERE IT HAS TO TRAVEL
 * ===========================================================================
 * THIS FILE IS THE CENTRE. `REGISTERED_BY` below is the only declaration of
 * what a registration source may be; the two `*_FIELD` constants are the only
 * place the column names are written; `stampLinkRegistration` is the only
 * writer. Everything else in either repo READS what this file decides.
 *
 * ⚠️ NO SECOND COLUMN. A `link_registered_support` column was proposed on
 * 2026-08-21 and the owner then decided against it: *"ไม่เพิ่มใหม่แล้ว … ย้ายไป
 * เป็นตัวเลือกใน registered_by จองตัวเลือกใหม่"*. The reason holds on its own —
 * a new column would have carried its own `other`, and `REGISTERED_BY` already
 * has one, so the same word would have meant two different things depending on
 * which column you read. A reserved VALUE costs a line and no migration; a
 * column costs a schema change, a clear-on-unlink entry, two more FE types and
 * a second label map. When a genuinely orthogonal fact turns up, revisit —
 * until then, a new source is a new NAME in the list below, not a new field.
 *
 * A NEW VALUE IN `REGISTERED_BY` REACHES SEVEN PLACES. Adding the name below
 * and stopping is what silently produces a row nobody can label and a bar that
 * counts nothing. Each destination and what it decides:
 *
 *   BACKEND
 *   1. `src/modules/chat/schemas/member.schema.ts` — the `@Prop`. Nothing to
 *      change for a new VALUE (there is no Mongoose `enum`, deliberately — see
 *      "WHY NO MONGOOSE enum" above). A new COLUMN needs a `@Prop` here, and
 *      the choice of default is made at that line, not here.
 *   2. `src/modules/customer-link/customer-link.service.ts` (~:1339) — the
 *      `$set` that CLEARS the stamp when a customer unlinks. A new column that
 *      is not added here keeps its old value through an unlink, and the next
 *      registration is stamped with the previous one's answer. This is the
 *      destination that is forgotten, because nothing fails when it is.
 *   3. `src/modules/tickets/insight-registrations/insight-registrations.service.ts`
 *      (`COUNTED_SOURCES`) — which values the report's bars COUNT. A value not
 *      listed there is silently excluded from every total. Widening that list
 *      changes what the bars mean, so it is an owner decision, not a follow-on
 *      edit: `system` is excluded ON PURPOSE and its spec goes red if included.
 *   4. `z-test/unit/customer-link-reg-source.spec.ts` (~:59) — asserts this
 *      list element for element. It goes red on any change here, by design:
 *      that red is the reminder to walk the rest of this list.
 *
 *   FRONTEND — repo `omnidesk-console`
 *   5. `services/chat/registrationSource.ts` — the union AND the `LABELS` map.
 *      A value missing from `LABELS` renders as the raw key on the panel.
 *   6. `services/chat/chatService.ts` and `services/chat/ticketService.ts` —
 *      the member types, declared in BOTH. A new COLUMN absent from either is
 *      invisible to TypeScript on the page that uses that one, even though the
 *      API sends it. (Nothing projects or whitelists members on the way out, so
 *      a new column does reach the browser — the type is the only gate.)
 *   7. `test/registrationSource.value.test.ts` — pins the labels and the call
 *      site in `pages/chat/TicketChat.tsx`.
 *
 * NAME BOTH ENDS, ALWAYS: whoever adds a value writes here where it will be
 * read, and writes at each destination where it came from. A one-ended note is
 * how a value ends up displayed but uncounted, or counted but unlabelled.
 * เพิ่มค่าใหม่ = ต้องบอกทั้งต้นทางและปลายทางทุกจุด ไม่งั้นหลุดเงียบ.
 */
export const REGISTERED_BY = [
  'admin',
  'member',
  'agent_auto',
  'semi_admin',
  'other',
  'system',
] as const;

export type RegisteredBy = (typeof REGISTERED_BY)[number];

export const LINK_REGISTERED_BY_FIELD = 'link_registered_by';
export const LINK_REGISTERED_AT_FIELD = 'link_registered_at';

/**
 * The one question this module can answer and nothing else can.
 *
 * An admin id present means an admin was driving; its absence means the person
 * whose account it is did it themselves.
 *
 * ⚠️ IT IS NOT THE SAME STRING THE WEBHOOK LOG WRITES, and an earlier version of
 * this comment claimed it was. The log's registration row uses
 * `adminUserId ? 'admin' : 'customer'` (`customer-link.service.ts:928`) — so the
 * two have always disagreed on the self-service case, first `system` vs
 * `customer` and now `member` vs `customer`. They are fed by the SAME condition,
 * which is what actually matters: one registration can never be recorded as
 * admin-driven in one place and self-driven in the other. Only the word differs.
 * เงื่อนไขเดียวกัน · คนละคำ · เคยเขียนคอมเมนต์ผิดว่าเป็นคำเดียวกัน.
 */
export function registeredByFor(
  adminUserId: string | null | undefined,
): RegisteredBy {
  return adminUserId ? 'admin' : 'member';
}

export interface RegistrationStampDeps {
  memberModel: Model<Record<string, unknown>>;
  warn: (msg: string) => void;
}

/**
 * Record the source of a registration — once, on the first one that lands.
 *
 * FIRST WRITER WINS, and it is the filter that enforces it, not a read before
 * the write. An admin pressing the button twice, a token replayed inside its
 * TTL, or a customer re-submitting all reach this line; only the first finds a
 * document to update and the rest match nothing. No lock, no window.
 * กดซ้ำกี่ครั้ง ค่าที่บันทึกไว้ครั้งแรกก็ไม่เปลี่ยน.
 *
 * Unlinking clears both fields (see `clearStoredProfile`), so a customer who
 * unlinks and registers again is stamped afresh — which is correct: that is a
 * new registration, by whoever made it.
 *
 * @returns true when this call was the one that wrote the stamp.
 */
export async function stampLinkRegistration(
  input: { channelUserId: string; adminUserId?: string | null },
  deps: RegistrationStampDeps,
): Promise<boolean> {
  const channelUserId = String(input?.channelUserId ?? '');
  if (!channelUserId) return false;
  try {
    const $set = withStamp(
      {},
      LINK_REGISTERED_BY_FIELD,
      LINK_REGISTERED_AT_FIELD,
      registeredByFor(input.adminUserId),
    );
    const res = await deps.memberModel
      .updateOne(
        {
          line_user_id: channelUserId,
          // absent OR an explicit null — a row may carry the schema's
          // `default: null` once anything else has written to it, and that
          // still means "never stamped".
          $or: [
            { [LINK_REGISTERED_BY_FIELD]: { $exists: false } },
            { [LINK_REGISTERED_BY_FIELD]: null },
          ],
        },
        { $set },
      )
      .exec();
    return (res as { modifiedCount?: number })?.modifiedCount === 1;
  } catch (err) {
    // Best-effort on purpose: the link exists upstream whatever happens here.
    deps.warn(
      `[CUSTOMER-LINK] registration stamp failed: ${(err as Error).message}`,
    );
    return false;
  }
}
