/**
 * [FEAT-20260907-FLEXPICKREFRESH] / [FEAT-20260907-FLEXMANAGELINK]
 * Step 2 of the broadcast form: the flex field names what it sends, its list is
 * current whenever somebody looks at it, and the way into the card library says
 * something when it is not allowed.
 * ===========================================================================
 * Owner, 07/09, four things:
 *   1. the field is called "the flex card to send", not "message"
 *   2. the list reloads on all three openings — modal, step, dropdown
 *   3. a refresh button beside the label
 *   4. "open this flex card" becomes "manage flex messages", with a themed
 *      dialog for an admin without `flex.manage`
 * plus: the preview button beside it is NOT touched.
 *
 * ⚠️ The picker imports the SERVICE FILE directly, not the `services/media`
 *    barrel, so the mock has to name that exact path or the real fetch runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const listFlexMessages = vi.fn(() =>
  Promise.resolve({ data: [{ id: 'card-1', name: 'Promo card' }] }),
);

vi.mock('../services/media/flexMessageService', () => ({
  flexMessageService: {
    listFlexMessages: (...a: unknown[]) =>
      (listFlexMessages as unknown as (...x: unknown[]) => unknown)(...a),
    getFlexMessage: () => Promise.resolve({ content_json: {} }),
  },
}));

/* ⚠️ `vi.fn<Args, Return>` is the OLD two-argument form; this vitest takes the
   whole call signature as one argument. The two-argument shape still runs
   (vitest ignores the types at runtime) but `tsc --noEmit` rejects it. */
const storedPermissions = vi.fn<() => string[]>(() => ['flex.manage']);
vi.mock('../services/authStorage', () => ({
  getStoredAuth: () => ({ permissions: storedPermissions() }),
}));

import { FlexCardPicker, COALESCE_MS } from '../components/campaign/flex/FlexCardPicker';
import { FlexManageButton } from '../components/campaign/flex/FlexManageButton';
import { I18nProvider } from '../i18n';

const wrap = (node: React.ReactElement) =>
  render(<I18nProvider>{node}</I18nProvider>);

/**
 * Time control, done with a `Date.now` stub rather than fake timers.
 *
 * ⚠️ `vi.setSystemTime` does NOTHING without `vi.useFakeTimers()`, and fake
 *    timers break `waitFor`. The picker reads the clock through `Date.now()`
 *    only, so stubbing that is enough and leaves the event loop real.
 *    An earlier version of this file called `vi.setSystemTime` and the window
 *    was never actually crossed — the cases passed for an unrelated reason.
 */
let clockOffset = 0;
const realNow = Date.now.bind(Date);
const advanceClock = (ms: number) => {
  clockOffset += ms;
};

beforeEach(() => {
  listFlexMessages.mockClear();
  storedPermissions.mockReturnValue(['flex.manage']);
  clockOffset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The first fetch has fully settled — `lastLoadedAt` is set from here on. */
const settled = async (c: HTMLElement) =>
  waitFor(() =>
    expect(c.querySelector('[data-testid="flex-card-loading"]')).toBeNull(),
  );

/**
 * The `SearchableSelect` trigger — explicitly NOT the refresh button.
 *
 * 🔴 The first version of this selector was
 *    `[data-testid="flex-card-picker"] button`, which returns the REFRESH
 *    button: `FlexCardPickerHeader` renders inside the same wrapper and comes
 *    first in the DOM. Every "opening the dropdown refetches" case therefore
 *    passed by pressing refresh instead, and survived a mutation that deleted
 *    `onOpen` entirely. Caught by that mutation, not by the green run.
 */
const trigger = (c: HTMLElement) =>
  c.querySelector(
    '[data-testid="flex-card-picker"] button:not([data-testid="flex-card-refresh"])',
  ) as HTMLElement;

describe('the label', () => {
  it('names the flex card, not "message"', async () => {
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalled());
    expect(container.textContent).toContain('Flex ที่ใช้ส่ง');
  });

  it('renders the refresh control beside it', async () => {
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="flex-card-refresh"]')).not.toBeNull();
  });
});

