import { Prop, raw, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type BroadcastDocument = HydratedDocument<Broadcast>;

/**
 * The group a broadcast is attributed to, denormalised.
 *
 * The name is stored beside the id deliberately: a broadcast is a historical
 * record, so the list must still read correctly after the group is renamed or
 * deleted.
 */
export interface BroadcastAssignGroup {
  id?: Types.ObjectId;
  name?: string;
}

/** Who receives the broadcast: everyone, or only the listed groups. */
export interface BroadcastTarget {
  mode?: string;
  group_ids?: Types.ObjectId[];
  /**
   * [FIX-20260824-BCASTRULESSCHEMA] How the conditions below combine.
   *
   * 🔴 THE WHOLE AUDIENCE FEATURE WAS INERT WITHOUT THESE TWO KEYS. Mongoose
   *    silently DROPS any path a schema does not declare, and `target` was
   *    `raw({ mode, group_ids })` — so a job saved with conditions reached Mongo
   *    as `{mode:'all', group_ids:[]}` and then sent to EVERY member of the OA.
   *    `normalizeTarget` was fixed on 23/08 to carry the conditions through, and
   *    `audienceFor` was fixed to read them, but neither could help: there was
   *    nowhere to put them. Measured 24/08 through a real POST — `rules` went in
   *    and the stored document had no `rules` key at all.
   *    normalize ถูก · reader ถูก · แต่ schema ไม่มีที่เก็บ ⇒ หายเงียบทุกครั้ง.
   *
   * ⚠️ ABSENT MEANS "EVERYONE", and that is the behaviour of every campaign that
   *    exists today — `audienceFor` reads a missing list as `[]`, which is a
   *    real answer (a campaign to every follower is a normal thing to want).
   *    So adding these changes nothing for a job that carries neither.
   */
  match?: string;
  /**
   * The conditions themselves. `Mixed`, not a declared sub-shape: the KEYS come
   * from `audience/sources/audience-source.registry.ts` and grow without a
   * schema change, and `buildAudienceFilter` REFUSES a job whose rule it cannot
   * build rather than dropping it. ตัวตรวจจริงอยู่ที่ filter builder ไม่ใช่ที่นี่.
   */
  rules?: unknown[];
}

/** The payload to send. `type` selects which of the three bodies is used. */
export interface BroadcastMessage {
  type?: string;
  text?: string;
  image_url?: string;
  flex_json?: unknown;
  /**
   * [FEAT-20260824-BCASTFLEXID] The card this job SENDS, by reference.
   *
   * 🔴 WHY A REFERENCE AND NOT THE JSON. Every other feature in this codebase
   * that sends a saved card links it by id (notice / payment / handoff); only
   * broadcast held a private copy of `flex_json`. The copy is the defect: an
   * admin fixes a typo in the card library and every campaign built before that
   * keeps sending the typo, with nothing on screen to say why.
   * แก้การ์ดที่ต้นทางแล้ว job เดิมต้องตามด้วย ⇒ เก็บ id ไม่เก็บสำเนา.
   *
   * ⚠️ ABSENT ≠ EMPTY. A row with no `flex_id` is a campaign saved before this
   * feature; it still renders from its own `flex_json` and must keep working.
   * The two are read in that order — id first, raw copy as the fallback — so
   * nothing that sends today changes behaviour.
   *
   * Only `type === 'flex'` uses this. `text` is typed straight into the job and
   * `image_url` is a URL; both stay exactly as they were, by owner's call
   * (24/08: "ยกเว้น text กรอกดิบ เซฟติด job" · "image ก็ทำงานได้แบบเดิม").
   *
   * revert: drop this field and the reader in `broadcast-run/saved-card.ts`.
   * Rows that hold one keep a plain ObjectId that nothing would read.
   */
  flex_id?: Types.ObjectId;
}

/** A one-off message pushed to many recipients across one or more channels. */
@Schema({ collection: 'broadcasts', ...legacyTimestamps })
export class Broadcast {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  /**
   * Which channel accounts send it. Empty means every hook, matching the legacy
   * UI — so no default is declared; Mongoose materialises `[]` for a bare array
   * path exactly as the legacy schema did.
   */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Hook' }] })
  hook_ids?: Types.ObjectId[];

  /**
   * Declared with `raw()` so this stays an inline nested path, not a
   * sub-schema — the two are not interchangeable. An inline path materialises
   * its own defaults on a new document (`assign_group.name` becomes `''`),
   * while an un-defaulted sub-schema stays absent entirely. The legacy schema
   * is inline, so this must be too, or newly written documents differ in shape
   * from the ones already stored.
   *
   * Note that `@Prop({ type: { ... } })` does NOT do this: Mongoose reads the
   * object as a single subdocument type and the nested defaults never apply.
   */
  @Prop(
    raw({
      id: { type: MongooseSchema.Types.ObjectId, ref: 'Group' },
      name: { type: String, default: '' },
    }),
  )
  assign_group?: BroadcastAssignGroup;

  /**
   * [FEAT-20260825-MULTIGROUP] กลุ่มเว็บของ job นี้ — **ตัวหลักตั้งแต่ 25/08**
   *
   * เจ้าของ 25/08: *"กลุ่มเว็บต้อง multi check เลือกได้หลายกลุ่ม fe be รองรับทำงานจริง"*
   *
   * 🔴 อ่านตัวนี้ ไม่ใช่ `assign_group` ข้างบน — ของใหม่ทุกใบเขียนลงที่นี่
   *    `assign_group` **ไม่ใช่ทางหลักแล้ว** มันถูกเขียนคู่ไว้ให้เป็นตัวแรกของลิสต์
   *    เพื่อ **แถวเก่าและตัวกรองเดิมเท่านั้น** ⇒ โค้ดใหม่ที่ต้องรู้ว่า job นี้อยู่กลุ่มไหน
   *    ต้องอ่าน `assign_group_ids` ห้ามอ่าน `assign_group` แล้วคิดว่าครบ
   *    เพราะมันเห็นแค่กลุ่มแรกจากทั้งหมด. ของเดิมเหลือไว้เพื่อความเข้ากันได้ ไม่ใช่เพื่อใช้งาน.
   *
   * 🔴 ทำไมไม่ลบของเดิมทิ้ง — `broadcasts-read.service.ts` กรองการมองเห็นด้วย
   *    `assign_group.id ∈ user.groups` แคมเปญที่เขียนไว้ก่อน 25/08 มีแต่คีย์นั้น
   *    ลบเมื่อไหร่ = **หายจากหน้าจอทุกคนที่ไม่ใช่ superadmin** โดยไม่มี error
   *    ⇒ ตัวกรองอ่านทั้งสองคีย์ด้วย `$or` และแถวเก่าไม่ต้อง migrate
   *
   * ⚠️ ไม่มี `default` — ไม่เคยเลือก (absent) กับ เลือกแล้วเอาออกหมด (`[]`)
   *    เป็นคนละเรื่อง และตัวอ่านต้องแยกออก. absent ≠ [].
   *
   * revert: ลบ Prop นี้ + ตัว `$or` ใน `broadcasts-read.service.ts` + การเขียนคู่ใน
   * `broadcasts.service.ts` ⇒ กลับไปกลุ่มเดียวเหมือนเดิม แถวที่เขียนไปแล้วยังอ่านออก
   * เพราะ `assign_group` ถูกเขียนคู่ไว้ตลอด
   */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group' }],
  })
  assign_group_ids?: Types.ObjectId[];

  /** Inline nested path — see the note on `assign_group`. */
  @Prop(
    raw({
      mode: { type: String, enum: ['all', 'group'], default: 'all' },
      group_ids: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group' }],
      /* [FIX-20260824-BCASTRULESSCHEMA] No `default` and no `enum` on either.
         A default would stamp a value onto every existing campaign the first
         time it is saved; an `enum` on `match` would make a row holding an
         unexpected value fail to LOAD, taking the whole list with it.
         ไม่ใส่ default · ไม่ใส่ enum — แถวเก่าต้องอ่านได้เสมอ. */
      match: { type: String },
      rules: [{ type: MongooseSchema.Types.Mixed }],
    }),
  )
  target?: BroadcastTarget;

  /**
   * Inline nested path — see the note on `assign_group`.
   *
   * The discriminator field is itself named `type`, so the legacy `type: {type:
   * String, ...}` is not a typo: the inner object is the field definition.
   */
  @Prop(
    raw({
      type: { type: String, enum: ['text', 'image', 'flex'], required: true },
      text: { type: String },
      image_url: { type: String },
      flex_json: { type: MongooseSchema.Types.Mixed },
      /* [FEAT-20260824-BCASTFLEXID] No `default`. A default writes itself into
         every existing document the first time that document is saved, which
         would put a value on campaigns nobody edited. Missing must stay
         missing. ห้ามใส่ default — แถวเก่าจะถูกเขียนทับตอนเซฟครั้งแรก. */
      flex_id: { type: MongooseSchema.Types.ObjectId, ref: 'FlexMessage' },
    }),
  )
  message?: BroadcastMessage;

  /**
   * [FEAT-20260822-BCASTCLAIM] `sending` joins the enum so a claimed run can be
   * written at all — `runValidators` rejects a value the enum does not list.
   *
   * ⚠️ IT IS NOT ADDED TO THE API'S OWN LIST. `STATUS_VALUES` in
   * `broadcasts.service.ts` is the gate that `create`, `update` and `list` use,
   * and it deliberately does NOT gain `sending`: an internal, machine-owned
   * state must not be settable by `PUT { status: 'sending' }` from outside.
   * Two sets that differ on purpose — do not "tidy" them into one.
   * สถานะภายใน ห้ามให้ยิงมาจากข้างนอก.
   */
  @Prop({
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'],
    default: 'draft',
  })
  status!: string;

  @Prop({ type: Date })
  scheduled_at?: Date;

  @Prop({ type: Date })
  sent_at?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  created_by?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updated_by?: Types.ObjectId;

  /** Soft delete: set instead of removing the document. */
  @Prop({ type: Date })
  deleted_at?: Date;

  /* ── [FEAT-20260822-BCASTCLAIM] run claim ──────────────────────────────────
   * Three optional columns so two processes cannot send the same job at once.
   * Without them "is this job already running?" is a read followed by a write,
   * and two concurrent sends both read `false` — the customer is messaged twice.
   *
   * 🔑 WHY NO `default` HERE, unlike `handoff-job.schema.ts:194-198`
   * That schema must default `locked_until` to the epoch because its claim
   * query filters on `{$lt: now}`, and a MISSING field never matches a date
   * comparison — a row without it would be invisible to the worker forever.
   * This design does not have that problem, on purpose: a job is claimed by a
   * `status` TRANSITION (`scheduled` → `sending`), which is atomic on its own,
   * and `lease_until` is only ever read for rows THIS code already wrote. So a
   * pre-existing row needs no backfill and no `$exists` branch, and adding
   * these columns changes nothing for any job that exists today.
   * แถวเก่าไม่ต้อง migrate เลย เพราะด่านคือ status ไม่ใช่วันที่.
   *
   * revert: delete these three props and the `broadcast_claim` index below.
   * ───────────────────────────────────────────────────────────────────────── */

  /** When the current run took the job. Absent on every job never claimed. */
  @Prop({ type: Date })
  claimed_at?: Date;

  /**
   * When the claim goes stale and a sweep may take the job back.
   *
   * ⚠️ MUST outlive the longest run the guards allow, or the sweep reclaims a
   * job that is still sending and the customer receives it twice. It is
   * computed from the request budget (`broadcast-send/limits.ts`), never typed
   * by hand.
   */
  @Prop({ type: Date })
  lease_until?: Date;

  /** Which process holds the claim — for the log, and to release only our own. */
  @Prop({ type: String })
  claimed_by?: string;

  /**
   * [FEAT-20260823-BCASTTITLE] The line a recipient sees in their chat list and
   * in the push notification, before they open anything.
   *
   * It becomes the flex `altText`. LINE's own core hardcodes
   * `'Broadcast message'` there (`build-payload.broadcast.ts:38`) and its
   * comment says that quirk is preserved ON PURPOSE, so the value is applied on
   * OUR side after core has built the message — core stays untouched.
   *
   * ⚠️ FLEX ONLY. A text or image message has no `altText`; LINE uses the
   *    content itself as the notification. Setting this on such a job changes
   *    nothing, and the UI should say so rather than pretend.
   *    มีผลเฉพาะการ์ด flex — text/image ใช้เนื้อความเองอยู่แล้ว.
   *
   * 🔴 NO `default:` ON PURPOSE. A schema default is written into every
   *    existing document the first time Mongoose saves it — a data change
   *    wearing a schema change's clothes, exactly the trap `run_count` records.
   *    The fallback (`'line messages'`) is applied at RENDER time instead, so
   *    absent stays absent in the collection.
   *    ไม่ใส่ default เพราะมันจะไปเขียนทับแถวเก่าทุกแถว.
   *
   * revert: delete this `@Prop`. Rows that already carry it become an orphan
   * column nobody reads, and every card falls back to the default line.
   */
  @Prop({ type: String })
  title_detail?: string;

  /**
   * [FEAT-20260823-BCASTSENDKIND] Which LINE endpoint this job goes out on.
   * =========================================================================
   * Approved by the owner 23/08, together with turning the new pipeline on.
   *
   * 🔴 ABSENT IS THE WHOLE POINT — IT MEANS "THE SENDER WE HAVE ALWAYS USED".
   *
   *    Every broadcast that exists today has no value here, and none of them
   *    may change behaviour because a column appeared. So the new pipeline is
   *    reached ONLY by a job that names a kind: `usesNewSendPath` answers
   *    false for absent, for an unknown string, and for anything that is not a
   *    string at all. Turning `BROADCAST_NEW_PATH_ENABLED` on therefore moves
   *    NO existing campaign — it only makes the choice available.
   *    เจ้าของสั่ง: "ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด".
   *
   * 🔴 NO `default:`, for the reason `title_detail` above spells out: a schema
   *    default is written into every existing document on its first save. A
   *    default of `'broadcast'` here would silently opt EVERY stored campaign
   *    into the new sender the next time anyone edited it.
   *    ใส่ default = ทุกแถวเก่าถูกย้ายท่อโดยไม่มีใครสั่ง.
   *
   * VALUES — validated on the way in, never trusted from the row:
   *   · `'broadcast'` — one request, LINE fans out to every follower. No
   *     recipient list, so no per-person value can be filled.
   *   · `'multicast'` — up to 500 named ids per request; an audience filter
   *     can narrow it and per-person values become possible.
   *
   * ⚠️ NOT AN ENUM AT THE SCHEMA LEVEL. A stored row that predates a value, or
   *    one written by a script, would fail to LOAD on an enum mismatch — the
   *    read throws and the campaign becomes unopenable. The check belongs
   *    where a bad value can still be reported (`ensureValidSendKind`), not
   *    where it can only break a read. enum ที่สคีมา = แถวเก่าอ่านไม่ขึ้น.
   *
   * revert: delete this `@Prop`. Rows carrying it become an orphan column and
   * every job falls back to the sender it used before — no data to undo.
   */
  @Prop({ type: String })
  send_kind?: string;

  /**
   * [FEAT-2708-GUARDWINDOW] How fresh a follow-up stamp must be, in hours.
   * =========================================================================
   * Owner, 27/08 (งาน 4.1). Whole hours 1-72; governs the three follow-up
   * audience sources via `guard-window.policy.ts` — the filter turns each of
   * their clauses into "stamped within the last N hours of the send round".
   *
   * 🔴 ABSENT = NO GUARD, which is what every campaign stored before 27/08
   *    has and keeps: no default, no backfill, and the send path attaches
   *    nothing when the column is missing — the query stays byte-identical
   *    (`new-send.service.ts`, spec G1 pins it). Range checked at the DTO and
   *    again in `ensureValidGuardWindow` (the message layer), never here —
   *    a schema-level constraint would make old rows unreadable, the exact
   *    trap `send_kind` above documents.
   *
   * revert: delete this `@Prop`. Rows carrying it become an orphan column and
   * every job simply loses its freshness guard — no data to undo.
   */
  @Prop({ type: Number })
  guard_window_hours?: number;

  /**
   * [FEAT-20260823-BCASTCARDTYPE] Does every recipient get the SAME card?
   * =========================================================================
   * Approved by the owner 23/08, the last column the send matrix was waiting
   * for. `send_kind` picks the endpoint; this picks the row.
   *
   * 🔴 ABSENT = `'plain'` = ONE card for everybody, which is what every
   *    campaign has always done. Nothing changes for a job that does not name
   *    a type, exactly as `send_kind` and `next_run_at` behave.
   *    เจ้าของสั่ง: "ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด".
   *
   * VALUES:
   *   · `'plain'`    — one rendered card, sent to everyone in the chunk
   *   · `'personal'` — rendered per recipient, so `{{member.*}}` and
   *     `{{profile.*}}` carry that person's real values
   *
   * 🔴 `'personal'` COSTS ONE LINE REQUEST PER RECIPIENT
   *    (`send-matrix.registry.ts` → `recipientsPerRequest: 1`), so the
   *    recipient ceiling IS the request budget. That is not a limitation to
   *    work around — a card whose body differs per person cannot ride one
   *    request, by LINE's design. It is also why `broadcast:personal` is
   *    `allowed: false`: `/message/broadcast` has no recipient list at all.
   *    การ์ดรายคน = ยิงทีละคน ⇒ ยิ่งคนเยอะยิ่งช้า ต้องรู้ก่อนเลือก.
   *
   * ⚠️ NO `default:`, and NOT an enum — the same two reasons `send_kind`
   *    above spells out: a default rewrites every stored document on its first
   *    save, and a schema enum makes a row with an unexpected value fail to
   *    LOAD rather than fail to validate.
   *
   * revert: delete this `@Prop`. Every job falls back to one card for
   * everybody — no data to undo.
   */
  @Prop({ type: String })
  card_type?: string;

  /**
   * [FEAT-20260823-BCASTDESC] What this campaign is for, in the admin's words.
   * =========================================================================
   * `name` has always been required and is what every list, log and history
   * row shows — but a name is a label, and months later "promo 3" answers
   * nothing. This is the room to say WHY the campaign exists, which is the
   * question anyone auditing a send actually has.
   * ชื่อไว้เรียก · คำอธิบายไว้ตอบว่าทำไปทำไม.
   *
   * 🔴 NO `default:` and not required — every campaign stored before 23/08 has
   *    none, and none of them may change because a column appeared. Absent
   *    means "nobody wrote one", which is a normal state and not an error.
   *
   * ⚠️ FREE TEXT, capped only in length. It is never rendered into a card and
   *    never reaches LINE — it is an internal note, so the strict rules
   *    `title_detail` carries would be ceremony here. ไม่เคยส่งออกไปหาลูกค้า.
   *
   * revert: delete this `@Prop`. Rows carrying it become an orphan column.
   */
  @Prop({ type: String })
  description?: string;

  /**
   * [FEAT-20260825-BCASTDIRECTTICKET] เปิดเคสให้คนที่ได้รับ multicast ใบนี้ไหม
   * ===========================================================================
   * ติ๊กแล้ว: หลัง multicast ส่งถึงใครสำเร็จ ระบบจะ **เปิดเคสรอไว้** ให้คนนั้น
   * โดยใช้ `description` (ช่อง "แคมเปญนี้ทำเพื่ออะไร") เป็นเหตุผลของเคส
   * ⇒ ข้อความเดียว ใช้สองที่ ไม่ต้องพิมพ์ซ้ำ และไม่มีทางเขียนไม่ตรงกัน
   *
   * ⭐ **ไม่มี `default:` และเป็น optional** — ตั้งใจให้เหมือน `send_kind` /
   * `next_run_at`: แถวเก่าที่ไม่มีคอลัมน์นี้อ่านได้เหมือนเดิมทุกแถว ไม่ต้อง
   * migrate อะไรเลย และ "ไม่มีค่า" กับ "ปิดไว้" แปลว่าเดียวกันคือ **ไม่เปิดเคส**
   * ⇒ ฟีเจอร์นี้ seamless โดยโครงสร้าง ไม่ใช่โดยความระมัดระวัง
   *
   * ⚠️ **MULTICAST เท่านั้น** — `/message/broadcast` ไม่มีรายชื่อผู้รับ LINE
   * กระจายเองและไม่บอกว่าใครได้รับ ⇒ ไม่มีใครให้เปิดเคสให้ · ตัวบังคับจริงอยู่ที่
   * ฝั่งรัน (`broadcast-follow-up/open-direct-ticket-on-multicast.ts`) ซึ่งอ่าน
   * เฉพาะรายชื่อที่ยิงถึงจริง ⇒ ต่อให้ติ๊กไว้กับงาน broadcast ก็ไม่มีอะไรเกิดขึ้น
   * ⚠️ ฝั่ง FE ซ่อนช่องนี้เมื่อไม่ใช่ multicast แต่ **นั่นคือความสะดวก ไม่ใช่ตัวกัน**
   *
   * revert: ลบ `@Prop` นี้ + บล็อกใน `new-send.service.ts` + โมดูล
   *         `open-direct-ticket-on-multicast.ts` + ช่องติ๊กฝั่ง FE
   *         แถวที่เคยมีค่าจะกลายเป็นคอลัมน์กำพร้า ซึ่งไม่มีใครอ่าน
   */
  @Prop({ type: Boolean })
  is_direct_ticket?: boolean;

  /* ── [FEAT-20260825-BCASTSKIPASSIST] ข้ามคนที่แอดมินกำลังคุยอยู่ ──────────
   * ติ๊ก ⇒ งานใบนี้จะไม่ส่งให้คนที่ห้องของเขา `assist_status: true`
   * ไม่ติ๊ก / ไม่มีคีย์ ⇒ ส่งทุกคนเหมือนเดิมทุกประการ
   *
   * ⚠️ **assist เป็นของ "ห้อง" ไม่ใช่ของ "คน"** — `chat_rooms.assist_status`
   *    ผูกกับคู่ (`hook_id`, `line_user_id`) ⇒ คนคนเดียวอาจถูกดูแลอยู่ที่ OA
   *    หนึ่งและไม่ถูกดูแลที่อีก OA หนึ่ง · จึงไม่มีคอลัมน์ assist บน `members`
   *    และงานนี้**ไม่**สร้างขึ้นใหม่ (denormalize = ต้องมีคนคอยซิงก์ = หนี้)
   * ⚠️ ขอบเขตที่เลือก: ถูกดูแลอยู่ที่ OA **ใด OA หนึ่งของงานใบนี้** = ข้ามทั้งใบ
   *    เหตุผล: ส่งพลาดเข้าไปในห้องที่คนกำลังคุยอยู่ คือความเสียหายที่เจ้าของ
   *    ขอให้กัน · ข้ามเกินไปหนึ่งคนเป็นผลเสียที่เบากว่ามาก
   *    ปรับได้จุดเดียวที่ `audience/skip-assist.policy.ts`
   * ⚠️ **MULTICAST เท่านั้น** ด้วยเหตุผลเดียวกับ `is_direct_ticket` ข้างบน —
   *    `/message/broadcast` ไม่ได้เลือกผู้รับจากตัวกรองนี้เลย
   *
   * revert: ลบ `@Prop` นี้ + `skip-assist.policy.ts` + บล็อกใน
   *         `new-send.service.ts` + ช่องติ๊กฝั่ง FE
   *         แถวที่เคยมีค่าจะกลายเป็นคอลัมน์กำพร้าที่ไม่มีใครอ่าน
   */
  @Prop({ type: Boolean })
  skip_assist?: boolean;

  /* ── [FEAT-20260822-BCASTSCHEDULE] repeat scheduling ───────────────────────
   * Four optional columns, approved by the owner on 22/08 after the seamless
   * dive (แผน §PH.31). Measured before adding: on dev, `broadcasts` holds 0
   * rows and none of these four names exists on any document, so there is no
   * collision and nothing to migrate.
   *
   * 🔴 WHY `next_run_at` EXISTS AT ALL, rather than reusing `scheduled_at`:
   *    `scheduled_at` is WHAT THE ADMIN TYPED. Overwriting it after each round
   *    destroys the setting the moment the first round fires — §11b.3.1 records
   *    exactly that trap. So the admin's value stays put and the scheduler
   *    keeps its own cursor. ค่าที่แอดมินตั้ง ห้ามถูกเขียนทับด้วยค่าที่ระบบคำนวณ.
   *
   * ⚠️ ALL FOUR ARE OPTIONAL WITH NO DEFAULT, on purpose. A row without
   *    `next_run_at` is NOT DUE (`broadcast-schedule/due-query.ts` fails
   *    closed), so every job that existed before this feature keeps behaving
   *    exactly as it did — it can only be sent by somebody pressing send.
   *    ไม่มีค่า = ไม่ถึงกำหนด ⇒ ของเก่าไม่ถูกยิงเองแน่นอน.
   *
   * revert: delete these four `@Prop`s and the `broadcast_due` index below.
   * Rows already carrying the columns become orphan fields nobody reads — no
   * migration needed to undo, and no behaviour depends on them being present.
   */

  /** The repeat rule the admin set. Absent ⇒ this job runs once, as before. */
  @Prop({ type: MongooseSchema.Types.Mixed })
  schedule?: Record<string, unknown>;

  /**
   * When the NEXT round is due — the scheduler's own cursor.
   *
   * ⚠️ Never the same field as `scheduled_at`; see the block above.
   */
  @Prop({ type: Date })
  next_run_at?: Date;

  /** When the last round actually started. For the log and for "did it run?". */
  @Prop({ type: Date })
  last_run_at?: Date;

  /**
   * Rounds finished so far.
   *
   * ⚠️ No `default: 0`. A default would REWRITE every existing document the
   * first time Mongoose saved it, which is a data change dressed as a schema
   * change. Absent means "never ran", and the reader treats it as 0.
   * ไม่ใส่ default เพราะมันจะไปเขียนทับแถวเก่าทุกแถว.
   */
  @Prop({ type: Number })
  run_count?: number;
}

