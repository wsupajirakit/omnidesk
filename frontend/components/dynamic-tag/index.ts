// [REFACTOR-20260808-CMPGROUP] Barrel for the `dynamic-tag` component group (dynamic-tag editor +
// its value preview — intra-coupled: the form renders the preview). App imports `../components/dynamic-tag`.
// Root hub AlertModal referenced via `../`. No side effects → behavior-identical.
// revert: `git mv components/dynamic-tag/*.tsx components/`, delete folder, repoint DynamicTagList back to
//   `../components/DynamicTagFormModal`, and restore the moved files' `../` depth.
export * from './DynamicTagFormModal';
export * from './DynamicTagPreviewModal';
