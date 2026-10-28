/**
 * [FEAT-20260819-CARDWINDOW] 25 cards drawn, more revealed on scroll — on every
 * tab, without touching search or realtime.
 *
 * ⚠️ WHICH PAGE: `pages/chat/TicketChat.tsx` = the LIVE page (`/ticket-support`).
 * `TicketSupport.tsx` is the old table on `/legacy-ticket` and is not involved.
 *
 * The window sits BELOW the filters and BELOW the sort, and that placement is the
 * entire safety argument:
 *   · search narrows the full list first, so a match never hides behind a page
 *   · the sort runs first, so a live message moves a card into view, not out
 * These tests pin the placement, not just the arithmetic.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { useCardWindow, CARD_WINDOW_SIZE } from '../services/chat/useCardWindow';
import { ticketChatPageWithPieces, ticketChatSource } from './ticketChatSource';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const Probe: React.FC<{ items: number[]; k: string; api: any }> = ({ items, k, api }) => {
  const w = useCardWindow(items, k);
  api.current = w;
  return <div data-testid="out">{w.visible.length}|{w.remaining}|{String(w.hasMore)}</div>;
};

describe('the window itself', () => {
  it('draws 25 and says how many are left', () => {
    const api: any = { current: null };
    render(<Probe items={Array.from({ length: 100 }, (_, i) => i)} k="a" api={api} />);
    expect(CARD_WINDOW_SIZE).toBe(25);
    expect(screen.getByTestId('out').textContent).toBe('25|75|true');
  });

  it('a short list is drawn whole and asks for nothing', () => {
    const api: any = { current: null };
    render(<Probe items={[1, 2, 3]} k="a" api={api} />);
    expect(screen.getByTestId('out').textContent).toBe('3|0|false');
  });

  it('revealing adds one page, and stops at the end', () => {
    const api: any = { current: null };
    render(<Probe items={Array.from({ length: 30 }, (_, i) => i)} k="a" api={api} />);
    act(() => api.current.loadMore());
    expect(screen.getByTestId('out').textContent).toBe('30|0|false');
    act(() => api.current.loadMore());
    expect(screen.getByTestId('out').textContent).toBe('30|0|false');
  });

  it('a REALTIME rebuild does not yank the operator back to the top', () => {
    /* The page rebuilds this array constantly. Resetting on array identity would
       send someone reading card 90 back to card 25 every time anyone, anywhere,
       sent a message. */
    const api: any = { current: null };
    const { rerender } = render(<Probe items={Array.from({ length: 100 }, (_, i) => i)} k="a" api={api} />);
    act(() => api.current.loadMore());
    expect(screen.getByTestId('out').textContent).toBe('50|50|true');
    rerender(<Probe items={Array.from({ length: 101 }, (_, i) => i)} k="a" api={api} />);
    expect(screen.getByTestId('out').textContent).toBe('50|51|true');   // still at 50
  });

  it('…but a DIFFERENT list starts at the top again', () => {
    const api: any = { current: null };
    const { rerender } = render(<Probe items={Array.from({ length: 100 }, (_, i) => i)} k="tab-a" api={api} />);
    act(() => api.current.loadMore());
    expect(screen.getByTestId('out').textContent).toBe('50|50|true');
    rerender(<Probe items={Array.from({ length: 100 }, (_, i) => i)} k="tab-b" api={api} />);
    expect(screen.getByTestId('out').textContent).toBe('25|75|true');
  });
});