export const BroadcastSchema = SchemaFactory.createForClass(Broadcast);

BroadcastSchema.index({ status: 1, created_at: -1 });
BroadcastSchema.index({ 'target.mode': 1 });
BroadcastSchema.index({ hook_ids: 1, created_at: -1 });

/**
 * [FEAT-20260822-BCASTCLAIM] The sweep that finds runs whose claim went stale.
 *
 * `partialFilterExpression` keeps this index to the handful of jobs that are
 * in flight right now rather than every broadcast ever created — the same shape
 * `handoff-job.schema.ts:280-288` uses and for the same reason.
 *
 * ⚠️ Only `sending` is indexed. A job in any other state is not claimed, so it
 * has nothing for the sweep to find, and no row that existed before this
 * feature can be in `sending` at all — which is why no backfill is needed.
 *
 * revert: drop this index and the three claim columns above.
 */
BroadcastSchema.index(
  { status: 1, lease_until: 1 },
  {
    name: 'broadcast_claim',
    partialFilterExpression: { status: 'sending' },
  },
);

/**
 * [FEAT-20260822-BCASTSCHEDULE] The index the due-scan rides.
 *
 * 🔴 PARTIAL, AND THAT IS THE WHOLE POINT. `mongo.module.ts` does not set
 * `autoIndex: false`, so Mongoose builds indexes at boot — on a collection with
 * history that is CPU and a slower start. Restricting this one to jobs that are
 * actually waiting keeps it tiny however long the history gets, because the
 * number of campaigns pending at any moment is small and does not grow with the
 * archive. Same shape and same reason as `broadcast_claim` above.
 *
 * Key order is ESR: `status` is the equality, `next_run_at` is BOTH the range
 * and the sort, so the scan is served with no in-memory SORT stage.
 *
 * ⚠️ Without it the scan is not a table scan — `{status:1, created_at:-1}`
 * still bounds it to `scheduled` rows — but it FETCHes them all and SORTs in
 * memory: 34 ms per 50,000 rows (measured, §11b.5) every minute, to return
 * nothing. That is the second reason the scheduler ships with its switch off.
 *
 * revert: drop this index; the scan keeps working, more slowly.
 */
BroadcastSchema.index(
  { status: 1, next_run_at: 1 },
  {
    name: 'broadcast_due',
    partialFilterExpression: { status: 'scheduled' },
    background: true,
  },
);
