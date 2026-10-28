/**
 * [REFACTOR-20260904-OBJFORMSPLIT] Characterization of the Local Gallery panel,
 * written BEFORE it was lifted out of `ObjectImageFormModal` (§6.3 step 2).
 *
 * WHAT IT DEFENDS. The panel is 269 lines reading ~14 values from its parent —
 * exactly the shape that breaks quietly when it moves. These cases pin the
 * things a reader would notice immediately if the extraction went wrong:
 * whether it renders at all, the gate that hides it while creating, the stored
 * files, and the upload input.
 *
 * ⚠️ Written to pass on the UNCHANGED file first, then again after the move.
 * A characterization test that was only ever run after the move proves nothing
 * about the move.
 */
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

const STORED = [
  {
    id: 'st-1',
    _id: 'st-1',
    image_url: '/uploads/images/a.png',
    image_type: 'png',
    priority: 1,
  },
  {
    id: 'st-2',
    _id: 'st-2',
    image_url: '/uploads/images/b.png',
    image_type: 'png',
    priority: 2,
  },
];

/* Method names copied from the modal's own call sites. A mock that invents a
   name returns undefined and the panel renders empty, which reads exactly like
   the feature being broken — that cost time on the sibling suite already. */
vi.mock('../services/media', () => ({
  objectCategoryService: {
    listCategories: () => Promise.resolve({ data: [] }),
  },
  imageStorageService: { list: () => Promise.resolve(STORED) },
  isSafeImageLink: () => true,
}));
vi.mock('../services/admin', () => ({
  groupService: { listGroups: () => Promise.resolve({ data: [] }) },
  fetchVisibleGroups: () => Promise.resolve([]),
}));

import { ObjectImageFormModal } from '../components/object/ObjectImageFormModal';

const album = {
  id: 'album-1',
  _id: 'album-1',
  detail: '',
  matching_tag: [],
  storage: 'local',
  img_path: '',
  categories: [],
  status: true,
};

const mount = (mode: 'create' | 'update', initialData?: unknown) =>
  render(
    <ObjectImageFormModal
      isOpen
      onClose={() => {}}
      onSubmit={() => Promise.resolve()}
      mode={mode}
      initialData={initialData as never}
    />,
  );

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => vi.restoreAllMocks());

describe('[OBJFORMSPLIT] the Local Gallery panel', () => {
  it('⭐⭐ renders the stored files of a saved album', async () => {
    const view = mount('update', album);
    await waitFor(() => {
      const imgs = view.container.querySelectorAll(
        'img[src*="/uploads/images/"]',
      );
      expect(imgs.length, 'the stored files never rendered').toBe(STORED.length);
    });
  });

  it('⭐⭐ offers a file input for the upload', async () => {
    /* The dropzone is the panel's whole reason to exist; losing the input in a
       move would leave a box that looks right and accepts nothing. */
    const view = mount('update', album);
    await waitFor(() => {
      expect(view.container.querySelector('input[type="file"]')).not.toBeNull();
    });
  });

  it('🔴 stays hidden while CREATING — the gate that predates this refactor', async () => {
    /* `resolvedMode !== 'create'` guards it because the gallery needs a saved
       album id. Dropping that condition during a move would render an empty
       panel on step 2 of every new album. */
    const view = mount('create');
    await waitFor(() => {
      expect(view.container.querySelector('form')).not.toBeNull();
    });
    expect(
      view.container.querySelectorAll('img[src*="/uploads/images/"]').length,
    ).toBe(0);
  });
});

describe('[GALLERYHEADERROW] the caption is not squeezed by the dropzone', () => {
  it('🔴 the caption and the dropzone are NOT siblings in one flex row', async () => {
    /* 🔴 THE BUG THIS PINS. They used to sit together inside a
       `flex items-center justify-between` row, which lays children side by side —
       so the dashed dropzone took the width and the dashed border ran straight
       through "Local Gallery / SERVER SIDE STORAGE". The owner's screenshot shows
       the words cut mid-glyph.

       The assertion is structural because that is where the bug lives: jsdom
       loads no CSS, so nothing here can measure the overlap itself. What it CAN
       prove is that the two are no longer children of the same row — which is
       the condition that produced it. */
    const view = mount('update', album);
    const caption = await waitFor(() => {
      const el = Array.from(view.container.querySelectorAll('h4')).find(
        (h) => h.textContent === 'Local Gallery',
      );
      expect(el, 'the Local Gallery caption never rendered').toBeTruthy();
      return el as HTMLElement;
    });

    const fileInput = view.container.querySelector('input[type="file"]');
    expect(fileInput, 'no dropzone input to compare against').not.toBeNull();

    /* Walk EVERY ancestor of the caption that also contains the dropzone, and
       require none of them to be a horizontal flex row.
       ⚠️ NO `if (...)` ESCAPE HATCH. The first version of this case guarded the
       lookup with `if (row)`, so once the caption moved out the lookup returned
       null and the whole assertion was skipped — it passed with the bug put back.
       A check that can quietly not run is worse than no check. */
    let node: HTMLElement | null = caption.parentElement;
    const offenders: string[] = [];
    while (node && node !== view.container) {
      if (node.contains(fileInput as Node)) {
        const cls = node.className || '';
        const horizontal =
          cls.includes('justify-between') && !cls.includes('flex-col');
        if (horizontal) offenders.push(cls);
      }
      node = node.parentElement;
    }
    expect(
      offenders,
      'the caption shares a horizontal flex row with the dropzone — that is the ' +
        'layout that ran the dashed border through the text',
    ).toEqual([]);
  });
});

