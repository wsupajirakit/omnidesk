/**
 * =============================================================================
 * [FEAT-20260903-TOPUPPERPROVIDER] one Shop-API path per slip provider, optionally
 * =============================================================================
 *
 * `shop-api/v1/customer/validate-slip` was written for Swiftcheck's envelope, so a
 * second vendor may need its own path on the customer's Shop-API. A `pay_topup`
 * record can now say which provider it serves; a record that says nothing serves
 * everybody, which is every record in existence today.
 *
 * 🔴 THE BUG THIS ALSO FIXES. Selection used to be "the FIRST enabled record with
 * that role", so adding a second `pay_topup` record did nothing — the first won
 * and the new one was dead, silently. The first describe below is that bug,
 * written as a case.
 *
 * 🔴 RULE B IS THE POINT OF THE SECOND DESCRIBE: with nothing configured, the
 * result must be the SAME OBJECT the old lookup returned. Identity, not shape —
 * a record that merely looks the same would still be a different row of config.
 *
 * ⚠️ WALLETPAY IS NOT ROUTED THROUGH THIS and must not be. Owner's decision, 03/09.
 * The last case asserts the helper is not what the walletpay leg uses, so the
 * decision cannot drift into "we forgot the other leg".
 *
 * revert: delete with `src/modules/payment/payment-endpoint.helper.ts`.
 */
import { normalizeEndpoints } from '@/modules/hooks';
import { findTopupEndpoint } from '@/modules/payment';

/** The old selection, kept verbatim so RULE B can be asserted against it. */
const legacyFindRole = <T extends Record<string, unknown>>(
  endpoints: readonly T[],
  role: string,
): T | null =>
  endpoints.find((e) => e && e['status'] !== false && e['role'] === role) ??
  null;

const shared = {
  key: 'PAY_TOPUP',
  role: 'pay_topup',
  path: 'shop-api/v1/customer/validate-slip',
};
const boundSlipguard = {
  key: 'PAY_TOPUP_SLIPGUARD',
  role: 'pay_topup',
  path: 'shop-api/v1/customer/validate-slip-slipguard',
  slip_provider: 'slipguard',
};
const walletpay = {
  key: 'PAY_WALLETPAY',
  role: 'pay_walletpay',
  path: 'shop-api/v1/play',
};

describe('[TOPUPPERPROVIDER] ⭐ a bound record is reachable at all', () => {
  it('⭐ picks the record bound to the provider that verified THIS slip', () => {
    /* 🔴 THE BUG, AS A CASE. With the old `find`, `shared` comes first and wins,
       so `PAY_TOPUP_SLIPGUARD` could never be called however it was configured —
       no error, nothing in the dashboard, just a record that does nothing. */
    const eps = [shared, boundSlipguard];

    expect(findTopupEndpoint(eps, 'pay_topup', 'slipguard')).toBe(
      boundSlipguard,
    );
    // and the old behaviour, for contrast — this is what it used to return
    expect(legacyFindRole(eps, 'pay_topup')).toBe(shared);
  });

  it('finds it whatever the order of the array', () => {
    /* Selection is by VALUE now, so `endpoints[]` order stops carrying meaning.
       That is the half of the fix nobody would notice until it bit. */
    expect(
      findTopupEndpoint([boundSlipguard, shared], 'pay_topup', 'slipguard'),
    ).toBe(boundSlipguard);
  });

  it('matches case-insensitively, like the resolver does', () => {
    // A record saved as `SlipGuard` must still serve a row stamped `slipguard`.
    const odd = { ...boundSlipguard, slip_provider: '  SlipGuard ' };

    expect(findTopupEndpoint([shared, odd], 'pay_topup', 'SLIPGUARD')).toBe(
      odd,
    );
  });

  it('ignores a disabled record and falls back to the shared one', () => {
    // `status: false` on that record turns the split off for that vendor alone.
    const off = { ...boundSlipguard, status: false };

    expect(findTopupEndpoint([shared, off], 'pay_topup', 'slipguard')).toBe(
      shared,
    );
  });
});

