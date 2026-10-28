/**
 * What "replying to a message" means, as data. UI-ONLY FOR NOW.
 * ===========================================================================
 * The owner asked for the interface first — hover a customer bubble, press
 * Reply, see it quoted above the composer, cancel with ✕ — and for the actual
 * send to come later ("อนาคตจะมี reply · ทำเผื่อไว้แต่ห้ามยัด").
 *
 * So this type is the seam. Everything the UI needs is here and nothing else:
 * no transport, no BE field, no message mutation. When the real feature lands,
 * `send()` reads this object and adds whatever the API wants — and nothing in
 * the UI has to change. ตอนนี้ยังไม่ส่งอะไร แค่เตรียมรูปข้อมูลไว้.
 *
 * revert: delete this file, ReplyPreviewBar.tsx, BubbleReplyButton.tsx, the
 * `onReplyTo` prop in ChatRoomView, and the `replyTo` state in TicketChat.
 */

/**
 * [FEAT-20260820-REPLYHIDDEN] Is the Reply chip shown on a customer bubble?
 *
 * Owner, 2026-08-20: "hidden ปุ่ม reply หน้า chat message ห้ามกระทบ".
 *
 * WHY OFF. The chip is the entrance to a feature that, by this file's own words
 * above, sends nothing yet: pressing it quotes the message over the composer and
 * the quote is dropped when the message goes out. A control that promises
 * something the product cannot do is worse than no control, so it waits here
 * until the transport exists. ยังส่งจริงไม่ได้ ⇒ ยังไม่ให้กดได้.
 *
 * ⚠️ OFF, NOT REMOVED. Deleting the chip would drag the preview bar, the timed
 * reveal and the `onReplyTo` seam out with it, and every one of those has to come
 * back on the day the real feature lands. Everything stays wired; only the way IN
 * is closed.
 *
 * TO TURN IT BACK ON: set this to `true`. That is the whole change — the chip is
 * still rendered by `ChatRoomView`, still gated by the same customer-only and
 * hover-reveal rules it always had, and `test/bubbleReplyHidden.value.test.ts`
 * will go red to remind whoever flips it to update the spec.
 * เปิดกลับ = แก้ true บรรทัดเดียว ไม่ต้องแตะที่อื่น.
 */
/* [FEAT-20260821-QUOTEREPLY] the day came — the send is real (`sendReply` posts
 * `quote_of`, the BE quotes through LINE). Flipped exactly as the note above
 * said; `test/bubbleReplyHidden.value.test.ts` was updated in the same commit. */
import { realName } from '../common/customerName';
import { translateNow } from '../../i18n';

export const SHOW_BUBBLE_REPLY_BUTTON = true;
export interface ReplyTarget {
  /** the message being replied to */
  id: string;
  /** who wrote it — decides the label shown above the quote */
  senderType?: string;
  /** a short plain-text stand-in; media has no text, so it may be empty */
  text?: string;
  /** 'image' | 'video' | 'sticker' | 'flex' … — lets the bar say "รูปภาพ" etc. */
  messageType?: string;
}

/**
 * One line describing the quoted message, whatever kind it is.
 * [FEAT-20260821-QUOTEJUMP] Kind decides BEFORE text: a media row stores a
 * placeholder as its content (`[image]`, `[sticker]`), and that placeholder was
 * leaking into the quote block verbatim. Text is trusted only for text.
 */
export function replySnippet(target: ReplyTarget | null): string {
  if (!target) return '';
  const kind = target.messageType;
  const isText = !kind || kind === 'text';
  const text = (target.text ?? '').trim();
  if (isText && text) return text;
  switch (kind) {
    case 'image': return translateNow('ticketui.reply.kind_image', 'รูปภาพ');
    case 'video': case 'video_pending': return translateNow('ticketui.reply.kind_video', 'วิดีโอ');
    case 'sticker': return translateNow('ticketui.reply.kind_sticker', 'สติกเกอร์');
    case 'flex': return translateNow('ticketui.reply.kind_flex', 'การ์ดข้อความ');
    default: return translateNow('ticketui.reply.kind_text', 'ข้อความ');
  }
}

