/* [FE] HookFormOverlays — characterization test for [FEAT-20260811-HOOKFORMSPLIT].
 *
 * Freezes the rendered DOM of the two overlays extracted from HookFormModal (the
 * image lightbox and the no-permission alert). JSX was moved verbatim, so the
 * snapshot IS the proof nothing visible changed. Closed states assert the guard
 * (`null` / `false` → renders nothing) the parent used to inline.
 *
 * revert: delete together with components/hook/form/HookFormOverlays.tsx.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import {
  HookImageZoomOverlay,
  HookPermissionAlertOverlay,
} from '../components/hook/form/HookFormOverlays';

const noop = () => {};

describe('HookImageZoomOverlay DOM unchanged by extraction', () => {
  it('src null renders nothing', () => {
    const { container } = render(
      <HookImageZoomOverlay src={null} onClose={noop} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('open with a src', () => {
    const { container } = render(
      <HookImageZoomOverlay src="https://x/y.png" onClose={noop} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('backdrop click closes; X also closes', () => {
    // NOTE the real DOM behaviour, kept verbatim from the inline version: the X
    // has no stopPropagation, so a click on it fires its own onClose AND bubbles
    // to the backdrop's onClose. That is exactly how it behaved inline — we assert
    // it rather than "fix" it, since changing it would be a behaviour change.
    let backdropOnly = 0;
    const { container } = render(
      <HookImageZoomOverlay src="https://x/y.png" onClose={() => backdropOnly++} />,
    );
    (container.firstChild as HTMLElement).click(); // backdrop → 1
    expect(backdropOnly).toBe(1);

    let xClicks = 0;
    const second = render(
      <HookImageZoomOverlay src="https://x/y.png" onClose={() => xClicks++} />,
    );
    // scope to this render's container — a prior render left a button in the doc
    (second.container.querySelector('button') as HTMLElement).click();
    expect(xClicks).toBe(2); // X fires + bubbles to backdrop
  });
});

describe('HookPermissionAlertOverlay DOM unchanged by extraction', () => {
  it('closed renders nothing', () => {
    const { container } = render(
      <HookPermissionAlertOverlay open={false} onClose={noop} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('open', () => {
    const { container } = render(
      <HookPermissionAlertOverlay open onClose={noop} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('Understood closes', () => {
    let closed = false;
    const { getByRole } = render(
      <HookPermissionAlertOverlay open onClose={() => (closed = true)} />,
    );
    getByRole('button').click();
    expect(closed).toBe(true);
  });
});
