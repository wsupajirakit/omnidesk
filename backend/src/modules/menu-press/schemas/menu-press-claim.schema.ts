/**
 * ==== [FEAT-20260902-MENUPRESSONCE] one press per button per rendered card ====
 *
 * ONE ROW = ONE PRESS THAT HAS ALREADY HAPPENED. Nothing else lives here: no
 * history, no analytics, no counters to read back. The row's mere existence is
 * the whole answer to "has this button on this card already been pressed by this
 * person".
 *
 * 🔴 `_id` IS THE LOCK, NOT A LABEL. It is the composite key, so the unique
 * index Mongo builds for `_id` is the entire concurrency mechanism: two taps
 * racing produce one insert and one E11000, and the loser is the second press.
 * There is no read-before-write anywhere in this feature, and therefore no
 * window between the check and the claim. The same shape the repo already trusts
 * for `handoff_jobs.dedupe_key` and `handoff_callbacks.event_id`.
 *
 * The four parts, and why each is in the key:
 *   render  — WHICH SENT CARD. Minted per rendered message and carried in the
 *             postback payload; without it every render of a card would share
 *             one budget and the button would die permanently after one press.
 *   item    — WHICH BUTTON. The destination already in the payload, so it costs
 *             no extra bytes.
 *   user    — WHICH PERSON. 🔴 This is what makes multicast safe: one rendered
 *             message object goes to N people, so without the person in the key
 *             the first to press would consume everybody's press.
 *   hook    — WHICH OA. The same person on a different OA is a different budget.
 * The ENVIRONMENT is deliberately NOT in the key — prod and dev are separated by
 * being different databases, which is stronger than a string prefix.
 *
 * revert: delete src/modules/menu-press/ and its two wiring lines (see
 * menu-press.module.ts). The collection can be dropped at leisure; nothing else
 * reads it.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { legacyTimestamps } from '@/infra/mongo/schema-options';

@Schema({ collection: 'menu_press_claims', ...legacyTimestamps })
export class MenuPressClaim {
  /**
   * `<render>:<item>:<lineUserId>:<hookId>` — built by `pressClaimId()` so the
   * spelling exists once. Typed as a string because it is composed, not an
   * ObjectId; Mongoose accepts that as long as the schema says so.
   */
  @Prop({ type: String, required: true })
  _id!: string;

  /**
   * 🔴 THE DEADLINE LIVES IN THE ROW, NOT IN THE INDEX — and that is the whole
   * reason this field exists instead of a TTL on `created_at`.
   *
   * Every other TTL index in this repo bakes the number into the index
   * (`handoff-callback.schema.ts`, `webhook-log.schema.ts`), and both carry the
   * warning that changing it in code alone raises `IndexOptionsConflict`, which
   * Mongoose SWALLOWS — the old TTL silently stays in force. The repo even ships
   * two mechanisms to cope with that (`cli/set-log-retention.ts` and
   * `system/webhook-log-ttl.ts`).
   *
   * The owner's requirement is that this window be adjustable — 6 hours today,
   * 1 hour or 10 days tomorrow. With `expireAfterSeconds: 0` the index means
   * "delete when the date in this field passes", so the NUMBER lives in code
   * (`MENU_PRESS_POLICY.ttlSeconds`) and is stamped per row at write time. The
   * index itself never changes ⇒ no collMod, no dropIndex, no drift check.
   *
   * A change applies to NEW rows only. A press already claimed under a 6-hour
   * rule keeps its 6-hour deadline — correct, because editing a config must not
   * retroactively extend a claim somebody already made.
   * เปลี่ยนเลขแล้วมีผลกับของใหม่ · ของเก่าใช้กติกาตอนที่มันเกิด
   */
  @Prop({ type: Date, required: true })
  expires_at!: Date;

  /**
   * How many times this button has been pressed on this card by this person.
   *
   * ⚠️ A COUNT, not a `used: true` flag, and that is the switchability the owner
   * asked for: allowing 3 presses one day is `max: 3` in the policy and NOTHING
   * here. A boolean would have spelled "once" into the storage shape, and going
   * to N would then mean changing the mechanism instead of a number.
   *
   * Written only by `$inc` — never read-then-written, so it cannot lose a race.
   */
  @Prop({ type: Number, required: true, default: 0 })
  presses!: number;
}

export const MenuPressClaimSchema =
  SchemaFactory.createForClass(MenuPressClaim);

/**
 * `expireAfterSeconds: 0` = "expire AT the date in this field".
 * ⚠️ This is the FIRST index of this form in the repo — every existing TTL uses a
 * baked number on `created_at`. The deviation is deliberate (see `expires_at`
 * above); do not "fix" it to match its neighbours.
 *
 * Mongo's reaper runs about every 60 s and yields after 50,000 documents or one
 * second, so rows outlive their deadline by a little. For this feature late is
 * the SAFE direction: a claim that lingers keeps a button correctly spent, while
 * a claim that vanished early would hand the customer a free press.
 */
MenuPressClaimSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 0, background: true },
);
