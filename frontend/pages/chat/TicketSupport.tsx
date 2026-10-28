/**
 * TicketSupport.tsx
 * Ticket Management Page with Instant Chat Panel
 * 
 * Created/Updated by: Gemini 3.6 Flash (2026-07-22)
 * Purpose: Ticket support manager with instant chat panel split view on accept ticket action.
 * DB impact: NONE (Frontend UI page)
 *
 * ⚠️ THIS IS THE LEGACY PAGE — READ THIS BEFORE CHANGING ANYTHING HERE
 * ---------------------------------------------------------------------------
 * There are TWO ticket pages in this repo and they are easy to confuse:
 *
 *   route            component            what it is
 *   ---------------  -------------------  ------------------------------------
 *   /ticket-support  TicketChat.tsx       **THE LIVE PAGE.** 3-column chat-first
 *                                         view. This is what operators open all
 *                                         day and what a screenshot of "the
 *                                         ticket page" almost always shows.
 *   /legacy-ticket   TicketSupport.tsx    THIS FILE. The older DataTable view,
 *                                         kept reachable after the omnichannel
 *                                         merge but not part of daily work.
 *
 * Note the trap: the route named `/ticket-support` does NOT render
 * `TicketSupport.tsx` — it renders `TicketChat.tsx`. The names are swapped
 * relative to what you would guess, so a change made "on the ticket page" by
 * filename lands where nobody will ever see it. Both routes are wired in
 * `App.tsx` (search for `/legacy-ticket`).
 *
 * ⇒ Feature work an operator must SEE belongs in `TicketChat.tsx`. Touch this
 *   file only for the legacy table itself, or to keep the two in step
 *   deliberately. ชื่อไฟล์กับ route สลับกัน — หน้าที่ใช้จริงคือ TicketChat.tsx
 *
 * Kept in step here on purpose (2026-08-19): the new-message badge + live
 * re-sort, `[FEAT-20260819-MSGALERT]`. The sound/toast for both pages is fired
 * once, app-wide, in `App.tsx` — not in either page.
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n, translateNow } from '../../i18n';
import {
  Search,
  Calendar,
  Database,
  User as UserIcon,
  Tag,
  MessageSquare, 
  Briefcase, 
  UserCheck, 
  Copy, 
  Check, 
  Image as ImageIcon, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  ChevronUp,
  Maximize2,
  X, 
  RefreshCw,
  CheckCircle,
  Info,
  Edit2,
  Download,
  Layers,
  Settings,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  Trash2
} from 'lucide-react';
import { API_BASE_URL } from '../../services/apiClient';
import { getStoredAuth } from '../../services/authStorage';
import { userService } from '../../services/admin';
import { ticketService, TicketEntry } from '../../services/chat';
import { webhookService } from '../../services/hook';
import { assignHistoryService } from '../../services/chat';
import { chatService } from '../../services/chat';
import { groupService } from '../../services/admin';
import { configService } from '../../services/admin';
import { usePreference } from '../../hooks/usePreferences';
import { AlertModal } from '../../components/modals';
import { ConfirmModal } from '../../components/modals';
import { auditService } from '../../services/admin';
import { useTicketWS } from '../../services/chat';
// [FEAT-20260819-MSGALERT] the unread-badge rules — pure, tested in
// test/ticketAlerts.value.test.ts. Kept OUT of this file on purpose: it is on
// the max-lines waiver and that list may only shrink.
import { inboundMessageKey, bumpUnread, clearUnread, markMessageAt, activityAt } from '../../services/chat';
import { ChatRoomView } from '../../components/chat';
// [FIX-20260814-CUSTOMERNAME] shared name resolution — skips the backend's
// "Unknown" placeholder while keeping nickname → display_name priority
import { customerName } from '../../components/common';
import { UserEntry, HookData } from '../../types';
import { copyText } from '../../utils/copyText';
import { TicketCategoryBadge, categoryOptionsFor, useProviderTicketCategories } from '../../components/ticket-category';

// Ticket category filters. A site whose customer provider declares its own set uses that
// ([FEAT-20261014-TICKETCATS], loan_v1); otherwise these, driven by the `acme_category`
// config flag exactly as before (shop-api).
// Each entry owns its label AND its matcher, so the dropdown and the filter
// logic never drift. `match(cat)` decides whether a ticket's stored category
// belongs under this option.
//   flag true  -> the legacy 4-category set (acme deployments)
//   flag absent/false -> the narrowed 2-category set
type CategoryOption = { label: string; match: (cat?: string | null) => boolean };

const CATEGORIES_LEGACY: CategoryOption[] = [
  { label: 'ทวงถาม', match: (c) => c === 'Collection' || c === 'ค่างวด' || c === 'ทวงถาม' },
  { label: 'ชำระค่างวด', match: (c) => c === 'Payment' || c === 'รับยอด' || c === 'ชำระค่างวด' },
  { label: 'สินเชื่อ', match: (c) => c === 'Loan' || c === 'สินเชื่อ' },
  { label: 'อื่นๆ', match: (c) => !['Collection', 'ค่างวด', 'ทวงถาม', 'Payment', 'รับยอด', 'ชำระค่างวด', 'Loan', 'สินเชื่อ'].includes(c || '') },
];

const CATEGORIES_NARROW: CategoryOption[] = [
  { label: 'แจ้งฝาก', match: (c) => c === 'Payment' || c === 'รับยอด' || c === 'แจ้งฝาก' },
  // Everything that is not a deposit slip lands here, including tickets created
  // before the set was narrowed — so nothing becomes unreachable.
  { label: 'อื่นๆ', match: (c) => c !== 'Payment' && c !== 'รับยอด' && c !== 'แจ้งฝาก' },
];

/* [FEAT-20261022-I18NPAGESEN] the Thai category / job-status words above stay the filter VALUES
   (state, comparisons, BE params); these maps only pick the label drawn for them. */
const CATEGORY_LABEL_KEY: Record<string, string> = {
  'ทวงถาม': 'pageui.support.cat_collection',
  'ชำระค่างวด': 'pageui.support.cat_installment',
  'สินเชื่อ': 'pageui.support.cat_loan',
  'อื่นๆ': 'pageui.support.cat_other',
  'แจ้งฝาก': 'pageui.support.cat_deposit',
  'อุปกรณ์': 'pageui.support.cat_device',
};
const JOB_STATUS_LABEL_KEY: Record<string, string> = {
  'รอรับงาน': 'pageui.support.status_waiting',
  'กำลังดำเนินงาน': 'pageui.support.status_in_progress',
  'จบงาน': 'pageui.support.status_done',
};

// Column defaults live in one place — the reset button and the initial state
// both read these (they used to be duplicated in three spots).
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  profile: 70, displayName: 120, customerInfo: 220, category: 100, needs: 200,
  attachments: 90, dateTime: 185, chatStatus: 100, jobStatus: 110, operator: 170,
};
const DEFAULT_VISIBLE_COLS = { profile: true, customerInfo: true, category: true, needs: true };