/** Whose message is being quoted, in the operator's words. */
export function replyAuthorLabel(target: ReplyTarget | null): string {
  if (!target) return '';
  return target.senderType === 'customer' ? translateNow('ticketui.common.customer', 'ลูกค้า') : target.senderType === 'bot' ? translateNow('ticketui.common.bot', 'บอท') : translateNow('ticket.chat_status_admin', 'แอดมิน');
}

/**
 * Can a reply be composed right now?
 *
 * A reply and an attachment cannot travel together: one send carries either a
 * quoted message or an image/sticker, never both. Owner, 2026-08-19: clicking
 * Reply while something is attached must be REFUSED with a dialog, while
 * attaching something to an existing reply silently CANCELS the reply. The two
 * directions differ on purpose — the second is a deliberate act with the reply
 * in plain sight, the first is a mistake worth naming.
 * ตอบกลับ + รูป/สติกเกอร์ พร้อมกันไม่ได้ · กดตอนมีไฟล์ค้าง = เตือน · แนบทีหลัง = ยกเลิกให้เงียบ ๆ
 *
 * Pure so both directions and every future caller share ONE rule.
 */
export type ReplyBlockReason = 'image' | 'sticker' | null;

export function replyBlockedBy(state: {
  hasImages?: boolean;
  hasSticker?: boolean;
}): ReplyBlockReason {
  if (state?.hasImages) return 'image';
  if (state?.hasSticker) return 'sticker';
  return null;
}

/**
 * What to tell the operator when a reply is refused. Owner's wording, verbatim
 * (2026-08-19) — kept here rather than in the dialog so both halves of the
 * message, and any future caller, read from one place.
 * ข้อความตามที่เจ้าของกำหนด อยู่ที่เดียว.
 */
export function replyBlockedTitle(reason: ReplyBlockReason): string {
  if (reason === 'image') return translateNow('ticketui.reply.blocked_image', 'ไม่สามารถตอบกลับพร้อมกับรูปภาพได้');
  if (reason === 'sticker') return translateNow('ticketui.reply.blocked_sticker', 'ไม่สามารถตอบกลับพร้อมกับสติกเกอร์ได้');
  return '';
}

export function replyBlockedMessage(reason: ReplyBlockReason): string {
  if (reason === 'image') {
    return translateNow('ticketui.reply.blocked_image_msg', 'ไม่สามารถตอบกลับข้อความพร้อมกับรูปภาพได้ / หากต้องการตอบกลับ reply สามารถส่งแยกข้อความ กับ รูปภาพได้');
  }
  if (reason === 'sticker') {
    return translateNow('ticketui.reply.blocked_sticker_msg', 'ไม่สามารถตอบกลับข้อความพร้อมกับสติกเกอร์ได้ / หากต้องการตอบกลับ reply สามารถส่งแยกข้อความ กับ สติกเกอร์ได้');
  }
  return '';
}

/**
 * [FEAT-20260821-QUOTEJUMP] What to call the customer INSIDE a quote block.
 * Owner, 21/08: "คำว่า ลูกค้า ใช้ชื่อจริง ถ้าไม่มีใช้เบอร์ ถ้าไม่มีใช้ line displayname
 * ถ้าไม่มีอีกใช้คำว่า member". That order differs from `customerName()` (the chat
 * header prefers the operator's nickname), so it is its own function rather than
 * a flag on that one — two callers, two orders, no shared knob to get wrong.
 * Placeholders the stores write (`Unknown`, blanks) are filtered by the same
 * `realName` rule the header uses. ชื่อจริง → เบอร์ → display name → member.
 */
export function quotedCustomerLabel(
  user: { full_name?: string | null; phone_number?: string | null; display_name?: string | null } | null | undefined,
): string {
  const u = user ?? {};
  return realName(u.full_name) || realName(u.phone_number) || realName(u.display_name) || 'member';
}
