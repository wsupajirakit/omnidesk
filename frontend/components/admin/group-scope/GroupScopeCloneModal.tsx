import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2, Undo2 } from 'lucide-react';
import { Modal } from '../../common/Modal';
import { GroupPicker } from './GroupPicker';
import { GroupEntry } from '../../../types';
import { useI18n } from '../../../i18n';
import {
  buildScopeCloneRequest,
  groupScopeService,
  isScopeCloneReady,
  sumScopeCloneTargets,
  type ScopeCloneInclude,
  type ScopeCloneResult
} from '../../../services/admin';

/**
 * [FEAT-20260816-GROUPSCOPECLONE] "Copy this group's permissions to other groups".
 *
 * Its own file in its own folder because it is a self-contained dialog: it reads
 * one group, owns its own state, and returns nothing to its parent except "I am
 * finished, reload". Nothing here belongs in Groups.tsx or GroupFormModal.tsx.
 *
 * ⚠️ This dialog ADDS. The visually similar bulk-scope dialog
 * (`components/bulk/BulkTagScopeModal.tsx`) REPLACES, and its warning says so —
 * the banner below deliberately says the opposite, in the same place, so an
 * operator who knows one is not misled by the other.
 *
 * Always previews before writing: the operation reaches every tag and card the
 * source group holds (801 and 39 on the dev database), so the numbers are shown
 * first and the confirm button is what performs the write.
 *
 * ON SUCCESS THE DIALOG CLOSES and the page behind it reports the result. The
 * numbers belong to the list the operator is going back to, not to a dialog they
 * would have to dismiss, and staying open invites a second confirm on a
 * selection that has already been written.
 *
 * UNDO: `mode: 'remove'` with the same body reverses the write exactly, and the
 * call path is kept and covered by tests. Its button is behind `allowUndo`,
 * which the page does not switch on — the current flow closes on success, so
 * there is nothing on screen to attach it to. Turning the prop on is all that is
 * needed to surface it again.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** the group whose permissions are being copied FROM */
  source: GroupEntry | null;
  /** every group the caller can see; the source is filtered out below */
  groups: GroupEntry[];
  /** called after a write so the page can refresh its list and report the result */
  onApplied?: (result: ScopeCloneResult) => void;
  /** see the note above — the undo control is kept but not surfaced today */
  allowUndo?: boolean;
}

const DEFAULT_INCLUDE: ScopeCloneInclude = { dynamic_tags: true, flex_messages: true };

