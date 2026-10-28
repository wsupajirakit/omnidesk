/**
 * [FEAT-20260822-BCASTSCHED] Barrel for the broadcast schedule unit.
 * ===========================================================================
 * RULES OF THIS FOLDER — the same four `broadcast-send/index.ts` states, and
 * for the same reasons:
 *  · every file here is PURE — no Mongo, no HTTP, no clock, no @Injectable
 *  · one concern per file, so one concern can be deleted on its own
 *  · the numbers live in `schedule-limits.ts` ONLY; no second copy anywhere
 *  · a field name is read from `schemas/broadcast.schema.ts` and written down
 *    ONCE, in `schedule-shape.ts`, with the line it came from
 *
 * 🟢 WIRED 23/08. Corrected the day it stopped being true — this block used
 * to say "NOT WIRED, AND SWITCHED OFF … IT CANNOT BE SWITCHED ON AS IT
 * STANDS", naming the columns and the index as missing. All four columns and
 * the `broadcast_due` index landed on 22/08, and the timer landed on 23/08 in
 * `broadcast-run/scheduler.driver.ts` — which is the ONLY impure file in the
 * story, deliberately outside this folder so the pure-only rule above still
 * holds. คอมเมนต์ที่เคยจริงแล้วไม่ตามแก้ อันตรายกว่าไม่เขียนเลย.
 *
 * 🔴 SWITCHING IT ON STILL MOVES NOTHING BY ITSELF, and that is by design:
 * the scan only ever returns jobs carrying `next_run_at`, a column no campaign
 * had before 22/08. A job nobody scheduled is invisible to the scheduler
 * however the switch is set. เจ้าของสั่ง: "ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด".
 *
 * revert: delete this folder. Nothing outside it refers to these names.
 */
export * from './schedule-limits';
export * from './schedule-shape';
export * from './next-run';
export * from './arm-on-update';
export * from './due-query';
export * from './scheduler.worker';
