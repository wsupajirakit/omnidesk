// [REFACTOR-20260808-CMPGROUP] Barrel for the `campaign` component group (auto-reply + broadcast
// form modals). App imports `../components/campaign`. Root hub ConfirmModal via `../`. No side effects.
// revert: `git mv components/campaign/*.tsx components/`, delete folder, repoint AutoReplies/Broadcasts
//   back to `../components/<File>`, restore moved files' `../` depth.
export * from './AutoReplyFormModal';
export * from './BroadcastFormModal';
