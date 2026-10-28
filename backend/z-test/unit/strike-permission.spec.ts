/**
 * [FEAT-20260824-STRIKESESSION] Reading and clearing are different privileges.
 *
 * Owner, 24/08: split the clear onto its own permission. This suite pins the
 * split at the only place it is expressed — the decorator metadata — because a
 * `@RequirePermissions` that is deleted, moved, or written on the wrong method
 * changes who can wipe a customer's record and breaks nothing else. No HTTP
 * test would notice: the module-scoped e2e has no auth guard at all.
 *
 * ⚠️ THE RULE THAT MAKES THIS CORRECT, and the one worth re-reading before
 * editing: a handler-level `@RequirePermissions` REPLACES the class-level one.
 * `PermissionsGuard` resolves it with
 * `reflector.getAllAndOverride(PERMISSIONS_KEY, [handler, class])`
 * (`src/common/guards/permissions.guard.ts:31-34`) — first match wins, so PATCH
 * requires `strike.manage` and NOT both. Anyone "fixing" this by adding
 * `'ticket.manage'` back onto the handler would silently widen the clear again.
 */
// Nest's decorators write their metadata through the reflect-metadata shim; a
// spec that reads it back has to load the shim itself, because nothing else in
// this file boots Nest.
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PERMISSIONS_KEY } from '@/common';
import { StrikeController } from '@/modules/strike';

const permsOn = (target: object | undefined): string[] | undefined =>
  target === undefined
    ? undefined
    : (Reflect.getMetadata(PERMISSIONS_KEY, target) as string[] | undefined);

describe('strike routes — who may read, who may clear', () => {
  it('reading is class-level ticket.manage', () => {
    expect(permsOn(StrikeController)).toEqual(['ticket.manage']);
  });

  it('clearing a session needs strike.manage, on the PATCH handler alone', () => {
    expect(permsOn(StrikeController.prototype.patch)).toEqual([
      'strike.manage',
    ]);
  });

  /* [FEAT-20260827-ADMINBLOCK] the block button is the same privilege as the
     clear button — owner: "สมมาตรกัน". Same replace-not-add decorator rule. */
  it('admin block needs strike.manage, on the POST suspend handler alone', () => {
    expect(permsOn(StrikeController.prototype.suspend)).toEqual([
      'strike.manage',
    ]);
  });

  /* The other half of the split: if a GET ever grows its own decorator, the
     class-level one stops applying to it and this notices. */
  it.each(['current', 'sessions', 'rollup', 'events'] as const)(
    'GET %s carries no handler-level override, so it inherits ticket.manage',
    (method) => {
      const handler = (
        StrikeController.prototype as unknown as Record<
          string,
          object | undefined
        >
      )[method];
      // a missing handler must fail loudly, not pass as "no permissions"
      expect(handler).toBeDefined();
      expect(permsOn(handler)).toBeUndefined();
    },
  );
});

describe('strike.manage reaches a fresh database', () => {
  const SEED = join(
    __dirname,
    '..',
    '..',
    'src',
    'modules',
    'admin',
    'acl-seed',
    'acl-seed.data.ts',
  );

  /**
   * ⚠️ This proves the string is SEEDED, not that anyone HAS it. `seedRoles` is
   * create-only (`acl-seeder.service.ts:176-179`), so on a database whose roles
   * already exist this changes nothing — there, superadmin and admin pass on
   * `system.manage` instead (`permissions.guard.ts:26`) and every other role has
   * to be granted the string by hand from the dashboard.
   * เทสนี้พิสูจน์แค่ว่า seed มีคำนี้ ไม่ได้พิสูจน์ว่าใครถืออยู่จริง
   */
  it('is granted to the two roles that already hold system.manage', () => {
    const source = readFileSync(SEED, 'utf8');
    const grants = source
      .split('\n')
      .filter((line) => line.trim() === "'strike.manage',");
    expect(grants).toHaveLength(2);
  });
});
