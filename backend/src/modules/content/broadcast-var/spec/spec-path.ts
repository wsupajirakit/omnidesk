/**
 * [FEAT-20260822-BCASTSPECCLONE] Cloned path helper.
 *
 * Copied from `system/dict-spec/flex-var-spec.ts`. The format rules match on
 * INDEX-COLLAPSED paths, so this must collapse them exactly the way upstream
 * does or a rule silently stops matching and a value ships unformatted.
 *
 * revert: delete this file with the rest of `spec/`.
 */

/** Collapse every bracketed index/key to `[]` so paths compare equal. */
export function canonicalFlexPath(path: string): string {
  return String(path).replace(/\[[^\]]*\]/g, '[]');
}

/** Every path the profile spec reads, with indexes collapsed. */
