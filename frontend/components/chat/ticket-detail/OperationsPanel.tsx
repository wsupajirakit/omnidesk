/**
 * OperationsPanel.tsx — the "ดำเนินการ" tab of the right-hand column: current
 * admin, transfer, category, the three customer cards, and close-case.
 *
 * WHAT: moved verbatim from `pages/chat/TicketChat.tsx` (module scope, at the
 * very bottom of the file).
 *
 * WHY: 59 code lines that read only their nine props. The `canTransfer` rule
 * (owner of the case AND job in progress) is computed here from props and
 * nothing else, so nothing had to be lifted or passed down to move it.
 *
 * Behaviour: none. `panelCardKey(...)` still keys the three cards with the same
 * nonce, so they remount on refresh exactly as before.
 *
 * revert: paste the component back at the bottom of the page above
 *   `export default TicketChat`, drop the line from `./index.ts`, delete this
 *   file.
 */
import React from 'react';
import { CircleCheck, Tags } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { ChatRoom, TicketEntry } from '../../../services/chat';
import { CurrentAdminCard, CustomerNotes, CustomerTags, FollowUpCard } from '../../member';
import { panelCardKey } from '../../../pages/chat/panelRefresh';
import { TransferCard } from './TransferCard';
import { getCategoryBadge } from './ticketPresentation';
import { TicketCategoryBadge } from '../../ticket-category';

// ── Operations tab: admin, category, customer tags + notes (1:many), close ──
export const OperationsPanel: React.FC<{
  ticket: TicketEntry;
  room: ChatRoom | null;
  acme: boolean;
  canClose: boolean;
  onClose: () => void;
  currentUser: any;
  assignableUsers: { id: string; username: string; display_name: string }[];
  onTransferSuccess: (newUser?: { id: string; username: string; display_name: string }) => void;
  /* [FIX-20260825-PANELREFRESH] ขยับเมื่อไหร่ = การ์ดที่โหลดข้อมูลเองต้อง remount
     (ป้ายกำกับ + โน๊ต ผูก useEffect กับ room._id ซึ่งไม่เปลี่ยนตอนรีเฟรช) */
  cardNonce: number;
  /* [FEAT-20260907-PROVCONDS] §6 switch off the ticket-list envelope: the
     follow-up world. Optional, default ON — a caller that predates the prop
     renders today's screen. */
  showFollowUps?: boolean;
  /* [FEAT-20261014-TICKETCATS] the site's categories from the customer provider; null/absent = the
     `acme`-driven badge exactly as before (shop-api). */
  categories?: readonly string[] | null;
}> = ({ ticket, room, acme, categories, canClose, onClose, currentUser, assignableUsers, onTransferSuccess, cardNonce, showFollowUps = true }) => {
  const { t } = useI18n();
  const currentUserId = currentUser?.id || currentUser?._id;
  const adminId = ticket.admin_user_id || ticket.admin_user_data?._id || ticket.admin_user_data?.id;
  const isOwner = !!(currentUserId && adminId && String(currentUserId) === String(adminId));
  const isJobInProgress = Number(ticket.job_status) === 1;
  const canTransfer = isOwner && isJobInProgress;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-gray-50 p-3 space-y-3">
      {/* [FEAT-20260731-CONTACTS] การ์ดย้ายไปไฟล์กลาง รับ 3 ค่าแทน ticket ทั้งก้อน */}
      <CurrentAdminCard jobStatus={ticket.job_status} chatStatus={ticket.chat_status} adminUser={ticket.admin_user_data} />

      {canTransfer && (
        <TransferCard
          ticket={ticket}
          room={room}
          currentUser={currentUser}
          assignableUsers={assignableUsers}
          onTransferSuccess={onTransferSuccess}
        />
      )}

      {/* category badge (Thai label) — the provider's set when declared (loan_v1), else the
          acme flag as before [FEAT-20261014-TICKETCATS] */}
      <div className="bg-white border border-border rounded-lg shadow-sm p-3">
        <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1.5"><Tags size={14} className="text-gray-400" /> {t('ticketui.ops.category', 'หมวด')}</h3>
        {categories ? <TicketCategoryBadge category={ticket.category} categories={categories} /> : getCategoryBadge(ticket.category, acme)}
      </div>

      {/* customer tags + notes (both 1:many, keyed on the customer) */}
      {/* [FEAT-20260824-FOLLOWUP] การ์ด "การติดตาม" — พี่น้องของอีก 2 ใบ ไม่ซ้อนใคร
          แขวนที่นี่ (และที่ Contact.tsx) เพราะแท็บ "ดำเนินการ" ถูกประกอบ 2 ที่
          revert: ลบบรรทัดนี้ + import + โฟลเดอร์ components/member/follow-up */}
      {/* [FIX-20260825-PANELREFRESH] key มี nonce เพื่อให้ remount ตอนกดรีเฟรช
          หรือคลิกกลับเข้าห้องเดิม · มี room._id อยู่ด้วยเพื่อให้ remount ตอนสลับ
          ลูกค้า ไม่งั้นการ์ดจะถือข้อมูลของคนก่อนหน้าค้างไว้
          ⚠️ FollowUpCard ไม่ได้ fetch เอง (อ่านจาก prop `room`) — key ให้มันด้วย
             เพื่อความสม่ำเสมอ แต่สิ่งที่ทำให้มันสดจริงคือ room ที่ถูกดึงใหม่ */}
      {/* [FEAT-20260907-PROVCONDS] the whole follow-up world rides one provider
          switch (`show_follow_ups` on the list envelope) — hidden on providers
          that declare it off (loan_v1); absent = today's screen. */}
      {showFollowUps && (
        <FollowUpCard key={panelCardKey('follow', room?._id, cardNonce)} room={room} />
      )}
      <CustomerTags key={panelCardKey('tags', room?._id, cardNonce)} room={room} />
      <CustomerNotes key={panelCardKey('notes', room?._id, cardNonce)} room={room} />

      {/* close case */}
      <button
        type="button"
        onClick={() => canClose && onClose()}
        disabled={!canClose}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-md text-sm font-bold transition-all shadow-sm ${
          canClose
            ? 'border-red-200 bg-red-50 hover:bg-red-100 text-red-600 cursor-pointer'
            : 'border-red-200/50 bg-red-50/40 text-red-400/60 blur-[1.5px] opacity-50 cursor-not-allowed pointer-events-none select-none'
        }`}
        title={canClose ? t('ticketui.common.close_case', 'ปิดเคส') : t('ticketui.common.own_case_only', 'กดได้เฉพาะเคสตนเอง')}
      >
        <CircleCheck size={15} /> {t('ticketui.common.close_case', 'ปิดเคส')}
      </button>
    </div>
  );
};
