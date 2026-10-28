// [REFACTOR-20260808-CMPGROUP] Barrel for the `chat` component group (chat gallery, chat room view,
// member profile, quick-reply manager, ticket toast, flex-slip card). App imports `../components/chat`.
// In-group edges (ChatRoomView -> ./ChatGallery, ./FlexSlipCard) stay relative; root hubs
// ConfirmModal/RegisterLinkCard via `../`. Named exports, no side effects -> behavior-identical.
// revert: `git mv components/chat/*.tsx components/`, delete folder, repoint importers back to
//   `../components/<File>` (App uses `./components/TicketToast`), restore `../` depth.
export * from './ChatGallery';
export * from './ChatRoomView';
export * from './MemberProfileModal';
export * from './QuickReplyManager';
export * from './TicketToast';
export * from './FlexSlipCard';
// [FEAT-20260819-INCHATTOAST] notice over the OPEN conversation (the card that has no badge)
export * from './NewMessageToast';
// [FEAT-20260819-REPLYUI] reply-to-a-message, UI only for now — the quote bar,
// the hover chip, the draft rules. Nothing here sends; see replyTarget.ts.
export * from './replyTarget';
export * from './useReplyDraft';
export * from './ReplyPreviewBar';
export * from './BubbleReplyButton';
// [FEAT-20260821-QUOTEREPLY] the quote block inside a bubble.
export * from './QuotedReference';
export * from './useTimedReveal';
/* [FEAT-20260908-AITRANSLATE] the translate chip, the language list and the
   two-layer bubble. All inert unless a page passes ChatRoomView's `onTranslate`
   prop — exporting them here changes nothing on its own. */
export * from './BubbleTranslateButton';
export * from './LanguagePicker';
export * from './TranslatedBubble';
// [FEAT-20260819-OPENFROMROOM] the dialog that opens the FIRST case for a room
export * from './OpenCaseModal';
