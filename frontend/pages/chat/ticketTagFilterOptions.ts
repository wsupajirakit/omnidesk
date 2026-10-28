import { thLabel } from '../../components/member';
import { translateNow } from '../../i18n';

/**
 * [FEAT-20260816-TAGSHOW] Options for the 🏷 customer-tag filter on the ticket
 * page — real tags are BACK.
 *
 * Supersedes [FIX-20260814-TAGLISTHIDE] (which reduced the dropdown to the
 * clear-filter option only). The list now reflects what the BE returns on every
 * load — and since [FEAT-20260816-TAGSCOPE] the BE really does scope it by the
 * caller's OA permission (superadmin sees all), so the old
 * [FEAT-20260801-TAGGROUP] claim finally holds.
 *
 * Shape is the pre-hide original, verbatim (git 99a4574^):
 *   value = tag id (labels can repeat across groups — id is the identity)
 *   label = `🏷 ${thLabel(label)}` — same rendering the chips use
 *   first option '' = clear the filter
 *
 * Pure function in its own file (sibling of ticketIdentity.ts) so it is unit
 * tested for real instead of grep-tested inside the 3k-line page.
 * revert (back to the hidden state): make TicketChat pass a hardcoded
 * `[{ value: '', label: '🏷 ทั้งหมด' }]` again — do NOT delete this file's
 * callers silently; both states were deliberate decisions, not accidents.
 */
export interface FilterTagRow {
  _id: string;
  label: string;
  color: string | null;
}

export interface TagFilterOption {
  value: string;
  label: string;
}

export function buildTagFilterOptions(
  tags: FilterTagRow[],
): TagFilterOption[] {
  return [
    { value: '', label: translateNow('ticketui.filter.all_tags', '🏷 ป้ายทั้งหมด') },
    ...tags.map((t) => ({ value: t._id, label: `🏷 ${thLabel(t.label)}` })),
  ];
}
