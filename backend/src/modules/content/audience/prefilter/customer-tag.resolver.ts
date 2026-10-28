/**
 * [FEAT-20260824-BCASTTAGPRE] "member คนไหนใช้ tag นี้" — planned, not queried.
 * ===========================================================================
 * เจ้าของ 24/08: *"เพิ่ม ท่อ สามารถเลือกเป้าหมาย จาก customer tag ได้ด้วย ว่า member
 * คนไหนใช้ tag นี้"* · *"customer_tags เดิมมันจะลิงก์กันใช่ไหม + crud ต้องมาลิงก์หมด"*
 *
 * 🔴 THE RULE CARRIES A `tags._id`, NOT A LABEL — that IS the link to the
 *    existing tag CRUD. `tag.schema.ts:11-15` says the label used to be copied
 *    onto every `customer_tags` row and that this was wrong: two groups' "VIP"
 *    collapsed into one and a rename meant rewriting every row. Targeting by id
 *    means renaming a tag leaves every saved campaign still pointing at the same
 *    tag, and deleting one leaves a campaign that matches nobody rather than a
 *    campaign that matches somebody else's label.
 *    ยิงด้วย tag_id ⇒ เปลี่ยนชื่อ tag แล้วแคมเปญเดิมยังชี้ตัวเดิม.
 *
 * 🔴 NOTHING IS COPIED ONTO `members`. The rejected alternative was to stamp the
 *    tag onto the member row. 14 files under `chat/` and `tickets/` write
 *    `customer_tags`; every one of them would have to keep a stamp in sync
 *    forever, and the first stale stamp (tag removed, copy left behind) sends a
 *    campaign to somebody who should not get it — "wider than asked", the exact
 *    failure this subsystem exists to prevent. It would also write to real
 *    customer data for a broadcast's convenience.
 *    ห้ามก๊อป tag ไปแปะบน members — ค่าค้างเมื่อไหร่ = ยิงกว้างกว่าที่สั่ง.
 *
 * 🔴 `hook_id` IS NOT USED TO NARROW. `customer-tag.schema.ts:15-19` states it
 *    plainly: `chat_room_id`/`hook_id` "are provenance only, never a visibility
 *    filter", and both default to `null`. Filtering on it would silently drop
 *    every row written without one. The OA narrowing that matters happens later
 *    and already exists — the recipient pager turns member ids into THIS OA's
 *    LINE ids through `chat_rooms` (`audience/oa-scope.ts`), so a resolved id
 *    that belongs to another OA drops out on its own.
 *    hook_id เป็นแค่ที่มา ไม่ใช่ตัวกรอง — การคัด OA ทำที่ chat_rooms อยู่แล้ว.
 *
 * MEASURED ON THE LANE DB (`boardcast_lane_24aug`, 2026-08-24, explain
 * executionStats): `customer_tags.find({tag_id})` → IXSCAN `tag_id_1`,
 * totalKeysExamined 1, totalDocsExamined 1, 0 ms. No index was added; the four
 * that exist (`tag_id_1`, `member_id_1`, `member_id_1_tag_id_1`, `hook_id_1`)
 * already answer this. ไม่ได้เพิ่ม index ใหม่.
 *
 * revert: delete this file and its line in `prefilter.registry.ts`.
 */
import type { AudienceRule } from '../sources';
import type {
  AudiencePrefilterResolver,
  PrefilterLookup,
} from './prefilter.types';

/**
 * The registry key this answers for.
 *
 * ⚠️ Written as a literal in `audience-source.registry.ts` too — that file must
 *    not import this folder, or deleting the folder would break the registry and
 *    the feature would stop being removable. A spec pins the two strings equal.
 *    ทะเบียนห้าม import โฟลเดอร์นี้ ไม่งั้นลบโฟลเดอร์แล้วพัง.
 */
export const CUSTOMER_TAG_KEY = 'customer_tag';

/** The mongoose model `chat.module.ts:99` / `tickets.module.ts:65` register. */
export const CUSTOMER_TAG_MODEL = 'CustomerTag';

/**
 * How many tags one rule may name.
 *
 * A POLICY number, not a measured one: it bounds how many ids ride in ONE
 * `$in` against `tag_id_1`, and `tags` holds 3 rows on this database. Twenty is
 * far past any real campaign and far below anything that could hurt. Refused
 * rather than trimmed — a trimmed tag list is a rule the admin cannot see was
 * cut. ตัดทิ้งเงียบ ๆ ไม่ได้ ต้องปฏิเสธ.
 */
