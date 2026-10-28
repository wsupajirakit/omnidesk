import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { QueryCacheModule } from '@/infra/query-cache/query-cache.module'; // [FIX-20260810-QCACHEIMPORT]
import { User, UserSchema } from '@/modules/admin';
// [FEAT-20260808-AUDITSITE] AuditLogService for the clearTickets audit row
// (legacy ticketController.js:977).
import { AuditModule } from '@/modules/audit';
// [FEAT-20260905-CUSTPROV PART 4] see the note beside the import in `imports:`.
import { CustomerProviderModule } from '@/modules/customer-provider';
import {
  AssignHistory,
  AssignHistorySchema,
  ChatMessage,
  ChatMessageSchema,
  ChatRoom,
  ChatRoomSchema,
  CustomerTag,
  CustomerTagSchema,
  Member,
  MemberSchema,
  Tag,
  TagSchema,
} from '@/modules/chat';
import { ImageStorage, ImageStorageSchema } from '@/modules/content';
import { Group, GroupSchema, Hook, HookSchema } from '@/modules/hooks';
import { SystemModule } from '@/modules/system';

import { AssignHistoriesController } from './assign-histories.controller';
import { AssignHistoriesService } from './assign-histories.service';
import { InsightReportsController } from './insight-reports.controller';
import { InsightReportsService } from './insight-reports.service';
import { InsightRegistrationsService } from './insight-registrations';
import { Ticket, TicketSchema } from './schemas/ticket.schema';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    // [FIX-20260810-QCACHEIMPORT] InsightReportsService injects ScopedQueryCacheService.
    // @Global publishes it only once the module is in the graph — true for the app,
    // not for a TestingModule assembled from this module alone.
    QueryCacheModule,
    // [FEAT-20260808-AUDITSITE] provides AuditLogService to TicketsService.
    AuditModule,
    // [FEAT-20260808-GROUPB-INSIGHTCAT] provides SystemConfigService so the
    // insight report can read the acme_category flag that gates the
    // ai_handled by-category aggregation. SystemModule is a leaf (imports no
    // feature module) → no cycle.
    SystemModule,
    /* [FEAT-20260905-CUSTPROV PART 4] provides `CustomerProviderService` to
       `TicketsService`, which reads `tierPaths` for the ticket query and stamps
       `show_tier_badge` / `show_tier_filter` onto every list response.
       🔴 MISSING THIS DID NOT FAIL tsc AND DID NOT FAIL A SINGLE TEST — the
       specs construct `TicketsService` directly, so nothing assembled the module
       graph. It failed the only way it can: the application refused to BOOT,
       with `Nest can't resolve dependencies of the TicketsService … argument
       CustomerProviderService at index [9]`. Found by building and starting the
       server, which is why that step is not optional. เทสเขียวไม่ใช่หลักฐาน
       `CustomerProviderModule` is a leaf — it imports no feature module — so it
       cannot close a cycle here, the same reason `SystemModule` above is safe.
       revert: drop this import together with the constructor parameter in
       `tickets.service.ts`. */
    CustomerProviderModule,
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: AssignHistory.name, schema: AssignHistorySchema },
      { name: ChatRoom.name, schema: ChatRoomSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: Member.name, schema: MemberSchema },
      { name: CustomerTag.name, schema: CustomerTagSchema },
      // Targets of the list enrichment's populates. Registered here rather than
      // relied on from ChatModule, so the ticket list does not depend on another
      // module's load order to resolve `tag_id` and `internal_content_id`.
      { name: Tag.name, schema: TagSchema },
      { name: ImageStorage.name, schema: ImageStorageSchema },
      { name: User.name, schema: UserSchema },
      { name: Hook.name, schema: HookSchema },
      { name: Group.name, schema: GroupSchema },
    ]),
  ],
  controllers: [
    TicketsController,
    AssignHistoriesController,
    InsightReportsController,
  ],
  providers: [
    TicketsService,
    AssignHistoriesService,
    InsightReportsService,
    // [FEAT-20260820-REGINSIGHT] registration counts for the insight page.
    InsightRegistrationsService,
  ],
  exports: [TicketsService, AssignHistoriesService, InsightReportsService],
})
export class TicketsModule {}
