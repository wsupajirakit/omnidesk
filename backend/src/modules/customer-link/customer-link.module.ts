/**
 * Customer-Link — the single connector between this service and the Shop-API
 * counterpart that owns customer accounts.
 *
 * Kept as its own module for the same reason legacy kept `src/customer-link/`
 * as its own folder: it is a public, third-party-facing surface with a security
 * model of its own (encrypted link tokens, an in-process rate limiter), and it
 * must be removable without touching the webhook flow or the hook model.
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CryptoModule } from '@/infra/crypto';
/* [FEAT-20260827-PUSHCORE-F] candidate F — the ONE LINE sender. Imported as a
   MODULE (not a re-provided class) precisely because the thing this replaces was
   a re-provided class: `LineApiService` was listed in `providers` below so this
   module would not have to pull WebhookModule's graph in. `LineModule` exports
   its providers from day one (line.module.ts:13-18 records why), so importing it
   is enough and no bootleg copy is created.
   revert: drop this import + the `LineModule` entry in `imports`, and put
           `LineApiService` back in `providers` with its old comment. */
import { LineModule } from '@/infra/line';
import { RealtimeModule } from '@/infra/realtime/realtime.module';
// [FEAT-20260811-SUCCESSPUSH] ChatHistoryService writes the pushed notice into
// chat_messages as sender_type:'bot'. It has no constructor deps beyond Mongoose
// models + RealtimePublisher, so we provide it directly here (mirroring how
// LineApiService is provided below) instead of importing the whole ChatModule —
// that keeps this module removable and avoids pulling ChatModule's graph in.
// It needs ChatRoom + ChatMessage models on top of Member/Hook (already here).
// revert: ลบ ChatHistoryService provider + ChatRoom/ChatMessage models + import.
import {
  ChatHistoryService,
  ChatMessage,
  ChatMessageSchema,
  ChatRoom,
  ChatRoomSchema,
  Member,
  MemberSchema,
} from '@/modules/chat';
import { ExternalModule } from '@/modules/external';
import {
  CustomTool,
  CustomToolSchema,
  Hook,
  HookSchema,
} from '@/modules/hooks';
import { SystemModule } from '@/modules/system';

import { CustomerLinkRateLimitGuard } from './customer-link-rate-limit.guard';
import { CustomerLinkController } from './customer-link.controller';
import { CustomerLinkService } from './customer-link.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hook.name, schema: HookSchema },
      { name: CustomTool.name, schema: CustomToolSchema },
      { name: Member.name, schema: MemberSchema },
      /* [FEAT-20260827-WLOGONEDOOR] `WebhookLog` was registered here for the
         services that wrote the collection directly. They now write through
         `WebhookLogWriter` (exported by SystemModule, which is imported
         below and holds its OWN registration), so nothing in this module
         resolves the model token any more — verified by grep, not assumed.
         ไม่มีใครในโมดูลนี้ขอโมเดลนี้แล้ว จึงถอดออก */
      // [FEAT-20260811-SUCCESSPUSH] models ChatHistoryService.logMessage needs
      // (room resolve + write). Hook is already registered above.
      { name: ChatRoom.name, schema: ChatRoomSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
    CryptoModule,
    // [FEAT-20260827-PUSHCORE-F] gives this module `LinePushDispatcher`.
    LineModule,
    ExternalModule,
    SystemModule,
    RealtimeModule,
  ],
  controllers: [CustomerLinkController],
  providers: [
    CustomerLinkService,
    CustomerLinkRateLimitGuard,
    /* [FEAT-20260827-PUSHCORE-F] `LineApiService` used to be provided here — a
       second instance of the webhook flow's sender, living in this module. It is
       gone: the send goes through `LinePushDispatcher` from `LineModule` above.
       Checked before removing, not assumed: `grep -rn "lineApi\." src/modules/
       customer-link/` is now empty, so nothing in this module resolves it. */
    // [FEAT-20260811-SUCCESSPUSH] chat-history writer for the linked-notice row.
    ChatHistoryService,
  ],
  exports: [CustomerLinkService],
})
export class CustomerLinkModule {}
