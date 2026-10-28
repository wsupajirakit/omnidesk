/* ==== [FEAT-20260826-ACTIVEPAGING] 📖 omnidesk-api docs/bottleneck_26_aug.md (S8)
 * What the OPEN tab asks the server for — one builder, two shapes, one switch.
 * ============================================================================
 * SWITCH: `TC_ACTIVE_PAGING` — **DEFAULT ON since 26/08 (paging phase 1.2)**.
 * Owner order after the parity gate passed 36/36 at 2,087 active rows on a
 * cloned DB (omnidesk-api docs/bottleneck_26_aug.md §S8-gate) AND the badge
 * freshness hole was closed first (phase 1.1, badgeCountsRefresh pins).
 * `'false'` is the per-browser kill switch — set it and this returns the
 * byte-identical legacy request (`{job_status:'0,1', limit:'all', within_days,
 * search}`). Same semantics as `TC_LIST_PAGING` on the closed tab (its catch
 * returns true too). History: shipped OFF (`=== 'true'`) 26/08 morning-noon
 * during the proof window; flipped that evening.
 *
 * ON ⇒ cursor paging in ACTIVITY order with the layer-3 server surface:
 *   sort=activity   (S7 — updated_at walk; page 1 = the working set)
 *   counts=''       (S6 — tab_counts becomes the badge truth)
 *   oa / tag / tier (S5 — the screen's own filters, server-side)
 *
 * ⚠️ CATEGORY BLOCKS PAGING BY DESIGN. Every category option is a MATCH
 * FUNCTION over several values ("ชำระค่างวด" = payment|รับยอด; "อื่นๆ" includes
 * null and negation — TicketChat.tsx CATEGORIES_LEGACY/NARROW), so no option
 * maps onto the server's exact-match `category` param. A category-filtered
 * request therefore falls back to the FULL legacy fetch — completeness over
 * speed, recorded honestly. A server-side bucket param is the named follow-up.
 * มีตัวกรองหมวด = วิ่งเส้นเดิมทั้งดุ้น เคสครบมาก่อนความเร็ว.
 *
 * revert: delete this file; put the literal legacy object back in fetchActive.
 */

export const ACTIVE_PAGE_SIZE = 100;

export function activePagingEnabled(): boolean {
  // [paging phase 1.2] flipped 26/08: `!== 'false'` = everyone ON, 'false' opts out.
  // catch → true mirrors TC_LIST_PAGING (ticketService.ts): storage unreadable ⇒
  // cannot read an opt-out ⇒ the default applies.
  try {
    return localStorage.getItem('TC_ACTIVE_PAGING') !== 'false';
  } catch {
    return true;
  }
}

export interface ActiveListInput {
  cursor: string;
  withinDays: number | undefined;
  search: string | undefined;
  oa?: string | undefined;
  tag?: string | undefined;
  tier?: string | undefined;
  /** the RAW label — its presence alone forces the legacy path (see header) */
  categoryLabel?: string | undefined;
}

export function activeListParams(
  input: ActiveListInput,
  pagingEnabled: boolean = activePagingEnabled(),
): Record<string, unknown> {
  if (!pagingEnabled || input.categoryLabel) {
    // the exact object fetchActive sent before this file existed — byte for byte
    return {
      job_status: '0,1',
      limit: 'all',
      within_days: input.withinDays,
      search: input.search,
    };
  }
  return {
    job_status: '0,1',
    limit: ACTIVE_PAGE_SIZE,
    cursor: input.cursor,
    sort: 'activity',
    counts: '',
    within_days: input.withinDays,
    search: input.search,
    ...(input.oa ? { oa: input.oa } : {}),
    ...(input.tag ? { tag: input.tag } : {}),
    ...(input.tier ? { tier: input.tier } : {}),
  };
}
