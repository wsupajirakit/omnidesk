/**
 * ==== [FEAT-20260817-GROUPBULKSTATUS] selection maths + the result sentence ====
 *
 * Pure helpers for the Groups bulk bar. Two reasons they live here rather than
 * inside the page:
 *   · the page cannot be rendered in vitest (it fetches on mount and polls), so
 *     logic written inline is untestable — the same reason
 *     `pages/chat/directTicketBadge.ts` exists;
 *   · `Groups.tsx` sits against the 400-line ESLint ceiling, and that waiver list
 *     may only shrink.
 *
 * revert: inline these three functions back into Groups.tsx and delete this file
 * with its spec.
 */

/** True when every row currently on screen is ticked (drives select-all). */
export function allSelected(
  rowIds: readonly string[],
  selected: ReadonlySet<string>,
): boolean {
  // An empty page must NOT read as "all selected", or the header checkbox would
  // show ticked with nothing to act on.
  return rowIds.length > 0 && rowIds.every((id) => selected.has(id));
}

/** Add or remove one id, returning a NEW set (React state must not be mutated). */
export function toggleOne(
  selected: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Select-all for the CURRENT page only.
 *
 * Ticks outside `rowIds` are preserved: the caller clears the selection whenever
 * the page or filter changes, so anything still in the set belongs to the page
 * being looked at. Toggling off removes only this page's ids for the same reason.
 */
export function toggleAllOnPage(
  selected: ReadonlySet<string>,
  rowIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  if (allSelected(rowIds, selected)) rowIds.forEach((id) => next.delete(id));
  else rowIds.forEach((id) => next.add(id));
  return next;
}

export interface BulkStatusResult {
  matched: number;
  modified: number;
  unchanged: number;
}

/**
 * What actually happened, not what was asked.
 *
 * The server skips groups already in the target state, so "20 selected" can be
 * "3 changed, 17 already were". Saying only "done" would hide that, and the
 * operator would go looking for a bug that is not there.
 * บอกผลจริง — เปลี่ยนกี่กลุ่ม เดิมอยู่แล้วกี่กลุ่ม.
 */
export function bulkStatusMessage(
  res: BulkStatusResult,
  stateLabel: string,
  alreadyLabel = 'เดิมอยู่แล้ว',
): string {
  const head = `${stateLabel} · ${res.modified} / ${res.matched}`;
  return res.unchanged > 0 ? `${head} (${alreadyLabel} ${res.unchanged})` : head;
}
