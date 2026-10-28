import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import type { AuthenticatedUser, JwtPayload } from '@/common';
import { authConfig } from '@/config/app.config';
import {
  ACCESS_TOKEN_COOKIE,
  buildCookieOptions,
  JwtAuthGuard,
  TokenService,
  WsTicketService,
  type CookieAttributes,
} from '@/modules/auth';

/**
 * [FEAT-20260808-HTTPONLY-S1] Before/after proof for the additive HttpOnly auth
 * migration, Step 1 (dual-support: cookie AND Bearer both work).
 *
 * The invariants under test:
 *   - the guard authenticates a cookie identically to a Bearer header (parity),
 *     and prefers the cookie when both are present;
 *   - the response `expiresAt` equals the JWT `exp`;
 *   - the CORS origin check echoes an allow-listed origin and rejects others
 *     (credentials on ⇒ no reflect-any);
 *   - the WS ticket writes `ws_ticket:<t>` = `{ userId, allowedHooks, env }`
 *     with a TTL and the correct per-tenant fan-out set, and is single-use.
 *
 * Fakes only — no Mongo, no real Redis, no real keys.
 */

const secret = 'test-secret-not-a-real-key';

const basePayload: JwtPayload = {
  user_id: 'a0d00000000000000000005f',
  role_id: 'a0d000000000000000000060',
  role_name: 'operator',
  permissions: ['ticket.view'],
  username: 'operator',
  display_name: 'Operator',
  token_version: 3,
  groups: ['a0d000000000000000000061'],
  allowed_hooks: null,
};

const buildTokenService = async (): Promise<TokenService> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      TokenService,
      { provide: JwtService, useValue: new JwtService({}) },
      {
        provide: authConfig.KEY,
        useValue: { jwtSecret: secret, jwtExpiresIn: '1h' },
      },
    ],
  }).compile();
  return moduleRef.get(TokenService);
};

/** A user-model stub whose stored token_version matches the token's. */
const userModelStub = (tokenVersion = basePayload.token_version) => ({
  findById: () => ({
    select: () => ({
      lean: () => ({
        exec: () =>
          Promise.resolve({
            active: true,
            deleted_at: null,
            token_version: tokenVersion,
          }),
      }),
    }),
  }),
});

/** Minimal Nest ExecutionContext wrapping a fake express request. */
const contextFor = (request: unknown) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as never;

const buildGuard = (tokenService: TokenService): JwtAuthGuard => {
  const reflectorStub = { getAllAndOverride: () => false };
  return new JwtAuthGuard(
    reflectorStub as never,
    tokenService,
    userModelStub() as never,
  );
};

