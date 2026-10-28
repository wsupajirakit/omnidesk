/**
 * [REFACTOR-20261027-TCSPLIT] The pieces `pages/chat/TicketChat.tsx` was split into.
 * Markup and pure helpers only — every piece of state, every effect and the whole realtime
 * path (WS handler, list fetches, counts, notices, case actions) stays in the page.
 * Pieces import each other by file, never through this barrel (no cycles).
 */
export * from './constants';
export * from './format';
export * from './types';
