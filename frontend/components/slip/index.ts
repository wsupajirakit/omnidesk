// [REFACTOR-20260808-CMPGROUP] Barrel for the `slip` component group (slip detail + verification
// modals). App imports `../components/slip`. No side effects → behavior-identical.
// revert: `git mv components/slip/*.tsx components/`, delete folder, repoint SlipVerification back to
//   `../components/SlipDetailModal`, restore moved files' `../` depth.
export * from './SlipDetailModal';
export * from './SlipVerificationModal';
