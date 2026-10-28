// [FEAT-20260905-MEDIAPICKER] Utility functions for Media Picker formatting and actions.

// [FIX-20260905-MPCLIPBOARD] the one copy helper — see the note on
// `copyMediaLinkToClipboard` below.
import { copyText } from '../../utils/copyText';

/**
 * Format bytes into human-readable size (e.g. 2.4 MB, 450 KB)
 */
export const formatFileSize = (bytes?: number | null): string => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

/**
 * Format ISO date string into clean date (e.g. "05 Sep 2026", matching "20 May 2017" mockup)
 */
export const formatMediaDate = (dateVal?: string | Date | null): string => {
  if (!dateVal) return '-';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
};

/**
 * Resolves a URL to an accessible absolute URL for the current environment.
 * Normalizes relative or mismatched origin/port `/uploads/` paths to the current window.location.origin.
 */
export const resolveAbsoluteMediaUrl = (url?: string | null): string => {
  if (!url) return '';
  const trimmed = url.trim();

  // If URL contains /uploads/, ensure it resolves to the current origin so it works across all ports
  if (typeof window !== 'undefined' && trimmed.includes('/uploads/')) {
    const uploadPath = trimmed.substring(trimmed.indexOf('/uploads/'));
    return `${window.location.origin}${uploadPath}`;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  if (typeof window !== 'undefined' && trimmed.startsWith('/')) {
    return `${window.location.origin}${trimmed}`;
  }

  return trimmed;
};

/**
 * [FIX-20260905-MPCLIPBOARD] Delegates to `utils/copyText`. It does NOT talk to
 * `navigator.clipboard` itself, and that is enforced by
 * `test/clipboardSweep.value.test.ts` — which this file failed on the merged
 * tree, so the rule caught it exactly as designed.
 *
 * WHY IT MATTERED BEYOND THE RULE: the Clipboard API exists only in a secure
 * context and this dashboard is served over plain http
 * (console.omnidesk.test:8088), so `navigator.clipboard` is `undefined` there.
 * The version this replaces guarded with `navigator?.clipboard?.writeText`, so
 * it fell through to its own textarea fallback rather than throwing — but that
 * fallback was a second copy of `copyText`'s body, and it removed the textarea
 * INLINE: if `select()` or `execCommand` threw, the node stayed orphaned in the
 * DOM, one leak per failed copy. `copyText` removes it in a `finally`.
 *
 * One helper, one rule. ห้ามเขียน copy ซ้ำเอง — เรียกของกลาง
 * revert: inline the modern-API + textarea pair back here and the sweep fails.
 */
export const copyMediaLinkToClipboard = async (
  rawUrl: string,
): Promise<boolean> => {
  const fullUrl = resolveAbsoluteMediaUrl(rawUrl);
  if (!fullUrl) return false;
  return copyText(fullUrl);
};
