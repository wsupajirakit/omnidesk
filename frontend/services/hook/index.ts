// [REFACTOR-20260808-SVCGROUP] Barrel for the `hook` service group (OA/hook config: webhook CRUD,
// webhook logs, custom tools, AI keys, training docs, suggestion + curl parsing utils). Importers
// target `../services/hook`. Re-exports services AND their types (e.g. CustomToolEntry) and utils
// (normalizeSuggestionText, parseCurl). Members are side-effect-free named exports → `export *`
// is behavior-identical.
// revert: `git mv services/hook/*.ts services/`, delete this folder, repoint importers back to
// `../services/<file>`, and restore the moved files' `./apiClient` / `../types` paths (the internal
// `./suggestionUtils` edge is unchanged — both files live in this group).
export * from './webhookService';
// [FEAT-20260903-FIELDOPTIONS] "what may this field be set to?", answered by the
// server so this side never offers a value the back end cannot act on.
export * from './fieldOptionsService';
// [FEAT-20260903-FIELDOPTIONS] the hook around it, so more than one form can
// offer the same server-owned list without either growing its own copy.
export * from './useFieldOptions';
export * from './paymentReplyExamplesService';
export * from './webhookLogService';
export * from './customToolService';
export * from './aiKeyService';
export * from './trainingDoc';
export * from './suggestionUtils';
export * from './curlParser';
