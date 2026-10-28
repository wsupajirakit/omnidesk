/**
 * [FEAT-20260901-OBJSCOPE] The "Access" step, whole — hint, switch, pickers.
 *
 * Both Object modals show exactly this step, so it is assembled once. Its own
 * file for a second reason: `ObjectCategoryFormModal` crossed the 400-line
 * warn threshold when the step was inlined, and the ratchet in
 * `eslint.config.mjs` may only ever shrink — a new name on the waiver list
 * means a new file grew too big, so the answer is to split, not to waive.
 *
 * Props only: the picks live in the parent's form state (rule F2), so the two
 * modals cannot drift apart and this file owns no state to lose.
 */
import React from 'react';

import { useI18n } from '../../../i18n';
import { ObjectScopePicker } from './ObjectScopePicker';
import { ObjectStatusToggle } from './ObjectStatusToggle';
import type { VisibleGroup } from '../../../services/admin';
import type { HookData } from '../../../types';

export interface ObjectAccessStepProps {
  groupIds: readonly string[];
  hookIds: readonly string[];
  status?: boolean;
  onScopeChange: (next: {
    group_providers: string[];
    hook_ids: string[];
  }) => void;
  onStatusChange: (next: boolean) => void;
  groups: readonly VisibleGroup[];
  hooks: readonly HookData[];
  groupsLoading?: boolean;
  hooksLoading?: boolean;
  disabled?: boolean;
  /** The album modal is wider than the category one. */
  columns?: 3 | 4;
  /** [FIX-20260901-SCOPEREQUIRED] Validation message for the pickers. */
  error?: string;
  testId?: string;
}

export const ObjectAccessStep: React.FC<ObjectAccessStepProps> = ({
  groupIds,
  hookIds,
  status,
  onScopeChange,
  onStatusChange,
  groups,
  hooks,
  groupsLoading,
  hooksLoading,
  disabled = false,
  columns = 3,
  error,
  testId = 'object-access-status',
}) => {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-slate-500">
        {t('object_form.tab_access_hint')}
      </p>

      <ObjectStatusToggle
        value={status}
        onChange={onStatusChange}
        disabled={disabled}
        testId={testId}
      />

      <ObjectScopePicker
        groupIds={groupIds}
        hookIds={hookIds}
        onChange={onScopeChange}
        groups={groups}
        hooks={hooks}
        groupsLoading={groupsLoading}
        hooksLoading={hooksLoading}
        disabled={disabled}
        columns={columns}
        error={error}
      />
    </div>
  );
};

export default ObjectAccessStep;
