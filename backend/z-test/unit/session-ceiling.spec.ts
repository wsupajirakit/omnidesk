/**
 * [FIX-20260820-SESSIONCEILING] — the renewal loop gets a wall.
 *
 * WHAT THIS PINS
 *   There is no refresh token in this system: the access token IS the renewal
 *   credential (`auth.controller.ts` hands `refresh()` only a user id), so a
 *   live token could renew itself indefinitely and the only thing that ever
 *   stopped it was somebody bumping `token_version` by hand.
 *
 *   Three properties are pinned here, and the first one is the reason the change
 *   is safe to ship at all:
 *     1. knob OFF (0, the default) ⇒ the minted payload is byte-identical to
 *        what today's code produces. Deploying changes nothing.
 *     2. knob ON ⇒ the deadline is CARRIED FORWARD, never extended, so renewing
 *        does not move the wall.
 *     3. a token minted before this shipped (no `sess_exp`) is STAMPED, not
 *        refused — the deploy logs nobody out.
 *
 * Red-first: every case below fails on the pre-fix code — case 1 because
 * `refresh` takes no second argument, cases 2-4 because nothing carries or
 * enforces a deadline.
 */
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';

import { authConfig } from '@/config/app.config';
import { AuthService } from '@/modules/auth/auth.service';
import { TokenService } from '@/modules/auth/token.service';
import { AuditLogService } from '@/modules/audit';
import { User } from '@/modules/admin';

const NOW = () => Math.floor(Date.now() / 1000);

/** A user row shaped the way `refresh` reads it, with the populate chain. */
const userRow = {
  _id: 'a0d00000000000000000005f',
  username: 'op',
  display_name: 'Operator',
  active: true,
  token_version: 3,
  permissions: ['ticket.manage'],
  role: null,
  groups: [],
  allowed_hooks: null,
  preferences: null,
};

const userModelStub = () => ({
  findOne: () => ({
    populate: () => ({ exec: () => Promise.resolve(userRow) }),
  }),
});

const build = async (sessionMaxLifetimeMin: number): Promise<AuthService> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      TokenService,
      { provide: JwtService, useValue: new JwtService({}) },
      { provide: getModelToken(User.name), useValue: userModelStub() },
      { provide: AuditLogService, useValue: { record: jest.fn() } },
      {
        provide: authConfig.KEY,
        useValue: {
          jwtSecret: 'test-secret-value-for-signing',
          jwtExpiresIn: '1h',
          sessionMaxLifetimeMin,
        },
      },
    ],
  }).compile();
  return moduleRef.get(AuthService);
};

/** The signed payload, read back without re-verifying (we only inspect claims). */
const claims = (token: string): Record<string, unknown> =>
  JSON.parse(
    Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

describe('[FIX-20260820-SESSIONCEILING] knob OFF is byte-identical to today', () => {
  it('mints no sess_exp claim at all when the knob is 0', async () => {
    const service = await build(0);
    const res = await service.refresh(String(userRow._id));
    expect('sess_exp' in claims(res.token)).toBe(false);
  });

  it('never refuses a renewal when the knob is 0, however old the deadline', async () => {
    const service = await build(0);
    // A deadline an hour in the PAST. With the feature off it must be ignored.
    const res = await service.refresh(String(userRow._id), NOW() - 3600);
    expect(res.token).toEqual(expect.any(String));
  });
});

describe('[FIX-20260820-SESSIONCEILING] knob ON puts a wall on the loop', () => {
  it('stamps a deadline on a token that carries none, instead of refusing it', async () => {
    // This is the grandfather case: every token that predates the fix.
    const service = await build(60);
    const res = await service.refresh(String(userRow._id));
    const exp = claims(res.token)['sess_exp'] as number;
    expect(exp).toBeGreaterThan(NOW() + 3500);
    expect(exp).toBeLessThanOrEqual(NOW() + 3600);
  });

  it('carries the SAME deadline forward — renewing does not move the wall', async () => {
    const service = await build(60);
    const first = NOW() + 120;
    const res = await service.refresh(String(userRow._id), first);
    expect(claims(res.token)['sess_exp']).toBe(first);
  });

  it('refuses the renewal once the deadline has passed', async () => {
    const service = await build(60);
    await expect(
      service.refresh(String(userRow._id), NOW() - 1),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('says nothing about WHY it refused', async () => {
    const service = await build(60);
    await expect(
      service.refresh(String(userRow._id), NOW() - 1),
    ).rejects.toThrow('invalid or expired token');
  });
});
