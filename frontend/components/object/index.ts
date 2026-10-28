// [REFACTOR-20260808-CMPGROUP] Barrel for the `object` component group (object-image + object-
// category form modals). App imports `../components/object`. Root hubs ConfirmModal/AlertModal/
// ScrollIndicator referenced via `../`. No side effects → behavior-identical.
// revert: `git mv components/object/*.tsx components/`, delete folder, repoint ObjectCategoryList /
//   ObjectImageList back to `../components/<File>`, restore moved files' `../` depth.
export * from './ObjectCategoryFormModal';
export * from './ObjectImageFormModal';
