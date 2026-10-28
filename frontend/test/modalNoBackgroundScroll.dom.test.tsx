/**
 * [FIX-20260829-BGSCROLLCHAIN] an open dialog must not let the page behind it move
 * ===========================================================================
 * Reported 29/08 against the broadcast dialog — reported once before on 28/08
 * and "fixed" then by `useBodyScrollLock`, which did not help. This records why.
 *
 * 🔴 THE 28/08 FIX LOCKED THE WRONG ELEMENT. `useBodyScrollLock` sets
 *    `document.body.style.overflow = 'hidden'`, but `<body>` is not what scrolls
 *    in this app: the scroller is `<main class="... flex-1 overflow-y-auto">`
 *    (`App.tsx`). Locking `body` therefore changes nothing a user can feel.
 *
 * 🔴 AND THE DIALOG IS NOT PORTALLED — `Modal` renders in place, so the overlay
 *    sits INSIDE that `<main>` in the DOM. When the overlay reaches its own
 *    scroll end the browser hands the remaining delta to the nearest scrollable
 *    ANCESTOR, which is exactly that `<main>`. Locking `body` never intercepts
 *    this path. `overscroll-behavior: contain` does — it stops the hand-off at
 *    the container itself, whichever ancestor would have received it.
 *
 * ⚠️ The `body` lock is deliberately LEFT IN PLACE. It is the correct guard for
 *    a page whose scroller really is the document, and removing it would trade
 *    one bug for another the day a page renders outside that `<main>`.
 *
 * ⚠️ jsdom has no scrolling and no `overscroll-behavior`, so what is asserted is
 *    the class contract that produces the behaviour — which is the whole fix.
 *
 * revert: drop `overscroll-contain` from the two overlays and the body in
 *         `Modal.tsx`, and delete this spec.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Modal from '../components/common/Modal';

const shell = (variant: 'panel' | 'form') => {
  const { container } = render(
    <Modal isOpen variant={variant} maxWidth="max-w-3xl">
      <Modal.Header title="t" onClose={() => {}} />
      <Modal.Body>body</Modal.Body>
    </Modal>,
  );
  const overlay = container.firstElementChild as HTMLElement;
  const panel = overlay?.firstElementChild as HTMLElement;
  return { overlay, body: panel?.lastElementChild as HTMLElement };
};

describe('[BGSCROLLCHAIN] scrolling a dialog never reaches the page behind it', () => {
  it('⭐⭐ 🔴 the form overlay contains its own overscroll', () => {
    expect(shell('form').overlay.className).toContain('overscroll-contain');
  });

  it('⭐⭐ 🔴 the panel overlay does too — same chaining, same page', () => {
    expect(shell('panel').overlay.className).toContain('overscroll-contain');
  });

  it('⭐⭐ the scrolling body contains it as well, so the inner box cannot hand off either', () => {
    /* The body is a scroller in its own right. Without this, reaching the END of
       the body hands the delta to the overlay and onward to the page — the same
       bug one level in, which is how it survived being "fixed" once already. */
    expect(shell('form').body.className).toContain('overscroll-contain');
  });
});
