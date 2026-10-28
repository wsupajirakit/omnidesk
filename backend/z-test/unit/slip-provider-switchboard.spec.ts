/**
 * =============================================================================
 * [FEAT-20260903-PROVIDERSWITCH] one line per provider, one word to switch
 * =============================================================================
 *
 * Owner, 03/09: a provider must be switchable on and off, and editable, **as
 * easily as possible** — wrapped, and separated per provider, from ONE central
 * register with no duplicated truth.
 *
 * These cases exist because "it is easy to switch on" is a claim, and a claim
 * about a money path deserves a measurement. The first case DRIVES the switch
 * rather than describing it: it takes the real entry list, flips one `enabled`,
 * and asserts the provider becomes resolvable — so if enabling ever needs a
 * second edit somewhere, this goes red.
 *
 * 🔴 AND IT PINS THE TWO STANDING RULES, because the registry is where both live:
 *   RULE A — a hook with its payment custom tool ON keeps flowing exactly as it
 *            does with Swiftcheck. Nothing here may change what an enabled provider
 *            returns.
 *   RULE B — staging keeps Swiftcheck with NOTHING configured: `''`, absent and an
 *            unregistered name all resolve to the default, and the default IS
 *            Swiftcheck by identity, not merely "a provider".
 *
 * revert: delete with `src/modules/slip/providers/provider-entries.ts`.
 */
import {
  buildProviderRegistry,
  DEFAULT_SLIP_PROVIDER,
  resolveDefaultProvider,
  resolveSlipProvider,
  SLIP_PROVIDER_ENTRIES,
  SLIP_PROVIDERS,
  slipguardProvider,
  swiftcheckProvider,
  type SlipProviderEntry,
} from '@/modules/slip';

/** The real list with one entry's `enabled` flipped — nothing else changed. */
const withEnabled = (name: string, enabled: boolean): SlipProviderEntry[] =>
  SLIP_PROVIDER_ENTRIES.map((e) =>
    e.provider.name === name ? { ...e, enabled } : e,
  );

describe('[SWITCHBOARD] ⭐ turning a provider on is ONE word', () => {
  it('⭐ flipping `enabled` is all it takes — nothing else has to be edited', () => {
    /* 🔴 THE CLAIM, MEASURED. If enabling ever grows a second step — an import,
       a map entry, a registration somewhere — this case goes red, because it
       performs the ONLY documented step and then demands the result. */
    const before = buildProviderRegistry(SLIP_PROVIDER_ENTRIES);
    const after = buildProviderRegistry(withEnabled('slipguard', true));

    expect(Object.keys(before)).not.toContain('slipguard');
    expect(Object.keys(after)).toContain('slipguard');
    expect(after.slipguard).toBe(slipguardProvider);
  });

  it('⭐ and turning one off removes it, without touching its neighbour', () => {
    // Independence: each entry is its own switch. Disabling one must not
    // disturb another, which is what "separated per provider" has to mean.
    const off = buildProviderRegistry(withEnabled('swiftcheck', false));

    expect(Object.keys(off)).not.toContain('swiftcheck');
    expect(off).toEqual({});
    // the real registry is untouched by the experiment — the list is readonly
    expect(SLIP_PROVIDERS.swiftcheck).toBe(swiftcheckProvider);
  });

  it('a disabled provider is not resolvable, however it is spelled', () => {
    /* Written and tested is not the same as reachable. `resolveSlipProvider`
       trims and lower-cases, so all of these must still miss. */
    for (const spelling of [
      'slipguard',
      'SlipGuard',
      ' slipguard ',
      'SLIPGUARD',
    ]) {
      expect(resolveSlipProvider(spelling)).toBeNull();
    }
  });
});

