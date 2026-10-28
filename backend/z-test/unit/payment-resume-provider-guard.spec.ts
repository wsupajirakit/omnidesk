/**
 * =============================================================================
 * [FEAT-20260903-RESUMEPROVIDERGUARD] did the provider change while a retry paused?
 * =============================================================================
 *
 * A `[ลองใหม่]` retry re-enters the topup leg with a slip that was verified
 * EARLIER. If the hook's provider changed while the run sat paused, the stored
 * envelope is provider A's dialect and the leg would send it with provider B's
 * tool. Owner's decision, 02/09: REVIEW, not proceed.
 *
 * 🔴 THE ORDER OF THESE CASES IS THE SPEC'S, NOT A PREFERENCE. §9.2:
 *
 *   "The test that matters is not 'the comparator works'. It is: a hook that has
 *    NEVER set `slip_provider`, holding both stamped and unstamped slips, resumes
 *    successfully. Write that one BEFORE the mismatch case — it is the state the
 *    whole fleet is in."
 *
 * So the fleet's state is first, and it is asserted against the REAL resolver.
 * The mismatch case comes second and needs an injected one, because with a single
 * provider enabled every value — `''`, `'swiftcheck'`, a typo, a name nobody has
 * registered — resolves to the same implementation, so `!==` cannot be true. A
 * branch that cannot be made true is not covered by claiming it is.
 *
 * revert: delete with `src/modules/payment/payment-provider-guard.ts`.
 */
import {
  providerChangedSinceVerification,
  resolveForCompare,
  type ProviderRef,
} from '@/modules/payment';
import { DEFAULT_SLIP_PROVIDER, swiftcheckProvider } from '@/modules/slip';

describe('[RESUMEGUARD] ⭐ RULE B FIRST — the fleet resumes, because the fleet is unconfigured', () => {
  it('⭐ [RULE B] a hook that never set a provider: UNSTAMPED slip resumes', () => {
    /* Every slip verified before stamping shipped has `slip_provider` absent.
       Compared as a value it never equals anything, so a naive comparator would
       dead-end EVERY paused retry on every existing row. Absent means "no
       opinion". */
    for (const stamp of [undefined, null, '', '   ']) {
      expect(providerChangedSinceVerification(stamp, '')).toBe(false);
    }
  });

  it('⭐ [RULE B] a hook that never set a provider: STAMPED slip resumes too', () => {
    /* The other half of the same fleet. The stamp holds the RESOLVED name
       (`'swiftcheck'`) while the hook holds `''` — the raw strings differ, and a
       string comparison would refuse every retry on a staging that verifies
       perfectly. `''` resolves to Swiftcheck, so the identities match. */
    expect(providerChangedSinceVerification('swiftcheck', '')).toBe(false);
    expect(providerChangedSinceVerification('swiftcheck', undefined)).toBe(
      false,
    );
    expect(providerChangedSinceVerification('swiftcheck', '   ')).toBe(false);
  });

  it("⭐ `''` really does mean Swiftcheck — the assumption the two cases above rest on", () => {
    // Asserted rather than assumed, because everything here depends on it.
    expect(resolveForCompare('')).toBe(swiftcheckProvider);
    expect(resolveForCompare(undefined)).toBe(DEFAULT_SLIP_PROVIDER);
    expect(resolveForCompare('swiftcheck')).toBe(swiftcheckProvider);
  });

  it('a typo, or a name nobody registered, is still the same provider', () => {
    /* `resolveSlipProvider` returns null for an unrecognised name and the caller
       falls back to the default — so a hook holding a typo is on Swiftcheck, and a
       slip stamped `'swiftcheck'` must resume against it. */
    expect(providerChangedSinceVerification('swiftcheck', 'slipguard')).toBe(
      false,
    );
    expect(providerChangedSinceVerification('swiftcheck', 'SwIfTcHeCk')).toBe(
      false,
    );
    expect(providerChangedSinceVerification('swiftcheck', 'not-a-vendor')).toBe(
      false,
    );
  });

  it('a non-string stamp is treated as no stamp, not as a value', () => {
    // A corrupt row must resume, not dead-end.
    for (const junk of [0, 1, {}, [], true]) {
      expect(providerChangedSinceVerification(junk, '')).toBe(false);
    }
  });
});

describe('[RESUMEGUARD] ⭐ the OTHER side of the switch, driven with two providers', () => {
  /* 🔴 WHY AN INJECTED RESOLVER. With one provider enabled, every value resolves
     to the same object, so the mismatch branch cannot be made true — not in
     production and not in a test. Shipping it that way would be exactly what the
     registry's tripwire warns about: a guard nobody can prove works, discovered
     on the day something is already wrong. This drives the real function with a
     two-provider registry so both branches have run. */
  const A = { name: 'swiftcheck' } as unknown as ProviderRef;
  const B = { name: 'slipguard' } as unknown as ProviderRef;
  const twoProviders = (name: unknown): ProviderRef =>
    (typeof name === 'string' ? name : '').trim().toLowerCase() === 'slipguard'
      ? B
      : A;

  it('⭐ a real change between two REGISTERED providers is a mismatch', () => {
    expect(
      providerChangedSinceVerification('swiftcheck', 'slipguard', twoProviders),
    ).toBe(true);
    expect(
      providerChangedSinceVerification('slipguard', 'swiftcheck', twoProviders),
    ).toBe(true);
  });

  it('⭐ [RULE B] and an UNSTAMPED slip still resumes, even with two providers', () => {
    /* The most dangerous version of failure mode 1: with a second provider
       enabled, resolving an absent stamp would turn it into the DEFAULT and
       compare it against a hook on the other provider — a mismatch, on every row
       written before stamping shipped. The early return is what stops that, and
       this is the case that would catch its removal. */
    for (const stamp of [undefined, null, '', '  ']) {
      expect(
        providerChangedSinceVerification(stamp, 'slipguard', twoProviders),
      ).toBe(false);
    }
  });

  it('the same provider spelled differently is NOT a mismatch', () => {
    // Identity, not string equality — `''` on the hook means the default.
    expect(
      providerChangedSinceVerification('swiftcheck', '', twoProviders),
    ).toBe(false);
    expect(
      providerChangedSinceVerification(
        'slipguard',
        '  SlipGuard ',
        twoProviders,
      ),
    ).toBe(false);
  });

  it('compares IDENTITY — two objects that look alike are still different', () => {
    /* The whole point of resolving: the comparison must be about which
       implementation runs, not about which words were stored. */
    const lookalike = (name: unknown): ProviderRef =>
      typeof name === 'string' && name === 'swiftcheck'
        ? { name: 'swiftcheck' }
        : { name: 'swiftcheck' };

    expect(
      providerChangedSinceVerification('swiftcheck', 'swiftcheck', lookalike),
    ).toBe(true);
  });
});
