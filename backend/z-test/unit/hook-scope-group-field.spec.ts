/**
 * [FIX-20260818-GROUPFIELD] The OA scope query asks for the field the Hook
 * collection actually has.
 *
 * ## What was broken, and who felt it
 * Two callers filtered hooks by `group_id`. The Hook schema declares `group`
 * (`hook.schema.ts:371`, indexed at `:834`) and never `group_id`; live data
 * agrees — 7 hooks, 7 with `group`, 0 with `group_id`. So the query matched
 * nothing, tier 3 returned `[]`, and `[]` means "no OA at all", not "no filter".
 *
 * The people who felt it are the four assist_admin accounts that hold
 * `broadcast.manage` / `auto_reply.manage` — `ticket`, `test_ticket`, `1231231`,
 * `12312`. They could open the Broadcast and Auto Reply screens, saw an empty
 * list, and every save was refused. Not a permission failure: they reached the
 * handler and were turned away inside it.
 *
 * ## The two sites needed DIFFERENT fixes, and that is the point
 *
 * SITE A — `content/content-oa-access.util.ts`. A pure field-name typo. Every
 * other line already matched the canonical resolver, so the copy is replaced by
 * a re-export rather than patched: same behaviour, one less copy.
 *
 * SITE B — `audit/audit-log.controller.ts`. The same typo PLUS no
 * `allowed_hooks` tier at all — it goes straight from `isSuperUser` to the group
 * query. Renaming the field there would turn a 403 into an OVER-BROAD 200 and
 * re-open exactly the leak `[FIX-20260808-ACLWHITELIST]` closed. So it delegates
 * to the shared three-tier rule instead.
 *
 * That asymmetry is why this is one change and not two one-character edits.
 *
 * ## What the collapse does NOT lose
 * The copy also filtered `deleted_at: { $exists: false }`. That is dead: the Hook
 * schema declares no `deleted_at`, and `deleteHook` is a hard
 * `findByIdAndDelete` (`hooks.service.ts:2930`). It filtered on a field that
 * cannot exist, so dropping it changes nothing — checked before removing it,
 * not assumed.
 */

import { ForbiddenException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AuthenticatedUser } from '@/common';
import { getAllowedHookIds } from '@/modules/hooks';
// Deep import, matching how the sibling audit spec reaches this controller: it
// is on the barrel, but the controller's own collaborators are stubbed here.
import { AuditLogController } from '@/modules/audit';
// eslint-disable-next-line no-restricted-imports
import { getAllowedHookIds as contentGetAllowedHookIds } from '@/modules/content/content-oa-access.util';

const GROUP = 'a0d00000000000000000001e';
const IN_GROUP = 'a0d00000000000000000005d';
const ALSO_IN_GROUP = 'a0d00000000000000000005c';

/** The four real accounts locked out of Broadcast and Auto Reply. */
const TIER3: AuthenticatedUser = {
  userId: 'a0d00000000000000000000a',
  username: 'test_ticket',
  roleName: 'assist_admin',
  groups: [GROUP],
} as unknown as AuthenticatedUser;

/** Provisioned for ONE OA — the tier the audit controller never had. */
const WHITELISTED: AuthenticatedUser = {
  ...TIER3,
  username: 'ticket',
  allowedHooks: [IN_GROUP],
};

const SUPER: AuthenticatedUser = {
  userId: 'a0d00000000000000000005e',
  username: 'su',
  roleName: 'superadmin',
  groups: [],
} as unknown as AuthenticatedUser;

/** Answers only when asked for the field the collection really has. */
function hookModel(): { find: unknown; findOne: unknown } {
  const rows = [{ _id: IN_GROUP }, { _id: ALSO_IN_GROUP }];
  const matches = (filter: Record<string, unknown>): boolean =>
    Object.prototype.hasOwnProperty.call(filter, 'group');
  return {
    find: (filter: Record<string, unknown>) => ({
      select: () => ({
        lean: () => Promise.resolve(matches(filter) ? rows : []),
      }),
    }),
    /**
     * Answers for BOTH hooks in the group, not just one.
     *
     * The first version answered only for IN_GROUP, which meant the
     * whitelist case below was refused by the STUB rather than by the rule —
     * and a mutation that stripped the whitelist tier out of the controller
     * still passed all eleven cases. Caught by running that mutation rather
     * than by reading the test. stub ต้องไม่เป็นตัวปฏิเสธเสียเอง
     */
    findOne: (filter: Record<string, unknown>) => ({
      select: () => ({
        lean: () =>
          Promise.resolve(
            matches(filter) &&
              [IN_GROUP, ALSO_IN_GROUP].includes(String(filter['_id']))
              ? { _id: String(filter['_id']) }
              : null,
          ),
      }),
    }),
  };
}

