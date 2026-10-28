/** Public surface of the hooks module — import '@/modules/hooks'. */

export * from './hooks.module';
export * from './hooks.service';
export * from './hooks.controller';
export * from './groups.service';
export * from './hook-cache.service';
// [FIX-20260821-AIKEYERRVISIBLE] Surfaced so the error-shape spec can drive the
// real service without importing a module internal (eslint no-restricted-imports).
// revert: drop this line together with the spec.
export * from './hook-credential-check.service';
export * from './groups.controller';
export * from './custom-tools.service';
export * from './custom-tools.controller';
// [FEAT-20261016-TOOLMINT] mint buttons · [FEAT-20261016-TAGBIND] ผูก tag button
// revert: drop these four export lines.
export * from './tool-mint/tool-mint.service';
export * from './tool-mint/tool-mint.controller';
export * from './tool-tag-bind/tool-tag-bind.service';
export * from './tool-tag-bind/tool-tag-bind.controller';
export * from './tool-tag-bind/tag-bind-plan';
// [FEAT-20260808-PAYTOOL-P1] Surface the category helpers + the shared
// normaliser/validator through the barrel so tests (and future callers) reach
// them without importing module internals (eslint no-restricted-imports).
// revert: drop these two export lines.
export {
  TOOL_CATEGORIES,
  normalizeCategory,
  // [FEAT-20260808-PAYTOOL-P2] revert: drop normalizePayment + PAYMENT_KNOB_DEFAULTS.
  normalizePayment,
  PAYMENT_KNOB_DEFAULTS,
  normalizeEndpoints,
} from './custom-tool-normalize';
export { assertCustomToolConfig } from './custom-tool-validate';
// [FEAT-20260808-PAYTOOL-P4] Surface the clone-tab registry through the barrel
// so tests reach `fieldsForTabs` / the maps without importing module internals
// (the global no-restricted-imports rule forbids '@/modules/*/*'). Read-only
// data + one pure function — no new runtime coupling.
// revert: drop this export block.
export {
  CLONEABLE_TABS,
  FIELD_TAB,
  NEVER_CLONE,
  SENSITIVE_FIELD,
  fieldsForTabs,
  labelKeyOf,
  type CloneableTab,
} from './hook-field-tabs';
export * from './dynamic-tags.service';
export * from './dynamic-tags.controller';
export * from './hook-audit-log.service';
/**
 * Exported because the outbound POST routes ported into `@/modules/external`
 * include `POST /hook/:id/push`, which answers legacy's `{ message }` 404 and
 * therefore needs the same exception + filter pair this module uses.
 */
export * from './hook-not-found.exception';
/**
 * [FEAT-20260808-PAYTOOL-P4] Surfaced for the same reason as the registry
 * above: the bulk payment switch's readiness check throws this, and its spec
 * asserts on the class + its `blocked` list without importing module internals.
 * revert: drop this export line.
 */
export * from './blocked-hooks.exception';
export {
  CustomCurl,
  CustomCurlSchema,
  type CustomCurlDocument,
} from './schemas/custom-curl.schema';
export {
  CustomTool,
  CustomToolEndpoint,
  CustomToolHmac,
  CustomToolSchema,
  EndpointIdempotency,
  EndpointProfileMap,
  EndpointResultMap,
  EndpointResultRule,
  type CustomToolDocument,
} from './schemas/custom-tool.schema';
export {
  DynamicTag,
  DynamicTagSchema,
  type DynamicTagDocument,
} from './schemas/dynamic-tag.schema';
export {
  FlexContentTag,
  FlexMessage,
  FlexMessageSchema,
  type FlexMessageDocument,
} from './schemas/flex-message.schema';
export { Group, GroupSchema, type GroupDocument } from './schemas/group.schema';
export {
  AuditActor,
  AuditChangedField,
  AuditRequestMeta,
  HookAuditLog,
  HookAuditLogSchema,
  type HookAuditLogDocument,
} from './schemas/hook-audit-log.schema';
export {
  CHANNEL_TYPES,
  Hook,
  HookSchema,
  type HookDocument,
} from './schemas/hook.schema';
export {
  Mapping,
  MappingSchema,
  type MappingDocument,
} from './schemas/mapping.schema';

// [FEAT-20260817-HOOKLABELS] slim OA-label list — exported so the spec can drive
// the service through the barrel (a deep path is an eslint error).
export {
  HookLabelsService,
  type HookLabel,
} from './hook-labels/hook-labels.service';

// [FEAT-20260818-CLONEFULL] Copy Item (สร้าง OA ใหม่จากต้นทาง) — export ผ่าน barrel
// เพื่อให้ spec เรียกได้ (deep path เป็น eslint error)
export { HookCloneService } from './hook-clone/hook-clone.service';
export {
  buildClonePatch,
  type CloneMergeReport,
} from './hook-clone/clone-merge';
// [FEAT-20261016-SLIPGUARDLOAN] slip provider ↔ key pair on both clone doors
export {
  holdSlipProviderWithoutKey,
  slipPairFieldsToSkip,
} from './hook-clone/slip-pair';

// [FIX-20260818-OAACCESSONE] plan §7.1 = C2/C3 = T3-2 — the ONE OA-scope resolver.
// Exported because chat/auth/tickets consume it and a deep path is an eslint error.
export {
  assertHookInScope,
  getAllowedHookIds,
  isHookOutOfScope,
  scopeFilter,
} from './oa-access/allowed-hook-ids';

// [FIX-20260818-VENDORKEYPROBE] plan §7.4 — vendor-aware AI key check.
// The vendor NAMES and the probe table travel together: a spec that checks the
// table covers every vendor needs both, and a deep import is a lint error here.
export { AI_VENDORS, type AiVendor } from './ai-vendor/parse-ai-vendor';
export { VENDOR_DEEPSEEK, VENDOR_GEMINI } from './ai-vendor/parse-ai-vendor';
/* [FEAT-20260909-DSREASONING] The reasoning knobs. Exported as FUNCTIONS, not
   as the column names: a caller that could read `REASONING_COLUMNS` could also
   read the wrong lane's entry, and the whole point of the module is that the
   lane is chosen once, by the code that knows which lane it is. */
export {
  resolveDeepSeekReasoning,
  resolveGeminiReasoning,
  type DeepSeekReasoning,
  type GeminiReasoning,
} from './ai-reasoning/resolve-reasoning';
export type { ReasoningLane } from './ai-reasoning/reasoning-columns';
export { buildAiKeyProbe, type AiKeyProbe } from './ai-vendor/ai-key-probe';
// [FEAT-20260904-VENDORSECCOL] read by webhook (reply/summary) and tickets
// (translate) — both already depend on this barrel.
export {
  DEEPSEEK_COLUMNS,
  GEMINI_COLUMNS,
  resolveVendorColumns,
  resolveVendorPair,
  type VendorColumns,
  type VendorPair,
} from './ai-vendor/resolve-vendor-fields';

// [FEAT-20260822-NOTICEMODE] Surface the notice-settings field rules through
// the barrel: the write-paths spec reaches them without a module-internal
// import (eslint no-restricted-imports), and the runtime phase (webhook
// module) will read scopes/toggles through this same surface later.
// revert: drop this line together with the notice-settings/ folder.
export * from './notice-settings';
