/**
 * Barrel for `components/chat/chat-input` — the ticket page's message composer.
 *
 * WHAT: `ChatInputBox` and the five presentational regions it was split into
 * used to live inside `pages/chat/TicketChat.tsx`. `formatShortTime` came with
 * them because the case overlay prints with it; the page still uses it too, so
 * it is re-exported here rather than duplicated.
 *
 * WHY a barrel: the page imports THIS and nothing else from the folder, so a
 * future re-cut inside the folder never touches the page.
 *
 * ⚠️ Leaf files import each other DIRECTLY (`./ComposerToolbar`), never through
 * this barrel — a leaf importing its own barrel is a cycle waiting to happen.
 *
 * revert: delete this file after moving the component back; see each file's own
 *   header for its individual steps.
 */
export { ChatInputBox } from './ChatInputBox';
export { formatShortTime } from './formatShortTime';
export type { ChatInputBoxProps, SendErrorState } from './ChatInputBox.types';
/* the five regions are exported so they can be tested and re-composed on their
   own; the page has no reason to name any of them. */
export { ComposerCaseOverlay } from './ComposerCaseOverlay';
export { ComposerToolbar } from './ComposerToolbar';
export { ComposerTrays } from './ComposerTrays';
export { ComposerInputRow } from './ComposerInputRow';
export { ComposerSendButton } from './ComposerSendButton';
export { ComposerSendErrorModal } from './ComposerSendErrorModal';
/* [FEAT-20260908-AITRANSLATE] the preview strip — the sixth region, and the only
   one that can cost money. It renders nothing until the admin presses แปล. */
export { ComposerTranslateTray } from './ComposerTranslateTray';
export type { ComposerTranslatePreview } from './ComposerTranslateTray';
