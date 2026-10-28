import { resolve } from 'node:path';

import { Logger, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
// [FEAT-20260829-MENUTAG-S3] plug. see docs/menu-plug-in.patch
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { aiConfig } from '@/config/app.config';
import { RateLimitModule } from '@/infra/rate-limit/rate-limit.module';
import { LineModule } from '@/infra/line';
import { UserRateLadderService } from './rate-limit/user-rate-ladder.service';
import { RedisModule } from '@/infra/redis/redis.module';
import {
  AssignHistory,
  AssignHistorySchema,
  ChatMessage,
  ChatMessageSchema,
  ChatModule,
  ChatRoom,
  ChatRoomSchema,
  Member,
  MemberSchema,
} from '@/modules/chat';
import {
  ImageStorage,
  ImageStorageSchema,
  ObjectImage,
  ObjectImageSchema,
} from '@/modules/content';
import { AiModule } from '@/modules/ai';
// [FEAT-20261026-RAGENGINE] the RAG engine — see the binding in `providers` below.
import { RagModule, RagRetrievalService } from '@/modules/rag';

import { DOC_RETRIEVAL_PROVIDER } from './doc-retrieval/doc-retrieval.provider';
import { CustomerLinkModule } from '@/modules/customer-link';
import { ExternalModule } from '@/modules/external';
import {
  FlexMessage,
  FlexMessageSchema,
  Hook,
  HookSchema,
  HooksModule,
} from '@/modules/hooks';
import { PaymentModule } from '@/modules/payment';
import { SlipModule } from '@/modules/slip';
// [FEAT-20260824-STRIKESESSION] plug. see docs/strike-plug-in.patch
import { StrikeModule } from '@/modules/strike';
import { SystemModule } from '@/modules/system';
import { Ticket, TicketSchema } from '@/modules/tickets';

import { AiCapDecorator } from './ai-reply/ai-cap.decorator';
import {
  AI_REPLY_PROVIDER,
  type AiReplyProvider,
} from './ai-reply/ai-reply.provider';
import { AssistSummaryCapDecorator } from './assist/assist-summary-cap.decorator';
import {
  AI_ASSIST_SUMMARY_PROVIDER,
  type AssistSummaryProvider,
  RealAssistSummaryProvider,
} from './ai-vendors/gemini/assist-summary.provider';
import { GeminiReplyProvider } from './ai-vendors/gemini/gemini-reply.provider';
import { ScriptedAiReplyProvider } from './ai-reply/scripted-ai-reply.provider';
// [FIX-20260818-STUBATBUILD] split out of assist-summary.provider.ts on dev so a
// deploy build can stub the scripted leg alone; kept in `assist/` here.
import { ScriptedAssistSummaryProvider } from './assist/scripted-assist-summary.provider';
import { LineApiService } from './line-api.service';
import { LineContentService } from './line-content.service';
import { LineSignatureGuard } from './line-signature.guard';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
// [FEAT-20260829-MENUTAG-S3] plug. see docs/menu-plug-in.patch
import {
  MENU_CARD_SOURCE,
  type StoredMenuCardSource,
} from '@/modules/menu';
/* [FEAT-20260902-MENUPRESSONCE] exports MenuPressService — the press budget.
   Importing it also CREATES the collection: Mongoose builds the declared index
   at boot and an index creates its collection, so there is no migration.
   🔴 ANCHORED ON THE MENU BLOCK, NOT ON StrikeModule. The first draft sat under
   the strike import and landed inside the CONTEXT LINES of
   docs/strike-plug-in.patch, which then stopped reverting and turned
   strike-plug-patch.spec.ts red — the exact failure the menu plug's own header
   warns about ("two independent plugs must never share an anchor"). It belongs
   beside the menu anyway: it is the menu's feature.
   revert: git apply -R docs/menu-plug-in.patch */
import { MenuPressModule } from '@/modules/menu-press';

/**
 * Where the call-cap counter survives restarts. Reuses the file the earlier
 * capped provider wrote, so its recorded history carries across this change.
 */
const AI_CAP_COUNTER_FILE = resolve(
  process.cwd(),
  '.gemini-test-call-count.json',
);

/**
 * Chooses the AI reply provider from the two switch axes — provider × cap.
 * Exported so the acceptance test can drive every combination directly, the same
 * function the DI factory calls. Full spec:
 * test-case/PLAN-webhook-0.5-rev2-mock-ai.md.
 *
 *   provider  mock → scripted (TEST ONLY) · real → Gemini
 *   cap       on   → AiCapDecorator(inner) · off → inner raw
 *
 *   local  mock + on     dev  real + on     prod  real + off
 *
 * Safe by construction:
 *  · defaults (resolved in aiConfig) are provider=real, cap=on
 *  · production + mock THROWS here — a script must never answer real customers
 */
export function selectAiReplyProvider(
  ai: Pick<
    ConfigType<typeof aiConfig>,
    'providerMode' | 'capMode' | 'capLimit'
  >,
  scripted: ScriptedAiReplyProvider,
  gemini: GeminiReplyProvider,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  logger: { log: (m: string, c?: string) => void } = Logger,
): AiReplyProvider {
  if (nodeEnv === 'production' && ai.providerMode === 'mock') {
    // Fatal, not a degrade: better a container that refuses to start than one
    // that silently answers customers from a script.
    throw new Error(
      '[AI] AI_PROVIDER=mock is forbidden in production — refusing to bind the ' +
        'scripted provider. Set AI_PROVIDER=real.',
    );
  }

  const inner: AiReplyProvider = ai.providerMode === 'mock' ? scripted : gemini;

  const provider: AiReplyProvider =
    ai.capMode === 'on'
      ? new AiCapDecorator(inner, ai.capLimit, AI_CAP_COUNTER_FILE)
      : inner;

  logger.log(
    `[AI] provider = ${ai.providerMode} ` +
      `(${ai.providerMode === 'mock' ? 'TEST ONLY' : 'live'}) · ` +
      `cap = ${ai.capMode}${ai.capMode === 'on' ? ` (limit ${ai.capLimit})` : ''}`,
    'WebhookModule',
  );
  return provider;
}

/**
 * [FIX-20260808-ASSISTSUMMARYFIRE] Chooses the assist-summary provider — the
 * MIRROR of `selectAiReplyProvider`, reading the SAME `aiConfig` axes
 * (provider × cap). One flag, no separate AI_SUMMARY env: `AI_PROVIDER=real`
 * fires BOTH the reply and the summary (owner decision 2026-08-08, "real
 * ยิงจริงหมด"); `AI_PROVIDER=mock` binds the scripted stand-in for tests.
 *
 *   provider  mock → scripted (TEST ONLY) · real → RealAssistSummaryProvider
 *   cap       on   → AssistSummaryCapDecorator(inner) · off → inner raw
 *
 * Safe by construction, exactly as the reply switch:
 *  · defaults (resolved in aiConfig) are provider=real, cap=on — so the summary
 *    fires on real deploys, which is the intended behaviour, not a guard to add
 *  · production + mock THROWS here — a script must never summarise real cases
 *
 * Exported so the acceptance test drives every combination through the same
 * function the DI factory calls.
 */
export function selectAssistSummaryProvider(
  ai: Pick<
    ConfigType<typeof aiConfig>,
    'providerMode' | 'capMode' | 'capLimit'
  >,
  scripted: ScriptedAssistSummaryProvider,
  gemini: RealAssistSummaryProvider,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  logger: { log: (m: string, c?: string) => void } = Logger,
): AssistSummaryProvider {
  if (nodeEnv === 'production' && ai.providerMode === 'mock') {
    // Fatal, not a degrade — same rule as the reply seam: better a container
    // that refuses to start than one that summarises real cases from a script.
    throw new Error(
      '[AI] AI_PROVIDER=mock is forbidden in production — refusing to bind the ' +
        'scripted assist-summary provider. Set AI_PROVIDER=real.',
    );
  }

  const inner: AssistSummaryProvider =
    ai.providerMode === 'mock' ? scripted : gemini;

  const provider: AssistSummaryProvider =
    ai.capMode === 'on'
      ? new AssistSummaryCapDecorator(inner, ai.capLimit, AI_CAP_COUNTER_FILE)
      : inner;

  logger.log(
    `[AI] assist-summary = ${ai.providerMode} ` +
      `(${ai.providerMode === 'mock' ? 'TEST ONLY' : 'live'}) · ` +
      `cap = ${ai.capMode}${ai.capMode === 'on' ? ` (limit ${ai.capLimit})` : ''}`,
    'WebhookModule',
  );
  return provider;
}

/**
 * LINE and Telegram webhook ingest.
 *
 * Hook is registered here because the signature guard resolves hooks by alias
 * to decrypt the channel secret. ChatRoom is needed by the Telegram callback
 * handler to toggle assist_status. ImageStorage is needed by
 * LineContentService, which writes one row per inbound image or video.
 *
 * The rest of the schemas arrived with the ingest wiring and are read-only from
 * here: ChatMessage (assist recency, `[[[history]]]`, the helper history
 * rewrite), Member (profile sync + phone/contract denormalisation),
 * AssignHistory and Ticket (the auto-unassist audit row), ObjectImage (the
 * `[[[img_*]]]` carousel).
 *
 * Every schema is owned by its own module — this module only reads them. If the
 * hooks, chat, content or tickets module is removed, this module breaks at boot,
 * which is the correct failure mode.
 */
@Module({
  imports: [
    /* [FEAT-20260827-PUSHCORE-B] candidate B — gives WebhookService
       `LinePushDispatcher` for the payment reply→push ladder. Imported as a
       MODULE: `LineModule` exports its providers from day one, so no bootleg
       copy of a sender is created here (the mistake customer-link had to undo).
       revert: drop this entry + the import line above. */
    LineModule,
    // [FEAT-20260824-STRIKESESSION] makes STRIKE_SINK resolvable in WebhookService.
    StrikeModule,
    // Exports RagEngineService — the retrieval + model turn the AI provider
    // calls. Its own header says whoever wires the pipeline imports it here;
    // this is that wiring.
    AiModule,
    // [FEAT-20261026-RAGENGINE] exports RagRetrievalService for the DOC_RETRIEVAL_PROVIDER line below.
    RagModule,
    // Brings HookCacheService, which both the signature guard and the service
    // use to resolve aliases without hitting Mongo on every inbound message.
    HooksModule,
    // ChatHistoryService — the write side of the chat screens, and the only
    // place chat_rooms / chat_messages rows are created by this pipeline.
    ChatModule,
    // WebhookLogService — every outbound call and every terminal writes one
    // webhook_logs row through it.
    SystemModule,
    // The combined profile fetch, on both the original and custom-tool routes.
    ExternalModule,
    /* [FEAT-20260902-MENUPRESSONCE] makes MenuPressService resolvable in
       WebhookService. Order inside `imports[]` does not affect Nest DI, so this
       position was chosen for the PATCHES, not for the runtime: it is a corridor
       no plug patch quotes.
       [FIX-20260903-PLUGCTX] it used to sit under `AiModule`, which put this
       patch's leading context on top of two lines docs/strike-plug-in.patch
       already quoted as its trailing context — one edit to the comment above
       `AiModule` would then have broken BOTH off-switches in a single commit,
       with "patch does not apply" as the only clue. Measured 03/09: a
       one-character edit there failed `git apply --check -R` for strike AND
       menu. `plug-patch-contract.spec.ts` now goes red if any two patches quote
       the same line again — do not move this block back.
       ตำแหน่งนี้เลือกเพื่อไม่ให้แพตช์สองเส้นจองบรรทัดเดียวกัน ไม่เกี่ยวกับลำดับ DI
       revert: git apply -R docs/menu-plug-in.patch */
    MenuPressModule,
    // [FIX-20260808-CUSTREG] CustomerLinkService.mintLinkToken for the register
    // keyword handler's reply.
    CustomerLinkModule,
    // The per-user message quota, and the Redis client behind the user lock.
    RateLimitModule,
    RedisModule,
    // [FEAT-20260808-PAYTOOL-P3] Exports PaymentRunnerService — the topup/walletpay
    // pair and the [ลองใหม่] resume. Imported so the webhook can run payment for
    // a verified slip and answer the retry postback. The runner SELF-GATES on
    // `payment_tool_status`, so importing it does not turn anything on: a hook
    // without the payment tool behaves exactly as before.
    PaymentModule,
    // [FIX-20260808-SLIPFLOW] Exports SlipFlowService (the Swiftcheck verify + slip
    // callback) and QrVisionService (the Gemini QR seam). WebhookService injects
    // both to run the inbound slip flow. SlipModule owns the SlipVerification
    // model and its own Swiftcheck/WebhookLog wiring; this module only consumes it.
    SlipModule,
    MongooseModule.forFeature([
      { name: Hook.name, schema: HookSchema },
      { name: ChatRoom.name, schema: ChatRoomSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: Member.name, schema: MemberSchema },
      { name: AssignHistory.name, schema: AssignHistorySchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: ObjectImage.name, schema: ObjectImageSchema },
      // Inbound customer media (image / video) is stored here by
      // LineContentService. Same collection the Object library uses; `source:
      // "chat"` is what keeps the two apart.
      { name: ImageStorage.name, schema: ImageStorageSchema },
      // [FIX-20260808-FLEXBUILDER] Card lookup by id / tag for the flex reply
      // builders.
      { name: FlexMessage.name, schema: FlexMessageSchema },
    ]),
  ],
  controllers: [WebhookController],
  providers: [
    /* [FEAT-20260829-MENUTAG-S3] The menu's CARD READER — not the engine.
       see docs/menu-plug-in.patch

       ⚠️ The engine itself is built per request at the seat in
       webhook.service.ts, NOT here. Its `coreSend` needs the LINE access token,
       which is decrypted per hook per request; a singleton engine would have to
       hold a stub for it and would then silently send nothing. So this provider
       supplies only the part that IS request-independent — reading a stored
       card — and the seat supplies the rest.

       The menu module contains no Nest at all (its contract, DO-NOT #3), which
       is what keeps `rm -rf src/modules/menu` a complete revert. So the Nest
       knowledge lives in this patch and the logic lives in the module.

       revert: git apply -R docs/menu-plug-in.patch */
    {
      provide: MENU_CARD_SOURCE,
      inject: [getModelToken(FlexMessage.name)],
      useFactory: (flexModel: Model<FlexMessage>): StoredMenuCardSource => ({
        find: async (q) =>
          (await flexModel
            .findOne({
              /* [FEAT-20260831-OPENFLEXTAG] conditional like the clauses below,
                 for the ONE door that addresses a card by minted tag and wants
                 it whatever type it is. Every other caller still sends a type,
                 so this narrows exactly as before for all of them. */
              ...(q.flexType ? { flex_type: q.flexType } : {}),
              /* [FIX-20260831-MENUSLUGDUP] a deleted card is not a candidate.
                 Unconditional, unlike the clauses below: with two rows sharing a
                 slug, `findOne` was free to answer with the deleted one, and the
                 renderer's own refusal then ended the lookup — the live sibling
                 was never reached and the customer got silence. Verified on the
                 real collection: live rows carry no `deleted_at` key at all. */
              deleted_at: { $exists: false },
              ...(q.subType ? { flex_sub_type: q.subType } : {}),
              ...(q.slug ? { flex_slug: q.slug } : {}),
              /* [FEAT-20260831-MENUMAINTAG] the minted `flex_tag` narrows to ONE
                 row. Another optional clause rather than a branch: the caller
                 states which keys it knows, and a query carrying both a tag and
                 a slug must match a card satisfying BOTH — never a near-miss
                 that happens to share one of them. */
              ...(q.tag ? { flex_tag: q.tag } : {}),
            })
            .lean()
            .exec()),
      }),
    },
    // [FEAT-20260821-RATELADDER] per-customer rate-limit escalation (wraps RateLimitService).
    UserRateLadderService,
    WebhookService,
    LineSignatureGuard,
    LineApiService,
    LineContentService,
    // Both leaves are registered so the factory can pick either. Only the one
    // the flag selects is ever handed a request; the other is constructed and
    // idle. GeminiReplyProvider pulls RagEngineService from AiModule.
    ScriptedAiReplyProvider,
    GeminiReplyProvider,
    // [FIX-20260808-ASSISTSUMMARYFIRE] Both summary leaves are registered so the
    // factory can pick either — mirroring the reply pair above. Only the one the
    // flag selects is handed a request; the other is constructed and idle.
    // RealAssistSummaryProvider pulls RagEngineService from AiModule.
    ScriptedAssistSummaryProvider,
    RealAssistSummaryProvider,
    /**
     * THE AI BINDING — chosen at boot by the provider × cap switch.
     *
     * `selectAiReplyProvider` (above) reads `AI_PROVIDER` and `AI_CAP` and
     * returns the scripted mock or the real Gemini provider, wrapped in the cap
     * decorator or not. Defaults are safe (real, capped); `mock` in production
     * throws here. The resolved choice is logged at boot. See the function and
     * test-case/PLAN-webhook-0.5-rev2-mock-ai.md.
     */
    {
      provide: AI_REPLY_PROVIDER,
      inject: [aiConfig.KEY, ScriptedAiReplyProvider, GeminiReplyProvider],
      useFactory: (
        ai: ConfigType<typeof aiConfig>,
        scripted: ScriptedAiReplyProvider,
        gemini: GeminiReplyProvider,
      ) => selectAiReplyProvider(ai, scripted, gemini),
    },
    /**
     * [FIX-20260808-ASSISTSUMMARYFIRE] THE ASSIST-SUMMARY BINDING — now chosen at
     * boot by the SAME provider × cap switch as the reply above, via
     * `selectAssistSummaryProvider`. It mirrors the reply seam exactly: reads
     * `AI_PROVIDER` and `AI_CAP` from `aiConfig`, returns the scripted mock or the
     * real `RealAssistSummaryProvider`, wrapped in the summary cap decorator or
     * not. One flag drives both seams — `AI_PROVIDER=real` fires the summary for
     * real (owner decision 2026-08-08, "real ยิงจริงหมด"); `mock` in production
     * throws here. The resolved choice is logged at boot.
     *
     * This replaces the previously inert `UnavailableAssistSummaryProvider`
     * binding. The summary flows to `ticket.need_detail` (assist-notification.ts
     * :827), which is what the operator board / FE reads. No extra env var, no
     * extra guard — the safe defaults (real, capped) are the reply seam's.
     */
    {
      provide: AI_ASSIST_SUMMARY_PROVIDER,
      inject: [
        aiConfig.KEY,
        ScriptedAssistSummaryProvider,
        RealAssistSummaryProvider,
      ],
      useFactory: (
        ai: ConfigType<typeof aiConfig>,
        scripted: ScriptedAssistSummaryProvider,
        gemini: RealAssistSummaryProvider,
      ) => selectAssistSummaryProvider(ai, scripted, gemini),
    },
    /* [FEAT-20261026-RAGENGINE] 🔌 THE PLUG — the one line that turns retrieval on for the
       fleet's code path. Per hook it still does nothing unless `doc_retrieval === true`.
       Delete this entry (and `RagModule` above) and every hook gets empty context again,
       exactly as before 26/10: the injection is `@Optional`, so the service falls back to
       `NoDocRetrievalProvider`. ถอดบรรทัดนี้ = ระบบกลับเป็นแบบเดิมทุกประการ
       ⚠️ LAST in `providers` on purpose: right under `providers: [` it sat inside the context
       docs/menu-plug-in.patch quotes, and that off-switch stopped applying
       (plug-patch-contract.spec.ts). Order here does not affect Nest DI. */
    { provide: DOC_RETRIEVAL_PROVIDER, useExisting: RagRetrievalService },
  ],
})
export class WebhookModule {}
