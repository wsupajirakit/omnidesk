/**
 * [FEAT-20260829-FLEXMENUTYPE] flex type `menu` + the Normal/Menu tab split.
 *
 * WHAT THIS PINS, and why each line of it was written before the code:
 *
 *  (A) `menu` must be inside `FLEX_TYPES`. `normalizeFlexType` coerces anything
 *      unknown to `'slip'` — so a request for `?flex_type=menu` made before the
 *      value is known does NOT return nothing, it returns SLIP CARDS. Shipping
 *      the dashboard tab first would quietly list the wrong rows. Measured on
 *      live data while planning: 55 cards, none of them menu.
 *
 *  (B) The Normal tab must be `{ $ne: 'menu' }`, never a list of the other
 *      types. Two of the 55 live rows carry no `flex_type` at all; `$ne` matches
 *      a missing field and returns 55, an explicit `$in` list returns 53 — two
 *      cards vanish from the page a person uses every day. The same trap the
 *      existing `$in: ['slip', null]` line was written to avoid.
 *
 *  (C) Everything else about the filter stays exactly as it was — `slip` still
 *      folds nulls in, and no query means no type filter at all.
 */
import {
  FlexMessagesService,
  normalizeFlexSlug,
  normalizeFlexSubType,
} from '@/modules/content';

type Filter = Record<string, unknown>;

/** Capture the filter the service builds, without touching Mongo. */
const serviceThatRecords = (): {
  svc: FlexMessagesService;
  filters: Filter[];
} => {
  const filters: Filter[] = [];
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: () => Promise.resolve([]),
  };
  const model = {
    countDocuments: (f: Filter) => {
      filters.push(f);
      return Promise.resolve(0);
    },
    find: (f: Filter) => {
      filters.push(f);
      return chain;
    },
  };
  const svc = new FlexMessagesService(
    model as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, filters };
};

const filterFor = async (
  query: Record<string, string | undefined>,
): Promise<Filter> => {
  const { svc, filters } = serviceThatRecords();
  await svc.listFlexMessages(query, undefined);
  return filters[0]!;
};

describe('[FLEXMENUTYPE] the menu type and the tab split', () => {
  it('🔴🔴 (A) ?flex_type=menu filters on menu — NOT coerced to slip', async () => {
    /* If this fails with `slip`, the value is missing from FLEX_TYPES and the
       dashboard tab would list slip cards under "Flex Menu". */
    expect(await filterFor({ flex_type: 'menu' })).toMatchObject({
      flex_type: 'menu',
    });
  });

  it('🔴🔴🔴 (B) ?tab=normal is `$ne: menu` — the form that keeps fieldless rows', async () => {
    const f = await filterFor({ tab: 'normal' });
    expect(f['flex_type']).toEqual({ $ne: 'menu' });
    /* Stated negatively too, but ONLY about the type clause: the filter also
       carries a `group_ids: { $in: … }` permission scope, which is unrelated.
       An `$in` list of the other types HERE is what would drop the two legacy
       rows that carry no `flex_type`. */
    expect(JSON.stringify(f['flex_type'])).not.toContain('$in');
  });

  it('⭐⭐ ?tab=menu is the menu filter', async () => {
    expect(await filterFor({ tab: 'menu' })).toMatchObject({
      flex_type: 'menu',
    });
  });

  it('⭐ an unknown tab is ignored rather than guessed', async () => {
    /* A typo must not silently show one tab's contents under the other. */
    const f = await filterFor({ tab: 'nonsense' });
    expect(f['flex_type']).toBeUndefined();
  });

  it('⭐⭐⭐ (C) slip still folds in rows with no flex_type — unchanged', async () => {
    expect(await filterFor({ flex_type: 'slip' })).toMatchObject({
      flex_type: { $in: ['slip', null] },
    });
  });

  it('⭐⭐ (C) no query ⇒ no type filter at all — unchanged', async () => {
    const f = await filterFor({});
    expect(f['flex_type']).toBeUndefined();
  });

  it('⭐ (C) every other type still filters by equality — unchanged', async () => {
    expect(await filterFor({ flex_type: 'customerhelper' })).toMatchObject({
      flex_type: 'customerhelper',
    });
  });
});

