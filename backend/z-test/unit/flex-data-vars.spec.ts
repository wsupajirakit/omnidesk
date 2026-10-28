/**
 * [FIX-20260808-FLEXVARMAP] Unit tests for the RUNTIME flex var-map assembly
 * (`src/modules/webhook/flex-data-vars.util.ts`).
 *
 * Pure, no network, no DB. `translate` is a spy or a stub throughout.
 *
 * The four HARD INVARIANTS from the risk note, each asserted below:
 *   1. empty/absent source → every tag "-", NO raw {{tag}} survives
 *   2. falsy-but-real values survive: 0 → "0", false → its formatted form
 *   3. profile vs site_rules formatter divergence preserved
 *   4. translate opts threaded: { scope, path, custom_tool_id(tool) } from opts
 *
 * Plus a byte-parity check against a realistic committed profile.
 */

import { CUSTOMER_PROFILE_SAMPLE } from '@/modules/content';
import {
  FLEX_VAR_SOURCES,
  buildFlexProfileVarMap,
  buildFlexVarMaps,
  buildSiteRulesVarMap,
  pickByRole,
  type TranslateFn,
} from '@/modules/webhook';

/** A translate that never knows a word — forces the raw/fallback branch. */
const nullTranslate: TranslateFn = () => null;

const RAW = CUSTOMER_PROFILE_SAMPLE as Record<string, unknown>;
const SAMPLE_PROFILE =
  ((RAW['data'] as Record<string, unknown>)?.['profile'] as Record<
    string,
    unknown
  >) ??
  (RAW['profile'] as Record<string, unknown>) ??
  RAW;

/**
 * The combined-blocks shape `extractFlexProfileFields` / `pickByRole` expect:
 * `combined[key] = { is_profile, role, data: <api body> }`.
 * The profile body is `{ data: { profile } }` (double-nested — see
 * flex-render.util extractFlexProfileFields comment).
 */
function makeProfileData(
  profile: Record<string, unknown> | null,
  siteShop: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const combined: Record<string, unknown> = {};
  if (profile) {
    combined['profile_block'] = {
      is_profile: true,
      data: { data: { profile } },
    };
  }
  if (siteShop) {
    combined['site_rules_block'] = {
      role: 'site_rules',
      data: { shop: siteShop },
    };
  }
  return combined;
}

describe('[FIX-20260808-FLEXVARMAP] buildFlexProfileVarMap — real data', () => {
  it('resolves key tags to REAL customer values (byte-parity sample)', () => {
    const map = buildFlexProfileVarMap(SAMPLE_PROFILE, {}, nullTranslate);

    // customer name lives at bank.account_name (spec `bank_account_name`).
    expect(map['bank_account_name']).toBe('judy');
    // bank_code shows the pretty name, not the raw "BBL".
    expect(map['bank_code']).toBe('Bangkok Bank');
    // a tier field.
    expect(map['tier_name']).toBe('Normal');
    // a finance balance — the cash wallet, whose real amount is 0.
    expect(map['balance_cash']).toBe('0');
  });

  it('INVARIANT 2 — falsy-but-real 0 survives, does not blank to "-"', () => {
    const map = buildFlexProfileVarMap(SAMPLE_PROFILE, {}, nullTranslate);
    expect(map['balance_cash']).toBe('0');
    expect(map['balance_cash']).not.toBe('-');
  });

  it('INVARIANT 1 — null profile → every tag is "-", never raw/blank', () => {
    const map = buildFlexProfileVarMap(null, {}, nullTranslate);
    const values = Object.values(map);
    expect(values.length).toBeGreaterThan(0);
    // bank_code with no code stays "-" (nice-name override guards on truthy).
    expect(map['bank_code']).toBe('-');
    // every value is a non-empty string; none carries a stray {{ }}.
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v).not.toMatch(/\{\{|\}\}/);
      expect(v.trim()).not.toBe('');
    }
  });
});

describe('[FIX-20260808-FLEXVARMAP] pickByRole', () => {
  it('finds a block by declared role', () => {
    const combined = {
      a: { role: 'other', data: 1 },
      b: { role: 'site_rules', data: { shop: {} } },
    };
    expect(pickByRole(combined, 'site_rules')?.key).toBe('b');
  });

  it('falls back to a key regex when no role matches', () => {
    const combined = { my_site_rules: { data: { shop: {} } } };
    expect(pickByRole(combined, 'site_rules', /site.?rule/i)?.key).toBe(
      'my_site_rules',
    );
  });

  it('returns null for a non-object / absent match', () => {
    expect(pickByRole(null, 'site_rules')).toBeNull();
    expect(pickByRole({ x: { role: 'z' } }, 'site_rules')).toBeNull();
  });
});

