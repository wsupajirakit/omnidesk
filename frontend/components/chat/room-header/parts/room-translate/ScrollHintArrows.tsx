/**
 * [FEAT-20260918-SCROLLHINT] "there is more this way" — and it goes away at the ends.
 * ============================================================================
 * Owner, 18/09: *"modal นี้ทำ arrow guide animate บอกด้วยถ้ามีพื้นที่ลงข้างล่างได้
 * (ข้างบนเหมือนกัน) ถ้าลงหรือขึ้นสุด arrow หาย dynamic"*.
 *
 * The room settings modal is four collapsible steps plus an OA panel, so on a
 * short window the fourth step and the OA summary sit below the fold with
 * nothing on screen saying so — the operator reads three steps and stops.
 *
 * ## Why it watches instead of guessing
 *
 * Whether there is more to see changes with every step the operator expands,
 * every resize, and every scroll. So the arrows read the container itself
 * (`scrollTop`, `scrollHeight`, `clientHeight`) and re-read on scroll, on
 * resize, and whenever the content resizes — the last one through
 * `ResizeObserver`, because expanding step 4 changes the height without any
 * scroll or window event firing at all. วัดจากกล่องจริง ไม่ใช่เดาจากจำนวนสเต็ป
 *
 * ## The tolerance is not decoration
 *
 * Sub-pixel layout and zoom leave `scrollTop + clientHeight` a fraction short of
 * `scrollHeight` at the true bottom, so an exact comparison leaves a down arrow
 * pointing at nothing forever — the one state the owner explicitly asked to
 * avoid. Two pixels of slack is enough to land on "no more" honestly.
 *
 * ## It never eats a click
 *
 * `pointer-events-none` on both arrows: they float over the scroll area, and a
 * button underneath one of them must still be pressable.
 *
 * Own file, per the FE anti-bloat rule — a self-contained overlay that reads one
 * ref and owns no form.
 *
 * revert: delete this file and the `<ScrollHintArrows … />` line plus the ref in
 * `RoomTranslateModal.tsx`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface ScrollHintArrowsProps {
  /** The scrolling element to watch. */
  targetRef: React.RefObject<HTMLElement | null>;
}

/** Sub-pixel slack — see the header. */
const EDGE_TOLERANCE_PX = 2;

export const ScrollHintArrows: React.FC<ScrollHintArrowsProps> = ({ targetRef }) => {
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const measure = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setCanScrollUp(scrollTop > EDGE_TOLERANCE_PX);
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - EDGE_TOLERANCE_PX);
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    /* Expanding a step changes the content height with no scroll and no window
       resize — without this the arrow would be stale until the next scroll.
       `ResizeObserver` is absent in some test environments, so its absence must
       degrade to "the other two listeners still work", never to a crash. */
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);

    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure, targetRef]);

  const scrollBy = (direction: 1 | -1) => {
    const el = targetRef.current;
    if (!el) return;
    el.scrollBy({ top: direction * Math.round(el.clientHeight * 0.7), behavior: 'smooth' });
  };

  return (
    <>
      {canScrollUp && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          data-testid="room-modal-scroll-up"
          onClick={() => scrollBy(-1)}
          className="pointer-events-auto absolute left-1/2 top-1 z-20 -translate-x-1/2 rounded-full bg-white/90 p-1 shadow-md ring-1 ring-gray-200 animate-bounce dark:bg-gray-700/90 dark:ring-gray-600"
        >
          <ChevronUp className="h-4 w-4 text-sky-600 dark:text-sky-300" />
        </button>
      )}
      {canScrollDown && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          data-testid="room-modal-scroll-down"
          onClick={() => scrollBy(1)}
          className="pointer-events-auto absolute left-1/2 bottom-1 z-20 -translate-x-1/2 rounded-full bg-white/90 p-1 shadow-md ring-1 ring-gray-200 animate-bounce dark:bg-gray-700/90 dark:ring-gray-600"
        >
          <ChevronDown className="h-4 w-4 text-sky-600 dark:text-sky-300" />
        </button>
      )}
    </>
  );
};
