import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { GroupEntry } from '../../../types';
import { useI18n } from '../../../i18n';

/**
 * [FEAT-20260816-GROUPSCOPECLONE] Multi-select group box with a search field.
 *
 * The same control the rest of the dashboard uses for a long option list
 * (`components/common/SearchableSelect.tsx`), in the one flavour that file does
 * not offer: MANY values. It stays one line tall until it is opened, so the
 * dialog around it keeps its height whether the tenant has three groups or
 * three hundred — an inline list pushed the confirm button off the screen.
 *
 * The open panel is capped at five rows and scrolls; nothing about the dialog
 * moves when the list grows.
 *
 * revert: delete this file and put the inline checkbox list back in
 * GroupScopeCloneModal (it was ~15 lines).
 */

/** rows visible in the open panel before it scrolls */
const VISIBLE_ROWS = 5;
const ROW_HEIGHT_REM = 2.75;

interface Props {
  groups: GroupEntry[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** hide the search field below this many groups — it would only take space */
  searchThreshold?: number;
}

export const GroupPicker: React.FC<Props> = ({
  groups,
  selected,
  onChange,
  searchThreshold = 6
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const usable = useMemo(() => groups.filter(group => group._id), [groups]);
  const showSearch = usable.length >= searchThreshold;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return usable;
    return usable.filter(
      group =>
        group.group_name.toLowerCase().includes(q) ||
        (group.description || '').toLowerCase().includes(q)
    );
  }, [usable, query]);

  // close on an outside click, and focus the search the moment it opens —
  // same behaviour as the single-value SearchableSelect next door
  useEffect(() => {
    if (!open) return;
    const onDocument = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    const focus = setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('mousedown', onDocument);
      clearTimeout(focus);
    };
  }, [open]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(entry => entry !== id) : [...selected, id]);

  const summary = useMemo(() => {
    if (selected.length === 0) return '';
    const names = selected
      .map(id => usable.find(group => group._id === id)?.group_name)
      .filter(Boolean);
    return names.length <= 2
      ? names.join(', ')
      : t('group_scope.selected_count', { count: selected.length });
  }, [selected, usable, t]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        data-testid="group-picker-trigger"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 rounded-lg border border-dark-600 bg-dark-800 px-3 py-2.5 text-left text-sm text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 ${
          open ? 'ring-2 ring-primary-500' : ''
        }`}
      >
        <span className={`flex-1 truncate ${summary ? '' : 'text-slate-400'}`}>
          {summary || t('group_scope.targets_placeholder')}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-dark-600 bg-white shadow-xl shadow-black/10 overflow-hidden">
          {showSearch && (
            <div className="p-2 border-b border-dark-600">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('group_scope.search_placeholder')}
                  className="w-full rounded-md border border-dark-600 bg-dark-800 pl-8 pr-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          )}

          <div
            data-testid="group-picker-list"
            className="overflow-y-auto custom-scrollbar py-1"
            style={{ maxHeight: `${VISIBLE_ROWS * ROW_HEIGHT_REM}rem` }}
          >
            {shown.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">
                {usable.length === 0
                  ? t('group_scope.no_candidates')
                  : t('group_scope.no_search_results')}
              </p>
            ) : (
              shown.map(group => {
                const picked = selected.includes(group._id);
                return (
                  <button
                    key={group._id}
                    type="button"
                    onClick={() => toggle(group._id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      picked ? 'bg-primary-500/10' : 'hover:bg-dark-700/50'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        picked ? 'border-primary-500 bg-primary-500 text-white' : 'border-dark-600'
                      }`}
                    >
                      {picked && <Check size={12} />}
                    </span>
                    <span className="truncate text-sm text-slate-900">{group.group_name}</span>
                    {!group.status && (
                      <span className="ml-auto shrink-0 text-xs text-slate-400">
                        {t('status.inactive')}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
