// [FEAT-20260816-GROUPSCOPECLONE] the copy-permissions dialog, kept in its own
// folder so Groups.tsx gains one import and nothing else.
// revert: delete this folder, the `./group-scope` line in ../index.ts, and the
// two call sites in pages/admin/Groups.tsx.
export * from './GroupScopeCloneModal';
