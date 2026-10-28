/**
 * [FIX-20260818-HOOKWRITESCOPE] Hook WRITES honour the per-user OA allowlist.
 *
 * ## The hole
 * `hooks.service.ts` scopes every hook operation through `ensureGroupAccess`,
 * which reads `getAllowedGroupIds(user)` and NEVER `allowed_hooks`. That is tier
 * 3 of the three-tier rule with tier 2 missing — the same drift already closed in
 * chat, tickets, slips, members, insight, customer-link and the outbound routes.
 *
 * Measured on the live database when this was written: three accounts
 * (`ticket`, `1231231`, `12312`) carry an `allowed_hooks` whitelist of four OAs
 * while their group holds six. So all three could **edit, toggle, clone and
 * DELETE** the two OAs they were explicitly provisioned away from — by id, with
 * the whitelist simply not consulted.
 *
 * That is strictly worse than the outbound gap fixed alongside it: that one sent
 * a message through someone else's OA, this one deletes it.
 *
 * ## Scope of THIS change — writes only, deliberately
 * The read/list sites (`getAllHooks`, `getHooksByGroup`, `getHookById`,
 * `loadHookAccessToken`) are NOT touched here. A list must be FILTERED rather
 * than refused, which changes what an operator SEES on screen rather than what
 * they may do, and that deserves its own round with its own before/after. Writes
 * can be refused outright, exactly as the outbound routes now are, so they are
 * separable and land first.
 *
 * ## Why it is additive
 * `ensureGroupAccess` is untouched. Its two messages are asserted by
 * `hook-labels.spec.ts`, `group-bulk-status.spec.ts` and `group-scope-clone.spec.ts`
 * and described in `hook-quota-token.spec.ts`; the new tier sits after it, so the
 * only new refusal is the case that leaks today.
 *
 * ## Who changes behaviour
 * Only an account holding an `allowed_hooks` array, and only for an OA outside
 * it. Super is unfiltered (`null` = no filter). `allowed_hooks: null` falls
 * through to the group rule unchanged — every account but the three above.
 */

