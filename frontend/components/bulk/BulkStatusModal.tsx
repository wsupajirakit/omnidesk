/**
 * ==== [FEAT-20260729-BULKSTATUS] START — enable/disable several accounts at once
 * 🔒 AUTO track — to_dev_auto branch only
 *
 * A separate dialog rather than another mode inside BulkPermissionsModal: the
 * two do different things, and folding a logout-capable action into the
 * permission editor would put it one stray click from a routine edit.
 *
 * Two steps on purpose:
 *   1. choose the target state (nothing is preselected)
 *   2. confirm, with the count and the consequence spelled out
 *
 * Disabling ends the person's session on their next request — the API re-reads
 * `active` on every call — so the warning says that plainly instead of implying
 * it only blocks the next login.
 *
 * revert: delete this file, its import and <BulkStatusModal> in Users.tsx, the
 *         bulkStatus* state, openBulkStatus/submitBulkStatus, the toolbar
 *         button, and userService.bulkUpdateActive.
 * ==== [FEAT-20260729-BULKSTATUS] END
 */
import React from 'react';
import { AlertTriangle, Loader2, UserCheck, UserX } from 'lucide-react';
import { useI18n } from '../../i18n';
// [FEAT-20260810-MODALSHELL] chrome (overlay/panel/header/body/footer) now comes
// from the shared primitive; only this dialog's own content stays here.
import { Modal } from '../common/Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** names being changed — display only; ids travel separately */
  usernames: string[];
  /** null until the operator picks; true = enable, false = disable */
  choice: boolean | null;
  onChoice: (next: boolean) => void;
  confirming: boolean;
  onConfirmStep: () => void;
  onSubmit: () => void;
  saving: boolean;
  /** Labels differ per page (users vs OAs), so the wording is passed in rather
   *  than hardcoded to user.* keys — that is what lets both pages share this
   *  dialog instead of forking it. */
  labels?: {
    title?: string;
    targets?: string;
    onLabel?: string;
    offLabel?: string;
    warning?: string;
  };
}

export const BulkStatusModal: React.FC<Props> = ({
  isOpen, onClose, usernames, choice, onChoice, confirming, onConfirmStep, onSubmit, saving, labels,
}) => {
  const { t } = useI18n();
  if (!isOpen) return null;

  const disabling = choice === false;
  const title = labels?.title ?? t('user.bulk_status_title');
  const targetsLabel = labels?.targets ?? t('user.bulk_modal_targets', { count: String(usernames.length) });
  const onLabel = labels?.onLabel ?? t('user.status_active');
  const offLabel = labels?.offLabel ?? t('user.status_inactive');
  const warning = labels?.warning ?? t('user.bulk_status_warning');

  return (
    <Modal isOpen={isOpen} maxWidth="max-w-lg">
        <Modal.Header title={title} onClose={onClose} />

        <Modal.Body>
          {/* Who is affected — capped and scrollable so a long list cannot push
              the buttons out of reach. */}
          <div>
            <div className="text-[13px] font-bold text-slate-600 dark:text-slate-300 mb-1">
              {targetsLabel}
            </div>
            <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex flex-wrap gap-1.5">
                {usernames.map(u => (
                  <span key={u} className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 text-[12px] font-medium break-all">
                    {u}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Step 1 — pick the target state. Neither is preselected, so the
              destructive one is never the default. */}
          <div>
            <div className="text-[13px] font-bold text-slate-600 dark:text-slate-300 mb-2">
              {t('user.bulk_status_choose')}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChoice(true)}
                disabled={saving}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                  choice === true
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-400/50'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <UserCheck size={16} /> {onLabel}
              </button>
              <button
                type="button"
                onClick={() => onChoice(false)}
                disabled={saving}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                  choice === false
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-2 ring-amber-400/50'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <UserX size={16} /> {offLabel}
              </button>
            </div>
          </div>

          {/* Disabling is the only branch that ends sessions, so the warning is
              shown only for that choice. */}
          {disabling && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
              <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[12px] text-amber-800 dark:text-amber-200 leading-relaxed">
                {warning}
              </p>
            </div>
          )}
        </Modal.Body>

        <Modal.Footer className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>

          {/* Step 2 — the same button changes meaning once pressed, so the final
              action is always a second, deliberate click. */}
          {!confirming ? (
            <button
              onClick={onConfirmStep}
              disabled={choice === null || saving}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {/* not common.next — that string is "next page" for pagination */}
              {t('user.bulk_status_next')}
            </button>
          ) : (
            <button
              onClick={onSubmit}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t('user.bulk_status_confirm', { count: String(usernames.length) })}
            </button>
          )}
        </Modal.Footer>
    </Modal>
  );
};
