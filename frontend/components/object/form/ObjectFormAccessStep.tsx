import React from 'react';

import type { ObjectImageFormData } from '../../../types';
import { ObjectScopePicker, ObjectStatusToggle } from '../scope';
import type { ObjectScopeOptions } from '../scope';

/**
 * [REFACTOR-20260904-OBJFORMSPLIT] The album form's ACCESS step: who may use
 * this album, and whether the bot may serve it at all.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageFormModal.tsx` (§6.3 step 3) — same markup,
 * same class strings, same order.
 *
 * 🔴 ELEVEN NAMES CROSSED THE SEAM AND ALL ELEVEN ARE PROPS. No state, no
 * effect, no handler body moved, so nothing about when this re-renders changed.
 * ⚠️ Four of them (`scopeGroups`, `scopeHooks`, and the two loading flags) come
 * from `useObjectScopeOptions` in the parent, and an identifier scan MISSED them
 * on the first pass because they arrive through a renaming destructure
 * (`groups: scopeGroups`). A regex over the block sees the new name and not
 * where it came from. Read the declaration; do not trust a regex.
 *
 * ⚠️ `columns={4}` is deliberate and not a default: the album modal is wider
 * than the category one, and the picker looks wrong at the shared value.
 *
 * revert: paste the body back into the `STEP_ACCESS` entry of the steps array in
 *   `ObjectImageFormModal.tsx` and delete this file.
 */
export interface ObjectFormAccessStepProps {
  formData: ObjectImageFormData;
  onFormChange: React.Dispatch<React.SetStateAction<ObjectImageFormData>>;
  errors: Record<string, string>;
  /** `'view'` disables every control here; the other modes leave them live. */
  resolvedMode: 'create' | 'update' | 'view';
  /* ⚠️ The four come from `useObjectScopeOptions` as ONE object; its exported
     type is reused rather than re-declared, so a change there reaches here. */
  scopeGroups: ObjectScopeOptions['groups'];
  scopeHooks: ObjectScopeOptions['hooks'];
  scopeGroupsLoading: boolean;
  scopeHooksLoading: boolean;
  t: (key: string) => string;
}

export const ObjectFormAccessStep: React.FC<ObjectFormAccessStepProps> = ({
  formData,
  onFormChange: setFormData,
  errors,
  resolvedMode,
  scopeGroups,
  scopeHooks,
  scopeGroupsLoading,
  scopeHooksLoading,
  t,
}) => (
  <div className="flex flex-col gap-4">
    <p className="text-[11px] text-slate-500">
      {t('object_form.tab_access_hint')}
    </p>
    <ObjectStatusToggle
      value={formData.status}
      onChange={(next) =>
        setFormData((prev) => ({ ...prev, status: next }))
      }
      disabled={resolvedMode === 'view'}
      testId="object-image-status"
    />
    <ObjectScopePicker
      groupIds={formData.group_providers || []}
      hookIds={formData.hook_ids || []}
      onChange={(next) =>
        setFormData((prev) => ({ ...prev, ...next }))
      }
      groups={scopeGroups}
      hooks={scopeHooks}
      groupsLoading={scopeGroupsLoading}
      hooksLoading={scopeHooksLoading}
      disabled={resolvedMode === 'view'}
      /* The album modal is wider than the category one. */
      columns={4}
      error={errors.scope}
    />
  </div>
);
