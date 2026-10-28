/**
 * [FIX-20260901-OBJSCOPEWRITE] The scope and the switch have to be WRITTEN.
 *
 * Adding a field to the schema, the DTO and the sanitizer covers validation,
 * storage and the trip back — but not the update branch, which copies dto onto
 * the document one named field at a time. A field missing from that list is
 * accepted by the API, answered with 200, and silently never saved.
 *
 * Found by pressing the switch on the list screen: it flipped, the request
 * succeeded, the refetch brought back the old value. `updateCategory` copied
 * only `name` and `api_key`; `updateImage` copied five scalars plus categories
 * and groups, and neither knew about `status` or `hook_ids`.
 *
 * These cases assert on the DOCUMENT after the update call, so they fail for
 * the same reason the screen did.
 */
import {
  ObjectCategoriesService,
  ObjectImagesService,
} from '@/modules/content';

const CAT_ID = 'a0d00000000000000000003b';
const IMG_ID = 'a0d00000000000000000005a';
const GROUP_A = 'a0d00000000000000000005b';
const HOOK_A = 'a0d000000000000000000071';
/* [FIX-20260901-CREATESCOPE] A real ObjectId: `resolveCategories` filters out
   anything `isValidObjectId` rejects, so a placeholder like 'cat1' resolves to
   an empty list and the create refuses with "Invalid category IDs". */
const CATEGORY_A = 'a0d000000000000000000072';

const audit = { createAuditLog: jest.fn().mockResolvedValue(undefined) };
/* A superuser: `getAllowedHookIds` short-circuits before touching the model. */
const USER = { userId: 'u1', role: 'superadmin', groups: [] } as never;
const HOOK_MODEL = {
  find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
};

const flush = () => new Promise((r) => setImmediate(r));

describe('updateCategory writes the scope and the switch', () => {
  const build = (doc: Record<string, unknown>) => {
    /* Two findOne calls happen: load the row, then check the new name is not
       taken. The second must answer null, or renaming looks like a clash. */
    const model = Object.assign(jest.fn(), {
      findOne: jest.fn().mockResolvedValueOnce(doc).mockResolvedValue(null),
    });
    return new ObjectCategoriesService(
      model as never,
      HOOK_MODEL as never,
      audit as never,
    );
  };

  const categoryDoc = (over: Record<string, unknown> = {}) => ({
    _id: CAT_ID,
    name: 'Promotions',
    api_key: '',
    status: true,
    group_providers: [],
    hook_ids: [],
    save: jest.fn().mockResolvedValue(undefined),
    toObject() {
      return { ...this };
    },
    ...over,
  });

  it('switching OFF actually reaches the document', async () => {
    const doc = categoryDoc();
    await build(doc).updateCategory(USER, CAT_ID, { status: false });

    expect(doc.status).toBe(false);
    expect(doc.save).toHaveBeenCalled();
  });

  it('switching back ON reaches it too', async () => {
    const doc = categoryDoc({ status: false });
    await build(doc).updateCategory(USER, CAT_ID, { status: true });

    expect(doc.status).toBe(true);
  });

  it('the group scope is written', async () => {
    const doc = categoryDoc();
    await build(doc).updateCategory(USER, CAT_ID, {
      group_providers: [GROUP_A],
    });

    expect((doc.group_providers as unknown[]).map(String)).toEqual([GROUP_A]);
  });

  it('the OA scope is written', async () => {
    const doc = categoryDoc();
    await build(doc).updateCategory(USER, CAT_ID, { hook_ids: [HOOK_A] });

    expect((doc.hook_ids as unknown[]).map(String)).toEqual([HOOK_A]);
  });

  /* Clearing a scope means "unrestricted" and is a legal, deliberate edit — it
     must not be mistaken for "field absent, leave alone". */
  it('CLEARING a scope is honoured, not treated as absent', async () => {
    const doc = categoryDoc({ group_providers: [GROUP_A] });
    await build(doc).updateCategory(USER, CAT_ID, { group_providers: [] });

    expect(doc.group_providers).toEqual([]);
  });

  it('a field the caller did not send is left alone', async () => {
    const doc = categoryDoc({ status: false, group_providers: [GROUP_A] });
    await build(doc).updateCategory(USER, CAT_ID, { name: 'Renamed' });

    expect(doc.status).toBe(false);
    expect((doc.group_providers as unknown[]).map(String)).toEqual([GROUP_A]);
  });

  it('the audit records the switch moving, with both sides', async () => {
    audit.createAuditLog.mockClear();
    const doc = categoryDoc();
    await build(doc).updateCategory(USER, CAT_ID, { status: false });
    await flush();

    const row = audit.createAuditLog.mock.calls[0]![0] as {
      changed_fields: Array<Record<string, unknown>>;
    };
    expect(row.changed_fields).toContainEqual({
      field: 'status',
      from: true,
      to: false,
    });
  });
});

