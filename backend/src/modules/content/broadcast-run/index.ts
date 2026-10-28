/**
 * [FEAT-20260822-BCASTRUNSVC] Barrel for the run orchestration.
 * ===========================================================================
 * RULES OF THIS FOLDER
 *  · this is the ONLY folder in the feature that is allowed to be impure, and
 *    it is impure only through the ports in `run-ports.ts` — no Mongo model, no
 *    HTTP client and no `new Date()` appears below this line
 *  · it holds NO rules: every ceiling, status, chunk size and retry key is
 *    asked of the module that owns it (`broadcast-send`, `broadcast-history`,
 *    `audience`) — a number typed in here is a bug in the wrong file
 *  · `runBroadcast` never throws for a runtime failure, so a claimed job is
 *    always handed back
 *
 * NOT WIRED YET: nothing in the running system imports this barrel, and the
 * only sink that exists sends nothing. ยังไม่ต่อเข้าระบบ — ตั้งใจ.
 *
 * revert: delete this folder and the line naming it in `content/index.ts`.
 */
export * from './run-ports';
export * from './release-status';
export * from './run-io';
export * from './run-lease';
export * from './run-broadcast';
export * from './new-path.switch';
export * from './new-send.port';
export * from './mongo-ports.factory';
export * from './new-send.service';
export * from './new-send.helpers';
export * from './saved-card';
export * from './preview.service';
export * from './history.service';
export * from './scheduler.driver';
