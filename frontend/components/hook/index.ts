// [REFACTOR-20260808-CMPGROUP] Barrel for the `hook` component group (OA/hook config modals:
// hook form + clone + new-hook choice + connection test + raw-JSON-rules help + handoff-creds editor).
// App imports `../components/hook`. In-group edges (HookFormModal -> ./HandoffHookCredsEditor,
// ./RawJsonRulesHelp) stay relative; root hubs ConfirmModal/AlertModal/ScrollIndicator via `../`.
// Some modals also carry an unused `export default`; consumers use the NAMED export so `export *` is safe.
// revert: `git mv components/hook/*.tsx components/`, delete folder, repoint importers back to
//   `../components/<File>`, restore `../` depth.
export * from './HookFormModal';
export * from './HookCloneModal';
export * from './NewHookChoiceModal';
export * from './ConnectionTestModal';
export * from './RawJsonRulesHelp';
export * from './HandoffHookCredsEditor';
// [FEAT-20260810-PAYSTATEFLEX] only HookFormModal uses it today (relative in-group import);
// exported here so a future page can bind payment states without reaching into the folder.
export * from './HookPaymentFlexBlock';
