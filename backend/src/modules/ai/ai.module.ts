import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ChatMessage, ChatMessageSchema } from '@/modules/chat';
import { DynamicTag, DynamicTagSchema } from '@/modules/hooks';
import { SystemModule, WebhookLogService } from '@/modules/system';

import { RagEngineService, WEBHOOK_LOG_SINK } from './rag-engine.service';

/**
 * Retrieval and the model turn — the port of legacy's `ragEngineService.js`.
 * [FEAT-20261026-RAGENGINE] The RETRIEVAL half was removed 26/10 (never bound, never ran); the
 * RAG engine in `src/modules/rag/` replaces it. What remains here is the model-turn side and the
 * prompt/tag helpers `ai-reply/*` imports.
 *
 * ── HOW THIS MODULE IS REACHED ──────────────────────────────────────────────
 * Imported by `WebhookModule` (webhook.module.ts:194); the Gemini reply/assist
 * providers pull `RagEngineService` from here. The two optional seams below are
 * still unbound — that part is deliberate and unchanged.
 *
 * ── THE TWO SEAMS ───────────────────────────────────────────────────────────
 * `WEBHOOK_LOG_SINK` and `DYNAMIC_TAG_FORMAT_DEPS` are both `@Optional()`.
 * Legacy resolves each with a `require()` executed *inside* the function that
 * needs it, which Nest has no equivalent for, so they became injected.
 *
 *  · `WEBHOOK_LOG_SINK` → `WebhookLogService`. [FEAT-20260808-DYTAGLOG] now bound
 *    below via `useExisting` so the sink actually writes. `WebhookLogService` is
 *    already exported from `SystemModule` (system.module.ts:92-96) and the barrel
 *    (`@/modules/system`). `SystemModule` imports NO feature module — only
 *    `MongooseModule.forFeature` — so it is a leaf: pulling it in here cannot form
 *    a cycle back to `AiModule`. Before the bind, absence was a faithful
 *    degradation (`console.warn` fired, the `webhook_logs` row did not get
 *    written); legacy DID write that row, so binding restores parity.
 *
 *  · `DYNAMIC_TAG_FORMAT_DEPS` → `{ applyFormat, translate }`. THIS ONE IS NOT
 *    JUST WIRING. `translate` is ready (`TranslationDictCacheService.translate`),
 *    but the only `applyFormat` in this repo lives inside
 *    `@/modules/content/flex-var/flex-var-guidelines.ts`, is not exported, and
 *    passes `{ scope, path }` where legacy passes `{ tool, scope, path }`.
 *    Binding to it would drop the tool-level dictionary layer for dynamic tags —
 *    a silent wrong-word bug, not a crash. Port legacy's `flexVarFormatRules`
 *    `applyFormat` (or export the existing one and add `tool`) before binding.
 *    Unbound, `computeDynamicTagValue` returns the RAW value, which is what
 *    legacy did before [FEAT-20260803-TRANSDICT] and what it still does whenever
 *    the dictionary misses.
 *
 * ── SCHEMAS ────────────────────────────────────────────────────────────────
 * Both are read-only here and owned by their own modules. Registering them via
 * `forFeature` rather than importing `HooksModule`/`ChatModule` keeps this a leaf
 * module: it pulls in no other feature module's providers and cannot join a
 * cycle with the webhook module that will import it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DynamicTag.name, schema: DynamicTagSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
    // [FEAT-20260808-DYTAGLOG] SystemModule is a leaf (imports no feature
    // module), so this adds a one-way edge AiModule → SystemModule with no cycle.
    // It brings `WebhookLogService` in scope for the `useExisting` bind below.
    SystemModule,
  ],
  providers: [
    RagEngineService,
    // [FEAT-20260808-DYTAGLOG] Bind the previously-unbound optional sink.
    // On a dynamic-tag calc error (rag-engine.service.ts:1469) this makes
    // `webhookLogSink.createLog(...)` write ONE row to the EXISTING
    // `webhook_logs` collection — fields { channel:'log_operation',
    // action_type:'dynamic_tag_calculation_error', status:'error',
    // error_message, raw_request:{tag,formula,sub_type}, reference_id } —
    // matching legacy ragEngineService.js:888-895. Additive, no schema change.
    { provide: WEBHOOK_LOG_SINK, useExisting: WebhookLogService },
  ],
  exports: [RagEngineService],
})
export class AiModule {}
