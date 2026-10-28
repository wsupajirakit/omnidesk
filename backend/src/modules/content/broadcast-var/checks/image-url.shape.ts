/**
 * [FEAT-20260822-BCASTIMGSHAPE] Is this URL one LINE will accept as an image?
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock — no request is made here.
 *
 * TWO DIFFERENT FAILURES, AND ONLY ONE OF THEM IS FATAL:
 *   A · the URL is malformed (empty, `-`, an unsubstituted `{{...}}`, http://,
 *       no host, too long) → LINE rejects the WHOLE message with 400 and the
 *       customer gets nothing at all. **This file prevents A.**
 *   B · the URL is well-formed but the file is gone (404, wrong host) → LINE
 *       accepts the message and the app draws an empty frame. Catching B needs
 *       a network call and is a separate, separately-switchable checker.
 *
 * The rules mirror LINE's: https only, at most 2000 characters, a real host.
 * They are re-stated here rather than imported, because this folder must not
 * depend on the original var path (เจ้าของ: "ทำแค่ฝั่งเรา ห้ามยุ่งกับ original").
 * ⚠️ A spec pins our answers against the original's on a shared table of URLs,
 *    so the two cannot drift apart silently.
 *
 * revert: delete this file with the rest of `checks/`.
 */
import { BROADCAST_FALLBACK_IMAGE_URL } from './image-fallback.config';

const MAX_URL_LEN = 2000;

/** Would LINE accept this as an image URL? Shape only — nothing is fetched. */
export function isUsableImageUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u || u.length > MAX_URL_LEN) return false;
  // An unsubstituted variable is the single most common cause of a 400 here.
  if (u.includes('{{') || u.includes('}}')) return false;
  if (!/^https:\/\//i.test(u)) return false;
  // A real host must follow https://, not a bare scheme.
  return /^https:\/\/[^\s/]+\./i.test(u);
}

/** Always returns something LINE accepts: the original, or the fallback. */
export function safeImageUrl(url: unknown): string {
  return isUsableImageUrl(url)
    ? String(url).trim()
    : BROADCAST_FALLBACK_IMAGE_URL;
}

/** Did this value have to be replaced? For the run's history row. */
export function wasImageReplaced(url: unknown): boolean {
  return !isUsableImageUrl(url);
}
