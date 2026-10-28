// [REFACTOR-20260808-MEMBERBARREL] Barrel for the `member` component group (customer-facing panels:
// CustomerCards, PersonalPanel, SearchableSelect). This closes the one reorg gap — every other
// components/ subfolder already exposes a barrel, but `member/` was still deep-imported by path from
// pages/chat/{TicketChat,Contact}. App/pages now import the folder path `../../components/member`.
// All members are NAMED exports with no cross-file name collisions and no default exports → `export *`
// preserves the exact binding shape and is behavior-identical (no module-level side effects).
// NOTE: `member/SearchableSelect` is intentionally SEPARATE from `common/SearchableSelect` (a different
// component that happens to share the name) — this barrel re-exports the member one only; do NOT merge.
// revert: repoint the importers in pages/chat/TicketChat.tsx + pages/chat/Contact.tsx back to the
//   per-file paths (`../../components/member/CustomerCards` etc.) and delete this file.
export * from './CustomerCards';
/* [REFACTOR-20260905-CUSTPROV] `PersonalPanel` left this group — it is now its
   own module at `components/profile-panel/`. Importers take it from there, so
   this barrel no longer re-exports it: two doors into one component is how the
   two disagree about which is canonical. */
export * from './SearchableSelect';
// [FEAT-20260824-FOLLOWUP] การ์ด "การติดตาม" — ออกทางบาร์เรลเดียวกับการ์ดใบอื่น
export { FollowUpCard } from './follow-up';