describe('[GROUPFIELD] site A — the content scope resolver', () => {
  it('⭐ a group-scoped account gets its group`s OAs, not an empty list', async () => {
    // This empty list is the whole bug: [] is "no OA at all", and every
    // broadcast/auto-reply write compares against it and refuses.
    const allowed = await contentGetAllowedHookIds(TIER3, hookModel() as never);

    expect(allowed).not.toBeNull();
    expect(allowed).toEqual([IN_GROUP, ALSO_IN_GROUP]);
  });

  it('a super user is still unfiltered', async () => {
    const allowed = await contentGetAllowedHookIds(SUPER, hookModel() as never);
    expect(allowed).toBeNull();
  });

  it('an account with a whitelist still gets exactly its whitelist', async () => {
    const allowed = await contentGetAllowedHookIds(
      WHITELISTED,
      hookModel() as never,
    );
    expect(allowed).toEqual([IN_GROUP]);
  });

  it('an account with no group at all still gets nothing — fail closed', async () => {
    const allowed = await contentGetAllowedHookIds(
      { ...TIER3, groups: [] },
      hookModel() as never,
    );
    expect(allowed).toEqual([]);
  });

  it('it answers identically to the canonical resolver', async () => {
    // After the collapse these are the same function. Pinned so a future edit
    // cannot quietly re-fork them.
    const a = await contentGetAllowedHookIds(TIER3, hookModel() as never);
    const b = await getAllowedHookIds(TIER3, hookModel() as never);
    expect(a).toEqual(b);
  });
});

describe('[GROUPFIELD] site B — the audit log`s OA filter', () => {
  function makeController(): AuditLogController {
    return new AuditLogController(
      {} as never, // auditLogService
      hookModel() as never,
      {} as never, // queryCache
    );
  }

  /** The private guard the list endpoint calls when `?hook_id=` is present. */
  type Ensure = (user: unknown, hookId: string) => Promise<void>;
  const ensure = (c: AuditLogController): Ensure =>
    (c as unknown as { ensureHookAccess: Ensure }).ensureHookAccess.bind(c);

  it('⭐ a group-scoped account can filter by an OA in its own group', async () => {
    await expect(
      ensure(makeController())(TIER3, IN_GROUP),
    ).resolves.toBeUndefined();
  });

  it('⭐ a whitelisted account is refused an OA OUTSIDE its whitelist', async () => {
    // The tier this controller never had. A field-name-only fix would have made
    // this ALLOWED — over-broad, and exactly the leak [FIX-20260808-ACLWHITELIST]
    // was written to close.
    await expect(
      ensure(makeController())(WHITELISTED, ALSO_IN_GROUP),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a whitelisted account still reaches an OA ON its whitelist', async () => {
    await expect(
      ensure(makeController())(WHITELISTED, IN_GROUP),
    ).resolves.toBeUndefined();
  });

  it('a super user is unaffected', async () => {
    await expect(
      ensure(makeController())(SUPER, ALSO_IN_GROUP),
    ).resolves.toBeUndefined();
  });

  it('an account with no group is still refused — fail closed', async () => {
    await expect(
      ensure(makeController())({ ...TIER3, groups: [] }, IN_GROUP),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/**
 * The same root defect, in the other direction: three writers READ `group_id`
 * off a Hook document. The Hook has no such field, so they stamped `group_id:
 * null` onto every `webhook_logs` row they created.
 *
 * `webhook_logs` genuinely declares `group_id` (`webhook-log.schema.ts:35`) —
 * the column is real, the value was not. The paths that get it right read
 * `hook['group']` and write it into `group_id`
 * (`webhook.service.ts:916,1084` · `chat-media.service.ts:479`).
 *
 * Structural, not behavioural: driving each writer through a stub would need
 * three unrelated harnesses, and the failure that matters is a writer reading
 * the wrong side — which the source shows directly.
 */
describe('[GROUPFIELD] a webhook_logs row carries the OA`s real group', () => {
  const read = (p: string): string =>
    readFileSync(join(__dirname, '../../src/modules/', p), 'utf8')
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

  it('no writer reads group_id off a hook document', () => {
    for (const file of [
      'customer-link/customer-link.service.ts',
      'external/custom-tool.service.ts',
    ]) {
      const src = read(file);
      // A hook is held as `h` or `hook` at these sites. Reading `group_id` off
      // either is reading a field the schema does not declare.
      expect(src).not.toMatch(/\bh\['group_id'\]/);
      expect(src).not.toMatch(/\bhook\?\.group_id\b/);
      expect(src).not.toMatch(/\bhook\.group_id\b/);
    }
  });
});
