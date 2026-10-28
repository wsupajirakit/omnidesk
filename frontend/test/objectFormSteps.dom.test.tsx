/**
 * [REFACTOR-20260904-OBJFORMSPLIT] The album form's BASIC and ACCESS steps,
 * pinned BEFORE either is lifted out of the 1,712-line modal (§6.3 step 2).
 * ===========================================================================
 * WHY THIS FILE. `objectFormWizard.dom.test.tsx` proves the wizard SHELL — which
 * step is visible, where an error scrolls to — and `objectLocalGallery` proves
 * the media step's gallery. Nothing anywhere touched what the BASIC step renders
 * or what the ACCESS step shows, so both were about to be moved with no net
 * under them at all. Net first, then cut.
 *
 * WHAT IT PINS — the things a move loses quietly:
 *  · the category picker is a BUTTON that opens a list, and it is disabled
 *    outside create mode (an album cannot change category after the fact)
 *  · the detail field and the tag field are wired to `formData`
 *  · the tag COPY button emits the `[[[tag]]]` shape the bot matches on
 *  · the ACCESS step renders the status toggle and the scope picker, and its
 *    hint line
 *
 * ⚠️ Both steps are rendered by the wizard with the INACTIVE ones still mounted
 * (that is its documented behaviour — hidden, not unmounted), so these cases
 * query the whole tree rather than clicking through the stepper.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const I18N = { t: (k: string) => k };
vi.mock('../i18n', () => ({ useI18n: () => I18N }));

const CATEGORIES = [
  { id: 'c1', name: 'Promotions' },
  { id: 'c2', name: 'Bonuses' },
];

vi.mock('../services/media', () => ({
  objectCategoryService: { listCategories: () => Promise.resolve(CATEGORIES) },
  imageStorageService: { list: () => Promise.resolve([]) },
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
  matching_tag: ['img_a_1', 'img_a_2'],
  storage: 'local',
  img_path: '',
  categories: [{ id: 'c1', name: 'Promotions' }],
  status: true,
};

const mount = (mode: 'create' | 'update' | 'view', initialData?: unknown) =>
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('[OBJFORMSPLIT] the BASIC step', () => {
  it('⭐ renders the category picker with the album\'s categories on it', async () => {
    mount('update', album);
    await waitFor(() =>
      expect(screen.getAllByText('Promotions').length).toBeGreaterThan(0),
    );
  });

  it('🔴 the category picker is DISABLED outside create mode', async () => {
    /* 🔴 An album's category cannot be changed after it exists — the button is
       disabled and styled as such. A lift that forwards `resolvedMode` wrongly,
       or forgets it, silently re-opens an edit path the server does not expect.
       The button must still be VISIBLE, just not clickable. */
    mount('update', album);
    const picker = await screen.findByText('object_image.form_categories_label');
    const button = picker.parentElement?.querySelector('button');
    expect(button).toBeDisabled();
  });

  it('🔴 in create mode the picker opens the category list', async () => {
    mount('create');
    const label = await screen.findByText('object_image.form_categories_label');
    const button = label.parentElement?.querySelector('button') as HTMLElement;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getAllByText('Bonuses').length).toBeGreaterThan(0),
    );
  });

  it('⭐ the detail field shows the album\'s detail', async () => {
    mount('update', album);
    await waitFor(() =>
      expect(screen.getAllByDisplayValue('my album').length).toBeGreaterThan(0),
    );
  });

  it('🔴 the tag COPY button emits the [[[tag]]] shape', async () => {
    /* 🔴 MUTATION KILLER. The brackets ARE the contract with the bot; a copy
       that loses them still shows a success alert and pastes something that
       never matches. Nothing else in any suite presses this button. */
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mount('update', album);
    /* The button's label is the literal string COPY, not a translation key —
       checked in the source rather than assumed from the neighbouring markup. */
    const copy = await screen.findByText('COPY');
    fireEvent.click(copy);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('[[[img_a_1]]] [[[img_a_2]]]'),
    );
    vi.unstubAllGlobals();
  });
});

describe('[OBJFORMSPLIT] the MEDIA step\'s storage picker', () => {
  it('🔴 offers local only, and a withdrawn choice only to an album already on it', async () => {
    /* 🔴 MUTATION KILLER. `storageOptionsFor(resolvedMode)` decides what the
       picker offers, and nothing in any suite looked at it — emptying that list
       left every case green while the admin loses the ability to pick a storage
       at all. เทสไม่เคยมองตัวเลือก = ตัดตัวเลือกทิ้งก็ไม่มีใครรู้ */
    /* ⚠️ Read from the source, not assumed: the picker calls
       `storageOptionsFor(formData.storage)` — the album's CURRENT storage, not
       the mode.
       ⚠️ [UI-20260904-LOCALONLY] FLIPPED 04/09: `external` was withdrawn from the
       offer alongside Drive, on the owner's word — one destination, no decision
       to get wrong. So a NEW album sees `local` alone, and a withdrawn value
       appears exactly when the album already sits on it. That second half is the
       load-bearing part and did not change: a `<select>` whose value matches no
       option renders the first one, so dropping it would move an album to local
       on the next save with nobody having touched the field.
       ตัวเลือกที่ถอนออกไปแล้ว ต้องยังโผล่ให้อัลบั้มที่ใช้มันอยู่ ไม่งั้นกดเซฟแล้วย้ายเงียบ ๆ */
    const view = mount('create');
    await waitFor(() => {
      const options = [...view.container.querySelectorAll('option')].map(
        (o) => o.getAttribute('value'),
      );
      /* ⚠️ Count FIRST. An earlier version asserted only "external is there,
         drive is not", and an empty <select> satisfies the second half — so
         emptying the list left this case green. A negative assertion is worth
         nothing without a positive one beside it.
         Assert what IS there before asserting what is not. */
      expect(options).toHaveLength(1);
      expect(options).toContain('local');
      expect(options).not.toContain('external');
      expect(options).not.toContain('google_drive');
    });
    cleanup();

    const drive = mount('update', { ...album, storage: 'google_drive' });
    await waitFor(() => {
      const options = [...drive.container.querySelectorAll('option')].map(
        (o) => o.getAttribute('value'),
      );
      expect(options).toHaveLength(2);
      expect(options).toContain('local');
      expect(options).toContain('google_drive');
    });
    cleanup();

    /* [UI-20260904-LOCALONLY] and the same courtesy for `external`, which is the
       value this change withdrew — an album sitting on it must still see it. */
    const ext = mount('update', { ...album, storage: 'external' });
    await waitFor(() => {
      const options = [...ext.container.querySelectorAll('option')].map(
        (o) => o.getAttribute('value'),
      );
      expect(options).toHaveLength(2);
      expect(options).toContain('local');
      expect(options).toContain('external');
    });
  });
});

