/** Public surface of the handoff module — import '@/modules/handoff'. */

export { HandoffModule } from './handoff.module';

export {
  HandoffCallback,
  HandoffCallbackSchema,
  type HandoffCallbackDocument,
} from './schemas/handoff-callback.schema';
export {
  HandoffChain,
  HandoffChainBinding,
  HandoffChainSchema,
  HandoffChainStep,
  type HandoffChainDocument,
  type HandoffChainScope,
  type HandoffChainStatement,
} from './schemas/handoff-chain.schema';
export {
  HandoffChainRun,
  HandoffChainRunSchema,
  type HandoffChainRunDocument,
} from './schemas/handoff-chain-run.schema';
export {
  HandoffHookOverride,
  HandoffHookOverrideSchema,
  type HandoffHookOverrideDocument,
} from './schemas/handoff-hook-override.schema';
export {
  HandoffAttachment,
  HandoffAttempt,
  HandoffJob,
  HandoffJobSchema,
  type HandoffJobActor,
  type HandoffJobDocument,
  type HandoffJobResultMeta,
} from './schemas/handoff-job.schema';
export {
  HandoffRawView,
  HandoffResult,
  HandoffResultHistory,
  HandoffResultSchema,
  type HandoffResultDocument,
  type HandoffResultFinal,
  type HandoffResultRequest,
} from './schemas/handoff-result.schema';
export {
  HandoffResultRule,
  HandoffTarget,
  HandoffTargetBinding,
  HandoffTargetSchema,
  type HandoffTargetAuth,
  type HandoffTargetAuthHmac,
  type HandoffTargetBreaker,
  type HandoffTargetCallbackInject,
  type HandoffTargetCondition,
  type HandoffTargetDocument,
  type HandoffTargetIdempotency,
  type HandoffTargetInboundAuth,
  type HandoffTargetOurCallback,
  type HandoffTargetPoll,
  type HandoffTargetRetry,
  type HandoffTargetScope,
  type HandoffTargetThrottle,
} from './schemas/handoff-target.schema';

// [FIX-20260818-HANDOFFSCOPE] plan §8 = T3-3 — the override-scope spec drives this
// service directly; a deep path into a module's internals is an eslint error.
export { HandoffChainService } from './handoff-chain.service';
