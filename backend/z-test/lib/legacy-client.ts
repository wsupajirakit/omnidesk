/**
 * Thin client for talking to both backends side by side.
 *
 * Golden tests call the same path on the legacy service and on this one, then
 * compare. Point them at local instances:
 *
 *   LEGACY_BASE_URL=http://localhost:10000 \
 *   CANDIDATE_BASE_URL=http://localhost:3100 \
 *   pnpm test:golden
 *
 * When LEGACY_BASE_URL is unset the golden suite skips instead of failing, so a
 * normal `pnpm verify` does not require the old backend to be running.
 */

export interface ApiResponse {
  status: number;
  body: unknown;
  contentType: string | null;
}

export const legacyBaseUrl = process.env['LEGACY_BASE_URL'];
export const candidateBaseUrl =
  process.env['CANDIDATE_BASE_URL'] ?? 'http://localhost:3100';

/** True when both backends are configured, so golden comparisons can run. */
export const canCompare = Boolean(legacyBaseUrl);

/**
 * Both backends rate limit login per client IP, and the whole suite
 * authenticates as one account. Run together, the cases exhaust a single window
 * and the later ones get 429 — which surfaces as a parity failure that moves
 * around depending on test order.
 *
 * Giving each request its own address isolates the buckets while leaving the
 * limiter switched on, so the suite still exercises the protection instead of
 * working around it. `cf-connecting-ip` is the header both services read first.
 *
 * Documentation range (TEST-NET-3), so these can never collide with a real
 * client address.
 */
let requestCounter = 0;
const nextClientIp = (): string => {
  requestCounter += 1;
  const octet = 1 + (requestCounter % 250);
  return `203.0.113.${octet}`;
};

export async function call(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse> {
  const headers = new Headers(init.headers);
  if (!headers.has('cf-connecting-ip')) {
    headers.set('cf-connecting-ip', nextClientIp());
  }

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const contentType = response.headers.get('content-type');
  const raw = await response.text();

  let body: unknown = raw;
  if (contentType?.includes('application/json')) {
    try {
      body = JSON.parse(raw);
    } catch {
      // Leave the raw text — a JSON content-type with an unparsable body is
      // itself a finding worth surfacing in the diff.
    }
  }

  return { status: response.status, body, contentType };
}

/** Issues the same request to both backends. */
export async function callBoth(
  path: string,
  init: RequestInit = {},
  options: { expect401?: boolean } = {},
): Promise<{ legacy: ApiResponse; candidate: ApiResponse }> {
  if (!legacyBaseUrl) throw new Error('LEGACY_BASE_URL is not set');

  const [legacy, candidate] = await Promise.all([
    call(legacyBaseUrl, path, init),
    call(candidateBaseUrl, path, init),
  ]);

  // `expect401` is for the handful of cases whose whole point is that both
  // backends reject — the login-with-wrong-password and the no-token sweep.
  // Without the opt-out the guard fires on exactly the cases it should not.
  if (!options.expect401) assertNotBothUnauthorised(legacy, candidate, path);
  return { legacy, candidate };
}

/**
 * Refuses to report a 401/401 pair as agreement.
 *
 * The two backends share one session store and enforce one session per user, so
 * any other process logging in as the same account revokes this suite's token
 * mid-run. Both services then answer `401 {"error":"invalid or expired token"}`
 * — **byte-identical**, which satisfies every assertion a parity case makes:
 * same status, `diffKeys` empty, `diffContractValues` empty.
 *
 * An audit counted **201 of 258** authenticated cases with no independent pin on
 * the status, so all 201 pass on a revoked token. The revocation is not rare —
 * it happens whenever a second agent runs against this pair. When it lands
 * *before* login the suite fails loudly with 100+ `authToken undefined`; when it
 * lands *after*, the suite goes green having compared nothing. Same event,
 * opposite visibility, and only one of the two is survivable.
 *
 * The security cases are the worst of them: "never leaks a secret" is trivially
 * satisfied by a 401 body, so the assertions that exist to catch a leak are the
 * ones a revoked token silences most completely.
 *
 * This lives in `callBoth` rather than in each spec because a guard every author
 * has to remember is a guard that will be missed — one spec already had it and
 * fifteen did not.
 */
export function assertNotBothUnauthorised(
  legacy: ApiResponse,
  candidate: ApiResponse,
  path: string,
): void {
  if (legacy.status === 401 && candidate.status === 401) {
    throw new Error(
      `both backends answered 401 for ${path} — the shared token was revoked ` +
        `(another session logged in as the same account). Re-run; this is not a ` +
        `parity result.`,
    );
  }
}
