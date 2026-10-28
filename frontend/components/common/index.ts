// [REFACTOR-20260808-CMPGROUP] Barrel for the `common` component group (shared UI primitives:
// searchable-select, skeletons, scroll indicator, sidebar, mega-menu, register-link card).
// App/pages/component-subfolders import `../components/common` (or `../common` from a sibling group).
// SearchableSelect/MegaMenu/Skeleton also carry an unused `export default`; every consumer uses the
// NAMED export (verified: no default imports anywhere) so `export *` preserves the exact binding shape.
// No module-level side effects → behavior-identical.
// revert: `git mv components/common/*.tsx components/`, delete folder, repoint importers back to the
//   per-file path, and restore the moved files' `../` depth.
export * from './SearchableSelect';
export * from './Skeleton';
export * from './ScrollIndicator';
export * from './Sidebar';
export * from './MegaMenu';
export * from './RegisterLinkCard';
// [FIX-20260814-CUSTOMERNAME] pure name-resolution helper (no JSX, no deps) —
// lives here so chat/ticket/contact can share it without importing each other
export * from './customerName';
// [FEAT-20260824-TABLEPAGER] shared table pager (page + per-page) — lives here, not in a
// feature folder, so messaging/contact/admin can share one pager without importing each other.
export * from './TablePager';
/* [FIX-20260905-LINELOGO] the LINE mark — ONE definition; the two copies it
   replaces had already drifted (see the file header). */
export * from './LineLogoIcon';
/* [REFACTOR-20260905-CUSTPROV] customer contact fields, beside customerName for
   the same reason: ticket/contact/chat share them without importing each other. */
export * from './customerDetail';
