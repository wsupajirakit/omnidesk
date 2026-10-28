/**
 * [REFACTOR-20260904-OBJFORMSPLIT] Which storage values the Object album picker
 * lists — lifted VERBATIM out of `ObjectImageFormModal.tsx` (was `:72-100`).
 *
 * WHY IT MOVED WITH ITS FLAG: `OFFER_GOOGLE_DRIVE` has exactly one reader, the
 * default argument below. Splitting them would put a switch in one file and its
 * only consumer in another, which is how a flag ends up flipped without anyone
 * finding the code it controls.
 *
 * WHY IT LEFT THE MODAL AT ALL: `ObjectImageFormModal.tsx` was 1,702 lines —
 * 4.2× the 400-line cap and on the eslint waiver list, which §6.1 says may only
 * shrink. This is the first cut. Behaviour is unchanged: the body below is the
 * original one, character for character.
 *
 * revert: paste both back above `type StepDef` in the modal and delete this file.
 */

/**
 * [UI-20260901-HIDEGDRIVE] Offer Google Drive as a storage choice?
 *
 * `false` drops it from the picker, so no NEW album can be created on it.
 *
 * ⚠️ ONLY THE CHOICE IS GONE. Albums already stored as `google_drive` keep
 * working exactly as before: every branch that reads `storage` is untouched,
 * and the folder-id field and its gallery still render for them.
 *
 * Flip to `true` to offer it again; nothing else needs changing.
 */
export const OFFER_GOOGLE_DRIVE = false;

/**
 * [UI-20260904-LOCALONLY] Offer "external" as a storage choice?
 *
 * `false` leaves the picker with a single value — internal storage — which is
 * what the owner asked for on 04/09: one destination, no decision to get wrong.
 *
 * ⚠️ ONLY THE CHOICE IS GONE, exactly as with Google Drive above. Albums already
 * stored as `external` keep working: nothing that READS `storage` changed, and
 * the option is still offered to such an album so its own value can display —
 * see the rule in `storageOptionsFor`, where dropping that would silently move
 * an album to local on the next save.
 *
 * Flip to `true` to offer it again; nothing else needs changing.
 */
export const OFFER_EXTERNAL = false;

/**
 * Which storage values the picker lists.
 *
 * ⚠️ An album that ALREADY holds `google_drive` still gets the option, even
 * while the choice is withdrawn. A `<select>` whose value matches no option
 * renders the first one instead — so opening such an album would show "local"
 * and pressing save would quietly move it. The option must exist for the value
 * to display truthfully.
 *
 * Exported so this rule can be tested without mounting the whole form, which
 * needs services, i18n and a gallery. One line, and getting it wrong moves
 * customer data silently, so it is pinned on its own.
 */
export function storageOptionsFor(
  current: string | undefined,
  offerGoogleDrive: boolean = OFFER_GOOGLE_DRIVE,
  offerExternal: boolean = OFFER_EXTERNAL,
): string[] {
  /* `local` is the only value always on offer. Every other one appears when it
     is either offered or already in use — the same rule for both, so a withdrawn
     choice never rewrites an album that is sitting on it. */
  const options = ['local'];
  if (offerExternal || current === 'external') options.push('external');
  if (offerGoogleDrive || current === 'google_drive') options.push('google_drive');
  return options;
}
