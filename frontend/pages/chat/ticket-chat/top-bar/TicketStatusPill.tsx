/**
 * [REFACTOR-20261027-TCSPLIT] The live status pill of the top bar (พร้อมรับเคส / รับเคสอยู่).
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * The page still builds it once as `statusInner` and places it (inline, or portaled for ticket-only).
 * revert: paste the body back where `<TicketStatusPill />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { MessageSquare } from 'lucide-react';
import type { TicketEntry } from '../../../../services/chat';
import type { TFn } from '../types';

export type TicketStatusPillProps = {
  myActiveCase: TicketEntry;
  openTicket: (ticket: TicketEntry, closedCases?: TicketEntry[]) => void;
  t: TFn;
};

export const TicketStatusPill: React.FC<TicketStatusPillProps> = ({
  myActiveCase,
  openTicket,
  t,
}) => myActiveCase ? (
  <button
    type="button"
    onClick={() => openTicket(myActiveCase)}
    className="hidden lg:flex items-center gap-2 text-xs font-semibold shrink-0 ml-2 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
    title={t('ticketui.status.go_to_my_case', 'ไปที่เคสที่กำลังดูแล')}
  >
    <MessageSquare size={14} className="text-red-500 animate-pulse" />
    <span className="w-2 h-2 rounded-full animate-pulse bg-red-500" />
    {t('ticketui.status.busy', 'รับเคสอยู่')}
  </button>
) : (
  <div className="hidden lg:flex items-center gap-2 text-xs font-semibold shrink-0 ml-2 text-green-600">
    <span className="w-2 h-2 rounded-full animate-pulse bg-green-400" />
    {t('ticketui.status.ready', 'พร้อมรับเคส')}
  </div>
);