describe('[OBJVIDEO] a stored VIDEO renders as a player, not a broken image', () => {
  it('🔴 the tile picks <video> vs <img> from media_kind alone', async () => {
    /* 🔴 The rule, and why it is not "parse the extension": the BE schema
       comment on `media_kind` says the column exists precisely so the UI never
       guesses. A second rule here would drift from the one the data carries. */
    const { StoredMediaThumb } = await import(
      '../components/object/gallery/StoredMediaThumb'
    );
    const v = render(
      <StoredMediaThumb url="/uploads/videos/a.mp4" mediaKind="video" />,
    );
    expect(v.container.querySelector('video')).not.toBeNull();
    expect(v.container.querySelector('img')).toBeNull();

    const i = render(
      <StoredMediaThumb url="/uploads/images/a.png" mediaKind="image" />,
    );
    expect(i.container.querySelector('img')).not.toBeNull();
    expect(i.container.querySelector('video')).toBeNull();
  });

  it('🔴 a LEGACY row with no media_kind renders as an image', async () => {
    /* Absent is the documented meaning of "image" — every legacy row is one.
       Rendering those as <video> would blank the whole existing gallery. */
    const { StoredMediaThumb } = await import(
      '../components/object/gallery/StoredMediaThumb'
    );
    const view = render(<StoredMediaThumb url="/uploads/images/old.png" />);
    expect(view.container.querySelector('img')).not.toBeNull();
    expect(view.container.querySelector('video')).toBeNull();
  });

  it('🔴 media_kind BEATS the extension when the two disagree', async () => {
    /* 🔴 THE CASE THAT MAKES THIS SUITE MEAN ANYTHING. Every other case here
       uses a URL whose extension agrees with the kind, so a version that just
       parsed the filename passed them all — a mutation doing exactly that
       SURVIVED the first draft.
       These two disagree on purpose: a stored video reached through a URL with
       no `.mp4` on it (a signed or rewritten link), and an image whose name
       happens to end in `.mp4`. Only the column can answer either one. */
    const { StoredMediaThumb } = await import(
      '../components/object/gallery/StoredMediaThumb'
    );
    const v = render(
      <StoredMediaThumb url="/uploads/videos/clip" mediaKind="video" />,
    );
    expect(v.container.querySelector('video')).not.toBeNull();

    const i = render(
      <StoredMediaThumb url="/uploads/images/not-a-video.mp4" mediaKind="image" />,
    );
    expect(i.container.querySelector('img')).not.toBeNull();
    expect(i.container.querySelector('video')).toBeNull();
  });

  it('a video tile does not autoplay or preload the whole file', async () => {
    /* A gallery of clips must not start several downloads when the modal
       opens; the poster frame is what the admin needs. */
    const { StoredMediaThumb } = await import(
      '../components/object/gallery/StoredMediaThumb'
    );
    const view = render(
      <StoredMediaThumb url="/uploads/videos/a.mp4" mediaKind="video" />,
    );
    const el = view.container.querySelector('video') as HTMLVideoElement;
    expect(el.getAttribute('preload')).toBe('metadata');
    expect(el.hasAttribute('autoplay')).toBe(false);
  });
});

describe('[OBJVIDEO] the video badge', () => {
  it('🔴 marks a video tile and leaves image tiles alone', async () => {
    /* Marking both kinds would badge every tile in every existing album —
       noise for the case that needs no explanation. */
    const { MediaKindBadge } = await import(
      '../components/object/gallery/MediaKindBadge'
    );
    const v = render(<MediaKindBadge mediaKind="video" />);
    expect(v.container.querySelector('[data-testid="media-kind-badge"]')).not.toBeNull();

    const i = render(<MediaKindBadge mediaKind="image" />);
    expect(i.container.querySelector('[data-testid="media-kind-badge"]')).toBeNull();

    const legacy = render(<MediaKindBadge />);
    expect(legacy.container.querySelector('[data-testid="media-kind-badge"]')).toBeNull();
  });

  it('the badge never swallows a click meant for the tile', async () => {
    /* The tile is drag-to-reorder and the player has controls underneath. */
    const { MediaKindBadge } = await import(
      '../components/object/gallery/MediaKindBadge'
    );
    const view = render(<MediaKindBadge mediaKind="video" />);
    const el = view.container.querySelector('[data-testid="media-kind-badge"]');
    expect(el?.className).toContain('pointer-events-none');
  });
});
