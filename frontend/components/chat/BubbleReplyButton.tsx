import React from 'react';
import { Reply } from 'lucide-react';
import { useI18n } from '../../i18n';

/**
 * The little "Reply" chip that appears beside a bubble on hover.
 * ===========================================================================
 * Kept out of ChatRoomView (1,600 lines, on the max-lines waiver) and out of
 * the bubble render itself, which is already a long branch chain per message
 * kind.
 *
 * VISIBILITY IS NOT ITS OWN. The row decides, through `useTimedReveal`: pointing
 * at a bubble reveals the chip and leaves it up for 10s, instead of the usual
 * CSS hover that disappears the moment the pointer drifts off a 20px target.
 * Nothing renders until then, so an untouched chat looks exactly as before.
 * ไม่ชี้ = ไม่มีอะไรโผล่เลย.
 *
 * revert: delete this file and its use in ChatRoomView.
 */
interface Props {
  onClick: () => void;
  /** Title/aria wording, so the same chip can serve other kinds later. */
  label?: string;
}

export const BubbleReplyButton: React.FC<Props> = ({ onClick, label: labelProp }) => {
  const { t } = useI18n();
  const label = labelProp ?? t('ticketui.bubble.reply', 'ตอบกลับข้อความนี้');
  return (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="shrink-0 self-center
      inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold
      text-slate-600 dark:text-slate-200 bg-white/95 dark:bg-slate-700/95
      border border-slate-200 dark:border-slate-600 shadow-sm
      hover:text-sky-600 hover:border-sky-300 dark:hover:text-sky-300
      transition-colors duration-150"
  >
    <Reply size={13} />
    Reply
  </button>
);
};
