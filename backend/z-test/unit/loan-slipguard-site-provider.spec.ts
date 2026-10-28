/**
 * [FEAT-20261016-SLIPGUARDLOAN] SlipGuard as a slip provider on the LOAN site only — Swiftcheck stays the default.
 *
 * Owner 16/10/2026: "รองรับที่ slipguard + swiftcheck ทดสอบจริง" · "ห้ามกระทบ x api".
 *
 * The global switchboard (`slip/providers/provider-entries.ts`) keeps SlipGuard `enabled: false` —
 * its tripwire (`slip-provider-hook-field.spec.ts`) stays green and shop-api cannot see SlipGuard. The
 * loan provider declares `slipProviders: ['slipguard']` instead, and the slip registry consults that
 * declaration. The tripwire's two preconditions are met for that scope:
 *   #2 THE PAYMENT LEG — a site's extra provider exists only while its payment world is OFF, so a
 *      SlipGuard envelope can never reach Shop-API's topup (enforced in code, pinned below).
 *   #1 THE CLONE PAIR — a clone that would move a hook's provider without its key holds the
 *      provider back (clone tab) / does not inherit the other vendor's key (Copy Item).
 *
 * TARGET: loan resolves + offers SlipGuard; the clone pair holds.  PIN: shop-api / unbound unchanged.
 */
import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  providerSlipProviders,
  resetActiveProvider,
} from '@/modules/customer-provider';
import {
  buildClonePatch,
  holdSlipProviderWithoutKey,
  slipPairFieldsToSkip,
} from '@/modules/hooks';
import { SENSITIVE_FIELDS } from '@/infra/crypto';
import {
  DEFAULT_SLIP_PROVIDER,
  resolveSlipProvider,
  SLIP_PROVIDER_ENTRIES,
  SLIP_PROVIDERS,
  slipguardProvider,
  slipProviderOptions,
  swiftcheckProvider,
} from '@/modules/slip';

const byName = (n: string) => {
  const p = CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n);
  if (!p) throw new Error('no provider ' + n);
  return p;
};
const values = () => slipProviderOptions().map((o) => o.value);
const realChoices = () =>
  slipProviderOptions().filter((o) => !o.is_default).length;

const SRC = {
  _id: 's',
  alias: 'src',
  slip_provider: 'slipguard',
  slip_verify_key: 'enc:slipguardKeyCipher.x',
  slip_verify_branch: '12345',
};
const fresh = (over: Record<string, unknown> = {}) => ({
  _id: 'n',
  alias: 'new',
  slip_verify_key: '',
  slip_verify_branch: '',
  ...over,
});

afterEach(() => resetActiveProvider());

describe('[SLIPGUARDLOAN] TARGET — loan: SlipGuard is selectable, Swiftcheck stays the default', () => {
  beforeEach(() => bindActiveProvider(byName('loan_v1')));

  it('⭐ loan declares SlipGuard as its extra slip provider', () => {
    expect(byName('loan_v1').slipProviders).toEqual(['slipguard']);
    expect(providerSlipProviders()).toEqual(['slipguard']);
  });

  it('⭐ a hook set to slipguard verifies with SlipGuard (however it was typed)', () => {
    for (const v of ['slipguard', 'SlipGuard', ' slipguard ']) {
      expect(resolveSlipProvider(v)).toBe(slipguardProvider);
    }
  });

  it('⭐ the picker offers swiftcheck + slipguard ⇒ choice_count 2 ⇒ the FE shows the picker and the branch box', () => {
    expect(values()).toEqual(['', 'slipguard', 'swiftcheck']);
    expect(realChoices()).toBe(2);
  });

  it('🔴 PIN — empty / swiftcheck / a typo still verify with Swiftcheck', () => {
    for (const v of ['', '  ', undefined, null, 'nonsense']) {
      expect(resolveSlipProvider(v) ?? DEFAULT_SLIP_PROVIDER).toBe(
        swiftcheckProvider,
      );
    }
    expect(resolveSlipProvider('swiftcheck')).toBe(swiftcheckProvider);
  });
});

describe('[SLIPGUARDLOAN] PIN — shop-api and unbound see exactly today', () => {
  for (const [label, bind] of [
    ['shop-api', () => bindActiveProvider(byName('shopapi_v1'))],
    ['unbound', () => undefined],
  ] as const) {
    it(`⭐ ${label}: slipguard is not a provider; the options are ['', 'swiftcheck'] (choice_count 1, picker hidden)`, () => {
      bind();
      expect(resolveSlipProvider('slipguard')).toBeNull();
      expect(resolveSlipProvider('slipguard') ?? DEFAULT_SLIP_PROVIDER).toBe(
        swiftcheckProvider,
      );
      expect(values()).toEqual(['', 'swiftcheck']);
      expect(realChoices()).toBe(1);
      expect(providerSlipProviders()).toEqual([]);
    });
  }

  it('loan bound, then reset ⇒ slipguard is gone again (the list does not outlive the binding)', () => {
    bindActiveProvider(byName('loan_v1'));
    resetActiveProvider();
    expect(resolveSlipProvider('slipguard')).toBeNull();
    expect(values()).toEqual(['', 'swiftcheck']);
  });

  it('shop-api declares no extra slip provider', () => {
    expect(byName('shopapi_v1').slipProviders).toBeUndefined();
  });

  it('🔴 the global switchboard is untouched — SlipGuard still OFF there, the tripwire stays as it was', () => {
    expect(Object.keys(SLIP_PROVIDERS)).toEqual(['swiftcheck']);
    const entry = SLIP_PROVIDER_ENTRIES.find(
      (e) => e.provider === slipguardProvider,
    );
    expect(entry?.enabled).toBe(false);
  });
});

