/**
 * TicketChat.tsx
 * Unified Ticket + Chat page (chat-first interface)
 *
 * Replaces the legacy DataTable ticket view at /ticket-support with a 3-column
 * chat interface. The legacy TicketSupport table stays reachable at
 * /legacy-ticket.
 *
 * ⚠️ WHICH FILE IS THE LIVE PAGE — the naming is a trap
 *   /ticket-support → **this file** (TicketChat.tsx). THE LIVE PAGE.
 *   /legacy-ticket  → TicketSupport.tsx. The old table, still reachable.
 * The route called `/ticket-support` does NOT render `TicketSupport.tsx`. A
 * change made on the file whose NAME matches the route lands on a page nobody
 * opens — that already cost a full round of work on 2026-08-19, when the
 * new-message badge was built on the legacy file and never appeared.
 * ⇒ anything an operator must SEE goes here. หน้าที่ใช้จริงคือไฟล์นี้.
 *
 * Layout: [ conversation list ] [ chat (ChatRoomView) ] [ personal / operations ]
 * Reuses ticketService + chatService (no new endpoints) and the shared
 * ChatRoomView for the message stream. Dark mode = the reference "comfort"
 * palette, applied via the `.tc` scope in index.html + the theme-dark toggle.
 *
 * DB impact: NONE (frontend page).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tierOfMember } from '../../utils/memberTier';
// [FIX-20260905-TIERFILTERSTUCK] the two tier switches, and the clear-on-hide
// rule that a hidden filter needs — see that file for the case it prevents.
import { tierSwitchesFrom, type TierSwitchResponse } from '../../utils/tierSwitches';
import { createPortal } from 'react-dom';
import {
  Loader2, MessageSquare,
  Plus, StickyNote,
  Image as ImageIcon,
  Trash2, ChevronUp,
  ChevronLeft, ChevronRight,
  // [FIX-20260731-PENDINGARROW] ลูกศรตรงในการ์ด "รอทำรายการ" ตามไฟล์ต้นแบบ
  // (fa-arrow-down / fa-arrow-up) — ไม่ใช่ chevron ที่เป็นหัวลูกศรอย่างเดียว
  ArrowDown, ArrowUp,
  // [FEAT-20260729-COPYALL] reveal toggle for the masked bank account number
  Eye, EyeOff,
  // [FEAT-20260815-LINEQUOTA] the ⓘ on the LINE OA row reuses `Info`, already
  // imported above for the web-data card — one icon, one import.
  // [FEAT-20260830] icon ของปุ่มตั้งค่าขนาดตัวอักษร (Maximize2 went with the
  // composer toolbar — see components/chat/chat-input/ComposerToolbar.tsx)
  ALargeSmall,
} from 'lucide-react';
import { AssignHistoryEntry } from '../../types';
import { getStoredAuth } from '../../services/authStorage';
import { userService } from '../../services/admin';
import { webhookService } from '../../services/hook';
import { ticketService, TicketEntry } from '../../services/chat';
// [PERF-20260822-TKTIDSFETCH] ดึงเฉพาะใบที่ระบุ — ตรรกะ + ทางตกกลับ เทสแยกได้
import { usePartialTicketFetch } from '../../services/chat/usePartialTicketFetch';
import { ticketIdsKey } from '../../services/chat/noCaseRefresh';
import { activeListParams, activePagingEnabled } from '../../services/chat/activeListParams';
import { mergePartialTickets } from '../../services/chat/partialTicketMerge';
import { chatService, ChatRoom, CustomerNote, CustomerTag } from '../../services/chat';
// [FEAT-20260811-CHATPIN] ปักหมุดห้องแชท — ตรรกะแยกไฟล์ ที่นี่แค่เรียกใช้
import { readPinned, togglePin, persistPinned, byPinnedFirst } from '../../services/chat';
import { assignHistoryService } from '../../services/chat';
import { configService } from '../../services/admin';
import { groupService } from '../../services/admin';
import { filterVisibleHooks, isSuperRole, isTicketOnly } from '../../services/admin';
// [FEAT-20260801-ONEROW] โหมดแถบบน — ต้องอ่านจากที่เดียวกับ App.tsx
import { isCompactTopBar } from '../../hooks/topBarMode';
import { HookData } from '../../types';
import { usePreference } from '../../hooks/usePreferences';
// [FEAT-20260830-CHATFONT] revert: ลบ import + state + ปุ่ม + modal
import {
  CHAT_FONT_SCALE_PATH,
  CHAT_FONT_SCALE_DEFAULT,
  normalizeChatFontScale,
} from '../../hooks/chatFontScale';
// [FEAT-20260830-TRAYFULL] revert: ลบ import + state + ปุ่ม + modal
import {
  CHAT_TRAY_MODE_PATH,
  CHAT_TRAY_MODE_DEFAULT,
  normalizeChatTrayMode,
} from '../../hooks/chatTrayMode';
import { useTicketWS } from '../../services/chat';
// [FIX-20260819-UNREADKEY] one shared rule for "which key holds this card's unread
// count" — used by the card badge AND the tab colour, so they cannot drift apart.
import { unreadFor } from '../../services/chat';
/* [FEAT-20260820-MSGGLOW] who may light the group tab — see that file. */
import { groupStillHasUnread, messageLightsGroupTab } from '../../services/chat/ticketAlerts';
import { useI18n, translateNow } from '../../i18n';
import { ChatRoomView } from '../../components/chat';
/* [FEAT-20260908-AITRANSLATE] this page is the ONE screen that gets the translate
   chip (owner's decision 8). `Chat.tsx`, `Contact.tsx` and `TicketSupport.tsx`
   share `ChatRoomView` and simply do not pass `onTranslate`, so they render
   byte-identically with no edits at all — which is what
   `test/chatTranslateOptional.value.test.ts` pins by reading their source. */
import type { TranslateTarget } from '../../components/chat';
import { aiTranslateService, translateErrorText } from '../../services/chat/aiTranslateService';
/* [FEAT-20260819-REPLYUI] reply-to-a-message, UI only. The page still owns the
   HANDLE that lets a bubble start a reply (`replyApiRef` below, hence the type);
   the draft itself is `useReplyDraft` inside components/chat/chat-input, which
   is where the composer now lives. No global store, no event bus.
   หน้านี้ถือแค่สายต่อ ส่วน state ของ draft อยู่ที่กล่องพิมพ์. */
import { type ReplyTarget } from '../../components/chat';
/* [FEAT-20260819-ORPHANROOM] conversations that never became a case. Derived by
   subtracting tickets from rooms — no schema field, nothing stored, and the row
   stops being an orphan by itself the moment a case exists for that customer. */
import { roomAsPseudoTicket, ORPHAN_FLAG, isQuietRow, botTabRows } from '../../services/chat';
// [FEAT-20260819-NEWESTTOP] the live-activity clock helpers, shared with the other
// ticket screen so both order rows by the same rule
import { markMessageAt, activityAt, customerEventKey } from '../../services/chat';
// [FEAT-20260819-CARDWINDOW] render 25, reveal on scroll — render-only, see the hook
import { useCardWindow, closedListParams } from '../../services/chat';
import { OpenCaseModal } from '../../components/chat';
import { TicketCategoryBadge, categoryOptionsFor, useProviderTicketCategories } from '../../components/ticket-category';
import { useProviderHiddenSections } from '../../hooks/useProviderSectionHidden';
import { ConfirmModal } from '../../components/modals';
/* [FEAT-20260827-PATCHAFTERCLOSE] กล่องยืนยันปิดเคสแบบแบ่ง section แทนตัวเลือกใบเดียว
   ⚠️ `CloseCaseFollowUpChoice` (26/08) **ยังอยู่ครบ** พร้อมเทสของมัน — ถอดตัวใหม่ออก
      แล้วเรียกตัวเก่ากลับได้ทันที ดู revert ที่หัวไฟล์ `CloseCaseSections.tsx` */
import {
  CloseCaseSections,
  closeCaseTopicsFor,
  withoutHiddenTopics,
  missingTopics,
  type CloseCaseAnswers,
  type CloseCaseTopic,
} from '../../components/member/follow-up/CloseCaseSections';
/* [FEAT-20260830-CLOSEWIZARD] the walkthrough's rules live in their own file —
   this page only wires them. revert: drop this import + the hook call + the
   three props on CloseCaseSections and the two on ConfirmModal. */
import { useCloseCaseWizard } from '../../components/member/follow-up/useCloseCaseWizard';
/* [FEAT-20260830-FOLLOWUPFRESH] read the follow-up stamps when the close dialog
   opens, instead of trusting the room loaded minutes ago. See the effect below.
   revert: drop this import, the effect, and `freshRoom ?? selectedRoom`. */
import {
  readFollowStamps,
  snapshotToRoomShape,
} from '../../services/chat/followStampService';
/* [FEAT-20260826-STRIKESUSPEND] the avatar's strike mark and the stats modal
   went with ProfileHeader — see components/chat/ticket-detail/ProfileHeader.tsx
   for the imports and the `strike*` state block that used to be tagged here. */
// ==== [FEAT-20260731-CONTACTS] การ์ดข้อมูลลูกค้า + helper ที่ย้ายออกไปเป็นไฟล์กลาง
// เดิมประกาศอยู่ในไฟล์นี้ทั้งหมด · ย้ายออกเพื่อให้หน้า Contacts ใช้ "ตัวเดียวกัน"
// ไม่ใช่ก็อปไปอีกชุด (สองชุด = แก้ทีต้องแก้สองที่ แล้วสองหน้าจะแสดงไม่ตรงกัน)
// ตรรกะไม่ถูกแก้เลย ย้ายอย่างเดียว — ดูรายละเอียดในหัวไฟล์ปลายทาง
// revert: ย้ายเนื้อกลับมาไว้ตำแหน่งเดิม แล้วลบ import บรรทัดนี้
import {
  adminLabel,
  // หมายเหตุ: ไม่ import getDynamicTagDotColor — ก่อนย้าย มันถูกใช้ที่เดียวคือ
  // ข้างใน CustomerTags ซึ่งตอนนี้ย้ายไปอยู่ไฟล์กลางแล้ว ไฟล์นี้จึงไม่ต้องใช้
  // (import มาแล้วไม่ใช้ = ขยะที่คนอ่านทีหลังต้องมานั่งเดาว่าเผื่อไว้ทำไม)
} from '../../components/member';
// [FEAT-20260801-CONTACTTABS] PersonalPanelNarrow (the panel the Contact page
// shares) is now imported by components/chat/ticket-detail/PersonalPanel.tsx,
// which is the only place that ever chose between it and the legacy panel.
/* [REFACTOR-20260905-CUSTPROV] the three helpers are NOT panel API — they moved
   to components/common, where chat/ticket/contact share them without importing
   each other's feature folders. */
import { parseCustomerDetail } from '../../components/common';
// [FIX-20260814-TICKETIDENTITY] identity + naming rules, extracted for testing
import {
  formatIdentityPair,
  getTicketUserKey,
  isSameTicketUser,
} from './ticketIdentity';
import { resolveRoom } from './resolveRoom';
// [FIX-20260817-SEARCHRAWPROFILE] one reader/matcher for the customer search box
import { memberMatchesSearch } from '../../utils/memberSearchText';
// [FEAT-20260817-REOPENBYADMIN] the activeTickets card after a reopen — see its header
import { buildReopenedTicketCard } from './reopenTicketCard';
// [FEAT-20260824-CLAIMPROFILE] กฎ "เคสเพิ่งเป็นของเรา" อยู่ไฟล์เดียว — ดูเหตุผลในไฟล์นั้น
import { shouldFireCaseTaken, type CaseOwnership } from './caseTakenRefresh';
import { chatOpenedDetail } from './chatOpenedRefresh';
import { shouldRefreshPanel } from './panelRefresh';
/* [FEAT-20260907-TABSEEN] taking the orange OFF a status tab. It adds a term to the
   colour composition and changes nothing that decides when the colour goes on.
   ref: todo/task/07092026/fe_todo114_07092026_tabglowclear.md */
import { markTabSeen, noTabLit, NOTHING_SEEN, tabIsLit, type TabSeen } from './tabSeen';
/* [FEAT-20261020-TICKETSTACK] same customer + same OA folded into one stack (flag, default OFF).
   Whole feature lives in ./ticket-stack — see its index.ts. */
import {
  groupTicketStacks, isTicketStackOn, renderTicketStackSlot, useStackExpand,
} from './ticket-stack';
// [REFACTOR-20261027-TCSPLIT] this page's own pieces — see ./ticket-chat/index.ts
import {
  CATEGORIES_LEGACY,
  CATEGORIES_NARROW,
  DATE_SCOPE_OPTIONS,
  STATUS_TABS,
  TICKET_SEARCH_MIN_CHARS,
  isBotModeTicket,
  type StatusTab,
} from './ticket-chat';
import {
  AssignHistoryModal,
  ChatSettingsDialogs,
  FavGroupDialogs,
  PinTranslateDialogs,
  QuickReplyModal,
  TagInfoModal,
} from './ticket-chat/dialogs';
import { EndedGroupCard, ListFilters, TicketCard } from './ticket-chat/list-column';
import { TicketStatusPill, TicketTopBar } from './ticket-chat/top-bar';
import { DetailColumn } from './ticket-chat/detail-column';
import {
  buildTierFilterOptions, groupBotTickets, groupEndedTickets, orderGroups, sortVisibleGroups, tierKeyOf,
} from './ticket-chat/derive';
/* [REFACTOR-20260905-CUSTPROV] composerHeightMemory, composer-trays and
   composerHeightPref are imported by components/chat/chat-input/* now — the
   composer is the only thing that ever read them. */
import { SearchableSelect, SelOpt } from '../../components/member';
import { ownershipPatch } from '../../utils/selectedTicketSync';
// ==== [FEAT-20260731-CONTACTS] END
// [FIX-20260728-SENDERR] ใช้แทน browser alert() ตอนส่งข้อความไม่สำเร็จ
// revert: ลบ import นี้
import { AlertModal } from '../../components/modals';

/* [REFACTOR-20260905-CUSTPROV] the eight components that used to be declared at
   the bottom of this file. Barrel imports only — see the note above `export
   default` for what moved and why. */
import { ChatInputBox } from '../../components/chat/chat-input';
import { getCategoryBadge } from '../../components/chat/ticket-detail';

// [FEAT-20260801-CONTACTTABS] LineLogoIcon ถูก "ย้าย" ออกจากไฟล์นี้
// [FIX-20260905-LINELOGO] และย้ายต่อไป components/common/LineLogoIcon.tsx — มันเคยมีสองชุด
//   และวาดคนละแบบ (ดู header ของไฟล์นั้น) ตอนนี้เหลือชุดเดียว
// เพื่อให้หน้า Contacts ใช้ตัวเดียวกัน (ไม่ก็อปสองชุด) · ตรรกะไม่ถูกแก้ ย้ายอย่างเดียว
// revert: ย้ายเนื้อกลับมาตำแหน่งเดิม แล้วลบ import ที่หัวไฟล์


// [FEAT-20260731-CONTACTS] SearchableSelect ถูกย้ายไป
// components/member/SearchableSelect.tsx เพื่อให้หน้า Contacts ใช้ตัวเดียวกัน


// [REFACTOR-20261027-TCSPLIT] category options, label keys, STATUS_TABS and
// DATE_SCOPE_OPTIONS (with their history) → ./ticket-chat/constants.ts — values unchanged.


// [FEAT-20260731-CONTACTS] โค้ดส่วนนี้ถูก "ย้าย" ไป components/member/CustomerCards.tsx
// เพื่อให้หน้า Contacts ใช้ตัวเดียวกัน (ไม่ใช่ก็อปไปอีกชุด) — ดู import ด้านบน


// [REFACTOR-20261027-TCSPLIT] SHOW_DATE_SCOPE (with its history) → ./ticket-chat/constants.ts

/* ==== [REFACTOR-20260905-CUSTPROV] AVATAR_FALLBACK · formatShortTime ·
   getCategoryBadge moved out of this file ====================================
   They are declared in the folders that the components which use them moved
   to, and imported back above:
     · AVATAR_FALLBACK, getCategoryBadge -> components/chat/ticket-detail/ticketPresentation.tsx
     · formatShortTime                   -> components/chat/chat-input/formatShortTime.ts
   WHY they could not simply stay here: `ProfileHeader`, `OperationsPanel` and
   `ComposerCaseOverlay` all read them, and those components now live in those
   folders. A leaf importing back from this page while this page imports the
   folder's barrel is an import cycle — and `AVATAR_FALLBACK` is a `const`, so a
   cycle could hand a leaf `undefined` at module-init time. One direction only:
   page -> barrel -> leaf.
   Not one byte of any of the three bodies changed; each gained only `export`.
   revert: paste the three declarations back here and drop them from the two
           import lines above. */

// [FEAT-20260731-CONTACTS] โค้ดส่วนนี้ถูก "ย้าย" ไป components/member/CustomerCards.tsx
// เพื่อให้หน้า Contacts ใช้ตัวเดียวกัน (ไม่ใช่ก็อปไปอีกชุด) — ดู import ด้านบน

/* [FIX-20260829-ROOMRESOLVE] ย้ายไป `./resolveRoom` เพื่อให้เขียนเทสให้มันได้
   — ไฟล์นี้ 6,338 บรรทัด import เข้าเทสไม่ไหว · ตรรกะไม่เปลี่ยนแม้แต่ไบต์เดียว
   ในคอมมิตนี้ · เหตุผลเต็มและบั๊กที่จะแก้ต่อ อยู่ในหัวไฟล์นั้น */

// [FEAT-20260801-CONTACTTABS] + [REFACTOR-20260905-CUSTPROV] getCustomerPhone อยู่ที่
//   components/common/customerDetail.ts — ไฟล์นี้ใช้มันนอกแผง จึงไม่ควรอยู่ในแผง
// เพื่อให้หน้า Contacts ใช้ตัวเดียวกัน (ไม่ก็อปสองชุด) · ตรรกะไม่ถูกแก้ ย้ายอย่างเดียว
// revert: ย้ายเนื้อกลับมาตำแหน่งเดิม แล้วลบ import ที่หัวไฟล์

// [FEAT-20260801-CONTACTTABS] + [REFACTOR-20260905-CUSTPROV] parseCustomerDetail อยู่ที่
//   components/common/customerDetail.ts (เหตุผลเดียวกับ getCustomerPhone)
// (แผงนั้นใช้ด้วย) · ตรรกะไม่ถูกแก้ ย้ายอย่างเดียว

// ==== [FEAT-20260729-IDENTITY] — moved to ./ticketIdentity.ts
// [FIX-20260814-TICKETIDENTITY] These rules (identity priority, the "Line :"
// label, and who counts as the same customer) now live in a sibling module so
// they can be unit-tested; this file is on the max-lines waiver and could not
// grow to host the tests' seams. Two bugs were fixed in the move — the backend
// "Unknown" placeholder no longer outranks a real name, and identity no longer
// falls back to comparing display names, which used to highlight two different
// customers at once. Behaviour is otherwise unchanged; see that file's header.
// revert: paste the functions back here and drop the import below.

// [REFACTOR-20261027-TCSPLIT] isBotModeTicket · formatRelative → ./ticket-chat/format.ts



