/* [FEAT-20260825-BCASTDATEFILTER] ใช้ตัวกรองวันที่ **ตัวเดียวกับหน้าอื่น** ไม่ทำใหม่
   เจ้าของสั่ง 25/08: *"filter คลุมทั้งสองตารางด้วย date picker 3 วัน
   (ใช้เหมือนหน้าอื่นอย่าทำใหม่)"*
   ตัวนี้ถูกใช้อยู่แล้วที่ WebhookLogs · AuditLogs · AssignHistory · HandoffHistory
   · RegisterDataCard และมี `MAX_RANGE_DAYS = 3` อยู่ในตัวพอดีตามที่สั่ง */
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { LogDateRangeFilter, defaultLogRange, type LogDateRange } from '../../components/common/LogDateRangeFilter';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// [PERF-20260825-POLLPOLICY] refresh policy + the measurements behind it
import { AUTO_FETCH_MS, sourceForTick, shouldLoadLogs } from './broadcastPolling';
import { formatCampaignTime } from '../../components/campaign/campaignTime';
import { Plus, RefreshCw, Search, Trash2, Edit2, Filter, Copy, Info, Eye, X } from 'lucide-react';
import { broadcastService } from '../../services/messaging';
import { BroadcastEntry, BroadcastFormData, WebhookLogEntry } from '../../types';
import { BroadcastFormModal } from '../../components/campaign';
/* [FEAT-20260824-RUNDETAIL] rounds + per-round modal, shown on the ประวัติ tab.
   The log table below it lists webhook_logs, which carry no run_id — so there was
   nothing on this tab a per-round modal could be hung off until now. */
import { BroadcastRunHistoryPanel } from '../../components/campaign/history';
// [FEAT-20260824-TABLEPAGER] shared pager — both tables on this page use the same one.
import { TablePager } from '../../components/common';
// [FEAT-20260824-BCASTTABS]/[FEAT-20260824-BCASTENABLED] this page's own pieces.
import { BroadcastPageTabs, BroadcastEnabledToggle, JobIdCell, BroadcastNameCell, type BroadcastTabKey } from '../../components/messaging';
import { RepeatStatusCell, RepeatDetailModal, isRepeatOn, type RepeatRuleLike } from '../../components/campaign/schedule';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';
import { webhookService } from '../../services/hook';
import { webhookLogService } from '../../services/hook';
import { WebhookLogDetailModal } from '../../components/modals';

type StatusFilter = 'all' | 'scheduled' | 'sent' | 'draft';