export const MAX_TAGS_PER_RULE = 20;

/** 24 lowercase/uppercase hex characters — what casts to an ObjectId. */
const HEX24 = /^[0-9a-fA-F]{24}$/;

/**
 * One `customer_tag` rule → one indexed lookup on `customer_tags`.
 *
 * 🔴 `eq` IS NORMALISED TO ONE-ELEMENT `$in`. One shape downstream means one
 *    thing to get right, and `{tag_id: {$in: [x]}}` and `{tag_id: x}` use the
 *    same index in the same way (measured: keys 1, docs 1).
 *
 * 🔴 A VALUE THAT IS NOT A 24-HEX ID IS AN ERROR, NEVER A SKIP. Handing a
 *    non-castable value to mongoose raises a CastError, and this whole path
 *    must not throw (a scheduled run would crash instead of reporting). Refusing
 *    here converts it into a readable reason before anything is queried.
 *    ค่าที่ cast ไม่ได้ = ปฏิเสธก่อนยิง ไม่ใช่ปล่อยให้ throw กลางทางส่ง.
 */
function planLookup(
  rule: AudienceRule,
  ruleIndex: number,
): PrefilterLookup | { readonly error: string } {
  if (rule.op !== 'eq' && rule.op !== 'in') {
    /* The registry offers only `eq`/`in`, so this is unreachable today. It is
       here because the day someone adds an operator to the entry, an unplanned
       rule would otherwise reach the filter builder still holding TAG ids in a
       clause that reads member ids — a campaign that silently matches nobody.
       เพิ่ม op ในทะเบียนวันไหน ต้องมาสอนไฟล์นี้ด้วย ไม่งั้นเงียบ ๆ ไม่โดนใคร. */
    return { error: `"${String(rule.op)}" cannot be used on a customer tag` };
  }

  const raw = rule.op === 'in' ? rule.value : [rule.value];
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'this customer-tag condition names no tag' };
  }
  /* [FIX-20260828-TAGOPMISMATCH] `eq` holding a LIST gets its own sentence.
   *
   * WHY: `eq` wraps its value once (line above), so a rule saved as
   * `{op:'eq', value:['id1','id2']}` arrives here as `[['id1','id2']]` — one
   * entry that is an ARRAY. The id check below then reports "must name a tag by
   * its id", which is FALSE and sends the reader hunting for a bad id. Seen on
   * stg 28/08 with two ids that were both valid and both present in `tags`; the
   * real fault was the operator, and the message hid it.
   *
   * This does NOT accept the rule — a silent reinterpretation as `in` would
   * widen the audience without anyone asking for it, which is the one thing
   * this whole resolver exists to prevent. It refuses, and says what to change.
   * ข้อความต้องบอกความจริง · ไม่ใช่กลบด้วยการเดาเจตนา
   * revert: delete this block — the id check below reports it as before. */
  if (rule.op === 'eq' && Array.isArray(rule.value)) {
    return {
      error:
        `"eq" holds one tag, but this condition names ${rule.value.length} — ` +
        'use "in" for more than one',
    };
  }
  if (raw.length > MAX_TAGS_PER_RULE) {
    return {
      error:
        `this customer-tag condition names ${raw.length} tags, and at most ` +
        `${MAX_TAGS_PER_RULE} are allowed in one condition`,
    };
  }

  const tagIds: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || !HEX24.test(v)) {
      return {
        error:
          'a customer-tag condition must name a tag by its id — ' +
          'refusing rather than sending to a wider list than intended',
      };
    }
    // Deduped: two copies of one tag would double the join rows for nothing.
    if (!tagIds.includes(v)) tagIds.push(v);
  }

  return {
    ruleIndex,
    model: CUSTOMER_TAG_MODEL,
    filter: { tag_id: { $in: tagIds } },
    projection: { member_id: 1, _id: 0 },
    memberIdField: 'member_id',
    describe:
      tagIds.length === 1
        ? `customer tag ${tagIds[0]}`
        : `${tagIds.length} customer tags`,
  };
}

export const customerTagPrefilter: AudiencePrefilterResolver = {
  key: CUSTOMER_TAG_KEY,
  planLookup,
};
