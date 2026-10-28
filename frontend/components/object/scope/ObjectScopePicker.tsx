/**
 * [FEAT-20260901-OBJSCOPE] Who may use this category / album — two grids.
 *
 * Same shape as the broadcast form's step 3 + step 4 (`BroadcastFormModal.tsx:
 * 1383-1398` and `:1414-1423`): `MultiCheckGrid` twice, select-all and search
 * for free, and the OA grid listing only the OAs of the ticked groups.
 *
 * The pickers are IMPORTED, not rewritten — `MultiCheckSelect.tsx:8-15` records
 * what happened the last time three lists grew three pickers.
 *
 * ⚠️ BOTH PICKERS ARE REQUIRED. Owner, 01/09: a category or album must name the
 * groups and the OAs it belongs to.
 *
 * The BACKEND still reads absent/`[]` as unrestricted, and that is deliberate —
 * every row that predates this feature carries neither column, and a fail-closed
 * reading would empty every screen and stop every image the bot serves. So the
 * requirement lives HERE, on new and edited records, while old rows keep
 * working untouched. The two are not in conflict: the form refuses to WRITE an
 * empty scope; the reader still tolerates one it finds.
 *
 * Owns no fetching and no form state — options come in, ids go out. The parent
 * keeps the state (rule F2), so this file cannot drift between the two modals.
 *
 * revert: delete this folder and the two usages in the object form modals.
 */
import React from 'react';

import { useI18n } from '../../../i18n';
import { MultiCheckGrid } from '../../campaign/pickers/MultiCheckGrid';
import { pruneHookIds } from '../../campaign/pickers/pruneHookIds';
import { ObjectGridFrame } from './ObjectGridFrame';
import type { VisibleGroup } from '../../../services/admin';
import type { HookData } from '../../../types';

export interface ObjectScopePickerProps {
  groupIds: readonly string[];
  hookIds: readonly string[];
  onChange: (next: { group_providers: string[]; hook_ids: string[] }) => void;
  groups: readonly VisibleGroup[];
  hooks: readonly HookData[];
  groupsLoading?: boolean;
  hooksLoading?: boolean;
  disabled?: boolean;
  /** Validation message, shown under both grids. */
  error?: string;
  /**
   * [UI-20260901-OBJGRIDFRAME] Columns for both grids on a wide screen.
   *
   * The album modal is wider than the category modal, so it fits four across
   * where the category modal fits three. Handled by wrapping the borrowed
   * picker, never by editing it — see `ObjectGridFrame`.
   */
  columns?: 3 | 4;
}

export const ObjectScopePicker: React.FC<ObjectScopePickerProps> = ({
  groupIds,
  hookIds,
  onChange,
  groups,
  hooks,
  groupsLoading = false,
  hooksLoading = false,
  disabled = false,
  columns = 3,
  error,
}) => {
  const { t } = useI18n();

  const groupOptions = groups.map((g) => ({
    value: String(g._id),
    label: g.group_name || String(g._id),
  }));

  /* `line_oa_name` is the display name — the same field the broadcast picker
     labels an OA with (`BroadcastFormModal.tsx:823`). `alias` is the routing
     key, not a name, so it is only the fallback. */
  const hookOptions = hooks.map((h) => ({
    value: String(h._id),
    label: h.line_oa_name || h.alias || String(h._id),
  }));

  /* Untick a group and its OAs must go too, or the row keeps an OA the group
     no longer reaches. Exactly the bug `pruneHookIds` was written for on the
     broadcast form — imported, not re-derived. */
  const handleGroups = (next: string[]) => {
    onChange({
      group_providers: next,
      hook_ids: pruneHookIds(hookIds, hooks, next),
    });
  };

  const handleHooks = (next: string[]) => {
    onChange({ group_providers: [...groupIds], hook_ids: next });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="object-scope">
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
          {t('object_scope.groups_label')} <span className="text-red-500">*</span>
        </label>
        <ObjectGridFrame columns={columns}>
          <MultiCheckGrid
            values={groupIds}
            onChange={handleGroups}
            options={groupOptions}
            loading={groupsLoading}
            disabled={disabled}
            testId="object-scope-groups"
          />
        </ObjectGridFrame>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
          {t('object_scope.hooks_label')} <span className="text-red-500">*</span>
        </label>
        <ObjectGridFrame columns={columns}>
          <MultiCheckGrid
            values={hookIds}
            onChange={handleHooks}
            options={hookOptions}
            loading={hooksLoading}
            /* No group ticked ⇒ nothing to choose from yet. Say that, rather
               than rendering an empty box that reads as "no OA exists". */
            emptyLabel={
              groupIds.length === 0
                ? t('object_scope.pick_a_group_first')
                : undefined
            }
            disabled={disabled}
            testId="object-scope-hooks"
          />
        </ObjectGridFrame>
      </div>

      {/* [FIX-20260901-SCOPEREQUIRED] The "empty means everyone" hint is gone:
          it described the old rule and would now contradict the validation. */}
      {error && (
        <p
          className="text-[11px] font-medium text-red-500"
          data-testid="object-scope-error"
        >
          {error}
        </p>
      )}
    </div>
  );
};

export default ObjectScopePicker;
