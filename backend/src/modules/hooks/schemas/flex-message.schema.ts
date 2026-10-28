import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type FlexMessageDocument = HydratedDocument<FlexMessage>;

/**
 * A content slot a card declares for itself.
 *
 * `no` is a permanent slot number, deliberately not the array index: deleting
 * slot 2 leaves [1, 3] and a new slot reclaims 2. Were it index-derived,
 * deleting slot 2 would renumber slot 3 and a card written with
 * `{{custom_content_3}}` would silently read a different slot with no error.
 *
 * `_id: false` — this is human-authored config read with the parent document,
 * never referenced per row.
 */
@Schema({ _id: false })
export class FlexContentTag {
  @Prop({ type: Number, required: true })
  no!: number;

  @Prop({ type: String, default: '' })
  label!: string;

  @Prop({ type: String, default: '' })
  hint!: string;
}

const FlexContentTagSchema = SchemaFactory.createForClass(FlexContentTag);

/**
 * A reusable Flex card template.
 *
 * `content_json` holds the raw provider payload, so it stays Mixed — pinning a
 * shape here would reject cards the provider already accepts.
 */
@Schema({ collection: 'flex_messages', ...legacyTimestamps })
export class FlexMessage {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  content_json!: unknown;

  /**
   * `slip` | `normal` | `profile` — decides which variable set the editor
   * offers.
   *
   * The default is `slip`, not `normal`, on purpose: every card that predates
   * this field is a slip card, and the frontend reads a missing value as `slip`
   * too. Changing the default would silently reclassify existing cards.
   */
  @Prop({ type: String, default: 'slip' })
  flex_type!: string;

  /**
   * [FEAT-20260829-FLEXMENUTYPE] which menu a `flex_type: 'menu'` card belongs to.
   *
   * `main` or `sub` today; the list is append-only like the type list itself.
   *
   * ⚠️ MEANINGFUL ONLY WHEN `flex_type === 'menu'`. Every other type stores null,
   * enforced on write, so a stray value on a slip card can never make it look
   * like a menu card to a future query.
   *
   * DATA EFFECT — none. `default: null` applies at insert, so the 55 cards that
   * already exist keep NO field at all and read as null. No migration, no
   * backfill, and nothing outside the menu type ever reads it.
   *
   * revert: delete this prop. The column can stay behind harmlessly — it is null
   * on every row that predates the feature.
   */
  @Prop({ type: String, default: null })
  flex_sub_type!: string | null;

  /**
   * [FEAT-20260829-FLEXMENUSLUG] optional free-text label for a menu card.
   *
   * ⚠️ MEANINGFUL ONLY WHEN `flex_type === 'menu'`, enforced on write.
   * ⚠️ Optional and blank-able: the form may be left empty and the value stays
   * **null**. No default is invented — a card that was never given one must be
   * indistinguishable from one that never will be.
   *
   * DATA EFFECT — none. `default: null` applies at insert, so every existing row
   * keeps NO field and reads as null. No migration, no backfill.
   *
   * revert: delete this prop; the column can stay behind, null everywhere.
   */
  @Prop({ type: String, default: null })
  flex_slug!: string | null;

  @Prop({ type: [FlexContentTagSchema], default: [] })
  content_tags!: FlexContentTag[];

  /**
   * Which fetched data block this card reads from, stored as a *role* rather
   * than a path or key — paths and keys are renameable and would break
   * silently, roles are stable and shared with the custom-tool layer.
   *
   * `null` means `profile`, which is the pre-feature behaviour.
   */
  @Prop({ type: String, default: null })
  source_role?: string | null;

  /** Multi-source successor to `source_role`; resolution order is
   * `source_roles` → `source_role` → `['profile']`. */
  @Prop({ type: [String], default: [] })
  source_roles!: string[];

  /**
   * Reference tag of the card (`flex_m00001`), allocated from a counter.
   *
   * Deliberately NOT unique: most cards leave it null, and multiple nulls
   * collide under a unique index. Uniqueness comes from the atomic counter
   * increment instead.
   */
  @Prop({ type: String, default: null, index: true })
  flex_tag?: string | null;

  /**
   * Pre-migration copy of `content_json`, left by the flex-namespace script.
   *
   * Not declared in the legacy Mongoose model — the script writes it through
   * the raw driver — but present on real cards, and it is the script's own
   * rollback source (revert restores it, then `$unset`s it). Declared here
   * because an undeclared field is dropped on any hydrate-then-save, which
   * would destroy the only copy of the original card content.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  flex_ns_backup?: unknown;

  /**
   * ==== [FEAT-20260810-CARDTICKET] open a direct ticket when THIS card replies ====
   *
   * OPT-IN, PER CARD. `false`/absent ⇒ nothing happens at all: the reply is sent and
   * no ticket is opened, exactly as before this field existed. Every card in the
   * database reads as `false`, so there is no migration and no behaviour change
   * until an admin ticks it. ไม่ตั้ง = ไม่มีอะไรเกิดขึ้น.
   *
   * WHEN IT FIRES: after the customer's reply has ACTUALLY been delivered
   * (`webhook.service.ts` `sendPaymentReply`, on the success path only). A reply
   * that failed both the reply token and the push must NOT produce a ticket —
   * promising an admin for a message the customer never got is worse than silence.
   *
   * ⚠️ ONLY meaningful on a card bound through `hook.payment_flex_ids`. A Swiftcheck
   * card (`hook.flex_success` etc.) is sent by `slip-flex.handler.ts`, a path that
   * never reaches `sendPaymentReply`, so a flag there would silently do nothing.
   * ⚠️ It changes NOTHING about the payment flow — not which statement matches, not
   * whether walletpay runs, not the slip lock. It only adds a ticket for an admin.
   * revert: drop both props; stored values are ignored and every state replies as
   * it did before.
   */
  @Prop({ type: Boolean, default: false })
  direct_ticket_on_reply!: boolean;

  /**
   * [FEAT-20260810-CARDTICKET] The sentence an admin reads on the chat divider,
   * which renders as "เคสนี้สร้างโดยระบบ เนื่องจาก <this>"
   * (`omnidesk-console/components/chat/ChatRoomView.tsx:313`).
   *
   * Write it as a REASON, not a code: "ลูกค้าโอนผิดบัญชี" reads correctly in that
   * sentence, `payment:wrong_account` does not. Empty while the flag is on still
   * produces a usable ticket — the caller falls back to a generic reason rather
   * than leaving the divider as "เนื่องจาก -".
   */
  @Prop({ type: String, default: '' })
  direct_ticket_text!: string;

  @Prop({ type: String, default: '' })
  callback_detail!: string;

  @Prop({ type: String, default: '' })
  callback_tag!: string;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group', index: true }],
  })
  group_ids?: Types.ObjectId[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', index: true })
  created_by?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updated_by?: Types.ObjectId;

  /** Soft delete; no default, so an untouched card has no key at all. */
  @Prop({ type: Date, index: true })
  deleted_at?: Date;
}

export const FlexMessageSchema = SchemaFactory.createForClass(FlexMessage);

// Text index backing card search by name.
FlexMessageSchema.index({ name: 'text' });
