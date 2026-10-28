import React from 'react';
import { useI18n } from '../../../i18n';
import { Loader2, Send } from 'lucide-react';

/**
 * [FIX-20260910-TRANSLATEONEBOX] The send button — one definition, two homes.
 * ===========================================================================
 * It used to be written inline inside `ComposerInputRow`, which was fine while
 * that row was the only place it could ever appear. It is not any more: once a
 * translation is staged the whole typing row is hidden and the button moves
 * into the preview strip (owner, 10/09: *"ซ่อนทั้งแถว ย้าย ➤ ไปไว้ในกล่องบน"*).
 *
 * 🔴 TWO MOUNT POINTS, NOT TWO BUTTONS. Copying the JSX would have meant two
 *    disabled rules, two titles and two colour sets drifting apart — and the
 *    disabled rule is not decoration: it is what stops an empty draft, an
 *    over-limit draft or a second click during a send. One file, one rule.
 *
 * ⚠️ EXACTLY ONE IS EVER ON SCREEN. The row hides precisely when the strip
 *    shows it, so `getByTitle('ส่งถึงลูกค้า')` still resolves to one node and
 *    the admin never sees two send buttons.
 *
 * ⚠️ MOVED VERBATIM. Same classes, same title strings, same `disabled`
 *    expression as the inline version — this commit changes WHERE it renders,
 *    never WHAT it does.
 *
 * revert: paste the button back into ComposerInputRow's row, delete this file
 *         and its line in `test/ticketChatSource.ts`.
 */
export const ComposerSendButton: React.FC<{
  send: () => void;
  sending: boolean;
  room: unknown;
  draft: string;
  overLimit: boolean;
  MAX_LEN: number;
  mode?: string;
  hasPendingImages: boolean;
  hasPendingSticker: boolean;
}> = ({ send, sending, room, draft, overLimit, MAX_LEN, mode, hasPendingImages, hasPendingSticker }) => {
  const { t } = useI18n(); // [FEAT-20261022-I18NTICKETEN]
  return (
  <button
    onClick={send}
    disabled={sending || !room || overLimit || (!draft.trim() && !(hasPendingImages && mode === 'reply') && !(hasPendingSticker && mode === 'reply'))}
    className={`w-10 h-10 shrink-0 text-white rounded-full flex items-center justify-center transition-colors ml-2 shadow-sm disabled:opacity-40 ${mode === 'reply' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-500 hover:bg-amber-600'}`}
    title={overLimit ? t('ticketui.composer.over_chars', 'เกิน {max} ตัวอักษร', { max: MAX_LEN }) : hasPendingImages && mode === 'reply' ? t('ticketui.composer.send_image_text', 'ส่งรูป + ข้อความ') : mode === 'reply' ? t('ticketui.composer.send_to_customer', 'ส่งถึงลูกค้า') : t('ticketui.composer.save_note', 'บันทึกโน๊ตภายใน')}
  >
    {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} className="-ml-0.5" />}
  </button>
  );
};

export default ComposerSendButton;
