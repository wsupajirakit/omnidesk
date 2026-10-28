/**
 * [FEAT-20260901-OBJROWSTATUS] The on/off switch as a LIST-ROW control.
 *
 * Owner, 01/09: the switch belongs outside the form, on both list pages, and it
 * must confirm.
 *
 * WHY CONFIRM HERE AND NOT IN THE FORM. Inside the form the switch is a pending
 * edit — nothing happens until save, and the whole modal can be cancelled. On a
 * row it fires immediately and the effect is on the customer's phone: switching
 * off means the bot stops serving that entry's images from the next message
 * onwards. One stray click on a dense list is a live behaviour change, so it
 * asks first, and the wording says what actually changes rather than "are you
 * sure".
 *
 * The dialog is the shared `ConfirmModal`, not a private one — same look, same
 * keyboard behaviour, same escape hatch as every other confirm in the app.
 *
 * `pending` is owned by the caller: the row that fired is the row that must show
 * the spinner, and the list knows which that is.
 *
 * revert: delete this file and the `<ObjectRowStatusToggle>` in the two list
 * pages. `status` stays editable inside the forms.
 */
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useI18n } from '../../../i18n';
import { ConfirmModal } from '../../modals';

export interface ObjectRowStatusToggleProps {
  /** Absent counts as ON — rows saved before this field carry no value. */
  value?: boolean;
  /** The row's name, quoted back in the confirm so the click is verifiable. */
  name: string;
  onConfirm: (next: boolean) => void;
  pending?: boolean;
  disabled?: boolean;
  testId?: string;
}

export const ObjectRowStatusToggle: React.FC<ObjectRowStatusToggleProps> = ({
  value,
  name,
  onConfirm,
  pending = false,
  disabled = false,
  testId = 'object-row-status',
}) => {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  /* `!== false`, not `=== true`: undefined is ON, the same rule the backend
     filter spells `{status: {$ne: false}}`. */
  const on = value !== false;

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled || pending}
        onClick={() => setAsking(true)}
        data-testid={testId}
        data-status-state={on ? 'on' : 'off'}
        title={
          on ? t('object_scope.status_on_hint') : t('object_scope.status_off_hint')
        }
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-all active:scale-95 disabled:opacity-50 ${
          on
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}
      >
        {pending ? (
          <Loader2 className="animate-spin" size={12} aria-hidden />
        ) : (
          <span
            className={`relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors ${
              on ? 'bg-emerald-500' : 'bg-red-400'
            }`}
            aria-hidden
          >
            <span
              className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform ${
                on ? 'translate-x-[0.8rem]' : 'translate-x-[0.15rem]'
              }`}
            />
          </span>
        )}
        {on ? t('object_scope.status_on') : t('object_scope.status_off')}
      </button>

      <ConfirmModal
        isOpen={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onConfirm(!on);
        }}
        /* Turning something OFF is the destructive direction here: it stops the
           bot mid-conversation. Turning it back on is not. */
        type={on ? 'danger' : 'info'}
        title={
          on
            ? t('object_scope.confirm_off_title')
            : t('object_scope.confirm_on_title')
        }
        message={
          on
            ? t('object_scope.confirm_off_message', { name })
            : t('object_scope.confirm_on_message', { name })
        }
        confirmLabel={
          on ? t('object_scope.status_off') : t('object_scope.status_on')
        }
      />
    </>
  );
};

export default ObjectRowStatusToggle;
