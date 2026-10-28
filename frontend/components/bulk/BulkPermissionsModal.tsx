/**
 * ==== [FEAT-20260729-BULKUI] START — new file
 * 🔒 AUTO track — to_dev_auto branch only
 *
 * Edit the permissions of several users in one go.
 *
 * A separate component rather than a mode inside UserFormModal: that form
 * carries username, password, role, groups and OA access, none of which apply
 * here, and threading a bulk flag through it would put all of them at risk for
 * a dialog that only ever writes one field. Deleting this file and its usage in
 * pages/Users.tsx removes the feature.
 *
 * ── What the operator sees ───────────────────────────────────────────────────
 * The names being changed, listed in full and scrollable — twenty usernames
 * must not push the buttons off screen — then the permission checkboxes, then
 * two confirmations. The second one restates the count and the exact
 * permissions, because "apply to 14 users" is the kind of action people click
 * through on autopilot.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────
 * It does not merge with each user's existing permissions. What is ticked
 * becomes their permission set, exactly as the API applies it. The dialog says
 * so plainly, since "add" and "replace" look identical until someone loses
 * access they had.
 *
 * The permission list mirrors the sections in UserFormModal so the same
 * permission is found in the same place; it is redeclared here rather than
 * imported because that file does not export it, and reaching into it for one
 * constant would couple the two dialogs together.
 * ==== [FEAT-20260729-BULKUI] END
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useI18n } from '../../i18n';
// [FEAT-20260810-MODALSHELL] shared dialog chrome — content below is unchanged
import { Modal } from '../common/Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** usernames being edited — display only; ids travel separately */
  usernames: string[];
  value: string[];
  onChange: (next: string[]) => void;
  /** permissions the caller may hand out (their own ceiling) */
  available: string[];
  onConfirm: () => void;
  saving: boolean;
}

/** Same grouping and order as the sidebar, matching UserFormModal. */
const SECTIONS: { key: string; permissions: string[] }[] = [
  // [FEAT-20260804-DASHPERM] หมวด dashboard บนสุด — mirror ของ UserFormModal
  //   revert: ลบแถวนี้ (คู่กับใน UserFormModal + KNOWN_PERMISSIONS)
  { key: 'dashboard', permissions: ['dashboard.stats.view'] },
  // [FIX-20260804-DICTPERM] เพิ่ม translation_dict.manage ให้ตรงกับ UserFormModal (เดิมขาดที่นี่ → ตกหมวด other)
  //   revert: ลบ 'translation_dict.manage' ออกจากแถวนี้
  // [FEAT-20260805-HANDOFF] mirror handoff perms here to stay in sync with UserFormModal general section
  { key: 'general', permissions: ['group.manage', 'hook.manage', 'slip.manage', 'flex.manage', 'dynamic_tags.manage', 'custom_tools.manage', 'translation_dict.manage', 'handoff.manage', 'handoff.view_raw', 'handoff.history'] },
  // [FEAT-20260824-STRIKESESSION] ต้องตรงกับ UserFormModal เป๊ะ — ไฟล์นี้ประกาศซ้ำโดยตั้งใจ (ดูหัวไฟล์)
  { key: 'support', permissions: ['ticket.manage', 'insight.manage', 'assign_history.manage', 'contact.manage', 'strike.manage'] },
  { key: 'storage', permissions: ['object.manage'] },
  { key: 'apps', permissions: ['user.manage', 'webhook_log.manage', 'audit.manage', 'config.manage', 'role.manage'] },
];

export const BulkPermissionsModal: React.FC<Props> = ({
  isOpen, onClose, usernames, value, onChange, available, onConfirm, saving,
}) => {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);

  // Only offer what the caller actually holds; anything else would be rejected
  // by the API anyway. Permissions outside the known sections still appear, so
  // a newly added one is never silently unreachable.
  //
  // [FEAT-20260729-HIDEROLEPERM] `role.manage` ("บทบาท") is filtered out here for
  // the same reason as in UserFormModal, and filtered from `available` rather
  // than from SECTIONS so it cannot reappear through the `extra` fallback below.
  // revert: drop the two HIDDEN lines.
  const grouped = useMemo(() => {
    const HIDDEN = new Set(['role.manage', 'Roles']);
    const offered = available.filter(p => !HIDDEN.has(p));
    const known = new Set(SECTIONS.flatMap(s => s.permissions));
    const extra = offered.filter(p => !known.has(p));
    return [
      ...SECTIONS
        .map(s => ({ key: s.key, permissions: s.permissions.filter(p => offered.includes(p)) }))
        .filter(s => s.permissions.length > 0),
      ...(extra.length ? [{ key: 'other', permissions: extra }] : []),
    ];
  }, [available]);

  if (!isOpen) return null;

  const toggle = (perm: string) => {
    onChange(value.includes(perm) ? value.filter(p => p !== perm) : [...value, perm]);
  };

  return (
    <Modal isOpen={isOpen} maxWidth="max-w-2xl">
        <Modal.Header title={t('user.bulk_modal_title')} onClose={onClose} />

        <Modal.Body>
          {/* Who is being changed — capped and scrollable so a long list cannot
              push the confirm buttons out of reach. */}
          <div>
            <div className="text-[13px] font-bold text-slate-600 dark:text-slate-300 mb-1">
              {t('user.bulk_modal_targets', { count: String(usernames.length) })}
            </div>
            <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex flex-wrap gap-1.5">
                {usernames.map(u => (
                  <span key={u} className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-200 text-[12px] font-medium break-all">
                    {u}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Replace, not merge — said before the checkboxes, not after. */}
          <div className="flex items-start gap-2 text-[12px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-2.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{t('user.bulk_modal_replace_warning')}</span>
          </div>

          <div className="space-y-3">
            {grouped.map(section => (
              <div key={section.key} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
                  {/* reuses the section labels already defined for the user form
                      — same wording in both dialogs, one place to change it */}
                  {t(`user.permission_group_${section.key}`)}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {section.permissions.map(perm => (
                    <label key={perm} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={value.includes(perm)}
                        onChange={() => toggle(perm)}
                        className="accent-primary-500"
                      />
                      <span>{t(`user.permission_${perm.replace(/\./g, '_')}`)}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal.Body>

        <Modal.Footer>
          {/* Second confirmation — restates the count and the exact permissions,
              because a bulk write is easy to click through on autopilot. */}
          {confirming ? (
            <div className="space-y-3">
              <div className="text-[13px] text-slate-700 dark:text-slate-200">
                {t('user.bulk_confirm_question', { count: String(usernames.length) })}
                <div className="mt-1.5 max-h-20 overflow-y-auto text-[12px] text-slate-500 dark:text-slate-400">
                  {value.length === 0
                    ? t('user.bulk_confirm_none')
                    : value.map(p => t(`user.permission_${p.replace(/\./g, '_')}`)).join(' · ')}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirming(false)} disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                  {t('common.back')}
                </button>
                <button onClick={onConfirm} disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 inline-flex items-center gap-2">
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {t('user.bulk_confirm_apply')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                {t('common.cancel')}
              </button>
              <button onClick={() => setConfirming(true)}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-sky-600 hover:bg-sky-500 text-white">
                {t('common.next')}
              </button>
            </div>
          )}
        </Modal.Footer>
    </Modal>
  );
};