describe('updateImage writes the scope and the switch', () => {
  const imageDoc = (over: Record<string, unknown> = {}) => ({
    _id: IMG_ID,
    detail: 'promo',
    img_path: '',
    storage: 'local',
    file_type: '',
    response_type: 'media',
    status: true,
    categories: [],
    group_providers: [],
    hook_ids: [],
    save: jest.fn().mockResolvedValue(undefined),
    toObject() {
      return { ...this };
    },
    ...over,
  });

  const build = (doc: Record<string, unknown>) => {
    /* `findById` feeds the re-read the service does after saving, to return a
       populated row. It answers with the same doc so the assertions below are
       about what was WRITTEN, not about what the re-read invented. */
    const model = Object.assign(jest.fn(), {
      findOne: jest.fn().mockResolvedValue(doc),
      findById: () => ({
        populate: () => ({ populate: () => Promise.resolve(doc) }),
      }),
    });
    /* Argument order matches the constructor exactly: image, category, group,
       storage, hook, audit. Getting it wrong hands `audit` to the hook slot and
       the failure reads as "status was not written" rather than "the stub is in
       the wrong position". */
    return new ObjectImagesService(
      model as never,
      { find: () => Promise.resolve([]) } as never, // objectCategoryModel
      { find: () => Promise.resolve([]) } as never, // groupModel
      { findOne: () => ({ sort: () => Promise.resolve(null) }) } as never, // imageStorageModel
      HOOK_MODEL as never,
      audit as never,
    );
  };

  it('switching OFF actually reaches the document', async () => {
    const doc = imageDoc();
    await build(doc).updateImage(USER, IMG_ID, { status: false });

    expect(doc.status).toBe(false);
  });

  it('switching back ON reaches it too', async () => {
    const doc = imageDoc({ status: false });
    await build(doc).updateImage(USER, IMG_ID, { status: true });

    expect(doc.status).toBe(true);
  });

  it('the OA scope is written', async () => {
    const doc = imageDoc();
    await build(doc).updateImage(USER, IMG_ID, { hook_ids: [HOOK_A] });

    expect((doc.hook_ids as unknown[]).map(String)).toEqual([HOOK_A]);
  });

  it('clearing the OA scope is honoured', async () => {
    const doc = imageDoc({ hook_ids: [HOOK_A] });
    await build(doc).updateImage(USER, IMG_ID, { hook_ids: [] });

    expect(doc.hook_ids).toEqual([]);
  });

  it('a field the caller did not send is left alone', async () => {
    const doc = imageDoc({ status: false });
    await build(doc).updateImage(USER, IMG_ID, { detail: 'renamed' });

    expect(doc.status).toBe(false);
  });
});

/**
 * [FIX-20260901-CREATESCOPE] The CREATE paths drop fields the same way.
 *
 * Reported as "I tick the OA boxes while creating, then reopen and they are
 * empty" — which reads as a display bug and is a write bug. Both create paths
 * build a document literal, and a literal drops what it does not name:
 * group_providers went through because it is named, hook_ids and status were
 * not. Confirmed against the database before fixing: albums created that day
 * carried groups=22 and hooks=0.
 */
