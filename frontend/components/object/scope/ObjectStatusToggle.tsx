/**
 * [FEAT-20260901-OBJSCOPE] On/off for a category or an album.
 *
 * Markup follows `components/messaging/enabled/BroadcastEnabledToggle.tsx:103-128` —
 * `role="switch"` + `aria-checked`, the same pill and knob — so the two switches
 * in this dashboard look and read the same.
 *
 * ⚠️ NO confirm dialog here, unlike the broadcast one. That switch stops a job
 * mid-flight; this one is a field inside a form that is not saved until the
 * admin presses save, and it is reversible in one click. A confirm on every
 * flick would be noise.
 *
 * ⚠️ No new shared primitive. `components/common/` has no Toggle, and adding one
 * to serve two call sites is out of scope for this change.
 *
 * OFF means the LINE reply path serves no image from this row — the same
 * outcome as being out of scope. It does NOT hide the row from the admin list;
 * hiding it would make it impossible to switch back on.
 */
import React from 'react';

import { useI18n } from '../../../i18n';

export interface ObjectStatusToggleProps {
  /** Absent counts as ON — rows saved before this field carry no value. */
  value?: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId?: string;
}

export const ObjectStatusToggle: React.FC<ObjectStatusToggleProps> = ({
  value,
  onChange,
  disabled = false,
  testId = 'object-status-toggle',
}) => {
  const { t } = useI18n();
  /* `!== false`, not `=== true`: undefined is ON. The same rule the backend
     filter spells `{status: {$ne: false}}`, for the same reason. */
  const on = value !== false;

  return (
    /* [UI-20260904-OBJSTATUS] Label and switch sit side by side, owner 04/09.
       Before: `justify-between` pushed the switch to the far edge of a full-width
       row, so on a wide modal the two halves of ONE control were a screen apart
       and the eye had to travel to answer "is this on?". The hint line under the
       label is gone for the same reason — the switch already says เปิด/ปิด in
       colour and in words, so the sentence restated it and only added height.
       ⚠️ The hint STRINGS are still used, as the tooltip on the list-row twin
       (`ObjectRowStatusToggle.tsx:64-66`) where there is no room for a label —
       so nothing here makes a translation key dead.
       revert: restore `justify-between` on the row, `text-xs` on the label, and
       the <p> that read `status_on_hint` / `status_off_hint`. */
    <div className="flex items-center gap-3">
      <div className="min-w-0">
        <label className="block text-sm font-semibold text-slate-700">
          {t('object_scope.status_label')}
        </label>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        data-testid={testId}
        data-status-state={on ? 'on' : 'off'}
        className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-2 py-0.5 text-xs font-medium transition-all active:scale-95 disabled:opacity-50 ${
          on
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}
      >
        <span
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
            on ? 'bg-emerald-500' : 'bg-red-400'
          }`}
          aria-hidden
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
              on ? 'translate-x-[0.9rem]' : 'translate-x-[0.15rem]'
            }`}
          />
        </span>
        {on ? t('object_scope.status_on') : t('object_scope.status_off')}
      </button>
    </div>
  );
};

export default ObjectStatusToggle;
