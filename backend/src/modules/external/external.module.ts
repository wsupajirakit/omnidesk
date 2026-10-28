import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CryptoModule } from '@/infra/crypto';
/**
 * Imported from the schema file rather than the '@/modules/chat' barrel, and
 * that is required, not a shortcut: ChatModule now imports this module (its
 * refresh route calls CustomToolService), so going through the barrel makes the
 * cycle chat -> external -> chat and Node resolves the second leg to a
 * half-initialised module — `Member` arrives as `undefined` and the app dies at
 * boot. Same reasoning, same fix as the `User` import in hooks.module.ts.
 */
// eslint-disable-next-line no-restricted-imports
import { Member, MemberSchema } from '@/modules/chat/schemas/member.schema';
import {
  CustomTool,
  CustomToolSchema,
  Hook,
  HookSchema,
} from '@/modules/hooks';
import { SystemModule } from '@/modules/system';

import { CustomToolService } from './custom-tool.service';
import { ExternalApiService } from './external-api.service';
import {
  CustomToolTestController,
  HookOutboundController,
} from './hook-outbound.controller';
import { HookOutboundService } from './hook-outbound.service';

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
    ]),
    SystemModule,
    CryptoModule,
  ],
  /**
   * The five outbound POST routes are declared here, not in HooksModule: they
   * need ExternalApiService / CustomToolService, and this module already
   * imports `@/modules/hooks` for the schemas. See hook-outbound.service.ts.
   */
  controllers: [HookOutboundController, CustomToolTestController],
  providers: [ExternalApiService, CustomToolService, HookOutboundService],
  exports: [ExternalApiService, CustomToolService],
})
export class ExternalModule {}
