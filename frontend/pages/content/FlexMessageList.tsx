import React, { useCallback, useEffect, useState } from 'react';
// [FEAT-20260802-FLEXTAG] + Check (toast) / Tag (ไอคอนหน้า tag)
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Trash2, Edit2, Play, Filter, Copy, Check, Tag as TagIcon, HelpCircle, X, AlertCircle, Layers, LayoutGrid, Table2 } from 'lucide-react';
import { flexMessageService } from '../../services/media';
import { FlexMessageEntry, FlexMessageFormData, GroupEntry } from '../../types';
import { FlexMessageFormModal, FlexPreviewModal, FlexCardCarousel, FlexCloneTemplateButton, useFlexViewMode, FlexBulkBar, FlexBulkGroupsModal, useFlexSelection, FLEX_TYPES, VISIBLE_FLEX_TYPES } from '../../components/flex';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';
import { useGroupsQuery } from '../../services/admin/queries';
import { useFlexListPageQuery } from '../../services/media/queries';
import { copyText } from '../../utils/copyText';
// [FEAT-20260831-MENUMAINTAG] one spelling of the [[[ ]]] form for every view
import { flexMarker, isFlexMarkerValue } from '../../utils/flexMarker';

// [FEAT-20260802-FLEXTYPEINFO] เนื้อหา modal อธิบายประเภท flex (โชว์แค่ 4 · ซ่อน normal/template_message)
//   เน้น "โปรไฟล์ (กึ่งปรับแต่ง)" เป็นพระเอก (highlight)
const FLEX_TYPE_INFO: { id: string; label: string; body: string; highlight?: boolean }[] = [
  { id: 'slip', label: 'สลิป (slip)', body: 'ใช้กับสลิป — การ์ดผลตรวจสลิป' },
  { id: 'profile', label: 'โปรไฟล์ (profile)', body: 'ล็อคตำแหน่งโปรไฟล์บางส่วน + แสดงข้อความที่ ai generate มาในส่วนของ content (ล็อคตำแหน่งของ flex)' },
  { id: 'custom', label: 'ปรับแต่ง (custom)', body: 'ล็อคตำแหน่งข้อมูล value และรูปแบบของข้อมูล value ทั้งหมด' },
  { id: 'profile_semi_custom', label: 'โปรไฟล์ กึ่งปรับแต่ง (profile-semi-custom)', highlight: true, body: 'ล็อคตำแหน่งโปรไฟล์บางส่วน + แสดงข้อความที่ ai generate ในส่วนของ content และ generate flex เองได้ในส่วนของ body ตามรูปแบบที่กำหนด' },
];

const NO_GROUPS: GroupEntry[] = [];   // [FEAT-20261027-TANSTACK] stable empty

