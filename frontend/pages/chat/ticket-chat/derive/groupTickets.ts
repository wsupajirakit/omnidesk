/**
 * [REFACTOR-20261027-TCSPLIT] The bodies of TicketChat's `groupedEndedTickets` and
 * `groupedBotTickets` useMemos — the ปิดเคส / บอทดูแล rows folded per customer, newest first,
 * pinned rooms on top. Moved verbatim; pure. The useMemos and their deps stay in the page.
 * revert: paste each body back into its useMemo in the page.
 */
import { byPinnedFirst, type TicketEntry } from '../../../../services/chat';
import { ticketStackKey } from '../../ticket-stack';
import { getTicketUserKey } from '../../ticketIdentity';
import type { StatusTab } from '../constants';

export function groupEndedTickets({
  statusTab, visibleTickets, ticketStackOn, pinnedRooms,
}: {
  statusTab: StatusTab;
  visibleTickets: TicketEntry[];
  ticketStackOn: boolean;
  pinnedRooms: string[];
}) {
  if (statusTab !== 'ended') return [];

  const map = new Map<string, TicketEntry[]>();
  for (const tk of visibleTickets) {
    /* [FEAT-20261020-TICKETSTACK] flag on ⇒ one card per customer PER OA (falls back to the
       customer key when a row has no OA/member). Off ⇒ the customer key, as before. */
    const key = (ticketStackOn && ticketStackKey(tk)) || getTicketUserKey(tk);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tk);
  }

  const out: Array<{
    key: string;
    /* [FEAT-20261020-TICKETSTACK] pins are stored per customer (getTicketUserKey) — kept apart
       from the group key so an OA-split card still sorts as pinned. Off ⇒ pinKey === key. */
    pinKey: string;
    userId: string;
    hookId: string;
    latest: TicketEntry;
    tickets: TicketEntry[];
  }> = [];

  map.forEach((tickets, key) => {
    tickets.sort((a, b) => {
      const timeA = a.resolved_at ? new Date(a.resolved_at).getTime() : (a.updated_at ? new Date(a.updated_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0));
      const timeB = b.resolved_at ? new Date(b.resolved_at).getTime() : (b.updated_at ? new Date(b.updated_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0));
      return timeB - timeA;
    });

    out.push({
      key,
      pinKey: getTicketUserKey(tickets[0]),
      userId: key,
      hookId: tickets[0]?.line_oa_hook_id || tickets[0]?.hook_id || 'all',
      latest: tickets[0],
      tickets,
    });
  });

  /* [FEAT-20260811-CHATPIN] ห้องที่ปักไว้ขึ้นก่อน — `byPinnedFirst` ครอบ comparator เดิม
     ไม่แก้ตัวเทียบเวลา ⇒ ลำดับภายในกลุ่มที่ปัก/ไม่ปักเหมือนเดิมเป๊ะ */
  out.sort(byPinnedFirst<typeof out[number]>(pinnedRooms, (g) => g.pinKey)((a, b) => {
    const timeA = a.latest.resolved_at ? new Date(a.latest.resolved_at).getTime() : (a.latest.updated_at ? new Date(a.latest.updated_at).getTime() : 0);
    const timeB = b.latest.resolved_at ? new Date(b.latest.resolved_at).getTime() : (b.latest.updated_at ? new Date(b.latest.updated_at).getTime() : 0);
    return timeB - timeA;
  }));

  return out;
}


export function groupBotTickets({
  statusTab, visibleTickets, pinnedRooms,
}: {
  statusTab: StatusTab;
  visibleTickets: TicketEntry[];
  pinnedRooms: string[];
}) {
  if (statusTab !== 'bot') return [];

  const map = new Map<string, TicketEntry[]>();
  for (const tk of visibleTickets) {
    const key = getTicketUserKey(tk);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tk);
  }

  const out: TicketEntry[] = [];
  map.forEach((tickets) => {
    tickets.sort((a, b) => {
      const timeA = a.resolved_at ? new Date(a.resolved_at).getTime() : (a.updated_at ? new Date(a.updated_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0));
      const timeB = b.resolved_at ? new Date(b.resolved_at).getTime() : (b.updated_at ? new Date(b.updated_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0));
      return timeB - timeA;
    });
    out.push(tickets[0]);
  });

  /* [FEAT-20260811-CHATPIN] ดูคำอธิบายที่ groupedEndedTickets — key ตัวเดียวกัน */
  out.sort(byPinnedFirst<TicketEntry>(pinnedRooms, getTicketUserKey)((a, b) => {
    const timeA = a.resolved_at ? new Date(a.resolved_at).getTime() : (a.updated_at ? new Date(a.updated_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0));
    const timeB = b.resolved_at ? new Date(b.resolved_at).getTime() : (b.updated_at ? new Date(b.updated_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0));
    return timeB - timeA;
  }));

  return out;
}
