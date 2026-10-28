/**
 * Pins WHO may reach the inbound handoff callback routes.
 *
 * ⚠️ SECURITY-RELEVANT. Legacy genuinely leaves these two routes unauthenticated
 * (apiRoutes.js:127-128 add them to `shouldSkipAuth`; :535-536 mount them with
 * only a body parser and NO `authorize(...)`). The inbound HMAC verified inside
 * the service is the entire security boundary. That is mirrored here because
 * legacy is the specification, and it is pinned here so the decision cannot be
 * reversed — in EITHER direction — without a test turning red and a human
 * reading this comment.
 *
 * The subtlety this file exists for: legacy makes the *path* public, not the
 * route. `shouldSkipAuth` matches a bounded lowercase key, and a path that
 * fails that charset is NOT rejected — it falls through to the normal
 * `authenticate` middleware. So the answer depends on the caller's credential,
 * which was captured from both running backends:
 *
 *   POST /api/handoff/callback/TARGET_KEY   no token   → 401 (both agreed)
 *   POST /api/handoff/callback/TARGET_KEY   good token → legacy 400 "bad target_key"
 *                                                        ours   401  ← the defect
 *
 * The port threw 401 unconditionally on the non-matching branch, collapsing
 * those two cases into one and hiding the handler's own charset check from an
 * authenticated caller.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { CallbackPublicGuard } from '@/modules/handoff/callback-public.guard';
import type { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

/** A JwtAuthGuard stand-in that records whether real validation was invoked. */
const makeJwtGuard = (
  outcome: boolean | Error = true,
): JwtAuthGuard & { calls: number } => {
  const guard = {
    calls: 0,
    canActivate: jest.fn(() => {
      guard.calls += 1;
      if (outcome instanceof Error) throw outcome;
      return Promise.resolve(outcome);
    }),
  };
  return guard as unknown as JwtAuthGuard & { calls: number };
};

const contextFor = (
  path: string,
  headers: Record<string, string> = {},
  method = 'POST',
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ method, path, url: path, headers }),
    }),
    getHandler: () => function decoratedHandler(): void {},
    getClass: () => class DecoratedController {},
  }) as unknown as ExecutionContext;

const AUTHED = { authorization: 'Bearer a.valid.token' };

describe('CallbackPublicGuard — the public path shape', () => {
  it.each([
    ['/api/handoff/callback/walletpay'],
    ['/api/handoff/callback/topup'],
    ['/api/handoff/callback/a_b-c9'],
    ['/api/handoff/callback/walletpay/job_1234'],
    [`/api/handoff/callback/${'k'.repeat(64)}`],
  ])('%s is PUBLIC — no token required, HMAC is the gate', async (path) => {
    const jwt = makeJwtGuard();
    const guard = new CallbackPublicGuard(jwt);

    await expect(guard.canActivate(contextFor(path))).resolves.toBe(true);
    // The whole point: nothing authenticated this request.
    expect(jwt.calls).toBe(0);
  });

  it.each([
    ['/api/handoff/callback/TARGET_KEY', 'uppercase'],
    ['/api/handoff/callback/bad.key', 'a dot'],
    [`/api/handoff/callback/${'k'.repeat(65)}`, 'over 64 chars'],
    ['/api/handoff/callback/:target_key', 'an unsubstituted param'],
  ])('%s (%s) falls through to auth, it is not auto-public', async (path) => {
    const jwt = makeJwtGuard(true);
    const guard = new CallbackPublicGuard(jwt);

    await expect(guard.canActivate(contextFor(path, AUTHED))).resolves.toBe(
      true,
    );
    // Reached the real validator rather than being waved through OR 401'd.
    expect(jwt.calls).toBe(1);
  });

  it('a GET on a public-looking path is not public — legacy matches POST only', async () => {
    const jwt = makeJwtGuard(true);
    const guard = new CallbackPublicGuard(jwt);

    await guard.canActivate(
      contextFor('/api/handoff/callback/walletpay', AUTHED, 'GET'),
    );
    expect(jwt.calls).toBe(1);
  });
});

describe('CallbackPublicGuard — the non-public branch validates properly', () => {
  it('an anonymous caller still gets 401, exactly as legacy does', async () => {
    const jwt = makeJwtGuard(
      new UnauthorizedException('missing authentication token'),
    );
    const guard = new CallbackPublicGuard(jwt);

    await expect(
      guard.canActivate(contextFor('/api/handoff/callback/TARGET_KEY')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  /**
   * The regression this file was written for. A valid token on a non-matching
   * key must REACH the handler, so the handler's own charset check can answer
   * `400 bad target_key`. If this guard rejects instead, the route answers 401
   * and parity is broken.
   */
  it('a valid token on a non-matching key reaches the handler (no 401)', async () => {
    const jwt = makeJwtGuard(true);
    const guard = new CallbackPublicGuard(jwt);

    await expect(
      guard.canActivate(contextFor('/api/handoff/callback/TARGET_KEY', AUTHED)),
    ).resolves.toBe(true);
  });

  /**
   * A token is never trusted merely for being present. `@Public()` on the
   * handler makes the global JwtAuthGuard stand down, so if this guard skipped
   * validation an arbitrary string would authenticate the request.
   */
  it('an invalid token is rejected, not waved through on presence alone', async () => {
    const jwt = makeJwtGuard(
      new UnauthorizedException('invalid or expired token'),
    );
    const guard = new CallbackPublicGuard(jwt);

    await expect(
      guard.canActivate(
        contextFor('/api/handoff/callback/TARGET_KEY', {
          authorization: 'Bearer totally-made-up',
        }),
      ),
    ).rejects.toThrow('invalid or expired token');
  });

  /**
   * JwtAuthGuard's first act is a reflector read of IS_PUBLIC_KEY over
   * `getHandler()`/`getClass()`. If the guard forwarded the ORIGINAL context,
   * that read would still find the `@Public()` handler and return true without
   * validating anything — a silently unauthenticated route.
   */
  it('hides the @Public() handler from the delegate so validation really runs', async () => {
    const jwt = makeJwtGuard(true);
    const guard = new CallbackPublicGuard(jwt);
    const original = contextFor('/api/handoff/callback/TARGET_KEY', AUTHED);

    await guard.canActivate(original);

    const forwarded = (jwt.canActivate as jest.Mock).mock
      .calls[0][0] as ExecutionContext;
    expect(forwarded.getHandler()).not.toBe(original.getHandler());
    expect(forwarded.getClass()).not.toBe(original.getClass());
  });
});
