// [REFACTOR-20261027-TCSPLIT] TicketChat's self-contained dialogs. None of them runs a case
// action — the accept / close / reopen / claim / busy-case dialogs stay in the page.
export { AssignHistoryModal } from './AssignHistoryModal';
export { ChatSettingsDialogs } from './ChatSettingsDialogs';
export { FavGroupDialogs } from './FavGroupDialogs';
export { PinTranslateDialogs } from './PinTranslateDialogs';
export { QuickReplyModal } from './QuickReplyModal';
export { TagInfoModal } from './TagInfoModal';
