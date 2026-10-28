/**
 * [FEAT-20260830-MUTEALERT] per-admin switch for the "bot stopped answering"
 * header alert — the red glow + numeric badge on `SuspendedTrayButton`.
 *
 * Owner's design (30/08, all questions closed):
 *   · two-way switch: `alert` = red glow + badge as today · `muted` = no glow,
 *     no bounce, no number — the button stays, the tray still opens, the DATA
 *     is untouched, other admins see everything as before
 *   · header only — the red `!` avatar mark in chat is NOT governed by this
 *   · per THIS admin, stored as a preference; every press is confirmed
 *
 * Same shape as its siblings (`chatTrayMode.ts`, `composerHeightPref.ts`):
 * one path constant, one normalizer, zero React.
 *
 * 🔴 THE NORMALIZER IS THE SAFETY NET. `usePreference` stores and returns values
 *    verbatim — it never validates. Whatever is on the wire (missing, null,
 *    "banana", 1, {}) must resolve to `alert`, so an admin with no stored value
 *    keeps today's behaviour exactly and nothing can break the header.
 *
 * revert: delete this file + the blocks tagged [FEAT-20260830-MUTEALERT] in
 *         SuspendedTrayButton.tsx / SuspendedTray.tsx + the i18n keys.
 */

/** Where it lives in the user's preferences (deep-merged server side). */
export const SUSPENDED_ALERT_MODE_PATH = 'ui.suspendedAlertMode';

export const SUSPENDED_ALERT_MODES = ['alert', 'muted'] as const;
export type SuspendedAlertMode = (typeof SUSPENDED_ALERT_MODES)[number];

/** Everyone starts here — and every broken value lands here too. */
export const SUSPENDED_ALERT_DEFAULT: SuspendedAlertMode = 'alert';

/** Whatever was stored → a valid mode. Garbage in, `alert` out. */
export function normalizeSuspendedAlertMode(value: unknown): SuspendedAlertMode {
  return value === 'muted' ? 'muted' : SUSPENDED_ALERT_DEFAULT;
}

/** True when this admin has switched the header alert off. */
export const isSuspendedAlertMuted = (value: unknown): boolean =>
  normalizeSuspendedAlertMode(value) === 'muted';
