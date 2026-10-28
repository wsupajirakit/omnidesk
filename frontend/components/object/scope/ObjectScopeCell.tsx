/**
 * [FEAT-20260901-OBJSCOPECELL] Show a row's scope in a list, without widening
 * the row.
 *
 * A scope can hold 130 groups. Printing them turns one row into a paragraph, so
 * the cell prints the FIRST name plus `+N`, and an info button opens the full
 * list in a dialog.
 *
 * The empty case is the one worth getting right: no groups and no OAs means
 * UNRESTRICTED, not "nobody". A blank cell would read as the opposite of the
 * truth, so it says so in words.
 *
 * Names, not ids: the list pages already hold the group and OA catalogues for
 * their filters, so they pass a lookup in. A cell that fetched its own names
 * would be one request per row.
 *
 * revert: delete this file and the `<ObjectScopeCell>` column in the two list
 * pages. The scope stays visible inside the forms.
 */
import React, { useState } from 'react';
import { Info, X } from 'lucide-react';

import { useI18n } from '../../../i18n';

export interface ObjectScopeCellProps {
  groupIds?: readonly unknown[];
  hookIds?: readonly unknown[];
  /** id → display name. Anything missing falls back to the raw id. */
  groupNames?: Record<string, string>;
  hookNames?: Record<string, string>;
  /** The row's own name, for the dialog title. */
  rowName?: string;
  testId?: string;
}

/**
 * [FIX-20260901-CELLPOPULATED] Turn one scope entry into a display name.
 *
 * The entry is EITHER a bare id string (categories) OR a populated document
 * (albums — `object-images.service` calls `.populate('group_providers')`).
 * `String(doc)` on the second gives "[object Object]", which is what the album
 * list showed.
 *
 * Three fallbacks, in order: the catalogue by id · the name the populated
 * document already carries · the raw id. The middle one matters — it keeps the
 * cell readable in the moment before the catalogue finishes loading.
 */
const nameOf = (entry: unknown, names?: Record<string, string>): string => {
  if (entry === null || entry === undefined) return '';

  if (typeof entry === 'object') {
    const o = entry as Record<string, unknown>;
    const id = String(o.id ?? o._id ?? '');
    const embedded = o.group_name ?? o.line_oa_name ?? o.name;
    return names?.[id] || (typeof embedded === 'string' ? embedded : '') || id;
  }

  const id = String(entry);
  return names?.[id] || id;
};

export const ObjectScopeCell: React.FC<ObjectScopeCellProps> = ({
  groupIds = [],
  hookIds = [],
  groupNames,
  hookNames,
  rowName = '',
  testId = 'object-scope-cell',
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const groups = groupIds.map((id) => nameOf(id, groupNames));
  const hooks = hookIds.map((id) => nameOf(id, hookNames));
  const total = groups.length + hooks.length;

  if (total === 0) {
    return (
      <span
        className="text-[11px] text-slate-400"
        data-testid={`${testId}-unrestricted`}
      >
        {t('object_scope.cell_all')}
      </span>
    );
  }

  /* Lead with whichever list actually has something, so a row scoped only by OA
     does not read as "+2" with nothing in front of it. */
  const lead = groups[0] ?? hooks[0] ?? '';
  const rest = total - 1;

  return (
    <>
      <span className="inline-flex items-center gap-1.5" data-testid={testId}>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 max-w-[10rem] truncate">
          {lead}
        </span>
        {rest > 0 && (
          <span
            className="text-[11px] font-semibold text-slate-500"
            data-testid={`${testId}-more`}
          >
            +{rest}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid={`${testId}-info`}
          title={t('object_scope.cell_view')}
          className="text-slate-400 transition-colors hover:text-primary-600"
        >
          <Info size={14} aria-hidden />
        </button>
      </span>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-white/45 backdrop-blur"
          data-testid={`${testId}-modal`}
          /* Click-away closes, like every other overlay here. The inner box
             stops the bubble so a click on the list does not shut it. */
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-[520px] max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-slate-900 truncate">
                  {t('object_scope.cell_title')}
                </h4>
                {rowName && (
                  <p className="text-xs text-slate-500 truncate">{rowName}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                data-testid={`${testId}-close`}
                className="rounded-full p-1 transition-colors hover:bg-slate-100"
              >
                <X size={18} className="text-slate-400" />
              </button>
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto custom-scrollbar p-4">
              <section>
                <p className="mb-1.5 text-xs font-semibold text-slate-600">
                  {t('object_scope.groups_label')} ({groups.length})
                </p>
                {groups.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    {t('object_scope.cell_all_groups')}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map((name) => (
                      <span
                        key={name}
                        className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <p className="mb-1.5 text-xs font-semibold text-slate-600">
                  {t('object_scope.hooks_label')} ({hooks.length})
                </p>
                {hooks.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    {t('object_scope.cell_all_hooks')}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {hooks.map((name) => (
                      <span
                        key={name}
                        className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ObjectScopeCell;
