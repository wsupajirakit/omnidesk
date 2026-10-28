/**
 * [REFACTOR-20260905-CUSTPROV] The ข้อมูลส่วนตัว panel as its own module.
 *
 * 🔴 THE ONLY WAY IN. `pages/chat/TicketChat.tsx` and `pages/chat/Contact.tsx`
 * render `<PersonalPanelNarrow …>` and know nothing else about this folder — no
 * file path, no card, no helper. That is the separation the owner asked for on
 * 05/09: *"แท็บข้อมูลส่วนตัว จัดระเบียบ module แยกออกมาจาก ticket … และให้ ticket
 * load ไปใช้"*.
 *
 * WHY IT LEFT `components/member/`. It sat beside `CustomerCards` and
 * `SearchableSelect` behind a shared barrel, so "the profile panel" was not a
 * thing you could point at — importing it meant importing the whole member
 * group. A folder makes the boundary real, and it is where the per-card split
 * (`dev-local §6.1`: 2,780 lines is over the 400-line ceiling) will land.
 *
 * ✅ THE THREE NON-PANEL HELPERS HAVE LEFT. `LineLogoIcon`, `getCustomerPhone`
 * and `parseCustomerDetail` used to ride this barrel because TicketChat needs
 * them outside the panel. They now live in `components/common`, so this barrel
 * exposes the panel and nothing else. The icon turned out to have DRIFTED from
 * its twin in `ChatRoomView` while it was duplicated — see
 * `components/common/LineLogoIcon.tsx`.
 *
 * revert: `git mv components/profile-panel/ProfilePanel.tsx
 *         components/member/PersonalPanel.tsx`, restore the `export * from
 *         './PersonalPanel'` line in `components/member/index.ts`, repoint the
 *         two page imports, delete this folder.
 *
 * 🔴 WHY NAMED EXPORTS, NOT `export *`, AS OF THE CARD SPLIT. The six cards
 * that moved to `./cards/` need to import a few single-card helpers back out
 * of `ProfilePanel.tsx` (e.g. `xpDTFull`, `CopyValue` — see dev-local §6: a
 * helper used by only 1 card file stays in the parent and gets exported for
 * that one file to import, rather than moving to `./shared/`). Those helpers
 * had to gain an `export` keyword to make that import possible — but an
 * `export *` here would have silently re-exported every one of them through
 * this barrel too, growing the panel's PUBLIC surface as a side effect of an
 * internal wiring need. Naming the two exports explicitly keeps this file's
 * export list frozen at exactly what it was before the split.
 * revert (of just this part): change back to `export * from './ProfilePanel'`
 * — safe only once no card-only helper in `ProfilePanel.tsx` carries `export`.
 */
export { PersonalPanelNarrow } from './ProfilePanel';
export type { MemberPanelSource } from './ProfilePanel';
