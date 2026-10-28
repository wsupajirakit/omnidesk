/* eslint-disable @typescript-eslint/require-await */
/**
 * [FEAT-20260829-MENUDYNSCEN] a scenario served from a CARD, not a code file.
 *
 * ── THE OWNER'S QUESTION, AND WHY THE OBVIOUS ANSWER IS WRONG ───────────────
 * "Must the scenario file name equal the slug, so the file loads the right
 *  card?" — no, and the live data is the argument: the collection already holds
 * `1234` beside `menu-seed-primary-a` (read 29/08). A slug lives in the DB where
 * an operator renames it freely; a scenario key lives in code behind a deploy.
 * Welding them means an operator renaming a card silently breaks a menu.
 *
 * So the rule is INJECTED (`slugFor`). These cases pin that the rule really
 * decides — including that two different rules produce two different cards for
 * the SAME scenario key, which is what "dynamic, freely chosen" means.
 *
 * ── AND THE FALL-THROUGH, WHICH IS THE SAFETY PROPERTY ──────────────────────
 * Every "no" answer (`null` rule, missing card, deleted card, empty card, a
 * rule that throws, a read that throws) must FALL THROUGH to the next source,
 * never answer an empty menu. That is what keeps a file-backed scenario working
 * when its card is absent — the two mechanisms coexist instead of competing.
 */
import {
  CardDefinitionSource,
  buildSources,
  CodeRegistrySource,
  type MenuContext,
  type StoredMenuCard,
  type MenuWiring,
} from '@/modules/menu';

const ctx = (): MenuContext => ({
  hook: { group: 'g1' },
  lineUserId: 'U1',
  member: null,
  siteRules: null,
  silence: { silenced: false, by: null },
});

const card = (over: Partial<StoredMenuCard> = {}): StoredMenuCard => ({
  name: 'MENU main',
  flex_type: 'menu',
  flex_slug: 'anything',
  group_ids: ['g1'],
  content_json: { type: 'bubble' },
  ...over,
});

const shelf = (rows: Record<string, StoredMenuCard>) => ({
  find: async (q: { slug?: string }) =>
    (q.slug ? rows[q.slug] : undefined) ?? null,
});

const src = (
  rows: Record<string, StoredMenuCard>,
  slugFor: (k: string) => string | null | Promise<string | null>,
  warn?: (d: string) => void,
) =>
  new CardDefinitionSource({
    cards: shelf(rows),
    slugFor: (k) => slugFor(k),
    ...(warn ? { warn } : {}),
  });

describe('[CARDSRC] the injected rule decides which card serves a scenario', () => {
  it('⭐ serves the card the rule names', async () => {
    const s = src({ 'sub-a': card({ flex_slug: 'sub-a' }) }, () => 'sub-a');
    const def = await s.get('second', null, ctx());
    expect(def?.render).toBe('stored');
    expect(def?.card?.slug).toBe('sub-a');
    expect(def?.key).toBe('second');
  });

  it('⭐⭐ a DIFFERENT rule serves a different card for the SAME scenario', async () => {
    const rows = {
      'sub-a': card({ flex_slug: 'sub-a' }),
      '1234': card({ flex_slug: '1234' }),
    };
    const a = await src(rows, () => 'sub-a').get('second', null, ctx());
    const b = await src(rows, () => '1234').get('second', null, ctx());
    expect([a?.card?.slug, b?.card?.slug]).toEqual(['sub-a', '1234']);
  });

  it('the slug need not resemble the scenario key at all', async () => {
    // the real collection holds `1234` — a convention would have excluded it
    const s = src({ '1234': card({ flex_slug: '1234' }) }, () => '1234');
    expect((await s.get('primary', null, ctx()))?.card?.slug).toBe('1234');
  });

  it('passes the variant through in the key it answers', async () => {
    const s = src({ x: card({ flex_slug: 'x' }) }, () => 'x');
    const def = await s.get('second', 'c', ctx());
    expect(def?.key).toBe('second-c');
    expect(def?.variant).toBe('c');
  });

  it('the rule may read the context (per-hook mapping)', async () => {
    const seen: unknown[] = [];
    const s = new CardDefinitionSource({
      cards: shelf({ x: card({ flex_slug: 'x' }) }),
      slugFor: (k, c) => {
        seen.push([k, c.hook['group']]);
        return 'x';
      },
    });
    await s.get('primary', null, ctx());
    expect(seen).toEqual([['primary', 'g1']]);
  });
});

