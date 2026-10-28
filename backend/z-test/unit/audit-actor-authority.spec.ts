/**
 * [FIX-20260818-AUDITACTOR] The audit trail says who the TOKEN says you are.
 * plan §2.2b M21 · audit_18_aug M21 (`audit-log.service.ts:154-193`)
 *
 * WHAT WAS WRONG. `POST /audit/logs` handed `req.body` to the service untouched,
 * and the service read the author of the entry out of that body:
 *
 *     if (!actor?.user_id) throw new BadRequestException(...)
 *     const normalizedActor = { user_id: actor.user_id, ... }
 *
 * So any authenticated caller could write a row attributing an action to a
 * colleague. That is worse than having no audit log: an empty trail is known to
 * be empty, while a forged one is read as evidence. The finding's own words —
 * "โยนความผิดให้ operator คนอื่นได้".
 *
 * WHY THE FIX IS IN THE CONTROLLER, NOT THE SERVICE. `createAuditLog` has ~30
 * internal callers (content, hooks, tickets, slip) that pass `buildActor(user)`,
 * already derived from `@CurrentUser()`. They are trusted and must keep working.
 * Exactly one caller is reachable from outside — this route — so that is where
 * the body stops being believed.
 *
 * These cases pin the rule at the route: the body's `actor` is IGNORED and the
 * authenticated caller is used, whatever the body claims.
 */

import type { AuthenticatedUser } from '@/common';
import { AuditLogController } from '@/modules/audit';

const CALLER: AuthenticatedUser = {
  userId: 'a0d00000000000000000000a',
  username: 'op1',
  displayName: 'Operator One',
  roleName: 'admin',
  groups: [],
} as unknown as AuthenticatedUser;

/** A different, real operator — the one a forged row would blame. */
const VICTIM_ID = 'a0d00000000000000000001a';

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
  const hookModel = {} as never;
  const queryCache = {} as never;
  const controller = new AuditLogController(
    audit as never,
    hookModel,
    queryCache,
  );
  return { controller, audit };
}

/**
 * Called through a widened signature ON PURPOSE. The pre-fix controller takes
 * one argument, so a directly-typed call would fail to COMPILE rather than fail
 * an assertion — and a red that never reached the assertion proves nothing about
 * the assertion. This shape runs against both versions, so the case goes red on
 * "the row names the victim", which is the defect in its own words.
 */
type CreateLog = (body: unknown, user: unknown) => Promise<unknown>;

describe('[FIX-20260818-AUDITACTOR] POST /audit/logs takes its actor from the token', () => {
  it('a body naming someone else is ignored — the row names the caller', async () => {
    const { controller, audit } = makeController();

    await (controller.createLog.bind(controller) as CreateLog)(
      {
        ref_id: 'a0d00000000000000000001b',
        action: 'create',
        parent: 'flex_message',
        // the forgery: a real colleague's id, supplied by the attacker
        actor: {
          user_id: VICTIM_ID,
          username: 'someone-else',
          display_name: 'Someone Else',
        },
      },
      CALLER,
    );

    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    const written = audit.createAuditLog.mock.calls[0][0];
    expect(written.actor.user_id).toBe(CALLER.userId);
    expect(written.actor.username).toBe('op1');
    expect(written.actor.display_name).toBe('Operator One');
  });

  it('a body with no actor still produces a row — the token supplies it', async () => {
    // This is the FE's fallback path: `auditService.ts` retries WITHOUT `actor`
    // when the first attempt is refused, so the route must not need the field.
    const { controller, audit } = makeController();

    await (controller.createLog.bind(controller) as CreateLog)(
      { ref_id: 'a0d00000000000000000001b', action: 'create' },
      CALLER,
    );

    expect(audit.createAuditLog.mock.calls[0][0].actor).toMatchObject({
      user_id: CALLER.userId,
      username: 'op1',
    });
  });

  it('everything else in the body is passed through unchanged', async () => {
    // PIN: the fix must replace the actor and touch nothing else. Legacy accepts
    // unknown fields and lets the schema drop them, which is why there is no DTO
    // here (see the controller header) — narrowing the body is a separate,
    // breaking decision and is not what this fix does.
    const { controller, audit } = makeController();

    await (controller.createLog.bind(controller) as CreateLog)(
      {
        ref_id: 'a0d00000000000000000001b',
        hook_id: 'a0d00000000000000000001c',
        group_id: 'a0d00000000000000000001d',
        parent: 'flex_message',
        action: 'update',
        changed_fields: [{ field: 'name', from: 'a', to: 'b' }],
        note: 'kept',
        version: 3,
      },
      CALLER,
    );

    expect(audit.createAuditLog.mock.calls[0][0]).toMatchObject({
      ref_id: 'a0d00000000000000000001b',
      hook_id: 'a0d00000000000000000001c',
      group_id: 'a0d00000000000000000001d',
      parent: 'flex_message',
      action: 'update',
      changed_fields: [{ field: 'name', from: 'a', to: 'b' }],
      note: 'kept',
      version: 3,
    });
  });

  it('no authenticated caller ⇒ no actor invented, and the service refuses', async () => {
    // The route sits behind the global JwtAuthGuard, so this cannot happen over
    // HTTP. It is pinned anyway because the failure mode matters: inventing a
    // 'system' actor here would let an unauthenticated path write rows that read
    // as legitimate. Absent caller ⇒ absent actor ⇒ the service's existing
    // `actor.user_id is required` answers 400. Fail closed, do not fill in.
    const { controller, audit } = makeController();

    await (controller.createLog.bind(controller) as CreateLog)(
      {
        ref_id: 'a0d00000000000000000001b',
        action: 'create',
        actor: { user_id: VICTIM_ID },
      },
      undefined,
    );

    expect(audit.createAuditLog.mock.calls[0][0].actor).toBeUndefined();
  });
});
