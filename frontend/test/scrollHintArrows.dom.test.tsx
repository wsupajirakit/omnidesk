/**
 * [FEAT-20260918-SCROLLHINT] The arrow has to disappear at the ends.
 * =============================================================================
 * Owner, 18/09: *"ทำ arrow guide animate บอกด้วยถ้ามีพื้นที่ลงข้างล่างได้ (ข้างบน
 * เหมือนกัน) ถ้าลงหรือขึ้นสุด arrow หาย dynamic"*.
 *
 * An arrow that stays visible at the bottom is worse than no arrow: it points at
 * nothing and teaches the operator to ignore it. So every case here is about
 * WHEN it is absent — at the top, at the bottom, and when the content fits.
 *
 * jsdom reports 0 for every layout measurement, so the scroll box is faked with
 * explicit properties. That is the honest way to drive geometry here: what is
 * under test is the arithmetic and the listener wiring, not the browser's layout.
 */
import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { ScrollHintArrows } from '../components/chat/room-header/parts/room-translate/ScrollHintArrows';

/** A stand-in for the scrolling body, with geometry jsdom will not compute. */
const makeBox = (scrollTop: number, clientHeight: number, scrollHeight: number) => {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight });
  el.scrollBy = vi.fn();
  document.body.appendChild(el);
  return el;
};

const mountWith = (el: HTMLElement) => {
  const Harness = () => {
    const ref = useRef<HTMLElement | null>(el);
    return <ScrollHintArrows targetRef={ref} />;
  };
  return render(<Harness />);
};

const up = () => screen.queryByTestId('room-modal-scroll-up');
const down = () => screen.queryByTestId('room-modal-scroll-down');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('[SCROLLHINT] which arrow shows', () => {
  it('at the very top of a long box: down only', () => {
    mountWith(makeBox(0, 400, 1200));

    expect(down()).toBeTruthy();
    expect(up()).toBeNull();
  });

  it('in the middle: both', () => {
    mountWith(makeBox(400, 400, 1200));

    expect(up()).toBeTruthy();
    expect(down()).toBeTruthy();
  });

  it('🔴 at the very bottom: the down arrow is GONE', () => {
    mountWith(makeBox(800, 400, 1200));

    expect(down()).toBeNull();
    expect(up()).toBeTruthy();
  });

  it('🔴 content that fits shows nothing at all', () => {
    mountWith(makeBox(0, 400, 400));

    expect(up()).toBeNull();
    expect(down()).toBeNull();
  });

  it('a sub-pixel gap at the bottom still counts as the bottom', () => {
    // Zoom and fractional layout leave a fraction; an exact comparison would
    // leave the arrow up forever, which is the state the owner asked to avoid.
    mountWith(makeBox(799, 400, 1200.4));

    expect(down()).toBeNull();
  });
});

describe('[SCROLLHINT] it keeps up with the box', () => {
  it('re-measures on scroll', () => {
    const el = makeBox(0, 400, 1200);
    mountWith(el);
    expect(up()).toBeNull();

    act(() => {
      (el as HTMLElement & { scrollTop: number }).scrollTop = 500;
      el.dispatchEvent(new Event('scroll'));
    });

    expect(up()).toBeTruthy();
  });

  it('re-measures on window resize', () => {
    const el = makeBox(0, 400, 1200);
    mountWith(el);

    act(() => {
      (el as HTMLElement & { scrollTop: number }).scrollTop = 800;
      window.dispatchEvent(new Event('resize'));
    });

    expect(down()).toBeNull();
  });

  it('🔴 survives an environment with no ResizeObserver', () => {
    // Expanding a step resizes the content with no scroll or resize event, so the
    // observer is how that case is caught — but its absence must not crash.
    const original = globalThis.ResizeObserver;
    // deliberately removing it for this case
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

    expect(() => mountWith(makeBox(0, 400, 1200))).not.toThrow();
    expect(down()).toBeTruthy();

    globalThis.ResizeObserver = original;
  });
});