describe('createCategory stores the scope and the switch', () => {
  /** Captures the literal handed to the model constructor. */
  const build = () => {
    const saved: Record<string, unknown> = {};
    const model = Object.assign(
      jest.fn().mockImplementation((doc: Record<string, unknown>) => {
        Object.assign(saved, doc);
        return {
          ...doc,
          _id: CAT_ID,
          save: jest.fn().mockResolvedValue(undefined),
          toObject: () => ({ ...doc, _id: CAT_ID }),
        };
      }),
      { findOne: jest.fn().mockResolvedValue(null) },
    );
    return {
      service: new ObjectCategoriesService(
        model as never,
        HOOK_MODEL as never,
        audit as never,
      ),
      saved,
    };
  };

  it('stores the OA scope the admin ticked', async () => {
    const { service, saved } = build();
    await service.createCategory(USER, { name: 'New', hook_ids: [HOOK_A] });

    expect((saved.hook_ids as unknown[]).map(String)).toEqual([HOOK_A]);
  });

  it('stores the group scope', async () => {
    const { service, saved } = build();
    await service.createCategory(USER, {
      name: 'New',
      group_providers: [GROUP_A],
    });

    expect((saved.group_providers as unknown[]).map(String)).toEqual([GROUP_A]);
  });

  it('stores status when the form said off', async () => {
    const { service, saved } = build();
    await service.createCategory(USER, { name: 'New', status: false });

    expect(saved.status).toBe(false);
  });

  /* A create with no answer is ON, and says so in the document rather than
     leaving an absent key for the schema default to fill — so what is written
     matches what a later read produces. */
  it('defaults to ON when the form did not say', async () => {
    const { service, saved } = build();
    await service.createCategory(USER, { name: 'New' });

    expect(saved.status).toBe(true);
  });
});

describe('createImage stores the scope and the switch', () => {
  const build = () => {
    const saved: Record<string, unknown> = {};
    const model = Object.assign(
      jest.fn().mockImplementation((doc: Record<string, unknown>) => {
        Object.assign(saved, doc);
        return {
          ...doc,
          _id: IMG_ID,
          save: jest.fn().mockResolvedValue(undefined),
          toObject: () => ({ ...doc, _id: IMG_ID }),
        };
      }),
      {
        /* `.sort()` is required: `getNextMatchingTag` chains it off findOne to
           pick the highest existing tag. Answering null means "no tags yet",
           so the new album gets the first one. */
        findOne: () => ({ sort: () => Promise.resolve(null) }),
        /* The service re-reads the row it just wrote and refuses if that read
           comes back empty, so this has to answer with the saved document. */
        findById: () => ({
          populate: () => ({
            populate: () => Promise.resolve({ toObject: () => ({ ...saved }) }),
          }),
        }),
      },
    );
    return {
      service: new ObjectImagesService(
        model as never,
        { find: () => Promise.resolve([{ _id: CATEGORY_A }]) } as never,
        { find: () => Promise.resolve([]) } as never,
        { findOne: () => ({ sort: () => Promise.resolve(null) }) } as never,
        HOOK_MODEL as never,
        audit as never,
      ),
      saved,
    };
  };

  it('stores the OA scope the admin ticked — the reported bug', async () => {
    const { service, saved } = build();
    await service.createImage(USER, {
      categories: [CATEGORY_A],
      hook_ids: [HOOK_A],
    });

    expect((saved.hook_ids as unknown[]).map(String)).toEqual([HOOK_A]);
  });

  it('stores status when the form said off', async () => {
    const { service, saved } = build();
    await service.createImage(USER, {
      categories: [CATEGORY_A],
      status: false,
    });

    expect(saved.status).toBe(false);
  });

  it('drops a malformed id instead of rejecting the whole save', async () => {
    const { service, saved } = build();
    await service.createImage(USER, {
      categories: [CATEGORY_A],
      hook_ids: ['not-an-object-id', HOOK_A],
    });

    expect((saved.hook_ids as unknown[]).map(String)).toEqual([HOOK_A]);
  });
});
