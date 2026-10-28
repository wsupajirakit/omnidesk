/**
 * =============================================================================
 * [FEAT-20260903-BASEURLPERPROVIDER] no provider may inherit another's host
 * =============================================================================
 *
 * THE BUG THIS MAKES IMPOSSIBLE. `slip-flow.service.ts` answered
 *
 *     this.integration.swiftcheckApiBaseUrl || provider.defaultBaseUrl
 *
 * — one Swiftcheck-named env, applied to EVERY provider. On any deployment that
 * sets `SWIFTCHECK_API_BASE_URL`, a second provider would have had its own path
 * appended to **Swiftcheck's host**: the customer's slip image and that vendor's
 * API key posted to the wrong company. Nothing errors — the URL still parses, so
 * it fails at the far end and is recorded as an outage.
 *
 * Measured 03/09: the var is set in neither `.env.local` nor `.env.example`, so
 * the bug was ARMED rather than firing. The first case below is the one that
 * would have caught it, and it is written so it stays meaningful when a second
 * provider is registered: the host each provider resolves to must CONTAIN that
 * provider's own default, derived from the live registry rather than listed here.
 *
 * ⚠️ Two of the providers here are fakes, because the property under test is
 * "a provider that is NOT Swiftcheck does not get Swiftcheck's override" and Swiftcheck is
 * the only registered one today. The last describe drives the real registry, so
 * the invariant is asserted against what actually ships.
 *
 * revert: delete with `src/modules/slip/providers/base-url.ts`.
 */
import {
  resolveBaseUrl,
  SLIP_PROVIDERS,
  swiftcheckProvider,
  type SlipProvider,
} from '@/modules/slip';

const OVERRIDE = 'https://staging.swiftcheck.example';

/** A provider that declares NO override — the normal case for a new vendor. */
const noOverrideProvider = {
  ...swiftcheckProvider,
  name: 'slipguard-shaped-fake',
  defaultBaseUrl: 'https://api.slipguard.example',
  baseUrlConfigKey: undefined,
} as SlipProvider;

describe('[BASEURL] ⭐ an override reaches only the provider that named it', () => {
  it('⭐ a provider that declares no override keeps its OWN host, even when the env is set', () => {
    /* 🔴 THE WHOLE POINT. With the old expression this returned Swiftcheck's host,
       and the vendor's path was then appended to it — a real slip image and a
       real API key sent to the wrong company, with no error anywhere because the
       URL is still syntactically valid. */
    expect(
      resolveBaseUrl(noOverrideProvider, { swiftcheckApiBaseUrl: OVERRIDE }),
    ).toBe('https://api.slipguard.example');
  });

  it('the provider that DID name it still gets it — Swiftcheck is unchanged', () => {
    // The behaviour that must not move: same field read, same precedence.
    expect(
      resolveBaseUrl(swiftcheckProvider, { swiftcheckApiBaseUrl: OVERRIDE }),
    ).toBe(OVERRIDE);
  });

  it('falls back to the provider default when the override is absent', () => {
    // Today's actual state — the var is set nowhere, so this is the live path.
    expect(resolveBaseUrl(swiftcheckProvider, {})).toBe(
      swiftcheckProvider.defaultBaseUrl,
    );
    expect(
      resolveBaseUrl(swiftcheckProvider, { swiftcheckApiBaseUrl: undefined }),
    ).toBe(swiftcheckProvider.defaultBaseUrl);
  });

  it('treats a blank or whitespace override as absent', () => {
    /* `SWIFTCHECK_API_BASE_URL=` in a compose file is the same intent as not
       setting it. Letting it through would build a request against a path with
       no host at all, which fails in a way nothing would connect back to config. */
    for (const blank of ['', '   ', '\t\n']) {
      expect(
        resolveBaseUrl(swiftcheckProvider, { swiftcheckApiBaseUrl: blank }),
      ).toBe(swiftcheckProvider.defaultBaseUrl);
    }
  });

  it('trims a padded override rather than building a URL with a space in it', () => {
    expect(
      resolveBaseUrl(swiftcheckProvider, {
        swiftcheckApiBaseUrl: `  ${OVERRIDE}  `,
      }),
    ).toBe(OVERRIDE);
  });
});

