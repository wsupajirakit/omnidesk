import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { webhookService } from '../../services/hook';
import { auditService } from '../../services/admin';
import { aiKeyService } from '../../services/hook';
import { useGroupsQuery } from '../../services/admin/queries';
import { useHookListQuery, useHookTagsQuery } from '../../services/hook/queries';
import { POLL_INTERVAL_MS } from '../../services/query';
import { getAuthUser } from '../../services/authStorage';
import { normalizeHookSubmission } from '../../utils/hookFormPayload';
import { GroupEntry, HookData, HookFormData } from '../../types';
import { channelOf } from '../../config/channelRegistry';
import { Edit2, Trash2, Plus, Search, ChevronLeft, ChevronRight, RefreshCw, Filter, CheckSquare, Square, Eye, Info, ExternalLink, Power, TestTube2, CheckCircle, X, Copy, Loader2, Link, CopyPlus,
  // [FEAT-20260822-NOTICEMODE] the follower switch's icon
  UserCheck } from 'lucide-react';
import { ConfirmModal } from '../../components/modals';
/* [FIX-20260828-WLISTSEARCHSEL] ตัวเลือกกลางของระบบ — ตัวเดียวกับที่ webhook log,
   audit log, slip, broadcast ใช้อยู่ · ห้ามเขียน dropdown ใบใหม่ */
import { SearchableSelect } from '../../components/common';
import HookTablePager from '../../components/hook/list/HookTablePager';
import ConfirmConsentCheck from '../../components/modals/ConfirmConsentCheck';
// [FEAT-20260729-BULKSTATUS] shared with the Users page — labels are passed in
import { BulkStatusModal } from '../../components/bulk';
// [FEAT-20260806-BULKMETHOD] new "choose method" stepper — the On/Off toolbar button
// opens THIS now; BulkStatusModal above stays wired for a one-line revert.
import { BulkMethodModal } from '../../components/bulk';
import { HookFormModal } from '../../components/hook';
import { TagsModal } from '../../components/modals';
// [FEAT-20260804-HOOKCLONE] โมดัลคัดลอกการตั้งค่า OA (ยืนยัน 2 ชั้น)
import { HookCloneModal } from '../../components/hook';
import { NewHookChoiceModal } from '../../components/hook';
import { AlertModal } from '../../components/modals';
// [FIX-20260817-BLANKSECRET] see utils/secretMask.ts
import { isMaskedSecret } from '../../utils/secretMask';
import { useI18n } from '../../i18n';
import { HookPageTabs, HookTabKey } from '../../components/hook/list/HookPageTabs';
import { LineQuotaTable } from '../../components/hook/quota/line';
// [FEAT-20260801-SAVETOAST] รับผลการบันทึกที่หน้าฟอร์มส่งมากับการ navigate
import { useLocation, useNavigate } from 'react-router-dom';
import { copyText } from '../../utils/copyText';

type FastModeFilterValue = 'all' | number;

// [FIX-20260728-PERPAGE] ตัวเลือกจำนวนแถวต่อหน้า
// หยุดที่ 100 เพราะ BE cap limit ไว้ 100 (ส่งเกินไปก็ได้แค่ 100 = ผู้ใช้จะ
// เลือก 200 แล้วเห็นแค่ 100 ซึ่งทำให้ตัวเลขหน้าเพี้ยน)
// revert: ลบ const นี้
const PER_PAGE_OPTIONS = [10, 25, 50, 75, 100];

/**
 * [HIDE-20260823-FOLLOWERSWITCH] The Follower column is hidden, not deleted.
 *
 * WHY — `follow_player_status` controls nothing. A grep across the whole back
 * end returns four hits and every one is metadata, never a decision:
 *   hooks/schemas/hook.schema.ts:405                      declares the column
 *   hooks/hook-field-tabs.ts:210                          puts it on the notice tab
 *   hooks/notice-settings/notice-settings.fields.ts:43,78 lists it as writable
 *                                                         and notes it owns no card
 * A switch that saves and changes nothing is worse than no switch: the operator
 * flips it, the save succeeds, and they believe a player is now being followed.
 *
 * WHAT DOES THE JOB INSTEAD — the deposit and withdraw switches, directly. The
 * notice runtime reads those two and no others (notice-context.ts:52-53), and
 * every follow-up stamp on the member comes off them:
 *   case-a/b  depositOn                → follow_up.line.notice_deposit_at
 *   case-c/d  withdrawOn               → follow_up.line.notice_withdraw_at
 *   case-e/f  depositOn + scope 'slip' → follow_up.line.notice_payment_at
 *
 * The owner's own 22/08 spec parked this switch's runtime as
 * "Phase 3 🛑 ล็อกจนกว่า D1-D3 จะถูกตอบ"
 * (omnidesk-api todo/task/22082026/todo5_22082026_hook-notice-follow-settings.md:153),
 * so hidden is the honest state until that phase is answered. The same section
 * is hidden in the hook form — HookNoticeTab.tsx, same tag.
 *
 * TO BRING IT BACK: flip this to `true`. The <th>, the <td>, the confirm-modal
 * branch, the write route and the strings are all still here and wired.
 * ซ่อน ไม่ได้ลบ — ค่ายังอยู่ใน DB และเส้นเขียนยังรับอยู่
 */
const SHOW_FOLLOWER_COLUMN = false;

/**
 * Columns in the table, so the empty-state row spans ALL of them.
 *
 * ⚠️ This was hard-coded `7` while the table had 9 columns — the "no results"
 * message stopped two columns short of the right edge. Deriving it means the
 * number cannot drift again, and it stays right whichever way the flag above is
 * set. Add a column ⇒ raise the base here in the same edit.
 */
const TABLE_COLUMN_COUNT = SHOW_FOLLOWER_COLUMN ? 9 : 8;

