/**
 * [FEAT-20260816-GROUPSCOPECLONE] Copying one group's scope onto other groups.
 *
 * A tag/card reaches an OA when its `group_ids` holds that OA's group
 * (`dynamic-tags.service.ts:179-195`, `customer-helper-flex.ts:167`). So
 * "give group B what group A has" is: add B's id to every document that
 * carries A's id — and NOTHING else.
 *
 * ⚠️ The sibling endpoint `POST /api/dynamic-tags/bulk-scope` REPLACES the
 * scope. This one ADDS. The two look alike and behave oppositely, so the
 * add-not-replace rule is pinned first below and mutation-tested.
 *
 * The model doubles here implement `$addToSet` / `$pull` for real rather than
 * recording calls, because idempotency and "the source keeps its access" are
 * claims about the resulting document, not about which method was called.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * The feature's own barrel, not '@/modules/hooks': that one re-exports
 * hooks.module.ts, which would drag the whole module graph (admin + handoff
 * leaves, every schema) into a unit test that needs one class. Same reason and
 * same shape as `custom-tool-assign-scope.spec.ts:30`.
 */
// eslint-disable-next-line no-restricted-imports
import { GroupScopeCloneService } from '@/modules/hooks/group-scope-clone';

const SRC = 'a0d000000000000000000055';
const DST = 'a0d000000000000000000056';
const DST2 = 'a0d000000000000000000057';
const OTHER = 'a0d000000000000000000058';

type Doc = Record<string, unknown>;

/** indexed access with a real error instead of `undefined` leaking into asserts */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`expected an element at index ${index}, got none`);
  }
  return value;
}

/** Mongo-ish matcher for the handful of filter shapes the service builds. */
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') {
      return (cond as Doc[]).some((c) => matches(doc, c));
    }
    if (key === '$and') {
      return (cond as Doc[]).every((c) => matches(doc, c));
    }
    const value = doc[key];
    if (cond === null) return value === null || value === undefined;
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('$exists' in c) return (value !== undefined) === c['$exists'];
      if ('$ne' in c) {
        return Array.isArray(value)
          ? !value.includes(c['$ne'])
          : value !== c['$ne'];
      }
      return false;
    }
    return Array.isArray(value) ? value.includes(cond) : value === cond;
  });
}

function applyUpdate(doc: Doc, update: Doc): boolean {
  let changed = false;
  // `$set` is modelled even though the service must never use it: the danger
  // this feature guards against is somebody turning the add into a replace, and
  // a double that ignores `$set` would report that mutation as "nothing
  // happened" instead of "the other groups lost access".
  const set = update['$set'] as Record<string, unknown> | undefined;
  if (set) {
    for (const [field, value] of Object.entries(set)) {
      if (JSON.stringify(doc[field]) !== JSON.stringify(value)) {
        doc[field] = value;
        changed = true;
      }
    }
  }
  const add = update['$addToSet'] as Record<string, unknown> | undefined;
  if (add) {
    for (const [field, value] of Object.entries(add)) {
      const arr = Array.isArray(doc[field]) ? (doc[field] as unknown[]) : [];
      if (!arr.includes(value)) {
        doc[field] = [...arr, value];
        changed = true;
      }
    }
  }
  const pull = update['$pull'] as Record<string, unknown> | undefined;
  if (pull) {
    for (const [field, value] of Object.entries(pull)) {
      const arr = Array.isArray(doc[field]) ? (doc[field] as unknown[]) : [];
      const next = arr.filter((entry) => entry !== value);
      if (next.length !== arr.length) {
        doc[field] = next;
        changed = true;
      }
    }
  }
  return changed;
}

function fakeModel(docs: Doc[]) {
  const filters: Doc[] = [];
  const updates: Doc[] = [];
  return {
    docs,
    filters,
    updates,
    countDocuments: (filter: Doc) => {
      filters.push(filter);
      return {
        exec: () =>
          Promise.resolve(docs.filter((d) => matches(d, filter)).length),
      };
    },
    updateMany: (filter: Doc, update: Doc) => {
      filters.push(filter);
      updates.push(update);
      const hit = docs.filter((d) => matches(d, filter));
      const modified = hit.filter((d) => applyUpdate(d, update)).length;
      return { exec: () => Promise.resolve({ modifiedCount: modified }) };
    },
  };
}

