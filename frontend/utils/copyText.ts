/**
 * ==== [FIX-20260816-COPYHTTP] copy-to-clipboard that works on plain http ====
 *
 * WHY: every copy button called `navigator.clipboard?.writeText(...)`. The
 * Clipboard API exists ONLY in secure contexts (https / localhost) — on the
 * local stack (http://console.omnidesk.test:8088) `navigator.clipboard` is
 * `undefined`, so the optional chain made every click a silent no-op: nothing
 * copied, no toast, no error. กดแล้วเงียบเพราะ API ไม่มีอยู่จริงบน http.
 *
 * HOW: try the modern API first (it is better: async, no focus tricks); when it
 * is missing OR rejects, fall back to the legacy hidden-textarea +
 * `document.execCommand('copy')`, which still works on http in every browser
 * this dashboard targets.
 *
 * RETURNS `true` only when one of the two paths actually reported success —
 * callers use that to decide between the success and failure toast. Never throws.
 *
 * ⚠️ ==== THIS IS THE ONLY DOOR TO THE CLIPBOARD IN THIS APP ====
 * [FIX-20260830-COPYHTTP2], owner-ordered: every remaining direct caller was
 * swept into this helper — 37 call sites across 23 files (hook/flex/dynamic-tag
 * modals, the handoff and content pages, TicketSupport, Contact, the suspended
 * tray, TelegramChatIdAutomate, …). They failed in three different ways and all
 * three are handled here:
 *
 *   `navigator.clipboard?.writeText(x)`      → silent no-op, success UI lied
 *   `await navigator.clipboard.writeText(x)` → threw, so the error branch fired
 *                                              on EVERY press and the copy was
 *                                              impossible
 *   `…writeText(x).then(…)`                  → `.writeText` of `undefined` threw
 *                                              BEFORE a promise existed, so
 *                                              `.catch` never ran and the click
 *                                              handler blew up
 *
 * 🔴 ADDING A COPY BUTTON? Call `copyText` and gate the success UI on what it
 *    returns. Do NOT reach for `navigator.clipboard` — `test/clipboardSweep.
 *    value.test.ts` fails the build if you do, and that rule exists because the
 *    mistake has now been made three separate times on this codebase.
 *
 * revert: delete this file + `test/clipboardSweep.value.test.ts` +
 *         `test/copyHttpSweep.dom.test.tsx`, and restore the inline
 *         `navigator.clipboard` calls (grep the tag `[FIX-20260830-COPYHTTP2]`).
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* secure-context API failed (e.g. permission) — try the legacy path */
  }
  // `ta` is declared out here so `finally` can always reach it: the node is
  // appended BEFORE select()/execCommand run, so if either throws, an inline
  // removeChild would be skipped and the textarea would stay orphaned in the
  // DOM — one hidden leak per failed copy. `finally` makes removal
  // unconditional; `?.` covers createElement itself throwing, and `remove()`
  // (unlike removeChild) is a no-op when the node was never appended.
  let ta: HTMLTextAreaElement | undefined;
  try {
    ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    // keep it out of view without display:none (display:none breaks select())
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    return ok;
  } catch {
    return false;
  } finally {
    ta?.remove();
  }
}
