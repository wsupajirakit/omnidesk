/**
 * [FEAT-20260816-TAGSCOPE] — the tag-filter options are scoped by the caller's
 * OA permission
 * ============================================================================
 * Before this change the endpoint was GLOBAL — the FE comment of 01/08 claiming
 * "the BE already filters by the caller's group" was never true. This suite
 * makes that claim real:
 *
 *   - superadmin        → distinct('tag_id') exactly as before (no filter —
 *                         sees every in-use tag)
 *   - admin with groups → counts only customer_tags rows whose hook_id belongs
 *                         to an OA of the caller's groups (the same rule the
 *                         ticket list uses for scoping)
 *   - no groups / no auth → fail-closed: $in [] = no options (must never fall
 *                         back to global)
 *
 * ⚠️ Scope: only the "in-use ids that seed the options" changes — sort/limit/
 *    shape and [FIX-20260814-TAGINUSEONLY] (count real rows, never trust
 *    use_count) stay exactly as they were.
 */
import { ChatService } from '@/modules/chat';
import type { AuthenticatedUser } from '@/common';

interface Chain {
  find: jest.Mock;
  select: jest.Mock;
  sort: jest.Mock;
  limit: jest.Mock;
  lean: jest.Mock;
}
/** Mocks a mongoose query chain — ends at lean() resolving to rows. */
function chain(rows: unknown[]): Chain {
  const c: Chain = {
    find: jest.fn(() => c),
    select: jest.fn(() => c),
    sort: jest.fn(() => c),
    limit: jest.fn(() => c),
    lean: jest.fn(() => Promise.resolve(rows)),
  };
  return c;
}

function makeService(opts: {
  tags?: unknown[];
  inUseIds?: unknown[];
  groupHooks?: { _id: string }[];
}) {
  const tagModel = chain(opts.tags ?? []);
  const distinct = jest.fn().mockResolvedValue(opts.inUseIds ?? []);
  const customerTagModel = { distinct };
  // getAllowedHookIds (chat.service's own copy) calls hookModel.find({group:{$in}})
  const hookModel = chain(opts.groupHooks ?? []);

  const svc = Object.create(ChatService.prototype) as ChatService;
  Object.assign(svc, { tagModel, customerTagModel, hookModel });
  return { svc, tagModel, customerTagModel, hookModel, distinct };
}

const GROUP = 'a0d00000000000000000001e';
const HOOK_A = 'a0d00000000000000000005d';
const HOOK_B = 'a0d00000000000000000002e';

function admin(over: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    userId: 'u1',
    roleId: 'r1',
    roleName: 'admin',
    permissions: ['ticket.manage'],
    username: 'scoped',
    displayName: 'Scoped Admin',
    tokenVersion: 0,
    groups: [GROUP],
    allowedHooks: null,
    ...over,
  };
}

describe('[TAG SCOPE] listPopularTags scopes by OA permission', () => {
  it('⭐ superadmin → the untouched original query, no filter (sees every in-use tag)', async () => {
    const { svc, distinct, hookModel } = makeService({ inUseIds: ['t1'] });

    await svc.listPopularTags(
      { limit: '20' },
      admin({ roleName: 'superadmin' }),
    );

    // Must be the exact [FIX-20260814-TAGINUSEONLY] call, not an empty filter —
    // distinct('tag_id', {}) means the same today but no longer reads as
    // "deliberately unscoped".
    expect(distinct).toHaveBeenCalledWith('tag_id');
    // superadmin never pays the group→hooks lookup
    expect(hookModel.find).not.toHaveBeenCalled();
  });

  it('⭐ admin with a group → counts only rows whose hook_id is one of the group OAs', async () => {
    const { svc, distinct, hookModel } = makeService({
      inUseIds: ['t1'],
      groupHooks: [{ _id: HOOK_A }, { _id: HOOK_B }],
    });

    await svc.listPopularTags({ limit: '20' }, admin());

    expect(hookModel.find).toHaveBeenCalledWith({ group: { $in: [GROUP] } });
    expect(distinct).toHaveBeenCalledWith('tag_id', {
      hook_id: { $in: [HOOK_A, HOOK_B] },
    });
  });

  it('⭐ no groups → fail-closed: $in [], never a fallback to global', async () => {
    const { svc, distinct } = makeService({});

    const out = (await svc.listPopularTags(
      { limit: '20' },
      admin({ groups: [] }),
    )) as { data: unknown[] };

    expect(distinct).toHaveBeenCalledWith('tag_id', { hook_id: { $in: [] } });
    expect(out.data).toEqual([]);
  });

  it('⭐ no auth at all (internal/test callers) → fail-closed like no groups', async () => {
    const { svc, distinct } = makeService({});

    await svc.listPopularTags({ limit: '20' });

    expect(distinct).toHaveBeenCalledWith('tag_id', { hook_id: { $in: [] } });
  });

  it('with scoping active, in-use filtering + sort/limit/shape stay exactly as before', async () => {
    const TAG = { _id: 't1', label: 'VIP', color: 'red', use_count: 3 };
    const { svc, tagModel } = makeService({
      tags: [TAG],
      inUseIds: ['t1'],
      groupHooks: [{ _id: HOOK_A }],
    });

    const out = (await svc.listPopularTags({ limit: '5' }, admin())) as {
      success: boolean;
      data: unknown[];
    };

    // The second layer (tags that are in use) is unchanged — TAGINUSEONLY as-is
    expect(tagModel.find).toHaveBeenCalledWith({ _id: { $in: ['t1'] } });
    expect(tagModel.sort).toHaveBeenCalledWith({
      use_count: -1,
      last_used_at: -1,
    });
    expect(tagModel.limit).toHaveBeenCalledWith(5);
    expect(out).toEqual({
      success: true,
      data: [{ _id: 't1', label: 'VIP', color: 'red', use_count: 3 }],
    });
  });
});
