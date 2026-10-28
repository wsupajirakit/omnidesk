import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Trash2, Edit2, Eye, Tag as TagIcon, Loader2, Copy, Check, ChevronDown, X, FileSpreadsheet, Download, CheckSquare, Square, Users } from 'lucide-react';

import { dynamicTagService } from '../../services/messaging';
import { webhookService } from '../../services/hook';
// [FEAT-20260728-TAGSCOPE] ตัวเลือกกลุ่ม/OA ต้องตามสิทธิ์ของ login เสมอ:
// perm group = fetchVisibleGroups (super→ทุกกลุ่ม, อื่น→กลุ่มตัวเอง, เรียง A-Z แล้ว)
// perm by OA = filterVisibleHooks (super→ทุก OA, มี whitelist→เฉพาะใน allowed_hooks)
import { fetchVisibleGroups, filterVisibleHooks } from '../../services/admin';
import { DynamicTagEntry, DynamicTagFormData, HookData } from '../../types';
import { DynamicTagFormModal } from '../../components/dynamic-tag';
// [FEAT-20260801-BULKTAGSCOPE] แก้ขอบเขต (กลุ่ม/OA) หลาย tag พร้อมกัน
// โครงลอกจาก components/BulkPermissionsModal.tsx — ไฟล์นั้นไม่ถูกแตะ
import { TagScopeCell } from '../../components/messaging';
import { BulkTagScopeModal, ScopeOption } from '../../components/bulk';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';
import { copyText } from '../../utils/copyText';

const SUB_TYPE_PATH_MAP: Record<string, string> = {
  'CUSTOMER_PROFILE': 'api/v1/customer',
  'INSTALLMENT_CURRENT': 'api/line/v1/installment_current.php',
  'PAYMENT_HISTORY': 'api/line/v1/payment_history.php',
  'CONTRACT_INFO': 'api/line/v1/contract.php',
  'ALL_INSTALLMENTS': 'api/line/v1/installment.php'
};

const getShortKey = (subType: string) => {
  const st = String(subType || '').trim();
  if (SUB_TYPE_PATH_MAP[st]) return st;
  const entry = Object.entries(SUB_TYPE_PATH_MAP).find(([_, v]) => v === st);
  return entry ? entry[0] : (st || '-');
};

const getLongPath = (subType: string) => {
  const st = String(subType || '').trim();
  if (SUB_TYPE_PATH_MAP[st]) return SUB_TYPE_PATH_MAP[st];
  if (Object.values(SUB_TYPE_PATH_MAP).includes(st)) return st;
  return '-';
};

/* [FEAT-20260804-CELLPOPOVER] ช่องที่ถูกตัดคำ — ชี้แล้วเห็นเต็ม ๆ
 *
 * WHY  the cells already carried a title attribute, so the text was reachable, but the
 *   browser tooltip waits about a second, renders in the OS font at a fixed width, and
 *   cannot be selected. These are file paths people copy into a Training Document —
 *   `data.profile.finance.balances[asset_code=cash].amount` is 52 characters and the
 *   column shows about 30 — so "read it and retype it" is the actual workflow being
 *   blocked. A real popover shows instantly, wraps, and can be selected.
 *
 * ⚠️ ไม่ตัด title ทิ้ง — ยังมีไว้เผื่อคนใช้คีย์บอร์ด/screen reader ที่ hover ไม่ถึง
 * ⚠️ โผล่เฉพาะตอนข้อความถูกตัดจริง (วัดจาก scrollWidth > clientWidth)
 *    ข้อความสั้นที่แสดงครบอยู่แล้วไม่ต้องมี popover มาบัง
 * ⚠️ ตำแหน่งใช้ fixed + วัดจาก getBoundingClientRect เพราะแถวอยู่ในตารางที่เลื่อนได้
 *    ถ้าใช้ absolute จะโดน overflow ของตารางตัดหาย
 * revert: ลบ component นี้ + เปลี่ยน <CellText .../> กลับเป็น <span> เดิม
 */
const CellText: React.FC<{ text?: string; className?: string; maxW?: string }> = ({ text, className = '', maxW = 'max-w-[240px]' }) => {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [box, setBox] = React.useState<{ top: number; left: number } | null>(null);
  const value = text || '-';

  const show = () => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return; // ไม่ได้ถูกตัด = ไม่ต้องโชว์
    const r = el.getBoundingClientRect();
    setBox({ top: r.bottom + 6, left: r.left });
  };

  return (
    <>
      <span
        ref={ref}
        className={`truncate block ${maxW} ${className}`}
        title={value}
        onMouseEnter={show}
        onMouseLeave={() => setBox(null)}
      >
        {value}
      </span>
      {box && (
        <div
          className="fixed z-[90] max-w-[480px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 shadow-xl"
          style={{ top: box.top, left: box.left }}
        >
          <span className="block text-[12px] font-mono text-slate-800 dark:text-slate-100 break-all leading-relaxed select-text">
            {value}
          </span>
        </div>
      )}
    </>
  );
};

