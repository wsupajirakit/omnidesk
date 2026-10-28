/**
 * [FEAT-20260808-AUDITSITE] Audit-log CALL SITES, pinned to the legacy shape.
 *
 * P2-1 ported the missing `auditLogService.createAuditLog(...)` calls that legacy
 * fires on admin writes but the new BE was skipping. These cases assert, per
 * representative site, that:
 *   1. the operation's normal result is UNCHANGED (purely additive), and
 *   2. exactly one audit row is written with legacy's action name / parent /
 *      changed_fields shape. [FIX-20260901-AUDITFROMTO] It is `from`/`to`
 *      EVERYWHERE now. The object and image-storage sites used to push legacy's
 *      `old_value`/`new_value`, which the sub-schema does not declare and
 *      Mongoose therefore dropped on write — so those rows recorded which field
 *      moved and never from what to what.
 *
 * Services are constructed directly with hand-stubbed models + a fake
 * `AuditLogService` — no Mongo, no DI container, no external keys. The audit
 * write is fire-and-forget in production; here the stub resolves, and we read
 * back the payload it was handed.
 */

import type { AuthenticatedUser } from '@/common';
import { ObjectCategoriesService } from '@/modules/content';
import { GroupsService } from '@/modules/hooks';
import { SlipVerificationService } from '@/modules/slip';
import { TicketsService } from '@/modules/tickets';

/* [FEAT-20260901-OBJSCOPE] The service now resolves the caller's OAs to scope
   its reads. A superuser short-circuits before this model is touched, and these
   cases all run as one, so an empty stub is enough — it must exist, not answer. */
const HOOK_MODEL = {
  find: () => ({ select: () => ({ lean: async () => [] }) }),
};

const USER: AuthenticatedUser = {
  userId: 'a0d00000000000000000000a',
  username: 'op1',
  displayName: 'Operator One',
  roleName: 'admin',
  groups: [],
} as unknown as AuthenticatedUser;

const REQUEST_META = {
  request_id: 'req-abc',
  ip: '10.0.0.1',
  user_agent: 'jest',
};

/** A resolving audit stub whose calls we inspect. */
function makeAudit() {
  return { createAuditLog: jest.fn().mockResolvedValue({}) };
}

/** Wait a microtask so the fire-and-forget `void ...createAuditLog` runs. */
const flush = () => new Promise((r) => setImmediate(r));

describe('[FEAT-20260808-AUDITSITE] object-categories audit (from legacy objectCategoryController.js)', () => {
  let audit: ReturnType<typeof makeAudit>;

  const CAT_ID = 'a0d00000000000000000001b';

  beforeEach(() => {
    audit = makeAudit();
  });

  it('create → one audit row {parent:object_category, action:create, note} and unchanged result', async () => {
    // Constructor-style model: `new this.categoryModel(doc)`.
    const saved = {
      _id: CAT_ID,
      name: 'Promotions',
      api_key: '',
      save: jest.fn().mockResolvedValue(undefined),
      toObject() {
        return { _id: CAT_ID, name: 'Promotions', api_key: '' };
      },
    };
    const model = Object.assign(
      jest.fn().mockImplementation(() => saved),
      {
        findOne: jest.fn().mockResolvedValue(null), // no existing name clash
      },
    );

    const service = new ObjectCategoriesService(
      model as never,
      HOOK_MODEL as never,
      audit as never,
    );

    const out = await service.createCategory(USER, {
      name: 'Promotions',
    });

    // Result unchanged: the sanitised category is returned.
    expect(out).toMatchObject({ id: CAT_ID, name: 'Promotions', api_key: '' });

    await flush();
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    const row = audit.createAuditLog.mock.calls[0][0];
    expect(row).toMatchObject({
      ref_id: CAT_ID,
      action: 'create',
      parent: 'object_category',
      note: 'Created category: Promotions',
    });
    // Actor is derived from the JWT identity.
    expect(row.actor).toMatchObject({
      user_id: USER.userId,
      username: 'op1',
      display_name: 'Operator One',
    });
    // Legacy has NO request_meta on the object_category audit.
    expect(row.request_meta).toBeUndefined();
  });

  it('update → changed_fields use from/to and only include what changed', async () => {
    const doc = {
      _id: CAT_ID,
      name: 'Old',
      api_key: 'k1',
      save: jest.fn().mockResolvedValue(undefined),
      toObject() {
        return { _id: CAT_ID, name: this.name, api_key: this.api_key };
      },
    };
    const model = Object.assign(jest.fn(), {
      // 1st findOne: load the category; 2nd: name-uniqueness check → none.
      findOne: jest.fn().mockResolvedValueOnce(doc).mockResolvedValueOnce(null),
    });

    const service = new ObjectCategoriesService(
      model as never,
      HOOK_MODEL as never,
      audit as never,
    );

    // Only api_key changes; name is left unchanged.
    const out = await service.updateCategory(USER, CAT_ID, {
      api_key: 'k2',
    });
    expect(out).toMatchObject({ id: CAT_ID, api_key: 'k2' });

    await flush();
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    const row = audit.createAuditLog.mock.calls[0][0];
    expect(row).toMatchObject({
      ref_id: CAT_ID,
      action: 'update',
      parent: 'object_category',
      note: 'Updated category: Old',
    });
    /* [FIX-20260901-AUDITFROMTO] `from`/`to` — the only shape the sub-schema
       stores. An unchanged field is still omitted. */
    expect(row.changed_fields).toEqual([
      { field: 'api_key', from: 'k1', to: 'k2' },
    ]);
  });

  it('update with no real change → NO audit row (legacy guards on changed_fields.length)', async () => {
    const doc = {
      _id: CAT_ID,
      name: 'Same',
      api_key: 'k1',
      save: jest.fn().mockResolvedValue(undefined),
      toObject() {
        return { _id: CAT_ID, name: this.name, api_key: this.api_key };
      },
    };
    const model = Object.assign(jest.fn(), {
      findOne: jest.fn().mockResolvedValueOnce(doc),
    });
    const service = new ObjectCategoriesService(
      model as never,
      HOOK_MODEL as never,
      audit as never,
    );

    await service.updateCategory(USER, CAT_ID, { api_key: 'k1' });
    await flush();
    expect(audit.createAuditLog).not.toHaveBeenCalled();
  });

  it('delete → one audit row {action:delete} with the actor from the caller', async () => {
    const doc = {
      _id: CAT_ID,
      name: 'Gone',
      api_key: '',
      save: jest.fn().mockResolvedValue(undefined),
    };
    const model = Object.assign(jest.fn(), {
      findOne: jest.fn().mockResolvedValueOnce(doc),
    });
    const service = new ObjectCategoriesService(
      model as never,
      HOOK_MODEL as never,
      audit as never,
    );

    await service.deleteCategory(CAT_ID, USER);
    await flush();
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.createAuditLog.mock.calls[0][0]).toMatchObject({
      ref_id: CAT_ID,
      action: 'delete',
      parent: 'object_category',
      note: 'Deleted category: Gone',
    });
  });
});

