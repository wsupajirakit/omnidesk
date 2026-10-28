/**
 * [FEAT-20260901-OBJSCOPE] The scope has to survive the trip BACK.
 *
 * A field can be validated, stored and read correctly and still be lost in the
 * sanitizer, because both object services build their response object one named
 * field at a time. When that happens the form re-opens blank and the NEXT save
 * writes the blank over the real value — so the bug reads as "it doesn't save"
 * when in fact it saved and was then erased.
 *
 * These cases pin the outbound half only. The inbound half (services actually
 * persisting what the DTO carried) is covered where those writes are tested.
 */
import {
  ObjectCategoriesService,
  ObjectImagesService,
} from '@/modules/content';

const GROUP_A = 'a0d000000000000000000017';
const HOOK_A = 'a0d000000000000000000018';

/** A stored document, as `toObject()` would hand it over. */
const categoryDoc = (over: Record<string, unknown> = {}) =>
  ({
    toObject: () => ({
      _id: 'cat1',
      name: 'Promotions',
      api_key: '',
      ...over,
    }),
  }) as never;

const imageDoc = (over: Record<string, unknown> = {}) =>
  ({
    toObject: () => ({
      _id: 'img1',
      detail: '',
      matching_tag: ['img_a_1000000'],
      img_path: '',
      categories: [],
      group_providers: [],
      ...over,
    }),
  }) as never;

const categories = () =>
  new ObjectCategoriesService(null as never, null as never, null as never);
const images = () =>
  new ObjectImagesService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

describe('sanitizeCategory — the scope survives the trip back', () => {
  it('carries group_providers, hook_ids and status out', () => {
    const out = categories().sanitizeCategory(
      categoryDoc({
        group_providers: [GROUP_A],
        hook_ids: [HOOK_A],
        status: false,
      }),
    );

    expect(out).toMatchObject({
      group_providers: [GROUP_A],
      hook_ids: [HOOK_A],
      status: false,
    });
  });

  /* The rows that exist today. None of them carries any of the three keys, and
     all three answers below are what keeps them working untouched. */
  it('a row saved before this feature reads as unrestricted and ON', () => {
    const out = categories().sanitizeCategory(categoryDoc());

    expect(out).toMatchObject({
      group_providers: [],
      hook_ids: [],
      status: true,
    });
  });

  it('only an explicit false is off — nothing else counts as off', () => {
    for (const stored of [undefined, null, true, 1, 'false']) {
      const out = categories().sanitizeCategory(
        categoryDoc({ status: stored }),
      );
      expect(out?.status).toBe(true);
    }
    expect(
      categories().sanitizeCategory(categoryDoc({ status: false }))?.status,
    ).toBe(false);
  });

  it('a non-array scope never reaches the form as one', () => {
    const out = categories().sanitizeCategory(
      categoryDoc({ group_providers: 'not-an-array', hook_ids: null }),
    );
    expect(out).toMatchObject({ group_providers: [], hook_ids: [] });
  });
});

describe('sanitizeImage — the scope survives the trip back', () => {
  it('carries hook_ids and status out', () => {
    const out = images().sanitizeImage(
      imageDoc({ hook_ids: [HOOK_A], status: false }),
    );

    expect(out).toMatchObject({ hook_ids: [HOOK_A], status: false });
  });

  it('an album saved before this feature reads as unrestricted and ON', () => {
    const out = images().sanitizeImage(imageDoc());

    expect(out).toMatchObject({ hook_ids: [], status: true });
  });

  it('keeps populated group_providers shaped as the form expects', () => {
    const out = images().sanitizeImage(
      imageDoc({
        group_providers: [{ _id: GROUP_A, group_name: 'Alpha' }],
      }),
    );

    expect(out?.group_providers).toEqual([
      { id: GROUP_A, group_name: 'Alpha' },
    ]);
  });
});