describe('wired into the live page, below search and sort', () => {
  // [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
  const page = ticketChatPageWithPieces();

  it('every tab is windowed — the main list and the closed-case list', () => {
    // the index comes along for the reveal animation, hence the tuple form
    /* [FEAT-20261020-TICKETSTACK] flipped 20/10: the main list still maps over
       `mainWindow.visible`, but each slot now goes through renderTicketStackSlot,
       which calls the SAME card callback `(tk, cardIdx)` for the front card and
       (flag on) for the older cards of a stack. Was:
       'mainWindow.visible.map((tk, cardIdx) => {' */
    expect(page).toContain(
      'mainWindow.visible.map((frontTk, frontIdx) => renderTicketStackSlot(mainStacks, frontTk, frontIdx, stackExpand, (tk, cardIdx) => {',
    );
    expect(page).toContain('endedWindow.visible.map((group, cardIdx) => {');
  });

  it('nothing is "fresh" before anything has been revealed', () => {
    /* BEHAVIOUR, not a source count: a mutation that made `isFresh` return true
       for everything slipped past a source-count assertion, which is exactly the
       kind of test that looks strict and proves nothing. */
    const api: any = { current: null };
    render(<Probe items={Array.from({ length: 100 }, (_, i) => i)} k="a" api={api} />);
    expect(api.current.isFresh(0)).toBe(false);
    expect(api.current.isFresh(24)).toBe(false);
  });

  it('after a reveal, ONLY the new batch is fresh', () => {
    const api: any = { current: null };
    render(<Probe items={Array.from({ length: 100 }, (_, i) => i)} k="a" api={api} />);
    act(() => api.current.loadMore());
    expect(api.current.isFresh(24)).toBe(false);   // was already on screen
    expect(api.current.isFresh(25)).toBe(true);    // just appeared
    expect(api.current.isFresh(49)).toBe(true);
  });

  it('switching list clears freshness — no half-animated list on a new tab', () => {
    const api: any = { current: null };
    const { rerender } = render(<Probe items={Array.from({ length: 100 }, (_, i) => i)} k="a" api={api} />);
    act(() => api.current.loadMore());
    expect(api.current.isFresh(30)).toBe(true);
    rerender(<Probe items={Array.from({ length: 100 }, (_, i) => i)} k="b" api={api} />);
    expect(api.current.isFresh(30)).toBe(false);
  });

  it('only the batch that just appeared animates', () => {
    /* This page re-renders on every inbound message. Animating the whole list on
       each render would make it twitch constantly, which is worse than no
       animation — so the class is bound to `isFresh`, never to the render. */
    const uses = page.match(/isFresh\(cardIdx\)/g) ?? [];
    expect(uses.length).toBe(4);          // class + delay, on each of the two lists
    expect(page).toContain("'tc-card-reveal' : ''");
  });

  it('the motion is defined once, and respects prefers-reduced-motion', () => {
    const css = src('index.css');
    expect(css).toContain('@keyframes tcCardReveal');
    expect(css).toContain('.tc-card-reveal {');
    /* The file has SEVERAL reduced-motion blocks; matching only the first one
       tested somebody else's animation. Any block that opts this class out counts. */
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
      .map((m) => m[1]);
    expect(blocks.some((b) => b.includes('.tc-card-reveal'))).toBe(true);
  });

  it('it slices the ALREADY sorted, ALREADY filtered list', () => {
    // the main window is fed the pinned+sorted list, not the raw fetch
    /* [FEAT-20261020-TICKETSTACK] flipped 20/10: flag on ⇒ the fronts of the stacks,
       which groupTicketStacks builds FROM visibleTicketsPinned in its order; flag
       off ⇒ mainStacks is null ⇒ visibleTicketsPinned itself, as before. Was:
       "statusTab === 'bot' ? groupedBotTickets : visibleTicketsPinned," */
    expect(page).toContain("statusTab === 'bot' ? groupedBotTickets : (mainStacks?.fronts ?? visibleTicketsPinned),");
    expect(page).toContain('groupTicketStacks(visibleTicketsPinned)');
  });

  it('the reset key is the things that mean "another list" — search included', () => {
    expect(page).toContain('const cardWindowKey = [');
    expect(page).toContain('filterTag, filterTier, debouncedSearch, filterWithinDays,');
  });

  it('the reveal point is on screen when there is more', () => {
    expect(page).toContain(".hasMore && (");
    expect(page).toContain('.sentinelRef}');
  });
});

describe('the date-scope picker is back on, and behind one flag', () => {
  // [REFACTOR-20261027-TCSPLIT] the flag + options moved to pages/chat/ticket-chat/ —
  // read the page with its pieces (test/ticketChatSource.ts); assertions unchanged
  const page = ticketChatSource();

  it('🔴 the flag is ON — the owner asked for the control back on 02/09', () => {
    /* [FIX-20260902-DATESCOPE2] this case used to assert `= false`, and the value
       flipping is the whole point of the change. What it should always have been
       pinning is that ONE flag governs the control — that is what made bringing it
       back a one-value edit instead of a rewrite, exactly as the comment beside it
       promised. So the flag stays asserted; only the expected value moves.

       It is not decoration: `withinDaysParam` is the single input both halves of
       the บอทดูแล badge filter by, and it decides how many pages `listAllRooms`
       must fetch. Without this control, `ทั้งหมด` — the most expensive setting —
       would be the only one reachable. */
    expect(page).toContain('const SHOW_DATE_SCOPE = true;');
    expect(page).toContain('{SHOW_DATE_SCOPE && (');
  });

  it('the popover itself is still there', () => {
    expect(page).toContain('DATE_SCOPE_OPTIONS');
    expect(page).toContain('dateScopeRef');
  });

  it('🔴 exactly TWO windows are offered — 7 วัน and ทั้งหมด', () => {
    /* Owner, 02/09: "ใช้ได้จริง 7 วันกับทั้งหมด (ที่เหลือไม่ให้เลือก)".
       The behaviour of a value no longer offered — it must still filter, and its
       label must not lie — is covered by test/dateScopeOptions.value.test.ts. */
    const list = page.slice(
      page.indexOf('const DATE_SCOPE_OPTIONS'),
      page.indexOf('const SHOW_DATE_SCOPE'),
    );
    expect(list).toContain("{ value: '7', label: '7 วัน' }");
    expect(list).toContain("{ value: '', label: 'ทั้งหมด' }");
    expect(list).not.toContain("label: '2 วัน'");
    expect(list).not.toContain("label: '5 วัน'");
  });

  it('🔴 the page opens on 7 วัน — and only because the control is visible', () => {
    /* [FIX-20260902-DATESCOPEDEFAULT] Owner, 02/09: "default เป็น 7 วัน".
       This case used to pin `useState('')`, which was right only while the picker
       was hidden: a narrow default with no visible way to widen it pins every list
       forever. So the pair is what gets asserted, not the value alone — a narrow
       default is allowed HERE because SHOW_DATE_SCOPE (above) is true. Flip that
       flag back to false without restoring '' and this case must fail. */
    expect(page).toContain("const [filterWithinDays, setFilterWithinDays] = useState('7');");
    expect(page).toContain('const SHOW_DATE_SCOPE = true;');
  });

  it('the gear lights up for the NON-default scope, not on every load', () => {
    /* The comparison was left at the literal '2' when the default became '' —
       so the "a filter is applied" dot was on permanently and meant nothing.
       It has to name whatever the default currently is. */
    expect(page).toContain("const isDateScopeActive = filterWithinDays !== '7';");
  });
});
