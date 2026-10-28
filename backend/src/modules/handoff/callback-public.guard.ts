import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

/**
 * Reproduces the legacy skip-auth CONDITION for the two callback routes.
 *
 * ⚠️ SECURITY-RELEVANT — READ BEFORE CHANGING.
 *
 * Legacy does not make the route public; it makes the *path* public, and only
 * when it matches (apiRoutes.js:127-128, inside `shouldSkipAuth`):
 *
 *   POST /^\/api\/handoff\/callback\/[a-z0-9_-]{1,64}$/
 *   POST /^\/api\/handoff\/callback\/[a-z0-9_-]{1,64}\/[^/]+$/
 *
 * For a path that matches, legacy runs NO bearer check at all — the inbound
 * HMAC verified inside the service is the entire security boundary, which
 * legacy states outright at apiRoutes.js:125 ("Its own HMAC is the gate, not
 * Bearer"). That is genuinely a public, unauthenticated endpoint, and it is
 * mirrored here on purpose because legacy is the specification. It is called
 * out loudly rather than mirrored silently.
 *
 * For a path that does NOT match — an uppercase or over-long key, say — legacy
 * does not reject. `shouldSkipAuth` simply returns false and the request FALLS
 * THROUGH to the normal `authenticate` middleware. So the outcome depends on
 * the caller's credential:
 *
 *   no token   → `authenticate` answers 401 missing authentication token
 *   good token → passes, reaches the handler, which answers its own
 *                400 { error: "bad target_key" }
 *                (handoffCallbackController.js:73-75)
 *
 * This guard previously threw 401 for BOTH cases, which broke the second one:
 * an authenticated caller with an odd key saw 401 where legacy sends 400.
 * Confirmed on the two running backends with `POST /api/handoff/callback/
 * TARGET_KEY` and a valid bearer token — legacy 400 "bad target_key", ours 401.
 *
 * The handler still carries `@Public()`, which makes the global JwtAuthGuard
 * stand down for every key shape. This guard therefore has to re-apply the
 * validation itself for the non-matching case. It delegates to the very same
 * JwtAuthGuard rather than re-checking signatures and `token_version` by hand,
 * because a second copy of the revocation logic is how the two drift apart and
 * a revoked token quietly keeps working on one route.
 */
@Injectable()
export class CallbackPublicGuard implements CanActivate {
  constructor(private readonly jwtGuard: JwtAuthGuard) {}

  /** Anchored, lowercase, 1-64 — exactly the legacy character class. */
  private static readonly PUBLIC_PATH =
    /^\/api\/handoff\/callback\/[a-z0-9_-]{1,64}(\/[^/]+)?$/;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // `req.path` excludes the query string, matching what legacy tests.
    const path = request.path || request.url.split('?')[0] || '';

    if (
      request.method === 'POST' &&
      CallbackPublicGuard.PUBLIC_PATH.test(path)
    ) {
      // Legacy skips auth entirely for this shape. The HMAC is the gate.
      return true;
    }

    /*
     * Not a legacy-public path → legacy's `authenticate` runs. Delegate to the
     * shared guard, but hand it a context whose handler is NOT the `@Public()`
     * one: JwtAuthGuard's first act is a reflector read of IS_PUBLIC_KEY over
     * `getHandler()`/`getClass()`, and if that still resolves to our decorated
     * handler it returns true immediately and validates nothing.
     *
     * `canActivate` is substituted for the handler because it is a plain
     * undecorated method on this class, so both reflector lookups miss and the
     * guard proceeds to its real work: extract the token, verify the signature,
     * re-check the account is active and `token_version` still matches, and
     * populate `request.user`. It throws 401 itself when any of that fails,
     * with the same messages every other route emits.
     */
    const unmarked: ExecutionContext = Object.create(
      context,
    ) as ExecutionContext;
    unmarked.getHandler = () => CallbackPublicGuard.prototype.canActivate;
    // `getClass` is generic over the class it returns; this class is a concrete
    // stand-in, so the cast just satisfies that variance.
    unmarked.getClass = (() =>
      CallbackPublicGuard) as ExecutionContext['getClass'];

    return await this.jwtGuard.canActivate(unmarked);
  }
}
