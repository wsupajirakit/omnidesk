/**
 * [FEAT-20260817-SECRETLOCK] Stored credentials open LOCKED; editing one is a
 * deliberate act with a way back.
 *
 * WHY THIS EXISTS (the incident, 17/08)
 * -------------------------------------
 * The edit form used to place the literal `__SECRET_KEPT__` placeholder inside
 * an EDITABLE box. The backend strips that placeholder only on an exact match,
 * so an operator who touched the text — deleted one character, typed a space —
 * produced a "new value" that was encrypted and written over the real
 * credential. HTTP 200, no error. It destroyed demo-oa-three's channel_secret and
 * access_token, recovered only because the audit log still held the old
 * ciphertext.
 *
 * THE RULE (owner's design)
 * -------------------------
 *   · a field that HOLDS a stored value renders read-only (secrets as bullets)
 *   · แก้ไข = unlock: the box EMPTIES and waits for the new value
 *   · ยกเลิก = relock: the stored value comes back untouched
 *   · unlocked + left blank = the save is refused — you asked to edit it,
 *     so give it a value or cancel (กด edit แล้วว่าง = ห้ามเซฟ)
 *   · channel_id locks too (its confirm-modal stays as the second gate) but is
 *     NOT a secret: its value stays visible, and unlocking keeps it in place
 *     for correction instead of clearing
 *
 * WHAT IT DELIBERATELY DOES NOT CHANGE
 * ------------------------------------
 *   · formData: while locked it still holds exactly what populate loaded, so
 *     every existing consumer (the P1 baseline diff, the external-fields change
 *     detector, validate()) sees the same values as before this feature.
 *     Only the rendered `value` differs (bullets).
 *   · create/clone: no stored value on the server side of that save → nothing
 *     locks, the form behaves exactly as it always has.
 *
 * The backend has a matching second layer (`findMangledSentinels`,
 * omnidesk-api hook-write.helpers.ts): any client that still submits a value
 * looking like the placeholder gets a 400 instead of a destroyed key.
 *
 * revert: delete this file, the <SecretLockButtons> usages and the
 * `secretLock.` references in HookFormModal/HookAiTab — inputs then render
 * exactly as before this feature.
 */
import React from 'react';

/** Masked credentials: unlocking EMPTIES the box (a new value must be typed). */
export const SECRET_LOCK_CLEAR_FIELDS = [
  'channel_secret',
  'access_token',
  'custom_ai_key',
  // [FEAT-20260904-VENDORSECCOL] the second vendor's key opens LOCKED like every
  // other stored credential; editing it is a deliberate act.
  'custom_ai_key_sec',
  'slip_verify_key',
  'telegram_key',
  'external_password',
] as const;

/** Locked the same way, but visible and kept in place on unlock (not a secret). */
export const SECRET_LOCK_KEEP_FIELDS = ['channel_id'] as const;

const CLEAR_SET = new Set<string>(SECRET_LOCK_CLEAR_FIELDS);
const ALL_LOCKABLE = [...SECRET_LOCK_CLEAR_FIELDS, ...SECRET_LOCK_KEEP_FIELDS];

/** What a locked secret shows instead of its (placeholder) value. */
export const LOCKED_DISPLAY = '••••••••••';

export interface SecretLockApi {
  /** Call once per populate with the values the form loaded (update mode). */
  arm: (populated: Record<string, unknown>, isUpdate: boolean) => void;
  /** read-only + edit button visible */
  isLocked: (field: string) => boolean;
  /** the operator pressed แก้ไข and has not cancelled */
  isUnlocked: (field: string) => boolean;
  edit: (field: string) => void;
  cancel: (field: string) => void;
  /** what the <input value=…> should render */
  displayValue: (field: string, raw: unknown) => string;
  /** '' while locked — for the test/copy buttons that would otherwise ship the placeholder */
  valueForUse: (field: string, raw: unknown) => string;
  /** the unlocked-but-blank errors to merge into validate()'s result */
  blankErrors: (
    formData: Record<string, unknown>,
    message: string,
  ) => Record<string, string>;
}

