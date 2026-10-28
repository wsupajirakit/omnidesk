// [FEAT-20261027-TANSTACK] Barrel for the query core. Module query hooks live in
// `services/<module>/queries/`; only the shared pieces are exported from here.
export * from './queryClient';
export * from './queryPolicy';
export * from './queryKeys';
export * from './useAppQuery';
export * from './usePageQuery';
