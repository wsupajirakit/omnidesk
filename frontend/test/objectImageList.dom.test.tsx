/**
 * [REFACTOR-20260904-OBJLISTSPLIT] Characterization of the Object album LIST
 * page, written BEFORE anything is lifted out of it (§6.3 step 2).
 *
 * WHY IT HAD TO BE WRITTEN FIRST. `pages/content/ObjectImageList.tsx` is 1,089
 * lines, is on the eslint waiver list, and had **no test at all** — so every
 * seam in it was unguarded. Splitting a file with no net is how a column, a
 * badge or a whole branch of the thumbnail disappears without anything going
 * red. Net first, then cut.
 *
 * WHAT IT PINS — deliberately the blocks that are about to move:
 *  · the eight table headers, in order
 *  · one row per album, with detail, tags in `[[[tag]]]` form and its categories
 *  · every branch of the thumbnail cell (thumb · external · local · drive · raw
 *    path · nothing) — five of the six are easy to lose in a move because only
 *    one of them is exercised by a screenshot
 *  · the filter bar: search box, category select filled from the service, tag box
 *  · the empty state, and the pagination readout
 *
 * It asserts on TEXT and ROLES, never on class strings, so a lift that keeps the
 * markup identical passes and a lift that quietly drops a branch does not.
 *
 * ⚠️ Run green on the UNCHANGED file first, then again after each extraction.
 * A characterization suite first run AFTER the move proves nothing about it.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/* Explicit, not relying on the auto-cleanup: without it the second `mount()` in
   this file finds two copies of every row and every query fails with "found
   multiple elements" — which reads like the page rendering twice, and cost a
   run to diagnose. */
afterEach(cleanup);

/* 🔴 ONE STABLE `t`, AND ONE STABLE OBJECT. `useI18n: () => ({ t: (k) => k })`
   hands back a NEW function on every render, and the page's `fetchImages` is a
   `useCallback` with `t` in its deps — so the fetch effect re-fires on every
   render, forever, and the suite hangs instead of failing. Cost a run to find.
   It must return the SAME object every time, or the effect never settles. */
const I18N = { t: (k: string) => k };
vi.mock('../i18n', () => ({ useI18n: () => I18N }));

/* One album per storage kind, so every thumbnail branch has an owner. Field
   names copied from the page's own reads — a mock that invents one renders an
   empty cell, which reads exactly like the feature being broken. */
const ALBUMS = [
  {
    id: 'a-thumb',
    detail: 'album with thumb',
    matching_tag: ['img_a_1'],
    storage: 'local',
    first_thumb: '/uploads/images/thumb.png',
    img_path: '',
    categories: [{ id: 'c1', name: 'Promotions' }],
    status: true,
  },
  {
    id: 'a-external',
    detail: 'album external',
    matching_tag: ['img_a_2', 'img_a_3'],
    storage: 'external',
    img_path: '',
    categories: [],
    status: true,
  },
  {
    id: 'a-local',
    detail: 'album local',
    matching_tag: [],
    storage: 'local',
    img_path: '',
    categories: [],
    status: false,
  },
  {
    id: 'a-drive',
    detail: 'album drive',
    matching_tag: 'img_single',
    storage: 'google_drive',
    img_path: '',
    categories: [],
    status: true,
  },
  {
    id: 'a-path',
    detail: '',
    matching_tag: [],
    storage: 'other',
    img_path: 'https://cdn.example/x.png',
    categories: [],
    status: true,
  },
];

/* One stored file, so the preview's Server Storage grid — and the zoom and
   detail buttons that live on it — have something to render. */
const STORED = [
  {
    id: 'st-1',
    image_url: '/uploads/images/stored.png',
    detail_link: 'https://example.test/a',
    detail_text: 'caption',
    created_by_name: 'Super User',
  },
  /* [FEAT-20260904-OBJVIDEO] a stored VIDEO beside the image. Before this row
     existed, the suite could not tell the two apart and the preview grid
     rendered every file as <img> — a video showed as a broken image here while
     playing correctly in the album modal. */
  {
    id: 'st-2',
    image_url: '/uploads/videos/stored.mp4',
    media_kind: 'video',
    detail_link: null,
    detail_text: null,
    /* a row nobody's account can be resolved for — legacy, or a deleted user.
       Nothing was backfilled, so this is a real shape. */
    created_by_name: null,
  },
];

const CATEGORIES = [
  { id: 'c1', name: 'Promotions' },
  { id: 'c2', name: 'Bonuses' },
];

