/** Public surface of the content module — import '@/modules/content'. */

/**
 * [FIX-20260808-FLEXVARMAP] The committed real-shape customer profile sample.
 * Exported through the barrel so tests can drive the runtime var-map build over
 * a realistic profile without a deep import into `flex-var/`.
 */
export { default as CUSTOMER_PROFILE_SAMPLE } from './flex-var/customer-profile-sample.json';

export * from './dto';
export { ContentModule } from './content.module';
export { MenusService } from './menus.service';
export { MenusController } from './menus.controller';
export { BroadcastsService } from './broadcasts.service';
export { BroadcastsReadService } from './broadcasts-read.service';
// [FEAT-2708-GUARDWINDOW] policy + the read-back sanitizer its spec pins
export * from './audience/sources/guard-window.policy';
export { sanitizeBroadcastRow } from './broadcast-payload.util';
export { BroadcastsController } from './broadcasts.controller';
export { AutoRepliesService } from './auto-replies.service';
export { AutoRepliesController } from './auto-replies.controller';
export { QuickRepliesService } from './quick-replies.service';
export { QuickRepliesController } from './quick-replies.controller';
/* [FEAT-20260901-OBJSCOPE] Exported through the barrel because the LINE reply
   path needs it too: `webhook.service.ts` already imports from '@/modules/content'
   (`ImageStorage`, `ObjectImage`), so the rule reaches its third call site with
   no new module edge and no `no-restricted-imports` violation. */
export * from './object-scope';
export { ObjectCategoriesService } from './object-categories.service';
export { ObjectCategoriesController } from './object-categories.controller';
export { ObjectImagesService } from './object-images.service';
export { ObjectImagesController } from './object-images.controller';
export { ImageStorageService } from './image-storage.service';
export { VideoStorageService } from './video-storage.service';
export { ImageStorageController } from './image-storage.controller';

export {
  AutoReply,
  AutoReplySchema,
  type AutoReplyAssignGroup,
  type AutoReplyDocument,
  type AutoReplyResponse,
} from './schemas/auto-reply.schema';
export {
  Broadcast,
  BroadcastSchema,
  type BroadcastAssignGroup,
  type BroadcastDocument,
  type BroadcastMessage,
  type BroadcastTarget,
} from './schemas/broadcast.schema';
export {
  ImageStorage,
  ImageStorageSchema,
  type ImageStorageDocument,
} from './schemas/image-storage.schema';
export { Menu, MenuSchema, type MenuDocument } from './schemas/menu.schema';
export {
  ObjectCategory,
  ObjectCategorySchema,
  type ObjectCategoryDocument,
} from './schemas/object-category.schema';
export {
  ObjectImage,
  ObjectImageSchema,
  type ObjectImageDocument,
} from './schemas/object-image.schema';
export {
  QuickReply,
  QuickReplySchema,
  type QuickReplyDocument,
} from './schemas/quick-reply.schema';
export {
  QuickReplyCategory,
  QuickReplyCategorySchema,
  type QuickReplyCategoryDocument,
} from './schemas/quick-reply-category.schema';

export {
  FlexMessagesService,
  type FlexMessageListItem,
} from './flex-messages.service';
// [FEAT-20260829-MENUPBGUIDE] exported so specs reach it through the barrel
export { buildMenuPostbackGuidelines } from './flex-var/menu-postback-guidelines';
export {
  FLEX_TYPE_MENU,
  normalizeFlexSubType,
  normalizeFlexSlug,
} from './flex-messages.service';
export { FlexMessagesController } from './flex-messages.controller';
export {
  BANK_DIRECTORY,
  BANK_LOGO_BASE,
  DEFAULT_COUNTRY,
  getBankInfo,
  normalizeBankKey,
  resolveBankLogo,
  resolveBankNiceName,
  type BankInfo,
} from './bank-directory';
export {
  CONTENT_MARKER_SRC,
  CONTENT_TAG_EMPTY,
  CONTENT_TAG_MAX,
  CONTENT_TAG_PREFIX,
  CONTENT_TOKEN_SRC,
  buildContentTagGuidelines,
  buildContentTagMap,
  contentTagMarker,
  contentTagName,
  contentTagToken,
  normalizeContentTags,
  parseContentMarkers,
  stripContentMarkers,
  type BuildContentTagMapResult,
  type ContentTag,
  type ContentTagGuideline,
} from './flex-content-tags.util';

/**
 * [FEAT-20260822-BCASTSEND] broadcast/multicast send contracts + pre-send checks.
 *
 * Exported here because the barrel is the only door into this module
 * (`no-restricted-imports` enforces it), and the specs must come through it
 * like any other consumer. NOTHING IN THE RUNNING SYSTEM IMPORTS THESE YET —
 * they are the phase-1 contract layer, wired to nobody. ยังไม่ต่อเข้าระบบ.
 *
 * revert: delete the four export lines below and the four folders they name.
 */
export * from './audience';
export * from './broadcast-send';
export * from './broadcast-var';
export * from './broadcast-follow-up';
export * from './broadcast-history';
export * from './broadcast-run';
export * from './broadcast-schedule';

export * from './content-actor-names.util';
export * from './content-broadcast-auto-reply.util';
export * from './content-oa-access.util';
