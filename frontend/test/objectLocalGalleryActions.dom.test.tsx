/**
 * [REFACTOR-20260904-OBJFORMSPLIT] The Local Gallery's three ACTIONS, pinned
 * before its state is moved (§6.4).
 * ===========================================================================
 * `objectLocalGallery.dom.test.tsx` proves what the panel RENDERS. Nothing
 * anywhere pressed its buttons, and the panel's three async handlers are exactly
 * what makes it a state move rather than a markup lift:
 *
 *  1. UPLOAD — auto-saves an unsaved album first, then posts the file
 *  2. SYNC (IMPORT URL TO SERVER) — auto-saves, resolves the api key from the
 *     album's FIRST category, then calls `uploadExternal`
 *  3. DRAG-TO-REORDER — writes the new `priority` and reloads the list
 *
 * Every one of them reaches into the parent (`onSubmit`, `categories`,
 * `serverImages`, `setIsUploadingLocal`, `fetchServerImages`), so a move that
 * carries the markup and leaves a handler behind compiles, renders perfectly and
 * silently does nothing when pressed — a button that went quiet is a break
 * nobody sees.
 *
 * ⚠️ These assert the CALLS, not the pixels: what was sent, in what order, with
 * which arguments. That is the part a snapshot cannot see.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const I18N = { t: (k: string) => k };
vi.mock('../i18n', () => ({ useI18n: () => I18N }));

const STORED = [
  { id: 'st-1', image_url: '/uploads/images/a.png', image_type: 'png', priority: 1 },
  { id: 'st-2', image_url: '/uploads/images/b.png', image_type: 'png', priority: 2 },
];

const CATEGORIES = [
  { id: 'c1', name: 'With key', api_key: 'KEY-1' },
  { id: 'c2', name: 'No key' },
];

const list = vi.fn(() => Promise.resolve(STORED));
const uploadDashboard = vi.fn(() => Promise.resolve({}));
const uploadExternal = vi.fn(() => Promise.resolve({}));
const update = vi.fn(() => Promise.resolve({}));

vi.mock('../services/media', () => ({
  objectCategoryService: { listCategories: () => Promise.resolve(CATEGORIES) },
  imageStorageService: {
    list: (...a: unknown[]) => list(...(a as [])),
    uploadDashboard: (...a: unknown[]) => uploadDashboard(...(a as [])),
    uploadDashboardVideo: () => Promise.resolve({ storage: {}, shrunk: false, reason: 'x' }),
    uploadExternal: (...a: unknown[]) => uploadExternal(...(a as [])),
    update: (...a: unknown[]) => update(...(a as [])),
  },
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
  detail: 'my album',
  matching_tag: [],
  storage: 'local',
  img_path: '',
  categories: [{ id: 'c1', name: 'With key' }],
  status: true,
};

const mount = (
  initialData: unknown,
  onSubmit: (data: unknown, silent?: boolean) => Promise<unknown> = () =>
    Promise.resolve(undefined),
) =>
  render(
    <ObjectImageFormModal
      isOpen
      onClose={() => {}}
      onSubmit={onSubmit as never}
      mode="update"
      initialData={initialData as never}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);

const pngFile = (): File => new File(['x'], 'photo.png', { type: 'image/png' });

describe('[OBJFORMSPLIT] the Local Gallery — UPLOAD', () => {
  it('🔴 posts the picked file against the SAVED album id', async () => {
    /* 🔴 The id is not a formality: it is what the file is attached to. A move
       that loses `initialData` uploads against `undefined` and the file lands
       nowhere the album can see. */
    const view = mount(album);
    const input = await waitFor(() => {
      const el = view.container.querySelector('input[type="file"]');
      expect(el, 'the upload input never rendered').not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(input, { target: { files: [pngFile()] } });
    await waitFor(() =>
      expect(uploadDashboard).toHaveBeenCalledWith(
        'album-1',
        expect.any(File),
        expect.anything(),
      ),
    );
  });

  /**
   * 🔴 THE AUTO-SAVE BRANCH IS NOT REACHABLE FROM THIS PANEL, AND THAT IS A
   * FINDING, NOT A GAP IN THE SUITE.
   *
   * `handleLocalFileUpload` opens with "if there is no id, save silently first"
   * — but the panel that owns the file input only renders when
   * `resolvedMode !== 'create' && (initialData?.id || formData.img_path)`.
   * Probed: an album with no id renders ZERO file inputs, in create AND update
   * mode. So the branch can only be entered by an album that has an
   * `img_path` but no id, which nothing in this form produces today.
   *
   * Two cases were written for it and deleted rather than bent into passing —
   * a test that drives an unreachable path proves the path exists, not that it
   * works. Left as a note so the next reader does not re-derive it.
   * Making a test pass on a path the UI cannot reach is self-deception.
   */
});

