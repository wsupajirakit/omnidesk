/**
 * [FIX-20260818-PROBESSRF] The operator probe cannot reach a private address.
 * audit_18_aug H14.
 *
 * ## What it is
 * `POST /config/test-custom` takes a caller-supplied url, method, headers and
 * body, fires at it, and returns the peer's status, statusText, EVERY response
 * header and the FULL body. That is a read SSRF, not a blind one: whatever the
 * target answers comes back to the caller verbatim.
 *
 * The route is superadmin-only (`ensureSuperRole`), which is narrower than the
 * audit implies and is why it is not critical. It still matters: cloud metadata,
 * anything on loopback, and every service on the internal network are one
 * request away, and the answer is handed over rather than merely triggered.
 *
 * ## The fix reuses the only SSRF guard in the repo
 * `assertPublicUrl` was hardened earlier today for IPv6 bracket forms and the
 * link-local, unique-local and carrier-grade-NAT ranges the original list never
 * covered. Writing a second guard here would mean two of them drifting apart,
 * which is the failure this codebase has repeatedly been bitten by.
 *
 * ## Why it MOVED to common/utils rather than being exported where it was
 * It lived in `modules/external`, and `external` already imports `@/modules/system`
 * in four places (external.module, custom-tool.service, external-api.service,
 * hook-outbound.service). Importing it the other way would have closed a module
 * cycle. `src/common/utils/` is where this species of helper already lives —
 * `escape-regex`, `header-safe-token`, `hmac-signer`, `mask-creds` — and nothing
 * in `common` may depend on a feature module, so the direction is right.
 *
 * One definition, two callers. Nothing is duplicated and nothing new is invented.
 */

import { assertPublicUrl } from '@/common/utils/assert-public-url';
// Deep import: the probe service is not on the system barrel, and adding it
// there for a test would be a wiring decision rather than a test detail.
// eslint-disable-next-line no-restricted-imports
import { ExternalProbeService } from '@/modules/system/external-probe.service';

/** Every shape the guard must refuse, including the ones added today. */
const PRIVATE_TARGETS = [
  'http://169.254.169.254/latest/meta-data/', // cloud metadata
  'http://127.0.0.1:27017/', // the database, from inside
  'http://localhost:6379/', // redis
  'http://10.0.0.5/internal',
  'http://192.168.1.10/admin',
  'http://[::1]/', // IPv6 loopback — the bracket form fixed today
  'http://[::ffff:127.0.0.1]/', // IPv4 inside an IPv6 literal
];

const PUBLIC_TARGET = 'https://api.example.com/shop-api/v1/site-rules';

describe('[PROBESSRF] the guard itself still recognises these', () => {
  // Not the fix — a PIN that the shared guard covers what this route needs
  // before it is wired in. If these ever stop throwing, the wiring below is
  // guarding nothing.
  it.each(PRIVATE_TARGETS)('refuses %s', (url) => {
    // Assert the guard's OWN message, not merely "something threw". A bare
    // toThrow() passes when the import is undefined and the call is a TypeError
    // — which is exactly how these first went green while proving nothing.
    expect(() => assertPublicUrl(url)).toThrow(/private\/loopback/);
  });

  it('allows a real customer endpoint', () => {
    expect(() => assertPublicUrl(PUBLIC_TARGET)).not.toThrow();
  });
});

describe('[PROBESSRF] POST /config/test-custom refuses before it sends', () => {
  function makeService(): {
    svc: ExternalProbeService;
    sent: string[];
  } {
    const sent: string[] = [];
    const svc = Object.create(
      ExternalProbeService.prototype,
    ) as ExternalProbeService;
    Object.assign(svc, {
      configService: {},
      // Stand in for the outbound call so nothing leaves this process. If the
      // guard works, this is never reached at all.
      send: (url: string) => {
        sent.push(url);
        return Promise.resolve({
          response: { status: 200, statusText: 'OK', headers: {}, body: 'x' },
          error: null,
        });
      },
    });
    return { svc, sent };
  }

  it.each(PRIVATE_TARGETS)('⭐ %s never reaches the network', async (url) => {
    const { svc, sent } = makeService();

    await expect(svc.testCustomRequest({ url })).rejects.toThrow();
    // The refusal must happen BEFORE the request — a guard that runs after the
    // fetch has already leaked whatever the target answered.
    expect(sent).toHaveLength(0);
  });

  it('a public URL still goes through — the button keeps working', async () => {
    const { svc, sent } = makeService();

    const result = await svc.testCustomRequest({
      url: PUBLIC_TARGET,
      method: 'GET',
    });

    expect(sent).toEqual([PUBLIC_TARGET]);
    expect(result.response?.status).toBe(200);
  });

  it('a missing url still reports the original error, unchanged', async () => {
    // `assertPublicUrl` returns early on a falsy value, so the existing
    // "url is required" answer must survive rather than becoming an SSRF error.
    const { svc } = makeService();

    await expect(svc.testCustomRequest({} as never)).rejects.toThrow(
      /url is required/,
    );
  });
});
