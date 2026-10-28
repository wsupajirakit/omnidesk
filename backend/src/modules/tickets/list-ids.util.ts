/**
 * [PERF-20260822-TKTIDSFETCH] Fetch a NAMED SUBSET of the ticket list through
 * the list's own code path.
 * ============================================================================
 * WHY IT EXISTS: a realtime event that the dashboard cannot patch in place
 * falls back to `scheduleRefetch()` (TicketChat.tsx:1415), which reloads the
 * WHOLE list with `limit=all`. One new ticket therefore costs a full list load.
 * The event payload itself is not enough to build a card — it carries only
 * `_id`, `hook_id`, `job_status`, `admin_user_id`, `category`
 * (tickets.service.ts:631) — and `getTicketById` is NOT a substitute: it runs
 * `populateAttachedFiles`, not `enrichTicketRows`, so its row is missing
 * chat_room_data, customer_tags and assign_histories. A row built from it would
 * render a subtly broken card.
 *
 * So the subset is fetched through the LIST itself: same scope resolution, same
 * filters, same `enrichTicketRows`, same `formatTicket`. Only the `_id` filter
 * is added. That makes the returned row byte-identical to the row the full list
 * would have produced — by construction, not by comparing fields.
 * เอาแถวจากเส้นเดิม ไม่ใช่ประกอบเอง.
 *
 * ⚠️ NARROWING, NEVER WIDENING. `ids` is ANDed onto the filter the request
 * already built, so every other constraint — hook scope, job_status, search,
 * within_days — still applies. A ticket the caller may not see, or one that
 * does not match the active search, cannot be pulled in by naming its id.
 * This is what keeps the partial fetch a strict SUBSET of the full refetch.
 *
 * ⚠️ ABSENT = TODAY. No `ids` in the query means this file contributes nothing
 * and the request is byte-identical to before.
 *
 * revert: delete this file, the `ids` field on ListTicketsQueryDto, and the one
 *         `if (ticketIds.length)` block in `listTickets`.
 */
import { Types, isValidObjectId } from 'mongoose';

/**
 * How many ids one request may name.
 *
 * The caller batches ids over a debounce window, so the realistic count is a
 * handful; the cap is a backstop against a pathological burst turning one
 * request into an unbounded `$in`. A caller with more than this to fetch should
 * do a full refetch instead — that is cheaper than many capped round trips, and
 * it is what the dashboard does.
 */
export const TICKET_IDS_MAX = 50;

/**
 * Parse the comma-separated `ids` query param into ObjectIds.
 *
 * Returns `[]` for absent/empty/entirely-invalid input, which the caller treats
 * as "no id filter" — the legacy behaviour. Invalid entries are DROPPED rather
 * than rejected: this parameter is an optimisation, and 400-ing a list request
 * over one malformed id would take the screen down for a hint it can live
 * without. Over the cap is truncated for the same reason.
 */
export function parseTicketIds(raw: string | undefined): Types.ObjectId[] {
  if (!raw) return [];
  const out: Types.ObjectId[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!id || seen.has(id) || !isValidObjectId(id)) continue;
    seen.add(id);
    out.push(new Types.ObjectId(id));
    if (out.length >= TICKET_IDS_MAX) break;
  }
  return out;
}
