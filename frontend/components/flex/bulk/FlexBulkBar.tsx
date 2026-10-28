import React from 'react';
import { CheckSquare, Layers, X } from 'lucide-react';

import { useI18n } from '../../../i18n';

/**
 * [FEAT-20260830-FLEXBULKGROUPS] the strip that appears in bulk mode.
 *
 * Its own file rather than markup inside the 640-line list page: it reads one
 * piece of state and owns no form, which is exactly the case §6.1 of the local
 * workflow says must start as a separate component.
 *
 * revert: delete this file and its use in pages/content/FlexMessageList.tsx.
 */
interface Props {
  count: number;
  onSelectPage: () => void;
  onClear: () => void;
  onOpen: () => void;
  onExit: () => void;
}

export const FlexBulkBar: React.FC<Props> = ({
  count,
  onSelectPage,
  onClear,
  onOpen,
  onExit,
}) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-dark-700 bg-dark-900/60 px-6 py-3">
      <span className="text-sm font-bold text-slate-700">
        {t('flex.bulk_selected', { count: String(count) })}
      </span>
      <button
        type="button"
        onClick={onSelectPage}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
      >
        <CheckSquare size={14} /> {t('flex.bulk_select_page')}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={count === 0}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
      >
        {t('flex.bulk_clear')}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          disabled={count === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-600 disabled:opacity-40"
        >
          <Layers size={14} /> {t('flex.bulk_action')}
        </button>
        <button
          type="button"
          onClick={onExit}
          title={t('flex.bulk_exit')}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
