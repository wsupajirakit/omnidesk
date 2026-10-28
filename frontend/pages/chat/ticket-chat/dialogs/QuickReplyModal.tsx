/**
 * [REFACTOR-20261027-TCSPLIT] The Quick Reply management modal, opened from the ⚙️ gear.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * revert: paste the body back where `<QuickReplyModal />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { X, Zap } from 'lucide-react';
import { QuickReplyManager } from '../../../../components/chat';
import type { TFn } from '../types';

export type QuickReplyModalProps = {
  quickReplyModalOpen: boolean;
  t: TFn;
  setQuickReplyModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export const QuickReplyModal: React.FC<QuickReplyModalProps> = ({
  quickReplyModalOpen,
  t,
  setQuickReplyModalOpen,
}) => (
  <>
    {/* Quick Reply management — big modal from the ⚙️ gear. Backdrop does NOT
        close (only the X); same CRUD as the composer panel. */}
    {quickReplyModalOpen && (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
        <div className="bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-dark-700">
            <h3 className="text-lg font-bold flex items-center gap-2"><Zap size={18} className="text-yellow-500" /> {t('ticketui.quick_reply.title', 'จัดการ Quick Reply (ตอบด่วน)')}</h3>
            <button onClick={() => setQuickReplyModalOpen(false)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"><X size={22} /></button>
          </div>
          <div className="p-5 overflow-y-auto custom-scrollbar">
            <QuickReplyManager variant="modal" />
          </div>
        </div>
      </div>
    )}
  </>
);
