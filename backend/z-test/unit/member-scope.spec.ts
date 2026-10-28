/**
 * [FIX-20260818-MEMBERSCOPE] plan §8 = T3-3 of fix_plan_18_aug
 *
 * ## Why this one is different from every other batch in the sweep
 * Every other row carried a `hook_id` to compare against. A member row does NOT —
 * 0 of 130 in the live data have the field, because a person is not owned by an
 * OA; a CONVERSATION is. So "may this caller touch this member" can only be
 * answered by a join: does the caller share a room with them?
 *
 * That makes the failure mode different too. A field check can only be wrong
 * about authority; a join can be wrong about REACHABILITY — a member whose rooms
 * all sit outside the caller's scope becomes 403 rather than editable. That is
 * correct, and it is why the cases below pin both directions explicitly.
 *
 * ⚠️ The webhook path does not use this service — `MembersService` is not
 * imported anywhere under `src/modules/webhook/` (checked before the change), so
 * no inbound LINE traffic can be refused by this guard.
 */
import { ForbiddenException } from '@nestjs/common';

import { MembersService } from '@/modules/chat';

const OA_A = 'a0d000000000000000000043';
const MEMBER = 'a0d000000000000000000045';

/**
 * @param sharedRoom what `chatRoomModel.exists` answers — a room joining the
 *   caller's OAs to this member, or nothing.
 */
const buildService = (sharedRoom: unknown) => {
  const seen: { existsFilter?: Record<string, unknown> } = {};
  const svc = Object.create(MembersService.prototype) as Record<
    string,
    unknown
  >;
  svc.memberModel = {
    findByIdAndUpdate: () => ({ lean: () => Promise.resolve({ _id: MEMBER }) }),
    findById: () => ({ lean: () => Promise.resolve({ _id: MEMBER }) }),
  };
  svc.hookModel = {
    find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
  };
  svc.chatRoomModel = {
    exists: (filter: Record<string, unknown>) => {
      seen.existsFilter = filter;
      return Promise.resolve(sharedRoom);
    },
  };
  return { svc: svc as unknown as MembersService, seen };
};

const operatorOfA = {
  roleName: 'operator',
  groups: [],
  allowedHooks: [OA_A],
} as never;

describe('[MEMBERSCOPE] a member is reachable only through a shared room', () => {
  it('⭐ no shared room ⇒ refused', async () => {
    const { svc } = buildService(null);
    await expect(
      svc.updateNickname(MEMBER, { nickname: 'x' }, operatorOfA),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('⭐ the join asks for the caller’s OAs, not for a field on the member', async () => {
    const { svc, seen } = buildService({ _id: 'room1' });
    await svc.updateNickname(MEMBER, { nickname: 'x' }, operatorOfA);
    expect(seen.existsFilter).toMatchObject({
      user_id: MEMBER,
      hook_id: { $in: [OA_A] },
    });
  });

  it('a shared room ⇒ the edit proceeds, unchanged', async () => {
    const { svc } = buildService({ _id: 'room1' });
    await expect(
      svc.updateNickname(MEMBER, { nickname: 'x' }, operatorOfA),
    ).resolves.toBeDefined();
  });

  it('a super user skips the join entirely — no query at all', async () => {
    const { svc, seen } = buildService(null);
    await expect(
      svc.updateNickname(MEMBER, { nickname: 'x' }, {
        roleName: 'superadmin',
      } as never),
    ).resolves.toBeDefined();
    expect(seen.existsFilter).toBeUndefined();
  });

  it('the raw profile read is guarded the same way', async () => {
    const { svc } = buildService(null);
    await expect(svc.getRawProfile(MEMBER, operatorOfA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