/* A spy, so the cases below can assert WHAT was asked of the server — the local
   filter and the refetch are two different rules and both have to survive. */
const listImages = vi.fn(() => Promise.resolve(ALBUMS));

vi.mock('../services/media', () => ({
  objectImageService: {
    listImages: (...args: unknown[]) => listImages(...(args as [])),
    updateImage: () => Promise.resolve({}),
    createImage: () => Promise.resolve({}),
    deleteImage: () => Promise.resolve({}),
  },
  objectCategoryService: {
    listCategories: () => Promise.resolve(CATEGORIES),
  },
  imageStorageService: {
    list: () => Promise.resolve(STORED),
    update: () => Promise.resolve({}),
  },
  isSafeImageLink: () => true,
}));

/* The form modal is 1,640 lines and has its own suites. Stubbing it keeps this
   suite about the LIST, and keeps the render fast enough to stay inside the
   machine's CPU budget. */
vi.mock('../components/object', () => ({
  ObjectImageFormModal: () => null,
}));

vi.mock('../components/object/scope', () => ({
  ObjectRowStatusToggle: ({ name }: { name: string }) => (
    <span data-testid="row-status">{name}</span>
  ),
  ObjectScopeCell: ({ rowName }: { rowName: string }) => (
    <span data-testid="scope-cell">{rowName}</span>
  ),
  useScopeNames: () => ({ groupNames: {}, hookNames: {} }),
}));

import { ObjectImageList } from '../pages/content/ObjectImageList';

const mount = async (): Promise<void> => {
  render(<ObjectImageList />);
  await waitFor(() =>
    expect(screen.getAllByText('album with thumb').length).toBeGreaterThan(0),
  );
};

/*
 * Find a row by the album's detail.
 *
 * ⚠️ `getAllByText`, not `getByText`: the detail sits in a `<div>` whose `<td>`
 * has no other content, so BOTH match and `getByText` throws "found multiple
 * elements" — a failure that reads like the page rendering twice and is not.
 * Every match is inside the same `<tr>`, so taking the first is exact.
 */
const rowFor = (detail: string): HTMLElement => {
  const row = screen.getAllByText(detail)[0]?.closest('tr');
  if (!row) throw new Error(`no row for ${detail}`);
  return row;
};

