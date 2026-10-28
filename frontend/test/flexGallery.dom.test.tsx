/**
 * [FEAT-20260907-FLEXGALLERY] The flex selector became a gallery.
 * ===========================================================================
 * The card is picked by looking at it — a big modal, two across, a real
 * thumbnail plus the name, click to select, and a "refresh รายการ" button inside
 * the modal itself.
 *
 * 🔴 AND, SAID TWICE: **the card-binding logic does not change, only the
 *    display.** Most of this file is about that promise, not about the grid.
 *    A redesign that quietly alters which id reaches the campaign would pass
 *    every "does the gallery look right" test ever written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';

const CARDS = [
  { id: 'card-1', name: 'Promo card', content_json: {} },
  { id: 'card-2', name: 'Welcome card', content_json: {} },
];

const listFlexMessages = vi.fn(() => Promise.resolve({ data: CARDS }));

vi.mock('../services/media/flexMessageService', () => ({
  flexMessageService: {
    listFlexMessages: () => listFlexMessages(),
    getFlexMessage: () => Promise.resolve({ content_json: {} }),
  },
}));

/* [FEAT-20260907-GALLERYMANAGELINK] The gallery header carries `FlexManageButton`,
   which reads permissions at CLICK time. Without this mock the stored auth is
   empty, so the button correctly shows its "no permission" dialog instead of
   opening a tab — and the hash case below failed for that reason on its first
   run, not because the URL was wrong. */
vi.mock('../services/authStorage', () => ({
  getStoredAuth: () => ({ permissions: ['flex.manage'] }),
}));

import { FlexCardPicker } from '../components/campaign/flex/FlexCardPicker';
import { FlexGalleryModal, matchesGalleryQuery } from '../components/campaign/flex/FlexGalleryModal';
import { I18nProvider } from '../i18n';

const PICKER_SRC = readFileSync(
  join(process.cwd(), 'components/campaign/flex/FlexCardPicker.tsx'),
  'utf8',
);

const wrap = (node: React.ReactElement) => render(<I18nProvider>{node}</I18nProvider>);

const openGallery = async (c: HTMLElement) => {
  await waitFor(() => expect(listFlexMessages).toHaveBeenCalled());
  fireEvent.click(c.querySelector('[data-testid="flex-card-open-gallery"]') as HTMLElement);
  await waitFor(() =>
    expect(document.querySelector('[data-testid="flex-gallery-grid"]')).not.toBeNull(),
  );
};

/**
 * [FEAT-20260907-GALLERYPICKCONFIRM] Press the confirm dialog's CONFIRM button.
 *
 * ⚠️ `ConfirmModal` carries no `data-testid`, and it is a shared component used
 *    by many screens — adding one for this test would be changing a file for a
 *    reason that has nothing to do with it. Its footer is `flex-row-reverse`, so
 *    the confirm button is the FIRST of the two in the DOM and the last visually.
 *    Matched on that shape rather than on the label, which is translated.
 */
const confirmPick = async (): Promise<void> => {
  const footer = document.querySelector('.flex-row-reverse') as HTMLElement;
  await waitFor(() => expect(footer).not.toBeNull());
  fireEvent.click(footer.querySelector('button') as HTMLElement);
};

beforeEach(() => {
  listFlexMessages.mockClear();
});

