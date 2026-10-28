import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// [FEAT-20260729-BULKUI] CheckSquare/AlertTriangle for the bulk toolbar + warnings
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Trash2, Edit2, Info, Copy, CheckSquare, AlertTriangle, X } from 'lucide-react';
import { userService } from '../../services/admin';
import { useUsersPageQuery } from '../../services/admin/queries';
import { BulkCloneUserRow, UserEntry, UserFormData } from '../../types';
import { UserFormModal } from '../../components/admin';
import { BulkCloneUsersModal } from '../../components/bulk';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';
import { getStoredAuth } from '../../services/authStorage';
// [FEAT-20260729-BULKUI] separate dialog — see the header comment in that file
import { BulkPermissionsModal } from '../../components/bulk';
// [FEAT-20260729-BULKSTATUS] separate dialog — see the file header for why
import { BulkStatusModal } from '../../components/bulk';

export const Users: React.FC = () => {
  const { t } = useI18n();
  const roleName = getStoredAuth()?.role?.name;
  const canManagePermissions = roleName === 'superadmin' || roleName === 'admin';
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  // [FEAT-20260729-USERLIST] was a fixed 25 — now selectable, same as the other
  // list pages. Changing it resets to page 1 (see the effect below), otherwise
  // you can be left on page 4 of a 2-page result and see nothing.
  const [itemsPerPage, setItemsPerPage] = useState(25);
  // [FEAT-20260729-USERLIST] filter by sector group. '' means every group, which
  // is the default so the page opens showing everything as before.
  const [groupFilter, setGroupFilter] = useState('');

  // ==== [FEAT-20260729-BULKUI] START — select rows, edit their permissions together
  // 🔒 AUTO track — to_dev_auto branch only
  //
  // Everything here is additive: no existing state, handler or column was
  // changed. Removing this block and the three JSX sections marked with the
  // same tag takes the feature out completely.
  //
  // The rules mirror the BE (see [FEAT-20260729-BULKPERM] in userController.js).
  // They are repeated here so a row that cannot be edited is visibly
  // unselectable, rather than letting someone tick twenty names and discover on
  // submit that four of them were refused.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPerms, setBulkPerms] = useState<string[]>([]);
  const [bulkConfirm, setBulkConfirm] = useState(false);   // second confirmation
  const [bulkSaving, setBulkSaving] = useState(false);
  // [FEAT-20260729-BULKSTATUS] dialog picks the target state, then confirms it.
  // choice: null = nothing picked yet · true = enable · false = disable
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusChoice, setBulkStatusChoice] = useState<boolean | null>(null);
  const [bulkStatusConfirm, setBulkStatusConfirm] = useState(false);
  const [bulkStatusSaving, setBulkStatusSaving] = useState(false);
  const [bulkBlockedNotice, setBulkBlockedNotice] = useState<string[]>([]);

  const myPermissions = useMemo(() => getStoredAuth()?.permissions || [], []);
  const isSuper = roleName === 'superadmin' || roleName === 'superuser';

  const ROLE_RANK: Record<string, number> = { superadmin: 3, admin: 2, assist_admin: 1.5, operator: 1 };
  const myRank = ROLE_RANK[roleName || ''] || 0;

  // A superadmin is bounded by nothing, so their dialog offers the full set.
  // Kept in sync with the sections in BulkPermissionsModal.
  const ALL_PERMISSIONS = [
    'group.manage', 'hook.manage', 'slip.manage', 'flex.manage', 'dynamic_tags.manage',
    'ticket.manage', 'insight.manage', 'assign_history.manage',
    // [FIX-20260731-CONTACTPERM] ขาดไปตั้งแต่แรก — ทำให้แก้สิทธิ์แบบหลายคนพร้อมกัน
    // (bulk) แจก "รายชื่อ (Contacts)" ไม่ได้เลย ทั้งที่ BulkPermissionsModal
    // มีช่องรออยู่แล้วในหมวด support · revert: ลบบรรทัดนี้
    'contact.manage',
    'object.manage',
    'user.manage', 'webhook_log.manage', 'audit.manage', 'config.manage', 'role.manage',
    'custom_tools.manage',
  ];

  /**
   * Why a given row cannot be bulk-edited, or null when it can.
   * A superadmin is never blocked. For everyone else a target is off limits
   * when it outranks them, or when it already holds a permission they lack —
   * editing it would strip that access without the caller ever seeing it.
   */
  const bulkBlockReason = useCallback((user: UserEntry): string | null => {
    if (isSuper) return null;
    const targetRank = ROLE_RANK[user.role?.name || ''] || 0;
    if (targetRank > myRank) return t('user.bulk_blocked_rank');
    const own = new Set(myPermissions);
    const exceeds = (user.permissions || []).filter((p: string) => !own.has(p));
    if (exceeds.length > 0) return t('user.bulk_blocked_perms', { perms: exceeds.join(', ') });
    return null;
  }, [isSuper, myRank, myPermissions, t]);
  // ==== [FEAT-20260729-BULKUI] END

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserEntry | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [cloneSource, setCloneSource] = useState<UserEntry | undefined>(undefined);
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
  const [groupsInfo, setGroupsInfo] = useState<{ isOpen: boolean; title: string; items: string[] }>({
    isOpen: false,
    title: '',
    items: []
  });
  const isModalOpen = isFormOpen || !!deleteId || alertState.isOpen || groupsInfo.isOpen;

  // ==== [FEAT-20260729-SAVETOAST] START — 🔒 สาย AUTO (to_dev_auto เท่านั้น)
  // เดิม save user แล้วขึ้นแค่ AlertModal ที่ต้องกดปิดเอง — ผู้ใช้ขอ toast
  // บอกผลทั้ง success และ failed. A toast reports the outcome without
  // stealing focus; the modal stays for the cases that carry a real message
  // (โหลดล้มเหลว / bulk / ลบ) ไม่ได้ถอดของเดิมออก
  // revert: grep FEAT-20260729-SAVETOAST ลบ state + showToast + <div> ท้ายไฟล์
  //         แล้วเปลี่ยน showAlert 4 จุดใน submitForm กลับเป็นแบบเดิม
  const [saveToast, setSaveToast] = useState<{ id: number; text: string; type: 'success' | 'error' } | null>(null);
  const saveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (text: string, type: 'success' | 'error') => {
    if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
    setSaveToast({ id: Date.now(), text, type });
    saveToastTimer.current = setTimeout(() => setSaveToast(null), type === 'error' ? 6000 : 3500);
  };
  useEffect(() => () => { if (saveToastTimer.current) clearTimeout(saveToastTimer.current); }, []);
  // ==== [FEAT-20260729-SAVETOAST] END

  const showAlert = (title: string, message: string, type: 'success' | 'error') => {
    setAlertState({ isOpen: true, title, message, type });
  };

  const closeAlert = () => setAlertState(prev => ({ ...prev, isOpen: false }));
  const closeGroupsInfo = () => setGroupsInfo({ isOpen: false, title: '', items: [] });

  /* ==== [FEAT-20261027-TANSTACK] list + 20s visible-tab poll — the shared contract ====
   * services/query/usePageQuery.ts (`poll`, `onFailure: clear`) owns what this screen hand-wrote here
   * ([FIX-20260809-POLLVIS]): poll only while the tab is visible, read again the moment
   * it shows, both paused while a modal is open, loading on every read, rows cleared on
   * a failed read. Pinned by test/requests/adminPollers.requests.test.tsx.
   * revert: restore this file from tag ckpt-after-tanstack-p1-demo-27102026. */
  const usersQuery = useUsersPageQuery(
    { page: currentPage, limit: itemsPerPage },
    { paused: isModalOpen, onError: (e: any) => { console.error(e); showAlert(t('user.alert_load_failed_title'), e.message || t('user.alert_load_failed_message'), 'error'); } },
  );
  const users: UserEntry[] = usersQuery.page?.data || [];
  const totalItems = usersQuery.page?.pagination?.total || 0;
  const totalPages = usersQuery.page?.pagination?.total_pages || 1;
  const [actionLoading, setActionLoading] = useState(false);   // the screen's own actions (save / delete / toggle)
  const loading = usersQuery.loading || actionLoading;
  const { refetch: refetchList } = usersQuery;
  const fetchUsers = useCallback(async () => { await refetchList(); }, [refetchList]);

  useEffect(() => {
    setCurrentPage(1);
    // [FEAT-20260729-USERLIST] page size and group filter reset the page too —
    // otherwise a narrower result can leave you stranded on an empty page.
  }, [search, itemsPerPage, groupFilter]);

  // [FEAT-20260729-USERLIST] every group present on the loaded users, for the
  // filter dropdown. Derived from the rows rather than fetched separately so it
  // can never offer a group that has nobody in it.
  const groupOptions = useMemo(() => {
    const seen = new Map<string, string>();
    users.forEach(u => (u.groups || []).forEach((g: any) => {
      const id = String(g?._id || g?.id || g?.group_name || '');
      const name = g?.group_name || id;
      if (id && !seen.has(id)) seen.set(id, name);
    }));
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  const filteredUsers = useMemo(() => {
    let list = users;

    // [FEAT-20260729-USERLIST] '' = every group, which is the default.
    if (groupFilter) {
      list = list.filter(u => (u.groups || []).some((g: any) =>
        String(g?._id || g?.id || g?.group_name || '') === groupFilter));
    }

    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(user =>
      user.username.toLowerCase().includes(q) ||
      (user.display_name || '').toLowerCase().includes(q) ||
      (user.role?.name || user.role_id || '').toLowerCase().includes(q)
    );
  }, [users, search, groupFilter]);

  // ==== [FEAT-20260729-BULKUI] handlers
  /** Rows that can actually be edited, given who is logged in. */
  const bulkSelectable = useMemo(
    () => filteredUsers.filter(u => bulkBlockReason(u) === null),
    [filteredUsers, bulkBlockReason]
  );

  const toggleBulkRow = (user: UserEntry) => {
    if (bulkBlockReason(user)) return;   // guarded again — never trust the disabled attribute alone
    setBulkSelected(prev =>
      prev.includes(user.id) ? prev.filter(id => id !== user.id) : [...prev, user.id]
    );
  };

  /**
   * Select-all only takes the rows that are allowed, and names the ones it had
   * to skip. Silently selecting fewer than asked would look like a bug.
   */
  const toggleBulkAll = () => {
    if (bulkSelected.length === bulkSelectable.length && bulkSelectable.length > 0) {
      setBulkSelected([]);
      setBulkBlockedNotice([]);
      return;
    }
    setBulkSelected(bulkSelectable.map(u => u.id));
    const skipped = filteredUsers
      .filter(u => bulkBlockReason(u) !== null)
      .map(u => `${u.username} — ${bulkBlockReason(u)}`);
    setBulkBlockedNotice(skipped);
  };

  const exitBulk = () => {
    setBulkMode(false);
    setBulkSelected([]);
    setBulkBlockedNotice([]);
    setBulkOpen(false);
    setBulkConfirm(false);
  };

  /** Seeds the checkboxes from the first selected user, so the common case —
   *  "make these people match this one" — starts from something real. */
  const openBulkEdit = () => {
    const first = filteredUsers.find(u => u.id === bulkSelected[0]);
    setBulkPerms(first?.permissions ? [...first.permissions] : []);
    setBulkConfirm(false);
    setBulkOpen(true);
  };

  const submitBulk = async () => {
    setBulkSaving(true);
    try {
      const res = await userService.bulkUpdatePermissions(bulkSelected, bulkPerms);
      showAlert(
        t('user.bulk_done_title'),
        t('user.bulk_done_message', { count: String(res.modified ?? bulkSelected.length) }),
        'success'
      );
      exitBulk();
      await fetchUsers();
    } catch (e: any) {
      // The API names the users it refused; surface those names rather than a
      // generic failure the operator cannot act on.
      const blocked = Array.isArray(e?.blocked)
        ? e.blocked.map((b: any) => `${b.username} — ${b.reason}`).join('\n')
        : '';
      showAlert(t('user.bulk_failed_title'), blocked || e?.message || t('user.bulk_failed_message'), 'error');
    } finally {
      setBulkSaving(false);
      setBulkConfirm(false);
    }
  };
  // ==== [FEAT-20260729-BULKUI] END handlers

  // ==== [FEAT-20260729-BULKSTATUS] START — enable/disable the selected users
  // Reuses the SAME selection the permission button uses, and the same
  // bulkBlockReason guard, so a row you cannot edit is a row you cannot disable.
  //
  // Disabling logs the person out on their next request (the API middleware
  // re-reads `active` every time), so the confirm text says so plainly — this is
  // not a change that waits for their token to expire.
  // revert: delete this block, the two buttons, and bulkStatusConfirm state.
  const openBulkStatus = () => {
    if (bulkSelected.length === 0) return;
    setBulkStatusChoice(null);   // no preselection — the operator must pick
    setBulkStatusConfirm(false); // step 1 of 2: choose, then confirm
    setBulkStatusOpen(true);
  };

  const submitBulkStatus = async () => {
    if (bulkStatusChoice === null) return;
    const nextActive = bulkStatusChoice;
    setBulkStatusSaving(true);
    try {
      const res = await userService.bulkUpdateActive(bulkSelected, nextActive);
      showAlert(
        t('user.bulk_status_done_title'),
        t('user.bulk_status_done_message', {
          count: String(res.modified ?? bulkSelected.length),
          state: nextActive ? t('user.status_active') : t('user.status_inactive'),
        }),
        'success'
      );
      exitBulk();
      await fetchUsers();
    } catch (e: any) {
      const blocked = Array.isArray(e?.blocked)
        ? e.blocked.map((b: any) => `${b.username} — ${b.reason}`).join('\n')
        : '';
      showAlert(t('user.bulk_status_failed_title'), blocked || e?.message || '', 'error');
    } finally {
      setBulkStatusSaving(false);
      setBulkStatusConfirm(false);
      setBulkStatusOpen(false);
    }
  };
  // ==== [FEAT-20260729-BULKSTATUS] END handlers

  const openCreate = () => {
    setEditing(undefined);
    setIsFormOpen(true);
  };

  const openEdit = async (entry: UserEntry) => {
    setActionLoading(true);
    try {
      const res = await userService.getUser(entry.id);
      setEditing(res.data);
      setIsFormOpen(true);
    } catch (e: any) {
      console.error(e);
      showAlert(t('user.alert_load_failed_title'), e.message || t('user.alert_load_failed_message'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Fetch the full record before cloning: the list projection omits
  // permissions, and the modal shows the caller exactly what will be inherited.
  const openClone = async (entry: UserEntry) => {
    setActionLoading(true);
    try {
      const res = await userService.getUser(entry.id);
      setCloneSource(res.data);
    } catch (e: any) {
      console.error(e);
      showAlert(t('user.alert_load_failed_title'), e.message || t('user.alert_load_failed_message'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const submitClone = async (rows: BulkCloneUserRow[]) => {
    if (!cloneSource) return;
    // Errors propagate: the modal maps per-row failures back onto their fields
    // and stays open so the entered rows are not lost.
    const result = await userService.bulkCloneUsers(cloneSource.id, rows);
    setCloneSource(undefined);
    await fetchUsers();
    showAlert(
      t('user.bulk_clone_success_title'),
      t('user.bulk_clone_success_message', { count: result.created, username: cloneSource.username }),
      'success'
    );
  };

  const submitForm = async (data: UserFormData) => {
    try {
      if (editing) {
        const payload: Partial<UserFormData> = {
          display_name: data.display_name,
          email: data.email,
          phone: data.phone,
          groups: data.groups,
          active: data.active
        };
        if (data.allowed_hooks !== undefined) {
          payload.allowed_hooks = data.allowed_hooks;
        }
        if (canManagePermissions && data.role_id) {
          payload.role_id = data.role_id;
        }
        if (canManagePermissions) {
          payload.permissions = data.permissions;
        }
        if (data.password) {
          payload.password = data.password;
        }
        await userService.updateUser(editing.id, payload);
        // [FEAT-20260729-SAVETOAST] toast แทน modal ตอนบันทึกสำเร็จ (ไม่ต้องกดปิด)
        showToast(t('user.alert_updated_title'), 'success');
      } else {
        const payload: UserFormData = {
          ...data,
          role_id: canManagePermissions ? data.role_id : undefined,
          permissions: canManagePermissions ? data.permissions : data.permissions,
          allowed_hooks: data.allowed_hooks
        };
        if (!canManagePermissions) {
          delete (payload as any).role_id;
          delete (payload as any).permissions;
        }
        // [FIX-20260811-CREATEUSERACTIVE] CreateUserDto has no `active` field (only
        // UpdateUserDto does — a new user is active by default at the BE). The form's
        // `active` rode in via {...data} and forbidNonWhitelisted rejected the whole
        // create with "property active should not exist". Strip it on create only.
        delete (payload as any).active;
        await userService.createUser(payload);
        // [FEAT-20260729-SAVETOAST]
        showToast(t('user.alert_created_title'), 'success');
      }
      await fetchUsers();
    } catch (e: any) {
      console.error(e);
      // [FEAT-20260729-SAVETOAST] ล้มเหลวก็ต้องบอก — เก็บข้อความจริงจาก BE ไว้
      // (เช่น "permissions exceed your own permissions") ไม่กลืนหาย
      showToast(`${t('user.alert_save_failed_title')}: ${e.message || t('user.alert_save_failed_message')}`, 'error');
      throw e;
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setActionLoading(true);
    try {
      await userService.deleteUser(deleteId);
      showAlert(t('user.alert_deleted_title'), t('user.alert_deleted_message'), 'success');
      await fetchUsers();
    } catch (e: any) {
      console.error(e);
      showAlert(t('user.alert_delete_failed_title'), e.message || t('user.alert_delete_failed_message'), 'error');
    } finally {
      setActionLoading(false);
      setDeleteId(null);
    }
  };

  const StatusBadge = ({ active }: { active?: boolean }) => (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
      active ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-slate-500/10 text-slate-300 border-slate-500/20'
    }`}>
      {active ? t('status.active') : t('status.inactive')}
    </span>
  );

  const openGroupsInfo = (user: UserEntry) => {
    const items = (user.groups || []).map(group => group.group_name);
    setGroupsInfo({
      isOpen: true,
      title: t('user.groups_title', { name: user.display_name || user.username }),
      items
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('user.title')}</h2>
          <p className="text-sm text-slate-500">{t('user.subtitle')}</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-3 w-full xl:w-auto">
          <div className="relative group w-full sm:w-72">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
            </div>
            <input
              type="text"
              placeholder={t('user.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
            />
          </div>

          {/* [FEAT-20260729-USERLIST] group filter + page size.
              The group list is built from the loaded rows, so it never offers an
              empty group. Default is every group. */}
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="w-full sm:w-52 bg-dark-800 border border-dark-600 rounded-lg py-2 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">{t('user.filter_all_groups')}</option>
            {groupOptions.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          <select
            value={itemsPerPage}
            onChange={(e) => setItemsPerPage(Number(e.target.value))}
            className="w-full sm:w-32 bg-dark-800 border border-dark-600 rounded-lg py-2 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-primary-500"
            title={t('user.per_page')}
          >
            {[10, 25, 50, 100].map(n => (
              <option key={n} value={n}>{n} / {t('user.per_page_unit')}</option>
            ))}
          </select>

          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto lg:ml-0">
            <button
              onClick={fetchUsers}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw size={18} />
              {t('common.refresh')}
            </button>
            {/* ==== [FEAT-20260729-BULKUI] bulk mode toggle — admin/superadmin only,
                 matching the BE guard. Leaving the mode clears the selection so a
                 stale set can never be submitted later. */}
            {canManagePermissions && (
              <button
                onClick={() => (bulkMode ? exitBulk() : setBulkMode(true))}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  bulkMode
                    ? 'bg-sky-600 hover:bg-sky-500 text-white'
                    : 'bg-dark-700 hover:bg-dark-600 text-slate-900'
                }`}
              >
                <CheckSquare size={18} />
                {bulkMode ? t('user.bulk_exit') : t('user.bulk_enter')}
              </button>
            )}
            {/* [FEAT-20260729-CREATEGUARD] creating a user means handing out
                access, so only admin and superadmin see the button. The BE
                already refuses anyone else — this stops the form from being
                opened only to fail on save. */}
            {canManagePermissions && (
              <button
                onClick={openCreate}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-primary-500/20 transition-all hover:scale-105 whitespace-nowrap"
              >
                <Plus size={18} />
                {t('common.add_new')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden relative">
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
        )}
        {/* ==== [FEAT-20260729-BULKUI] selection summary + the skip notice.
             The notice lists who select-all could not take, by name and reason —
             selecting fewer rows than asked without saying so reads as a bug. */}
        {bulkMode && (
          <div className="px-4 py-3 border-b border-dark-700 bg-sky-500/5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('user.bulk_selected_count', { count: String(bulkSelected.length) })}
              </span>
              {/* [FEAT-20260729-BULKGLOW] the action button glows once rows are
                  selected, so "ready to press" reads from the button itself and
                  not only from the rows behind it. Enabled state only — a
                  disabled button that glows would invite a dead click. */}
              <button
                onClick={openBulkEdit}
                disabled={bulkSelected.length === 0}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold bg-sky-600 hover:bg-sky-500 text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${
                  bulkSelected.length > 0
                    ? 'scale-[1.03] ring-2 ring-sky-400/70 animate-glow-pulse'
                    : ''
                }`}
              >
                {t('user.bulk_edit_perms')}
              </button>
              {/* [FEAT-20260729-BULKSTATUS] one button; enable vs disable is
                  chosen inside the dialog, so the toolbar does not grow a second
                  near-identical control and the destructive option is never one
                  stray click away.
                  Orange rather than the permission button's blue, because this
                  one can log people out — it should not read as a neighbouring
                  variant of "edit". Glows only while something is selected. */}
              <button
                onClick={openBulkStatus}
                disabled={bulkSelected.length === 0}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold bg-amber-600 hover:bg-amber-500 text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${
                  bulkSelected.length > 0
                    ? 'scale-[1.03] ring-2 ring-amber-400/70 animate-glow-pulse-amber'
                    : ''
                }`}
              >
                {t('user.bulk_status')}
              </button>
              {bulkSelected.length > 0 && (
                <button onClick={() => { setBulkSelected([]); setBulkBlockedNotice([]); }}
                  className="text-sm text-slate-500 hover:text-slate-700 underline">
                  {t('user.bulk_clear')}
                </button>
              )}
            </div>

            {bulkBlockedNotice.length > 0 && (
              <div className="mt-2 flex items-start gap-2 text-[12px] text-amber-700 dark:text-amber-400">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold">{t('user.bulk_skipped_title', { count: String(bulkBlockedNotice.length) })}</div>
                  {/* scrollable: a long list must not push the table off screen */}
                  <ul className="mt-1 max-h-24 overflow-y-auto pr-2 space-y-0.5">
                    {bulkBlockedNotice.map((line, i) => <li key={i} className="break-words">• {line}</li>)}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                {/* [FEAT-20260729-BULKUI] the column only exists in bulk mode, so
                    the normal table is byte-identical to before. */}
                {bulkMode && (
                  <th className="px-4 py-4 w-10">
                    <input
                      type="checkbox"
                      checked={bulkSelectable.length > 0 && bulkSelected.length === bulkSelectable.length}
                      onChange={toggleBulkAll}
                      className="accent-sky-500"
                      title={t('user.bulk_select_all')}
                    />
                  </th>
                )}
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('user.header_username')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('user.header_display_name')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('user.header_role')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('user.header_groups')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('user.header_status')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('user.header_updated_at')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right whitespace-nowrap">{t('user.header_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && filteredUsers.length === 0 ? (
                <tr>
                  {/* [FEAT-20260729-BULKUI] +1 for the checkbox column */}
                  <td colSpan={bulkMode ? 8 : 7} className="px-6 py-12 text-center text-slate-500">
                    {t('user.no_results')}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  /* [FEAT-20260729-BULKGLOW] a selected row glows so the set being
                     edited is readable at a glance — a small checkbox on a dark
                     table is easy to lose track of when picking several.
                     transition-all (was transition-colors) so the ring and shadow
                     ease in too; hover behaviour is unchanged.
                     revert: restore `className="transition-colors hover:bg-dark-700/50"`. */
                  <tr
                    key={user.id}
                    className={`transition-all duration-300 hover:bg-dark-700/50 ${
                      bulkMode && bulkSelected.includes(user.id)
                        ? 'bg-sky-500/10 shadow-[inset_0_0_18px_rgba(14,165,233,0.28)] ring-1 ring-inset ring-sky-500/50'
                        : ''
                    }`}
                  >
                    {/* [FEAT-20260729-BULKUI] a row the caller may not edit is
                        disabled AND explains itself on hover, so the reason is
                        available without submitting and being refused. */}
                    {bulkMode && (() => {
                      const blocked = bulkBlockReason(user);
                      return (
                        <td className="px-4 py-4 w-10">
                          <input
                            type="checkbox"
                            checked={bulkSelected.includes(user.id)}
                            disabled={!!blocked}
                            onChange={() => toggleBulkRow(user)}
                            className={`accent-sky-500 transition-transform duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                              bulkSelected.includes(user.id) ? 'scale-125' : ''
                            }`}
                            title={blocked || undefined}
                          />
                        </td>
                      );
                    })()}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-900">{user.username}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 min-w-[200px]">
                      {user.display_name || '-'}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                      {user.role?.name || user.role_id || '-'}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span>{user.groups?.length ? user.groups.length : 0}</span>
                        <button
                          type="button"
                          onClick={() => openGroupsInfo(user)}
                          className="p-1 rounded-md hover:bg-primary-500/20 text-slate-500 hover:text-primary-500 transition-colors"
                          title={t('user.groups_info')}
                        >
                          <Info size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge active={user.active} />
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                      {user.updated_at
                        ? new Date(user.updated_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '-'}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(user)}
                          className="p-1.5 rounded-lg hover:bg-primary-500/20 text-slate-500 hover:text-primary-500 transition-colors"
                          title={t('common.edit')}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => openClone(user)}
                          className="p-1.5 rounded-lg hover:bg-primary-500/20 text-slate-500 hover:text-primary-500 transition-colors"
                          title={t('user.bulk_clone_action')}
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteId(user.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-500 transition-colors"
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

        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-6 py-4 border-t border-dark-700">
          <span className="text-sm text-slate-500">
            {t('common.showing_total', { count: totalItems })}
          </span>
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
        </div>
      </div>

      {/* ==== [FEAT-20260729-BULKUI] bulk permission dialog.
           `available` is the caller's own permission set (superadmins get the
           full list), so the dialog can never offer something the API will
           refuse. */}
      <BulkPermissionsModal
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        usernames={filteredUsers.filter(u => bulkSelected.includes(u.id)).map(u => u.username)}
        value={bulkPerms}
        onChange={setBulkPerms}
        available={isSuper ? ALL_PERMISSIONS : myPermissions}
        onConfirm={submitBulk}
        saving={bulkSaving}
      />

      {/* [FEAT-20260729-BULKSTATUS] shares the selection with the permission
          dialog above; the state to apply is chosen inside. */}
      <BulkStatusModal
        isOpen={bulkStatusOpen}
        onClose={() => { setBulkStatusOpen(false); setBulkStatusConfirm(false); }}
        usernames={filteredUsers.filter(u => bulkSelected.includes(u.id)).map(u => u.username)}
        choice={bulkStatusChoice}
        onChoice={(next) => { setBulkStatusChoice(next); setBulkStatusConfirm(false); }}
        confirming={bulkStatusConfirm}
        onConfirmStep={() => setBulkStatusConfirm(true)}
        onSubmit={submitBulkStatus}
        saving={bulkStatusSaving}
      />

      <UserFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={submitForm}
        initialData={editing}
        mode={editing ? 'update' : 'create'}
        canEditRole={!!canManagePermissions}
        canEditPermissions={!!canManagePermissions}
      />

      <BulkCloneUsersModal
        isOpen={!!cloneSource}
        onClose={() => setCloneSource(undefined)}
        source={cloneSource}
        onSubmit={submitClone}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        title={t('user.delete_title')}
        message={t('user.delete_message')}
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
        isOpen={groupsInfo.isOpen}
        onClose={closeGroupsInfo}
        title={groupsInfo.title}
        message={groupsInfo.items.length ? groupsInfo.items.join('\n') : t('user.groups_empty')}
        type="success"
      />

      {/* ==== [FEAT-20260729-SAVETOAST] START — toast ผลการบันทึกฟอร์ม user
          fixed มุมขวาบน เหนือ modal (z-[60]) เพราะฟอร์มปิดพร้อมกันพอดี
          error อยู่นานกว่า (6s vs 3.5s) เพราะมีข้อความจาก BE ให้อ่าน
          revert: ลบ block นี้ทั้งก้อน */}
      {saveToast && (
        <div
          key={saveToast.id}
          role="status"
          aria-live="polite"
          className={`fixed top-20 right-5 z-[60] flex items-start gap-2.5 max-w-[360px] px-4 py-3 rounded-xl shadow-xl border text-sm font-semibold ${
            saveToast.type === 'success'
              ? 'bg-emerald-600 border-emerald-400 text-white'
              : 'bg-red-600 border-red-400 text-white'
          }`}
        >
          {saveToast.type === 'success'
            ? <CheckSquare size={16} className="shrink-0 mt-0.5" />
            : <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
          <span className="min-w-0 break-words">{saveToast.text}</span>
          <button
            onClick={() => setSaveToast(null)}
            className="shrink-0 -mr-1 p-0.5 rounded hover:bg-white/20 transition-colors"
            aria-label={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {/* ==== [FEAT-20260729-SAVETOAST] END */}
    </div>
  );
};
