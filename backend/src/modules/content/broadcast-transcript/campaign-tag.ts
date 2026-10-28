/**
 * [FEAT-20260824-BCASTTRANSCRIPT] The mark that says "this row came from a
 * campaign", and which kind.
 * ===========================================================================
 * Owner, 24/08: *"ทำ flag ไว้ด้วยว่า chat msg นี้คือ multi (หรืออาจจะมี boardcast อีกใน
 * อนาคต แต่ตอนนี้ boardcast เรายังไม่เก็บเข้ามา แต่ต้องมีท่อต่อไว้รอเสียบ) ห้ามกระทบ"*.
 *
 * 🔴 IT RIDES IN `metadata`, WHICH COSTS NO SCHEMA CHANGE. `chat-message.schema.ts`
 *    declares `metadata` as `Mixed` with `default: {}`, so a new key is additive
 *    by construction: existing rows keep reading, nothing migrates, and the
 *    revert is deleting the writer. A top-level column would have been a schema
 *    change on the busiest collection in the system for a label.
 *    metadata เป็น Mixed อยู่แล้ว ⇒ เพิ่มคีย์ได้เลย ไม่ต้องแก้ schema ไม่ต้อง migrate.
 *
 * 🔴 `sender_type` CANNOT CARRY IT. That field has a real enum
 *    (`['customer','bot','admin']`, `chat-message.schema.ts:56`), and a row
 *    holding a value outside an enum fails to LOAD — one bad row would take the
 *    whole transcript query with it. A campaign message is written as `bot`,
 *    which is also what keeps it silent (see the writer).
 *    sender_type มี enum ⇒ ค่าใหม่ = แถวนั้นอ่านไม่ขึ้นทั้ง query.
 *
 * ⚠️ THE PIPE FOR `broadcast` IS OPEN AND DELIBERATELY UNUSED. Nothing writes it
 *    today — a `/message/broadcast` send has no recipient list, so there is no
 *    room to write a row into. The kind is part of the vocabulary anyway so that
 *    the day it becomes storable, readers and the frontend already understand
 *    the value instead of rendering an unknown tag grey.
 *    เปิดค่าไว้รอ ยังไม่มีใครเขียน — วันที่เก็บได้ ฝั่งอ่านจะรู้จักอยู่แล้ว.
 */

/** Every campaign kind a transcript row may be marked with. */
export const CAMPAIGN_KINDS = ['multicast', 'broadcast'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

/** The key inside `metadata` that holds the mark. One key, one object. */
export const CAMPAIGN_META_KEY = 'campaign';

/**
 * What a reader gets. Every field is optional on the READ side because a row
 * written by an older build may carry fewer of them — a missing job name must
 * render as "a campaign", never as a crash.
 */
export interface CampaignTag {
  readonly kind: CampaignKind;
  /** The `broadcasts._id` this row came from, as a string. */
  readonly job_id?: string;
  /** The campaign's name AT SEND TIME, denormalised on purpose. */
  readonly job_name?: string;
  /** The run that produced it, so a transcript row joins to a history row. */
  readonly run_id?: string;
}

/**
 * Build the `metadata` fragment for a campaign row.
 *
 * ⚠️ THE NAME IS COPIED, NOT REFERENCED, and that is the same call the campaign
 * list already makes for `assign_group.name`: a transcript is a historical
 * record, so it must still read correctly after the campaign is renamed or
 * deleted. Joining at read time would make an old conversation change its own
 * history. ชื่อ ณ ตอนส่ง ต้องไม่เปลี่ยนตามการแก้ชื่อภายหลัง.
 *
 * ⚠️ Absent fields are OMITTED rather than written as `null`, so a row carries
 * only what was actually known. absent ≠ null.
 */
export function campaignTag(tag: CampaignTag): Record<string, unknown> {
  const text = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

  const id = text(tag.job_id);
  const name = text(tag.job_name);
  const run = text(tag.run_id);

  return {
    [CAMPAIGN_META_KEY]: {
      kind: tag.kind,
      ...(id === undefined ? {} : { job_id: id }),
      ...(name === undefined ? {} : { job_name: name }),
      ...(run === undefined ? {} : { run_id: run }),
    },
  };
}

/**
 * Read the mark off a row, or `null` when there is none.
 *
 * 🔴 A ROW WITH NO MARK IS AN ORDINARY MESSAGE, and every message written before
 * today is in that state. This must never guess: answering a kind for an
 * unmarked row would relabel years of ordinary conversation as campaign traffic.
 * ไม่มี mark = ข้อความปกติ ห้ามเดา.
 */
export function readCampaignTag(metadata: unknown): CampaignTag | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const raw = (metadata as Record<string, unknown>)[CAMPAIGN_META_KEY];
  if (typeof raw !== 'object' || raw === null) return null;

  const row = raw as Record<string, unknown>;
  const kind = row['kind'];
  if (
    typeof kind !== 'string' ||
    !(CAMPAIGN_KINDS as readonly string[]).includes(kind)
  ) {
    /* A kind nobody wrote on purpose. Refusing beats inventing a category the
       frontend would then have to style. ชนิดที่ไม่รู้จัก = ถือว่าไม่มี mark. */
    return null;
  }

  const text = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

  return {
    kind: kind as CampaignKind,
    job_id: text(row['job_id']),
    job_name: text(row['job_name']),
    run_id: text(row['run_id']),
  };
}

