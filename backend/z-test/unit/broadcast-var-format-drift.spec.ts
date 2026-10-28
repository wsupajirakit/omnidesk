/**
 * [FEAT-20260822-BCASTFORMATCLONE] The clone and the original must produce the
 * SAME VALUES, not merely the same tag names.
 * ===========================================================================
 * The tag-set drift spec proves the two know the same variables. This one
 * proves they turn the same data into the same text. A clone that agrees on
 * names and disagrees on values is the worse failure: every fashion looks filled
 * and every number is wrong.
 *
 * ⚠️ This file is ALLOWED to import the original; the runtime clone is not.
 * ⚠️ Red here means fix the CLONE. Upstream is upstream.
 */
import {
  buildFlexProfileVarMap as cloneProfileMap,
  buildSiteRulesVarMap as cloneSiteMap,
} from '@/modules/content';
import {
  buildFlexProfileVarMap as originalProfileMap,
  buildSiteRulesVarMap as originalSiteMap,
} from '@/modules/webhook';

/** No dictionary, so both sides fall back to their built-in formatting. */
const noTranslate = () => null;

/** A profile with one value of every kind the formatters treat specially. */
const profile = {
  web_code: 'WEB1',
  line_user_id: 'U0001',
  status: 'active',
  phone: '0812345678',
  registered_at: '2026-01-15T08:30:00.000Z',
  truewallet: '',
  tier: { code: 'T1', name: 'Gold', level: 2 },
  bank: { account_no: '1234xxxx', account_name: 'JUDY', code: 'BBL' },
  promotion: { has_active_promotion: true },
  finance: {
    transactions: {
      deposit: [
        {
          status: 'success',
          amount: 1500.5,
          created_at: '2026-02-02T01:00:00.000Z',
        },
      ],
      withdraw: [{ status: 'pending', amount: 200 }],
    },
  },
};

const siteRules = {
  data: {
    shop: {
      wallet: {
        wallet_setting: {
          is_open_deposit: true,
          is_withdraw_open: false,
          deposit_amount_mode: 'auto',
          deposit_min: 100,
        },
      },
      products: { products: [{ name: 'home_living', is_open: true }] },
      promotions: { promotions: [{ name: 'welcome', is_active: true }] },
    },
  },
};

const opts = { tool: null, scope: 'WEB1' };

describe('format drift — profile values', () => {
  const ours = cloneProfileMap(profile, opts, noTranslate);
  const theirs = originalProfileMap(profile, opts, noTranslate);

  it('the original produced values at all (a vacuity check)', () => {
    expect(Object.keys(theirs).length).toBeGreaterThan(100);
  });

  it('🔴 every key holds an identical value', () => {
    const differing = Object.keys(theirs).filter((k) => ours[k] !== theirs[k]);
    expect(differing).toEqual([]);
  });

  it('🔴 the two maps have exactly the same keys', () => {
    expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).sort());
  });

  it('empty stays `-` here — the N/A pass runs afterwards, not inside', () => {
    // Making the clone emit N/A directly would fail every comparison above for
    // a reason that has nothing to do with drift.
    expect(Object.values(theirs)).toContain('-');
    expect(ours['truewallet']).toBe(theirs['truewallet']);
  });
});

describe('format drift — site_rules values', () => {
  const ours = cloneSiteMap(siteRules, opts, noTranslate);
  const theirs = originalSiteMap(siteRules, opts, noTranslate);

  it('the original produced values at all', () => {
    expect(Object.keys(theirs).length).toBeGreaterThan(100);
  });

  it('🔴 every key holds an identical value', () => {
    const differing = Object.keys(theirs).filter((k) => ours[k] !== theirs[k]);
    expect(differing).toEqual([]);
  });

  it('🔴 the two maps have exactly the same keys', () => {
    expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).sort());
  });
});

describe('format drift — the awkward inputs', () => {
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['a string where an object belongs', 'nonsense'],
    ['an empty object', {}],
    ['an array', []],
  ];

  it.each(cases)(
    'profile: %s behaves the same on both sides',
    (_label, input) => {
      expect(cloneProfileMap(input, opts, noTranslate)).toEqual(
        originalProfileMap(input, opts, noTranslate),
      );
    },
  );

  it.each(cases)(
    'site_rules: %s behaves the same on both sides',
    (_label, input) => {
      expect(cloneSiteMap(input, opts, noTranslate)).toEqual(
        originalSiteMap(input, opts, noTranslate),
      );
    },
  );
});
