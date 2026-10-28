import { ticketStackKey, type StackableTicket } from './ticketStackKey';

/**
 * [FEAT-20261020-TICKETSTACK] Fold an already sorted, already filtered list into
 * stacks of "same customer, same OA". Pure — no React, no I/O.
 *
 * Contract (each line is pinned by test/ticketStack.value.test.ts):
 *   - A stack sits where its FIRST ticket sat in the input. The input is the
 *     page's pinned-first, newest-activity-first list, so pinning and the
 *     "a new message floats the card up" rule keep working unchanged.
 *   - Inside a stack the newest-OPENED ticket (`created_at`) is the front card
 *     (owner: การ์ดหน้าสุดคือใบล่าสุด); the rest follow newest → oldest. Equal
 *     times keep the input order (Array.prototype.sort is stable).
 *   - A ticket with no usable key is a stack of one, keyed by its own `_id`.
 *   - Nothing is dropped or duplicated: Σ size === input length.
 *
 * It never touches the counts — the tab numbers are computed from the
 * ungrouped rows upstream of this, so stacking changes what is DRAWN only.
 */
export interface TicketStackGroup<T> {
  key: string;
  front: T;
  rest: T[];
  size: number;
}

export interface TicketStacks<T> {
  /** One ticket per stack, in list order — what the render window slices. */
  fronts: T[];
  /** front `_id` → its stack. */
  byFront: Map<string, TicketStackGroup<T>>;
}

const openedAt = (tk: StackableTicket): number => {
  const t = tk.created_at ? Date.parse(tk.created_at) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export function groupTicketStacks<T extends StackableTicket>(sorted: readonly T[]): TicketStacks<T> {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  for (const tk of sorted) {
    const key = ticketStackKey(tk) ?? `id|${tk._id}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(tk);
    else {
      buckets.set(key, [tk]);
      order.push(key);
    }
  }

  const fronts: T[] = [];
  const byFront = new Map<string, TicketStackGroup<T>>();
  for (const key of order) {
    const newestFirst = [...buckets.get(key)!].sort((a, b) => openedAt(b) - openedAt(a));
    const group: TicketStackGroup<T> = {
      key,
      front: newestFirst[0],
      rest: newestFirst.slice(1),
      size: newestFirst.length,
    };
    fronts.push(group.front);
    byFront.set(String(group.front._id), group);
  }
  return { fronts, byFront };
}
