/**
 * [FEAT-20260822-NOTICERUNTIME] barrel — the notice runtime's public surface.
 * Checkers only so far (R1): pure, no DI, no side effects, individually
 * borrowable — the owner's standing rule. Cases + the orchestrator arrive in
 * R3 and must keep the same shape: one file per case, removable one at a time.
 * revert: delete this folder; nothing outside it holds state for it.
 */
export * from './notice.keys';
export * from './notice-time-window';
export * from './notice-word-match';
export * from './notice-site-rule-check';
export * from './notice-cooldown';
export * from './notice-policy';
// [R3] the six cases (one file each, order = data), the context funnel and
// the one-line orchestrator. revert: delete these three lines with cases/.
export * from './cases';
export * from './notice-context';
export * from './notice-decide';
// [FEAT-20260831-ADMINVIAWITHDRAW] the withdraw lane, derived from the order
export * from './notice-withdraw-lane';
export * from './notice-guard.helper';