const tag = (over: Doc = {}): Doc => ({
  _id: 'tag-1',
  tag: '{{balance}}',
  deleted_at: null,
  group_ids: [SRC],
  hook_ids: ['hook-1'],
  hook_id: null,
  group_id: null,
  ...over,
});

/** flex marks deletion by ABSENCE (`deleted_at: {$exists:false}`), unlike tags. */
const flex = (over: Doc = {}): Doc => ({
  _id: 'flex-1',
  title: 'card',
  group_ids: [SRC],
  ...over,
});

const SUPER = {
  userId: 'u1',
  username: 'root',
  displayName: 'root',
  roleName: 'superadmin',
  permissions: ['*'],
  groups: [SRC, DST, DST2],
} as never;

const OPERATOR = (permissions: string[]) =>
  ({
    userId: 'u2',
    username: 'op',
    displayName: 'op',
    roleName: 'admin',
    permissions,
    groups: [SRC, DST],
  }) as never;

function makeService(
  opts: { tags?: Doc[]; flexes?: Doc[]; deniedGroups?: string[] } = {},
) {
  const tagModel = fakeModel(opts.tags ?? [tag()]);
  const flexModel = fakeModel(opts.flexes ?? [flex()]);
  const denied = new Set(opts.deniedGroups ?? []);
  const groups = {
    getGroupById: (id: string) => {
      if (denied.has(id)) {
        return Promise.reject(
          new ForbiddenException('insufficient group access'),
        );
      }
      return Promise.resolve({ id, group_name: `group-${id.slice(-2)}` });
    },
  };
  const audit = { createAuditLog: jest.fn().mockResolvedValue(undefined) };
  const service = new GroupScopeCloneService(
    tagModel,
    flexModel,
    groups as never,
    audit as never,
  );
  return { service, tagModel, flexModel, audit, groups };
}

const body = (over: Doc = {}) => ({
  source_group_id: SRC,
  target_group_ids: [DST],
  ...over,
});

const META = { request_id: 'r1', ip: '127.0.0.1' };

