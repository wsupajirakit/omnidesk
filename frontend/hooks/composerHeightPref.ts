/**
 * [FEAT-20260830-COMPOSERHPREF] the dragged input height as a per-admin
 * preference — so a height dragged today is still there after a reload or on
 * another machine (owner 30/08: "เซฟลง preference เวลาลากไว้จะได้ไม่ลืม").
 *
 * Same shape as its siblings `chatFontScale.ts` / `chatTrayMode.ts`:
 * one path constant, one normalizer, zero React in this file.
 *
 * 🔴 THE NORMALIZER IS THE SAFETY NET. `usePreference` stores and returns values
 *    verbatim — it never validates (that has bitten before). Whatever is on the
 *    wire — missing, null, a string, NaN, 9999 — must come out as a height the
 *    composer can actually use, so an admin with no stored value (or a broken
 *    one) gets the default and NOTHING breaks.
 *
 * ⚠️ The clamp bounds mirror `MIN_H = 39, MAX_H = 416` in TicketChat.tsx (the
 *    drag clamp, pinned by test/composerDragRange.test.ts). They are duplicated
 *    here because those are function-locals; test/composerHeightPref.value.test.ts
 *    cross-pins the two pairs so they cannot drift apart silently.
 *
 * revert: delete this file + its wiring in ChatInputBox (grep the tag).
 */
import { DEFAULT_COMPOSER_H } from '../pages/chat/composerHeightMemory';

/** Where it lives in the user's preferences (deep-merged server side). */
export const COMPOSER_HEIGHT_PATH = 'ui.chatComposerHeight';

/** Mirrors TicketChat's MIN_H / MAX_H — see the header. */
export const COMPOSER_HEIGHT_MIN = 39;
export const COMPOSER_HEIGHT_MAX = 416;

/**
 * Whatever was stored → a usable height. Garbage in, default out; a number in,
 * that number clamped to the drag range and rounded.
 */
export function normalizeComposerHeight(value: unknown): number {
  /* 🔴 only a number or a non-empty numeric STRING may pass. `Number(null)` is
     0 and `Number([200])` is 200 — both JS coercion traps that would let
     garbage smuggle a height in; the spec pins them to the default. */
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_COMPOSER_H;
  return Math.round(
    Math.max(COMPOSER_HEIGHT_MIN, Math.min(COMPOSER_HEIGHT_MAX, n)),
  );
}
