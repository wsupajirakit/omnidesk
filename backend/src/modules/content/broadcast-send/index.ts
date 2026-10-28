/**
 * [FEAT-20260822-BCASTSEND] Barrel for the broadcast send unit.
 * ===========================================================================
 * RULES OF THIS FOLDER (แผน §R3.2 · §PH.3)
 *  · every file here is PURE — no Mongo, no HTTP, no clock, no @Injectable
 *  · one concern per file, so one concern can be deleted on its own
 *  · nothing here imports from `src/modules/*` — it is a leaf
 *  · the numbers live in `limits.ts` ONLY; no second copy anywhere
 *
 * NOT WIRED YET: nothing in the running system imports this barrel. It is the
 * contract layer that phase 1 needs in place so phase 4 is a swap, not a
 * rewrite. ยังไม่ต่อเข้าระบบ — ตั้งใจ.
 *
 * revert: delete this folder. Nothing outside it refers to these names.
 */
export * from './limits';
export * from './send-profile.registry';
export * from './send-matrix.registry';
export * from './chunk';
export * from './retry-key';
export * from './chunk-failure';
export * from './chunk-sink';
export * from './run-plan';
/* [FEAT-20260903-BCASTEMPTYAUD] whether a zero headcount skips an OA */
export * from './empty-audience.policy';
/* [FEAT-20260907-BCASTUNUSEDRULES] what to say when a pipe ignores its own
   audience conditions — and which save is refused for creating that state */
export * from './audience-on-broadcast.policy';
export * from './run-trigger';
export * from './run-guard';
export * from './abuse-guard';
export * from './global-quota';
export * from './claim';
export * from './resume';
export * from './send-loop.helpers';
export * from './oa-executor';
export * from './run-executor';
export * from './sinks';
export * from './adapters';
