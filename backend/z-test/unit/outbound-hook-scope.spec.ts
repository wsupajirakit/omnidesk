/**
 * [FIX-20260818-OUTBOUNDSCOPE] The outbound routes honour the per-user OA
 * allowlist, not just the group. audit_18_aug H9.
 *
 * ## What H9 actually is, after reading the code
 * The finding reads "POST /hook/:id/push has no permission check". Two separate
 * things are true, and only one of them is fixable today:
 *
 *   1. NO @RequirePermissions — deliberate, and documented in
 *      `hooks.controller.ts:15-21`: the accounts in real use do not hold
 *      `hook.manage` in their own claim, only their role does, and the guard
 *      reads the claim. Adding the decorator 403s exactly the people who use
 *      these screens. That half stays with the permission model (T3-1).
 *
 *   2. The scope check is GROUP-ONLY — `ensureGroupAccess`, tier 3 of the
 *      three-tier rule. The `allowed_hooks` tier is missing, so an operator
 *      provisioned for ONE OA can fire an outbound push, an external-API probe
 *      or an arbitrary endpoint execution through ANY OA in their group. That is
 *      the same missing middle tier this codebase has now closed in chat,
 *      tickets, slips, members, insight and customer-link.
 *
 * This spec pins (2). It is the half that actually stops cross-OA abuse: spam in
 * another customer's brand name, and their LINE push quota spent.
 *
 * ## Why it is additive rather than a rewrite
 * `ensureGroupAccess` keeps its exact behaviour and its exact messages —
 * "group access is required" and "insufficient group access" are asserted by
 * `hook-labels.spec.ts`, `group-bulk-status.spec.ts`, `group-scope-clone.spec.ts`
 * and described in `hook-quota-token.spec.ts`. The new tier is a separate check
 * placed after it, so no pinned message moves and the only new refusal is the
 * case that is a leak today.
 *
 * ## Who changes behaviour
 * Only an account that HAS an `allowed_hooks` array and aims at an OA outside
 * it. A super user is unaffected (`null` = no filter). An account with
 * `allowed_hooks: null` falls through to the group rule exactly as before, which
 * is every account except the three provisioned with a whitelist.
 */

import { ForbiddenException } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common';
import { HookOutboundService } from '@/modules/external';

const GROUP = 'a0d00000000000000000001e';
const IN_SCOPE = 'a0d00000000000000000005d'; // on the allowlist
const SAME_GROUP_OFF_LIST = 'a0d00000000000000000005c'; // same group, NOT on it

/** An operator provisioned for one OA — the shape three real accounts have. */
const WHITELISTED: AuthenticatedUser = {
  userId: 'a0d00000000000000000000a',
  username: 'ticket',
  displayName: 'Ticket',
  roleName: 'assist_admin',
  groups: [GROUP],
  allowedHooks: [IN_SCOPE],
} as unknown as AuthenticatedUser;

/** No allowlist at all — the group rule alone decides, exactly as before. */
const GROUP_ONLY: AuthenticatedUser = {
  ...WHITELISTED,
  username: 'flex_m',
  allowedHooks: null,
};

const SUPER: AuthenticatedUser = {
  userId: 'a0d00000000000000000005e',
  username: 'su',
  roleName: 'superadmin',
  groups: [],
  allowedHooks: null,
} as unknown as AuthenticatedUser;

function makeService(hookId: string): HookOutboundService {
  const hook = {
    _id: hookId,
    group: GROUP,
    channel_type: 'line',
    line_key: 'x'.repeat(40),
    access_token: 'y'.repeat(40),
  };
  const service = Object.create(
    HookOutboundService.prototype,
  ) as HookOutboundService;
  Object.assign(service, {
    hookModel: {
      findById: () => ({
        lean: () => ({ exec: () => Promise.resolve(hook) }),
      }),
      // getAllowedHookIds resolves the group tier through this
      find: () => ({
        select: () => ({
          lean: () =>
            Promise.resolve([{ _id: IN_SCOPE }, { _id: SAME_GROUP_OFF_LIST }]),
        }),
      }),
    },
    webhookLogModel: { create: () => Promise.resolve({}) },
    customToolModel: {},
    crypto: { decrypt: (v: unknown) => String(v) },
    systemConfig: {},
    externalApi: {},
    customTool: {},
  });
  return service;
}

/**
 * [FIX-20260820-KILLDEADPUSH] this used to drive `pushMessage`, and that route is
 * gone. The RULE it tests is not: the same allowlist tier guards
 * `testExternalApi` (service :534 at the time) and `executeExternalEndpoint`
 * (:807), both of which the dashboard calls every day. Re-pointing it at a LIVE
 * route is what keeps audit H9 covered — deleting the spec with the route would
 * have removed the only test of a security rule that still guards two callers.
 * ย้ายเทสไปเกาะ route ที่ยังมีชีวิต · กฎ H9 ยังต้องมีคนคุม.
 *
 * `testExternalApi` refuses on scope BEFORE it looks at the body, exactly as
 * `pushMessage` did, so the assertions below are unchanged.
 */
const push = (
  service: HookOutboundService,
  hookId: string,
  user: AuthenticatedUser,
) => service.testExternalApi(hookId, {}, user);

describe('[OUTBOUNDSCOPE] the allowlist tier on the outbound routes (audit H9)', () => {
  it('⭐ an OA in the caller`s GROUP but not on their allowlist is refused', async () => {
    // The leak: three real accounts are provisioned for four OAs each while
    // their group holds seven. Before this, all seven could be pushed through.
    const service = makeService(SAME_GROUP_OFF_LIST);

    await expect(
      push(service, SAME_GROUP_OFF_LIST, WHITELISTED),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an OA ON the allowlist still works — the everyday case', async () => {
    const service = makeService(IN_SCOPE);

    // Reaches the LINE send (which fails on a fake token) rather than being
    // refused by scope. Anything that is NOT a scope refusal proves the point.
    await expect(push(service, IN_SCOPE, WHITELISTED)).rejects.not.toThrow(
      /insufficient OA access/,
    );
  });

  it('an account with NO allowlist is unchanged — the group rule alone decides', async () => {
    const service = makeService(SAME_GROUP_OFF_LIST);

    await expect(
      push(service, SAME_GROUP_OFF_LIST, GROUP_ONLY),
    ).rejects.not.toThrow(/insufficient OA access/);
  });

  it('a super user is unaffected — `null` means no filter, not no access', async () => {
    const service = makeService(SAME_GROUP_OFF_LIST);

    await expect(push(service, SAME_GROUP_OFF_LIST, SUPER)).rejects.not.toThrow(
      /insufficient OA access/,
    );
  });
});