describe('🔴 the binding logic did NOT change', () => {
  it('⭐⭐⭐ picking a card calls onChange with that id and nothing else', async () => {
    /* This is the contract the dropdown had. The gallery must be indistinguishable
       from it as far as the campaign is concerned.
       [FEAT-20260907-GALLERYPICKCONFIRM] since 07/09 the click ASKS first, so the
       binding happens on confirm — the value is unchanged, the step is new. */
    const onChange = vi.fn();
    const { container } = wrap(<FlexCardPicker value={null} onChange={onChange} />);
    const c = container as HTMLElement;
    await openGallery(c);

    fireEvent.click(
      document.querySelector('[data-testid="flex-gallery-card-card-2"]') as HTMLElement,
    );
    await confirmPick();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('card-2');
  });

  it('⭐⭐⭐ clicking a card BINDS NOTHING until it is confirmed', async () => {
    /* [FEAT-20260907-GALLERYPICKCONFIRM] the point of the dialog: the tiles are
       large and adjacent, and a misclick used to rebind the campaign silently. */
    const onChange = vi.fn();
    const { container } = wrap(<FlexCardPicker value={null} onChange={onChange} />);
    await openGallery(container as HTMLElement);
    fireEvent.click(
      document.querySelector('[data-testid="flex-gallery-card-card-2"]') as HTMLElement,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('⭐⭐ the confirm names the card — an id would be no safer', async () => {
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    fireEvent.click(
      document.querySelector('[data-testid="flex-gallery-card-card-2"]') as HTMLElement,
    );
    await waitFor(() => expect(document.body.textContent).toContain('Welcome card'));
  });

  it('🔴 there is NO clear button — and that is a deliberate loss', async () => {
    /* [UI-20260907-GALLERYNOCLEAR] This case used to assert the opposite: that
       "ล้างค่า" still yielded `null`, matching the old combobox's `clearable`.
       That button was removed.
       The consequence is real and is recorded rather than hidden: a campaign can
       no longer be put back to having NO flex card from this screen. The picker's
       contract is unchanged — it still forwards whatever id it is given,
       including `null` — there is simply no control that sends one. */
    const { container } = wrap(<FlexCardPicker value={'card-1'} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    expect(document.querySelector('[data-testid="flex-gallery-clear"]')).toBeNull();
  });

  it('🔴 the picker still holds NO selection state of its own', () => {
    /* The selected id lives in the parent, through `value`/`onChange`. If the
       gallery had introduced a local copy, the form and the screen could
       disagree — the classic redesign bug. The only `useState` this file gained
       is the open/closed flag. */
    const states = PICKER_SRC.match(/useState[<(]/g) ?? [];
    expect(PICKER_SRC).toContain('const [galleryOpen, setGalleryOpen] = useState(false)');
    /* cards · loading · loadError · galleryOpen — and no fifth. */
    expect(states.length).toBe(4);
  });

  it('🔴 selecting does not fetch anything', async () => {
    /* Thumbnails come from `content_json` already on the list rows (proven in the
       BE's own list mapper). A per-tile request would turn opening the gallery
       into fifty calls. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    const before = listFlexMessages.mock.calls.length;
    fireEvent.click(
      document.querySelector('[data-testid="flex-gallery-card-card-1"]') as HTMLElement,
    );
    expect(listFlexMessages.mock.calls.length).toBe(before);
  });
});

describe('the gallery itself', () => {
  it('⭐⭐ shows every card with its name', async () => {
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    const grid = document.querySelector('[data-testid="flex-gallery-grid"]') as HTMLElement;
    expect(grid.querySelectorAll('button')).toHaveLength(CARDS.length);
    expect(grid.textContent).toContain('Promo card');
    expect(grid.textContent).toContain('Welcome card');
  });

  it('⭐⭐ lays out two across, as required', async () => {
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    const grid = document.querySelector('[data-testid="flex-gallery-grid"]') as HTMLElement;
    expect(grid.className).toContain('sm:grid-cols-2');
  });

  it('⭐⭐ has its own refresh button, and it really refetches', async () => {
    /* Owner asked for refresh from INSIDE the modal — somebody who just made a
       card in another tab is standing here, not up on the form's label row. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    listFlexMessages.mockClear();
    fireEvent.click(
      document.querySelector('[data-testid="flex-gallery-refresh"]') as HTMLElement,
    );
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalledTimes(1));
  });

  it('🔴 and the refetch is VISIBLE from inside the modal', async () => {
    /* [FIX-20260907-GALLERYREFRESHVISIBLE] It always refetched — a mutation that
       removed the call turned the case above red — but the picker's own
       "loading" line renders BEHIND this modal, so pressing refresh looked like
       pressing a dead button. The status now
       lives where the person pressing it is looking. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector('[data-testid="flex-gallery-count"]')).not.toBeNull(),
    );
    /* the count is the "it answered" signal — it reports even when the answer
       is the same list, which is the case the admin was unsure about */
    expect(
      document.querySelector('[data-testid="flex-gallery-count"]')?.textContent,
    ).toContain(String(CARDS.length));
  });

  it('🔴 the card tile does NOT scroll — it fits, 100%', async () => {
    /* [UI-20260907-GALLERYFITCARD] no scroll inside the card, show
       it whole. It used to be a 260px box with `overflow-y-auto`, so every tall
       card was cut off inside the tile the admin is meant to judge at a glance.
       Asserted on the class list because jsdom does no layout — there is no real
       height to measure, but there IS a fixed height and an overflow rule to
       forbid. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    const tile = document.querySelector('[data-testid="flex-gallery-card-card-1"]') as HTMLElement;
    const box = tile.firstElementChild as HTMLElement;
    expect(box.className).not.toContain('overflow-y-auto');
    expect(box.className).not.toMatch(/\bh-\[\d+px\]/);
  });

  it('⭐⭐ the gallery header carries "จัดการ flex message" — the SAME button', async () => {
    /* [FEAT-20260907-GALLERYMANAGELINK] Reuse, not a second button: this is the
       component that already owns the label, the permission dialog and the
       router `#`. Its testid is the proof it is that component and not a
       look-alike. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    expect(document.querySelector('[data-testid="manage-flex-messages"]')).not.toBeNull();
  });

  it('🔴 and its link still carries the router hash', async () => {
    /* The `#` is pinned in two files
       for that reason. Without it the tab opens on the SPA fallback. */
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    fireEvent.click(document.querySelector('[data-testid="manage-flex-messages"]') as HTMLElement);
    const url = String(open.mock.calls[0]?.[0] ?? '');
    expect(url.endsWith('#/flex-messages')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('⭐⭐ hover shows "เลือกการ์ดใบนี้" over the card', async () => {
    /* [UI-20260907-GALLERYHOVERPICK] The overlay is always in the DOM and is
       revealed by `group-hover` — jsdom does no layout and fires no CSS hover, so
       what is asserted is the MECHANISM: the label exists, the reveal is keyed on
       `group-hover`, and the card box blurs on the same event. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    const tile = document.querySelector('[data-testid="flex-gallery-card-card-1"]') as HTMLElement;
    expect(tile.className).toContain('group');
    expect(tile.textContent).toContain('เลือกการ์ดใบนี้');
    const overlay = tile.querySelector('.group-hover\\:opacity-100') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(tile.querySelector('[class*="group-hover:blur"]')).not.toBeNull();
  });

  it('🔴 the hover label is NOT a button — button-in-button is invalid HTML', () => {
    /* The tile IS the button. A real <button> inside it would make React warn,
       break keyboard order, and could swallow the click it advertises. The same
       trap `FlexCardCarousel` documents at the top of its tile. */
    const { container } = wrap(
      <FlexGalleryModal
        isOpen
        onClose={vi.fn()}
        cards={CARDS}
        value={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    void container;
    const tile = document.querySelector('[data-testid="flex-gallery-card-card-1"]') as HTMLElement;
    expect(tile.querySelectorAll('button')).toHaveLength(0);
  });

  it('⭐⭐ the confirm is BLUE, not the danger red', async () => {
    /* [UI-20260907-CONFIRMBLUETONE] Choosing a card is not destructive. The blue
       header comes from `type="info"`; the blue BUTTON comes from `confirmTone`,
       which exists so the dozen other `type="info"` dialogs in the app keep the
       green they have today. */
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    fireEvent.click(
      document.querySelector('[data-testid="flex-gallery-card-card-1"]') as HTMLElement,
    );
    const footer = await waitFor(() => {
      const f = document.querySelector('.flex-row-reverse') as HTMLElement;
      expect(f).not.toBeNull();
      return f;
    });
    const confirm = footer.querySelector('button') as HTMLElement;
    expect(confirm.className).toContain('bg-blue-600');
    expect(confirm.className).not.toContain('bg-red-600');
  });

  it('marks the currently bound card', async () => {
    const { container } = wrap(<FlexCardPicker value={'card-1'} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    const tile = document.querySelector('[data-testid="flex-gallery-card-card-1"]') as HTMLElement;
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    const other = document.querySelector('[data-testid="flex-gallery-card-card-2"]') as HTMLElement;
    expect(other.getAttribute('aria-pressed')).toBe('false');
  });

  it('the trigger prints the selected name, not the raw id', async () => {
    const { container } = wrap(<FlexCardPicker value={'card-1'} onChange={vi.fn()} />);
    const c = container as HTMLElement;
    await waitFor(() => expect(listFlexMessages).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (c.querySelector('[data-testid="flex-card-open-gallery"]') as HTMLElement).textContent,
      ).toContain('Promo card'),
    );
  });
});

describe('search inside the gallery', () => {
  it('the rule is plain and case-insensitive', () => {
    expect(matchesGalleryQuery('Promo card', 'promo')).toBe(true);
    expect(matchesGalleryQuery('Promo card', '  CARD ')).toBe(true);
    expect(matchesGalleryQuery('Promo card', 'welcome')).toBe(false);
  });

  it('🔴 filters in memory — no request per keystroke', () => {
    const onRefresh = vi.fn();
    const { container } = wrap(
      <FlexGalleryModal
        isOpen
        onClose={vi.fn()}
        cards={CARDS}
        value={null}
        onSelect={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.change(
      container.querySelector('[data-testid="flex-gallery-search"]') as HTMLElement,
      { target: { value: 'welcome' } },
    );
    const grid = document.querySelector('[data-testid="flex-gallery-grid"]') as HTMLElement;
    expect(grid.querySelectorAll('button')).toHaveLength(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('⭐⭐ has a clear button, shown only when there is text', async () => {
    const { container } = wrap(<FlexCardPicker value={null} onChange={vi.fn()} />);
    await openGallery(container as HTMLElement);
    const box = document.querySelector('[data-testid="flex-gallery-search"]') as HTMLElement;
    /* nothing typed → no button sitting there as dead furniture */
    expect(document.querySelector('[data-testid="flex-gallery-search-clear"]')).toBeNull();

    fireEvent.change(box, { target: { value: 'welcome' } });
    const clear = document.querySelector('[data-testid="flex-gallery-search-clear"]') as HTMLElement;
    expect(clear).not.toBeNull();
    fireEvent.click(clear);
    expect((box as HTMLInputElement).value).toBe('');
  });

  it('⭐⭐ REOPENING the gallery starts with an empty search', async () => {
    /* [UI-20260907-GALLERYSEARCHRESET] This component does NOT remount between
       openings — the `Modal` shell returns null but `FlexGalleryModal` stays
       mounted inside the picker, so its `useState('')` runs once for the life of
       the form. Without the effect, an admin who searched "coin" and came back
       later would see a filtered library and no reason why. */
    /* Driven through `isOpen` directly rather than through the picker's trigger:
       clicking the trigger while the modal is already open does not close it, so
       a click-click sequence would prove nothing. This is the real open → close →
       open the effect has to survive. */
    const props = {
      onClose: vi.fn(),
      cards: CARDS,
      value: null,
      onSelect: vi.fn(),
      onRefresh: vi.fn(),
    };
    const { rerender } = wrap(<FlexGalleryModal isOpen {...props} />);
    fireEvent.change(
      document.querySelector('[data-testid="flex-gallery-search"]') as HTMLElement,
      { target: { value: 'welcome' } },
    );
    expect(
      (document.querySelector('[data-testid="flex-gallery-search"]') as HTMLInputElement).value,
    ).toBe('welcome');

    rerender(
      <I18nProvider>
        <FlexGalleryModal isOpen={false} {...props} />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider>
        <FlexGalleryModal isOpen {...props} />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(
        (document.querySelector('[data-testid="flex-gallery-search"]') as HTMLInputElement).value,
      ).toBe(''),
    );
  });

  it('says so when nothing matches', () => {
    const { container } = wrap(
      <FlexGalleryModal
        isOpen
        onClose={vi.fn()}
        cards={CARDS}
        value={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.change(
      container.querySelector('[data-testid="flex-gallery-search"]') as HTMLElement,
      { target: { value: 'zzzz' } },
    );
    expect(document.querySelector('[data-testid="flex-gallery-empty"]')).not.toBeNull();
  });
});
