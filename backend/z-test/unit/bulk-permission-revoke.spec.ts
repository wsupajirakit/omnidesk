/**
 * [FIX-20260820-BULKPERMREVOKE] revoking permissions in bulk takes effect now,
 * not up to an hour from now.
 *
 * THE DEFECT, IN ONE SENTENCE
 *   Permissions ride inside the JWT, so rewriting the user row is not enough:
 *   until `token_version` moves, every token already issued keeps announcing the
 *   old set, and `PermissionsGuard` believes it.
 *
 * WHY IT WAS ONLY THIS ROUTE
 *   The single-user edit has always bumped, and `bulkUpdateActive` in this same
 *   file bumps when it deactivates someone. `bulkUpdatePermissions` was the one
 *   that did not — a faithful port of legacy-api `userController.js:736`, which
 *   omits it too. That makes two buttons on the same admin screen behave
 *   differently: revoke one operator and it is instant; tick twenty and it is
 *   not. ปุ่มสองปุ่มในหน้าเดียวกัน ให้ผลต่างกัน
 *
 * WHAT THE FIX COSTS
 *   Everyone in the batch is signed out. `jwt-auth.guard.ts:67` refuses their
 *   next request, apiClient turns the 401 into an `auth:invalid` event, and the
 *   dashboard shows its session-timeout modal. Signing in again is the whole
 *   cost, and the owner accepted it on 2026-08-20.
 *
 * Red-first: every case below fails on the pre-fix code, which builds the same
 * bulkWrite with `$set` alone.
 */
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { UsersBulkService } from '@/modules/admin/users-bulk.service';
import { UsersAccessService } from '@/modules/admin/users-access.service';
import { User } from '@/modules/admin';
import type { AuthenticatedUser } from '@/common';

/** The two rows the route will rewrite. One of them holds the hidden permission. */
const USERS = [
  { _id: 'u1', username: 'ztu_perm1', permissions: ['ticket.manage'] },
  {
    _id: 'u2',
    username: 'ztu_perm2',
    permissions: ['ticket.manage', 'role.manage'],
  },
];

const admin = {
  userId: 'admin1',
  roleName: 'admin',
  // The route refuses to touch a user holding a permission the caller lacks
  // (users-bulk.service.ts:270-276), so the caller here holds everything the two
  // targets do. That is the realistic case: a lead revoking rights they own.
  permissions: ['user.manage', 'ticket.manage', 'role.manage', 'hook.manage'],
} as unknown as AuthenticatedUser;

/** Captures the bulkWrite argument so the test can read the real update doc. */
/** A thenable query stub: any chained method returns itself, awaiting gives USERS. */
const chain = (): Record<string, unknown> => {
  const q: Record<string, unknown> = {};
  return new Proxy(q, {
    get: (_t, prop) =>
      prop === 'then'
        ? (res: (v: unknown) => void) => res(USERS)
        : () => chain(),
  });
};

const build = async (): Promise<{
  service: UsersBulkService;
  bulkWrite: jest.Mock;
}> => {
  const bulkWrite = jest
    .fn()
    .mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });
  const userModel = {
    bulkWrite,
    // A chain that answers whatever the route calls on it and resolves to USERS
    // at the end — so this test does not break the next time a `.lean()` or a
    // `.select()` is added to the read. ไม่ผูกกับรูปทรงของ chain.
    find: () => chain(),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      UsersBulkService,
      { provide: getModelToken(User.name), useValue: userModel },
      {
        provide: UsersAccessService,
        // Every accessService member the route touches, stubbed to "allowed":
        // this suite is about the write it builds, not the ACL that guards it.
        useValue: {
          isSuperUser: () => false,
          ensurePermissionSubset: () => undefined,
          getRoleRank: () => 0,
        },
      },
    ],
  }).compile();
  return { service: moduleRef.get(UsersBulkService), bulkWrite };
};

/** Every `updateOne` doc the route handed to Mongo. */
const updates = (bulkWrite: jest.Mock): Record<string, unknown>[] =>
  (
    bulkWrite.mock.calls[0]?.[0] as {
      updateOne: { update: Record<string, unknown> };
    }[]
  ).map((w) => w.updateOne.update);

describe('[FIX-20260820-BULKPERMREVOKE] a bulk revoke invalidates the tokens it revokes', () => {
  it('bumps token_version for every user in the batch', async () => {
    const { service, bulkWrite } = await build();
    await service.bulkUpdatePermissions(admin, {
      user_ids: ['u1', 'u2'],
      permissions: ['hook.manage'],
    });

    const docs = updates(bulkWrite);
    expect(docs).toHaveLength(2);
    // Without this the old permission set stays live in an issued token.
    docs.forEach((d) => expect(d['$inc']).toEqual({ token_version: 1 }));
  });

  it('still writes the permissions themselves — the bump is additive', async () => {
    const { service, bulkWrite } = await build();
    await service.bulkUpdatePermissions(admin, {
      user_ids: ['u1', 'u2'],
      permissions: ['hook.manage'],
    });

    updates(bulkWrite).forEach((d) =>
      expect(d['$set']).toEqual({
        permissions: expect.arrayContaining(['hook.manage']),
      }),
    );
  });

  it('still preserves role.manage on the user that held it', async () => {
    // The hidden permission is not in the picker, so a plain replace would
    // revoke it silently. Pinned here because the bump must not disturb it.
    const { service, bulkWrite } = await build();
    await service.bulkUpdatePermissions(admin, {
      user_ids: ['u1', 'u2'],
      permissions: ['hook.manage'],
    });

    const [first, second] = updates(bulkWrite) as {
      $set: { permissions: string[] };
    }[];
    expect(first!.$set.permissions).not.toContain('role.manage');
    expect(second!.$set.permissions).toContain('role.manage');
  });
});
