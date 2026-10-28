/**
 * [FIX-20260818-CHATOASCOPE] plan §8 = T3-3 of fix_plan_18_aug · closes C2.1 + the
 * sync-profile hole found by the ownership sweep
 *
 * ## What was open
 * Two write paths in the chat module resolved their target by id alone and never
 * asked whether the caller may act on that OA:
 *
 *   1. `resolveRoomHook(id, hookIdQuery)` — no `auth` parameter at all, while its
 *      read-side twin `resolveRoomForRead` has taken one and enforced scope since
 *      [FIX-20260808-ACLWHITELIST]. Everything that SENDS (reply, push, sticker,
 *      image, inline note) goes through it, so an operator of OA-A could send a
 *      message to OA-B's customer, from OA-B's channel, spending OA-B's quota.
 *      That is audit C2.1.
 *   2. `syncUserProfile(dto)` — takes `hook_id` straight from the request body and
 *      decrypts THAT hook's LINE access token. An operator of OA-A could name
 *      OA-B's hook and make the server call LINE as OA-B, then overwrite the
 *      shared member row from the answer.
 *
 * ## Why the assertion below is about the DECRYPT, not the response
 * For sync-profile the damage is done before anything is returned: the token is
 * decrypted and spent. So the test asserts the refusal happens BEFORE
 * `safeDecrypt` runs — a version that checks scope after loading the token would
 * still pass a response-shape assertion while leaking the credential.
 * ความเสียหายอยู่ที่ "คีย์ถูกใช้" ไม่ใช่ "คำตอบที่ส่งกลับ"
 *
 * ## Harness
 * Direct instantiation over the prototype — no Nest, no Mongo. Only the few
 * collaborators these two methods touch are stubbed, so the test fails for the
 * reason under test rather than for a missing dependency.
 */
import { ForbiddenException } from '@nestjs/common';

import { ChatService } from '@/modules/chat';

const ROOM_ID = 'a0d000000000000000000042'; // must LOOK like an ObjectId or the
// resolver takes its line_user_id branch and demands a hook_id query instead
const OA_A = 'a0d000000000000000000043';
const OA_B = 'a0d000000000000000000044';

/** An operator scoped to OA_A only (per-user whitelist, the tightest tier). */
const operatorOfA = {
  userId: 'a0d000000000000000000045',
  roleName: 'operator',
  groups: ['a0d000000000000000000046'],
  allowedHooks: [OA_A],
} as never;

const superadmin = {
  ...(operatorOfA as object),
  roleName: 'superadmin',
} as never;

type Stubs = {
  decryptCalls: number;
  lineProfileCalls: number;
};

/**
 * Builds the service with just enough around it. `hookModel.find` answers the
 * group-fallback tier; it is never reached for a whitelisted user, which is the
 * point — the whitelist must win.
 */
const buildService = (
  roomHookId: string,
): { svc: ChatService; stubs: Stubs } => {
  const stubs: Stubs = { decryptCalls: 0, lineProfileCalls: 0 };
  /**
   * ⚠️ Typed as a loose record, not `ChatService & {…}`: `logger` is private on the
   * class, so intersecting collapses the type to `never`. The prototype is still
   * the real one, so the methods under test are the real methods.
   */
  const svc = Object.create(ChatService.prototype) as Record<
    string,
    unknown
  > & {
    syncUserProfile: ChatService['syncUserProfile'];
  };

  svc.chatRoomModel = {
    findById: () => Promise.resolve({ _id: ROOM_ID, hook_id: roomHookId }),
    findOne: () => Promise.resolve({ _id: ROOM_ID, hook_id: roomHookId }),
  };
  svc.hookModel = {
    findById: () => ({
      lean: () =>
        Promise.resolve({
          _id: roomHookId,
          access_token: 'enc:whatever',
          channel_type: 'line',
        }),
    }),
    find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
  };
  svc.crypto = {
    safeDecrypt: () => {
      stubs.decryptCalls += 1;
      return 'plain-token';
    },
  };
  svc.lineApi = {
    getLineProfile: () => {
      stubs.lineProfileCalls += 1;
      return Promise.resolve(null);
    },
  };
  svc.logger = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };

  return { svc: svc as unknown as ChatService, stubs };
};