/**
 * [FEAT-20260824-BCASTTRANSCRIPT] The index that serves the OTHER query shape.
 * ===========================================================================
 * Owner, 24/08: *"ปกติต้อง where chat room id ก่อนทุกครั้ง แล้ว where metadata อีกที
 * … เผื่อวันนึงอยากคิวรี่ where meta ตรงๆ ต้องรองรับทั้งสอง"*.
 *
 * TWO SHAPES, AND ONLY ONE OF THEM NEEDS ANYTHING NEW — measured on this
 * database, not reasoned about:
 *
 *   1. `{ room_id, "metadata.campaign.kind" }`  ← the everyday one
 *      Served ALREADY by the existing `room_id_1_created_at_-1`. The explain
 *      shows it bounded to that room's messages (363 examined in the busiest
 *      room here) and the metadata term filtered inside that set. Nothing to
 *      add: a room holds tens to hundreds of rows however big the collection
 *      gets. ⇒ ไม่ต้องมี index ใหม่สำหรับแบบนี้.
 *
 *   2. `{ "metadata.campaign.kind" }` alone     ← someday: "every campaign row"
 *      COLLSCAN today. Measured: 1,058 documents examined to return 40.
 *      With the PARTIAL index below: 40 keys, 40 documents, exactly the answer.
 *
 * 🔴 WHY `partialFilterExpression` IS THE WHOLE POINT, and why this is not debt.
 *    A plain index on this path would hold an entry for EVERY chat message ever
 *    written — millions of nulls, on the busiest-written collection in the
 *    system, so that a rare query could be fast. The partial version indexes
 *    ONLY rows that carry the key: an ordinary message never enters it and
 *    never pays to maintain it, and the index stays proportional to campaign
 *    traffic rather than to the transcript. Measured here: 20 KB for 40
 *    campaign rows, beside 28 KB for the room index that covers all 1,018.
 *    partial ⇒ ข้อความปกติไม่เข้า index ไม่ต้องจ่ายค่าดูแล · โตตามแคมเปญ ไม่โตตามห้องแชท.
 *
 * ⚠️ IT IS NOT CREATED YET, ON PURPOSE. Nothing queries shape 2 today, and an
 *    index that no query uses is itself a cost on every insert. This constant
 *    exists so that the day it IS wanted, the shape is not re-derived under
 *    pressure — it is one command, written down and already measured.
 *    ยังไม่สร้าง เพราะยังไม่มีใครคิวรี่ · แต่รูปแบบเตรียมไว้แล้ว ไม่ต้องมาคิดใหม่ตอนร้อน.
 *
 * To create it (also in the runbook):
 * ```js
 * db.chat_messages.createIndex(
 *   { 'metadata.campaign.kind': 1, created_at: -1 },
 *   { partialFilterExpression: { 'metadata.campaign.kind': { $exists: true } },
 *     name: 'campaign_kind_created' },
 * )
 * ```
 */
export const CAMPAIGN_KIND_PATH = `metadata.${CAMPAIGN_META_KEY}.kind`;

export const CAMPAIGN_INDEX_SPEC = {
  name: 'campaign_kind_created',
  key: { [CAMPAIGN_KIND_PATH]: 1, created_at: -1 },
  partialFilterExpression: { [CAMPAIGN_KIND_PATH]: { $exists: true } },
} as const;
