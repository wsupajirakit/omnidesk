/** Public surface of the system module — import '@/modules/system'. */

export { SystemModule } from './system.module';
export { SystemConfigService } from './system-config.service';
// [FEAT-20260808-P3CFGINVAL] registry in-memory config readers subscribe to for
// immediate (non-TTL) invalidation on any system_configs write.
export { ConfigCacheInvalidator } from './config-cache-invalidator.service';

/**
 * Exported because the ported slip flow logs its Swiftcheck call through the SAME
 * writer the `/webhook/logs` endpoints use (legacy:2857 calls
 * `webhookLogService.createLog` directly). Going through this service rather
 * than the model keeps the three mid-rename field mirrors and the `channel_type`
 * denormalisation in one place — writing the row directly would drop both and
 * make slip rows differ from every other log row.
 */
export { WebhookLogService } from './webhook-log.service';
// [FEAT-20260827-WLOGONEDOOR] the one door every webhook_logs row goes through.
export { WebhookLogWriter } from './webhook-log.writer';
export type { VersionInfo } from './version.service';

/**
 * `GET /model`'s pair, exported so it can be built in isolation with a stubbed
 * HTTP client. The success path cannot be exercised end-to-end — that needs a
 * live Gemini call, which R10 forbids — so the mapping and the failure envelope
 * are pinned by unit test instead, and the barrel is the only import route —
 * reaching into a module's internal files is lint-blocked.
 */
export { ModelController } from './model.controller';
export {
  ModelService,
  type ModelErrorResponse,
  type ModelListResponse,
  type ModelSummary,
} from './model.service';

/**
 * Exported so the flex variable table can render its example column through the
 * SAME dictionary the customer-facing cards use — a second copy would drift.
 */
export { TranslationDictCacheService } from './translation-dict-cache.service';

/**
 * The variable spec and its formatting rules.
 *
 * These were ported for the translation-dict `/usage` endpoint and are now also
 * the source of `GET /api/flex-messages/variables`. Re-exported here rather than
 * reached into directly, so the two consumers share ONE definition of every
 * variable — a second copy is how the table and the renderer drift apart.
 */
export {
  canonicalFlexPath,
  collectSpecPaths,
  pickShop,
  walkFlexVarSpec,
  walkSiteRulesSpec,
  type SpecVisitor,
} from './dict-spec/flex-var-spec';
export {
  FORMAT_RULES,
  type FormatRule,
} from './dict-spec/flex-var-format-rules';
export { default as SITE_RULES_SAMPLE } from './dict-spec/siteRulesSample.json';

export {
  Counter,
  CounterSchema,
  type CounterDocument,
} from './schemas/counter.schema';
export {
  CompatArtifact,
  Migration,
  MigrationSchema,
  type MigrationDocument,
} from './schemas/migration.schema';
export {
  SystemConfig,
  SystemConfigSchema,
  type SystemConfigDocument,
} from './schemas/system-config.schema';
export {
  TranslationDict,
  TranslationDictSchema,
  type TranslationDictDocument,
} from './schemas/translation-dict.schema';
export {
  WebhookLog,
  WebhookLogSchema,
  type WebhookLogDocument,
} from './schemas/webhook-log.schema';
// [FEAT-20260821-WLOGTTLDRIFT] the retention number + drift check, reachable without module internals.
export * from './webhook-log-ttl';
