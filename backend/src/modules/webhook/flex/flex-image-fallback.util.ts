/**
 * Fallback image for flex cards.
 * Ported from legacy `src/config/flexImageFallback.js` [FEAT-20260804-FLEXIMGFALLBACK].
 *
 * 🎯 To change the fallback picture, edit FALLBACK_IMAGE_URL below — one line,
 * nothing else in the system holds a second copy.
 *
 * The problem it solves: a card writes an image url as a variable
 * (`{{promo_img_path}}`). After substitution the value may be unusable — empty,
 * `'-'` (the standard "no data" value), a raw json path with no scheme
 * (`img.example.net/x.png`), or an unresolved `{{...}}`. LINE then rejects the
 * WHOLE message with 400 and the customer gets no card at all, even though the
 * rest of the card was fine. Same failure mode as the empty-text case in
 * [FIX-20260801-FLEXEMPTYTEXT].
 *
 * ⚠️ Only the url SHAPE is checked — no request is made to see whether it loads.
 *    Deliberate: this runs on the reply path, and one HTTP call per image per
 *    message would be slower and more fragile than the problem. A dead link
 *    renders as an empty frame in LINE, which still beats a 400.
 */

/** 🎯 The fallback picture — change here, once. */
export const FALLBACK_IMAGE_URL =
  'https://cpsurge.cpli.co.th/images/2026/bg/BG2.png';

/**
 * Can LINE accept this url as an image?
 *
 * LINE's rules: https only, at most 2000 characters.
 * ⚠️ Plain `http://` fails too — LINE requires https.
 */
export function isUsableImageUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u || u.length > 2000) return false;
  if (u.includes('{{') || u.includes('}}')) return false; // unresolved variable
  if (!/^https:\/\//i.test(u)) return false;
  // A real host must follow https://, not a bare "https://".
  return /^https:\/\/[^\s/]+\./i.test(u);
}

/** Always returns a usable url — the original when it works, else the fallback. */
export function safeImageUrl(url: unknown): string {
  return isUsableImageUrl(url) ? String(url).trim() : FALLBACK_IMAGE_URL;
}
