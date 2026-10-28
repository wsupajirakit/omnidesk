/**
 * [REFACTOR-20261027-TCSPLIT] The right column: drawer backdrop, collapse + personal/operations tabs, and the panels.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * A transfer success is handled by the page (`handleTransferSuccess` writes the ticket list).
 * revert: paste the body back where `<DetailColumn />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { OperationsPanel, PersonalPanel, ProfileHeader } from '../../../../components/chat/ticket-detail';
import type { ChatRoom, TicketEntry } from '../../../../services/chat';
import type { AuthUser } from '../../../../types/auth';
import type { TFn } from '../types';

export type DetailColumnProps = {
  rightOpen: boolean;
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>;
  t: TFn;
  setRightTab: React.Dispatch<React.SetStateAction<"personal" | "operations">>;
  rightTab: "personal" | "operations";
  selectedTicket: TicketEntry;
  showFollowUps: boolean;
  oaName: (hookId?: string | null) => string;
  selectedRoom: ChatRoom;
  showRegisterAction: boolean;
  showWalletpayCard: boolean;
  providerCats: string[];
  acmeCategory: boolean;
  canCloseCase: boolean;
  setConfirmAction: React.Dispatch<React.SetStateAction<{ ticket: TicketEntry; targetStatus: number; }>>;
  currentUser: AuthUser;
  assignableUsers: { id: string; username: string; display_name: string; }[];
  cardNonce: number;
  handleTransferSuccess: (newUser?: { id: string; username: string; display_name: string; }) => void;
};

export const DetailColumn: React.FC<DetailColumnProps> = ({
  rightOpen,
  setRightOpen,
  t,
  setRightTab,
  rightTab,
  selectedTicket,
  showFollowUps,
  oaName,
  selectedRoom,
  showRegisterAction,
  showWalletpayCard,
  providerCats,
  acmeCategory,
  canCloseCase,
  setConfirmAction,
  currentUser,
  assignableUsers,
  cardNonce,
  handleTransferSuccess,
}) => (
  <>
    {/* ── RIGHT: personal / operations ──
        Driven by `rightOpen` at EVERY width (single source of truth).
        wide+ (≥1380): inline column that appears/disappears in-flow.
        <wide: an overlay drawer that slides in from the right, with a
        backdrop. Auto-collapses below `wide` (see the matchMedia effect);
        the edge handle reopens it. Applies to both normal and ticketOnly. */}
    {rightOpen && (
      <div
        onClick={() => setRightOpen(false)}
        className="wide:hidden absolute inset-0 bg-black/40 z-30"
      />
    )}
    <div className={`tc-col-right w-[340px] lg:w-[380px] bg-white border-l border-gray-200 h-full flex flex-col shrink-0 z-40 ${
      rightOpen
        ? 'absolute right-0 inset-y-0 shadow-2xl translate-x-0 transition-transform wide:static wide:shadow-none'
        : 'absolute right-0 inset-y-0 shadow-2xl translate-x-full transition-transform wide:hidden'
    }`}>
      {/* tabs */}
      <div className="flex items-stretch border-b border-gray-200 bg-gray-50 shrink-0">
        {/* Collapse the panel — leading position (before the tabs). Arrow
            points right = "tuck the panel away". Bordered + hover-fill so it
            reads as a control. Applies to both normal and ticketOnly. */}
        <button
          onClick={() => setRightOpen(false)}
          className="px-3 shrink-0 border-r border-gray-200 text-gray-400 hover:text-primary hover:bg-white transition-colors flex items-center justify-center"
          title={t('common.collapse')}
          aria-label={t('common.collapse')}
        >
          <ChevronRight size={20} />
        </button>
        <button
          onClick={() => setRightTab('personal')}
          className={`flex-1 py-3 text-sm font-bold transition-colors border-b-2 ${rightTab === 'personal' ? 'text-primary border-primary bg-white' : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100'}`}
        >
          {t('ticketui.panel.tab_personal', 'ข้อมูลส่วนตัว')}
        </button>
        <button
          onClick={() => setRightTab('operations')}
          className={`flex-1 py-3 text-sm font-bold transition-colors border-b-2 ${rightTab === 'operations' ? 'text-primary border-primary bg-white' : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100'}`}
        >
          {t('ticketui.panel.tab_operations', 'ดำเนินการ')}
        </button>
      </div>

      {!selectedTicket ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-xs p-6 text-center">
          {t('ticketui.panel.pick_case', 'เลือกเคสเพื่อดูข้อมูลลูกค้า')}
        </div>
      ) : (
        <>
          {/* Shared profile header — shown above BOTH tabs (matches the mockup). */}
          <ProfileHeader ticket={selectedTicket} showFollowUps={showFollowUps} />
          {rightTab === 'personal' ? (
            <PersonalPanel ticket={selectedTicket} oaName={oaName(selectedTicket.line_oa_hook_id)} room={selectedRoom} showRegisterAction={showRegisterAction} showWalletpayCard={showWalletpayCard} />
          ) : (
            <OperationsPanel
              categories={providerCats}
              ticket={selectedTicket}
              room={selectedRoom}
              acme={acmeCategory}
              showFollowUps={showFollowUps}
              canClose={canCloseCase}
              onClose={() => setConfirmAction({ ticket: selectedTicket, targetStatus: 2 })}
              currentUser={currentUser}
              assignableUsers={assignableUsers}
              cardNonce={cardNonce}
              onTransferSuccess={handleTransferSuccess}
            />
          )}
        </>
      )}
    </div>
  </>
);