import { ForbiddenException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Deep import, matching the sibling hook specs (`hook-quota-token`,
// `hook-update-blank-write`): HooksService is not on the module barrel, and
// adding it there for a test would be a wiring decision, not a test detail.
// eslint-disable-next-line no-restricted-imports
import { HooksService } from '@/modules/hooks/hooks.service';

const GROUP = 'a0d00000000000000000001e';
const ON_LIST = 'a0d00000000000000000005d';
const OFF_LIST = 'a0d00000000000000000005c'; // same group, NOT on the allowlist

type Harness = Record<string, unknown> & {
  deleteHook: (id: string, body: unknown, ctx: unknown) => Promise<unknown>;
  // (body, ctx) — the id lives IN the body, unlike deleteHook's positional one
  updateHookStatus: (body: unknown, ctx: unknown) => Promise<unknown>;
};

/** The three real accounts have exactly this shape. */
const WHITELISTED = {
  userId: 'a0d00000000000000000000a',
  username: 'ticket',
  roleName: 'assist_admin',
  groups: [GROUP],
  allowedHooks: [ON_LIST],
};

const GROUP_ONLY = { ...WHITELISTED, allowedHooks: null };
const SUPER = {
  userId: 'a0d00000000000000000005e',
  username: 'su',
  roleName: 'superadmin',
  groups: [],
  allowedHooks: null,
};

function makeService(hookId: string): Harness {
  const hook = { _id: hookId, group: GROUP, alias: 'target' };
  const svc = Object.create(HooksService.prototype) as Harness;
  Object.assign(svc, {
    hookModel: {
      findById: () => ({
        select: () => ({ lean: () => ({ exec: () => Promise.resolve(hook) }) }),
        lean: () => ({ exec: () => Promise.resolve(hook) }),
      }),
      // the group tier of getAllowedHookIds resolves through this
      find: () => ({
        select: () => ({
          lean: () => Promise.resolve([{ _id: ON_LIST }, { _id: OFF_LIST }]),
        }),
      }),
      findByIdAndUpdate: () => ({
        lean: () => ({ exec: () => Promise.resolve(hook) }),
      }),
      findByIdAndDelete: () => ({ exec: () => Promise.resolve(hook) }),
    },
    crypto: { safeDecrypt: (v: unknown) => v, encrypt: (v: unknown) => v },
  });
  return svc;
}

const OUT_OF_SCOPE = /insufficient OA access/;

describe('[HOOKWRITESCOPE] deleting an OA obeys the allowlist', () => {
  it('⭐ an OA in the caller`s group but NOT on their allowlist cannot be deleted', async () => {
    const svc = makeService(OFF_LIST);

    await expect(
      svc.deleteHook(OFF_LIST, {}, { user: WHITELISTED }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.deleteHook(OFF_LIST, {}, { user: WHITELISTED }),
    ).rejects.toThrow(OUT_OF_SCOPE);
  });

  it('an OA ON the allowlist is still deletable — the everyday case', async () => {
    const svc = makeService(ON_LIST);

    await expect(
      svc.deleteHook(ON_LIST, {}, { user: WHITELISTED }),
    ).rejects.not.toThrow(OUT_OF_SCOPE);
  });

  it('an account with NO allowlist is unchanged — the group rule alone decides', async () => {
    const svc = makeService(OFF_LIST);

    await expect(
      svc.deleteHook(OFF_LIST, {}, { user: GROUP_ONLY }),
    ).rejects.not.toThrow(OUT_OF_SCOPE);
  });

  it('a super user is unaffected — `null` means no filter', async () => {
    const svc = makeService(OFF_LIST);

    await expect(
      svc.deleteHook(OFF_LIST, {}, { user: SUPER }),
    ).rejects.not.toThrow(OUT_OF_SCOPE);
  });
});

describe('[HOOKWRITESCOPE] toggling an OA obeys the allowlist', () => {
  it('⭐ status of an off-allowlist OA cannot be toggled', async () => {
    const svc = makeService(OFF_LIST);

    await expect(
      svc.updateHookStatus({ id: OFF_LIST, status: 0 }, { user: WHITELISTED }),
    ).rejects.toThrow(OUT_OF_SCOPE);
  });

  it('an on-allowlist OA still toggles', async () => {
    const svc = makeService(ON_LIST);

    await expect(
      svc.updateHookStatus({ id: ON_LIST, status: 0 }, { user: WHITELISTED }),
    ).rejects.not.toThrow(OUT_OF_SCOPE);
  });
});

/**
 * A STRUCTURAL pin, not a behavioural one.
 *
 * The write sites are spread across six methods and two of them refuse inside a
 * loop that collects `blocked`/`results` rather than throwing. Driving every one
 * of them through a stub would need more scaffolding than the rule is worth, and
 * the failure mode that actually matters is a site being FORGOTTEN — today or by
 * the next person adding a seventh write path.
 *
 * So this reads the source and asserts the pairing directly. Comments are
 * stripped first, because the prose in this file names the very calls being
 * counted.
 */
describe('[HOOKWRITESCOPE] no write site is left on the group check alone', () => {
  const source = readFileSync(
    join(__dirname, '../../src/modules/hooks/hooks.service.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  /** The body of a method, from its declaration to the next one. */
  const bodyOf = (name: string): string => {
    const start = source.indexOf(`async ${name}(`);
    const next = source.indexOf('\n  async ', start + 1);
    const priv = source.indexOf('\n  private async ', start + 1);
    const end = Math.min(...[next, priv].filter((n) => n > -1));
    return source.slice(start, Number.isFinite(end) ? end : undefined);
  };

  it('every write method asks the allowlist at least once', () => {
    // Per METHOD, not per line: `deleteHook` asks after an if/else that picks
    // the group's shape, so a line-window heuristic calls it unguarded when it
    // is not. The method body is the honest unit.
    for (const method of [
      'updateHook',
      'updateHookStatus',
      'deleteHook',
      'cloneHookSettings',
      'loadBulkTargets',
    ]) {
      expect(bodyOf(method)).toContain('assertHookInScope');
    }
  });

  it('createHook is exempt, and that is a decision rather than an omission', () => {
    // There is no existing OA to place in scope — the group check is the whole
    // question at creation time. Pinned so the exemption stays deliberate.
    const body = bodyOf('createHook');
    expect(body).toContain('this.ensureGroupAccess(');
    expect(body).not.toContain('assertHookInScope');
  });

  it('the READ paths are untouched this round, deliberately', () => {
    // Listing must be FILTERED, not refused, so it changes what an operator SEES
    // and belongs in its own round. If one of these gains the check without a
    // spec describing the new list behaviour, this goes red on purpose.
    for (const method of ['getAllHooks', 'getHooksByGroup']) {
      expect(bodyOf(method)).not.toContain('assertHookInScope');
    }
  });
});
