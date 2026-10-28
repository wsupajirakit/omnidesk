/**
 * useCardSwitchLoading.ts — the short skeleton flash fired when the selected
 * ticket changes, so the previous card's data never lingers on screen.
 *
 * WHAT: moved verbatim from `pages/chat/TicketChat.tsx` (module scope, right
 * below `DetailSkeleton`).
 *
 * WHY: a 13-code-line hook that owns its own `useState`/`useRef`/`useEffect`
 * and reads nothing but its `key` argument. It is a hook, not page code.
 *
 * ⚠️ The hook is moved WHOLE — the `useState` and the `useEffect` travel
 * together inside it and are still called from exactly one place
 * (`PersonalPanel`), in the same position in that component's hook order. No
 * state was lifted into or out of a component, so render and effect timing are
 * unchanged (`dev-local` §6.4).
 *
 * revert: paste the function back into the page above the two-panels warning,
 *   drop the line from `./index.ts` and the import in `./PersonalPanel.tsx`,
 *   delete this file.
 */
import { useEffect, useRef, useState } from 'react';

// A short skeleton flash whenever the selected ticket changes, so stale data from
// the previous card never lingers while the new card's data settles.
export function useCardSwitchLoading(key: string | undefined) {
  const [loading, setLoading] = useState(false);
  const prev = useRef(key);
  useEffect(() => {
    if (prev.current !== key) {
      prev.current = key;
      setLoading(true);
      const t = setTimeout(() => setLoading(false), 350);
      return () => clearTimeout(t);
    }
  }, [key]);
  return loading;
}
