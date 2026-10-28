/**
 * ticketChatSource.ts — read "the ticket chat page's UI source" as ONE string.
 *
 * ==== WHY THIS EXISTS =======================================================
 * [REFACTOR-20260905-CUSTPROV] `pages/chat/TicketChat.tsx` used to declare eight
 * components below the page component: the composer and the seven pieces of the
 * right-hand column. They shared the file but never shared the page's state, so
 * they were moved into `components/chat/chat-input/` and
 * `components/chat/ticket-detail/`. Nothing about the rendered screen changed —
 * every moved body is byte-identical, and the only edit was adding `export`.
 *
 * Twenty-nine suites in this folder assert on that source as TEXT ("the close
 * button carries `tc-fixed-scale-1`", "`img.src = AVATAR_FALLBACK;` appears
 * exactly twice"). Their subject moved, not their claim — so the file they read
 * had to follow the code, or thirty green specs would have gone red for a
 * filing change.
 *
 * ⇒ This returns the page PLUS exactly the files it was split into, in the
 * order the code used to appear. The claim each suite makes is unchanged; only
 * the denominator is restored to what it was before the split. Counting
 * assertions (`toBe(2)`) keep working because concatenation preserves counts.
 * ⚠️ NOT ONE ASSERTION WAS DELETED OR LOOSENED to get these suites green.
 *
 * ==== THE ONE RISK, STATED PLAINLY ==========================================
 * A multi-line regex with an open gap (`[\s\S]{0,220}`) could now match ACROSS a
 * file boundary and pass on two unrelated fragments. The list below is exactly
 * the split of one former file and is kept in the original source order, so
 * adjacency is close to what it was — but this is a real, if small, loss of
 * precision, and it is the price of not rewriting thirty specs. A suite that
 * wants the old precision should read the single file it cares about instead of
 * calling this. ความแม่นลดลงนิดเดียว แต่ไม่มี assertion ไหนถูกลบ.
 *
 * [REFACTOR-20261027-TCSPLIT] Second split, same terms: the page's own markup and pure
 * helpers moved into `pages/chat/ticket-chat/` (state, effects and the realtime path did
 * not move). Those files are listed right after the page, in the order the code used to
 * appear in it, and the suites that pinned moved text switched to this union — again
 * with no assertion deleted or loosened.
 *
 * revert: when the eight components move back into the page, delete this file
 *   and point each caller's read at `pages/chat/TicketChat.tsx` again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * [REFACTOR-20261027-TCSPLIT] The page's OWN code: `TicketChat.tsx` plus the pieces its markup
 * and pure helpers were split into (`pages/chat/ticket-chat/`), in the order the code used to
 * appear in the page. This is exactly what `TicketChat.tsx` held before that split — so a
 * suite that read the page file alone (and COUNTS things in it) keeps the same denominator by
 * reading this; the older composer / right-panel split below is deliberately not included.
 */
export const TICKET_CHAT_PAGE_FILES = [
  'pages/chat/TicketChat.tsx',
  'pages/chat/ticket-chat/constants.ts',
  'pages/chat/ticket-chat/format.ts',
  'pages/chat/ticket-chat/derive/tier.ts',
  'pages/chat/ticket-chat/derive/groupOrder.ts',
  'pages/chat/ticket-chat/derive/groupTickets.ts',
  'pages/chat/ticket-chat/top-bar/TicketStatusPill.tsx',
  'pages/chat/ticket-chat/top-bar/TicketTopBar.tsx',
  'pages/chat/ticket-chat/list-column/ListFilters.tsx',
  'pages/chat/ticket-chat/list-column/EndedGroupCard.tsx',
  'pages/chat/ticket-chat/list-column/TicketCard.tsx',
  'pages/chat/ticket-chat/detail-column/DetailColumn.tsx',
  'pages/chat/ticket-chat/dialogs/QuickReplyModal.tsx',
  'pages/chat/ticket-chat/dialogs/FavGroupDialogs.tsx',
  'pages/chat/ticket-chat/dialogs/TagInfoModal.tsx',
  'pages/chat/ticket-chat/dialogs/ChatSettingsDialogs.tsx',
  'pages/chat/ticket-chat/dialogs/AssignHistoryModal.tsx',
  'pages/chat/ticket-chat/dialogs/PinTranslateDialogs.tsx',
] as const;

/** the page, then the files it was split into — in the old source order */
export const TICKET_CHAT_SOURCE_FILES = [
  ...TICKET_CHAT_PAGE_FILES,
  // the composer, and the five regions of its returned tree
  'components/chat/chat-input/ChatInputBox.types.ts',
  'components/chat/chat-input/ChatInputBox.tsx',
  'components/chat/chat-input/ComposerCaseOverlay.tsx',
  'components/chat/chat-input/ComposerToolbar.tsx',
  'components/chat/chat-input/ComposerTrays.tsx',
  'components/chat/chat-input/ComposerInputRow.tsx',
  // [FIX-20260910-TRANSLATEONEBOX] the send button left that row so the translate
  // strip could mount the same one — same split, same rule: the union follows.
  'components/chat/chat-input/ComposerSendButton.tsx',
  'components/chat/chat-input/ComposerSendErrorModal.tsx',
  'components/chat/chat-input/formatShortTime.ts',
  // the right-hand column
  'components/chat/ticket-detail/ticketPresentation.tsx',
  'components/chat/ticket-detail/ProfileHeader.tsx',
  'components/chat/ticket-detail/DetailSkeleton.tsx',
  'components/chat/ticket-detail/useCardSwitchLoading.ts',
  'components/chat/ticket-detail/PersonalPanel.tsx',
  'components/chat/ticket-detail/TransferCard.tsx',
  'components/chat/ticket-detail/OperationsPanel.tsx',
] as const;

/**
 * The PAGE alone. Use this when the claim really is about the page — "the page
 * mounts the composer twice, keyed by ticket" is about `TicketChat.tsx` and
 * nothing else, and counting it over the union would also count the composer's
 * own `React.FC<ChatInputBoxProps>` as a mount.
 */
export function ticketChatPageSource(): string {
  return readFileSync(join(process.cwd(), TICKET_CHAT_SOURCE_FILES[0]), 'utf8');
}

/**
 * The ticket page's UI source, concatenated. Raw — callers keep applying their
 * own comment-stripping, exactly as they did when this was one file.
 */
/** [REFACTOR-20261027-TCSPLIT] the page's own code — see `TICKET_CHAT_PAGE_FILES` */
export function ticketChatPageWithPieces(): string {
  return TICKET_CHAT_PAGE_FILES.map((rel) => readFileSync(join(process.cwd(), rel), 'utf8')).join('\n');
}

export function ticketChatSource(): string {
  return TICKET_CHAT_SOURCE_FILES.map((rel) =>
    readFileSync(join(process.cwd(), rel), 'utf8'),
  ).join('\n');
}
