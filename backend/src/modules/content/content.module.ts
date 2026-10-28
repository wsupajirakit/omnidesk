import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { LineModule } from '@/infra/line';
import { AuditModule } from '@/modules/audit';
import {
  FlexMessage,
  FlexMessageSchema,
  Group,
  GroupSchema,
  Hook,
  HookSchema,
} from '@/modules/hooks';
import {
  Counter,
  CounterSchema,
  SystemModule,
  WebhookLog,
  WebhookLogSchema,
} from '@/modules/system';
/* [FEAT-20260903-BCASTSRFRESH] exports `CustomToolService`, the existing
   site-rules fetch pipe. `external/` imports nothing from `content/`, so this
   closes no cycle — checked with grep, not assumed. */
import { ExternalModule } from '@/modules/external';
import { AutoRepliesController } from './auto-replies.controller';
import { FlexMessagesController } from './flex-messages.controller';
import { FlexMessagesService } from './flex-messages.service';
import { AutoRepliesService } from './auto-replies.service';
import { BroadcastsController } from './broadcasts.controller';
import { BroadcastsReadService } from './broadcasts-read.service';
import { BroadcastsService } from './broadcasts.service';
import { ImageStorageController } from './image-storage.controller';
import { ImageStorageService } from './image-storage.service';
import { VideoStorageService } from './video-storage.service';
import { MenusController } from './menus.controller';
import { MenusService } from './menus.service';
import { ObjectCategoriesController } from './object-categories.controller';
import { ObjectCategoriesService } from './object-categories.service';
import { ObjectImagesController } from './object-images.controller';
import { ObjectImagesService } from './object-images.service';
import { QuickRepliesController } from './quick-replies.controller';
import { QuickRepliesService } from './quick-replies.service';
import {
  BroadcastNewSendPort,
  BroadcastNewSendService,
  BroadcastHistoryReadService,
  BroadcastPreviewService,
  BroadcastSchedulerDriver,
} from './broadcast-run';
import { MediaPickerController, MediaPickerService } from './media-picker';
import { AutoReply, AutoReplySchema } from './schemas/auto-reply.schema';
import {
  BroadcastHistory,
  BroadcastHistorySchema,
} from './schemas/broadcast-history.schema';
import { Broadcast, BroadcastSchema } from './schemas/broadcast.schema';
import {
  ImageStorage,
  ImageStorageSchema,
} from './schemas/image-storage.schema';
import { Menu, MenuSchema } from './schemas/menu.schema';
import {
  ObjectCategory,
  ObjectCategorySchema,
} from './schemas/object-category.schema';
import { ObjectImage, ObjectImageSchema } from './schemas/object-image.schema';
import {
  QuickReplyCategory,
  QuickReplyCategorySchema,
} from './schemas/quick-reply-category.schema';
import { QuickReply, QuickReplySchema } from './schemas/quick-reply.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Menu.name, schema: MenuSchema },
      { name: Broadcast.name, schema: BroadcastSchema },
      { name: AutoReply.name, schema: AutoReplySchema },
      { name: QuickReplyCategory.name, schema: QuickReplyCategorySchema },
      { name: QuickReply.name, schema: QuickReplySchema },
      { name: ObjectCategory.name, schema: ObjectCategorySchema },
      { name: ObjectImage.name, schema: ObjectImageSchema },
      { name: ImageStorage.name, schema: ImageStorageSchema },
      { name: Hook.name, schema: HookSchema },
      { name: Group.name, schema: GroupSchema },
      { name: FlexMessage.name, schema: FlexMessageSchema },
      // Running flex_tag numbers come from the shared counters collection.
      { name: Counter.name, schema: CounterSchema },
      // [FIX-20260808-BROADCASTSEND] Broadcast send writes one webhook_log row
      // per hook (success/error), so BroadcastsService needs the model.
      { name: WebhookLog.name, schema: WebhookLogSchema },
      /* [FEAT-20260822-BCASTWIRE] The run-history rows. Registering the model
         creates nothing by itself — the collection appears when the first row
         is written, and its indexes build on an empty collection, which is
         instant. `members`/`chat_rooms` are deliberately NOT here: their
         schemas live behind `@/modules/chat`, which already imports this
         barrel, so registering them would close a module cycle. The send
         service asks the connection for those two at call time instead. */
      { name: BroadcastHistory.name, schema: BroadcastHistorySchema },
    ]),
    // Flex create/update/delete each write an audit entry.
    AuditModule,
    /**
     * [FEAT-20260822-BCASTWIRE] For `LinePushDispatcher`, which the broadcast
     * send path injects — the WRAPPER, never `LinePushService`, because the
     * wrapper is where phase 4 swaps the queue in.
     *
     * ⚠️ This is the first time ContentModule reaches LINE. `chat.module.ts:13`
     * already imports the same module for the same provider, so the path is
     * proven rather than new. เส้นนี้มีคนเดินแล้ว ไม่ใช่ของใหม่.
     */
    LineModule,
    /**
     * For `TranslationDictCacheService`, which renders the example column of
     * `GET /api/flex-messages/variables` through the same in-process dictionary
     * the customer-facing cards use.
     */
    SystemModule,
    /**
     * [FEAT-20260903-BCASTSRFRESH] For `CustomToolService` — a broadcast run
     * refreshes each OA's site rules once before rendering, on the SAME pipe
     * the panel's Refresh button uses. Without this import the injection is
     * `undefined` (it is `@Optional()`) and every run silently falls back to
     * the stored blob, which is the old behaviour and not an error — so the
     * wiring has to be verified here rather than trusted to fail loudly.
     * ต่อไม่ครบ = กลับไปใช้ของเก่าเงียบ ๆ ไม่ error ⇒ ต้องเช็คตรงนี้เอง.
     */
    ExternalModule,
  ],
  controllers: [
    MenusController,
    BroadcastsController,
    AutoRepliesController,
    QuickRepliesController,
    ObjectCategoriesController,
    ObjectImagesController,
    ImageStorageController,
    FlexMessagesController,
    MediaPickerController,
  ],
  providers: [
    MenusService,
    BroadcastsService,
    /* [FEAT-20260823-BCASTSVCSPLIT] the read half. */
    BroadcastsReadService,
    /**
     * [FEAT-20260822-BCASTWIRE] The new send pipeline, bound to the seam the
     * live sender branches into.
     *
     * 🔴 PROVIDING IT DOES NOT ENABLE IT. `BROADCAST_NEW_PATH_ENABLED` is still
     * `false`, and `broadcasts.service.ts` needs BOTH that flag and this
     * provider before a single byte goes out the new way. What this line
     * changes is that the second lock is now closeable — before it, the switch
     * could not have worked even if somebody flipped it.
     * ต่อสายแล้ว แต่ยังไม่ได้เปิด — สวิตช์ยังปิดอยู่.
     *
     * revert: delete this provider. The old sender is untouched and resumes
     * being the only path, exactly as before.
     */
    BroadcastNewSendService,
    /* [FEAT-20260823-BCASTPREVIEW] Reads and renders; reaches no dispatcher. */
    BroadcastPreviewService,
    /* [FEAT-20260823-BCASTHISTREAD] Read-only: one find, no writes. */
    BroadcastHistoryReadService,
    /* [FEAT-20260823-BCASTCRON] The only timer. Refuses unless a job opted in. */
    BroadcastSchedulerDriver,
    { provide: BroadcastNewSendPort, useClass: BroadcastNewSendService },
    AutoRepliesService,
    QuickRepliesService,
    ObjectCategoriesService,
    ObjectImagesService,
    ImageStorageService,
    VideoStorageService,
    FlexMessagesService,
    MediaPickerService,
  ],
  exports: [
    MenusService,
    BroadcastsService,
    AutoRepliesService,
    QuickRepliesService,
    ObjectCategoriesService,
    ObjectImagesService,
    ImageStorageService,
    FlexMessagesService,
    MediaPickerService,
  ],
})
export class ContentModule {}
