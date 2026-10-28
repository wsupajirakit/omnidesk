// [REFACTOR-20260808-CMPGROUP] Barrel for the `bulk` component group (bulk-action modals: clone
// users, method toggle, permissions, status, tag-scope). App code imports `../components/bulk`.
// `export *` carries the NAMED exports these modals are imported by (each also has an unused
// `export default`, which is intentionally NOT re-exported — no consumer uses it). Presentational
// modals, no module-level side effects → behavior-identical.
// revert: `git mv components/bulk/*.tsx components/`, delete this folder, repoint importers back to
// `../components/<File>`, and restore the moved files' `../../services|types|i18n` paths to `../`.
export * from './BulkCloneUsersModal';
export * from './BulkMethodModal';
export * from './BulkPermissionsModal';
export * from './BulkStatusModal';
export * from './BulkTagScopeModal';
