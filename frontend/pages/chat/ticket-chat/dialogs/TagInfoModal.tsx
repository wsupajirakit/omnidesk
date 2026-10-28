/**
 * [REFACTOR-20261027-TCSPLIT] A card's category + all-tags info modal.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * revert: paste the body back where `<TagInfoModal />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { Info, X } from 'lucide-react';
import { getDynamicTagColor, thLabel } from '../../../../components/member';
import type { TicketEntry } from '../../../../services/chat';
import type { TFn } from '../types';

export type TagInfoModalProps = {
  tagInfoTicket: TicketEntry;
  t: TFn;
  setTagInfoTicket: React.Dispatch<React.SetStateAction<TicketEntry>>;
  categoryBadge: (cat?: string | null) => React.JSX.Element;
};

export const TagInfoModal: React.FC<TagInfoModalProps> = ({
  tagInfoTicket,
  t,
  setTagInfoTicket,
  categoryBadge,
}) => (
  <>
    {/* category + all-tags info (list card overflow) — category and tags shown
        as separate, clearly-labelled groups; body scrolls, capped at 60vh. */}
    {tagInfoTicket && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
        {/* backdrop click does NOT close — only the X button does */}
        <div className="tc-select-menu w-[450px] max-w-[calc(100vw-2rem)] rounded-2xl border shadow-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
            <h3 className="text-base font-bold flex items-center gap-2"><Info size={18} className="text-primary" /> {t('ticketui.tags.modal_title', 'หมวด & ป้ายกำกับ')}</h3>
            <button onClick={() => setTagInfoTicket(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"><X size={24} /></button>
          </div>
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">{t('ticketui.tags.category', 'หมวด')}</div>
              <div>{categoryBadge(tagInfoTicket.category)}</div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">{t('ticketui.tags.tags_count', 'ป้ายกำกับ ({n})', { n: tagInfoTicket.customer_tags?.length || 0 })}</div>
              <div className="flex flex-wrap gap-2.5">
                {(tagInfoTicket.customer_tags || []).length === 0 ? (
                  <span className="text-sm opacity-50 italic">{t('ticketui.tags.none', 'ไม่มีป้ายกำกับ')}</span>
                ) : (
                  (tagInfoTicket.customer_tags || []).map(cg => (
                    <span key={cg._id} className={`tag-item text-[13px] font-semibold px-3 py-1.5 rounded-xl border ${getDynamicTagColor(cg.label, cg.color)}`}>{thLabel(cg.label)}</span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </>
);