describe('[SLIPGUARDLOAN] tripwire #2 by construction — no extra provider where the payment world is ON', () => {
  it('⭐ a site that declares SlipGuard but keeps payment ON gets nothing (the envelope could reach Shop-API)', () => {
    bindActiveProvider({
      features: { payment: true },
      slipProviders: ['slipguard'],
    });
    expect(providerSlipProviders()).toEqual([]);
    expect(resolveSlipProvider('slipguard')).toBeNull();
    expect(values()).toEqual(['', 'swiftcheck']);
  });

  it('loan keeps payment OFF — the precondition its SlipGuard stands on', () => {
    expect(byName('loan_v1').features?.payment).toBe(false);
  });
});

describe('[SLIPGUARDLOAN] tripwire #1 — Copy Item: a provider move does not inherit the other vendor key', () => {
  it('⭐ loan: form moves slipguard → swiftcheck ⇒ key + branch NOT inherited (admin enters the new vendor key)', () => {
    bindActiveProvider(byName('loan_v1'));
    expect(
      slipPairFieldsToSkip(fresh({ slip_provider: 'swiftcheck' }), SRC),
    ).toEqual(['slip_verify_key', 'slip_verify_branch']);
    const r = buildClonePatch(
      fresh({ slip_provider: 'swiftcheck' }),
      SRC,
      SENSITIVE_FIELDS,
    );
    expect(r.patch).not.toHaveProperty('slip_verify_key');
    expect(r.patch).not.toHaveProperty('slip_verify_branch');
    expect(r.skipped).toEqual(
      expect.arrayContaining(['slip_verify_key', 'slip_verify_branch']),
    );
  });

  it('⭐ loan: same provider (or the form left it blank) ⇒ key + branch inherited as before', () => {
    bindActiveProvider(byName('loan_v1'));
    for (const p of ['slipguard', ' SlipGuard ', '']) {
      const r = buildClonePatch(
        fresh({ slip_provider: p }),
        SRC,
        SENSITIVE_FIELDS,
      );
      expect(r.patch['slip_verify_key']).toBe(SRC.slip_verify_key);
      expect(r.patch['slip_verify_branch']).toBe('12345');
    }
  });

  it('loan: "" and "swiftcheck" are the same provider — not a move', () => {
    bindActiveProvider(byName('loan_v1'));
    const src = { ...SRC, slip_provider: '' };
    expect(
      slipPairFieldsToSkip(fresh({ slip_provider: 'swiftcheck' }), src),
    ).toEqual([]);
  });

  it('🔴 PIN — shop-api: nothing is a move (one provider), so Copy Item inherits exactly as today', () => {
    bindActiveProvider(byName('shopapi_v1'));
    const r = buildClonePatch(
      fresh({ slip_provider: 'swiftcheck' }),
      SRC,
      SENSITIVE_FIELDS,
    );
    expect(r.patch['slip_verify_key']).toBe(SRC.slip_verify_key);
    expect(r.skipped).toEqual([]);
  });
});

describe('[SLIPGUARDLOAN] tripwire #1 — clone tab: a provider move without its key is held back', () => {
  const run = (target: Record<string, unknown>, fields: string[]) => {
    const updates: Record<string, unknown> = {
      slip_provider: 'slipguard',
      slip_verify_branch: '12345',
      ai_prompt: 'x',
    };
    const changed = Object.keys(updates).map((field) => ({
      field,
      from: null,
      to: null,
    }));
    const held = holdSlipProviderWithoutKey({
      updates,
      changedFields: changed,
      target,
      fields,
    });
    return { held, updates, changed: changed.map((c) => c.field) };
  };

  it('⭐ loan: swiftcheck → slipguard, key NOT ticked ⇒ provider + branch held, the rest still cloned, reported', () => {
    bindActiveProvider(byName('loan_v1'));
    const r = run({ slip_provider: '' }, [
      'slip_provider',
      'slip_verify_branch',
      'ai_prompt',
    ]);
    expect(r.held).toBe(true);
    expect(r.updates).toEqual({ ai_prompt: 'x' });
    expect(r.changed).toEqual(['ai_prompt']);
  });

  it('⭐ loan: key ticked ⇒ the pair travels together, nothing held', () => {
    bindActiveProvider(byName('loan_v1'));
    const r = run({ slip_provider: '' }, [
      'slip_provider',
      'slip_verify_branch',
      'slip_verify_key',
    ]);
    expect(r.held).toBe(false);
    expect(r.updates).toHaveProperty('slip_provider', 'slipguard');
  });

  it('loan: the target is already on slipguard ⇒ not a move, nothing held', () => {
    bindActiveProvider(byName('loan_v1'));
    expect(run({ slip_provider: 'SLIPGUARD' }, ['slip_provider']).held).toBe(
      false,
    );
  });

  it('🔴 PIN — shop-api: never held (slipguard is not a provider there)', () => {
    bindActiveProvider(byName('shopapi_v1'));
    const r = run({ slip_provider: '' }, [
      'slip_provider',
      'slip_verify_branch',
    ]);
    expect(r.held).toBe(false);
    expect(r.updates).toHaveProperty('slip_provider', 'slipguard');
  });

  /* the ROUTE itself (cloneHookSettings, real service) is driven in
     `clone-field-select.spec.ts` [SLIPGUARDLOAN] — loan holds, shop-api writes as before */
});
