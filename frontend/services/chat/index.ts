// [REFACTOR-20260808-SVCGROUP] Barrel for the `chat` service group (live chat / tickets / handoff:
// chat, tickets, the WebSocket hook, assign history, handoff targets, quick replies, translation dict).
// App code imports `../services/chat`; TESTS mock the underlying module path (`../services/chat/<file>`).
// These are network/WS-touching services — only their import PATHS changed here; no WS logic was
// touched. Members are side-effect-free named exports, so `export *` is behavior-identical.
// revert: `git mv services/chat/*.ts services/`, delete this folder, repoint importers back to
// `../services/<file>`, and restore the moved files' `../apiClient` / `../authStorage` / `../../types` paths.
export * from './chatService';
export * from './ticketService';
export * from './useTicketWS';
export * from './assignHistoryService';
export * from './handoffService';
export * from './quickReplyService';
export * from './translationDictService';
// [FEAT-20260811-CHATPIN] ปักหมุดห้องแชท — pure logic เก็บใน users.preferences
export * from './pinnedRooms';
// [FEAT-20260816-WALLETPAYCARD] read-only WalletPay leg history for the ticket panel
export * from './walletpayHistoryService';
// [FEAT-20260819-MSGALERT] pure alert/badge rules — no network, no React
export * from './ticketAlerts';
// [FEAT-20260819-ORPHANROOM] rooms that never became a case — derived, not stored
export * from './orphanRooms';
// [FEAT-20260819-CARDWINDOW] render 25 cards, reveal more on scroll (render-only)
export * from './useCardWindow';
export * from './registrationSource';