export const Broadcasts: React.FC = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BroadcastEntry[]>([]);
  const [hooks, setHooks] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  /* [FEAT-20260824-TABLEPAGER] Was `const itemsPerPage = 10`. It is state now so the
     per-page selector can move it; it already flows into the request as `limit`. */
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [logLoading, setLogLoading] = useState(true);
  const [logs, setLogs] = useState<WebhookLogEntry[]>([]);
  const [logPage, setLogPage] = useState(1);
  /* [FEAT-20260828-LOGSEARCH] คำที่พิมพ์อยู่ กับคำที่ยิงจริง แยกกันคนละตัว
     ⚠️ ถ้าใช้ตัวเดียว ทุกตัวอักษรที่พิมพ์จะกลายเป็นคำขอหนึ่งใบ · แยกไว้แล้วหน่วง
        ทำให้ช่องพิมพ์ยังลื่น แต่ยิงจริงเมื่อหยุดพิมพ์ */
  /* [FEAT-20260828-JOBSEARCH] คำค้นที่ **ยิงไปเซิร์ฟเวอร์แล้ว** (หน่วงจาก `search`)
     ⚠️ ใช้ช่องเดิมของหน้านี้ ไม่เพิ่มช่องใหม่ — ผู้ใช้เห็นช่องเดียวเหมือนเดิม
        เปลี่ยนแค่ว่ามันค้นได้ทั้งฐาน ไม่ใช่แค่หน้าที่เปิดอยู่ */
  const [jobSearch, setJobSearch] = useState('');
  const [logSearchInput, setLogSearchInput] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [logTotalItems, setLogTotalItems] = useState(0);
  /* [FEAT-20260824-TABLEPAGER] Same as above, for the log table's own pager. */
  const [logItemsPerPage, setLogItemsPerPage] = useState(10);
  /* [FIX-20260825-LOGDEFAULTALL] 🔴 เดิม default เป็น `'success'`
     ⇒ เปิดหน้ามาเห็นเฉพาะที่ส่งสำเร็จ **แถวที่ล้มเหลวถูกกรองทิ้งตั้งแต่แรก**
     เจ้าของแจ้ง "ไม่มีประวัติ" ส่วนหนึ่งมาจากตรงนี้ (จับได้จาก log จริงตอนทดสอบ:
     FE ยิง `?status=success` ตายตัว) · ของที่ต้องเห็นก่อนคือ "ล้มเหลว" ไม่ใช่ซ่อนมัน */
  /* [FIX-20260828-SKIPSTATUS] `skipped` เป็นค่าที่ BE เขียนได้จริงแล้ว
     ⚠️ ไม่ขยาย type ที่นี่ = ตัวเลือกในเมนูถูก cast ทิ้งและตัวกรองจะไม่ทำงาน */
  const [logStatus, setLogStatus] = useState<
    'all' | 'success' | 'error' | 'skipped'
  >('all');
  /* ช่วงวันที่อันเดียว คุมทั้งตารางประวัติรายรอบและตาราง LINE API */
  const [dateRange, setDateRange] = useState<LogDateRange>(defaultLogRange);
  /* [FEAT-20260824-BCASTTABS] Which of the two tables is on screen. The list is
     the landing tab — it is what an admin opens this page to do. */
  const [activeTab, setActiveTab] = useState<BroadcastTabKey>('broadcasts');

  /* [FEAT-20260826-REPEATCELL] ช่องสถานะกดทำงานได้
     ⚠️ สวิตช์จริงคือ `schedule.enabled` (ยืนยันจาก BE `schedule-shape.ts:250`)
        ไม่แตะ `next_run_at` ซึ่งเป็นเคอร์เซอร์ของตัวจัดตาราง ไม่ใช่ของหน้าจอ
     ⚠️ ส่ง `schedule` ทั้งก้อนกลับไป ไม่ส่งเฉพาะ `enabled` — ฝั่ง BE เก็บเป็น
        Mixed ทั้งอ็อบเจกต์ ส่งไปแค่คีย์เดียวจะทับกฎที่เหลือหายทั้งหมด
     ⚠️ อัปเดตในหน้าจอทันที (optimistic) แล้วถ้าพลาดค่อยคืนค่า — ไม่งั้นผู้ใช้กด
        แล้วเงียบไปหนึ่งวินาที นึกว่าไม่ติด แล้วกดซ้ำ */
  const [repeatModal, setRepeatModal] = useState<null | { id: string; name: string }>(null);
  const [repeatBusy, setRepeatBusy] = useState<string | null>(null);
  /* [FEAT-20260826-JOBIDCELL] toast บอกผลคัดลอก — บอก **ผลจริง** จาก `copyText`
     ไม่ใช่เด้งว่าสำเร็จทุกครั้ง · บน http คลิปบอร์ดอาจล้มเหลวจริง ๆ */
  const [copyToast, setCopyToast] = useState<null | { ok: boolean }>(null);
  const showCopyToast = (ok: boolean): void => {
    setCopyToast({ ok });
    window.setTimeout(() => setCopyToast(null), 2000);
  };

  /* [FEAT-20260826-REPEATEDIT] แก้เวลาที่ยิงจาก modal
     ⚠️ แก้เฉพาะ `at_time_min` · ส่ง `schedule` ทั้งก้อนกลับเหมือน toggle
        (BE เก็บเป็น Mixed — ส่งคีย์เดียวจะทับกฎที่เหลือหาย) */
  const saveRepeatTime = async (id: string, atTimeMin: number): Promise<void> => {
    const item = items.find(b => String(b.id ?? (b as any)._id) === id);
    const current = ((item as any)?.schedule ?? null) as RepeatRuleLike | null;
    if (!current) return;
    setRepeatBusy(id);
    const patched = { ...current, at_time_min: atTimeMin };
    setItems(prev => prev.map(b =>
      String(b.id ?? (b as any)._id) === id ? ({ ...b, schedule: patched } as any) : b));
    try {
      await broadcastService.updateBroadcast(id, { schedule: patched } as any);
      /* [FIX-2708-REPEATSAVEFB] Reported from the stg screen on 27/08:
         pressing save changed nothing on screen. The save DID work — it was
         just silent: the modal stayed open, the row kept showing the old
         next_run_at (only `schedule` was patched in memory, while the next
         run is computed server-side), and failure looked exactly like
         success.
         => after a successful PUT: re-fetch -> close the modal -> say so.
         WHY the close sits AFTER the await: closing first would announce a
         save that has not happened yet.
         revert: drop these three lines + the showAlert in the catch block. */
      await fetchItems();
      setRepeatModal(null);
      showAlert(t('common.save_success'), t('broadcast.repeat_at_time_hint'), 'success');
    } catch (e) {
      setItems(prev => prev.map(b =>
        String(b.id ?? (b as any)._id) === id ? ({ ...b, schedule: current } as any) : b));
      /* On failure keep the modal OPEN so the edit is not lost, and say
         plainly that it failed. */
      showAlert(
        t('broadcast.alert_save_failed_title'),
        (e as Error)?.message || t('broadcast.alert_save_failed_message'),
        'error',
      );
    } finally {
      setRepeatBusy(null);
    }
  };

  const toggleRepeat = async (id: string, next: boolean): Promise<void> => {
    const item = items.find(b => String(b.id ?? (b as any)._id) === id);
    const current = ((item as any)?.schedule ?? null) as RepeatRuleLike | null;
    if (!current) return;
    setRepeatBusy(id);
    const patched = { ...current, enabled: next };
    setItems(prev => prev.map(b =>
      String(b.id ?? (b as any)._id) === id ? ({ ...b, schedule: patched } as any) : b));
    try {
      await broadcastService.updateBroadcast(id, { schedule: patched } as any);
    } catch {
      setItems(prev => prev.map(b =>
        String(b.id ?? (b as any)._id) === id ? ({ ...b, schedule: current } as any) : b));
    } finally {
      setRepeatBusy(null);
    }
  };
  const [isLogDetailOpen, setIsLogDetailOpen] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const logRefreshTimerRef = useRef<number | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<BroadcastEntry | undefined>(undefined);
  const [prefill, setPrefill] = useState<BroadcastEntry | undefined>(undefined);
  const [isView, setIsView] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  /* [FEAT-20260907-BCASTNAMECELL] `'info'` joined the union so the name dialog
     can borrow this one modal instead of adding a second. `AlertModal` has
     always supported the value (`components/modals/AlertModal.tsx:10`); only
     this page's narrower type was keeping it out. Purely additive — no existing
     caller passes it. */
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success'
  });
  const [oaInfo, setOaInfo] = useState<{ isOpen: boolean; title: string; items: string[] }>({
    isOpen: false,
    title: '',
    items: []
  });
  const isModalOpen = isFormOpen || !!deleteId || alertState.isOpen || oaInfo.isOpen || isLogDetailOpen;

  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'info') => {
    setAlertState({ isOpen: true, title, message, type });
  };

  const closeAlert = () => setAlertState(prev => ({ ...prev, isOpen: false }));

  /* [FEAT-20260828-JOBSEARCH] หน่วงแล้วค่อยยิง · กลับหน้า 1 ทุกครั้งที่คำค้นเปลี่ยน
     🔴 ไม่กลับหน้า 1 = ค้นตอนอยู่หน้า 5 แล้วเจอหน้าว่างทั้งที่ผลอยู่หน้า 1 */
  useEffect(() => {
    const id = window.setTimeout(() => {
      const needle = search.trim();
      setJobSearch(needle.length >= 4 ? needle : '');
      setCurrentPage(1);
    }, 400);
    return () => window.clearTimeout(id);
  }, [search]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await broadcastService.listBroadcasts({
        page: currentPage,
        limit: itemsPerPage,
        status: statusFilter === 'all' ? undefined : statusFilter,
        /* [UI-20260825-BCASTNEWEST] ใหม่สุดขึ้นบน
           เดิม `scheduled_at:asc` ⇒ เก่าสุดอยู่บน และไม่มีคอมเมนต์อธิบายว่าทำไม
           ⚠️ `scheduled_at` เป็น null สำหรับงานที่ไม่ได้ตั้งเวลา (แถวที่โชว์ "-")
              ⇒ เรียงด้วยมันทำให้งานกลุ่มนั้นกองรวมกันโดยไม่มีลำดับที่คนอ่านเดาได้
           ⇒ ใช้ `updated_at:desc` ซึ่งเป็นคอลัมน์ "อัปเดตล่าสุด" ที่ตารางโชว์อยู่แล้ว
              ⇒ สิ่งที่ตาเห็นกับสิ่งที่ใช้เรียง เป็นตัวเดียวกัน
           ⚠️ BE ไม่มี whitelist ของ sort field (`broadcasts-read.service.ts`
              `parseSort` ส่งผ่านตรง ๆ) ⇒ พิมพ์ชื่อ field ผิดจะไม่ error แต่ได้
              ลำดับมั่ว ๆ เงียบ ๆ · ชื่อต้องตรงกับคอลัมน์จริงใน `broadcasts`
           revert: กลับเป็น `sort: 'scheduled_at:asc'` */
        sort: 'updated_at:desc',
        search: jobSearch || undefined
      });
      setItems(res.data || []);
      setTotalItems(res.pagination?.total || 0);
      setTotalPages(res.pagination?.total_pages || 1);
    } catch (e: any) {
      console.error(e);
      setItems([]);
      setTotalItems(0);
      setTotalPages(1);
      showAlert(t('broadcast.alert_load_failed_title'), e.message || t('broadcast.alert_load_failed_message'), 'error');
    } finally {
      setLoading(false);
    }
    // itemsPerPage is a dependency now that it is state — without it the request keeps
    // sending the OLD limit and the selector looks broken. ลืมใส่ = เลือกแล้วไม่เปลี่ยน.
  }, [currentPage, itemsPerPage, statusFilter, jobSearch, t]);

  /* [FEAT-20260828-LOGSEARCH] หน่วง 400ms แล้วค่อยยิง · กลับหน้า 1 ทุกครั้งที่คำค้นเปลี่ยน
     🔴 ไม่กลับหน้า 1 = ผู้ใช้ค้นตอนอยู่หน้า 5 แล้วเจอหน้าว่าง ทั้งที่ผลมีอยู่หน้า 1
     ⚠️ คำที่สั้นกว่า 4 ตัวถูกส่งเป็นค่าว่าง = "ไม่ค้น" ⇒ ลบคำค้นทิ้งแล้วรายการกลับมาเต็ม
        ทันที ไม่ต้องกดอะไรเพิ่ม */
  useEffect(() => {
    const id = window.setTimeout(() => {
      const needle = logSearchInput.trim();
      setLogSearch(needle.length >= 4 ? needle : '');
      setLogPage(1);
    }, 400);
    return () => window.clearTimeout(id);
  }, [logSearchInput]);

  const fetchLogs = useCallback(async () => {
    setLogLoading(true);
    try {
      const res = await webhookLogService.getLogsWithFilters({
        page: logPage,
        limit: logItemsPerPage,
        status: logStatus === 'all' ? undefined : logStatus,
        channel: 'line_api',
        action_type: 'send_broadcast',
        /* [FEAT-20260825-BCASTDATEFILTER] ส่งเป็น YYYY-MM-DD ดิบ — BE อ่านเป็นวันแบบ
           กรุงเทพและคุมช่วงเอง · ห้ามแปลงเป็น ISO ที่นี่ (กติกาเดียวกับ WebhookLogs) */
        from: dateRange.from,
        to: dateRange.to,
        search: logSearch || undefined
      });
      setLogs(res.data || []);
      setLogTotalItems(res.pagination?.total || 0);
      setLogTotalPages(res.pagination?.total_pages || 1);
    } catch (e: any) {
      console.error(e);
      setLogs([]);
      setLogTotalItems(0);
      setLogTotalPages(1);
      showAlert(t('broadcast.alert_load_failed_title'), e.message || t('broadcast.alert_load_failed_message'), 'error');
    } finally {
      setLogLoading(false);
    }
    // Same reason as fetchItems: logItemsPerPage is state, so it must be a dependency.
  }, [logPage, logItemsPerPage, logStatus, dateRange, logSearch, t]);

  const scheduleLogRefresh = useCallback(() => {
    if (logRefreshTimerRef.current) {
      window.clearTimeout(logRefreshTimerRef.current);
    }
    logRefreshTimerRef.current = window.setTimeout(() => {
      fetchLogs();
    }, 10000);
  }, [fetchLogs]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  /* [PERF-20260825-LAZYLOG] ⏳ lazy — ไม่แตะ log จนกว่าแท็บ "ประวัติ" จะอยู่บนจอ
     เดิมยิงตั้งแต่ mount ⇒ ทุกคนที่เปิดหน้านี้เพื่อดูรายการบรอดแคสต์เฉย ๆ
     ก็จ่ายค่าคิวรี่ log ไปฟรี ๆ ทั้งที่ไม่เคยเปิดดู
     ⚠️ แก้ 25/08 — เดิมใช้ latch `hasOpenedLogs` (ติดแล้วไม่ปลด) แต่ `activeTab`
        ต้องอยู่ใน deps ไม่งั้นเปิดแท็บครั้งแรกจะไม่ยิง ⇒ พอ latch ติดค้าง
        การสลับ**กลับ**มาแท็บรายการก็ยิง log ซ้ำ ทั้งที่ตารางนั้นไม่ได้ mount
        คือค่าที่ตั้งใจจะประหยัดพอดี · ตอนนี้ตัดสินจากแท็บที่เห็นอยู่จริง
     revert: `shouldLoadLogs` → `() => true` (ที่ broadcastPolling.ts) */
  useEffect(() => {
    if (!shouldLoadLogs(activeTab)) return;
    fetchLogs();
  }, [fetchLogs, activeTab]);

  useEffect(() => {
    return () => {
      if (logRefreshTimerRef.current) {
        window.clearTimeout(logRefreshTimerRef.current);
      }
    };
  }, []);

  /**
   * ==== [FIX-20260809-POLLVIS] หยุด poll ตอนแท็บถูกซ่อน ====
   *
   * Two fetches per tick here, so the guard is an early `return` rather than a
   * per-call check — both must skip together, or a hidden tab would still hit
   * the DB for half the work.
   *
   * WHY: without the gate this fires every 20s forever in a background tab.
   * ⚠️ NO BEHAVIOUR CHANGE WHILE FOCUSED. The `visibilitychange` refetch is the
   * load-bearing half — without it the user returns to STALE rows.
   * Mirrors pages/chat/TicketSupport.tsx:663-676.
   * revert: drop the visibility check and the listener.
   */
  /* [PERF-20260825-AUTOFETCH] Cadence and what a tick refreshes both live in
     `broadcastPolling.ts` — that file carries the measurements behind the
     policy and the list of knobs. Nothing is decided here on purpose: a policy
     spread across a page is one nobody can find when they want to change it. */
  useEffect(() => {
    const tick = () => {
      const source = sourceForTick({
        tab: activeTab,
        hidden: document.visibilityState !== 'visible',
        modalOpen: isModalOpen,
      });
      if (source === 'logs') fetchLogs();
      else if (source === 'broadcasts') fetchItems();
    };
    const timer = window.setInterval(tick, AUTO_FETCH_MS);
    /* Coming back to the tab must show fresh rows immediately, not after
       another full cycle — this half is what makes the long cadence usable. */
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [fetchItems, fetchLogs, isModalOpen, activeTab]);

  useEffect(() => {
    let isActive = true;
    webhookService
      .getAllHooks()
      .then(res => {
        if (!isActive) return;
        const map: Record<string, string> = {};
        res.forEach(hook => {
          if (hook?._id) {
            map[hook._id] = hook.line_oa_name || hook.alias || hook.company_name || hook._id;
          }
        });
        setHooks(map);
      })
      .catch(error => {
        console.error('Failed to load hooks for broadcast table', error);
        if (!isActive) return;
        setHooks({});
      });
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter]);

  /* [FEAT-20260824-TABLEPAGER] Changing the page size MUST reset to page 1.
     ⚠️ Otherwise: you are on page 9 of 10-per-page, you pick 100 — page 9 of a
     100-per-page list is past the end, so the server answers with an empty page
     and the table looks broken/empty for no reason. เปลี่ยนจำนวนต่อหน้า ต้องกลับหน้า 1.
     Done in the handler rather than in an effect so the reset is one render with
     the size change, not a second fetch at the stale page. */
  const changeItemsPerPage = (perPage: number) => {
    setItemsPerPage(perPage);
    setCurrentPage(1);
  };

  const changeLogItemsPerPage = (perPage: number) => {
    setLogItemsPerPage(perPage);
    setLogPage(1);
  };

  /**
   * [FEAT-20260828-JOBSEARCH] คำค้นถูกส่งไปกรองที่ **เซิร์ฟเวอร์** แล้ว
   *
   * 🔴 เดิมกรอง `items` ในเครื่อง ⇒ ค้นเจอแค่แถวของหน้าที่เปิดอยู่ · พิมพ์ชื่อที่มีจริง
   *    แล้วได้ผลว่าง ทั้งที่แคมเปญนั้นอยู่หน้า 3 — ผิดแบบเงียบ ไม่มีอะไรบอก
   *    และค้นด้วย id ไม่ได้เลยเพราะไม่มี id อยู่ในสิ่งที่กรอง
   *
   * ⚠️ คำที่สั้นกว่า 4 ตัวยังกรองในเครื่องเหมือนเดิม — สั้นเกินกว่าที่เซิร์ฟเวอร์จะรับ
   *    (กติกาเดียวกันทั้งสองฝั่ง) แต่การกรองสิ่งที่เห็นอยู่ยังมีประโยชน์กับผู้ใช้
   *    ⇒ ไม่ใช่ "กรองสองชั้น" แต่เป็น "ชั้นไหนทำงานขึ้นกับความยาวของคำ"
   */
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || q.length >= 4) return items;
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, search]);

  const openCreate = () => {
    setEditing(undefined);
    setPrefill(undefined);
    setIsView(false);
    setIsFormOpen(true);
  };

  const openEdit = (entry: BroadcastEntry) => {
    setEditing(entry);
    setPrefill(undefined);
    setIsView(false);
    setIsFormOpen(true);
  };

  const openView = (entry: BroadcastEntry) => {
    setEditing(entry);
    setPrefill(undefined);
    setIsView(true);
    setIsFormOpen(true);
  };

  const openCopy = (entry: BroadcastEntry) => {
    setEditing(undefined);
    setPrefill({
      ...entry,
      status: 'draft',
      scheduled_at: null
    });
    setIsView(false);
    setIsFormOpen(true);
  };

  const openOaInfo = (entry: BroadcastEntry) => {
    const items = (entry.hook_ids || []).map(id => hooks[id] || id);
    setOaInfo({
      isOpen: true,
      title: t('broadcast.oa_info_title', { name: entry.name }),
      items
    });
  };

  const closeOaInfo = () => setOaInfo({ isOpen: false, title: '', items: [] });

  const getHookSummary = (entry: BroadcastEntry) => {
    const names = (entry.hook_ids || []).map(id => hooks[id] || id);
    if (names.length === 0) return '-';
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(undefined);
    setPrefill(undefined);
    setIsView(false);
  };

  const submitForm = async (data: BroadcastFormData) => {
    try {
      /* [FIX-20260825-SENDNOW] 🔴 เก็บ id ของแถวที่เพิ่งบันทึกไว้ยิงต่อ
         เจ้าของแจ้ง 25/08: *"กดส่งทันทีไม่เห็นส่งเลย ไม่ได้ผล ไม่มีประวัติด้วย"*
         การบันทึกด้วย `status: 'sent'` **ไม่ได้ยิงอะไรเลย** — ฝั่ง BE การยิงจริง
         อยู่คนละ endpoint (`POST /api/broadcasts/:id/send`) ซึ่งวิ่งผ่าน
         `inline.sink` → `LinePushDispatcher` (core push) ตามปกติของระบบ
         ⇒ ที่นี่คือจุดเดียวที่ถือทั้ง "ผลบันทึก" และ "id" จึงเป็นที่ที่ถูกต้อง
            ในการต่อ ไม่ใช่ในฟอร์มซึ่งไม่รู้ id ของแถวใหม่
         ⚠️ ยิง **หลังบันทึกสำเร็จเท่านั้น** — บันทึกไม่ผ่านต้องไม่มีข้อความออก */
      /* [FIX-20260825-SENDNOWCLAIMABLE] 🔴 "ส่งทันที" ต้องบันทึกเป็น `scheduled`
         `broadcast-send/claim.ts:29` ⇒ `CLAIMABLE_FROM = ['scheduled']` — claim ได้
         เฉพาะสถานะนั้น · ถ้าบันทึกเป็น `sent` เลย ตัว claim จะปฏิเสธแล้วคืน
         `not-claimed` ซึ่งถูกแปลเป็น "another process is already running this job"
         (ไม่มีใครแย่งจริง — แค่สถานะ claim ไม่ได้) วัดจาก log จริง 25/08
         ⚠️ `sent` เป็นสถานะที่ **ตัวส่งเขียนเมื่อส่งจบ** ไม่ใช่คำประกาศล่วงหน้าของฟอร์ม
         ⚠️ BE บังคับว่า `scheduled` ต้องมี `scheduled_at` ⇒ ใส่เวลา ณ ตอนกด
            ซึ่งตรงกับความหมาย "ส่งทันที" อยู่แล้ว
         ที่นี่คือจุดเดียวที่รู้ทั้งเจตนาและเป็นคนยิง /send ต่อ จึงแปลงที่นี่
         revert: ส่ง data ตรง ๆ โดยไม่แปลง แล้วอาการ not-claimed จะกลับมา */
      const wantsSendNow = data.status === 'sent';
      const body = wantsSendNow
        ? { ...data, status: 'scheduled' as const, scheduled_at: new Date().toISOString() }
        : data;

      let savedId: string | null = null;
      if (editing) {
        await broadcastService.updateBroadcast(editing.id, body);
        savedId = editing.id;
        showAlert(t('broadcast.alert_updated_title'), t('broadcast.alert_updated_message'), 'success');
      } else {
        const created = await broadcastService.createBroadcast(body);
        savedId = created?.id ?? null;
        showAlert(t('broadcast.alert_created_title'), t('broadcast.alert_created_message'), 'success');
      }

      if (wantsSendNow && savedId) {
        /* ⚠️ ยิงล้มเหลวต้องไม่ทำให้ "บันทึกสำเร็จ" กลายเป็นล้มเหลว — แถวถูกเขียนไปแล้วจริง
           แต่ต้องบอกให้เห็น ไม่ใช่เงียบ ซึ่งคืออาการที่เจ้าของเจอมาตลอด */
        try {
          await broadcastService.sendBroadcastNow(savedId);
        } catch (sendErr: any) {
          console.error('send failed', sendErr);
          showAlert(
            t('broadcast.alert_send_failed_title'),
            sendErr?.message || t('broadcast.alert_send_failed_message'),
            'error',
          );
        }
      }
      /* [FIX-20260903-CLOSEONSENT] 🔴 close the form the moment save+send wins
         ROOT CAUSE, measured from the real log rather than guessed:
         `POST /:id/send` answered 201 in `responseTime: 3115` ms
         (22:45:05 → 22:45:08) because this path now refetches site rules before
         sending (`[BCASTSRFRESH]`). The form's `confirmSubmit` called
         `onClose()` only AFTER `await onSubmit(...)`, which covers both `/send`
         and `fetchItems()` ⇒ the confirm dialog sat on screen for 3+ seconds
         with nothing indicating work in progress. That is the "stuck" report —
         not actually frozen, just slow and silent, which from the outside is
         the same thing.

         ⚠️ Closed HERE, not in the form: this is the only place that knows the
            save truly succeeded (the row exists) and it owns `isFormOpen`.
         ⚠️ Deliberately BEFORE `fetchItems()` — refreshing the list is
            background work for the page behind, not a precondition for closing.
            If the refresh is slow or fails, the form must still close, because
            the campaign was already written.
         ⚠️ Placed AFTER the `wantsSendNow` block, so a failed `/send` has
            already raised its error alert and the form still closes — the row
            did save. That block's rules are unchanged.
         ⚠️ A failed SAVE goes to the `catch` below, which rethrows ⇒ the form
            stays open with the confirm dialog available to correct. Unchanged.
         revert: remove this `closeForm()` and the 3-second hang returns */
      closeForm();
      await fetchItems();
      scheduleLogRefresh();
    } catch (e: any) {
      console.error(e);
      showAlert(t('broadcast.alert_save_failed_title'), e.message || t('broadcast.alert_save_failed_message'), 'error');
      throw e;
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setLoading(true);
    try {
      await broadcastService.deleteBroadcast(deleteId);
      showAlert(t('broadcast.alert_deleted_title'), t('broadcast.alert_deleted_message'), 'success');
      await fetchItems();
    } catch (e: any) {
      console.error(e);
      showAlert(t('broadcast.alert_delete_failed_title'), e.message || t('broadcast.alert_delete_failed_message'), 'error');
    } finally {
      setLoading(false);
      setDeleteId(null);
    }
  };

  /* [FEAT-20260825-SENDINGBADGE] สถานะ "กำลังส่ง"
     ═══════════════════════════════════════════════════════════════════════
     ⭐ ฝั่ง BE มีสถานะนี้อยู่แล้ว ไม่ได้เพิ่มใหม่ — `broadcast.schema.ts` enum
        มี `'sending'` และ `broadcast-send/claim.ts` ตั้งเป็น `CLAIMED_STATE`
        ตอน claim งาน · **ฝั่ง FE ต่างหากที่ไม่เคยรู้จักมันเลย** ⇒ งานที่กำลังส่ง
        อยู่จะโชว์ชื่อสถานะดิบ ๆ ว่า "sending" โดยไม่มีสีและไม่มีคำแปล
     ⚠️ เป็นสถานะที่ **เครื่องเป็นเจ้าของ** — schema จงใจไม่ให้ตั้งจากภายนอก
        (`PUT { status: 'sending' }` ถูกกันไว้) ⇒ ที่นี่มีหน้าที่ "แสดง" อย่างเดียว
     ⚠️ ไม่ realtime ตามที่สั่ง — อาศัย auto-fetch ทุก 45 วิ (ดู [AUTOFETCH]) */
  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, string> = {
      scheduled: t('broadcast.status_scheduled'),
      sending: t('broadcast.status_sending'),
      sent: t('broadcast.status_sent'),
      draft: t('broadcast.status_draft'),
      failed: t('broadcast.status_failed'),
      cancelled: t('broadcast.status_cancelled'),
    };
    const color =
      status === 'sending'
        ? 'bg-sky-500/10 text-sky-800 border-sky-500/30'
        : status === 'sent'
          /* [UI-20260826-SENTBLUE] เจ้าของ 26/08: *"badge ส่งแล้ว ใช้สีฟ้า จะได้ไม่งง
             font สีเข้มด้วย ไม่งั้น light theme อ่านยาก"*
             เดิมเป็นเขียวอ่อน ซึ่งชนกับสีเขียวของ "เปิดใช้งาน" ในช่องสถานะ ⇒ อ่านสับสน
             ⚠️ ใช้ `text-blue-700` ไม่ใช่ `-500` — บนพื้นอ่อน 500 คอนทราสต์ต่ำเกิน */
          ? 'bg-blue-500/10 text-blue-700 border-blue-500/30'
          : status === 'failed'
            ? 'bg-red-500/10 text-red-700 border-red-500/25'
            : status === 'scheduled'
              ? 'bg-yellow-500/10 text-yellow-800 border-yellow-500/30'
              : 'bg-slate-500/10 text-slate-800 border-slate-500/25';
    return (
      <span
        data-testid={status === 'sending' ? 'status-sending' : undefined}
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${color} ${
          status === 'sending' ? 'bcast-sending-glow' : ''
        }`}
      >
        {/* จุดวิ่ง — บอกว่ากำลังทำงานอยู่จริง ไม่ใช่ค้าง
            ⚠️ สีฟ้าอ่อน ไม่ใช้สีจัด เพราะต้องอ่านได้ทั้ง light และ dark */}
        {status === 'sending' && (
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-sky-500 opacity-70 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
          </span>
        )}
        {map[status] || status}
      </span>
    );
  };

  const statusBadge = (status?: string) => {
    const normalized = (status || '').toLowerCase();
    const base = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold border';
    if (normalized === 'success') return <span className={`${base} bg-emerald-500/10 text-emerald-400 border-emerald-500/20`}>{t('status.success')}</span>;
    if (normalized === 'failed') return <span className={`${base} bg-red-500/10 text-red-400 border-red-500/20`}>{t('status.failed')}</span>;
    if (normalized === 'pending') return <span className={`${base} bg-yellow-500/10 text-yellow-700 border-yellow-500/20`}>{t('status.pending')}</span>;
    /* [FIX-20260828-SKIPSTATUS] "ถูกข้าม" ต้องอ่านออกทันทีว่าไม่ใช่ความล้มเหลว
       🔴 OA ที่ไม่มีผู้รับสักคนเคยถูกบันทึกเป็น `error` พร้อมข้อความ
          `this OA was skipped: empty` ⇒ คนดูตารางเห็นแดงแล้วคิดว่าระบบพัง
          ต้องเปิดอ่านข้อความถึงจะรู้ว่าไม่มีอะไรเสีย
       ⇒ ส้ม: ไม่ใช่เขียว (ไม่ได้ส่งถึงใคร) และไม่ใช่แดง (ไม่มีอะไรพัง) */
    if (normalized === 'skipped') return <span className={`${base} bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300`} data-testid="log-status-skipped">{t('status.skipped')}</span>;
    /* [FIX-20260828-SKIPSTATUS] `error` เคยตกลง fallback สีเทา — สีเดียวกับค่าที่
       ไม่รู้จัก ⇒ ความล้มเหลวจริงอ่านไม่ออกว่าเป็นความล้มเหลว */
    if (normalized === 'error') return <span className={`${base} bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300`}>{t('status.error')}</span>;
    if (normalized === 'suppressed') return <span className={`${base} bg-slate-500/10 text-slate-700 border-slate-500/30`}>{t('status.suppressed')}</span>;
    return <span className={`${base} bg-slate-500/10 text-slate-700 border-slate-500/20`}>{status || '-'}</span>;
  };

  const openLogDetail = (id: string) => {
    setSelectedLogId(id);
    setIsLogDetailOpen(true);
  };

  const closeLogDetail = () => {
    setSelectedLogId(null);
    setIsLogDetailOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('broadcast.title')}</h2>
          <p className="text-sm text-slate-700">{t('broadcast.subtitle')}</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-3 w-full xl:w-auto">
          {/* [FEAT-20260824-BCASTTABS] These two filter the CAMPAIGN LIST only — the log
              table carries its own status filter. Leaving them mounted over the ประวัติ tab
              would offer controls that change nothing the user is looking at.
              The `search`/`statusFilter` STATE stays in the page, so switching back restores
              what was typed — only the markup goes. สลับแท็บแล้วคำค้นไม่หาย. */}
          {activeTab === 'broadcasts' && (
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto" data-testid="broadcast-list-filters">
            <div className="relative w-full sm:w-40">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Filter className="text-slate-700" size={16} />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="pl-9 pr-4 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none cursor-pointer"
              >
                <option value="all">{t('status.all_status')}</option>
                <option value="scheduled">{t('broadcast.status_scheduled')}</option>
                <option value="sent">{t('broadcast.status_sent')}</option>
                <option value="draft">{t('broadcast.status_draft')}</option>
              </select>
            </div>

            <div className="relative group w-full sm:w-72">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="text-slate-700 group-focus-within:text-primary-500 transition-colors" size={18} />
              </div>
              <input
                type="text"
                placeholder={t('broadcast.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>
          )}

          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto lg:ml-0">
            <button
              onClick={() => {
                fetchItems();
                fetchLogs();
              }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw size={18} />
              {t('common.refresh')}
            </button>
            <button
              onClick={openCreate}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-primary-500/20 transition-all hover:scale-105 whitespace-nowrap"
            >
              <Plus size={18} />
              {t('common.add_new')}
            </button>
          </div>
        </div>
      </div>

      {/* [FEAT-20260824-BCASTTABS] บรอดแคสต์ | ประวัติ — the two tables no longer stack. */}
      <BroadcastPageTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'broadcasts' && (
      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden relative" data-testid="broadcast-list-panel">
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
        )}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('broadcast.header_name')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('broadcast.header_oa')}</th>
                {/* [FEAT-20260824-BCASTENABLED] สถานะ = on/off. The job lifecycle moved to
                    its own column on the right; see the cells below. */}
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('broadcast.header_status')}</th>
                {/* [UI-20260825-HISTORYUI] คอลัมน์นี้เคยเป็นภาษาไทยฝังในโค้ด พร้อมโน้ต
                    TODO(i18n) ว่า "ไฟล์แปลติดงานอื่นอยู่" ⇒ หัวตารางนี้เป็นช่องเดียวใน
                    หน้านี้ที่ไม่เปลี่ยนตามภาษา คนที่เปิดเป็น en/it/zh จะเห็นไทยโผล่มาช่องเดียว
                    ⇒ ย้ายขึ้น i18n เป็น `broadcast.header_job_status` และใส่ครบทั้งสี่ภาษา
                    ⚠️ คีย์ถูก **เพิ่มต่อท้าย** ไฟล์แปล ไม่ได้แทรกกลางหรือสลับลำดับของเดิม
                       เพราะไฟล์แปลกำลังถูกงานอื่นแก้อยู่พร้อมกัน การแทรกกลางจะชน
                    revert: ใส่ข้อความไทยกลับลงใน <th> แล้วลบคีย์ออกจากไฟล์แปลทั้งสี่ */}
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('broadcast.header_job_status')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('broadcast.header_schedule')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('broadcast.header_created_by')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('broadcast.header_updated_at')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider text-right whitespace-nowrap">{t('broadcast.header_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && filteredItems.length === 0 ? (
                <tr>
                  {/* 8 columns since [FEAT-20260824-BCASTENABLED] added สถานะงาน — the old
                      value of 6 already under-spanned the 7 that were there. */}
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-700">
                    {t('broadcast.no_results')}
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-dark-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      {/* [FEAT-20260907-BCASTNAMECELL] the name is capped and gets
                          its own info button — one long name used to widen the
                          column for every row. The dialog is this page's EXISTING
                          AlertModal so `isModalOpen` still pauses auto-refresh. */}
                      <BroadcastNameCell
                        name={item.name}
                        onShowFull={() => showAlert(t('broadcast.header_name'), item.name, 'info')}
                      />
                      {/* [FEAT-20260826-JOBIDCELL] id + copy + info **ทุกแถวเหมือนกัน**
                          เดิมโชว์เฉพาะแถวที่ล้มเหลว ⇒ แถวอื่นคัดลอก id ไม่ได้เลย
                          ⚠️ 07/09: ปุ่ม copy/info ของ id ชุดนี้ **ไม่เกี่ยว** กับปุ่ม info
                             ของชื่อด้านบน เจ้าของย้ำแล้ว ห้ามยุบรวมกัน */}
                      <JobIdCell
                        jobId={String(item.id ?? (item as any)._id ?? '')}
                        onOpenHistory={() => setActiveTab('history')}
                        onCopied={showCopyToast}
                      />
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-700 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span>{getHookSummary(item)}</span>
                        {(item.hook_ids || []).length > 0 && (
                          <button
                            type="button"
                            onClick={() => openOaInfo(item)}
                            className="p-1 rounded-md text-slate-700 hover:text-primary-500 hover:bg-primary-500/10 transition-colors"
                            title={t('broadcast.oa_info')}
                          >
                            <Info size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                    {/* [FEAT-20260824-BCASTENABLED] สถานะ now answers "is this campaign
                        armed?", not "did it send?". Owner: "สถานะ คือเปิด ปิด ใช้งาน ไม่ใช่
                        ส่งแล้ว" — one job sends many times, so a per-job "ส่งแล้ว" is
                        meaningless; whether a RUN finished is a ประวัติ question.
                        🔴 The on/off rule lives in resolveBroadcastEnableState — `null`
                        and a missing key both mean ON. Do not falsy-check it here. */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {/* [FEAT-20260826-ENABLETOGGLE] ช่อง "สถานะ" = สิ่งที่แอดมินคุมเอง
                          ⇒ เป็นสวิตช์ (มี confirm) · งานส่งครั้งเดียวยังเป็นป้ายเดิม กดไม่ได้ */}
                      <BroadcastEnabledToggle
                        schedule={item.schedule}
                        status={item.status}
                        testId={`enabled-${item.id}`}
                        disabled={repeatBusy === String(item.id ?? (item as any)._id)}
                        onToggle={next => void toggleRepeat(String(item.id ?? (item as any)._id), next)}
                      />
                    </td>
                    {/* The lifecycle is NOT deleted, only demoted: ฉบับร่าง still tells an
                        admin the campaign was never armed, and the edit button below keys
                        off `item.status`. Removing it would take away information nobody
                        asked to lose. ย้ายที่ ไม่ใช่ลบทิ้ง. */}
                    <td className="px-6 py-4 whitespace-nowrap" data-testid={`lifecycle-${item.id}`}>
                      {(() => {
                        const jid = String(item.id ?? (item as any)._id ?? '');
                        const sch = ((item as any).schedule ?? null) as RepeatRuleLike | null;
                        return (
                          <RepeatStatusCell
                            status={item.status}
                            jobId={jid}
                            schedule={sch}
                            statusLabel={<StatusBadge status={item.status} />}
                            onOpenHistory={() => setActiveTab('history')}
                            onOpenRepeat={() => setRepeatModal({ id: jid, name: item.name || jid })}
                            onToggleRepeat={next => void toggleRepeat(jid, next)}
                            toggleBusy={repeatBusy === jid}
                          />
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-700 whitespace-nowrap">
                      {item.scheduled_at ? formatCampaignTime(item.scheduled_at) : '-'}
                    </td>
                    {/* [FEAT-20260823-BCASTACTOR] The backend resolves the id to a
                        name at read time. `null` means it HELD an id it could not
                        resolve — a removed account, or the lookup being down —
                        which is different from a campaign nobody made, so the
                        cell says "unknown" rather than going blank.
                        แปลไม่ออก ≠ ไม่มีคนสร้าง. */}
                    <td className="px-6 py-4 text-xs text-slate-700 whitespace-nowrap" data-testid={`created-by-${item.id}`}>
                      {item.created_by_name
                        ?? (item.created_by ? t('broadcast.created_by_unknown') : '-')}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-700 whitespace-nowrap">
                      {item.updated_at
                        ? formatCampaignTime(item.updated_at)
                        : '-'}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openView(item)}
                          className="p-1.5 rounded-lg hover:bg-blue-500/20 text-slate-700 hover:text-blue-500 transition-colors"
                          title={t('common.view')}
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => openCopy(item)}
                          className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-slate-700 hover:text-indigo-500 transition-colors"
                          title={t('broadcast.copy_action')}
                        >
                          <Copy size={16} />
                        </button>
                        {item.status !== 'sent' && (
                          <button
                            onClick={() => openEdit(item)}
                            className="p-1.5 rounded-lg hover:bg-primary-500/20 text-slate-700 hover:text-primary-500 transition-colors"
                            title={t('common.edit')}
                          >
                            <Edit2 size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteId(item.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-700 hover:text-red-500 transition-colors"
                          title={t('common.delete')}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* [FEAT-20260824-TABLEPAGER] The arrows-only footer became the shared pager, which
            adds the per-page selector the owner asked for on BOTH tables. The summary text
            is passed in so this page keeps its own `t()` wording. */}
        <TablePager
          testId="broadcast-pager"
          page={currentPage}
          totalPages={totalPages}
          perPage={itemsPerPage}
          loading={loading}
          onPageChange={setCurrentPage}
          onPerPageChange={changeItemsPerPage}
          className="border-t border-dark-700"
          summary={<span className="text-sm text-slate-700">{t('common.showing_total', { count: totalItems })}</span>}
        />
      </div>
      )}

      {/* [FEAT-20260824-BCASTTABS] The ประวัติ tab. This used to sit stacked under the list,
          below the fold — which is where "did it actually send?" is answered now that สถานะ
          stopped claiming it. Owner: "การดูว่าเสร็จไหม ไปดูใน history". */}
      {activeTab === 'history' && (
      /* [UI-20260825-HISTORYUI] ช่องวันที่บนแท็บนี้ถูกบีบจนอ่านค่าไม่ครบ
          ⇒ ตั้ง "ความกว้างขั้นต่ำ" ให้ช่องวันที่ของ **ทั้งสองตาราง** ที่กล่องนอกสุดนี้ที่เดียว
          ⚠️ ทำไมไม่ไปแก้ที่ตัวช่องเอง: `LogDateRangeFilter` เป็นของกลางที่อีก 5-6 หน้าใช้อยู่
             (WebhookLogs · AuditLogs · AssignHistory · HandoffHistory · RegisterDataCard)
             การตั้ง min-width ที่ตัวมันจะเปลี่ยนหน้าอื่นตามไปด้วยโดยไม่มีใครขอ · ส่วนตาราง
             บนถูกวาดโดย `BroadcastRunHistoryPanel` ซึ่งไม่มี prop ให้ส่ง class ลงไป
             ⇒ ยิงจาก ancestor คือทางเดียวที่ครอบทั้งสองตารางได้โดยไม่แตะไฟล์ที่ใช้ร่วมกัน
          ⚠️ ค่าที่ตั้งไว้ยังแคบกว่ากล่อง select `min-w-[16rem]` ที่อยู่แถวเดียวกันอยู่แล้ว
             ⇒ ไม่ได้เพิ่มความเสี่ยงล้นจอที่ยังไม่มี และแถวเป็น `flex-wrap` อยู่แล้ว
             จอแคบจึงตัดลงบรรทัดใหม่ ไม่ดันจนล้น
          ⚠️ ใส่กฎของ `datetime-local` ไว้ด้วย ทั้งที่วันนี้หน้านี้มีแต่ `type="date"`
             (ตัวกรองที่ใช้จริงคือ `LogDateRangeFilter` ⇒ `<input type="date">` — ที่เป็น
             `datetime-local` คือช่องในฟอร์มบรอดแคสต์ ไม่ใช่แท็บนี้) เผื่อวันที่ของกลาง
             เปลี่ยนชนิด ช่องจะยังกว้างพอให้เห็นทั้งวันและเวลา ไม่ต้องกลับมาไล่แก้อีกรอบ
          revert: ลบสองคลาส `[&_input[type=...]]:min-w-*` ออกจาก className บรรทัดถัดไป */
      <div
        className="flex flex-col gap-3 [&_input[type=date]]:min-w-[9.5rem] [&_input[type=datetime-local]]:min-w-[14rem]"
        data-testid="broadcast-history-panel"
      >
        {/* [UI-20260825-HISTORYUI] ตาราง "ประวัติการส่ง Broadcast LINE API" ย้ายขึ้นมาอยู่บน
            เจ้าของสั่ง 25/08 ให้สลับที่กับ "ประวัติรายรอบ" — ย้ายทั้งบล็อก ไม่ได้ก๊อปหรือ
            เขียนใหม่ ข้างในยังเป็นบรรทัดเดิมทุกบรรทัด
            revert: สลับบล็อกนี้กับ <BroadcastRunHistoryPanel/> ด้านล่างกลับที่เดิม */}
        {/* [UI-20260825-HISTORYUI] header + ตาราง + แถบแบ่งหน้า = **การ์ดใบเดียว**
            🔴 ของเดิม [FIX-20260825-LOGHEADERJOIN] แก้ด้วยการตัด `border-b-0` +
               `rounded-t-xl` ให้ header แล้วหวังให้ตารางไปชนพอดี — แต่ทั้งคู่เป็น
               "พี่น้อง" ใต้ `flex flex-col gap-3` ⇒ `gap-3` แทรกช่องว่าง 12px คั่นไว้เสมอ
               ขอบที่อุตส่าห์ตัดออกจึงไม่เคยได้ชนกันเลย นั่นคือรอยแยกที่เจ้าของเห็น
               ⇒ ปัญหาไม่ได้อยู่ที่ "ขอบ" แต่อยู่ที่ "ทั้งสองเป็นกล่องคนละใบ"
            ⇒ ใช้โครงเดียวกับ "ประวัติรายรอบ" (`BroadcastRunHistoryPanel`) คือให้
               **กล่องนอกเป็นคนถือ** ขอบ/มุม/เงา แล้วหัวกับตารางเป็นลูกในกล่องเดียวกัน
               ⇒ ไม่มี gap อะไรมาคั่นได้อีก และสองส่วนของหน้านี้กลายเป็นการ์ดพี่น้องกันจริง
            ⚠️ `overflow-hidden` คือตัวที่ทำให้มุมฉากของตารางถูกตัดตามมุมโค้งของการ์ด
               เอาออกเมื่อไหร่ มุมล่างของตารางจะแหลมโผล่ออกมานอกกรอบทันที
            ⚠️ ตารางยังเก็บพื้น `bg-dark-900` ของตัวเองไว้ (หัวตารางเป็น `bg-dark-800`)
               ⇒ หน้าตาของตารางไม่เปลี่ยน เปลี่ยนแค่ว่า "ใครเป็นคนวาดกรอบ"
            revert: คืน `border border-dark-700 rounded-t-xl border-b-0 shadow-lg` ให้ header,
                    คืน `border border-dark-700 rounded-b-xl shadow-lg` ให้กล่องตาราง,
                    คืน `bg-dark-900 border border-dark-700 rounded-xl shadow-lg` ให้ TablePager
                    แล้วลบ div ครอบใบนี้ทิ้ง */}
        <div
          className="flex flex-col overflow-hidden rounded-xl border border-dark-700 bg-dark-800 shadow-lg shadow-black/20"
          data-testid="broadcast-log-panel"
        >
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 py-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
              <div>
                <p className="text-sm text-slate-700">{t('broadcast.logs_title')}</p>
                <h3 className="text-xl font-semibold text-slate-900">{t('broadcast.logs_subtitle')}</h3>
              </div>
              {/* [FEAT-20260828-LOGSEARCH] ค้นชื่อ OA หรือ id ของงาน
                  🔴 การกรองเกิดที่ **เซิร์ฟเวอร์** ไม่ใช่ที่นี่ — รายการนี้แบ่งหน้าที่ BE
                     ถ้ากรองในเครื่องจะค้นเจอแค่แถวของหน้าที่เปิดอยู่ แล้วผู้ใช้จะเห็น
                     "ไม่พบ" ทั้งที่แถวนั้นอยู่หน้าอื่น โดยไม่มีอะไรบอก
                  ⚠️ ขั้นต่ำ 4 ตัวอักษรบังคับจริงที่ BE · ตรงนี้แค่ไม่ยิงคำที่สั้นกว่านั้น
                     และบอกผู้ใช้ว่าทำไมยังไม่มีอะไรเกิดขึ้น */}
              <div className="relative min-w-[15rem]">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                  aria-hidden
                />
                <input
                  type="text"
                  name="log_search"
                  data-testid="log-search"
                  value={logSearchInput}
                  onChange={(e) => setLogSearchInput(e.target.value)}
                  placeholder={t('broadcast.logs_search_placeholder')}
                  className="w-full rounded-lg border border-dark-600 bg-white py-1.5 pl-8 pr-7 text-sm text-slate-800"
                />
                {logSearchInput !== '' && (
                  <button
                    type="button"
                    data-testid="log-search-clear"
                    onClick={() => setLogSearchInput('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
                    aria-label={t('common.cancel')}
                  >
                    <X size={14} />
                  </button>
                )}
                {logSearchInput.trim() !== '' && logSearchInput.trim().length < 4 && (
                  <p
                    className="absolute left-0 top-full mt-1 text-[11px] text-amber-600 dark:text-amber-300"
                    data-testid="log-search-min"
                  >
                    {t('broadcast.logs_search_min')}
                  </p>
                )}
              </div>
            </div>
            {/* [FEAT-20260825-FILTERBIGGER] เจ้าของ 25/08: *"font ใหญ่ขึ้นทั้งหน้า
                  ในส่วนของ select + filter date"* — ขยายเฉพาะแถบเครื่องมือของหน้านี้
                  ⚠️ ไม่แก้ที่ SearchableSelect / LogDateRangeFilter เพราะทั้งคู่ถูกใช้
                     อีก 5-6 หน้า การขยายที่ตัวมันจะทำให้หน้าอื่นเพี้ยนตามโดยไม่มีใครขอ
                  revert: ลบ style zoom ออก */}
            <div className="flex flex-wrap items-center gap-3" style={{ zoom: 1.15 }}>
              {/* [FEAT-20260825-BCASTDATEFILTER] ตัวกรองวันที่ตัวเดียว คุมทั้ง
                  "ประวัติรายรอบ" และ "ประวัติการส่ง Broadcast LINE API"
                  ใช้คอมโพเนนต์เดียวกับ WebhookLogs/AuditLogs — จำกัดช่วง 3 วันในตัวมันเอง
                  revert: ลบบรรทัดนี้ + state dateRange + พารามิเตอร์ from/to ใน fetchLogs */}
              <LogDateRangeFilter
                value={dateRange}
                onChange={(next) => { setDateRange(next); setLogPage(1); }}
              />
              {/* [FEAT-20260825-BCASTSTATUSSEARCH] ใช้ `SearchableSelect` ตัวเดียวกับ
                  ทั้งระบบ ไม่ใช่ <select> ดิบ — เจ้าของท้วง 25/08 ว่าการเหลือ select
                  ดิบไว้คือการสร้างหนี้ (หน้าตาไม่ตรงกับที่อื่น และต้องมาไล่แก้ทีหลัง)
                  revert: กลับไปใช้ <select> เดิม */}
              <div className="min-w-[16rem]" data-testid="log-status-select">
                {/* [UI-20260826-DROPDIR] `dropUp` — แถวตัวกรองรูปเดียวกับหน้าประวัติ
                    (`zoom: 1.15` เหนือตารางยาว) กางลงแล้วทับแถวที่กำลังกรอง */}
                <SearchableSelect
                  dropUp
                  value={logStatus}
                  onChange={(v) => {
                    setLogStatus(
                      (v || 'all') as 'all' | 'success' | 'error' | 'skipped',
                    );
                    setLogPage(1);
                  }}
                  /* [FIX-20260828-SKIPSTATUS] ต้องมี `skipped` ในตัวกรองด้วย
                     ⚠️ ขาดไป = แถวที่ถูกข้ามจะหายจากทุกตัวกรองยกเว้น "ทุกสถานะ"
                        ซึ่งอ่านได้ว่า "ไม่มีแถวแบบนั้น" ทั้งที่มันมีอยู่ */
                  options={[
                    { value: 'all', label: t('status.all_statuses') },
                    { value: 'success', label: t('status.success') },
                    { value: 'error', label: t('status.error') },
                    { value: 'skipped', label: t('status.skipped') },
                  ]}
                  placeholder={t('status.all_statuses')}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto bg-dark-900 border-t border-dark-700 relative">
            {logLoading && (
              <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
            )}
            <table className="min-w-full divide-y divide-dark-700">
              <thead className="bg-dark-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-700">{t('webhook_logs.header_alias')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-700">{t('webhook_logs.header_channel')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-700">{t('webhook_logs.header_created_at')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-700">{t('webhook_logs.header_status')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-700">{t('webhook_logs.header_action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800">
                {!logLoading && logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-700">
                      {t('broadcast.logs_empty')}
                    </td>
                  </tr>
                ) : (
                  logs.map(log => (
                    <tr key={log._id} className="hover:bg-dark-900/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-slate-700">{log.hook_alias}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{log.channel}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {/* [FEAT-20260825-THAIDISPLAY] เวลาไทยเสมอ — ดู campaignTime.ts */}
                        {formatCampaignTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3">{statusBadge(log.status)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openLogDetail(log._id)}
                          className="p-2 rounded-lg bg-dark-800 border border-dark-600 text-slate-600 hover:text-slate-900 hover:border-primary-500 transition-colors"
                          title={t('webhook_logs.view_detail')}
                        >
                          <Info size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* [FEAT-20260824-TABLEPAGER] Second table, SAME pager — that is the whole point of
              putting it in components/common. Its own testId so the two never collide. */}
          <TablePager
            testId="broadcast-log-pager"
            page={logPage}
            totalPages={logTotalPages}
            perPage={logItemsPerPage}
            loading={logLoading}
            onPageChange={setLogPage}
            onPerPageChange={changeLogItemsPerPage}
            className="bg-dark-900 border-t border-dark-700"
            summary={
              <>
                <span>{t('common.showing_total', { count: logTotalItems })}</span>
                <span>{t('common.page_of', { page: logPage, total: logTotalPages })}</span>
              </>
            }
          />
        </div>

        {/* [FEAT-20260824-RUNDETAIL] Owner: "ต้องแสดงทั้ง history + webhook log จะได้ครบ
            แต่ว่าทำเป็น modal กดดู". This is the HISTORY half — one line per round, click
            to open the modal. The raw LINE log table stays exactly as it was: the two
            answer different questions and one is not a summary of the other.
            🔴 `items` is passed in, not re-fetched — the page already has it.
            [UI-20260825-HISTORYUI] เดิมข้อความตรงนี้เขียนว่า "the log table BELOW" ซึ่ง
            ตอนนี้ไม่จริงแล้ว — ตาราง LINE API ย้ายขึ้นไปอยู่ข้างบน จึงตัดคำบอกตำแหน่งทิ้ง
            แทนที่จะกลับด้านเป็น "above" เพราะเหตุผลของบล็อกนี้ไม่ได้ผูกกับลำดับบนล่างเลย */}
        {/* [FEAT-20260825-BCASTDATEFILTER] เจ้าของ 25/08: *"filter วันที่มันต้องมี
            ทั้งสองตาราง บนกับล่าง"* ⇒ ส่งช่วงวันที่ชุดเดียวกันลงมาให้ตารางนี้ด้วย
            ใช้ state ตัวเดียว ⇒ เลือกทีเดียวคุมทั้งสองตารางจริง ไม่ใช่คนละอัน
            ⚠️ `dateRange`/`setDateRange` เป็นของหน้า ไม่ใช่ของบล็อก ⇒ สลับบนล่าง
               ไม่กระทบตัวกรอง ทั้งสองตารางยังอ่านช่วงวันที่ตัวเดียวกันอยู่ */}
        <BroadcastRunHistoryPanel
          broadcasts={items}
          dateRange={dateRange}
          onDateRangeChange={(next) => { setDateRange(next); setLogPage(1); }}
        />
      </div>
      )}

      <BroadcastFormModal
        isOpen={isFormOpen}
        onClose={closeForm}
        onSubmit={submitForm}
        initialData={editing ?? prefill}
        mode={isView ? 'view' : editing ? 'update' : 'create'}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        title={t('broadcast.delete_title')}
        message={t('broadcast.delete_message')}
        onConfirm={confirmDelete}
        onClose={() => setDeleteId(null)}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />

      <AlertModal
        isOpen={alertState.isOpen}
        onClose={closeAlert}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />

      <AlertModal
        isOpen={oaInfo.isOpen}
        onClose={closeOaInfo}
        title={oaInfo.title}
        message={oaInfo.items.length ? oaInfo.items.join('\n') : t('broadcast.oa_empty')}
        type="success"
      />

      {/* [FEAT-20260826-REPEATCELL] modal รอบซ้ำ — สวิตช์ตัวเดียวกับในตาราง */}
      <RepeatDetailModal
        open={repeatModal !== null}
        name={repeatModal?.name ?? ''}
        jobId={repeatModal?.id ?? ''}
        schedule={
          repeatModal
            ? (((items.find(b => String(b.id ?? (b as any)._id) === repeatModal.id) as any)?.schedule ?? null) as RepeatRuleLike | null)
            : null
        }
        nextRunAt={
          repeatModal
            ? (((items.find(b => String(b.id ?? (b as any)._id) === repeatModal.id) as any)?.next_run_at ?? null) as string | null)
            : null
        }
        busy={repeatBusy !== null}
        onToggle={next => { if (repeatModal) void toggleRepeat(repeatModal.id, next); }}
        onSaveTime={min => { if (repeatModal) void saveRepeatTime(repeatModal.id, min); }}
        onClose={() => setRepeatModal(null)}
      />

      {/* [FEAT-20260826-JOBIDCELL] toast ผลการคัดลอก — บอกผลจริง ไม่เด้งว่าสำเร็จเสมอ */}
      {copyToast && (
        <div
          data-testid="copy-toast"
          className={`fixed bottom-6 right-6 z-[80] rounded-xl border-2 px-4 py-3 text-sm font-bold shadow-2xl ${
            copyToast.ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : 'border-red-300 bg-red-50 text-red-700'
          }`}
        >
          {copyToast.ok ? t('broadcast.copy_ok') : t('broadcast.copy_fail')}
        </div>
      )}

      <WebhookLogDetailModal
        isOpen={isLogDetailOpen}
        logId={selectedLogId || undefined}
        onClose={closeLogDetail}
      />
    </div>

  );
};