describe('[TOPUPPERPROVIDER] 🔴 RULE B — Swiftcheck works with NOTHING configured', () => {
  it('⭐ [RULE B] with no record bound, returns exactly what the old lookup did', () => {
    /* Every tool in existence is this case. Identity against the legacy
       expression, so "nothing moved" is a measurement rather than a claim. */
    const eps = [shared, walletpay];

    for (const stamp of [
      'swiftcheck',
      '',
      '   ',
      null,
      undefined,
      'anything',
    ]) {
      expect(findTopupEndpoint(eps, 'pay_topup', stamp)).toBe(
        legacyFindRole(eps, 'pay_topup'),
      );
    }
  });

  it('⭐ [RULE B] a row stamped by another vendor still reaches the shared record', () => {
    /* A tool that never split its paths keeps serving every provider — which is
       what makes enabling a second provider safe for tools nobody reconfigured. */
    expect(findTopupEndpoint([shared], 'pay_topup', 'slipguard')).toBe(shared);
  });

  it('an unstamped row (written before the stamp existed) reaches the shared record', () => {
    expect(findTopupEndpoint([shared], 'pay_topup', undefined)).toBe(shared);
  });

  it('a record bound to a provider that never ran simply never matches', () => {
    /* No registry lookup is needed to honour "ignore a disabled provider": a
       provider that is not enabled cannot have stamped a row, so its record is
       unreachable by construction. */
    expect(
      findTopupEndpoint([shared, boundSlipguard], 'pay_topup', 'swiftcheck'),
    ).toBe(shared);
  });
});

describe('[TOPUPPERPROVIDER] the failure directions', () => {
  it('⭐ returns null when ONLY another vendor’s record exists', () => {
    /* Deliberate. The caller treats null as `no_topup_endpoint`: it releases the
       lock, the customer can resend, and the reason is recorded. The alternative
       — calling a path built for a different vendor — moves money through an
       endpoint nobody pointed at this slip. */
    expect(
      findTopupEndpoint([boundSlipguard], 'pay_topup', 'swiftcheck'),
    ).toBeNull();
  });

  it('returns null for an empty or missing list, as before', () => {
    expect(findTopupEndpoint([], 'pay_topup', 'swiftcheck')).toBeNull();
    expect(findTopupEndpoint(undefined, 'pay_topup', 'swiftcheck')).toBeNull();
  });

  it('never returns a record of a different role', () => {
    expect(
      findTopupEndpoint([walletpay], 'pay_topup', 'swiftcheck'),
    ).toBeNull();
  });
});

/* ==== THE OUTBOUND HALF — a field that cannot be SAVED is not a feature ======
   `normalizeEndpoints` rebuilds every record from a whitelist, so a field missing
   from that list is dropped on save while the API answers 200 and the record goes
   on serving everybody. That failure has happened in this repo before, on this
   exact class of field, and it is invisible from the selection cases above. */
describe('[TOPUPPERPROVIDER] ⭐ the value survives the save', () => {
  it('⭐ `normalizeEndpoints` keeps `slip_provider` — the whitelist knows it', () => {
    const [ep] = normalizeEndpoints([
      {
        key: 'PAY_TOPUP',
        path: 'x/y',
        role: 'pay_topup',
        slip_provider: 'slipguard',
      },
    ]);

    expect(ep?.slip_provider).toBe('slipguard');
  });

  it('normalises it the way the selection matches — trimmed and lower-cased', () => {
    // A record saved as `  SlipGuard ` must serve a row stamped `slipguard`, and the
    // cheapest place to guarantee that is on the way in.
    const [ep] = normalizeEndpoints([
      {
        key: 'PAY_TOPUP',
        path: 'x/y',
        role: 'pay_topup',
        slip_provider: '  SlipGuard ',
      },
    ]);

    expect(ep?.slip_provider).toBe('slipguard');
  });

  it("⭐ [RULE B] a record that says nothing normalises to `''`, not undefined", () => {
    /* `''` is the "serves every provider" state, and it must be what an
       untouched record produces — `undefined` would work today by accident and
       break the moment anything compares the value rather than its truthiness. */
    const [ep] = normalizeEndpoints([
      { key: 'PAY_TOPUP', path: 'x/y', role: 'pay_topup' },
    ]);

    expect(ep?.slip_provider).toBe('');
    // and the selection still treats it as the shared record
    expect(findTopupEndpoint([ep!], 'pay_topup', 'slipguard')).toBe(ep);
  });
});

describe('[TOPUPPERPROVIDER] 🔴 walletpay is NOT split — owner’s decision, not an omission', () => {
  it('the walletpay leg is untouched by this: its body is built from the shared envelope', () => {
    /* Asserted as behaviour rather than left as a comment: if somebody routes
       `pay_walletpay` through here "for symmetry", a bound record would start
       selecting for it and this case says that was a decision, not a gap.
       The helper works for any role by construction — the point is that the
       walletpay CALL SITE does not use it, and the shared record is what a walletpay
       lookup must keep returning. */
    const eps = [
      walletpay,
      {
        ...walletpay,
        key: 'PAY_WALLETPAY_SLIPGUARD',
        slip_provider: 'slipguard',
      },
    ];

    expect(legacyFindRole(eps, 'pay_walletpay')).toBe(walletpay);
  });
});