describe('[FLEXMENUSUBTYPE] the sub-type, and what it must never disturb', () => {
  it('⭐⭐⭐ only a menu card can carry a sub-type', () => {
    /* Forced null for every other type so a stray value on a slip card can
       never make it look like a menu card to a future query. */
    expect(normalizeFlexSubType('main', 'menu')).toBe('main');
    expect(normalizeFlexSubType('main', 'slip')).toBeNull();
    expect(normalizeFlexSubType('main', 'custom')).toBeNull();
  });

  it('⭐⭐⭐ an unknown value becomes null — never a guessed default', () => {
    /* A typo must not silently pick a side. The card simply has no sub-type
       and the menu source will not match it, which is visible. */
    expect(normalizeFlexSubType('nonsense', 'menu')).toBeNull();
    expect(normalizeFlexSubType('', 'menu')).toBeNull();
    expect(normalizeFlexSubType(undefined, 'menu')).toBeNull();
    expect(normalizeFlexSubType(null, 'menu')).toBeNull();
  });

  it('⭐⭐ both shipped values are accepted', () => {
    expect(normalizeFlexSubType('main', 'menu')).toBe('main');
    expect(normalizeFlexSubType('sub', 'menu')).toBe('sub');
  });

  it('⭐ whitespace and case are not silently forgiven', () => {
    /* The value is a key a query will match on, not prose. Trimming is fine;
       inventing a case-insensitive match would make ' Main ' and 'main' two
       spellings of one thing in the database. */
    expect(normalizeFlexSubType('  main  ', 'menu')).toBe('main');
    expect(normalizeFlexSubType('MAIN', 'menu')).toBeNull();
  });
});

describe('[FLEXMENUSLUG] the optional slug, and what it must never disturb', () => {
  it('⭐⭐⭐ only a menu card can carry a slug', () => {
    /* Forced null everywhere else, exactly like the sub-type: a value left on a
       slip card is dead weight a future menu query could trip over. */
    expect(normalizeFlexSlug('main-menu', 'menu')).toBe('main-menu');
    expect(normalizeFlexSlug('main-menu', 'slip')).toBeNull();
    expect(normalizeFlexSlug('main-menu', 'custom')).toBeNull();
  });

  it('⭐⭐⭐ empty stays EMPTY — null, never an invented default', () => {
    /* The field is optional and the form may be left blank. Filling in a guess
       (the card name, a counter) would put a value in the database nobody chose
       and that nothing could tell apart from a deliberate one. THAT is what
       "no backfill" means here: absent stays absent, forever. */
    expect(normalizeFlexSlug('', 'menu')).toBeNull();
    expect(normalizeFlexSlug('   ', 'menu')).toBeNull();
    expect(normalizeFlexSlug(undefined, 'menu')).toBeNull();
    expect(normalizeFlexSlug(null, 'menu')).toBeNull();
  });

  it('⭐⭐ free text is accepted as typed, only trimmed', () => {
    /* The owner asked for text, not an identifier, so no charset rule is
       invented here. Trimming is the one safe normalisation: a trailing space is
       never meant, and it would make two slugs that look identical differ. */
    expect(normalizeFlexSlug('  ปุ่มหลัก 1  ', 'menu')).toBe('ปุ่มหลัก 1');
    expect(normalizeFlexSlug('Main Menu / A', 'menu')).toBe('Main Menu / A');
  });

  it('⭐ a non-string is not coerced into "[object Object]"', () => {
    expect(normalizeFlexSlug({ a: 1 }, 'menu')).toBeNull();
    expect(normalizeFlexSlug(42, 'menu')).toBe('42');
  });
});
