import React from 'react';
import { useI18n } from '../../../i18n';

/**
 * [UI-20260903-CARDTYPETWOPLACES] the card-content picker, offered in TWO places
 * ===========================================================================
 * Owner 03/09: the picker keeps its existing home on step 2, and gains a second
 * one on step 5 that appears when Multicast is chosen.
 *
 * ── why one component instead of a second copy of the JSX ─────────────────
 * Before this, the picker was ~28 lines of JSX inline in `BroadcastFormModal`.
 * Rendering it in a second place by copy-paste would create two `<select name=
 * "card_type">` blocks that must be kept in step by hand — the cost warning,
 * the `''` → null mapping and the option list would drift the moment one side
 * is edited. Extracting first means both places ARE the same control, so the
 * two cannot disagree.
 *
 * 🔴 STILL ONE VALUE. Both instances read and write `formData.card_type` — the
 *    same field. This is one setting reachable from two screens, NOT two
 *    settings. Changing it on step 5 shows the change on step 2 and back.
 *
 * ⚠️ This file holds NO state: it takes the current value and an onChange, so
 *    `formData` stays owned by the modal exactly as before (§6.1). No effect,
 *    no fetch.
 *
 * ⚠️ WHO DECIDES WHEN IT IS VISIBLE: the caller, not this file. Step 2 has
 *    always shown it only for multicast, and step 5 must do the same, but the
 *    reason is a property of the send method rather than of the control, and
 *    step 5 sits right next to the send-method select that clears the value.
 *    Keeping the gate at the call sites leaves that pairing readable.
 *    ⇒ a broadcast job never offers a per-person card, on either step:
 *      `/message/broadcast` carries no recipient list, so a card whose body
 *      differs per person has nowhere to put the difference, and the backend
 *      refuses that pair outright (`send-matrix.registry.ts`
 *      `broadcast:personal` `allowed: false`).
 *
 * revert: inline this JSX back into `BroadcastFormModal.tsx` at the step-2 site
 *   and delete both call sites + this file.
 */
export interface BroadcastCardTypePickerProps {
  /** `'personal'` | null — the current `formData.card_type` */
  readonly value: string | null;
  /** null when the admin picks the plain card; `'personal'` otherwise */
  readonly onChange: (next: string | null) => void;
  readonly disabled: boolean;
  /** the modal's shared input styling, passed in so this file owns no theme */
  readonly className: string;
  /**
   * Distinguishes the two instances in the DOM. Both render the same control,
   * so a test (and a human reading the accessibility tree) needs to say WHICH
   * one it means — two identical `data-testid`s would make the step-5 block
   * unaddressable.
   */
  readonly testId: string;
}

export const BroadcastCardTypePicker: React.FC<BroadcastCardTypePickerProps> = ({
  value,
  onChange,
  disabled,
  className,
  testId,
}) => {
  const { t } = useI18n();

  return (
    <div className="mt-4" data-testid={testId}>
      <label className="block text-sm font-medium text-slate-700 mb-2">
        {t('broadcast.card_type_label')}
      </label>
      <select
        name="card_type"
        value={value ?? ''}
        disabled={disabled}
        /* '' is the plain card and must land as null, not as an empty string —
           the backend treats the field as absent, and a '' would be a third
           state that nothing else in the flow understands. */
        onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
        className={className}
      >
        <option value="">{t('broadcast.card_type_plain')}</option>
        <option value="personal">{t('broadcast.card_type_personal')}</option>
      </select>
      <p className="mt-1 text-xs text-slate-700">{t('broadcast.card_type_hint')}</p>
      {value === 'personal' && (
        /* 🔴 One LINE request per recipient — the admin has to know
           BEFORE choosing, not after the run takes an hour. */
        <p className="mt-1 text-[11px] text-amber-700" data-testid="card-type-cost">
          {t('broadcast.card_type_cost')}
        </p>
      )}
    </div>
  );
};