describe('the four reload triggers', () => {
  it('1 — mounting fetches once (the modal opening)', async () => {
    wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalledTimes(1));
  });

  it('2 — becoming the active step fetches again', async () => {
    const { rerender } = wrap(
      <FlexCardPicker value={null} onChange={vi.fn()} active={false} />,
    );
    await settled(document.body);
    listFlexMessages.mockClear();
    advanceClock(COALESCE_MS + 10);

    rerender(
      <I18nProvider>
        <FlexCardPicker value={null} onChange={vi.fn()} active />
      </I18nProvider>,
    );
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalledTimes(1));
  });

  it('3 — opening the dropdown fetches again', async () => {
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    const c = container as HTMLElement;
    await settled(c);
    listFlexMessages.mockClear();
    advanceClock(COALESCE_MS + 10);

    fireEvent.click(trigger(c));
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalledTimes(1));
  });

  it('🔴 a trigger INSIDE the coalesce window is ignored', async () => {
    /* The window's own case. `inFlight` alone cannot cover it — that guard only
       catches overlapping requests, and by here the first has finished. A
       mutation removing `COALESCE_MS` survived until this case existed. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    const c = container as HTMLElement;
    await settled(c);
    listFlexMessages.mockClear();

    fireEvent.click(trigger(c));
    await new Promise(r => setTimeout(r, 20));
    expect(listFlexMessages).not.toHaveBeenCalled();
  });

  it('3b — CLOSING the gallery does not', async () => {
    /* [FEAT-20260907-FLEXGALLERY] rewritten 07/09. It used to open and then
       re-click the combobox trigger to close it; the picker no longer has a
       combobox — the trigger opens a gallery MODAL, and closing is a different
       button. The property being guarded is unchanged: dismissing costs no
       request. A caller that refetched on close would spend one every time the
       admin backed out. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    const c = container as HTMLElement;
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalledTimes(1));
    await settled(c);
    advanceClock(COALESCE_MS + 10);
    fireEvent.click(trigger(c)); // open the gallery
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalledTimes(2));
    listFlexMessages.mockClear();
    advanceClock(COALESCE_MS + 10);

    /* the gallery's own close button — the modal renders into the document.
       ⚠️ Addressed by its OWN testid. This used to reach it as
          `flex-gallery-clear`'s `nextElementSibling`, and when the owner had the
          clear button removed on 07/09 the selector dereferenced null. A test
          that navigates by DOM position breaks on layout changes that have
          nothing to do with what it is checking. */
    fireEvent.click(
      document.querySelector('[data-testid="flex-gallery-close"]') as HTMLElement,
    );
    await new Promise(r => setTimeout(r, 20));
    expect(listFlexMessages).not.toHaveBeenCalled();
  });

  it('4 — the refresh button ALWAYS fetches, even inside the coalesce window', async () => {
    /* Somebody pressing refresh is telling us the stored answer is wrong.
       Refusing them would look like a broken button. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalledTimes(1));
    listFlexMessages.mockClear();

    fireEvent.click(
      container.querySelector('[data-testid="flex-card-refresh"]') as HTMLElement,
    );
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalledTimes(1));
  });

  it('🔴 three triggers in one gesture stay ONE request', async () => {
    /* Mount + becoming active + opening the dropdown all happen within a few
       hundred milliseconds when the modal opens on step 2 and the admin clicks
       the select. Without coalescing this change would triple the traffic. */
    const { container } = wrap(
      <FlexCardPicker value={null} onChange={vi.fn()} active />,
    );
    fireEvent.click(trigger(container as HTMLElement));
    await new Promise(r => setTimeout(r, 30));
    expect(listFlexMessages).toHaveBeenCalledTimes(1);
  });
});

describe('manage flex messages', () => {
  it('opens the library in a new tab when the permission is held', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { container } = wrap(<FlexManageButton />);
    fireEvent.click(
      container.querySelector('[data-testid="manage-flex-messages"]') as HTMLElement,
    );
    expect(open).toHaveBeenCalledWith(
      expect.any(String),
      '_blank',
      'noopener,noreferrer',
    );
    expect(container.querySelector('[data-testid="flex-manage-denied"]')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('🔴 the url carries the ROUTER HASH — without it the page never opens', async () => {
    /* [FIX-20260907-FLEXMANAGEHASH] reported from the running stg site: the
       button did nothing useful because it asked the SERVER for
       `/flex-messages`, a path only the HashRouter knows. The `#` is the fix,
       so it is pinned here rather than left to a reviewer's eye.
       The origin is NOT hard-coded — jsdom's own would make this test lie about
       what runs in a browser served from a sub-path. */
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { container } = wrap(<FlexManageButton />);
    fireEvent.click(
      container.querySelector('[data-testid="manage-flex-messages"]') as HTMLElement,
    );
    const url = String(open.mock.calls[0]?.[0]);
    expect(url.endsWith('#/flex-messages')).toBe(true);
    expect(url.startsWith(window.location.origin)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('🔴 shows the themed dialog and navigates NOWHERE without it', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    storedPermissions.mockReturnValue(['broadcast.manage']);
    const { container } = wrap(<FlexManageButton />);
    fireEvent.click(
      container.querySelector('[data-testid="manage-flex-messages"]') as HTMLElement,
    );
    await waitFor(() =>
      expect(document.querySelector('[data-testid="flex-manage-denied"]')).not.toBeNull(),
    );
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('🔴 a system administrator is NOT locked out', async () => {
    /* `permAllows` honours `system.manage` and `*`. A bare
       `permissions.includes('flex.manage')` would deny them, and the navigation
       menu — which uses `permAllows` — would still offer the destination. */
    const open = vi.fn();
    vi.stubGlobal('open', open);
    storedPermissions.mockReturnValue(['system.manage']);
    const { container } = wrap(<FlexManageButton />);
    fireEvent.click(
      container.querySelector('[data-testid="manage-flex-messages"]') as HTMLElement,
    );
    expect(open).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
