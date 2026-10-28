import {
  deriveCategory,
  normalizeEndpoints,
  PAYMENT_ROLES,
} from '@/modules/hooks/custom-tool-normalize';

/**
 * ==== [FIX-20260810-CATFROMROLE] ====
 *
 * The role dropdown offers `pay_topup`/`pay_walletpay` on EVERY tool, but the payment
 * runner gates on the separate `category` field
 * (`payment-runner.service.ts:532`). An operator could pick the payment role, save,
 * and get a line that is silently inert because หมวด still said generic — no error,
 * no warning. Two fields, one fact, free to disagree.
 *
 * The owner's requirement: one tool, one save, and profile / site_rules / link /
 * topup / walletpay all keep working. So these tests pin BOTH halves — the derivation
 * itself AND the fact that the generic roles are untouched by it.
 */

const ep = (role: string, key = 'K') => ({
  key,
  method: 'GET',
  path: '/x',
  role,
});

describe('[FIX-20260810-CATFROMROLE] category is decided by the endpoint roles', () => {
  /* [FEAT-20260815-WALLETPAYCAT] this case USED TO assert `'payment'` for every
     member of PAYMENT_ROLES. It no longer can: the two legs became separate
     categories on 15 Aug so that one OA can hold Shop-API v1 (`payment_tool_id`)
     and a dedicated walletpay tool (`walletpay_tool_id`) at the same time — while both
     answered `'payment'`, linking the second overwrote the first and the OA lost
     its binding.

     What survives unchanged is the property this case actually guards: a payment
     role NEVER leaves a tool `'generic'`. That is the money-relevant half — a
     tool the runner will look for `findRole` on must not be filed as generic.
     The exact category per role is pinned in `category-walletpay.spec.ts`. */
  it.each([...PAYMENT_ROLES])(
    'a %s endpoint never leaves the tool generic',
    (role) => {
      expect(deriveCategory([ep(role)])).not.toBe('generic');
    },
  );

  it('pay_topup is specifically payment — the topup gate depends on it', () => {
    expect(deriveCategory([ep('pay_topup')])).toBe('payment');
  });

  it('the generic roles never make a tool payment', () => {
    const generic = [
      'profile',
      'link',
      'edit',
      'unlink',
      'login',
      'refresh',
      'other',
    ];
    expect(deriveCategory(generic.map((r) => ep(r)))).toBe('generic');
  });

  it('no endpoints at all is generic', () => {
    expect(deriveCategory([])).toBe('generic');
  });

  it('THE REAL CASE: an existing Shop-API tool that gains a topup line', () => {
    // profile + link + site_rules is the tool the owner already runs. Adding the
    // topup leg must flip it in ONE save — this is the whole point of the fix.
    const before = [
      ep('profile', 'PROFILE'),
      ep('link', 'LINK'),
      ep('other', 'SITE_RULES'),
    ];
    expect(deriveCategory(before)).toBe('generic');
    expect(deriveCategory([...before, ep('pay_topup', 'PAY_TOPUP')])).toBe(
      'payment',
    );
  });

  it('keeps every generic endpoint intact alongside the payment legs', () => {
    // "profile site + payment + topup + walletpay ต้องทำงานเหมือนเดิม" — the derivation
    // must not drop, reorder or rewrite any endpoint.
    const all = [
      ep('profile', 'PROFILE'),
      ep('link', 'LINK'),
      ep('other', 'SITE_RULES'),
      ep('pay_topup', 'PAY_TOPUP'),
      ep('pay_walletpay', 'PAY_WALLETPAY'),
    ];
    const kept = normalizeEndpoints(all);
    expect(kept.map((e) => e.role)).toEqual([
      'profile',
      'link',
      'other',
      'pay_topup',
      'pay_walletpay',
    ]);
    expect(deriveCategory(kept)).toBe('payment');
  });

  it('a disabled payment line still counts', () => {
    // Switching an endpoint off is temporary. Flipping the tool back to generic
    // would ALSO unbind it from every OA (hooks.service.ts:2625) — far more than
    // the operator asked for.
    expect(deriveCategory([{ ...ep('pay_topup'), status: false }])).toBe(
      'payment',
    );
  });

  it('junk and missing roles are simply not payment', () => {
    expect(deriveCategory([{}])).toBe('generic'); // no role key at all
    expect(deriveCategory([ep('PAY_TOPUP')])).toBe('generic'); // case-sensitive on purpose
    expect(deriveCategory([ep('pay_topup_extra')])).toBe('generic');
  });

  it('survives the shapes a bad payload can carry', () => {
    // The write path must never throw on junk — it coerces, like every other
    // normalizer in this file.
    expect(deriveCategory([null as never, undefined as never])).toBe('generic');
    expect(deriveCategory(undefined as never)).toBe('generic');
  });

  it('PAYMENT_ROLES is the single source of truth, not a copy', () => {
    // A third payment leg added to PAYMENT_ROLES must be picked up here without
    // editing deriveCategory.
    expect([...PAYMENT_ROLES]).toEqual(['pay_topup', 'pay_walletpay']);
    for (const role of PAYMENT_ROLES) {
      expect(normalizeEndpoints([ep(role)])[0]!.role).toBe(role);
    }
  });
});
