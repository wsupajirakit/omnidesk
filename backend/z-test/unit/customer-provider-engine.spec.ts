/**
 * [FEAT-20260905-CUSTPROV] The path engine's own rules, pinned.
 *
 * ## Why this file exists — a mutation survived
 * `readChain` implements `??`, not `||`, and its header says so in capitals. On
 * 05/09 that line was mutated to `if (v) return v;` and **all 61 tests still
 * passed**: every vector in the suite happened to use truthy values, so the rule
 * the comment shouted about was covered by nothing at all.
 *
 * That is the failure this file exists to prevent. A comment explaining why a
 * falsy value must stop a chain, with no case behind it, is a comment that will
 * be "simplified" by someone reading only the code.
 * คอมเมนต์ที่ไม่มีเทสหนุน = กฎที่รอโดนลบ
 *
 * ## What it costs to get wrong
 * A customer whose credit is genuinely `0` falls through to the other vendor's
 * key and the card shows whatever that holds — a stale number presented as a
 * balance. Same for an empty-string name and a `false` flag.
 */
import { readPath } from '@/common/utils/read-path';
import {
  composeFields,
  DEFAULT_CUSTOMER_PROVIDER,
  readChain,
  resolveSections,
} from '@/modules/customer-provider';

describe('[CUSTPROV/ENGINE] readChain stops on a falsy ANSWER — it is ?? not ||', () => {
  const blob = {
    a: 0,
    b: '',
    c: false,
    fallbackA: 999,
    fallbackB: 'not empty',
    fallbackC: true,
  };

  it('⭐ 0 wins over a later path — a zero balance is a balance', () => {
    expect(readChain(blob, ['a', 'fallbackA'])).toBe(0);
  });

  it("⭐ '' wins over a later path — an empty name is an answer, not a gap", () => {
    expect(readChain(blob, ['b', 'fallbackB'])).toBe('');
  });

  it('⭐ false wins over a later path — a flag that is off is set', () => {
    expect(readChain(blob, ['c', 'fallbackC'])).toBe(false);
  });

  it('null and undefined DO fall through — that is the other half of ??', () => {
    expect(readChain({ x: null, y: 7 }, ['x', 'y'])).toBe(7);
    expect(readChain({ y: 7 }, ['x', 'y'])).toBe(7);
    expect(readChain({}, ['x', 'y'])).toBeUndefined();
  });

  it('the whole chain missing ⇒ undefined, never a throw', () => {
    expect(readChain(null, ['a.b.c'])).toBeUndefined();
    expect(readChain(undefined, ['a'])).toBeUndefined();
  });
});

describe('[CUSTPROV/ENGINE] readPath — the whole grammar, and where it stops', () => {
  const blob = {
    finance: {
      balances: [
        { asset_code: 'credit', amount: 50085.46 },
        { asset_code: 'cash', amount: 0 },
      ],
      nested: { deep: { value: 'found' } },
    },
  };

  it('a dotted path walks objects', () => {
    expect(readPath(blob, 'finance.nested.deep.value')).toBe('found');
  });

  it('⭐ the array filter picks by field, and it is the MATCH, not the first row', () => {
    // Mutating `.find(…)` to `arr[0]` used to leave every test green: the credit
    // row happened to be first. `cash` is second on purpose.
    expect(readPath(blob, 'finance.balances[asset_code=cash].amount')).toBe(0);
    expect(readPath(blob, 'finance.balances[asset_code=credit].amount')).toBe(
      50085.46,
    );
  });

  it('no row matches ⇒ undefined, and the walk stops rather than throwing', () => {
    expect(
      readPath(blob, 'finance.balances[asset_code=nope].amount'),
    ).toBeUndefined();
  });

  it('the target is not an array ⇒ undefined', () => {
    expect(
      readPath(blob, 'finance.nested[asset_code=x].amount'),
    ).toBeUndefined();
  });

  it('⭐ the field comparison COERCES — a numeric id matches its digits', () => {
    /* 🔴 THIS CHANGED ON 05/09, deliberately, and the change is recorded rather
       than hidden. This module first shipped its own reader with a strict
       `===`, so `rows[id=1]` missed a numeric `1`. It now uses the canonical
       reader (`@/common/utils/read-path`), which is the production-proven one
       behind the flex/broadcast paths and compares `String(item[key])`.
       Nothing on a screen moved: `shopapi_v1` keys its balances by the STRINGS
       'credit' / 'cash' / 'coin', so both readers answer identically there —
       verified by the vectors in `customer-provider-fields.spec.ts`. */
    const numeric = { rows: [{ id: 1, v: 'a' }] };
    expect(readPath(numeric, 'rows[id=1].v')).toBe('a');
  });

  it('⭐ and the canonical reader brings [0] and [a][b], which the local one lacked', () => {
    const b = {
      products: [[{ n: 'x' }, { n: 'y' }]],
      rows: [{ v: 1 }, { v: 2 }],
    };
    expect(readPath(b, 'rows[1].v')).toBe(2);
    expect(readPath(b, 'products[0][1].n')).toBe('y');
  });

  it("the empty path is the root itself — how a vendor says 'top level'", () => {
    expect(readPath(blob, '')).toBe(blob);
  });
});

describe('[CUSTPROV/ENGINE] resolveSections — the root is a guard', () => {
  const decl = {
    rootPaths: ['data', ''],
    sectionPaths: {
      profile: ['profile'],
      finance: ['finance', 'profile.finance'],
    },
    fieldPaths: {},
  };

  it('picks the first root that HAS a profile', () => {
    expect(
      resolveSections({ data: { profile: { n: 1 } } }, decl)?.['profile'],
    ).toEqual({
      n: 1,
    });
    expect(resolveSections({ profile: { n: 2 } }, decl)?.['profile']).toEqual({
      n: 2,
    });
  });

  it('⭐ no profile anywhere ⇒ null, even when a section is sitting right there', () => {
    expect(
      resolveSections({ data: { finance: { credit: 1 } } }, decl),
    ).toBeNull();
    expect(resolveSections({}, decl)).toBeNull();
    expect(resolveSections(null, decl)).toBeNull();
  });

  it('a provider that forgets sectionPaths.profile is told so, loudly', () => {
    // A silent `undefined` here would make every field fall back and look like a
    // vendor with no data, which is the hardest kind of bug to trace.
    expect(() =>
      resolveSections(
        {},
        { rootPaths: [''], sectionPaths: {}, fieldPaths: {} },
      ),
    ).toThrow(/sectionPaths\.profile/);
  });
});

describe('[CUSTPROV/ENGINE] the falsy rule survives all the way to a card value', () => {
  it('⭐ a credit balance of 0 is served as 0, not replaced by the other key', () => {
    // The end-to-end version of the mutation that survived: both spellings
    // present, the first holding a real zero.
    const f = composeFields(DEFAULT_CUSTOMER_PROVIDER, {
      data: {
        profile: {},
        finance: {
          credit_balance: 0,
          balances: [{ asset_code: 'credit', amount: 12345 }],
        },
      },
    });
    expect(f.finCredit).toBe(0);
  });
});
