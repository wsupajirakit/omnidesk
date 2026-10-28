/**
 * TransferCard.tsx — "โอนงาน": the searchable admin dropdown, the confirm
 * dialog and the assign-history write that follows a successful transfer.
 *
 * WHAT: moved verbatim from `pages/chat/TicketChat.tsx` (module scope, below
 * `PersonalPanelLegacy`).
 *
 * WHY: 85 code lines that read only their five props and their own three
 * `useState`s. Its only caller is `OperationsPanel`, now its neighbour.
 *
 * Behaviour: none. Same request order (`updateTicketMinimal`, then the
 * best-effort `createAssignHistory`), same swallowed errors, same labels.
 *
 * revert: paste the component back into the page above `OperationsPanel`, drop
 *   the line from `./index.ts` and the import in `./OperationsPanel.tsx`,
 *   delete this file.
 */
import React, { useMemo, useState } from 'react';
import { Loader2, UserCheck } from 'lucide-react';
import { ChatRoom, TicketEntry, ticketService, assignHistoryService } from '../../../services/chat';
import { SearchableSelect } from '../../member';
import { ConfirmModal } from '../../modals';
import { useI18n } from '../../../i18n';
import { withVars } from '../i18nVars';

// ── Transfer Card: searchable user dropdown + confirm + history log ────────
export const TransferCard: React.FC<{
  ticket: TicketEntry;
  room: ChatRoom | null;
  currentUser: any;
  assignableUsers: { id: string; username: string; display_name: string }[];
  onTransferSuccess: (newUser?: { id: string; username: string; display_name: string }) => void;
}> = ({ ticket, room, currentUser, assignableUsers, onTransferSuccess }) => {
  const { t } = useI18n();
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const currentUserId = currentUser?.id || currentUser?._id;
  const filteredUsers = useMemo(() => {
    return assignableUsers.filter(u => u.id !== currentUserId);
  }, [assignableUsers, currentUserId]);

  const selectOptions = useMemo(() => {
    return filteredUsers.map(u => ({
      value: u.id,
      label: `${u.username}${u.display_name ? ` (${u.display_name})` : ''}`,
    }));
  }, [filteredUsers]);

  const selectedUserObj = useMemo(() => {
    return filteredUsers.find(u => u.id === selectedTargetId);
  }, [filteredUsers, selectedTargetId]);

  const handleTransfer = async () => {
    if (!selectedTargetId || transferring) return;
    try {
      setTransferring(true);
      setConfirmOpen(false);

      await ticketService.updateTicketMinimal(ticket._id, { admin_user_id: selectedTargetId });

      const roomId = room?._id || (ticket as any).chat_room_id;
      if (roomId) {
        await assignHistoryService.createAssignHistory({
          ticket_id: ticket._id,
          chat_room_id: roomId,
          assign_to: selectedTargetId,
          changed_by_id: currentUserId || '',
          action: 'transfer',
        }).catch(() => {});
      }

      setSelectedTargetId('');
      onTransferSuccess(selectedUserObj);
    } catch (err) {
      console.error('Failed to transfer ticket:', err);
    } finally {
      setTransferring(false);
    }
  };

  const targetLabel = selectedUserObj
    ? `${selectedUserObj.username}${selectedUserObj.display_name ? ` (${selectedUserObj.display_name})` : ''}`
    : '';

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm p-3 space-y-2.5">
      <h3 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
        <UserCheck size={14} className="text-blue-500" /> {t('ticketui.transfer.title', 'โอนงาน')}
      </h3>
      <div className="space-y-2">
        <label className="text-[11px] font-bold text-gray-500 block">{t('ticketui.transfer.pick_label', 'เลือกผู้รับโอนงาน')}</label>
        <SearchableSelect
          value={selectedTargetId}
          options={selectOptions}
          onChange={setSelectedTargetId}
          placeholder={t('ticketui.transfer.pick_ph', '-- เลือกแอดมินที่ต้องการโอน --')}
          searchPlaceholder={t('ticketui.transfer.search_ph', 'ค้นหาชื่อ หรือ username...')}
        />
        <button
          type="button"
          disabled={!selectedTargetId || transferring}
          onClick={() => setConfirmOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-xs font-bold transition-colors shadow-sm cursor-pointer"
        >
          {transferring ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
          <span>{t('ticketui.transfer.title', 'โอนงาน')}</span>
        </button>
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleTransfer}
        title={t('ticketui.transfer.confirm_title', 'ยืนยันการโอนงาน')}
        message={withVars(t('ticketui.transfer.confirm_msg', 'คุณต้องการโอนงานนี้ให้ "{target}" ใช่หรือไม่?'), { target: targetLabel })}
        type="info"
      />
    </div>
  );
};