describe('[CHATOASCOPE] sending must stay inside the caller’s OA (audit C2.1)', () => {
  it('⭐ an operator of OA-A cannot resolve a room that belongs to OA-B', async () => {
    const { svc } = buildService(OA_B);
    await expect(
      (
        svc as unknown as {
          resolveRoomHook: (
            id: string,
            q: string | undefined,
            auth?: unknown,
          ) => Promise<unknown>;
        }
      ).resolveRoomHook(ROOM_ID, undefined, operatorOfA),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the same operator still resolves their OWN room — unchanged', async () => {
    const { svc } = buildService(OA_A);
    await expect(
      (
        svc as unknown as {
          resolveRoomHook: (
            id: string,
            q: string | undefined,
            auth?: unknown,
          ) => Promise<unknown>;
        }
      ).resolveRoomHook(ROOM_ID, undefined, operatorOfA),
    ).resolves.toBeDefined();
  });

  it('a super user is unscoped, as everywhere else', async () => {
    const { svc } = buildService(OA_B);
    await expect(
      (
        svc as unknown as {
          resolveRoomHook: (
            id: string,
            q: string | undefined,
            auth?: unknown,
          ) => Promise<unknown>;
        }
      ).resolveRoomHook(ROOM_ID, undefined, superadmin),
    ).resolves.toBeDefined();
  });
});

describe('[CHATOASCOPE] sync-profile must not spend another OA’s LINE token', () => {
  it('⭐ refuses BEFORE the access token is decrypted', async () => {
    const { svc, stubs } = buildService(OA_B);
    await expect(
      svc.syncUserProfile({ hook_id: OA_B, line_user_id: 'U123' }, operatorOfA),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // the whole point: the credential must never have been touched
    expect(stubs.decryptCalls).toBe(0);
    expect(stubs.lineProfileCalls).toBe(0);
  });

  it('the caller’s own hook still syncs — unchanged', async () => {
    const { svc, stubs } = buildService(OA_A);
    await svc
      .syncUserProfile({ hook_id: OA_A, line_user_id: 'U123' }, operatorOfA)
      .catch(() => undefined); // the LINE stub answers null; we only care that it got there
    expect(stubs.decryptCalls).toBe(1);
  });
});

/**
 * [FIX-20260818-ASSISTSCOPE · plan §8 = T3-3] the six assist-status routes.
 *
 * The member-keyed pair is the one that was misfiring in ordinary use, not just
 * under attack: `updateAssistStatusByMemberId` ran an `updateMany` with no hook
 * filter, and four LINE ids in the live database own rooms under two different
 * hooks. One legitimate toggle therefore silenced (or un-silenced) another OA's
 * bot for that customer. The read twin had the mirror bug: it answered from
 * `rooms[0]`, whichever OA that happened to be.
 *
 * These cases assert on the FILTER the service builds, because that is where the
 * fix lives — folded into the query so the write stays atomic, rather than a
 * check before it.
 */
describe('[ASSISTSCOPE] assist status never reaches another OA', () => {
  /** Captures the filter each model call receives. */
  const buildAssistService = (allowedHooks: string[] | null) => {
    const seen: {
      find?: unknown;
      updateMany?: unknown;
      findOneAndUpdate?: unknown;
    } = {};
    const svc = Object.create(ChatService.prototype) as Record<string, unknown>;
    svc.chatRoomModel = {
      find: (filter: unknown) => {
        seen.find = filter;
        return {
          lean: () =>
            Promise.resolve([
              { _id: ROOM_ID, hook_id: OA_A, assist_status: true },
            ]),
        };
      },
      updateMany: (filter: unknown) => {
        seen.updateMany = filter;
        return Promise.resolve({ matchedCount: 1 });
      },
      findOneAndUpdate: (filter: unknown) => {
        seen.findOneAndUpdate = filter;
        return Promise.resolve({ _id: ROOM_ID, assist_status: true });
      },
    };
    svc.hookModel = {
      find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
    };
    return { svc: svc as unknown as ChatService, seen, allowedHooks };
  };

  const operatorScoped = { ...(operatorOfA as object) } as never;

  it('⭐ the member-keyed WRITE is scoped inside the updateMany filter', async () => {
    const { svc, seen } = buildAssistService([OA_A]);
    await svc.updateAssistStatusByMemberId(
      'U123',
      { assist_status: true },
      operatorScoped,
    );
    expect(seen.updateMany).toMatchObject({ hook_id: { $in: [OA_A] } });
  });

  it('⭐ the member-keyed READ is scoped inside the find filter', async () => {
    const { svc, seen } = buildAssistService([OA_A]);
    await svc.getAssistStatusByMemberId('U123', operatorScoped);
    expect(seen.find).toMatchObject({ hook_id: { $in: [OA_A] } });
  });

  it('⭐ the id-keyed WRITE folds the scope into findOneAndUpdate, not a pre-check', async () => {
    const { svc, seen } = buildAssistService([OA_A]);
    await svc.updateAssistStatus(
      ROOM_ID,
      { assist_status: true },
      operatorScoped,
    );
    expect(seen.findOneAndUpdate).toMatchObject({
      _id: ROOM_ID,
      hook_id: { $in: [OA_A] },
    });
  });

  it('a super user is unfiltered — the filter carries no hook_id at all', async () => {
    const { svc, seen } = buildAssistService(null);
    await svc.updateAssistStatusByMemberId(
      'U123',
      { assist_status: true },
      superadmin,
    );
    expect(seen.updateMany).not.toHaveProperty('hook_id');
  });
});

/**
 * [FIX-20260818-ROOMSCOPE · plan §8 = T3-3] room-keyed notes and tags.
 *
 * These readers already fetched `hook_id` — `.select('_id user_id hook_id')` —
 * and then ignored it, so the fix costs no extra query. The room is the OA
 * boundary: a note or a customer tag hangs off a room, so reading one from
 * another OA's room is the same disclosure as reading that room.
 */
describe('[ROOMSCOPE] notes and tags are read only from the caller’s own rooms', () => {
  const buildRoomReader = (roomHookId: string) => {
    const svc = Object.create(ChatService.prototype) as Record<string, unknown>;
    svc.chatRoomModel = {
      findById: () => ({
        select: () => ({
          lean: () =>
            Promise.resolve({
              _id: ROOM_ID,
              user_id: 'member1',
              hook_id: roomHookId,
            }),
        }),
      }),
    };
    svc.hookModel = {
      find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
    };
    svc.customerTagModel = {
      find: () => ({
        populate: () => ({
          populate: () => ({
            sort: () => ({ lean: () => Promise.resolve([]) }),
          }),
        }),
      }),
    };
    return svc as unknown as ChatService;
  };

  it('⭐ tags of another OA’s room are refused', async () => {
    const svc = buildRoomReader(OA_B);
    await expect(
      svc.listCustomerTags(ROOM_ID, operatorOfA),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('tags of the caller’s own room still read — unchanged', async () => {
    const svc = buildRoomReader(OA_A);
    await expect(
      svc.listCustomerTags(ROOM_ID, operatorOfA),
    ).resolves.toBeDefined();
  });

  it('a super user reads any room’s tags, as before', async () => {
    const svc = buildRoomReader(OA_B);
    await expect(
      svc.listCustomerTags(ROOM_ID, superadmin),
    ).resolves.toBeDefined();
  });
});
