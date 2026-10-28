/**
 * Barrel for `components/chat/ticket-detail` — the right-hand column of the
 * ticket page (the profile strip and the two tab panels).
 *
 * WHAT: these components + two helpers (seven until the legacy panel was removed
 * 14/10/2026) used to be declared inside
 * `pages/chat/TicketChat.tsx`, below the page component. They shared the file
 * with it but never shared a line of its state.
 *
 * WHY a barrel: the page imports THIS and nothing else from the folder, so a
 * future re-cut inside the folder never touches the page.
 *
 * ⚠️ Leaf files import each other DIRECTLY (`./TransferCard`), never through
 * this barrel — a leaf importing its own barrel is a cycle waiting to happen.
 *
 * revert: delete this file after moving each component back; see each file's
 *   own header for its individual steps.
 */
export { AVATAR_FALLBACK, getCategoryBadge } from './ticketPresentation';
export { ProfileHeader } from './ProfileHeader';
export { DetailSkeleton } from './DetailSkeleton';
export { useCardSwitchLoading } from './useCardSwitchLoading';
export { PersonalPanel } from './PersonalPanel';
export { TransferCard } from './TransferCard';
export { OperationsPanel } from './OperationsPanel';