describe('[HTTPONLY-S1] guard dual-read parity (cookie vs Bearer)', () => {
  it('authenticates a Bearer header and a cookie to the SAME user', async () => {
    const tokenService = await buildTokenService();
    const guard = buildGuard(tokenService);
    const token = tokenService.sign(basePayload);

    const bearerReq: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };
    const cookieReq: Record<string, unknown> = {
      headers: {},
      cookies: { [ACCESS_TOKEN_COOKIE]: token },
    };

    await expect(guard.canActivate(contextFor(bearerReq))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(cookieReq))).resolves.toBe(true);

    // Parity: both paths attach an identical AuthenticatedUser.
    expect(bearerReq.user).toEqual(cookieReq.user);
    expect((bearerReq.user as AuthenticatedUser).userId).toBe(
      basePayload.user_id,
    );
  });

  it('prefers the cookie when both a cookie and a Bearer header are present', async () => {
    const tokenService = await buildTokenService();
    const guard = buildGuard(tokenService);

    const cookieToken = tokenService.sign({
      ...basePayload,
      user_id: 'a0d000000000000000000062',
    });
    const bearerToken = tokenService.sign(basePayload);

    // token_version still matches, so either token would pass the model check;
    // the userId proves which token the guard actually read.
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${bearerToken}` },
      cookies: { [ACCESS_TOKEN_COOKIE]: cookieToken },
    };

    await guard.canActivate(contextFor(req));
    expect((req.user as AuthenticatedUser).userId).toBe(
      'a0d000000000000000000062',
    );
  });

  it('still rejects a request carrying neither cookie nor header', async () => {
    const tokenService = await buildTokenService();
    const guard = buildGuard(tokenService);
    await expect(
      guard.canActivate(contextFor({ headers: {} })),
    ).rejects.toThrow();
  });

  it('keeps the legacy x-access-token header working', async () => {
    const tokenService = await buildTokenService();
    const guard = buildGuard(tokenService);
    const token = tokenService.sign(basePayload);
    const req: Record<string, unknown> = {
      headers: { 'x-access-token': token },
    };
    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
  });
});

describe('[HTTPONLY-S1] expiresAt derives from the JWT exp', () => {
  it('returns exp * 1000 (epoch ms)', async () => {
    const tokenService = await buildTokenService();
    const token = tokenService.sign(basePayload);

    const decoded = new JwtService({}).decode<JwtPayload>(token);
    const expMs = tokenService.expiresAt(token);

    expect(expMs).toBe((decoded.exp as number) * 1000);
    // 1h token: expiry is in the future and roughly an hour out.
    expect(expMs! - Date.now()).toBeGreaterThan(0);
    expect(expMs! - Date.now()).toBeLessThanOrEqual(3600_000 + 5000);
  });
});

describe('[HTTPONLY-S1] cookie attributes', () => {
  it('is always HttpOnly and carries the configured attributes', () => {
    const attrs: CookieAttributes = {
      domain: '.example.com',
      secure: true,
      sameSite: 'lax',
    };
    const opts = buildCookieOptions(attrs);
    expect(opts.httpOnly).toBe(true);
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
    expect(opts.domain).toBe('.example.com');
  });

  it('omits domain entirely when empty (host-only, for local)', () => {
    const opts = buildCookieOptions({
      domain: '',
      secure: false,
      sameSite: 'lax',
    });
    expect('domain' in opts).toBe(false);
    expect(opts.secure).toBe(false);
  });
});

/**
 * Reproduces the exact origin callback main.ts installs, so the test pins the
 * real credentialed-CORS rule rather than a paraphrase.
 */
const corsOriginCheck =
  (allowed: string[]) =>
  (
    origin: string | undefined,
    cb: (err: Error | null, allow?: boolean) => void,
  ): void =>
    cb(null, !origin || allowed.includes(origin));

describe('[HTTPONLY-S1] CORS credentialed origin check', () => {
  const allowed = ['https://dash.example.com', 'http://localhost:5173'];

  it('echoes an allow-listed origin', () => {
    corsOriginCheck(allowed)('https://dash.example.com', (_e, ok) =>
      expect(ok).toBe(true),
    );
    corsOriginCheck(allowed)('http://localhost:5173', (_e, ok) =>
      expect(ok).toBe(true),
    );
  });

  it('rejects an unlisted origin (no reflect-any with credentials)', () => {
    corsOriginCheck(allowed)('https://evil.example.com', (_e, ok) =>
      expect(ok).toBe(false),
    );
  });

  it('allows requests with no Origin (curl / server-to-server)', () => {
    corsOriginCheck(allowed)(undefined, (_e, ok) => expect(ok).toBe(true));
  });
});

/** In-memory Redis double implementing only what the ticket path uses. */
class FakeRedis {
  store = new Map<string, { value: string; ttl: number }>();
  set(key: string, value: string, _ex: 'EX', ttl: number): Promise<'OK'> {
    this.store.set(key, { value, ttl });
    return Promise.resolve('OK');
  }
  /** GETDEL — omnidesk-ws' single-use consume. */
  getdel(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    this.store.delete(key);
    return entry.value;
  }
}

const buildWsTicketService = (
  fake: FakeRedis,
  hookIds: string[] = [],
  wsEnv = 'dev',
  ttl = 45,
): WsTicketService => {
  const hookModelStub = {
    find: () => ({
      select: () => ({
        lean: () => Promise.resolve(hookIds.map((id) => ({ _id: id }))),
      }),
    }),
  };
  const redisServiceStub = { getClient: () => fake };
  const realtimeStub = { wsEnv, wsTicketTtlSec: ttl };
  return new WsTicketService(
    hookModelStub as never,
    redisServiceStub as never,
    realtimeStub as never,
  );
};

const operator: AuthenticatedUser = {
  userId: 'a0d00000000000000000005f',
  roleId: 'a0d000000000000000000060',
  roleName: 'operator',
  permissions: [],
  username: 'operator',
  displayName: 'Operator',
  tokenVersion: 0,
  groups: ['a0d000000000000000000061'],
  allowedHooks: null,
};

const superadmin: AuthenticatedUser = {
  ...operator,
  roleName: 'superadmin',
};

describe('[HTTPONLY-S1] WS ticket mint → Redis ws_ticket:<t>', () => {
  it('stores { userId, allowedHooks, env } with the per-tenant fan-out set', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake, ['hookA', 'hookB'], 'dev', 45);

    const { ticket, expiresIn } = await svc.mint(operator);
    expect(expiresIn).toBe(45);

    const raw = fake.store.get(`ws_ticket:${ticket}`);
    expect(raw).toBeDefined();
    expect(raw!.ttl).toBe(45);

    const payload = JSON.parse(raw!.value);
    // Shape must match EXACTLY what omnidesk-ws Step 0 reads.
    expect(payload).toEqual({
      userId: operator.userId,
      allowedHooks: ['hookA', 'hookB'],
      env: 'dev',
      // this operator is not super, so the sentinel says so explicitly
      is_super: false,
    });
    /* [FIX-20260818-WSSENTINEL · plan W1] `is_super` joins the payload. The key
       set is still asserted exactly rather than loosened, because omnidesk-ws parses
       this object and an unnoticed extra field is how a contract drifts. What the
       new field means to the consumer is that its PRESENCE marks a ticket minted
       by this backend — an older one has no such key — so it must never silently
       disappear again. */
    expect(Object.keys(payload).sort()).toEqual([
      'allowedHooks',
      'env',
      'is_super',
      'userId',
    ]);
  });

  it('represents super as allowedHooks:null (no fan-out filter)', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake, ['ignored'], 'prod');
    const { ticket } = await svc.mint(superadmin);
    const payload = JSON.parse(fake.store.get(`ws_ticket:${ticket}`)!.value);
    expect(payload.allowedHooks).toBeNull();
    expect(payload.env).toBe('prod');
  });

  it('represents a groupless non-super user as allowedHooks:[] (nothing)', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake, [], 'dev');
    const { ticket } = await svc.mint({ ...operator, groups: [] });
    const payload = JSON.parse(fake.store.get(`ws_ticket:${ticket}`)!.value);
    expect(payload.allowedHooks).toEqual([]);
  });

  it('is single-use: a second GETDEL of the same ticket returns null', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake, ['hookA']);
    const { ticket } = await svc.mint(operator);

    const first = fake.getdel(`ws_ticket:${ticket}`);
    const second = fake.getdel(`ws_ticket:${ticket}`);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('mints unguessable, distinct opaque tokens', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake);
    const a = await svc.mint(operator);
    const b = await svc.mint(operator);
    expect(a.ticket).not.toBe(b.ticket);
    // 32 random bytes as base64url ⇒ well over 40 chars, no meaning encoded.
    expect(a.ticket.length).toBeGreaterThan(40);
  });
});

/**
 * [FIX-20260818-OAACCESSONE · plan §7.1 = C2/C3 = T3-2] the WS ticket must be
 * scoped exactly like the REST list endpoints.
 *
 * `ws-ticket.service.ts` said in its own comment that its scoping was "kept
 * byte-identical" to the HTTP path's `getAllowedHookIds`. It was not: the
 * per-user `allowed_hooks` tier was missing, so an operator provisioned for one
 * OA received realtime events for EVERY OA in their group — the same cross-OA
 * leak `[FIX-20260808-ACLWHITELIST]` closed on the REST side, still open here.
 *
 * The case below is the difference in one assertion: the stub returns two group
 * OAs, the user is whitelisted to one, and the ticket must carry only that one.
 * It fails on the pre-fix code (which returns both) for exactly that reason.
 */
describe('[OAACCESSONE] WS ticket honours the per-user allowed_hooks whitelist', () => {
  const whitelisted: AuthenticatedUser = {
    ...operator,
    // valid ObjectId shape on purpose — the resolver filters invalid ids out
    allowedHooks: ['a0d000000000000000000063'],
  };

  it('⭐ allowed_hooks wins over the group fallback', async () => {
    const fake = new FakeRedis();
    // the group would grant two OAs; the whitelist names a third, narrower set
    const svc = buildWsTicketService(
      fake,
      ['a0d000000000000000000064', 'a0d000000000000000000065'],
      'dev',
      45,
    );

    const { ticket } = await svc.mint(whitelisted);
    const stored = JSON.parse(fake.store.get(`ws_ticket:${ticket}`)!.value) as {
      allowedHooks: string[] | null;
    };

    expect(stored.allowedHooks).toEqual(['a0d000000000000000000063']);
  });

  it('super users still get null (no filter) — unchanged', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(
      fake,
      ['a0d000000000000000000064'],
      'dev',
      45,
    );
    const { ticket } = await svc.mint({
      ...superadmin,
      allowedHooks: ['a0d000000000000000000063'],
    });
    const stored = JSON.parse(fake.store.get(`ws_ticket:${ticket}`)!.value) as {
      allowedHooks: string[] | null;
    };
    expect(stored.allowedHooks).toBeNull();
  });

  it('no groups and no whitelist ⇒ [] (fail closed), unchanged', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake, [], 'dev', 45);
    const { ticket } = await svc.mint({ ...operator, groups: [] });
    const stored = JSON.parse(fake.store.get(`ws_ticket:${ticket}`)!.value) as {
      allowedHooks: string[] | null;
    };
    expect(stored.allowedHooks).toEqual([]);
  });
});

/**
 * [FIX-20260818-WSSENTINEL · plan W1] the sentinel that lets omnidesk-ws tell the two
 * meanings of `allowedHooks: null` apart.
 *
 * `null` currently says both "super user, no filter" (this path) and "this
 * account has no allowed_hooks field" (omnidesk-ws's other auth path, true for 8 of
 * the 11 live accounts). omnidesk-ws cannot distinguish them, so it filters neither —
 * that is the leak. `is_super` carries the answer explicitly.
 *
 * ⚠️ Its PRESENCE is also the version marker: a ticket minted by an older backend
 * has no such key, and omnidesk-ws is expected to read that absence as "old rules".
 * So these cases pin that it is ALWAYS emitted, never omitted and never
 * `undefined` — an intermittently-present marker would be worse than none.
 */
describe('[WSSENTINEL] the ticket says plainly whether the caller is super', () => {
  it('⭐ a super user gets is_super:true alongside the null it already sent', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake, ['hookA'], 'dev', 45);

    const { ticket } = await svc.mint(superadmin);
    const stored = JSON.parse(fake.store.get(`ws_ticket:${ticket}`)!.value) as {
      allowedHooks: string[] | null;
      is_super: boolean;
    };

    // both, not either: allowedHooks keeps its old value so older consumers
    // behave exactly as before
    expect(stored.allowedHooks).toBeNull();
    expect(stored.is_super).toBe(true);
  });

  it('⭐ a scoped operator gets is_super:false, not a missing key', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake, ['hookA'], 'dev', 45);

    const { ticket } = await svc.mint(operator);
    const stored = JSON.parse(
      fake.store.get(`ws_ticket:${ticket}`)!.value,
    ) as Record<string, unknown>;

    expect(stored['is_super']).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stored, 'is_super')).toBe(true);
  });

  it('⭐ an operator with no groups still carries the marker (fail-closed stays legible)', async () => {
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake, [], 'dev', 45);

    const { ticket } = await svc.mint({ ...operator, groups: [] });
    const stored = JSON.parse(fake.store.get(`ws_ticket:${ticket}`)!.value) as {
      allowedHooks: string[] | null;
      is_super: boolean;
    };

    // [] means "no OA at all" — the marker must not turn that into "super"
    expect(stored.allowedHooks).toEqual([]);
    expect(stored.is_super).toBe(false);
  });

  it('the sentinel agrees with allowedHooks — one decision, not two', async () => {
    // is_super is derived from the resolved value, so they cannot drift apart
    const fake = new FakeRedis();
    const svc = buildWsTicketService(fake, ['hookA'], 'dev', 45);

    for (const user of [operator, superadmin]) {
      const { ticket } = await svc.mint(user);
      const stored = JSON.parse(
        fake.store.get(`ws_ticket:${ticket}`)!.value,
      ) as {
        allowedHooks: string[] | null;
        is_super: boolean;
      };
      expect(stored.is_super).toBe(stored.allowedHooks === null);
    }
  });
});
