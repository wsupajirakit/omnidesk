import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { QueryCacheModule } from '@/infra/query-cache/query-cache.module'; // [FIX-20260810-QCACHEIMPORT]

import {
  CustomTool,
  CustomToolSchema,
  Hook,
  HookSchema,
} from '@/modules/hooks';

import { ConfigCacheInvalidator } from './config-cache-invalidator.service';
import { ExternalProbeService } from './external-probe.service';
import { InternalCacheController } from './internal-cache.controller';
import { InternalCacheService } from './internal-cache.service';
import { ModelController } from './model.controller';
import { ModelService } from './model.service';
import { OaAccessService } from './oa-access.service';
import {
  SystemConfig,
  SystemConfigSchema,
} from './schemas/system-config.schema';
import {
  TranslationDict,
  TranslationDictSchema,
} from './schemas/translation-dict.schema';
import { WebhookLog, WebhookLogSchema } from './schemas/webhook-log.schema';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';
import { TranslationDictCacheService } from './translation-dict-cache.service';
import { TranslationDictController } from './translation-dict.controller';
import { TranslationDictService } from './translation-dict.service';
import { TranslationDictUsageService } from './translation-dict-usage.service';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';
import { WebhookLogController } from './webhook-log.controller';
import { WebhookLogService } from './webhook-log.service';
import { WebhookLogWriter } from './webhook-log.writer';
import { WebhookStatsService } from './webhook-stats.service';

/**
 * System-level endpoints: version, config, stats, webhook logs, models and the
 * translation dictionary.
 *
 * Hook and CustomTool are registered here because two handlers read them —
 * per-OA access checks and the dictionary's tool dropdown — but their schemas
 * are owned by the hooks module.
 */
@Module({
  imports: [
    // [FIX-20260810-QCACHEIMPORT] WebhookLogController injects ScopedQueryCacheService.
    // @Global publishes it only once the module is in the graph, which holds for the app
    // (AppModule imports it) but not for a TestingModule built from this module alone.
    // โมดูลต้องประกาศของที่ตัวเองใช้
    QueryCacheModule,
    MongooseModule.forFeature([
      { name: SystemConfig.name, schema: SystemConfigSchema },
      { name: WebhookLog.name, schema: WebhookLogSchema },
      { name: TranslationDict.name, schema: TranslationDictSchema },
      { name: Hook.name, schema: HookSchema },
      { name: CustomTool.name, schema: CustomToolSchema },
    ]),
  ],
  controllers: [
    VersionController,
    InternalCacheController,
    SystemConfigController,
    WebhookLogController,
    ModelController,
    TranslationDictController,
  ],
  providers: [
    VersionService,
    InternalCacheService,
    SystemConfigService,
    // [FEAT-20260808-P3CFGINVAL] leaf-safe immediate config-cache invalidation.
    ConfigCacheInvalidator,
    ExternalProbeService,
    // [FEAT-20260827-WLOGONEDOOR] the single persistence door for webhook_logs.
    WebhookLogWriter,
    WebhookLogService,
    WebhookStatsService,
    OaAccessService,
    ModelService,
    TranslationDictService,
    // The cache warms on module init and holds a dedicated Redis subscriber for
    // cross-instance invalidation, so it must be a singleton provider.
    TranslationDictCacheService,
    TranslationDictUsageService,
  ],
  /**
   * This module imports no other feature module, so it stays a leaf and cannot
   * be part of a cycle — which is what makes exporting from it safe.
   *
   * `WebhookLogService` is exported for the LINE ingest pipeline: every outbound
   * call and every terminal on that path writes one webhook_logs row, and those
   * rows are the only observable side effect of an endpoint that always answers
   * 200. A second copy of the write logic in the webhook module would drift from
   * the read side that `GET /webhook/logs` serves.
   */
  // `WebhookLogService` joins the list for the slip flow's Swiftcheck-call log —
  // see the note on the barrel export. Still a leaf module: this adds an
  // outbound export, not an import.
  exports: [
    TranslationDictCacheService,
    SystemConfigService,
    WebhookLogService,
    /* [FEAT-20260827-WLOGONEDOOR] exported so external-api, custom-tool,
     * customer-link and the two broadcast senders can stop writing the model
     * directly. All three of those modules already import SystemModule —
     * checked in their module files, not assumed — so this adds no new edge. */
    WebhookLogWriter,
    // [FEAT-20260808-P3CFGINVAL] exported so in-memory config readers (e.g.
    // WebhookService's AI-category cache) can register for immediate invalidation.
    ConfigCacheInvalidator,
  ],
})
export class SystemModule {}
