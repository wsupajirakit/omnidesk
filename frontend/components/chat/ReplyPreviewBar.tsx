import React from 'react';
import { Reply, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { withVars } from './i18nVars';

import { type ReplyTarget, replySnippet, replyAuthorLabel } from './replyTarget';

/**
 * The quoted message shown ABOVE the composer while a reply is being written.
 * ===========================================================================
 * Renders nothing when there is no reply, so a composer with no reply in
 * progress is byte-identical to before this existed.
 *
 * Colours come from the app's own palette (primary/slate + dark variants), not
 * from the mock the owner sketched — "สีเอาตามธีมไม่ต้องสีชมพู (แค่ตัวอย่าง)".
 * The left rule and the muted quote line follow the same shape every chat app
 * uses, so it reads as a quote without a legend.
 *
 * UI only: it displays and it cancels. Nothing here sends.
 *
 * revert: delete this file and its use in TicketChat.
 */
interface Props {
  target: ReplyTarget | null;
  onCancel: () => void;
}

export const ReplyPreviewBar: React.FC<Props> = ({ target, onCancel }) => {
  const { t } = useI18n();
  if (!target) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700
      bg-slate-50 dark:bg-slate-800/60">
      <Reply size={14} className="shrink-0 text-primary" />
      {/* the quote: a coloured rule, then who wrote it, then the text itself */}
      <div className="flex-1 min-w-0 border-l-2 border-primary/70 pl-2">
        <div className="text-[11px] font-semibold text-primary leading-none">
          {withVars(t('ticketui.reply.to', 'ตอบกลับ{who}'), { who: replyAuthorLabel(target) })}
        </div>
        <div className="text-[12px] text-slate-600 dark:text-slate-300 truncate mt-0.5">
          {replySnippet(target)}
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        title={t('ticketui.reply.cancel', 'ยกเลิกการตอบกลับ')}
        aria-label={t('ticketui.reply.cancel', 'ยกเลิกการตอบกลับ')}
        /* [FEAT-20260819-REPLYUI] +30% and given an outline (owner, 2026-08-19):
           at 24px with no border it read as decoration rather than a control, and
           cancelling a reply is the one action on this bar. 24→32px, icon 14→18.

           The outline is 2px and slate-400 in BOTH themes rather than the usual
           300/600 pair: on light the bar sits on slate-50 and on dark on
           slate-800/60, so a border tuned to either background disappears into
           the other. One mid-tone reads against both. ต้องชัดทั้งสองธีม. */
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center
          border-2 border-slate-400 dark:border-slate-400/80
          text-slate-600 dark:text-slate-200
          hover:text-slate-900 hover:bg-slate-200 hover:border-slate-600
          dark:hover:text-white dark:hover:bg-slate-700 dark:hover:border-slate-200
          transition-colors"
      >
        <X size={18} />
      </button>
    </div>
  );
};
