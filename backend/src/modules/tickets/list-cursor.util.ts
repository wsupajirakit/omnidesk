import { Types } from 'mongoose';

/**
 * [PERF-20260821-TICKETCURSOR] Keyset ("cursor") paging for the ticket list.
 *
 * WHY: `limit=all` on the closed-case tab shipped 2.7 MB on 20/08 and grows with
 * history; `skip/limit` scans and discards `skip` documents on every page. A
 * seek on (created_at desc, _id desc) costs O(page) at any depth and is stable
 * while tickets are being inserted — the right shape for a live list.
 * (Owner, 21/08: high load, "seamless to stg ห้ามพัง", realtime untouched.)
 *
 * SEAMLESS: none of this runs unless the request carries `cursor` (even empty
 * for page 1). Without it, the list builds the exact query, sort and response
 * it built before — pinned by z-test/unit/ticket-list-cursor.spec.ts.
 *
 * THE CURSOR is opaque base64url of `<epoch ms>.<_id>` — the two sort keys of
 * the last row returned. Opaque so a URL never shows a raw ObjectId and so the
 * encoding can change without the FE knowing.
 *
 * INDEX: the seek + sort need `{ hook_id:1, job_status:1, created_at:-1, _id:-1 }`
 * (the pre-existing compound index lacks the `_id` tiebreaker, which would force
 * an in-memory SORT of the whole filtered set). Declared in ticket.schema.ts.
 *
 * revert: delete this file, the `cursor` branch in `listTickets`, and the index.
 */

/** Page size ceiling in cursor mode. A caller asking for more gets this. */
export const TICKET_LIST_MAX_PAGE = 200;

/**
 * Ceiling for `limit=all` (the legacy unbounded mode). 0 = unbounded = today.
 * Kept at 0 so an FE that still sends `limit=all` keeps receiving every row;
 * raise it only AFTER every FE in front of this BE pages with a cursor.
 * เปิดเพดานทีหลัง ตอนที่ FE ทุกตัวเลิกส่ง all แล้ว.
 */
export const TICKET_LIST_HARD_MAX = 0;

export interface TicketCursor {
  created_at: Date;
  _id: string;
}

export function encodeTicketCursor(c: TicketCursor): string {
  return Buffer.from(`${c.created_at.getTime()}.${c._id}`, 'utf8').toString(
    'base64url',
  );
}

/**
 * `null`  = no cursor (first page) · `undefined` = malformed (caller answers 400)
 * · otherwise the decoded keys.
 */
export function decodeTicketCursor(
  raw: unknown,
): TicketCursor | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  let text: string;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
  const dot = text.indexOf('.');
  if (dot <= 0) return undefined;
  const msText = text.slice(0, dot);
  const id = text.slice(dot + 1);
  // Digits only — `Number()` would accept ' 12', '1e3', '0x10'. And a finite
  // number can still be out of Date range (→ Invalid Date → Mongoose CastError
  // → 500 instead of 400; found in review). Validate the Date itself.
  if (!/^\d{1,15}$/.test(msText) || !Types.ObjectId.isValid(id))
    return undefined;
  const created_at = new Date(Number(msText));
  if (Number.isNaN(created_at.getTime())) return undefined;
  return { created_at, _id: id };
}

/**
 * The seek condition for "rows strictly after `c` in (<field> desc, _id desc)".
 * [FEAT-20260826-TKTACTIVITYSORT] `field` defaults to created_at — every
 * existing caller is byte-identical; `sort=activity` passes 'updated_at'.
 * The token itself is field-agnostic (a time + an id): in activity mode the
 * time IS the row's updated_at.
 */
export function ticketCursorSeek(
  c: TicketCursor,
  field: 'created_at' | 'updated_at' = 'created_at',
): Record<string, unknown>[] {
  return [
    { [field]: { $lt: c.created_at } },
    { [field]: c.created_at, _id: { $lt: new Types.ObjectId(c._id) } },
  ];
}

/** Clamp a requested page size into [1, TICKET_LIST_MAX_PAGE]. */
export function clampTicketPage(limit: unknown, fallback = 50): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), TICKET_LIST_MAX_PAGE);
}