describe('[OBJFORMSPLIT] the Local Gallery — SYNC from a URL', () => {
  /* ⚠️ Probed, not assumed: the IMPORT button renders for `storage: 'external'`
     — NOT for google_drive, which was the first guess. The Drive case has its
     own picker higher up the step; this button is the external-URL path.
     Probe the real DOM before writing a fixture. */
  const externalAlbum = {
    ...album,
    storage: 'external',
    img_path: 'https://drive.test/folder',
  };

  it('🔴 sends the url AND the api key of the album\'s FIRST category', async () => {
    /* 🔴 The key is looked up from `categories` by the album's first category id.
       A move that loses the `categories` prop sends `api_key: undefined` and the
       import fails server-side for a reason nothing on screen explains.
       The key comes from the first CATEGORY, not from the album. */
    mount(externalAlbum);
    const button = await screen.findByText('IMPORT URL TO SERVER');
    fireEvent.click(button);
    await waitFor(() =>
      expect(uploadExternal).toHaveBeenCalledWith('album-1', {
        url: 'https://drive.test/folder',
        api_key: 'KEY-1',
      }),
    );
  });

  it('reloads the stored files after a successful import', async () => {
    mount(externalAlbum);
    fireEvent.click(await screen.findByText('IMPORT URL TO SERVER'));
    await waitFor(() => expect(uploadExternal).toHaveBeenCalled());
    /* once on open, once after the import */
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  });

  it('🔴 with no url there is no import button at all', async () => {
    /* 🔴 Probed rather than assumed: an external album with an EMPTY `img_path`
       renders no panel and therefore no button — the whole section is gated on
       `initialData?.id || formData.img_path`. An earlier version of this case
       expected a DISABLED button and failed, because the button is not there to
       be disabled. ไม่มี url = ไม่มีปุ่ม ไม่ใช่ปุ่มเทา */
    const view = mount({ ...album, storage: 'external', img_path: '', id: undefined, _id: undefined });
    await new Promise((r) => setTimeout(r, 40));
    expect(view.container.textContent).not.toContain('IMPORT URL TO SERVER');
  });
});

describe('[OBJFORMSPLIT] the Local Gallery — DRAG to reorder', () => {
  it('🔴 dropping a tile writes its new priority and reloads', async () => {
    /* 🔴 `priority` IS the display order the bot serves. A drag that renders
       beautifully and never calls `update` reorders nothing — and the tiles snap
       back only after the next reload, which looks like a slow UI rather than a
       lost write. */
    const view = mount(album);
    const tiles = await waitFor(() => {
      const found = view.container.querySelectorAll('[draggable="true"]');
      expect(found.length, 'the stored tiles never rendered').toBe(STORED.length);
      return found;
    });
    fireEvent.dragStart(tiles[0]);
    fireEvent.drop(tiles[1]);
    await waitFor(() =>
      /* tile 0 moved onto index 1 ⇒ priority becomes 2 (index + 1) */
      expect(update).toHaveBeenCalledWith('st-1', { priority: 2 }),
    );
  });

  it('dropping a tile on itself writes nothing', async () => {
    const view = mount(album);
    const tiles = await waitFor(() => {
      const found = view.container.querySelectorAll('[draggable="true"]');
      expect(found.length).toBe(STORED.length);
      return found;
    });
    fireEvent.dragStart(tiles[0]);
    fireEvent.drop(tiles[0]);
    await new Promise((r) => setTimeout(r, 20));
    expect(update).not.toHaveBeenCalled();
  });
});
