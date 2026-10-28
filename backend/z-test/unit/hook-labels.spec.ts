import { Types } from 'mongoose';

import { HookLabelsService } from '@/modules/hooks';

/**
 * ==== [FEAT-20260817-HOOKLABELS] the slim OA list ============================
 *
 * WHY IT EXISTS, in numbers measured on the dev database: one hook document is
 * 105.7 KB — 46 KB of `suggestion_company_text`, 34 KB of `suggestion_text`, 9 KB
 * of `ai_raw_json_rules` — so `GET /hook` ships 376.8 KB for six OAs, and 11
 * dashboard pages call it, most of them to put a name in a dropdown. The audit
 * page reads three fields, which weigh 81 bytes.
 *
 * What must hold, and what a green compile cannot tell you:
 *   1. THE PROJECTION STAYS SLIM. If someone adds a field "just this once", the
 *      endpoint quietly becomes a second full list — the exact thing it exists to
 *      avoid. The `.select()` list is asserted here, so growing it is a decision
 *      with a red test, not a diff nobody reads.
 *   2. SCOPING IS THE SAME RULE AS THE FULL LIST. A superuser sees everything; a
 *      normal account is limited to its own groups and BOTH `group` shapes are
 *      matched (ObjectId on app-written rows, string on migrated rows); an account
 *      with no group is refused. A slim endpoint that forgot the scope would leak
 *      every tenant's OA names.
 *   3. THE SHAPE IS FIXED. Missing fields come back as `null`, never `undefined`,
 *      so the dashboard's `|| '-'` fallbacks behave the same for every row.
 */

const GROUP_A = new Types.ObjectId();
const GROUP_B = new Types.ObjectId();

function buildService(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ filter: unknown; select: string }> = [];
  let selected = '';
  const chain = {
    select: (fields: string) => {
      selected = fields;
      return chain;
    },
    sort: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(rows),
  } as unknown as Record<string, unknown>;
  const hookModel = {
    find: (filter: unknown) => {
      calls.push({
        filter,
        get select() {
          return selected;
        },
      });
      return chain;
    },
  };
  const service = new HookLabelsService(hookModel as never);
  return { service, calls, selectedFields: () => selected };
}

describe('[HOOKLABELS] the projection cannot grow by accident', () => {
  it('⭐ asks Mongo for exactly the six label fields — nothing heavy', async () => {
    const { service, selectedFields } = buildService([]);
    await service.listLabels({ roleName: 'superadmin' } as never);

    const fields = selectedFields().split(' ').sort();
    expect(fields).toEqual(
      [
        'alias',
        'company_name',
        'display_name',
        'line_oa_name',
        'status',
      ].sort(),
    );
    // the three fields that make a hook 105.7 KB must never appear here
    for (const heavy of [
      'suggestion_text',
      'suggestion_company_text',
      'ai_raw_json_rules',
    ]) {
      expect(selectedFields()).not.toContain(heavy);
    }
  });

  it('returns a fixed shape: absent fields are null, not undefined', async () => {
    const id = new Types.ObjectId();
    const { service } = buildService([{ _id: id, alias: 'oa1' }]);

    const [row] = await service.listLabels({ roleName: 'superadmin' } as never);

    expect(row).toEqual({
      _id: String(id),
      alias: 'oa1',
      display_name: null,
      line_oa_name: null,
      company_name: null,
      status: null,
    });
  });
});

describe('[HOOKLABELS] scoping matches the full list', () => {
  it('a superuser is not filtered at all', async () => {
    const { service, calls } = buildService([]);
    await service.listLabels({ roleName: 'superadmin' } as never);
    expect(calls[0]?.filter).toEqual({});
  });

  it('⭐ a normal account is limited to its groups, in BOTH id shapes', async () => {
    const { service, calls } = buildService([]);
    await service.listLabels({
      roleName: 'admin',
      groups: [String(GROUP_A), String(GROUP_B)],
    } as never);

    const filter = calls[0]?.filter as { $or: Array<Record<string, unknown>> };
    expect(filter.$or).toHaveLength(2);
    const branches = filter.$or as Array<{ group: { $in: unknown[] } }>;
    const byObjectId = branches[0]!;
    const byString = branches[1]!;
    expect(byObjectId.group.$in.map(String)).toEqual([
      String(GROUP_A),
      String(GROUP_B),
    ]);
    // the string branch exists because migrated rows store the group as a string
    expect(byString.group.$in).toEqual([String(GROUP_A), String(GROUP_B)]);
  });

  it('⭐ an account with no group is REFUSED, not served everything', async () => {
    const { service } = buildService([]);
    await expect(
      service.listLabels({ roleName: 'admin', groups: [] } as never),
    ).rejects.toThrow('group access is required');
    await expect(service.listLabels(undefined)).rejects.toThrow(
      'group access is required',
    );
  });

  it('⭐ a malformed group id is dropped from BOTH branches, exactly as the full list does', async () => {
    const { service, calls } = buildService([]);
    await service.listLabels({
      roleName: 'admin',
      groups: [String(GROUP_A), 'not-an-id'],
    } as never);

    const filter = calls[0]?.filter as {
      $or: Array<{ group: { $in: unknown[] } }>;
    };
    expect(filter.$or[0]!.group.$in.map(String)).toEqual([String(GROUP_A)]);
    expect(filter.$or[1]!.group.$in).toEqual([String(GROUP_A)]);
    expect(filter.$or[1]!.group.$in).not.toContain('not-an-id');
  });

  it('⭐ groups that are ALL malformed ⇒ 403, not an empty list', async () => {
    // Found in review: filtering after the empty-check made this return [] while
    // the full list answers 403 — two endpoints disagreeing about access.
    const { service } = buildService([]);
    await expect(
      service.listLabels({ roleName: 'admin', groups: ['nope', ''] } as never),
    ).rejects.toThrow('group access is required');
  });
});