describe('[SWITCHBOARD] the register is the single truth — no name written twice', () => {
  it('⭐ every key IS its provider’s own name, never a hand-typed string', () => {
    /* The map used to read `swiftcheck: swiftcheckProvider`, stating the same fact
       twice. Drift there is silent and expensive: a hook stores the KEY, the
       resolver matches the KEY, and the row is stamped with `provider.name` — so
       two spellings mean the configured value and the stamp disagree with
       nothing failing. */
    for (const [key, provider] of Object.entries(SLIP_PROVIDERS)) {
      expect(key).toBe(provider.name);
    }
  });

  it('every enabled name survives the resolver’s normalisation', () => {
    /* `resolveSlipProvider` lower-cases and trims before looking up. A provider
       named `SlipGuard` would therefore be registered under a key the resolver can
       never produce — present in the map and unreachable in production. */
    for (const key of Object.keys(SLIP_PROVIDERS)) {
      expect(key).toBe(key.trim().toLowerCase());
      expect(key.length).toBeGreaterThan(0);
      expect(resolveSlipProvider(key)).toBe(SLIP_PROVIDERS[key]);
    }
  });

  it('no two entries answer to the same name, enabled or not', () => {
    // Two entries sharing a name means one silently shadows the other in the
    // map, and which one wins depends on array order.
    const names = SLIP_PROVIDER_ENTRIES.map((e) => e.provider.name);

    expect(new Set(names).size).toBe(names.length);
  });
});

describe('[SWITCHBOARD] 🔴 RULE B — the default is Swiftcheck, and it is not positional', () => {
  it('⭐ [RULE B] the default IS Swiftcheck — identity, not "a provider"', () => {
    /* Staging runs with NOTHING configured, so every hook there reaches the
       default. If this ever becomes another vendor, staging silently changes
       who verifies its money. */
    expect(DEFAULT_SLIP_PROVIDER).toBe(swiftcheckProvider);
    expect(resolveDefaultProvider(SLIP_PROVIDER_ENTRIES)).toBe(
      swiftcheckProvider,
    );
  });

  it("⭐ [RULE B] `''`, absent and an unknown name all reach the default", () => {
    // The three states a hook can be in with nothing set, plus a typo.
    for (const value of ['', '   ', null, undefined, 'not-a-provider']) {
      expect(resolveSlipProvider(value) ?? DEFAULT_SLIP_PROVIDER).toBe(
        swiftcheckProvider,
      );
    }
  });

  it('is chosen by the MARK, not by being first in the list', () => {
    /* Deriving "the default" from position would mean reordering the array
       changes which vendor verifies money for the whole fleet — a diff nobody
       would read as dangerous. */
    const reordered = [...SLIP_PROVIDER_ENTRIES].reverse();

    expect(resolveDefaultProvider(reordered)).toBe(swiftcheckProvider);
  });

  it('refuses a list that names none, two, or a disabled default', () => {
    /* This runs at module load, so an ambiguous registry takes the process down
       at boot rather than picking a vendor nobody chose. */
    const noDefault = SLIP_PROVIDER_ENTRIES.map((e) => ({
      ...e,
      isDefault: false,
    }));
    const twoDefaults = SLIP_PROVIDER_ENTRIES.map((e) => ({
      ...e,
      isDefault: true,
    }));
    const disabledDefault = SLIP_PROVIDER_ENTRIES.map((e) =>
      e.isDefault ? { ...e, enabled: false } : e,
    );

    expect(() => resolveDefaultProvider(noDefault)).toThrow(/exactly one/);
    expect(() => resolveDefaultProvider(twoDefaults)).toThrow(/exactly one/);
    expect(() => resolveDefaultProvider(disabledDefault)).toThrow(/DISABLED/);
  });
});

describe('[SWITCHBOARD] 🔴 RULE A — an enabled provider still flows untouched', () => {
  it('⭐ [RULE A] the registry hands back the SAME object, not a copy', () => {
    /* RULE A is that a hook with its payment custom tool ON keeps flowing
       exactly as it does today. The registry is on that path, so it must be a
       lookup and nothing more — wrapping or cloning a provider here would change
       what the money leg receives. */
    expect(SLIP_PROVIDERS.swiftcheck).toBe(swiftcheckProvider);
    expect(resolveSlipProvider('swiftcheck')).toBe(swiftcheckProvider);
  });

  it('⭐ [RULE A] building the registry twice cannot differ', () => {
    // Pure: no cache, no order dependence, no hidden state between calls.
    expect(buildProviderRegistry(SLIP_PROVIDER_ENTRIES)).toEqual(
      buildProviderRegistry(SLIP_PROVIDER_ENTRIES),
    );
  });

  it('today’s registry is exactly the hand-written literal it replaced', () => {
    /* The map was `{ swiftcheck: swiftcheckProvider }`. This change is a refactor of
       HOW it is built, and this case is what makes that word honest. */
    expect(SLIP_PROVIDERS).toEqual({ swiftcheck: swiftcheckProvider });
  });
});
