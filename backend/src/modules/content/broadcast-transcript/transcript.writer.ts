/**
 * [FEAT-20260824-BCASTTRANSCRIPT] A multicast lands in the customer's chat, the
 * way the bot's own messages do.
 * ===========================================================================
 * Owner, 24/08: *"กรณี multicase เราต้องเก็บข้อความเข้า chatmessage ด้วย = sender
 * เหมือน bot ทุกอย่าง ห้ามพัง + มี divider multicast หลังข้อความนั้น"* ·
 * *"ห้ามเด้งรัวๆ เพราะ multicast เป็นร้อยคนมันเด้งรัวๆ รำคาญพอดี"*.
 *
 * ── WHAT MAKES THIS SAFE, ALL OF IT MEASURED ─────────────────────────────────
 *
 * 🔴 NO SOUND — and NOT because anything here suppresses one. The frontend rule
 *    is `shouldAlert` (`services/chat/ticketAlerts.ts`), whose last line is
 *    `return sender_type === 'customer'`. A row written as `bot` is silent by
 *    the rule that already exists; there is nothing to add and nothing to
 *    special-case. เสียงดังเฉพาะ customer ⇒ bot เงียบอยู่แล้ว ไม่ต้องแก้ FE.
 *
 * 🔴 NO UNREAD BADGE — same shape. `chat-history.service.ts:384` increments
 *    `unread_count` only `if (senderType === 'customer')`.
 *
 * 🔴 NO CORNER TOAST — that fires on `ticket:new` only; the owner removed it for
 *    chat messages on 19/08.
 *
 * 🔴 `last_message` IS NOT TOUCHED, and this is the one that would have hurt.
 *    Unlike the three above, `last_message` is written for EVERY sender with no
 *    condition — so a 100-recipient multicast would jump 100 rooms to the top of
 *    the chat list at once. That is exactly the "เด้งรัวๆ" the owner ruled out.
 *    `ticket-divider.helper.ts` skips it for the same reason, in its own words:
 *    "a divider cannot surface as the newest message in the ticket list".
 *    ⇒ the campaign is IN the conversation, and the list does not reorder.
 *    last_message เขียนทุก sender ไม่มีเงื่อนไข ⇒ แตะเมื่อไหร่ ลิสต์เด้งทั้งแถบ.
 *
 * 🔴 IT NEVER THROWS. A transcript row is a record of something that ALREADY
 *    HAPPENED — the message is on the customer's phone whether or not this
 *    write lands. Failing the send because the copy failed would be the tail
 *    wagging the dog, which is how `ticket-divider.helper.ts` behaves too.
 *    เก็บสำเนาพัง ห้ามทำให้การส่งพัง.
 *
 * ⚠️ THE MODEL COMES FROM THE CONNECTION, not from DI — `chat.module.ts:8`
 *    imports `@/modules/content`, so importing the chat barrel back is a cycle
 *    whose failure mode is an `undefined` schema at boot. The caller passes the
 *    model it already resolves that way for `Member` and `ChatRoom`.
 *
 * ⚠️ BROADCAST IS NOT WRITTEN, ON PURPOSE. `/message/broadcast` carries no
 *    recipient list, so there is no room to write into — LINE fans it out and
 *    never tells us to whom. The `kind` vocabulary already accepts it
 *    (`campaign-tag.ts`) so the day that changes, nothing here has to learn a
 *    new word. ท่อเปิดรอไว้ แต่ยังไม่มีใครเสียบ เพราะ broadcast ไม่รู้ว่าใครได้รับ.
 *
 * revert: delete this folder and the call site in `new-send.service.ts`. The
 * send is untouched — nothing in the send path reads anything this writes.
 */
import type { Model } from 'mongoose';

import { campaignTag, type CampaignKind } from './campaign-tag';

/** The divider variant the frontend styles purple. */
export const MULTICAST_DIVIDER_VARIANT = 'multicast';

/** One recipient's room, as the send path already knows it. */
export interface TranscriptTarget {
  /** `chat_rooms._id`. The rows are keyed to the ROOM, never to the member. */
  readonly roomId: unknown;
  readonly hookId: unknown;
  /**
   * [FIX-20260831-PERSONALCOPY] THIS room's own copy, when it differs from the
   * run-wide one. A `personal` multicast substitutes per RECIPIENT, so one
   * blob cannot describe every room — these carry each person's real card.
   * Absent (every plain caller) ⇒ the input-level `content`/`flexJson` blob is
   * used exactly as before; both fields OPTIONAL so existing callers compile
   * and behave byte-identically. Same rules as the blob: `content` a string
   * always, the card in `flexJson`.
   */
  readonly content?: string;
  readonly flexJson?: unknown;
}

export interface TranscriptInput {
  readonly kind: CampaignKind;
  readonly jobId?: string;
  readonly jobName?: string;
  readonly runId?: string;
  /** What was sent: the same `message_type` a bot row uses. */
  readonly messageType: string;
  /**
   * The message's TEXT. For `text` it is the message; for `image` the URL; for
   * `flex` a short label — the card itself goes in `flexJson`.
   *
   * 🔴 ALWAYS A STRING. Verified against all 1,018 rows on this database: every
   *    `message_type` — text, image, flex, sticker, divider, follow — stores a
   *    STRING here, with no exception. A flex row reads `"[Flex] <name>"`.
   *    This function first wrote the card OBJECT here and it CRASHED the chat
   *    page: `ChatRoomView.tsx:1427` calls `msg.content.includes(...)`, which is
   *    not a function on an object, and React unmounted the whole conversation.
   *    ทุกแถวเก็บ content เป็น string เสมอ — ยัด object ลงไป หน้าแชทพังทั้งหน้า.
   */
  readonly content: string;
  /**
   * The flex card itself, for `message_type: 'flex'` only.
   *
   * 🔴 IT LIVES IN `metadata.flex_json`, NOT in `content` and NOT in
   *    `raw_content`. That is where the renderer looks:
   *    `ChatRoomView.tsx:739` — `if (data.message_type === 'flex' &&
   *    data.metadata?.flex_json)`. A real row confirms it; `raw_content` is
   *    `null` on every flex row. ตัวการ์ดอยู่ metadata.flex_json ไม่ใช่ content.
   */
  readonly flexJson?: unknown;
  readonly targets: readonly TranscriptTarget[];
}