export const WebhookList: React.FC = () => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<HookTabKey>('manage');

  // ==== [FEAT-20260801-SAVETOAST] START — แจ้งผลหลังบันทึกจากหน้าฟอร์มเต็ม
  // 🔒 สาย AUTO — to_dev_auto / to_prod_auto
  //
  // ปัญหา: หน้าฟอร์ม (HookFormPage) เซฟเสร็จแล้วเด้งกลับมาหน้านี้ทันที
  // ผู้ใช้จึงไม่เห็นอะไรยืนยันว่าสำเร็จ — "มีหรือไม่ก็ไม่เห็น"
  //
  // วิธี: หน้าฟอร์มส่งผลมากับ navigate state แล้วหน้านี้เอามาโชว์เป็นแถบเขียว
  // ⚠️ ต้องล้าง state ทิ้งทันทีหลังอ่าน ไม่งั้นกด refresh หรือกดปุ่ม back
  //    แถบเดิมจะโผล่ซ้ำทั้งที่ไม่ได้เพิ่งบันทึกอะไร
  // ⚠️ ไม่แตะ AlertModal ของหน้าฟอร์ม — อันนั้นยังทำงานเหมือนเดิมทุกประการ
  // revert: ลบบล็อกนี้ + แถบข้างล่าง + navigate state ใน HookFormPage
  const location = useLocation();
  const navigate = useNavigate();
  const [savedToast, setSavedToast] = useState<string | null>(null);
  useEffect(() => {
    const msg = (location.state as any)?.savedMessage;
    if (!msg) return;
    setSavedToast(String(msg));
    navigate(location.pathname, { replace: true, state: null });   // ล้างทิ้งทันที
    const timer = window.setTimeout(() => setSavedToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [location.state, location.pathname, navigate]);
  // ==== [FEAT-20260801-SAVETOAST] END
  // [FIX-20260729-MENUPERM] ถอด `isActuallyBpAdmin` ออก — ที่นี่ใช้ในทางกลับกัน
  // (ซ่อนปุ่ม copy/delete จาก user ชื่อ bp_admin) ไม่มี user ชื่อนั้นแล้ว
  // เงื่อนไข `!isActuallyBpAdmin` จึงเป็น true เสมอ = ปุ่มแสดงอยู่แล้วทุกบัญชี
  // ลบทิ้งได้โดยผลลัพธ์บนจอไม่เปลี่ยน
  // revert: คืน const แล้วครอบปุ่ม copy/delete ด้วย {!isActuallyBpAdmin && ( … )}
  const fastModeOptions = useMemo(
    () => [
      { value: 2, label: t('webhook_list.fast_mode_fast') },
      { value: 1, label: t('webhook_list.fast_mode_normal') },
      { value: 0, label: t('webhook_list.fast_mode_thinking') }
    ],
    [t]
  );
  const fastModeLabels = useMemo(() => {
    return fastModeOptions.reduce((acc, option) => {
      acc[option.value] = option.label;
      return acc;
    }, {} as Record<number, string>);
  }, [fastModeOptions]);
  
  // Filter & Search States
  const [search, setSearch] = useState('');
  const [quotaSearch, setQuotaSearch] = useState('');
  const quotaRefreshRef = useRef<(() => void) | null>(null);
  const handleRegisterQuotaRefresh = useCallback((fn: () => void) => {
    quotaRefreshRef.current = fn;
  }, []);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [fastModeFilter, setFastModeFilter] = useState<FastModeFilterValue>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  
  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  // ==== [FIX-20260728-PERPAGE] START — เดิมคือ: const itemsPerPage = 10;
  // (ค่าคงที่ ไม่มี dropdown ให้เลือกมาตั้งแต่แรก — ไม่ใช่ของที่หายไป)
  // เปลี่ยนเป็น state เพื่อให้ผู้ใช้เลือกจำนวนแถวต่อหน้าได้
  //
  // เพดาน 100: BE cap limit ไว้ที่ 100 อยู่แล้ว (hookController getAllHooks
  // ใช้ Math.min(parseInt(limit) || 10, 100)) ส่งมากกว่านั้นไปก็ได้แค่ 100
  // จึงไม่ใส่ตัวเลือกที่เกิน 100 เพราะจะได้ข้อมูลไม่ครบตามที่ผู้ใช้เลือก
  //
  // revert: เปลี่ยนกลับเป็น  const itemsPerPage = 10;  แล้วลบ dropdown
  // ในส่วน pagination + ลบ PER_PAGE_OPTIONS
  const [itemsPerPage, setItemsPerPage] = useState(10);
  // ==== [FIX-20260728-PERPAGE] END

  // ==== [FIX-20260728-HOOKPAGE] START — state ชุดนี้เพิ่มใหม่
  // เดิมหน้านี้ถือ hook ทั้ง 1000 ตัวใน allHooks แล้ว filter/แบ่งหน้าฝั่ง client
  // ตอนนี้ย้ายไปให้ BE ทำ จึงต้องเก็บ total + tag list แยก
  //
  // debouncedSearch: ช่องค้นหาเดิม filter ใน memory ทันทีทุกตัวอักษร (ฟรี)
  // แต่ตอนนี้ทุกตัวอักษร = 1 request → ต้องหน่วง 350ms ไม่งั้นยิงถล่ม BE
  // ช่อง input ยังตอบสนองทันทีเหมือนเดิม (search อัปเดตทุกคีย์) แค่ตัวที่
  // ใช้ยิง API เป็น debouncedSearch
  //
  // revert: ลบ state 3 ตัวนี้ + useEffect debounce ที่อยู่ใต้ลงมา
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  // ==== [FIX-20260728-HOOKPAGE] END

  // [FEAT-20260804-HOOKCLONE] OA ต้นแบบที่กดปุ่มคัดลอก (null = ปิดโมดัล)
  const [cloneSource, setCloneSource] = useState<HookData | null>(null);
  // [FEAT-20260805-NEWHOOKCHOICE] modal เลือกทางตอนกด Add New
  const [showNewChoice, setShowNewChoice] = useState(false);
  // [FEAT-20260805-ACTIONCONFIRM] ยืนยันก่อน edit/clone (เปิดแท็บใหม่) — บอก row + action
  const [actionConfirm, setActionConfirm] = useState<{ type: 'edit' | 'clone'; hook: HookData } | null>(null);

  /* [FEAT-20260804-GROUPCOL] แปลง group ของ hook → ชื่อกลุ่มที่คนอ่านรู้เรื่อง
   * ⚠️ API รายการ hook ส่ง group มาเป็น "id ล้วน" (ไม่ populate) จึงต้องเทียบกับ groups
   *    ที่หน้านี้โหลดไว้แล้ว · เผื่ออนาคต BE เปลี่ยนมา populate ก็รองรับแบบ object ด้วย
   * ⚠️ groups ยังโหลดไม่เสร็จ = คืน '' → ตารางโชว์ "-" ชั่วคราว ไม่พังและไม่โชว์ id ดิบ */
  const groupNameOf = (hook: HookData): string => {
    const g: any = (hook as any).group ?? (hook as any).group_id;
    if (g && typeof g === 'object') return g.group_name || g.name || '';
    const id = String(g || '');
    if (!id) return '';
    const found = groups.find((x: any) => String(x.id || x._id) === id);
    return found ? (found as any).group_name || (found as any).name || '' : '';
  };

  // Selection States
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // [FEAT-20260729-BULKSTATUS] choice: null = not picked · true = on · false = off
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusChoice, setBulkStatusChoice] = useState<boolean | null>(null);
  const [bulkStatusConfirm, setBulkStatusConfirm] = useState(false);
  const [bulkStatusSaving, setBulkStatusSaving] = useState(false);
  // [FEAT-20260806-BULKMETHOD] the "choose method" stepper visibility (opened by the
  // On/Off toolbar button). Independent of the bulkStatus* state above.
  const [bulkMethodOpen, setBulkMethodOpen] = useState(false);

  // Modal States
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  /* [UI-20260826-DELCONSENT] ติ๊กยืนยันของโมดัลลบ — ล้างทุกครั้งที่ปิดโมดัล */
  const [deleteConsent, setDeleteConsent] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingHook, setEditingHook] = useState<HookData | undefined>(undefined);
  const [isViewMode, setIsViewMode] = useState(false);
  const [formPrefillHook, setFormPrefillHook] = useState<HookData | undefined>(undefined);
  const [formMode, setFormMode] = useState<'create' | 'update'>('create');
  const [isFormLoading, setIsFormLoading] = useState(false);

  // Tags Modal States
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const [tagsModalData, setTagsModalData] = useState<string[]>([]);
  const [lineConfirm, setLineConfirm] = useState<{ isOpen: boolean; hook?: HookData }>({ isOpen: false });

  // Alert Modal State
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error';
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success',
  });

  const [isKeyTesterOpen, setIsKeyTesterOpen] = useState(false);
  const [keyTesterValue, setKeyTesterValue] = useState('');
  const [isKeyTesterLoading, setIsKeyTesterLoading] = useState(false);
  const [keyTesterResult, setKeyTesterResult] = useState<{ status: 'idle' | 'success' | 'error'; message?: string }>({ status: 'idle' });
  const [isToggleLoading, setIsToggleLoading] = useState(false);

  const [toggleConfirm, setToggleConfirm] = useState<{
    isOpen: boolean;
    /* [FEAT-20260822-NOTICEMODE] `follow_player_status` joins the two toggles
       this table already owns. It is a BOOLEAN column written by its own route
       (`PUT /hook/notice/:id`), so it travels here as 1/0 like the others and is
       converted once, at the call. เก็บเป็น 1/0 เหมือนเพื่อน แปลงตอนยิงครั้งเดียว. */
    field: 'status' | 'fast_mode' | 'follow_player_status';
    hook?: HookData;
    nextValue?: number;
    label?: string;
  }>({
    isOpen: false,
    field: 'status'
  });
  const isModalOpen =
    isDeleteOpen ||
    isFormOpen ||
    isTagsModalOpen ||
    alertState.isOpen ||
    isKeyTesterOpen ||
    toggleConfirm.isOpen;

  /* ==== [FEAT-20261027-TANSTACK] list · tags · groups through TanStack Query =====
   * Same requests as before (services unchanged, refetch on every mount). What moved:
   *  · the 20s poll is `refetchInterval` (POLL_INTERVAL_MS.hookList), off while a
   *    modal is open (as before) and — owner 26/10 — paused while the tab is hidden;
   *  · a poll tick is SILENT (owner 26/10): the top bar shows only while a key has no
   *    answer yet (`isPending` — first load, page/filter change) or for an operator
   *    action (`actionBusy`);
   *  · the last good rows stay on screen while a new page loads AND after a failed
   *    load (`lastGoodPage`), exactly like the old setAllHooks-on-success.
   * Pinned by test/requests/hookPages.requests.test.tsx.
   * revert: restore this file from tag ckpt-before-tanstack-demo-26102026. */
  const listQuery = useHookListQuery(
    { page: currentPage, limit: itemsPerPage, keyword: debouncedSearch, status: statusFilter,
      fast_mode: fastModeFilter, group: groupFilter, tag: tagFilter },
    { pollMs: isModalOpen ? false : POLL_INTERVAL_MS.hookList },
  );
  const lastGoodPage = useRef<{ data: HookData[]; total: number }>({ data: [], total: 0 });
  if (listQuery.data) lastGoodPage.current = listQuery.data;
  const allHooks = (listQuery.data ?? lastGoodPage.current).data;
  const totalItems = (listQuery.data ?? lastGoodPage.current).total;
  const [actionBusy, setActionBusy] = useState(false);
  const loading = listQuery.isPending || actionBusy;
  const { refetch: refetchList } = listQuery;
  /** Re-read the current page after an operator action — shows the bar, as before. */
  const fetchData = useCallback(async () => {
    setActionBusy(true);
    try { await refetchList(); } finally { setActionBusy(false); }
  }, [refetchList]);

  const tagOptions = useHookTagsQuery().data ?? [];
  // groups: one attempt per mount (the old latch re-fired forever when the request failed)
  const groupsQuery = useGroupsQuery({ status: true, limit: 100 });
  const groups = useMemo<GroupEntry[]>(
    () => [...(groupsQuery.data?.data ?? [])].sort((a, b) => a.group_name.localeCompare(b.group_name)),
    [groupsQuery.data],
  );
  const groupsLoading = groupsQuery.isLoading;
  // ==== [FEAT-20261027-TANSTACK] END

  const showAlert = (title: string, message: string, type: 'success' | 'error') => {
    setAlertState({ isOpen: true, title, message, type });
  };

  const closeAlert = () => {
    setAlertState(prev => ({ ...prev, isOpen: false }));
  };

  const openKeyTester = () => {
    setKeyTesterValue('');
    setKeyTesterResult({ status: 'idle' });
    setIsKeyTesterOpen(true);
  };

  const closeKeyTester = () => {
    if (isKeyTesterLoading) return;
    setIsKeyTesterOpen(false);
  };

  const runKeyTest = async () => {
    const key = keyTesterValue.trim();
    if (!key) {
      setKeyTesterResult({ status: 'error', message: t('webhook_list.key_required') });
      return;
    }
    setIsKeyTesterLoading(true);
    setKeyTesterResult({ status: 'idle' });
    try {
      const res = await aiKeyService.testGeminiKey(key);
      setKeyTesterResult({ status: 'success', message: t('webhook_list.valid_method', { method: res.method }) });
    } catch (e: any) {
      setKeyTesterResult({ status: 'error', message: e?.message || t('webhook_list.invalid_key_short') });
    } finally {
      setIsKeyTesterLoading(false);
    }
  };

  const getActor = () => {
    const user = getAuthUser();
    if (!user) return undefined;
    return {
      user_id: user.id,
      username: user.username,
      display_name: user.display_name,
    };
  };

  const safeAudit = async (payload: Parameters<typeof auditService.createHookAuditLog>[0]) => {
    try {
      await auditService.createHookAuditLog(payload);
    } catch (e) {
      console.warn('Audit log failed (non-blocking)', e);
    }
  };

  const redactIfSensitive = (field: string, value: any) => {
    const sensitive = new Set(['line_secret', 'line_key', 'custom_ai_key', 'telegram_key', 'telegram_chat_id']);
    if (!sensitive.has(field)) return value;
    if (value === undefined || value === null || value === '') return null;
    return '[set]';
  };

  // --- Fetch Data ---
  // [FEAT-20261027-TANSTACK] list / tags / groups fetching, the debounced-search
  // refetch and the 20s poll now live in the query block above (after isModalOpen).
  // The old fetchData + 3 effects are kept verbatim at tag ckpt-before-tanstack-demo-26102026.

  // --- Filter Logic ---
  // ==== [FIX-20260728-HOOKPAGE] START
  // ทั้ง filter + pagination ย้ายไปทำฝั่ง BE แล้ว (ดู getHooksPaged + fetchData)
  // allHooks ที่ได้กลับมาคือ "แถวของหน้าปัจจุบันที่ผ่านตัวกรองแล้ว" อยู่ในตัว
  // จึงไม่ต้อง filter/slice ซ้ำ — ถ้า filter ซ้ำจะกลายเป็นกรอง 2 ชั้นและ
  // ทำให้ตัวเลขหน้าเพี้ยน
  //
  // ตัวกรองที่ BE รับผิดชอบตอนนี้: keyword (7 ฟิลด์), tag, status,
  // fast_mode, group, sort — ตรงกับที่โค้ดเดิมทำฝั่ง client ทุกตัว
  //
  // โค้ดเดิมทั้งก้อน (copy กลับได้ตรงตัวตอน revert):
  //   const filteredHooks = useMemo(() => {
  //     return allHooks.filter(hook => {
  //       if (statusFilter === 'active' && hook.status !== 1) return false;
  //       if (statusFilter === 'inactive' && hook.status !== 0) return false;
  //       if (fastModeFilter !== 'all' && hook.fast_mode !== fastModeFilter) return false;
  //       const hookGroupId = String((hook as any).group ?? hook.group_id ?? '');
  //       if (groupFilter !== 'all' && hookGroupId !== groupFilter) return false;
  //       if (tagFilter !== 'all' && !(hook.tag || []).includes(tagFilter)) return false;
  //       if (search) {
  //         const query = search.toLowerCase();
  //         const inName = hook.line_oa_name.toLowerCase().includes(query);
  //         const inCompany = hook.company_name.toLowerCase().includes(query);
  //         const inAlias = hook.alias.toLowerCase().includes(query);
  //         const inTags = hook.tag.some(t => t.toLowerCase().includes(query));
  //         return inName || inCompany || inAlias || inTags;
  //       }
  //       return true;
  //     });
  //   }, [allHooks, search, statusFilter, fastModeFilter, groupFilter, tagFilter]);
  //   const totalPages = Math.ceil(filteredHooks.length / itemsPerPage);
  //   const paginatedHooks = useMemo(() => {
  //     const start = (currentPage - 1) * itemsPerPage;
  //     return filteredHooks.slice(start, start + itemsPerPage);
  //   }, [filteredHooks, currentPage]);
  //
  // revert: เอาบล็อกคอมเมนต์ด้านบนกลับมาเป็นโค้ดจริง แล้วลบ 3 บรรทัดล่างนี้
  const filteredHooks = allHooks;
  const paginatedHooks = allHooks;
  const totalPages = Math.max(Math.ceil(totalItems / itemsPerPage), 1);

  // กลับไปหน้า 1 เมื่อเปลี่ยนตัวกรอง — ใช้ debouncedSearch ไม่ใช่ search
  // เพราะถ้าใช้ search ตรง ๆ ทุกตัวอักษรจะรีเซ็ตหน้าก่อนที่ request จะยิง
  // [FIX-20260728-PERPAGE] itemsPerPage อยู่ในลิสต์นี้ด้วย — เปลี่ยนจาก 10 เป็น 100
  // ตอนอยู่หน้า 5 แล้วไม่รีเซ็ต จะขอหน้า 5 ของ 100 แถว/หน้า = เลยท้ายตาราง
  // ได้ผลลัพธ์ว่างเปล่าทั้งที่มีข้อมูล
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, statusFilter, fastModeFilter, groupFilter, tagFilter, itemsPerPage]);
  // ==== [FIX-20260728-HOOKPAGE] END

  // --- Selection Logic ---
  const handleSelectAll = () => {
    if (selectedIds.size === paginatedHooks.length && paginatedHooks.length > 0) {
      setSelectedIds(new Set());
    } else {
      const newSelected = new Set(selectedIds);
      paginatedHooks.forEach(h => newSelected.add(h._id));
      setSelectedIds(newSelected);
    }
  };

  const handleSelectRow = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const isAllSelected = paginatedHooks.length > 0 && paginatedHooks.every(h => selectedIds.has(h._id));

  // --- Delete Logic ---
  const handleDeleteClick = (id: string) => {
    setDeleteIds([id]);
    setDeleteConsent(false);
    setIsDeleteOpen(true);
  };

  const handleBulkDeleteClick = () => {
    setDeleteIds(Array.from(selectedIds));
    setDeleteConsent(false);
    setIsDeleteOpen(true);
  };

  // ==== [FEAT-20260729-BULKSTATUS] START — enable/disable the selected OAs
  // Reuses selectedIds, the same set bulk delete works from. The target state is
  // chosen inside the dialog so the toolbar keeps one button per action.
  //
  // Disabling an OA stops its webhook from being processed, so the dialog names
  // every OA involved rather than only counting them.
  // revert: delete this block, the bulkStatus* state, the toolbar button and
  //         <BulkStatusModal> below.
  const openBulkStatus = () => {
    if (selectedIds.size === 0) return;
    setBulkStatusChoice(null);
    setBulkStatusConfirm(false);
    setBulkStatusOpen(true);
  };

  const submitBulkStatus = async () => {
    if (bulkStatusChoice === null) return;
    const nextStatus = bulkStatusChoice ? 1 : 0;
    setBulkStatusSaving(true);
    try {
      const res = await webhookService.bulkUpdateHookStatus(Array.from(selectedIds), nextStatus);
      setSelectedIds(new Set());
      setBulkStatusOpen(false);
      await fetchData();
      showAlert(
        t('webhook_list.bulk_status_done_title'),
        t('webhook_list.bulk_status_done_message', {
          count: String(res.modified ?? selectedIds.size),
          state: bulkStatusChoice ? t('webhook_list.status_on') : t('webhook_list.status_off'),
        }),
        'success'
      );
    } catch (e: any) {
      // The API names the OAs it refused; show those rather than a generic error.
      const blocked = Array.isArray(e?.blocked)
        ? e.blocked.map((b: any) => `${b.alias} — ${b.reason}`).join('\n')
        : '';
      showAlert(t('webhook_list.bulk_status_failed_title'), blocked || e?.message || '', 'error');
    } finally {
      setBulkStatusSaving(false);
      setBulkStatusConfirm(false);
    }
  };
  // ==== [FEAT-20260729-BULKSTATUS] END

  const confirmDelete = async () => {
    setActionBusy(true);
    try {
      await webhookService.deleteHooks(deleteIds, getActor());
      setSelectedIds(new Set());
      await fetchData();
      showAlert(t('webhook_list.alert_deleted_title'), t('webhook_list.alert_deleted_message'), 'success');
    } catch (error: any) {
      console.error("Delete failed", error);
      showAlert(t('webhook_list.alert_delete_failed_title'), error.message || t('webhook_list.alert_delete_failed_message'), 'error');
    } finally {
      setActionBusy(false);
      setDeleteIds([]);
    }
  };

  const deleteMessage = useMemo(() => {
    if (deleteIds.length === 1) {
      const hook = allHooks.find(h => h._id === deleteIds[0]);
      if (hook) {
        return t('webhook_list.delete_single_message', { company: hook.company_name, alias: hook.alias });
      }
    } else if (deleteIds.length > 1) {
        return t('webhook_list.delete_many_message', { count: deleteIds.length });
    }
    return t('webhook_list.delete_many_message', { count: deleteIds.length });
  }, [deleteIds, allHooks, t]);

  // --- Form & View Logic ---
  // ==== [FEAT-20260731-HOOKFULLPAGE] ปุ่ม "เพิ่มใหม่" เปิดเป็นหน้าเต็ม ไม่ใช่ modal
  // เดิมเปิด modal (setIsFormOpen(true)) ทำให้ route /hooks/create ที่สร้างไว้
  // ไม่มีใครเรียกใช้เลย · ใช้รูปแบบเดียวกับ handleCopy (clone) ที่เปิดหน้าเต็มอยู่แล้ว
  // เปิดแท็บใหม่เหมือน edit/clone เพื่อไม่ให้ลิสต์ที่กรอง/เลือกไว้หายไป
  // revert: คืน 5 บรรทัดเดิม (setEditingHook/setFormPrefillHook/setFormMode/
  //         setIsViewMode/setIsFormOpen) แล้วลบ block นี้
  // [FEAT-20260805-NEWHOOKCHOICE] Add New เปิด modal เลือกทางก่อน (เว็บใหม่ / จากกลุ่มเดิม)
  const handleCreate = () => setShowNewChoice(true);
  const openCreateBlank = () => {
    setShowNewChoice(false);
    window.open(`${window.location.origin}${window.location.pathname}#/hooks/create`, '_blank');
  };
  const openCreateFromSource = (sourceId: string, provisionHandoff?: boolean) => {
    setShowNewChoice(false);
    // reuse the existing clone route — prefills all fields except channel/secret.
    // [FEAT-20260806-CLONE-PROVISION] ?provision=1 tells the clone page to also provision the
    // source's handoff bindings on create. absent = plain clone (เดิม).
    const q = provisionHandoff ? '?provision=1' : '';
    window.open(`${window.location.origin}${window.location.pathname}#/hooks/clone/${sourceId}${q}`, '_blank');
  };
  const openCreateInGroup = (groupId: string) => {
    setShowNewChoice(false);
    // create ปกติ + ล็อก group ไว้ (fill แค่กลุ่ม) — ?group= optional, create ปกติไม่มีก็ได้
    window.open(`${window.location.origin}${window.location.pathname}#/hooks/create?group=${groupId}`, '_blank');
  };
  // ==== [FEAT-20260731-HOOKFULLPAGE] END

  const loadHookForForm = async (hook: HookData, viewMode: boolean) => {
    if (isFormLoading) return;
    setIsFormLoading(true);
    try {
      const fullHook = await webhookService.getHookById(hook._id);
      setEditingHook(fullHook);
      setFormPrefillHook(undefined);
      setFormMode('update');
      setIsViewMode(viewMode);
      setIsFormOpen(true);
    } catch (error: any) {
      console.error(error);
      showAlert(t('webhook_list.alert_operation_failed_title'), error?.message || t('webhook_list.alert_operation_failed_message'), 'error');
    } finally {
      setIsFormLoading(false);
    }
  };

  // ==== [FEAT-20260731-HOOKFULLPAGE] START — Open edit / clone in standalone full page in new tab
  // User requirement: Clicking edit or clone opens a standalone page in a NEW browser tab (`window.open`)
  // revert: restore `loadHookForForm(hook, false)` and modal state setter in `handleCopy`
  // [FEAT-20260805-ACTIONCONFIRM] edit / clone / multi-clone ask a confirm first
  // (which row + what will happen), then run. delete/change-status already confirm.
  const runEdit = (hook: HookData) => {
    window.open(`${window.location.origin}${window.location.pathname}#/hooks/edit/${hook._id}`, '_blank');
  };
  const handleEdit = (hook: HookData) => setActionConfirm({ type: 'edit', hook });

  const handleView = (hook: HookData) => {
    loadHookForForm(hook, true);
  };

  const runClone = (hook: HookData) => {
    window.open(`${window.location.origin}${window.location.pathname}#/hooks/clone/${hook._id}`, '_blank');
  };
  const handleCopy = (hook: HookData) => setActionConfirm({ type: 'clone', hook });
  // ==== [FEAT-20260731-HOOKFULLPAGE] END

  const closeFormModal = () => {
    setIsFormOpen(false);
    setEditingHook(undefined);
    setFormPrefillHook(undefined);
    setFormMode('create');
    setIsViewMode(false);
    setIsFormLoading(false);
  };

  const openToggleModal = (
    hook: HookData, 
    field: 'status' | 'fast_mode' | 'follow_player_status',
    nextValue?: number,
    label?: string
  ) => {
    let computed = nextValue;
    if (field === 'status') {
      computed = computed ?? (hook.status === 1 ? 0 : 1);
    }
    /* [FEAT-20260822-NOTICEMODE] read `=== true` on purpose — the same lean rule
       the back end uses: a row that predates the column, or holds the STRING
       "true", counts as OFF. อ่านแบบเดียวกับ BE ห้ามใช้ truthy. */
    if (field === 'follow_player_status') {
      computed = computed ?? ((hook as any).follow_player_status === true ? 0 : 1);
    }
    if (computed === undefined) return;
    if (field === 'fast_mode' && computed === hook.fast_mode) return;
    setToggleConfirm({ isOpen: true, field, hook, nextValue: computed, label });
  };

  const confirmToggle = async () => {
    if (!toggleConfirm.hook || toggleConfirm.nextValue === undefined) return;
    setIsToggleLoading(true);
    try {
      let apiMessage: string | undefined;
      if (toggleConfirm.field === 'status') {
        const result = await webhookService.updateHookStatus(toggleConfirm.hook._id, toggleConfirm.nextValue);
        apiMessage = result?.message;
      } else if (toggleConfirm.field === 'follow_player_status') {
        /* [FEAT-20260822-NOTICEMODE] its own route — the main `PUT /hook/:id`
           DROPS this column by design (it is not in ALLOWED_UPDATES, whose 400
           text is golden-pinned against legacy), so writing it through
           `updateHook` would return 200 and change nothing.
           ⚠️ A REAL BOOLEAN: the BE rejects non-booleans on purpose, because the
           STRING "false" is truthy and would switch the wrong way. */
        await webhookService.updateHookNotice(toggleConfirm.hook._id, {
          follow_player_status: toggleConfirm.nextValue === 1,
        });
      } else {
        const updatePayload: Partial<HookFormData> = { fast_mode: toggleConfirm.nextValue };
        /* [REFACTOR-20260803-DOCBLOCK] แนบ Training Doc **ครบทั้ง 3 กล่อง**
           ⚠️ เดิมแนบแค่ suggestion_text · พอแยกเป็น 3 field แล้ว การกดสลับ fast mode
              จะกลายเป็นการส่ง payload ที่ไม่มีอีก 2 field -> ถ้าฝั่ง BE ตีความว่า
              "ไม่ส่ง = ไม่เปลี่ยน" ก็รอด แต่ถ้ามีใครเปลี่ยนเป็น replace เมื่อไหร่
              กล่อง 2/3 หายทันทีโดยไม่มีใครรู้ · แนบครบไว้ = ปลอดภัยทั้งสองทาง
           ⚠️ ส่งค่าที่อ่านมาตรง ๆ ไม่แปลงอะไร — หน้านี้ไม่ใช่ที่แก้เนื้อหา */
        if (toggleConfirm.hook?.suggestion_text) {
          updatePayload.suggestion_text = toggleConfirm.hook.suggestion_text;
        }
        if (toggleConfirm.hook?.suggestion_company_text) {
          updatePayload.suggestion_company_text = toggleConfirm.hook.suggestion_company_text;
        }
        if (toggleConfirm.hook?.suggestion_text_no_profile) {
          updatePayload.suggestion_text_no_profile = toggleConfirm.hook.suggestion_text_no_profile;
        }
        await webhookService.updateHook(toggleConfirm.hook._id, updatePayload);
      }
      /* [FEAT-20260822-NOTICEMODE] the notice route writes its OWN audit row
         (hooks.service.ts, `[NOTICEMODE] audit log failed`), so adding one here
         would record the same click twice — and the two rows would disagree the
         day either side changes its wording. หนึ่งคลิก หนึ่งแถว. */
      if (toggleConfirm.field !== 'follow_player_status')
      await safeAudit({
        ref_id: toggleConfirm.hook._id,
        hook_id: toggleConfirm.hook._id,
        parent: 'hook',
        action: toggleConfirm.field === 'status' ? 'toggle_status' : 'toggle_fast_mode',
        changed_fields: [
          {
            field: toggleConfirm.field,
            from: toggleConfirm.hook[toggleConfirm.field],
            to: toggleConfirm.nextValue
          }
        ],
        actor: getActor(),
        note: 'datatable toggle'
      });
      const fieldLabel = toggleConfirm.field === 'status'
        ? t('webhook_list.toggle_field_status')
        : toggleConfirm.field === 'follow_player_status'
          ? t('webhook_list.toggle_field_follow_player')
          : t('webhook_list.toggle_field_fast_mode');
      const fastModeLabel =
        toggleConfirm.label ??
        fastModeLabels[toggleConfirm.nextValue ?? 2] ??
        fieldLabel;
      const statusMessage = toggleConfirm.nextValue === 1
        ? t('webhook_list.toggle_status_enabled', { field: fieldLabel })
        : t('webhook_list.toggle_status_disabled', { field: fieldLabel });
      const message =
        toggleConfirm.field === 'status' ||
        toggleConfirm.field === 'follow_player_status'
          ? apiMessage || statusMessage
          : apiMessage || t('webhook_list.toggle_fast_mode_updated', { mode: fastModeLabel });
      showAlert(
        toggleConfirm.field === 'fast_mode' ? t('webhook_list.alert_fast_mode_title') : t('webhook_list.alert_status_title'),
        message,
        'success'
      );
      await fetchData();
    } catch (error: any) {
      console.error(error);
      showAlert(t('webhook_list.alert_update_failed_title'), error.message || t('webhook_list.alert_update_failed_message'), 'error');
    } finally {
      setIsToggleLoading(false);
      setToggleConfirm({ isOpen: false, field: 'status', label: undefined });
    }
  };

  const submitForm = async (data: HookFormData) => {
    try {
      // [FEAT-20260817-FORMDIFF] On edit the form now sends only the fields the
      // operator changed, so this block must not re-create the ones it omitted —
      // the guarded rules live in utils/hookFormPayload.ts, shared with
      // HookFormPage so the two screens cannot drift apart again.
      const normalizedPayload = normalizeHookSubmission(data as any, {
        isCreate: formMode === 'create',
      }) as HookFormData;
      const finalPayload: Partial<HookFormData> = normalizedPayload;

      if (editingHook) {
        await webhookService.updateHook(editingHook._id, finalPayload);
        const changes = Object.keys(finalPayload).flatMap((key) => {
          const field = key as keyof HookFormData;
          const beforeVal = (editingHook as any)[field];
          const afterVal = (finalPayload as any)[field];
          // [FIX-20260817-BLANKSECRET] the mask is not a value — see the same
          // guard in HookFormPage and utils/secretMask.ts for why.
          if (isMaskedSecret(beforeVal) || isMaskedSecret(afterVal)) return [];
          if (JSON.stringify(beforeVal ?? null) === JSON.stringify(afterVal ?? null)) return [];
          const f = String(field);
          return [{
            field: f,
            from: redactIfSensitive(f, beforeVal ?? null),
            to: redactIfSensitive(f, afterVal ?? null)
          }];
        });
        await safeAudit({
          ref_id: editingHook._id,
          hook_id: editingHook._id,
          parent: 'hook',
          action: 'update',
          changed_fields: changes,
          actor: getActor(),
          note: 'form update'
        });
        showAlert(t('webhook_list.alert_updated_title'), t('webhook_list.alert_updated_message'), 'success');
      } else {
        const created: any = await webhookService.createHook(normalizedPayload);
        const createdId = created?._id || created?.data?._id;
        if (createdId) {
          const customAi = (normalizedPayload as any).custom_ai_key;
          const suggestionText = (normalizedPayload as any).suggestion_text;
          await safeAudit({
            ref_id: createdId,
            hook_id: createdId,
            parent: 'hook',
            action: 'create',
            changed_fields: [
              { field: 'status', from: null, to: (normalizedPayload as any).status ?? null },
              { field: 'fast_mode', from: null, to: (normalizedPayload as any).fast_mode ?? null },
              ...(customAi ? [{ field: 'custom_ai_key', from: null, to: redactIfSensitive('custom_ai_key', customAi) }] : []),
              ...(suggestionText ? [{ field: 'suggestion_text', from: null, to: suggestionText }] : [])
            ],
            actor: getActor(),
            note: 'form create'
          });
        }
        showAlert(t('webhook_list.alert_created_title'), t('webhook_list.alert_created_message'), 'success');
      }
      fetchData();
    } catch (error: any) {
      // Re-throw so the modal form knows something went wrong and doesn't close
      showAlert(t('webhook_list.alert_operation_failed_title'), error?.message || t('webhook_list.alert_operation_failed_message'), 'error');
      throw error;
    }
  };

  // --- Tags Modal Logic ---
  const openTagsModal = (tags: string[]) => {
    setTagsModalData(tags);
    setIsTagsModalOpen(true);
  };

  const openLineConfirm = (hook: HookData) => {
    setLineConfirm({ isOpen: true, hook });
  };

  const closeLineConfirm = () => {
    setLineConfirm({ isOpen: false, hook: undefined });
  };

  const confirmOpenLine = () => {
    if (!lineConfirm.hook?.line_url) return;
    window.open(lineConfirm.hook.line_url, '_blank', 'noopener,noreferrer');
    closeLineConfirm();
  };

  const TogglePill = ({
    on,
    onClick,
    icon: Icon,
    colorOn,
    colorOff = 'bg-slate-200 border border-dark-600',
    knobOn = 'translate-x-7 text-emerald-600 bg-white/90',
    knobOff = 'translate-x-0 text-slate-500 bg-white/70',
    scale = 1
  }: {
    on: boolean;
    onClick: () => void;
    icon: React.ComponentType<{ size?: number }>;
    colorOn: string;
    colorOff?: string;
    knobOn?: string;
    knobOff?: string;
    scale?: number;
  }) => (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center h-9 w-16 rounded-full transition-all duration-300 ${on ? colorOn : colorOff} shadow-lg hover:shadow-xl`}
      style={{ transform: `scale(${scale})` }}
    >
      <span
        className={`absolute left-1 top-1 h-7 w-7 rounded-full flex items-center justify-center transition-transform duration-300 ${on ? knobOn : knobOff}`}
      >
        <Icon size={16} />
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* [FEAT-20260801-SAVETOAST] แถบยืนยันหลังบันทึก — หายเองใน 4 วินาที
          วางบนสุดของหน้าเพื่อให้เห็นทันทีที่เด้งกลับมา ไม่ต้องเลื่อนหา */}
      {savedToast && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-300 shadow-sm">
          <CheckCircle size={18} className="shrink-0" />
          <span>{savedToast}</span>
        </div>
      )}

      {/* Header Actions */}
      <div className="flex flex-col gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 min-w-0">
            {/* [FEAT-20260917-HOOKTABS] Tab switcher moved in front of label */}
            <HookPageTabs active={activeTab} onChange={setActiveTab} />
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">
                {activeTab === 'quota' ? t('hook_quota.note_push_only') : t('webhook_list.subtitle')}
              </p>
            </div>
          </div>

          {activeTab === 'quota' && (
            <div className="flex items-center gap-3 w-full lg:w-auto lg:ml-auto">
              <div className="relative group w-full sm:w-72">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
                </div>
                <input
                  type="text"
                  placeholder={t('hook_quota.search_placeholder', 'ค้นหา OA...')}
                  value={quotaSearch}
                  onChange={(e) => setQuotaSearch(e.target.value)}
                  className="pl-10 pr-4 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                />
              </div>

              <button
                type="button"
                onClick={() => quotaRefreshRef.current?.()}
                className="flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
              >
                <RefreshCw size={16} />
                <span className="hidden sm:inline">{t('common.refresh', 'รีเฟรช')}</span>
              </button>
            </div>
          )}
        </div>
        
        {activeTab === 'manage' && (
        /* Controls Container: Stacks vertically on mobile, row on desktop */
        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3 w-full">
          
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:flex-1 flex-wrap">
             {/* [FIX-20260828-WLISTSEARCHSEL] เจ้าของ 28/08: *"3 select นี้ search ได้ด้วย
                 ใช้ตัวเดียวกัน อย่าสร้างหนี้"*
                 🔴 ทั้งสามช่องเคยเป็น `<select>` ดิบ — หน้าตาคนละแบบกับตัวเลือกที่เหลือ
                    ทั้งแอป และค้นหาไม่ได้ · กลุ่มในระบบมีหลายสิบ แท็กยิ่งมากกว่า
                    การไล่ตาหาในรายการยาว ๆ โดยไม่มีช่องค้นคือสาเหตุที่ตัวกลางนี้ถูก
                    เขียนขึ้นตั้งแต่แรก
                 ⚠️ ใช้ `SearchableSelect` ตัวเดิม ไม่ได้เขียนใบใหม่ — เพิ่ม dropdown
                    อีกใบเมื่อไหร่ วันหน้าจะต้องมาไล่แก้ทุกใบให้เหมือนกันอีกรอบ
                 ⚠️ ค่า `'all'` ยังเป็นค่าเดิมของตัวกรอง ไม่ได้เปลี่ยนเป็น `''` —
                    ตัวกรองข้างล่างเทียบกับ `'all'` อยู่ ถ้าเปลี่ยนที่นี่ที่เดียว
                    รายการจะว่างเปล่าโดยไม่มี error ให้เห็น
                 revert: คืน `<select>` สามใบเดิม + ลบ import ด้านบน */}
             <div className="w-full sm:w-40" data-testid="hook-status-filter">
               <SearchableSelect
                  value={statusFilter}
                  onChange={(v) => setStatusFilter((v || 'all') as any)}
                  options={[
                    { value: 'all', label: t('status.all_status') },
                    { value: 'active', label: t('status.active') },
                    { value: 'inactive', label: t('status.inactive') },
                  ]}
                  placeholder={t('status.all_status')}
               />
            </div>

            {/* Group Filter — ⚠️ ตอนโหลดยังไม่เสร็จ เดิมมีแถว "กำลังโหลด" ที่กดไม่ได้
                อยู่ในรายการ · ตัวกลางไม่มีแถวแบบนั้น จึงบอกผ่าน placeholder แทน
                ไม่ใช่ปล่อยให้เมนูว่างเปล่าซึ่งอ่านได้ว่า "ไม่มีกลุ่มในระบบ" */}
            <div className="w-full sm:w-44" data-testid="hook-group-filter">
               <SearchableSelect
                  value={groupFilter}
                  onChange={(v) => setGroupFilter(v || 'all')}
                  options={[
                    { value: 'all', label: t('webhook_list.filter_group_all') },
                    ...groups.map((group) => ({
                      value: group._id,
                      label: group.group_name,
                    })),
                  ]}
                  placeholder={
                    groupsLoading
                      ? t('hook_form.group_loading')
                      : t('webhook_list.filter_group_all')
                  }
               />
            </div>

            {/* Tag Filter */}
            <div className="w-full sm:w-44" data-testid="hook-tag-filter">
               <SearchableSelect
                  value={tagFilter}
                  onChange={(v) => setTagFilter(v || 'all')}
                  options={[
                    { value: 'all', label: t('webhook_list.filter_tag_all') },
                    ...tagOptions.map((tag) => ({ value: tag, label: tag })),
                  ]}
                  placeholder={t('webhook_list.filter_tag_all')}
               />
            </div>

            {/* [HIDE-20260917-FASTMODEFILTER] Fast mode filter hidden per user request */}
            {false && (
            <div className="w-full sm:w-40" data-testid="hook-fast-mode-filter">
               <SearchableSelect
                  value={String(fastModeFilter)}
                  onChange={(v) => setFastModeFilter((v || 'all') as any)}
                  options={[
                    { value: 'all', label: t('webhook_list.fast_mode_all') },
                    ...fastModeOptions.map((o) => ({ value: String(o.value), label: o.label })),
                  ]}
                  placeholder={t('webhook_list.fast_mode_all')}
               />
            </div>
            )}

            {/* Search Box - Expanded full width available */}
            <div className="relative group w-full sm:flex-1 sm:min-w-[200px]">
               <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
               </div>
               <input 
                  type="text" 
                  placeholder={t('webhook_list.search_placeholder')} 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
               />
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
            {/* [FEAT-20260729-BULKSTATUS] sits beside the existing bulk delete
                and reuses the SAME selectedIds — no second selection mechanism.
                Amber, not red: this one is reversible, delete is not, and they
                must not look interchangeable when they sit side by side. */}
            {/* [FEAT-20260805-DESELECT] ยกเลิกการเลือกทั้งหมด — โผล่เมื่อมีแถวถูกเลือก */}
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
              >
                <X size={18} />
                <span className="hidden sm:inline">{t('webhook_list.deselect')}</span>
              </button>
            )}

            {/* [FEAT-20260806-BULKMETHOD] On/Off = ALWAYS visible, kept in its ORIGINAL spot:
                selected → right after Deselect · nothing selected → before Test Key / Add New.
                glow only when a selection exists · 0 selected opens the stepper on group→OA.
                revert: wrap in {selectedIds.size>0 && …} + repoint onClick to openBulkStatus. */}
            <button
              onClick={() => setBulkMethodOpen(true)}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${selectedIds.size > 0 ? 'scale-[1.03] ring-2 ring-amber-400/70 animate-glow-pulse-amber' : ''}`}
            >
              <Power size={18} />
              <span className="hidden sm:inline">{t('webhook_list.bulk_status')}</span>{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </button>

            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkDeleteClick}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-red-500/20 transition-all hover:scale-105"
              >
                <Trash2 size={18} />
                <span className="hidden sm:inline">{t('webhook_list.delete')}</span> ({selectedIds.size})
              </button>
            )}

            {/* [FEAT-20260805-CLONE-TOOLBAR] clone — SHOWS ONLY when exactly one row is
                selected (hidden otherwise), then opens the modal with that row as source. */}
            {selectedIds.size === 1 && (
              <button
                onClick={() => {
                  const id = Array.from(selectedIds)[0];
                  const hook = allHooks.find((h) => h._id === id);
                  if (hook) setCloneSource(hook);
                }}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                title={t('hook_clone.title')}
              >
                <CopyPlus size={18} />
                <span className="hidden sm:inline">{t('hook_clone.clone_short')}</span>
              </button>
            )}

            {/* [FEAT-20260805-ROWSELECT] เลือกแถวอยู่ = ซ่อน Test Key + Add New
                (โฟกัสที่ bulk action ของแถวที่เลือก ไม่ให้ปุ่มรก) */}
            {selectedIds.size === 0 && (
              <>
                {/* [HIDE-20260917-KEYTESTER] Test key button hidden per user request */}
                {false && (
                  <button
                    onClick={openKeyTester}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                    title={t('webhook_list.test_key_title')}
                  >
                    <TestTube2 size={18} />
                    {t('webhook_list.test_key')}
                  </button>
                )}

                <button
                  onClick={handleCreate}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-primary-500/20 transition-all hover:scale-105 whitespace-nowrap"
                >
                  <Plus size={18} />
                  {t('webhook_list.add_new')}
                </button>
              </>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Table Container */}
      {activeTab === 'manage' && (
      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden relative">
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
        )}
        {/* [UI-20260826-HOOKPAGERTOP] เจ้าของสั่ง: "pagination หน้า hook แสดงบน
            header ด้วย พร้อม total count + per page เหมือน footer เลย"
            ⚠️ อ่าน/เขียน state ก้อนเดียวกับตัวล่าง ⇒ กดที่ไหนก็ขยับพร้อมกันทั้งคู่ */}
        <HookTablePager
          edge="top"
          itemsPerPage={itemsPerPage}
          onItemsPerPage={setItemsPerPage}
          perPageOptions={PER_PAGE_OPTIONS}
          currentPage={currentPage}
          totalPages={totalPages}
          onPage={setCurrentPage}
          totalLabel={t('common.showing_total', { count: totalItems })}
        />
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                <th className="px-6 py-4 w-12">
                   <button 
                    onClick={handleSelectAll}
                    className="text-slate-500 hover:text-slate-900 transition-colors flex items-center"
                   >
                     {isAllSelected ? <CheckSquare size={18} className="text-primary-500" /> : <Square size={18} />}
                   </button>
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('webhook_list.header_oa_name_company')}</th>
                {/* [FEAT-20260804-GROUPCOL] คอลัมน์กลุ่ม — วางก่อน ALIAS ตามที่สั่ง
                    ⚠️ API รายการ hook ส่ง group มาเป็น id เท่านั้น (ไม่ populate ชื่อ)
                       จึงแปลง id → ชื่อ ด้วย groups ที่หน้านี้โหลดไว้อยู่แล้ว (ตัวกรองใช้อยู่)
                       ไม่ต้องยิง API เพิ่ม · revert: ลบ th/td คู่นี้ + groupNameOf */}
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('webhook_list.header_group')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('webhook_list.header_alias')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('webhook_list.header_tags')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('webhook_list.header_status')}</th>
                {/* [HIDE-20260823-FOLLOWERSWITCH] see SHOW_FOLLOWER_COLUMN above */}
                {SHOW_FOLLOWER_COLUMN && (
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('webhook_list.header_follow_player')}</th>
                )}
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('webhook_list.header_updated_at')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right whitespace-nowrap">{t('webhook_list.header_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && filteredHooks.length === 0 ? (
                 <tr>
                   <td colSpan={TABLE_COLUMN_COUNT} className="px-6 py-12 text-center text-slate-500">
                      {t('webhook_list.no_results')}
                   </td>
                </tr>
              ) : (
                paginatedHooks.map((hook) => {
                  const isSelected = selectedIds.has(hook._id);
                  return (
                    <tr
                      key={hook._id}
                      // [FEAT-20260805-ROWCLICK] คลิกที่ว่างของแถว = ติ๊กเลือก · ยกเว้นคลิกบน
                      // ปุ่ม/ลิงก์/อินพุต/สวิตช์ (interactive) เพื่อไม่ให้ชนกับ action เดิม
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, a, input, label, [role="switch"]')) return;
                        handleSelectRow(hook._id);
                      }}
                      className={`transition-colors group cursor-pointer ${isSelected ? 'bg-primary-500/20 dark:bg-primary-500/25 ring-1 ring-inset ring-primary-500/40' : 'hover:bg-dark-700/50'}`}
                    >
                      <td className="px-6 py-4">
                        <button 
                          onClick={() => handleSelectRow(hook._id)}
                          className="text-slate-500 hover:text-slate-900 transition-colors flex items-center"
                        >
                          {isSelected ? <CheckSquare size={18} className="text-primary-500" /> : <Square size={18} />}
                        </button>
                      </td>
                      <td className="px-6 py-4 min-w-[220px]">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            {/* [FEAT-20260804-LISTDOMAIN] บรรทัดบน = "เว็บ" (company_name)
                                เดิมโชว์ line_oa_name ซึ่งซ้ำกับคอลัมน์ชื่อ LINE OA อยู่แล้ว
                                ⚠️ fallback ไป line_oa_name เผื่อ hook เก่าที่ยังไม่ได้กรอกชื่อเว็บ
                                   ไม่งั้นแถวจะว่างเปล่าจนกดอะไรไม่ถูก */}
                            <span className="text-sm font-medium text-slate-900 truncate max-w-[200px]" title={hook.company_name || hook.line_oa_name}>{hook.company_name || hook.line_oa_name || '-'}</span>
                            <button
                              onClick={() => handleView(hook)}
                              className="p-1 rounded-md bg-dark-700 text-slate-600 hover:text-slate-900 hover:bg-dark-600 transition-colors"
                              title={t('webhook_list.view_connection_details')}
                            >
                              <Info size={14} />
                            </button>
                            {channelOf(hook.channel_type).brandActions && (
                            <button
                              onClick={() => openLineConfirm(hook)}
                              className="w-7 h-7 rounded-full bg-[#06C755] text-white text-[9px] font-bold flex items-center justify-center shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                              title={t('webhook_list.open_line')}
                              aria-label={t('webhook_list.open_line')}
                              disabled={!hook.line_url}
                            >
                              {channelOf(hook.channel_type).label}
                            </button>
                            )}
                          </div>
                          {/* [FEAT-20260804-LISTDOMAIN] บรรทัดล่าง = โดเมน กดแล้วเปิดแท็บใหม่
                              ⚠️ ไม่มีโดเมน → แสดง "-" เฉย ๆ ไม่ทำเป็นลิงก์ (กดแล้วเปิดหน้าว่าง)
                              ⚠️ เติม https:// ให้เองถ้าแอดมินพิมพ์แค่ example.com
                                 ไม่งั้น browser จะมองเป็น path ในเว็บเรา แล้วเปิดหน้า 404 ของตัวเอง
                              ⚠️ rel="noopener noreferrer" — กันหน้าปลายทางเข้าถึง window.opener ได้
                              ⚠️ stopPropagation กันไปโดนคลิกของแถว */}
                          {hook.domain_name && String(hook.domain_name).trim() ? (
                            <a
                              href={/^https?:\/\//i.test(hook.domain_name) ? hook.domain_name : `https://${hook.domain_name}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title={hook.domain_name}
                              className="text-xs text-primary-600 hover:text-primary-500 hover:underline truncate max-w-[200px] inline-flex items-center gap-1 w-fit"
                            >
                              <ExternalLink size={11} className="shrink-0" />
                              {hook.domain_name}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400" title={t('webhook_list.no_domain')}>-</span>
                          )}
                          <div className="flex items-center gap-2 text-xs">
                          </div>
                        </div>
                      </td>
                      {/* [FEAT-20260804-GROUPCOL] ชื่อกลุ่ม (เว็บ) — ไม่มีค่า = "-" ไม่ปล่อยว่าง */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          {groupNameOf(hook) || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs font-mono text-slate-600 bg-dark-900 px-2 py-1 rounded border border-dark-600">
                          {hook.alias}
                        </span>
                      </td>
                      <td className="px-6 py-4 min-w-[150px]">
                        <div className="flex flex-wrap gap-1 items-center" title={hook.tag.join(', ')}>
                          {hook.tag.slice(0, 2).map((t, i) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
                              {t}
                            </span>
                          ))}
                          {hook.tag.length > 2 && (
                            <button 
                                onClick={() => openTagsModal(hook.tag)}
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-dark-700 text-slate-600 hover:bg-primary-600 hover:text-white transition-colors border border-dark-600"
                            >
                                +{hook.tag.length - 2}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <TogglePill
                          on={hook.status === 1}
                          onClick={() => openToggleModal(hook, 'status')}
                          icon={Power}
                          colorOn="bg-emerald-500 shadow-[0_10px_30px_rgba(16,185,129,0.35)]"
                          colorOff="bg-slate-200 border border-dark-600"
                          knobOn="translate-x-7 text-emerald-600 bg-white"
                          knobOff="translate-x-0 text-slate-500 bg-white/80"
                          scale={0.6}
                        />
                      </td>
                      {/* [FEAT-20260822-NOTICEMODE] follower switch — same pill,
                          same confirm modal, its own colour so the two are never
                          mistaken for each other at a glance. It writes through
                          the notice route (see confirmToggle). */}
                      {/* [HIDE-20260823-FOLLOWERSWITCH] ซ่อนคู่กับ <th> —
                          ทั้งสองต้องขยับพร้อมกัน ไม่งั้นคอลัมน์หลังจากนี้เลื่อนหมด */}
                      {SHOW_FOLLOWER_COLUMN && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <TogglePill
                            on={(hook as any).follow_player_status === true}
                            onClick={() => openToggleModal(hook, 'follow_player_status')}
                            icon={UserCheck}
                            colorOn="bg-indigo-500 shadow-[0_10px_30px_rgba(99,102,241,0.35)]"
                            colorOff="bg-slate-200 border border-dark-600"
                            knobOn="translate-x-7 text-indigo-600 bg-white"
                            knobOff="translate-x-0 text-slate-500 bg-white/80"
                            scale={0.6}
                          />
                        </td>
                      )}
                      <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                         {new Date(hook.updated_at || hook.created_at).toLocaleString('th-TH', { 
                           day: '2-digit', month: '2-digit', year: 'numeric', 
                           hour: '2-digit', minute: '2-digit' 
                         })}
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                             <button 
                              onClick={() => handleView(hook)}
                              className="p-1.5 rounded-lg hover:bg-blue-500/20 text-slate-500 hover:text-blue-500 transition-colors"
                              title={t('webhook_list.view_details')}
                            >
                              <Eye size={16} />
                            </button>
                            <button 
                              onClick={() => handleEdit(hook)}
                              className="p-1.5 rounded-lg hover:bg-primary-500/20 text-slate-500 hover:text-primary-500 transition-colors"
                              title={t('webhook_list.edit')}
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => handleCopy(hook)}
                              className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-slate-500 hover:text-indigo-500 transition-colors"
                              title={t('webhook_list.copy_row')}
                            >
                              <Copy size={16} />
                            </button>
                            {/* clone — มีทั้ง 2 ทาง: ปุ่ม toolbar (เลือก 1 แถว) + icon ในแถวนี้ */}
                            <button
                              onClick={() => setCloneSource(hook)}
                              className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-slate-500 hover:text-emerald-600 transition-colors"
                              title={t('hook_clone.title')}
                            >
                              <CopyPlus size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteClick(hook._id)}
                              className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-500 transition-colors"
                              title={t('webhook_list.delete_action')}
                            >
                              <Trash2 size={16} />
                            </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* [UI-20260826-HOOKPAGERTOP] แถบล่าง — มาร์กอัปเดิมย้ายเข้า component แล้ว
            ตัวบนสุดของตารางใช้ตัวเดียวกัน ต่างแค่ prop `edge` */}
        <HookTablePager
          itemsPerPage={itemsPerPage}
          onItemsPerPage={setItemsPerPage}
          perPageOptions={PER_PAGE_OPTIONS}
          currentPage={currentPage}
          totalPages={totalPages}
          onPage={setCurrentPage}
          totalLabel={t('common.showing_total', { count: totalItems })}
        />
      </div>
      )}

      {activeTab === 'quota' && (
        <LineQuotaTable
          showHeaderCard={false}
          search={quotaSearch}
          onSearchChange={setQuotaSearch}
          onRefresh={handleRegisterQuotaRefresh}
        />
      )}

      {/* [UI-20260826-DELCONSENT] เจ้าของสั่ง: "modal delete webhook เพิ่ม checkmark
          ก่อน ใหญ่ ๆ กดง่าย" · ปุ่มยืนยันถูกล็อกจนกว่าจะติ๊ก และค่าติ๊กถูกล้างทุกครั้ง
          ที่ปิด/เปิดโมดัล ไม่งั้นรอบถัดไปจะเปิดมาแบบ "ติ๊กไว้แล้ว" ซึ่งอันตรายกว่าเดิม */}
      <ConfirmModal 
        isOpen={isDeleteOpen}
        onClose={() => { setIsDeleteOpen(false); setDeleteConsent(false); }}
        onConfirm={confirmDelete}
        confirmDisabled={!deleteConsent}
        title={deleteIds.length > 1 ? t('webhook_list.delete_many_title', { count: deleteIds.length }) : t('webhook_list.delete_single_title')}
        message={deleteMessage}
        type="danger"
      >
        <ConfirmConsentCheck
          checked={deleteConsent}
          onChange={setDeleteConsent}
          label={deleteIds.length > 1
            ? t('pageui.hook.list.delete_consent_many', 'เข้าใจแล้วว่ากำลังลบ {n} รายการ', { n: deleteIds.length })
            : t('pageui.hook.list.delete_consent_one', 'เข้าใจแล้วว่ากำลังลบรายการนี้')}
        />
      </ConfirmModal>

      {/* [FEAT-20260729-BULKSTATUS] shares BulkStatusModal with the Users page;
          only the wording differs, which is why that component takes labels. */}
      <BulkStatusModal
        isOpen={bulkStatusOpen}
        onClose={() => { setBulkStatusOpen(false); setBulkStatusConfirm(false); }}
        usernames={allHooks.filter(h => selectedIds.has(h._id)).map(h => h.alias || h.line_oa_name || h._id)}
        choice={bulkStatusChoice}
        onChoice={(next) => { setBulkStatusChoice(next); setBulkStatusConfirm(false); }}
        confirming={bulkStatusConfirm}
        onConfirmStep={() => setBulkStatusConfirm(true)}
        onSubmit={submitBulkStatus}
        saving={bulkStatusSaving}
        labels={{
          title: t('webhook_list.bulk_status_title'),
          targets: t('webhook_list.bulk_status_targets', { count: String(selectedIds.size) }),
          onLabel: t('webhook_list.status_on'),
          offLabel: t('webhook_list.status_off'),
          warning: t('webhook_list.bulk_status_warning'),
        }}
      />

      {/* [FEAT-20260806-BULKMETHOD] the method stepper (group → OA → method → confirm).
          Self-contained: it applies via webhookService and calls onApplied on success. */}
      <BulkMethodModal
        isOpen={bulkMethodOpen}
        onClose={() => setBulkMethodOpen(false)}
        preselected={allHooks
          .filter((h) => selectedIds.has(h._id))
          .map((h) => ({ id: h._id, name: h.alias || h.line_oa_name || h._id }))}
        onApplied={(info) => {
          setSelectedIds(new Set());
          fetchData();
          showAlert(
            t('bulk_method.done_title'),
            t('bulk_method.done_message', {
              method: info.methodLabel,
              /* [FEAT-20260828-BULKAI] `stateLabel` มาก่อน — method ที่ไม่ใช่สวิตช์
                 (AI vendor/model) ไม่มีสถานะเปิด/ปิด · ถ้าบังคับให้เลือกอย่างใด
                 อย่างหนึ่ง ข้อความสรุปจะบอกว่า "ปิด" ทั้งที่ผู้ใช้เพิ่งตั้ง vendor */
              state:
                info.stateLabel ??
                (info.state ? t('bulk_method.value_on') : t('bulk_method.value_off')),
              count: String(info.count),
            }),
            'success'
          );
        }}
      />

      <ConfirmModal
        isOpen={toggleConfirm.isOpen}
        onClose={() => setToggleConfirm({ isOpen: false, field: 'status', label: undefined })}
        onConfirm={confirmToggle}
        /* [FIX-20260823-FOLLOWDIALOG] THREE fields, three titles.
           This read `status ? … : fast_mode` — two branches for three fields — so
           the follower toggle, added later, fell into the ELSE and asked
           "เปลี่ยน Fast Mode?" while writing follow_player_status. The write was
           right; only the question was wrong, which is the worse half: the
           operator confirms a change to a setting nobody touched.
           ⚠️ Add a branch here whenever `openToggleModal` learns a new field.
           สามค่า ต้องสามข้อความ ห้ามปล่อยตกใส่ else. */
        title={
          toggleConfirm.field === 'status'
            ? t('webhook_list.toggle_status_title', {
                state: toggleConfirm.nextValue === 1 ? t('status.on') : t('status.off')
              })
            : toggleConfirm.field === 'follow_player_status'
              ? t('webhook_list.toggle_follow_player_title')
              : t('webhook_list.toggle_fast_mode_title', {
                  mode: toggleConfirm.label ?? fastModeLabels[toggleConfirm.nextValue ?? 2] ?? t('webhook_list.toggle_field_fast_mode')
                })
        }
        message={
          toggleConfirm.hook
            ? toggleConfirm.field === 'status'
              ? t('webhook_list.toggle_status_message', {
                  name: toggleConfirm.hook.line_oa_name,
                  company: toggleConfirm.hook.company_name
                })
              : toggleConfirm.field === 'follow_player_status'
              /* names the OA and the DIRECTION — the two things the operator
                 needs to check before confirming, and neither was on screen. */
              ? t('webhook_list.toggle_follow_player_message', {
                  name: toggleConfirm.hook.line_oa_name,
                  company: toggleConfirm.hook.company_name,
                  state: toggleConfirm.nextValue === 1 ? t('status.on') : t('status.off')
                })
              : t('webhook_list.toggle_fast_mode_message', {
                  name: toggleConfirm.hook.line_oa_name,
                  company: toggleConfirm.hook.company_name,
                  mode: toggleConfirm.label ?? fastModeLabels[toggleConfirm.nextValue ?? 2] ?? t('webhook_list.toggle_field_fast_mode')
                })
            : ''
        }
        type="warning"
      />

      <HookFormModal 
        isOpen={isFormOpen}
        onClose={closeFormModal}
        onSubmit={submitForm}
        initialData={formPrefillHook ?? editingHook}
        isViewMode={isViewMode}
        mode={formMode}
      />

      <TagsModal
        isOpen={isTagsModalOpen}
        onClose={() => setIsTagsModalOpen(false)}
        tags={tagsModalData}
      />

      {/* [FEAT-20260804-HOOKCLONE] คัดลอกการตั้งค่า OA → OA อื่นในกลุ่มเดียวกัน
          ส่ง hooks ทั้งหมดที่หน้านี้โหลดมาแล้วเข้าไป ไม่ต้องยิง API ซ้ำ
          ⚠️ โมดัลกรองเองว่าปลายทางต้องกลุ่มเดียวกับต้นแบบ · BE กันซ้ำอีกชั้น */}
      <NewHookChoiceModal
        isOpen={showNewChoice}
        onClose={() => setShowNewChoice(false)}
        onCreateBlank={openCreateBlank}
        onCreateFromSource={openCreateFromSource}
        onCreateInGroup={openCreateInGroup}
      />

      {/* [FEAT-20260805-ACTIONCONFIRM] ยืนยันก่อน edit/clone */}
      <ConfirmModal
        isOpen={!!actionConfirm}
        title={actionConfirm?.type === 'clone' ? t('webhook_list.confirm_clone_title') : t('webhook_list.confirm_edit_title')}
        message={
          actionConfirm
            ? (actionConfirm.type === 'clone' ? t('webhook_list.confirm_clone_message') : t('webhook_list.confirm_edit_message'))
                .replace('{name}', (actionConfirm.hook as any).display_name || actionConfirm.hook.line_oa_name || actionConfirm.hook.alias || actionConfirm.hook._id)
            : ''
        }
        type={actionConfirm?.type === 'clone' ? 'info' : 'info'}
        onConfirm={() => {
          if (!actionConfirm) return;
          if (actionConfirm.type === 'edit') runEdit(actionConfirm.hook);
          else runClone(actionConfirm.hook);
          setActionConfirm(null);
        }}
        onClose={() => setActionConfirm(null)}
      />

      <HookCloneModal
        isOpen={!!cloneSource}
        onClose={() => setCloneSource(null)}
        source={cloneSource}
        allHooks={allHooks}
        sourceGroupName={cloneSource ? groupNameOf(cloneSource) : undefined}
        onDone={({ success, failed }) => {
          showAlert(
            t('hook_clone.title'),
            t('hook_clone.done_msg')
              .replace('{ok}', String(success))
              .replace('{fail}', String(failed)),
            failed ? 'error' : 'success'
          );
          fetchData();
        }}
      />

      <AlertModal
        isOpen={alertState.isOpen}
        onClose={closeAlert}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />

      {isToggleLoading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-white/45 backdrop-blur transition-opacity">
          <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-sm transform transition-all scale-100">
            <div className="flex items-center gap-3 p-6 border-b border-dark-700">
              <Loader2 className="animate-spin text-primary-400" size={20} />
              <h3 className="text-lg font-semibold text-slate-900">{t('webhook_list.updating_webhook')}</h3>
            </div>
            <div className="p-6 text-sm text-slate-600">
              {t('webhook_list.updating_webhook_message')}
            </div>
          </div>
        </div>
      )}

      {isKeyTesterOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/45 backdrop-blur transition-opacity">
          <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex justify-between items-center p-4 border-b border-dark-700">
              <h3 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
                <TestTube2 size={20} className="text-primary-400" />
                {t('webhook_list.test_key_title')}
              </h3>
              <button onClick={closeKeyTester} className="text-slate-500 hover:text-slate-900 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('webhook_list.ai_key_label')}</label>
                <input
                  value={keyTesterValue}
                  onChange={(e) => {
                    setKeyTesterValue(e.target.value);
                    setKeyTesterResult({ status: 'idle' });
                  }}
                  placeholder={t('webhook_list.ai_key_placeholder')}
                  className="w-full bg-primary-500/10 border border-primary-500/30 rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                />
              </div>

              {keyTesterResult.status === 'error' && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  {t('webhook_list.invalid_key', { message: keyTesterResult.message || t('webhook_list.invalid_key_short') })}
                </div>
              )}
              {keyTesterResult.status === 'success' && (
                <div className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle size={18} />
                  {keyTesterResult.message || t('webhook_list.valid_key')}
                </div>
              )}
              {keyTesterResult.status === 'idle' && (
                <div className="text-xs text-slate-500">
                  {t('webhook_list.key_tester_helper')}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 p-4 border-t border-dark-700 bg-dark-900/50 rounded-b-xl">
              <button
                onClick={closeKeyTester}
                disabled={isKeyTesterLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.close')}
              </button>
              <button
                onClick={runKeyTest}
                disabled={isKeyTesterLoading || !keyTesterValue.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white shadow-lg transition-all transform hover:scale-105 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isKeyTesterLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className="animate-spin" size={16} /> {t('common.testing')}
                  </span>
                ) : t('common.test')}
              </button>
            </div>
          </div>
        </div>
      )}

      {lineConfirm.isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-white/45 backdrop-blur">
          <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-dark-700">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Link size={18} className="text-emerald-400" />
                {t('webhook_list.line_confirm_title')}
              </h3>
              <button onClick={closeLineConfirm} className="text-slate-500 hover:text-slate-900 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="text-sm text-slate-600 flex flex-col gap-1">
                <div>
                  <span className="text-slate-500">{t('webhook_list.line_name_label')}</span>{' '}
                  <span className="text-slate-900 font-semibold">{lineConfirm.hook?.line_oa_name || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500">{t('webhook_list.company_label')}</span>{' '}
                  <span className="text-slate-900 font-semibold">{lineConfirm.hook?.company_name || '-'}</span>
                </div>
                {lineConfirm.hook?.line_url && (
                  <div className="pt-2 border-t border-dark-700/50">
                    <div className="text-slate-500 mb-1">{t('webhook_list.line_url_label') || 'LINE Official URL'}:</div>
                    <div className="flex items-center gap-2 bg-dark-900/50 p-2 rounded-lg border border-dark-700">
                      <span className="text-xs font-mono text-primary-400 truncate flex-1">{lineConfirm.hook.line_url}</span>
                      <button 
                        onClick={() => {
                          // [FIX-20260830-COPYHTTP2] see utils/copyText — the raw API
                          // is undefined on http and this button did nothing at all
                          void copyText(lineConfirm.hook?.line_url || '');
                        }}
                        className="p-1.5 rounded-md hover:bg-dark-700 text-slate-400 hover:text-primary-400 transition-colors"
                        title={t('common.copy')}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center">
                {lineConfirm.hook?.line_url ? (
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(lineConfirm.hook.line_url)}`}
                    alt={t('webhook_list.line_qr_alt')}
                    className="w-44 h-44 rounded-xl border border-dark-700 bg-white p-2"
                  />
                ) : (
                  <div className="text-sm text-slate-500">{t('webhook_list.line_no_url')}</div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-dark-700 bg-dark-900/50 rounded-b-2xl">
              <button
                onClick={closeLineConfirm}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmOpenLine}
                disabled={!lineConfirm.hook?.line_url}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white shadow-lg transition-all bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('webhook_list.line_confirm_open')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
