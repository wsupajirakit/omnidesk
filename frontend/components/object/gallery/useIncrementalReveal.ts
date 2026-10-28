/**
 * [FEAT-20260907-GALLERYINCREMENTAL] Show a first slice of a long list, and grow
 * it when the reader scrolls to the end of what is shown.
 * ===========================================================================
 * the album's stored-file grid must not render everything at once,
 * and it must load more BY ITSELF when the scroll reaches the right place — no
 * "load more" button.
 *
 * 🔴 THIS IS NOT `flex/carousel/useLazyReveal.ts`, AND IT IS NOT A COPY OF IT.
 *    They answer different questions and neither can do the other's job:
 *      · `useLazyReveal` — "this tile is ALREADY in the DOM; is it near the
 *        viewport yet, so may I mount its expensive contents?" Every tile has to
 *        exist and register a ref for it to work at all.
 *      · this hook — "how many tiles should exist in the first place?"
 *    An album with 400 files would still build 400 wrappers under the other
 *    hook. Reuse was considered and rejected on that, not on taste.
 *
 * 🔴 THE FETCH IS STILL ONE CALL FOR EVERYTHING, AND THAT IS NOT FIXED HERE.
 *    `GET /api/image-storage` takes `object_image_id` and `matching_tag` and
 *    nothing else — no `limit`, no `skip`, no cursor (checked in
 *    `omnidesk-api/src/modules/content/image-storage.controller.ts:131-141`, not
 *    assumed). Real server-side paging is a BACKEND change and was not made
 *    without asking. What this removes is the cost that actually shows on
 *    screen: mounting hundreds of `<img>`/`<video>` nodes in one commit.
 *    ยังดึงมาทีเดียวทั้งหมด เพราะ API ไม่มี paging — ที่ลดคือการ "วาด" ไม่ใช่การ "ดึง"
 *
 * ⚠️ NO IntersectionObserver (jsdom in tests, older browsers) ⇒ EVERYTHING is
 *    shown at once. "Slow but complete" beats "fast but half the album is
 *    invisible and there is no way to reach it". Same stance `useLazyReveal`
 *    took, for the same reason.
 *
 * ⚠️ The observer watches a sentinel inside the SCROLLING BOX, not the page.
 *    The grid scrolls in its own `max-h` container; against the viewport the
 *    sentinel would either never intersect or intersect immediately.
 *
 * 🔴🔴 WHY THE OBSERVER IS BUILT IN AN EFFECT AND NOT IN THE REF CALLBACK.
 *    The first version copied `useLazyReveal`'s lazy-in-the-ref-callback trick
 *    and it did not work — load-more never fired in a browser.
 *    React attaches refs CHILD FIRST: the sentinel's ref ran while the scroll
 *    box's ref had not, so `rootEl` was still null and the observer was created
 *    against the VIEWPORT; the box's ref then disconnected it, and nothing ever
 *    re-observed. `useLazyReveal` gets away with the trick because its root IS
 *    the viewport — it has no container to wait for. This hook does.
 *    Effects run after EVERY ref in the commit, so by the time this one runs
 *    both elements exist. The elements are held in STATE, not refs, so setting
 *    them re-runs the effect.
 *    ⚠️ The bug was invisible to the tests at first: the fake observer's
 *       `disconnect()` was a no-op, so the dead observer's callback still fired.
 *       `test/objectGalleryIncremental.dom.test.tsx` now has a fake that really
 *       stops, and a case asserting something is still watching after mount.
 *
 * revert: delete this file and render the whole array.
 */
import { useCallback, useEffect, useState } from 'react';

/** How many more tiles each time the end comes into view. */
export const REVEAL_CHUNK = 20;

export interface IncrementalReveal {
  /** How many items of the list may be rendered right now. */
  readonly visibleCount: number;
  /** Put on the scrolling container. */
  readonly rootRef: (el: HTMLElement | null) => void;
  /** Put on an empty element AFTER the last rendered tile. */
  readonly sentinelRef: (el: HTMLElement | null) => void;
  /** Are there items still held back? Callers use it to hide the sentinel. */
  readonly hasMore: boolean;
}

export function useIncrementalReveal(total: number): IncrementalReveal {
  const [visibleCount, setVisibleCount] = useState(REVEAL_CHUNK);
  /* STATE, not refs — the effect below has to re-run when either arrives. */
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const [sentinelEl, setSentinelEl] = useState<HTMLElement | null>(null);

  /* A different album — start the window again. Without this, opening a long
     album after a short one would leave it cut short with a sentinel that has
     already been passed. */
  useEffect(() => {
    setVisibleCount(REVEAL_CHUNK);
  }, [total]);

  const rootRef = useCallback((el: HTMLElement | null) => setRootEl(el), []);
  const sentinelRef = useCallback((el: HTMLElement | null) => setSentinelEl(el), []);

  const hasMore = visibleCount < total;

  useEffect(() => {
    if (!hasMore) return;
    if (typeof IntersectionObserver === 'undefined') {
      /* No IntersectionObserver at all (jsdom, older browsers) — show everything
         rather than trap the rest of the album behind a mechanism this
         environment does not have. Slow but complete beats fast but unreachable. */
      setVisibleCount(total);
      return;
    }
    if (!sentinelEl) return;

    const io = new IntersectionObserver(
      entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        setVisibleCount(c => (c >= total ? c : Math.min(total, c + REVEAL_CHUNK)));
      },
      /* `rootEl` may legitimately be null on the very first pass if the box has
         not mounted yet; the effect re-runs when it arrives. Passing null means
         the viewport, which is why the guard above waits for the sentinel and
         why this list includes the root. */
      { root: rootEl, rootMargin: '200px' },
    );
    io.observe(sentinelEl);
    return () => io.disconnect();
  }, [hasMore, sentinelEl, rootEl, total]);

  return {
    visibleCount: Math.min(visibleCount, total),
    rootRef,
    sentinelRef,
    hasMore,
  };
}
