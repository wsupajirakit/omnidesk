/**
 * [FIX-20260818-RANKCALLSITES] Rank is checked at every door, not most of them.
 * audit_18_aug H12 — and two more doors the finding does not name.
 *
 * ## What the dive found
 * Eight routes under `/api/users` can change another account. FIVE already ask
 * "does this target outrank me?" and refuse if so:
 *   deleteUser · createUser · bulk-active · bulk-clone · bulk-permissions
 * THREE did not:
 *   PUT /api/users/:id        (H12)              — set anyone's password
 *   POST /generate-temp-key   (NOT in the audit)  — mint a reset key for anyone
 *   POST /:id/kill-sessions   (NOT in the audit)  — revoke anyone's sessions
 *
 * So the pattern was already the house style; three routes simply missed it.
 * That is what makes this a consistency fix rather than a new policy.
 *
 * ## Why generate-temp-key is the worst of the three
 * It is a complete account takeover on its own, needing no other bug: an `admin`
 * mints a temp key for a `superadmin`, then posts it to the PUBLIC
 * `/reset-password-temp` route (which is otherwise sound — the key is encrypted,
 * bound to the user, expiring, and rate limited) and signs in as them. Fixing
 * H12 alone would have left this open, which is exactly why the whole family was
 * enumerated instead of the one line the audit pointed at.
 *
 * ## Why this is seamless
 * - The dashboard calls NEITHER generate-temp-key NOR kill-sessions (grepped the
 *   whole FE): no screen changes.
 * - Editing yourself does not use `PUT /api/users/:id` — the dashboard has
 *   `PATCH /change-password` and `PUT /me/preferences` for that.
 * - Equal rank still passes, so an admin still administers admins.
 * - An UNRANKED target still passes, deliberately — `users-rank-failclosed.spec.ts`
 *   pins that, and assigning a custom role must keep working.
 * - All nine live accounts hold a ranked role, so no real operator changes.
 */

import { ForbiddenException } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common';
import {
  UsersAccessService,
  UsersPrefsService,
  UsersService,
} from '@/modules/admin';

const SUPERADMIN_ROLE = 'a0d00000000000000000008d';
const OPERATOR_ROLE = 'a0d00000000000000000008e';
const ADMIN_ROLE = 'a0d00000000000000000007e';

const TARGET_ID = 'a0d00000000000000000000a';

/** An `admin` — rank 2. Holds user.manage in the real database. */
const ADMIN: AuthenticatedUser = {
  userId: 'a0d00000000000000000005e',
  username: 'admin',
  displayName: 'Admin',
  roleId: ADMIN_ROLE,
  roleName: 'admin',
  groups: [],
} as unknown as AuthenticatedUser;

const ROLE_NAMES: Record<string, string> = {
  [SUPERADMIN_ROLE]: 'superadmin',
  [OPERATOR_ROLE]: 'operator',
  [ADMIN_ROLE]: 'admin',
};

/** A real UsersAccessService over a stubbed role collection. */
function makeAccess(): UsersAccessService {
  const roleModel = {
    findById: (id: unknown) => ({
      select: () => ({
        exec: () =>
          Promise.resolve(
            ROLE_NAMES[String(id)] ? { name: ROLE_NAMES[String(id)] } : null,
          ),
      }),
      exec: () =>
        Promise.resolve(
          ROLE_NAMES[String(id)]
            ? { _id: id, name: ROLE_NAMES[String(id)] }
            : null,
        ),
    }),
  };
  const access = Object.create(
    UsersAccessService.prototype,
  ) as UsersAccessService;
  Object.assign(access, { roleModel });
  return access;
}