describe('[FEAT-20260808-AUDITSITE] groups audit (from legacy groupController.js)', () => {
  let audit: ReturnType<typeof makeAudit>;
  const GROUP_ID = 'a0d000000000000000000023';

  beforeEach(() => {
    audit = makeAudit();
  });

  it('create → audit row {parent:group, action:create, group_id, changed_fields from:null}', async () => {
    const created = {
      _id: GROUP_ID,
      group_name: 'North',
      description: 'north desc',
      status: true,
      toObject() {
        return {
          _id: GROUP_ID,
          group_name: this.group_name,
          description: this.description,
          status: this.status,
        };
      },
    };
    // findOne(...).lean().exec() for the uniqueness check → none.
    const groupModel = {
      findOne: jest.fn(() => ({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      })),
      create: jest.fn().mockResolvedValue(created),
      // db.collection('users').updateOne — the non-super membership add. USER is
      // super (roleName admin is NOT super here), so guard on isSuperUser: admin
      // is not super → membership add runs; stub it.
      db: {
        collection: () => ({ updateOne: jest.fn().mockResolvedValue({}) }),
      },
    };

    const service = new GroupsService(groupModel as never, audit as never);

    const superUser = {
      ...USER,
      roleName: 'superadmin',
    } as unknown as AuthenticatedUser;
    const out = await service.createGroup(
      { group_name: 'North', description: 'north desc', status: true },
      superUser,
      REQUEST_META,
    );
    expect(out).toMatchObject({ group_name: 'North' });

    await flush();
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    const row = audit.createAuditLog.mock.calls[0][0];
    expect(row).toMatchObject({
      ref_id: GROUP_ID,
      group_id: GROUP_ID,
      parent: 'group',
      action: 'create',
      note: 'Created group: North (by Operator One)',
    });
    // group audit uses from/to (from:null on create).
    expect(row.changed_fields).toEqual([
      { field: 'group_name', from: null, to: 'North' },
      { field: 'description', from: null, to: 'north desc' },
      { field: 'status', from: null, to: true },
    ]);
    // group audit DOES carry request_meta.
    expect(row.request_meta).toEqual(REQUEST_META);
  });
});

