/**
 * [FEAT-20260822-BCASTHISTORY] Barrel for the run-history contracts.
 * ===========================================================================
 * RULES OF THIS FOLDER
 *  · pure only — the numbers and the shapes, never the writing
 *  · recipient ID LISTS never live in a history row (`recipient-ledger.ts`)
 *  · nothing here imports the original var path or `infra/`
 *
 * 🟢 WIRED. Corrected 23/08 — it said "NOT WIRED YET" long after five files
 *    started importing it (`run-io`, `new-send.service`, `run-ports`,
 *    `release-status`, `mongo-ports.factory`). A comment that WAS true and was
 *    not kept true is worse than none: the next reader budgets their care
 *    against it. คอมเมนต์ที่เคยจริงแล้วไม่ตามแก้ อันตรายกว่าไม่เขียน.
 *
 * revert: delete this folder and its line in `content/index.ts`.
 */
export * from './run-counters';
export * from './recipient-ledger';
export * from './usage-queries';
export * from './history-row';
export * from './history-read';