/** A target account holding `roleId`, with the save/lean chain each caller uses. */
function makeTarget(roleId: string): Record<string, unknown> {
  return {
    _id: TARGET_ID,
    username: 'victim',
    display_name: 'Victim',
    role: roleId, // NOT populated — this is the shape updateUser actually loads
    groups: [],
    permissions: [],
    active: true,
    token_version: 4,
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function makeUsersService(target: Record<string, unknown>): UsersService {
  const chain = (result: unknown): Record<string, unknown> => ({
    populate: function (this: unknown) {
      return this as Record<string, unknown>;
    },
    lean: function (this: unknown) {
      return this as Record<string, unknown>;
    },
    exec: () => Promise.resolve(result),
  });
  const service = Object.create(UsersService.prototype) as UsersService;
  Object.assign(service, {
    userModel: { findOne: () => chain(target), findById: () => chain(target) },
    roleModel: {},
    accessService: makeAccess(),
    auditLogService: { createAuditLog: jest.fn().mockResolvedValue({}) },
  });
  return service;
}

function makePrefsService(target: Record<string, unknown>): UsersPrefsService {
  const service = Object.create(
    UsersPrefsService.prototype,
  ) as UsersPrefsService;
  Object.assign(service, {
    userModel: { findOne: () => ({ exec: () => Promise.resolve(target) }) },
    accessService: makeAccess(),
  });
  return service;
}

/** Called through a widened signature so these cases run against the pre-fix
 *  code and go red on BEHAVIOUR rather than on argument arity. */
type Call2 = (a: unknown, b: unknown) => Promise<unknown>;
/** killUserSessions takes (id, dto, caller) — passing the caller as the dto made
 *  the ⭐ case pass for the WRONG reason (an absent caller ranks 0 and is refused
 *  by the requester-side guard, not by the target's rank). Caught by its own PIN. */
type Call3 = (a: unknown, b: unknown, c: unknown) => Promise<unknown>;

describe('[RANKCALLSITES] PUT /api/users/:id — H12', () => {
  it('⭐ an admin may NOT edit a superadmin (this is the password-reset takeover)', async () => {
    const service = makeUsersService(makeTarget(SUPERADMIN_ROLE));

    await expect(
      service.updateUser(TARGET_ID, ADMIN, { password: 'taken over' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an admin may still edit an operator — the everyday case must not break', async () => {
    const service = makeUsersService(makeTarget(OPERATOR_ROLE));

    await expect(
      service.updateUser(TARGET_ID, ADMIN, {
        display_name: 'Renamed',
      }),
    ).resolves.toBeDefined();
  });

  it('equal rank still passes — an admin administers admins', async () => {
    const service = makeUsersService(makeTarget(ADMIN_ROLE));

    await expect(
      service.updateUser(TARGET_ID, ADMIN, { active: false }),
    ).resolves.toBeDefined();
  });

  it('an UNRANKED target still passes — deliberately unchanged', async () => {
    // Pinned by users-rank-failclosed.spec.ts: assigning a custom role is a real
    // flow, and an unranked target holds no privilege this guard protects.
    const service = makeUsersService(makeTarget('a0d00000000000000000008f'));

    await expect(
      service.updateUser(TARGET_ID, ADMIN, { phone: '0800000000' }),
    ).resolves.toBeDefined();
  });
});

describe('[RANKCALLSITES] POST /api/users/generate-temp-key — not in the audit', () => {
  it('⭐ an admin may NOT mint a reset key for a superadmin', async () => {
    const service = makePrefsService(makeTarget(SUPERADMIN_ROLE));

    await expect(
      (service.generateTempKey.bind(service) as Call2)(
        { user_id: TARGET_ID },
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an admin may still mint one for an operator', async () => {
    const service = makePrefsService(makeTarget(OPERATOR_ROLE));

    const out = (await (service.generateTempKey.bind(service) as Call2)(
      { user_id: TARGET_ID },
      ADMIN,
    )) as { temp_key?: string };
    expect(typeof out.temp_key).toBe('string');
  });
});

describe('[RANKCALLSITES] POST /api/users/:id/kill-sessions — not in the audit', () => {
  it('⭐ an admin may NOT revoke a superadmin`s sessions', async () => {
    const service = makePrefsService(makeTarget(SUPERADMIN_ROLE));

    await expect(
      (service.killUserSessions.bind(service) as Call3)(
        TARGET_ID,
        undefined,
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an admin may still revoke an operator`s sessions', async () => {
    const target = makeTarget(OPERATOR_ROLE);
    const service = makePrefsService(target);

    await (service.killUserSessions.bind(service) as Call3)(
      TARGET_ID,
      undefined,
      ADMIN,
    );
    expect(target['token_version']).toBe(5);
  });
});
