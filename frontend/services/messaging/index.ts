// [REFACTOR-20260808-SVCGROUP] Barrel for the `messaging` service group (outbound campaign
// messaging: auto-replies, broadcasts, dynamic tags). Importers target `../services/messaging`.
// Members are side-effect-free named exports, so `export *` is behavior-identical.
// revert: `git mv services/messaging/*.ts services/`, delete this folder, repoint importers back
// to `../services/<file>`, and restore the moved files' `./apiClient` / `../types` paths.
export * from './autoReplyService';
export * from './broadcastService';
export * from './dynamicTagService';
