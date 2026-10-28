// [REFACTOR-20260808-CMPGROUP] Barrel for the `modals` component group (generic reusable modals:
// alert, confirm, double-confirm, image-zoom, JSON view (x2), tags, webhook-log detail). App/pages/
// component-subfolders import `../components/modals` (or `../modals` from a sibling group). All are
// NAMED exports consumed by name (verified: no default imports anywhere) → `export *` preserves the
// exact binding shape. No module-level side effects → behavior-identical.
// revert: `git mv components/modals/*.tsx components/`, delete folder, repoint importers back to the
//   per-file path, and restore the moved files' `../` depth.
export * from './AlertModal';
export * from './ConfirmModal';
export * from './DoubleConfirmModal';
export * from './ImageZoomModal';
export * from './JsonModal';
export * from './JsonViewModal';
export * from './TagsModal';
export * from './WebhookLogDetailModal';
