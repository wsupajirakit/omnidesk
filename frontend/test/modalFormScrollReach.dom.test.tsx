/**
 * [FIX-20260828-FORMSCROLLREACH] the top of a tall form dialog must stay reachable
 * ===========================================================================
 * Reported 28/08 against the broadcast create/edit dialog: content sat above the
 * title bar and no amount of scrolling brought it back — "บัคพื้นที่เลื่อนได้".
 *
 * 🔴 THE CAUSE IS `items-center` ON A SCROLLING BOX. When the child is taller
 *    than the box, centring pushes the child's top edge ABOVE the scroll origin.
 *    A browser cannot scroll to a negative offset, so that strip is not merely
 *    hidden — it is unreachable. `items-start` + `my-auto` centres the same way
 *    on a tall screen while keeping the top edge at the scroll origin.
 *
 * 🔴 WHY IT FIRES ON ORDINARY LAPTOPS — measured, not guessed:
 *      overlay gives   100vh − 2rem   (`p-4`)
 *      panel wants      90vh + 4rem   (`h-[90vh]` + `my-8`)
 *      overflows when   6rem > 10vh   ⇒   viewport shorter than 960px
 *    ⇒ nearly every laptop, which is why this reproduced immediately.
 *
 * ⚠️ jsdom computes no layout, so no test here can scroll a real box. What can
 *    be locked is the class contract that decides the layout — and that is the
 *    whole of this fix. A test that "scrolled" would be theatre.
 *
 * ⚠️ Same three-part fix already proven on `BroadcastRunDetailModal` (26/08,
 *    `[FIX-20260826-RUNMODALSCROLL]`). It was applied to that one dialog only;
 *    the shared chrome kept the bug for the six dialogs that use `variant="form"`.
 *
 * revert: drop this file and restore `items-center` / `my-8` in `Modal.tsx`.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Modal from '../components/common/Modal';

const shell = () => {
  const { container } = render(
    <Modal isOpen variant="form" maxWidth="max-w-3xl">
      <Modal.Header title="t" onClose={() => {}} />
      <Modal.Body>body</Modal.Body>
    </Modal>,
  );
  const overlay = container.firstElementChild as HTMLElement;
  const panel = overlay?.firstElementChild as HTMLElement;
  const body = panel?.lastElementChild as HTMLElement;
  return { overlay, panel, body };
};

describe('[FORMSCROLLREACH] a tall form dialog can be scrolled back to its top', () => {
  it('⭐⭐ 🔴 the scrolling overlay does NOT centre its child — that is what hides the top', () => {
    const { overlay } = shell();
    expect(overlay.className).toContain('overflow-y-auto');
    expect(overlay.className).toContain('items-start');
    expect(overlay.className).not.toContain('items-center');
  });

  it('⭐⭐ 🔴 the panel centres with `my-auto`, never a fixed `my-8`', () => {
    const { panel } = shell();
    /* `my-auto` still floats the panel mid-screen when there is room, and
       collapses to nothing when there is not — `my-8` keeps demanding 4rem
       the box does not have, which is what pushed the top out of reach. */
    expect(panel.className).toContain('my-auto');
    expect(panel.className).not.toContain('my-8');
  });

  it('⭐⭐ the body may shrink — a flex child refuses to without `min-h-0`', () => {
    const { body } = shell();
    /* `min-height: auto` is the default for a flex item, so the body refuses to
       shrink below its content and `overflow-y-auto` never engages. Without
       this the panel is the right height and still cannot scroll inside. */
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('overflow-y-auto');
  });
});
