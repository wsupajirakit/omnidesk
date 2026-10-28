/**
 * ComposerInputRow.tsx — the bottom of the composer box: the quoted-message
 * bar, the refusal dialog that explains why a quote was blocked, the
 * textarea + send button, the expanded image preview, and the character
 * counter.
 *
 * WHAT: moved verbatim from `ChatInputBox` in `pages/chat/TicketChat.tsx` — one
 * contiguous slice, in source order, with every comment.
 *
 * WHY this is a real seam: it is the whole "what the admin types into and what
 * reports on it" region, bounded above by the trays and below by the end of the
 * box. Its two `!showStickers &&` guards are the same rule stated twice
 * ([FEAT-20260830-STICKERNOINPUT]: while the sticker tray is open the input and
 * its counter are dead weight), so they belong in one file or neither.
 *
 * ⚠️ NO STATE MOVED. `draft`, `previewUrl`, `sending` and the `reply` draft all
 * stay declared in `ChatInputBox`; this file gets their values plus `send`,
 * `setDraft`, `setPreviewUrl` and `onComposerPaste` under their original names.
 * The `textareaStyle` / class decisions are computed in `ChatInputBox` exactly
 * as before and arrive already decided, so nothing about the height rules moved
 * (`dev-local` §6.4).
 *
 * REJECTED ALTERNATIVE: leaving this inline and instead lifting the grip-drag
 * plumbing (`dragRef`, `onGripDown/Move/Up`, `composerBoxH`) into a hook. That
 * would have been the bigger cut, but it moves `useRef` and re-expresses three
 * handlers that four suites pin as source text — surgery, not organisation.
 * เอาชิ้นที่ยกไปทั้งก้อนได้ ไม่ใช่ชิ้นที่ต้องผ่า.
 *
 * revert: paste the slice back where `<ComposerInputRow …/>` is rendered in
 *   `./ChatInputBox.tsx`, drop this file and its line in `./index.ts`.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import { GripHorizontal, X } from 'lucide-react';
import type { ChatRoom } from '../../../services/chat';
import type { ReplyDraft } from '../useReplyDraft';
import { ReplyPreviewBar } from '../ReplyPreviewBar';
import { replyBlockedMessage, replyBlockedTitle } from '../replyTarget';
import { ConfirmModal } from '../../modals';
import { chatComposerFixedRowClass } from '../../../hooks/chatTrayMode';
import { ComposerSendButton } from './ComposerSendButton';

export const ComposerInputRow: React.FC<{
  reply: ReplyDraft;
  trayMode?: string;
  composerLocked: boolean;
  anyTrayOpen: boolean;
  showStickers: boolean;
  /**
   * [FIX-20260910-TRANSLATEONEBOX] a translation is staged ⇒ THIS WHOLE ROW IS
   * GONE and the preview strip carries the typing field and the send button.
   *
   * 🔴 Owner, 10/09: *"ปิดช่องล่างไปเลย เวลาแปลแล้ว เปิดใช้ช่องบนแทน เวลาแก้ไข
   *    งงไหม"* — the strip already showed the Thai, so the screen held the same
   *    sentence in two boxes and neither of them said which one you were meant
   *    to edit. One box at a time.
   * ⚠️ It hides on a PREVIEW, never on a pending or failed translate: a refused
   *    press must leave the composer exactly as it was, draft included (§4C,
   *    pinned as M21). No preview ⇒ this row is on screen.
   * ⚠️ `false` restores the row byte for byte — owner: *"ปิดแปลทุกอย่างต้อง
   *    เหมือนเดิมนะ"*. It is a gate on the existing markup, nothing inside it
   *    changed.
   */
  previewOpen: boolean;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  send: () => void;
  onComposerPaste: (e: React.ClipboardEvent) => void;
  textareaStyle: { height: number } | undefined;
  overLimit: boolean;
  MAX_LEN: number;
  sending: boolean;
  room: ChatRoom | null;
  mode: 'reply' | 'note';
  pendingImages: { file: File; url: string }[];
  pendingSticker: { packageId: string; stickerId: string } | null;
  previewUrl: string | null;
  setPreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
}> = ({ reply, trayMode, composerLocked, anyTrayOpen, showStickers, previewOpen, draft, setDraft, send, onComposerPaste, textareaStyle, overLimit, MAX_LEN, sending, room, mode, pendingImages, pendingSticker, previewUrl, setPreviewUrl }) => {
  const { t } = useI18n(); // [FEAT-20261022-I18NTICKETEN]
  return (
  <>
        {/* [FEAT-20260819-REPLYUI] the quoted message, directly above the input.
            Renders nothing when no reply is in progress. */}
        <ReplyPreviewBar target={reply.target} onCancel={reply.cancel} />
        {/* …and the refusal, when Reply was pressed while something is attached.
            One button: there is nothing to confirm, only something to explain. */}
        <ConfirmModal
          isOpen={!!reply.blockedBy}
          onClose={reply.dismissBlocked}
          onConfirm={reply.dismissBlocked}
          title={replyBlockedTitle(reply.blockedBy)}
          message={replyBlockedMessage(reply.blockedBy)}
          type="warning"
          confirmLabel={t('ticketui.composer.understood', 'เข้าใจแล้ว')}
          hideCancel
        />
        {/* textarea + send */}
        {/* [FIX-20260830-TRAYBOTTOM] the row the owner saw clipped. Once the tray
            is `flex-1`, every sibling without `shrink-0` is fair product to be
            squeezed — this row must never be. */}
        {/* [FIX-20260830-GRIPWHOLE] `flex-1 min-h-0` so this row absorbs the height
            the dragged box has left over after the fixed rows and the tray. */}
        {/* [FIX-20260830-TRAYCAPSCALE] `min-h-0` → `min-h-[44px]`.
            This row is the one that lost in the owner's default-mode screenshot:
            it is `flex-1` with a basis of 0%, so when a tall tray competes for a
            capped composer this row's floor is literally zero and the textarea
            collapses to a clipped sliver. `shrink-0` cannot save it — a
            `flex:1 1 0%` item is already at its basis, so refusing to shrink
            below 0 changes nothing. A real minimum does: 44px is the send button
            (h-10 = 40px) plus the row's own padding, i.e. the height below which
            the row would clip a control that is always present. The tray keeps
            everything above this floor, so nothing is taken from it until the
            composer genuinely cannot show its own controls. */}
        {/* [FEAT-20260830-STICKERNOINPUT] stickers SEND ON CLICK — while that
            tray is open the input and its send button are dead weight, so the
            whole row is gone (owner). Emoji and quick replies INSERT into the
            draft instead, so their trays keep the row: the owner picks emoji
            continuously and watches them land in the input. */}
        {!showStickers && !previewOpen && <div
          /* [FIX-20260830-REALFULL] two mutually exclusive roles, decided in JS:
             no tray → this row is the FILLER of the fixed-height box (flex-1);
             tray open → the tray is the filler and this row holds its own
             height (shrink-0 via the helper). The old class carried flex-1 in
             the base AND shrink-0 from the helper at once — which of the two
             won depended on Tailwind's emission order. */
          className={composerLocked || anyTrayOpen
            ? chatComposerFixedRowClass(trayMode, 'flex items-end p-2 bg-white rounded-b-lg min-h-[44px]')
            : 'flex items-end p-2 bg-white rounded-b-lg min-h-[44px] flex-1'}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            onPaste={onComposerPaste}
            placeholder={pendingImages.length > 0 && mode === 'reply' ? t('ticketui.composer.ph_caption', 'ใส่แคปชั่น (ไม่บังคับ) แล้วกดส่ง...') : mode === 'reply' ? t('ticketui.composer.ph_reply', 'พิมพ์ข้อความตอบลูกค้า... (Shift+Enter ขึ้นบรรทัดใหม่)') : t('ticketui.composer.ph_note', 'โน๊ตภายใน (แอดมินเห็นเท่านั้น ไม่ส่งถึงลูกค้า)...')}
            /* [FIX-20260830-GRIPWHOLE] `h-full` replaces `style={{ height: areaH }}`.
               The drag number moved to the composer box; the textarea now simply
               fills whatever its row was given, so an open tray and the typing
               area share the dragged height instead of the textarea taking it all.
               The row itself is `shrink-0` in full mode, so this never collapses.
               [FIX-20260830-COMPOSERIDLEH] `h-full` is right only while an ancestor
               HAS a resolved height — i.e. full mode, or default mode with a tray
               open. With no tray the box sizes to content, so `h-full` would
               resolve against `auto` and collapse the typing area to one line no
               matter how far the grip was dragged. In that state the textarea
               carries the dragged pixel height itself (`textareaStyle`), which is
               exactly the pre-GRIPWHOLE behaviour, and `h-full` is dropped so the
               inline height is the only authority. */
            className={`w-full ${textareaStyle ? '' : 'h-full'} bg-transparent border-none focus:ring-0 focus:outline-none resize-none text-sm p-2 placeholder-gray-400 overflow-y-auto custom-scrollbar ${overLimit ? 'text-red-600' : 'text-gray-800'}`}
            style={textareaStyle}
          />
          {/* [FIX-20260910-TRANSLATEONEBOX] moved to ./ComposerSendButton so the
              preview strip can mount the SAME button when this row is hidden —
              not a copy of it. */}
          <ComposerSendButton
            send={send}
            sending={sending}
            room={room}
            draft={draft}
            overLimit={overLimit}
            MAX_LEN={MAX_LEN}
            mode={mode}
            hasPendingImages={pendingImages.length > 0}
            hasPendingSticker={!!pendingSticker}
          />
        </div>}
        {/* expanded image preview (zoom) — closes on backdrop click */}
        {previewUrl && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
            onClick={() => setPreviewUrl(null)}
          >
            <img src={previewUrl} alt="preview" className="max-w-full max-h-full rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
            <button type="button" onClick={() => setPreviewUrl(null)} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 text-gray-800 flex items-center justify-center shadow hover:bg-white"><X size={18} /></button>
          </div>
        )}
        {/* char count + resize hint */}
        {/* [FIX-20260830-TRAYBOTTOM] same reason as the textarea row above —
            the counter is the last thing on screen, so it is squeezed first. */}
        {/* [FEAT-20260830-STICKERNOINPUT] the counter belongs to the input */}
        {!showStickers && !previewOpen && <div className={chatComposerFixedRowClass(trayMode, 'px-3 pb-2 bg-white rounded-b-lg text-[10px] flex items-center justify-between gap-2 select-none')}>
          <span className={`font-medium ${overLimit ? 'text-red-600' : draft.length > MAX_LEN * 0.9 ? 'text-orange-500' : 'text-gray-400'}`}>
            {draft.length.toLocaleString()}/{MAX_LEN.toLocaleString()}
            {overLimit && <span className="ml-1 font-bold">{t('ticketui.composer.over_limit', 'เกินขีดจำกัด — ส่งไม่ได้')}</span>}
          </span>
          <span className="text-gray-400 flex items-center gap-1"><GripHorizontal size={11} /> {t('ticketui.composer.drag_hint', 'ลากแถบด้านบนเพื่อขยาย')}</span>
        </div>}
  </>
  );
};
