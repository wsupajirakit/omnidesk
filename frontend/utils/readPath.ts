/**
 * ==== [REFACTOR-20260905-READPATHTRUTH] one reader for "value at a dot path" ====
 *
 * A census on 05/09 found this exact idea written three times in this repo:
 *   - components/dynamic-tag/DynamicTagPreviewModal.tsx:31 and :119 (same file, twice)
 *   - hooks/usePreferences.ts:6
 *   - utils/memberSearchText.ts:57-66 (`pick` — a fourth, differently-shaped variant,
 *     found while investigating this task; left untouched, see "NOT merged" below)
 *
 * They were NOT interchangeable. Measured with a throwaway script (not committed)
 * exercising all three against nested objects, missing steps, and falsy
 * intermediates:
 *
 *   `acc && acc[part]`                          (DynamicTagPreviewModal, both copies)
 *   `acc == null ? undefined : acc[k]`          (usePreferences — this file's contract)
 *   `acc && typeof acc === 'object' ? acc[k] : undefined`   (memberSearchText's `pick`)
 *
 * All three agree on the ordinary cases: plain nested reads, a genuinely MISSING
 * key at any depth, and a falsy LEAF value (0/''/false as the last segment) — the
 * value is returned untouched because there is nothing left to walk past it.
 *
 * They diverge only on a falsy-but-PRESENT INTERMEDIATE — a step that exists but
 * is not an object, with more path left to walk (e.g. `{a: 0}` read at `"a.b"`):
 * `acc && acc[part]` short-circuits on the `0`/`''`/`false`/`NaN`/`null` itself
 * and returns THAT VALUE, not `undefined` — a side effect of reusing `&&` as both
 * "should I keep going" and "what do I return", not a designed choice. The other
 * two treat "not an object, but more path left" as "not found" and return
 * `undefined`. This file adopts the LATTER contract:
 *
 *   GRAMMAR:  dot-separated segments (`"a.b.c"`); each segment indexes the
 *             current value as a plain string key — works for object keys and,
 *             incidentally, for arrays/strings via a numeric-string segment
 *             (`"a.0"`). No bracket syntax, no escaping a literal dot in a key,
 *             no wildcards. (None of the three prior versions supported more
 *             than this either.) An empty-string path (`""`) is NOT special-cased
 *             to mean "the root" — it looks up a literal `""` key, which is
 *             `undefined` on any real object. One of the two DynamicTagPreviewModal
 *             copies had an `if (!p) return o` guard for this; it is dropped here
 *             because its only call site always passed a non-empty path (proven
 *             below), so the guard was unreachable dead code, not a real contract.
 *   MISSING:  any step that cannot be walked — the key is absent, OR the current
 *             value is not a non-null object/array/string with more path left —
 *             returns `undefined`. Never throws; a non-string `path` also yields
 *             `undefined` rather than the `TypeError` a bare `path.split` would
 *             raise (both original DynamicTagPreviewModal copies wrapped their
 *             call in try/catch for exactly this; that safety net is now inside
 *             the reader itself instead of duplicated at every call site).
 *   WHY:      two of the three real implementations already agreed on this before
 *             this file existed, and it is the more defensible contract for a
 *             function whose job is "did this path resolve" — the honest answer
 *             when it did not is "not found," not a value that only exists
 *             because of WHICH falsy primitive happened to sit in the middle.
 *
 * ── Callers repointed, and whether behaviour changed ──────────────────────────
 * - hooks/usePreferences.ts: zero change — it WAS this exact algorithm already.
 *   All 12 real `usePreference(...)` paths in the app (App.tsx, TicketSupport.tsx,
 *   TicketChat.tsx, SuspendedTrayButton.tsx) are static literals through `ui.*` /
 *   `tables.tickets.*` namespace objects populated by `deepMerge` from a JSON
 *   preferences blob — an intermediate there is always an object or simply
 *   absent (a brand-new account with no saved prefs), never a bare falsy
 *   primitive. Measured directly: no divergence for any of them, populated or
 *   empty.
 * - DynamicTagPreviewModal.tsx:119 (`handleCopyPath`, the "Copy Path" buttons):
 *   safe by construction, not just by luck. `generateJsonLines` only ever
 *   extends a path past a key whose value passed `typeof value === 'object' &&
 *   value !== null` (see that function) — so every path string it hands back
 *   is PROVEN to have a non-null object at every position but the last, in the
 *   SAME object being read back. `test/readPathSingleTruth.test.ts` pins this
 *   invariant against adversarial data (false/0/''/null mixed through a tree).
 * - DynamicTagPreviewModal.tsx:31 (inside `generateJsonLines`, the diff-compare
 *   branch feeding `diffContent`): this is the one spot where the divergence
 *   is REACHABLE in principle, because it reads `diffObj` — a DIFFERENT object
 *   than the one `currentPath` was built from, so the invariant above does not
 *   cover it. In practice it is dead: `diffContent` is a typed, destructured
 *   prop but grep across the whole repo shows NO real call site ever passes it
 *   (both render sites in DynamicTagFormModal.tsx omit it; CustomTools.tsx only
 *   names it in a comment). No real input hits the difference today. Repointed
 *   anyway, so the two copies in that file truly become one — if `diffContent`
 *   is ever wired up, it will get the same "not found ⇒ undefined" contract as
 *   everywhere else, which is documented here specifically so whoever wires it
 *   up next knows this was a deliberate choice, not an oversight.
 *
 * ── NOT merged: utils/memberSearchText.ts:57-66 (`pick`) ──────────────────────
 * Out of this task's edit scope, and closer to this contract than to the one
 * being replaced (undefined on a falsy intermediate) — but not byte-identical:
 * `pick` also refuses to descend into a string PRIMITIVE at all (its
 * `typeof acc === 'object'` guard rejects strings, so `{a:"hi"}` read at `"a.0"`
 * is `undefined` there, vs `"h"` here and in the old DynamicTagPreviewModal
 * code). Left as-is; noting it here so a future consolidation of that file
 * knows the one behavioural gap to check.
 *
 * revert: delete this file; restore each caller's own inline
 *   `path.split('.').reduce(...)` from git history.
 */
export function readPath(obj: unknown, path: string): unknown {
  if (typeof path !== 'string') return undefined;
  try {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc == null) return undefined;
      return (acc as Record<string, unknown>)[key];
    }, obj);
  } catch {
    return undefined;
  }
}
