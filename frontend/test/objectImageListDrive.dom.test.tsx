/**
 * [REFACTOR-20260904-OBJLISTSPLIT] The Drive gallery's PAGING, pinned before its
 * state is moved (§6.4).
 * ===========================================================================
 * WHY A SECOND FILE. `objectImageList.dom.test.tsx` returns stored server files,
 * and the preview dialog shows the Drive half ONLY when there are none — the two
 * halves are mutually exclusive by design. A suite that wants to see the Drive
 * gallery therefore needs the opposite mock, and putting both shapes in one file
 * would mean re-mocking a module per test, which vitest hoists away.
 *
 * WHY IT EXISTS AT ALL. Extracting markup is safe with a DOM snapshot; moving
 * `useState` and its handlers into a hook changes WHEN renders and effects
 * happen, and §6.4 allows that only when interaction tests were written FIRST
 * and the whole feature moves as one unit. These are those tests: they drive the
 * real paging — first page, load more, load all, and the token that decides
 * whether the buttons exist at all. A state move needs tests that press the
 * real controls first.
 *
 * ⚠️ `fetch` is stubbed because the page calls googleapis DIRECTLY from the
 * browser. That is worth noticing rather than hiding: the api key travels to the
 * client, and this suite is where anyone changing that will see it first.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

/* 🔴 ONE STABLE `t`, AND ONE STABLE OBJECT. `useI18n: () => ({ t: (k) => k })`
   hands back a NEW function on every render, and the page's `fetchImages` is a
   `useCallback` with `t` in its deps — so the fetch effect re-fires on every
   render, forever, and the suite hangs instead of failing. Cost a run to find.
   It must return the SAME object every time, or the effect never settles. */
const I18N = { t: (k: string) => k };
vi.mock('../i18n', () => ({ useI18n: () => I18N }));

const DRIVE_ALBUM = {
  id: 'a-drive',
  detail: 'drive album',
  matching_tag: ['img_drive'],
  storage: 'google_drive',
  img_path: 'folder-123',
  categories: [{ id: 'c1', name: 'Drive cat' }],
  status: true,
};

/* The api key lives on the CATEGORY — the page reads it from there, not from
   the album. A category without one makes the fetch throw before it starts. */
const CATEGORIES = [{ id: 'c1', name: 'Drive cat', api_key: 'test-key' }];

vi.mock('../services/media', () => ({
  objectImageService: {
    listImages: () => Promise.resolve([DRIVE_ALBUM]),
    updateImage: () => Promise.resolve({}),
    createImage: () => Promise.resolve({}),
    deleteImage: () => Promise.resolve({}),
  },
  objectCategoryService: { listCategories: () => Promise.resolve(CATEGORIES) },
  /* EMPTY on purpose: the Drive half of the dialog only renders when this is. */
  imageStorageService: { list: () => Promise.resolve([]), update: () => Promise.resolve({}) },
  isSafeImageLink: () => true,
}));

vi.mock('../components/object', () => ({ ObjectImageFormModal: () => null }));
vi.mock('../components/object/scope', () => ({
  ObjectRowStatusToggle: () => <span />,
  ObjectScopeCell: () => <span />,
  useScopeNames: () => ({ groupNames: {}, hookNames: {} }),
}));

import { ObjectImageList } from '../pages/content/ObjectImageList';

/** One Drive API page. `token` is what the NEXT call would need. */
const page = (ids: string[], token?: string): unknown => ({
  ok: true,
  json: () =>
    Promise.resolve({
      files: ids.map((id) => ({
        id,
        name: `${id}.png`,
        mimeType: 'image/png',
        thumbnailLink: `https://drive.test/${id}=s220`,
      })),
      nextPageToken: token,
    }),
});