export const DynamicTagList: React.FC = () => {
  const { t } = useI18n();

  // ==== [FEAT-20260801-BULKTAGSCOPE] START — เลือกหลายรายการแล้วแก้ขอบเขตทีเดียว
  // 🔒 สาย AUTO — to_dev_auto / to_prod_auto
  //
  // ⚠️ เลือกเฉพาะที่เห็นอยู่ในหน้านี้เท่านั้น (ไม่ใช่ "ทั้งหมดที่ตรง filter")
  //    เพราะ "แก้ทุกใบที่ค้นเจอ" เป็นการเขียนทับสิ่งที่มองไม่เห็น ซึ่งกู้คืนยาก
  // ⚠️ ล้างที่เลือกทุกครั้งที่เปลี่ยนหน้า/ค้นใหม่ — id ที่ค้างจากหน้าเก่าจะกลายเป็น
  //    การแก้ของที่ผู้ใช้ไม่เห็นแล้ว
  // revert: ลบบล็อกนี้ + checkbox ในตาราง + ปุ่ม + <BulkTagScopeModal/>
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkGroupIds, setBulkGroupIds] = useState<string[]>([]);
  const [bulkHookIds, setBulkHookIds] = useState<string[]>([]);

  const exitBulk = () => {
    setBulkMode(false); setBulkSelected([]); setBulkOpen(false);
    setBulkGroupIds([]); setBulkHookIds([]);
  };
  const toggleSelected = (id: string) =>
    setBulkSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  /** เปิดกล่อง — ตั้งค่าเริ่มต้นจากใบแรกที่เลือก เพราะเคสที่พบบ่อยคือ
   *  "ทำให้ที่เหลือเหมือนใบนี้" จะได้ไม่ต้องติ๊กใหม่หมด */
  const openBulkScope = () => {
    const first = items.find((i) => i.id === bulkSelected[0]) as any;
    setBulkGroupIds(Array.isArray(first?.group_ids) ? first.group_ids.map(String) : []);
    setBulkHookIds(Array.isArray(first?.hook_ids) ? first.hook_ids.map(String) : []);
    setBulkOpen(true);
  };

  const submitBulkScope = async () => {
    setBulkSaving(true);
    try {
      const res = await dynamicTagService.bulkUpdateScope(bulkSelected, bulkGroupIds, bulkHookIds);
      showAlert(
        t('dyn_tag.bulk_done_title'),
        t('dyn_tag.bulk_done_message', { count: String(res.modified ?? bulkSelected.length) }),
        'success'
      );
      exitBulk();
      await fetchItems();
    } catch (e: any) {
      // BE ตอบเหตุผลมาเป็นข้อความอ่านรู้เรื่องอยู่แล้ว — โชว์ตรง ๆ
      showAlert(t('dyn_tag.bulk_failed_title'), e?.message || t('dyn_tag.bulk_failed_title'), 'error');
    } finally {
      setBulkSaving(false);
    }
  };
  // ==== [FEAT-20260801-BULKTAGSCOPE] END
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DynamicTagEntry[]>([]);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [hooks, setHooks] = useState<HookData[]>([]);
  // ==== [FEAT-20260728-TAGSCOPE] START — filter 2 ชั้น: กลุ่มก่อน → OA ในกลุ่ม
  // กลุ่ม: ตามสิทธิ์ login · [FEAT-20260802-GROUPALL] default = "ทุกกลุ่ม" ('' = ไม่ส่ง scope_group_id)
  // admin ไม่มีกลุ่ม → ไม่มี dropdown กลุ่ม ใช้ filter OA (ตามสิทธิ์) แบบเดิม — ห้ามพัง
  const [tagGroups, setTagGroups] = useState<{ _id: string; group_name: string }[]>([]);
  const [groupFilter, setGroupFilter] = useState('');
  const [groupHooks, setGroupHooks] = useState<HookData[]>([]); // OA ในกลุ่มที่เลือก (ตามสิทธิ์)
  const tagGroupName = (gid?: string) => tagGroups.find(g => g._id === gid)?.group_name || 'กลุ่ม (ไม่พบชื่อ)';
  // ==== [FEAT-20260728-TAGSCOPE] END
  const [hookFilter, setHookFilter] = useState('');
  /* [FEAT-20260803-DYTAGFILTER] กรองตาม path (sub_type = ชื่อ endpoint ของ custom tool)
     รายชื่อดึงจาก DB จริง ไม่ hard-code — endpoint key ต่างกันได้ตาม tool ของแต่ละที่
     ⚠️ ดึงครั้งเดียวตอนเปิดหน้า · ล้มเหลว = [] แล้ว dropdown ไม่โผล่ (หน้าเดิมไม่พัง) */
  const [subTypes, setSubTypes] = useState<{ sub_type: string; label: string; count: number }[]>([]);
  const [subTypeFilter, setSubTypeFilter] = useState('');
  /* [FEAT-20260804-MERGECOL] modal ดู value/detail แบบเต็ม (กดปุ่มตา)
     popover ตอน hover พอสำหรับอ่านผ่าน ๆ แต่หายทันทีที่เมาส์ขยับ — คนที่กำลัง
     ลากคลุมเพื่อคัดลอกจึงใช้ไม่ได้ · modal ค้างไว้จนกดปิด เลือกได้สบาย */
  const [valueModal, setValueModal] = useState<{ value: string; detail: string; tag: string } | null>(null);

  useEffect(() => {
    // [FEAT-20260803-DYTAGFILTER] โหลดรายชื่อ path ที่มีจริงตอนเปิดหน้า
    dynamicTagService.listSubTypes().then(setSubTypes).catch(() => setSubTypes([]));
  }, []);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<DynamicTagEntry | undefined>(undefined);
  const [isView, setIsView] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tag: string } | null>(null);
  // [FEAT-20260728-TAGSCOPE] ถอด NAVIGATION HELPER toast ออกทั้งก้อนตามสั่ง 2026-07-28
  // (เดิม: const [infoToast, setInfoToast] = useState<...>(null); + effect + JSX ก้อนใหญ่)
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

  const showAlert = (title: string, message: string, type: 'success' | 'error') => {
    setAlertState({ isOpen: true, title, message, type });
  };

  const handleCopyTag = async (tag: string) => {
    const wrappedTag = `[[${tag}]]`;
    // [FIX-20260830-COPYHTTP2] the toast follows the real copy — see utils/copyText
    if (!(await copyText(wrappedTag))) return;
    setToast({ message: 'Tag Copied!', tag: wrappedTag });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await dynamicTagService.listDynamicTags({
        page: currentPage,
        limit: pageSize,
        tag: search || undefined,
        hook_id: hookFilter || undefined,
        // [FEAT-20260728-TAGSCOPE] ไม่ได้เจาะ OA → ดูทั้งกลุ่ม (tag กลุ่ม + tag ราย OA สมาชิก)
        scope_group_id: !hookFilter && groupFilter ? groupFilter : undefined,
        sub_type: subTypeFilter || undefined // [FEAT-20260803-DYTAGFILTER]
      });
      setItems(res.data || []);
      setTotalItems(res.pagination?.total || 0);
      setTotalPages(res.pagination?.total_pages || 1);
    } catch (e: any) {
      console.error(e);
      showAlert(t('common.error_title'), e.message || '', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentPage, search, hookFilter, groupFilter, subTypeFilter, pageSize, t]); // [FEAT-20260728-TAGSCOPE] + groupFilter · [FEAT-20260803-DYTAGFILTER] + subTypeFilter

  // Fetch hooks for filter and display
  useEffect(() => {
    webhookService.getAllHooks().then(data => {
      // Sort by created_at ascending (oldest first)
      const sortedHooks = [...data].sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setHooks(sortedHooks);
      // [FEAT-20260728-TAGSCOPE] เดิม: default = OA ตัวแรก + Navigation Helper toast
      // ใหม่: default มาจาก "กลุ่มแรกตาม A-Z ตามสิทธิ์" (effect ด้านล่าง) — ไม่ auto เลือก OA ที่นี่
    }).catch(console.error);
    // [FEAT-20260728-TAGSCOPE] กลุ่มตามสิทธิ์ login (super=ทุกกลุ่ม, อื่น=กลุ่มตัวเอง, เรียง A-Z แล้ว)
    // ไม่มีกลุ่ม → tagGroups ว่าง → ใช้ filter OA อย่างเดียว ห้าม error
    fetchVisibleGroups()
      .then(gs => {
        setTagGroups(gs);
        // [FEAT-20260802-GROUPALL] default = "ทุกกลุ่ม" ('' = ไม่ส่ง scope_group_id)
        //   เดิม: setGroupFilter(gs[0]._id) บังคับกลุ่มแรก A-Z ทำให้เห็นแค่กลุ่มเดียวตอนเข้าหน้า
        //   revert: คืนบรรทัด if (gs.length > 0) setGroupFilter(gs[0]._id);
      })
      .catch(() => setTagGroups([]));
  }, []);

  // [FEAT-20260728-TAGSCOPE] เปลี่ยนกลุ่ม → โหลด OA ในกลุ่ม (กรองตามสิทธิ์ OA ซ้ำอีกชั้น)
  // และ reset filter OA เป็น "ทุก OA ในกลุ่ม" (default ตามสั่ง)
  useEffect(() => {
    if (!groupFilter) { setGroupHooks([]); return; }
    let cancelled = false;
    webhookService.getHooksByGroup(groupFilter)
      .then(hs => { if (!cancelled) setGroupHooks(filterVisibleHooks(hs)); })
      .catch(() => { if (!cancelled) setGroupHooks([]); });
    setHookFilter('');
    setCurrentPage(1);
    return () => { cancelled = true; };
  }, [groupFilter]);


  // [FEAT-20260728-TAGSCOPE] effect auto-hide ของ Navigation Helper ถูกถอดพร้อม toast


  useEffect(() => {
    fetchItems();
  }, [fetchItems, pageSize]); // Add pageSize to dependency

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentPage === 1) {
      fetchItems();
    } else {
      setCurrentPage(1);
    }
  };

  const openCreate = () => {
    setEditing(undefined);
    setIsView(false);
    setIsFormOpen(true);
  };

  const openEdit = (entry: DynamicTagEntry) => {
    setEditing(entry);
    setIsView(false);
    setIsFormOpen(true);
  };

  const openView = (entry: DynamicTagEntry) => {
    setEditing(entry);
    setIsView(true);
    setIsFormOpen(true);
  };

  const submitForm = async (data: DynamicTagFormData) => {
    try {
      if (editing) {
        await dynamicTagService.updateDynamicTag(editing.id, data);
        showAlert(t('common.success'), 'Dynamic Tag updated successfully', 'success');
      } else {
        await dynamicTagService.createDynamicTag(data);
        showAlert(t('common.success'), 'Dynamic Tag created successfully', 'success');
      }
      fetchItems();
    } catch (e: any) {
      console.error(e);
      showAlert(t('common.error_title'), e.message || '', 'error');
      throw e;
    }
  };

  const handleExportExcel = async () => {
    setLoading(true);
    try {
      /* [FIX-20260804-EXPORTALL] ดึงทีละหน้าจนครบ แทนการขอ 10000 แถวรวดเดียว
       *
       * WHY  the call asked for limit 10000, but the endpoint clamps limit to 200, so the
       *   file held the first 200 rows and nothing said otherwise. With 751 tags that is
       *   551 missing from a spreadsheet someone is about to work from. The clamp is
       *   right — one request should not be able to pull an unbounded result set — so the
       *   caller is what has to change.
       * ⚠️ ใช้ limit เท่าเพดานจริงของ BE (200) ขอเกินไปก็ถูกตัดอยู่ดี
       * ⚠️ ส่ง filter ชุดเดียวกับที่ตารางใช้ — ไฟล์ต้องตรงกับสิ่งที่คนเห็นบนจอ
       *    (เดิมลืมส่ง search กับ sub_type ไปด้วย ทำให้ export ได้เกินกว่าที่กรองไว้)
       * 🔴 นับแล้วไม่ตรง total = หยุด แล้วบอกให้รู้ ไม่ปล่อยไฟล์ที่ขาดออกไปเงียบ ๆ
       */
      const PAGE = 200;
      const allItems: any[] = [];
      let total = 0;
      for (let page = 1; page <= 200; page++) {   // เพดานกันวนไม่รู้จบถ้า BE ตอบแปลก
        const res = await dynamicTagService.listDynamicTags({
          page,
          limit: PAGE,
          tag: search || undefined,
          hook_id: hookFilter || undefined,
          scope_group_id: !hookFilter && groupFilter ? groupFilter : undefined, // [FEAT-20260728-TAGSCOPE]
          sub_type: subTypeFilter || undefined,   // [FEAT-20260803-DYTAGFILTER]
        });
        total = res.pagination?.total ?? 0;
        const batch = res.data || [];
        allItems.push(...batch);
        if (batch.length < PAGE || allItems.length >= total) break;
      }
      if (total && allItems.length !== total) {
        showAlert(
          t('common.error_title'),
          t('pageui.messaging.export_incomplete', 'ดึงข้อมูลได้ {got} จาก {total} รายการ — ยังไม่ export เพื่อไม่ให้ได้ไฟล์ที่ขาด', { got: allItems.length, total }),
          'error',
        );
        return;
      }

      // หัวตาราง (Thai Headers)
      const headers = [
        'หมายเลข Tag',
        'คำอธิบาย (Detail)',
        'value',
        'path',
        'ประเภทข้อมูล (API Type)',
        'ชื่อบอท (Line OA)',
        'วันที่สร้าง (Created At)'
      ];

      const rows = allItems.map(item => {
        const hook = hooks.find(h => h._id === item.hook_id);
        const shortKey = getShortKey(item.sub_type);
        const longPath = getLongPath(item.sub_type);
        
        return [
          `[[${item.tag}]]`,
          item.detail || '-',
          item.value || '-',
          `${shortKey}\n${longPath}`,
          item.sub_type || '-',
          // [FEAT-20260728-TAGSCOPE] CSV แสดง scope กลุ่ม/หลายกลุ่ม/บางตัวในกลุ่มด้วย
          (item.group_ids && item.group_ids.length > 0)
            ? `กลุ่ม: ${item.group_ids.map(g => tagGroupName(g)).join('|')}${(item.hook_ids && item.hook_ids.length > 0) ? ` +OA:${item.hook_ids.length}` : ''}`
            : item.group_id
            ? `กลุ่ม: ${tagGroupName(item.group_id)}`
            : (item.hook_ids && item.hook_ids.length > 0)
              ? `เฉพาะ ${item.hook_ids.length} OA: ${item.hook_ids.map(id => hooks.find(h => h._id === id)?.alias || '?').join('|')}`
              : hook ? `${hook.line_oa_name} (${hook.alias})` : 'System',
          item.created_at ? new Date(item.created_at).toLocaleString('th-TH') : '-'
        ];
      });

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      // Determine filename
      const selectedHook = hooks.find(h => h._id === hookFilter);
      // [FEAT-20260728-TAGSCOPE] ไม่ได้เจาะ OA → ตั้งชื่อไฟล์ตามกลุ่มที่เลือก
      const botName = selectedHook
        ? selectedHook.line_oa_name.replace(/\s+/g, '_')
        : (groupFilter ? `Group_${tagGroupName(groupFilter).replace(/\s+/g, '_')}` : 'All_OA');
      const dateStr = new Date().toLocaleDateString('th-TH').replace(/\//g, '-');
      const filename = `${botName}_dynamic_tags_${dateStr}.csv`;

      // ใช้ UTF-8 BOM เพื่อให้ Excel แสดงผลภาษาไทยได้ถูกต้อง
      const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e: any) {
      console.error(e);
      showAlert(t('common.error_title'), 'Failed to export data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await dynamicTagService.deleteDynamicTag(deleteId);
      showAlert(t('common.success'), 'Dynamic Tag deleted successfully', 'success');
      fetchItems();
    } catch (e: any) {
      console.error(e);
      showAlert(t('common.error_title'), e.message || '', 'error');
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 relative">
      {/* Global Toast Notification for List */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[70] bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-6 duration-300 border border-emerald-400/30 backdrop-blur-md">
          <div className="bg-white/20 p-2 rounded-lg">
            <Check size={20} className="text-white" />
          </div>
          <div className="flex flex-col min-w-[200px]">
            <span className="text-sm font-black tracking-tight">{toast.message}</span>
            <p className="text-[10px] font-mono opacity-90 truncate max-w-[250px] mt-0.5">
              {toast.tag}
            </p>
          </div>
        </div>
      )}

      {/* [FEAT-20260728-TAGSCOPE] Navigation Helper toast ถูกถอดออกทั้งก้อนตามสั่ง 2026-07-28 */}


      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Dynamic Tags</h2>
        </div>

        {/* [FIX-20260801-TAGTOOLBAR] เดิม lg:flex-row ตายตัว ไม่ยอมขึ้นบรรทัดใหม่
            พอมีปุ่ม "แก้ขอบเขตที่เลือก" เพิ่มเข้ามา ปุ่มชุดขวาเลยล้นออกนอกกรอบ
            → เติม flex-wrap + บังคับให้กลุ่มปุ่มขึ้นแถวใหม่ (basis-full)
            revert: เอา flex-wrap ออก แล้วรวมปุ่มกลับเป็น div เดียว */}
        <form onSubmit={handleSearch} className="flex flex-col lg:flex-row lg:items-center gap-3 w-full flex-1 min-w-0">
          <div className="relative group w-full lg:flex-1 lg:min-w-[200px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="text-slate-700 group-focus-within:text-primary-500 transition-colors" size={18} />
            </div>
            <input
              type="text"
              placeholder={t('pageui.messaging.tag_search_ph', 'ค้นหา tag / detail / value...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"

            />
          </div>

          {/* ==== [FEAT-20260728-TAGSCOPE] START — เดิม: dropdown OA เดียว (All OA + ทุก OA)
              ใหม่: filter 2 ชั้นตามสิทธิ์ login — (1) กลุ่มก่อน: default กลุ่มแรก A-Z
              ไม่มีตัวเลือก "ทุกกลุ่ม" · admin ไม่มีกลุ่ม → ซ่อน dropdown นี้ ใช้ OA อย่างเดียว
              (2) OA ภายใต้กลุ่ม: default "ทุก OA ในกลุ่ม" */}
          {tagGroups.length > 0 && (
          <div className="relative group w-full sm:w-56">
             <select
               value={groupFilter}
               onChange={(e) => { setGroupFilter(e.target.value); }}
               className="w-full bg-purple-50/50 border-2 border-purple-500 rounded-xl py-2.5 px-4 text-sm font-black text-purple-900 focus:ring-4 focus:ring-purple-500/20 focus:border-purple-600 outline-none transition-all appearance-none cursor-pointer shadow-lg shadow-purple-500/10 hover:bg-purple-50 hover:border-purple-600"
             >
               {/* [FEAT-20260802-GROUPALL] default = ทุกกลุ่ม (เหมือนหน้า flex-messages) */}
               <option value="" className="font-bold text-slate-900">👥 {t('pageui.messaging.all_groups', 'ทุกกลุ่ม')}</option>
               {tagGroups.map(g => (
                 <option key={g._id} value={g._id} className="font-bold text-slate-900">👥 {g.group_name}</option>
               ))}
             </select>
             <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-purple-600">
               <ChevronDown size={18} />
             </div>
          </div>
          )}
          {/* [FEAT-20260803-DYTAGFILTER] กรองตาม path (endpoint ของ custom tool)
              โผล่เฉพาะตอนมี path ให้เลือกมากกว่า 1 — มีอันเดียวก็ไม่ต้องมีตัวกรอง
              ⚠️ นับจำนวนต่อท้ายให้เห็นเลยว่ากดแล้วจะเหลือกี่รายการ
              revert: ลบ block นี้ + state subTypes/subTypeFilter + param sub_type */}
          {subTypes.length > 1 && (
          <div className="relative group w-full sm:w-60">
             <select
               value={subTypeFilter}
               onChange={(e) => { setSubTypeFilter(e.target.value); setCurrentPage(1); }}
               className="w-full bg-sky-50/50 border-2 border-sky-500 rounded-xl py-2.5 px-4 text-sm font-black text-sky-900 focus:ring-4 focus:ring-sky-500/20 focus:border-sky-600 outline-none transition-all appearance-none cursor-pointer shadow-lg shadow-sky-500/10 hover:bg-sky-50 hover:border-sky-600"
             >
               <option value="" className="font-bold text-slate-700">{t('pageui.messaging.all_paths', 'ทุก path')}</option>
               {subTypes.map(st => (
                 <option key={st.sub_type} value={st.sub_type} className="font-bold text-slate-900">
                   {st.label} ({st.count})
                 </option>
               ))}
             </select>
             <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-sky-600">
               <ChevronDown size={18} />
             </div>
          </div>
          )}

          <div className="relative group w-full sm:w-64">
             <select
               value={hookFilter}
               onChange={(e) => {
                 setHookFilter(e.target.value);
                 setCurrentPage(1);
               }}
               className="w-full bg-emerald-50/50 border-2 border-emerald-500 rounded-xl py-2.5 px-4 text-sm font-black text-emerald-900 focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-600 outline-none transition-all appearance-none cursor-pointer shadow-lg shadow-emerald-500/10 hover:bg-emerald-50 hover:border-emerald-600"
             >
               <option value="" className="font-bold text-slate-700">{groupFilter ? t('pageui.messaging.all_oas_in_group', 'ทุก OA ในกลุ่ม') : 'All OA'}</option>
               {(groupFilter ? groupHooks : filterVisibleHooks(hooks)).map(h => (
                 <option key={h._id} value={h._id} className="font-bold text-slate-900">{h.line_oa_name} / {h.alias}</option>
               ))}
             </select>
             <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-emerald-600">
               <ChevronDown size={18} />
             </div>
          </div>
          {/* ==== [FEAT-20260728-TAGSCOPE] END */}

          {/* [FIX-20260801-TAGTOOLBAR] Refresh อยู่ท้ายแถวตัวกรอง — มันคือ submit ของฟอร์มค้นหา
              ปุ่มจัดการ (Export/แก้ขอบเขต/เพิ่มใหม่) ย้ายออกไปนอกการ์ดแล้ว ดูข้างล่าง */}
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              type="submit"
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              {t('common.refresh')}
            </button>
          </div>

          </form>
      </div>

      {/* ==== [FIX-20260801-TAGTOOLBAR] ปุ่มจัดการ — อยู่นอกการ์ด ไม่มีพื้นหลัง
           ผู้ใช้สั่ง "export edit add แยกออกมาเป็น div ใหม่แบบไม่มี bg"
           อยู่นอก <form> ด้วย — ทั้ง 3 ปุ่มเป็น type="button" อยู่แล้ว ไม่ได้พึ่ง submit
           ⚠️ Refresh ไม่ย้ายมาด้วย เพราะมันคือ submit ของฟอร์มค้นหา ต้องอยู่ในฟอร์ม
           revert: ย้ายบล็อกนี้กลับเข้าไปในฟอร์ม แล้วลบ div ครอบนี้ */}
      <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleExportExcel}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 whitespace-nowrap"
              >
                <FileSpreadsheet size={18} />
                Export
              </button>
              {/* ==== [FEAT-20260801-BULKTAGSCOPE] ปุ่มเข้า/ออกโหมดเลือก + ปุ่มแก้ขอบเขต
                   วางไว้ก่อนปุ่ม "เพิ่มใหม่" ให้อยู่กลุ่มเดียวกับปุ่มจัดการอื่น
                   ⚠️ ปุ่มแก้จะกดได้เมื่อเลือกอย่างน้อย 1 รายการเท่านั้น */}
              {bulkMode ? (
                <>
                  <button type="button" onClick={openBulkScope} disabled={bulkSelected.length === 0}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
                    <Users size={18} />
                    {t('dyn_tag.bulk_button')} ({bulkSelected.length})
                  </button>
                  <button type="button" onClick={exitBulk}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-800 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
                    <X size={18} /> {t('common.cancel')}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setBulkMode(true)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 border border-sky-500/40 text-sky-600 dark:text-sky-300 hover:bg-sky-500/10 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
                  <CheckSquare size={18} /> {t('dyn_tag.bulk_button')}
                </button>
              )}
              <button
                type="button"
                onClick={openCreate}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-primary-500/20 transition-all hover:scale-105 whitespace-nowrap"
              >
                <Plus size={18} />
                {t('common.add_new')}
              </button>
            
      </div>

      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden relative">
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse z-10" />
        )}
        {/* ==== [FIX-20260801-TAGTOOLBAR] แถบทำงานเหนือตาราง — โผล่เมื่อเลือกแล้วเท่านั้น
             ผู้ใช้สั่ง "ถ้า select แล้ว ปุ่ม edit โชว์ด้านซ้ายของ table"
             อยู่ติดกับ checkbox ที่เพิ่งกด ไม่ต้องกวาดตาไปหาปุ่มบนสุดของหน้า
             ⚠️ ปุ่มบน toolbar ยังอยู่เหมือนเดิม — อันนี้เป็นทางลัด ไม่ได้ย้ายของเดิมมา
             revert: ลบบล็อกนี้ */}
        {bulkMode && bulkSelected.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-dark-700 bg-sky-500/10">
            <span className="text-xs font-bold text-sky-700 dark:text-sky-300">
              {t('dyn_tag.bulk_selected_count', { count: String(bulkSelected.length) })}
            </span>
            <button type="button" onClick={openBulkScope}
              className="inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
              <Users size={14} /> {t('dyn_tag.bulk_button')}
            </button>
            <button type="button" onClick={() => setBulkSelected([])}
              className="text-xs font-medium text-slate-700 hover:text-slate-700 dark:hover:text-slate-800">
              {t('common.cancel')}
            </button>
          </div>
        )}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                {/* [FEAT-20260801-BULKTAGSCOPE] คอลัมน์เลือก — โผล่เฉพาะตอนเปิดโหมดเลือก
                    ติ๊กหัวตาราง = เลือก/ยกเลิกทั้งหน้านี้ (ไม่ใช่ทุกหน้า — ดูเหตุผลที่ state) */}
                {bulkMode && (
                  <th className="px-4 py-4 w-10">
                    <button type="button" onClick={() => setBulkSelected(
                      bulkSelected.length === items.length ? [] : items.map((i) => i.id))}
                      className="text-slate-700 hover:text-sky-500" title={t('pageui.messaging.select_page', 'เลือกทั้งหน้านี้')}>
                      {bulkSelected.length === items.length && items.length > 0
                        ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </th>
                )}
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">Tags</th>
                {/* ==== [FIX-20260729-DYTAGCOL] START — 🔒 สาย AUTO
                    เดิมหัวตารางเป็น Detail / Value แต่ข้อมูลที่วางอยู่ใต้หัวข้อ
                    ไม่ตรงกัน: ช่อง "Detail" แสดง detail + **value** ซ้อนกัน ส่วนช่อง
                    "Value" กลับแสดง sub_type (short key + long path) ซึ่งมักว่าง →
                    ผู้ใช้เห็น VALUE เป็น "-" ทั้งที่ tag มี value อยู่จริง
                    แก้ให้ 1 หัวข้อ = 1 ข้อมูล ตรงกับที่ CSV export แยกไว้อยู่แล้ว
                    (headers: Detail · value · path)
                    revert: คืนเป็น 2 หัวข้อ Detail/Value แล้วรวม cell กลับ */}
                {/* [FEAT-20260804-MERGECOL] ยุบ Detail + Value เป็นคอลัมน์เดียว 2 บรรทัด
                    value อยู่บน (สิ่งที่คนก๊อปไปใช้) · detail อยู่ล่างเป็นคำอธิบาย
                    ได้ความกว้างคืนมาหนึ่งคอลัมน์ ทั้งคู่จึงแสดงได้ยาวขึ้นกว่าเดิมมาก */}
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap w-full">Value / Detail</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">Path</th>
                {/* ==== [FIX-20260729-DYTAGCOL] END */}
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">OA</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan={bulkMode ? 7 : 6} className="px-6 py-12 text-center text-slate-700">
                    No results found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className={`transition-colors hover:bg-dark-700/50 ${bulkMode && bulkSelected.includes(item.id) ? 'bg-sky-500/10' : ''}`}>
                    {/* [FEAT-20260801-BULKTAGSCOPE] แถวที่เลือกไว้เรืองสีฟ้า ให้เห็นชุดที่กำลังจะแก้ */}
                    {bulkMode && (
                      <td className="px-4 py-4 w-10">
                        <button type="button" onClick={() => toggleSelected(item.id)}
                          className={bulkSelected.includes(item.id) ? 'text-sky-500' : 'text-slate-700 hover:text-sky-500'}>
                          {bulkSelected.includes(item.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 group/tag">
                        <TagIcon size={16} className="text-primary-500" />
                        <span className="text-sm font-bold text-slate-900">
                          {`[[${item.tag}]]`}
                        </span>
                        <button
                          onClick={() => handleCopyTag(item.tag)}
                          className="p-1.5 rounded bg-white border border-slate-200 shadow-sm transition-all flex items-center gap-1.5 text-[10px] font-bold text-primary-600 hover:bg-primary-50 whitespace-nowrap"
                          title="Copy Tag"
                        >
                          <Copy size={12} /> Copy
                        </button>
                      </div>
                    </td>
                    {/* [FEAT-20260804-MERGECOL] Value (บน) + Detail (ล่าง) ในช่องเดียว
                        [FIX-20260729-DYTAGCOL] Value = value จริงของ tag · Detail = คำอธิบาย */}
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          {/* [FIX-20260804-NOCLAMP] ไม่บังคับความกว้างแล้ว — ยืดเต็มช่องที่มี
                              คอลัมน์นี้กว้างกว่าข้อความจริงอยู่แล้วหลังยุบ 2 คอลัมน์เป็นอันเดียว
                              การตรึงไว้ 380px จึงตัดคำทั้งที่ยังเหลือที่ว่างทางขวาอีกเยอะ
                              ⚠️ popover ยังทำงานเหมือนเดิม — มันเช็คจาก scrollWidth ตอน hover
                                 ข้อความสั้นพอจะไม่ขึ้น ยาวเกินช่องจริง ๆ ถึงจะขึ้น */}
                          <CellText text={item.value} className="text-[11px] font-mono text-slate-900 font-bold" maxW="" />
                          {/* [FIX-20260804-NOCLAMP] detail เป็น badge — แยกสายตาออกจาก path ด้านบน
                              สองบรรทัดในช่องเดียวอ่านปนกันง่าย · badge ทำให้รู้ทันทีว่าอันไหน
                              คือ path (ก๊อปไปใช้) อันไหนคือชื่อเรียก
                              ⚠️ w-fit ไม่ใช่เต็มแถว ไม่งั้นกลายเป็นแถบยาวพาดทั้งช่อง */}
                          {item.detail ? (
                            <span className="mt-1.5 inline-block w-fit max-w-full rounded-md bg-slate-500/10 dark:bg-slate-400/15 px-2 py-0.5 text-[12px] font-bold text-slate-600 dark:text-white break-all">
                              {item.detail}
                            </span>
                          ) : (
                            <span className="mt-1.5 block text-sm text-slate-700 dark:text-slate-700">-</span>
                          )}
                        </div>
                        {/* 👁 ชี้ = popover · กด = modal (เผื่อ path ยาวมากจนอยากอ่านนิ่ง ๆ) */}
                        <button
                          type="button"
                          onClick={() => setValueModal({ value: item.value || '-', detail: item.detail || '-', tag: item.tag })}
                          title={t('pageui.messaging.view_full', 'ดูแบบเต็ม')}
                          className="shrink-0 mt-0.5 p-1.5 rounded-md text-slate-700 hover:text-primary-600 hover:bg-primary-500/10 transition-colors"
                        >
                          <Eye size={15} />
                        </button>
                      </div>
                    </td>
                    {/* [FIX-20260729-DYTAGCOL] Path = sub_type (short key + long path)
                        ว่างได้ตามปกติถ้า tag ไม่ได้ผูก sub_type */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <CellText text={getShortKey(item.sub_type)} className="text-[11px] font-mono text-slate-900 font-bold" maxW="max-w-[200px]" />
                        {getLongPath(item.sub_type) !== '-' && (
                          <span className="px-2 py-0.5 w-fit rounded text-[9px] font-black uppercase bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
                            {getLongPath(item.sub_type)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {/* [FEAT-20260728-TAGSCOPE] tag ผูกกลุ่ม → ชื่อกลุ่ม · ผูกบางตัว (hook_ids) → จำนวน+รายชื่อย่อ
                          หลายกลุ่ม (group_ids) → รายชื่อกลุ่ม (+จำนวน OA เพิ่มถ้าผสม)
                          [FEAT-20260830-TAGSCOPECELL] ย้ายทั้งสี่กรณีออกไปเป็น
                          `components/messaging/cells/TagScopeCell` — ตัวเลือกว่ากรณีไหนชนะ
                          และข้อความเหมือนเดิมทุกตัว ที่เพิ่มคือตัดรายชื่อเหลือ 2 แล้ว
                          เหลือเป็น +N กดดูทั้งหมดใน modal (15 กลุ่มเคยดันคอลัมน์ตกจอ)
                          ไฟล์นี้อยู่ใน waiver list ของ max-lines อยู่แล้ว จึงห้ามโตเพิ่ม */}
                      <TagScopeCell item={item} hooks={hooks} groupName={tagGroupName} />
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openView(item)}
                          className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-slate-700 hover:text-emerald-500 transition-colors"
                          title="View"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => openEdit(item)}
                          className="p-1.5 rounded-lg hover:bg-primary-500/20 text-slate-700 hover:text-primary-500 transition-colors"
                          title={t('common.edit')}
                        >
                          <Edit2 size={16} />
                        </button>
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

        <div className="flex flex-col sm:flex-row justify-between items-center px-6 py-4 border-t border-dark-700 gap-4">
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-700 whitespace-nowrap">
              {t('common.showing_total', { count: totalItems })}
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-dark-900 border border-dark-600 rounded-lg py-1 px-2 text-xs text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none"
            >
              <option value="10">10 / Page</option>
              <option value="25">25 / Page</option>
              <option value="50">50 / Page</option>
              <option value="100">100 / Page</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-dark-700 text-slate-700 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-primary-500">{currentPage}</span>
              <span className="text-sm text-slate-700">/</span>
              <span className="text-sm text-slate-700">{totalPages}</span>
            </div>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg bg-dark-700 text-slate-700 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <DynamicTagFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditing(undefined);
          setIsView(false);
        }}
        onSubmit={submitForm}
        initialData={editing}
        mode={isView ? 'view' : (editing ? 'update' : 'create')}
      />

      {/* [FEAT-20260804-MERGECOL] ดู value/detail เต็ม ๆ + คัดลอกได้

          ⚠️ ใช้ break-all เพราะ path ไม่มีช่องว่างให้ตัดบรรทัด ถ้าไม่ใส่จะล้นกรอบ */}

      {valueModal && (

        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-dark-950/60 backdrop-blur-sm animation-fade-in"

             onClick={() => setValueModal(null)}>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>

            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">

              <span className="font-mono text-sm font-bold text-primary-600 truncate">[[{valueModal.tag}]]</span>

              <button type="button" onClick={() => setValueModal(null)}

                      className="p-1.5 rounded-lg text-slate-700 hover:text-slate-600 hover:bg-slate-100 transition-colors">

                <X size={18} />

              </button>

            </div>

            <div className="px-5 py-4 space-y-4">

              <div>

                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1">Value</p>

                <p className="text-[13px] font-mono text-slate-800 dark:text-slate-100 break-all leading-relaxed select-text bg-slate-50 dark:bg-slate-900/60 rounded-lg px-3 py-2">

                  {valueModal.value}

                </p>

              </div>

              <div>

                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1">Detail</p>

                <p className="text-sm text-slate-700 dark:text-slate-200 break-words leading-relaxed select-text">{valueModal.detail}</p>

              </div>

            </div>

            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex justify-end">

              <button type="button"

                      /* [FIX-20260830-COPYHTTP2] the dialog closes only once the value
                         is really on the clipboard — it used to close on a no-op,
                         taking the value off screen with it. */
                      onClick={() => {
                        const value = valueModal.value;
                        void copyText(value).then((ok) => { if (ok) setValueModal(null); });
                      }}

                      className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 transition-all inline-flex items-center gap-2">

                <Copy size={14} /> {t('pageui.messaging.copy_value', 'คัดลอก Value')}

              </button>

            </div>

          </div>

        </div>

      )}


      <ConfirmModal
        isOpen={!!deleteId}
        title="Delete Dynamic Tag?"
        message="Are you sure you want to delete this dynamic tag? This action cannot be undone."
        onConfirm={confirmDelete}
        onClose={() => setDeleteId(null)}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />


      {/* ==== [FEAT-20260801-BULKTAGSCOPE] กล่องแก้ขอบเขตหลายรายการ
           groups/hooks ใช้ชุดเดียวกับ dropdown ตัวกรองด้านบน — ไม่ยิง API เพิ่ม
           → แอดมินเห็นเฉพาะกลุ่ม/OA ที่ตัวเองมีสิทธิ์อยู่แล้ว (filterVisibleHooks) */}
      <BulkTagScopeModal
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        tagNames={items.filter((i) => bulkSelected.includes(i.id)).map((i) => i.tag)}
        groups={tagGroups.map((g): ScopeOption => ({ id: String(g._id), label: g.group_name }))}
        hooks={hooks.map((h): ScopeOption => ({
          id: String(h._id),
          label: h.line_oa_name || h.alias || String(h._id),
          groupId: (h as any).group ? String((h as any).group) : undefined,
          groupLabel: tagGroups.find((g) => String(g._id) === String((h as any).group))?.group_name,
        }))}
        groupIds={bulkGroupIds}
        hookIds={bulkHookIds}
        onChangeGroups={setBulkGroupIds}
        onChangeHooks={setBulkHookIds}
        onConfirm={submitBulkScope}
        saving={bulkSaving}
      />

      <AlertModal
        isOpen={alertState.isOpen}
        onClose={() => setAlertState(prev => ({ ...prev, isOpen: false }))}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />
    </div>
  );
};

export default DynamicTagList;
