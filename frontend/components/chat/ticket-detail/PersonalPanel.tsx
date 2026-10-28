/**
 * PersonalPanel.tsx — the "ข้อมูล" tab of the right-hand column: a skeleton
 * while the card switches, then the customer-info panel (`PersonalPanelNarrow`).
 *
 * WHAT: moved verbatim from `pages/chat/TicketChat.tsx`. It used to choose between two
 * panels; since 14/10/2026 there is one (see [FIX-20261014-LEGACYPANELGONE] below).
 *
 * WHY: it is the entry point of this folder — it is what the page renders, and
 * `DetailSkeleton` and `useCardSwitchLoading` are its private collaborators.
 *
 * revert: paste the component back into the page below `useCardSwitchLoading`,
 *   drop the line from `./index.ts`, delete this file.
 */
import React from 'react';
import { ChatRoom, TicketEntry } from '../../../services/chat';
import { PersonalPanelNarrow } from '../../profile-panel';
import { DetailSkeleton } from './DetailSkeleton';
import { useCardSwitchLoading } from './useCardSwitchLoading';

// ── Personal tab: customer detail (from ticket.line_user_data) ────────────

// [FEAT-20260731-CONTACTS] การ์ดลูกค้าถูก "ย้าย" ไป components/member/CustomerCards.tsx
// เพื่อให้หน้า Contacts ใช้ตัวเดียวกัน (ไม่ใช่ก็อปไปอีกชุด) — ดู import ด้านบน


/* [FIX-20261014-LEGACYPANELGONE] ONE panel. The acme-era `PersonalPanelLegacy` (shown
 * only when the config row `acme_category` was true — no environment carries that row)
 * was removed 14/10/2026 on the owner's order; the loan site draws through the provider view.
 * "No environment carries that row" = none we could read (local, both scratch copies, the
 * v2 clone — checked 14/10); production was not readable from here.
 * `PersonalPanelNarrow` is also the Contact page's panel (pages/chat/Contact.tsx) — one edit
 * lands on both screens. `acme_category` still picks the ticket CATEGORY set in
 * TicketChat.tsx (decision D4), not the panel.
 * revert: tag `ckpt-before-legacypanel-14102026`. */
export const PersonalPanel: React.FC<{
  ticket: TicketEntry; oaName: string; room: ChatRoom | null;
  /* [FEAT-20260907-PROVCONDS] §6 switches off the LIST envelope (the profile
     answer is null for unlinked members, exactly when the register box shows).
     Optional, default ON = today. */
  showRegisterAction?: boolean; showWalletpayCard?: boolean;
}> = ({ ticket, oaName, room, showRegisterAction = true, showWalletpayCard = true }) => {
  const switching = useCardSwitchLoading(ticket._id);
  if (switching) return <DetailSkeleton />;
  // [FEAT-20260801-CONTACTTABS] prop เปลี่ยนชื่อจาก ticket → source ตอนย้ายไฟล์กลาง
  // ⚠️ โปรเจกต์นี้ไม่มี @types/react → tsc **ไม่ตรวจ prop ของ JSX**
  return <PersonalPanelNarrow source={ticket} room={room} oaLabel={oaName} showRegisterAction={showRegisterAction} showWalletpayCard={showWalletpayCard} />;
};

// [FEAT-20260801-CONTACTTABS] แผงข้อมูลลูกค้า + helper ถูก "ย้าย" ไป components/profile-panel/ProfilePanel.tsx
// เพื่อให้หน้า Contacts ใช้ตัวเดียวกัน (ไม่ก็อปสองชุด) · ตรรกะไม่ถูกแก้ ย้ายอย่างเดียว
// revert: ย้ายเนื้อกลับมาตำแหน่งเดิม แล้วลบ import ที่หัวไฟล์