/* ==== [FIX-20260903-HOSTNOTAFIELD] the host is NOT hook data =================
   This block used to prove the opposite: `[FEAT-20260903-HOSTPERHOOK]`, a
   third argument carrying the hook's own host, with cases for a bad value, a
   trailing slash and a padded string. It existed for a few hours. The host had
   been read from a Swiftcheck-named env, the owner ruled env out, and "per hook"
   was the first place to put it instead; then the owner saw the form and ruled
   again — an operator must not TYPE a host and it does not belong in the
   database. So the parameter is gone, and with it the field on the schema, the
   update whitelist, the tab map, the form input, the types and two i18n keys.

   🔴 THE CASES ARE NOT SIMPLY DELETED. A removed capability that leaves no test
   behind is indistinguishable from one that was never built, and the next reader
   would re-add the parameter believing it was an oversight. What replaces them
   asserts that the signature ITSELF refuses a third argument, so re-adding the
   layer means deliberately editing this file too.
   ⇒ ลบความสามารถต้องเหลือหลักฐานว่าตั้งใจลบ ไม่ใช่ลืม */
describe('[BASEURL] ⭐ the host comes from the provider, never from a hook', () => {
  it('⭐ [RULE B] nothing configured = the provider’s own host, byte for byte', () => {
    /* RULE B in one line, and now true by construction rather than by everyone
       leaving the field blank: there is no longer a value a hook could hold that
       would change this. */
    expect(resolveBaseUrl(swiftcheckProvider, {})).toBe(
      swiftcheckProvider.defaultBaseUrl,
    );
    expect(resolveBaseUrl(noOverrideProvider, {})).toBe(
      noOverrideProvider.defaultBaseUrl,
    );
  });

  it('⭐ takes exactly two arguments — a per-hook host cannot be passed in', () => {
    /* `Function.length` counts declared parameters before any default. A third
       one reappearing turns this red immediately, which is the point: the removal
       was a decision and the next change to it should be one too. */
    expect(resolveBaseUrl.length).toBe(2);
  });

  it('⭐ a hook carrying a host-shaped value cannot reach the resolver', () => {
    /* The flow calls `baseUrlFor(provider)` with no hook at all now. This pins
       the consequence at the resolver: even handed a third argument by a caller
       written against the old signature, the answer does not move. */
    /* [MERGE-20260904-LOOSECAST] A plain annotation, not `as unknown as`. The
       double cast was the ONE new lint error this lane brought into `dev`
       (`no-unnecessary-type-assertion`): a two-parameter function already IS
       assignable to a signature whose third parameter is optional, so the cast
       asserted nothing. The annotation states the same intent and compiles to
       the same call. */
    const asLoose: (
      p: typeof swiftcheckProvider,
      c: Record<string, string | undefined>,
      extra?: unknown,
    ) => string = resolveBaseUrl;
    expect(asLoose(swiftcheckProvider, {}, 'https://slip.mine.example')).toBe(
      swiftcheckProvider.defaultBaseUrl,
    );
  });
});

describe('[BASEURL] the REGISTRY is the single source of truth for hosts', () => {
  it('⭐ every registered provider resolves to ITS OWN host, with the env set', () => {
    /* Derived from the live registry, so a provider registered tomorrow is
       covered without editing this case — and if it ever inherits another
       vendor's host, this is what goes red. */
    const wrong = Object.entries(SLIP_PROVIDERS)
      .filter(([, p]) => {
        const resolved = resolveBaseUrl(p, { swiftcheckApiBaseUrl: OVERRIDE });
        // its own default, or the override IT named — never another's
        return resolved !== p.defaultBaseUrl && !p.baseUrlConfigKey;
      })
      .map(([name]) => name);

    expect(wrong).toEqual([]);
  });

  it('every declared override key is one the config actually has', () => {
    /* The key is typed as a union in the port, so this cannot drift silently —
       but the union is only as honest as the config it mirrors. Asserting the
       name here means a rename in `app.config.ts` is caught by a test rather
       than by a provider quietly falling back to its default in production. */
    const declared = Object.values(SLIP_PROVIDERS)
      .map((p) => p.baseUrlConfigKey)
      .filter((k): k is NonNullable<typeof k> => !!k);

    for (const key of declared) {
      expect(['swiftcheckApiBaseUrl']).toContain(key);
    }
  });

  it('no provider declares another provider’s host as its own default', () => {
    // Two providers sharing a default would mean one of them is misconfigured
    // in exactly the way that produces a request to the wrong company.
    const defaults = Object.values(SLIP_PROVIDERS).map((p) => p.defaultBaseUrl);

    expect(new Set(defaults).size).toBe(defaults.length);
  });
});
