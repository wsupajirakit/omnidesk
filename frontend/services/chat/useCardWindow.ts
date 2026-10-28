import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * [FEAT-20260819-CARDWINDOW] Render 25 cards, reveal more on scroll.
 * ===========================================================================
 * WHAT THIS IS — and, more importantly, WHAT IT IS NOT
 *
 *   It windows the RENDER, not the data. The page still holds the whole list it
 *   already fetched; this only decides how much of it reaches the DOM.
 *
 *   That distinction is the entire safety argument the owner asked for:
 *     · SEARCH still spans everything — it filters the full list upstream, and
 *       this window sits below it, so a match on card 400 becomes card 3 and is
 *       simply inside the window. Nothing was left on a server page.
 *     · REALTIME still works — the list re-sorts above this hook, so a customer
 *       writing moves their card to the top and the window shows it immediately.
 *       Revealing more never re-sorts and sorting never resets the window.
 *   ค้นยังค้นได้ทั้งหมด · ของใหม่ยังเด้งขึ้นบน · แค่วาดน้อยลง
 *
 *   It does NOT reduce what the browser downloads. Cutting the payload is a
 *   separate, larger job (server-side paging) and this hook neither helps nor
 *   hinders it.
 *
 * WHY THE WINDOW MUST NOT RESET ON EVERY LIST CHANGE
 *   A realtime page rebuilds its array constantly. Resetting on a new array
 *   identity would yank an operator who had scrolled to card 90 back to card 25
 *   every time anyone anywhere sent a message. It resets on the RESET KEY — the
 *   tab, the filters, the search term — which is what actually means "a different
 *   list". เลื่อนอ่านอยู่แล้วต้องไม่โดนดีดกลับ.
 *
 * revert: delete this file and its use in the ticket page.
 */
export const CARD_WINDOW_SIZE = 25;

export interface CardWindow<T> {
  /** the slice to render */
  visible: T[];
  /** is anything still hidden? */
  hasMore: boolean;
  /** how many are hidden — for a "+N" label */
  remaining: number;
  /** reveal one more page */
  loadMore: () => void;
  /** attach to the sentinel element at the end of the list */
  sentinelRef: (node: HTMLElement | null) => void;
  /**
   * Was this row part of the batch that just appeared? Used to animate ONLY the
   * new cards. Everything already on screen must stay perfectly still — a list
   * that re-animates itself whenever anything changes is worse than no animation
   * at all, and this page re-renders on every incoming message.
   * เฉพาะใบที่เพิ่งโผล่ · ใบเดิมห้ามขยับ.
   */
  isFresh: (index: number) => boolean;
}

export function useCardWindow<T>(
  items: T[],
  /** changing this string means "a different list" and resets the window */
  resetKey: string,
  pageSize: number = CARD_WINDOW_SIZE,
): CardWindow<T> {
  const [count, setCount] = useState(pageSize);

  // A different tab/filter/search is a different list — start at the top again.
  useEffect(() => { setCount(pageSize); }, [resetKey, pageSize]);

  const total = items?.length ?? 0;
  const visible = useMemo(
    () => (items ?? []).slice(0, count),
    [items, count],
  );
  const hasMore = total > count;

  const loadMore = useCallback(() => {
    setCount((c) => (c >= total ? c : c + pageSize));
  }, [total, pageSize]);

  /* Reveal by SCROLLING, not by pressing a button: an IntersectionObserver on a
     sentinel at the end of the list. The observer is rebuilt whenever the
     callback changes so it never holds a stale `total`, and it is disconnected on
     unmount — an observer left alive on a removed node keeps the node in memory. */
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!node || typeof IntersectionObserver === 'undefined') return;
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '200px' });
    observerRef.current.observe(node);
  }, [loadMore]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  /* Where the last reveal began. A ref, not state: it must not cause a render of
     its own, and it is read during the render that follows the reveal. It resets
     with the window, so switching tab never leaves half a list marked "fresh". */
  const revealedFromRef = useRef(0);
  const prevCountRef = useRef(pageSize);
  if (count !== prevCountRef.current) {
    revealedFromRef.current = count > prevCountRef.current ? prevCountRef.current : 0;
    prevCountRef.current = count;
  }
  const isFresh = useCallback(
    (index: number) => revealedFromRef.current > 0 && index >= revealedFromRef.current,
    [],
  );

  return { visible, hasMore, remaining: Math.max(0, total - count), loadMore, sentinelRef, isFresh };
}