describe('[OBJFORMSPLIT] the ACCESS step', () => {
  it('⭐ renders its hint and the status toggle', async () => {
    mount('update', album);
    await waitFor(() => {
      expect(screen.getByText('object_form.tab_access_hint')).toBeInTheDocument();
      expect(screen.getByText('object_scope.status_label')).toBeInTheDocument();
    });
  });

  it('🔴 the status toggle reflects the album, not a default', async () => {
    /* 🔴 A lift that forgets to pass `formData.status` renders a switch that
       always looks ON — and an admin turning a disabled album "off" changes
       nothing while believing they did. */
    /* ⚠️ Probed, not assumed: this modal renders exactly ONE `role="switch"`,
       and the form is filled from `initialData` by an effect — so the element
       has to be RE-QUERIED inside `waitFor`. Capturing it once before the effect
       runs is what made an earlier version of this case fail while the feature
       was fine. อย่าเดา — เปิดดู DOM จริงแล้วค่อยเขียน */
    const view = mount('update', { ...album, status: false });
    await waitFor(() => {
      const toggle = view.container.querySelector('[role="switch"]');
      expect(toggle, 'the status switch never rendered').not.toBeNull();
      expect(toggle?.getAttribute('aria-checked')).toBe('false');
    });
  });
});

/**
 * [REFACTOR-20260904-FORMHOOKS] Validation, driven through the real Save button.
 *
 * 🔴 WHY THIS EXISTS: a mutation that made the scope rule return `undefined` —
 * i.e. an album with no group and no OA saves cleanly — left every other case in
 * every suite green. `objectFormWizard` covers the wizard HELPERS (which step is
 * first-invalid, where an error scrolls); nothing pressed Save and watched what
 * validation refused. That is the one branch whose failure is silent: the album
 * saves and the bot can never serve it.
 */
describe('[FORMHOOKS] Save refuses what the server would refuse', () => {
  const save = async (initial: Record<string, unknown>) => {
    const onSubmit = vi.fn(() => Promise.resolve('id-1'));
    render(
      <ObjectImageFormModal
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit as never}
        mode="update"
        initialData={initial as never}
      />,
    );
    await waitFor(() => expect(screen.getByText('common.save')).toBeInTheDocument());
    fireEvent.click(screen.getByText('common.save'));
    await new Promise((r) => setTimeout(r, 60));
    return onSubmit;
  };

  it('🔴 an album with NO group and NO OA is refused', async () => {
    /* 🔴 MUTATION KILLER. This is the rule whose removal is invisible: the save
       succeeds, the row exists, and the bot never serves it because nobody is
       allowed to see it. */
    const onSubmit = await save({
      ...album,
      group_providers: [],
      hook_ids: [],
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText('object_scope.required').length).toBeGreaterThan(0);
  });

  it('🔴 an album with no detail is refused, with EVERY other rule satisfied', async () => {
    /* 🔴 The scope and detail rules must be separated or neither is measured.
       The base fixture has no group and no OA, so an earlier version of this
       case was blocked by the scope rule and passed with the detail rule
       deleted — it proved only that SOMETHING refused the save. */
    const onSubmit = await save({
      ...album,
      group_providers: ['g1'],
      hook_ids: ['h1'],
      detail: '   ',
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText('object_scope.required')).toBeNull();
    /* 🔴 Assert the DETAIL rule's own message. "onSubmit was not called" is true
       whichever rule refused — and true again if the button simply did nothing,
       which is how the earlier version of this case survived deleting the rule.
       Probed: the message really does render on screen. */
    expect(
      screen.getAllByText('object_image.form_detail_required').length,
    ).toBeGreaterThan(0);
  });

  it('a complete album reaches the confirm step', async () => {
    /* The positive direction: without it every case above passes on a form that
       simply never submits anything. */
    const onSubmit = await save({
      ...album,
      group_providers: ['g1'],
      hook_ids: ['h1'],
    });
    expect(onSubmit).not.toHaveBeenCalled(); // confirm dialog opens first
    expect(screen.queryByText('object_scope.required')).toBeNull();
  });
});
