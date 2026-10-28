import { Types } from 'mongoose';

import { GroupsService } from '@/modules/hooks';

/**
 * ==== [FEAT-20260817-GROUPBULKSTATUS] turning many groups on or off ==========
 *
 * The endpoint saves an operator twenty clicks, so the only thing that matters
 * is that it cannot do twenty wrong things at once. What is pinned here:
 *
 *   1. ALL-OR-NOTHING ACCESS — one id the caller may not touch refuses the WHOLE
 *      request, before any write, and the message names the group. A loop that
 *      checked access per row would leave the operator unable to tell which half
 *      of their batch landed (the reasoning the hooks bulk endpoint records).
 *   2. NO POINTLESS WRITES — a group already in the target state is skipped, so
 *      it produces neither an update nor an audit row, and is reported back as
 *      `unchanged`.
 *   3. AN ID THAT MATCHES NOTHING IS NOT A PERMISSION PROBLEM — it comes back as
 *      `missing`. Otherwise a stale row on the screen looks like a 403.
 *   4. AUDIT PER CHANGED GROUP with the real from/to, same shape the single-row
 *      update writes, so the audit page cannot tell one click from twenty.
 *
 * Model and audit service are jest stubs: no Mongo, no writes. The point is the
 * DECISIONS, and each is observed at the seam that would carry it out.
 */

const GROUP_A = new Types.ObjectId();
const GROUP_B = new Types.ObjectId();
const CALLER = new Types.ObjectId();

type Row = {
  _id: Types.ObjectId;
  group_name: string;
  status: boolean;
};

const superUser = { roleName: 'superadmin', userId: String(CALLER) } as never;
const memberOf = (...ids: Types.ObjectId[]) =>
  ({
    roleName: 'admin',
    userId: String(CALLER),
    username: 'op1',
    groups: ids.map(String),
  }) as never;

function buildService(rows: Row[]) {
  const updateMany = jest.fn(() => ({
    exec: () => Promise.resolve({ modifiedCount: rows.length }),
  }));
  const groupModel = {
    find: jest.fn(() => ({
      lean: () => ({ exec: () => Promise.resolve(rows) }),
    })),
    updateMany,
  };
  const audits: Array<Record<string, unknown>> = [];
  const auditLogService = {
    createAuditLog: jest.fn((entry: Record<string, unknown>) => {
      audits.push(entry);
      return Promise.resolve(undefined);
    }),
  };
  const service = new GroupsService(
    groupModel as never,
    auditLogService as never,
  );
  return { service, updateMany, audits, groupModel };
}

describe('[GROUPBULKSTATUS] access is all-or-nothing', () => {
  it('⭐ one unreachable group refuses the whole request and writes NOTHING', async () => {
    const { service, updateMany } = buildService([
      { _id: GROUP_A, group_name: 'ทีมเช้า', status: false },
      { _id: GROUP_B, group_name: 'ทีมดึก', status: false },
    ]);

    await expect(
      service.bulkUpdateGroupStatus(
        [String(GROUP_A), String(GROUP_B)],
        true,
        memberOf(GROUP_A), // member of A only
      ),
    ).rejects.toThrow(/insufficient group access: ทีมดึก/);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('a superadmin is not scoped, and the write happens once for the batch', async () => {
    const { service, updateMany } = buildService([
      { _id: GROUP_A, group_name: 'ทีมเช้า', status: false },
      { _id: GROUP_B, group_name: 'ทีมดึก', status: false },
    ]);

    const res = await service.bulkUpdateGroupStatus(
      [String(GROUP_A), String(GROUP_B)],
      true,
      superUser,
    );

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: true, matched: 2, unchanged: 0 });
  });
});

describe('[GROUPBULKSTATUS] it only writes what actually changes', () => {
  it('⭐ a group already in the target state is skipped, not rewritten', async () => {
    const { service, updateMany, audits } = buildService([
      { _id: GROUP_A, group_name: 'ทีมเช้า', status: true }, // already on
      { _id: GROUP_B, group_name: 'ทีมดึก', status: false },
    ]);

    const res = await service.bulkUpdateGroupStatus(
      [String(GROUP_A), String(GROUP_B)],
      true,
      superUser,
    );

    const filter = (updateMany.mock.calls[0] as unknown[])[0] as {
      _id: { $in: Types.ObjectId[] };
    };
    expect(filter._id.$in.map(String)).toEqual([String(GROUP_B)]);
    expect(res).toMatchObject({ matched: 2, unchanged: 1 });
    // and no audit noise for the untouched one
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      parent: 'group',
      action: 'update',
      changed_fields: [{ field: 'status', from: false, to: true }],
    });
  });

  it('every group already correct ⇒ no write at all', async () => {
    const { service, updateMany, audits } = buildService([
      { _id: GROUP_A, group_name: 'ทีมเช้า', status: true },
    ]);

    const res = await service.bulkUpdateGroupStatus(
      [String(GROUP_A)],
      true,
      superUser,
    );

    expect(updateMany).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
    expect(res).toMatchObject({ modified: 0, unchanged: 1 });
  });

  it('the write carries the caller as updated_by, and the soft-delete guard', async () => {
    const { service, updateMany } = buildService([
      { _id: GROUP_A, group_name: 'ทีมเช้า', status: false },
    ]);

    await service.bulkUpdateGroupStatus([String(GROUP_A)], true, superUser);

    const [filter, update] = updateMany.mock.calls[0] as unknown[] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter['deleted_at']).toBeNull();
    expect(update.$set['status']).toBe(true);
    expect(String(update.$set['updated_by'])).toBe(String(CALLER));
  });
});

describe('[GROUPBULKSTATUS] the edges a UI will hit', () => {
  it('an id that matches no row is `missing`, NOT an access failure', async () => {
    const ghost = String(new Types.ObjectId());
    const { service } = buildService([
      { _id: GROUP_A, group_name: 'ทีมเช้า', status: false },
    ]);

    const res = await service.bulkUpdateGroupStatus(
      [String(GROUP_A), ghost],
      true,
      superUser,
    );

    expect(res).toMatchObject({ matched: 1, missing: [ghost] });
  });

  it('duplicate ids are collapsed — one row, one audit', async () => {
    const { service, audits } = buildService([
      { _id: GROUP_A, group_name: 'ทีมเช้า', status: false },
    ]);

    const res = await service.bulkUpdateGroupStatus(
      [String(GROUP_A), String(GROUP_A)],
      true,
      superUser,
    );

    expect(res).toMatchObject({ matched: 1 });
    expect(audits).toHaveLength(1);
  });

  it('no ids → 400, a malformed id → 400, and no matching row → 404', async () => {
    const { service } = buildService([]);
    await expect(
      service.bulkUpdateGroupStatus([], true, superUser),
    ).rejects.toThrow('ids is required');
    await expect(
      service.bulkUpdateGroupStatus(['not-an-id'], true, superUser),
    ).rejects.toThrow('Invalid group identifier');
    await expect(
      service.bulkUpdateGroupStatus([String(GROUP_A)], true, superUser),
    ).rejects.toThrow('Group not found');
  });

  it('turning OFF works the same way, with from/to reversed in the audit', async () => {
    const { service, audits } = buildService([
      { _id: GROUP_A, group_name: 'ทีมเช้า', status: true },
    ]);

    await service.bulkUpdateGroupStatus([String(GROUP_A)], false, superUser);

    expect(audits[0]).toMatchObject({
      changed_fields: [{ field: 'status', from: true, to: false }],
    });
  });
});