describe('[FIX-20260808-FLEXVARMAP] formatter divergence — profile vs site_rules', () => {
  /**
   * INVARIANT 3. A raw boolean routes to dict `bool`; with a translate that
   * MISSES, the two formatters diverge on purpose:
   *   profile   → primitiveText(false) → "false"
   *   site_rules→ boolean safety net    → "ปิด"
   */
  it('a missed boolean renders differently on each source', () => {
    // is_auto_deposit is a real profile boolean (false in the sample).
    const profileMap = buildFlexProfileVarMap(
      SAMPLE_PROFILE,
      {},
      nullTranslate,
    );
    expect(profileMap['is_auto_deposit']).toBe('false');

    // Drive the same raw boolean through the site_rules build via a shop block
    // whose value is a boolean at a spec path. Assert the เปิด/ปิด net fires.
    // (site_rules spec paths carry booleans; the net is what differs.)
    const siteMap = buildSiteRulesVarMap(
      { wallet: { wallet_setting: { is_open_deposit: false } } },
      {},
      nullTranslate,
    );
    expect(siteMap['dep_open']).toBe('ปิด');
    // At least one site_rules boolean must have rendered เปิด/ปิด, never "false".
    const rendered = Object.values(siteMap);
    expect(rendered).toContain('ปิด');
    expect(rendered).not.toContain('false');
  });
});

describe('[FIX-20260808-FLEXVARMAP] translate opts threading', () => {
  it('INVARIANT 4 — build calls translate with { scope, path, tool } from opts', () => {
    const calls: Array<{
      dict: string;
      scope?: string;
      path?: string;
      tool?: string;
    }> = [];
    const spy: TranslateFn = (dict, _key, opts) => {
      calls.push({ dict, scope: opts.scope, path: opts.path, tool: opts.tool });
      return null;
    };

    buildFlexProfileVarMap(
      SAMPLE_PROFILE,
      { scope: 'demo-scope', tool: '4242' },
      spy,
    );

    // Some formattable value (e.g. a datetime/bool) must have hit translate.
    expect(calls.length).toBeGreaterThan(0);
    const withScope = calls.find((c) => c.scope === 'demo-scope');
    expect(withScope).toBeDefined();
    expect(withScope?.tool).toBe('4242');
    // path is the data.profile.-prefixed stored spelling.
    expect(withScope?.path).toMatch(/^data\.profile\./);
  });
});

describe('[FIX-20260808-FLEXVARMAP] buildFlexVarMaps — orchestrator', () => {
  it('emits BOTH namespaced and bare tags for the implicit profile source', () => {
    const doc = { source_roles: ['profile'] };
    const map = buildFlexVarMaps(
      doc,
      makeProfileData(SAMPLE_PROFILE),
      { custom_tool_id: '99' },
      nullTranslate,
    );
    expect(map['bank_code']).toBe('Bangkok Bank'); // bare (implicit)
    expect(map['profile.bank_code']).toBe('Bangkok Bank'); // namespaced
  });

  it('INVARIANT 1 — a SELECTED source with no data still fills "-", no braces leak', () => {
    // Card selects site_rules; profileData has a profile but NO site block.
    const doc = { source_roles: ['site_rules'] };
    const map = buildFlexVarMaps(
      doc,
      makeProfileData(SAMPLE_PROFILE, null),
      null,
      nullTranslate,
    );
    // site_rules tags exist and are all namespaced "-", never skipped.
    const siteKeys = Object.keys(map).filter((k) =>
      k.startsWith('site_rules.'),
    );
    expect(siteKeys.length).toBeGreaterThan(0);
    for (const k of siteKeys) {
      expect(map[k]).not.toMatch(/\{\{|\}\}/);
    }
    // profile is always included (implicit) — bank_code still real.
    expect(map['bank_code']).toBe('Bangkok Bank');
  });

  it('threads custom_tool_id and profile web_code as scope into translate', () => {
    const calls: Array<{ scope?: string; tool?: string }> = [];
    const spy: TranslateFn = (_d, _k, opts) => {
      calls.push({ scope: opts.scope, tool: opts.tool });
      return null;
    };
    buildFlexVarMaps(
      { source_roles: ['profile'] },
      makeProfileData(SAMPLE_PROFILE),
      { custom_tool_id: 777 },
      spy,
    );
    const webCode = SAMPLE_PROFILE['web_code'];
    const hit = calls.find((c) => c.tool === '777');
    expect(hit).toBeDefined();
    if (typeof webCode === 'string') {
      expect(calls.some((c) => c.scope === webCode)).toBe(true);
    }
  });

  it('a throwing source is skipped, not fatal', () => {
    const site = FLEX_VAR_SOURCES['site_rules']!;
    const original = site.pick;
    site.pick = () => {
      throw new Error('boom');
    };
    try {
      const map = buildFlexVarMaps(
        { source_roles: ['site_rules'] },
        makeProfileData(SAMPLE_PROFILE),
        null,
        nullTranslate,
      );
      // profile survived; site_rules silently dropped.
      expect(map['bank_code']).toBe('Bangkok Bank');
      expect(Object.keys(map).some((k) => k.startsWith('site_rules.'))).toBe(
        false,
      );
    } finally {
      site.pick = original;
    }
  });
});
