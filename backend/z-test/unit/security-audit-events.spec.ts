/**
 * [FIX-20260818-SECAUDIT] Security events reach the audit trail. plan §2.2b M3
 *
 * The finding (audit_18_aug M3) is that `grep audit src/modules/auth/` and the
 * same grep over `src/modules/admin/` both returned nothing: signing in,
 * creating an account, changing a role and resetting a password left no trace,
 * while content changes had been audited for months.
 *
 * These cases pin the five events named in that finding at the seam that writes
 * them, plus the two rules that make the rows worth having:
 *   - a failed audit write must NOT fail the operation (fire-and-forget), and
 *   - a password change must never put the secret, or its hash, in the row.
 *
 * Services are built off their prototypes with hand-stubbed collaborators — the
 * shape `users-rank-failclosed.spec.ts` already uses here. No Nest, no Mongo.
 */

import type { AuthenticatedUser } from '@/common';
import { hashPassword } from '@/common/utils/password';
import { AuthService } from '@/modules/auth';
import { UsersService } from '@/modules/admin';

const AUDIT_PARENT = 'user';

const USER_ID = 'a0d00000000000000000000a';
const GROUP_ID = 'a0d00000000000000000001b';
const ROLE_OLD = 'a0d00000000000000000007d';
const ROLE_NEW = 'a0d00000000000000000007e';

const ADMIN: AuthenticatedUser = {
  userId: 'a0d00000000000000000005e',
  username: 'boss',
  displayName: 'The Boss',
  roleName: 'superadmin',
  groups: [GROUP_ID],
} as unknown as AuthenticatedUser;

function makeAudit(): { createAuditLog: jest.Mock } {
  return { createAuditLog: jest.fn().mockResolvedValue({}) };
}

/** Lets the fire-and-forget `void ...createAuditLog` settle. */
const flush = (): Promise<unknown> => new Promise((r) => setImmediate(r));

/* ────────────────────────────── login ────────────────────────────── */

const PASSWORD = 'correct horse battery staple';

function loginDoc(): Record<string, unknown> {
  return {
    _id: USER_ID,
    username: 'op1',
    display_name: 'Operator One',
    password_hash: hashPassword(PASSWORD),
    role: { _id: ROLE_OLD, name: 'admin', permissions: [] },
    groups: [{ _id: GROUP_ID, group_name: 'G' }],
    permissions: [],
    allowed_hooks: null,
    preferences: null,
    token_version: 1,
  };
}

function makeAuthService(doc: Record<string, unknown> | null): {
  service: AuthService;
  audit: { createAuditLog: jest.Mock };
} {
  const audit = makeAudit();
  const chain = (result: unknown): Record<string, unknown> => ({
    populate: () => ({ exec: () => Promise.resolve(result) }),
  });
  const service = Object.create(AuthService.prototype) as AuthService;
  Object.assign(service, {
    userModel: {
      findOne: () => chain(doc),
      findByIdAndUpdate: () => chain(doc),
    },
    tokenService: { sign: () => 'tok', expiresAt: () => 0 },
    auditLogService: audit,
    // [FIX-20260820-SESSIONCEILING] the service now reads a config knob. This
    // stub hand-assembles its dependencies, so a new one has to be added here
    // too. 0 = the ceiling is off, which is what these cases assume.
    auth: { sessionMaxLifetimeMin: 0 },
  });
  return { service, audit };
}

describe('[SECAUDIT] signing in leaves a trace', () => {
  it('a successful login writes one row naming the account that signed in', async () => {
    const { service, audit } = makeAuthService(loginDoc());

    await service.login('op1', PASSWORD);
    await flush();

    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    const row = audit.createAuditLog.mock.calls[0][0];
    expect(row).toMatchObject({
      action: 'login',
      parent: AUDIT_PARENT,
      ref_id: USER_ID,
    });
    // The actor of a login is the account itself — nobody else performed it.
    expect(row.actor).toMatchObject({
      user_id: USER_ID,
      username: 'op1',
      display_name: 'Operator One',
    });
  });

  it('the row carries no password material of any kind', async () => {
    const { service, audit } = makeAuthService(loginDoc());

    await service.login('op1', PASSWORD);
    await flush();

    const serialized = JSON.stringify(audit.createAuditLog.mock.calls[0][0]);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('password_hash');
  });

  it('a REFUSED login writes nothing — recording it needs a schema decision', async () => {
    // Documented gap, not an oversight: `action` has no `login_failed` value and
    // `ref_id` is required, which an unknown username cannot supply. See the
    // header of `security-events.ts`.
    const { service, audit } = makeAuthService(loginDoc());

    await expect(service.login('op1', 'wrong password')).rejects.toThrow();
    await flush();

    expect(audit.createAuditLog).not.toHaveBeenCalled();
  });

  it('⭐ an audit write that fails does not fail the login', async () => {
    const { service, audit } = makeAuthService(loginDoc());
    audit.createAuditLog.mockRejectedValue(new Error('mongo is down'));

    // The rejection is swallowed inside the helper. If it were not, this would
    // either throw here or surface as an unhandled rejection.
    await expect(service.login('op1', PASSWORD)).resolves.toMatchObject({
      token: 'tok',
    });
    await flush();
  });
});