export const TicketChat: React.FC = () => {
  const { t, locale, isEnglish } = useI18n();
  // ── Channel / group scope ──────────────────────────────────────────────
  // The top-bar switcher picks a GROUP (test / Globex / Acme …); the
  // list then shows every hook in that group. activeHookId is an optional
  // extra narrowing (the OA filter dropdown), not the primary scope.
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  // ==== [FIX-20260731-GROUPRACE] START
  // Hooks and groups are fetched in parallel and neither waits for the other,
  // so an empty `groups` means one of two very different things: the user has
  // no groups, or the request simply has not come back yet. The OA-only
  // fallback below treated both as "no groups", set activeHookId from the
  // first hook, and every later branch that could pick a group is guarded on
  // `!activeHookId` — so once the groups did arrive, nothing selected them and
  // activeGroupId stayed null for the rest of the session.
  // ผลคือ refresh แล้วบางครั้งไม่มีกลุ่มถูกเลือก (แล้วแต่ว่า API ไหนกลับมาก่อน)
  // ธงนี้แยก "โหลดเสร็จแล้วว่างจริง" ออกจาก "ยังโหลดไม่เสร็จ"
  // ตั้งทั้งใน .then และ .catch → user ที่โดน 403 ยังได้ fallback เหมือนเดิมเป๊ะ
  // revert: ลบ state นี้ + จุดตั้งค่า 2 จุดใน boot effect + เงื่อนไขใน auto-select
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  // ==== [FIX-20260731-GROUPRACE] END
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeHookId, setActiveHookId] = useState<string | null>(null);

  // OA visibility: super sees every OA; others are limited to allowed_hooks.
  // Centralised in visibleGroups so the boot filter, ticket filter and the OA
  // selector all agree. `null` set = no restriction (super or legacy).
  const userAllowedHooksSet = useMemo(() => {
    if (isSuperRole()) return null;
    const auth = getStoredAuth();
    const allowed = auth?.allowed_hooks ?? auth?.user?.allowed_hooks ?? null;
    return allowed ? new Set(allowed) : null;
  }, []);

  // ── Filters + tabs ─────────────────────────────────────────────────────
  const [statusTab, setStatusTab] = useState<StatusTab>('waiting');
  const [searchPhone, setSearchPhone] = useState('');
  const [filterOa, setFilterOa] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterTag, setFilterTag] = useState('');   // customer-tag filter — SEPARATE from category (they AND together)
  // [FEAT-20260801-MEMBERTIER] เดิมเป็น stub (เลือกแล้วไม่กรองอะไร เพราะ ticket
  // ไม่มีข้อมูล tier ติดมา) · ตอนนี้ BE เก็บ tier ลง column ของ Member แล้ว
  // และ ticket ส่ง Member ทั้งดวงขึ้นมา → กรองได้จริงแล้ว (ดู tierKeyOf)
  const [filterTier, setFilterTier] = useState('');
  /* [FEAT-20260905-CUSTPROV PART 4] 📖 todo/task/05092026/todo3_05092026_
     profile_panel_module.md §18-23 — BE-decided switches for the tier FILTER
     dropdown (this file) and the tier BADGE (this file's card + ChatRoomView's
     room header). Both default `true` so a page that loads BEFORE the first
     ticket-list response lands renders exactly like today — "default is
     TODAY" is the whole point of this flag (§21), so the initial state can
     never be the OFF value.
     Read from `res.show_tier_badge` / `res.show_tier_filter` on the SAME
     ticket-list response this page already fetches (fetchActive/fetchCompleted
     below) — no new endpoint, no FE env var, no rebuild to flip it.
     `!== false` (not `=== true`) treats an absent/undefined key as "on", the
     same absent-means-default rule the BE port declares for a provider entry
     that omits the tier block.
     revert: delete these two states, the two `!== false` reads below, the
     `showTierBadge` prop on <ChatRoomView>, and the two `&& showTierBadge` /
     `showTierFilter &&` gates at the card badge and the filter dropdown. */
  const [showTierBadge, setShowTierBadge] = useState(true);
  const [showTierFilter, setShowTierFilter] = useState(true);
  /* [FEAT-20260907-PROVCONDS] third §6 switch off the same envelope — the
     follow-up world (card + ignore-abandon shield). Default ON = today. */
  const [showFollowUps, setShowFollowUps] = useState(true);
  /* [FEAT-20260907-PROVCONDS] these two ride the LIST envelope because the
     profile answer is NULL for unlinked members — the exact case the register
     box renders for. Defaults ON = today. */
  const [showRegisterAction, setShowRegisterAction] = useState(true);
  const [showWalletpayCard, setShowWalletpayCard] = useState(true);
  /* [FIX-20260905-TIERFILTERSTUCK] 🔴 HIDING THE CONTROL IS NOT ENOUGH — IT HAS
     TO LET GO OF THE FILTER TOO.
     `filterTier` is NOT a stub. It drives two client-side predicates (the active
     and completed row filters) AND rides the server query as `tier:`. So a page
     that has a tier selected when this switch flips OFF keeps a SHORTENED list —
     server-side and client-side — with no control left on screen to clear it,
     and the tab counts keep counting the filtered set (`hasFilter` reads
     `filterTier`). An operator would see tickets missing and have nothing to
     click. Reachable in the ordinary way: the dashboard is a long-lived SPA, so
     a provider switch on the back end reaches a page that is already open with a
     tier chosen. ซ่อนตัวกรองแล้วต้องล้างค่าด้วย ไม่งั้นรายการหายโดยไม่มีปุ่มแก้
     Clearing it also returns the query to the byte-identical "no filter" path
     that the unset-provider proof already covers.
     Kept as ONE helper rather than three edits because the three fetch paths
     below each read this response, and the same rule written three times is the
     shape that drifts the moment one is changed.
     revert: delete this helper and call the two setters directly at the three
     sites, accepting the stuck-filter case. */
  const applyTierSwitches = useCallback((res: TierSwitchResponse | null | undefined) => {
    // The RULE lives in `utils/tierSwitches.ts` (with its own spec, including
    // the stuck-filter case). This function only applies the answer to state.
    const sw = tierSwitchesFrom(res);
    setShowTierBadge(sw.showBadge);
    setShowTierFilter(sw.showFilter);
    if (sw.clearSelection) setFilterTier('');
    // [FEAT-20260907-PROVCONDS] same envelope, same rule shape (absent = ON).
    setShowFollowUps(sw.showFollowUps);
    setShowRegisterAction(sw.showRegisterAction);
    setShowWalletpayCard(sw.showWalletpayCard);
  }, []);
  // [FEAT-20260808-DATESCOPE] date-scope filter (⚙️ icon in front of the search box).
  // '' = ทั้งหมด (no bound; param OMITTED → identical to today). '2'|'3'|'4'|'5'|'7' =
  // last-N-days. Default 7 วัน. Component state — same pattern as the other filters
  // above (none persist to localStorage). Threaded into fetchActive/fetchCompleted +
  // the group-count meta calls so list AND every count badge stay consistent.
  // revert: delete this block, the ⚙️ popover in the toolbar, and the `within_days`
  // args on the 3 fetch sites.
  /* [FEAT-20260819-SHOWALL] Default was ทั้งหมด ('') while the ⚙️ picker was HIDDEN.
     ⚠️ The two went together. Hiding the control while leaving a narrow default
     would pin every list to that window with nothing on screen able to widen it —
     the worst of both. ซ่อนปุ่มแล้วต้องเปิดเป็นทั้งหมด ไม่งั้นติดกรอบถาวร. */
  /* [FIX-20260902-DATESCOPEDEFAULT] Owner, 02/09: the ticket page opens on 7 วัน.
     Safe to narrow ONLY because the picker is visible again (SHOW_DATE_SCOPE) —
     ทั้งหมด is one click away, so the rule above is satisfied.
     Why it is worth narrowing: `withinDaysParam` is the single input BOTH halves
     of the บอทดูแล badge filter by, and it decides how many pages `listAllRooms`
     fetches — one on 7 วัน, every room on ทั้งหมด. Opening on the cheap window is
     the difference between one request and a full walk on every page load.
     revert: put '' back here (the picker keeps working either way). */
  const [filterWithinDays, setFilterWithinDays] = useState('7');
  const [dateScopeOpen, setDateScopeOpen] = useState(false);
  const dateScopeRef = useRef<HTMLDivElement | null>(null);
  // Number|undefined actually sent to the service: ทั้งหมด → undefined (omit param).
  const withinDaysParam = useMemo<number | undefined>(
    () => (filterWithinDays === '' ? undefined : Number(filterWithinDays)),
    [filterWithinDays],
  );
  /* [FEAT-20260819-SERVERSEARCH] What the SERVER is asked for, derived from the
     search box. Two things happen the moment the operator types:
       · `search` is sent, so the DATABASE narrows the list instead of the browser
         filtering a page it already downloaded;
       · the date window is DROPPED — a search that only looks at the last 2 days
         is not a search. That limit was never intended: it was a side effect of
         filtering a windowed list on screen.
     Empty box ⇒ both fall back to exactly today's behaviour: no `search` param,
     and the window the ⚙️ picker says. ช่องค้นว่าง = เหมือนเดิมเป๊ะ.
     The BE regex covers every field the browser filter does, including the
     raw-profile bank paths — see [FEAT-20260819-SERVERSEARCH] in tickets.service. */
  /* The term the SERVER sees lags the box by a beat. `fetchActive` is rebuilt
     whenever its inputs change and `useEffect(..., [fetchActive])` re-runs it, so
     using the raw value would fire one request per keystroke. The browser filter
     keeps using the immediate value, so typing still feels instant while the
     network sees one request after the operator stops.
     พิมพ์ลื่นเหมือนเดิม แต่ยิง server ครั้งเดียวตอนหยุดพิมพ์. */
  const [debouncedSearch, setDebouncedSearch] = useState('');
  /* [FEAT-2708-SEARCHMIN4] เจ้าของ 27/08: "เซฟ request — พิมพ์ ≥4 ตัวอักษร
     search ถึงจะทำงาน" · gate ที่ตัวขับ request จุดเดียว: ต่ำกว่า 4 = server
     ไม่เห็นอะไรเลย (เท่ากับไม่ได้ค้น) · เลขอยู่ที่ค่าคงที่ตัวเดียว แก้ที่นี่ที่เดียว */
  useEffect(() => {
    const t = setTimeout(() => {
      const q = searchPhone.trim();
      setDebouncedSearch(q.length >= TICKET_SEARCH_MIN_CHARS ? q : '');
    }, 350);
    return () => clearTimeout(t);
  }, [searchPhone]);
  /* ตัวกรองฝั่งจอ (memberMatchesSearch ในสอง memo ข้างล่าง) ใช้ derived ตัวนี้
     — ความหมายเดียวทุกชั้น: ต่ำกว่า 4 คือ "ยังไม่ได้ค้นหา" ไม่ใช่ "ค้นหาบางส่วน" */
  const activeSearch = searchPhone.trim().length >= TICKET_SEARCH_MIN_CHARS ? searchPhone : '';

  /* [FEAT-20260826-SEARCHLIMITNOTE] 📖 omnidesk-api docs/bottleneck_26_aug.md (S4)
     The BE has said `search_truncated: true` since PERF-20260821-MEMBERSEARCH
     when a capped search mode hits its ceiling — and nothing in the FE ever
     read it (grep was empty, 26/08), so a limited result looked complete.
     Invisible today: the shipping legacy mode never truncates; the note can
     only appear after the BE search-mode flip. One flag per list.
     revert: drop the two states, their two writes, and the amber line. */
  const [activeSearchLimited, setActiveSearchLimited] = useState(false);
  const [completedSearchLimited, setCompletedSearchLimited] = useState(false);

  /* [FEAT-20260826-ACTIVEPAGING] 📖 omnidesk-api docs/bottleneck_26_aug.md (S8)
     Open-tab paging state — inert while TC_ACTIVE_PAGING is off (default):
     the builder returns the legacy shape, cursor stays null, hasMore false,
     serverTabCounts null, and every branch below no-ops. */
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const [activeHasMore, setActiveHasMore] = useState(false);
  const [activeLoadingMore, setActiveLoadingMore] = useState(false);
  const [serverTabCounts, setServerTabCounts] = useState<{
    waiting: number; active: number; mine: number; ended: number;
  } | null>(null);
  const activePagesRef = useRef(1); // how deep the operator has walked — silent refetches keep this depth

  const serverSearch = debouncedSearch || undefined;
  const scopeForQuery = debouncedSearch ? undefined : withinDaysParam;

  /* [FEAT-20260826-ACTIVEPAGING] read by fetchActive through a ref so the
     filter states do NOT join its deps — with the switch OFF a filter change
     must not trigger a network call it never triggered before (F5). */
  const activeFiltersRef = useRef<{ oa?: string; tag?: string; tier?: string; categoryLabel?: string }>({});
  activeFiltersRef.current = {
    oa: filterOa || undefined,
    tag: filterTag || undefined,
    tier: filterTier || undefined,
    categoryLabel: filterCategory || undefined,
  };

  /* [FIX-20260902-DATESCOPE2] Derived, not guessed. The fallback used to be the
     literal '2 วัน', which was true only while `2` was the default AND an option.
     With the list down to `7` and `ทั้งหมด`, an operator still holding `'5'` from
     before would have been shown "2 วัน" while the page filtered by five — a
     label naming a window nobody is using is worse than no label.
     Now: a known value uses its own label, an unknown one reports its real
     number, and empty means the bound is omitted entirely. */
  const dateScopeLabel = useMemo(
    () =>
      (DATE_SCOPE_OPTIONS.some(o => o.value === filterWithinDays)
        ? t(`ticketui.datescope.${filterWithinDays || 'all'}`, DATE_SCOPE_OPTIONS.find(o => o.value === filterWithinDays)!.label)
        : filterWithinDays ? t('ticketui.datescope.days', '{n} วัน', { n: filterWithinDays }) : t('ticketui.datescope.all', 'ทั้งหมด')),
    [filterWithinDays, t],
  );
  /* Active = anything other than the default → the gear gets a colored ring + dot,
     so a non-default scope is visible without the label being on screen.
     [FIX-20260902-DATESCOPEDEFAULT] The comparison follows the default. It was
     pinned to the literal '2' and never moved when the default became '', so the
     gear has been lit on EVERY page load since 19/08 — a permanent "active" badge
     tells the operator nothing. Now the default (7 วัน) is the quiet state and
     ทั้งหมด — the expensive one — is the one that announces itself. */
  const isDateScopeActive = filterWithinDays !== '7';
  // Close the ⚙️ popover on outside click (same pattern as SearchableSelect).
  useEffect(() => {
    if (!dateScopeOpen) return;
    const onDoc = (e: MouseEvent) => { if (dateScopeRef.current && !dateScopeRef.current.contains(e.target as Node)) setDateScopeOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [dateScopeOpen]);
  const [acmeCategory, setAcmeCategory] = useState(false);
  /* [FEAT-20261014-TICKETCATS] the customer provider decides the set when it declares one (loan_v1);
     null = the `acme_category`-driven set exactly as before (shop-api). */
  const providerCats = useProviderTicketCategories();
  /* [FEAT-20261018-CLOSEFOLLOW] sections the site's provider hides — read by the close dialog */
  const providerHiddenSections = useProviderHiddenSections();
  const categoryOptions = useMemo(
    () => (providerCats ? categoryOptionsFor(providerCats) : (acmeCategory ? CATEGORIES_LEGACY : CATEGORIES_NARROW)),
    [providerCats, acmeCategory]
  );
  /* [FEAT-20261014-TICKETCATS] ONE switch for every category badge on this page (card,
     sub-ticket, tag-info, history): the provider's set when declared, else the
     `acme_category`-driven badge exactly as before (shop-api). */
  const categoryBadge = (cat?: string | null) =>
    providerCats ? <TicketCategoryBadge category={cat} categories={providerCats} /> : getCategoryBadge(cat, acmeCategory);
  // Popular customer-tag labels (global) shown in their OWN tag filter dropdown
  // (kept separate from the category filter — the two never mix). Refreshed on
  // mount and whenever a tag is applied anywhere (tc:tags-changed).
  const [filterPopularTags, setFilterPopularTags] = useState<{ _id: string; label: string; color: string | null }[]>([]);
  // [REFACTOR-20261027-TCSPLIT] tierKeyOf / tierLabelOf (with their [FEAT-20260801-MEMBERTIER] notes)
  // → ./ticket-chat/derive/tier.ts — pure helpers, bodies verbatim
  useEffect(() => {
    // [FEAT-20260816-TAGSHOW] 20 → 50 (the BE cap): a freshly applied tag has
    // the lowest use_count, so with more than 20 tags in use it would fall off
    // the list — i.e. "added a tag, refreshed, still not in the dropdown".
    const load = () => chatService.popularTags(50).then(r => setFilterPopularTags(r.data || [])).catch(() => {});
    load();
    const onChanged = () => load();
    window.addEventListener('tc:tags-changed', onChanged);
    return () => window.removeEventListener('tc:tags-changed', onChanged);
  }, []);

  // ── Ticket data ────────────────────────────────────────────────────────
  const [activeTickets, setActiveTickets] = useState<TicketEntry[]>([]); // job_status 0,1
  const [completedTickets, setCompletedTickets] = useState<TicketEntry[]>([]); // job_status 2
  // [REFACTOR-20261027-TCSPLIT] options built in ./ticket-chat/derive/tier.ts (body verbatim)
  const tierFilterOptions = useMemo(() => buildTierFilterOptions(activeTickets, completedTickets), [activeTickets, completedTickets]);
  // Real-time assist_status override per roomId (patched by tc:assist-changed events from ChatRoomView)
  const [roomAssistMap, setRoomAssistMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [completedLoaded, setCompletedLoaded] = useState(false);
  // [PERF-20260821-TICKETCURSOR] server paging of the ended tab: the BE's opaque
  // cursor for the NEXT page, and whether one exists. Reset by every fresh fetch.
  const [completedCursor, setCompletedCursor] = useState<string | null>(null);
  const [completedHasMore, setCompletedHasMore] = useState(false);
  const [completedLoadingMore, setCompletedLoadingMore] = useState(false);
  const [completedTotal, setCompletedTotal] = useState<number | null>(null);
  const isFetchingRef = useRef(false);
  // Per-group active-ticket counts (group_id → total), for EVERY visible group's
  // tab — not just the open one (which used activeTickets and read 0 elsewhere).
  // Fetched from the group meta endpoint; refreshed live on ticket WS events.
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({});
  // Groups with NEW tickets that arrived while not open → yellow highlight on the
  // tab / overflow. Cleared when the group is opened. Empty by default (seamless).
  const [groupHasNew, setGroupHasNew] = useState<Record<string, boolean>>({});
  // Status-tab (ส่วนตัว/รอรับเคส/กำลังคุย/ปิดเคส) new markers → yellow count on
  // that tab. A new customer ticket in the OPEN group lands in 'waiting'; cleared
  // when the admin views that tab.
  const [statusHasNew, setStatusHasNew] = useState<Record<string, boolean>>({});
  /* [FEAT-20260907-TABSEEN] which tabs the operator has acknowledged. View-only:
     it hides a badge that is already on screen and is read by nothing else. A
     message arriving empties it (see the realtime handler), because an
     acknowledgement that only went ON would kill the badge permanently. */
  const [tabSeen, setTabSeen] = useState<TabSeen>(NOTHING_SEEN);
  /* [FEAT-20260819-ORPHANROOM] rooms with no case, fetched ONLY while the bot-care
     tab is open. One request, on the endpoint this page already uses elsewhere,
     and never on the pages that do not show them. โหลดตอนเปิดแท็บเท่านั้น. */
  const [orphanRooms, setOrphanRooms] = useState<ChatRoom[]>([]);
  /** [FIX-20260819-EVERTICKETED] member ids with at least one case EVER — the only
      answer a date-scoped list cannot give. */


  /**
   * [FIX-20260820-BOTCOUNT] The บอทดูแล tab's rows, built ONCE.
   *
   * The list and the tab's number used to be computed apart: the list added the
   * rooms that never became a case, the number did not. A customer with a room
   * and no ticket was therefore a card the badge did not count — reported with a
   * screenshot on 2026-08-20, one card on screen and a 0 beside the tab.
   * รายการบวกห้องที่ไม่เคยมีเคส · ตัวนับไม่ได้บวก ⇒ การ์ดขึ้นแต่เลข 0.
   *
   * Now both read this array, and `services/chat/orphanRooms.ts` owns the rule.
   * A number taken from these rows cannot disagree with the rows.
   *
   * ⚠️ It is computed on every tab, not only when บอทดูแล is selected — the badge
   * has to be right while the operator is looking at another tab, which is
   * exactly when they rely on it. คิดตลอด ไม่ใช่เฉพาะตอนเปิดแท็บนั้น.
   */
  const botRows = useMemo(
    () =>
      botTabRows<TicketEntry>({
        activeTickets,
        completedTickets,
        rooms: orphanRooms,
        /* [FIX-20260902-BOTONESOURCE] nothing to subtract any more. This used to
           be every member who had EVER had a case, fetched separately and taken
           away here — the client's own copy of a question the server now answers
           inside the rows themselves. Subtracting again could only remove rooms
           the server had already decided to keep, which is exactly how the two
           halves came to differ by one room. */
        everTicketed: [],
        withinDays: withinDaysParam,
        keyOf: getTicketUserKey,
        isBotMode: isBotModeTicket,
        roomToRow: (room) => roomAsPseudoTicket(room) as unknown as TicketEntry,
      }),
    [activeTickets, completedTickets, orphanRooms, withinDaysParam],
  );

  /* [FEAT-20260819-NEWESTTOP] when each customer last wrote, kept in memory.
     ⚠️ THIS FILE IS THE LIVE PAGE — route `/ticket-support`. The table at
     `pages/chat/TicketSupport.tsx` is a DIFFERENT screen (`/legacy-ticket`) and
     has its own copy of this idea; changing one never changes the other.
     ไฟล์นี้ = หน้าที่ใช้จริง · อีกไฟล์คือหน้าเก่า คนละหน้ากัน.

     Needed because a message NEVER touches the ticket row — nothing bumps its
     `updated_at` — so without this a customer writing could not move their card
     to the top. Read back through `unreadFor`, the same key rule the unread map
     uses. */
  const [lastMsgAt, setLastMsgAt] = useState<Record<string, number>>({});
  /* [FIX-20260819-ORPHANLIVE] bumped when a WS event says this tab's picture may
     have changed. The orphan rows come from `chat_rooms`, which no ticket event
     describes, so without this they refreshed only when the operator re-entered
     the tab — and rooms are created continuously, so what was on screen went
     stale within minutes. A counter, not a fetch call: the effect below already
     knows HOW to load; this only says WHEN. */
  const [orphanTick, setOrphanTick] = useState(0);
  const orphanTickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleOrphanRefresh = useCallback(() => {
    // One refresh per burst — a customer writing three times is one change here.
    if (orphanTickTimer.current) return;
    orphanTickTimer.current = setTimeout(() => {
      orphanTickTimer.current = null;
      setOrphanTick((t) => t + 1);
    }, 1500);
  }, []);
  useEffect(() => () => {
    if (orphanTickTimer.current) clearTimeout(orphanTickTimer.current);
  }, []);
  /* [FEAT-20260819-OPENFROMROOM] the dialog that opens the FIRST case for one of
     those rooms. Separate state from `reopenConfirm` on purpose: the two look
     alike on screen but hit different routes, and sharing one would make it easy
     to send a synthesized `orphan:<id>` where a real ticket id is expected. */
  const [openCaseRoom, setOpenCaseRoom] = useState<{ roomId: string; name: string } | null>(null);
  const [openingCase, setOpeningCase] = useState(false);
  /** Why the open failed — most often the BE's 409 when someone else claimed first. */
  const [openCaseError, setOpenCaseError] = useState<string | null>(null);

  /* [FEAT-20260819-REPLYUI] the composer publishes a tiny handle here so a click
     on a bubble (a sibling component away) can start a reply. Mirrors chatApiRef
     above; nothing else crosses between the two. */
  const replyApiRef = useRef<{ requestReply: (t: ReplyTarget) => boolean } | null>(null);

  // ── Selection + chat panel ─────────────────────────────────────────────
  const [selectedTicket, setSelectedTicket] = useState<TicketEntry | null>(null);
  /* [FIX-20260823-CLAIMCAS] id ของตั๋วที่เปิดอยู่ ในรูป ref — ตัว WS handler อ่าน
     ค่านี้ได้โดยไม่ต้องเพิ่ม `selectedTicket` เข้า dependency ของ useCallback
     ซึ่งจะทำให้ handler ถูกสร้างใหม่ทุกครั้งที่เปลี่ยนเคส และ re-subscribe WS ใหม่
     ⇒ ref คือทางที่ไม่กระทบ subscription ที่มีอยู่ */
  const selectedTicketIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedTicketIdRef.current = selectedTicket?._id ?? null;
  }, [selectedTicket]);
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const [rightTab, setRightTab] = useState<'personal' | 'operations'>('personal');
  // Right (customer) panel open state — the single source of truth at EVERY
  // width. A FAB toggles it manually anywhere; below the `wide` breakpoint
  // (1380px, where the 3-column layout gets cramped) it auto-collapses. Init
  // from the current width so the first paint is already correct.
  // NOTE: keep this in sync with the `wide` screen in index.html.
  const WIDE_BP = 1380;
  const [rightOpen, setRightOpen] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth >= WIDE_BP : true)
  );
  // Auto-collapse the right panel when the viewport is narrower than `wide`, and
  // auto-open it when it grows back — but only react to the breakpoint being
  // CROSSED, so a manual toggle in between is respected until the next crossing.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(min-width: ${WIDE_BP}px)`);
    setRightOpen(mq.matches);
    const handler = (e: MediaQueryListEvent) => setRightOpen(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  // Mobile-only (<lg): the conversation list can be collapsed once a case is
  // open so the chat gets the full width. Toggled by the </> button.
  const [leftOpen, setLeftOpen] = useState(true);
  // ==== [FIX-20260728-NOBLINK] START
  // เดิมคอมเมนต์บรรทัดนี้คือ:
  //   "Bumped after a reply/note is sent so ChatRoomView remounts + refetches."
  // ซึ่งบอกตรง ๆ ว่าเจตนาเดิมคือ "remount" — นั่นคือต้นเหตุการกระพริบ
  //
  // chatRefreshKey ยังอยู่เพราะใช้เป็น "ทางสำรอง" (fallback) เมื่อ append
  // ไม่ได้ผล เช่น ChatRoomView ยังไม่พร้อม (ref ว่าง) — ดีกว่าข้อความไม่โผล่เลย
  // แต่ "ไม่ได้อยู่ใน key แล้ว" จึงไม่ทำให้ remount อีก
  //
  // chatApiRef = ช่องทางสั่ง ChatRoomView ให้ append ข้อความตรง ๆ
  // ไม่มี network call เพิ่ม (ใช้ object ที่ API ตอบกลับมาอยู่แล้ว)
  //
  // revert: ลบ chatApiRef + คืนคอมเมนต์เดิม แล้วเอา chatRefreshKey กลับไปใส่ใน
  //         key ของ <ChatRoomView>
  const [chatRefreshKey, setChatRefreshKey] = useState(0);
  // [FEAT-20260908-AITRANSLATE] `patchMessage` added alongside the original two —
  // the handle the translate handler below uses to put a translation onto the
  // ONE message it belongs to, without reloading the room.
  const chatApiRef = useRef<{
    appendMessage: (m: any) => void;
    refetch: () => void;
    patchMessage: (id: string, patch: Record<string, any>) => void;
  } | null>(null);
  // ==== [FIX-20260728-NOBLINK] END

  // ==== [FEAT-20260908-AITRANSLATE] START — แปลข้อความของลูกค้า (ฝั่งอ่าน) ====
  //
  // Owner, 09/09: *"ฝั่งอ่าน กดแล้ว confirm แล้วแปลให้เลย"* — pressing the chip
  // and choosing a language IS the confirm, so this fires as soon as it is
  // called. It is called ONLY from `LanguagePicker.onPick` inside the bubble;
  // opening a room fires nothing, which is the owner's "translation is never
  // forced" rule and what `chatTranslateOptional` pins.
  const [translateAlert, setTranslateAlert] = useState<string | null>(null);

  /**
   * 🔴 THE HTTP RESPONSE IS THE ONLY DELIVERY — there is no socket for this.
   *
   * FE note §7 trap 1: `message:new` carries only `preview`
   * (`content.slice(0,120)`) and there is no `message:updated` branch for the
   * `translations` column, so waiting for a websocket event yields a feature
   * that works for nobody. The result the BE just returned is patched straight
   * into `ChatRoomView`'s message state.
   *
   * ⚠️ ONE message is patched, never the whole list (FE note §6, "no re-render
   *    storm"). `patchMessage` is the ready-ref function added for exactly this;
   *    `refetch()` would work too and is what this called before, but it
   *    replaces the list with page 1 — translating a message the operator
   *    reached by "load older" or a quote-jump would scroll it out of the window
   *    immediately after they paid an AI call for it.
   *
   * ⚠️ THE PATCH REPLACES `translations` WITH THE ONE ENTRY JUST RETURNED, and
   *    that is deliberate rather than an oversight. `patchMessage` takes a
   *    `Partial<ChatMessage>` and merges with `{ ...m, ...patch }`, so the page
   *    cannot see the entries already on the message and cannot append to them.
   *    It does not matter on screen: `activeTranslation()` (TranslatedBubble)
   *    renders the LAST entry and nothing reads the others, so asking for a
   *    second language shows the second language either way. The full array
   *    stays intact in the database, and any refetch of the room brings it back
   *    — local state converges on the server, it never overwrites it.
   *    ⇒ If a future feature ever needs the whole list client-side, the fix is
   *      to let `patchMessage` accept a function of the existing message; it is
   *      not to rebuild the array from a page that cannot see it.
   */
  const handleBubbleTranslate = useCallback(async (target: TranslateTarget) => {
    try {
      /* the BE reads the message it already holds and appends the result, so
         only the id and the languages travel.
         [FEAT-20260910-SOURCEPIPE] `target.from` is undefined for every press the
         UI can make today — no control offers a source, and the model detects it
         and reports it back. It is passed anyway so the day a source picker
         lands, the change is a control producing a value, not a route, a service
         and a handler all being widened at once. Undefined keeps `from` off the
         request body entirely. */
      const res = await aiTranslateService.translateMessage(
        target.id,
        target.lang,
        target.from,
      );
      const entry = res?.data;
      if (!entry?.text) return;   // nothing came back — leave the bubble alone
      chatApiRef.current?.patchMessage(target.id, {
        translations: [{ lang: entry.lang, text: entry.text, from: entry.from ?? null, to: entry.to }],
      });
    } catch (err) {
      setTranslateAlert(translateErrorText(err));
      throw err;
    }
  }, []);
  // ==== [FEAT-20260908-AITRANSLATE] END
  // Realtime unread: room_id → count of new INBOUND messages that arrived while
  // that room wasn't the open one. Drives the yellow badge on the chat-list card.
  // Cleared when the room is opened. Empty by default — no badge, seamless.
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});

  // ── Action state ───────────────────────────────────────────────────────
  // Identity for assign-history/assignment comes from the stored auth token,
  // same source the rest of the app trusts — no extra /me round-trip.
  const currentUser = useMemo(() => getStoredAuth()?.user ?? null, []);
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; username: string; display_name: string }[]>([]);

  /* ==== [FEAT-20260811-CHATPIN] ปักหมุดห้องแชท ====
   * เจ้าของสั่ง 2026-08-11: ปักหมุดใน panel ซ้าย · "prefrenece ของใครของมัน" ·
   * "max 20 ต้องเตือน" · badge รูปหมุด (ไม่มีตัวนับ) เด่นทั้ง dark/light
   * ตรรกะทั้งหมดอยู่ `services/chat/pinnedRooms.ts` (ไฟล์นี้ ~3.9k บรรทัดแล้ว ห้ามบวม)
   * เก็บใน `users.preferences.pinned_rooms` ⇒ ไม่แตะ BE เลย
   * อ่านค่าเริ่มต้นแบบ sync จาก preferences ที่มากับ login ⇒ กางหน้ามาหมุดอยู่ที่เดิม
   * ไม่กระพริบ ไม่ต้องรอ network */
  const [pinnedRooms, setPinnedRooms] = useState<string[]>(() => readPinned());
  const [pinLimitAlert, setPinLimitAlert] = useState(false);
  /* [FEAT-20260811-CHATPIN] เจ้าของสั่ง 2026-08-11: "ขอ remove pin confirm + modal บอกชื่อ
     วันเวลา ticket" ⇒ **การเอาหมุดออกต้องยืนยันก่อน** และกล่องยืนยันต้องบอกว่าเป็นห้องของ
     ใครและเคสเมื่อไหร่ — ไม่ใช่ถามลอย ๆ ว่า "ยืนยันหรือไม่" ซึ่งอ่านแล้วไม่รู้ว่ากำลังปลดอันไหน
     ⚠️ ยืนยันเฉพาะ "เอาออก" · การ "ปัก" ไม่ต้องยืนยัน (กดผิดก็แค่กดออก ไม่เสียอะไร) */
  const [unpinTarget, setUnpinTarget] = useState<{ key: string; name: string; when: string } | null>(null);

  /** ปักหมุด (ไม่ถาม) — optimistic: state ขึ้นก่อน แล้ว persist (local sync + PUT async) */
  const applyPin = useCallback((key: string) => {
    setPinnedRooms((cur) => {
      const r = togglePin(cur, key);
      if (!r.ok) {
        // เต็มเพดาน ⇒ เตือนแล้วไม่ปัก (ไม่ตัดเงียบ ไม่เด้งอันเก่าออก)
        setPinLimitAlert(true);
        return cur;
      }
      persistPinned(r.next);
      return r.next;
    });
  }, []);

  /**
   * กดปุ่มหมุดบนแถว — ปักเลย / เอาออกต้องยืนยัน
   *
   * `tk` ส่งมาเพื่อเอาชื่อกับเวลาไปโชว์ในกล่องยืนยัน ⇒ แอดมินเห็นว่าปลดของใคร
   * ใช้ `formatIdentityPair` ตัวเดียวกับที่การ์ดโชว์ชื่ออยู่ (`:2531`) ⇒ ข้อความตรงกับที่ตาเห็น
   */
  const togglePinnedRoom = useCallback((key: string, tk?: TicketEntry) => {
    if (!pinnedRooms.includes(key)) { applyPin(key); return; }
    const t = tk?.updated_at || tk?.created_at || tk?.resolved_at;
    setUnpinTarget({
      key,
      name: tk ? formatIdentityPair(tk.line_user_data, tk.line_user_id) : key,
      when: t
        ? new Date(t).toLocaleString(isEnglish ? 'en-GB' : 'th-TH', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false,
          })
        : '-',
    });
  }, [pinnedRooms, applyPin, locale]);

  /** ยืนยันแล้วค่อยเอาหมุดออกจริง */
  const confirmUnpin = useCallback(() => {
    const key = unpinTarget?.key;
    setUnpinTarget(null);
    if (!key) return;
    setPinnedRooms((cur) => {
      const r = togglePin(cur, key);
      if (!r.ok) return cur;
      persistPinned(r.next);
      return r.next;
    });
  }, [unpinTarget]);

  const [openHistoryTicketId, setOpenHistoryTicketId] = useState<string | null>(null);
  const [historyCache, setHistoryCache] = useState<Record<string, AssignHistoryEntry[]>>({});
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [historyModalTicket, setHistoryModalTicket] = useState<{ ticket: TicketEntry; list: any[] } | null>(null);
  const [showMongoId, setShowMongoId] = useState(false);
  const [copiedMongoId, setCopiedMongoId] = useState(false);
  const [showCustomerInfoInModal, setShowCustomerInfoInModal] = useState(false);
  const [copiedLabelInModal, setCopiedLabelInModal] = useState<string | null>(null);

  const openHistoryModal = async (subTk: TicketEntry) => {
    setShowCustomerInfoInModal(false);
    setCopiedLabelInModal(null);
    let embeddedList = subTk.assign_histories || [];
    let list = (embeddedList.length > 0 ? embeddedList : historyCache[subTk._id] || []) as any[];

    setHistoryModalTicket({ ticket: subTk, list });

    if (list.length === 0) {
      setLoadingHistoryId(subTk._id);
      try {
        let res = await assignHistoryService.getAssignHistories({ ticket_id: subTk._id, limit: 50 });
        let fetched = res?.data || [];
        if (fetched.length === 0 && (subTk as any).chat_room_id) {
          res = await assignHistoryService.getAssignHistories({ chat_room_id: (subTk as any).chat_room_id, limit: 50 });
          fetched = res?.data || [];
        }
        setHistoryCache(prev => ({ ...prev, [subTk._id]: fetched }));
        setHistoryModalTicket({ ticket: subTk, list: fetched });
      } catch (err) {
        console.error('Failed to load assign histories for modal', err);
      } finally {
        setLoadingHistoryId(null);
      }
    }
  };

  const toggleAssignHistory = async (ticketId: string, chatRoomId?: string | null) => {
    if (openHistoryTicketId === ticketId) {
      setOpenHistoryTicketId(null);
      return;
    }
    setOpenHistoryTicketId(ticketId);

    if (!historyCache[ticketId]) {
      setLoadingHistoryId(ticketId);
      try {
        let res = await assignHistoryService.getAssignHistories({ ticket_id: ticketId, limit: 50 });
        let list = res?.data || [];
        if (list.length === 0 && chatRoomId) {
          res = await assignHistoryService.getAssignHistories({ chat_room_id: chatRoomId, limit: 50 });
          list = res?.data || [];
        }
        setHistoryCache(prev => ({ ...prev, [ticketId]: list }));
      } catch (err) {
        console.error('Failed to load assign histories', err);
      } finally {
        setLoadingHistoryId(null);
      }
    }
  };

  useEffect(() => {
    userService.listUsersForAssign().then(res => {
      const mapped = (res.data || []).map(u => ({
        id: u.user_id,
        username: u.username,
        display_name: u.display_name
      }));
      setAssignableUsers(mapped);
    }).catch(console.error);
  }, []);
  const [actionInProgress, setActionInProgress] = useState(false);
  // Synchronous mirror of actionInProgress — a ref reads true immediately on the
  // same tick, so a rapid double-click can't slip past the state update lag.
  const actionInProgressRef = useRef(false);
  const [confirmAction, setConfirmAction] = useState<{ ticket: TicketEntry; targetStatus: number } | null>(null);
  /* [FEAT-20260826-CLOSECLEARFU] ตอบว่าจะตามการสมัครต่อไหม — `null` = ยังไม่เลือก
     แยกจาก confirmAction เพราะมันต้องถูกล้างทุกครั้งที่เปิด/ปิดกล่อง ไม่ใช่ค้างข้ามใบ */
  /* [FEAT-20260827-PATCHAFTERCLOSE] คำตอบของทุก section — key ที่ไม่มี = ยังไม่ตอบ
     ต้องถูกล้างทุกครั้งที่เปิด/ปิดกล่อง ไม่ใช่ค้างข้ามใบ (เหตุผลเดียวกับรุ่นก่อน) */
  const [closeAnswers, setCloseAnswers] = useState<CloseCaseAnswers>({});
  const [followUpMissing, setFollowUpMissing] = useState(false);
  /* [FIX-20260830-SHAKEEVERYTIME] a boolean cannot report the SECOND press:
     setting `true` over `true` is not a state change, so React never re-renders,
     the CSS animation never restarts and the focus effect never re-runs — the
     dialog shook once and then sat still however many times the admin pressed
     ยืนยัน (owner, 30/08). This counter changes on every blocked attempt, which
     is what both the shake and the re-focus hang off. */
  const [missingAttempt, setMissingAttempt] = useState(0);
  /* [FEAT-20260826-CLOSECLEARFU] ค่า follow_up มากับ `selectedRoom` อยู่แล้ว
     (`GET /api/chat` populate member แบบ deny-list จึงไม่ตัด `config` ทิ้ง) ⇒
     ไม่ต้องยิง API เพิ่มตอนเปิดกล่องยืนยัน · ตัว ticket ใช้ไม่ได้ เพราะ
     `list-member-trim.ts` ตัด `config` ออกจาก `line_user_data` โดยตั้งใจ */
  /* [FEAT-20260827-PATCHAFTERCLOSE] หัวข้อที่ต้องขึ้นสำหรับ member คนนี้ — ว่าง =
     ไม่มี section ไหนขึ้นเลย = ปิดเคสปกติ (ไม่เรนเดอร์ ไม่ล็อกปุ่ม ไม่ส่ง field) */
  /* ═══ [FEAT-20260830-FOLLOWUPFRESH] read the stamps when the dialog OPENS ═══
     Owner 30/08 asked whether this checked follow-up in realtime. It did not:
     `selectedRoom` is loaded when the admin opens the room and never refreshed.
     Between opening a room and pressing "ปิดเคส" the stamps can move — the notice
     runtime writes them after a card goes out, a multicast clears them, another
     admin presses the clock button on the panel. The dialog then offered a
     choice about a stamp that was already gone: the BE correctly did nothing,
     and the admin walked away believing they had acted.

     🔴 ONE RULE STILL DECIDES. The snapshot is rendered back into the room shape
        and fed to the SAME `closeCaseTopicsFor` — fresh data in, unchanged
        decision out. A second source of truth here is exactly how the screen and
        the server start disagreeing.
     ⚠️ A FAILED READ FALLS BACK to `selectedRoom` and says so on screen. Silently
        treating stale data as fresh would restore the bug this closes.
     ⚠️ Only for `targetStatus === 2` — the same dialog serves "รับเคส", where
        none of this applies. */
  const [freshRoom, setFreshRoom] = useState<ChatRoom | null>(null);
  const [freshLoading, setFreshLoading] = useState(false);
  const [freshFailed, setFreshFailed] = useState(false);
  const closeMemberId =
    (selectedRoom?.user_data as { _id?: string } | null | undefined)?._id ?? null;
  const closeDialogOpen = confirmAction?.targetStatus === 2;

  useEffect(() => {
    if (!closeDialogOpen || !closeMemberId) {
      setFreshRoom(null);
      setFreshLoading(false);
      setFreshFailed(false);
      return;
    }
    let alive = true;
    setFreshRoom(null);
    setFreshFailed(false);
    setFreshLoading(true);
    readFollowStamps(closeMemberId)
      .then((snap) => {
        if (alive) setFreshRoom(snapshotToRoomShape(snap) as unknown as ChatRoom);
      })
      .catch(() => {
        if (alive) setFreshFailed(true);
      })
      .finally(() => {
        if (alive) setFreshLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [closeDialogOpen, closeMemberId]);

  /* [FEAT-20260830-FOLLOWUPFRESH] the fresh snapshot wins; `selectedRoom` is the
     fallback for a failed read and for the "รับเคส" dialog. */
  /* [FEAT-20261018-CLOSEFOLLOW] minus the sections the provider hides (loan: all three) */
  const closeTopics = withoutHiddenTopics(
    closeCaseTopicsFor(
      freshRoom ?? selectedRoom,
      confirmAction?.targetStatus ?? 0,
    ),
    providerHiddenSections,
  );

  /* [FEAT-20260830-CLOSEWIZARD] one topic at a time. No topics ⇒ isLast is
     already true, so a plain close is untouched. */
  const closeWizard = useCloseCaseWizard(
    closeTopics,
    closeAnswers,
    confirmAction ? `${confirmAction.ticket._id}-${confirmAction.targetStatus}` : null,
  );

  /* [FIX-20260830-CLOSEANSWERSTALE] the answers must reach `executeAction`
     through a ref, not through its closure.
     🔴 THE BUG THIS FIXES: `executeAction` is a `useCallback` whose deps are
        `[activeTickets, completedTickets, currentUser, fetchActive]` — neither
        `closeTopics` nor `closeAnswers` is listed. The dialog rendered the
        sections correctly and the confirm button validated them correctly,
        because both of those read the LIVE values during render. But the click
        handler ran the callback captured on an earlier render, where
        `closeTopics` was still `[]` (no room selected yet). The loop that builds
        `answered` therefore iterated nothing, `patch_after_close` was never
        added to the payload, and the back end had nothing to act on — so it
        cleared no stamp and wrote no audit row, with no error anywhere.
        Confirmed against the running server: the BE logged
        `patchAfterClose=undefined jobStatus=2`.
     ⚠️ Adding them to the dep array instead would rebuild `executeAction` on
        every keystroke of the dialog and is not how this file solves the
        problem elsewhere (`activeFiltersRef`, `selectedTicketIdRef`,
        `scopeRef` in usePartialTicketFetch all use a ref for exactly this).
     Assigned on every render, so the ref always holds what the screen shows. */
  const closeCaseRef = useRef<{
    topics: CloseCaseTopic[];
    answers: CloseCaseAnswers;
  }>({ topics: [], answers: {} });
  closeCaseRef.current = { topics: closeTopics, answers: closeAnswers };
  // [FEAT-20260817-REOPENBYADMIN] its OWN confirm state (precedent: the transfer
  // modal has its own instance) — widening confirmAction's targetStatus union
  // would touch every existing reader for one new action.
  const [reopenConfirm, setReopenConfirm] = useState<TicketEntry | null>(null);
  const [reopening, setReopening] = useState(false);
  // Shown when the admin opens another card while a case is in progress.
  const [busyCaseWarnOpen, setBusyCaseWarnOpen] = useState(false);
  // The card the admin clicked while busy — opened if they choose "รับเคสใหม่".
  const [pendingTicket, setPendingTicket] = useState<TicketEntry | null>(null);
  // Ticket whose full category+tag list is shown in the info modal (list overflow).
  const [tagInfoTicket, setTagInfoTicket] = useState<TicketEntry | null>(null);
  // Success flash after a case is closed (auto-hides).
  const [closeSuccessOpen, setCloseSuccessOpen] = useState(false);
  useEffect(() => {
    if (!closeSuccessOpen) return;
    const t = setTimeout(() => setCloseSuccessOpen(false), 1800);
    return () => clearTimeout(t);
  }, [closeSuccessOpen]);

  const [claiming, setClaiming] = useState(false);
  const [claimConfirmOpen, setClaimConfirmOpen] = useState(false);
  // Race-conflict warning: the server rejected a close/claim/accept because the
  // ticket was already closed by someone else (HTTP 409). We surface it and
  // refresh the list so the stale card corrects itself.
  const [raceWarnMsg, setRaceWarnMsg] = useState<string | null>(null);
  /* [FIX-20260823-CLAIMCAS] แถวในลิสต์เป็นแหล่งความจริงของ "ใครถือเคสนี้"
     พอ `schedulePartialFetch` ดึงของสดมาลง `activeTickets` แล้ว กล่องบนจอต้อง
     ตามให้ทัน — กล่องอ่านจาก `selectedTicket` ซึ่งไม่มีใคร sync ให้มาก่อนหน้านี้
     ⚠️ patch เฉพาะตอน "เจ้าของต่างจริง" เท่านั้น ไม่งั้นจะเขียน state ทุกครั้งที่
        ลิสต์ขยับ แล้วทำให้ re-render โดยเปล่าประโยชน์
     ⚠️ patch แค่ 2 field ที่เกี่ยวกับเจ้าของ ไม่ทับทั้งแถว เพราะ `selectedTicket`
        อาจถือค่าที่หน้าจอแก้ไว้เอง (เช่น customer_tags ที่ :1702 เขียนลงไป) */
  /* [FIX-20260829-SELECTEDSTATUSSYNC] `job_status` joined the patch.
     The footer decides with `selectedJobStatus === 1 && !isMyCase`, so copying
     the owner fields WITHOUT the status left the held-by banner unreachable —
     another admin accepted, the transcript said so, and the bar underneath still
     offered "กดรับเคสเพื่อสนทนา". The 23/08 fix corrected the name in a banner
     that was never being rendered.
     ⚠️ The early-out now asks about BOTH fields it copies; the owner-only guard
        skipped a row whose status moved while the owner string stayed equal.
     ⚠️ Still a patch of named fields — `selectedTicket` carries values this page
        wrote itself (customer_tags), and a whole-row copy reverts them.
     ⚠️ Nothing realtime is touched: same effect, same trigger, one more field. */
  useEffect(() => {
    if (!selectedTicket) return;
    const fresh = activeTickets.find(tk => tk._id === selectedTicket._id);
    if (!fresh) return;
    const patch = ownershipPatch(selectedTicket as any, fresh as any);
    if (!patch) return;
    setSelectedTicket(prev => (prev && prev._id === fresh._id ? { ...prev, ...patch } as any : prev));
  }, [activeTickets, selectedTicket]);

  const isRaceConflict = (e: any) => (e?.status === 409) || /ถูกปิดไปแล้ว|already accepted|already/i.test(e?.message || '');
  /* [FIX-20260823-CLAIMCAS] 409 ที่แปลว่า "มีคนรับไปก่อน" ไม่ใช่ "เคสถูกปิด"
     ตรวจจากข้อความ เพราะทั้งคู่เป็น 409 เหมือนกัน · ต้องเช็คตัวนี้ก่อน
     `isRaceConflict` เสมอ ไม่งั้นจะถูกกลืนแล้วปิดหน้าเคสทิ้งทั้งที่เคสยังเปิดอยู่ */
  const isClaimTakenConflict = (e: any) =>
    /ถูกรับไปแล้วโดยแอดมินท่านอื่น/.test(e?.message || '');

  const handleExecuteClaim = async () => {
    if (!selectedTicket || !currentUser) return;
    const userId = currentUser.id || currentUser._id;
    if (!userId) return;

    try {
      setClaiming(true);
      setClaimConfirmOpen(false);

      /* [FIX-20260823-CLAIMCAS] ส่ง "เจ้าของที่ฉันเห็นบนจอตอนกด" ไปด้วย
         BE เอาไปเป็นเงื่อนไขในคำสั่งเขียนเดียวกัน ⇒ สองคนกดพร้อมกันมีคนเดียวที่ได้
         `''` = เห็นว่ายังไม่มีใครถือ (ต่างจากไม่ส่งเลย = ไม่ให้ตรวจ) */
      await ticketService.updateTicketMinimal(selectedTicket._id, {
        admin_user_id: userId,
        expected_admin_user_id: String(
          (selectedTicket as any).admin_user_id ?? '',
        ),
      });

      const roomId = selectedRoom?._id || (selectedTicket as any).chat_room_id;
      if (roomId) {
        await assignHistoryService.createAssignHistory({
          ticket_id: selectedTicket._id,
          chat_room_id: roomId,
          assign_to: userId,
          changed_by_id: userId,
          action: 'claim',
        }).catch(() => {});
      }

      const myUserData = {
        _id: userId,
        id: userId,
        username: currentUser.username,
        display_name: currentUser.display_name,
      };

      setSelectedTicket(prev => prev ? {
        ...prev,
        admin_user_id: userId,
        admin_user_data: myUserData,
      } : null);

      setActiveTickets(prev => prev.map(tk => tk._id === selectedTicket._id ? {
        ...tk,
        admin_user_id: userId,
        admin_user_data: myUserData,
      } : tk));

      fetchActive(true);
      setChatRefreshKey(k => k + 1);
    } catch (err) {
      /* [FIX-20260823-CLAIMCAS] "ถูกแย่ง" กับ "ถูกปิด" เป็นคนละเรื่อง
         ถูกปิด → ปิดหน้าเคสถูกแล้ว ไม่มีอะไรให้ทำต่อ
         ถูกแย่ง → เคสยังเปิดอยู่ **ห้ามปิดหน้า** แค่ดึงของสดมาให้กล่องโชว์เจ้าของ
                   คนใหม่ แอดมินจะได้กดรับต่ออีกครั้งได้ทันทีถ้าต้องการ */
      if (isClaimTakenConflict(err)) {
        setRaceWarnMsg((err as any)?.message || t('ticketui.race.claimed_by_other', 'เคสนี้ถูกรับไปแล้วโดยแอดมินท่านอื่น'));
        schedulePartialFetch(selectedTicket._id);
      } else if (isRaceConflict(err)) {
        setRaceWarnMsg((err as any)?.message || t('ticketui.race.closed_cannot_take', 'เคสนี้ถูกปิดไปแล้ว เคลม/รับไม่ได้'));
        setSelectedTicket(null); setSelectedRoom(null);
        fetchActive(true);
      } else {
        console.error('Failed to claim ticket:', err);
      }
    } finally {
      setClaiming(false);
    }
  };

  // ── Group switcher display mode (DB preference, default = slider) ─────────
  // 'slider' = the horizontal tab strip (current); 'select' = a dropdown.
  // Neither mode has an "all groups" option — a group is always selected.
  const [groupMode, setGroupMode] = usePreference<'slider' | 'select'>('ui.ticketGroupMode', 'slider', { immediate: true });
  // Per-user favourite groups (slider mode only), in fav order. Seamless default
  // [] — no stored value means plain alphabetical, no star markers. Max 5.
  const [favGroups, setFavGroups] = usePreference<string[]>('ui.favGroups', [], { immediate: true });
  const FAV_MAX = 5;

  /* [FEAT-20260830-CHATFONT] ขนาดตัวอักษรของช่องแชทกลาง (6 ขั้น คูณ 1.0-2.0).
     `immediate` เพราะเป็นการเลือกครั้งเดียวจบ — debounce เคยทำให้ค่าหายถ้า
     ผู้ใช้ reload ทันที (ดูคอมเมนต์ใน usePreferences.ts).
     ⚠️ normalize ทุกครั้งที่อ่าน เพราะ usePreference คืนค่าที่เก็บไว้ตรง ๆ
     โดยไม่ตรวจอะไรเลย ⇒ ค่าเพี้ยนจะทำให้ calc() ใน CSS พังทั้งบล็อก */
  const [chatFontScaleRaw, setChatFontScaleRaw] = usePreference<number>(
    CHAT_FONT_SCALE_PATH, CHAT_FONT_SCALE_DEFAULT, { immediate: true });
  const chatFontScale = normalizeChatFontScale(chatFontScaleRaw);
  const [fontModalOpen, setFontModalOpen] = useState(false);

  /* [FEAT-20260830-TRAYFULL] โหมดแผงเครื่องมือ (ค่าเริ่มต้น / เต็มจอ) */
  const [chatTrayModeRaw, setChatTrayModeRaw] = usePreference<string>(
    CHAT_TRAY_MODE_PATH, CHAT_TRAY_MODE_DEFAULT, { immediate: true });
  const chatTrayMode = normalizeChatTrayMode(chatTrayModeRaw);
  const [trayModalOpen, setTrayModalOpen] = useState(false);

  /* toast ของสองการตั้งค่านี้ — ลอกรูปแบบ closeSuccessOpen ในไฟล์เดียวกัน
     (หน้านี้ไม่มี toast กลาง และ TicketToast ถูกปิดไว้ด้วยเทส) */
  const [settingToast, setSettingToast] = useState<string | null>(null);
  useEffect(() => {
    if (!settingToast) return;
    const timer = setTimeout(() => setSettingToast(null), 1800);
    return () => clearTimeout(timer);
  }, [settingToast]);
  // Group awaiting a fav/unfav confirm (null = modal closed).
  const [favConfirm, setFavConfirm] = useState<{ id: string; name: string; faved: boolean } | null>(null);
  const [favLimitWarn, setFavLimitWarn] = useState(false);
  const [quickReplyModalOpen, setQuickReplyModalOpen] = useState(false);  // จัดการ Quick Reply (จากฟันเฟือง)

  // ── boot: hooks, groups, current user, flag ────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await webhookService.getAllHooks();
        // super → all OAs; others → only their allowed_hooks.
        setHooks(filterVisibleHooks(data as any));
      } catch (e) { console.error('load hooks failed', e); }
    })();
    // Only ACTIVE groups (status:true) — a group the user belongs to but that
    // has been deactivated must not appear. Intersected with the user's own
    // sector groups below.
    groupService.listGroups({ limit: 200, status: true }).then((res: any) => {
      setGroups(res?.data || res || []);
      setGroupsLoaded(true); // [FIX-20260731-GROUPRACE]
    }).catch(() => {
      // ==== [FIX-20260729-TICKETONLYOA] START (part 2 — group tab) — 🔒 สาย AUTO
      // /api/groups requires group.manage, so a ticket-only user always lands
      // here with a 403 — and the group tab pill vanished with it. But the
      // user's own group names are already in the JWT (login returns
      // user.groups as {id, group_name}), so use them as the fallback list.
      // filterVisibleGroups intersects with the same JWT ids → identity, and
      // ticket list + per-tab counts go through /api/tickets/group/* which is
      // guarded by ticket.manage, so everything downstream works unchanged.
      // ไม่กระทบ user ปกติ — โค้ดนี้อยู่ใน catch เท่านั้น fetch สำเร็จ = ไม่แตะ
      // revert: เหลือ catch ว่างแบบเดิม `/* groups optional */`
      const own = ((getStoredAuth()?.user as any)?.groups ?? [])
        .filter((g: any) => g && (g.id || g._id) && g.group_name)
        .map((g: any) => ({ _id: String(g.id ?? g._id), group_name: g.group_name }));
      if (own.length > 0) setGroups(own);
      // ==== [FIX-20260729-TICKETONLYOA] END (part 2)
      // [FIX-20260731-GROUPRACE] 403 ก็ถือว่าโหลดเสร็จแล้ว — ปลดล็อก fallback OA
      setGroupsLoaded(true);
    });
    configService.listConfigs({ limit: 200 }).then((res) => {
      const row = (res.data || []).find((c: any) => c.key === 'acme_category');
      const v = row?.value;
      setAcmeCategory(v === true || v === 1 || v === 'true');
    }).catch(() => { /* absent = narrowed set */ });
  }, []);

  // Same rule as everywhere else (account menu, forms): super roles see all
  // ACTIVE groups; everyone else sees active ∩ their sector groups. `groups` is
  // already fetched with status:true, so filterVisibleGroups just applies the
  // super/∩ rule via the shared helper — no duplicated logic to drift.
  const visibleGroups = useMemo(
    () => sortVisibleGroups({ groups }),
    [groups],
  );

  // Default scope: if there are favorited groups, automatically set the first favorited group as active!
  const initializedFavActiveRef = useRef(false);

  useEffect(() => {
    if (visibleGroups.length === 0) {
      // ==== [FIX-20260729-TICKETONLYOA] START — 🔒 สาย AUTO (to_dev_auto เท่านั้น)
      // Restore the ticket-only fallback that 5b729a6 (favGroups rework) dropped.
      // A user without group.manage gets 403 from /api/groups, so visibleGroups
      // stays empty forever — the old bare `return` here then left the page with
      // no scope at all: no tabs, no tickets, nothing.
      // เงื่อนไขเดิม (มีมาตั้งแต่ 88c99cb): ไม่มีกลุ่มให้เลือก → ใช้ OA ตัวแรก
      // ที่มีสิทธิ์ (allowed_hooks) เป็น scope แทน แล้ว ticket โหลดผ่าน
      // /api/tickets/hook/:id ซึ่ง guard ด้วย ticket.manage อยู่แล้ว
      // revert: ลบ if-block ข้างในนี้ทั้งก้อน เหลือ `return;` เปล่าเหมือนเดิม
      //
      // [FIX-20260731-GROUPRACE] อย่าเพิ่งตัดสินใจถ้ายังโหลดกลุ่มไม่เสร็จ —
      // ว่างตอนนี้อาจแปลว่า "ยังไม่มา" ไม่ใช่ "ไม่มี" · ตั้ง activeHookId ไปก่อน
      // จะทำให้ทุกเงื่อนไขเลือกกลุ่มด้านล่าง (ที่ guard ด้วย !activeHookId) ตายหมด
      // revert: ลบบรรทัด if (!groupsLoaded) return;
      if (!groupsLoaded) return;
      if (hooks.length > 0 && !activeGroupId && !activeHookId) {
        setActiveHookId(hooks[0]._id);
        initializedFavActiveRef.current = true;
      }
      // ==== [FIX-20260729-TICKETONLYOA] END
      return;
    }

    const live = new Set(visibleGroups.map(g => g._id));
    const validFavs = (favGroups || []).filter(id => live.has(id));

    if (validFavs.length > 0) {
      if (!activeGroupId || !live.has(activeGroupId) || (!validFavs.includes(activeGroupId) && !initializedFavActiveRef.current)) {
        setActiveGroupId(validFavs[0]);
        initializedFavActiveRef.current = true;
      }
    } else if (!activeGroupId && !activeHookId) {
      setActiveGroupId(visibleGroups[0]._id);
      initializedFavActiveRef.current = true;
    } else if (hooks.length > 0 && !activeGroupId && !activeHookId) {
      setActiveHookId(hooks[0]._id);
      initializedFavActiveRef.current = true;
    }
    // [FIX-20260731-GROUPRACE] groupsLoaded ต้องอยู่ใน deps ไม่งั้น effect
    // ไม่ถูกเรียกซ้ำตอนโหลดกลุ่มเสร็จ (กรณี hooks ว่างแต่ groups ก็ว่าง)
  }, [visibleGroups, hooks, favGroups, activeGroupId, activeHookId, groupsLoaded]);

  // Hooks belonging to the active group — used for per-group ticket counts and
  // the OA filter dropdown scope.
  const activeGroupHookIds = useMemo(() => {
    if (!activeGroupId) return null;
    return new Set(hooks.filter(h => (h.group ?? (h as any).group_id) === activeGroupId).map(h => h._id));
  }, [hooks, activeGroupId]);

  /* [FIX-20260902-BOTONESOURCE] REMOVED: `noCaseRooms` and the effect that
     fetched it. It was the badge's "other half" — a server count added on every
     tab except this one, which is precisely what made one box carry two
     formulas. The rows now arrive already decided by the server on every tab
     (see the effect below), so the count is `rows.length` and there is no second
     half left to keep in step. This also removes one request per OA: the rows
     route replaces the count route rather than joining it. */

  /* [FEAT-20260819-ORPHANROOM] the rooms behind the bot-care tab's extra rows.
     Fetched ONLY while that tab is open and only for the OAs in view, using
     `listRooms` — the same endpoint `openTicket` already calls, so this is one
     request on a tab the operator opened deliberately, never a background poll.
     Leaving the tab drops the list and re-entering refetches: no cache, so
     nothing can go stale behind the operator's back.
     โหลดตอนเปิดแท็บเท่านั้น · ออกจากแท็บทิ้งเลย ไม่มี cache ให้ค้าง. */
  /* [PERF-20260826-NOCASEDEPS] 📖 omnidesk-api docs/bottleneck_26_aug.md (S4)
     Membership key, NOT array identity: every fetch, patch and partial merge
     builds a NEW array even when the rows are identical, and this effect fires
     one request PER OA — so identity deps would re-ask, per event × per admin ×
     per OA, for a number that cannot have moved. Membership changes only when a
     ticket appears or disappears; claim, close, transfer and field patches keep
     every id in place.
     ⚠️ [FIX-20260902-BOTONESOURCE] IT MUST STAY IN THE DEPS BELOW. Opening or
        closing a case is exactly what moves a room in or out of this tab, and the
        WS tick alone does not cover it — `scheduleOrphanRefresh` fires on
        `ticket:new` and on a customer message, not on someone else closing a
        case. Dropping this key made the rows stale until the next burst; the
        suite caught it. */
  const noCaseRefreshKey = useMemo(
    () => ticketIdsKey(activeTickets) + '|' + ticketIdsKey(completedTickets),
    [activeTickets, completedTickets],
  );

  /* [FIX-20260902-BOTONESOURCE] The rows behind this tab, decided by the SERVER.
     ═══════════════════════════════════════════════════════════════════════════
     WHAT THIS REPLACES. Two fetches used to feed this: every room for the OA
     (capped at 200 by the back end, silently) and every member who had ever had
     a case, subtracted from it in the browser. The tab then counted what was
     left. That count could only ever be a count of what THIS browser managed to
     load, which is why the badge read 29 from another tab and 28 from its own,
     and why two operators could see different numbers for the same OA at the
     same second.

     Now one route answers WHICH rooms, using the same rule its sibling uses to
     answer HOW MANY, so the rows ARE the count. Nothing is subtracted here.

     ⚠️ FETCHED ON EVERY TAB, deliberately, where the old room download never
        could be. The response is small by the filter — customers with no case at
        all — so the badge is right while the operator is looking elsewhere,
        which is exactly when they rely on it.
     ⚠️ `everTicketed` IS GONE and must not come back. It existed because the
        page's ticket lists are date-scoped and could not answer "ever had a
        case"; the server answers that now, per OA. Keeping it would subtract a
        second time — and it subtracted across the whole GROUP, which is what
        made the two halves differ by one room on the local data (a customer with
        cases on another OA in the group still has an unattended room on this one).
     ⚠️ Same triggers as before: `orphanTick` (the debounced WS burst) and the
        ⚙️ window. One refresh per burst, unchanged. */
  useEffect(() => {
    const hookIds = activeHookId
      ? [activeHookId]
      : activeGroupHookIds ? Array.from(activeGroupHookIds) : [];
    if (hookIds.length === 0) {
      setOrphanRooms([]);
      return;
    }
    let alive = true;
    Promise.all(
      hookIds.map(id =>
        ticketService
          .getNoCaseRooms(id, withinDaysParam)
          .catch(() => [] as ChatRoom[]),
      ),
    ).then(lists => {
      if (!alive) return;
      setOrphanRooms(lists.flat());
    });
    return () => { alive = false; };
  }, [activeHookId, activeGroupHookIds, orphanTick, noCaseRefreshKey, withinDaysParam]);

  // Shared group picker — used by the slider tabs, the select-mode dropdown, and
  // the slider's overflow dropdown. Same side effects everywhere.
  const selectGroup = useCallback((id: string) => {
    setActiveHookId(null); setActiveGroupId(id); setFilterOa('');
    setCompletedLoaded(false); setSelectedTicket(null); setSelectedRoom(null);
    setGroupHasNew(prev => { if (!prev[id]) return prev; const n = { ...prev }; delete n[id]; return n; }); // opening clears its yellow flag
  }, []);

  // Star clicked → open a confirm modal (fav or unfav). When adding and already
  // at the cap, show the "unfav one first" warning instead of the confirm.
  const requestFavToggle = useCallback((id: string, name: string) => {
    const faved = favGroups.includes(id);
    if (!faved && favGroups.length >= FAV_MAX) { setFavLimitWarn(true); return; }
    setFavConfirm({ id, name, faved });
  }, [favGroups]);
  const confirmFav = useCallback(() => {
    if (!favConfirm) return;
    const { id, faved } = favConfirm;
    setFavGroups(prev => faved ? prev.filter(x => x !== id) : [...prev, id]);
    setFavConfirm(null);
  }, [favConfirm, setFavGroups]);

  // ── Slider overflow: tabs fill up to 70% of the strip; the rest drop into a
  // searchable dropdown. Picking one from the dropdown promotes it to the front
  // (and active). Not persisted — resets whenever the group list changes. ──────
  const sliderWrapRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  // Ticket-only: the OA switcher is portaled into the App header slot (declared
  // here, above the slider-measure effect that depends on it, to avoid a TDZ).
  // ==== [FEAT-20260801-ONEROW] ต้องคิดตรงกับ App.tsx เป๊ะ
  // App เป็นคนเรนเดอร์ช่อง #tc-header-oa-slot ส่วนหน้านี้เป็นคน portal แท็บเข้าไป
  // ถ้าสองที่ตัดสินโหมดคนละแบบ จะได้แถบที่มีช่องว่างเปล่า (หรือแท็บซ้อนสองที่)
  // → อ่านจาก hooks/topBarMode.ts ที่เดียวกัน
  // ⚠️ ตัวนี้คือ "การจัดวาง" เท่านั้น = สิทธิ์จริง ∪ ความชอบที่ตั้งไว้
  // ⚠️ ฟัง event ตอนผู้ใช้กดสลับในเมนู ⚙️ เพื่อให้ย้ายแท็บทันทีโดยไม่ต้องรีเฟรช
  const [ticketOnly, setTicketOnly] = useState(() => isCompactTopBar());
  useEffect(() => {
    const sync = () => setTicketOnly(isCompactTopBar());
    window.addEventListener('app:topbar-mode-changed', sync);
    return () => window.removeEventListener('app:topbar-mode-changed', sync);
  }, []);
  const [oaSlot, setOaSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!ticketOnly) { setOaSlot(null); return; }
    setOaSlot(document.getElementById('tc-header-oa-slot'));
  }, [ticketOnly]);
  // #tc-gear-slot lives inside the app's ⚙️ gear dropdown, which mounts/unmounts
  // as it opens/closes. Observe the DOM so we portal the group/QR controls in
  // whenever the dropdown is open.
  const [gearSlot, setGearSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => setGearSlot(document.getElementById('tc-gear-slot'));
    find();
    const obs = new MutationObserver(find);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  const [promotedId, setPromotedId] = useState<string | null>(null);
  const [inlineCount, setInlineCount] = useState<number>(visibleGroups.length);
  // reset promotion when the underlying group set changes
  useEffect(() => { setPromotedId(null); }, [visibleGroups.length]);
  // Favourites that still map to a live/visible group, in stored fav order.
  // A faved group that's no longer visible is silently dropped (seamless — no
  // dangling star, falls back to alphabetical). Slider mode only.
  const favOrder = useMemo(() => {
    if (groupMode !== 'slider' || favGroups.length === 0) return [] as string[];
    const live = new Set(visibleGroups.map(g => g._id));
    return favGroups.filter(id => live.has(id));
  }, [favGroups, visibleGroups, groupMode]);
  const isFaved = useCallback((id: string) => favOrder.includes(id), [favOrder]);

  // ==== [FIX-20260801-OATABSTAY] ลำดับแท็บ: ตัวที่เลือกจาก dropdown → รายการโปรด
  // (ตามลำดับที่ติดดาว) → ที่เหลือ (เรียงตามตัวอักษรจาก visibleGroups) ไม่มีตัวไหนซ้ำ
  //
  // ⚠️ เดิม head = `promotedId || activeGroupId` → **คลิกแท็บไหนแท็บนั้นเด้งมาหน้าสุด**
  //    ผู้ใช้สั่งว่า "active มันจะต้องไหลไปหา tab นั้น ไม่ใช่ย้ายตำแหน่ง tab มาข้างหน้า"
  //    → เอา activeGroupId ออกจาก head · คลิกแท็บ = เปลี่ยนแค่ตัวที่ active
  //      ส่วนตำแหน่งอยู่กับที่ (selectGroup ตั้งแค่ activeGroupId ไม่แตะ promotedId)
  //
  // ⚠️ **การเลือกจาก dropdown ยังเด้งมาอันแรกเหมือนเดิม** — ตรงนี้ห้ามเปลี่ยน
  //    (setPromotedId ถูกเรียกที่เดียวคือ onChange ของ dropdown "อื่นๆ")
  //    เพราะตัวที่เลือกจาก dropdown คือตัวที่ "ยังไม่โผล่เป็นแท็บ" ถ้าไม่ดันมาข้างหน้า
  //    ผู้ใช้จะเลือกแล้วไม่เห็นอะไรเปลี่ยนเลย
  //
  // ลำดับรายการโปรดยังทำงานทับอีกชั้นเหมือนเดิม ไม่ได้แตะ
  // revert: เปลี่ยน head กลับเป็น `promotedId || activeGroupId`
  const orderedGroups = useMemo(
    () => orderGroups({ promotedId, visibleGroups, favOrder }),
    [visibleGroups, promotedId, favOrder],
  );
  const recomputeInline = useCallback(() => {
    const wrap = sliderWrapRef.current, meas = measureRef.current;
    if (!wrap || !meas) return;
    // Ticket-only: the switcher lives in the header slot, sharing the row with the
    // brand/status/theme/profile — measure the SLOT's real width (its available
    // space), not the wrap (which flex-shrinks to near-zero before tabs render).
    // Non-ticket-only: the wrap fills the Ticket bar, so measure it directly.
    const basis = ticketOnly ? (oaSlot?.clientWidth || wrap.clientWidth) : wrap.clientWidth;
    if (!basis) return;                                    // slot not laid out yet — don't collapse to 1
    const GAP = 6;
    const SELECT_W = 150 + GAP;                            // the "อื่นๆ" dropdown (w-[150px]) + gap
    const kids = Array.from(meas.children) as HTMLElement[];
    const widths = kids.map(k => k.offsetWidth + GAP);
    const totalAll = widths.reduce((s, w) => s + w, 0);

    // First: do ALL tabs fit without any dropdown? Then show them all — collapse
    // ONLY on real overflow, not at an arbitrary 70% cap (that reserved ~30% of a
    // wide strip for a 150px select and hid tabs far too early).
    if (totalAll <= basis) { setInlineCount(kids.length); return; }

    // They overflow → a dropdown WILL be shown, so reserve exactly its width
    // (not a proportional 30%) and pack tabs into the rest.
    const budget = basis - SELECT_W;
    let used = 0, n = 0;
    for (const w of widths) {
      used += w;
      if (used <= budget) n++; else break;
    }
    setInlineCount(Math.max(1, n));                        // always show at least 1
  }, [ticketOnly, oaSlot]);
  useEffect(() => {
    if (groupMode !== 'slider') return;
    // Recompute after layout settles — important when the switcher is portaled
    // into the header (its wrap width isn't final until the header has laid out).
    const raf = requestAnimationFrame(recomputeInline);
    recomputeInline();
    const ro = new ResizeObserver(recomputeInline);
    if (sliderWrapRef.current) ro.observe(sliderWrapRef.current);
    if (oaSlot) ro.observe(oaSlot);   // ticket-only: the header slot drives the width
    window.addEventListener('resize', recomputeInline);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('resize', recomputeInline); };
    // oaSlot in deps: re-run once the portal target exists so we measure the real
    // header width, not the (possibly 0/narrow) pre-portal container.
  }, [recomputeInline, groupMode, orderedGroups.length, oaSlot]);
  const inlineGroups = orderedGroups.slice(0, inlineCount);
  const overflowGroups = orderedGroups.slice(inlineCount);

  // ── fetch active (0,1) tickets for the scope ───────────────────────────
  const fetchActive = useCallback(async (silent = false) => {
    if (!activeGroupId && !activeHookId) return;
    if (silent && isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (!silent) setLoading(true);
    try {
      /* [FEAT-20260826-ACTIVEPAGING] ONE builder decides the request shape
         (services/chat/activeListParams.ts): switch off — or a category
         filter, which no exact param can express — returns the byte-identical
         legacy object and the walk below collapses to a single full fetch. */
      const listBy = (params: Record<string, unknown>) =>
        activeGroupId
          ? ticketService.listTicketsByGroup(activeGroupId, params as any)
          : ticketService.listTicketsByHook(activeHookId!, params as any);
      const base = {
        withinDays: scopeForQuery,
        search: serverSearch,
        ...activeFiltersRef.current,
      };
      const first = activeListParams({ cursor: '', ...base });
      const paged = 'cursor' in first;

      if (!paged) {
        // [FEAT-20260808-DATESCOPE] withinDaysParam is undefined for ทั้งหมด → the
        // service omits the query param → request byte-identical to today.
        const res: any = await listBy(first);
        if (res?.success) {
          let list = res.data || [];
          if (userAllowedHooksSet) {
            list = list.filter((tk: any) => !tk.line_oa_hook_id || userAllowedHooksSet.has(tk.line_oa_hook_id.toString()));
          }
          setActiveTickets(list);
          // [FEAT-20260826-SEARCHLIMITNOTE] read, not shelved
          setActiveSearchLimited((res as any).search_truncated === true);
          setServerTabCounts(null);
          setActiveCursor(null);
          setActiveHasMore(false);
          // [FEAT-20260905-CUSTPROV PART 4] absent/undefined ⇒ stay ON (today).
          applyTierSwitches(res);
        }
      } else {
        /* walk as deep as the operator already was (silent refresh must not
           yank loaded pages away), page 1 on a fresh scope. */
        const pagesTarget = Math.max(1, activePagesRef.current);
        const seen = new Set<string>();
        let rows: TicketEntry[] = [];
        let cursor = '';
        let hasMore = false;
        let counts: typeof serverTabCounts = null;
        let limited = false;
        for (let page = 0; page < pagesTarget; page += 1) {
          const res: any = await listBy(activeListParams({ cursor, ...base }));
          if (!res?.success) break;
          // [FEAT-20260905-CUSTPROV PART 4] same value on every page; cheapest
          // correct spot is right where every other per-page flag is read.
          applyTierSwitches(res);
          for (const tk of res.data || []) {
            const id = String(tk._id);
            if (!seen.has(id)) { seen.add(id); rows.push(tk); }
          }
          counts = counts ?? res.tab_counts ?? null;
          limited = limited || (res as any).search_truncated === true;
          const pg = res.pagination || {};
          hasMore = pg.has_more === true;
          if (!hasMore || !pg.next_cursor) break;
          cursor = pg.next_cursor;
        }
        if (userAllowedHooksSet) {
          rows = rows.filter((tk: any) => !tk.line_oa_hook_id || userAllowedHooksSet.has(tk.line_oa_hook_id.toString()));
        }
        /* F2 — pinned rows the walk did not reach are pulled explicitly:
           uid_ keys through the float-up fetch (member id), id_ keys through
           the existing ids-fetch. ปักหมุดต้องมาเสมอ ไม่ว่าอยู่หน้าไหน. */
        const helpers = pagedHelpersRef.current;
        const have = new Set(rows.map((tk) => getTicketUserKey(tk as any)));
        for (const key of helpers.pinnedRooms) {
          if (have.has(key)) continue;
          if (key.startsWith('uid_')) helpers.scheduleFloatUp(key.slice(4));
          else if (key.startsWith('id_') && key.length > 3) helpers.schedulePartialFetch(key.slice(3));
        }
        setActiveTickets(rows);
        setActiveSearchLimited(limited);
        setServerTabCounts(counts);
        setActiveCursor(hasMore ? cursor : null);
        setActiveHasMore(hasMore);
      }
    } catch (e) {
      console.error('fetch active tickets failed', e);
    } finally {
      isFetchingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [activeGroupId, activeHookId, userAllowedHooksSet, scopeForQuery, serverSearch]);

  /* [FEAT-20260826-ACTIVEPAGING] next page, operator's click — the closed
     tab's loadMoreCompleted, mirrored. Dedup by _id: realtime may have
     prepended a row the next page also carries. */
  const loadMoreActive = useCallback(async () => {
    if (!activeHasMore || !activeCursor || activeLoadingMore) return;
    if (!activeGroupId && !activeHookId) return;
    setActiveLoadingMore(true);
    try {
      const base = { withinDays: scopeForQuery, search: serverSearch, ...activeFiltersRef.current };
      const params = activeListParams({ cursor: activeCursor, ...base });
      if (!('cursor' in params)) return; // switch flipped off mid-session
      let res: any;
      if (activeGroupId) res = await ticketService.listTicketsByGroup(activeGroupId, params as any);
      else if (activeHookId) res = await ticketService.listTicketsByHook(activeHookId!, params as any);
      if (res?.success) {
        let list: TicketEntry[] = res.data || [];
        if (userAllowedHooksSet) {
          list = list.filter((tk: any) => !tk.line_oa_hook_id || userAllowedHooksSet.has(tk.line_oa_hook_id.toString()));
        }
        setActiveTickets(prev => {
          const seen = new Set(prev.map(t => String(t._id)));
          return [...prev, ...list.filter(t => !seen.has(String(t._id)))];
        });
        setActiveCursor(res.pagination?.next_cursor ?? null);
        setActiveHasMore(res.pagination?.has_more === true);
        activePagesRef.current += 1;
      }
    } catch (e) {
      console.error('load more active tickets failed', e);
    } finally {
      setActiveLoadingMore(false);
    }
  }, [activeHasMore, activeCursor, activeLoadingMore, activeGroupId, activeHookId, scopeForQuery, serverSearch, userAllowedHooksSet]);

  /* [FEAT-20260826-ACTIVEPAGING] scope changed → the walk depth resets. A ref
     write only — no fetch, so the OFF behaviour is untouched. */
  useEffect(() => {
    activePagesRef.current = 1;
  }, [activeGroupId, activeHookId, scopeForQuery, serverSearch]);

  /* [FEAT-20260826-ACTIVEPAGING] with paging ON the filters are server params,
     so changing one must refetch. With the switch OFF this body no-ops — a
     filter change causes exactly as many requests as it always did: none. */
  useEffect(() => {
    activePagesRef.current = 1;
    if (activePagingEnabled()) { void fetchActive(true); }
  }, [filterOa, filterTag, filterTier, filterCategory, fetchActive]);

  const fetchCompleted = useCallback(async () => {
    if (!activeGroupId && !activeHookId) return;
    setLoading(true);
    try {
      let res: any;
      // [FEAT-20260808-DATESCOPE] same scope as active list so ปิดเคส/บอทดูแล counts
      // stay consistent with รอรับ/กำลังคุย. undefined → param omitted (ทั้งหมด).
      /* [PERF-20260821-TICKETCURSOR] first page by cursor (100 rows) unless the
         kill switch says legacy — then this is the exact `limit:'all'` request it
         was. The decision lives in closedListParams, pinned by
         test/ticketListCursor.value.test.ts. */
      const params = closedListParams({ cursor: '', withinDays: scopeForQuery, search: serverSearch, categoryLabel: filterCategory || undefined });
      if (activeGroupId) res = await ticketService.listTicketsByGroup(activeGroupId, params);
      else if (activeHookId) res = await ticketService.listTicketsByHook(activeHookId, params);
      if (res?.success) {
        let list = res.data || [];
        if (userAllowedHooksSet) {
          list = list.filter((tk: any) => !tk.line_oa_hook_id || userAllowedHooksSet.has(tk.line_oa_hook_id.toString()));
        }
        setCompletedTickets(list);
        if (typeof res.pagination?.total === 'number') {
          setCompletedTotal(res.pagination.total);
        } else {
          setCompletedTotal(list.length);
        }
        setCompletedCursor(res.pagination?.next_cursor ?? null);
        setCompletedHasMore(res.pagination?.has_more === true);
        setCompletedLoaded(true);
        // [FEAT-20260826-SEARCHLIMITNOTE] read, not shelved
        setCompletedSearchLimited((res as any).search_truncated === true);
        // [FEAT-20260905-CUSTPROV PART 4] same switches, same envelope — the
        // closed tab hits the identical `listTickets` BE method (only
        // `job_status` differs), so this is a second, independent confirmation
        // rather than a second source of truth.
        applyTierSwitches(res);
      }
    } catch (e) {
      console.error('fetch completed tickets failed', e);
    } finally {
      setLoading(false);
    }
  /* [FEAT-20261019-CATFILTER] filterCategory re-runs the closed fetch (full when set, page 1 when
     cleared) — shop-api never changes it, so it never adds a request there */
  }, [activeGroupId, activeHookId, userAllowedHooksSet, scopeForQuery, serverSearch, filterCategory]);

  /* [PERF-20260821-TICKETCURSOR] next page of the ended tab, appended. Dedupe by
     _id: a ticket closed between two pages may already be on screen via
     `ticket:updated` (realtime patches rows it knows; this only adds rows it
     does not). Guarded against double taps. */
  const loadMoreCompleted = useCallback(async () => {
    if (!completedHasMore || !completedCursor || completedLoadingMore) return;
    if (!activeGroupId && !activeHookId) return;
    setCompletedLoadingMore(true);
    try {
      const params = closedListParams({ cursor: completedCursor, withinDays: scopeForQuery, search: serverSearch, categoryLabel: filterCategory || undefined });
      let res: any;
      if (activeGroupId) res = await ticketService.listTicketsByGroup(activeGroupId, params);
      else if (activeHookId) res = await ticketService.listTicketsByHook(activeHookId, params);
      if (res?.success) {
        let list: TicketEntry[] = res.data || [];
        if (userAllowedHooksSet) {
          list = list.filter((tk: any) => !tk.line_oa_hook_id || userAllowedHooksSet.has(tk.line_oa_hook_id.toString()));
        }
        setCompletedTickets(prev => {
          const seen = new Set(prev.map(t => t._id));
          return [...prev, ...list.filter(t => !seen.has(t._id))];
        });
        setCompletedCursor(res.pagination?.next_cursor ?? null);
        setCompletedHasMore(res.pagination?.has_more === true);
      }
    } catch (e) {
      console.error('load more completed tickets failed', e);
    } finally {
      setCompletedLoadingMore(false);
    }
  }, [activeGroupId, activeHookId, completedCursor, completedHasMore, completedLoadingMore, scopeForQuery, serverSearch, userAllowedHooksSet, filterCategory]);

  useEffect(() => { fetchActive(); }, [fetchActive]);
  useEffect(() => { fetchCompleted(); }, [fetchCompleted]);

  // Per-group counts for ALL visible group tabs. The active group's tab still
  // uses the precise live activeTickets length (see render); every OTHER tab
  // shows this fetched total so it's never a stale 0. Refreshed on mount, when
  // the group set changes, and (debounced) on ticket WS events.
  const refreshGroupCounts = useCallback(async () => {
    const groupsToCount = visibleGroups.filter(g => !String(g._id).startsWith('dummy-oa-'));
    if (groupsToCount.length === 0) return;
    const ids = groupsToCount.map(g => g._id);

    // Phase 5 (5a): one batch call instead of N per-group calls. If the BE is too
    // old (404) or the batch fails, fall back to per-group — so an old BE + new FE
    // still works (seamless, independent deploy).
    const batchEnabled = (() => { try { return localStorage.getItem('TC_META_BATCH') !== 'false'; } catch { return true; } })();
    if (batchEnabled) {
      try {
        // [FEAT-20260808-DATESCOPE] scope the OA-tab counts to match the list.
        // undefined → param omitted → today's unbounded batch.
        const res = await ticketService.getTicketMetaBatchRaw(ids, withinDaysParam);
        // Guard against an old BE whose SPA catch-all answers unknown /api paths
        // with 200 + index.html: require JSON content AND a `metas` object before
        // trusting the batch; otherwise fall through to per-group.
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const j = await res.json();
          if (j && j.metas && typeof j.metas === 'object') {
            const metas = j.metas;
            setGroupCounts(prev => {
              const next = { ...prev };
              // group-tab number = "รอรับ" (job_status 0). `waiting` is additive on
              // the BE; an old BE without it → undefined → keep prev/0 (never total).
              ids.forEach(id => { next[id] = metas[id]?.waiting ?? prev[id] ?? 0; });
              return next;
            });
            return;
          }
        }
        // non-OK / non-JSON / no metas (e.g. old BE 404 or SPA fallback) → per-group
      } catch { /* network/parse error → fall through to per-group */ }
    }

    // Fallback: per-group (original path). Kept for old-BE compatibility + as the
    // safety net if the batch endpoint misbehaves.
    const entries = await Promise.all(groupsToCount.map(async g => {
      try {
        const meta = await ticketService.getTicketMetaByGroup(g._id, withinDaysParam);
        return [g._id, meta?.waiting ?? 0] as const;
      } catch { return [g._id, groupCounts[g._id] ?? 0] as const; }
    }));
    setGroupCounts(prev => { const next = { ...prev }; entries.forEach(([id, n]) => { next[id] = n; }); return next; });
  }, [visibleGroups, withinDaysParam]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refreshGroupCounts(); }, [refreshGroupCounts]);

  // ── Realtime handling (ws_plan.md Phase 3): patch-on-event, not refetch-on-event.
  // A full-list refetch on every event × every admin is the #2 scale bottleneck.
  // Instead:
  //   • ticket:updated for a ticket ALREADY in the list → patch it in place
  //     (status change / move / drop when closed) — zero network.
  //   • ticket:new, or an update for a ticket we don't have yet → we lack the
  //     full row (event carries only _id/hook_id/job_status), so coalesce those
  //     into ONE debounced refetch instead of one per event.
  // The 15s poll remains the safety net, and TC_WS_PATCH=false disables patching
  // (falls back to the old refetch-on-event) if anything regresses.
  const wsPatchEnabled = (() => { try { return localStorage.getItem('TC_WS_PATCH') !== 'false'; } catch { return true; } })();
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) return; // one refetch coalesces a burst
    refetchTimerRef.current = setTimeout(() => { refetchTimerRef.current = null; fetchActive(true); }, 600);
  }, [fetchActive]);
  useEffect(() => () => { if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current); }, []);

  /* [FEAT-20260826-ACTIVEPAGING] S8b — the float-up fetch. Under paging a
     customer message can land on a card the walk never loaded; today (full
     fetch) that card is always present and lastMsgAt floats it. The event
     carries the MEMBER id (line_user_id, FEAT-20260819-MSGEVENTUSER) and the
     list endpoint takes it as a param — so we pull exactly that customer's
     open tickets, coalesced 600ms like scheduleRefetch, capped: a burst wider
     than FLOAT_UP_MAX customers falls back to one page-1 refetch. Off-switch
     ⇒ the caller never schedules, this stays inert. */
  /* [FEAT-20260826-PAGINGCOUNTS] 📖 omnidesk-api todo/task/26082026/todo6_26082026_paging-default-on.md (paging phase 1.1)
     badge ต้องตามการ์ดให้ทันแม้ realtime จะ patch แทน fetch — เดิม `setServerTabCounts`
     มีจุดเซ็ตจุดเดียวใน fetchActive ⇒ โหมด ws-patch การ์ดขยับสดแต่ badge แช่แข็ง.
     ทางแก้แบบเดียวกับ `scheduleGroupCountRefresh`: ทุกเหตุการณ์ที่เปลี่ยนสมาชิก/สถานะ
     ของลิสต์นัดดึง "เลขล้วน" หนึ่งครั้ง (debounce 1.5s รวม burst · `limit: 1` = ไม่ขนแถว ·
     `counts: ''` = aggregate ตัวเดิมของ BE ที่มี index แล้ว) — ไม่ทำบัญชีบวกลบฝั่ง client
     เพราะ drift เงียบ. ทุกจุดเรียกอยู่หลัง `activePagingEnabled()` ⇒ สวิตช์ปิด = ศูนย์
     request เพิ่ม byte-identical (pin ใน badgeCountsRefresh.value.test.ts).
     revert: ลบ block นี้ + จุดเรียก 3 บรรทัด (W1a wrapper · W1b float-up · W2 patch branch) */
  const countsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // no-bias 26/08: scope อ่านตอน "ยิง" ไม่ใช่ตอน "นัด" — สลับ OA/กลุ่มระหว่างรอ 1.5s
  // แล้วเลข scope เก่าห้ามมาทับ scope ใหม่ (ref แบบเดียวกับ scopeRef ของ usePartialTicketFetch)
  const countsScopeRef = useRef({ activeGroupId, activeHookId, scopeForQuery, serverSearch });
  countsScopeRef.current = { activeGroupId, activeHookId, scopeForQuery, serverSearch };
  const scheduleCountsRefresh = useCallback(() => {
    if (countsRefreshTimerRef.current) return;
    countsRefreshTimerRef.current = setTimeout(async () => {
      countsRefreshTimerRef.current = null;
      try {
        const f = activeFiltersRef.current;
        const sc = countsScopeRef.current;
        const params: Record<string, unknown> = {
          job_status: '0,1',
          limit: 1,
          cursor: '',
          sort: 'activity',
          counts: '',
          within_days: sc.scopeForQuery,
          search: sc.serverSearch,
          ...(f.oa ? { oa: f.oa } : {}),
          ...(f.tag ? { tag: f.tag } : {}),
          ...(f.tier ? { tier: f.tier } : {}),
        };
        let res: any;
        if (sc.activeGroupId) res = await ticketService.listTicketsByGroup(sc.activeGroupId, params as any);
        else if (sc.activeHookId) res = await ticketService.listTicketsByHook(sc.activeHookId, params as any);
        else return;
        if (res?.success && res.tab_counts) setServerTabCounts(res.tab_counts);
      } catch {
        /* เลขเดิมดีกว่า error — เงียบ แล้วรอรอบหน้า */
      }
    }, 1500);
  }, []);
  useEffect(() => () => { if (countsRefreshTimerRef.current) clearTimeout(countsRefreshTimerRef.current); }, []);

  const activeTicketsRef = useRef<TicketEntry[]>([]);
  useEffect(() => { activeTicketsRef.current = activeTickets; }, [activeTickets]);
  const floatUpRef = useRef<Set<string>>(new Set());
  const floatUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const FLOAT_UP_MAX = 10;
  const scheduleFloatUp = useCallback((memberId: string) => {
    if (!memberId) return;
    floatUpRef.current.add(memberId);
    if (floatUpTimerRef.current) return;
    floatUpTimerRef.current = setTimeout(async () => {
      floatUpTimerRef.current = null;
      const ids = Array.from(floatUpRef.current);
      floatUpRef.current.clear();
      if (ids.length === 0) return;
      if (ids.length > FLOAT_UP_MAX) { scheduleRefetch(); return; }
      const f = activeFiltersRef.current;
      for (const mid of ids) {
        try {
          const params: Record<string, unknown> = {
            job_status: '0,1',
            /* [FIX-20260827-CHANNELUSERPARAM] declare the id's CONTEXT by its
               VALUE SHAPE, not by the variable's name.
               📖 omnidesk-api/todo/task/27082026/todo5_27082026_floatup-identity-contexts.md
               `mid` reaches this fetch from TWO sources that live in different
               id spaces (proven by firing the real flow, not read off names):
                 · pinned uid_ keys — usually the member's Mongo _id (24 hex),
                   because the ticket API's formatTicket puts userRef._id into
                   `line_user_id` (tickets.service.ts:164) — but an orphan
                   pseudo-ticket with no member row falls back to the external
                   id (orphanRooms.ts:51);
                 · the message:new WS event — ALWAYS the external `Uxxx…` id
                   (its publisher carries room.line_user_id,
                   chat-history.service.ts:450). This leg used to 400.
               The two spaces are disjoint by construction (24-hex ObjectId vs
               `U`+32-hex, 33 chars) so the shape IS the context. Each goes out
               under its honest, channel-neutral name; the BE resolves
               `channel_user_id` to the member before filtering, and an unknown
               id yields an EMPTY list — never an unfiltered one.
               revert: send `member_id: mid` unconditionally (WS leg 400s again). */
            limit: 'all', // bounded to ONE customer's open cases either way
            ...(/^[0-9a-f]{24}$/i.test(mid)
              ? { member_id: mid }
              : { channel_user_id: mid }),
            within_days: scopeForQuery,
            search: serverSearch,
            ...(f.oa ? { oa: f.oa } : {}),
            ...(f.tag ? { tag: f.tag } : {}),
            ...(f.tier ? { tier: f.tier } : {}),
          };
          let res: any;
          if (activeGroupId) res = await ticketService.listTicketsByGroup(activeGroupId, params as any);
          else if (activeHookId) res = await ticketService.listTicketsByHook(activeHookId, params as any);
          else return;
          const rows: TicketEntry[] = (res?.success ? res.data : []) || [];
          if (rows.length) {
            setActiveTickets(prev => mergePartialTickets(prev, rows, { allowedHooks: userAllowedHooksSet ?? null }));
            if (activePagingEnabled()) scheduleCountsRefresh(); // [FEAT-20260826-PAGINGCOUNTS] W1b
          }
        } catch {
          scheduleRefetch();
          return;
        }
      }
    }, 600);
  }, [activeGroupId, activeHookId, scopeForQuery, serverSearch, userAllowedHooksSet, scheduleRefetch, scheduleCountsRefresh]);
  useEffect(() => () => { if (floatUpTimerRef.current) clearTimeout(floatUpTimerRef.current); }, []);

  /* [PERF-20260822-TKTIDSFETCH] ดึงเฉพาะใบที่ระบุ แทนการโหลดทั้งลิสต์ — ตรรกะทั้งหมด
     รวมทางตกกลับ 3 ทาง อยู่ใน services/chat/usePartialTicketFetch.ts ซึ่งเทสได้ตรง ๆ
     ที่นี่แค่ส่ง scope เดิมของ fetchActive เข้าไปให้ครบ (BE เอา ids ไป AND ทับ
     ⇒ ตั๋วที่ไม่ตรงคำค้นแอบเข้ามาไม่ได้) · ไม่แตะ scheduleRefetch ที่จุดอื่นทั้ง 12 จุด
     revert: ลบบล็อกนี้ + import แล้วเปลี่ยนจุดเรียกกลับเป็น scheduleRefetch() */
  const schedulePartialFetch = usePartialTicketFetch<TicketEntry>(
    { activeGroupId, activeHookId, withinDays: scopeForQuery, search: serverSearch, allowedHooks: userAllowedHooksSet ?? null },
    {
      listByGroup: ticketService.listTicketsByGroup,
      listByHook: ticketService.listTicketsByHook,
      scheduleRefetch,
      // [FEAT-20260826-PAGINGCOUNTS] W1a — ทุก merge ที่ไหลผ่าน hook นี้ (ticket:new,
      // ใบที่ยังไม่มีในลิสต์, refresh ใบที่เปิดอยู่) ต้องนัดรีเฟรชเลข badge ด้วย
      setActiveTickets: (u: (prev: TicketEntry[]) => TicketEntry[]) => {
        setActiveTickets(u);
        if (activePagingEnabled()) scheduleCountsRefresh();
      },
    },
  );

  /* [FEAT-20260826-ACTIVEPAGING] read by fetchActive's paged branch through a
     render-assigned ref — keeping fetchActive's deps EXACTLY the legacy list,
     so with the switch OFF nothing new can retrigger it (F5). */
  const pagedHelpersRef = useRef({
    pinnedRooms: [] as string[],
    scheduleFloatUp: (_m: string) => {},
    schedulePartialFetch: (_id: string) => {},
  });
  pagedHelpersRef.current = { pinnedRooms, scheduleFloatUp, schedulePartialFetch };

  // Phase 5 (5d): debounced + trailing-coalesced per-group count refresh. A burst
  // of ticket events collapses into ONE meta round (leading window). If more
  // events land WHILE a refresh is in flight, we mark it pending and run exactly
  // one more round after — so counts never stay stale, without a call per event.
  // At 100 admins this bounds the batch-meta calls to ~1 per (window + fetch), not
  // one per event. Window widened 800→1000ms to coalesce harder at scale.
  const groupCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupCountBusyRef = useRef(false);
  const groupCountPendingRef = useRef(false);
  const runGroupCountRefresh = useCallback(async () => {
    if (groupCountBusyRef.current) { groupCountPendingRef.current = true; return; }
    groupCountBusyRef.current = true;
    try { await refreshGroupCounts(); }
    finally {
      groupCountBusyRef.current = false;
      if (groupCountPendingRef.current) { groupCountPendingRef.current = false; runGroupCountRefresh(); }
    }
  }, [refreshGroupCounts]);
  const scheduleGroupCountRefresh = useCallback(() => {
    if (groupCountBusyRef.current) { groupCountPendingRef.current = true; return; } // in flight → coalesce
    if (groupCountTimerRef.current) return;
    groupCountTimerRef.current = setTimeout(() => { groupCountTimerRef.current = null; runGroupCountRefresh(); }, 1000);
  }, [runGroupCountRefresh]);
  useEffect(() => () => { if (groupCountTimerRef.current) clearTimeout(groupCountTimerRef.current); }, []);

  const handleWsEvent = useCallback((e: { type: string; data: Record<string, unknown> }) => {
    // ==== [FEAT-20260730-PROFILEPUSH] START — ข้อมูลลูกค้าเปลี่ยน → ดันเข้าการ์ดสด
    // 🔒 branch to_dev_custom_adapter
    //
    // BE ยิงเมื่อ: ลูกค้าผูกบัญชีสำเร็จ · แอดมินแก้ไขการผูก · แอดมินเคลียร์ข้อมูล
    //
    // ── ทำไมส่งต่อด้วย CustomEvent ไม่ใช่ setState ──────────────────────────
    // การ์ดอยู่ใน PersonalPanelNarrow ซึ่งเป็นคนละ component และถือ state ของ
    // โปรไฟล์เอง (rawProfile) การยก state ขึ้นมาที่นี่ = รื้อของเดิมที่ทำงานดีอยู่
    // ใช้ CustomEvent แบบเดียวกับ 'tc:tags-changed' / 'tc:assist-changed' ที่มี
    // ในไฟล์นี้อยู่แล้ว → แตะของเดิมน้อยที่สุด และ revert ได้สะอาด
    //
    // **วางไว้บนสุดของ handler และ return ทันที** เพื่อไม่ให้ไหลลงไปเจอ logic
    // ของ ticket list ข้างล่าง (event นี้ไม่มี ticket id ถ้าหลุดลงไปจะ refetch เปล่า)
    // revert: ลบบล็อกนี้ + handler ใน PersonalPanelNarrow + type ใน useTicketWS
    /* [PERF-20260822-TKTIDSFETCH] ต่อกลับได้หลังสายหลุด — event ระหว่างนั้นหายไปแล้ว
       และตั้งแต่รอบนี้เป็นต้นไปเส้น fallback ดึงเฉพาะใบที่ระบุ จึงไม่มีอะไรกู้ให้อีก
       โหลดใหม่ทั้งชุดหนึ่งครั้ง คือตาข่ายเดียวที่เหลือ (ก่อนหน้านี้ไม่มีเลย —
       full refetch ของ scheduleRefetch บังเอิญทำหน้าที่นี้อยู่)
       ยิงเฉพาะ "ต่อกลับ" ไม่ใช่ต่อครั้งแรก — useTicketWS แยกให้แล้ว */
    if (e.type === 'ws:reconnected') { fetchActive(true); return; }

    if (e.type === 'customer:profile_updated') {
      window.dispatchEvent(new CustomEvent('tc:customer-profile-updated', { detail: e.data }));
      return;
    }
    // ==== [FEAT-20260730-PROFILEPUSH] END

    // ── message:new (realtime chat, both directions) ──────────────────────────
    // A new bubble was stored (customer inbound OR admin outbound). If it belongs
    // to the OPEN room → remount ChatRoomView so it refetches and shows the bubble.
    // Otherwise mark that room unread (yellow badge) — but only for customer
    // messages (the admin's own outbound isn't "unread" for them). The list
    // preview/order comes from the next activeTickets refresh (poll/patch); this
    // handler only drives the live bubble + unread indicator so it's cheap.
    /* [REMOVED-20260820-ABANDON] a `room:abandon` branch lived here: it marked the
       conversation so the tab, the card and the chime could react. The owner retired
       the whole alert on 2026-08-20 and nothing replaces it — the bot-care list is
       already kept live by the `message:new` handler just below, which refreshes it
       for any customer message while that tab is open, and an abandon could only ever
       follow a customer message. ไม่มีอะไรหายจาก realtime.
       เงื่อนไขเดิมเก็บครบที่ omnidesk-api/todo/be_todo27_20082026.md. */

    if (e.type === 'message:new') {
      const roomId = e.data?.room_id as string | undefined;
      const senderType = e.data?.sender_type as string | undefined;
      /* [FIX-20260819-ORPHANLIVE] a customer writing is the ONLY way a room with no
         ticket becomes worth showing, and the only signal about one that reaches the
         dashboard at all. Rooms are created constantly, so this tab cannot wait for
         the operator to re-enter it. Refreshed only while that tab is open, so no
         other view pays for it. ห้องเกิดใหม่ตลอด แท็บนี้ต้องสดจริง. */
      if (statusTab === 'bot' && senderType === 'customer') scheduleOrphanRefresh();
      if (!roomId) return;
      /* [FEAT-20260819-NEWESTTOP] stamp WHEN this customer last wrote, for EVERY
         inbound message — including one for the room already open, so the card
         being read stays on top instead of sinking. Keyed both ways the list can
         look a row up (room id and LINE user id), the same pair the unread map
         uses, so the two can never disagree about which row an event belongs to.
         ต้องจำเวลาเอง เพราะข้อความไม่แตะ updated_at ของ ticket. */
      if (senderType === 'customer') {
        // This page's handler is typed without the envelope's `ts`, so the arrival
        // time is taken locally — the ordering only needs "which came later".
        const at = Date.now();
        /* [FIX-20260819-OAKEY] the person-wide LINE id is not a valid key on its
           own — see unreadFor. Stamp the room id (already conversation-scoped) and
           the OA-scoped customer key, which is what the cards look up. */
        const stampKeys = [
          roomId,
          customerEventKey(e.data?.hook_id, e.data?.line_user_id),
        ].filter(Boolean) as string[];
        setLastMsgAt(prev => {
          let next = prev;
          for (const k of stampKeys) next = markMessageAt(next, k, at);
          return next;
        });
      }
      const openRoomId = selectedRoom?._id || (selectedRoom as any)?.line_user_id;
      if (openRoomId && roomId === openRoomId) {
        // [FIX-20260728-NOBLINK] เดิมคือ: setChatRefreshKey(k => k + 1);
        // = remount ทั้งห้องทุกข้อความที่เข้ามา (กระพริบ + โหลดรูปใหม่ทั้งห้อง)
        // ตอนนี้ ChatRoomView subscribe message:new เองแล้ว append ตรงจุด
        // จึงไม่ต้องทำอะไรที่นี่ — ปล่อยให้ component จัดการ ไม่ยิงซ้ำซ้อน
        // revert: ใส่ setChatRefreshKey(k => k + 1); กลับมา แล้วลบ handler
        //         message:new ใน ChatRoomView.tsx
      } else if (senderType === 'customer') {
        /* [FIX-20260819-UNREADKEY] key the count by the LINE user id AS WELL as the
           room id. The badge reads `unreadByRoom[tk.chat_room_id] ||
           unreadByRoom[tk.line_user_id]`, and NEITHER can ever hold a room id: the
           ticket list returns no `chat_room_id` at all (checked against the live
           endpoint, not the source), and `tk.line_user_id` holds the MEMBER ObjectId.
           So this map was written under a key nothing ever looked up and the badge
           never appeared once — dead since the day it was added. `line_user_id` is the
           one id the event and the card share; the BE started sending it in
           [FEAT-20260819-MSGEVENTUSER]. Both keys are written, so an older BE that does
           not send the field behaves exactly as before.
           เขียนคีย์ที่การ์ดหาเจอจริง ไม่งั้น badge ไม่มีวันขึ้น. */
        const lineUserId = e.data?.line_user_id as string | undefined;
        /* [FEAT-20260826-ACTIVEPAGING] S8b — the card this message belongs to
           may live on a page the walk never loaded. Only paging mode needs the
           pull; membership is checked against the live list via ref. */
        if (
          lineUserId &&
          activePagingEnabled() &&
          !activeTicketsRef.current.some(tk => String((tk as any).line_user_id ?? '') === String(lineUserId))
        ) {
          scheduleFloatUp(lineUserId);
        }
        /* [FEAT-20260907-TABSEEN] a message arrived, so nothing is "already seen" any
           more — without this the acknowledgement would cover the badge forever and the
           next message would announce nothing. Added BESIDE the increment: the counter,
           its keys and its conditions below are untouched.
           ref: todo/task/07092026/fe_todo114_07092026_tabglowclear.md */
        setTabSeen(NOTHING_SEEN);
        setUnreadByRoom(prev => {
          const next = { ...prev, [roomId]: (prev[roomId] || 0) + 1 };
          /* [FIX-20260819-OAKEY] OA-scoped. One customer can hold conversations on
             several OAs (8 already do), so the bare LINE id would light their card
             on every OA they have ever written to. */
          const key = customerEventKey(e.data?.hook_id, lineUserId);
          if (lineUserId) next[key] = (prev[key] || 0) + 1;
          return next;
        });
      }

      /* [FEAT-20260820-MSGGLOW] …and light the GROUP tab, which until now only a
         NEW CASE could do. Owner: "เวลามีข้อความใหม่ในเคส ก็ให้สีส้มขึ้นด้วย ทั้งแท็บ
         hook list เลย + select option ด้วยต้องส้มกรอบ".

         The other three places the owner named already lit up from the lines
         above — the card's badge, its orange text, and the status tabs all read
         `unreadByRoom`. The `อื่นๆ` select needs nothing of its own either: its
         ring is derived from `groupHasNew`, so it follows this line for free.

         ⚠️ ADDITIVE ONLY. Nothing above is touched and the `return` below still
         ends the branch exactly where it did, so every other realtime rule —
         unread counts, newest-top ordering, the orphan refresh — behaves as
         before. The group→hook lookup is the same one the ticket branch uses.
         เพิ่มอย่างเดียว ไม่แตะของเดิมสักบรรทัด · realtime อื่นเหมือนเดิมทั้งหมด.

         Cleared the same way a new case is: opening the group drops the flag
         (`selectGroup`). Who is excluded, and why, lives in
         `services/chat/ticketAlerts.ts`. */
      if (messageLightsGroupTab(e)) {
        const msgHook = hooks.find(h => h._id === (e.data?.hook_id as string));
        const msgGid = (msgHook?.group ?? (msgHook as any)?.group_id) as string | undefined;
        if (msgGid) {
          setGroupHasNew(prev => (prev[msgGid] ? prev : { ...prev, [msgGid]: true }));
        }
      }
      return;
    }
    // [FEAT-20260817-REOPENBYADMIN] a reopen is deliberately NOT ticket:new
    // (which lights the "รอรับเคส" tab and chimes everyone) and NOT
    // ticket:updated (which only patches tickets already in the list). The
    // presser already moved their card locally; everyone else refetches.
    if (e.type === 'ticket:reopened') {
      const evAdmin = String(e.data?.admin_user_id ?? '');
      if (!evAdmin || !currentUser || evAdmin !== String(currentUser.id)) {
        fetchActive(true);
      }
      return;
    }
    /* [FIX-20260819-ORPHANLIVE] …and a new ticket can make a room STOP being an
       orphan, so the same refresh runs for that too (the card turns green). */
    if (statusTab === 'bot' && e.type === 'ticket:new') scheduleOrphanRefresh();
    if (e.type !== 'ticket:new' && e.type !== 'ticket:updated') return;

    // Group tab realtime: resolve the event's hook → its group, refresh that
    // group's count (debounced), and — for a NEW ticket in a group we're not
    // viewing — flag it yellow. Runs regardless of TC_WS_PATCH: counts/highlights
    // for OTHER groups don't depend on the open list.
    const evHookId = e.data?.hook_id as string | undefined;
    if (evHookId) {
      const grp = hooks.find(h => h._id === evHookId);
      const gid = (grp?.group ?? (grp as any)?.group_id) as string | undefined;
      if (gid) {
        scheduleGroupCountRefresh();
        if (e.type === 'ticket:new') {
          // [FIX-20260808-ACTIVETAB-NOTIFY] A new case must flag its badge yellow on ANY
          // group/tab — INCLUDING the group the operator is currently viewing. Previously the
          // active group was excluded (`if (gid !== activeGroupId)`), so a new case landing in
          // the group you are already on lit NO group-tab badge; the yellow only appeared when
          // you happened to be on a different group. Now flag the group ALWAYS; and when it is
          // the OPEN group, additionally mark the "รอรับเคส" (waiting) status-tab number yellow.
          // The flag clears when the admin (re)clicks the group tab (selectGroup) / status tab.
          // ⚠️ Highlight flags ONLY — counts/meta/reconciliation (scheduleGroupCountRefresh,
          //    scheduleRefetch, the count formula) are untouched. The chime is fired globally in
          //    App.tsx on ticket:new (honors the ui.notiSound preference) — independent of tab.
          // revert: restore `if (gid !== activeGroupId) { setGroupHasNew } else { setStatusHasNew }`.
          setGroupHasNew(prev => (prev[gid] ? prev : { ...prev, [gid]: true }));
          if (gid === activeGroupId) {
            setStatusHasNew(prev => (prev.waiting ? prev : { ...prev, waiting: true }));
          }
        }
      }
    }

    if (!wsPatchEnabled) { fetchActive(true); return; }

    const id = e.data?._id as string | undefined;
    const status = e.data?.job_status;

    // updated event with a status, for a ticket we already hold → patch in place.
    if (e.type === 'ticket:updated' && id && typeof status === 'number') {
      const category = e.data?.category as string | null | undefined;
      /* [FIX-20261019-CLOSELIVE] "is this ticket in the open list?" and the close snapshot are
         decided from the list ON SCREEN (`activeTicketsRef`, synced after every commit) — NOT inside
         the setActiveTickets updater below. React runs an updater eagerly only when nothing else is
         queued; with another update pending it defers it to the next render, so `found` read a few
         lines down was still false: the row left the open tabs (the updater ran later) but never
         reached ปิดเคส/บอทดูแล, and the fallback partial fetch asks job_status 0,1 only, so nothing
         brought it back until the closed list reloaded. Proven 19/10 with a trace (4 of 6 runs of
         the realtime close case) and pinned by a deterministic case in ticketChatRealtime.dom.test.
         Display is unchanged by design: same row, same counts, same instant move — it now happens
         every time. The removal / patch itself still runs in the updater, on the latest state.
         A row not on screen yet (added by an update not committed) falls through to the partial
         fetch exactly as before.
         revert: compute `found` / `closedSnapshot` inside the updater again. */
      const onScreen = activeTicketsRef.current.find(tk => tk._id === id);
      const found = !!onScreen;
      // For status=2 (close): the snapshot of the full ticket (includes chat_room_data,
      // assist_status, etc.) is prepended to completedTickets so the "ปิดเคส" and "บอทดูแล"
      // counts update in real-time for ALL browsers (own WS echo + other browsers).
      const closedSnapshot: TicketEntry | undefined = onScreen && status === 2
        ? ({ ...onScreen, job_status: 2, ...(category !== undefined ? { category } : {}) } as TicketEntry)
        : undefined;
      setActiveTickets(prev => {
        const idx = prev.findIndex(tk => tk._id === id);
        if (idx === -1) return prev;              // not ours — fall through to refetch
        if (status === 2) {
          return prev.filter(tk => tk._id !== id);
        }
        const next = prev.slice();
        // Patch status AND category (category badge is a projection of this field,
        // so it re-renders for free) — the event now carries category.
        next[idx] = { ...next[idx], job_status: status, ...(category !== undefined ? { category } : {}) } as TicketEntry;
        return next;
      });
      // Prepend closed ticket into completedTickets so closed-count and bot-count
      // update instantly for every connected browser. The dedup guard prevents a
      // double-entry when own browser's optimistic update (L1421) already added it.
      if (found && status === 2 && closedSnapshot) {
        const snap = closedSnapshot;
        setCompletedTickets(prev =>
          prev.some(tk => tk._id === snap._id) ? prev : [snap, ...prev]
        );
      }
      // If the ticket was accepted (0 or 1), make sure it is removed from completedTickets
      // to keep counts synchronized (since scheduleRefetch only fetches active tickets).
      if (status === 0 || status === 1) {
        setCompletedTickets(prev => prev.filter(tk => tk._id !== id));
      }
      /* [FIX-20260823-CLAIMCAS] แถวในลิสต์ถูก patch ด้วย job_status + category
         เท่านั้น ⇒ **`admin_user_data` ค้าง** ทั้งในลิสต์และในกล่อง "รับเคสต่อ"
         (กล่องอ่านจาก `selectedTicket` — ดู `isOtherAdminCase`)
         ⇒ ถ้า event นี้เป็นตั๋ว **ใบที่เปิดอยู่บนจอ** ให้ดึงของสดใบเดียว
         เงื่อนไขแคบที่สุดเท่าที่จะแคบได้: แอดมินหนึ่งคนเปิดได้ทีละใบ ⇒ อย่างมาก
         1 คำขอต่อการกระทำบนตั๋วที่ตัวเองเปิดอยู่ · เคสอื่นเข้ามากี่ใบก็ไม่เพิ่ม
         ⚠️ ใช้ `schedulePartialFetch` ตัวเดิม (debounce 600ms · รวม id เป็น Set ·
            เพดาน 50 ใบแล้วตกเป็น full refetch) — ไม่ได้สร้างกลไกใหม่
         ⚠️ ไม่แตะ payload ของ `ticket:updated` ⇒ badge/นับ/แท็บ bot ไม่กระทบ */
      if (found && id === selectedTicketIdRef.current) {
        schedulePartialFetch(id);
      }
      // [FEAT-20260826-PAGINGCOUNTS] W2 — patch เปลี่ยนสถานะ/สมาชิกของลิสต์โดยไม่ fetch
      // (รวม echo ของ action ตัวเอง: รับ/ปิด/reopen) ⇒ เลข badge ต้องตามให้ทัน
      if (found && activePagingEnabled()) scheduleCountsRefresh();
      if (found) return;                          // patched, no network
    }
    /* [PERF-20260822-TKTIDSFETCH] ตั๋วใหม่ หรือ update ของใบที่ยังไม่มีในลิสต์ —
       ยังต้องได้แถวเต็มจาก BE แต่ขอเฉพาะ "ใบนั้น" แทนทั้งลิสต์
       ไม่มี id (event ผิดรูป) → ตกกลับ full refetch ใน schedulePartialFetch เอง */
    schedulePartialFetch(String(e.data?._id ?? ''));
  }, [wsPatchEnabled, fetchActive, scheduleRefetch, schedulePartialFetch, scheduleCountsRefresh, hooks, activeGroupId, selectedRoom, scheduleGroupCountRefresh, statusTab, currentUser]);

  useTicketWS(handleWsEvent);

  // Tag added/removed in the detail box → patch the matching cards' chips IN PLACE
  // (no refetch). The event carries the new tags; we update every ticket of the
  // same customer in both lists (tags are per-customer, shared across tickets),
  // matched by user identity (not _id). Falls back to a refetch if no payload.
  useEffect(() => {
    const onTags = (e: Event) => {
      const detail = (e as CustomEvent).detail as { roomId?: string; tags?: { _id: string; label: string; color: string | null }[] } | undefined;
      if (!detail || !detail.tags || !selectedTicket) { fetchActive(true); return; }
      const nextTags = detail.tags;
      const patch = (tk: TicketEntry) => isSameTicketUser(selectedTicket, tk) ? { ...tk, customer_tags: nextTags } : tk;
      setActiveTickets(prev => prev.map(patch));
      setCompletedTickets(prev => prev.map(patch));
      setSelectedTicket(prev => prev && isSameTicketUser(prev, selectedTicket) ? { ...prev, customer_tags: nextTags } : prev);
    };
    window.addEventListener('tc:tags-changed', onTags);
    return () => window.removeEventListener('tc:tags-changed', onTags);
  }, [fetchActive, selectedTicket]);

  // Real-time assist_status tracking: ChatRoomView fires 'tc:assist-changed'
  // whenever the admin toggles assist on/off. We update roomAssistMap so the
  // yellow bot bar below re-renders without waiting for a ticket list refetch.
  useEffect(() => {
    const onAssist = (e: Event) => {
      const { roomId, assistStatus } = (e as CustomEvent<{ roomId: string; assistStatus: boolean }>).detail;
      if (!roomId) return;
      setRoomAssistMap(prev => ({ ...prev, [roomId]: assistStatus }));
    };
    window.addEventListener('tc:assist-changed', onAssist);
    return () => window.removeEventListener('tc:assist-changed', onAssist);
  }, []);

  // ── derived list for the current tab + filters ─────────────────────────
  const visibleTickets = useMemo(() => {
    const uid = currentUser?.id;
    let base: TicketEntry[] = [];
    if (statusTab === 'ended') {
      base = completedTickets;
    } else if (statusTab === 'bot') {
      /* [FIX-20260820-BOTCOUNT] the rows and the badge now come from one place —
         `botRows` above. What used to live here (the closed-case filter, the
         orphan subtraction, `everTicketed`, and the date window) moved into
         `botTabRows` in services/chat/orphanRooms.ts, unchanged in behaviour and
         covered by test/botTabRows.value.test.ts.
         ย้ายกฎไปที่เดียว · พฤติกรรมเท่าเดิม · ตัวนับกับรายการ drift ไม่ได้อีก. */
      base = botRows;
    } else if (statusTab === 'mine') {
      base = activeTickets.filter(tk => Number(tk.job_status) === 1 && tk.admin_user_id === uid);
    } else if (statusTab === 'waiting') {
      base = activeTickets.filter(tk => Number(tk.job_status) === 0);
    } else {
      // active
      base = activeTickets.filter(tk => Number(tk.job_status) === 1);
    }
    return base.filter(tk => {
      if (filterOa && tk.line_oa_hook_id !== filterOa) return false;
      // category + tag are INDEPENDENT filters (AND). category matches on tk.category;
      // tag matches on tk.customer_tags membership. Picking both narrows to rows in both.
      if (filterCategory) {
        const opt = categoryOptions.find(o => o.label === filterCategory);
        if (opt && !opt.match(tk.category)) return false;
      }
      // [FEAT-20260801-TAGGROUP] เทียบด้วย tag_id ไม่ใช่ชื่อ — ชื่อป้ายซ้ำข้ามกลุ่มได้แล้ว
      // (กลุ่ม A กับ B ต่างมี "VIP" ของตัวเอง ถ้าเทียบชื่อจะลากของอีกกลุ่มติดมาด้วย)
      if (filterTag && !(tk.customer_tags || []).some(cg => cg.tag_id === filterTag)) return false;
      // [FEAT-20260801-MEMBERTIER] กรองตามระดับสมาชิกที่ BE เก็บไว้บน Member
      if (filterTier && tierKeyOf(tierOfMember(tk.line_user_data)) !== filterTier) return false;
      if (activeSearch.trim()) {
        const ud = tk.line_user_data;
        const pDetail = parseCustomerDetail(ud?.detail);
        /* [FIX-20260817-SEARCHRAWPROFILE] ตัวเทียบอยู่ที่ utils/memberSearchText.ts
           ที่เดียว (ตัวกรองนี้มีสองชุดในไฟล์นี้ — เคยก๊อปกันไว้)
           array เดิมค้น `bank_account`/`bank_name`/`account_name`/`true_wallet`/
           `domain`/`agent`/`agent_code` ซึ่ง **ไม่มีอยู่ใน member schema เลย**
           ⇒ ค้นเลขบัญชีไม่เคยเจอ · ค่าจริงอยู่ใน raw_profile_data (payload มีมาให้แล้ว)
           ชื่อไลน์ · เบอร์ · ชื่อ-สกุล · เลขบัญชี ครบตามที่เจ้าของสั่ง
           (domain/agent/truewallet ตั้งใจไม่ค้น ตามที่สั่ง) */
        if (
          !memberMatchesSearch(ud, activeSearch, [
            pDetail.phone,
            pDetail.name,
            pDetail.contract,
            tk.line_user_id,
          ])
        )
          return false;
      }
      return true;
    });
  }, [statusTab, activeTickets, completedTickets, filterOa, filterCategory, filterTag, filterTier, categoryOptions, activeSearch, currentUser, orphanRooms, withinDaysParam]);

  /* ==== [FEAT-20260811-CHATPIN] เส้นที่สามที่ต้องเรียงหมุด ====
   * แท็บ `active` / `mine` / `waiting` render `visibleTickets` ตรง ๆ (`:2436`) และเส้นนี้
   * **ไม่มี sort ของตัวเองเลย** — ใช้ลำดับที่ BE ส่งมา ⇒ ต้องเพิ่มการเรียงที่นี่
   * ไม่ใช่แค่แทรกเงื่อนไขเหมือนอีกสองเส้น
   * ⚠️ `active` คือแท็บที่แอดมินใช้มากที่สุด ถ้าลืมเส้นนี้ = หมุดไม่ทำงานในแท็บหลัก
   *    (จับได้ตอนรีวิว ไม่ใช่ตอนใช้จริง — จดไว้ที่ fe_todo12 §2.2)
   * ไม่ปักอะไรไว้ ⇒ คืน array เดิมทั้งตัว ไม่ copy ไม่ sort = พฤติกรรมเดิมเป๊ะ */
  /* [FEAT-20260819-NEWESTTOP] …and it must ORDER them too — owner: "ใหม่สุดต้องขึ้น
     บนเสมอ" for ส่วนตัว / รอรับเคส / กำลังคุย.
     ⚠️ THIS FILE IS THE LIVE PAGE (`/ticket-support`). `TicketSupport.tsx` is the
     old table on `/legacy-ticket` — a different screen with its own sort.

     Two things were missing, and only together do they give "newest on top":
       1. this list had NO sort at all (see the note above) — it showed whatever
          order the BE happened to return;
       2. a new MESSAGE never touches the ticket row, so even a sorted list could
          not react to a customer writing. `lastMsgAt` supplies that, and
          `activityAt` only ever RAISES a row — a stale event can never push a
          card down.
     Pinned rooms still win: the comparator is wrapped in `byPinnedFirst`, exactly
     as before, so pinning behaves identically. ปักหมุดยังอยู่บนสุดเหมือนเดิม. */
  const visibleTicketsPinned = useMemo(() => {
    const activityOf = (tk: TicketEntry): number => {
      const own = tk.updated_at
        ? new Date(tk.updated_at).getTime()
        : (tk.created_at ? new Date(tk.created_at).getTime() : 0);
      return activityAt(own, unreadFor(lastMsgAt, tk as never));
    };
    const newestFirst = (a: TicketEntry, b: TicketEntry) => activityOf(b) - activityOf(a);
    return [...visibleTickets].sort(
      byPinnedFirst<TicketEntry>(pinnedRooms, getTicketUserKey)(newestFirst),
    );
  }, [visibleTickets, pinnedRooms, lastMsgAt]);

  /* [FEAT-20261020-TICKETSTACK] fold the SORTED list into stacks for ส่วนตัว/รอรับเคส/กำลังคุย.
     Read once per mount (reload to apply a flag change). Off ⇒ null ⇒ the list below is fed
     `visibleTicketsPinned` and every slot renders the plain card — the old page exactly.
     บอทดูแล already shows one card per customer; ปิดเคส has its own grouping further down.
     Counts never read this — they are built from the ungrouped rows. */
  const ticketStackOn = useMemo(() => isTicketStackOn(), []);
  const mainStacks = useMemo(
    () => (ticketStackOn && statusTab !== 'bot' && statusTab !== 'ended' ? groupTicketStacks(visibleTicketsPinned) : null),
    [ticketStackOn, statusTab, visibleTicketsPinned],
  );

  const [expandedGroupCardId, setExpandedGroupCardId] = useState<string | null>(null);

  // Group closed tickets ("ปิดเคส" tab) by user
  const groupedEndedTickets = useMemo(
    () => groupEndedTickets({ statusTab, visibleTickets, ticketStackOn, pinnedRooms }),
    [statusTab, visibleTickets, pinnedRooms, ticketStackOn],
  );

  // Group bot-handled tickets by user, returning latest ticket per user for normal card layout
  const groupedBotTickets = useMemo(
    () => groupBotTickets({ statusTab, visibleTickets, pinnedRooms }),
    [statusTab, visibleTickets, pinnedRooms],
  );

  /* [FEAT-20260819-CARDWINDOW] 25 cards on screen, more revealed as the operator
     scrolls — on EVERY tab. Owner: "max cardrecord = 25 · load more ทุกแท็บ · ต้องไม่
     กระทบ realtime + search".

     It windows the RENDER only, below the sort and below the filters, which is
     exactly why nothing breaks:
       · SEARCH is unaffected — it narrows the full list upstream, so a match that
         used to sit at position 400 becomes position 3 and is inside the window.
         Nothing is stranded on a server page. ค้นยังค้นได้ทั้งหมด.
       · REALTIME is unaffected — the list is re-sorted above this, so a new
         message moves its card to the top and the window shows it at once.
     The reset key is what genuinely means "a different list": switching tab,
     group, OA or filters starts at 25 again, while a realtime rebuild of the same
     list does NOT — an operator scrolled to card 90 must not be yanked back
     because somebody, somewhere, sent a message. เลื่อนอ่านอยู่ ห้ามโดนดีดกลับ. */
  const cardWindowKey = [
    statusTab, activeGroupId, activeHookId, filterOa, filterCategory,
    filterTag, filterTier, debouncedSearch, filterWithinDays,
  ].join('|');
  const mainWindow = useCardWindow(
    // [FEAT-20261020-TICKETSTACK] flag on ⇒ one front card per stack, still in sorted order
    statusTab === 'bot' ? groupedBotTickets : (mainStacks?.fronts ?? visibleTicketsPinned),
    cardWindowKey,
  );
  const endedWindow = useCardWindow(groupedEndedTickets, cardWindowKey);
  // [FEAT-20261020-TICKETSTACK] open/folded per stack — folds again when the list changes
  const stackExpand = useStackExpand(cardWindowKey);

  const getUniqueUserCount = useCallback((tickets: TicketEntry[]) => {
    const set = new Set<string>();
    for (const tk of tickets) {
      set.add(getTicketUserKey(tk));
    }
    return set.size;
  }, []);

  const filterByActiveFilters = useCallback((list: TicketEntry[]) => {
    return list.filter(tk => {
      if (filterOa && tk.line_oa_hook_id !== filterOa) return false;
      // category + tag are INDEPENDENT filters (AND) — see the visible-list memo above.
      if (filterCategory) {
        const opt = categoryOptions.find(o => o.label === filterCategory);
        if (opt && !opt.match(tk.category)) return false;
      }
      // [FEAT-20260801-TAGGROUP] เทียบด้วย tag_id ไม่ใช่ชื่อ — ชื่อป้ายซ้ำข้ามกลุ่มได้แล้ว
      // (กลุ่ม A กับ B ต่างมี "VIP" ของตัวเอง ถ้าเทียบชื่อจะลากของอีกกลุ่มติดมาด้วย)
      if (filterTag && !(tk.customer_tags || []).some(cg => cg.tag_id === filterTag)) return false;
      // [FEAT-20260801-MEMBERTIER] กรองตามระดับสมาชิกที่ BE เก็บไว้บน Member
      if (filterTier && tierKeyOf(tierOfMember(tk.line_user_data)) !== filterTier) return false;
      if (activeSearch.trim()) {
        const ud = tk.line_user_data;
        const pDetail = parseCustomerDetail(ud?.detail);
        /* [FIX-20260817-SEARCHRAWPROFILE] ตัวเทียบอยู่ที่ utils/memberSearchText.ts
           ที่เดียว (ตัวกรองนี้มีสองชุดในไฟล์นี้ — เคยก๊อปกันไว้)
           array เดิมค้น `bank_account`/`bank_name`/`account_name`/`true_wallet`/
           `domain`/`agent`/`agent_code` ซึ่ง **ไม่มีอยู่ใน member schema เลย**
           ⇒ ค้นเลขบัญชีไม่เคยเจอ · ค่าจริงอยู่ใน raw_profile_data (payload มีมาให้แล้ว)
           ชื่อไลน์ · เบอร์ · ชื่อ-สกุล · เลขบัญชี ครบตามที่เจ้าของสั่ง
           (domain/agent/truewallet ตั้งใจไม่ค้น ตามที่สั่ง) */
        if (
          !memberMatchesSearch(ud, activeSearch, [
            pDetail.phone,
            pDetail.name,
            pDetail.contract,
            tk.line_user_id,
          ])
        )
          return false;
      }
      return true;
    });
  }, [filterOa, filterCategory, filterTag, filterTier, categoryOptions, activeSearch]);

  const counts = useMemo(() => {
    const uid = currentUser?.id;
    /* [FEAT-20260826-ACTIVEPAGING] F3 — with the switch on, the loaded rows
       are ONE PAGE, so counting them would show the page size as the badge
       (the exact lie fe_todo73 §1.3 predicts). tab_counts carries the same
       filter set the request did (S6; equality proven by P3.4 in the BE
       parity instrument). A category filter runs the legacy full fetch, so
       sc is null there and the client count stays the truth. */
    const sc = activePagingEnabled() ? serverTabCounts : null;
    const filteredActive = filterByActiveFilters(activeTickets);
    const filteredCompleted = filterByActiveFilters(completedTickets);

    /* [FIX-20260820-BOTCOUNT] counted from the SAME rows the tab lists, through
       the same active-filters every other count uses. It was built here from the
       completed tickets alone, which silently dropped every room that never
       became a case. นับจากแถวชุดเดียวกับที่แสดง. */
    const botUserKeys = new Set(
      filterByActiveFilters(botRows).map(tk => getTicketUserKey(tk)),
    );

    // [FEAT-20260801-MEMBERTIER] นับ filterTier ด้วย — ไม่งั้นตอนกรอง tier
    // ตัวเลข "ปิดเคส" จะไปใช้ยอดรวมทั้งหมดจาก BE แทนจำนวนที่กรองแล้ว
    const hasFilter = !!(filterOa || filterCategory || filterTag || filterTier || activeSearch.trim());
    const endedCount = (!hasFilter && completedTotal !== null)
      ? Math.max(completedTotal, filteredCompleted.length)
      : filteredCompleted.length;

    return {
      mine: sc ? sc.mine : filteredActive.filter(tk => Number(tk.job_status) === 1 && tk.admin_user_id === uid).length,
      waiting: sc ? sc.waiting : filteredActive.filter(tk => Number(tk.job_status) === 0).length,
      active: sc ? sc.active : filteredActive.filter(tk => Number(tk.job_status) === 1).length,
      ended: endedCount,
      /* [FEAT-20260820-BOTCOUNTBE] on the bot tab the rooms are loaded, so the
         rows themselves are the truth; on every OTHER tab they are not loaded at
         all and the server's number is the only way to know. Taking the larger of
         the two is what makes the badge right in both states without a second
         rule — and it can never double-count, because the two are never both
         populated. อยู่แท็บนั้น = นับจากแถวจริง · แท็บอื่น = ใช้เลขจาก BE. */
      /* [FIX-20260902-BOTONESOURCE] ONE box, ONE formula.
         This used to be
             Math.max(k, k + (statusTab === 'bot' ? 0 : noCaseRooms))
         — the number was computed from the rows when the operator stood on this
         tab and from a server count when they stood anywhere else. Two formulas
         for one badge, so the same page showed 29 and 28 seconds apart, and two
         operators watching the same OA could read different numbers at the same
         moment. The rooms now arrive already decided by the server on EVERY tab,
         so the rows are the count and there is nothing left to branch on. */
      bot: botUserKeys.size,
    };
  /* [FIX-20260820-BOTCOUNTSTALE] `botRows` MUST be listed. It is read above, and
     without it the badge froze at whatever it saw first: clicking บอทดูแล changes
     `statusTab`, which re-runs this while `orphanRooms` is still loading, so the
     count drops the server number and lands on 0 — then the rooms arrive, the
     rows render, and this never recomputes. Owner saw exactly that: 1 before the
     click, 0 after, with a row on screen.
     ⚠️ Adding it cannot move another badge: `mine`/`waiting`/`active`/`ended` are
     computed from the ticket lists and never read `botRows`, so recomputing more
     often returns the same values for them. Pinned by `test/botCountDeps.value.test.ts`.
     อ่านอะไรต้องประกาศอันนั้น · แท็บอื่นไม่ได้อ่าน botRows จึงขยับไม่ได้. */
  }, [activeTickets, completedTickets, filterByActiveFilters, currentUser, completedTotal, filterOa, filterCategory, filterTag, filterTier, searchPhone, serverTabCounts, statusTab, botRows]);
  /* [FEAT-20260819-TABUNREAD] does any CARD inside a tab carry a new-message badge?
     Owner's rule: the parent tab's badge changes COLOUR when one of its children has a
     new message, while its NUMBER stays put — the tab number counts CASES, a card badge
     counts MESSAGES, and mixing the two would make both meaningless.
     แท็บนับเคส · การ์ดนับข้อความ · เปลี่ยนแค่สี ไม่เปลี่ยนเลข.

     Derived, never stored: read straight off the same filtered list `counts` uses, so it
     lights and clears exactly when the cards do — opening a chat clears that card's
     number and the tab returns to its normal colour by itself. A separate stored flag
     would drift out of step with what the operator can actually see.

     It rides on top of `statusHasNew` (the NEW-CASE highlight) instead of replacing it:
     both mean "something new is in here" and share one colour, so a tab already lit by a
     new case simply stays lit. */
  const tabHasUnread = useMemo(() => {
    const uid = currentUser?.id;
    const filteredActive = filterByActiveFilters(activeTickets);
    const hasNew = (tk: TicketEntry): boolean =>
      /* [FIX-20260819-ORPHANQUIET] a row with no case never lights its tab. With the
         abandon exception gone that is the whole rule again. */
      !isQuietRow(tk) && unreadFor(unreadByRoom, tk as any) > 0;
    return {
      mine: filteredActive.some(tk => Number(tk.job_status) === 1 && tk.admin_user_id === uid && hasNew(tk)),
      waiting: filteredActive.some(tk => Number(tk.job_status) === 0 && hasNew(tk)),
      active: filteredActive.some(tk => Number(tk.job_status) === 1 && hasNew(tk)),
      // 'ended' is not a conversation anyone is waiting on, so a message there does
      // not light the tab.
      ended: false,
      /* [REMOVED-20260820-ABANDON] 'bot' used to light orange for a flagged
         conversation. The alert is retired, and an ordinary bot-handled room was never
         meant to interrupt anybody — so the tab is quiet again, exactly as it was
         before the flag existed. บอทดูแลเงียบเหมือนเดิม. */
      bot: false,
    } as Record<string, boolean>;
  }, [activeTickets, completedTickets, filterByActiveFilters, currentUser, unreadByRoom]);

  /* [FEAT-20260907-TABSEEN] the one place a tab is acknowledged — the tab's own click
     and, for a tab already open, clicking any card in it. Both mean the same thing:
     the operator has looked.
     ref: todo/task/07092026/fe_todo114_07092026_tabglowclear.md

     🔴 IT ONLY HIDES. Nothing here writes `statusHasNew`, `unreadByRoom` or a count,
        and no room is marked read — the cards keep their own numbers and the tab keeps
        counting cases.

     ⚠️ AND IT CARRIES THE GROUP'S ORANGE DOWN WITH IT. When this acknowledgement
        leaves NO tab lit, the group being viewed stops claiming it holds something new.
        The condition is "nothing is orange", NOT "all five were clicked": a tab that was
        never orange satisfies it untouched, so three lit tabs need three clicks and the
        other two are irrelevant.
        · computed against `next`, the state AFTER this click — reading `tabSeen` here
          would let the last click see itself as "one still lit" and never fire
        · only the group actually open. The others keep their orange because nobody has
          looked at them
        · one round only, and that needs no mechanism: the realtime handlers set
          `groupHasNew` again on the next message, exactly as they do today. That path
          is untouched. */
  const acknowledgeTab = useCallback((key: string) => {
    setTabSeen(prev => {
      const next = markTabSeen(prev, key);
      if (next === prev) return prev;
      if (noTabLit(STATUS_TABS.map(t => t.key), { statusHasNew, tabHasUnread }, next)) {
        const gid = activeGroupId;
        if (gid) setGroupHasNew(g => { if (!g[gid]) return g; const out = { ...g }; delete out[gid]; return out; });
      }
      return next;
    });
  }, [statusHasNew, tabHasUnread, activeGroupId]);
  /* [FEAT-20260907-TABSEEN] `openTicket` is a `useCallback([])`, so it cannot close over
     either of these without going stale — the same reason `activeTicketsRef` exists at
     :1964. Refs keep A2 reading the tab that is on screen NOW. */
  const acknowledgeTabRef = useRef(acknowledgeTab);
  useEffect(() => { acknowledgeTabRef.current = acknowledgeTab; }, [acknowledgeTab]);
  const statusTabRef = useRef(statusTab);
  useEffect(() => { statusTabRef.current = statusTab; }, [statusTab]);

  // The case THIS admin currently has in progress (job_status 1, assigned to me).
  // Used only to *warn* — the admin can still open any card. See openTicket.
  // NOTE (future-proofing): a single-ticket lookup; if the product later tracks
  // a "primary" active case explicitly, swap this for that field.
  const myActiveCase = useMemo(() => {
    const uid = currentUser?.id;
    if (!uid) return null;
    return activeTickets.find(tk => Number(tk.job_status) === 1 && tk.admin_user_id === uid) || null;
  }, [activeTickets, currentUser]);

  // Actually open a ticket's chat (no guard). Both the direct click and the
  // warning modal's "รับเคสใหม่" go through here.
  // Synthetic "ปิด Case #N" dividers injected into the chat stream — ONLY when
  // the chat was opened via the ดูแชท button on a history card (closedCases set).
  // A normal open clears them so they never leak into a live chat.
  const [closeCaseDividers, setCloseCaseDividers] = useState<any[]>([]);

  const doOpenTicket = useCallback(async (ticket: TicketEntry, closedCases?: TicketEntry[]) => {
    setSelectedTicket(ticket);
    setRightTab('personal');
    // Build close-case dividers only for a ดูแชท open; clear otherwise.
    if (closedCases && closedCases.length) {
      // group array is newest-first → oldest = Case #1
      const n = closedCases.length;
      setCloseCaseDividers(closedCases.map((c, i) => ({
        _id: `closecase-${c._id}`,
        message_type: 'divider',
        content: t('ticketui.divider.close_case', 'ปิด Case #{n}', { n: n - i }),
        created_at: c.resolved_at || c.updated_at || c.created_at,
        metadata: { variant: 'close' },
        sender_type: 'admin',
      })).filter(d => d.created_at));
    } else {
      setCloseCaseDividers([]);
    }
    const hookId = ticket.line_oa_hook_id || 'all';
    try {
      const rooms = await chatService.listRooms(hookId).catch(() => [] as any[]);
      /* [FIX-20260829-ROOMRESOLVE] await — resolveRoom หาห้องจริงเสมอ และคืน null
         ได้ · `selectedRoom` เป็น `ChatRoom | null` อยู่แล้ว จึงรับได้ตรง ๆ */
      const room = await resolveRoom(ticket, rooms as ChatRoom[]);
      setSelectedRoom(room);
      /* [FEAT-20260825-CHATOPENFRESH] แค่ "คลิกการ์ด" ก็ต้องได้ข้อมูลสด
         เจ้าของ 25/08: *"แค่คลิกการ์ด (ไม่จำเป็นต้องเปิด หรือรับเคส) ให้ fetch สด
         + บันทึกให้ record member นั้นด้วยข้อมูลล่าสุด + panel ขวาได้ข้อมูลล่าสุด
         ทั้ง raw profile + site rule"*

         ⭐ วางตรงนี้เพราะ `doOpenTicket` รัน **หนึ่งครั้งต่อการคลิกหนึ่งครั้ง**
            ⇒ "คลิก 1 = ยิง 1" โดยโครงสร้าง ไม่ต้องมี ref จำสถานะเหมือน
            shouldFireCaseTaken (ตัวนั้นอยู่ใน useEffect จึงต้องกันเอง)
         ⭐ จงใจ **ไม่มี** เงื่อนไข isMyCase / job_status — เจ้าของสั่งว่าไม่ต้อง
            รับเคสก็ต้องได้ของสด · เติมเงื่อนไขเมื่อไหร่ chatOpenedRefresh.value
            แดงทันที (T4)
         ⚠️ ใช้ช่องทาง event เดิมของระบบ ไม่ได้สร้างท่อใหม่ — PersonalPanel
            ฟังอยู่แล้ว และเป็นตัวตัดสินเองว่าจะ refresh อะไรบ้าง
         revert: ลบบล็อกนี้ + import chatOpenedDetail + ไฟล์ chatOpenedRefresh.ts */
      const openedDetail = chatOpenedDetail(
        room?.line_user_id || ticket.line_user_data?.line_user_id || ticket.line_user_id,
      );
      if (openedDetail) {
        window.dispatchEvent(
          new CustomEvent('tc:customer-profile-updated', { detail: openedDetail }),
        );
      }
      // Opening a room clears its unread badge (all key forms the event may use).
      // [FIX-20260819-UNREADKEY] `line_user_data.line_user_id` added — that is the key
      // the badge actually reads, so without it opening a chat left the number showing.
      /* [FIX-20260819-OAKEY] the OA-scoped key is the one the badge reads, so it is
         the one that has to be cleared; the older forms stay so nothing that used
         to be cleared stops being cleared. */
      const keys = [
        room?._id,
        (room as any)?.line_user_id,
        (ticket as any).chat_room_id,
        ticket.line_user_id,
        ticket.line_user_data?.line_user_id,
        customerEventKey(ticket.line_oa_hook_id, ticket.line_user_data?.line_user_id),
      ].filter(Boolean) as string[];

      /* [FEAT-20260907-TABSEEN] A2 — a card was opened in the tab that is already on
         screen, which is the same statement as clicking the tab: the operator has
         looked. Placed beside the unread clear rather than inside it, so the clear
         below is byte-identical to what it was.
         ref: todo/task/07092026/fe_todo114_07092026_tabglowclear.md */
      acknowledgeTabRef.current(statusTabRef.current);

      if (keys.length) setUnreadByRoom(prev => {
        if (!keys.some(k => prev[k])) return prev;
        const next = { ...prev }; keys.forEach(k => delete next[k]);
        /* [FIX-20260824-GROUPGLOW] the missing DOWN direction of the group tab's
           orange. The flag lights on realtime (untouched — :1633/:1676) and used
           to die only on group switch, so reading everything to zero INSIDE the
           group left it burning — the owner's report verbatim. Here, at the one
           place unread is cleared, the pure rule (ticketAlerts.groupStillHasUnread)
           asks whether this group still holds ANY unread; only when the reason is
           truly gone does the flag go. Another unread card in the group ⇒ flag
           stays — exactly what "หายเมื่อ 0" demands. ไม่แตะ realtime · ไม่แตะตัวเลข */
        const openedHook = hooks.find(h => h._id === ticket.line_oa_hook_id) as any;
        const gid = openedHook?.group ?? openedHook?.group_id;
        if (gid) {
          const groupHookIds = new Set(
            hooks
              .filter(h => (((h as any).group ?? (h as any).group_id) === gid))
              .map(h => String(h._id)),
          );
          const groupRoomIds = new Set(
            [...activeTickets, ...completedTickets]
              .map(t => String((t as any).chat_room_id ?? ''))
              .filter(Boolean),
          );
          if (!groupStillHasUnread(next, groupHookIds, groupRoomIds)) {
            setGroupHasNew(g => {
              if (!g[gid]) return g;
              const out = { ...g }; delete out[gid]; return out;
            });
          }
        }
        return next;
      });
    } catch {
      /* [FIX-20260829-ROOMRESOLVE] เส้น catch — ลิสต์ว่าง ⇒ resolveRoom จะไปถาม
         ห้องเดียวให้เอง แทนที่จะสร้างห้องปลอมเหมือนเดิม */
      setSelectedRoom(await resolveRoom(ticket, []));
    }
  }, []);

  // ── select a ticket → open its chat, but WARN first if a case is in progress.
  // The admin may view any card; the modal just offers "รับเคสใหม่" (open the
  // clicked card anyway) or "กลับเคสเดิม" (jump back to the current case).
  // Opening a card is always free — viewing never counts as "taking" a case.
  // The one-case-at-a-time check moved to the ACCEPT button (see acceptCurrent).
  const openTicket = useCallback((ticket: TicketEntry, closedCases?: TicketEntry[]) => {
    // Auto-switch OA Group tab if ticket belongs to a different group
    const tkHook = hooks.find(h => h._id === ticket.line_oa_hook_id);
    const targetGroupId = (ticket as any).group_id || (ticket as any).group || (tkHook ? (tkHook.group ?? (tkHook as any).group_id) : null);
    if (targetGroupId && targetGroupId !== activeGroupId) {
      setActiveGroupId(targetGroupId);
    }

    doOpenTicket(ticket, closedCases);
    setLeftOpen(false);

    // Scroll active card into view in left list
    setTimeout(() => {
      const el = document.querySelector('.tc-card-selected');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
  }, [doOpenTicket, hooks, activeGroupId]);

  // ── accept / close (job_status 1 / 2) ──────────────────────────────────
  // [FEAT-20260817-REOPENBYADMIN] reopen a closed case as a NEW ticket owned by
  // me. The BE does the whole block (atomic claim on the room = duplicate guard
  // + bot mute, then create + divider + history) — the FE only moves the card
  // completed → active (executeAction's optimistic patch cannot: it maps over
  // activeTickets, where a closed case does not live) and tells ChatRoomView
  // the bot bar flipped via the same tc:assist-changed event it already emits.
  /* [FEAT-20260819-OPENFROMROOM] open the first case for a room that never had
     one. Mirrors `executeReopen`'s aftermath — the new case becomes the selected
     one on the active tab — but takes the room route, and drops the row from the
     orphan list so the card stops being orange the moment the case exists. */
  const executeOpenFromRoom = useCallback(async (choices: { category: string; need_detail: string }) => {
    if (!openCaseRoom) return;
    setOpeningCase(true);
    try {
      const resp = await ticketService.openTicketFromRoom(openCaseRoom.roomId, choices);
      if (!resp || resp.success === false) throw new Error('open failed');
      setOrphanRooms(prev => prev.filter(r => String(r._id) !== openCaseRoom.roomId));
      if (resp.data) {
        const card = resp.data as TicketEntry;
        setActiveTickets(prev => [card, ...prev.filter(tk => tk._id !== card._id)]);
        setSelectedTicket(card);
      }
      setStatusTab('active');
      if (resp.room_id) {
        window.dispatchEvent(new CustomEvent('tc:assist-changed', {
          detail: { roomId: resp.room_id, assistStatus: true },
        }));
      }
      setOpenCaseRoom(null);
      fetchActive(true);
    } catch (err) {
      // Same AlertModal this page already uses for failures — never a raw alert()
      // (there is a comment on record about why that was replaced).
      setOpenCaseError((err as Error)?.message || t('ticketui.error.try_again', 'ลองใหม่อีกครั้ง'));
    } finally {
      setOpeningCase(false);
    }
  }, [openCaseRoom, fetchActive]);

  const executeReopen = useCallback(async (ticket: TicketEntry) => {
    setReopening(true);
    try {
      const resp = await ticketService.reopenTicketByAdmin(ticket._id);
      if (!resp || (resp as any).success === false) throw new Error('reopen failed');
      const card = buildReopenedTicketCard(ticket as any, resp as any, currentUser as any) as unknown as TicketEntry;
      setCompletedTickets(prev => prev.filter(tk => tk._id !== ticket._id));
      setActiveTickets(prev => [card, ...prev.filter(tk => tk._id !== card._id)]);
      setSelectedTicket(card);
      setStatusTab('active');
      if (resp.room_id) {
        // shape mirrors ChatRoomView's own dispatch — roomAssistMap only
        // updates from this CustomEvent, never by refetch
        window.dispatchEvent(new CustomEvent('tc:assist-changed', {
          detail: { roomId: resp.room_id, assistStatus: true },
        }));
      }
      // [FIX-20260817-REOPENDIVIDER] pull the transcript so the "เปิดเคสอีกครั้ง"
      // divider the BE just wrote shows NOW. The BE also publishes message:new
      // for that row, but this call is what makes it certain on the presser's
      // own screen (no dependency on the socket) — the bug was the divider
      // appearing only after the admin sent a message.
      chatApiRef.current?.refetch();
    } catch (e: any) {
      // 409 = someone else already holds the customer (or won the race) — the
      // truthful next step is a refetch, not a silent retry
      setRaceWarnMsg(e?.message || t('ticketui.error.open_case_failed_detail', 'เปิดเคสไม่สำเร็จ — ลูกค้าอาจมีเคสเปิดอยู่แล้ว'));
      fetchActive(true);
    } finally {
      setReopening(false);
      setReopenConfirm(null);
    }
  }, [currentUser, fetchActive]);

  const executeAction = useCallback(async (ticket: TicketEntry, targetStatus: number) => {
    // Race guard: ignore re-entry while a job action is already in flight (a
    // double-click on ปิดเคส/รับเคส must not fire the PUT twice).
    if (actionInProgressRef.current) return;
    actionInProgressRef.current = true;
    setActionInProgress(true);
    const payload: any = { job_status: targetStatus, chat_status: 'admin' };
    if (targetStatus === 1) {
      payload.admin_user_id = currentUser?.id || null; payload.assigned_at = new Date();
      /* [FIX-20260830-CLAIMRACEGUARD] เงื่อนไข "จอเห็นว่ายังว่าง" — เหตุผลเต็มอยู่ที่
         TicketSupport.tsx executeJobAction · ส่งเฉพาะตอนตั๋วยังไม่มีเจ้าของ เพื่อไม่ให้
         เส้นโอนเคส/เปลี่ยนมือได้ guard ใหม่ที่ไม่เคยมี (บั๊ก 24/08 ห้ามกลับมา)
         409 ที่ตามมาถูกจับโดย isRaceConflict ที่ catch ข้างล่างอยู่แล้ว */
      if (!ticket.admin_user_id) payload.expected_admin_user_id = '';
    }
    else if (targetStatus === 2) {
      const adminId = ticket.admin_user_id || (ticket.admin_user_data as any)?._id || (ticket.admin_user_data as any)?.id;
      const currentId = currentUser?.id || (currentUser as any)?._id;
      const isSuper = ((currentUser as any)?.role?.name || '').toLowerCase() === 'superadmin';
      const isOwner = !!(currentId && adminId && String(currentId) === String(adminId));
      if (!isOwner && !isSuper) {
        actionInProgressRef.current = false;
        setActionInProgress(false);
        alert(t('ticketui.error.close_own_only', 'กดปิดเคสได้เฉพาะเคสของตนเองเท่านั้น'));
        return;
      }
      payload.resolved_at = new Date();
      /* [FEAT-20260827-PATCHAFTERCLOSE] ส่งเฉพาะหัวข้อที่ **ขึ้นจริง** และถูกตอบแล้ว
         (แทนที่ `clear_follow_up` ของ [FEAT-20260826-CLOSECLEARFU] ซึ่ง FE ไม่ส่งแล้ว
          — คีย์นั้นยังอยู่ทั้ง DTO ฝั่ง BE และ type ฝั่ง service ⇒ client เก่าไม่พัง)
         ⚠️ BE ต้องขึ้นก่อน FE เสมอ — `forbidNonWhitelisted` ทำให้คีย์ที่ BE ยังไม่รู้จัก
            กลายเป็น 400 คือปิดเคสไม่ได้ทั้งระบบ
         ⚠️ ไม่มีหัวข้อไหนขึ้น ⇒ ไม่ใส่ `patch_after_close` เลย ⇒ payload เท่าเดิม
            ทุกไบต์กับก่อนมีฟีเจอร์นี้ · เคสที่ตอบ "ตามต่อ/ติดตาม" ก็ยังส่งค่านั้นมา
            เพราะ BE ต้องแยกออกระหว่าง "เลือกจะไม่ทำ" กับ "ไม่เคยถูกถาม" */
      /* [FIX-20260830-CLOSEANSWERSTALE] read through the ref — see its comment.
         Using `closeTopics`/`closeAnswers` directly here reads this callback's
         captured render, which is stale by the time the admin clicks. */
      const { topics: liveTopics, answers: liveAnswers } = closeCaseRef.current;
      const answered: CloseCaseAnswers = {};
      for (const topic of liveTopics) {
        const picked = liveAnswers[topic];
        if (picked !== undefined) (answered as any)[topic] = picked;
      }
      if (Object.keys(answered).length > 0) payload.patch_after_close = answered;
    }

    // UI-only patch: on accept, also fill admin_user_data from the signed-in user
    // so the "ผู้ดูแลปัจจุบัน" card flips to me instantly (it reads admin_user_data,
    // not admin_user_id). NOT sent to the BE — the payload above stays minimal;
    // the server re-populates admin_user_data on the next fetchActive. Without
    // this the card showed "ยังไม่มีผู้ดูแล/บอทดูแล" until a refetch landed.
    const uiPatch: any = { ...payload };
    if (targetStatus === 1 && currentUser) {
      uiPatch.admin_user_data = {
        _id: currentUser.id,
        username: (currentUser as any).username || '',
        display_name: (currentUser as any).display_name || '',
        role: (currentUser as any).role || '',
        email: (currentUser as any).email || null,
      };
    }

    const prevActive = activeTickets;
    const prevCompleted = completedTickets;
    // optimistic
    if (targetStatus === 1) {
      setActiveTickets(prev => prev.map(tk => tk._id === ticket._id ? { ...tk, ...uiPatch } : tk));
      // Also remove from completedTickets: bot-tab tickets live there (job_status=2,
      // assist=false). Without this, the stale entry lingers → closed count inflates
      // by +1 permanently, then snaps back when fetchCompleted returns the real count.
      setCompletedTickets(prev => prev.filter(tk => tk._id !== ticket._id));
      setStatusTab('active');
    } else if (targetStatus === 2) {
      setActiveTickets(prev => prev.filter(tk => tk._id !== ticket._id));
      setCompletedTickets(prev => [{ ...ticket, ...payload } as TicketEntry, ...prev]);
      // close = leave the conversation and return to the list (no page refresh),
      // then flash a success confirmation.
      setSelectedTicket(null);
      setSelectedRoom(null);
      setCloseSuccessOpen(true);
    }
    try {
      const hookId = ticket.line_oa_hook_id || 'all';
      const [updateRes, rooms] = await Promise.all([
        ticketService.updateTicketMinimal(ticket._id, payload),
        chatService.listRooms(hookId).catch(() => [] as any[]),
      ]);
      if (updateRes && (updateRes as any).success === false) {
        setActiveTickets(prevActive); setCompletedTickets(prevCompleted);
        fetchActive(true);
        return;
      }
      const room = await resolveRoom(ticket, rooms as ChatRoom[]);
      /* [FIX-20260829-ROOMRESOLVE] `_synthetic` ไม่เคยถูกเซ็ตโดยใครเลย — guard นี้
         ตายมาตลอด · ตอนนี้ `room` เป็นห้องจริงหรือ null เท่านั้น เช็ค null พอ
         ⇒ ประวัติรับเคสจะไม่ถูกเขียนด้วย room id ที่ไม่มีอยู่จริงอีก */
      if (room?._id) {
        await Promise.all([
          assignHistoryService.createAssignHistory({
            ticket_id: ticket._id,
            chat_room_id: room._id,
            assign_to: targetStatus === 1 ? (currentUser?.id || null) : (ticket.admin_user_id || null),
            changed_by_id: currentUser?.id || '',
            action: targetStatus === 1 ? 'accept' : 'close',
          }).catch(() => { /* history is best-effort */ }),
          chatService.updateAssistStatus(room._id, targetStatus === 1).catch(() => { /* ignore */ }),
        ]);
      }
      if (targetStatus === 1) {
        setSelectedTicket({ ...ticket, ...uiPatch });
        setSelectedRoom(room);
      }
      fetchActive(true);
    } catch (e) {
      setActiveTickets(prevActive); setCompletedTickets(prevCompleted);
      // Lost a race (someone closed it first) → tell the admin + refresh so the
      // stale card corrects. Also close the conversation view for a close attempt.
      if (isRaceConflict(e)) {
        setRaceWarnMsg((e as any)?.message || t('ticketui.race.closed', 'เคสนี้ถูกปิดไปแล้ว'));
        if (targetStatus === 2) { setSelectedTicket(null); setSelectedRoom(null); }
        fetchActive(true);
      } else {
        console.error('job action failed', e);
      }
    } finally {
      actionInProgressRef.current = false;
      setActionInProgress(false);
      setConfirmAction(null);
    }
  }, [activeTickets, completedTickets, currentUser, fetchActive]);

  const oaName = (hookId?: string | null) =>
    hooks.find(h => h._id === hookId)?.line_oa_name || '';

  const selectedJobStatus = selectedTicket ? Number(selectedTicket.job_status) : null;
  // isAccepted = the composer is usable (status 1 in-progress OR 2 already closed,
  // both keep the chat visible). canCloseCase is stricter: only an IN-PROGRESS
  // case (status 1) can be closed — a case that's already closed (2) must NOT be
  // closeable again. actionInProgress additionally blocks a double-click race.
  const isAccepted = selectedJobStatus === 1 || selectedJobStatus === 2;

  const currentAdminId = selectedTicket?.admin_user_id || selectedTicket?.admin_user_data?._id || selectedTicket?.admin_user_data?.id;
  const currentUserId = currentUser?.id || (currentUser as any)?._id;
  const isMyCase = !!(currentUserId && currentAdminId && String(currentUserId) === String(currentAdminId));

  // ==== [FEAT-20260824-CLAIMPROFILE] เคสเพิ่งเป็นของเรา → ดึงโปรไฟล์ดิบใหม่ทันที
  // WHAT: รอยต่อ **เดียว** ที่ครอบทั้ง 3 ปุ่ม (กดรับเคส · รับเคสต่อ · เปิดเคส)
  //       และปุ่มที่จะเพิ่มทีหลัง — ไม่ต้องไปแปะ handler ทีละปุ่ม
  // WHY ต้องจำ ticketId ไว้ใน ref: ถ้าดูแค่ isMyCase พลิก false→true การ "สลับห้อง"
  //       จากเคสของแอดมินอื่นไปเคสที่เป็นของเราอยู่แล้ว จะพลิกด้วย → ยิงดึงโปรไฟล์
  //       ทุกครั้งที่สลับห้องทั้งที่ไม่มีใครกดรับ (bug จริง) · กฎอยู่ใน caseTakenRefresh.ts
  // ยิงผ่านช่องทางเดิมที่ panel ขวาฟังอยู่แล้ว (ไม่เพิ่มเส้นใหม่)
  // revert: ลบ useEffect + ref นี้ + import ด้านบน + ไฟล์ caseTakenRefresh.ts
  const caseOwnRef = useRef<CaseOwnership>({ ticketId: null, isMine: false });
  useEffect(() => {
    const next: CaseOwnership = {
      // คีย์ด้วย **ลูกค้า** ไม่ใช่ ticket._id — ดูกับดัก reopen ในหัวไฟล์ caseTakenRefresh.ts
      ticketId: selectedTicket?.line_user_data?.line_user_id || null,
      isMine: selectedJobStatus === 1 && isMyCase,
    };
    const prev = caseOwnRef.current;
    caseOwnRef.current = next;
    if (!shouldFireCaseTaken(prev, next)) return;
    const lineUserId = selectedTicket?.line_user_data?.line_user_id;
    if (!lineUserId) return;
    window.dispatchEvent(new CustomEvent('tc:customer-profile-updated', {
      detail: { channel_user_id: lineUserId, action: 'case_taken' },
    }));
  }, [selectedTicket, selectedJobStatus, isMyCase]);
  // ==== [FEAT-20260824-CLAIMPROFILE] END

  /* [FIX-20260825-PANELREFRESH] กดปุ่ม refresh = แผงขวาต้องสด "ทั้งแผง"
     ─────────────────────────────────────────────────────────────────────────
     เดิมปุ่มนี้ทำให้สดแค่ข้อมูลโปรไฟล์ · หมวด · ป้ายกำกับ · การติดตาม · โน๊ต
     ยังเป็นของเก่าทั้งหมด เพราะการ์ดสี่ใบเอาข้อมูลมาคนละทาง:

       ป้ายกำกับ · โน๊ต  โหลดเองด้วย useEffect ที่ผูกกับ `room._id`
                         ⇒ ดึง room ใหม่ก็ไม่ยิงซ้ำ เพราะ _id เท่าเดิม
                         ⇒ ต้อง **remount** (bump nonce → key เปลี่ยน)
       การติดตาม         อ่านจาก prop `room` ⇒ ต้อง **ดึง room ใหม่**
       หมวด              อ่านจาก prop `ticket` ⇒ ต้อง **ดึง ticket ใหม่**

     ⇒ จึงต้องทำสองท่าพร้อมกัน ท่าเดียวแก้ได้แค่ครึ่งเดียว
     ⚠️ เงื่อนไข "action ไหนนับ" อยู่ใน `panelRefresh.ts` — เฉพาะ `manual_refresh`
        เท่านั้น · ถ้า remount ทุก action การ์ดจะรีเซ็ตตอนแอดมินแค่คลิกห้อง
        แล้วโน๊ตที่พิมพ์ค้างไว้จะหายกลางคัน
     ⚠️ patch `category` ทีละฟิลด์ ไม่ทับทั้งแถว — `selectedTicket` ถือค่าที่จอ
        แก้ไว้เองด้วย (เช่น customer_tags) กติกาเดียวกับ effect ที่ sync เจ้าของเคส
     ⚠️ ไม่โยน — ปุ่มรีเฟรชล้มเหลวต้องไม่ทำให้หน้าจอพัง
     revert: ลบบล็อกนี้ + prop cardNonce + key ของการ์ดสามใบ + ไฟล์ panelRefresh.ts */
  /* [FIX-20260825-PANELREFRESH] ref ไม่ใช่ dep — ถ้าใส่ `selectedTicket` ลง deps
     listener จะถูกถอด/ผูกใหม่ทุกครั้งที่เคสขยับ และมีจังหวะที่ event หลุดระหว่างนั้น
     (the same listener-lifecycle concern applies to other panel event handlers) */
  const selectedTicketRef = useRef<TicketEntry | null>(null);
  selectedTicketRef.current = selectedTicket;
  const [cardNonce, setCardNonce] = useState(0);
  useEffect(() => {
    const onPanelRefresh = (e: Event) => {
      const detail = (e as CustomEvent).detail as { action?: unknown } | null;
      if (!shouldRefreshPanel(detail?.action)) return;
      setCardNonce((n) => n + 1);
      void (async () => {
        try {
          const tk = selectedTicketRef.current;
          if (!tk) return;
          const hookId = tk.line_oa_hook_id || 'all';
          const rooms = await chatService.listRooms(hookId).catch(() => [] as any[]);
          const fresh = await resolveRoom(tk, rooms as ChatRoom[]);
          if (fresh) setSelectedRoom(fresh);
          const list = await fetchActive(true);
          const freshTk = Array.isArray(list)
            ? (list as TicketEntry[]).find((t) => t._id === tk._id)
            : undefined;
          if (freshTk) {
            setSelectedTicket((prev) =>
              prev && prev._id === freshTk._id
                ? { ...prev, category: freshTk.category }
                : prev,
            );
          }
        } catch {
          /* เงียบไว้ — ปุ่มรีเฟรชพลาดต้องไม่ทำให้หน้าจอพัง */
        }
      })();
    };
    window.addEventListener('tc:customer-profile-updated', onPanelRefresh);
    return () => window.removeEventListener('tc:customer-profile-updated', onPanelRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchActive]);

  const isSuperAdmin = ((currentUser as any)?.role?.name || '').toLowerCase() === 'superadmin';
  const isOtherAdminCase = selectedJobStatus === 1 && !isMyCase;
  const otherAdminName = adminLabel(selectedTicket?.admin_user_data) || t('ticketui.other_admin', 'แอดมินท่านอื่น');
  const canCloseCase = selectedJobStatus === 1 && !actionInProgress && (isMyCase || isSuperAdmin);
  // (ticketOnly + oaSlot declared earlier, above the slider-measure effect.)

  // Live status pill (พร้อมรับเคส / รับเคสอยู่). Its own node so ticket-only can
  // portal it into a separate header slot (keeps it out of the switcher's width).
  const statusInner = <TicketStatusPill {...{ myActiveCase, openTicket, t }} />;

  // The top-bar contents (settings + OA switcher + live status). Rendered inside
  // this page's own bar normally, or portaled into the header for ticket-only.
  const topBarInner = (
    <TicketTopBar
      {...{
        ticketOnly, gearSlot, t, groupMode, setGroupMode, setQuickReplyModalOpen,
        activeGroupId, selectGroup, visibleGroups, sliderWrapRef, inlineGroups, activeTickets,
        groupCounts, isFaved, groupHasNew, requestFavToggle, overflowGroups, setPromotedId,
        measureRef, orderedGroups, statusInner, selectedTicket, leftOpen, setLeftOpen,
      }}
    />
  );

  const statusSlot = ticketOnly ? document.getElementById('tc-header-status-slot') : null;

  /* [REFACTOR-20261027-TCSPLIT] stays in the page: it writes the ticket list
     (setActiveTickets + fetchActive), so the right column receives the function, never
     the code. Body verbatim from its old inline place on <OperationsPanel onTransferSuccess>;
     like that inline arrow it is rebuilt on every render, so it sees the same values. */
  const handleTransferSuccess = (newUser?: { id: string; username: string; display_name: string }) => {
    if (newUser) {
      const newAdminData = {
        _id: newUser.id,
        id: newUser.id,
        username: newUser.username,
        display_name: newUser.display_name
      };
      setSelectedTicket(prev => prev ? {
        ...prev,
        admin_user_id: newUser.id,
        admin_user_data: newAdminData
      } : null);
      setActiveTickets(prev => prev.map(tk => tk._id === selectedTicket?._id ? {
        ...tk,
        admin_user_id: newUser.id,
        admin_user_data: newAdminData
      } : tk));
    }
    fetchActive(true);
    setChatRefreshKey(k => k + 1);
  };

  return (
    <div className={`tc relative h-[calc(100vh-var(--app-header-h,64px))] -m-4 md:-m-6 lg:-m-8 flex flex-col overflow-hidden text-gray-800 bg-gray-100`}>
      {/* Ticket-only: portal the switcher into the header OA slot + status into the
          status slot (separately, so status doesn't shrink the switcher). Drop this
          bar. Otherwise render the normal Ticket top bar. */}
      {ticketOnly ? (
        <>
          {oaSlot && createPortal(topBarInner, oaSlot)}
          {statusSlot && createPortal(statusInner, statusSlot)}
        </>
      ) : (
          <div className="h-12 bg-white text-gray-800 border-b border-gray-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-[45]">
            {/* [FIX-20260729-SELECTZ] z-30 → z-[45]: เมนู "อื่นๆ" (SearchableSelect z-50)
                อยู่ใน stacking context ของ bar นี้ เลยโดน tc-col-right (z-40) ทับ —
                the whole bar must outrank the right column or every popover in it
                paints underneath. But it must stay BELOW the app header (z-50):
                first attempt used z-50 and the bar covered the mega-menu dropdown
                (equal z, later DOM order wins). 40 < 45 < 50 satisfies both.
                ticketOnly ไม่โดนตั้งแต่แรกเพราะ portal เข้า header เอง
                revert: เปลี่ยนกลับเป็น z-30 */}
            {topBarInner}
          </div>
        )}

      {/* Mobile responsive split — ONLY for the normal (non-ticketOnly) layout.
          ticketOnly keeps its exact original layout untouched. Mobile-first:
          the base classes target small screens and `lg:` restores the desktop
          3-column layout (the Tailwind Play CDN here has no max-* variants). */}

      {/* 3-column body */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* ── LEFT: conversation list ──
            Desktop (lg+): always a fixed-width column.
            Mobile (<lg): once a case is open, the list can collapse to give the
            chat full width (hidden; the chat's ">" handle reopens it); with no
            case open it fills the screen. Applies to BOTH normal and ticketOnly
            layouts (only the mega-menu differs between them). */}
        <div className={`tc-col-left relative bg-white border-r border-gray-200 flex flex-col shrink-0 h-full lg:w-[360px] ${
          selectedTicket
            ? (leftOpen ? 'w-full lg:w-[360px]' : 'hidden lg:flex lg:w-[360px]')
            : 'w-full lg:w-[360px]'
        }`}>
          <ListFilters
            {...{
              dateScopeRef, setDateScopeOpen, t, dateScopeLabel, isDateScopeActive, dateScopeOpen,
              setFilterWithinDays, filterWithinDays, searchPhone, setSearchPhone, locale, activeSearchLimited,
              completedSearchLimited, serverSearch, filterOa, setFilterOa, hooks, activeGroupHookIds,
              providerCats, filterCategory, setFilterCategory, categoryOptions, filterTag, setFilterTag,
              filterPopularTags, showTierFilter, filterTier, setFilterTier, tierFilterOptions,
            }}
          />

          {/* status tabs */}
          <div className="flex px-2 border-b border-gray-200 justify-between pt-2 shrink-0">
            {STATUS_TABS.map(tab => {
              const on = statusTab === tab.key;
              const count = counts[tab.key];
              const tabNew = !!statusHasNew[tab.key];   // yellow NUMBER when a new case landed here
              // [FEAT-20260819-TABUNREAD] …or when a CARD in this tab carries an unread
              // message. Same class as the card's badge on purpose — one colour means
              // "new" everywhere. The COUNT itself is never touched: it counts cases.
              /* [FEAT-20260907-TABSEEN] …unless the operator has acknowledged this tab.
                 The two sources above are unchanged — `tabIsLit` composes them exactly as
                 `tabNew || tabHasUnread` did and then asks whether it has been seen.
                 ref: todo/task/07092026/fe_todo114_07092026_tabglowclear.md */
              const tabUnread = tabIsLit(tab.key, { statusHasNew, tabHasUnread }, tabSeen);
              return (
                <button
                  key={tab.key}
                  onClick={() => { setStatusTab(tab.key); setStatusHasNew(prev => { if (!prev[tab.key]) return prev; const n = { ...prev }; delete n[tab.key]; return n; }); acknowledgeTab(tab.key); }}
                  className={`flex flex-col items-center pb-2 px-2 flex-1 text-[12px] font-bold transition-colors border-b-2 ${on ? 'text-primary border-primary' : 'text-gray-500 hover:text-gray-800 border-transparent'}`}
                >
                  {t(`ticketui.tab.${tab.key}`, tab.label)}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold leading-none mt-1 ${tabUnread ? 'tc-unread-badge' : on ? 'tc-tab-count-on bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* list */}
          <div className="tc-chat-list flex-1 overflow-y-auto custom-scrollbar">
            {loading && visibleTickets.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-xs">
                <Loader2 className="mx-auto animate-spin mb-2" size={20} />
                {t('ticketui.list.loading', 'กำลังโหลด...')}
              </div>
            ) : visibleTickets.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-xs">{t('ticketui.list.empty', 'ไม่มีเคสในสถานะนี้')}</div>
            ) : statusTab === 'ended' ? (
              endedWindow.visible.map((group, cardIdx) => {
                return (
                  <EndedGroupCard
                    key={group.key}
                    {...{
                      group, expandedGroupCardId, selectedTicket, endedWindow, cardIdx, t,
                      setTagInfoTicket, oaName, ticketStackOn, stackExpand, categoryBadge, setStatusTab,
                      openTicket, openHistoryModal, roomAssistMap, activeTickets, completedTickets,
                    }}
                  />
                );
              })
            ) : (
              // [FEAT-20260811-CHATPIN] `visibleTicketsPinned` = visibleTickets ที่เรียงหมุดแล้ว
              // (`groupedBotTickets` เรียงหมุดในตัวมันเองแล้ว) · ⚠️ คอมเมนต์ต้องอยู่นอก
              // นิพจน์ JSX — วาง {/* */} คั่นก่อน `(` ทำให้ TS อ่านเป็น object แล้วพัง
              // [FEAT-20261020-TICKETSTACK] each slot = the card below, or a stack around it
              // (front + older cards, all drawn by this SAME callback). Flag off ⇒ mainStacks
              // is null ⇒ renderTicketStackSlot just calls the callback = the old card.
              mainWindow.visible.map((frontTk, frontIdx) => renderTicketStackSlot(mainStacks, frontTk, frontIdx, stackExpand, (tk, cardIdx) => {
                return (
                  <TicketCard
                    key={tk._id}
                    {...{
                      tk, selectedTicket, unreadByRoom, openTicket, mainWindow, cardIdx,
                      t, oaName, pinnedRooms, togglePinnedRoom, categoryBadge, setTagInfoTicket,
                      showTierBadge,
                    }}
                  />
                );
              }))
            )}
            {/* [FEAT-20260819-CARDWINDOW] the reveal point. An IntersectionObserver
                inside the hook watches this element, so scrolling to the end of the
                list loads the next 25 — no button to press, and nothing is fetched:
                the rows are already in memory, they were simply not drawn.
                เลื่อนถึงท้ายลิสต์ = โผล่เพิ่มเอง ไม่ต้องกดปุ่ม ไม่ยิงเน็ตเพิ่ม. */}
            {(statusTab === 'ended' ? endedWindow : mainWindow).hasMore && (
              <div
                ref={(statusTab === 'ended' ? endedWindow : mainWindow).sentinelRef}
                className="py-3 text-center text-[11px] text-gray-400"
              >
                {t('ticketui.list.window', 'กำลังแสดง {shown} รายการ · เลื่อนลงเพื่อดูอีก {left}', { shown: (statusTab === 'ended' ? endedWindow : mainWindow).visible.length, left: (statusTab === 'ended' ? endedWindow : mainWindow).remaining })}
              </div>
            )}
            {/* [PERF-20260821-TICKETCURSOR] the server has older closed cases than the
                100 in memory. A BUTTON, not an auto-load: every fetch here is the
                operator's call (same rule as the chat's "โหลดเพิ่ม"). Shown only after
                the render window has revealed everything it already holds. */}
            {statusTab === 'ended' && !endedWindow.hasMore && completedHasMore && (
              <div className="py-3 text-center">
                <button
                  type="button"
                  onClick={() => { void loadMoreCompleted(); }}
                  disabled={completedLoadingMore}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {completedLoadingMore ? t('ticketui.list.loading_more', 'กำลังโหลด…') : t('ticketui.list.load_older', 'โหลดเคสเก่ากว่า (แสดง {n})', { n: `${completedTickets.length}${completedTotal !== null ? ` / ${completedTotal}` : ''}` })}
                </button>
              </div>
            )}
            {/* [FEAT-20260826-ACTIVEPAGING] the open tab's twin of the button
                above — same rule: a BUTTON, the operator's call, shown only
                after the render window has revealed everything loaded. Off-
                switch ⇒ activeHasMore is always false and this never renders. */}
            {statusTab !== 'ended' && statusTab !== 'bot' && !mainWindow.hasMore && activeHasMore && (
              <div className="py-3 text-center">
                <button
                  type="button"
                  onClick={() => { void loadMoreActive(); }}
                  disabled={activeLoadingMore}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {activeLoadingMore ? t('ticketui.list.loading_more', 'กำลังโหลด…') : t('ticketui.list.load_previous', 'โหลดเคสก่อนหน้า (แสดง {n})', { n: activeTickets.length })}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER: chat ──
            Desktop (lg+): always flex-1.
            Mobile (<lg): hidden until a case is picked + the list is collapsed,
            then fills the screen. Applies to both normal and ticketOnly. */}
        <div
          className={`tc-col-center flex-1 min-w-0 lg:min-w-[350px] flex-col relative bg-[#f0f2f5] lg:flex ${
            selectedTicket && !leftOpen ? 'flex' : 'hidden lg:flex'
          }`}
          /* [FEAT-20260830-CHATFONT] ตัวคูณขนาดตัวอักษรของ "ช่องกลางเท่านั้น".
             กฎที่กินค่านี้อยู่ใน index.css ทั้งหมด และ scope ใต้ .tc-col-center
             ⇒ panel ซ้าย/ขวา header menu ไม่ได้รับผลใด ๆ
             ⚠️ ห้ามไปทา documentElement — นั่นเป็นของ `ui.fontScale` ในฟันเฟือง
             ซึ่งเจ้าของสั่งว่าห้ามยุ่ง ถ้าทาทั้งสองที่ค่าจะคูณกันแล้วเพี้ยนทั้งคู่
             ⚠️ รูปแบบ ['--x' as any] ตามแบบอย่าง App.tsx (--app-header-h) เพราะ
             CSSProperties ของ TS ไม่รับ key ที่ขึ้นต้นด้วย --
             revert: ลบ style นี้ + บล็อก CSS [FEAT-20260830-CHATFONT] */
          style={{ ['--tc-chat-scale' as never]: String(chatFontScale) }}
        >
          {/* Edge handle tabs (click, not drag) — tall, easy-to-hit, slightly
              translucent, themed to the chat surface. In the CHAT column the list
              is collapsed, so this handle only ever EXPANDS it (arrow ►).
              Mobile-only (<lg); the chat itself is only visible here when a case
              is open + the list is collapsed. */}
          {selectedTicket && (
            <button
              onClick={() => setLeftOpen(true)}
              className="tc-edge-handle lg:hidden absolute top-1/2 -translate-y-1/2 left-0 z-30 h-24 w-9 rounded-r-2xl flex items-center justify-center bg-white/70 backdrop-blur-sm border border-l-0 border-gray-200/70 text-gray-500 shadow-lg hover:bg-white hover:text-primary active:scale-95 transition-all"
              title={t('common.expand')}
              aria-label={t('common.expand')}
            >
              <ChevronRight size={20} />
            </button>
          )}
          {/* RIGHT handle: toggle the customer panel — shown at ALL sizes when the
              panel is collapsed (below `wide` it auto-collapses; a FAB-style tab
              reopens it anywhere). Arrow points left = "open the panel". */}
          {selectedTicket && !rightOpen && (
            <button
              onClick={() => setRightOpen(true)}
              className="tc-edge-handle absolute top-1/2 -translate-y-1/2 right-0 z-30 h-24 w-9 rounded-l-2xl flex items-center justify-center bg-white/70 backdrop-blur-sm border border-r-0 border-gray-200/70 text-gray-500 shadow-lg hover:bg-white hover:text-primary active:scale-95 transition-all"
              title={t('ticket.customerInfo')}
              aria-label={t('ticket.customerInfo')}
            >
              <ChevronLeft size={24} />
            </button>
          )}
          {!selectedTicket ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
              <MessageSquare size={48} className="mb-3 opacity-20" />
              {t('ticketui.room.pick_case', 'เลือกเคสจากรายการเพื่อเริ่มสนทนา')}
            </div>
          ) : (
            <>
              {/* ==== [FIX-20260731-CLOSEDBADGE] START
                  เดิมตรงนี้มีแถบ "เคสนี้ปิดแล้ว" เต็มความกว้างคาดอยู่เหนือห้องแชท
                  ซ้ำกับแถบล่าง (footer) ที่บอกเรื่องเดียวกันอยู่แล้ว = กินพื้นที่
                  แนวตั้งไปเปล่าๆ และดันเนื้อหาลงทุกครั้งที่เปิดเคสที่ปิดแล้ว

                  ย้ายไปแสดงแทนที่ "ปุ่มปิดเคส" บนหัวห้องแชทแทน — ตำแหน่งนั้น
                  เมื่อเคสปิดแล้วปุ่มจะถูก disable + เบลอทิ้งไว้เฉยๆ อยู่แล้ว
                  (ดู ChatRoomView) เอาป้ายไปวางแทนจึงได้พื้นที่คืนและสื่อสารตรงจุด

                  footer ไม่แตะตามที่ผู้ใช้กำหนด
                  revert: เอา block นี้กลับมา แล้วลบ prop `caseClosed` ที่ส่งให้
                          ChatRoomView ด้านล่าง
              ==== [FIX-20260731-CLOSEDBADGE] END */}
              <div className="tc-chat-history flex-1 min-h-0 flex">
                {/* ==== [FIX-20260728-NOBLINK] START
                    เดิม key คือ:
                      key={`${selectedRoom?._id || selectedRoom?.line_user_id}-${chatRefreshKey}`}
                    การบวก chatRefreshKey ทำให้ React unmount+mount ใหม่ทั้ง
                    component ทุกครั้งที่ส่ง/มีข้อความเข้า = ห้องกระพริบ
                    + fetch หน้า 1 ใหม่ + รูปทุกใบในห้องถูกขอใหม่ + scroll เด้ง
                    ตอนนี้เอา chatRefreshKey ออก เหลือ key ตามห้อง (เปลี่ยนห้อง
                    ยังต้อง remount อยู่ ถูกต้องแล้ว) แล้วให้ ChatRoomView
                    append ข้อความเองผ่าน onReadyRef + WS message:new
                    revert: เอา -${chatRefreshKey} กลับเข้าไปใน key
                             แล้วลบ onReadyRef prop ออก
                ==== */}
                <ChatRoomView
                  /* [FEAT-20260830-CHATFONT] เปิด modal ขนาดตัวอักษร — ส่งเฉพาะหน้านี้
                     อีก 3 หน้าที่ใช้ ChatRoomView ร่วมกันจะไม่มีปุ่มโผล่ */
                  onOpenFontScale={() => setFontModalOpen(true)}
                  fontScaleLabel={t('ticket.chat_font_title')}
                  key={`${selectedRoom?._id || selectedRoom?.line_user_id}`}
                  onReadyRef={(api) => { chatApiRef.current = api; }}
                  /* [FEAT-20260819-REPLYUI] switches the Reply chip on for this page
                     only — the other three pages that use ChatRoomView omit it and
                     render exactly as before.

                     [FIX-20260824-REPLYGATE] …and only while THIS admin holds the
                     case. เจ้าของสั่ง 24/08: ปุ่ม reply ต้องไม่โผล่เลยจนกว่าจะรับเคส
                     และต้องใช้ state เดียวกับกล่องพิมพ์แชท

                     `selectedJobStatus === 1 && isMyCase` คือ state นั้นจริง ๆ ไม่ใช่
                     ตัวที่ใกล้เคียง — ChatInputBox เปิดใช้งานเมื่อ
                     `accepted && !isOtherAdminCase` ซึ่งที่จุดเรียกนี้คือ
                     `isAccepted && !(js===1 && !isMyCase)` และเคสปิด (js===2) แยกไป
                     สาขาอื่นที่ส่ง `accepted={false}` ⇒ ยุบแล้วเหลือเงื่อนไขนี้พอดี

                     ⚠️ ห้ามใช้ `isAccepted` ตรง ๆ — มันเป็น true กับเคสที่ปิดแล้วด้วย
                        (js===1 || js===2) ⇒ เคสที่ปิดไปแล้วจะมีปุ่ม reply โผล่

                     ส่ง `undefined` แทนการซ่อนด้วย CSS: `ChatRoomView` gate ตัวเอง
                     ด้วย `onReplyTo &&` อยู่แล้ว ⇒ ปุ่ม **ไม่ถูก render เลย** ตรงกับคำว่า
                     "ไม่ขึ้นมาเลย" · และไม่ต้องแตะคอมโพเนนต์ที่อีก 3 หน้าใช้ร่วมกัน
                     revert: คืนเป็น `onReplyTo={(t) => …}` แบบไม่มีเงื่อนไข */
                  onReplyTo={
                    selectedJobStatus === 1 && isMyCase
                      ? (t) => replyApiRef.current?.requestReply(t) ?? false
                      : undefined
                  }
                  /* [FEAT-20260908-AITRANSLATE] the translate chip, on this page
                     and this page only.
                     🔴 Gated on the SAME `selectedJobStatus === 1 && isMyCase`
                        the reply chip uses — and for a stronger reason than
                        symmetry: every press is a BILLED AI call against a
                        lifetime budget, so an admin merely LOOKING at someone
                        else's case, or at a case nobody has accepted, must not
                        be able to spend one. Passing `undefined` means the chip
                        is not rendered at all (the component gates on the prop
                        with `&&`), which is stricter than hiding it with CSS.
                     ⚠️ Do NOT simplify to `isAccepted`: that is also true for a
                        CLOSED case (js===2), and the chip would come back on
                        cases nobody is working — the exact trap the reply gate
                        documents just above. */
                  onTranslate={
                    selectedJobStatus === 1 && isMyCase ? handleBubbleTranslate : undefined
                  }
                  /* [FEAT-20260819-ORPHANROOM] so the header avatar can wear the same
                     ring as this customer's card. Optional — the pages without ticket
                     context simply keep the default green. */
                  isOrphanRow={!!(selectedTicket as any)[ORPHAN_FLAG]}
                  room={selectedRoom}
                  hookId={selectedTicket.line_oa_hook_id || undefined}
                  headerTitle={selectedTicket.line_user_data?.phone_number || selectedTicket.line_user_data?.display_name || undefined}
                  /* [FIX-20260801-HEADER2LINE] ชื่อ OA บรรทัดล่างของหัวแชท
                     ใช้ oaName() ตัวเดิมที่หน้านี้มีอยู่แล้ว ไม่ยิง API เพิ่ม */
                  oaName={oaName(selectedTicket.line_oa_hook_id) || undefined}
                  showDetailBox={false}
                  onCloseCase={() => setConfirmAction({ ticket: selectedTicket, targetStatus: 2 })}
                  canCloseCase={canCloseCase}
                  // [FIX-20260731-CLOSEDBADGE] เคสปิดแล้ว → หัวห้องแชทโชว์ป้าย
                  // "เคสนี้ปิดแล้ว" แทนปุ่มปิดเคส (ปุ่มกดไม่ได้อยู่แล้วตอนนั้น)
                  caseClosed={selectedJobStatus === 2}
                  extraDividers={closeCaseDividers}
                  // [FIX-20260801-HEADER2LINE] ให้หัวแชทแสดงป้ายเทียร์จาก raw profile
                  // หน้า Chat ปกติไม่ส่ง prop นี้ → ไม่ยิงอะไรและไม่มีป้าย (ไม่กระทบ)
                  memberId={selectedTicket.line_user_data?._id || undefined}
                  /* [FIX-20260810-TIERSOURCE] ส่ง member ทั้งดวง (มี raw_profile_data)
                     ให้ header อ่าน tier จากก้อนเดียวกับ panel — ไม่ยิง API เพิ่ม */
                  memberData={selectedTicket.line_user_data}
                  /* [FEAT-20260905-CUSTPROV PART 4] same switch that gates the
                     card badge above — `showTierBadge` governs BOTH sites or
                     neither ([FIX-20260810-TIERSOURCE]). The other 3 pages that
                     share ChatRoomView omit this prop, so its default (`true`
                     in ChatRoomView.tsx) keeps them byte-identical to today. */
                  showTierBadge={showTierBadge}
                  /* [FEAT-20260810-DIRECTTICKET] ส่งข้อมูล ticket ให้ห้องแชตรู้ว่า
                     เคสนี้ระบบเปิดให้เอง — ใช้ขึ้น divider ส้มบนสุดของ stream
                     ไม่ใช่ direct ⇒ ไม่แสดงอะไร (ticket เก่าไม่มี field นี้ = seamless) */
                  ticketMeta={{
                    /* [FIX-20260820-DIVIDEROWNER] the case id, so the view can ask
                       whether THIS case's divider is already in the transcript
                       rather than inferring it from the rows around it. */
                    _id: (selectedTicket as any)?._id,
                    direct_ticket: (selectedTicket as any)?.direct_ticket,
                    direct_ticket_detail: (selectedTicket as any)?.direct_ticket_detail,
                    need_detail: (selectedTicket as any)?.need_detail,
                    created_at: (selectedTicket as any)?.created_at,
                  }}
                />
                {/* accept overlay handled inside ChatInputBox */}
              </div>
              {/* A closed case (job_status 2) is view-only — no composer, just a
                  notice. Otherwise show the composer (accept overlay until taken). */}
              {/* ==== [FIX-20260731-CLOSEDBOX] START
                   ผู้ใช้สั่ง "กล่อง chatbox ของเคสที่ปิดแล้ว เปลี่ยนเป็นแบบภาพที่สอง"
                   = แบบเดียวกับ overlay "บอทกำลังดูแลแชทนี้" คือ **ป้ายแคปซูลลอย
                   อยู่บนกล่องพิมพ์ที่เบลอ** ไม่ใช่แถบแบนเต็มความกว้างแบบเดิม

                   ทำโดยส่ง accepted={false} + closedNotice ให้ ChatInputBox
                   เพื่อให้ได้ "กล่องพิมพ์ + overlay เบลอ" ทรงเดียวกับตอนรอรับเคส
                   → ความสูงเท่ากับ blur ของ "กดรับเคส" อัตโนมัติ (ผู้ใช้สั่งไว้)

                   ⚠️ เคสปิดแล้วยังพิมพ์ไม่ได้เหมือนเดิมทุกประการ — overlay ทับอยู่
                      และไม่มีปุ่มให้กด (onAccept ไม่ถูกส่ง) ไม่ได้เปิดสิทธิ์อะไรใหม่
                   revert: กลับไปใช้ <div> แถบแบน "เคสนี้ปิดแล้ว" ตัวเดิม */}
              {selectedJobStatus === 2 ? (
                <ChatInputBox
                  /* [FIX-20260830-TRAYSTICK] รีเซ็ตทุกอย่างในกล่องพิมพ์เมื่อสลับห้อง
                     อาการที่เจ้าของเจอ: เปิดแผงตอบด่วน/อิโมจิ/สติกเกอร์ค้างไว้ แล้ว
                     คลิกการ์ดอื่น (บอทดูแล/รับเคส) แผงยังค้างอยู่ใต้ overlay ทำให้
                     กล่องสูงผิดและดูเหมือนค้าง
                     ต้นเหตุ: state ของแผงทั้งสาม + ความสูง + ข้อความร่าง อยู่ **ข้างใน**
                     ChatInputBox และไม่มี key ⇒ React ใช้ instance เดิมข้ามห้อง
                     `key` ที่เปลี่ยนตามห้อง = remount = ทุกอย่างกลับเป็นค่าเริ่มต้น
                     ของห้องใหม่ ซึ่งเป็นสิ่งที่เจ้าของสั่ง ("เคลียร์กล่องพิมพ์ออกไปเลย")
                     ⚠️ ใช้ `_id` ของ ticket ซึ่งนิ่ง — ไม่ใช่ object หรือค่าที่เปลี่ยน
                     ทุก poll ไม่งั้นจะ remount รัวและข้อความที่พิมพ์ค้างหายระหว่างพิมพ์
                     revert: ลบบรรทัด key ออกจากทั้งสองจุด */
                  key={selectedTicket?._id ?? 'none'}
                  /* [FEAT-20260830-TRAYFULL] ส่งโหมด + ตัวเปิด modal ลงไป
                     ⚠️ ต้องส่งจากที่นี่เท่านั้น ไม่ใช่ให้ ChatInputBox อ่านเอง —
                     state เป็นของหน้า และหน้าอื่นที่ไม่ส่ง prop จะไม่มีปุ่มโผล่ */
                  trayMode={chatTrayMode}
                  onOpenTraySettings={() => setTrayModalOpen(true)}
                  traySettingsLabel={t('ticket.tray_mode_title')}
                  /* [FEAT-20260830-TRAYCLOSEBAR] label for the toolbar close button */
                  trayCloseLabel={t('ticket.tray_close')}
                  onReplyReadyRef={(api) => { replyApiRef.current = api; }}
                  accepted={false}
                  accepting={false}
                  room={selectedRoom}
                  hookId={selectedTicket.line_oa_hook_id || undefined}
                  channelType={hooks.find(h => h._id === selectedTicket.line_oa_hook_id)?.channel_type}
                  closedNotice={t('ticketui.room.bot_handling', 'บอทกำลังดูแล')}
                  // [FEAT-20260817-REOPENBYADMIN] the button exists ONLY for the
                  // bot-care set (owner's rule) — same predicate that builds that
                  // tab: bot-mode ticket AND the customer has no open case. The
                  // filter is a browser snapshot; the BE's atomic claim is the
                  // real guard when two admins race.
                  /* [FEAT-20260819-OPENFROMROOM] the same button, two routes. A row that
                     came from a ROOM has no ticket to reopen — its id is a synthesized
                     `orphan:<roomId>` that would 404 on the reopen route — so it opens the
                     dialog that creates the FIRST case instead. The reopen path below is
                     untouched. ปุ่มเดียวกัน แต่คนละเส้น ตามชนิดของแถว. */
                  onReopen={
                    (selectedTicket as any)[ORPHAN_FLAG]
                      ? () => setOpenCaseRoom({
                          roomId: String((selectedTicket as any).chat_room_id ?? ''),
                          name: selectedTicket.line_user_data?.display_name
                            || selectedTicket.line_user_data?.phone_number || '',
                        })
                      : isBotModeTicket(selectedTicket) &&
                        !activeTickets.some(tk => getTicketUserKey(tk) === getTicketUserKey(selectedTicket))
                        ? () => setReopenConfirm(selectedTicket)
                        : undefined
                  }
                  reopening={reopening}
                />
              ) : (
                <ChatInputBox
                  /* [FIX-20260830-TRAYSTICK] รีเซ็ตทุกอย่างในกล่องพิมพ์เมื่อสลับห้อง
                     อาการที่เจ้าของเจอ: เปิดแผงตอบด่วน/อิโมจิ/สติกเกอร์ค้างไว้ แล้ว
                     คลิกการ์ดอื่น (บอทดูแล/รับเคส) แผงยังค้างอยู่ใต้ overlay ทำให้
                     กล่องสูงผิดและดูเหมือนค้าง
                     ต้นเหตุ: state ของแผงทั้งสาม + ความสูง + ข้อความร่าง อยู่ **ข้างใน**
                     ChatInputBox และไม่มี key ⇒ React ใช้ instance เดิมข้ามห้อง
                     `key` ที่เปลี่ยนตามห้อง = remount = ทุกอย่างกลับเป็นค่าเริ่มต้น
                     ของห้องใหม่ ซึ่งเป็นสิ่งที่เจ้าของสั่ง ("เคลียร์กล่องพิมพ์ออกไปเลย")
                     ⚠️ ใช้ `_id` ของ ticket ซึ่งนิ่ง — ไม่ใช่ object หรือค่าที่เปลี่ยน
                     ทุก poll ไม่งั้นจะ remount รัวและข้อความที่พิมพ์ค้างหายระหว่างพิมพ์
                     revert: ลบบรรทัด key ออกจากทั้งสองจุด */
                  key={selectedTicket?._id ?? 'none'}
                  /* [FEAT-20260830-TRAYFULL] ส่งโหมด + ตัวเปิด modal ลงไป
                     ⚠️ ต้องส่งจากที่นี่เท่านั้น ไม่ใช่ให้ ChatInputBox อ่านเอง —
                     state เป็นของหน้า และหน้าอื่นที่ไม่ส่ง prop จะไม่มีปุ่มโผล่ */
                  trayMode={chatTrayMode}
                  onOpenTraySettings={() => setTrayModalOpen(true)}
                  traySettingsLabel={t('ticket.tray_mode_title')}
                  /* [FEAT-20260830-TRAYCLOSEBAR] label for the toolbar close button */
                  trayCloseLabel={t('ticket.tray_close')}
                  onReplyReadyRef={(api) => { replyApiRef.current = api; }}
                  accepted={isAccepted}
                  accepting={actionInProgress}
                  onAccept={() => {
                    // one-case-at-a-time is enforced HERE, at accept time (not on open):
                    // if I already hold a DIFFERENT in-progress case, warn instead.
                    if (myActiveCase && myActiveCase._id !== selectedTicket._id) {
                      setPendingTicket(selectedTicket);
                      setBusyCaseWarnOpen(true);
                    } else {
                      setConfirmAction({ ticket: selectedTicket, targetStatus: 1 });
                    }
                  }}
                  room={selectedRoom}
                  hookId={selectedTicket.line_oa_hook_id || undefined}
                  channelType={hooks.find(h => h._id === selectedTicket.line_oa_hook_id)?.channel_type}
                  // [FIX-20260728-NOBLINK] เดิมคือ: onSent={() => setChatRefreshKey(k => k + 1)}
                  // ซึ่งบวก key แล้ว remount ทั้งห้อง = กระพริบ + โหลดรูปใหม่ทั้งหมด
                  // ตอนนี้ append ข้อความที่เพิ่งส่งเข้า state ตรง ๆ (0 network call)
                  // ถ้า ref ยังไม่พร้อมหรือ API ไม่คืน data → fallback refetch
                  // เฉพาะห้องนี้ (ยังไม่ remount) ดีกว่าข้อความไม่โผล่
                  // revert: เปลี่ยนกลับเป็น onSent={() => setChatRefreshKey(k => k + 1)}
                  onSent={(sentMessage) => {
                    // [FIX-20260728-NOBLINK-EMPTY] ต้องเช็คว่า object ที่ API
                    // ตอบกลับมา "มีเนื้อข้อความจริง" ก่อน append ไม่งั้นได้
                    // bubble ว่าง (เคสที่เจอจริง: payload บางเส้นมีแต่ preview)
                    // ไม่ครบเมื่อไหร่ → refetch ห้องนี้ ยังไม่ remount
                    const hasBody = !!sentMessage && (
                      (typeof sentMessage.content === 'string' && sentMessage.content.length > 0) ||
                      !!sentMessage.internal_content_id ||
                      sentMessage.message_type === 'video_pending'
                    );
                    if (hasBody && chatApiRef.current) {
                      chatApiRef.current.appendMessage(sentMessage);
                    } else {
                      chatApiRef.current?.refetch();
                    }
                  }}
                  isOtherAdminCase={isOtherAdminCase}
                  otherAdminName={otherAdminName}
                  claimedAt={selectedTicket.assigned_at}
                  onClaim={() => setClaimConfirmOpen(true)}
                  claiming={claiming}
                />
              )}
            </>
          )}
        </div>

        <DetailColumn
          {...{
            rightOpen, setRightOpen, t, setRightTab, rightTab, selectedTicket,
            showFollowUps, oaName, selectedRoom, showRegisterAction, showWalletpayCard, providerCats,
            acmeCategory, canCloseCase, setConfirmAction, currentUser, assignableUsers, cardNonce,
            handleTransferSuccess,
          }}
        />
      </div>

      <QuickReplyModal
        {...{
          quickReplyModalOpen, t, setQuickReplyModalOpen,
        }}
      />

      {/* accept / close confirm */}
      <ConfirmModal
        isOpen={!!confirmAction}
        onClose={() => { setConfirmAction(null); setCloseAnswers({}); setFollowUpMissing(false); }}
        onConfirm={() => {
          if (!confirmAction) return;
          /* [FEAT-20260827-PATCHAFTERCLOSE] ตอบไม่ครบ = ไม่ปิด แค่ทำให้หัวข้อที่ค้างแดง
             ⚠️ ตัวตัดสินต้องเป็น `closeTopics` ตัวเดียวกับที่ตัดสินว่าจะ "แสดง" อะไร
                ไม่งั้นจะล็อกปุ่มยืนยันของเคสที่ไม่มีช่องให้เลือก = ปิดเคสไม่ได้เลย
                (บั๊กที่รุ่น 26/08 กันไว้ ยังต้องกันต่อ) · ไม่มีหัวข้อ = ลิสต์ว่าง = ผ่านทันที */
          /* [FEAT-20260830-FOLLOWUPFRESH] never confirm on data still in flight —
             the sections would be judged against a room about to be replaced,
             which is the stale-data bug wearing a different hat. */
          if (freshLoading) return;
          /* [FEAT-20260830-CLOSEWIZARD] not the last step ⇒ the button ADVANCES.
             The same guard applies first: an unanswered step cannot be stepped
             past, and the shake/focus fires exactly as it does on the close. */
          if (!closeWizard.isLast) {
            if (!closeWizard.canAdvance) {
              setFollowUpMissing(true);
              setMissingAttempt((n) => n + 1);
              return;
            }
            setFollowUpMissing(false);
            closeWizard.next();
            return;
          }
          if (missingTopics(closeTopics, closeAnswers).length > 0) {
            setFollowUpMissing(true);
            // [FIX-20260830-SHAKEEVERYTIME] every press is its own attempt
            setMissingAttempt((n) => n + 1);
            return;
          }
          executeAction(confirmAction.ticket, confirmAction.targetStatus);
          /* [FIX-20260830-CLOSESTAYOPEN] we close it, because we know the guard
             passed — see closeOnConfirm={false} below. */
          setConfirmAction(null);
          setCloseAnswers({});
          setFollowUpMissing(false);
        }}
        /* [FIX-20260830-CLOSESTAYOPEN] the dialog must NOT close itself on
           confirm while options are unanswered.
           🔴 The bug: `ConfirmModal` defaults `closeOnConfirm` to true and calls
              `onClose()` right after `onConfirm()`, ignoring whether the handler
              bailed out. So the guard ran, set the red state, blocked the close
              — and the dialog vanished anyway, taking the warning with it. The
              admin saw the modal disappear and assumed the case had closed.
           ⇒ the caller owns the closing now: `executeAction` succeeds → we call
             `setConfirmAction(null)` ourselves; a blocked confirm simply stays. */
        closeOnConfirm={false}
        /* [FEAT-20260830-CLOSEWIZARD] the footer says what the press will do.
           With no topics `confirmKind` is already 'close', so the label is the
           one every other dialog shows. */
        confirmLabel={
          confirmAction?.targetStatus === 2 && closeWizard.confirmKind === 'next'
            ? t('ticketui.common.next', 'ถัดไป')
            : undefined
        }
        title={confirmAction?.targetStatus === 2 ? t('ticketui.confirm.close_title', 'ยืนยันปิดเคส') : t('ticketui.confirm.accept_title', 'ยืนยันรับเคส')}
        message={confirmAction?.targetStatus === 2 ? t('ticketui.confirm.close_msg', 'ต้องการปิดเคสนี้ใช่หรือไม่?') : t('ticketui.confirm.accept_msg', 'รับเคสนี้เพื่อเริ่มสนทนาใช่หรือไม่?')}
        type={confirmAction?.targetStatus === 2 ? 'warning' : 'info'}
        /* [FEAT-20260830-FOLLOWUPFRESH] greyed out while the stamps are being
           read, so it cannot be pressed against data about to change */
        confirmDisabled={freshLoading}
      >
        {/* [FEAT-20260827-PATCHAFTERCLOSE] ไม่มีหัวข้อไหนขึ้น = ไม่เรนเดอร์อะไรเลย
            ⇒ กล่องยืนยันของทุกเคสที่เหลือมี DOM เท่าเดิมทุกไบต์ (`children` ที่ไม่ส่ง
            เรนเดอร์เป็นค่าว่างตามที่ ConfirmModal เขียนกำกับไว้) */}
        {/* [FEAT-20260830-FOLLOWUPFRESH] say what the dialog is doing. The read is
            one small request, but the admin must not see an empty dialog and
            conclude there is nothing to answer. */}
        {closeDialogOpen && freshLoading && (
          <div
            data-testid="close-case-fresh-loading"
            className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-dark-700 dark:bg-dark-900/40"
          >
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('ticket.close_case_checking_follow_up')}
            </span>
          </div>
        )}
        {closeDialogOpen && freshFailed && (
          <p
            data-testid="close-case-fresh-failed"
            role="alert"
            className="mt-3 break-words rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300"
          >
            {t('ticket.close_case_follow_up_stale')}
          </p>
        )}
        <CloseCaseSections
          topics={closeTopics}
          answers={closeAnswers}
          onChange={(topic: CloseCaseTopic, value: string) => {
            setCloseAnswers((prev) => {
              const next = { ...prev, [topic]: value };
              /* [FIX-20260830-CLOSEMISSING] ล้างคำเตือนก็ต่อเมื่อ "ครบทุกหัวข้อ" แล้ว
                 เท่านั้น — เดิมล้างทันทีที่แตะหัวข้อใดหัวข้อหนึ่ง ทำให้เคสที่มีสอง
                 หัวข้อ (ฝาก + ถอน) เลือกไปข้างเดียวแล้วแดงหายทั้งกล่อง แอดมินจึงกด
                 ยืนยันซ้ำแล้วไม่เกิดอะไรขึ้น โดยไม่มีอะไรบอกว่าเหลือหัวข้อไหน
                 ⚠️ ต้องคำนวณจาก `next` ไม่ใช่ `closeAnswers` — setState เป็น async
                 ค่าที่อ่านนอก updater จะเป็นค่าก่อนหน้าเสมอ (ช้าไปหนึ่งคลิก) */
              if (missingTopics(closeTopics, next).length === 0) {
                setFollowUpMissing(false);
              }
              return next;
            });
          }}
          showMissing={followUpMissing}
          missingAttempt={missingAttempt}
          stepIndex={closeWizard.stepIndex}
          onStepBack={closeWizard.back}
        />
      </ConfirmModal>

      {/* [FEAT-20260819-OPENFROMROOM] the failure the operator must see: the BE
          refuses with 409 when another admin claimed the same room first. */}
      <AlertModal
        isOpen={!!openCaseError}
        onClose={() => setOpenCaseError(null)}
        title={t('ticketui.error.open_case_failed', 'เปิดเคสไม่สำเร็จ')}
        type="warning"
        message={openCaseError ?? ''}
      />

      {/* [FEAT-20260819-OPENFROMROOM] first-case dialog — category + need. Its own
          instance beside the reopen confirm, because they hit different routes. */}
      <OpenCaseModal
        categories={providerCats}
        open={!!openCaseRoom}
        customerName={openCaseRoom?.name}
        busy={openingCase}
        onCancel={() => setOpenCaseRoom(null)}
        onConfirm={executeOpenFromRoom}
      />

      {/* [FEAT-20260817-REOPENBYADMIN] reopen confirm — its own instance */}
      <ConfirmModal
        isOpen={!!reopenConfirm}
        onClose={() => setReopenConfirm(null)}
        onConfirm={() => reopenConfirm && executeReopen(reopenConfirm)}
        title={t('ticketui.confirm.reopen_title', 'ยืนยันเปิดเคส')}
        message={t('ticketui.confirm.reopen_msg', 'เปิดเคสนี้และรับเป็นผู้ดูแลใช่หรือไม่?')}
        type="info"
      />

      {/* race-conflict warning (someone closed/claimed first) — acknowledge only */}
      <ConfirmModal
        isOpen={!!raceWarnMsg}
        onClose={() => setRaceWarnMsg(null)}
        onConfirm={() => setRaceWarnMsg(null)}
        title={t('ticketui.race.title', 'เคสถูกจัดการไปแล้ว')}
        message={raceWarnMsg || ''}
        confirmLabel={t('ticketui.common.ok', 'รับทราบ')}
        hideCancel
        type="warning"
      />

      {/* claim confirm */}
      <ConfirmModal
        isOpen={claimConfirmOpen}
        onClose={() => setClaimConfirmOpen(false)}
        onConfirm={handleExecuteClaim}
        title={t('ticketui.claim.title', 'ยืนยันการเคลมงาน')}
        message={t('ticketui.claim.msg', 'คุณต้องการเคลมงานนี้จาก "{name}" มาดูแลเองใช่หรือไม่?', { name: otherAdminName })}
        type="info"
        confirmLabel={t('ticketui.claim.button', 'เคลมงาน')}
      />

      <FavGroupDialogs
        {...{
          favConfirm, setFavConfirm, confirmFav, t, favLimitWarn, setFavLimitWarn,
          FAV_MAX,
        }}
      />

      {/* Warn when ACCEPTING a case while another is in progress. Two choices:
          "รับเคสใหม่" accepts the new case anyway; "กลับเคสเดิม" jumps back. */}
      <ConfirmModal
        isOpen={busyCaseWarnOpen}
        onClose={() => { setBusyCaseWarnOpen(false); setPendingTicket(null); }}
        onConfirm={() => {
          setBusyCaseWarnOpen(false);
          const t = pendingTicket; setPendingTicket(null);
          if (t) setConfirmAction({ ticket: t, targetStatus: 1 });  // accept the new case
        }}
        confirmLabel={t('ticketui.busy.accept_new', 'รับเคสใหม่')}
        cancelLabel={t('ticketui.busy.back', 'กลับเคสเดิม')}
        closeOnConfirm={false}
        onCancel={() => {
          setBusyCaseWarnOpen(false); setPendingTicket(null);
          // back to the current case: switch the left list to the tab that holds
          // it ("ส่วนตัว" — my in-progress cases) and open it so the card highlights.
          if (myActiveCase) { setStatusTab('mine'); doOpenTicket(myActiveCase); }
        }}
        type="warning"
        title={t('ticketui.busy.title', 'มีเคสที่กำลังดูแลอยู่')}
        message={t('ticketui.busy.msg', 'คุณกำลังดูแลเคส "{current}" อยู่ — จะรับเคสใหม่ "{next}" (รับซ้อน) หรือกลับไปที่เคสเดิม?', { current: myActiveCase?.line_user_data?.display_name || myActiveCase?.line_user_data?.phone_number || t('ticketui.busy.current', 'ปัจจุบัน'), next: pendingTicket?.line_user_data?.display_name || pendingTicket?.line_user_data?.phone_number || t('ticketui.busy.new', 'ใหม่') })}
      />

      <TagInfoModal
        {...{
          tagInfoTicket, t, setTagInfoTicket, categoryBadge,
        }}
      />

      <ChatSettingsDialogs
        {...{
          fontModalOpen, setFontModalOpen, chatFontScaleRaw, setChatFontScaleRaw, setSettingToast, t,
          trayModalOpen, setTrayModalOpen, chatTrayModeRaw, setChatTrayModeRaw, settingToast, closeSuccessOpen,
        }}
      />

      <AssignHistoryModal
        {...{
          historyModalTicket, t, categoryBadge, setShowCustomerInfoInModal, showCustomerInfoInModal, setShowMongoId,
          showMongoId, acmeCategory, oaName, setCopiedLabelInModal, copiedLabelInModal, setCopiedMongoId,
          copiedMongoId, setHistoryModalTicket, isEnglish,
        }}
      />

      <PinTranslateDialogs
        {...{
          pinLimitAlert, setPinLimitAlert, t, translateAlert, setTranslateAlert, unpinTarget,
          setUnpinTarget, confirmUnpin,
        }}
      />
    </div>
  );
};

/* [FEAT-20260830-TRAYDATA] EMOJI_SET + STICKER_PACKS moved to
   ./composer-trays/ (owner: tray data in its own tidy folder). Data unchanged
   byte-for-byte — see each file's header for the rules that govern it. */

/* ==== [REFACTOR-20260905-CUSTPROV] eight components moved out of this file ===
 *
 * WHAT MOVED — everything that used to sit below `TicketChat` in this file:
 *   components/chat/chat-input/     ChatInputBox (split into five regions
 *                                   inside that folder — see its header)
 *   components/chat/ticket-detail/  ProfileHeader, DetailSkeleton,
 *                                   useCardSwitchLoading, PersonalPanel,
 *                                   TransferCard,
 *                                   OperationsPanel
 *
 * WHY: 1,192 of this file's 4,485 code lines (26.6%) were eight components that
 * merely SHARED the file with the page. Not one of them read the page's state,
 * handlers or effects — each reads its own props and its own local state — so
 * moving them is filing, not surgery. This file stays on the eslint max-lines
 * waiver either way; the point is that the eight are now findable, and each is
 * small enough to be read in one sitting.
 *
 * ⚠️ NO STATE MOVED, IN EITHER DIRECTION. Nothing was lifted up into this page
 * and nothing was pushed down into a child, so render order, hook order and
 * effect timing are unchanged and the screen is byte-identical (`dev-local`
 * §6.4). Every moved body is verbatim — the only edit was adding `export`.
 *
 * ⚠️ Several suites read THIS FILE as source text and assert substrings. Where
 * a pinned string travelled with the code, the suite now reads the file it
 * travelled to; the assertion itself is unchanged. See those suites' comments.
 *
 * revert: move each component's body back below `export default TicketChat`
 *   (each new file's header lists its own steps), drop the two barrel imports
 *   above, and delete the two folders.
 * ============================================================================ */

export default TicketChat;
