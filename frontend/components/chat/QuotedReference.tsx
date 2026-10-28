/**
 * [FEAT-20260821-QUOTEREPLY] The quote block INSIDE a bubble.
 * ===========================================================================
 * The BE marks a message that quoted another with `quoted_provider_msg_id` —
 * LINE's id for the quoted message (our outbound quote-replies, and a customer
 * quoting one of ours). This resolves it against the loaded thread by
 * `provider_msg_id`, the same id-space, and draws the same rule-and-label shape
 * `ReplyPreviewBar` uses above the composer, so "what I am replying to" and
 * "what this replied to" look like one feature.
 *
 * Renders NOTHING when the field is absent, so every existing bubble is
 * byte-identical. A quoted message outside the loaded window gets a neutral
 * stand-in rather than a blank — the operator still learns it was a reply.
 *
 * Own file on purpose: ChatRoomView is 1,700 lines on the max-lines waiver, and
 * the bubble render is already a long branch chain. ไฟล์แยก ไม่ยัดเพิ่ม.
 *
 * revert: delete this file and its one use in ChatRoomView.
 */
import React from 'react';
import { useI18n } from '../../i18n';

import type { ChatMessage } from '../../services/chat/chatService';
import { replySnippet, replyAuthorLabel, quotedCustomerLabel } from './replyTarget';

/** What the host gets on click: our `_id` when the quoted message is loaded, else only LINE's id. */
export interface QuoteJumpTarget {
  id: string | null;
  providerMsgId: string;
}

interface Props {
  msg: ChatMessage;
  /** the loaded thread — the quoted message is looked up here, not fetched */
  messages: ChatMessage[];
  /** [FEAT-20260821-QUOTEJUMP] the room's customer — names the quoted customer (owner's order) */
  customer?: { full_name?: string | null; phone_number?: string | null; display_name?: string | null } | null;
  /** [FEAT-20260821-QUOTEJUMP] click → go to the quoted message. Absent = plain block. */
  onJump?: (target: QuoteJumpTarget) => void;
}

export const QuotedReference: React.FC<Props> = ({ msg, messages, customer, onJump }) => {
  const { t } = useI18n();
  const quotedId = msg.quoted_provider_msg_id;
  if (!quotedId) return null;
  const quoted = messages.find((m) => m.provider_msg_id === quotedId) ?? null;
  /* [FEAT-20260831-QUOTESRC] the BE's answer for the same question, used ONLY when
     the quoted message is not in the loaded page — a room opens with ten messages,
     so quoting anything older used to fall through to the stand-in below.
     The loaded row wins on purpose: it is the same message, it is already here, and
     it cannot be staler than a value computed for this page. ของบนจอมาก่อนเสมอ. */
  const source = quoted
    ? {
        id: String(quoted._id),
        senderType: quoted.sender_type,
        text: typeof quoted.content === 'string' ? quoted.content : '',
        messageType: quoted.message_type,
        senderName: quoted.metadata?.sender_name as string | undefined,
      }
    : msg.quoted_preview
      ? {
          id: msg.quoted_preview.id,
          senderType: msg.quoted_preview.sender_type,
          text: msg.quoted_preview.text,
          messageType: msg.quoted_preview.message_type,
          senderName: msg.quoted_preview.sender_name,
        }
      : null;
  // Admin sends are stored as `sender_type: 'bot'` with the operator's name in
  // metadata — the same rule the bubble uses to sign them (`adminSenderName`).
  // A real bot reply has no name and stays "บอท".
  const signedByAdmin = !!source?.senderName?.trim();
  const target = source
    ? {
        id: source.id,
        senderType: source.senderType === 'bot' && signedByAdmin ? 'admin' : source.senderType,
        text: source.text,
        messageType: source.messageType,
      }
    : null;
  // Owner, 21/08: the customer is named, not called "ลูกค้า". Bot/admin keep their labels.
  const author = !target
    ? t('ticketui.reply.reply', 'ตอบกลับ')
    : target.senderType === 'customer'
      ? quotedCustomerLabel(customer)
      : replyAuthorLabel(target);
  const body = (
    <>
      <div className="text-[11px] font-semibold text-primary leading-none">{author}</div>
      <div className="text-[12px] text-slate-600 dark:text-slate-300 truncate mt-0.5">
        {target ? replySnippet(target) : t('ticketui.reply.quoted', 'ข้อความที่อ้างถึง')}
      </div>
    </>
  );
  const cls = 'mb-1.5 border-l-2 border-primary/70 pl-2 opacity-90 text-left';
  // A real <button> when it can act — keyboard and screen readers get it for free;
  // a plain <div> otherwise, so a host without a jump handler renders no control.
  return onJump ? (
    <button
      type="button"
      className={`${cls} block w-full cursor-pointer hover:opacity-100`}
      title={t('ticketui.reply.go_to', 'ไปที่ข้อความนี้')}
      onClick={(e) => {
        e.stopPropagation();
        /* [FEAT-20260831-QUOTESRC] `target.id` is our `_id` whichever way it was
           resolved — from the page or from the BE — so a quote outside the window
           now jumps straight by id instead of asking the BE to anchor on the LINE
           id. `null` only when neither knew it. */
        onJump({ id: target ? target.id : null, providerMsgId: quotedId });
      }}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
};
