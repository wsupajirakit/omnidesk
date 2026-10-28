/**
 * [FEAT-20260822-BCASTVAR] Barrel for the broadcast variable path.
 *
 * RULES OF THIS FOLDER
 *  · `spec/` and `format/` are CLONES of the original var path, held to it by
 *    two drift specs. Nothing in them may be "improved" — differences are bugs.
 *  · `read/` and `render/` are OURS: they know the shapes Mongo stores and the
 *    guarantees a broadcast needs, neither of which the original deals with.
 *  · `checks/` are the switchable pre-send checkers.
 *  · nothing here imports the original at runtime — only the drift specs do.
 *
 * 🟢 WIRED as of 23/08 (was "NOT WIRED YET" — corrected the day it stopped
 *    being true). `broadcast-send/adapters/oa-vars.reader.ts` calls
 *    `buildBroadcastVars` for every OA of a run, and `new-send.service.ts`
 *    hands the result to the card builder.
 *
 *    ⚠️ Only the OA-scoped families arrive that way: `hook_*` and
 *    `site_rules.*`. `member.*` / `profile.*` cannot be filled on a
 *    `/message/broadcast` — one request, no recipient list — so they render
 *    `N/A` there and need multicast to carry real values.
 *    ต่อแล้ว แต่ค่าเฉพาะคนยังต้องรอ multicast.
 *
 * revert: delete this folder and its lines in `content/index.ts`.
 */
export * from './checks';
export * from './spec/broadcast-var-spec';
export * from './spec/spec-path';
export * from './spec/pick-shop';
export * from './format/value-format';
export * from './format/build-var-map';
export * from './read/raw-blob.reader';
export * from './read/build-broadcast-vars';
/* [FEAT-20260903-BCASTOASCOPE] the OA-path dictionary scope. */
export * from './read/site-rules-scope';
export * from './render/substitute';
