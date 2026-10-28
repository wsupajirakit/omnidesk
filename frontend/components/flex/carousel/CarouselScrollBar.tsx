/**
 * [FEAT-20260831-CAROUSELBAR] The carousel's own scroll bar — big enough to grab.
 * ===========================================================================
 * เจ้าของสั่ง 31/08: *"slider bar แบบ carousel ขยายใหญ่ขึ้นและทำสวย ๆ และแสดงทั้งบนและล่าง"*.
 *
 * The strip relied on the browser's own horizontal scrollbar, which on macOS is
 * an overlay that FADES OUT when the pointer stops — so on a page of 260px
 * tiles there was often nothing on screen saying "this scrolls", let alone
 * anything to drag. This is a real control: always visible, thick enough to hit,
 * and rendered ABOVE and BELOW the strip so it is in reach wherever the eye is.
 *
 * ⚠️ IT DOES NOT OWN THE SCROLL POSITION. The strip is still the source of truth
 *    — this reads `scrollLeft` on scroll and writes it on drag, so the arrows,
 *    the point round, a trackpad swipe and this bar can never disagree. Keeping a copy
 *    of the position in state here is how a scrollbar starts lying.
 * ⚠️ NO STATE WHEN THERE IS NOTHING TO SCROLL: a strip narrower than its box
 *    renders no bar at all rather than a full-width one that does nothing.
 *
 * Own file per the FE anti-bloat rule (§6.1): a self-contained control that
 * reads one ref and holds no form state. แยกไฟล์ตั้งแต่แรก.
 *
 * revert: delete this file and its two uses in `FlexCardCarousel`.
 */
import React from 'react';

interface Props {
  /** The scrolling strip. Read on scroll, written on drag — never mirrored. */
  stripRef: React.RefObject<HTMLDivElement | null>;
  /** `top` sits above the strip, `bottom` below it — same control, twice. */
  place: 'top' | 'bottom';
}

export const CarouselScrollBar: React.FC<Props> = ({ stripRef, place }) => {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = React.useState({ size: 0, pos: 0 });
  const dragging = React.useRef(false);

  /* Read the strip's real geometry. Called on scroll, on resize and once on
     mount — a bar that measures only once is wrong the moment a card loads. */
  const measure = React.useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) {
      setRatio({ size: 0, pos: 0 });
      return;
    }
    setRatio({
      size: Math.max(el.clientWidth / el.scrollWidth, 0.08),
      pos: el.scrollLeft / max,
    });
  }, [stripRef]);

  React.useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    /* Cards arrive lazily, so the strip gets wider after the first paint. */
    const t = window.setTimeout(measure, 300);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.clearTimeout(t);
    };
  }, [measure, stripRef]);

  /** Point on the track → scroll position. Used by both click and drag. */
  const seek = React.useCallback(
    (clientX: number) => {
      const el = stripRef.current;
      const track = trackRef.current;
      if (!el || !track) return;
      const box = track.getBoundingClientRect();
      const thumb = box.width * ratio.size;
      const usable = Math.max(box.width - thumb, 1);
      const x = Math.min(Math.max(clientX - box.left - thumb / 2, 0), usable);
      el.scrollLeft = (x / usable) * (el.scrollWidth - el.clientWidth);
    },
    [ratio.size, stripRef],
  );

  React.useEffect(() => {
    const move = (e: PointerEvent) => dragging.current && seek(e.clientX);
    const up = () => (dragging.current = false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [seek]);

  // nothing to scroll ⇒ no control, rather than a decorative full-width bar
  if (ratio.size === 0) return null;

  return (
    <div
      ref={trackRef}
      data-testid={`flex-carousel-bar-${place}`}
      onPointerDown={(e) => {
        dragging.current = true;
        seek(e.clientX);
      }}
      className={`group/bar relative h-3 w-full cursor-pointer rounded-full bg-slate-200/70 ring-1 ring-inset ring-slate-300/60 transition-colors hover:bg-slate-200 ${
        place === 'top' ? 'mb-3' : 'mt-3'
      }`}
    >
      <div
        data-testid={`flex-carousel-thumb-${place}`}
        className="pointer-events-none absolute inset-y-0 rounded-full bg-gradient-to-r from-primary-400 to-primary-600 shadow-sm transition-[width,left] duration-75 group-hover/bar:from-primary-500 group-hover/bar:to-primary-700"
        style={{
          width: `${ratio.size * 100}%`,
          left: `${ratio.pos * (100 - ratio.size * 100)}%`,
        }}
      />
    </div>
  );
};
