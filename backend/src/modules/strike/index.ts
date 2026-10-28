/**
 * Public surface of the strike module — import '@/modules/strike'.
 *
 * Deep paths into this folder are an eslint error by the repo's layering rule,
 * so whatever is not listed here is genuinely private. Keep it that way: the
 * schemas are not exported, because nobody outside should be querying these two
 * collections directly.
 */

export { StrikeModule } from './strike.module';
export { STRIKE_GATE, type StrikeGate } from './strike-gate.port';
/* [FEAT-20260826-STRIKESUSPEND] exported for its spec, which must reach it
   through the barrel — a deep path into a module's internals is an eslint error
   by this repo's layering rule, tests included. */
export { StrikeGateService } from './strike-gate.service';
/* Exported for the same reason `@/modules/audit` exports AuditLogController:
   the layering rule forbids a deep path into this folder, so a test that needs
   to read the route decorators has no other way in.
   `z-test/unit/strike-permission.spec.ts` is that test. */
export { StrikeController } from './strike.controller';
/* [FEAT-20260827-ADMINBLOCK] exported for its specs, through the barrel like
   every other one (layering rule). */
export { StrikeAdminService } from './strike-admin.service';
export {
  StrikeService,
  type StrikeRollupView,
  type StrikeSessionView,
} from './strike.service';
export { ROLLUP_SESSION_CAP } from './strike-rollup.helper';
/* [FEAT-20260827-ADMINBLOCK] exported for `strike-block-audit.spec.ts`, which
   must come through the barrel like every other test (layering rule). */
export {
  STRIKE_AUDIT_PARENT,
  auditStrikeClear,
  auditStrikeSuspend,
  type StrikeAuditWriter,
} from './strike-block-audit.helper';
export {
  STRIKE_SINK,
  type StrikeSink,
  type StrikeRecordInput,
  type StrikeVerdictLike,
} from './strike-sink.port';
export {
  STRIKE_TRACKING,
  STRIKE_TRACKING_CONFIG,
  type StrikeTrackingConfig,
} from './strike.config';
