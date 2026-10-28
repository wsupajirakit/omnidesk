/**
 * [REFACTOR-20260904-OBJFORMSPLIT] The album FORM's Google Drive gallery, pinned
 * before its state is moved (§6.4).
 * ===========================================================================
 * The list page's Drive gallery has `objectImageListDrive.dom.test.tsx`. The
 * form's own Drive gallery — a different component, a different state, the same
 * API — had nothing: no case loaded a page, pressed load-more, or uploaded one
 * Drive file into our storage.
 *
 * WHAT IT PINS:
 *  · the first page loads when the album is on Drive and its category has a key
 *  · NO key means the gallery empties instead of calling Drive with `key=undefined`
 *  · load-more APPENDS rather than replaces
 *  · one Drive file can be pushed into our own storage, and the stored list
 *    reloads afterwards
 *
 * ⚠️ `fetch` is stubbed: the browser talks to googleapis directly here, which is
 * pre-existing and is why the api key reaches the client at all.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const I18N = { t: (k: string) => k };
vi.mock('../i18n', () => ({ useI18n: () => I18N }));

const CATEGORIES = [
  { id: 'c1', name: 'With key', api_key: 'KEY-1' },
  { id: 'c2', name: 'No key' },
];

const list = vi.fn(() => Promise.resolve([]));
const uploadExternal = vi.fn(() => Promise.resolve({}));

vi.mock('../services/media', () => ({
  objectCategoryService: { listCategories: () => Promise.resolve(CATEGORIES) },
  imageStorageService: {
    list: (...a: unknown[]) => list(...(a as [])),
    uploadExternal: (...a: unknown[]) => uploadExternal(...(a as [])),
    uploadDashboard: () => Promise.resolve({}),
    uploadDashboardVideo: () =>
      Promise.resolve({ storage: {}, shrunk: false, reason: 'x' }),
    update: () => Promise.resolve({}),
  },
  isSafeImageLink: () => true,
}));
vi.mock('../services/admin', () => ({
  groupService: { listGroups: () => Promise.resolve({ data: [] }) },
  fetchVisibleGroups: () => Promise.resolve([]),
}));

import { ObjectImageFormModal } from '../components/object/ObjectImageFormModal';

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

const driveAlbum = (over: Record<string, unknown> = {}) => ({
  id: 'album-1',
  _id: 'album-1',
  detail: 'drive album',
  matching_tag: [],
  storage: 'google_drive',
  img_path: 'folder-123',
  categories: [{ id: 'c1', name: 'With key' }],
  status: true,
  ...over,
});

const mount = (initialData: unknown) =>
  render(
    <ObjectImageFormModal
      isOpen
      onClose={() => {}}
      onSubmit={() => Promise.resolve('album-1')}
      mode="update"
      initialData={initialData as never}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('[OBJFORMSPLIT] the form\'s Drive gallery', () => {
  it('🔴 loads the first page and rewrites the thumbnail to 800px', async () => {
    /* 🔴 The 220-to-800 rewrite is invisible when it breaks: every preview is
       simply a postage stamp, with a perfectly successful response behind it. */
    const fetchMock = vi.fn().mockResolvedValue(page(['d1', 'd2']));
    vi.stubGlobal('fetch', fetchMock);
    mount(driveAlbum());
    await waitFor(() => expect(screen.getByAltText('d1.png')).toBeInTheDocument());
    expect(screen.getByAltText('d1.png')).toHaveAttribute(
      'src',
      'https://drive.test/d1=s800',
    );
  });

  it('🔴 asks Drive for shared-drive content', async () => {
    /* 🔴 Without both flags Drive answers 200 and omits Shared Drive files —
       the exact drift that made the list page and this screen disagree. */
    const fetchMock = vi.fn().mockResolvedValue(page(['d1']));
    vi.stubGlobal('fetch', fetchMock);
    mount(driveAlbum());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('supportsAllDrives=true');
    expect(url).toContain('includeItemsFromAllDrives=true');
    expect(url).toContain('key=KEY-1');
  });

  it('🔴 a category with NO api key does not call Drive at all', async () => {
    /* 🔴 Calling with `key=undefined` is a 400 from Google and an empty gallery
       either way — but one of the two burns a request and logs an error the
       admin cannot act on. */
    const fetchMock = vi.fn().mockResolvedValue(page(['d1']));
    vi.stubGlobal('fetch', fetchMock);
    mount(driveAlbum({ categories: [{ id: 'c2', name: 'No key' }] }));
    /* ⚠️ 700ms, NOT 60. The effect debounces the Drive call by 500ms
       (`setTimeout(fetchGDrive, 500)`), so a short wait proves only that the
       timer had not fired yet — the case passed for free and a mutation that
       removed the api-key guard survived it. Wait past the debounce. */
    await new Promise((r) => setTimeout(r, 700));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('🔴 a rejected key shows an empty gallery, not a parsed error body', async () => {
    /* 🔴 MUTATION KILLER, and a behaviour this refactor TIGHTENED. Of the three
       copies this file used to have, only one checked `res.ok`; the other two
       called `.json()` on a 401/403 and carried on with `{error:…}`, which has
       no `files` and so looked like "an empty folder" rather than "your key was
       rejected". The merged fetcher takes the strictest of the three. */
    /* ⚠️ The body deliberately CARRIES a `files` array. An error body without
       one is refused by the `!data.files` guard either way, so it cannot tell
       the two rules apart — that mutant is equivalent and an earlier version of
       this case proved nothing. Only a non-2xx that still parses into something
       renderable separates "checked the status" from "did not". */
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          files: [
            {
              id: 'd1',
              name: 'd1.png',
              mimeType: 'image/png',
              thumbnailLink: 'https://drive.test/d1=s220',
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    mount(driveAlbum());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByAltText('d1.png')).toBeNull();
  });

  it('🔴 load-more APPENDS the next page instead of replacing it', async () => {
    /* 🔴 The append branch keys off "was this the first call". Turn it into a
       replace and page one vanishes the moment page two lands. */
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(['d1'], 'tok-2'))
      .mockResolvedValueOnce(page(['d2']));
    vi.stubGlobal('fetch', fetchMock);
    mount(driveAlbum());
    /* the first page only arrives after the 500ms debounce */
    await waitFor(() => expect(screen.getByAltText('d1.png')).toBeInTheDocument(), {
      timeout: 3000,
    });

    fireEvent.click(screen.getByText(/object_image.load_more/));
    await waitFor(() => expect(screen.getByAltText('d2.png')).toBeInTheDocument(), {
      timeout: 3000,
    });
    /* 🔴 BOTH pages must be on screen at once. Asserting only that d2 arrived
       is what let a "replace instead of append" mutation survive: d2 is present
       either way, and d1 quietly disappears. */
    expect(screen.getByAltText('d1.png')).toBeInTheDocument();
    expect(screen.getAllByAltText(/d[12]\.png/)).toHaveLength(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=tok-2');
  });

  it('🔴 pushing one Drive file into our storage reloads the stored list', async () => {
    /* 🔴 Without the reload the tile the admin just imported does not appear
       until the modal is reopened, which reads as "the import did nothing". */
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page(['d1'])));
    mount(driveAlbum());
    await waitFor(() => expect(screen.getByAltText('d1.png')).toBeInTheDocument());
    const before = list.mock.calls.length;

    /* ⚠️ Located by structure, not by label: the per-file upload button in
       `GDriveImage` carries NO title and NO aria-label — it is an icon-only
       button, so a screen reader announces nothing. Recorded here rather than
       fixed, because adding a label is a UI change and this net exists to
       protect a refactor. It is the tile's only button. */
    const tile = screen.getByAltText('d1.png').closest('div') as HTMLElement;
    const uploadBtn = tile.parentElement?.querySelector('button') as HTMLElement;
    expect(uploadBtn, 'the per-file upload button never rendered').toBeTruthy();
    fireEvent.click(uploadBtn);
    await waitFor(() =>
      expect(uploadExternal).toHaveBeenCalledWith('album-1', { drive_id: 'd1' }),
    );
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });
});
