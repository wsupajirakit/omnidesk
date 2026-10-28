/** Public surface of the chat module — import '@/modules/chat'. */

export * from './chat.module';
export * from './chat.service';
export * from './chat.controller';
export * from './dto';
export * from './members.service';
export * from './members.controller';
export {
  AssignHistory,
  AssignHistorySchema,
  type AssignHistoryDocument,
} from './schemas/assign-history.schema';
export {
  ChatMessage,
  ChatMessageSchema,
  /* [FEAT-20260908-CHATTRANS] the stored-translation subdocument. Exported so a
     spec can build one without a deep path into `schemas/`. */
  MessageTranslation,
  MessageTranslationSchema,
  type ChatMessageDocument,
} from './schemas/chat-message.schema';
export {
  ChatRoomNote,
  ChatRoomNoteSchema,
  type ChatRoomNoteDocument,
} from './schemas/chat-room-note.schema';
export {
  ChatRoom,
  ChatRoomLastMessage,
  ChatRoomSchema,
  type ChatRoomDocument,
} from './schemas/chat-room.schema';
export {
  CustomerTag,
  CustomerTagSchema,
  type CustomerTagDocument,
} from './schemas/customer-tag.schema';
export {
  Member,
  MemberSchema,
  type MemberDocument,
} from './schemas/member.schema';
export { Tag, TagSchema, type TagDocument } from './schemas/tag.schema';

export {
  ChatHistoryService,
  type ChatProfileHint,
  type IdLike,
  type LogMessageInput,
  type LogSystemMessageInput,
} from './chat-history.service';
export {
  ChatMediaService,
  MEDIA_SEND_UNPORTED,
  type UploadedImageFile,
} from './chat-media.service';
export { ChatMediaController } from './chat-media.controller';
export {
  mirrorPair,
  mirrorUpdatePair,
  type MirroringQuery,
} from './schemas/mirror-field-pair';

// [FIX-20260808-CHANNELSEND] channel-agnostic send-adapter layer (mirrors the
// legacy channels/ module). Exported so tests and future channels import via
// the barrel, per the no-restricted-imports rule.
export {
  ChannelRegistry,
  // [FIX-20260827-CGATECHANNEL] the transport predicate the chat send gates use
  servedByLineCore,
} from './channels/channel-registry';
// [FEAT-20260821-QUOTEREPLY] the send ladder — two strategies, one binding.
export {
  OUTBOUND_SEND_STRATEGY,
  PushOnlySendStrategy,
  ReplyReuseSendStrategy,
} from './channels/outbound-send-strategy';
export type {
  OutboundSendOutcome,
  OutboundSendPlan,
  OutboundSendStrategy,
  ReplyCandidate,
} from './channels/outbound-send-strategy';
export {
  REPLY_TOKEN_TTL_MS,
  findReplyCandidate,
  resolveQuoteToken,
  // [FEAT-20260831-QUOTESRC] read side: the quoted message for a page of bubbles
  resolveQuotedPreviews,
  withQuotedPreviews,
} from './channels/quote-reply-lookup';
export type {
  ResolvedQuote,
  QuotedPreview,
} from './channels/quote-reply-lookup';
export {
  LineSendAdapter,
  // [FEAT-20260821-CHATPUSHCORE] reused by the migrated call sites so the
  // operator-facing failure wording survives the move to the push core.
  extractLineReason,
} from './channels/line-send-adapter';
// [FEAT-20260816-MULTIIMG] exported for the spec (z-test must import through
// the barrel — no-restricted-imports); chat-media.service uses the relative
// path inside the module.
export {
  LINE_MAX_MESSAGES_PER_PUSH,
  planImagePushBatches,
  type ImagePushBatch,
} from './channels/outbound-image-batch';
// [FEAT-20260814-ADMINPUSHLOG] outbound audit helper — exported for the same
// reason as the adapters above: tests (and any future channel) must reach it
// through the barrel, never by deep path (`no-restricted-imports`).
export {
  logOutboundPush,
  OUTBOUND_PUSH_ACTION,
  type OutboundAuditContext,
  type OutboundAuditLogger,
  type OutboundAuditResult,
} from './channels/outbound-audit';
// [FEAT-20260821-ABANDONSHIELD] audit helper for the abandon-shield flip —
// exported for the same reason as `logOutboundPush` above: the spec must reach
// it through the barrel, never by deep path (`no-restricted-imports`).
export {
  auditAbandonShieldFlip,
  type AbandonAuditInput,
  type AbandonAuditWriter,
} from './member-abandon-audit.helper';
/* [FEAT-20260829-MANUALFOLLOWSTAMP] revert: delete this export block with the helper. */
export {
  auditFollowStampSet,
  buildFollowStampNote,
  FOLLOW_STAMP_KEY_BY_KIND,
  FOLLOW_STAMP_KINDS,
  isFollowStampKind,
  readRegistrationPair,
  readStoredStamp,
  stampIsEmpty,
  type FollowStampAuditWriter,
  type FollowStampKind,
} from './member-follow-stamp.helper';
/* [FEAT-20260908-CHATTRANS] the translate slice. Everything here is exported for
   the same reason the two audit helpers above are: `z-test/` must reach the real
   function through the barrel, never a deep path. `ChatTranslateService` is NOT
   exported from the MODULE (nothing outside chat calls it) — this is the
   package surface, which is a different question.
   revert: delete this block with `src/modules/chat/translate/`. */
export { ChatTranslateController } from './translate/chat-translate.controller';
export {
  ChatTranslateService,
  type ChatTranslateResult,
} from './translate/chat-translate.service';
export {
  TranslateChatMessageDto,
  TranslateChatPreviewDto,
} from './translate/chat-translate.dto';
export {
  checkVendorKey,
  vendorKeyProblemMessage,
  type SecretDecryptor,
  type VendorCredential,
  type VendorKeyProblem,
} from './translate/translate-key-check';
export {
  outboundTranslationEntry,
  pushMessageTranslation,
  type MessageTranslationEntry,
  type PushableTranslationEntry,
  type TranslationStoreModel,
} from './translate/translation-store';
export {
  auditMessageTranslate,
  type TranslateAuditInput,
  type TranslateAuditWriter,
} from './translate/translate-audit.helper';
export {
  buildPreviewRateLimitIdentifier,
  previewRateLimitMessage,
  PREVIEW_RATE_LIMIT_BUCKET,
  PREVIEW_RATE_LIMIT_KEY_SUFFIX,
} from './translate/preview-rate-limit';
export type { SendAdapter } from './channels/send-adapter';
export type { OutboundMessage, SendContext } from './channels/outbound-message';
// [PERF-20260821-MEMBERSEARCH] search-bucket derivation (pure) — the ticket search and the schema hooks share it.
export * from './schemas/member-search-tokens';
// [FEAT-20261016-LOGMASK80] the owner's head-kept `*` mask — the webhook log reuses it for loan personal values.
export { maskValue } from './site-rules/redact-site-rules';
