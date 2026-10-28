import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Show something for one row, then hide it again after a while.
 * ===========================================================================
 * Built for the Reply chip: the owner wants pointing at a bubble to reveal it
 * and then leave it up for a beat — "ถ้าชี้ bubble icon reply แสดงขึ้น 10 วิ" —
 * rather than the usual CSS `group-hover`, which vanishes the instant the
 * pointer drifts and makes a small target frustrating to hit.
 *
 * One id at a time on purpose: two chips lingering over different bubbles reads
 * as a glitch. Pointing at another bubble simply moves the reveal.
 *
 * Kept generic and separate because the timing rule is the whole feature here,
 * and it is the part worth testing on its own. โผล่แล้วค้างไว้ ไม่ใช่หายทันทีที่เมาส์ออก.
 *
 * revert: delete this file and its use in ChatRoomView.
 */
export const REPLY_REVEAL_MS = 10000;

export interface TimedReveal {
  /** the id currently revealed, or null */
  shownId: string | null;
  /** true when the reveal was pinned by a click and has no countdown */
  pinned: boolean;
  /** point at a row: reveal it and (re)start its countdown */
  show: (id: string) => void;
  /** click a row: pin it open, or unpin if it was already pinned */
  toggle: (id: string) => void;
  /** hide whatever is revealed (clicking empty space, or acting on it) */
  clear: () => void;
  /** convenience for the render loop */
  isShown: (id: string) => boolean;
}

/**
 * Two ways in, because the owner asked for both and they suit different hands:
 *   • POINT at a bubble → revealed, hides itself after `durationMs`
 *   • CLICK a bubble    → PINNED open with no countdown, until the same bubble
 *     is clicked again, empty space is clicked, or Reply is pressed
 * A pinned reveal ignores hovers elsewhere: a deliberate choice outranks a
 * pointer wandering across the list. ปักไว้แล้ว เมาส์ผ่านใบอื่นไม่แย่ง.
 */
export function useTimedReveal(durationMs: number = REPLY_REVEAL_MS): TimedReveal {
  const [shownId, setShownId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef(false);
  pinnedRef.current = pinned;

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const show = useCallback((id: string) => {
    if (!id || pinnedRef.current) return;
    setShownId(id);
    // Re-pointing restarts the clock rather than stacking timers, so the chip
    // never disappears while the pointer is still on it.
    stopTimer();
    timerRef.current = setTimeout(() => setShownId(null), durationMs);
  }, [durationMs, stopTimer]);

  const clear = useCallback(() => {
    stopTimer();
    setPinned(false);
    setShownId(null);
  }, [stopTimer]);

  const toggle = useCallback((id: string) => {
    if (!id) return;
    stopTimer();
    setShownId(prev => {
      const samePinned = pinnedRef.current && prev === id;
      setPinned(!samePinned);
      return samePinned ? null : id;
    });
  }, [stopTimer]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const isShown = useCallback((id: string) => shownId != null && shownId === id, [shownId]);

  return { shownId, pinned, show, toggle, clear, isShown };
}