describe('[FEAT-20260808-AUDITSITE] slip-verification audit (from legacy slipVerificationController.js)', () => {
  let audit: ReturnType<typeof makeAudit>;
  const SLIP_ID = 'a0d000000000000000000024';

  beforeEach(() => {
    audit = makeAudit();
  });

  it('create → audit row {parent:slip_verification, action:create}, changed_fields use from/to with from:null', async () => {
    const created = {
      _id: SLIP_ID,
      trans_ref: 'TR123',
      toObject() {
        return { _id: SLIP_ID, trans_ref: 'TR123' };
      },
    };
    const slipModel = { create: jest.fn().mockResolvedValue(created) };
    const service = new SlipVerificationService(
      slipModel as never,
      {} as never, // customToolService (was externalApiService pre-BPCUSTOMSLIP) — unused by create; any call = loud TypeError
      audit as never,
      // [FIX-20260818-SLIPSCOPE · plan §8] the OA-scope resolver's Hook model.
      // Returns nothing, so a non-super caller scopes to [] — these cases build
      // no auth at all, which is the unprivileged path either way.
      {
        find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
      } as never,
      // [FEAT-20260823-SLIPPHONE] member model — unused, this case creates a
      // slip and never searches.
      {} as never,
    );

    const out = await service.create(
      { trans_ref: 'TR123', amount: 500 },
      USER,
      REQUEST_META,
    );
    // Result unchanged: the created record is returned under `data`.
    expect(out.data).toMatchObject({ _id: SLIP_ID, trans_ref: 'TR123' });

    await flush();
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    const row = audit.createAuditLog.mock.calls[0][0];
    expect(row).toMatchObject({
      ref_id: SLIP_ID,
      parent: 'slip_verification',
      action: 'create',
      note: 'Created slip verification for trans_ref: TR123 (by Operator One)',
    });
    expect(row.request_meta).toEqual(REQUEST_META);
    // slip audit uses from/to; every payload key is recorded with from:null.
    expect(Array.isArray(row.changed_fields)).toBe(true);
    for (const cf of row.changed_fields) {
      expect(cf).toHaveProperty('from', null);
      expect(cf).toHaveProperty('to');
    }
    // trans_ref + amount must be present among the payload keys.
    const fields = row.changed_fields.map((c: { field: string }) => c.field);
    expect(fields).toEqual(expect.arrayContaining(['trans_ref', 'amount']));
  });
});

describe('[FEAT-20260808-AUDITSITE] tickets.clearTickets audit (from legacy ticketController.js)', () => {
  let audit: ReturnType<typeof makeAudit>;
  const HOOK_ID = 'a0d000000000000000000025';

  beforeEach(() => {
    audit = makeAudit();
  });

  it('clear_tickets → one audit row {action:clear_tickets, NO parent, NO request_meta} + unchanged result', async () => {
    const CHAT_USER_ID = 'a0d000000000000000000026';
    const ticketModel = {
      find: jest.fn(() => ({
        lean: () =>
          Promise.resolve([{ chat_user_id: CHAT_USER_ID, hook_id: HOOK_ID }]),
      })),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
    };
    const chatRoomModel = {
      find: jest.fn(() => ({ lean: () => Promise.resolve([]) })),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
    const realtimePublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    const superUser = {
      ...USER,
      roleName: 'superadmin',
    } as unknown as AuthenticatedUser;

    // Superuser → getAllowedHookIds returns null, so hookModel is never queried.
    const service = new TicketsService(
      ticketModel as never, // ticketModel
      {} as never, // assignHistoryModel
      chatRoomModel as never, // chatRoomModel
      {} as never, // chatMessageModel
      {} as never, // memberModel
      {} as never, // customerTagModel
      {} as never, // hookModel — unused for superuser
      realtimePublisher as never, // realtimePublisher
      audit as never, // auditLogService
      /* [FEAT-20260905-CUSTPROV PART 3] the tier reader takes its paths from the
       active provider now. This suite is not about tiers, so the default entry
       is enough — but it must be PRESENT, or the service cannot construct. */
      {
        resolve: () => ({
          tierPaths: ['data.profile.tier', 'profile.tier', 'tier'],
        }),
      } as never,
    );

    const out = await service.clearTickets(
      HOOK_ID,
      { clear_waiting: true, clear_processing: true },
      superUser,
    );

    // Result unchanged: legacy's success envelope with the counts.
    expect(out).toMatchObject({
      success: true,
      message: 'Tickets cleared successfully',
      ticketsClosed: 3,
      roomsReset: 0,
    });

    await flush();
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    const row = audit.createAuditLog.mock.calls[0][0];
    expect(row).toMatchObject({
      action: 'clear_tickets',
      ref_id: HOOK_ID,
      hook_id: HOOK_ID,
    });
    // clear_tickets carries NO parent, NO request_meta, NO note.
    expect(row.parent).toBeUndefined();
    expect(row.request_meta).toBeUndefined();
    expect(row.note).toBeUndefined();
    expect(row.changed_fields).toEqual([
      { field: 'tickets_closed', from: 0, to: 3 },
      { field: 'rooms_reset', from: 0, to: 0 },
      { field: 'statuses_cleared', from: null, to: [0, 1] },
    ]);
    // Actor inline-built with legacy's display_name || username || "Admin".
    expect(row.actor).toMatchObject({
      user_id: superUser.userId,
      username: 'op1',
      display_name: 'Operator One',
    });
  });
});
