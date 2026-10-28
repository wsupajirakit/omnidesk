// [REFACTOR-20260808-CMPGROUP] Barrel for the `flex` component group (flex-message editor + its
// live preview — tightly coupled: the form renders the preview). App code imports `../components/flex`.
// FlexSlipCard stays at root for now (it is a chat-message renderer used by ChatRoomView). Root hubs
// ConfirmModal/DoubleConfirmModal/AlertModal are referenced via `../`. No side effects → identical.
// revert: `git mv components/flex/*.tsx components/`, delete this folder, repoint FlexMessageList back
// to `../components/FlexMessageFormModal`, and restore the moved files' `../` depth.
export * from './FlexMessageFormModal';
export * from './FlexPreviewModal';
// [FEAT-20260830-FLEXBULKGROUPS] bulk group editing on the list.
export * from './bulk';
// [FEAT-20260831-FLEXCAROUSEL] the carousel view of the same list (own subfolder).
export * from './carousel';
// [FEAT-20260907-CLONETEMPLATEBTN] "copy แม่แบบ" — shared by the table and the
// carousel, which is why it sits at this level and not inside either of them.
export * from './FlexCloneTemplateButton';
