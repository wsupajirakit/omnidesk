import { timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/**
 * [FEAT-20260813-PROXYGATE] Inner gate of the BE lockdown (docs/migrate-stack.md).
 *
 * Outer layer: the Traefik dynamic file `zz-omnidesk-routing.yaml` stamps
 * `X-Internal-Secret` onto every request that enters through the FE-origin
 * route, and the public BE domain only exposes the external allowlist. This
 * middleware is the INNER layer: it re-checks that stamp so a request that
 * reaches the container WITHOUT passing the front proxy (a docker-network
 * neighbour, a future accidental port exposure) is refused — fail-closed.
 *
 * **DEFAULT OFF (seamless / zero impact).** While `INTERNAL_PROXY_SECRET` is
 * unset/empty this middleware is a bare `next()` — behaviour is byte-identical
 * to today. Turning it off never requires a code change: unset the env and
 * restart. ปิด = ลบ env ตัวเดียว ไม่ต้องแตะโค้ด.
 *
 * Public paths = external callers that never travel the FE-origin route.
 * The list MUST stay in sync with the Traefik `omnidesk-be-allow` router rule
 * (see docs/migrate-stack.md §3 — the two layers describe the same contract):
 *   - LINE webhook        `/webhook` · `/:alias/webhook`   (HMAC-gated)
 *   - Telegram webhook    `/api/telegram/webhook`          (secret checked in service)
 *   - handoff callback    `/api/handoff/callback/...`      (per-target inbound auth;
 *                                                          trailing `/` required so the
 *                                                          `callbacks` inbox stays private)
 *   - customer landing    `/customer-link/...`             (its own token flow)
 *   - health probes       `/health` · `/health/ready`
 * Static media (`/uploads/*`, `/bank-logos/*`) is mounted BEFORE this
 * middleware in main.ts (LINE/Telegram fetch those), so it is public by
 * position — deliberately absent from this list.
 *
 * Note: `/webhook/logs` (dashboard log API) is NOT public here — the regex
 * matches only `/webhook` and `/<alias>/webhook`, unlike the looser rate-limit
 * bypass. Dashboard traffic arrives stamped through the FE-origin route.
 *
 * DB-EFFECT: none — pure request filtering; nothing is written anywhere.
 *
 * revert: delete this folder + the `app.use(...)` line in main.ts (same marker)
 *         + the `INTERNAL_PROXY_SECRET` entries in env.schema.ts/app.config.ts.
 */

/** Paths reachable WITHOUT the proxy stamp — exported for the unit test. */
export function isPublicPath(path: string): boolean {
  return (
    // LINE: `/webhook` and `/<alias>/webhook`; trailing slash kept because
    // Express lenient routing accepts it today (parity, ห้ามพัง).
    /^\/(?:[^/]+\/)?webhook\/?$/.test(path) ||
    /^\/api\/telegram\/webhook\/?$/.test(path) ||
    // Handoff INBOUND callback only — the external target posts here (HMAC-gated
    // in the controller). The `/` after `callback` is REQUIRED so this does NOT
    // over-match the dashboard inbox `/api/handoff/callbacks` (list/attach/
    // dismiss, `handoff.manage` JWT). callbacks was leaking through the old
    // `startsWith('/api/handoff/callback')` prefix; the dashboard reaches the
    // inbox via the stamped FE-origin route, so it needs no public allowance.
    // [FEAT-20260813-PROXYGATE] tightened 2026-08-13 — handoff not yet in use.
    /^\/api\/handoff\/callback\//.test(path) ||
    path.startsWith('/customer-link') ||
    // Static media prefixes. REAL files are already served BEFORE this gate by
    // the mounts in main.ts (position), so these two rules only affect MISSING
    // files: without them a broken media link would fall through express.static
    // into the gate and turn the legacy 404 into a 403 (caught in live local
    // verify 2026-08-13). Public by rule keeps exact 404 parity.
    path.startsWith('/uploads') ||
    path.startsWith('/bank-logos') ||
    /^\/health(?:\/|$)/.test(path)
  );
}

/**
 * Constant-time stamp comparison. Length is checked first because
 * `timingSafeEqual` throws on unequal buffer lengths; the length itself is not
 * secret (the operator-chosen stamp length is not sensitive information).
 */
function stampMatches(provided: unknown, secret: string): boolean {
  if (typeof provided !== 'string' || provided.length !== secret.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

/** Same body shape as the rate-limit deny — a terse JSON error, no detail leak. */
function deny(res: Response): void {
  res.status(403).json({ error: 'forbidden' });
}

/**
 * Builds the Express middleware. Kept as a factory (not a Nest class) so it can
 * be unit-tested without booting the app, and so `main.ts` wires it with a
 * single `app.use(...)` — the same shape as `buildGlobalRateLimitMiddleware`.
 */
export function buildProxyGateMiddleware(
  secret: string | undefined,
): (req: Request, res: Response, next: NextFunction) => void {
  // Resolved once at boot: container env cannot change without a restart
  // anyway. OFF returns a dedicated bare-next() so the per-request cost of the
  // disabled state is exactly one function call — the seamless guarantee.
  if (typeof secret !== 'string' || secret.length === 0) {
    return (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    };
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    if (isPublicPath(req.path || '')) {
      next();
      return;
    }
    if (stampMatches(req.headers['x-internal-secret'], secret)) {
      next();
      return;
    }
    deny(res);
  };
}