/* ───────────────────────── account changes ───────────────────────── */

function makeUsersService(): {
  service: UsersService;
  audit: { createAuditLog: jest.Mock };
  saved: Record<string, unknown>;
} {
  const audit = makeAudit();

  const saved: Record<string, unknown> = {
    _id: USER_ID,
    username: 'op1',
    display_name: 'Operator One',
    password_hash: hashPassword('old one'),
    active: true,
    role: ROLE_OLD,
    groups: [GROUP_ID],
    permissions: [],
    allowed_hooks: null,
    token_version: 3,
    save: jest.fn().mockResolvedValue(undefined),
  };

  const lean = (result: unknown): Record<string, unknown> => ({
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
    userModel: {
      findOne: () => lean(saved),
      findById: () =>
        lean({ ...saved, role: { _id: ROLE_NEW, name: 'admin' } }),
      create: () => Promise.resolve({ _id: USER_ID }),
    },
    roleModel: {},
    accessService: {
      getRole: () => Promise.resolve({ _id: ROLE_NEW, name: 'admin' }),
      getRequesterRank: () => Promise.resolve(3),
      ensureAllowedByRank: () => true,
      resolveGroups: (g: unknown) => Promise.resolve(g),
      ensureGroupSubset: () => undefined,
      ensurePermissionSubset: () => undefined,
      resolveAllowedHooksInput: () => Promise.resolve(undefined),
      sanitizeUser: (u: unknown) => u,
      // [FIX-20260818-RANKCALLSITES] update/deleteUser now ask whether the caller
      // outranks the target. These cases are about the AUDIT ROW, not about rank,
      // so the stub answers yes and the rank rule keeps its own spec
      // (user-admin-rank-callsites.spec.ts) rather than being asserted twice.
      mayActOnUser: () => Promise.resolve(true),
    },
    auditLogService: audit,
    // [FIX-20260820-SESSIONCEILING] the service now reads a config knob. This
    // stub hand-assembles its dependencies, so a new one has to be added here
    // too. 0 = the ceiling is off, which is what these cases assume.
    auth: { sessionMaxLifetimeMin: 0 },
  });

  return { service, audit, saved };
}

describe('[SECAUDIT] changing an account leaves a trace', () => {
  it('creating a user writes a create row for the new account', async () => {
    const { service, audit } = makeUsersService();

    await service.createUser(ADMIN, {
      username: 'newbie',
      password: 'irrelevant',
    });
    await flush();

    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.createAuditLog.mock.calls[0][0]).toMatchObject({
      action: 'create',
      parent: AUDIT_PARENT,
      ref_id: USER_ID,
      actor: { user_id: ADMIN.userId, username: 'boss' },
    });
  });

  it('⭐ changing a role writes an update row naming the old and new role', async () => {
    const { service, audit } = makeUsersService();

    await service.updateUser(USER_ID, ADMIN, { role_id: ROLE_NEW });
    await flush();

    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    const row = audit.createAuditLog.mock.calls[0][0];
    expect(row).toMatchObject({ action: 'update', parent: AUDIT_PARENT });
    expect(row.changed_fields).toEqual([
      { field: 'role', from: ROLE_OLD, to: ROLE_NEW },
    ]);
  });

  it('⭐ a password reset is recorded WITHOUT the password or its hash', async () => {
    const { service, audit } = makeUsersService();

    await service.updateUser(USER_ID, ADMIN, {
      password: 'brand new secret',
    });
    await flush();

    const row = audit.createAuditLog.mock.calls[0][0];
    expect(row.changed_fields).toEqual([
      { field: 'password', from: null, to: '[changed]' },
    ]);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('brand new secret');
    expect(serialized).not.toContain('$');
  });

  it('deactivating an account is recorded — it changes what the account can do', async () => {
    const { service, audit } = makeUsersService();

    await service.updateUser(USER_ID, ADMIN, { active: false });
    await flush();

    expect(audit.createAuditLog.mock.calls[0][0].changed_fields).toEqual([
      { field: 'active', from: true, to: false },
    ]);
  });

  it('an edit that changes nothing security-relevant writes NO row', async () => {
    // PIN against noise. An audit trail nobody can read is an audit trail nobody
    // reads, so renaming a display name must not fill it.
    const { service, audit } = makeUsersService();

    await service.updateUser(USER_ID, ADMIN, {
      display_name: 'Operator One (day shift)',
    });
    await flush();

    expect(audit.createAuditLog).not.toHaveBeenCalled();
  });

  it('deleting a user writes a delete row', async () => {
    const { service, audit, saved } = makeUsersService();
    Object.assign(saved, { role: { _id: ROLE_OLD, name: 'operator' } });

    await service.deleteUser(USER_ID, ADMIN);
    await flush();

    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.createAuditLog.mock.calls[0][0]).toMatchObject({
      action: 'delete',
      parent: AUDIT_PARENT,
      ref_id: USER_ID,
      actor: { user_id: ADMIN.userId },
    });
  });
});