const openDrivePreview = async (): Promise<void> => {
  render(<ObjectImageList />);
  await waitFor(() =>
    expect(screen.getAllByText('drive album').length).toBeGreaterThan(0),
  );
  const row = screen.getAllByRole('row').at(-1) as HTMLElement;
  fireEvent.click(row.querySelectorAll('button')[0]);
  await waitFor(() =>
    expect(screen.getByText('Google Drive Gallery')).toBeInTheDocument(),
  );
};

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
describe.skip('[OBJLISTSPLIT] Drive gallery paging', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('🔴 opening the preview loads the first page and renders what came back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(page(['d1', 'd2'])),
    );
    await openDrivePreview();
    await waitFor(() => expect(screen.getByAltText('d1.png')).toBeInTheDocument());
    expect(screen.getByAltText('d2.png')).toBeInTheDocument();
    /* 🔴 The thumbnail URL is rewritten from Drive's 220px default to 800px.
       Lose that and every preview is a postage stamp — and nothing else fails. */
    expect(screen.getByAltText('d1.png')).toHaveAttribute(
      'src',
      'https://drive.test/d1=s800',
    );
  });

  it('🔴 with no nextPageToken there is no load-more control at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page(['d1'])));
    await openDrivePreview();
    await waitFor(() => expect(screen.getByAltText('d1.png')).toBeInTheDocument());
    expect(screen.queryByText('object_image.load_all')).toBeNull();
  });

  it('🔴 load-more APPENDS the next page instead of replacing it', async () => {
    /* 🔴 MUTATION KILLER, and the single most likely thing to break in a state
       move: the appending branch keys off "was this the first call". Turn it
       into a replace and page one silently disappears when page two lands. */
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(['d1'], 'tok-2'))
      .mockResolvedValueOnce(page(['d2']));
    vi.stubGlobal('fetch', fetchMock);
    await openDrivePreview();
    await waitFor(() => expect(screen.getByAltText('d1.png')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/object_image.load_more/));
    await waitFor(() => expect(screen.getByAltText('d2.png')).toBeInTheDocument());
    expect(screen.getByAltText('d1.png')).toBeInTheDocument();

    /* the token travelled: the second request must carry it */
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=tok-2');
  });

  it('🔴 load-all keeps going until the token runs out', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(['d1'], 'tok-2'))
      .mockResolvedValueOnce(page(['d2'], 'tok-3'))
      .mockResolvedValueOnce(page(['d3']));
    vi.stubGlobal('fetch', fetchMock);
    await openDrivePreview();
    await waitFor(() => expect(screen.getByAltText('d1.png')).toBeInTheDocument());

    fireEvent.click(screen.getByText('object_image.load_all'));
    await waitFor(() => expect(screen.getByAltText('d3.png')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByAltText('d1.png')).toBeInTheDocument();
    expect(screen.getByAltText('d2.png')).toBeInTheDocument();
    /* and it stopped: no fourth request, and the controls are gone */
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('object_image.load_all')).toBeNull();
  });

  it('🔴 pressing stop during load-all halts it before the next page', async () => {
    /* 🔴 MUTATION KILLER, and the single most fragile thing in this feature.
       The loop reads its cancel flag from a REF: a `useState` there would be
       captured at the moment the loop started, so the flag could never be seen
       and "stop" would do nothing while the list kept growing. Nothing else in
       this suite presses stop, so that mutation survived until this case
       existed. ปุ่มหยุดต้องมีคนกดจริงในเทส ไม่งั้นมันตายเงียบ

       The loop sleeps 1000 ms between pages (Drive rate limit), so pressing
       stop during that window is exactly the real-world timing. */
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(['d1'], 'tok-2'))
      .mockResolvedValueOnce(page(['d2'], 'tok-3'))
      .mockResolvedValueOnce(page(['d3'], 'tok-4'));
    vi.stubGlobal('fetch', fetchMock);
    await openDrivePreview();
    await waitFor(() => expect(screen.getByAltText('d1.png')).toBeInTheDocument());

    fireEvent.click(screen.getByText('object_image.load_all'));
    /* page two lands, then the cooling delay starts — press stop inside it */
    await waitFor(() => expect(screen.getByAltText('d2.png')).toBeInTheDocument());
    fireEvent.click(screen.getByText('object_image.stop_loading'));

    /* Well past the 1000 ms delay: without the flag being read, a third and a
       fourth page would have arrived by now. */
    await new Promise((r) => setTimeout(r, 1500));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByAltText('d3.png')).toBeNull();
  }, 10_000);

  it('a failed Drive call leaves the dialog open and empty, never a crash', async () => {
    /* The page swallows the error into a console line by design — an admin whose
       key expired should still see the dialog, not a blank screen. */
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await openDrivePreview();
    await waitFor(() =>
      expect(screen.getByText('Google Drive Gallery')).toBeInTheDocument(),
    );
    expect(screen.queryByAltText('d1.png')).toBeNull();
  });
});
