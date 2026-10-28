/* Through the barrel, exactly as the modal does (`ObjectImageFormModal.tsx:12`)
   — one directory deeper, so `../../types` becomes `../../../types`. */
import type { ObjectImageFormData } from '../../../types';

/**
 * [REFACTOR-20260904-OBJFORMSPLIT] The Object album form's constants — the
 * display switches, the step table and the empty form.
 *
 * Lifted VERBATIM out of `ObjectImageFormModal.tsx` (was `:36-152`, minus the
 * storage picker which went to `storageOptions.ts` with its own flag). Nothing
 * here reads state, props, a handler or an effect, which is what makes it a
 * safe lift under §6.3 rather than a state move under §6.4.
 *
 * WHY: the modal was 1,702 lines — 4.2× the 400-line cap and on the eslint
 * waiver list, which §6.1 says may only shrink. Values, comments and defaults
 * below are the originals, character for character.
 *
 * revert: paste this back at the top of the modal and delete this file.
 */

/**
 * [UI-20260901-HIDERESPONSETYPE] Show the "response type" choice?
 *
 * `false` pins every new album to `media`, which is what DEFAULT_FORM already
 * used. Flip to `true` to bring the choice back — nothing else needs changing,
 * because the field never stopped being sent or stored.
 */
export const SHOW_RESPONSE_TYPE = false;

/**
 * [UI-20260901-HIDELIMITS] Show the "Flex 10 / Media 5" limit labels?
 *
 * `false` hides both — the create-mode pair and the edit-mode pair, so the
 * hint does not survive on one screen and vanish on the other.
 *
 * THE LIMITS THEMSELVES ARE UNTOUCHED. The over-count warnings still fire
 * (`media_limit_warning` / `flex_limit_warning`), which are the messages that
 * appear when a limit is actually exceeded rather than stated up front. Only
 * the standing labels are gone.
 *
 * Flip to `true` to bring them back; the i18n keys stay in place either way.
 */
export const SHOW_LIMIT_LABELS = false;

/**
 * [UI-20260904-HIDEMEDIAWARN] Show the "Media: at most 5 images" over-count
 * warning?
 *
 * `false` hides it on BOTH of its render sites — the one beside the
 * response-type picker and the standalone one that exists for when that picker
 * is hidden. Hiding one and leaving the other is how a message disappears on
 * one screen and survives on the next.
 *
 * ⚠️ THE LIMIT ITSELF IS UNTOUCHED. Five remains the ceiling wherever it is
 * enforced; only this on-screen sentence is gone. The i18n keys stay in place,
 * so flipping this back needs no other edit.
 *
 * ⚠️ Its sibling `flex_limit_warning` is deliberately NOT gated by this flag.
 * The owner asked for the media line only, and one flag hiding two unrelated
 * messages is how the second one disappears without anybody deciding to.
 */
export const SHOW_MEDIA_LIMIT_WARNING = false;

export type StepDef = { id: string; fields: readonly string[] };

export const STEP_BASIC: StepDef = {
  id: 'basic',
  fields: ['categories', 'detail', 'response_type'],
};
export const STEP_MEDIA: StepDef = { id: 'media', fields: [] };
// [FIX-20260901-SCOPEREQUIRED] `scope` is this step's error key.
export const STEP_ACCESS: StepDef = { id: 'access', fields: ['scope'] };

/**
 * [UI-20260901-OBJWIZARD] Three steps in every mode.
 *
 * It used to be two while creating, because everything the media step held was
 * a gallery and a gallery needs a saved album id — so the step rendered blank
 * and the user walked to "2 of 3" and found nothing.
 *
 * [UI-20260901-STORAGETOSTEP2] changed that: storage, the path/folder field and
 * the preview moved into this step, and all three work before an album is
 * saved. Creating must reach them — the local upload auto-saves the album first
 * and then attaches the file, so a create that could not choose its storage
 * would be pinned to the `external` default with no way to say otherwise.
 *
 * The galleries below stay gated on `resolvedMode !== 'create'`; they are the
 * part that genuinely needs an id, and the step is no longer empty without them.
 *
 * `_mode` is kept in the signature on purpose: the per-mode question is one
 * edit away from coming back, and every caller already passes it.
 */
export const stepDefsFor = (
  _mode: 'create' | 'update' | 'view',
): readonly StepDef[] => [STEP_BASIC, STEP_MEDIA, STEP_ACCESS];

export const DEFAULT_FORM: ObjectImageFormData = {
  detail: '',
  matching_tag: [],
  response_type: 'media',
  img_path: '',
  /* [UI-20260904-LOCALONLY] A NEW ALBUM IS CREATED ON INTERNAL STORAGE.
     This was `external`, which stopped making sense the moment that choice was
     withdrawn from the picker: the form would have opened on a value it no
     longer offers, the select would list `external` anyway (the rule that keeps
     a withdrawn value visible for the album holding it), and every new album
     would still be created on it — the exact opposite of "one destination".
     ⚠️ This changes where NEW albums land. Existing albums are untouched: their
     stored value is read as-is and still shown to them.
     อัลบั้มใหม่เกิดที่ ที่เก็บภายใน · ของเก่าไม่ถูกแตะ */
  storage: 'local',
  categories: [],
  /* [FEAT-20260901-OBJSCOPE] Empty = unrestricted, ON. A new album is usable by
     every group and every OA until someone narrows it on purpose — the same
     result the old auto-select-all produced, without writing 131 ids to say it. */
  group_providers: [],
  hook_ids: [],
  status: true,
};
