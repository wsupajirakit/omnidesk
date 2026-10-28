/**
 * [REFACTOR-20261027-TCSPLIT] Chat font / tray-mode modals and the two flash toasts.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * revert: paste the body back where `<ChatSettingsDialogs />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { ChatFontScaleModal } from '../../../../components/chat/ChatFontScaleModal';
import { ChatTrayModeModal } from '../../../../components/chat/ChatTrayModeModal';
import type { TFn } from '../types';

export type ChatSettingsDialogsProps = {
  fontModalOpen: boolean;
  setFontModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  chatFontScaleRaw: number;
  setChatFontScaleRaw: (value: number | ((prev: number) => number)) => void;
  setSettingToast: React.Dispatch<React.SetStateAction<string>>;
  t: TFn;
  trayModalOpen: boolean;
  setTrayModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  chatTrayModeRaw: string;
  setChatTrayModeRaw: (value: string | ((prev: string) => string)) => void;
  settingToast: string;
  closeSuccessOpen: boolean;
};

export const ChatSettingsDialogs: React.FC<ChatSettingsDialogsProps> = ({
  fontModalOpen,
  setFontModalOpen,
  chatFontScaleRaw,
  setChatFontScaleRaw,
  setSettingToast,
  t,
  trayModalOpen,
  setTrayModalOpen,
  chatTrayModeRaw,
  setChatTrayModeRaw,
  settingToast,
  closeSuccessOpen,
}) => (
  <>
    {/* close-case success flash (auto-hides; no page refresh) */}
    {/* [FEAT-20260830-CHATFONT] modal ขนาดตัวอักษร — ลากแล้วเซฟทันที */}
    <ChatFontScaleModal
      isOpen={fontModalOpen}
      onClose={() => setFontModalOpen(false)}
      value={chatFontScaleRaw}
      onChange={(scale) => {
        setChatFontScaleRaw(scale);
        setSettingToast(t('ticket.chat_font_saved'));
      }}
    />

    {/* [FEAT-20260830-TRAYFULL] modal โหมดแผงเครื่องมือ — เลือกแล้วเซฟทันที */}
    <ChatTrayModeModal
      isOpen={trayModalOpen}
      onClose={() => setTrayModalOpen(false)}
      value={chatTrayModeRaw}
      onChange={(mode) => {
        setChatTrayModeRaw(mode);
        setSettingToast(t('ticket.tray_mode_saved'));
        setTrayModalOpen(false);
      }}
    />

    {/* [FEAT-20260830-CHATFONT] toast ของสองการตั้งค่า
        ⚠️ z-[110] เท่ากับ close-success flash ข้างล่าง — ต้องสูงกว่า modal
        (z-[100]) ไม่งั้น toast ที่ยิงจากใน modal จะไปอยู่ข้างหลัง */}
    {settingToast && (
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[110] flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow-lg animate-slide-in-right">
        <CheckCircle2 size={16} /> {settingToast}
      </div>
    )}

    {closeSuccessOpen && (
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[110] flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow-lg animate-slide-in-right">
        <CheckCircle2 size={16} /> {t('ticketui.close_success', 'ปิดเคสสำเร็จ')}
      </div>
    )}
  </>
);
