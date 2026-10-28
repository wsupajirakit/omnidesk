/**
 * [FIX-20260904-GDRIVEINLINECOMP] a Google-Drive thumbnail must survive an
 * unrelated parent re-render.
 * ===========================================================================
 * 🔴 THE DEFECT THIS PINS. `GDriveImage` was declared INSIDE
 * `ObjectImageFormModal` (`:657` before the fix). A component created in the
 * body of another component is a BRAND-NEW function identity on every render,
 * and React compares types by identity — so every parent render unmounted the
 * whole thumbnail subtree and mounted a fresh one. The visible cost: each image
 * refetched from Google on every keystroke that touched parent state.
 *
 * ⚠️ WHY THIS TEST IS ABOUT DOM IDENTITY, NOT ABOUT MARKUP. A snapshot cannot
 * see this bug at all: the remounted tree renders the SAME html. The only
 * observable difference is that the `<img>` is a different DOM node afterwards.
 * ⇒ the assertion is `toBe` on the element reference, deliberately.
 *
 * This case was written to FAIL on the pre-fix file and to pass after the
 * component was lifted to `components/object/gdrive/GDriveImage.tsx`.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));
/* Names taken from the modal's own call sites (`listCategories`, `list`) —
   a mock that invents a method name silently returns undefined and the gallery
   never renders, which reads exactly like the feature being broken. */
vi.mock('../services/media', () => ({
  objectCategoryService: {
    listCategories: () =>
      Promise.resolve({
        data: [{ id: 'cat-1', _id: 'cat-1', name: 'c', api_key: 'k' }],
      }),
  },
  imageStorageService: { list: () => Promise.resolve([]) },
  isSafeImageLink: () => true,
}));
vi.mock('../services/admin', () => ({
  groupService: { listGroups: () => Promise.resolve({ data: [] }) },
  /* the scope step reaches for this one through its own hooks */
  fetchVisibleGroups: () => Promise.resolve([]),
}));

import { ObjectImageFormModal } from '../components/object/ObjectImageFormModal';

const DRIVE_FILE = {
  id: 'file-1',
  name: 'one.png',
  mimeType: 'image/png',
  thumbnailLink: 'https://example.invalid/one.png',
};

beforeEach(() => {
  /* jsdom ships no ResizeObserver and the scroll indicator observes the form —
     the same one-line stub several suites here already use */
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class { observe() {} unobserve() {} disconnect() {} };
  /* the modal reaches Google with a bare `fetch` (see the listUrl it builds),
     so one stub is all the gallery needs to render a real thumbnail.
     ⚠️ `ok: true` IS REQUIRED. [REFACTOR-20260904-DRIVEFETCH] merged the three
     copies of this call into one fetcher that checks `res.ok` before parsing —
     only one of the three used to. A stub without it is a non-2xx as far as the
     code is concerned, and the gallery correctly renders nothing. A real Drive
     response always carries it; the stub was simply thinner than reality. */
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ files: [DRIVE_FILE] }),
      } as never),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('[GDRIVEINLINECOMP] the thumbnail is not remounted by an unrelated render', () => {
  it('🔴 the same <img> DOM node survives a parent state change', async () => {
    render(
      <ObjectImageFormModal
        isOpen
        onClose={() => {}}
        onSubmit={() => Promise.resolve()}
        mode="update"
        initialData={
          {
            id: 'album-1',
            _id: 'album-1',
            detail: '',
            matching_tag: [],
            storage: 'google_drive',
            img_path: 'folder-1',
            categories: ['cat-1'],
            status: true,
          } as never
        }
      />,
    );

    const first = await waitFor(() => {
      const el = document.querySelector<HTMLImageElement>(
        `img[alt="${DRIVE_FILE.name}"]`,
      );
      expect(el, 'the Drive thumbnail never rendered').not.toBeNull();
      return el as HTMLImageElement;
    });

    /* Any parent state change will do — this one is a plain text field that has
       nothing to do with the gallery, which is the whole point. */
    const detail = document.querySelector<HTMLInputElement>(
      'input[name="detail"], textarea[name="detail"]',
    );
    expect(detail, 'no detail field to type into').not.toBeNull();
    fireEvent.change(detail as HTMLElement, { target: { value: 'x' } });

    const second = document.querySelector<HTMLImageElement>(
      `img[alt="${DRIVE_FILE.name}"]`,
    );
    expect(second).not.toBeNull();
    expect(
      second,
      'the thumbnail was remounted — a component declared inside its parent is ' +
        'a new type every render, so React throws the subtree away and refetches',
    ).toBe(first);
  });
});