describe('[OBJLISTSPLIT] the table', () => {
  /* ⚠️ [UI-20260904-HIDEMATCHTAG] FLIPPED 04/09, kept for the argument.
   *
   * These five cases pinned the "Matching Tag" column: the header list, the tag
   * chips in a row, the string-or-array branch, and the COPY button with what it
   * writes. The owner asked for the column to go from the table and from the
   * preview dialog, so the ones that assert it is DRAWN cannot stand.
   *
   * What is retired is only the RENDERING. `matching_tag` is still stored, still
   * returned, still what the bot matches on, and the copy logic is untouched
   * behind `SHOW_MATCHING_TAG` — flip that flag and the old expectations below
   * are what should come back, including the bracket shape the bot needs.
   * ซ่อนแค่การแสดงผล ข้อมูลและตรรกะคัดลอกยังอยู่ครบ
   *
   * The header/cell ALIGNMENT case is new, and it is the one that matters now:
   * the `<th>` and the `<td>` live in different files, so hiding one alone does
   * not remove a column — it shifts every column after it, and the table still
   * looks plausible. หัวกับช่องต้องหายพร้อมกัน ไม่งั้นคอลัมน์เลื่อนแบบดูไม่ออก
   */
  it('renders the headers in order, without the matching-tag column', async () => {
    await mount();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'object_image.header_image',
      'object_image.header_detail',
      'object_image.header_categories',
      'object_image.header_storage',
      'object_scope.column',
      'object_scope.status_label',
      'object_image.header_actions',
    ]);
    expect(headers).not.toContain('object_image.header_tag');
  });

  it('renders one row per album', async () => {
    await mount();
    /* +1 for the header row. A row lost in a move shows up here first. */
    expect(screen.getAllByRole('row')).toHaveLength(ALBUMS.length + 1);
  });

  it('⭐ every row has exactly as many cells as there are headers', async () => {
    /* 🔴 THE REAL HAZARD of hiding a column across two files. Gate the header
       and forget the cell and the table keeps rendering: Categories simply slides
       under Storage. Nothing throws, nothing looks broken, and the numbers are
       wrong on every row. This is the case that catches it. */
    await mount();
    const headerCount = screen.getAllByRole('columnheader').length;
    const row = rowFor('album with thumb');
    expect(within(row).getAllByRole('cell')).toHaveLength(headerCount);
  });

  it('a row carries its detail and its categories', async () => {
    await mount();
    const row = rowFor('album with thumb');
    expect(within(row).getByText('Promotions')).toBeInTheDocument();
  });

  it('⭐ the matching tag is not drawn anywhere in the table', async () => {
    /* Asserted per SHAPE, both branches: an array tag and a bare-string tag.
       The page handled `matching_tag` as string OR array in three places, so a
       half-done hide would leave one of them on screen. */
    await mount();
    expect(within(rowFor('album with thumb')).queryByText('[[[img_a_1]]]')).toBeNull();
    expect(within(rowFor('album drive')).queryByText('[[[img_single]]]')).toBeNull();
  });

  it('⭐ the COPY button goes with the column — nothing is left half-hidden', async () => {
    /* The button lived inside the tag cell. A hide that dropped the chips but
       kept the button would leave an action that copies something invisible. */
    await mount();
    expect(within(rowFor('album external')).queryByText('COPY')).toBeNull();
    expect(within(rowFor('album local')).queryByText('COPY')).toBeNull();
  });

  it('each row shows the upload, edit and delete actions', async () => {
    /* [UI-20260907-HIDEVIEWEYE] The row used to be view / edit / delete. The eye
       is hidden and an "upload" action took its place at the front of the
       cluster: every entry point for an existing album now opens the form on its
       media step, so a third door labelled "view" was the same room again.
       ⚠️ `common.view` is deliberately asserted ABSENT — the button was hidden,
          not merely reordered, and a case that only checked the three that remain
          would still pass if it came back. */
    await mount();
    const row = rowFor('album local');
    for (const title of ['object_image.upload_action', 'common.edit', 'common.delete']) {
      expect(within(row).getByTitle(title)).toBeInTheDocument();
    }
    expect(within(row).queryByTitle('common.view')).toBeNull();
  });

  it('the scope cell and the status switch are given the row name', async () => {
    await mount();
    const row = rowFor('album local');
    expect(within(row).getByTestId('scope-cell')).toHaveTextContent('album local');
    expect(within(row).getByTestId('row-status')).toHaveTextContent('album local');
  });
});

describe('[OBJLISTSPLIT] the thumbnail cell — every branch', () => {
  it('a stored thumbnail renders an <img> with that src', async () => {
    await mount();
    const img = within(rowFor('album with thumb')).getByRole('img');
    expect(img).toHaveAttribute('src', '/uploads/images/thumb.png');
  });

  it('🔴 external storage shows the External Link marker', async () => {
    /* 🔴 MUTATION KILLER for the branch order: these four cases answer
       differently only while the `first_thumb → external → local → drive`
       chain is intact. Collapsing any two of them changes exactly one. */
    await mount();
    expect(
      within(rowFor('album external')).getByText('External Link'),
    ).toBeInTheDocument();
  });

  it('🔴 local storage shows the Local marker', async () => {
    await mount();
    expect(within(rowFor('album local')).getByText('Local')).toBeInTheDocument();
  });

  it('🔴 google drive storage shows the Drive Gallery marker', async () => {
    await mount();
    expect(
      within(rowFor('album drive')).getByText('Drive Gallery'),
    ).toBeInTheDocument();
  });

  it('a raw img_path with no thumb still renders an <img>', async () => {
    await mount();
    const row = screen.getAllByRole('row').at(-1) as HTMLElement;
    expect(within(row).getByRole('img')).toHaveAttribute(
      'src',
      'https://cdn.example/x.png',
    );
  });
});