export function useSecretLock(
  setFormData: React.Dispatch<React.SetStateAction<any>>,
  /** Always-current form values — a ref, so the callbacks stay stable.
      (Reading prev inside the setState updater was the first draft; a state
      updater must be PURE, and stashing there raced the cancel path.) */
  formDataRef: React.MutableRefObject<Record<string, unknown>>,
): SecretLockApi {
  // Which fields carried a stored value when the form loaded (update only).
  const storedRef = React.useRef<Set<string>>(new Set());
  // Which of those the operator has unlocked. State: the buttons re-render on it.
  const [unlocked, setUnlocked] = React.useState<Set<string>>(new Set());
  // The value each unlocked field held, so ยกเลิก can put it back.
  const stashRef = React.useRef<Map<string, unknown>>(new Map());

  const arm = React.useCallback(
    (populated: Record<string, unknown>, isUpdate: boolean) => {
      const stored = new Set<string>();
      if (isUpdate) {
        for (const f of ALL_LOCKABLE) {
          const v = populated[f];
          if (typeof v === 'string' ? v.trim() !== '' : !!v) stored.add(f);
        }
      }
      storedRef.current = stored;
      stashRef.current.clear();
      setUnlocked(new Set());
    },
    [],
  );

  const isUnlocked = React.useCallback(
    (f: string) => unlocked.has(f),
    [unlocked],
  );
  const isLocked = React.useCallback(
    (f: string) => storedRef.current.has(f) && !unlocked.has(f),
    [unlocked],
  );

  const edit = React.useCallback(
    (f: string) => {
      stashRef.current.set(f, formDataRef.current[f]);
      // secrets empty out and wait for the new value; channel_id stays put
      if (CLEAR_SET.has(f)) setFormData((prev: any) => ({ ...prev, [f]: '' }));
      setUnlocked((prev) => new Set(prev).add(f));
    },
    [setFormData, formDataRef],
  );

  const cancel = React.useCallback(
    (f: string) => {
      // read the stash BEFORE queueing the state update — the updater must stay pure
      const hadStash = stashRef.current.has(f);
      const stashed = stashRef.current.get(f);
      stashRef.current.delete(f);
      if (hadStash) setFormData((prev: any) => ({ ...prev, [f]: stashed }));
      setUnlocked((prev) => {
        const next = new Set(prev);
        next.delete(f);
        return next;
      });
    },
    [setFormData, formDataRef],
  );

  const displayValue = React.useCallback(
    (f: string, raw: unknown) =>
      isLocked(f) && CLEAR_SET.has(f) ? LOCKED_DISPLAY : String(raw ?? ''),
    [isLocked],
  );

  const valueForUse = React.useCallback(
    (f: string, raw: unknown) => (isLocked(f) ? '' : String(raw ?? '')),
    [isLocked],
  );

  const blankErrors = React.useCallback(
    (formData: Record<string, unknown>, message: string) => {
      const errs: Record<string, string> = {};
      for (const f of unlocked) {
        if (String(formData[f] ?? '').trim() === '') errs[f] = message;
      }
      return errs;
    },
    [unlocked],
  );

  return { arm, isLocked, isUnlocked, edit, cancel, displayValue, valueForUse, blankErrors };
}

/**
 * The แก้ไข / ยกเลิก button for one lockable field. Rendered inside the input's
 * `relative` wrapper, mirroring the group field's unlock button in the same
 * form. `offsetClass` moves it left when an eye toggle occupies right-2.
 */
export const SecretLockButtons: React.FC<{
  field: string;
  lock: SecretLockApi;
  editLabel: string;
  cancelLabel: string;
  offsetClass?: string;
}> = ({ field, lock, editLabel, cancelLabel, offsetClass = 'right-2' }) => {
  if (lock.isLocked(field)) {
    return (
      <button
        type="button"
        data-testid={`secret-edit-${field}`}
        onClick={() => lock.edit(field)}
        className={`absolute ${offsetClass} top-1/2 -translate-y-1/2 text-xs px-2 py-1 bg-dark-700 rounded-md text-slate-600 hover:text-slate-900 hover:bg-dark-600`}
      >
        {editLabel}
      </button>
    );
  }
  if (lock.isUnlocked(field)) {
    return (
      <button
        type="button"
        data-testid={`secret-cancel-${field}`}
        onClick={() => lock.cancel(field)}
        className={`absolute ${offsetClass} top-1/2 -translate-y-1/2 text-xs px-2 py-1 bg-amber-500/10 border border-amber-500/30 rounded-md text-amber-600 hover:bg-amber-500/20`}
      >
        {cancelLabel}
      </button>
    );
  }
  return null;
};
