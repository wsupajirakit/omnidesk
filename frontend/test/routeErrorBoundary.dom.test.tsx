/* [FIX-20260922-CHUNKSTUCK] The screen a stranded admin actually gets.
 *
 * The point of the boundary is not "an error was caught" — it is that the user
 * ends up somewhere they can act. So these cases assert the BUTTON, the reload
 * it performs, and that navigating away clears the card. Before this existed
 * the app had no boundary at all (`grep componentDidCatch` returned nothing),
 * so a rethrown chunk error unmounted the tree and left a blank page.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { RouteErrorBoundaryInner } from '../components/common/chunk-recovery/RouteErrorBoundary';

afterEach(cleanup);

const Boom: React.FC<{ msg: string }> = ({ msg }) => {
  throw new Error(msg);
};

const CHUNK = 'Failed to fetch dynamically imported module: /assets/TicketChat-abc.js';

/** React logs a caught error; the boundary logs its own. Neither is a failure,
 *  and leaving them on makes a green run look broken. */
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('[CHUNKSTUCK] a failed page ends in a button, not a spinner', () => {
  it('⭐⭐⭐ a chunk error shows the reload screen', () => {
    const spy = quiet();
    render(
      <RouteErrorBoundaryInner resetKey="/chat">
        <Boom msg={CHUNK} />
      </RouteErrorBoundaryInner>,
    );
    expect(screen.getByTestId('route-error-boundary')).toBeInTheDocument();
    expect(screen.getByText('โหลดหน้านี้ไม่สำเร็จ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'โหลดใหม่' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('⭐⭐⭐ pressing the button reloads the page — that is the whole escape hatch', () => {
    const spy = quiet();
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      render(
        <RouteErrorBoundaryInner resetKey="/chat">
          <Boom msg={CHUNK} />
        </RouteErrorBoundaryInner>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'โหลดใหม่' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
      spy.mockRestore();
    }
  });

  it('⭐⭐⭐ an ordinary bug gets a DIFFERENT message — and still never a blank page', () => {
    const spy = quiet();
    render(
      <RouteErrorBoundaryInner resetKey="/chat">
        <Boom msg="x is not a function" />
      </RouteErrorBoundaryInner>,
    );
    expect(screen.getByText('หน้านี้มีข้อผิดพลาด')).toBeInTheDocument();
    expect(screen.queryByText('โหลดหน้านี้ไม่สำเร็จ')).toBeNull();
    /* the raw message is on screen for support — "หน้าขาว" is not a report */
    expect(screen.getByText(/x is not a function/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('⭐⭐⭐ navigating to another route clears the error — one bad page must not freeze the app', () => {
    const spy = quiet();
    const { rerender } = render(
      <RouteErrorBoundaryInner resetKey="/chat">
        <Boom msg={CHUNK} />
      </RouteErrorBoundaryInner>,
    );
    expect(screen.getByTestId('route-error-boundary')).toBeInTheDocument();
    rerender(
      <RouteErrorBoundaryInner resetKey="/hook">
        <div>หน้าอื่นโหลดได้</div>
      </RouteErrorBoundaryInner>,
    );
    expect(screen.queryByTestId('route-error-boundary')).toBeNull();
    expect(screen.getByText('หน้าอื่นโหลดได้')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('⭐⭐ staying on the SAME route keeps the card — re-rendering is not a fix', () => {
    const spy = quiet();
    const { rerender } = render(
      <RouteErrorBoundaryInner resetKey="/chat">
        <Boom msg={CHUNK} />
      </RouteErrorBoundaryInner>,
    );
    rerender(
      <RouteErrorBoundaryInner resetKey="/chat">
        <div>ไม่ควรเห็นอันนี้</div>
      </RouteErrorBoundaryInner>,
    );
    expect(screen.getByTestId('route-error-boundary')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('⭐⭐ a healthy page renders untouched — the boundary is invisible when nothing fails', () => {
    render(
      <RouteErrorBoundaryInner resetKey="/chat">
        <div>เนื้อหาปกติ</div>
      </RouteErrorBoundaryInner>,
    );
    expect(screen.getByText('เนื้อหาปกติ')).toBeInTheDocument();
    expect(screen.queryByTestId('route-error-boundary')).toBeNull();
  });
});