export const GroupScopeCloneModal: React.FC<Props> = ({ isOpen, onClose, source, groups, onApplied, allowUndo = false }) => {
  const { t } = useI18n();
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [include, setInclude] = useState<ScopeCloneInclude>(DEFAULT_INCLUDE);
  const [preview, setPreview] = useState<ScopeCloneResult | null>(null);
  const [applied, setApplied] = useState<ScopeCloneResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // every re-open starts clean — a stale preview from the previous group would
  // be numbers describing a source that is no longer selected
  useEffect(() => {
    if (!isOpen) return;
    setTargetIds([]);
    setInclude(DEFAULT_INCLUDE);
    setPreview(null);
    setApplied(null);
    setError('');
    setBusy(false);
  }, [isOpen, source?._id]);

  const candidates = useMemo(
    () => groups.filter(group => group._id && group._id !== source?._id),
    [groups, source?._id]
  );

  const request = useMemo(
    () => buildScopeCloneRequest(source?._id || '', targetIds, include),
    [source?._id, targetIds, include]
  );
  const ready = isScopeCloneReady(request);

  const nameOf = (id: string) => groups.find(group => group._id === id)?.group_name || id;

  /**
   * Any change to the selection throws the preview away — otherwise the counts
   * on screen would describe a different set of groups than the confirm button
   * is about to write.
   */
  const setTargets = (next: string[]) => {
    setPreview(null);
    setApplied(null);
    setTargetIds(next);
  };

  const toggleInclude = (key: keyof ScopeCloneInclude) => {
    setPreview(null);
    setApplied(null);
    setInclude(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const run = async (action: 'preview' | 'apply' | 'undo') => {
    setBusy(true);
    setError('');
    try {
      if (action === 'preview') {
        setApplied(null);
        setPreview(await groupScopeService.preview(request));
      } else if (action === 'apply') {
        const result = await groupScopeService.apply(request);
        setApplied(result);
        onApplied?.(result);
        // hand the result to the page and step out of the way
        if (!allowUndo) onClose();
      } else {
        const result = await groupScopeService.apply({ ...request, mode: 'remove' });
        setApplied(result);
        setPreview(null);
        onApplied?.(result);
      }
    } catch (e: any) {
      setError(e?.message || t('group_scope.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen || !source) return null;

  const shown = applied || preview;
  const totals = sumScopeCloneTargets(shown);

  /**
   * The one primary action, rendered in the header as well as the footer: the
   * dialog scrolls once a preview is on screen, and the confirm must not be the
   * thing the operator has to go looking for. Defined once so the two can never
   * disagree about what the button does or when it is disabled.
   */
  const primaryAction = (extra: string) =>
    !applied ? (
      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => run(preview ? 'apply' : 'preview')}
        className={`rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${extra}`}
      >
        {busy ? <Loader2 className="animate-spin" size={16} /> : <Copy size={16} />}
        {t(preview ? 'group_scope.apply_button' : 'group_scope.preview_button')}
      </button>
    ) : null;

  return (
    <Modal isOpen={isOpen} variant="form" maxWidth="max-w-2xl">
      <Modal.Header
        title={t('group_scope.title')}
        onClose={onClose}
        /* no cancel here — the X is the same action */
        actions={primaryAction('ml-auto mr-2 px-4 py-1.5')}
      />

      <div className="p-6 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-5">
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
          <p className="text-xs text-amber-700 leading-relaxed">{t('group_scope.add_not_replace')}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-500 mb-1">{t('group_scope.source_label')}</label>
          <div className="rounded-lg border border-primary-500/30 bg-primary-500/10 px-4 py-2.5 text-sm font-medium text-slate-900">
            {source.group_name}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-500 mb-2">{t('group_scope.targets_label')}</label>
          {/*
            ⚠️ This sits ABOVE "what to copy" on purpose. Its panel opens
            downward, and as the last field in the dialog the options were cut
            off by the dialog's own bottom edge.
          */}
          <GroupPicker groups={candidates} selected={targetIds} onChange={setTargets} />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-500 mb-2">{t('group_scope.include_label')}</label>
          <div className="flex flex-wrap gap-3">
            {(['dynamic_tags', 'flex_messages'] as (keyof ScopeCloneInclude)[]).map(key => (
              <button
                key={key}
                type="button"
                onClick={() => toggleInclude(key)}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors ${
                  include[key]
                    ? 'border-primary-500 bg-primary-500/10 text-slate-900'
                    : 'border-dark-600 text-slate-500 hover:text-slate-900'
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    include[key] ? 'border-primary-500 bg-primary-500 text-white' : 'border-dark-600'
                  }`}
                >
                  {include[key] && <Check size={12} />}
                </span>
                {t(key === 'dynamic_tags' ? 'group_scope.include_tags' : 'group_scope.include_flex')}
              </button>
            ))}
          </div>
        </div>

        {shown && (
          <div className="rounded-lg border border-dark-600 overflow-hidden">
            <div className="bg-dark-900 px-4 py-2 text-xs text-slate-500">
              {t('group_scope.source_totals', {
                tags: shown.source_totals.dynamic_tags,
                flex: shown.source_totals.flex_messages
              })}
            </div>
            <div className="divide-y divide-dark-700">
              {shown.targets.map(target => (
                <div key={target.group_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-900">{nameOf(target.group_id)}</span>
                  <span className="text-slate-500">
                    {t(
                      applied
                        ? applied.mode === 'remove'
                          ? 'group_scope.removed'
                          : 'group_scope.changed'
                        : 'group_scope.will_change',
                      { tags: target.dynamic_tags, flex: target.flex_messages }
                    )}
                  </span>
                </div>
              ))}
            </div>
            {applied && (
              <div className="bg-emerald-500/10 px-4 py-2 text-xs text-emerald-600">
                {t('group_scope.done', { tags: totals.dynamic_tags, flex: totals.flex_messages })}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-500">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-dark-700">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors"
          >
            {t('common.close')}
          </button>

          {allowUndo && applied && applied.mode === 'add' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run('undo')}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-amber-600 border border-amber-500/40 hover:bg-amber-500/10 transition-colors flex items-center gap-2 disabled:opacity-60"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Undo2 size={16} />}
              {t('group_scope.undo_button')}
            </button>
          )}

          {primaryAction('px-6 py-2.5 shadow-lg shadow-primary-500/20')}
        </div>
      </div>
    </Modal>
  );
};