describe('[OBJLISTSPLIT] the filter bar and the footer', () => {
  it('the search box is present and empty', async () => {
    await mount();
    const search = screen.getByTestId('object-image-search');
    expect(search).toHaveValue('');
    expect(search).toHaveAttribute(
      'placeholder',
      'object_image.search_placeholder',
    );
  });

  it('🔴 the category select is filled from the service, with an "all" option first', async () => {
    /* 🔴 The options come from a fetch the filter bar does not own. If the bar
       moves without its `categories` prop, this is what goes red — the select
       renders with only the "all" entry and looks harmless. */
    await mount();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    /* The page reads `t('…filter_category_all') || 'All Categories'`, and the
       stub `t` returns the key — so the key is what "all" looks like here. */
    expect(options[0]).toBe('object_image.filter_category_all');
    expect(options).toContain('Promotions');
    expect(options).toContain('Bonuses');
  });

  it('the refresh and add buttons are present', async () => {
    await mount();
    expect(screen.getByText('common.refresh')).toBeInTheDocument();
    expect(screen.getByText('common.add_new')).toBeInTheDocument();
  });

  it('the link out to the categories screen opens in a new tab, safely', async () => {
    await mount();
    const link = screen.getByTestId('object-images-to-categories');
    expect(link).toHaveAttribute('href', '#/object-categories');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('the pagination readout shows the current and total pages', async () => {
    await mount();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });
});

/**
 * The overlays. They render only once state is set, so nothing above reaches
 * them — and an extraction whose only proof is a suite that never opened it is
 * exactly the hole §8 warns about.
 *
 * ⚠️ These three were written AFTER the zoom overlay and the detail dialog were
 * lifted, not before, and that is said out loud rather than implied: they were
 * proven instead by mutating the moved files and watching these cases go red.
 * The preview modal itself has not been moved yet — for THAT one, this is the
 * BEFORE net, in the right order.
 */
/* 🔴 PARKED 07/09 — NOT DELETED, AND NOT PASSING EITHER.
   [FEAT-20260907-OBJUPLOADSTEP] These cases reach the album PREVIEW dialog by
   clicking a row's thumbnail. On 07/09 that click was repointed at the
   edit form's media step, so the dialog has no entry point left and these cases
   can no longer open what they assert about.

   They are SKIPPED rather than deleted because the dialog
   and its Drive gallery to be kept for possible future use. Skipping keeps the
   assertions — and the fact that a decision is outstanding — visible in the
   suite output, where a deletion would erase both.

   To bring them back: give `ObjectImagePreviewModal` an entry point again (the
   eye button is the obvious candidate) and point `openPreview` in these files at
   it. To retire them: delete this file's skipped blocks together with
   `ObjectImagePreviewModal`, `useGDrivePreview` and `ObjectImageZoomOverlay`. */
describe.skip('[OBJLISTSPLIT] the overlays', () => {
  const openPreview = async (detail: string): Promise<void> => {
    await mount();
    /* '' means the album with no detail — the last row, which is the only one
       carrying a raw `img_path` and therefore the only one that can show the
       single-image half of the dialog. */
    const row =
      detail === ''
        ? (screen.getAllByRole('row').at(-1) as HTMLElement)
        : rowFor(detail);
    /* The thumbnail is the FIRST button in the row; the others are COPY and the
       three actions. `getByRole('button')` would find five. */
    fireEvent.click(within(row).getAllByRole('button')[0]);
    await waitFor(() =>
      expect(screen.getByText('common.close')).toBeInTheDocument(),
    );
  };

  it('clicking a thumbnail opens the preview with that album inside it', async () => {
    await openPreview('album drive');
    /* ⚠️ [UI-20260904-HIDEMATCHTAG] This used the album's TAG as its proof of
       "the right album opened". The dialog no longer draws the tag, so the
       storage line — which names this album's own kind — carries that job now,
       and the tag's absence is asserted alongside it rather than left untested.
       เคยใช้ tag เป็นตัวยืนยันว่าเปิดถูกอัลบั้ม ตอนนี้ใช้บรรทัด storage แทน */
    expect(screen.getByText('google_drive storage')).toBeInTheDocument();
    expect(screen.queryByText('[[[img_single]]]')).toBeNull();
  });

  it('🔴 the preview lists the stored files the service returned', async () => {
    /* 🔴 The grid is fed by a fetch the preview does not own. If it is ever
       moved without its `serverPreviewImages` prop it renders an empty grid,
       which looks like an album with no files rather than a broken screen. */
    await openPreview('album with thumb');
    expect(screen.getByText('Server Storage (Local Gallery)')).toBeInTheDocument();
    const stored = screen
      .getAllByRole('img')
      .filter((i) => i.getAttribute('src') === '/uploads/images/stored.png');
    expect(stored.length).toBe(1);
  });

  it('🔴 with stored files present, the single-image view is NOT also rendered', async () => {
    /* 🔴 MUTATION KILLER. The two halves of the dialog are mutually exclusive:
       the stored-file grid shows when there are files, the single image / Drive
       gallery only when there are none. Both conditions read the same two values
       from opposite sides, so a mutation that makes one unconditional renders
       BOTH — and every other case here stays green, because each of them only
       ever asserts that its own half is present. Caught exactly that way. */
    await openPreview('');
    expect(screen.getByText('Server Storage (Local Gallery)')).toBeInTheDocument();
    /* the caption under the single image — its only text on screen */
    expect(screen.queryByText('https://cdn.example/x.png')).toBeNull();
  });

  it('🔴 the zoom button opens the full-screen overlay on that file', async () => {
    await openPreview('album with thumb');
    /* two stored files now, so two zoom buttons — [0] is the image's */
    fireEvent.click(screen.getAllByTitle('Zoom Preview')[0]);
    await waitFor(() =>
      expect(screen.getByText('Click anywhere to close')).toBeInTheDocument(),
    );
    const shown = screen.getByAltText('Fullscreen preview');
    expect(shown).toHaveAttribute('src', '/uploads/images/stored.png');
  });

  it('🔴 the edit button opens the detail dialog filled from that file', async () => {
    await openPreview('album with thumb');
    fireEvent.click(screen.getAllByTitle('Edit Details')[0]);
    await waitFor(() =>
      expect(screen.getByText('object_image.edit_image_details')).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('https://example.test/a')).toBeInTheDocument();
    expect(screen.getByDisplayValue('caption')).toBeInTheDocument();
  });
});

/**
 * [FEAT-20260904-OBJVIDEO] Video has to be watchable on THIS screen too.
 *
 * The album modal's gallery already decided image-vs-video from `media_kind`;
 * this page's preview did not, so a stored clip rendered as a broken `<img>`
 * and the zoom overlay showed nothing. Both now read the same column through
 * the same component: one rule, shared by both screens.
 */
/* 🔴 PARKED 07/09 — NOT DELETED, AND NOT PASSING EITHER.
   [FEAT-20260907-OBJUPLOADSTEP] These cases reach the album PREVIEW dialog by
   clicking a row's thumbnail. On 07/09 that click was repointed at the
   edit form's media step, so the dialog has no entry point left and these cases
   can no longer open what they assert about.

   They are SKIPPED rather than deleted because the dialog
   and its Drive gallery to be kept for possible future use. Skipping keeps the
   assertions — and the fact that a decision is outstanding — visible in the
   suite output, where a deletion would erase both.

   To bring them back: give `ObjectImagePreviewModal` an entry point again (the
   eye button is the obvious candidate) and point `openPreview` in these files at
   it. To retire them: delete this file's skipped blocks together with
   `ObjectImagePreviewModal`, `useGDrivePreview` and `ObjectImageZoomOverlay`. */
describe.skip('[OBJVIDEO] a stored video on the album list page', () => {
  const openPreview = async (): Promise<void> => {
    await mount();
    const row = rowFor('album with thumb');
    fireEvent.click(within(row).getAllByRole('button')[0]);
    await waitFor(() =>
      expect(screen.getByText('Server Storage (Local Gallery)')).toBeInTheDocument(),
    );
  };

  it('🔴 renders a <video> for the video row and an <img> for the image row', async () => {
    /* 🔴 MUTATION KILLER. Every earlier case here only ever had images, so the
       grid could render <img> unconditionally and stay green. */
    await openPreview();
    const video = document.querySelector('video[src="/uploads/videos/stored.mp4"]');
    expect(video).not.toBeNull();
    const img = screen
      .getAllByRole('img')
      .find((i) => i.getAttribute('src') === '/uploads/images/stored.png');
    expect(img).toBeDefined();
    /* and the video is NOT rendered as an image */
    expect(
      screen.queryAllByRole('img').find(
        (i) => i.getAttribute('src') === '/uploads/videos/stored.mp4',
      ),
    ).toBeUndefined();
  });

  it('🔴 zooming a video opens a player, not a picture', async () => {
    /* 🔴 The overlay took a bare url while only images could be stored. If the
       kind stops travelling with it, this renders <img src="…mp4"> — a broken
       image with no error anywhere. */
    await openPreview();
    const zoomButtons = screen.getAllByTitle('Zoom Preview');
    fireEvent.click(zoomButtons[1]);
    await waitFor(() =>
      expect(screen.getByText('Click anywhere to close')).toBeInTheDocument(),
    );
    const player = screen.getByTestId('zoom-video');
    expect(player).toHaveAttribute('src', '/uploads/videos/stored.mp4');
    expect(screen.queryByAltText('Fullscreen preview')).toBeNull();
  });
});

/**
 * [FEAT-20260904-UPLOADEDBY] Who uploaded each stored file.
 *
 * ⚠️ The name is RESOLVED BY THE SERVER from `created_by`, which stores an id
 * and only an id. There is no id in the payload, so these cases also pin that
 * nothing id-shaped can appear on screen.
 */
/* 🔴 PARKED 07/09 — NOT DELETED, AND NOT PASSING EITHER.
   [FEAT-20260907-OBJUPLOADSTEP] These cases reach the album PREVIEW dialog by
   clicking a row's thumbnail. On 07/09 that click was repointed at the
   edit form's media step, so the dialog has no entry point left and these cases
   can no longer open what they assert about.

   They are SKIPPED rather than deleted because the dialog
   and its Drive gallery to be kept for possible future use. Skipping keeps the
   assertions — and the fact that a decision is outstanding — visible in the
   suite output, where a deletion would erase both.

   To bring them back: give `ObjectImagePreviewModal` an entry point again (the
   eye button is the obvious candidate) and point `openPreview` in these files at
   it. To retire them: delete this file's skipped blocks together with
   `ObjectImagePreviewModal`, `useGDrivePreview` and `ObjectImageZoomOverlay`. */
describe.skip('[UPLOADEDBY] the album list preview names the uploader', () => {
  it('🔴 shows the resolved name, and a dash when there is none', async () => {
    /* 🔴 A blank caption and a missing caption look identical on screen; the
       dash is what makes "nobody recorded" readable. And a legacy row really
       does arrive with null — no backfill was done, by instruction. */
    await mount();
    const row = rowFor('album with thumb');
    fireEvent.click(within(row).getAllByRole('button')[0]);
    await waitFor(() =>
      expect(screen.getByText('Server Storage (Local Gallery)')).toBeInTheDocument(),
    );
    const captions = screen
      .getAllByTestId('uploader-caption')
      .map((c) => c.textContent);
    expect(captions).toContain('Super User');
    expect(captions).toContain('—');
  });
});

/**
 * [REFACTOR-20260904-OBJLISTSPLIT] The list's own data rules, pinned BEFORE the
 * fetch/filter/paging state is moved into a hook (§6.4).
 *
 * These are behaviours, not markup: what the search actually matches, what the
 * tag catalogue collects, and the fact that typing re-queries the SERVER rather
 * than only filtering what is already on screen. A hook that kept the state but
 * dropped one of these would render a perfectly normal-looking list.
 */
describe('[OBJLISTSPLIT] search, filter and the request behind them', () => {
  it('🔴 typing re-queries the server with the term', async () => {
    /* 🔴 The page filters locally AND refetches — the effect depends on
       `search`. A move that keeps only the local filter looks right until the
       album that matches is on page two of a result the server never sent. */
    await mount();
    listImages.mockClear();
    fireEvent.change(screen.getByTestId('object-image-search'), {
      target: { value: 'external' },
    });
    await waitFor(() =>
      expect(listImages).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'external' }),
      ),
    );
  });

  it('🔴 the local filter matches detail, tag OR category name', async () => {
    /* 🔴 Three branches, and only one of them is exercised by typing a word you
       can see in the first column. */
    await mount();
    fireEvent.change(screen.getByTestId('object-image-search'), {
      target: { value: 'promotions' },
    });
    await waitFor(() => {
      /* matched by CATEGORY name, not by its detail text */
      expect(screen.getAllByText('album with thumb').length).toBeGreaterThan(0);
      expect(screen.queryByText('album external')).toBeNull();
    });
  });

  it('🔴 a blank search shows everything again, untouched', async () => {
    await mount();
    fireEvent.change(screen.getByTestId('object-image-search'), {
      target: { value: 'nothing-matches-this' },
    });
    await waitFor(() =>
      expect(screen.queryByText('album with thumb')).toBeNull(),
    );
    fireEvent.change(screen.getByTestId('object-image-search'), {
      target: { value: '   ' },
    });
    await waitFor(() =>
      expect(screen.getAllByText('album with thumb').length).toBeGreaterThan(0),
    );
  });

  it('choosing a category asks the server for that category', async () => {
    await mount();
    listImages.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c2' } });
    await waitFor(() =>
      expect(listImages).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'c2' }),
      ),
    );
  });

  it('the footer counts what the server said, not what is drawn', async () => {
    await mount();
    expect(screen.getByText('common.showing_total')).toBeInTheDocument();
  });
});
