// [FEAT-20261027-TANSTACK] Query hooks of the `admin` service group. Not re-exported
// from `services/admin/index.ts` (tests mock that barrel with partial factories).
export * from './adminKeys';
export * from './useAdminReferenceQueries';
export * from './useAdminPagedQueries';
