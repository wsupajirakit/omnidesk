import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Copy, Loader2, Plus, Trash2, Eye, EyeOff, AlertCircle, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { permissionLabel } from '../../services/admin';
import { webhookService } from '../../services/hook';
import { BulkCloneUserError, BulkCloneUserRow, UserEntry } from '../../types';
import { useI18n } from '../../i18n';

const MAX_ROWS = 10;

interface BulkCloneUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  source?: UserEntry;
  onSubmit: (rows: BulkCloneUserRow[]) => Promise<void>;
}

type Row = BulkCloneUserRow & { _key: number };

const emptyRow = (key: number): Row => ({
  _key: key,
  username: '',
  password: '',
  display_name: '',
  email: '',
  phone: ''
});

/**
 * Create up to ten users that inherit the source user's access.
 *
 * Role, groups and permissions are copied server-side and are shown here as
 * read-only context — the whole point of cloning is that access is not
 * re-entered (and so cannot drift) while identity is unique per row.
 */
export const BulkCloneUsersModal: React.FC<BulkCloneUsersModalProps> = ({
  isOpen,
  onClose,
  source,
  onSubmit
}) => {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([emptyRow(0)]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<number, Partial<Record<keyof BulkCloneUserRow, string>>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  // Which inherited-detail popup is open: groups, permissions, or OA-by-group.
  const [detailPopup, setDetailPopup] = useState<null | 'groups' | 'permissions'>(null);
  // All hooks (OAs), used to resolve the source's allowed_hooks ids into names
  // and group them under their sector group.
  const [allHooks, setAllHooks] = useState<any[]>([]);
  const nextKey = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ canScroll: false, atBottom: true });

  useEffect(() => {
    if (!isOpen) return;
    setRows([emptyRow(0)]);
    setErrors({});
    setFormError(null);
    setRevealed({});
    nextKey.current = 1;
    // Load hooks so we can show the source's allowed OAs (by name, grouped).
    webhookService.getAllHooks().then(setAllHooks).catch(() => setAllHooks([]));
  }, [isOpen]);

  // Drive the "more below" hint off real measurements: a fixed-height list with
  // a hidden tenth row is the easiest thing to miss in a tall modal.
  const measure = () => {
    const el = scrollRef.current;
    if (!el) return;
    const canScroll = el.scrollHeight > el.clientHeight + 4;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    setScrollState((prev) =>
      prev.canScroll === canScroll && prev.atBottom === atBottom ? prev : { canScroll, atBottom }
    );
  };

  useEffect(() => {
    measure();
  }, [rows.length, isOpen]);

  const atLimit = rows.length >= MAX_ROWS;
  const filledCount = useMemo(
    () => rows.filter((r) => r.username.trim() || r.password.trim()).length,
    [rows]
  );

  const setField = (key: number, field: keyof BulkCloneUserRow, value: string) => {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, [field]: value } : r)));
    setErrors((prev) => {
      if (!prev[key]?.[field]) return prev;
      const next = { ...prev, [key]: { ...prev[key] } };
      delete next[key][field];
      return next;
    });
  };

  const addRow = () => {
    if (atLimit) return;
    setRows((prev) => [...prev, emptyRow(nextKey.current++)]);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  };

  const removeRow = (key: number) => {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r._key !== key)));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validate = (): BulkCloneUserRow[] | null => {
    const nextErrors: typeof errors = {};
    const seen = new Map<string, number>();

    rows.forEach((row) => {
      const username = row.username.trim().toLowerCase();
      const rowErrors: Partial<Record<keyof BulkCloneUserRow, string>> = {};

      if (!username) rowErrors.username = t('user.bulk_clone_username_required');
      else if (seen.has(username)) rowErrors.username = t('user.bulk_clone_username_duplicate');
      else seen.set(username, row._key);

      if (!row.password.trim()) rowErrors.password = t('user.bulk_clone_password_required');

      if (Object.keys(rowErrors).length) nextErrors[row._key] = rowErrors;
    });

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError(t('user.bulk_clone_fix_errors'));
      return null;
    }

    setFormError(null);
    return rows.map((r) => ({
      username: r.username.trim(),
      password: r.password,
      display_name: r.display_name?.trim() || '',
      email: r.email?.trim() || '',
      phone: r.phone?.trim() || ''
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const payload = validate();
    if (!payload) return;

    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (err: any) {
      // Map per-row failures from the API back onto the row that caused them,
      // so a rejected batch points at the field to fix rather than at the batch.
      const details: BulkCloneUserError[] | undefined = err?.details || err?.response?.data?.details;
      if (Array.isArray(details) && details.length) {
        const mapped: typeof errors = {};
        details.forEach((d) => {
          const row = rows[d.index];
          if (!row) return;
          mapped[row._key] = { ...(mapped[row._key] || {}), [(d.field || 'username') as keyof BulkCloneUserRow]: d.error };
        });
        setErrors(mapped);
      }
      setFormError(err?.message || t('user.bulk_clone_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !source) return null;

  const roleName = typeof source.role === 'object' ? (source.role as any)?.name : source.role;
  const groupNames = (source.groups || [])
    .map((g: any) => (typeof g === 'object' ? g.group_name || g.name : g))
    .filter(Boolean);

  // Group → the source's allowed OAs under that group. Every one of the user's
  // groups is listed (even with no allowed OA), so the popup reads:
  //   กลุ่ม: acme → OA: aaa, bbb
  // allowed_hooks null = "all OAs" (no restriction) → show every OA in the group.
  const allowedHookIds = source.allowed_hooks ?? null;
  const allowAllOa = !Array.isArray(allowedHookIds);
  const groupsById = new Map<string, { id: string; name: string }>();
  (source.groups || []).forEach((g: any) => {
    const id = String(g?._id ?? g?.id ?? '');
    if (id) groupsById.set(id, { id, name: g.group_name || g.name || '' });
  });
  const oaByGroup: { group: string; oas: string[] }[] = (() => {
    const allowSet = allowAllOa ? null : new Set(allowedHookIds as string[]);
    const buckets = new Map<string, string[]>();
    // seed every group so groups with no OA still show
    (source.groups || []).forEach((g: any) => {
      const name = g.group_name || g.name || ''; if (name) buckets.set(name, []);
    });
    allHooks.forEach(h => {
      if (allowSet && !allowSet.has(h._id)) return; // restricted → only allowed OAs
      const gid = String(h.group ?? h.group_id ?? '');
      const g = groupsById.get(gid);
      if (!g) return; // only OAs inside the user's own groups
      buckets.get(g.name)?.push(h.line_oa_name || h.name || h._id);
    });
    return Array.from(buckets.entries()).map(([group, oas]) => ({ group, oas: oas.sort() }))
      .sort((a, b) => a.group.localeCompare(b.group));
  })();
  const allowedOaCount = allowAllOa
    ? null
    : allHooks.filter(h => new Set(allowedHookIds as string[]).has(h._id)).length;

  const inputClass = (hasError?: boolean) =>
    `w-full px-3 py-2 rounded-lg border text-sm transition-colors bg-white dark:bg-dark-900 ${
      hasError
        ? 'border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-500'
        : 'border-slate-200 dark:border-dark-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500'
    } outline-none`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-dark-950/60 backdrop-blur-sm animation-fade-in">
      <div className="bg-white dark:bg-dark-800 w-full max-w-6xl max-h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-dark-700 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Copy className="text-primary-500 shrink-0" size={20} />
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate">
                {t('user.bulk_clone_title')}
              </h3>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {t('user.bulk_clone_subtitle', { username: source.username })}
            </p>
            {/* Source user, explicit + prominent: คัดลอกจาก: <username> (<display name>) */}
            <p className="mt-1.5 text-base font-semibold text-slate-700 dark:text-slate-200">
              {t('user.bulk_clone_source_label')}: <span className="font-bold text-primary-600 dark:text-primary-400">{source.username}</span>
              {(source as any).display_name && <span className="text-slate-400 font-medium"> ({(source as any).display_name})</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors shrink-0"
            aria-label="close"
          >
            <X size={26} />
          </button>
        </div>

        {/* Inherited access — read-only, so it is obvious what is being copied */}
        <div className="px-6 py-4 bg-primary-500/5 border-b border-primary-500/10 shrink-0">
          <div className="flex items-start gap-3">
            <ShieldCheck className="text-primary-500 mt-0.5 shrink-0" size={18} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                {t('user.bulk_clone_inherited')}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="px-2.5 py-1 rounded-lg bg-primary-500/10 text-primary-600 font-medium">
                  {t('user.form_role_label')}: {roleName || '-'}
                </span>
                {/* Groups: "first +N"; always clickable when there's ≥1 group. */}
                {groupNames.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setDetailPopup('groups')}
                    className="px-2.5 py-1 rounded-lg bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20 transition-colors cursor-pointer"
                    title={groupNames.join(', ')}
                  >
                    {t('user.form_groups_label')}: {groupNames[0]}
                    {groupNames.length > 1 && <span className="font-bold text-primary-600"> +{groupNames.length - 1}</span>}
                  </button>
                ) : (
                  <span className="px-2.5 py-1 rounded-lg bg-slate-500/10 text-slate-600 dark:text-slate-300">
                    {t('user.form_groups_label')}: -
                  </span>
                )}
                {/* Permissions: click to see the full label list. */}
                {(source.permissions || []).length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setDetailPopup('permissions')}
                    className="px-2.5 py-1 rounded-lg bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20 transition-colors cursor-pointer"
                  >
                    {t('user.form_permissions_label')}: <span className="font-bold text-primary-600">{(source.permissions || []).length}</span>
                  </button>
                ) : (
                  <span className="px-2.5 py-1 rounded-lg bg-slate-500/10 text-slate-600 dark:text-slate-300">
                    {t('user.form_permissions_label')}: 0
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Row counter */}
        <div className="px-6 py-3 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-dark-700 shrink-0">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <UsersIcon size={16} className="text-slate-400" />
            <span className="font-medium">
              {t('user.bulk_clone_row_count', { count: rows.length, max: MAX_ROWS })}
            </span>
            {atLimit && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 text-xs font-medium">
                {t('user.bulk_clone_at_limit', { max: MAX_ROWS })}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={addRow}
            disabled={atLimit || submitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={16} />
            {t('user.bulk_clone_add_row')}
          </button>
        </div>

        {/* Rows */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div ref={scrollRef} onScroll={measure} className="flex-1 overflow-y-auto px-6 py-4 space-y-3 custom-scrollbar">
            {rows.map((row, index) => {
              const rowErrors = errors[row._key] || {};
              return (
                <div
                  key={row._key}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-dark-700 bg-slate-50/60 dark:bg-dark-900/40"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      #{index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRow(row._key)}
                      disabled={rows.length === 1 || submitting}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title={t('user.bulk_clone_remove_row')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {t('user.form_username_label')} <span className="text-red-500">*</span>
                      </label>
                      <input
                        value={row.username}
                        onChange={(e) => setField(row._key, 'username', e.target.value)}
                        disabled={submitting}
                        className={inputClass(!!rowErrors.username)}
                        placeholder="john"
                      />
                      {rowErrors.username && (
                        <p className="mt-1 text-xs text-red-500">{rowErrors.username}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {t('user.form_display_name_label')}
                      </label>
                      <input
                        value={row.display_name}
                        onChange={(e) => setField(row._key, 'display_name', e.target.value)}
                        disabled={submitting}
                        className={inputClass(false)}
                        placeholder="John Doe"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {t('user.form_password_label')} <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={revealed[row._key] ? 'text' : 'password'}
                          value={row.password}
                          onChange={(e) => setField(row._key, 'password', e.target.value)}
                          disabled={submitting}
                          className={`${inputClass(!!rowErrors.password)} pr-10`}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setRevealed((p) => ({ ...p, [row._key]: !p[row._key] }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                          tabIndex={-1}
                        >
                          {revealed[row._key] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {rowErrors.password && (
                        <p className="mt-1 text-xs text-red-500">{rowErrors.password}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {t('user.form_email_label')}
                      </label>
                      <input
                        type="email"
                        value={row.email}
                        onChange={(e) => setField(row._key, 'email', e.target.value)}
                        disabled={submitting}
                        className={inputClass(!!rowErrors.email)}
                        placeholder="john@example.com"
                      />
                      {rowErrors.email && <p className="mt-1 text-xs text-red-500">{rowErrors.email}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {t('user.form_phone_label')}
                      </label>
                      <input
                        value={row.phone}
                        onChange={(e) => setField(row._key, 'phone', e.target.value)}
                        disabled={submitting}
                        className={inputClass(false)}
                        placeholder="0812345678"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Scroll hint */}
          {scrollState.canScroll && !scrollState.atBottom && (
            <div className="px-6 -mt-6 pb-1 pointer-events-none relative z-10">
              <div className="text-center">
                <span className="inline-block px-3 py-1 rounded-full bg-slate-800/80 text-white text-xs animate-bounce">
                  {t('user.bulk_clone_scroll_hint')}
                </span>
              </div>
            </div>
          )}

          {formError && (
            <div className="mx-6 mb-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2 shrink-0">
              <AlertCircle className="text-red-500 mt-0.5 shrink-0" size={16} />
              <span className="text-sm text-red-600">{formError}</span>
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-200 dark:border-dark-700 flex items-center justify-between gap-4 shrink-0">
            <span className="text-xs text-slate-400">
              {t('user.bulk_clone_footer_hint', { count: filledCount })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-700 disabled:opacity-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
                {t('user.bulk_clone_submit', { count: rows.length })}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Inherited detail popup — full list of groups or permissions. */}
      {detailPopup && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-dark-950/60 backdrop-blur-sm" onClick={() => setDetailPopup(null)}>
          {/* Default size ~30% larger than before (w-[600px], max-h-[90vh]); the
              list area always scrolls so it stays usable when groups/permissions
              grow long in the future. */}
          <div className="bg-white dark:bg-dark-800 w-full max-w-[600px] max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 dark:border-dark-700 flex items-center justify-between shrink-0">
              <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">
                {detailPopup === 'groups'
                  ? t('user.form_groups_label')
                  : `${t('user.form_permissions_label')} (${(source.permissions || []).length})`}
              </h4>
              <button type="button" onClick={() => setDetailPopup(null)} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors" aria-label="close">
                <X size={26} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto custom-scrollbar min-h-0">
              {detailPopup === 'groups' ? (
                // Each group is a header; the OAs it contains (that the source can
                // access) are listed underneath — กลุ่ม → OA.
                <div className="space-y-4">
                  {oaByGroup.length === 0 ? (
                    <p className="text-sm text-slate-400 italic">-</p>
                  ) : (
                    oaByGroup.map(({ group, oas }) => (
                      <div key={group} className="rounded-xl border border-slate-200 dark:border-dark-700 overflow-hidden">
                        <div className="px-3 py-2 bg-slate-500/10 flex items-center justify-between">
                          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('user.form_groups_label')}: {group}</span>
                          <span className="text-[11px] font-medium text-slate-400">{allowAllOa ? `${oas.length} OA` : `${oas.length} OA`}</span>
                        </div>
                        <div className="p-3 flex flex-wrap gap-2">
                          {oas.length === 0 ? (
                            <span className="text-xs text-slate-400 italic">{t('pageui.admin.no_oa_dash', '— ไม่มี OA —')}</span>
                          ) : (
                            oas.map((oa, i) => (
                              <span key={i} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20">
                                {oa}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(source.permissions || []).map((item: string, i: number) => (
                    <span key={i} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20">
                      {permissionLabel(item, t)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
