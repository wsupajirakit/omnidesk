import React from 'react';
import { useLocation } from 'react-router-dom';

import { isChunkLoadError } from './lazyWithRecovery';
import { translateNow } from '../../../i18n';

/**
 * [FIX-20260922-CHUNKSTUCK] The app had no error boundary at all — one thrown
 * render error unmounted everything and left a blank page.
 * ===========================================================================
 * `grep -rn "componentDidCatch\|getDerivedStateFromError"` over this repo on
 * 22/09 returned NOTHING. That is why the old chunk helper could not afford to
 * rethrow: with no boundary, rethrowing meant React tearing the whole tree down
 * and the admin staring at an empty screen with no hint and no button. So it
 * hung on a never-settling promise instead — trading a blank page for a frozen
 * one. Both are dead ends; the boundary is what makes a THIRD option exist.
 *
 * 🔴 IT CATCHES EVERY RENDER ERROR, not only chunk failures. That is a real
 *    behaviour change and it is deliberate: before this, ANY uncaught error in
 *    any page produced the same blank screen. The message adapts — a chunk
 *    failure is an update/network story the user can fix by reloading, anything
 *    else is a bug they should report — but nothing is allowed to end in a
 *    white void.
 *
 * ⚠️ THE FALLBACK USES NO `t()`, NO ICON PACK, NO SERVICE. It is the screen
 *    shown when something already failed to load, so every dependency it takes
 *    is another thing that can be broken at exactly the wrong moment. Plain
 *    markup and literal text only. หน้าจอฉุกเฉินต้องไม่พึ่งอะไรที่พังไปแล้ว
 *
 * ⚠️ IT RESETS WHEN THE ROUTE CHANGES. Without that, one failed page would keep
 *    its error card in place while the user navigates elsewhere — the app would
 *    look permanently broken after a single bad chunk.
 *
 * revert: delete this file and unwrap `<RouteErrorBoundary>` in App.tsx.
 */

interface Props {
  children: React.ReactNode;
  /** Changing this clears a shown error — the route path in practice. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  /** The value of `resetKey` when the error was captured. */
  shownFor?: string;
}

class RouteErrorBoundaryInner extends React.Component<Props, State> {
  public state: State = { error: null };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  public static getDerivedStateFromProps(
    props: Props,
    state: State,
  ): Partial<State> | null {
    if (!state.error) return { shownFor: props.resetKey };
    /* navigated away from the page that failed ⇒ give the app another chance */
    if (state.shownFor !== props.resetKey) return { error: null, shownFor: props.resetKey };
    return null;
  }

  public componentDidCatch(error: Error): void {
    /* The console is the only place this can be reported from: a page that
       failed to load cannot be relied on to have a logger, and an error
       reporter of our own would be one more thing to fail here. */
    console.error('[RouteErrorBoundary] render failed', error);
  }

  private readonly reload = (): void => {
    window.location.reload();
  };

  public render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunk = isChunkLoadError(error);
    return (
      <div
        className="flex flex-col items-center justify-center h-full w-full py-20 px-6 text-center"
        data-testid="route-error-boundary"
      >
        <p className="text-slate-600 text-sm font-semibold">
          {chunk ? translateNow('pageui.common.route_load_failed', 'โหลดหน้านี้ไม่สำเร็จ') : translateNow('pageui.common.route_error', 'หน้านี้มีข้อผิดพลาด')}
        </p>
        <p className="mt-2 text-slate-400 text-xs max-w-sm leading-relaxed">
          {chunk
            ? translateNow('pageui.common.route_load_failed_hint', 'อาจเป็นเพราะมีการอัปเดตระบบ หรือเน็ตสะดุดระหว่างโหลด กดปุ่มด้านล่างเพื่อโหลดใหม่ได้เลย')
            : translateNow('pageui.common.route_error_hint', 'ลองโหลดใหม่อีกครั้ง ถ้ายังเจอเหมือนเดิม รบกวนแจ้งทีมพัฒนาพร้อมบอกว่าอยู่หน้าไหน')}
        </p>
        <button
          type="button"
          onClick={this.reload}
          className="mt-5 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
        >
          {translateNow('pageui.common.route_reload', 'โหลดใหม่')}
        </button>
        {/* The message is for support, not for the user to decode — but without
            it a report reads "หน้าขาว" and nobody can act on that. */}
        <p className="mt-4 text-[10px] text-slate-300 break-all max-w-md">{error.message}</p>
      </div>
    );
  }
}

/**
 * Reads the current route so the boundary can reset itself on navigation.
 * Must render inside the router — in this app that is the `<HashRouter>` in
 * App.tsx, which wraps everything the boundary is placed around.
 */
export const RouteErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  return (
    <RouteErrorBoundaryInner resetKey={location.pathname}>{children}</RouteErrorBoundaryInner>
  );
};

/** Exported for tests that drive the reset behaviour without a router. */
export { RouteErrorBoundaryInner };
