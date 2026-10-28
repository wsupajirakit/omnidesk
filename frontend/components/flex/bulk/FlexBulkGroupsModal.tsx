import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { useI18n } from '../../../i18n';
import { Modal } from '../../common/Modal';

/**
 * [FEAT-20260830-FLEXBULKGROUPS] change the group scope of several cards.
 *
 * Shaped after components/bulk/BulkPermissionsModal.tsx — the same job for
 * users — so the two dialogs read the same way: the affected names listed in
 * full and scrollable, the replace-not-merge warning stated BEFORE the picker,
 * then two confirmations, the second restating the count and the exact groups.
 * A bulk write is easy to click through on autopilot.
 *
 * ⚠️ REPLACE, NOT MERGE. What is ticked becomes the whole scope of every card,
 * exactly as `POST /api/flex-messages/bulk-groups` applies it. Say it here or
 * somebody loses access to a card and nothing on screen explained why.
 *
 * TWO DIFFERENCES FROM THE USERS DIALOG, both deliberate:
 *   1. `confirming` is reset when the dialog closes. The users one keeps it, so
 *      cancelling on the confirm screen and reopening lands the operator
 *      straight back on "Apply" with no chance to review.
 *   2. Confirm is disabled with nothing ticked. The endpoint refuses an empty
 *      group list (it would orphan every card from every non-superuser), so
 *      offering the button would only produce a 400.
 *
 * revert: delete this file, its folder siblings, and the call site in
 * pages/content/FlexMessageList.tsx.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Card names being changed — display only; the ids travel separately. */
  names: string[];
  /** Groups the operator may pick from (already scoped by the list page). */
  groups: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  onConfirm: () => void;
  saving: boolean;
}

export const FlexBulkGroupsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  names,
  groups,
  value,
  onChange,
  onConfirm,
  saving,
}) => {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);

  // See note 1 in the header: a reopened dialog always starts at step one.
  useEffect(() => {
    if (!isOpen) setConfirming(false);
  }, [isOpen]);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((g) => g !== id) : [...value, id]);

  const labelOf = (id: string) =>
    groups.find((g) => g.value === id)?.label ?? id;

  return (
    <Modal isOpen={isOpen} maxWidth="max-w-2xl">
      <Modal.Header title={t('flex.bulk_modal_title')} onClose={onClose} />

      <Modal.Body>
        <div>
          <div className="text-[13px] font-bold text-slate-600 dark:text-slate-300 mb-1">
            {t('flex.bulk_modal_targets', { count: String(names.length) })}
          </div>
          {/* Capped and scrollable — twenty card names must not push the
              buttons off screen. */}
          <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800/50">
            <div className="flex flex-wrap gap-1.5">
              {names.map((n, i) => (
                <span
                  key={`${n}-${i}`}
                  className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-200 text-[12px] font-medium break-all"
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 text-[12px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-2.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{t('flex.bulk_modal_replace_warning')}</span>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
            {t('flex.bulk_modal_pick')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto">
            {groups.map((g) => (
              <label
                key={g.value}
                className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={value.includes(g.value)}
                  onChange={() => toggle(g.value)}
                  className="accent-primary-500"
                />
                <span className="break-all">{g.label}</span>
              </label>
            ))}
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        {confirming ? (
          <div className="space-y-3">
            <div className="text-[13px] text-slate-700 dark:text-slate-200">
              {t('flex.bulk_confirm_question', { count: String(names.length) })}
              <div className="mt-1.5 max-h-20 overflow-y-auto text-[12px] text-slate-500 dark:text-slate-400">
                {value.map(labelOf).join(' · ')}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 inline-flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {t('flex.bulk_confirm_apply')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {/* The endpoint refuses an empty scope; say why the button is off
                rather than letting the operator find out from a 400. */}
            <span className="text-[12px] text-slate-400">
              {value.length === 0 ? t('flex.bulk_need_group') : ''}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={value.length === 0}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40"
              >
                {t('flex.bulk_next')}
              </button>
            </div>
          </div>
        )}
      </Modal.Footer>
    </Modal>
  );
};