describe('[GROUPSCOPECLONE] apply — the scope is ADDED, never replaced', () => {
  it('(T1 TARGET) the target is appended and every existing scope survives', async () => {
    const { service, tagModel, flexModel } = makeService({
      tags: [tag({ group_ids: [SRC, OTHER] })],
      flexes: [flex({ group_ids: [SRC, OTHER] })],
    });

    await service.apply(body(), SUPER, META);

    expect(at(tagModel.docs, 0)['group_ids']).toEqual([SRC, OTHER, DST]);
    expect(at(flexModel.docs, 0)['group_ids']).toEqual([SRC, OTHER, DST]);
  });

  it('(T2 TARGET) running it twice changes nothing the second time', async () => {
    const { service, tagModel } = makeService();

    const first = await service.apply(body(), SUPER, META);
    const second = await service.apply(body(), SUPER, META);

    expect(at(tagModel.docs, 0)['group_ids']).toEqual([SRC, DST]);
    expect(at(first.targets, 0).dynamic_tags).toBe(1);
    expect(at(second.targets, 0).dynamic_tags).toBe(0);
  });

  it('(T3 TARGET) several target groups are all served in one call', async () => {
    const { service, tagModel } = makeService();

    const res = await service.apply(
      body({ target_group_ids: [DST, DST2] }),
      SUPER,
      META,
    );

    expect(at(tagModel.docs, 0)['group_ids']).toEqual([SRC, DST, DST2]);
    expect(res.targets.map((t: { group_id: string }) => t.group_id)).toEqual([
      DST,
      DST2,
    ]);
  });

  it('(T4 TARGET) only group_ids is written — hook scope and legacy fields are untouched', async () => {
    const { service, tagModel } = makeService();

    await service.apply(body(), SUPER, META);

    for (const update of tagModel.updates) {
      expect(Object.keys(update)).toEqual(['$addToSet']);
      expect(Object.keys(update['$addToSet'] as Doc)).toEqual(['group_ids']);
    }
    expect(at(tagModel.docs, 0)['hook_ids']).toEqual(['hook-1']);
    expect(at(tagModel.docs, 0)['hook_id']).toBeNull();
    expect(at(tagModel.docs, 0)['group_id']).toBeNull();
  });

  it('(T5 TARGET) a tag scoped only by the legacy group_id is copied too', async () => {
    const { service, tagModel } = makeService({
      tags: [tag({ group_ids: [], group_id: SRC })],
    });

    await service.apply(body(), SUPER, META);

    expect(at(tagModel.docs, 0)['group_ids']).toEqual([DST]);
    expect(at(tagModel.docs, 0)['group_id']).toBe(SRC);
  });

  it('(T6 TARGET) mode=remove puts every document back exactly as it was', async () => {
    const { service, tagModel, flexModel } = makeService({
      tags: [tag({ group_ids: [SRC, OTHER] })],
      flexes: [flex({ group_ids: [SRC] })],
    });
    const before = JSON.stringify([tagModel.docs, flexModel.docs]);

    await service.apply(body(), SUPER, META);
    await service.apply(body({ mode: 'remove' }), SUPER, META);

    expect(JSON.stringify([tagModel.docs, flexModel.docs])).toBe(before);
  });

  it("(T7 TARGET) deleted rows are skipped, per each collection's own convention", async () => {
    const { service, tagModel, flexModel } = makeService({
      tags: [tag({ _id: 'gone', deleted_at: new Date() })],
      flexes: [flex({ _id: 'gone', deleted_at: new Date() })],
    });

    const res = await service.apply(body(), SUPER, META);

    expect(at(tagModel.docs, 0)['group_ids']).toEqual([SRC]);
    expect(at(flexModel.docs, 0)['group_ids']).toEqual([SRC]);
    expect(at(res.targets, 0)).toMatchObject({
      dynamic_tags: 0,
      flex_messages: 0,
    });
  });

  it('(T8 TARGET) include lets one side be copied without the other', async () => {
    const { service, tagModel, flexModel } = makeService();

    await service.apply(
      body({ include: { dynamic_tags: true, flex_messages: false } }),
      SUPER,
      META,
    );

    expect(at(tagModel.docs, 0)['group_ids']).toEqual([SRC, DST]);
    expect(at(flexModel.docs, 0)['group_ids']).toEqual([SRC]);
    expect(flexModel.updates).toHaveLength(0);
  });

  it('(T9 TARGET) one audit row per target group, on the GROUP trail', async () => {
    const { service, audit } = makeService();

    await service.apply(body({ target_group_ids: [DST, DST2] }), SUPER, META);

    expect(audit.createAuditLog).toHaveBeenCalledTimes(2);
    const first = at(audit.createAuditLog.mock.calls, 0)[0];
    expect(first).toMatchObject({
      ref_id: DST,
      group_id: DST,
      parent: 'group',
      action: 'update',
    });
    // the row says WHERE the access came from and HOW MUCH of it
    expect(String(first.note)).toContain(SRC);
    const fields = Object.fromEntries(
      (first.changed_fields as { field: string; to: unknown }[]).map((c) => [
        c.field,
        c.to,
      ]),
    );
    expect(fields['scope_clone_source_group']).toBe(SRC);
    expect(fields['scope_clone_mode']).toBe('add');
    expect(fields['dynamic_tags_granted']).toBe(1);
    // ⚠️ never `group_ids`: that is a field of the TAG, not of the group this
    // row belongs to
    expect(Object.keys(fields)).not.toContain('group_ids');
  });

  it('(T17 TARGET) a run that moves nothing writes no audit row at all', async () => {
    const { service, audit } = makeService();

    await service.apply(body(), SUPER, META);
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);

    // idempotent re-run: nothing moves, so nothing is recorded
    await service.apply(body(), SUPER, META);
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('(T18 TARGET) an undo is recorded as a removal, with negative counts', async () => {
    const { service, audit } = makeService();

    await service.apply(body(), SUPER, META);
    await service.apply(body({ mode: 'remove' }), SUPER, META);

    const last = at(audit.createAuditLog.mock.calls, 1)[0];
    const fields = Object.fromEntries(
      (last.changed_fields as { field: string; to: unknown }[]).map((c) => [
        c.field,
        c.to,
      ]),
    );
    expect(fields['scope_clone_mode']).toBe('remove');
    expect(fields['dynamic_tags_granted']).toBe(-1);
    expect(String(last.note)).toMatch(/Removed/);
  });
});

describe('[GROUPSCOPECLONE] preview — counts without writing', () => {
  it('(T10 TARGET) preview writes nothing and reports what apply then does', async () => {
    const { service, tagModel, flexModel } = makeService({
      tags: [tag(), tag({ _id: 'tag-2' })],
      flexes: [flex()],
    });

    const preview = await service.preview(body(), SUPER);
    expect(tagModel.updates).toHaveLength(0);
    expect(flexModel.updates).toHaveLength(0);
    expect(preview.applied).toBe(false);
    expect(at(preview.targets, 0)).toMatchObject({
      dynamic_tags: 2,
      flex_messages: 1,
    });

    const applied = await service.apply(body(), SUPER, META);
    expect(applied.applied).toBe(true);
    expect(at(applied.targets, 0)).toMatchObject({
      dynamic_tags: 2,
      flex_messages: 1,
    });
  });

  it('(T11 TARGET) the source totals are reported so an empty source is obvious', async () => {
    const { service } = makeService({ tags: [], flexes: [] });

    const preview = await service.preview(body(), SUPER);

    expect(preview.source_totals).toEqual({
      dynamic_tags: 0,
      flex_messages: 0,
    });
    expect(at(preview.targets, 0)).toMatchObject({
      dynamic_tags: 0,
      flex_messages: 0,
    });
  });
});

describe('[GROUPSCOPECLONE] the refusals', () => {
  it('(T12 TARGET) a group cannot be its own target', async () => {
    const { service, tagModel } = makeService();

    await expect(
      service.apply(body({ target_group_ids: [DST, SRC] }), SUPER, META),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tagModel.updates).toHaveLength(0);
  });

  it('(T13 TARGET) a group the caller cannot see is refused, before any write', async () => {
    const { service, tagModel } = makeService({ deniedGroups: [DST] });

    await expect(service.apply(body(), SUPER, META)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tagModel.updates).toHaveLength(0);
  });

  it('(T14 TARGET) copying tags needs dynamic_tags.manage, copying cards needs flex.manage', async () => {
    const tagsOnly = makeService();
    await expect(
      tagsOnly.service.apply(
        body(),
        OPERATOR(['group.manage', 'flex.manage']),
        META,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const flexOnly = makeService();
    await expect(
      flexOnly.service.apply(
        body(),
        OPERATOR(['group.manage', 'dynamic_tags.manage']),
        META,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const both = makeService();
    await expect(
      both.service.apply(
        body(),
        OPERATOR(['group.manage', 'dynamic_tags.manage', 'flex.manage']),
        META,
      ),
    ).resolves.toMatchObject({ applied: true });
  });

  it('(T15 TARGET) malformed input is refused with 400, never a partial write', async () => {
    const { service, tagModel } = makeService();
    const bad = [
      body({ source_group_id: 'not-an-id' }),
      body({ source_group_id: undefined }),
      body({ target_group_ids: [] }),
      body({ target_group_ids: ['nope'] }),
      body({ mode: 'delete-everything' }),
      body({ include: { dynamic_tags: false, flex_messages: false } }),
    ];

    for (const input of bad) {
      await expect(service.apply(input, SUPER, META)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(tagModel.updates).toHaveLength(0);
  });

  it('(T16 TARGET) duplicate targets are collapsed, not applied twice', async () => {
    const { service, tagModel } = makeService();

    const res = await service.apply(
      body({ target_group_ids: [DST, DST, DST] }),
      SUPER,
      META,
    );

    expect(res.targets).toHaveLength(1);
    expect(at(tagModel.docs, 0)['group_ids']).toEqual([SRC, DST]);
  });
});

describe('[GROUPSCOPECLONE] PIN — the sibling endpoint keeps its own meaning', () => {
  it('(P1 PIN) bulk-scope still REPLACES: dynamic-tags.service.ts holds no $addToSet', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/modules/hooks/dynamic-tags.service.ts'),
      'utf8',
    );
    expect(src).toContain('group_ids: groupIds');
    expect(src).not.toContain('$addToSet');
  });
});
