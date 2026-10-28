/**
 * [FEAT-20260822-BCASTSWITCH] One import for the live sender to reach.
 *
 * `broadcasts.service.ts` needs exactly two things from this folder — the
 * switch and the seam — and it must not pull the folder barrel, because
 * `content/index.ts` re-exports the service itself and that is a cycle.
 * This file exists so the live sender has ONE line to import and one to delete.
 *
 * revert: delete this file, its line in `index.ts`, and the import in
 * `broadcasts.service.ts`.
 */
export { usesNewSendPath, BROADCAST_NEW_PATH_ENABLED } from './new-path.switch';
export { BroadcastNewSendPort } from './new-send.port';
export type { NewSendOutcome, LegacySendResult } from './new-send.port';