export const FlexMessageList: React.FC = () => {
  const { t } = useI18n();
  // [FEAT-20260802-FLEXTYPEINFO] modal อธิบายประเภท (ปุ่ม ? เด่น ๆ ข้างหัวข้อ)
  const [infoOpen, setInfoOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  // [FEAT-20260802-FLEXTYPEFILTER] กรองตามประเภท (ว่าง = ทุกประเภท) + map ป้ายไว้โชว์ใน column
  const [typeFilter, setTypeFilter] = useState('');
  /* [FEAT-20260829-FLEXMENUTYPE] Normal / Flex Menu.
     'normal' is the page as it has always been — everything that is NOT a
     menu card, decided on the SERVER so the dashboard never has to learn
     which types are special. Default 'normal' ⇒ opening this page shows
     exactly what it showed before this feature existed. */
  const [tab, setTab] = useState<'normal' | 'menu'>('normal');
  /* [FEAT-20260831-FLEXCAROUSEL] ตาราง ⇄ carousel · คีย์เป็น `tab` ตัวเดียวกับที่
     พรีวิวในแถวเคยใช้ ⇒ สลับแท็บแล้วกลับเป็นตารางเสมอ ตามที่เจ้าของสั่ง
     (ปุ่มลูกตารายแถวถูกถอดออก — บทบาทนั้นย้ายมาเป็นปุ่มสลับโหมดปุ่มเดียว) */
  const viewMode = useFlexViewMode(tab);
  const flexTypeLabel = (v?: string | null) => FLEX_TYPES.find(ftx => ftx.value === v)?.label || v || '-';
  const [currentPage, setCurrentPage] = useState(1);
  /* [FEAT-20260831-FLEXPERPAGE] เจ้าของแจ้ง 31/08 ว่า per-page หายไปทั้งสองแท็บ
     เดิมเป็นค่าคงที่ 10 แก้ไม่ได้ · ทำเป็น state + ตัวเลือกท้ายตาราง
     ⚠️ เปลี่ยนค่าแล้วต้องกลับหน้า 1 เสมอ ไม่งั้นจะค้างอยู่หน้าที่ไม่มีอยู่จริง
        (เช่นอยู่หน้า 5 ของ 10/หน้า แล้วเปลี่ยนเป็น 100/หน้า ⇒ เหลือหน้าเดียว) */
  const [itemsPerPage, setItemsPerPage] = useState(10);
  /* [FEAT-20260831-FLEXLOADMORE] โหมดการ์ดไม่ใช้ pagination/per-page — เจ้าของสั่ง 31/08
     *"แบบ flex ไม่ต้องมี pagination ไม่ต้องมี per page ใช้ lazy load + load more
       ไปเรื่อยๆ และแสดงจำนวนการ์ดทั้งหมดตลอดเวลาตำแหน่งเดิม"*
     ⇒ ถือ "โหลดมาแล้วกี่ใบ" แทนเลขหน้า · กด load more = ขยายตัวเลขนี้
     ⚠️ จงใจใช้ **limit ที่โตขึ้น** ไม่ใช่การ append ทีละหน้าฝั่ง client
        เพราะ append เองต้องจัดการซ้ำ/ลำดับ/ของที่เพิ่งถูกลบ ⇒ บั๊กเงียบ
        ส่วนนี้ยิงคำขอเดียวได้ผลลัพธ์ที่ตรงกับเซิร์ฟเวอร์เสมอ
        ต้นทุน render ฝั่ง client ถูกคุมด้วย lazy reveal อยู่แล้ว */
  const CAROUSEL_STEP = 12;
  const [cardCount, setCardCount] = useState(CAROUSEL_STEP);
  /* อ่านสถานะ loading จาก callback ที่ตั้งใจให้ไม่มี dep — ใช้ ref แทน state */
  const loadingRef = React.useRef(false);

  /* [FEAT-20260830-FLEXBULKGROUPS] bulk group editing.
     The reset key is everything that changes WHICH rows exist. A selection that
     survived a page or filter change would let the confirm dialog list fewer
     cards than the write actually touches — and this write REPLACES the scope,
     so the unlisted ones would silently change hands. */
  const selection = useFlexSelection(
    `${tab}|${currentPage}|${search}|${groupFilter}|${typeFilter}`,
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkGroups, setBulkGroups] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  /* ONE source of truth for the table width — the checkbox column makes it six.
     It used to be a literal 5 in the empty-state cell with a comment recording a
     hand-made 4 → 5 bump; three literals would drift the way that one nearly
     did. Add a column ⇒ change this line only. */
  const colCount = selection.active ? 6 : 5;

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<FlexMessageEntry | undefined>(undefined);
  const [isView, setIsView] = useState(false);
  /* [FEAT-20260829-FLEXMENUTYPE] ปุ่ม preview บนตารางเปิด simulator ตรง ๆ
     เดิมมันเปิด "ฟอร์มในโหมด view" ซึ่งต้องกดอีกทีถึงจะเห็นการ์ด — ทำงานเหมือนกัน
     ทุกแท็บ เพราะสิ่งที่คนอยากเห็นคือการ์ด ไม่ใช่ฟอร์ม
     revert: คืน onClick กลับเป็น openView(item) แล้วลบ state/โมดัลนี้ */
  const [previewJson, setPreviewJson] = useState<unknown>(null);
  const [isClone, setIsClone] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // [FEAT-20260802-FLEXTAG] toast ตอนคัดลอก tag (เก็บค่าที่คัดลอกไปโชว์ให้เห็นกับตา)
  const [tagToast, setTagToast] = useState<string | null>(null);
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

  /* [FEAT-20260830-FLEXBULKGROUPS] one request for the whole batch.
     🔗 CROSS-REPO: the endpoint lives in `omnidesk-api`
     (POST /api/flex-messages/bulk-groups) and IT decides — it re-applies the
     caller's group scope to the read and to every write, so `skipped` naming
     cards this account may not touch is a normal answer, not a failure.
     Deploy BE first; without it this button answers 404. */
  const handleBulkGroups = async () => {
    setBulkSaving(true);
    try {
      const res = await flexMessageService.bulkUpdateGroups(selection.ids, bulkGroups);
      setBulkOpen(false);
      selection.exit();
      await fetchItems();
      const skipped = res.skipped.length
        ? ` ${t('flex.bulk_result_skipped', { count: String(res.skipped.length) })}`
        : '';
      showAlert(
        t('common.success'),
        t('flex.bulk_result', {
          modified: String(res.modified),
          matched: String(res.matched),
        }) + skipped,
        'success',
      );
    } catch (e: any) {
      showAlert(t('common.error_title'), e?.message || '', 'error');
    } finally {
      setBulkSaving(false);
    }
  };

  /* [FEAT-20260831-FLEXINFINITE] เลื่อนสุด ⇒ ขยายจำนวนที่โหลด
     ⚠️ ต้อง `useCallback` — carousel ใช้ค่านี้เป็น dep ของ IntersectionObserver
        ถ้า identity เปลี่ยนทุก render จะ subscribe/unsubscribe รัวไม่หยุด
     ⚠️ กัน `loading` ไว้ ไม่งั้นเลื่อนค้างที่ปลายแถวจะยิงซ้อนกันหลายรอบ */
  const loadMoreCards = useCallback(() => {
    if (loadingRef.current) return;
    setCardCount((c) => c + CAROUSEL_STEP);
  }, []);

  /* ==== [FEAT-20261027-TANSTACK] the list read — shared contract ====================
   * services/query/usePageQuery.ts (`onFailure: 'keep'`, no poll): read on mount and on
   * every key change, loading on every read, a failed read alerts and KEEPS the rows.
   * Pinned by test/requests/contentLists.requests.test.tsx (passes on old and new code).
   * revert: restore this file from tag ckpt-after-tanstack-p4-demo-27102026. */
  const flexQuery = useFlexListPageQuery(
    {
      page: viewMode.isCarousel ? 1 : currentPage,
      limit: viewMode.isCarousel ? cardCount : itemsPerPage,
      name: search || undefined,
      group_id: groupFilter || undefined,
      /* [FIX-20260829-TABWINS] The type filter belongs to the NORMAL tab only — on the
         server `flex_type` outranks `tab`, so on the menu tab the parameter is never sent. */
      flex_type: (tab === 'normal' && typeFilter) || undefined,
      tab,
    },
    (e: any) => { console.error(e); showAlert(t('flex.alert_load_failed'), e.message || '', 'error'); },
  );
  const items: FlexMessageEntry[] = flexQuery.page?.data || [];
  const totalItems = flexQuery.page?.pagination?.total || 0;
  const totalPages = flexQuery.page?.pagination?.total_pages || 1;
  const loading = flexQuery.loading;
  loadingRef.current = loading;   // loadMoreCards reads it synchronously (carousel guard)
  const { refetch: refetchFlex } = flexQuery;
  const fetchItems = useCallback(async () => { await refetchFlex(); }, [refetchFlex]);
  // group filter options — one read per mount, failure = empty list (as before)
  const groups: GroupEntry[] = useGroupsQuery({ limit: 100, status: true }).data?.data ?? NO_GROUPS;

  /* [FEAT-20260825-FLEXDEEPLINK] เปิดโมดัลแก้ไขจากลิงก์ `?edit=<id>`
     เจ้าของ 25/08: *"เปิด page flex message (new tab) พร้อม edit record model
     รายการนี้เปิดรอเลย"*

     🔴 รอบแรกผมเขียนให้ไปค้นใน `items` ซึ่ง **ผิด** — ลิสต์แบ่งหน้า ใบที่ต้องการ
        อาจไม่ได้อยู่หน้าแรก แล้วโมดัลก็ไม่เปิดโดยไม่มีอะไรบอก (เจ้าของเจอจริง)
     ⇒ ดึงใบนั้นตรง ๆ ด้วย `getFlexMessage(id)` ซึ่งมีอยู่แล้วในเซอร์วิส
        ไม่ขึ้นกับหน้าไหน ไม่ขึ้นกับตัวกรองที่ค้างอยู่

     ⚠️ `openedRef` กันเปิดซ้ำเมื่อลิสต์รีเฟรช (เช่นหลังเซฟ) และไม่ล้าง query ทิ้ง
        เพื่อให้กด refresh แล้วยังเปิดใบเดิม
     ⚠️ หาไม่เจอ = แจ้งเตือน ไม่ใช่เงียบ — เงียบคืออาการที่เพิ่งแก้ไป
     revert: ลบ effect นี้ + `openedRef` */
  const openedRef = React.useRef<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    if (!id || openedRef.current === id) return;
    openedRef.current = id;
    let alive = true;
    (async () => {
      try {
        const entry = await flexMessageService.getFlexMessage(id);
        if (alive && entry) openEdit(entry);
      } catch (e: any) {
        console.error('deep-link edit failed', e);
        showAlert(t('flex.alert_load_failed'), e?.message || '', 'error');
      }
    })();
    return () => { alive = false; };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1); setCardCount(CAROUSEL_STEP);
    fetchItems();
  };

  /* [FEAT-20260829-FLEXMENUTYPE] ปุ่มเพิ่มแยกสองใบ
     · "เพิ่มใหม่" = การ์ดทั่วไป — เลือกประเภทได้ตามเดิม แต่ไม่มี menu ให้เลือก
     · "เพิ่มเมนู"  = ล็อก type เป็น menu เลย เปลี่ยนไม่ได้
     เหตุผล: ประเภท menu ไม่ควรไปปนอยู่ในลิสต์เดียวกับการ์ดปกติ คนกดผิดแล้วจะได้
     การ์ดที่ระบบเมนูมองไม่เห็น หรือการ์ดเมนูที่หลงไปอยู่แท็บทั่วไป */
  const [lockedType, setLockedType] = useState<string | undefined>(undefined);

  const openCreate = (locked?: string) => {
    setEditing(undefined);
    setIsView(false);
    setIsClone(false);
    setLockedType(locked);
    setIsFormOpen(true);
  };

  const openEdit = (entry: FlexMessageEntry) => {
    setLockedType(undefined); // แก้ของเดิม = ใช้ type ที่การ์ดนั้นเป็นอยู่
    setEditing(entry);
    setIsView(false);
    setIsClone(false);
    setIsFormOpen(true);
  };

  const openView = (entry: FlexMessageEntry) => {
    setEditing(entry);
    setIsView(true);
    setIsClone(false);
    setIsFormOpen(true);
  };

  const openClone = (entry: FlexMessageEntry) => {
    setEditing(entry);
    setIsView(false);
    setIsClone(true);
    setIsFormOpen(true);
  };

  const submitForm = async (data: FlexMessageFormData) => {
    try {
      if (editing && !isClone) {
        await flexMessageService.updateFlexMessage(editing.id, data);
        showAlert(t('common.success'), t('flex.alert_updated'), 'success');
      } else {
        await flexMessageService.createFlexMessage(data);
        showAlert(t('common.success'), t('flex.alert_created'), 'success');
      }
      fetchItems();
    } catch (e: any) {
      console.error(e);
      showAlert(t('flex.alert_save_failed'), e.message || '', 'error');
      throw e;
    }
  };

  // ==== [FEAT-20260802-FLEXTAG] คัดลอก tag ของการ์ด
  // ⚠️ คัดลอกออกไปเป็น [[[flex_m00001]]] (สามชั้น) ไม่ใช่ค่าดิบ — ตรงกับรูปแบบ
  //    tag อื่นของระบบ ([[[customer-helper]]] / [[[flex_profile]]])
  //    ต่างจาก dynamic tag ที่เป็นสองชั้น [[..]] — คนละระบบกัน อย่าเอามาปนกัน
  // ⚠️ clipboard ใช้ไม่ได้บน http (ไม่ใช่ secure context) → กัน throw ไว้
  //    ไม่งั้นทั้งหน้าค้างเพราะแค่กดปุ่มคัดลอก
  // revert: ลบ state toast + ฟังก์ชันนี้ + column ในตาราง (marker เดียวกัน)
  const handleCopyFlexTag = (tag: string) => {
    /* [FEAT-20260831-MENUMAINTAG] a MARKER is copied wrapped; a SLUG is copied raw.
       The menu tab used to send its slug through the wrapper, so the clipboard
       received `[[[menu-q6-main]]]` — the shape of a system marker, resolved by
       nothing. Deciding on the VALUE rather than on the tab means the rule cannot
       drift when a tab is added. */
    const wrapped = isFlexMarkerValue(tag) ? flexMarker(tag) : tag;
    /* [FIX-20260830-COPYHTTP2] the optional chain swallowed an API that does not
       exist on http, and the toast fired regardless — see utils/copyText. */
    void copyText(wrapped).then((ok) => {
      if (!ok) return;
      setTagToast(wrapped);
      setTimeout(() => setTagToast(null), 3000);
    });
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await flexMessageService.deleteFlexMessage(deleteId);
      showAlert(t('common.success'), t('flex.alert_deleted'), 'success');
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
      {/* [FEAT-20260802-FLEXTAG] toast ยืนยันการคัดลอก — รูปแบบเดียวกับหน้า dynamic tag */}
      {tagToast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[70] bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-6 duration-300 border border-emerald-400/30 backdrop-blur-md">
          <div className="bg-white/20 p-2 rounded-lg">
            <Check size={20} className="text-white" />
          </div>
          <div className="flex flex-col min-w-[200px]">
            <span className="text-sm font-black tracking-tight">{t('pageui.content.flex_tag_copied', 'คัดลอก Flex Tag แล้ว')}</span>
            <p className="text-[10px] font-mono opacity-90 truncate max-w-[250px] mt-0.5">{tagToast}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900">{t('flex.title')}</h2>
            {/* [FEAT-20260802-FLEXTYPEINFO] ปุ่ม ? เด่น + animate → เปิด modal อธิบายประเภท */}
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              title={t('pageui.content.flex_type_help_title', 'ประเภทของ Flex คืออะไร?')}
              aria-label={t('pageui.content.flex_type_help_aria', 'อธิบายประเภทของ Flex')}
              className="relative shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-emerald-600 text-white flex items-center justify-center shadow-lg shadow-primary-500/40 hover:scale-110 active:scale-95 transition-transform"
            >
              <span className="absolute inset-0 rounded-full bg-primary-400/60 animate-ping" />
              <HelpCircle size={20} className="relative" />
            </button>
          </div>
          <p className="text-sm text-slate-500">{t('flex.subtitle')}</p>

          {/* [FEAT-20260829-FLEXMENUTYPE] แท็บ Normal / Flex Menu
              · Normal = หน้าเดิมทุกประการ (ทุกประเภทที่ไม่ใช่ menu)
              · Flex Menu = การ์ดของระบบเมนูเท่านั้น
              เซิร์ฟเวอร์เป็นคนตัดสินว่า "ไม่ใช่ menu" แปลว่าอะไร — หน้าจอแค่บอกชื่อแท็บ
              revert: ลบบล็อกนี้ + state `tab` + การส่ง `tab` ใน fetchItems */}
          <div className="mt-3 inline-flex rounded-lg border border-dark-600 bg-dark-800 p-1 gap-1">
            {([
              { key: 'normal' as const, label: t('pageui.content.flex_tab_normal', 'ทั่วไป (Normal)') },
              { key: 'menu' as const, label: t('pageui.content.flex_tab_menu', 'เมนู (Flex Menu)') },
            ]).map(x => (
              <button
                key={x.key}
                type="button"
                onClick={() => { setTab(x.key); setTypeFilter(''); setCurrentPage(1); setCardCount(CAROUSEL_STEP); }}
                aria-pressed={tab === x.key}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === x.key
                    ? 'bg-primary-500 text-white'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSearch} className="flex flex-col lg:flex-row gap-3 w-full xl:w-auto">
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
            {/* [FEAT-20260829-FLEXGROUPSEARCH] typeable, because a raw <select>
                stops being usable once the list is long — this deployment has
                dozens of `bulk20-group-*` entries and picking one meant scrolling
                blindly. `SearchableSelect` is the component the rest of the
                dashboard already uses (member pickers, broadcast form), so this
                is a swap to the existing pattern, not a new widget.
                revert: restore the plain <select> above it. */}
            <div className="w-full sm:w-48">
              <SearchableSelect
                value={groupFilter}
                onChange={(v) => {
                  setGroupFilter(v);
                  setCurrentPage(1); setCardCount(CAROUSEL_STEP);
                }}
                options={groups.map((g) => ({ value: g._id, label: g.group_name }))}
                placeholder={t('flex.form_group_placeholder')}
                clearable
              />
            </div>

            {/* [FEAT-20260802-FLEXTYPEFILTER] กรองตามประเภทของ flex
                [FEAT-20260829-FLEXMENUTYPE] ซ่อนบนแท็บ Flex Menu — ประเภทถูกตรึงไว้แล้ว
                การโชว์ตัวกรองที่เลือกอะไรก็ไม่เปลี่ยนผลคือหลอกคนใช้ */}
            {tab === 'normal' && (
            <div className="relative w-full sm:w-56">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Filter className="text-slate-400" size={16} />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); setCardCount(CAROUSEL_STEP); }}
                className="pl-9 pr-4 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none cursor-pointer"
              >
                <option value="">{t('pageui.content.flex_all_types', 'ทุกประเภท')}</option>
                {/* [FEAT-20260802-FLEXTYPEHIDE] filter โชว์แค่ 4 ประเภท (ซ่อน normal/template_message ไว้ก่อน) */}
                {VISIBLE_FLEX_TYPES.map(ftx => (
                  <option key={ftx.value} value={ftx.value}>{ftx.label}</option>
                ))}
              </select>
            </div>
            )}

            <div className="relative group w-full sm:w-72">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
              </div>
              <input
                type="text"
                placeholder={t('pageui.content.flex_search_ph', 'ค้นหาด้วยชื่อ หรือ flex tag...')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex gap-2 w-full sm:w-auto">
            <button
              type="submit"
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw size={18} />
              {t('common.refresh')}
            </button>
            {/* [FEAT-20260829-FLEXMENUTYPE] โชว์เฉพาะปุ่มของแท็บที่เปิดอยู่
                สองปุ่มพร้อมกันทำให้ต้องอ่านก่อนกด และกดผิดได้ง่าย — แท็บบอกอยู่แล้ว
                ว่ากำลังทำงานกับการ์ดชนิดไหน ปุ่มจึงควรมีความหมายเดียว */}
            {tab === 'normal' && (
            <button
              type="button"
              onClick={() => openCreate()}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-primary-500/20 transition-all hover:scale-105 whitespace-nowrap"
            >
              <Plus size={18} />
              {t('common.add_new')}
            </button>
            )}
            {/* [FEAT-20260829-FLEXMENUTYPE] ปุ่มที่สองสำหรับการ์ดเมนูโดยเฉพาะ
                หน้าตาเหมือนปุ่มเดิม ต่างที่ล็อกประเภทให้เลย เลือกไม่ได้
                ปุ่มแรกก็จะไม่มี "เมนู" ให้เลือกในลิสต์ประเภท — คนละทางเข้า ไม่ปนกัน */}
            {tab === 'menu' && (
            <button
              type="button"
              onClick={() => openCreate('menu')}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-primary-500/20 transition-all hover:scale-105 whitespace-nowrap"
            >
              <Plus size={18} />
              {t('pageui.content.flex_add_menu', 'เพิ่มเมนู')}
            </button>
            )}
          </div>
        </form>
      </div>

      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden relative">
        {/* [FEAT-20260830-FLEXBULKGROUPS] bulk mode lives above the table: the
            strip replaces nothing, so leaving it closes the feature entirely. */}
        {!viewMode.isCarousel && selection.active ? (
          <FlexBulkBar
            count={selection.ids.length}
            onSelectPage={() => selection.selectMany(items.map((x) => x.id))}
            onClear={selection.clear}
            onOpen={() => { setBulkGroups([]); setBulkOpen(true); }}
            onExit={selection.exit}
          />
        ) : (
          /* [UI-20260907-FLEXTOOLBARSPLIT] The two toolbar buttons sit on
             OPPOSITE SIDES: แก้สิทธิหลายใบ on the left, ปรับการแสดงผล on the right.
             🔴 THIS SUPERSEDES THE 31/08 ORDER. `[FEAT-20260831-FLEXCAROUSEL]`
                put the toggle immediately BEFORE the bulk button because the
                owner asked for it to "show first" while both sat in one
                right-hand cluster. On 07/09 they asked for them split to either
                end, so adjacency is gone and with it the reason for that order.
                The test that pinned it (`test/flexCarousel.dom.test.tsx`) was
                rewritten to the new arrangement rather than worked around.
             ⚠️ TWO SLOTS, NOT `justify-between` ON THE BUTTONS THEMSELVES. The
                bulk button only renders in table mode; with the buttons as
                direct children, carousel mode would leave ONE child and
                `justify-between` would park ปรับการแสดงผล on the LEFT. The empty
                left slot is what keeps the right-hand button on the right.
             revert: collapse back to one `flex justify-end gap-2` row with the
             toggle first, and restore the old ordering case in that spec. */
          <div className="flex items-center justify-between gap-2 border-b border-dark-700 px-6 py-2">
            {/* LEFT — stays mounted even when empty; see the note above. */}
            <div className="flex items-center gap-2">
              {/* [FEAT-20260831-FLEXCAROUSEL] แก้สิทธิหลายใบมีเฉพาะโหมดตาราง — เจ้าของสั่ง 31/08
                  เพราะการเลือกหลายใบใช้ checkbox ในแถว ซึ่งโหมดการ์ดไม่มี */}
              {!viewMode.isCarousel && (
                <button
                  type="button"
                  data-testid="flex-bulk-enter"
                  onClick={selection.enter}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  <Layers size={14} /> {t('flex.bulk_enter')}
                </button>
              )}
            </div>

            {/* RIGHT — the display toggle, unchanged apart from where it sits. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="flex-view-toggle"
                onClick={viewMode.toggle}
                aria-pressed={viewMode.isCarousel}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                  viewMode.isCarousel
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {viewMode.isCarousel ? <Table2 size={14} /> : <LayoutGrid size={14} />}
                {t('flex.view_toggle')}
              </button>
            </div>
          </div>
        )}
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
        )}
        {/* [FEAT-20260831-FLEXCAROUSEL] โหมด carousel แทนที่ **เฉพาะตาราง**
            pagination อยู่นอกก้อนนี้ ⇒ ยังกดเปลี่ยนหน้าได้จริงทั้งสองโหมด
            (เจ้าของสั่ง: "มี pagination บอกด้วย กดได้จริง")
            ⚠️ ส่งของชุดเดียวกับที่ตารางใช้ (`items`) ไม่ยิง request เพิ่มแม้แต่ครั้งเดียว */}
        {viewMode.isCarousel ? (
          <FlexCardCarousel
            items={items.map((x) => ({
              id: x.id,
              name: x.name,
              /* [FEAT-20260831-MENUMAINTAG] the minted tag on every tab; the slug is
                 only a fallback for a menu card that has none yet. Before this the
                 menu tab handed the carousel a slug, which it printed raw and copied
                 wrapped — two views disagreeing about one card. */
              /* [FEAT-20260831-MENUMAINTAG] same rule as the table: a MAIN menu card
                 carries its minted tag, a SUB one shows the slug its parent's postback
                 points at. Any other type is unchanged — it has no sub-type. */
              tag:
                (tab === 'menu'
                  ? x.flex_sub_type === 'main'
                    ? x.flex_tag || x.flex_slug
                    : x.flex_slug
                  : x.flex_tag) || undefined,
              content_json: x.content_json,
            }))}
            onEdit={(id) => {
              const found = items.find((x) => x.id === id);
              if (found) openEdit(found);
            }}
            onCopyTag={handleCopyFlexTag}
            onCloneCard={(id) => {
              /* [FEAT-20260907-CLONETEMPLATEBTN] the SAME `openClone` the table row
                 calls — the two views must not grow two ideas of what cloning is. */
              const found = items.find((x) => x.id === id);
              if (found) openClone(found);
            }}
            hasMore={items.length < totalItems}
            onReachEnd={loadMoreCards}
            emptyText={t('flex.no_results')}
          />
        ) : (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                {/* [FEAT-20260802-FLEXTAG] column แรกสุดตามที่ผู้ใช้สั่ง */}
                {/* [FEAT-20260829-FLEXMENUSLUGCOL] A menu card has no Flex Tag —
                    that column showed "-" on every row, so the menu tab listed
                    cards with nothing to tell them apart. The slug is what
                    identifies a menu card AND what a button's postback points
                    at, so it takes the column on this tab.
                    revert: drop the ternary, keep the Flex Tag header. */}
                {selection.active && (
                  <th className="w-10 px-4 py-4" scope="col">
                    <span className="sr-only">{t('flex.bulk_select_page')}</span>
                  </th>
                )}
                <th className="px-4 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                  {/* [FEAT-20260831-MENUMAINTAG] a menu card now carries a minted
                      FLEX TAG like every other type; the slug is only the fallback
                      for a row made before the tag existed. The header said "Menu
                      Slug" on this tab, which stopped being what the column shows. */}
                  Flex Tag
                </th>
                {/* [FEAT-20260802-FLEXTYPEFILTER] column ประเภท */}
                <th className="px-4 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('pageui.content.flex_col_type', 'ประเภท')}</th>
                <th className="px-4 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('flex.header_name')}</th>
                <th className="px-4 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('flex.header_created_at')}</th>
                <th className="px-4 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right whitespace-nowrap">{t('flex.header_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-6 py-12 text-center text-slate-500">
                    {t('flex.no_results')}
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  /* [FEAT-20260830-FLEXROWPREVIEW] a Fragment, because the row can
                     now be followed by its own preview row. The key moves here:
                     the two <tr>s are siblings in <tbody>, so React needs the key
                     on the wrapper, not on the first row. */
                  <React.Fragment key={item.id}>
                  {/* [FEAT-20260831-FLEXROWPICK] ตอนเลือกหลายใบ คลิกที่ **แถว** มีค่าเท่ากับ
                      ติ๊ก checkbox — เจ้าของสั่ง 31/08 · นอกโหมดเลือก แถวไม่มี onClick
                      จึงไม่กระทบการใช้งานปกติแม้แต่นิดเดียว
                      ⚠️ ปุ่มต่าง ๆ ในคอลัมน์จัดการเรียก stopPropagation ไม่ได้ทุกตัว
                         จึงกันด้วยการเช็ค target ว่าเป็น interactive element หรือไม่ */}
                  <tr
                    className={`transition-colors hover:bg-dark-700/50 ${selection.active ? 'cursor-pointer' : ''}`}
                    onClick={selection.active ? (e) => {
                      const el = e.target as HTMLElement;
                      if (el.closest('button, a, input, select, textarea')) return;
                      selection.toggle(item.id);
                    } : undefined}
                  >
                    {selection.active && (
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selection.isSelected(item.id)}
                          onChange={() => selection.toggle(item.id)}
                          aria-label={item.name}
                          className="accent-primary-500"
                        />
                      </td>
                    )}
                    {/* [FEAT-20260802-FLEXTAG] มีเฉพาะการ์ดประเภทโปรไฟล์ · ที่เหลือขีด "-" */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      {/* [FEAT-20260831-MENUMAINTAG] on the MENU tab the first column
                          shows the tag for a MAIN card and the SLUG for a sub one.
                          เจ้าของ 31/08: "sub = slug แถวแรก ถ้า main = tag ถูกแล้ว".
                          A sub card is never summoned by a marker — its parent opens it
                          with a postback — so showing a tag there would advertise a
                          route that does not exist. The number is still minted and kept
                          on the row; it is simply not offered. */}
                      {tab === 'menu' &&
                      !(item.flex_sub_type === 'main' && item.flex_tag) ? (
                        /* [FEAT-20260831-MENUMAINTAG] the slug is the FALLBACK now —
                           shown only while a menu card has no minted tag yet (rows made
                           before the tag existed). Displayed and copied RAW because it
                           is a payload fragment, not a marker. */
                        item.flex_slug ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 font-mono">{item.flex_slug}</span>
                            {/* the fallback value is a SLUG, not a marker — copied raw */}
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                              {t('flex.kind_slug')}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyFlexTag(item.flex_slug as string)}
                              className="p-1.5 rounded bg-white border border-slate-200 shadow-sm transition-all flex items-center gap-1.5 text-[10px] font-bold text-primary-600 hover:bg-primary-50 whitespace-nowrap"
                              title={t('pageui.content.copy_menu_slug', 'คัดลอก Menu Slug')}
                            >
                              <Copy size={12} /> Copy
                            </button>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">-</span>
                        )
                      ) : item.flex_tag ? (
                        <div className="flex items-center gap-2">
                          <TagIcon size={16} className="text-primary-500" />
                          <span className="text-sm font-bold text-slate-900 font-mono">{flexMarker(item.flex_tag)}</span>
                          {/* [FEAT-20260831-MENUMAINTAG] name the KIND: the column holds
                              two different things — a MARKER you paste into a prompt and
                              a SLUG that goes inside a postback payload — and an operator
                              had to infer which from its shape. */}
                          <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-600">
                            {t('flex.kind_tag')}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyFlexTag(item.flex_tag as string)}
                            className="p-1.5 rounded bg-white border border-slate-200 shadow-sm transition-all flex items-center gap-1.5 text-[10px] font-bold text-primary-600 hover:bg-primary-50 whitespace-nowrap"
                            title={t('pageui.content.copy_flex_tag', 'คัดลอก Flex Tag')}
                          >
                            <Copy size={12} /> Copy
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">-</span>
                      )}
                    </td>
                    {/* [FEAT-20260802-FLEXTYPEFILTER] ป้ายประเภท */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full bg-primary-50 text-primary-700 border border-primary-100 px-2.5 py-1 text-xs font-semibold">
                        {flexTypeLabel(item.flex_type)}
                      </span>
                      {/* [FEAT-20260831-MENUMAINTAG] เจ้าของ 31/08: "ประเภทให้บอกด้วย sub
                          หรือ main". Every menu row read "เมนู (menu)" whether it was the
                          card a customer lands on or one of its children — and the two
                          are reached differently (a marker vs a postback), so the
                          difference matters at a glance.
                          Rendered from the row's own value ⇒ a type that never sets a
                          sub-type cannot grow a chip. */}
                      {item.flex_sub_type && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-slate-100 text-slate-600 border border-slate-200 px-2 py-1 text-[10px] font-bold uppercase tracking-wide">
                          {item.flex_sub_type}
                        </span>
                      )}
                    </td>
                    {/* [FIX-20260802-FLEXROW] ชื่อยาว ๆ ดันปุ่ม action ตกขอบจอ
                        → ตัดด้วย ... แล้วให้ hover ดูเต็ม (title) */}
                    <td className="px-4 py-4">
                      <span
                        className="block max-w-[240px] truncate text-sm font-bold text-slate-900 uppercase tracking-tight"
                        title={item.name}
                      >
                        {item.name}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-500 whitespace-nowrap">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* [FIX-20260802-FLEXROW] เหลือแค่ไอคอนสามเหลี่ยม — ข้อความกินที่จนปุ่มอื่นตกขอบ */}
                        <button
                          onClick={() => setPreviewJson(item.content_json)}
                          className="p-1.5 rounded-lg bg-pink-50 text-pink-600 hover:bg-pink-100 transition-all border border-pink-100"
                          title="Preview"
                        >
                          <Play size={16} />
                        </button>
                        {/* [FEAT-20260907-CLONETEMPLATEBTN] was a bare ⧉ icon; the owner
                            asked for the label to show. Same component the carousel
                            uses — one behaviour, one place to change it. The `md` scale
                            keeps this row's 16px icon geometry. */}
                        <FlexCloneTemplateButton size="md" onClick={() => openClone(item)} />
                        <button
                          onClick={() => openEdit(item)}
                          className="p-1.5 rounded-lg hover:bg-primary-500/20 text-slate-500 hover:text-primary-500 transition-colors"
                          title={t('common.edit')}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteId(item.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-500 transition-colors"
                          title={t('common.delete')}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* [FEAT-20260831-FLEXLOADMORE] ท้ายลิสต์ — จำนวนรวมอยู่ **ตำแหน่งเดิมเสมอ**
            ทั้งสองโหมด (ซ้ายสุด) ตามที่เจ้าของสั่ง · ต่างกันแค่ตัวควบคุมด้านขวา
              โหมดตาราง  → หน้า + จำนวนต่อหน้า
              โหมดการ์ด  → ปุ่มโหลดเพิ่ม (ไม่มี pagination ไม่มี per-page) */}
        <div className="flex flex-wrap justify-between items-center gap-3 px-6 py-4 border-t border-dark-700">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {t('common.showing_total', { count: totalItems })}
            </span>
            {!viewMode.isCarousel && (
              /* [FEAT-20260831-FLEXPERPAGE] ตัวเลือกจำนวนต่อหน้าที่เจ้าของแจ้งว่าหายไป
                 — มีเฉพาะโหมดตาราง เพราะโหมดการ์ดโหลดต่อเนื่องแทน
                 ⚠️ เปลี่ยนแล้วเด้งกลับหน้า 1 เสมอ ไม่งั้นค้างอยู่หน้าที่ไม่มีอยู่จริง */
              <label className="flex items-center gap-1.5 text-sm text-slate-500">
                <span>{t('common.per_page')}</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                  className="rounded-lg border border-dark-700 bg-dark-800 px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {viewMode.isCarousel ? (
            /* [FEAT-20260831-FLEXINFINITE] ไม่มีปุ่มโหลดเพิ่ม — เลื่อนสุดแล้วโหลดเอง
               (เจ้าของสั่ง: "load more auto เวลา scroll สุด ไม่ใช่ปุ่ม ไม่เอาปุ่ม")
               เหลือแค่ตัวบอกว่าโหลดมาแล้วเท่าไหร่จากทั้งหมด */
            <span className="text-sm text-slate-500">
              {loading ? t('common.loading') : `${items.length} / ${totalItems}`}
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm text-slate-600">{currentPage} / {totalPages}</span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* [FEAT-20260802-FLEXTYPEINFO] modal อธิบายประเภท flex — 4 ประเภท เน้นกึ่งปรับแต่ง */}
      {infoOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-[fadeIn_0.15s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-primary-600 to-emerald-600 text-white">
              <div className="flex items-center gap-2">
                <HelpCircle size={20} />
                <h3 className="text-base font-bold">{t('pageui.content.flex_type_modal_title', 'ประเภทของ Flex Message')}</h3>
              </div>
              <button type="button" onClick={() => setInfoOpen(false)} className="p-1 rounded-lg hover:bg-white/20 transition-colors" aria-label={t('common.close', 'ปิด')}>
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {FLEX_TYPE_INFO.map((it) => (
                <div
                  key={it.label}
                  className={`rounded-xl border p-3.5 ${it.highlight
                    ? 'border-orange-400 bg-orange-50 ring-2 ring-orange-300/60 shadow-md'
                    : 'border-slate-200 bg-slate-50'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-bold ${it.highlight ? 'text-orange-700' : 'text-slate-800'}`}>{t(`pageui.content.flex_info_${it.id}_label`, it.label)}</span>
                    {/* [FEAT-20260802-FLEXTYPEINFO] ไฮไลต์ = ส้ม + ! เตือน (ไม่มีคำว่า "เด่น") */}
                    {it.highlight && (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500 text-white shrink-0" title={t('pageui.content.important', 'สำคัญ')}>
                        <AlertCircle size={13} />
                      </span>
                    )}
                  </div>
                  <p className={`text-xs leading-relaxed ${it.highlight ? 'text-orange-800' : 'text-slate-500'}`}>{t(`pageui.content.flex_info_${it.id}_body`, it.body)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <FlexBulkGroupsModal
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        names={items.filter(x => selection.isSelected(x.id)).map(x => x.name)}
        groups={groups.map(g => ({ value: g._id, label: g.group_name }))}
        value={bulkGroups}
        onChange={setBulkGroups}
        onConfirm={handleBulkGroups}
        saving={bulkSaving}
      />

      <FlexPreviewModal
        isOpen={previewJson !== null}
        onClose={() => setPreviewJson(null)}
        flexJson={previewJson}
      />

      <FlexMessageFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditing(undefined);
          setIsView(false);
          setIsClone(false);
          setLockedType(undefined);
        }}
        lockedFlexType={lockedType}
        onSubmit={submitForm}
        initialData={editing}
        mode={isView ? 'view' : (isClone ? 'create' : (editing ? 'update' : 'create'))}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        title={t('flex.delete_title')}
        message={t('flex.delete_message')}
        onConfirm={confirmDelete}
        onClose={() => setDeleteId(null)}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
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

export default FlexMessageList;
