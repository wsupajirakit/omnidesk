/**
 * [FEAT-20260905-CUSTPROV] Row normalisation — the half a `view` cannot ship
 * without.
 *
 * ## Why it exists
 * The 26 card values carry rows as RAW arrays, and every card then reads the
 * vendor's field names again while drawing. Counted across the panel's `.map()`
 * callbacks on 05/09: ~26 more field names over 5 row kinds. A `view` that
 * carried raw rows would leave the dashboard knowing that this vendor calls a
 * product's name `catalog_name`, so adding provider B would still be a two-repo
 * change — the outcome PART 7 §38 exists to prevent.
 *
 * ## 🔴 These vectors are the CURRENT screen, expressed as data
 * Each case names the panel line it was read from. They describe, they do not
 * judge: where two row kinds disagree, the disagreement is pinned, not tidied.
 */
import {
  resolveRow,
  resolveRows,
  SHOPAPI_V1_ROW_PATHS,
} from '@/modules/customer-provider';

const R = SHOPAPI_V1_ROW_PATHS;

describe('[CUSTPROV/ROWS] money and bonus rows — at / amount / status', () => {
  it('⭐ `at` wins over `date`, exactly as `h.at ?? h.date` does', () => {
    expect(resolveRow({ at: 'iso', date: 123 }, R['money']!)).toEqual({
      at: 'iso',
      amount: undefined,
      status: undefined,
    });
  });

  it('the real shape sends only `date`', () => {
    const row = resolveRow(
      { amount: 500, date: 1756684800000, status: 'success' },
      R['money']!,
    );
    expect(row).toEqual({ at: 1756684800000, amount: 500, status: 'success' });
  });

  it('⭐ an amount of 0 survives — it is an answer, not a gap', () => {
    // The `??` rule, at row level. `||` here would blank a genuine zero.
    expect(resolveRow({ amount: 0 }, R['money']!)['amount']).toBe(0);
  });
});

describe('[CUSTPROV/ROWS] product rows — the widest disagreement between the two upstreams', () => {
  it('⭐ the mock names win, one field at a time', () => {
    // PersonalPanel.tsx:2529-2532 — `g.product ?? g.name ?? g.catalog_name` etc.
    const row = resolveRow(
      { product: 'Mock Fashion', provider: 'MockCo', image: 'a.png', at: 5 },
      R['product']!,
    );
    expect(row['name']).toBe('Mock Fashion');
    expect(row['provider']).toBe('MockCo');
    expect(row['image']).toBe('a.png');
  });

  it('⭐ the real upstream resolves through its own names', () => {
    const row = resolveRow(
      {
        catalog_name: 'Real Target',
        product_name: 'RealCo',
        product_type: 'ELECTRONICS',
        catalog_image_path: 'cdn.x/y.png',
        played_at: 1784629980,
      },
      R['product']!,
    );
    expect(row).toEqual({
      name: 'Real Target',
      provider: 'RealCo',
      type: 'ELECTRONICS',
      image: 'cdn.x/y.png',
      at: 1784629980,
    });
  });

  it('the image is the RAW value — adding https:// is display logic, not a lookup', () => {
    // `PersonalPanel.tsx:2533` prefixes the scheme when it is missing. Doing it
    // here would make a path table start rewriting values.
    expect(
      resolveRow({ catalog_image_path: 'cdn.x/y.png' }, R['product']!)['image'],
    ).toBe('cdn.x/y.png');
  });
});

describe('[CUSTPROV/ROWS] coin and point round rows', () => {
  it('coin rows carry at / type / amount', () => {
    expect(
      resolveRow({ date: 900, type: 'spend', amount: 2 }, R['coin']!),
    ).toEqual({
      at: 900,
      type: 'spend',
      amount: 2,
    });
  });

  it('⭐ the coin row TEXT is deliberately absent — it is an algorithm', () => {
    /* `PersonalPanel.tsx:2694-2696` reads
       `note || reason || description || title || action` — a TRUTHY chain, so an
       empty-string note falls through — then defaults to "ได้รับ"/"ใช้ไป" by
       `type`. Two rules a path table does not have. It belongs in
       `derive-fields.ts`, and this case is what stops it being quietly added
       here with the wrong chain rule. */
    expect(Object.keys(R['coin']!)).toEqual(['at', 'type', 'amount']);
    expect(R['coin']!['text']).toBeUndefined();
  });

  it('⭐ point round prize falls through three names, cost through three more', () => {
    expect(
      resolveRow({ reward: 'Free Round', coin_spent: 3 }, R['pointRound']!),
    ).toEqual({
      at: undefined,
      prize: 'Free Round',
      cost: 3,
    });
  });
});

describe('[CUSTPROV/ROWS] the two pending pipes read time in OPPOSITE order', () => {
  it('⭐ withdraw is `at ?? date`, deposit is `date ?? at` — and both are pinned', () => {
    /* `PersonalPanel.tsx:1811` vs `:1857`. Same feature, opposite order. The
       deposit side is frozen by the owner (11/08, *"ฝากมาจาก statement อย่าไป
       ยุ่ง"*) because it is the list the slip matcher reads, so unifying them
       would move a timestamp on a screen an admin reconciles against. */
    const both = { at: 'A', date: 'D' };
    expect(resolveRow(both, R['pendingWithdraw']!)['at']).toBe('A');
    expect(resolveRow(both, R['pendingDeposit']!)['at']).toBe('D');
  });

  it('the deposit pipe also carries `type`, which the withdraw pipe does not', () => {
    // `type === 'deposit'` is what keeps withdraw statements out of that tab.
    expect(Object.keys(R['pendingDeposit']!)).toContain('type');
    expect(Object.keys(R['pendingWithdraw']!)).not.toContain('type');
  });
});

describe('[CUSTPROV/ROWS] resolveRows over a list', () => {
  it('⭐ order is preserved — several cards sort afterwards', () => {
    const out = resolveRows(
      [{ amount: 1 }, { amount: 2 }, { amount: 3 }],
      R['money']!,
    );
    expect(out.map((r) => r['amount'])).toEqual([1, 2, 3]);
  });

  it('a non-array is an empty list, not a throw', () => {
    expect(resolveRows(undefined, R['money']!)).toEqual([]);
    expect(resolveRows(null, R['money']!)).toEqual([]);
    expect(resolveRows({ not: 'an array' }, R['money']!)).toEqual([]);
  });

  it('⭐ every declared row kind resolves without throwing on an empty row', () => {
    // A table with a typo'd path would still pass a single happy case; this
    // walks all of them.
    for (const [kind, table] of Object.entries(R)) {
      expect(`${kind}:${typeof resolveRow({}, table)}`).toBe(`${kind}:object`);
    }
    expect(Object.keys(R)).toHaveLength(7);
  });
});
