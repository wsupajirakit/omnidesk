/**
 * ==== [FEAT-20261027-TANSTACK] the ONE place every query timing lives ==========
 *
 * WHAT: the defaults handed to the app's QueryClient, plus the per-screen poll
 * intervals and the few per-query exceptions. No page writes a millisecond
 * value of its own — it reads one from here. ไม่มีเลขลอยในหน้า อยู่ที่นี่ที่เดียว
 *
 * WHY THESE DEFAULTS (owner 26/10: "เหมือนเดิมทุกประการ" — freshness identical):
 *   · staleTime 0     → every mount refetches, exactly as the old useEffect did.
 *                       The cache only lets a revisit PAINT instantly while that
 *                       refetch runs; the request count does not change.
 *   · retry 0         → `services/apiCircuitBreaker.ts` already owns failure
 *                       handling; a second retry layer would re-open the
 *                       request storm that breaker was written to stop.
 *   · window focus / reconnect refetch OFF → the old pages never refetched on
 *                       focus; a page that does (visibility listener) opts in
 *                       per query, so the behaviour stays page-by-page as before.
 *   · interval polling pauses in a hidden tab (TanStack default kept). Every
 *     poller already did that by hand except the Hook list, and the owner chose
 *     to make the Hook list pause too (26/10).
 *
 * HOW TO CHANGE: edit a value here; nothing else needs to move. To make data
 * cached for longer (fewer requests), raise `staleTimeMs` — that IS a freshness
 * change and needs the owner's OK first.
 * revert: delete services/query/ and the provider in index.tsx.
 */
export const QUERY_DEFAULTS = {
  staleTimeMs: 0,
  gcTimeMs: 5 * 60_000,
  retry: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/** Poll intervals — each value is the one the screen used before the move. */
export const POLL_INTERVAL_MS = {
  hookList: 20_000,
  users: 20_000,
  groups: 20_000,
  systemConfig: 20_000,
  auditLogs: 20_000,
  autoReplies: 20_000,
  assignHistory: 20_000,
} as const;

/**
 * Per-query exceptions, each with its reason.
 * `noCache`: `services/hook/useFieldOptions.ts` is "NOT CACHED, deliberately" —
 * a stale option list must never be offered, so nothing is kept once the form
 * closes (gcTime 0) and a reopen starts from empty, as before.
 */
export const QUERY_EXCEPTIONS = {
  noCache: { gcTime: 0 },
} as const;