export const TicketSupport: React.FC = () => {
  const { t } = useI18n();

  // Tab State
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [activeHookId, setActiveHookId] = useState<string | null>(null);
  const [pendingHookId, setPendingHookId] = useState<string | null>(null);
  
  const [groups, setGroups] = useState<any[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) =>
      (a.group_name || '').localeCompare(b.group_name || '', undefined, { sensitivity: 'base', numeric: true })
    );
  }, [groups]);

  const userAllowedHooks = useMemo(() => {
    const auth = getStoredAuth();
    return auth?.allowed_hooks ?? auth?.user?.allowed_hooks ?? null;
  }, []);

  const userAllowedHooksSet = useMemo(() => {
    return userAllowedHooks ? new Set(userAllowedHooks) : null;
  }, [userAllowedHooks]);

  const activeGroupHooks = useMemo(() => {
    if (!activeGroupId) return [];
    const filtered = hooks.filter(h => (h.group ?? h.group_id) === activeGroupId);
    if (userAllowedHooks) {
      return filtered.filter(h => userAllowedHooks.includes(h._id));
    }
    return filtered;
  }, [hooks, activeGroupId, userAllowedHooks]);

  const activeGroupHookIds = useMemo(() => activeGroupHooks.map(h => h._id), [activeGroupHooks]);

  // Filters state
  const [search, setSearch] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('ทั้งหมด');
  const [filterCategory, setFilterCategory] = useState('ทั้งหมด');
  // acme_category: true = legacy 4-category set, absent/false = narrowed 2.
  const [acmeCategory, setAcmeCategory] = useState(false);
  /* [FEAT-20261014-TICKETCATS] provider set when declared (loan_v1); null = as before (shop-api). */
  const providerCats = useProviderTicketCategories();
  const categoryOptions = useMemo(
    () => (providerCats ? categoryOptionsFor(providerCats) : (acmeCategory ? CATEGORIES_LEGACY : CATEGORIES_NARROW)),
    [providerCats, acmeCategory]
  );
  const [filterChatStatus, setFilterChatStatus] = useState('ทั้งหมด');
  const [filterJobStatus, setFilterJobStatus] = useState('รอรับงาน');
  const [filterOperator, setFilterOperator] = useState('ทั้งหมด');

  // Page limit
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Tickets live API data state
  const [activeTickets, setActiveTickets] = useState<TicketEntry[]>([]);
  const [completedTickets, setCompletedTickets] = useState<TicketEntry[]>([]);
  const [isCompletedLoaded, setIsCompletedLoaded] = useState(false);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [totalTickets, setTotalTickets] = useState(0);

  // Server-side pagination state for จบงาน tab
  const [completedServerPage, setCompletedServerPage] = useState(1);
  const [completedServerTotal, setCompletedServerTotal] = useState(0);
  const [completedServerTotalPages, setCompletedServerTotalPages] = useState(1);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Ticket Info Detail Modal state
  const [selectedTicketForInfo, setSelectedTicketForInfo] = useState<TicketEntry | null>(null);

  // Ticket Gallery Modal state
  const [selectedTicketForGallery, setSelectedTicketForGallery] = useState<TicketEntry | null>(null);

  // Zoomed Image URL state for gallery
  const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);

  // Action Confirmation Modal state
  const [actionInProgress, setActionInProgress] = useState(false);
  const [confirmActionModal, setConfirmActionModal] = useState<{
    isOpen: boolean;
    ticket: TicketEntry | null;
    targetStatus: number; // 1 = รับงาน, 2 = จบงาน
  }>({
    isOpen: false,
    ticket: null,
    targetStatus: 1
  });

  // Operator Edit Modal state
  const [operatorEditModal, setOperatorEditModal] = useState<{
    isOpen: boolean;
    ticket: TicketEntry | null;
  }>({
    isOpen: false,
    ticket: null
  });

  // Assignee Dropdown state
  const [isAssigneeDropdownOpen, setIsAssigneeDropdownOpen] = useState(false);
  const [assigneeSearchQuery, setAssigneeSearchQuery] = useState('');
  const assigneeSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isAssigneeDropdownOpen) {
      setAssigneeSearchQuery('');
    } else {
      setTimeout(() => {
        assigneeSearchInputRef.current?.focus();
      }, 50);
    }
  }, [isAssigneeDropdownOpen]);

  // Expanded Ticket ID for showing assign histories
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);

  const toggleTicketExpand = (id: string) => {
    setExpandedTicketId(prev => prev === id ? null : id);
  };

  // Read the acme_category flag once on mount. Absent/false keeps the
  // narrowed 2-category set; only an explicit true restores the legacy 4.
  useEffect(() => {
    configService.listConfigs({ limit: 200 }).then(res => {
      const row = (res.data || []).find((c: any) => c.key === 'acme_category');
      const v = row?.value;
      setAcmeCategory(v === true || v === 1 || v === 'true');
    }).catch(() => { /* absent config = narrowed set, the safe default */ });
  }, []);

  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error';
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success'
  });

  const [ticketTakenModal, setTicketTakenModal] = useState(false);
  const [ticketTakenCountdown, setTicketTakenCountdown] = useState(3);

  // Bulk Clear Modal state
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearWaiting, setClearWaiting] = useState(true);
  const [clearProcessing, setClearProcessing] = useState(true);
  const [clearConfirming, setClearConfirming] = useState(false); // For 2-step confirm
  const [clearSubmitting, setClearSubmitting] = useState(false);

  // Current logged in user & System admin list state
  const [currentUserDetail, setCurrentUserDetail] = useState<UserEntry | null>(null);
  const [allUsers, setAllUsers] = useState<UserEntry[]>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>('');

  const canBulkClear = useMemo(() => {
    if (!currentUserDetail) return false;
    const roleName = (currentUserDetail.role?.name || '').toLowerCase();
    return ['superuser', 'superadmin', 'admin', 'dev'].includes(roleName);
  }, [currentUserDetail]);

  // Column sizing and visibility — backed by the user's DB preferences (was
  // per-user localStorage). Falls back to the code defaults for accounts that
  // never set them, and the hook debounce-PUTs changes to the backend.
  const [colWidths, setColWidths] = usePreference<Record<string, number>>('tables.tickets.colWidths', DEFAULT_COL_WIDTHS);
  const [visibleCols, setVisibleCols] = usePreference('tables.tickets.visibleCols', DEFAULT_VISIBLE_COLS, { immediate: true });
  const [favGroups] = usePreference<string[]>('ui.favGroups', [], { immediate: true });

  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [resetConfirmModalOpen, setResetConfirmModalOpen] = useState(false);

  const [nicknameInfoModal, setNicknameInfoModal] = useState<{ displayName: string; nickname: string; pictureUrl?: string; isRegistered?: boolean; fullName?: string; detail?: string; phone?: string; contract?: string } | null>(null);
  const [editModal, setEditModal] = useState<{
    isOpen: boolean;
    ticket: TicketEntry | null;
    nickname: string;
    // detailName/detailPhone/detailContract are not three fields on the user.
    // They are the three "|"-separated parts of the single line_user.detail
    // string, split by parseDetail() and re-joined on save. Renaming one here
    // changes nothing on the backend; the whole value ships as `detail`.
    detailName: string;
    detailPhone: string;
    // Part 3 of `detail` — the contract number a human typed into the ticket.
    // Distinct from line_user_data.contract_code, which is the registered
    // contract on the user record. Both surface under the "ID" label.
    detailContract: string;
  }>({ isOpen: false, ticket: null, nickname: '', detailName: '', detailPhone: '', detailContract: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDownloadAll, setConfirmDownloadAll] = useState(false);

  // Instant Chat Room Side Panel State
  const mainContainerRef = useRef<HTMLDivElement | null>(null);
  const [instantChatTarget, setInstantChatTarget] = useState<{
    room: any;
    ticket: TicketEntry;
    hookId?: string;
    isExpanded?: boolean;
    isCollapsed?: boolean;
  } | null>(null);
  const [instantChatPercent, setInstantChatPercent] = useState<number>(80);
  /* [FEAT-20260819-MSGALERT] how many customer messages landed on each card
     while nobody was looking at it, keyed by LINE user id — the only key a
     ticket row and a `message:new` event share (a row exposes no chat_room_id,
     and `ticket.line_user_id` is the MEMBER ObjectId). In memory only: a reload
     clears it, which is correct — "new since you last looked" is a per-session
     idea and there is no server-side read state to restore from.
     เก็บในหน่วยความจำ รีเฟรชแล้วหาย ตั้งใจ. */
  const [unreadByUser, setUnreadByUser] = useState<Record<string, number>>({});
  /* [FEAT-20260819-MSGALERT] when each card last heard from its customer, keyed
     the same way. Kept SEPARATE from the count on purpose: opening a chat clears
     the number but must NOT clear this, or the card you are reading would drop
     back down the list under you. เปิดแชทแล้วเลขหาย แต่ลำดับต้องอยู่ที่เดิม. */
  const [lastMsgAtByUser, setLastMsgAtByUser] = useState<Record<string, number>>({});

  const isCompactView = !!(instantChatTarget && !instantChatTarget.isCollapsed && !instantChatTarget.isExpanded && (100 - instantChatPercent) <= 45);

  // Auto-collapse main menu when instant chat opens
  useEffect(() => {
    if (instantChatTarget) {
      window.dispatchEvent(new CustomEvent('collapse-sidebar'));
    }
  }, [instantChatTarget]);

  /* [FEAT-20260819-MSGALERT] opening a chat clears that card's number — owner:
     "เมื่อกดเปิดดูแชท badge เลขบนการ์ดจะหายไป". Done HERE and not in the click
     handlers because several paths open a chat (card click, รับงาน, and the
     fallback branch when the room lookup fails); watching the target that all of
     them set is the one place a future path cannot forget. `clearUnread` returns
     the SAME object when there is nothing to clear, so opening a card with no
     badge causes no re-render. */
  useEffect(() => {
    const key = instantChatTarget?.room?.line_user_id;
    if (!key) return;
    setUnreadByUser((prev) => clearUnread(prev, String(key)));
  }, [instantChatTarget]);

  const startInstantChatResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = mainContainerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const currentX = moveEvent.clientX - containerRect.left;
      const newPercent = Math.max(30, Math.min(90, ((containerRect.width - currentX) / containerRect.width) * 100));
      setInstantChatPercent(Math.round(newPercent));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Column settings load/save is handled by usePreference (DB-backed) — no
  // per-user localStorage effects needed anymore.

  // Handle column resizing by dragging
  const startResize = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || 100;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(50, startWidth + deltaX); // min width 50px
      setColWidths(prev => ({
        ...prev,
        [colKey]: newWidth
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Sorting state
  const [sortKey, setSortKey] = useState<'category' | 'chat_status' | 'job_status' | 'created_at' | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  // Clipboard copied notification state
  const [copiedId, setCopiedId] = useState<{ id: string; field: string } | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  // Countdown timer states for confirmation actions
  const [actionCountdown, setActionCountdown] = useState(0);
  const [assignCountdown, setAssignCountdown] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();

  const isFetchingRef = useRef(false);
  const isCompletedFetchingRef = useRef(false);
  const lastMetaRef = useRef<{ total: number; last_updated: string | null }>({ total: -1, last_updated: null });

  const fetchTickets = useCallback(async (silent = false) => {
    if (!activeGroupId && !activeHookId) return;
    if (silent && isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (!silent) setLoading(true);
    try {
      let res: any;
      let meta: any;
      if (activeGroupId) {
        try {
          [res, meta] = await Promise.all([
            ticketService.listTicketsByGroup(activeGroupId, { job_status: '0,1', limit: 'all' }),
            ticketService.getTicketMetaByGroup(activeGroupId),
          ]);
        } catch {
          // Fallback: fan-out to get tickets for all hooks in the active group
          if (activeGroupHookIds.length > 0) {
            const ticketsList: any[] = [];
            let totalCount = 0;
            let lastUpdated: string | null = null;
            await Promise.all(activeGroupHookIds.map(async (hookId) => {
              try {
                const [hRes, hMeta] = await Promise.all([
                  ticketService.listTicketsByHook(hookId, { job_status: '0,1', limit: 'all' }),
                  ticketService.getTicketMeta(hookId)
                ]);
                if (hRes?.success && hRes.data) {
                  ticketsList.push(...hRes.data);
                }
                if (hMeta?.success) {
                  totalCount += hMeta.total;
                  if (hMeta.last_updated && (!lastUpdated || hMeta.last_updated > lastUpdated)) {
                    lastUpdated = hMeta.last_updated;
                  }
                }
              } catch (e) {
                console.error(`Failed to fetch for hook ${hookId}:`, e);
              }
            }));
            res = { success: true, data: ticketsList };
            meta = { success: true, total: totalCount, last_updated: lastUpdated };
          }
        }
      } else if (activeHookId) {
        [res, meta] = await Promise.all([
          ticketService.listTicketsByHook(activeHookId, { job_status: '0,1', limit: 'all' }),
          ticketService.getTicketMeta(activeHookId),
        ]);
      }

      if (res?.success) {
        let ticketsList = res.data || [];
        if (userAllowedHooksSet) {
          ticketsList = ticketsList.filter((t: any) => !t.line_oa_hook_id || userAllowedHooksSet.has(t.line_oa_hook_id.toString()));
        }
        setActiveTickets(ticketsList);
      }
      if (meta?.success) {
        lastMetaRef.current = { total: meta.total, last_updated: meta.last_updated ?? null };
        setTotalTickets(meta.total);
      }
    } catch (e) {
      console.error('Failed to fetch tickets:', e);
    } finally {
      isFetchingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [activeGroupId, activeHookId, activeGroupHookIds, userAllowedHooksSet]);

  // Fetch Completed Tickets — server-side pagination + filter
  const completedFetchParamsRef = useRef<string>('');
  const fetchCompletedTickets = useCallback(async (page = 1) => {
    if (!activeGroupId && !activeHookId) return;
    if (isCompletedFetchingRef.current) return;
    isCompletedFetchingRef.current = true;
    setCompletedLoading(true);

    // Map filterOperator (display_name) → admin_user_id
    const operatorId = filterOperator !== 'ทั้งหมด' && filterOperator !== '-'
       ? allUsers.find(u => u.display_name === filterOperator || u.username === filterOperator)?.id
       : filterOperator === '-' ? 'unassigned' : undefined;

    try {
      let res: any;
      if (activeGroupId) {
        try {
          res = await ticketService.listTicketsByGroup(activeGroupId, {
            job_status: 2,
            page,
            limit: itemsPerPage,
            search: search.trim() || undefined,
            category: filterCategory !== 'ทั้งหมด' ? filterCategory : undefined,
            start_date: filterStartDate || undefined,
            end_date: filterEndDate || undefined,
            admin_user_id: operatorId && operatorId !== 'unassigned' ? operatorId : undefined,
          });
        } catch {
          // Fallback to single hook
          if (activeGroupHookIds.length > 0) {
            res = await ticketService.listTicketsByHook(activeGroupHookIds[0], {
              job_status: 2,
              page,
              limit: itemsPerPage,
              search: search.trim() || undefined,
              category: filterCategory !== 'ทั้งหมด' ? filterCategory : undefined,
              start_date: filterStartDate || undefined,
              end_date: filterEndDate || undefined,
              admin_user_id: operatorId && operatorId !== 'unassigned' ? operatorId : undefined,
            });
          }
        }
      } else if (activeHookId) {
        res = await ticketService.listTicketsByHook(activeHookId, {
          job_status: 2,
          page,
          limit: itemsPerPage,
          search: search.trim() || undefined,
          category: filterCategory !== 'ทั้งหมด' ? filterCategory : undefined,
          start_date: filterStartDate || undefined,
          end_date: filterEndDate || undefined,
          admin_user_id: operatorId && operatorId !== 'unassigned' ? operatorId : undefined,
        });
      }

      if (res?.success) {
        setCompletedTickets(res.data || []);
        setCompletedServerTotal(res.pagination?.total || 0);
        setCompletedServerTotalPages(res.pagination?.total_pages || 1);
        setIsCompletedLoaded(true);
      }
    } catch (e) {
      console.error('Failed to fetch completed tickets:', e);
    } finally {
      isCompletedFetchingRef.current = false;
      setCompletedLoading(false);
    }
  }, [activeGroupId, activeHookId, activeGroupHookIds, search, filterCategory, filterStartDate, filterEndDate, filterOperator, itemsPerPage, allUsers]);

  // Lightweight poll — only fetch full data when something actually changed
  const pollMeta = useCallback(async () => {
    if (!activeGroupId && !activeHookId) return;
    if (isFetchingRef.current) return;
    try {
      let meta: any;
      if (activeGroupId) {
        meta = await ticketService.getTicketMetaByGroup(activeGroupId).catch(() => null);
        if (!meta) {
          if (activeHookId) {
            meta = await ticketService.getTicketMeta(activeHookId).catch(() => null);
          }
        }
      } else if (activeHookId) {
        meta = await ticketService.getTicketMeta(activeHookId).catch(() => null);
      }

      if (!meta?.success) return;
      const prev = lastMetaRef.current;
      const changed = meta.total !== prev.total || meta.last_updated !== prev.last_updated;
      lastMetaRef.current = { total: meta.total, last_updated: meta.last_updated };
      setTotalTickets(meta.total);
      if (changed) fetchTickets(true);
    } catch {
      // silent fail — meta is optional, full fetch not required
    }
  }, [activeGroupId, activeHookId, fetchTickets]);

  // Load user details & system users, groups, and hooks on mount
  useEffect(() => {
    const currentAuth = getStoredAuth();
    if (currentAuth?.user?.id) {
      userService.getUser(currentAuth.user.id).then(res => {
        setCurrentUserDetail(res.data);
      }).catch(console.error);

      userService.listUsersForAssign().then(res => {
        const mappedUsers: UserEntry[] = (res.data || []).map(u => ({
          id: u.user_id,
          username: u.username,
          display_name: u.display_name,
          email: '',
          phone: '',
          groups: [],
          permissions: [],
          active: true,
          role: null
        }));
        setAllUsers(mappedUsers);
      }).catch(console.error);
    }

    // Load groups
    groupService.listGroups({ limit: 100 }).then(res => {
      const activeGroups = (res.data || []).filter((g: any) => g.status === 1 || g.status === true);
      setGroups(activeGroups);
    }).catch(console.error);

    webhookService.getAllHooks().then(hooksList => {
      const activeHooks = (hooksList || [])
        .filter(h => h.status === 1)
        .sort((a, b) => (a.line_oa_name || '').localeCompare(b.line_oa_name || '', 'th'));
      setHooks(activeHooks);
    }).catch(console.error);
  }, []); // Only run once on mount

  const autoSelectedGroupRef = useRef(false);

  // Auto-select active group: prefers first starred group (favGroups[0]), otherwise first available group
  useEffect(() => {
    if (groups.length === 0) return;

    const searchString = location.search || (window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
    const params = new URLSearchParams(searchString);
    const groupIdParam = params.get('groupId');
    const statusParam = params.get('status');
    let shouldCleanUrl = false;

    if (statusParam) {
      const statusMap: Record<string, string> = {
        'pending': 'รอรับงาน',
        'accepted': 'กำลังดำเนินงาน',
        'completed': 'จบงาน'
      };
      setFilterJobStatus(statusMap[statusParam] || statusParam);
      shouldCleanUrl = true;
    }

    if (groupIdParam) {
      const targetGroup = groups.find((g: any) => g._id === groupIdParam || g.group_name === groupIdParam);
      if (targetGroup) {
        setActiveGroupId(targetGroup._id);
        autoSelectedGroupRef.current = true;
        if (shouldCleanUrl) {
          navigate('/ticket-support', { replace: true });
        }
        return;
      }
    }

    if (shouldCleanUrl) {
      navigate('/ticket-support', { replace: true });
    }

    const liveSet = new Set(groups.map((g: any) => g._id));
    const validFavs = (favGroups || []).filter(id => liveSet.has(id));

    if (validFavs.length > 0) {
      // Auto select the first starred group if activeGroupId is not set or not in validFavs
      if (!activeGroupId || !liveSet.has(activeGroupId) || (!validFavs.includes(activeGroupId) && !autoSelectedGroupRef.current)) {
        setActiveGroupId(validFavs[0]);
        autoSelectedGroupRef.current = true;
      }
    } else if (!activeGroupId || !liveSet.has(activeGroupId)) {
      const sortedActive = [...groups].sort((a, b) =>
        (a.group_name || '').localeCompare(b.group_name || '', undefined, { sensitivity: 'base', numeric: true })
      );
      if (sortedActive.length > 0) {
        setActiveGroupId(sortedActive[0]._id);
        autoSelectedGroupRef.current = true;
      }
    }
  }, [groups, favGroups, activeGroupId, location.search, navigate]);

  // On hook change: reset meta cache, clear completed state, and fetch active data once
  useEffect(() => {
    lastMetaRef.current = { total: -1, last_updated: null };
    setCompletedTickets([]);
    setIsCompletedLoaded(false);
    setCompletedServerPage(1);
    setCompletedServerTotal(0);
    setCompletedServerTotalPages(1);
    fetchTickets();
  }, [fetchTickets]);

  // Server-side fetch for จบงาน tab: trigger when tab active or filters/page change
  const completedServerPageRef = useRef(1);
  useEffect(() => {
    if (filterJobStatus !== 'จบงาน' || !activeGroupId) return;
    completedServerPageRef.current = completedServerPage;
    fetchCompletedTickets(completedServerPage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterJobStatus, activeGroupId, completedServerPage]);

  // Reset completedServerPage to 1 when filters or group changes
  useEffect(() => {
    setCompletedServerPage(1);
    setIsCompletedLoaded(false);
  }, [search, filterCategory, filterStartDate, filterEndDate, filterOperator, activeGroupId, itemsPerPage]);

  // Poll meta every 15s (lightweight), pause when tab hidden, fetch full data only on change
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') pollMeta();
    }, 15000);

    const onVisible = () => { if (document.visibilityState === 'visible') pollMeta(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMeta]);

  // ==== [FIX-20260728-REALTIME-SCALE] START — เพิ่มใหม่ (เดิมไม่มี)
  // ปัญหา: WS event ที่มาถี่ๆ (ลูกค้าพิมพ์สั้นๆ ติดกันหลายข้อความ) ทำให้เรียก
  // fetchTickets(true) รัวตามไปด้วย ที่ 50-80 admin × 100 OA คือตัวคูณที่หนัก
  // มาก เพราะ fetchTickets ดึงทั้งกลุ่ม (limit:'all') = 7 query ต่อครั้ง
  //
  // ⚠️ จงใจ "ไม่แตะสูตร query / การนับ" เลย — fetchTickets, pollMeta, meta.total,
  //    badge count ทั้งหมดคงเดิม 100% ตัวเลขที่นับถูกอยู่แล้วจะไม่เพี้ยน
  //    (เคยพิจารณาวิธี patch ทีละ ticket จาก GET /api/tickets/:id แล้ว แต่
  //     ทิ้งไปเพราะจะทำให้ totalTickets/badge เพี้ยนทันที — meta ไม่ได้อัปเดตตาม)
  //
  // สิ่งที่ทำ 2 ชั้น:
  //   (1) debounce — event ที่มาติดๆ กันภายใน REALTIME_REFETCH_DEBOUNCE_MS
  //       ยุบเหลือทำงานครั้งเดียวหลัง event สุดท้ายนิ่ง
  //   (2) single-ticket patch — แทนที่จะ fetchTickets(true) ดึงทั้งกลุ่ม
  //       (7 query, payload หลักร้อย-พันใบ) เปลี่ยนเป็นดึง "ตั๋วใบเดียวที่เปลี่ยน"
  //       ผ่าน GET /api/tickets/:id (1 query, 1 ใบ) แล้ว patch เข้า state
  //
  // ⚠️ ตัวเลขทุกตัวยังมาจากที่เดิมและเท่าเดิม — ยืนยันด้วยเทสจริงบน DB แล้ว
  //    (legacy-api/scratch_test_ticket_counts.js 25/25 เทียบทุกแท็บ ทุก filter):
  //    · badge "รอรับงาน"/"กำลังดำเนินงาน" นับจาก activeTickets array ตรงๆ
  //      → patch ให้ array ถูก ตัวเลขก็ถูกอัตโนมัติ
  //    · badge "จบงาน" = totalTickets - activeTickets.length ซึ่ง totalTickets
  //      มาจาก meta.total (API) → จึงยิง refreshMeta() ควบคู่เสมอ ใช้ endpoint
  //      getTicketMetaByGroup/getTicketMeta ตัวเดียวกับที่ pollMeta ใช้อยู่แล้ว
  //      **ไม่ได้คำนวณเองฝั่ง FE และไม่ได้แตะสูตร query ฝั่ง BE เลย**
  //    · ถ้าดึงตั๋วใบเดียวไม่สำเร็จ → fallback ไป fetchTickets(true) แบบเดิม
  //      ข้อมูลจึงไม่มีทางค้าง
  //
  // revert: ลบทั้งบล็อก START/END นี้ แล้วเปลี่ยน useTicketWS ด้านล่างกลับไป
  //         เรียก fetchTickets(true) ตรงๆ ตามเดิม (ดูคอมเมนต์ในนั้นประกอบ)
  const REALTIME_REFETCH_DEBOUNCE_MS = 800;
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTicketIdsRef = useRef<Set<string>>(new Set());

  // ดึง meta ใหม่จาก endpoint เดิม (ตัวเดียวกับ pollMeta) เพื่อให้ totalTickets
  // ยังมาจาก API เหมือนเดิม ไม่ใช่การบวก/ลบเอาเองฝั่ง FE
  const refreshMeta = useCallback(async () => {
    try {
      let meta: any = null;
      if (activeGroupId) {
        meta = await ticketService.getTicketMetaByGroup(activeGroupId).catch(() => null);
        if (!meta && activeHookId) {
          meta = await ticketService.getTicketMeta(activeHookId).catch(() => null);
        }
      } else if (activeHookId) {
        meta = await ticketService.getTicketMeta(activeHookId).catch(() => null);
      }
      if (meta?.success) {
        lastMetaRef.current = { total: meta.total, last_updated: meta.last_updated ?? null };
        setTotalTickets(meta.total);
      }
    } catch {
      // เงียบไว้ — meta พลาดไม่ควรทำให้ patch ทั้งก้อนล้ม
    }
  }, [activeGroupId, activeHookId]);

  const flushTicketPatches = useCallback(async () => {
    const ids: string[] = Array.from(pendingTicketIdsRef.current);
    pendingTicketIdsRef.current.clear();
    if (ids.length === 0) return;

    try {
      const fetched = await Promise.all(ids.map(id => ticketService.getTicketById(id).catch(() => null)));
      const usable = fetched.filter((t): t is TicketEntry => !!t);
      // ดึงไม่ได้สักใบ → ถอยไปใช้ทางเดิมทั้งก้อน ไม่ปล่อยให้ข้อมูลค้าง
      if (usable.length !== ids.length) {
        fetchTickets(true);
        return;
      }

      setActiveTickets(prev => {
        let next = prev;
        for (const t of usable) {
          // สิทธิ์ OA — เงื่อนไขเดียวกับที่ fetchTickets กรองไว้
          const hookIdStr = (t.line_oa_hook_id || t.hook_id)?.toString();
          if (userAllowedHooksSet && hookIdStr && !userAllowedHooksSet.has(hookIdStr)) continue;

          const idx = next.findIndex(x => x._id === t._id);
          // activeTickets เก็บเฉพาะ job_status 0/1 (ตรงกับ fetchTickets ที่ยิง
          // job_status:'0,1') — ตั๋วที่ถูกปิดต้องหลุดออกจาก array นี้
          const belongsHere = t.job_status === 0 || t.job_status === 1;
          if (!belongsHere) {
            if (idx !== -1) next = next.filter((_, i) => i !== idx);
            continue;
          }
          if (idx === -1) {
            next = [t, ...next];
          } else {
            // getTicketById ไม่ populate customer_tags (list endpoint เติมแยก)
            // จึงคงค่าเดิมไว้ ไม่ทับด้วย undefined
            const merged = { ...t, customer_tags: t.customer_tags ?? next[idx].customer_tags };
            next = next.map((x, i) => (i === idx ? merged : x));
          }
        }
        return next;
      });

      await refreshMeta();
    } catch {
      fetchTickets(true);
    }
  }, [fetchTickets, refreshMeta, userAllowedHooksSet]);

  const scheduleTicketPatch = useCallback((ticketId?: string) => {
    // ไม่มี ticket id ใน payload → ไม่รู้จะ patch ใบไหน ใช้ทางเดิม
    if (!ticketId) {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        fetchTickets(true);
      }, REALTIME_REFETCH_DEBOUNCE_MS);
      return;
    }
    pendingTicketIdsRef.current.add(ticketId);
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      flushTicketPatches();
    }, REALTIME_REFETCH_DEBOUNCE_MS);
  }, [fetchTickets, flushTicketPatches]);

  // กัน timer ค้างตอน unmount (เปลี่ยนหน้า/ปิดแท็บ)
  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, []);
  // ==== [FIX-20260728-REALTIME-SCALE] END

  // WebSocket: instant update — only refresh if event belongs to allowed OA / active hook in active group
  useTicketWS((event) => {
    if (event.type === 'ticket:new' || event.type === 'ticket:updated') {
      const eventHookId = (event.data as any)?.hook_id?.toString();
      // [FIX-20260728-REALTIME-SCALE] เดิม: `if (!eventHookId) { fetchTickets(true); }`
      // ไม่มี hook_id = ไม่รู้ว่า event นี้เป็นของ OA ไหน ของเดิม refetch ให้ทุกคน
      // ไม่สนกลุ่ม → admin ที่ดูแลคนละกลุ่มก็โดนลากมา refetch ด้วย (fan-out ข้ามกลุ่ม)
      // ตอนนี้ payload ทุกตัวมี hook_id ครบ (BE guard ไว้แล้วใน wsPublisher) จึงยังไม่
      // เคยระเบิด — แต่กันไว้ถ้ามี event type ใหม่ในอนาคตที่ลืมใส่
      // revert: เปลี่ยน 2 บรรทัดนี้กลับเป็น fetchTickets(true)
      if (!eventHookId) {
        console.warn('[TicketSupport] WS event ไม่มี hook_id — ข้าม refetch (กัน fan-out ข้ามกลุ่ม)', event.type);
        return;
      }
      if (activeGroupHookIds.includes(eventHookId)) {
        // [FIX-20260728-REALTIME-SCALE] เดิม: fetchTickets(true) ตรงๆ ทุก event
        // ตอนนี้ debounce + patch เฉพาะตั๋วใบที่เปลี่ยน (มี fallback ในตัว)
        scheduleTicketPatch((event.data as any)?._id?.toString());
      }
    }
    /* [FEAT-20260819-MSGALERT] a customer wrote in → +1 on that card's number,
       and the card rises in the lists that sort by latest activity. NO refetch is
       fired and NO field on the ticket row is touched — the reorder is a local
       hint only (see `markMessageAt` / `activityAt` in services/chat/ticketAlerts).
       The sound and the toast are handled once, app-wide, in App.tsx —
       deliberately NOT here, or having this page open would fire a second beep.
       ไม่ยิง refetch ไม่แตะแถว ticket. */
    if (event.type === 'message:new') {
      const msgHookId = (event.data as any)?.hook_id?.toString();
      // Same group scope as above: another admin's OA must not touch this list.
      if (!msgHookId || !activeGroupHookIds.includes(msgHookId)) return;
      const key = inboundMessageKey(event as any);
      if (!key) return;
      setLastMsgAtByUser((prev) => markMessageAt(prev, key, Number(event.ts) || Date.now()));
      /* EVERY inbound message counts, including one for the chat that happens to
         be open. An earlier version skipped the open chat ("you are reading it
         anyway") — that was never asked for, and it made the number look broken:
         the card the owner was testing on was exactly the open one, so it never
         showed a number. The only clearing rule is the one that WAS asked for —
         opening a chat zeroes that card. นับทุกข้อความ · ล้างตอนกดเปิดแชทเท่านั้น. */
      setUnreadByUser((prev) => bumpUnread(prev, key));
    }
  });

  // Reset page when search, filters, or items per page change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterStartDate, filterEndDate, filterCustomer, filterCategory, filterChatStatus, filterJobStatus, filterOperator, activeGroupId, itemsPerPage]);

  // Countdown hooks disabled as requested: allow immediate user confirmation
  useEffect(() => {
    setActionCountdown(0);
  }, [confirmActionModal.isOpen]);

  useEffect(() => {
    setAssignCountdown(0);
    if (!operatorEditModal.isOpen) {
      setIsAssigneeDropdownOpen(false);
    }
  }, [operatorEditModal.isOpen]);

  // Ticket taken modal — show modal without countdown timer
  useEffect(() => {
    if (!ticketTakenModal) return;
  }, [ticketTakenModal]);

  // Default to 'รอรับงาน' tab whenever entering compact view
  useEffect(() => {
    if (isCompactView) {
      setFilterJobStatus('รอรับงาน');
    }
  }, [isCompactView]);

  const handleCopy = (text: string, id: string, field: string) => {
    if (!text || text === "N/A" || text === "-(ไม่ได้ลงทะเบียน)-") return;
    /* [FIX-20260830-COPYHTTP2] `navigator.clipboard` is UNDEFINED on http, so
       `.writeText` threw before a promise existed — this `.then` never ran and the
       click handler threw instead. copyText always returns a promise and reports
       the real result. */
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopiedId({ id, field });
      setToastVisible(true);
      const timer1 = setTimeout(() => setCopiedId(null), 1500);
      const timer2 = setTimeout(() => setToastVisible(false), 2000);
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
      };
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  };

  // Open confirmation modal instead of immediate update
  const triggerJobAction = (ticket: TicketEntry, nextStatus: number) => {
    setConfirmActionModal({
      isOpen: true,
      ticket,
      targetStatus: nextStatus
    });
  };

  const executeJobAction = async () => {
    const { ticket, targetStatus } = confirmActionModal;
    if (!ticket) return;

    if (actionInProgress) return;
    setActionInProgress(true);

    const payload: any = { job_status: targetStatus, chat_status: 'admin' };
    if (targetStatus === 1) {
      payload.admin_user_id = currentUserDetail?.id || null;
      payload.assigned_at = new Date();
      /* [FIX-20260830-CLAIMRACEGUARD] ส่ง "เจ้าของที่เห็นบนจอตอนกด" ไปเป็นเงื่อนไข
         ═══════════════════════════════════════════════════════════════════════
         BE มี guard ฝั่งตัวเองอยู่แล้ว แต่มันรู้ได้แค่ "ตอนนี้ DB ว่างไหม" ไม่ใช่
         "ผู้กดเห็นอะไร" ⇒ ถ้ารายการบนจอ**ค้าง** (คนอื่นรับไปแล้วแต่ยังไม่ refresh)
         คำขอนี้จะกลายเป็น "โอนเคส" ในสายตา BE แล้วแย่งเคสจากเจ้าของใหม่เงียบ ๆ
         การส่งค่านี้ปิดช่องนั้น เพราะเงื่อนไขถูก AND เข้าไปในคำสั่งเขียนเดียวกัน

         ⚠️ ส่ง **เฉพาะตอนที่จอบอกว่ายังว่าง** (`''`) — ถ้าตั๋วมีเจ้าของอยู่แล้ว
            ไม่ส่งเลย เพื่อไม่ให้เส้น "โอนเคส" ได้ guard ใหม่ที่ไม่เคยมี
            (เจ้าของสั่ง seamless · และเป็นเส้นที่พังจริงเมื่อ 24/08) */
      if (!ticket.admin_user_id) payload.expected_admin_user_id = '';
    } else if (targetStatus === 2) {
      payload.resolved_at = new Date();
    }

    // — Optimistic update — ปิด modal + แสดงผลทันที ก่อน API ตอบ
    const prevActive = activeTickets;
    const prevCompleted = completedTickets;

    if (targetStatus === 1) {
      setActiveTickets(prev => prev.map(t => t._id === ticket._id ? { ...t, ...payload } : t));
    } else if (targetStatus === 2) {
      setActiveTickets(prev => prev.filter(t => t._id !== ticket._id));
      if (isCompletedLoaded) {
        setCompletedTickets(prev => {
          const exists = prev.some(t => t._id === ticket._id);
          if (exists) {
            return prev.map(t => t._id === ticket._id ? { ...t, ...payload } : t);
          } else {
            return [{ ...ticket, ...payload }, ...prev];
          }
        });
      }
    }

    setConfirmActionModal({ isOpen: false, ticket: null, targetStatus: 1 });
    if (targetStatus === 1) {
      setFilterJobStatus('กำลังดำเนินงาน');
    } else if (targetStatus === 2) {
      setFilterJobStatus('จบงาน');
    }

    try {
      const hookId = ticket.line_oa_hook_id || 'all';
      const [updateRes, rooms] = await Promise.all([
        ticketService.updateTicketMinimal(ticket._id, payload),
        chatService.listRooms(hookId).catch(() => [] as any[]),
      ]);

      if (updateRes && (updateRes as any).success === false) {
        // rollback
        setActiveTickets(prevActive);
        setCompletedTickets(prevCompleted);
        const errMsg = (updateRes as any).error || '';
        if (errMsg === 'Ticket already accepted') {
          setTicketTakenModal(true);
        } else {
          setAlertState({ isOpen: true, title: translateNow('pageui.support.error_title', 'เกิดข้อผิดพลาด'), message: errMsg, type: 'error' });
        }
        fetchTickets(true);
        return;
      }

      const targetUserId = ticket.line_user_data?.line_user_id || ticket.line_user_id;
      const targetUserMongoId = ticket.line_user_data?._id || ticket.line_user_id;

      const matchingRoom = rooms.find((r: any) => {
        const uData = r.user_data as any;
        const roomLineUserId = r.line_user_id || uData?.line_user_id;
        return ((ticket as any).chat_room_id && r._id === (ticket as any).chat_room_id) ||
          r._id === targetUserMongoId ||
          (roomLineUserId && targetUserId && roomLineUserId === targetUserId) ||
          (uData?._id && targetUserMongoId && uData._id === targetUserMongoId);
      });
      const targetRoom = matchingRoom || {
        _id: (ticket as any).chat_room_id || ticket.line_user_id,
        line_user_id: targetUserId,
        hook_id: ticket.line_oa_hook_id,
        user_data: ticket.line_user_data,
        assist_status: true,
      };

      if (matchingRoom?._id) {
        await Promise.all([
          assignHistoryService.createAssignHistory({
            ticket_id: ticket._id,
            chat_room_id: matchingRoom._id,
            assign_to: targetStatus === 1 ? (currentUserDetail?.id || null) : (ticket.admin_user_id || null),
            changed_by_id: currentUserDetail?.id || '',
            action: targetStatus === 1 ? 'accept' : 'close',
          }),
          chatService.updateAssistStatus(matchingRoom._id, targetStatus === 1),
        ]);
      }

      if (targetStatus === 1) {
        setInstantChatTarget({
          room: targetRoom,
          ticket: ticket,
          hookId: ticket.line_oa_hook_id,
          isExpanded: false,
          isCollapsed: false,
        });
      }

      fetchTickets(true);
      if (targetStatus === 2 && isCompletedLoaded) {
        // [FIX-20260801-HOOKTYPES] เดิมส่ง true ทั้งที่พารามิเตอร์คือ "เลขหน้า" (page = 1)
        // น่าจะลอกมาจาก fetchTickets(true) ที่พารามิเตอร์เป็น silent — คนละความหมาย
        // ผลคือยิง query ด้วย page=true · ตั้งใจแค่ "โหลดรายการเคสที่ปิดแล้วใหม่" = หน้า 1
        fetchCompletedTickets(1);
      }
    } catch (e) {
      // rollback on network error
      setActiveTickets(prevActive);
      setCompletedTickets(prevCompleted);
      /* [FIX-20260830-CLAIMRACEGUARD] "ถูกแย่งเคส" ไม่ใช่ "บันทึกไม่สำเร็จ"
         ═══════════════════════════════════════════════════════════════════
         🔴 กล่อง `ticketTakenModal` (พร้อมปุ่ม "รีเฟรชทันที") มีอยู่ในไฟล์นี้
            มาตลอด แต่ **เปิดไม่ได้เลย**: จุดเดียวที่สั่งเปิดคือสาขา
            `updateRes.success === false` ข้างบน ซึ่งไปไม่ถึง เพราะ
            `handleApiResponse` (services/apiClient.ts:55-57) **throw ทันที**
            เมื่อ `!response.ok` ⇒ 409 ไม่เคยกลายเป็น `updateRes` ⇒ สาขานั้นตาย
            ⇒ ของจริงตกมาที่ catch นี้ แล้วขึ้น "ไม่สามารถบันทึกได้ กรุณาลองใหม่"
            ซึ่ง **ชวนให้กดซ้ำ** ทั้งที่เคสถูกคนอื่นรับไปแล้ว กดกี่ครั้งก็ไม่ได้

         BE ส่ง 409 พร้อมข้อความคงที่ (tickets.service.ts `[FIX-20260823-CLAIMCAS]`
         / `[FIX-20260830-CLAIMRACEGUARD]`) — แยกด้วยข้อความ ไม่ใช่ status
         เพราะ 409 ใช้ทั้ง "ถูกแย่ง" และ "ถูกปิด" ซึ่งคนละการกระทำบนหน้าจอ
         ⚠️ regex ต้องตรงกับ TicketChat.tsx:1090 — ข้อความฝั่ง BE ถูกตรึงด้วย
            golden suite ห้ามเปลี่ยนคำ */
      /* ⚠️ จับ **เฉพาะข้อความไทยของการถูกแย่ง** — ห้ามใส่ `already accepted` เข้ามา
         `'Ticket already accepted'` เป็น 409 คนละเรื่องที่มีมาก่อนแล้ว
         (`tickets.service.ts:1573-1581`) ซึ่งเด้งตอน **เจ้าของคนเดิม** ถูก assign ซ้ำ
         บนตั๋วที่รับไปแล้ว ⇒ ถ้าจับด้วยจะขึ้นกล่อง "มีแอดมินท่านอื่นรับไปแล้ว"
         ทั้งที่ไม่มีใครแย่ง = โกหกผู้ใช้ */
      const msg = (e as any)?.message || '';
      if (/ถูกรับไปแล้วโดยแอดมินท่านอื่น/.test(msg)) {
        setTicketTakenModal(true);   // กล่องเดียว ปุ่มเดียว = รีเฟรชทันที
      } else {
        console.error('Failed to update job status:', e);
        setAlertState({ isOpen: true, title: translateNow('pageui.support.error_title', 'เกิดข้อผิดพลาด'), message: translateNow('pageui.support.save_failed_retry', 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'), type: 'error' });
      }
    } finally {
      setActionInProgress(false);
    }
  };

  const handleCompactCardClick = (ticket: any) => {
    const jobStatusNum = Number(ticket.job_status);
    if (jobStatusNum === 0 || ticket.job_status === undefined || ticket.job_status === null) {
      // Unassigned ticket: open Confirm Accept Job Modal -> once confirmed, opens chat room
      triggerJobAction(ticket, 1);
    } else {
      // Already accepted or completed ticket: open chat room directly
      const hookId = ticket.line_oa_hook_id || 'all';
      chatService.listRooms(hookId).then((rooms: any[]) => {
        const targetUserId = ticket.line_user_data?.line_user_id || ticket.line_user_id;
        const targetUserMongoId = ticket.line_user_data?._id || ticket.line_user_id;
        const matchingRoom = rooms.find((r: any) => {
          const uData = r.user_data as any;
          const roomLineUserId = r.line_user_id || uData?.line_user_id;
          return (ticket.chat_room_id && r._id === ticket.chat_room_id) ||
            r._id === targetUserMongoId ||
            (roomLineUserId && targetUserId && roomLineUserId === targetUserId) ||
            (uData?._id && targetUserMongoId && uData._id === targetUserMongoId);
        });
        const targetRoom = matchingRoom || {
          _id: ticket.chat_room_id || ticket.line_user_id,
          line_user_id: targetUserId,
          hook_id: ticket.line_oa_hook_id,
          user_data: ticket.line_user_data,
          assist_status: true,
        };
        setInstantChatTarget({
          room: targetRoom,
          ticket: ticket,
          hookId: ticket.line_oa_hook_id,
          isExpanded: false,
          isCollapsed: false,
        });
      }).catch(() => {
        const targetUserId = ticket.line_user_data?.line_user_id || ticket.line_user_id;
        const targetRoom = {
          _id: ticket.chat_room_id || ticket.line_user_id,
          line_user_id: targetUserId,
          hook_id: ticket.line_oa_hook_id,
          user_data: ticket.line_user_data,
          assist_status: true,
        };
        setInstantChatTarget({
          room: targetRoom,
          ticket: ticket,
          hookId: ticket.line_oa_hook_id,
          isExpanded: false,
          isCollapsed: false,
        });
      });
    }
  };

  const handleOperatorChange = async () => {
    const ticket = operatorEditModal.ticket;
    if (!ticket || !selectedOperatorId) return;

    setLoading(true);
    try {
      const nextJobStatus = ticket.job_status === 0 ? 1 : ticket.job_status;
      const payload: any = {
        admin_user_id: selectedOperatorId,
        job_status: nextJobStatus
      };

      /* [FIX-20260830-CLAIMRACEGUARD] เหตุผลเดียวกับ executeJobAction ข้างบน —
         ส่งเงื่อนไข "จอเห็นว่ายังว่าง" เฉพาะตอนตั๋วยังไม่มีเจ้าของ
         ⇒ เส้น "เปลี่ยนผู้ทำรายการ" ของตั๋วที่มีเจ้าของแล้ว ไม่ถูกแตะเลย */
      if (!ticket.admin_user_id) payload.expected_admin_user_id = '';

      if (nextJobStatus === 1 && !ticket.assigned_at) {
        payload.assigned_at = new Date();
        payload.chat_status = 'admin';
      }

      await ticketService.updateTicket(ticket._id, payload);

      // Find Chat Room ID
      let chatRoomId = '';
      try {
        const hookId = ticket.line_oa_hook_id || 'all';
        const rooms = await chatService.listRooms(hookId);
        const matchingRoom = rooms.find(
          r => {
            const uData = r.user_data as any;
            return uData?._id === ticket.line_user_id || uData?.id === ticket.line_user_id || r.line_user_id === ticket.line_user_data?.line_user_id;
          }
        );
        if (matchingRoom) {
          chatRoomId = matchingRoom._id;
        }
      } catch (err) {
        console.error('Failed to resolve chat room ID:', err);
      }

      if (chatRoomId) {
        // Log history with action: 'edit'
        await assignHistoryService.createAssignHistory({
          ticket_id: ticket._id,
          chat_room_id: chatRoomId,
          assign_to: selectedOperatorId,
          changed_by_id: currentUserDetail?.id || '',
          action: 'edit'
        });

        // Set assist status to true
        await chatService.updateAssistStatus(chatRoomId, true);
      }

      setOperatorEditModal({ isOpen: false, ticket: null });
      setFilterJobStatus('กำลังดำเนินงาน');

      const assignedUser = allUsers.find(u => u.id === selectedOperatorId);
      const assignedName = assignedUser ? (assignedUser.display_name || assignedUser.username) : translateNow('pageui.support.staff', 'เจ้าหน้าที่');
      setAlertState({
        isOpen: true,
        title: translateNow('pageui.support.assign_ok_title', 'มอบหมายผู้ดูแลสำเร็จ'),
        message: translateNow('pageui.support.assign_ok_msg', 'มอบหมายงานให้ {name} เรียบร้อยแล้ว', { name: assignedName }),
        type: 'success'
      });

      await fetchTickets();
    } catch (e) {
      /* [FIX-20260830-CLAIMRACEGUARD] เดิม catch นี้ **กลืนเงียบ**: 409 ตกมาที่นี่
         แล้วมีแค่ console.error ⇒ modal ค้างเปิด ไม่มีข้อความ ไม่มีอะไรเปลี่ยน
         แอดมินไม่รู้เลยว่าการมอบหมายไม่สำเร็จ (เห็นแค่ปุ่มหยุดหมุน)
         ตอนนี้: ถูกแย่ง → ปิด modal แล้วขึ้นกล่อง "รีเฟรชทันที" · อื่น ๆ → บอกตามจริง */
      /* ⚠️ เส้นที่ไม่ใช่ "ถูกแย่ง" ต้องเหมือนเดิม **ทุกตัวอักษร** — คือ console.error เฉย ๆ
         เคยลองเพิ่ม alert ให้ตรงนี้แล้วถอดออก เพราะมันเปลี่ยนพฤติกรรมของเส้นที่
         ไม่เกี่ยวกับงานนี้ (เจ้าของสั่ง seamless) · การกลืนเงียบของเดิมเป็นหนี้ที่มีอยู่ก่อน
         ถ้าจะแก้ต้องเป็นงาน/commit ของตัวเอง
         ⚠️ regex จับเฉพาะข้อความไทย เหตุผลเดียวกับ executeJobAction ข้างบน */
      const msg = (e as any)?.message || '';
      if (/ถูกรับไปแล้วโดยแอดมินท่านอื่น/.test(msg)) {
        setOperatorEditModal({ isOpen: false, ticket: null });
        setTicketTakenModal(true);
      } else {
        console.error('Failed to assign operator:', e);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key: 'category' | 'chat_status' | 'job_status' | 'created_at') => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // Get user role hierarchical power
  const getRoleLevel = (roleName?: string) => {
    if (!roleName) return 1;
    const name = roleName.toLowerCase();
    if (name === 'superadmin') return 3;
    if (name === 'admin') return 2;
    return 1;
  };

  const canEditAssignee = (row: TicketEntry) => {
    // ต้องเป็น record ที่รับงานแล้ว (job_status === 1) เท่านั้น
    if (row.job_status !== 1) return false;
    if (!currentUserDetail) return false;

    const roleName = (currentUserDetail.role?.name || '').toLowerCase();
    // admin และ superadmin เปลี่ยนของใครก็ได้
    if (roleName === 'superadmin' || roleName === 'admin') return true;

    // ระดับอื่น เปลี่ยนได้เฉพาะงานของตนเอง
    return row.admin_user_id === currentUserDetail.id;
  };

  const canCloseJob = (row: TicketEntry) => {
    if (!currentUserDetail) return false;
    const roleName = (currentUserDetail.role?.name || '').toLowerCase();

    // ระดับ super จบงานใครก็ได้
    if (roleName === 'superadmin') return true;

    // ระดับอื่น จบงานได้เฉพาะงานของตนเอง
    const adminId = row.admin_user_id || row.admin_user_data?.id || row.admin_user_data?._id;
    const currentId = currentUserDetail.id || currentUserDetail._id;
    if (!adminId || !currentId) return false;
    return String(adminId) === String(currentId);
  };

  // Filter eligible operators based on hierarchy and sector group matching (pre-filtered by backend list-for-assign endpoint)
  const eligibleOperators = useMemo(() => {
    return allUsers;
  }, [allUsers]);

  const filteredOperators = useMemo(() => {
    if (!assigneeSearchQuery.trim()) return eligibleOperators;
    const q = assigneeSearchQuery.toLowerCase();
    return eligibleOperators.filter(u => 
      (u.username || '').toLowerCase().includes(q) ||
      (u.display_name || '').toLowerCase().includes(q)
    );
  }, [eligibleOperators, assigneeSearchQuery]);

  // Filter & Sort & Paginate data
  const processedTickets = useMemo(() => {
    // จบงาน tab: data is already filtered/paginated by server — return as-is (only sort)
    if (filterJobStatus === 'จบงาน') {
      // Backend already sorted by updated_at DESC, no further processing needed
      return [...completedTickets];
    }

    // 1. Select the base list based on tab (active tabs only below)
    let result = [...activeTickets];

    // 2. Search (display_name, nickname, line_user_id, full_name, phone, contract)
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(ticket => {
        const displayName = ticket.line_user_data?.display_name || '';
        const nickname = ticket.line_user_data?.nickname || '';
        const lineUserId = ticket.line_user_data?.line_user_id || '';
        const fullName = ticket.line_user_data?.full_name || '';
        const phone = ticket.line_user_data?.phone_number || '';
        const contract = ticket.line_user_data?.contract_code || '';
        const detail = ticket.line_user_data?.detail || '';

        return displayName.toLowerCase().includes(q) ||
          nickname.toLowerCase().includes(q) ||
          lineUserId.toLowerCase().includes(q) ||
          fullName.toLowerCase().includes(q) ||
          phone.toLowerCase().includes(q) ||
          contract.toLowerCase().includes(q) ||
          detail.toLowerCase().includes(q);
      });
    }

    // 2.5 Date-Time range filter
    if (filterStartDate || filterEndDate) {
      let startVal = filterStartDate ? new Date(filterStartDate).getTime() : null;
      let endVal = filterEndDate ? new Date(filterEndDate).getTime() : null;

      // Swap start/end if start is greater than end
      if (startVal && endVal && startVal > endVal) {
        const temp = startVal;
        startVal = endVal;
        endVal = temp;
      }

      result = result.filter(ticket => {
        const ticketTime = ticket.created_at ? new Date(ticket.created_at).getTime() : null;
        if (!ticketTime) return false;
        if (startVal && ticketTime < startVal) return false;
        if (endVal && ticketTime > endVal) return false;
        return true;
      });
    }

    // 3. Customer Type
    if (filterCustomer === 'ลงทะเบียน') {
      result = result.filter(ticket => ticket.line_user_data?.full_name);
    } else if (filterCustomer === 'ไม่ลงทะเบียน') {
      result = result.filter(ticket => !ticket.line_user_data?.full_name);
    }

    // 4. Category — matcher comes from the active category set (flag-driven),
    // so the filter always agrees with the dropdown options.
    if (filterCategory !== 'ทั้งหมด') {
      const opt = categoryOptions.find(o => o.label === filterCategory);
      result = result.filter(ticket =>
        opt ? opt.match(ticket.category) : ticket.category === filterCategory
      );
    }

    // 5. Chat Status (Bot -> job_status === 0, Admin -> job_status !== 0)
    if (filterChatStatus !== 'ทั้งหมด') {
      if (filterChatStatus === 'บอทตอบ') {
        result = result.filter(ticket => ticket.job_status === 0);
      } else if (filterChatStatus === 'แอดมินตอบ') {
        result = result.filter(ticket => ticket.job_status !== 0);
      }
    }

    // 6. Job Status
    const statusValue = filterJobStatus === 'รอรับงาน' ? 0 : filterJobStatus === 'กำลังดำเนินงาน' ? 1 : 2;
    result = result.filter(ticket => ticket.job_status === statusValue);

    // 7. Operator
    if (filterOperator !== 'ทั้งหมด') {
      if (filterOperator === '-') {
        result = result.filter(ticket => !ticket.admin_user_data);
      } else {
        result = result.filter(ticket => 
          ticket.admin_user_data && 
          (ticket.admin_user_data.display_name === filterOperator || ticket.admin_user_data.username === filterOperator)
        );
      }
    }

    // 8. Sorting
    /* [FEAT-20260819-MSGALERT] a row's time, raised by the moment its customer
       last wrote in this session. With no message the map is empty and every list
       below is ordered exactly as it was before this feature existed.
       ไม่มีข้อความเข้า = ลำดับเหมือนเดิมเป๊ะ. */
    const liveActivity = (t: TicketEntry, rowTime: number): number =>
      activityAt(rowTime, lastMsgAtByUser[t.line_user_data?.line_user_id || '']);
    if (sortKey) {
      result.sort((a, b) => {
        if (sortKey === 'created_at') {
          /* [FEAT-20260819-MSGALERT] a job_status===0 row is the WAITING QUEUE and
             stays strictly on created_at — first in, first served; a live message
             must not let one customer jump the queue by writing again. Only rows
             already being worked on, which this code ALREADY orders by last
             activity (updated_at), are raised by a new message.
             คิวรอรับงานยังเรียงตามเวลาเข้า ไม่ให้แซงคิวด้วยการทักซ้ำ.
             To include the queue too, wrap both branches in liveActivity(). */
          const timeA = a.job_status === 0 
            ? (a.created_at ? new Date(a.created_at).getTime() : 0)
            : liveActivity(a, a.updated_at ? new Date(a.updated_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0));
          const timeB = b.job_status === 0
            ? (b.created_at ? new Date(b.created_at).getTime() : 0)
            : liveActivity(b, b.updated_at ? new Date(b.updated_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0));
          
          if (timeA < timeB) return sortAsc ? -1 : 1;
          if (timeA > timeB) return sortAsc ? 1 : -1;
          return 0;
        }

        const valA = a[sortKey] ?? '';
        const valB = b[sortKey] ?? '';
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        
        // Secondary sort: created_at descending (newest first)
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
    } else {
      // Default sort
      if (filterJobStatus === 'กำลังดำเนินงาน' || filterJobStatus === 'จบงาน') {
        result.sort((a, b) => {
          // [FEAT-20260819-MSGALERT] same rule — these tabs already mean "most
          // recent activity first", so a live message counts as activity.
          const dateA = liveActivity(a, a.updated_at ? new Date(a.updated_at).getTime() : 0);
          const dateB = liveActivity(b, b.updated_at ? new Date(b.updated_at).getTime() : 0);
          return dateB - dateA;
        });
      } else {
        // Default sort for "รอรับงาน" tab: created_at descending (newest first)
        result.sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        });
      }
    }

    return result;
  }, [activeTickets, completedTickets, activeHookId, search, filterStartDate, filterEndDate, filterCustomer, filterCategory, filterChatStatus, filterJobStatus, filterOperator, sortKey, sortAsc, lastMsgAtByUser]);

  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [revealedGroups, setRevealedGroups] = useState<Set<string>>(new Set());
  const [childPages, setChildPages] = useState<Record<string, number>>({});
  const [childLimit, setChildLimit] = useState(10);
  const toggleRevealGroup = (key: string) => setRevealedGroups(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const getChildPage = (key: string) => childPages[key] || 1;
  const setChildPage = (key: string, page: number) => setChildPages(prev => ({ ...prev, [key]: page }));

  // Group tickets by (user_id + hook_id)
  const userGroupKey = (t: TicketEntry) => {
    const userId = t.line_user_id || t.line_user_data?.line_user_id || (t as any).chat_user_id || 'unknown';
    const hookId = t.line_oa_hook_id || t.hook_id || 'all';
    return `${userId}_${hookId}`;
  };

  const groupedTickets = useMemo(() => {
    const map = new Map<string, TicketEntry[]>();
    for (const t of processedTickets) {
      const key = userGroupKey(t);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }

    const result: Array<{
      key: string;
      userId: string;
      hookId: string;
      latest: TicketEntry;
      tickets: TicketEntry[];
    }> = [];

    map.forEach((tickets, key) => {
      // Sort tickets inside group by updated_at / created_at DESC (newest first)
      tickets.sort((a, b) => {
        const timeA = a.updated_at ? new Date(a.updated_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
        const timeB = b.updated_at ? new Date(b.updated_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
        return timeB - timeA;
      });

      const parts = key.split('_');
      result.push({
        key,
        userId: parts[0],
        hookId: parts[1] || 'all',
        latest: tickets[0],
        tickets,
      });
    });

    // Sort groups by latest ticket date DESC
    result.sort((a, b) => {
      const timeA = a.latest.updated_at ? new Date(a.latest.updated_at).getTime() : (a.latest.created_at ? new Date(a.latest.created_at).getTime() : 0);
      const timeB = b.latest.updated_at ? new Date(b.latest.updated_at).getTime() : (b.latest.created_at ? new Date(b.latest.created_at).getTime() : 0);
      return timeB - timeA;
    });

    return result;
  }, [processedTickets]);

  const isGroupedMode = filterJobStatus === 'จบงาน';

  const totalPages = isGroupedMode
    ? Math.ceil(groupedTickets.length / itemsPerPage) || 1
    : Math.ceil(processedTickets.length / itemsPerPage) || 1;

  const paginatedTickets = useMemo(() => {
    if (filterJobStatus === 'จบงาน') return processedTickets;
    const start = (currentPage - 1) * itemsPerPage;
    return processedTickets.slice(start, start + itemsPerPage);
  }, [processedTickets, currentPage, itemsPerPage, filterJobStatus]);

  const paginatedGroups = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return groupedTickets.slice(start, start + itemsPerPage);
  }, [groupedTickets, currentPage, itemsPerPage]);

  const CopyableCell = ({ text, id, field, classes = "" }: { text: string; id: string; field: string; classes?: string }) => {
    if (!text || text.trim() === "" || text.toUpperCase() === "N/A") {
      return null;
    }

    const isSpecialValue = text === "-(ไม่ได้ลงทะเบียน)-";
    const isCopied = copiedId?.id === id && copiedId?.field === field;

    if (isSpecialValue) {
      // the marker stays the value (compared above); only what is drawn translates
      return <span className={`${classes} text-slate-400 italic`}>{t('pageui.support.unregistered_marker', '-(ไม่ได้ลงทะเบียน)-')}</span>;
    }

    return (
      <div className="flex justify-between items-center group/cell max-w-full min-w-0">
        <span className={`${classes} text-slate-800 truncate`} title={text}>{text}</span>
        <button
          onClick={() => handleCopy(text, id, field)}
          className="ml-2 text-slate-400 hover:text-primary-600 transition-opacity p-0.5 focus:outline-none flex-shrink-0"
          title={t('pageui.support.copy_data', 'คัดลอกข้อมูล')}
        >
          {isCopied ? (
            <Check size={13} className="text-emerald-600 font-bold" />
          ) : (
            <Copy size={13} />
          )}
        </button>
      </div>
    );
  };

  const getCategoryBadge = (category: string | null) => {
    if (providerCats) return <TicketCategoryBadge category={category} categories={providerCats} />; // [FEAT-20261014-TICKETCATS]
    const displayCategory = category || 'Other';
    switch (displayCategory) {
      case "Collection":
      case "ค่างวด":
      case "ทวงถาม":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-800 border border-orange-200 shadow-sm whitespace-nowrap">{t('pageui.support.cat_collection', 'ทวงถาม')}</span>;
      case "IT":
      case "อุปกรณ์":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-sky-100 text-sky-800 border border-sky-200 shadow-sm whitespace-nowrap">{t('pageui.support.cat_device', 'อุปกรณ์')}</span>;
      case "Payment":
      case "รับยอด":
      case "แจ้งฝาก":
      case "ชำระค่างวด":
        // Same underlying category; the label follows the flag (legacy = ชำระค่างวด).
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-sm whitespace-nowrap">{acmeCategory ? t('pageui.support.cat_installment', 'ชำระค่างวด') : t('pageui.support.cat_deposit', 'แจ้งฝาก')}</span>;
      case "Loan":
      case "สินเชื่อ":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200 shadow-sm whitespace-nowrap">{t('pageui.support.cat_loan', 'สินเชื่อ')}</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 border border-purple-200 shadow-sm whitespace-nowrap">{t('pageui.support.cat_other', 'อื่นๆ')}</span>;
    }
  };

  const formatTicketTime = (dateStr?: string | null) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('th-TH', { 
        year: 'numeric',
        day: '2-digit', 
        month: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        calendar: 'gregory'
      });
    } catch {
      return dateStr;
    }
  };

  const formatUserWithDisplayName = (user: any, fallback: string) => {
    if (!user) return fallback;
    let userObj = user;
    if (typeof user === 'string') {
      const found = allUsers.find(u => u.id === user || (u as any)._id === user);
      if (found) userObj = found;
    }
    if (typeof userObj === 'string') return userObj;
    const username = userObj.username;
    const displayName = userObj.display_name;
    if (username && displayName && username !== displayName) {
      return `${username} (${displayName})`;
    }
    return username || displayName || fallback;
  };

  // line_user.detail is one string shaped "name|phone|contract". Positional, so
  // a missing middle part still has to hold its slot ("name||contract") or the
  // contract reads back as the phone. handleSaveEditModal re-joins in this order.
  const parseDetail = (raw: string) => {
    const parts = (raw || '').split('|');
return { detailName: parts[0] || '', detailPhone: parts[1] || '', detailContract: parts[2] || '' };
  };

  const handleSaveEditModal = async () => {
    const { ticket, nickname, detailName, detailPhone, detailContract } = editModal;
    if (!ticket?.line_user_data?._id) return;
    setSavingEdit(true);
    const detail = [detailName, detailPhone, detailContract].join('|').replace(/\|+$/, '');
    try {
      const origNickname = ticket.line_user_data.nickname || '';
      const origDetail = ticket.line_user_data.detail || '';
      const changedFields: { field: string; from: string; to: string }[] = [];

      if (nickname !== origNickname) {
        await ticketService.patchNickname(ticket.line_user_data._id, nickname);
        changedFields.push({ field: 'nickname', from: origNickname, to: nickname });
      }
      if (detail !== origDetail) {
        await ticketService.patchDetail(ticket.line_user_data._id, detail);
        changedFields.push({ field: 'detail', from: origDetail, to: detail });
      }

      if (changedFields.length > 0) {
        auditService.createHookAuditLog({
          ref_id: ticket.line_user_data._id,
          hook_id: ticket.line_oa_hook_id || undefined,
          parent: 'line_user',
          action: 'update',
          changed_fields: changedFields,
          note: `line_user_id: ${ticket.line_user_data.line_user_id}`
        }).catch(console.error);
      }

      const updateTicketUser = (prev: TicketEntry[]) => prev.map(t => t._id === ticket._id
        ? { ...t, line_user_data: t.line_user_data ? { ...t.line_user_data, nickname, detail } : null }
        : t
      );
      setActiveTickets(updateTicketUser);
      setCompletedTickets(updateTicketUser);
      setEditModal({ isOpen: false, ticket: null, nickname: '', detailName: '', detailPhone: '', detailContract: '' });
    } catch (e: any) {
      setAlertState({ isOpen: true, title: translateNow('pageui.support.error_short', 'ผิดพลาด'), message: e.message || translateNow('pageui.support.save_failed', 'บันทึกไม่สำเร็จ'), type: 'error' });
    } finally {
      setSavingEdit(false);
    }
  };

  const activeColCount = 6 +
    (visibleCols.profile ? 1 : 0) +
    (visibleCols.customerInfo ? 1 : 0) +
    (visibleCols.category ? 1 : 0) +
    (visibleCols.needs ? 1 : 0);

  return (
    <div ref={mainContainerRef} className="flex gap-0 w-full max-w-full h-[calc(100vh-64px)] -mt-4 -mb-4 md:-mt-6 md:-mb-6 lg:-mt-8 lg:-mb-8 overflow-hidden relative">
      {/* Left Main View (Ticket List & Filters) */}
      <div
        style={{ width: instantChatTarget ? (instantChatTarget.isExpanded ? '0%' : (instantChatTarget.isCollapsed ? '100%' : `${100 - instantChatPercent}%`)) : '100%' }}
        className={`flex flex-col gap-4 overflow-y-auto custom-scrollbar p-3 md:p-4 min-w-0 ${instantChatTarget?.isExpanded ? 'hidden' : 'flex'}`}
      >
        {/* Loading overlay */}
        {loading && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3 min-w-[160px]">
              <Loader2 size={36} className="animate-spin text-emerald-500" />
              <span className="text-sm font-semibold text-slate-700">{t('common.loading_data')}</span>
            </div>
          </div>
        )}

        {isCompactView ? (
          /* Sleek Vertical Compact Cards List for Ticket Support */
          <div className="flex flex-col gap-3 h-full overflow-hidden min-h-0">
            {/* Header & Quick Status Pills */}
            <div className="flex flex-col gap-2 bg-white p-3 rounded-xl border border-slate-200 shadow-sm shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">{t('pageui.support.tickets_n', 'ตั๋วงาน ({n})', { n: processedTickets.length })}</span>
                <button 
                  /* [FIX-20260801-HOOKTYPES] เดิม onClick={fetchTickets} → React ส่ง
                     MouseEvent เข้าไปเป็น argument แรก ซึ่งฟังก์ชันตีความเป็น silent=true
                     ผลคือกดรีเฟรชแล้วไม่ขึ้นสถานะโหลด และถ้ามี fetch ค้างอยู่จะถูก
                     drop ทิ้งเงียบ ๆ (บรรทัด `if (silent && isFetchingRef.current) return`)
                     ไม่มีใครฟ้องเพราะโปรเจกต์ยังไม่ได้ติดตั้ง @types/react */
                  onClick={() => fetchTickets()}
                  className="p-1 text-slate-400 hover:text-emerald-600 rounded-md transition-colors"
                  title={t('pageui.support.refresh', 'รีเฟรช')}
                >
                  <RefreshCw size={14} />
                </button>
              </div>

              {/* Group & OA Sub-Channel Selectors */}
              <div className="flex flex-col gap-1.5">
                <select
                  value={activeGroupId ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      setActiveGroupId(val);
                      setActiveHookId(null);
                      setPendingGroupId(null);
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-800 outline-none cursor-pointer"
                >
                  {!activeGroupId && <option value="">{t('pageui.support.pick_group', 'เลือกกลุ่ม...')}</option>}
                  {sortedGroups.map((group) => (
                    <option key={group._id} value={group._id}>{group.group_name}</option>
                  ))}
                </select>

                {activeGroupId && activeGroupHooks.length > 0 && (
                  <select
                    value={activeHookId ?? ''}
                    onChange={(e) => setActiveHookId(e.target.value || null)}
                    className="w-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg text-[11px] font-bold text-emerald-800 outline-none cursor-pointer"
                  >
                    <option value="">{t('pageui.support.all_n_oas', 'ทั้งหมด ({n} OA)', { n: activeGroupHooks.length })}</option>
                    {activeGroupHooks.map((hook) => (
                      <option key={hook._id} value={hook._id}>
                        {hook.alias || hook.line_oa_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
                <input
                  type="text"
                  placeholder={t('pageui.support.search_name_line', 'ค้นหาชื่อ / LINE ID...')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 pl-8 pr-2.5 py-1.5 rounded-lg text-xs font-medium outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Status Filters */}
              <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar pt-1">
                {[
                  { status: 'รอรับงาน', code: 0, label: t('pageui.support.pill_waiting', 'รอรับ'), color: 'bg-amber-50 text-amber-700 border-amber-200' },
                  { status: 'กำลังดำเนินงาน', code: 1, label: t('pageui.support.pill_doing', 'กำลังทำ'), color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                  { status: 'จบงาน', code: 2, label: t('pageui.support.pill_done', 'จบงาน'), color: 'bg-slate-50 text-slate-700 border-slate-200' }
                ].map(item => {
                  const count = item.code === 2 ? completedTickets.length : activeTickets.filter(t => t.job_status === item.code).length;
                  const isSelected = filterJobStatus === item.status;
                  return (
                    <button
                      key={item.status}
                      onClick={() => setFilterJobStatus(isSelected ? '' : item.status)}
                      className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all shrink-0 flex items-center gap-1 ${
                        isSelected ? 'bg-slate-800 text-white border-slate-800' : `${item.color} hover:opacity-80`
                      }`}
                    >
                      <span>{item.label}</span>
                      <span className="px-1 py-0.2 rounded-full text-[9px] bg-white/70 text-slate-800 font-extrabold">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vertical Ticket Cards Stream */}
            <div className="flex-1 flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1 min-h-0">
              {processedTickets.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">{t('pageui.support.no_tickets', 'ไม่พบตั๋วงาน')}</div>
              ) : (
                processedTickets.map((ticket) => {
                  const isActive = instantChatTarget?.ticket?._id === ticket._id;
                  /* [FEAT-20260819-MSGALERT] new customer messages on this card
                     since it was last opened. 0 = no badge at all. */
                  const unreadCount = unreadByUser[ticket.line_user_data?.line_user_id || ''] || 0;
                  const userImg = ticket.line_user_data?.picture_url || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
                  const displayName = ticket.line_user_data?.display_name || ticket.chat_user_id?.display_name || t('pageui.support.no_name', 'ไม่ระบุชื่อ');
                  
                  return (
                    <div
                      key={ticket._id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCompactCardClick(ticket);
                      }}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 group select-none ${
                        isActive
                          ? 'bg-emerald-50/90 border-emerald-500 shadow-sm ring-1 ring-emerald-500'
                          : 'bg-white border-slate-200 hover:border-emerald-400 hover:shadow-md'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <img
                            src={userImg}
                            alt="user"
                            className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <h4 className="text-xs font-bold text-slate-800 truncate group-hover:text-emerald-600 transition-colors">
                              {displayName}
                            </h4>
                            <p className="text-[10px] text-slate-500 truncate font-normal mt-0.5">
                              {/* [FEAT-20260819-MSGALERT] the count sits IN FRONT of
                                  the need text — owner's placement. Orange outline so it
                                  reads as "new", without competing with the status pills
                                  below. Hidden entirely at 0, so a card with no new
                                  message looks exactly as it did before. */}
                              {unreadCount > 0 && (
                                <span
                                  title={t('pageui.support.new_msgs_n', 'ข้อความใหม่ {n} ข้อความ', { n: unreadCount })}
                                  className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 mr-1 align-middle rounded-md border border-orange-400 bg-orange-50 text-orange-600 text-[10px] font-bold leading-none"
                                >
                                  {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                              )}
                              {ticket.need_detail || ticket.category || t('pageui.support.no_detail', 'ไม่มีรายละเอียด')}
                            </p>
                          </div>
                        </div>

                        {/* Minimal Action Button on Right Side */}
                        {Number(ticket.job_status) === 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCompactCardClick(ticket);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-[11px] shadow-sm flex items-center gap-1 shrink-0 transition-all cursor-pointer hover:shadow"
                          >
                            <Briefcase size={12} />
                            <span>{t('pageui.support.accept', 'รับงาน')}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCompactCardClick(ticket);
                            }}
                            className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] flex items-center gap-1 shrink-0 transition-all cursor-pointer border border-slate-200"
                          >
                            <MessageSquare size={11} className="text-emerald-600" />
                            <span>{t('pageui.support.open_chat', 'เปิดแชต')}</span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[9px] text-slate-400 pt-1.5 border-t border-slate-100">
                        <span className="truncate">{ticket.category || t('pageui.support.general', 'ทั่วไป')}</span>
                        <span className="shrink-0">{ticket.created_at ? new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 w-full">
            {/* Channel picker */}
            <div className="bg-dark-800 border border-dark-700 p-4 rounded-xl shadow-sm flex flex-col sm:flex-row gap-4 items-end">
              <div className="w-full sm:max-w-xs">
                <label htmlFor="ticket-group" className="block text-slate-700 text-xs font-bold mb-1">
                  {t('pageui.support.data_group', 'กลุ่มข้อมูล')}
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-emerald-500">
                    <Database size={16} />
                  </span>
                  <select
                    id="ticket-group"
                    value={activeGroupId ?? ''}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!next) return;
                      setActiveGroupId(next);
                      setPendingGroupId(null);
                    }}
                    className="w-full appearance-none bg-dark-800 border border-dark-600 pl-9 pr-9 py-2.5 rounded-lg text-slate-900 text-sm font-bold focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
                  >
                    {!activeGroupId && <option value="">{t('pageui.support.pick_group', 'เลือกกลุ่ม...')}</option>}
                    {sortedGroups.map((group) => (
                      <option key={group._id} value={group._id}>
                        {group.group_name}
                      </option>
                    ))}
                  </select>
                  <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                    <ChevronDown size={16} />
                  </span>
                </div>
              </div>

              {activeGroupId && (
                <div className="w-full sm:max-w-xs">
                  <label htmlFor="ticket-sub-channel" className="block text-slate-700 text-xs font-bold mb-1">
                    {t('pageui.support.filter_by_oa', 'กรองราย OA (ตัวเลือก)')}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-emerald-500">
                      <Tag size={16} />
                    </span>
                    <select
                      id="ticket-sub-channel"
                      value={activeHookId ?? ''}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        setActiveHookId(next);
                      }}
                      className="w-full appearance-none bg-dark-800 border border-dark-600 pl-9 pr-9 py-2.5 rounded-lg text-slate-900 text-sm font-bold focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
                    >
                      <option value="">{t('pageui.support.all_n_oas', 'ทั้งหมด ({n} OA)', { n: activeGroupHooks.length })}</option>
                      {activeGroupHooks.map((hook) => (
                        <option key={hook._id} value={hook._id}>
                          {hook.alias || hook.line_oa_name}
                        </option>
                      ))}
                    </select>
                    <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                      <ChevronDown size={16} />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Header and Filter Controls */}
      <div className="bg-dark-800 border border-dark-700 p-4 rounded-xl shadow-sm flex flex-col gap-4">
        {/* Row 1: Search & Date Range */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          {/* Search */}
          <div className="w-full relative md:col-span-2">
            <label className="block text-slate-700 text-xs font-bold mb-1">{t('pageui.support.search', 'ค้นหา')}</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                <Search size={14} />
              </span>
              <input 
                type="text" 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('pageui.support.search_ph', 'Line OA / ชื่อ-นามสกุล / เบอร์')} 
                className="w-full bg-dark-800 border border-dark-600 pl-8 pr-3 py-1.5 rounded-lg text-slate-900 placeholder-slate-400 text-xs focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>

          {/* Date Start */}
          <div className="w-full relative md:col-span-1">
            <label className="block text-slate-700 text-xs font-bold mb-1">{t('pageui.support.date_from', 'เริ่มจาก')}</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                <Calendar size={14} />
              </span>
              <input 
                type="datetime-local" 
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-full bg-dark-800 border border-dark-600 pl-8 pr-3 py-1.5 rounded-lg text-slate-900 text-[10px] focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>

          {/* Date End */}
          <div className="w-full relative md:col-span-1">
            <label className="block text-slate-700 text-xs font-bold mb-1">{t('pageui.support.date_to', 'ถึง')}</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                <Calendar size={14} />
              </span>
              <input 
                type="datetime-local" 
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full bg-dark-800 border border-dark-600 pl-8 pr-3 py-1.5 rounded-lg text-slate-900 text-[10px] focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>
        </div>

        {/* Row 2: Select Filters & Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          {/* Customer */}
          <div className="w-full">
            <label className="block text-slate-700 text-xs font-bold mb-1">{t('pageui.support.customer', 'ลูกค้า')}</label>
            <select 
              value={filterCustomer}
              onChange={(e) => setFilterCustomer(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 px-3 py-1.5 rounded-lg text-slate-900 text-xs focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
            >
              <option value="ทั้งหมด">{t('pageui.support.all', 'ทั้งหมด')}</option>
              <option value="ลงทะเบียน">{t('pageui.support.registered', 'ลงทะเบียน')}</option>
              <option value="ไม่ลงทะเบียน">{t('pageui.support.not_registered', 'ไม่ลงทะเบียน')}</option>
            </select>
          </div>

          {/* Category */}
          <div className="w-full">
            <label className="block text-slate-700 text-xs font-bold mb-1">{t('pageui.support.category', 'หมวดหมู่')}</label>
            <select 
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 px-3 py-1.5 rounded-lg text-slate-900 text-xs focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
            >
              {/* Options come from the flag-driven category set, so the list
                  matches the filter logic. */}
              <option value="ทั้งหมด">{t('pageui.support.all', 'ทั้งหมด')}</option>
              {categoryOptions.map(o => <option key={o.label} value={o.label}>{CATEGORY_LABEL_KEY[o.label] ? t(CATEGORY_LABEL_KEY[o.label], o.label) : o.label}</option>)}
            </select>
          </div>

          {/* Chat Status */}
          <div className="w-full">
            <label className="block text-slate-700 text-xs font-bold mb-1">{t('pageui.support.chat_status', 'สถานะแชท')}</label>
            <select 
              value={filterChatStatus}
              onChange={(e) => setFilterChatStatus(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 px-3 py-1.5 rounded-lg text-slate-900 text-xs focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
            >
              <option value="ทั้งหมด">{t('pageui.support.all', 'ทั้งหมด')}</option>
              <option value="บอทตอบ">{t('pageui.support.bot_replied', 'บอทตอบ')}</option>
              <option value="แอดมินตอบ">{t('pageui.support.admin_replied', 'แอดมินตอบ')}</option>
            </select>
          </div>

          {/* Operator */}
          <div className="w-full">
            <label className="block text-slate-700 text-xs font-bold mb-1">{t('pageui.support.operator', 'ผู้ทำรายการ')}</label>
            <select 
              value={filterOperator}
              onChange={(e) => setFilterOperator(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 px-3 py-1.5 rounded-lg text-slate-900 text-xs focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
            >
              <option value="ทั้งหมด">{t('pageui.support.all', 'ทั้งหมด')}</option>
              <option>-</option>
              {currentUserDetail && (
                <option value={currentUserDetail.display_name || currentUserDetail.username}>
                  {currentUserDetail.display_name || currentUserDetail.username} {t('pageui.support.me', '(ฉัน)')}
                </option>
              )}
              {allUsers.map((u) => (
                <option key={u.id} value={u.display_name || u.username}>
                  {u.display_name || u.username}
                </option>
              ))}
            </select>
          </div>

          {/* Limit per page (Header) */}
          <div className="w-full">
            <label className="block text-slate-700 text-xs font-bold mb-1">{t('pageui.support.per_page', 'แสดง/หน้า')}</label>
            <select 
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="w-full bg-dark-800 border border-dark-600 px-3 py-1.5 rounded-lg text-slate-900 text-xs focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
            >
              <option value={10}>{t('pageui.support.n_items', '{n} รายการ', { n: 10 })}</option>
              <option value={25}>{t('pageui.support.n_items', '{n} รายการ', { n: 25 })}</option>
              <option value={50}>{t('pageui.support.n_items', '{n} รายการ', { n: 50 })}</option>
              <option value={100}>{t('pageui.support.n_items', '{n} รายการ', { n: 100 })}</option>
            </select>
          </div>

          {/* Reset Filters / Refresh */}
          <div className="w-full flex gap-2">
            <button 
              onClick={() => {
                fetchTickets();
                if (filterJobStatus === 'จบงาน') {
                  fetchCompletedTickets();
                }
              }}
              className="flex-1 flex items-center justify-center gap-1.5 bg-dark-700 hover:bg-dark-600 text-slate-900 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors border border-dark-600 shadow-sm"
              title={t('pageui.support.fetch_latest', 'ดึงข้อมูลล่าสุด')}
            >
              <RefreshCw size={12} className={loading || completedLoading ? 'animate-spin' : ''} />
            </button>
            <button 
              onClick={() => {
                setSearch('');
                setFilterStartDate('');
                setFilterEndDate('');
                setFilterCustomer('ทั้งหมด');
                setFilterCategory('ทั้งหมด');
                setFilterChatStatus('ทั้งหมด');
                setFilterJobStatus('รอรับงาน');
                setFilterOperator('ทั้งหมด');
                setItemsPerPage(25);
                setSortKey(null);
                fetchTickets();
              }}
              className="flex-3 w-full flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-3 py-2 rounded-lg text-sm font-medium transition-colors border border-dark-600 shadow-sm"
              title={t('pageui.support.clear_filters', 'ล้างตัวกรอง')}
            >
              <span>{t('pageui.support.reset', 'รีเซ็ต')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Ticket Container */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-sm overflow-hidden relative flex flex-col">
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-emerald-500/80 animate-pulse z-10" />
        )}
        
        {/* Job Status Tabs (Placed above Table Header) */}
        <div className="flex bg-slate-50 border-b border-slate-200 justify-between items-center pr-4">
          <div className="flex">
            {['รอรับงาน', 'กำลังดำเนินงาน', 'จบงาน'].map((status) => {
              let count = 0;
              if (status === 'รอรับงาน') {
                count = activeTickets.filter(t => t.job_status === 0).length;
              } else if (status === 'กำลังดำเนินงาน') {
                count = activeTickets.filter(t => t.job_status === 1).length;
              } else if (status === 'จบงาน') {
                count = isCompletedLoaded
                  ? completedServerTotal
                  : Math.max(0, totalTickets - activeTickets.length);
              }
              const isActive = filterJobStatus === status;
              return (
                <button
                  key={status}
                  onClick={() => setFilterJobStatus(status)}
                  className={`px-5 py-3 font-bold text-xs transition-all border-b-2 focus:outline-none flex items-center gap-1.5 select-none ${
                    isActive 
                      ? 'border-emerald-500 text-emerald-600 bg-white shadow-sm' 
                      : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                  }`}
                >
                  <span>{t(JOB_STATUS_LABEL_KEY[status], status)}</span>
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded-full ${isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
            
            {canBulkClear && filterJobStatus !== 'จบงาน' && (
              <button
                onClick={() => {
                  setClearWaiting(true);
                  setClearProcessing(true);
                  setClearConfirming(false);
                  setClearModalOpen(true);
                }}
                className="ml-4 px-4 py-1.5 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 my-auto"
                title={t('pageui.support.bulk_clear_tip', 'เคลียร์งานที่ค้างอยู่')}
              >
                <Trash2 size={14} />
                {t('pageui.support.bulk_clear', 'เคลียร์งาน')}
              </button>
            )}
          </div>

          {/* Settings / Column Visibility Dropdown */}
          <div className="relative">
            <button
              onClick={() => setColMenuOpen(!colMenuOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm focus:outline-none"
            >
              <Settings size={13} />
              <span>{t('pageui.support.col_settings', 'ตั้งค่าคอลัมน์')}</span>
            </button>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setColMenuOpen(false)} />
                <div className="absolute right-0 mt-1.5 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-30 p-3 flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('pageui.support.col_toggle', 'เปิด/ปิด คอลัมน์')}</span>
                  
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={visibleCols.profile}
                      onChange={(e) => setVisibleCols(prev => ({ ...prev, profile: e.target.checked }))}
                      className="rounded text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5 cursor-pointer"
                    />
                    <span>{t('pageui.support.col_profile', 'รูปโปรไฟล์')}</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={visibleCols.customerInfo}
                      onChange={(e) => setVisibleCols(prev => ({ ...prev, customerInfo: e.target.checked }))}
                      className="rounded text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5 cursor-pointer"
                    />
                    <span>{t('pageui.support.col_customer', 'Line OA / ชื่อ-สกุล / เบอร์')}</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={visibleCols.category}
                      onChange={(e) => setVisibleCols(prev => ({ ...prev, category: e.target.checked }))}
                      className="rounded text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5 cursor-pointer"
                    />
                    <span>{t('pageui.support.category', 'หมวดหมู่')}</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={visibleCols.needs}
                      onChange={(e) => setVisibleCols(prev => ({ ...prev, needs: e.target.checked }))}
                      className="rounded text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5 cursor-pointer"
                    />
                    <span>{t('pageui.support.col_need', 'ความต้องการ')}</span>
                  </label>

                  <div className="border-t border-slate-100 my-1 pt-2">
                    <button
                      onClick={() => setResetConfirmModalOpen(true)}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors rounded-lg border border-rose-200/50 shadow-sm focus:outline-none"
                    >
                      {t('pageui.support.col_reset', 'รีเซ็ตขนาดและคอลัมน์')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Desktop View (Table format, visible on Large screens) */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-xs text-left table-fixed">
            <colgroup>
              {visibleCols.profile && <col style={{ width: colWidths.profile }} />}
              <col style={{ width: colWidths.displayName }} />
              {visibleCols.customerInfo && <col style={{ width: colWidths.customerInfo }} />}
              {visibleCols.category && <col style={{ width: colWidths.category }} />}
              {visibleCols.needs && <col style={{ width: colWidths.needs }} />}
              <col style={{ width: colWidths.attachments }} />
              <col style={{ width: colWidths.dateTime }} />
              <col style={{ width: colWidths.chatStatus }} />
              <col style={{ width: colWidths.jobStatus }} />
              <col style={{ width: colWidths.operator }} />
            </colgroup>
            <thead>
              <tr className="bg-dark-900 text-slate-550 border-b border-dark-700">
                {visibleCols.profile && (
                  <th className="p-3 border-r border-dark-700/50 relative group/th select-none">
                    <span>{t('pageui.support.col_profile', 'รูปโปรไฟล์')}</span>
                    <div onMouseDown={(e) => startResize(e, 'profile')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                  </th>
                )}
                <th className="p-3 border-r border-dark-700/50 relative group/th select-none">
                  <span>{t('ticket.displayname')}</span>
                  <div onMouseDown={(e) => startResize(e, 'displayName')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                </th>
                {visibleCols.customerInfo && (
                  <th className="p-3 border-r border-dark-700/50 relative group/th select-none">
                    <span>{t('pageui.support.col_customer', 'Line OA / ชื่อ-สกุล / เบอร์')}</span>
                    <div onMouseDown={(e) => startResize(e, 'customerInfo')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                  </th>
                )}
                {visibleCols.category && (
                  <th 
                    onClick={() => handleSort('category')}
                    className="p-3 border-r border-dark-700/50 cursor-pointer hover:bg-dark-700 hover:text-slate-900 transition-colors relative group/th select-none"
                  >
                    <div className="flex items-center justify-between">
                      <span>{t('pageui.support.category', 'หมวดหมู่')}</span>
                      <span className="text-[10px] opacity-60">⇅</span>
                    </div>
                    <div onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'category'); }} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                  </th>
                )}
                {visibleCols.needs && (
                  <th className="p-3 border-r border-dark-700/50 relative group/th select-none">
                    <span>{t('pageui.support.col_need', 'ความต้องการ')}</span>
                    <div onMouseDown={(e) => startResize(e, 'needs')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                  </th>
                )}
                <th className="p-3 text-center border-r border-dark-700/50 relative group/th select-none">
                  <span>{t('pageui.support.col_attachments', 'รูปภาพแนบ')}</span>
                  <div onMouseDown={(e) => startResize(e, 'attachments')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                </th>
                <th 
                  onClick={() => handleSort('created_at')}
                  className="p-3 border-r border-dark-700/50 cursor-pointer hover:bg-dark-700 hover:text-slate-900 transition-colors relative group/th select-none"
                >
                  <div className="flex items-center justify-between">
                    <span>{t('pageui.support.col_datetime', 'วัน-เวลา')}</span>
                    <span className="text-[10px] opacity-60">⇅</span>
                  </div>
                  <div onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'dateTime'); }} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                </th>
                <th 
                  onClick={() => handleSort('chat_status')}
                  className="p-3 border-r border-dark-700/50 cursor-pointer hover:bg-dark-700 hover:text-slate-900 transition-colors relative group/th select-none"
                >
                  <div className="flex items-center justify-between">
                    <span>{t('pageui.support.chat_status', 'สถานะแชท')}</span>
                    <span className="text-[10px] opacity-60">⇅</span>
                  </div>
                  <div onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'chatStatus'); }} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                </th>
                <th 
                  onClick={() => handleSort('job_status')}
                  className="p-3 border-r border-dark-700/50 cursor-pointer hover:bg-dark-700 hover:text-slate-900 transition-colors relative group/th select-none"
                >
                  <div className="flex items-center justify-between">
                    <span>{t('pageui.support.col_job_status', 'สถานะงาน')}</span>
                    <span className="text-[10px] opacity-60">⇅</span>
                  </div>
                  <div onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'jobStatus'); }} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                </th>
                <th className="p-3 relative group/th select-none">
                  <span>{t('pageui.support.operator', 'ผู้ทำรายการ')}</span>
                  <div onMouseDown={(e) => startResize(e, 'operator')} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-10 transition-all opacity-0 group-hover/th:opacity-100" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {/* Grouped mode for จบงาน tab */}
              {isGroupedMode ? (
                completedLoading ? (
                  <tr>
                    <td colSpan={activeColCount} className="px-6 py-12 text-center text-slate-500 font-bold">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="animate-spin text-emerald-500" size={18} />
                        {t('pageui.support.loading_done', 'กำลังโหลดข้อมูลงานที่จบแล้ว...')}
                      </div>
                    </td>
                  </tr>
                ) : paginatedGroups.length === 0 ? (
                  <tr>
                    <td colSpan={activeColCount} className="px-6 py-12 text-center text-slate-500 font-bold">
                      {t('pageui.support.no_jobs_for_filters', 'ไม่พบข้อมูลงานช่วยเหลือตามตัวกรองที่เลือก')}
                    </td>
                  </tr>
                ) : paginatedGroups.map((group) => {
                  const { key, tickets: groupTickets, latest } = group;
                  const isGroupExpanded = expandedGroupId === key;
                  const gDisplayName = latest.line_user_data?.display_name || 'Line User';
                  const gNickname = latest.line_user_data?.nickname || '';
                  const gPicture = latest.line_user_data?.picture_url || `https://i.pravatar.cc/150?img=${latest._id.slice(-2)}`;
                  const gDetail = latest.line_user_data?.detail || '';
                  const gFullName = latest.line_user_data?.full_name || '';
                  const gPhone = latest.line_user_data?.phone_number || 'N/A';
                  const gContract = latest.line_user_data?.contract_code || 'N/A';
                  const { detailName: gDN, detailPhone: gDP, detailContract: gDC } = parseDetail(gDetail);

                  return (
                    <React.Fragment key={key}>
                      {/* Group Header Row */}
                      <tr className={`border-b border-dark-700 cursor-pointer transition-colors ${isGroupExpanded ? 'bg-emerald-500/[0.13] hover:bg-emerald-500/[0.16]' : 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]'}`} onClick={() => setExpandedGroupId(isGroupExpanded ? null : key)}>
                        {visibleCols.profile && (
                          <td className="p-3 border-r border-dark-700/40 text-center" onClick={e => e.stopPropagation()}>
                            <img src={gPicture} alt="profile" onClick={() => setNicknameInfoModal({ displayName: gDisplayName, nickname: gNickname, pictureUrl: gPicture, isRegistered: !!gFullName, fullName: gFullName, detail: gDetail, phone: gPhone, contract: gContract })} className={`w-12 h-12 rounded-full mx-auto object-cover cursor-pointer hover:opacity-80 transition-opacity ring-4 shadow-lg ${gFullName ? 'ring-emerald-400 shadow-emerald-300' : 'ring-red-400 shadow-red-300'}`} />
                          </td>
                        )}
                        <td className="p-3 border-r border-dark-700/40 min-w-0 overflow-hidden" onClick={e => e.stopPropagation()}>
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-1 min-w-0">
                              <button onClick={() => setNicknameInfoModal({ displayName: gDisplayName, nickname: gNickname, pictureUrl: gPicture, isRegistered: !!gFullName, fullName: gFullName, detail: gDetail, phone: gPhone, contract: gContract })} className="font-bold block truncate max-w-full text-left text-slate-800 hover:text-primary-600 transition-colors text-xs min-w-0 flex-1" title={t('pageui.support.view_name', 'ดูข้อมูลชื่อ')}>{gNickname || gDisplayName}</button>
                              <span 
                                className={`px-2 py-0.5 text-[10px] font-bold rounded-full border flex-shrink-0 inline-flex items-center gap-1 shadow-sm ${
                                  groupTickets.length > 1 
                                    ? 'bg-emerald-500 text-white border-emerald-600' 
                                    : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                }`} 
                                title={t('pageui.support.stacked_n', 'การ์ดซ้อนกันอยู่ {n} รายการ', { n: groupTickets.length })}
                              >
                                <Layers size={11} />
                                <span>{groupTickets.length}</span>
                              </span>
                            </div>
                            {latest.line_user_data?.line_user_id && (
                              <CopyableCell text={latest.line_user_data.line_user_id} id={`g-${key}`} field="lineUserId" classes="text-[10px] font-mono text-slate-500 block truncate max-w-full" />
                            )}
                          </div>
                        </td>
                        {visibleCols.customerInfo && (
                          <td className="p-3 border-r border-dark-700/40 min-w-0 overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="flex flex-col gap-1.5 min-w-0">
                              {gFullName ? (
                                <CopyableCell text={gFullName} id={`g-${key}`} field="fullName" classes="font-bold text-slate-800 truncate max-w-full" />
                              ) : (gDN || gDP || gDC) ? (
                                <>
                                  {gDN && <CopyableCell text={gDN} id={`g-${key}`} field="detailName" classes="font-bold text-slate-800 truncate max-w-full" />}
                                  {gDP && <CopyableCell text={gDP} id={`g-${key}`} field="detailPhone" classes="font-bold text-slate-800 truncate max-w-full" />}
                                  {gDC && <CopyableCell text={gDC} id={`g-${key}`} field="detailContract" classes="font-mono text-xs font-bold text-slate-700 truncate max-w-full" />}
                                </>
                              ) : (
                                <span className="text-slate-400 italic text-[10px]">{t('pageui.support.unregistered_marker', '-(ไม่ได้ลงทะเบียน)-')}</span>
                              )}
                              <CopyableCell text={gPhone} id={`g-${key}`} field="phone" classes="font-bold text-slate-800 truncate max-w-full" />
                              <CopyableCell text={gContract} id={`g-${key}`} field="contract" classes="font-mono text-xs font-bold text-slate-700 truncate max-w-full" />
                            </div>
                          </td>
                        )}
                        {visibleCols.category && (
                          <td className="p-3 border-r border-dark-700/40 text-center min-w-0">
                            {getCategoryBadge(latest.category)}
                          </td>
                        )}
                        {visibleCols.needs && (
                          <td className="p-3 border-r border-dark-700/40 min-w-0 overflow-hidden">
                            <span className="text-slate-700 font-medium text-xs truncate block">{latest.need_detail || '-'}</span>
                          </td>
                        )}
                        <td className="p-3 border-r border-dark-700/40 text-center">
                          {latest.attached_files && latest.attached_files.length > 0 ? (
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); setSelectedTicketForGallery(latest); }}
                              className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center mx-auto"
                              title={t('pageui.support.view_attachments_n', 'ดูรูปภาพแนบ ({n} ภาพ)', { n: latest.attached_files.length })}
                            >
                              <ImageIcon size={14} />
                            </button>
                          ) : (
                            <span className="text-slate-400 italic font-normal text-[10px]">-</span>
                          )}
                        </td>
                        <td className="p-3 border-r border-dark-700/40 min-w-0 overflow-hidden">
                          <span className="text-[10px] font-bold text-slate-655 block truncate">{t('pageui.support.last_done_at', 'จบล่าสุด :')} {formatTicketTime(latest.updated_at || latest.created_at)}</span>
                        </td>
                        <td className="p-3 border-r border-dark-700/40 text-center">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-sky-100 text-sky-700 px-2 py-0.5 rounded border border-sky-200 whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />{t('pageui.support.admin', 'แอดมิน')}
                          </span>
                        </td>
                        <td className="p-3 border-r border-dark-700/40 text-center">
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[10px] whitespace-nowrap">
                            <CheckCircle size={12} className="text-emerald-500" />{t('pageui.support.status_done', 'จบงาน')}
                          </span>
                        </td>
                        <td className="p-3 min-w-0 overflow-hidden">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-[10px] font-bold text-slate-700 truncate">
                                {latest.admin_user_data ? (latest.admin_user_data.display_name || latest.admin_user_data.username) : '-'}
                              </span>
                              <span className="text-[9px] text-slate-400 font-normal truncate">{formatTicketTime(latest.resolved_at || latest.updated_at)}</span>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); setExpandedGroupId(isGroupExpanded ? null : key); }}
                              className={`px-2 py-1.5 rounded-lg border transition-all flex-shrink-0 ${isGroupExpanded ? 'bg-primary-500 text-white border-primary-500' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                            >
                              {isGroupExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded: individual tickets */}
                      {isGroupExpanded && (() => {
                        const childPage = getChildPage(key);
                        const childTotalPages = Math.ceil(groupTickets.length / childLimit) || 1;
                        const childStart = (childPage - 1) * childLimit;
                        const pagedChildren = groupTickets.slice(childStart, childStart + childLimit);
                        return (
                        <>
                        {pagedChildren.map((row) => {
                        const displayName = row.line_user_data?.display_name || 'Line User';
                        const nickname = row.line_user_data?.nickname || '';
                        const detail = row.line_user_data?.detail || '';
                        const fullName = row.line_user_data?.full_name || '';
                        const phone = row.line_user_data?.phone_number || 'N/A';
                        const contract = row.line_user_data?.contract_code || 'N/A';
                        const adminName = row.admin_user_data
                          ? (row.admin_user_data.display_name || row.admin_user_data.username)
                          : '-';
                        const { detailName: dn, detailPhone: dp, detailContract: dc } = parseDetail(detail);

                        return (
                          <React.Fragment key={row._id}>
                            <tr className="bg-slate-200/50 hover:bg-slate-200/70 border-b border-dark-700/60">
                              {visibleCols.profile && (
                                <td className="p-2 border-r border-dark-700/40 text-center">
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mx-auto" />
                                </td>
                              )}
                              {revealedGroups.has(key) ? (
                                <>
                                  <td className="p-2 pl-3 border-r border-dark-700/40 min-w-0 overflow-hidden">
                                    <div className="flex items-center gap-1 min-w-0">
                                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                        {/* [FIX-20260814-CUSTOMERNAME] was `nickname || displayName` —
                                            a poisoned nickname ("Unknown") outranked the real name */}
                                        <span className="font-bold text-slate-800 truncate text-xs">{customerName(row.line_user_data)}</span>
                                        {row.line_user_data?.line_user_id && (
                                          <span className="text-[10px] font-mono text-slate-500 truncate">{row.line_user_data.line_user_id}</span>
                                        )}
                                      </div>
                                      <button
                                        onClick={e => { e.stopPropagation(); toggleRevealGroup(key); }}
                                        className="p-0.5 text-slate-400 hover:text-primary-500 transition-colors flex-shrink-0"
                                        title={t('pageui.support.hide', 'ซ่อน')}
                                      >
                                        <EyeOff size={12} />
                                      </button>
                                    </div>
                                  </td>
                                  {visibleCols.customerInfo && (
                                    <td className="p-2 border-r border-dark-700/40 min-w-0 overflow-hidden">
                                      <div className="flex flex-col gap-1.5 min-w-0">
                                        {fullName ? (
                                          <CopyableCell text={fullName} id={row._id} field="fullName" classes="font-bold text-slate-800 truncate max-w-full" />
                                        ) : (dn || dp || dc) ? (
                                          <>
                                            {dn && <CopyableCell text={dn} id={row._id} field="detail-name" classes="font-bold text-slate-800 truncate max-w-full" />}
                                            {dp && <CopyableCell text={dp} id={row._id} field="detail-phone" classes="font-bold text-slate-800 truncate max-w-full" />}
                                            {dc && <CopyableCell text={dc} id={row._id} field="detail-contract" classes="font-mono text-xs font-bold text-slate-700 truncate max-w-full" />}
                                          </>
                                        ) : (
                                          <span className="text-slate-400 italic text-[10px]">{t('pageui.support.unregistered_marker', '-(ไม่ได้ลงทะเบียน)-')}</span>
                                        )}
                                        <CopyableCell text={phone} id={row._id} field="phone" classes="font-bold text-slate-800 truncate max-w-full" />
                                        <CopyableCell text={contract} id={row._id} field="contract" classes="font-mono text-xs font-bold text-slate-700 truncate max-w-full" />
                                      </div>
                                    </td>
                                  )}
                                </>
                              ) : (
                                <td colSpan={visibleCols.customerInfo ? 2 : 1} className="p-2 border-r border-dark-700/40 text-center">
                                  <button
                                    onClick={e => { e.stopPropagation(); toggleRevealGroup(key); }}
                                    className="p-0.5 text-slate-400 hover:text-primary-500 transition-colors mx-auto"
                                    title={t('pageui.support.show_info', 'แสดงข้อมูล')}
                                  >
                                    <Eye size={12} />
                                  </button>
                                </td>
                              )}
                              {visibleCols.category && (
                                <td className="p-2 border-r border-dark-700/40 text-center">
                                  {getCategoryBadge(row.category)}
                                </td>
                              )}
                              {visibleCols.needs && (
                                <td className="p-2 border-r border-dark-700/40 min-w-0 overflow-hidden">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="truncate flex-1 text-xs text-slate-700">{row.need_detail || '-'}</span>
                                    <button onClick={() => setSelectedTicketForInfo(row)} className="p-1.5 text-slate-400 hover:text-emerald-600 flex-shrink-0 border border-slate-200 hover:border-emerald-400 rounded-lg bg-white hover:bg-emerald-50"><Info size={16} /></button>
                                  </div>
                                </td>
                              )}
                              <td className="p-2 border-r border-dark-700/40 text-center">
                                {row.attached_files && row.attached_files.length > 0 ? (
                                  <button onClick={() => setSelectedTicketForGallery(row)} className="p-1 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20 mx-auto flex items-center justify-center"><ImageIcon size={12} /></button>
                                ) : <span className="text-slate-400 text-[10px]">-</span>}
                              </td>
                              <td className="p-2 border-r border-dark-700/40 min-w-0 overflow-hidden">
                                <div className="flex flex-col text-[10px] font-bold text-slate-655">
                                  <span className="truncate">{t('pageui.support.done_at', 'จบงาน :')} {formatTicketTime(row.updated_at || row.created_at)}</span>
                                  <span className="text-[9px] text-slate-500 font-normal truncate">{t('pageui.support.created_at_short', 'สร้าง :')} {formatTicketTime(row.created_at)}</span>
                                </div>
                              </td>
                              <td className="p-2 border-r border-dark-700/40 text-center">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-sky-100 text-sky-700 px-2 py-0.5 rounded border border-sky-200 whitespace-nowrap">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />{t('pageui.support.admin', 'แอดมิน')}
                                </span>
                              </td>
                              <td className="p-2 border-r border-dark-700/40 text-center">
                                <div className="flex items-center gap-1 justify-center">
                                  <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[10px] whitespace-nowrap">
                                    <CheckCircle size={11} className="text-emerald-500" />{t('pageui.support.status_done', 'จบงาน')}
                                  </span>
                                  <button
                                    onClick={() => toggleTicketExpand(row._id)}
                                    className={`px-2 py-1 rounded-lg border transition-all shrink-0 ${expandedTicketId === row._id ? 'bg-primary-500 text-white border-primary-500' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                                  >
                                    {expandedTicketId === row._id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                  </button>
                                </div>
                              </td>
                              <td className="p-2 text-[10px] font-bold text-slate-655 min-w-0 overflow-hidden">
                                <span className="truncate block max-w-[90px]" title={adminName}>{adminName}</span>
                                <span className="text-[9px] text-slate-500 font-normal">{formatTicketTime(row.resolved_at || row.updated_at)}</span>
                              </td>
                            </tr>
                            {expandedTicketId === row._id && (
                              <tr className="bg-slate-50/20">
                                <td colSpan={activeColCount} className="px-8 py-3 border-b border-dark-700/60">
                                  {row.assign_histories && row.assign_histories.length > 0 ? (
                                    <div className="flex justify-end">
                                      <div className="flex flex-col gap-2 bg-white/60 p-4 rounded-xl border border-slate-200/60 shadow-sm max-w-2xl w-full">
                                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('pageui.support.assign_history', 'ประวัติการจ่ายงาน')}</h4>
                                        <div className="relative border-l border-indigo-200/80 ml-2 pl-4 flex flex-col gap-3">
                                          {row.assign_histories.map((h: any, idx: number) => {
                                            const actorName = formatUserWithDisplayName(h.changed_by_id, 'System');
                                            const assigneeName = formatUserWithDisplayName(h.assign_to, 'Unassigned');
                                            let actionText = '';
                                            let dotColor = 'bg-slate-400';
                                            if (h.action === 'accept') { actionText = t('pageui.support.hist_accept', 'รับงานโดย: {actor}', { actor: actorName }); dotColor = 'bg-emerald-500 ring-4 ring-emerald-500/15'; }
                                            else if (h.action === 'edit') { actionText = t('pageui.support.hist_edit', 'เปลี่ยนผู้รับผิดชอบเป็น: {assignee} (โดย {actor})', { assignee: assigneeName, actor: actorName }); dotColor = 'bg-blue-500 ring-4 ring-blue-500/15'; }
                                            else if (h.action === 'close') { actionText = t('pageui.support.hist_close', 'ปิดงานโดย: {actor}', { actor: actorName }); dotColor = 'bg-slate-500 ring-4 ring-slate-500/15'; }
                                            return (
                                              <div key={h._id || idx} className="relative flex items-center justify-between gap-4 text-[10px]">
                                                <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border border-white bg-white flex items-center justify-center">
                                                  <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                                </span>
                                                <span className="font-bold text-slate-800">{actionText}</span>
                                                <span className="text-[9px] text-slate-400 font-normal shrink-0">{formatTicketTime(h.created_at)}</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-slate-400 italic text-[10px] text-center">{t('pageui.support.no_history', 'ไม่มีข้อมูลประวัติการดำเนินงาน')}</div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {/* Child pagination */}
                      {childTotalPages > 1 && (
                        <tr className="bg-slate-100/80 border-b border-dark-700/40">
                          <td colSpan={activeColCount} className="px-4 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
                                <span>{t('pageui.support.child_range', 'แสดง {from}–{to} จาก {total} รายการ', { from: childStart + 1, to: Math.min(childStart + childLimit, groupTickets.length), total: groupTickets.length })}</span>
                                <select value={childLimit} onChange={e => { setChildLimit(Number(e.target.value)); setChildPage(key, 1); }} className="ml-2 border border-slate-300 rounded px-1.5 py-0.5 text-[10px] bg-white text-slate-700 focus:outline-none">
                                  <option value={5}>5</option>
                                  <option value={10}>10</option>
                                  <option value={20}>20</option>
                                  <option value={50}>50</option>
                                </select>
                              </div>
                              <div className="flex items-center gap-1">
                                <button disabled={childPage <= 1} onClick={() => setChildPage(key, childPage - 1)} className="px-2 py-0.5 rounded border border-slate-300 text-[10px] text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">‹</button>
                                {Array.from({ length: childTotalPages }, (_, i) => i + 1).map(p => (
                                  <button key={p} onClick={() => setChildPage(key, p)} className={`px-2 py-0.5 rounded border text-[10px] font-bold ${childPage === p ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-300 text-slate-600 bg-white hover:bg-slate-50'}`}>{p}</button>
                                ))}
                                <button disabled={childPage >= childTotalPages} onClick={() => setChildPage(key, childPage + 1)} className="px-2 py-0.5 rounded border border-slate-300 text-[10px] text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">›</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </>
                        );
                      })()}
                    </React.Fragment>
                  );
                })
              ) : (
                /* Normal mode */
                paginatedTickets.length === 0 ? (
                  <tr>
                    <td colSpan={activeColCount} className="px-6 py-12 text-center text-slate-500 font-bold">
                      {t('pageui.support.no_jobs_for_filters', 'ไม่พบข้อมูลงานช่วยเหลือตามตัวกรองที่เลือก')}
                    </td>
                  </tr>
                ) : (
                paginatedTickets.map((row) => {
                  let rowBg = "bg-white hover:bg-slate-50/80";
                  if (row.job_status === 1) rowBg = "bg-amber-500/[0.04] hover:bg-amber-500/[0.08]";
                  if (row.job_status === 2) rowBg = "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06]";

                  const displayName = row.line_user_data?.display_name || 'Line User';
                  const nickname = row.line_user_data?.nickname || '';
                  const pictureUrl = row.line_user_data?.picture_url || `https://i.pravatar.cc/150?img=${row._id.slice(-2)}`;
                  const fullName = row.line_user_data?.full_name || '';
                  const detail = row.line_user_data?.detail || '';
                  const phone = row.line_user_data?.phone_number || 'N/A';
                  const contract = row.line_user_data?.contract_code || 'N/A';

                  const adminName = row.admin_user_data 
                    ? (row.admin_user_data.display_name || row.admin_user_data.username) 
                    : '-';
                  const adminSubtext = row.job_status === 2
                    ? ` / ${formatTicketTime(row.resolved_at || row.updated_at)}`
                    : row.job_status === 1 
                      ? ` / ${t('pageui.support.in_progress_sub', 'กำลังดำเนินการ')}`
                      : '';

                  return (
                    <React.Fragment key={row._id}>
                      <tr className={`transition-colors border-b border-dark-700 ${rowBg}`}>
                      {/* Avatar */}
                      {visibleCols.profile && (
                        <td className="p-3 border-r border-dark-700/40 text-center">
                          <img
                            src={pictureUrl}
                            alt="profile"
                            onClick={() => setNicknameInfoModal({ displayName, nickname, pictureUrl, isRegistered: !!fullName, fullName, detail, phone, contract })}
                            className={`w-12 h-12 rounded-full mx-auto object-cover cursor-pointer hover:opacity-80 transition-opacity ring-4 shadow-lg ${fullName ? 'ring-emerald-400 shadow-emerald-300' : 'ring-red-400 shadow-red-300'}`}
                          />
                        </td>
                      )}

                      {/* displayname / nickname & Member User ID */}
                      <td className="p-3 border-r border-dark-700/40 min-w-0 overflow-hidden">
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-1 min-w-0 group/nick">
                            <button
                              onClick={() => setNicknameInfoModal({ displayName, nickname, pictureUrl, isRegistered: !!fullName, fullName, detail, phone, contract })}
                              className="font-bold block truncate max-w-full text-left text-slate-800 hover:text-primary-600 transition-colors text-xs min-w-0 flex-1"
                              title={t('pageui.support.view_name', 'ดูข้อมูลชื่อ')}
                            >
                              {/* [FIX-20260814-CUSTOMERNAME] see the list card above.
                                  `nickname`/`displayName` stay raw for the modals below —
                                  an operator must still see and edit the stored value. */}
                              {customerName(row.line_user_data)}
                            </button>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <button
                                onClick={() => setEditModal({ isOpen: true, ticket: row, nickname, ...parseDetail(detail) })}
                                className="p-0.5 text-slate-400 hover:text-primary-500 transition-colors"
                                title={t('pageui.support.edit_nickname_detail', 'แก้ไขชื่อเรียก / รายละเอียด')}
                              >
                                <Edit2 size={11} />
                              </button>
                            </div>
                          </div>
                          {row.line_user_data?.line_user_id && (
                            <CopyableCell
                              text={row.line_user_data.line_user_id}
                              id={row._id}
                              field="lineUserId"
                              classes="text-[10px] font-mono text-slate-500 block truncate max-w-full"
                            />
                          )}
                        </div>
                      </td>

                      {/* ข้อมูลลูกค้า (Line OA / ชื่อ-สกุล / เบอร์) */}
                      {visibleCols.customerInfo && (
                        <td className="p-3 border-r border-dark-700/40 min-w-0 overflow-hidden">
                          <div className="flex flex-col gap-1.5 min-w-0">
                            {/* Line OA Name */}
                            {(() => {
                              const hookId = row.hook_id || row.line_oa_hook_id;
                              const hook = hooks.find((h) => String(h._id) === String(hookId));
                              const lineOaName = hook?.line_oa_name || (row as any).line_oa_name || '-';
                              return (
                                <span className="font-semibold text-emerald-600 text-xs truncate max-w-full" title={lineOaName}>
                                  {lineOaName}
                                </span>
                              );
                            })()}
                            {fullName ? (
                              <CopyableCell text={fullName} id={row._id} field="fullName" classes="font-bold block text-slate-800 truncate max-w-full" />
                            ) : (() => {
                                const { detailName: dn, detailPhone: dp } = parseDetail(detail);
                                const hasAny = dn || dp;
                                return (
                                  <div className="flex flex-col gap-0.5">
                                    {hasAny ? (
                                      <>
                                        {dn ? <CopyableCell text={dn} id={row._id} field="detail-name" classes="font-bold text-slate-800 truncate max-w-full" /> : null}
                                        {dp ? <CopyableCell text={dp} id={row._id} field="detail-phone" classes="font-bold text-slate-800 truncate max-w-full" /> : null}
                                      </>
                                    ) : (
                                      <span className="text-slate-400 italic text-[10px]">{t('pageui.support.unregistered_marker', '-(ไม่ได้ลงทะเบียน)-')}</span>
                                    )}
                                    <button
                                      onClick={() => setEditModal({ isOpen: true, ticket: row, nickname, ...parseDetail(detail) })}
                                      className="p-0.5 text-slate-400 hover:text-primary-500 transition-colors self-start"
                                      title={t('pageui.support.edit_customer_detail', 'แก้ไขรายละเอียดลูกค้า')}
                                    >
                                      <Edit2 size={11} />
                                    </button>
                                  </div>
                                );
                              })()
                            }
                            <CopyableCell text={phone} id={row._id} field="phone" classes="font-bold text-slate-800 truncate max-w-full" />
                          </div>
                        </td>
                      )}

                      {/* Category */}
                      {visibleCols.category && (
                        <td className="p-3 border-r border-dark-700/40 text-center min-w-0 overflow-hidden">
                          <div className="truncate max-w-full">{getCategoryBadge(row.category)}</div>
                        </td>
                      )}

                      {/* Need with Info Icon */}
                      {visibleCols.needs && (
                        <td className="p-3 border-r border-dark-700/40 text-slate-800 font-medium min-w-0 overflow-hidden">
                          <div className="flex items-center justify-between gap-1.5 group/need min-w-0">
                            <span className="truncate flex-1" title={row.need_detail || ''}>{row.need_detail || '-'}</span>
                            <button
                              onClick={() => setSelectedTicketForInfo(row)}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 transition-colors focus:outline-none flex-shrink-0 border border-slate-200 hover:border-emerald-400 rounded-lg bg-white hover:bg-emerald-50"
                              title={t('pageui.support.view_message_detail', 'ดูรายละเอียดข้อความ')}
                            >
                              <Info size={16} />
                            </button>
                          </div>
                        </td>
                      )}

                      {/* Image Attached Button */}
                      <td className="p-3 border-r border-dark-700/40 text-center">
                        {row.attached_files && row.attached_files.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setSelectedTicketForGallery(row)}
                            className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center mx-auto"
                            title={t('pageui.support.view_attachments_n', 'ดูรูปภาพแนบ ({n} ภาพ)', { n: row.attached_files.length })}
                          >
                            <ImageIcon size={14} />
                          </button>
                        ) : (
                          <span className="text-slate-400 italic font-normal text-[10px]">-</span>
                        )}
                      </td>

                      {/* Date Time */}
                      <td className="p-3 border-r border-dark-700/40 text-slate-655 font-bold text-[10px] leading-relaxed min-w-0 overflow-hidden">
                        <div className="flex flex-col min-w-0">
                          {row.job_status === 0 ? (
                            <span className="truncate" title={`${t('pageui.support.ticket_created', 'ticket สร้างเมื่อ :')} ${formatTicketTime(row.created_at)}`}>
                              {t('pageui.support.ticket_created', 'ticket สร้างเมื่อ :')} {formatTicketTime(row.created_at)}
                            </span>
                          ) : (
                            <>
                              <span className="truncate" title={`${t('pageui.support.last_updated', 'อัพเดทล่าสุด :')} ${formatTicketTime(row.updated_at || row.created_at)}`}>
                                {t('pageui.support.last_updated', 'อัพเดทล่าสุด :')} {formatTicketTime(row.updated_at || row.created_at)}
                              </span>
                              <span className="text-[9px] text-slate-500 font-normal truncate" title={`${t('pageui.support.ticket_created', 'ticket สร้างเมื่อ :')} (${formatTicketTime(row.created_at)})`}>
                                {t('pageui.support.ticket_created', 'ticket สร้างเมื่อ :')} ({formatTicketTime(row.created_at)})
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Chat Status */}
                      <td className="p-3 border-r border-dark-700/40 text-center min-w-0 overflow-hidden">
                        {row.job_status === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded border border-purple-200 shadow-sm whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                            {t('ticket.chat_status_bot')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-sky-100 text-sky-700 px-2 py-0.5 rounded border border-sky-200 shadow-sm whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                            {t('ticket.chat_status_admin')}
                          </span>
                        )}
                      </td>

                      {/* Job Status / Button Action */}
                      <td className="p-3 border-r border-dark-700/40 text-center min-w-0 overflow-hidden">
                        <div className="flex items-center justify-center gap-1">
                          {row.job_status === 0 && (
                            <button 
                              onClick={() => triggerJobAction(row, 1)}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1.5 rounded-lg text-[10px] transition-all hover:scale-105 active:scale-95 shadow-md w-full whitespace-nowrap"
                            >
                              {t('pageui.support.accept', 'รับงาน')}
                            </button>
                          )}
                          {row.job_status === 1 && (
                            <div className="flex items-center gap-1 w-full justify-center">
                              <button 
                                onClick={() => canCloseJob(row) && triggerJobAction(row, 2)}
                                disabled={!canCloseJob(row)}
                                title={canCloseJob(row) ? t('pageui.support.status_done', 'จบงาน') : t('pageui.support.own_cases_only', 'กดได้เฉพาะเคสตนเอง')}
                                className={`font-bold px-2.5 py-1.5 rounded-lg text-[10px] transition-all w-full whitespace-nowrap ${
                                  canCloseJob(row)
                                    ? 'bg-amber-500 hover:bg-amber-600 text-white hover:scale-105 active:scale-95 shadow-md cursor-pointer'
                                    : 'bg-amber-500/50 text-white/70 blur-[1.5px] opacity-50 cursor-not-allowed pointer-events-none select-none'
                                }`}
                              >
                                {t('pageui.support.status_done', 'จบงาน')}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleTicketExpand(row._id)}
                                className={`px-3 py-1.5 rounded-lg border transition-all shrink-0 ${expandedTicketId === row._id ? 'bg-primary-500 text-white border-primary-500 shadow-sm hover:bg-primary-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'}`}
                                title={expandedTicketId === row._id ? t('pageui.support.collapse_history', 'ย่อประวัติการจ่ายงาน') : t('pageui.support.expand_history', 'ขยายประวัติการจ่ายงาน')}
                              >
                                {expandedTicketId === row._id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                            </div>
                          )}
                          {row.job_status === 2 && (
                            <div className="flex items-center gap-1 justify-center py-1.5">
                              <span className="inline-flex items-center justify-center gap-1 text-emerald-600 font-bold text-[10px] whitespace-nowrap">
                                <CheckCircle size={12} className="text-emerald-500" />
                                {t('pageui.support.status_done', 'จบงาน')}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleTicketExpand(row._id)}
                                className={`px-3 py-1.5 rounded-lg border transition-all shrink-0 ${expandedTicketId === row._id ? 'bg-primary-500 text-white border-primary-500 shadow-sm hover:bg-primary-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'}`}
                                title={expandedTicketId === row._id ? t('pageui.support.collapse_history', 'ย่อประวัติการจ่ายงาน') : t('pageui.support.expand_history', 'ขยายประวัติการจ่ายงาน')}
                              >
                                {expandedTicketId === row._id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Admin Name with Edit Button */}
                      <td className="p-3 text-slate-655 font-bold text-[10px] min-w-0 overflow-hidden">
                        <div className="flex items-center justify-between gap-2 group/operator w-full min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <div className="flex flex-col min-w-0">
                              <span className="truncate max-w-[90px]" title={adminName}>{adminName}</span>
                              {adminSubtext && (
                                <span className="text-[9px] text-slate-500 font-normal mt-0.5 whitespace-pre-wrap break-words max-w-[90px]" title={adminSubtext.trim()}>
                                  {adminSubtext.trim()}
                                </span>
                              )}
                            </div>
                            {(row.job_status === 1 || row.job_status === 2) && (
                              <button
                                type="button"
                                onClick={() => toggleTicketExpand(row._id)}
                                className={`px-3 py-1 rounded-lg border transition-all shrink-0 ${expandedTicketId === row._id ? 'bg-primary-500 text-white border-primary-500 shadow-sm hover:bg-primary-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'}`}
                                title={expandedTicketId === row._id ? t('pageui.support.collapse_history', 'ย่อประวัติการจ่ายงาน') : t('pageui.support.expand_history', 'ขยายประวัติการจ่ายงาน')}
                              >
                                {expandedTicketId === row._id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            )}
                          </div>
                          {canEditAssignee(row) && (
                            <button 
                              onClick={() => {
                                setOperatorEditModal({ isOpen: true, ticket: row });
                                setSelectedOperatorId(row.admin_user_id || '');
                              }}
                              className="p-1 text-emerald-600 hover:text-emerald-500 focus:outline-none transition-colors flex-shrink-0"
                              title={t('pageui.support.change_operator', 'เปลี่ยนผู้ทำรายการ')}
                            >
                              <Edit2 size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedTicketId === row._id && (
                      <tr className="bg-slate-50/30">
                        <td colSpan={activeColCount} className="px-6 py-4 border-b border-dark-700/60">
                          {row.assign_histories && row.assign_histories.length > 0 ? (
                            <div className="flex justify-end">
                              <div className="flex flex-col gap-2 bg-white/60 p-4 rounded-xl border border-slate-200/60 shadow-sm max-w-2xl w-full">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('pageui.support.assign_history_bi', 'ประวัติการจ่ายงาน / Assignment History')}</h4>
                                <div className="relative border-l border-indigo-200/80 ml-2 pl-4 flex flex-col gap-3">
                                  {row.assign_histories.map((h: any, idx: number) => {
                                    const actorName = formatUserWithDisplayName(h.changed_by_id, 'System');
                                    const assigneeName = formatUserWithDisplayName(h.assign_to, 'Unassigned');
                                    const timeStr = formatTicketTime(h.created_at);
                                    let actionText = '';
                                    let dotColor = 'bg-slate-400';

                                    if (h.action === 'accept') {
                                      actionText = t('pageui.support.hist_accept', 'รับงานโดย: {actor}', { actor: actorName });
                                      dotColor = 'bg-emerald-500 ring-4 ring-emerald-500/15';
                                    } else if (h.action === 'edit') {
                                      actionText = t('pageui.support.hist_edit', 'เปลี่ยนผู้รับผิดชอบเป็น: {assignee} (โดย {actor})', { assignee: assigneeName, actor: actorName });
                                      dotColor = 'bg-blue-500 ring-4 ring-blue-500/15';
                                    } else if (h.action === 'close') {
                                      actionText = t('pageui.support.hist_close', 'ปิดงานโดย: {actor}', { actor: actorName });
                                      dotColor = 'bg-slate-500 ring-4 ring-slate-500/15';
                                    }

                                    return (
                                      <div key={h._id || idx} className="relative flex items-center justify-between gap-4 text-[10px]">
                                        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border border-white bg-white flex items-center justify-center">
                                          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                        </span>
                                        <div className="flex flex-col">
                                          <span className="font-bold text-slate-800">{actionText}</span>
                                        </div>
                                        <span className="text-[9px] text-slate-400 font-normal shrink-0">{timeStr}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-slate-400 italic text-[10px] p-3 text-center">
                              {t('pageui.support.no_history', 'ไม่มีข้อมูลประวัติการดำเนินงาน')}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })
                )
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View (Card format, visible on small/medium screens) */}
        <div className="block lg:hidden divide-y divide-dark-700">
          {completedLoading ? (
            <div className="px-6 py-12 text-center text-slate-500 font-bold">
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="animate-spin text-emerald-500" size={18} />
                {t('pageui.support.loading_done', 'กำลังโหลดข้อมูลงานที่จบแล้ว...')}
              </div>
            </div>
          ) : paginatedTickets.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 font-bold">
              {t('pageui.support.no_jobs_for_filters', 'ไม่พบข้อมูลงานช่วยเหลือตามตัวกรองที่เลือก')}
            </div>
          ) : (
            paginatedTickets.map((row) => {
              let cardBg = "bg-white";
              if (row.job_status === 1) cardBg = "bg-amber-500/[0.02]";
              if (row.job_status === 2) cardBg = "bg-emerald-500/[0.02]";

              const displayName = row.line_user_data?.display_name || 'Line User';
              const pictureUrl = row.line_user_data?.picture_url || `https://i.pravatar.cc/150?img=${row._id.slice(-2)}`;
              const fullName = row.line_user_data?.full_name || '-(ไม่ได้ลงทะเบียน)-';
              const phone = row.line_user_data?.phone_number || 'N/A';
              const contract = row.line_user_data?.contract_code || 'N/A';

              const adminName = row.admin_user_data 
                ? (row.admin_user_data.display_name || row.admin_user_data.username) 
                : '-';

              return (
                <div key={row._id} className={`p-4 flex flex-col gap-3 transition-colors ${cardBg}`}>
                  {/* Top Bar: Profile & Statuses */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <img 
                        src={pictureUrl} 
                        alt="profile" 
                        className="w-10 h-10 rounded-full border border-slate-300 shadow-sm object-cover"
                      />
                      <div className="flex flex-col">
                        <span className="font-bold text-sm text-slate-900 leading-tight">{displayName}</span>
                        {row.job_status === 0 ? (
                          <span className="text-[9px] text-slate-500 mt-0.5">{t('pageui.support.ticket_created', 'ticket สร้างเมื่อ :')} {formatTicketTime(row.created_at)}</span>
                        ) : (
                          <>
                            <span className="text-[9px] text-slate-600 mt-0.5">{t('pageui.support.last_updated', 'อัพเดทล่าสุด :')} {formatTicketTime(row.updated_at || row.created_at)}</span>
                            <span className="text-[9px] text-slate-400">{t('pageui.support.ticket_created', 'ticket สร้างเมื่อ :')} ({formatTicketTime(row.created_at)})</span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-1">
                      {getCategoryBadge(row.category)}
                      {row.job_status !== 0 ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded border border-sky-200 shadow-sm whitespace-nowrap">
                          {t('ticket.chat_status_admin')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded border border-purple-200 shadow-sm whitespace-nowrap">
                          {t('ticket.chat_status_bot')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Customer Information Grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-slate-50 p-2.5 rounded-lg border border-slate-150 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 block">{t('pageui.support.full_name', 'ชื่อ-นามสกุล')}</span>
                      <CopyableCell text={fullName} id={row._id} field="fullName" classes="font-bold text-slate-800" />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">{t('pageui.support.phone', 'เบอร์โทร')}</span>
                      <CopyableCell text={phone} id={row._id} field="phone" classes="font-bold text-slate-800" />
                    </div>
                    <div className="col-span-2 pt-1 border-t border-slate-200/50">
                      <span className="text-[10px] text-slate-500 block">ID</span>
                      <CopyableCell text={contract} id={row._id} field="contract" classes="font-mono text-xs font-bold text-slate-700" />
                    </div>
                  </div>

                  {/* Need/Content details */}
                  <div className="text-xs text-slate-800 font-medium">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 block">{t('pageui.support.col_need', 'ความต้องการ')}</span>
                      <button
                        onClick={() => setSelectedTicketForInfo(row)}
                        className="text-[10px] text-emerald-600 hover:text-emerald-500 font-bold flex items-center gap-0.5 border border-emerald-300 hover:border-emerald-500 rounded-lg px-1.5 py-0.5 bg-white hover:bg-emerald-50"
                      >
                        <Info size={11} />
                        {t('pageui.support.see_all', 'ดูทั้งหมด')}
                      </button>
                    </div>
                    <p className="bg-white p-2 rounded border border-slate-200 mt-0.5 shadow-sm text-slate-700 break-words leading-relaxed line-clamp-3">{row.need_detail}</p>
                  </div>

                  {/* Actions & Assignee row */}
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 mt-1">
                    {/* Attachments */}
                    <div>
                      {row.attached_files && row.attached_files.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setSelectedTicketForGallery(row)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-xs font-bold shadow-sm shadow-emerald-500/10"
                        >
                          <ImageIcon size={12} />
                          {t('pageui.support.attachments_n', 'รูปภาพแนบ ({n})', { n: row.attached_files.length })}
                        </button>
                      ) : (
                        <div className="text-slate-400 italic text-xs">
                          {t('pageui.support.no_evidence', 'ไม่มีรูปภาพหลักฐาน')}
                        </div>
                      )}
                    </div>

                    {/* Action button */}
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-[9px] text-slate-500">{t('pageui.support.operator', 'ผู้ทำรายการ')}</span>
                          {canEditAssignee(row) && (
                            <button 
                              onClick={() => {
                                setOperatorEditModal({ isOpen: true, ticket: row });
                                setSelectedOperatorId(row.admin_user_id || '');
                              }}
                              className="text-emerald-600 hover:text-emerald-500 p-0.5 focus:outline-none transition-colors"
                              title={t('pageui.support.change_operator', 'เปลี่ยนผู้ทำรายการ')}
                            >
                              <Edit2 size={10} />
                            </button>
                          )}
                        </div>
                        <span className="text-[10px] font-bold text-slate-700 max-w-[100px] truncate block" title={adminName}>{adminName}</span>
                      </div>
                      
                      <div className="min-w-[80px]">
                        {row.job_status === 0 && (
                          <button 
                            onClick={() => triggerJobAction(row, 1)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-all shadow-md w-full whitespace-nowrap"
                          >
                            {t('pageui.support.accept', 'รับงาน')}
                          </button>
                        )}
                        {row.job_status === 1 && (
                          <div className="flex items-center gap-1.5 justify-end">
                            <button 
                              onClick={() => canCloseJob(row) && triggerJobAction(row, 2)}
                              disabled={!canCloseJob(row)}
                              title={canCloseJob(row) ? t('pageui.support.status_done', 'จบงาน') : t('pageui.support.own_cases_only', 'กดได้เฉพาะเคสตนเอง')}
                              className={`font-bold px-3 py-1.5 rounded-lg text-xs transition-all w-full whitespace-nowrap ${
                                canCloseJob(row)
                                  ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-md cursor-pointer'
                                  : 'bg-amber-500/50 text-white/70 blur-[1.5px] opacity-50 cursor-not-allowed pointer-events-none select-none'
                              }`}
                            >
                              {t('pageui.support.status_done', 'จบงาน')}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleTicketExpand(row._id)}
                              className={`px-3.5 py-1.5 rounded-lg border transition-all shrink-0 ${expandedTicketId === row._id ? 'bg-primary-500 text-white border-primary-500 shadow-sm hover:bg-primary-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'}`}
                            >
                              {expandedTicketId === row._id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        )}
                        {row.job_status === 2 && (
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="inline-flex items-center justify-center gap-1 text-emerald-600 font-bold text-xs whitespace-nowrap py-1">
                              <CheckCircle size={14} className="text-emerald-500" />
                              {t('pageui.support.status_done', 'จบงาน')}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleTicketExpand(row._id)}
                              className={`px-3.5 py-1.5 rounded-lg border transition-all shrink-0 ${expandedTicketId === row._id ? 'bg-primary-500 text-white border-primary-500 shadow-sm hover:bg-primary-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'}`}
                            >
                              {expandedTicketId === row._id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content for Mobile View */}
                  {expandedTicketId === row._id && (
                    <div className="bg-slate-50/50 border-t border-slate-100/60 px-3 py-2 text-[10px] rounded-b-lg flex justify-center">
                      {row.assign_histories && row.assign_histories.length > 0 ? (
                        <div className="flex flex-col gap-1.5 w-full max-w-sm">
                          <span className="font-bold text-slate-400 uppercase tracking-wide text-[9px]">{t('pageui.support.handling_history_bi', 'ประวัติการดำเนินงาน (Assignment History)')}</span>
                          <div className="relative border-l border-indigo-200/80 ml-2 pl-3 flex flex-col gap-2.5">
                            {row.assign_histories.map((h: any, idx: number) => {
                              const actorName = formatUserWithDisplayName(h.changed_by_id, 'System');
                              const assigneeName = formatUserWithDisplayName(h.assign_to, 'Unassigned');
                              const timeStr = formatTicketTime(h.created_at);
                              let actionText = '';
                              let dotColor = 'bg-slate-400';

                              if (h.action === 'accept') {
                                actionText = t('pageui.support.hist_accept', 'รับงานโดย: {actor}', { actor: actorName });
                                dotColor = 'bg-emerald-500';
                              } else if (h.action === 'edit') {
                                actionText = t('pageui.support.hist_edit', 'เปลี่ยนผู้รับผิดชอบเป็น: {assignee} (โดย {actor})', { assignee: assigneeName, actor: actorName });
                                dotColor = 'bg-blue-500';
                              } else if (h.action === 'close') {
                                actionText = t('pageui.support.hist_close', 'ปิดงานโดย: {actor}', { actor: actorName });
                                dotColor = 'bg-slate-500';
                              }

                              return (
                                <div key={h._id || idx} className="relative flex flex-col text-[10px]">
                                  <span className="absolute -left-[16px] top-1 w-2 h-2 rounded-full border border-white bg-white flex items-center justify-center">
                                    <span className={`w-1 h-1 rounded-full ${dotColor}`} />
                                  </span>
                                  <span className="font-bold text-slate-800 leading-tight">{actionText}</span>
                                  <span className="text-[8px] text-slate-400 mt-0.5">{timeStr}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="text-slate-400 italic text-center py-2">
                          {t('pageui.support.no_history', 'ไม่มีข้อมูลประวัติการดำเนินงาน')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pagination Panel */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-4 py-3 border-t border-dark-700 bg-dark-900">
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-655 font-bold">
              {filterJobStatus === 'จบงาน'
                ? t('pageui.support.page_range', 'แสดง {from} ถึง {to} จากทั้งหมด {total} รายการ', { from: completedServerTotal === 0 ? 0 : (completedServerPage - 1) * itemsPerPage + 1, to: Math.min(completedServerTotal, completedServerPage * itemsPerPage), total: completedServerTotal })
                : t('pageui.support.page_range', 'แสดง {from} ถึง {to} จากทั้งหมด {total} รายการ', { from: Math.min(processedTickets.length, (currentPage - 1) * itemsPerPage + 1), to: Math.min(processedTickets.length, currentPage * itemsPerPage), total: processedTickets.length })
              }
            </span>
            
            {/* Limit per page (Footer) */}
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-xs text-slate-500">{t('pageui.support.per_page_colon', 'แสดงต่อหน้า:')}</span>
              <select 
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="bg-dark-800 border border-dark-600 px-2 py-1 rounded text-slate-900 text-xs focus:ring-1 focus:ring-primary-500 outline-none cursor-pointer"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => filterJobStatus === 'จบงาน'
                ? setCompletedServerPage(prev => Math.max(1, prev - 1))
                : setCurrentPage(prev => Math.max(1, prev - 1))
              }
              disabled={filterJobStatus === 'จบงาน' ? completedServerPage === 1 : currentPage === 1}
              className="p-2 rounded-lg border border-dark-600 text-slate-500 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-slate-700 font-bold px-2 self-center">
              {filterJobStatus === 'จบงาน' ? completedServerPage : currentPage} / {totalPages}
            </span>
            <button
              onClick={() => filterJobStatus === 'จบงาน'
                ? setCompletedServerPage(prev => Math.min(totalPages, prev + 1))
                : setCurrentPage(prev => Math.min(totalPages, prev + 1))
              }
              disabled={filterJobStatus === 'จบงาน' ? completedServerPage === totalPages : currentPage === totalPages}
              className="p-2 rounded-lg border border-dark-600 text-slate-500 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
      </div>
      )}
      </div>

      {/* Shared Modals (Work in both Compact View and Desktop Mode) */}
      {selectedTicketForInfo && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex justify-between items-center bg-slate-50 border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Info size={18} className="text-emerald-500 flex-shrink-0" />
                {t('pageui.support.need_detail_title', 'รายละเอียดความต้องการช่วยเหลือ')}
              </h3>
              <button
                onClick={() => setSelectedTicketForInfo(null)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg border border-red-500 bg-white hover:bg-red-50 text-red-500 transition-colors text-xs font-bold shadow-sm"
              >
                <X size={13} />
                {t('tags_modal.close')}
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 flex flex-col gap-4 text-xs text-slate-855 font-bold">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-slate-500 font-bold block mb-0.5">displayname</span>
                  <CopyableCell 
                    text={selectedTicketForInfo.line_user_data?.display_name || 'Line User'} 
                    id={selectedTicketForInfo._id} 
                    field="modal-displayname" 
                    classes="font-semibold text-slate-800" 
                  />
                </div>
                <div>
                  <span className="text-slate-500 font-bold block mb-0.5">{t('pageui.support.full_name', 'ชื่อ-นามสกุล')}</span>
                  <CopyableCell 
                    text={selectedTicketForInfo.line_user_data?.full_name || '-(ไม่ได้ลงทะเบียน)-'} 
                    id={selectedTicketForInfo._id} 
                    field="modal-fullname" 
                    classes="font-semibold text-slate-800" 
                  />
                </div>
                <div>
                  <span className="text-slate-500 font-bold block mb-0.5">{t('pageui.support.phone', 'เบอร์โทร')}</span>
                  <CopyableCell 
                    text={selectedTicketForInfo.line_user_data?.phone_number || 'N/A'} 
                    id={selectedTicketForInfo._id} 
                    field="modal-phone" 
                    classes="font-semibold text-slate-800" 
                  />
                </div>
                <div>
                  {/* contract_code from the user record — the registered
                      contract, not the one typed into the ticket's detail. */}
                  <span className="text-slate-500 font-bold block mb-0.5">ID</span>
                  <CopyableCell
                    text={selectedTicketForInfo.line_user_data?.contract_code || 'N/A'}
                    id={selectedTicketForInfo._id} 
                    field="modal-contract" 
                    classes="font-mono text-slate-800" 
                  />
                </div>
                <div className="col-span-2 pt-1 border-t border-slate-100">
                  <span className="text-slate-500 font-bold block mb-0.5">Member User ID</span>
                  {selectedTicketForInfo.line_user_data?.line_user_id ? (
                    <CopyableCell
                      text={selectedTicketForInfo.line_user_data.line_user_id}
                      id={selectedTicketForInfo._id}
                      field="modal-lineuserid"
                      classes="font-mono text-slate-800"
                    />
                  ) : (
                    <span className="text-slate-400 italic">{t('pageui.support.no_member_id', '-(ไม่พบ Member User ID)-')}</span>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-slate-500 font-bold block">{t('pageui.support.support_need', 'ความต้องการช่วยเหลือ')}</span>
                  {selectedTicketForInfo.need_detail && (
                    <button
                      onClick={() => handleCopy(selectedTicketForInfo.need_detail || '', selectedTicketForInfo._id, 'modal-need')}
                      className="text-slate-400 hover:text-primary-600 transition-colors p-0.5 focus:outline-none flex items-center gap-1 text-[10px] font-bold"
                      title={t('pageui.support.copy_detail', 'คัดลอกรายละเอียด')}
                    >
                      {copiedId?.id === selectedTicketForInfo._id && copiedId?.field === 'modal-need' ? (
                        <>
                          <Check size={11} className="text-emerald-600" />
                          <span className="text-emerald-600">{t('pageui.support.copied', 'คัดลอกแล้ว')}</span>
                        </>
                      ) : (
                        <>
                          <Copy size={11} />
                          <span>{t('pageui.support.copy', 'คัดลอก')}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 leading-relaxed font-normal break-words whitespace-pre-wrap">
                  {selectedTicketForInfo.need_detail}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-3">
                <div>
                  <span className="text-slate-500 font-bold block mb-0.5">{t('pageui.support.category', 'หมวดหมู่')}</span>
                  <div>{getCategoryBadge(selectedTicketForInfo.category)}</div>
                </div>
                <div>
                  <span className="text-slate-500 font-bold block mb-0.5">{t('pageui.support.col_datetime', 'วัน-เวลา')}</span>
                  <span className="font-semibold text-slate-605">{formatTicketTime(selectedTicketForInfo.created_at)}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Action Confirmation Modal (รับงาน / จบงาน) */}
      {confirmActionModal.isOpen && confirmActionModal.ticket && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex justify-between items-center bg-slate-50 border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Briefcase size={18} className="text-emerald-500 flex-shrink-0" />
                {t('pageui.support.confirm_action_title', 'ยืนยันการทำรายการ')}
              </h3>
              <button 
                onClick={() => setConfirmActionModal({ isOpen: false, ticket: null, targetStatus: 1 })}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-all focus:outline-none"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 flex flex-col gap-4 text-xs text-slate-855 font-bold">
              <p className="text-sm text-slate-700 font-normal leading-relaxed">
                {t('pageui.support.confirm_q_a', 'คุณต้องการยืนยันการ')} <span className={`font-bold ${confirmActionModal.targetStatus === 2 ? 'text-amber-500' : 'text-emerald-500'}`}>{confirmActionModal.targetStatus === 2 ? t('pageui.support.status_done', 'จบงาน') : t('pageui.support.accept_support', 'รับงานช่วยเหลือ')}</span> {t('pageui.support.confirm_q_b', 'สำหรับลูกค้าท่านนี้ใช่หรือไม่?')}
              </p>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col gap-2">
                <div>
                  <span className="text-slate-500 font-bold block mb-0.5">LINE User (displayname)</span>
                  <span className="text-slate-800 font-bold text-sm">{confirmActionModal.ticket.line_user_data?.display_name || 'Line User'}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold block mb-0.5">{t('pageui.support.customer_full_name', 'ชื่อเต็มลูกค้า')}</span>
                  <span className="text-slate-800 font-bold text-sm">
                    {confirmActionModal.ticket.line_user_data?.full_name || t('pageui.support.not_registered_short', 'ไม่ได้ลงทะเบียน')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold block mb-0.5">ID</span>
                  <span className="text-slate-700 font-mono text-xs">{confirmActionModal.ticket.line_user_data?.contract_code || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button 
                onClick={() => setConfirmActionModal({ isOpen: false, ticket: null, targetStatus: 1 })}
                className="bg-slate-200 hover:bg-slate-350 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs transition-all shadow-sm focus:outline-none"
              >
                {t('pageui.support.cancel', 'ยกเลิก')}
              </button>
              <button 
                onClick={executeJobAction}
                disabled={actionInProgress || loading}
                className={`text-white font-bold px-4 py-2 rounded-lg text-xs transition-all shadow-sm focus:outline-none flex items-center gap-1.5 ${
                  confirmActionModal.targetStatus === 2 
                    ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/10' 
                    : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/10'
                } disabled:opacity-50 cursor-pointer`}
              >
                {loading && <RefreshCw size={12} className="animate-spin" />}
                {loading ? t('pageui.support.saving', 'กำลังบันทึก...') : t('pageui.support.confirm_save', 'ยืนยันการบันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Operator Edit Assignment Modal */}
      {operatorEditModal.isOpen && operatorEditModal.ticket && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 pt-[10vh]">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm min-h-[420px] flex flex-col overflow-visible animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex justify-between items-center bg-slate-50 border-b border-slate-200 px-5 py-4 rounded-t-xl">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <UserIcon size={18} className="text-emerald-500 flex-shrink-0" />
                {t('pageui.support.assign_title', 'มอบหมายผู้รับผิดชอบงาน')}
              </h3>
              <button 
                onClick={() => setOperatorEditModal({ isOpen: false, ticket: null })}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-all focus:outline-none"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 flex flex-col gap-4 text-xs text-slate-855 font-bold flex-grow">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-1">
                <div>
                  <span className="text-slate-500 font-bold block text-[10px]">LINE User (displayname)</span>
                  <span className="text-slate-800 text-xs">{operatorEditModal.ticket.line_user_data?.display_name || 'Line User'}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold block text-[10px]">{t('pageui.support.current_assignee', 'ผู้รับผิดชอบปัจจุบัน')}</span>
                  <span className="text-slate-800 text-xs">
                    {operatorEditModal.ticket.admin_user_data 
                      ? (operatorEditModal.ticket.admin_user_data.display_name || operatorEditModal.ticket.admin_user_data.username) 
                      : '-'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 text-xs font-bold mb-1">{t('pageui.support.pick_new_assignee', 'เลือกผู้รับผิดชอบใหม่')}</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsAssigneeDropdownOpen(prev => !prev)}
                    className="w-full bg-white border border-slate-300 px-3 py-2 rounded-lg text-slate-900 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all cursor-pointer flex items-center justify-between text-left shadow-sm min-h-[46px]"
                  >
                    <span>
                      {selectedOperatorId ? (() => {
                        const selectedUser = eligibleOperators.find(u => u.id === selectedOperatorId);
                        if (!selectedUser) return t('pageui.support.no_assignee', '-- ไม่ระบุผู้รับผิดชอบ --');
                        return (
                          <span className="flex flex-col gap-0.5 leading-tight">
                            <span className="font-bold text-slate-800">username : {selectedUser.username || '-'}</span>
                            <span className="text-slate-500 text-[10px]">name : {selectedUser.display_name || '-'}</span>
                          </span>
                        );
                      })() : (
                        <span className="text-slate-500">{t('pageui.support.no_assignee', '-- ไม่ระบุผู้รับผิดชอบ --')}</span>
                      )}
                    </span>
                    <span className="text-slate-400 shrink-0 select-none">
                      {isAssigneeDropdownOpen ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </span>
                  </button>

                  {isAssigneeDropdownOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-[55] bg-transparent" 
                        onClick={() => setIsAssigneeDropdownOpen(false)}
                      />
                      <div className="absolute z-[60] mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-y-auto p-1.5 flex flex-col gap-1 scrollbar-thin" style={{ maxHeight: 'min(420px, 45vh)' }}>
                        {/* Search Input */}
                        <div className="sticky top-0 bg-white pb-1.5 pt-0.5 px-1 z-10 border-b border-slate-100 mb-1">
                          <input
                            ref={assigneeSearchInputRef}
                            type="text"
                            value={assigneeSearchQuery}
                            onChange={(e) => setAssigneeSearchQuery(e.target.value)}
                            placeholder={t('pageui.support.search_assignee', 'ค้นหาชื่อผู้รับผิดชอบ...')}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:ring-1 focus:ring-emerald-500 focus:border-transparent outline-none transition-all font-normal"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOperatorId('');
                            setIsAssigneeDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-100 transition-colors text-xs font-bold ${!selectedOperatorId ? 'bg-slate-50 text-emerald-600' : 'text-slate-500'}`}
                        >
                          {t('pageui.support.no_assignee', '-- ไม่ระบุผู้รับผิดชอบ --')}
                        </button>
                        {filteredOperators.length === 0 ? (
                          <div className="text-center text-slate-400 text-xs py-3 font-normal">
                            {t('pageui.support.no_assignee_found', 'ไม่พบข้อมูลผู้รับผิดชอบ')}
                          </div>
                        ) : (
                          filteredOperators.map(user => (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => {
                                setSelectedOperatorId(user.id);
                                setIsAssigneeDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-lg hover:bg-emerald-50/50 hover:text-emerald-700 transition-colors text-xs flex flex-col gap-0.5 leading-tight ${selectedOperatorId === user.id ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/40 shadow-sm' : 'text-slate-700 border border-transparent'}`}
                            >
                              <span className="font-bold text-slate-800">username : {user.username || '-'}</span>
                              <span className="text-slate-500 text-[10px]">name : {user.display_name || '-'}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex justify-end gap-2 rounded-b-xl">
              <button 
                onClick={() => setOperatorEditModal({ isOpen: false, ticket: null })}
                className="bg-slate-200 hover:bg-slate-350 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs transition-all shadow-sm focus:outline-none"
              >
                {t('pageui.support.cancel', 'ยกเลิก')}
              </button>
              <button 
                onClick={handleOperatorChange}
                disabled={!selectedOperatorId || loading}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-4 py-2 rounded-lg text-xs transition-all shadow-sm focus:outline-none flex items-center gap-1.5 cursor-pointer"
              >
                {loading && <RefreshCw size={12} className="animate-spin" />}
                {loading ? t('pageui.support.saving', 'กำลังบันทึก...') : t('pageui.support.save_assignee', 'บันทึกผู้รับงาน')}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTicketForGallery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity">
          <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-4xl transform transition-all scale-100 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b border-dark-700 bg-dark-900/40">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ImageIcon size={18} className="text-primary-400" />
                <span>
                  {selectedTicketForGallery.line_user_data?.full_name 
                    ? t('pageui.support.gallery_title_full', 'รูปภาพแนบของ {name} (LINE: {line})', { name: selectedTicketForGallery.line_user_data.full_name, line: selectedTicketForGallery.line_user_data.display_name || 'Line User' })
                    : t('pageui.support.gallery_title', 'รูปภาพแนบของ {name}', { name: selectedTicketForGallery.line_user_data?.display_name || 'Line User' })
                  }
                  <span className="ml-2 text-sm text-slate-500 font-normal">{t('pageui.support.n_images_paren', '({n} ภาพ)', { n: selectedTicketForGallery.attached_files?.length || 0 })}</span>
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConfirmDownloadAll(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors text-xs font-bold shadow-md shadow-emerald-500/10"
                >
                  <Download size={14} />
                  Download All
                </button>
                <button
                  onClick={() => setSelectedTicketForGallery(null)}
                  className="ml-2 flex items-center gap-2 px-5 py-2 rounded-lg border border-red-500 bg-white hover:bg-red-50 text-red-500 transition-colors text-xs font-bold shadow-sm"
                >
                  <X size={14} />
                  {t('tags_modal.close')}
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-dark-900/20">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {selectedTicketForGallery.attached_files?.map((file) => {
                  const url = file.image_url.startsWith('http') ? file.image_url : `${API_BASE_URL}${file.image_url}`;
                  return (
                    <div key={file._id} className="relative group rounded-xl overflow-hidden border border-dark-600 bg-dark-800 p-1.5 flex flex-col gap-2 shadow-md hover:shadow-lg transition-all">
                      <div className="aspect-square w-full rounded-lg overflow-hidden bg-black/5 flex items-center justify-center">
                        <img 
                          src={url} 
                          alt="attached file" 
                          className="w-full h-full object-cover hover:scale-105 transition-transform duration-300 cursor-zoom-in"
                          onClick={() => setZoomedImageUrl(url)}
                        />
                      </div>
                      <div className="flex items-center justify-between px-1 text-[10px] text-slate-500">
                        <span>
                          {new Date(file.created_at).toLocaleString('th-TH', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        <button 
                          onClick={() => setZoomedImageUrl(url)}
                          className="text-primary-500 hover:underline font-bold focus:outline-none"
                        >
                          {t('pageui.support.view_full_size', 'ดูขนาดจริง')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Zoomed Image Lightbox Overlay */}
            {zoomedImageUrl && (
              <div 
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm transition-opacity cursor-zoom-out"
                onClick={() => setZoomedImageUrl(null)}
              >
                <button
                  onClick={() => setZoomedImageUrl(null)}
                  className="absolute top-6 right-6 bg-white hover:bg-red-50 text-red-500 px-7 py-3 rounded-2xl transition-all duration-200 focus:outline-none z-[70] shadow-2xl shadow-red-500/30 hover:scale-105 active:scale-95 border border-red-500 flex items-center gap-2 text-sm font-bold"
                  title="Close Zoom"
                >
                  <X size={22} className="stroke-[2.5]" />
                  {t('tags_modal.close')}
                </button>
                <div className="max-w-full max-h-[90vh] flex items-center justify-center pointer-events-none">
                  <img 
                    src={zoomedImageUrl} 
                    alt="zoomed view" 
                    className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {resetConfirmModalOpen && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <Settings size={15} className="text-slate-600" />
                <span>{t('pageui.support.reset_table_title', 'ยืนยันการรีเซ็ตตาราง')}</span>
              </h3>
              <button 
                onClick={() => setResetConfirmModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 text-center">
              <p className="text-xs font-semibold text-slate-700 leading-relaxed">
                {t('pageui.support.reset_table_msg', 'คุณต้องการรีเซ็ตขนาดคอลัมน์ตารางและการแสดงผลคอลัมน์ทั้งหมดกลับเป็นค่าเริ่มต้นใช่หรือไม่?')}
              </p>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200/60 flex items-center justify-end gap-2.5">
              <button 
                type="button"
                onClick={() => setResetConfirmModalOpen(false)}
                className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all border border-slate-200 focus:outline-none"
              >
                {t('pageui.support.cancel', 'ยกเลิก')}
              </button>
              <button 
                type="button"
                onClick={() => {
                  setColWidths(DEFAULT_COL_WIDTHS);
                  setVisibleCols(DEFAULT_VISIBLE_COLS);
                  setResetConfirmModalOpen(false);
                  setColMenuOpen(false);
                }}
                className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-600/10 focus:outline-none"
              >
                {t('pageui.support.confirm_reset', 'ยืนยันการรีเซ็ต')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nickname + Detail Edit Modal */}
      {editModal.isOpen && editModal.ticket && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center bg-slate-50 border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Edit2 size={16} className="text-emerald-500 flex-shrink-0" />
                {t('pageui.support.edit_customer_title', 'แก้ไขข้อมูลลูกค้า')}
              </h3>
              <button
                /* [FIX-20260801-HOOKTYPES] เดิม reset ด้วย { detail: '' } ซึ่งไม่ใช่ฟิลด์ของ state นี้
                   (ของจริงคือ detailName / detailPhone / detailContract)
                   ผลคือกดกากบาทปิดแล้ว 3 ฟิลด์นั้นกลายเป็น undefined → ช่องกรอกหลุดจาก
                   controlled เป็น uncontrolled (React เตือน) และเปิด modal ครั้งถัดไปค่าเพี้ยน
                   อีก 2 จุดที่ปิด modal (บรรทัด ~1541 และ ~3710) reset ถูกอยู่แล้ว — มีแต่ตรงนี้ที่ตกหล่น */
                onClick={() => setEditModal({ isOpen: false, ticket: null, nickname: '', detailName: '', detailPhone: '', detailContract: '' })}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-all focus:outline-none"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500">
                <span className="font-bold text-slate-700">{editModal.ticket.line_user_data?.display_name || 'Line User'}</span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">{t('ticket.name')}</label>
                <input
                  autoFocus
                  type="text"
                  value={editModal.nickname}
                  onChange={e => setEditModal(prev => ({ ...prev, nickname: e.target.value }))}
                  placeholder={t('pageui.support.nickname_ph', 'ชื่อเรียก...')}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all bg-white"
                />
              </div>
              {!editModal.ticket.line_user_data?.full_name && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-slate-700">{t('pageui.support.name', 'ชื่อ')}</label>
                    <input
                      type="text"
                      value={editModal.detailName}
                      onChange={e => setEditModal(prev => ({ ...prev, detailName: e.target.value }))}
                      placeholder={t('pageui.support.name_ph', 'ชื่อ...')}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all bg-white"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-slate-700">{t('pageui.support.phone', 'เบอร์โทร')}</label>
                    <input
                      type="text"
                      value={editModal.detailPhone}
                      onChange={e => setEditModal(prev => ({ ...prev, detailPhone: e.target.value }))}
                      placeholder={t('pageui.support.phone_ph', 'เบอร์โทร...')}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all bg-white"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button
                onClick={() => setEditModal({ isOpen: false, ticket: null, nickname: '', detailName: '', detailPhone: '', detailContract: '' })}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs transition-all shadow-sm focus:outline-none"
              >
                {t('pageui.support.cancel', 'ยกเลิก')}
              </button>
              <button
                onClick={handleSaveEditModal}
                disabled={savingEdit}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-xs transition-all shadow-sm focus:outline-none flex items-center gap-1.5"
              >
                {savingEdit && <RefreshCw size={12} className="animate-spin" />}
                {savingEdit ? t('pageui.support.saving', 'กำลังบันทึก...') : t('pageui.support.save', 'บันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}

      {nicknameInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 min-w-[280px] max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">{t('pageui.support.info', 'ข้อมูล')}</h3>
              <button onClick={() => setNicknameInfoModal(null)} className="flex items-center gap-2 px-5 py-2 rounded-lg border border-red-500 bg-white hover:bg-red-50 text-red-500 transition-colors text-xs font-bold shadow-sm">
                <X size={13} />
                {t('tags_modal.close')}
              </button>
            </div>
            {nicknameInfoModal.pictureUrl && (
              <div className="flex justify-center mb-4">
                <img
                  src={nicknameInfoModal.pictureUrl}
                  alt="profile"
                  className={`w-20 h-20 rounded-full object-cover ring-4 shadow-lg ${nicknameInfoModal.isRegistered ? 'ring-emerald-400 shadow-emerald-200' : 'ring-red-400 shadow-red-200'}`}
                />
              </div>
            )}
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mb-0.5">Display name</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-slate-800 font-medium">{nicknameInfoModal.displayName || '-'}</p>
                  {nicknameInfoModal.displayName && (
                    <button
                      onClick={() => handleCopy(nicknameInfoModal.displayName, 'nicknameInfoModal', 'displayName')}
                      className="text-slate-400 hover:text-primary-600 transition-colors p-0.5 flex-shrink-0"
                      title={t('pageui.support.copy', 'คัดลอก')}
                    >
                      {copiedId?.id === 'nicknameInfoModal' && copiedId?.field === 'displayName'
                        ? <Check size={13} className="text-emerald-600" />
                        : <Copy size={13} />
                      }
                    </button>
                  )}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mb-0.5">{t('ticket.name') || 'ชื่อเรียก'}</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-slate-800 font-medium">{nicknameInfoModal.nickname || '-'}</p>
                  {nicknameInfoModal.nickname && (
                    <button
                      onClick={() => handleCopy(nicknameInfoModal.nickname, 'nicknameInfoModal', 'nickname')}
                      className="text-slate-400 hover:text-primary-600 transition-colors p-0.5 flex-shrink-0"
                      title={t('pageui.support.copy', 'คัดลอก')}
                    >
                      {copiedId?.id === 'nicknameInfoModal' && copiedId?.field === 'nickname'
                        ? <Check size={13} className="text-emerald-600" />
                        : <Copy size={13} />
                      }
                    </button>
                  )}
                </div>
              </div>
              {/* Customer Info */}
              {(() => {
                const m = nicknameInfoModal;
                const { detailName: dn, detailPhone: dp, detailContract: dc } = parseDetail(m.detail || '');
                const hasDetail = dn || dp || dc;
                const phoneVal = m.phone && m.phone !== 'N/A' ? m.phone : '';
                const contractVal = m.contract && m.contract !== 'N/A' ? m.contract : '';
                const hasAny = m.fullName || hasDetail || phoneVal || contractVal;
                if (!hasAny) return null;
                return (
                  <div className="border-t border-slate-100 pt-3 mt-1 flex flex-col gap-2">
                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">{t('pageui.support.col_customer', 'Line OA / ชื่อ-สกุล / เบอร์')}</p>
                    {m.fullName ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-slate-800 font-medium">{m.fullName}</span>
                        <button onClick={() => handleCopy(m.fullName!, 'nicknameInfoModal', 'fullName')} className="text-slate-400 hover:text-primary-600 p-0.5 flex-shrink-0">
                          {copiedId?.id === 'nicknameInfoModal' && copiedId?.field === 'fullName' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                        </button>
                      </div>
                    ) : hasDetail ? (
                      <div className="flex flex-col gap-1">
                        {dn && <div className="flex items-center justify-between gap-2"><span className="text-sm text-slate-800 font-medium">{dn}</span><button onClick={() => handleCopy(dn, 'nicknameInfoModal', 'dn')} className="text-slate-400 hover:text-primary-600 p-0.5 flex-shrink-0">{copiedId?.id === 'nicknameInfoModal' && copiedId?.field === 'dn' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}</button></div>}
                        {dp && <div className="flex items-center justify-between gap-2"><span className="text-sm text-slate-800 font-medium">{dp}</span><button onClick={() => handleCopy(dp, 'nicknameInfoModal', 'dp')} className="text-slate-400 hover:text-primary-600 p-0.5 flex-shrink-0">{copiedId?.id === 'nicknameInfoModal' && copiedId?.field === 'dp' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}</button></div>}
                        {dc && <div className="flex items-center justify-between gap-2"><span className="text-sm font-mono text-slate-700">{dc}</span><button onClick={() => handleCopy(dc, 'nicknameInfoModal', 'dc')} className="text-slate-400 hover:text-primary-600 p-0.5 flex-shrink-0">{copiedId?.id === 'nicknameInfoModal' && copiedId?.field === 'dc' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}</button></div>}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic text-xs">{t('pageui.support.unregistered_marker', '-(ไม่ได้ลงทะเบียน)-')}</span>
                    )}
                    {phoneVal && <div className="flex items-center justify-between gap-2"><span className="text-sm text-slate-800 font-medium">{phoneVal}</span><button onClick={() => handleCopy(phoneVal, 'nicknameInfoModal', 'phone')} className="text-slate-400 hover:text-primary-600 p-0.5 flex-shrink-0">{copiedId?.id === 'nicknameInfoModal' && copiedId?.field === 'phone' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}</button></div>}
                    {contractVal && <div className="flex items-center justify-between gap-2"><span className="text-sm font-mono text-slate-700">{contractVal}</span><button onClick={() => handleCopy(contractVal, 'nicknameInfoModal', 'contract')} className="text-slate-400 hover:text-primary-600 p-0.5 flex-shrink-0">{copiedId?.id === 'nicknameInfoModal' && copiedId?.field === 'contract' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}</button></div>}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {confirmDownloadAll && selectedTicketForGallery && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Download size={20} className="text-emerald-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">{t('pageui.support.confirm_download', 'ยืนยันการดาวน์โหลด')}</h3>
            </div>
            <p className="text-xs text-slate-500 mb-5">
              {t('pageui.support.download_all_a', 'ดาวน์โหลดรูปภาพทั้งหมด')} <span className="font-bold text-slate-700">{t('pageui.support.n_images', '{n} ภาพ', { n: selectedTicketForGallery.attached_files?.length || 0 })}</span> {t('pageui.support.download_all_b', 'ใช่หรือไม่?')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDownloadAll(false)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg border border-red-500 bg-white hover:bg-red-50 text-red-500 transition-colors text-xs font-bold shadow-sm"
              >
                <X size={13} />
                {t('tags_modal.close')}
              </button>
              <button
                onClick={async () => {
                  setConfirmDownloadAll(false);
                  if (selectedTicketForGallery.attached_files) {
                    for (const file of selectedTicketForGallery.attached_files) {
                      const imageUrl = file.image_url;
                      const url = imageUrl.startsWith('http') ? imageUrl : `${API_BASE_URL}${imageUrl}`;
                      try {
                        const response = await fetch(url);
                        const blob = await response.blob();
                        const blobUrl = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = blobUrl;
                        const filename = imageUrl.substring(imageUrl.lastIndexOf('/') + 1) || `${file._id}.jpg`;
                        link.download = filename;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        window.URL.revokeObjectURL(blobUrl);
                      } catch (err) {
                        console.error('Failed to download image:', err);
                        window.open(url, '_blank');
                      }
                      await new Promise(resolve => setTimeout(resolve, 300));
                    }
                  }
                }}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors text-xs font-bold shadow-sm"
              >
                <Download size={13} />
                {t('pageui.support.download', 'ดาวน์โหลด')}
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertModal
        isOpen={alertState.isOpen}
        onClose={() => setAlertState(prev => ({ ...prev, isOpen: false }))}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />

      <ConfirmModal
        isOpen={!!pendingHookId}
        onClose={() => setPendingHookId(null)}
        onConfirm={() => {
          if (pendingHookId) setActiveHookId(pendingHookId);
          setPendingHookId(null);
        }}
        title={t('ticket.channel_switch_title')}
        message={t('ticket.channel_switch_message', {
          name: (() => {
            const h = hooks.find(x => x._id === pendingHookId);
            return h ? (h.alias || h.line_oa_name) : '';
          })()
        })}
        type="info"
        confirmLabel={t('ticket.channel_switch_confirm')}
        cancelLabel={t('common.cancel')}
      />

      <ConfirmModal
        isOpen={!!pendingGroupId}
        onClose={() => setPendingGroupId(null)}
        onConfirm={() => {
          if (pendingGroupId) {
            setActiveGroupId(pendingGroupId);
            setActiveHookId(null);
          }
          setPendingGroupId(null);
        }}
        title={t('pageui.support.confirm_group_change', 'ยืนยันการเปลี่ยนกลุ่ม')}
        message={t('ticket.channel_switch_message', {
          name: (() => {
            const g = groups.find(x => x._id === pendingGroupId);
            return g ? g.group_name : '';
          })()
        })}
        type="info"
        confirmLabel={t('pageui.support.confirm_change', 'ยืนยันการเปลี่ยน')}
        cancelLabel={t('common.cancel')}
      />

      {/* Ticket Already Taken Modal */}
      {ticketTakenModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle size={28} className="text-amber-500" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-800 mb-1">{t('ticket.already_accepted_title')}</h3>
              <p className="text-sm text-slate-500">{t('ticket.already_accepted_msg')}</p>
            </div>
            <button
              onClick={() => { setTicketTakenModal(false); fetchTickets(true); }}
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw size={15} />
              {t('ticket.refresh_now')}
            </button>
          </div>
        </div>
      )}

      {/* Clear Tickets Modal */}
      {clearModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                <Trash2 className="text-red-500" size={20} />
                {t('pageui.support.clear_all_title', 'เคลียร์งานทั้งหมด')}
              </h3>
              <button 
                onClick={() => setClearModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100"
                disabled={clearSubmitting}
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 flex flex-col gap-4 text-sm text-slate-600">
              <p>{t('pageui.support.clear_pick_status', 'เลือกสถานะงานที่คุณต้องการเคลียร์ (จบงานทันที):')}</p>
              
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={clearWaiting}
                    onChange={(e) => setClearWaiting(e.target.checked)}
                    className="w-5 h-5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                    disabled={clearConfirming || clearSubmitting}
                  />
                  <div>
                    <span className="block font-bold text-slate-700">{t('pageui.support.status_waiting', 'รอรับงาน')}</span>
                    <span className="text-xs text-slate-500">{t('pageui.support.clear_waiting_hint', 'เคลียร์งานที่ยังไม่มีคนรับ')}</span>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={clearProcessing}
                    onChange={(e) => setClearProcessing(e.target.checked)}
                    className="w-5 h-5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                    disabled={clearConfirming || clearSubmitting}
                  />
                  <div>
                    <span className="block font-bold text-slate-700">{t('pageui.support.status_in_progress', 'กำลังดำเนินงาน')}</span>
                    <span className="text-xs text-slate-500">{t('pageui.support.clear_in_progress_hint', 'เคลียร์งานที่กำลังดำเนินการอยู่')}</span>
                  </div>
                </label>
              </div>

              {!clearWaiting && !clearProcessing && (
                <p className="text-red-500 text-xs font-bold mt-1">{t('pageui.support.pick_one_status', '* กรุณาเลือกอย่างน้อย 1 สถานะ')}</p>
              )}

              {clearConfirming && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg flex gap-3 animate-in fade-in slide-in-from-top-2">
                  <AlertTriangle className="text-red-500 flex-shrink-0" size={20} />
                  <div>
                    <p className="font-bold text-red-800 text-sm mb-1">{t('pageui.support.confirm_clear_q', 'ยืนยันการเคลียร์งาน?')}</p>
                    <p className="text-red-600 text-xs leading-relaxed">
                      {t('pageui.support.clear_warn', 'การกระทำนี้จะจบงานตามสถานะที่เลือกทั้งหมดทันทีและไม่สามารถย้อนกลับได้ คุณแน่ใจหรือไม่?')}
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setClearModalOpen(false)}
                className="px-4 py-2 font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm disabled:opacity-50"
                disabled={clearSubmitting}
              >
                {t('pageui.support.cancel', 'ยกเลิก')}
              </button>
              
              {!clearConfirming ? (
                <button
                  onClick={() => setClearConfirming(true)}
                  disabled={(!clearWaiting && !clearProcessing) || clearSubmitting}
                  className="px-4 py-2 font-bold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors shadow-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('pageui.support.do_clear', 'ดำเนินการเคลียร์งาน')}
                </button>
              ) : (
                <button
                  onClick={async () => {
                    const targetHookIds = activeHookId ? [activeHookId] : activeGroupHookIds;
                    if (targetHookIds.length === 0) return;
                    setClearSubmitting(true);
                    try {
                      let totalClosed = 0;
                      let totalRooms = 0;
                      await Promise.all(targetHookIds.map(async (hId) => {
                        try {
                          const res = await ticketService.clearTickets(hId, clearWaiting, clearProcessing);
                          if (res.success) {
                            totalClosed += res.ticketsClosed || 0;
                            totalRooms += res.roomsReset || 0;
                          }
                        } catch (err) {
                          console.error(`Failed to clear hook ${hId}:`, err);
                        }
                      }));
                      setAlertState({
                        isOpen: true,
                        title: translateNow('pageui.support.success', 'สำเร็จ'),
                        message: translateNow('pageui.support.clear_done_msg', 'เคลียร์งานเรียบร้อยแล้ว (Tickets: {tickets}, Rooms: {rooms})', { tickets: totalClosed, rooms: totalRooms }),
                        type: 'success'
                      });
                      setClearModalOpen(false);
                    } catch (err: any) {
                      setAlertState({
                        isOpen: true,
                        title: translateNow('pageui.support.error_noun', 'ข้อผิดพลาด'),
                        message: err.message || translateNow('pageui.support.clear_failed', 'ไม่สามารถเคลียร์งานได้'),
                        type: 'error'
                      });
                    } finally {
                      setClearSubmitting(false);
                      setClearConfirming(false);
                    }
                  }}
                  disabled={clearSubmitting}
                  className="px-4 py-2 font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors shadow-sm text-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {clearSubmitting ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      {t('pageui.support.processing', 'กำลังประมวลผล...')}
                    </>
                  ) : (
                    t('pageui.support.confirm_clear', 'ยืนยันการเคลียร์งาน')
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Copy Success Toast */}
      <div 
        className={`fixed bottom-5 right-5 bg-slate-800 text-white border border-slate-700 px-4 py-2.5 rounded-lg shadow-2xl transition-all duration-300 flex items-center gap-2 z-50 ${
          toastVisible ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0 pointer-events-none'
        }`}
      >
        <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
          <Check size={12} />
        </span>
        <span className="text-xs font-bold">{t('pageui.support.copied_done', 'คัดลอกข้อมูลเรียบร้อยแล้ว')}</span>
      </div>

      {/* Resizable Divider & Quick Collapse/Expand Controls */}
      {instantChatTarget && !instantChatTarget.isExpanded && !instantChatTarget.isCollapsed && (
        <div
          onMouseDown={startInstantChatResize}
          className="w-4 bg-slate-200 hover:bg-emerald-500 cursor-col-resize z-20 shrink-0 transition-colors flex flex-col items-center justify-center gap-3 group relative"
          title={t('pageui.support.drag_resize_chat', 'ลากเพื่อปรับขนาดหน้าจอแชต')}
        >
          {/* Quick Collapse Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setInstantChatTarget(prev => prev ? { ...prev, isCollapsed: true } : null);
            }}
            className="w-7 h-10 bg-white border border-slate-300 rounded-lg shadow-md flex items-center justify-center text-slate-700 hover:text-emerald-600 hover:border-emerald-500 hover:bg-emerald-50 transition-all cursor-pointer z-30"
            title={t('pageui.support.collapse_chat', 'ซ่อนหน้าจอแชต (Collapse)')}
          >
            <ChevronRight size={18} />
          </button>

          <div className="w-1 h-10 bg-slate-400 group-hover:bg-white rounded-full transition-colors" />

          {/* Quick Expand Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setInstantChatTarget(prev => prev ? { ...prev, isExpanded: true } : null);
            }}
            className="w-7 h-10 bg-white border border-slate-300 rounded-lg shadow-md flex items-center justify-center text-slate-700 hover:text-emerald-600 hover:border-emerald-500 hover:bg-emerald-50 transition-all cursor-pointer z-30"
            title={t('pageui.support.expand_chat', 'ขยายเต็มหน้าจอ (Expand)')}
          >
            <Maximize2 size={16} />
          </button>
        </div>
      )}

      {/* Floating Restore Button when Collapsed */}
      {instantChatTarget && instantChatTarget.isCollapsed && (
        <button
          type="button"
          onClick={() => setInstantChatTarget(prev => prev ? { ...prev, isCollapsed: false } : null)}
          className="fixed right-0 top-1/2 -translate-y-1/2 bg-emerald-600 hover:bg-emerald-700 text-white py-3 px-2 rounded-l-xl shadow-2xl flex items-center gap-1.5 z-40 transition-all cursor-pointer animate-pulse"
          title={t('pageui.support.open_instant_room', 'เปิด Instant Chat Room')}
        >
          <ChevronLeft size={18} />
          <span className="text-xs font-bold [writing-mode:vertical-lr] rotate-180 py-1">{t('pageui.support.open_instant', 'เปิด Instant Chat')}</span>
        </button>
      )}

      {/* Right Side Panel: Instant Chat Room */}
      {instantChatTarget && !instantChatTarget.isCollapsed && (
        <div
          style={{ width: instantChatTarget.isExpanded ? '100%' : `${instantChatPercent}%` }}
          className="h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col shrink-0 overflow-hidden z-20 animate-in slide-in-from-right duration-200"
        >
          <ChatRoomView
            room={instantChatTarget.room}
            hookId={instantChatTarget.hookId}
            onClose={() => setInstantChatTarget(null)}
            isExpanded={instantChatTarget.isExpanded}
            onToggleExpand={() => setInstantChatTarget(prev => prev ? { ...prev, isExpanded: !prev.isExpanded } : null)}
            onCollapse={() => setInstantChatTarget(prev => prev ? { ...prev, isCollapsed: true } : null)}
            // [FIX-20260814-CUSTOMERNAME] was the raw display_name, so a
            // placeholder row titled the chat header "Unknown"
            headerTitle={customerName(instantChatTarget.ticket?.line_user_data)}
            showDetailBox={true}
          />
        </div>
      )}
    </div>
  );
};

export default TicketSupport;