describe('[CARDSRC] every "no" falls through — never an empty menu', () => {
  const cases: Array<[string, () => CardDefinitionSource]> = [
    ['the rule maps nothing', () => src({}, () => null)],
    ['no card under that slug', () => src({}, () => 'missing')],
    [
      'the card was deleted',
      () =>
        src({ x: card({ flex_slug: 'x', deleted_at: new Date() }) }, () => 'x'),
    ],
    [
      'the card is empty',
      () => src({ x: card({ flex_slug: 'x', content_json: null }) }, () => 'x'),
    ],
  ];

  it.each(cases)('returns null when %s', async (_label, make) => {
    expect(await make().get('primary', null, ctx())).toBeNull();
  });

  it('a rule that THROWS falls through instead of taking the menu down', async () => {
    const seen: string[] = [];
    const s = src(
      {},
      () => {
        throw new Error('rule exploded');
      },
      (d) => seen.push(d),
    );
    expect(await s.get('primary', null, ctx())).toBeNull();
    expect(seen[0]).toContain('slug rule failed');
  });

  it('a card read that THROWS falls through too', async () => {
    const seen: string[] = [];
    const s = new CardDefinitionSource({
      cards: {
        find: async () => {
          throw new Error('mongo down');
        },
      },
      slugFor: () => 'x',
      warn: (d) => seen.push(d),
    });
    expect(await s.get('primary', null, ctx())).toBeNull();
    expect(seen[0]).toContain('card read failed');
  });

  it('a warn that throws still costs nobody the menu', async () => {
    const s = src(
      {},
      () => {
        throw new Error('boom');
      },
      () => {
        throw new Error('logger exploded');
      },
    );
    expect(await s.get('primary', null, ctx())).toBeNull();
  });
});

describe('[CARDSRC] ⭐⭐⭐ it never invents buttons', () => {
  it('items is EMPTY — the card own buttons must survive minting', async () => {
    const s = src({ x: card({ flex_slug: 'x' }) }, () => 'x');
    /* Any item here would be minted OVER the operator's buttons by
       mintButtons, silently re-pointing every destination they wrote. */
    expect((await s.get('primary', null, ctx()))?.items).toEqual([]);
  });

  it('uses the card name as alt-text, not an invented string', async () => {
    const s = src({ x: card({ flex_slug: 'x', name: 'เมนูหลัก' }) }, () => 'x');
    expect((await s.get('primary', null, ctx()))?.title).toBe('เมนูหลัก');
  });

  it('falls back to the scenario key when the card is unnamed', async () => {
    const s = src({ x: card({ flex_slug: 'x', name: '  ' }) }, () => 'x');
    expect((await s.get('primary', null, ctx()))?.title).toBe('primary');
  });
});

describe('[CARDSRC] the chain order', () => {
  const wiring = (over: Partial<MenuWiring> = {}): MenuWiring => ({
    coreSend: async () => ({}),
    ...over,
  });

  it('the code registry is ALWAYS last', () => {
    const s = buildSources(wiring({ cards: shelf({}), slugFor: () => 'x' }));
    expect(s[s.length - 1]).toBeInstanceOf(CodeRegistrySource);
  });

  it('the card source sits in front of the registry', () => {
    const s = buildSources(wiring({ cards: shelf({}), slugFor: () => 'x' }));
    expect(s[0]).toBeInstanceOf(CardDefinitionSource);
    expect(s).toHaveLength(2);
  });

  it('explicit front sources still win over the card source', () => {
    const front = { get: () => null };
    const s = buildSources(
      wiring({ cards: shelf({}), slugFor: () => 'x', frontSources: [front] }),
    );
    expect(s[0]).toBe(front);
    expect(s[1]).toBeInstanceOf(CardDefinitionSource);
  });

  it('⭐ omitting the rule changes NOTHING — every menu still comes from code', () => {
    const s = buildSources(wiring({ cards: shelf({}) }));
    expect(s).toHaveLength(1);
    expect(s[0]).toBeInstanceOf(CodeRegistrySource);
  });

  it('a rule with no card reader is skipped, never registered dead', () => {
    const s = buildSources(wiring({ slugFor: () => 'x' }));
    expect(s).toHaveLength(1);
    expect(s[0]).toBeInstanceOf(CodeRegistrySource);
  });
});
