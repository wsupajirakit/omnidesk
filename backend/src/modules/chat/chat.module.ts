import { Logger, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { chatConfig } from '@/config/app.config';

import { CryptoModule } from '@/infra/crypto';
import { CustomerProviderModule } from '@/modules/customer-provider';
import { ImageStorage, ImageStorageSchema } from '@/modules/content';
import { ExternalModule } from '@/modules/external';
import { Group, GroupSchema, Hook, HookSchema } from '@/modules/hooks';
// [FEAT-20260908-CHATTRANS] the translate capability chat calls. See `imports`.
import { AiTranslateModule } from '@/modules/ai-translate';
// [FEAT-20260808-MEDIALOG] outbound chat-image webhook_logs writer.
import { AuditModule } from '@/modules/audit';
import { LineModule, LinePushDispatcher } from '@/infra/line';
import { SystemModule } from '@/modules/system';
/**
 * Registered here as a provider rather than imported from WebhookModule, which
 * does not export it and is another session's file. The service holds no state
 * and takes no constructor dependencies, so a second instance is the same
 * object twice, not a second LINE client — the point is that the request code
 * lives in exactly one file. Leaf import: see the note in chat.service.ts.
 */
// eslint-disable-next-line no-restricted-imports
import { LineApiService } from '@/modules/webhook/line-api.service';
/**
 * [FIX-20260808-VIDEORETRY] Registered here as a plain provider — same reasoning
 * as LineApiService above. Its only dependency is the ImageStorage model, which
 * this module already registers, so no WebhookModule import is needed (that would
 * be circular: WebhookModule imports ChatModule). Powers retryVideoDownload.
 */
// eslint-disable-next-line no-restricted-imports
import { LineContentService } from '@/modules/webhook/line-content.service';

// [FIX-20260808-CHANNELSEND] channel-agnostic send-adapter layer — mirrors the
// legacy channels/ module. Registered so ChatService / ChatMediaService can
// deliver outbound messages through the registry (no hardcoded 'line' branch).
import { ChannelRegistry } from './channels/channel-registry';
import {
  OUTBOUND_SEND_STRATEGY,
  PushOnlySendStrategy,
  ReplyReuseSendStrategy,
} from './channels/outbound-send-strategy';
import { LineSendAdapter } from './channels/line-send-adapter';
import { ChatHistoryService } from './chat-history.service';
import { ChatMediaController } from './chat-media.controller';
import { ChatMediaService } from './chat-media.service';
/* [FEAT-20260816-WALLETPAYCARD] read-only feed for the ticket panel's WalletPay card.
   ⚠️ The schema is imported from its LEAF FILE, not from `@/modules/handoff`:
   handoff already imports `@/modules/chat` (handoff.module.ts:7), so pulling the
   handoff barrel in here creates a module cycle — it broke 48 suites the moment
   it was tried. The leaf file has no module imports, which is the same escape
   hatch handoff itself uses for chat's schemas. ห้าม import barrel ข้ามกลับ. */
import {
  HandoffChainRun,
  HandoffChainRunSchema,
} from '@/modules/handoff/schemas/handoff-chain-run.schema';
import {
  HandoffResult,
  HandoffResultSchema,
} from '@/modules/handoff/schemas/handoff-result.schema';

import {
  WalletpayHistoryController,
  WalletpayHistoryService,
} from './walletpay-history';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
/* [FEAT-20260908-CHATTRANS] the whole feature is this folder + these two lines
   and the `AiTranslateModule` import above. */
import { ChatTranslateController } from './translate/chat-translate.controller';
import { ChatTranslateService } from './translate/chat-translate.service';
/* [FEAT-20260918-AUTOTRANS] the inbound plug — token, contract, implementation. */
import { AUTO_TRANSLATE_INBOUND } from './translate/auto/auto-translate.port';
import { AutoTranslateInboundService } from './translate/auto/auto-translate-inbound.service';
// [FIX-20260808-TGCOLLISION] The Telegram callback stub controller/service that
// used to live here were removed: they bound the SAME route
// `POST /api/telegram/webhook` as the full port in WebhookController, and because
// ChatModule is imported before WebhookModule the stub (DB assist-toggle only, no
// outbound) shadowed the real handler — an admin tapping a Telegram button got no
// popup / group confirmation / keyboard redraw. WebhookService.processTelegramWebhook
// is now the sole owner. Files telegram-webhook.{controller,service}.ts deleted.
import {
  ChatMessage,
  ChatMessageSchema,
  ChatRoom,
  ChatRoomNote,
  ChatRoomNoteSchema,
  ChatRoomSchema,
  CustomerTag,
  CustomerTagSchema,
  Member,
  MemberSchema,
  Tag,
  TagSchema,
} from './schemas';

@Module({
  imports: [
    /* [FEAT-20260905-CUSTPROV] `MembersService` stamps `customer_provider` onto
       the profile and site-rules responses; the resolver lives in a LEAF module
       that imports no feature module, so this cannot close a cycle. */
    CustomerProviderModule,
    MongooseModule.forFeature([
      { name: ChatRoom.name, schema: ChatRoomSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: Member.name, schema: MemberSchema },
      { name: ChatRoomNote.name, schema: ChatRoomNoteSchema },
      { name: Tag.name, schema: TagSchema },
      { name: CustomerTag.name, schema: CustomerTagSchema },
      { name: Hook.name, schema: HookSchema },
      { name: Group.name, schema: GroupSchema },
      // Outbound chat images are stored in the shared media collection.
      { name: ImageStorage.name, schema: ImageStorageSchema },
      /* [FEAT-20260816-WALLETPAYCARD] READ-ONLY registration of the handoff result
         schema so the WalletPay card can list step-2 legs for one member. Nothing
         here writes it — the chain console (`handoff.*`) remains the only
         writer, and its routes are untouched. อ่านอย่างเดียว ไม่แตะของเดิม. */
      { name: HandoffResult.name, schema: HandoffResultSchema },
      /* [FEAT-20260816-WALLETPAYSTMT] the run row holds the statement snapshot the
         card joins `statement_id` from — read-only, same as above. */
      { name: HandoffChainRun.name, schema: HandoffChainRunSchema },
    ]),
    // The refresh button on the ticket panel calls CustomToolService — the one
    // writer of raw_profile_data. Kept acyclic by the leaf schema imports on
    // the external side (see external.module.ts).
    ExternalModule,
    // sync-profile decrypts the OA access token before calling LINE.
    CryptoModule,
    // [FEAT-20260808-MEDIALOG] WebhookLogService for the outbound chat-image
    // webhook_logs row (legacy chatRoomController.js:1176/1191 → logOutbound
    // WebhookLog → webhookLogService.createLog). SystemModule exports it and does
    // NOT import ChatModule, so this stays acyclic (same precedent as SlipModule).
    SystemModule,
    /* [FEAT-20260821-ABANDONSHIELD] AuditLogService, for the one row written when
       the abandon shield is flipped (`member-abandon-audit.helper.ts`).
       Acyclic for the same reason SystemModule above is: AuditModule exports the
       service and does NOT import ChatModule. feature-scoped — app.module.ts is
       untouched. revert: delete this line with the helper. */
    AuditModule,
    /* [FEAT-20260821-CHATPUSHCORE] the central LINE sender, for the admin chat
       console (push-core candidate C). Acyclic: `infra/line` imports nothing
       from `src/modules` — lint enforces it. */
    LineModule,
    /* [FEAT-20260908-CHATTRANS] chat is a CALLER of the translate capability,
       never its owner. One import line and a bare constructor parameter is the
       whole wiring — the DI token stays private inside that module, which is
       why there is no `@Inject` and no symbol import anywhere on this side.
       Acyclic by construction: `AiTranslateModule` has no `imports` key at all
       and `ai-translate-isolation.spec.ts` fails if it ever grows one pointing
       at a feature module. It is absent from `app.module.ts` on purpose, so it
       enters the graph only because this line asks for it.
       ⚠️ `RateLimitService` and `AuditLogService` need no line here:
       `RateLimitModule` is `@Global` (registered once in `app.module.ts`) and
       `AuditModule` is already imported above for the abandon-shield row.
       revert: delete this line with `src/modules/chat/translate/`. */
    AiTranslateModule,
  ],
  controllers: [
    ChatController,
    MembersController,
    ChatMediaController,
    // [FEAT-20260816-WALLETPAYCARD] self-contained; delete this line + the folder to revert.
    WalletpayHistoryController,
    /* [FEAT-20260908-CHATTRANS] the two translate routes. A controller of its
       own so the whole feature is one folder; it shares the `api/chat` prefix
       and shadows nothing (see its header). revert: delete this line + the folder. */
    ChatTranslateController,
  ],
  providers: [
    // [FIX-20260808-CHANNELSEND] send-adapter registry + LINE adapter.
    LineSendAdapter,
    ChannelRegistry,
    /* [FEAT-20260821-QUOTEREPLY] the ONE place the send ladder is chosen.
       `CHAT_REPLY_REUSE=off` (default) binds PushOnly — byte-identical to
       before. `on` binds ReplyReuse. Flip the env, no deploy; to remove the
       feature for good, delete ReplyReuseSendStrategy and this factory's
       `on` branch. Logged once at boot so "which one is live" is never a guess. */
    {
      provide: OUTBOUND_SEND_STRATEGY,
      inject: [chatConfig.KEY, LinePushDispatcher],
      useFactory: (
        chat: ConfigType<typeof chatConfig>,
        core: LinePushDispatcher,
      ) => {
        const on = chat.replyReuse === 'on';
        new Logger('ChatModule').log(
          `admin send ladder = ${on ? 'reply-reuse → push' : 'push only'} (CHAT_REPLY_REUSE=${chat.replyReuse})`,
        );
        return on
          ? new ReplyReuseSendStrategy(core)
          : new PushOnlySendStrategy(core);
      },
    },
    LineApiService,
    // [FIX-20260808-VIDEORETRY] video re-download for retryVideoDownload
    LineContentService,
    ChatService,
    MembersService,
    // [FEAT-20260816-WALLETPAYCARD] self-contained read-only service.
    WalletpayHistoryService,
    ChatMediaService,
    // The write side of the chat screens. Exported for the webhook ingest
    // pipeline, which is wired in a later stage.
    ChatHistoryService,
    /* [FEAT-20260908-CHATTRANS] NOT exported: nothing outside chat calls it,
       and the capability anyone may call is `AiTranslateService`, not this. */
    ChatTranslateService,
    /* [FEAT-20260918-AUTOTRANS] the inbound plug, bound by env — the same shape
       as OUTBOUND_SEND_STRATEGY above, and for the same reason: a feature that
       can be turned off should be turned off by NOT EXISTING, not by a branch
       inside the code that runs anyway.

       `off` (default) resolves the token to `null`, so `@Optional()` in
       ChatHistoryService leaves `autoTranslate` undefined and the storage path
       runs exactly as it did before. Flip the env to `on` and the same path
       gains one `void` call. Logged once at boot so "is it live" is never a
       guess — the same courtesy the send ladder pays.
       ปิด = ไม่ผลสุทธิบจริง ๆ · revert: delete this provider + translate/auto/. */
    {
      provide: AUTO_TRANSLATE_INBOUND,
      inject: [chatConfig.KEY, AutoTranslateInboundService],
      useFactory: (
        chat: ConfigType<typeof chatConfig>,
        impl: AutoTranslateInboundService,
      ) => {
        const on = chat.autoTranslate === 'on';
        new Logger('ChatModule').log(
          `inbound auto-translate = ${on ? 'ON' : 'off (not plugged in)'} (CHAT_AUTO_TRANSLATE=${chat.autoTranslate})`,
        );
        return on ? impl : null;
      },
    },
    AutoTranslateInboundService,
  ],
  exports: [ChatService, MembersService, ChatMediaService, ChatHistoryService],
})
export class ChatModule {}