describe('[SCROLLHINT] pressing one moves the box', () => {
  it('the down arrow scrolls forward, smoothly', () => {
    const el = makeBox(0, 400, 1200);
    mountWith(el);

    fireEvent.click(down()!);

    expect(el.scrollBy).toHaveBeenCalledWith({ top: 280, behavior: 'smooth' });
  });

  it('the up arrow scrolls back', () => {
    const el = makeBox(400, 400, 1200);
    mountWith(el);

    fireEvent.click(up()!);

    expect(el.scrollBy).toHaveBeenCalledWith({ top: -280, behavior: 'smooth' });
  });

  it('🔴 neither arrow is reachable by keyboard or screen reader', () => {
    // They duplicate scrolling, which the container already offers; announcing
    // them would add two stops to every tab through the dialog.
    mountWith(makeBox(400, 400, 1200));

    for (const btn of [up()!, down()!]) {
      expect(btn.getAttribute('tabindex')).toBe('-1');
      expect(btn.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('[SCROLLHINT] the modal body must actually be able to overflow', () => {
  /* 🔴 These three classes are why the modal could not scroll and why no arrow
     appeared, in a build the owner opened. They are asserted on the source
     because nothing else can see them: jsdom computes no layout, so a render
     test cannot tell a scrollable box from a box that simply grew to fit, and
     `tsc` and eslint see a perfectly valid className either way.
       · `min-h-0`      — without it the flex item keeps `min-height: auto` and
                          refuses to shrink below its content
       · `absolute inset-0` on the scroller — `h-full` resolved to the content
                          height, leaving scrollHeight === clientHeight
       · `relative` on the wrapper — the arrows sit over the box; inside the
                          scroller they would scroll away with the content
     คลาสสามตัวนี้คือเหตุผลที่โมดัลเลื่อนไม่ได้ ห้ามหลุด */
  const modalSrc = () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { resolve } = require('node:path') as typeof import('node:path');
    return readFileSync(
      resolve(__dirname, '../components/chat/room-header/parts/room-translate/RoomTranslateModal.tsx'),
      'utf8',
    );
  };

  it('the wrapper carries the flex role the scroller used to have', () => {
    // It takes `flex-1 min-h-0 flex flex-col` so the scroller inside keeps the
    // exact relationship it always had; `relative` is what the arrows need.
    expect(modalSrc()).toContain('className="relative flex-1 min-h-0 flex flex-col"');
  });

  it('🔴 the scroller is still a FLEX CHILD that owns the overflow', () => {
    const src = modalSrc();

    expect(src).toMatch(/ref=\{bodyRef\}[^>]*\bflex-1\b/);
    expect(src).toMatch(/ref=\{bodyRef\}[^>]*overflow-y-auto/);
    /* The two shapes that each broke it: `h-full` left scrollHeight equal to
       clientHeight (no scrollbar, no arrows), and `absolute` took the body out
       of the flow so the modal collapsed to header + footer. */
    expect(src).not.toMatch(/ref=\{bodyRef\}[^>]*\bh-full\b/);
    expect(src).not.toMatch(/ref=\{bodyRef\}[^>]*\babsolute\b/);
  });

  it('the arrows are rendered OUTSIDE the scrolling element', () => {
    const src = modalSrc();
    const arrows = src.indexOf('<ScrollHintArrows');
    const scroller = src.indexOf('ref={bodyRef}');

    expect(arrows).toBeGreaterThan(-1);
    expect(arrows).toBeLessThan(scroller);
  });
});

describe('[SCROLLHINT] each arrow points the way it moves', () => {
  /* Reported as "arrow สลับด้าน" — it was the collapsed layout inverting the box,
     not the pairing, but nothing pinned the pairing either. Now it does: the up
     arrow sits at the TOP and scrolls backwards, the down arrow sits at the
     BOTTOM and scrolls forwards. Swapping either half turns this red. */
  it('the up arrow is anchored to the top and scrolls back', () => {
    const el = makeBox(400, 400, 1200);
    mountWith(el);
    const btn = up()!;

    expect(btn.className).toContain('top-1');
    expect(btn.className).not.toContain('bottom-1');
    fireEvent.click(btn);
    expect(el.scrollBy).toHaveBeenCalledWith({ top: -280, behavior: 'smooth' });
  });

  it('the down arrow is anchored to the bottom and scrolls forward', () => {
    const el = makeBox(400, 400, 1200);
    mountWith(el);
    const btn = down()!;

    expect(btn.className).toContain('bottom-1');
    expect(btn.className).not.toContain('top-1');
    fireEvent.click(btn);
    expect(el.scrollBy).toHaveBeenCalledWith({ top: 280, behavior: 'smooth' });
  });

  it('🔴 the up arrow renders ABOVE the down arrow in the DOM', () => {
    mountWith(makeBox(400, 400, 1200));

    // Same stacking context, so document order decides which is drawn first —
    // and a reader scanning the JSX should meet them in the order they appear.
    const position = up()!.compareDocumentPosition(down()!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
