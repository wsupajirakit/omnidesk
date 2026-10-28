/**
 * [FEAT-20260829-NOTICEUNSAVED] does the notification tab still owe a save?
 * ===========================================================================
 * The notification tab writes to its OWN route (`PUT /hook/notice/:id`), separate
 * from the form's main save. Two consequences the admin cannot see:
 *
 * 🔴 pressing the main save stores everything EXCEPT these fields, silently, and
 *    the success toast makes it look complete;
 * 🔴 the tab's own unsaved marker used to live inside the tab, which unmounts on
 *    every tab switch and re-seeded itself from the current form on the way back
 *    — so it reported "saved" for a change that had never been sent.
 *
 * Keeping the snapshot in the FORM means the answer survives tab switches, and
 * the main save can ask the question without the tab being mounted at all. Read
 * from inside the tab, the guard would fire only while the admin happened to be
 * standing on that tab — present-looking and useless everywhere else.
 *
 * ⚠️ THE FIELD LIST IS NOT REDECLARED HERE. `NOTICE_FORM_FIELDS` in
 *    `noticeCardGate.ts` is the one list the tab's own save body is built from;
 *    a second copy would drift and the marker would start missing fields the
 *    route actually sends. ใช้ลิสต์เดียว ห้ามก๊อป
 * ⚠️ `null` snapshot = the tab was never opened ⇒ NOT dirty. Treating unknown as
 *    dirty would block the save on every OA nobody had visited that tab on.
 *
 * revert: delete this file and its spec, and drop `noticeSavedRef` from
 *         `HookFormModal.tsx`.
 */
import { NOTICE_FORM_FIELDS } from '../components/hook/form/noticeCardGate';

/**
 * A stable string for the notice half of a form.
 *
 * Built by walking `NOTICE_FORM_FIELDS` in ITS order, never `Object.keys(form)`,
 * so two forms holding the same values compare equal no matter what order the
 * keys happen to sit in.
 */
export function noticeSnapshot(form: unknown): string {
  const src = (form ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  NOTICE_FORM_FIELDS.forEach((f) => {
    if (f in src) out[f] = src[f];
  });
  return JSON.stringify(out);
}

/** Is there a notice change the tab's own save button has not sent yet? */
export function noticeIsDirty(snapshot: string | null | undefined, form: unknown): boolean {
  if (typeof snapshot !== 'string') return false;
  if (!form) return false;
  return noticeSnapshot(form) !== snapshot;
}
