// [REFACTOR-20260808-SVCGROUP] Barrel for the `finance` service group (slip verification + bank
// lookup). Groups same-domain services under one folder; importers target `../services/finance`.
// All members are side-effect-free named exports, so `export *` is behavior-identical.
// revert: `git mv services/finance/*.ts services/`, delete this folder, and repoint importers back
// to `../services/<file>` (and fix the moved files' `../apiClient`/`../../types` back to `./`/`../`).
export * from './slipVerificationService';
export * from './bankService';
