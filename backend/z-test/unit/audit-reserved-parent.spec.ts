/**
 * [FIX-20260819-AUDITRESERVED] `POST /audit/logs` may not write a SECURITY row.
 *
 * WHAT IS WRONG. The route carries no `@RequirePermissions` — deliberately, and
 * the controller header says why: legacy sits these three endpoints behind
 * `requireApiAuth` alone, so adding one would reject callers legacy admits.
 * That decision is not revisited here.
 *
 * The consequence is that ANY authenticated operator can POST a row. Since
 * [FIX-20260818-SECAUDIT] the login / create-account / role-change / password
 * trail is written with `parent: SECURITY_AUDIT_PARENT`
 * (`security-events.ts:47`, value `'user'`), and the LIST endpoint filters on
 * exactly that value. So an operator could POST a hand-written row into the
 * security category and it would read as evidence of a sign-in that never
 * happened — the same class of harm as the forged `actor` that
 * [FIX-20260818-AUDITACTOR] closed, one field over.
 *
 * WHY THE REFUSAL IS IN THE CONTROLLER, NOT THE SERVICE. `recordUserSecurityEvent`
 * calls `createAuditLog` DIRECTLY with that parent and is the legitimate writer of
 * those rows. A service-level rule would silence the real security trail. Exactly
 * one caller is reachable from outside — this route — so that is where it stops.
 *
 * THE DASHBOARD IS NOT AFFECTED. Every `POST /audit/logs` in the dashboard goes
 * through `services/admin/auditService.ts::createHookAuditLog`, whose six call
 * sites send `parent: 'hook'` (HookFormPage x2, WebhookList x3) or
 * `parent: 'line_user'` (TicketSupport x1). None sends `'user'`. The last two
 * cases below pin those two literals so the refusal can never grow into them.
 */

import { ForbiddenException } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common';
import { AuditLogController, SECURITY_AUDIT_PARENT } from '@/modules/audit';

const CALLER: AuthenticatedUser = {
  userId: 'a0d00000000000000000000a',
  username: 'op1',
  displayName: 'Operator One',
  roleName: 'admin',
  groups: [],
} as unknown as AuthenticatedUser;

function makeController(): {
  controller: AuditLogController;
  audit: { createAuditLog: jest.Mock };
} {
  const audit = {
    createAuditLog: jest.fn().mockResolvedValue({
      _id: 'a1',
      toObject: () => ({ created_at: 'now' }),
    }),
  };
  const controller = new AuditLogController(
    audit as never,
    {} as never,
    {} as never,
  );
  return { controller, audit };
}

/** Widened on purpose — same reason as audit-actor-authority.spec.ts:67. */
type CreateLog = (body: unknown, user: unknown) => Promise<unknown>;

describe('[FIX-20260819-AUDITRESERVED] the reserved security category is not writable over HTTP', () => {
  it('the constant this rule is keyed off is the real one', () => {
    // PIN: if the security helper ever renames its parent, this case fails here
    // rather than silently leaving the category open again.
    expect(SECURITY_AUDIT_PARENT).toBe('user');
  });

  it('a write into the reserved security category is refused, and never reaches the service', async () => {
    const { controller, audit } = makeController();

    await expect(
      (controller.createLog.bind(controller) as CreateLog)(
        {
          ref_id: 'a0d00000000000000000001b',
          action: 'login',
          parent: SECURITY_AUDIT_PARENT,
          note: 'a sign-in that never happened',
        },
        CALLER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(audit.createAuditLog).not.toHaveBeenCalled();
  });

  it("an ordinary write (parent 'hook') still succeeds untouched", async () => {
    const { controller, audit } = makeController();

    const result = await (controller.createLog.bind(controller) as CreateLog)(
      {
        ref_id: 'a0d00000000000000000001b',
        hook_id: 'a0d00000000000000000001c',
        parent: 'hook',
        action: 'update',
        changed_fields: [{ field: 'name', from: 'a', to: 'b' }],
        note: 'kept',
      },
      CALLER,
    );

    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.createAuditLog.mock.calls[0][0]).toMatchObject({
      ref_id: 'a0d00000000000000000001b',
      hook_id: 'a0d00000000000000000001c',
      parent: 'hook',
      action: 'update',
      note: 'kept',
    });
    expect(result).toEqual({ data: { _id: 'a1', created_at: 'now' } });
  });

  it("the dashboard's other literal (parent 'line_user') still succeeds", async () => {
    const { controller, audit } = makeController();

    await (controller.createLog.bind(controller) as CreateLog)(
      {
        ref_id: 'a0d00000000000000000001b',
        parent: 'line_user',
        action: 'update',
        changed_fields: [{ field: 'nickname', from: 'a', to: 'b' }],
      },
      CALLER,
    );

    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('a body with no parent at all still succeeds', async () => {
    // The FE minimal-retry body may carry `parent: undefined`; the rule must
    // match the reserved VALUE, never "the field is absent".
    const { controller, audit } = makeController();

    await (controller.createLog.bind(controller) as CreateLog)(
      { ref_id: 'a0d00000000000000000001b', action: 'create' },
      CALLER,
    );

    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
  });
});