/**
 * Write one message row + one divider row per recipient room.
 *
 * Returns how many ROWS were inserted, or `null` when the write could not be
 * attempted at all. `0` means "there was nothing to write" — a different fact
 * from "it failed", and the two must not be collapsed. absent ≠ 0.
 */
export async function writeCampaignTranscript(
  chatMessageModel: Model<Record<string, unknown>>,
  input: TranscriptInput,
): Promise<number | null> {
  const targets = input.targets.filter((t) => t?.roomId);
  if (targets.length === 0) return 0;

  const tag = campaignTag({
    kind: input.kind,
    job_id: input.jobId,
    job_name: input.jobName,
    run_id: input.runId,
  });

  const label = input.jobName?.trim();

  /**
   * [FIX-20260824-DIVIDERORDER] The divider must land AFTER the message, and
   * "after" has to be written down rather than hoped for.
   *
   * 🔴 LETTING MONGOOSE STAMP BOTH WAS NOT ENOUGH. Its timestamps came out 1ms
   *    apart — technically ordered, and the chat view sorts on
   *    `created_at` — but one millisecond survives nothing: any layer that
   *    formats, rounds or groups to the second turns it into a tie, and a tie
   *    falls back to whatever order the API happened to return. Measured 24/08:
   *    the divider rendered ABOVE its own card.
   *    ห่างกัน 1ms = เสมอกันทันทีที่มีใครปัดเป็นวินาที แล้วลำดับก็พลิก.
   *
   * ⚠️ A WHOLE SECOND, and the timestamps are set HERE rather than left to the
   *    schema, so the gap is a property of this writer instead of a side effect
   *    of how fast two inserts happen to be built.
   *
   * ⚠️ The message keeps the real instant; only the divider is nudged. It is a
   *    marker about the message, not an event of its own, so a second of drift
   *    on it is meaningless — a second of drift on the MESSAGE would not be.
   *    ขยับแค่เส้นคั่น ไม่ขยับตัวข้อความ.
   */
  const sentAt = new Date();
  const dividerAt = new Date(sentAt.getTime() + 1000);

  const rows: Record<string, unknown>[] = [];

  for (const target of targets) {
    /* [FIX-20260831-PERSONALCOPY] the target's own copy wins; the run-wide blob
       is the fallback — never the other way round, and never blank. */
    const rowContent = target.content ?? input.content;
    const rowFlex =
      target.flexJson !== undefined ? target.flexJson : input.flexJson;
    /* The message itself — field for field the shape a real bot row has, so the
       transcript renders it with the code that already exists. */
    rows.push({
      room_id: target.roomId,
      hook_id: target.hookId,
      channel_type: 'line',
      is_push: true,
      is_admin: false,
      /* 🔴 `bot`, and the enum is why: `sender_type` accepts three values and a
         row outside them fails to LOAD. It is also what keeps this silent. */
      sender_type: 'bot',
      sender_id: null,
      message_type: input.messageType,
      content: rowContent,
      provider_msg_id: null,
      reply_token: null,
      created_at: sentAt,
      updated_at: sentAt,
      metadata: {
        ...tag,
        /* Only for a flex row, and only when there is a card — the renderer
           checks this key's presence, so writing `undefined` for a text message
           would be a key that means nothing. */
        ...(rowFlex === undefined ? {} : { flex_json: rowFlex }),
      },
    });

    /* The divider that says where it came from. AFTER the message, per the
       owner: "มี divider multicast หลังข้อความนั้น". */
    rows.push({
      room_id: target.roomId,
      hook_id: target.hookId,
      channel_type: 'line',
      is_push: true,
      is_admin: false,
      sender_type: 'bot',
      sender_id: null,
      message_type: 'divider',
      /* The text is the fallback an older frontend shows before it learns the
         variant — readable on its own, never a bare code.
         ข้อความสำรอง ต้องอ่านรู้เรื่องเอง เผื่อ FE ยังไม่รู้จัก variant นี้. */
      content: label ? `Multicast จาก job "${label}"` : 'Multicast',
      provider_msg_id: null,
      reply_token: null,
      /* One second AFTER the message — see the note above the constants. */
      created_at: dividerAt,
      updated_at: dividerAt,
      metadata: {
        /* `metadata.variant` is what drives colour and icon
           (`ChatRoomView.tsx` → `DIVIDER_STYLES`); an unknown variant renders
           grey rather than breaking. */
        variant: MULTICAST_DIVIDER_VARIANT,
        ...tag,
      },
    });
  }

  try {
    /* One insert for the whole round. `ordered: false` so one bad row cannot
       discard the rest — a transcript that is missing one line beats a
       transcript that is missing the round. หนึ่งแถวเสีย ห้ามล้มทั้งชุด. */
    const written = await chatMessageModel.insertMany(rows, { ordered: false });
    return Array.isArray(written) ? written.length : rows.length;
  } catch {
    /* Deliberately swallowed — see the header. The caller logs; the send stands. */
    return null;
  }
}
