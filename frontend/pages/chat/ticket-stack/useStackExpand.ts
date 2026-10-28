import { useCallback, useState } from 'react';

/**
 * [FEAT-20261020-TICKETSTACK] Which stacks are open. Every stack starts folded.
 *
 * `resetKey` is the list's identity (TicketChat's `cardWindowKey`: tab, group,
 * OA, filters, search, date scope). A different list folds everything again; a
 * realtime rebuild of the SAME list keeps what the operator opened — same rule
 * as the card window, so a message from someone else never snaps a stack shut.
 *
 * The reset happens during render (React's "adjust state when a prop changes"
 * pattern), not in an effect, so a stale open stack is never painted for a frame.
 */
export interface StackExpand {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}

export function useStackExpand(resetKey: string): StackExpand {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [listKey, setListKey] = useState(resetKey);
  if (listKey !== resetKey) {
    setListKey(resetKey);
    setOpen(new Set());
  }

  const isOpen = useCallback((key: string) => open.has(key), [open]);
  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return { isOpen, toggle };
}
