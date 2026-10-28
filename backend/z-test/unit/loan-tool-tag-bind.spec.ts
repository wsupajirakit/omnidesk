/**
 * [FEAT-20261016-TAGBIND] The "ผูก tag" button — `POST /api/custom-tool-tag-bind/:toolId`.
 *
 * Owner 16/10/2026: an unbound `[[ins_x_*]]` answers N/A silently (a tag only reaches the OAs
 * it is bound to — `buildDynamicTagQuery`), so a button binds the template's tags to every OA
 * using the tool · own module · dynamic (follows the tool's real endpoints, no tag list by name).
 *
 * TARGET: missing tags inserted bound to the OAs · template tags get the missing OAs ADDED ·
 *         a tool without an endpoint never gets that endpoint's tags · idempotent re-run.
 * PIN:    shop-api 404 before any read · an admin's same-named tag, a deleted tag, a single-OA tag
 *         are never written · no OA is ever removed · hooks / custom_tools are only READ.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { LOAN_V1_SEED_BUNDLE } from '@/cli/custom-tool-seed/bundles/loan-v1.bundle';
import { planTags } from '@/cli/custom-tool-seed/seed-plan';
import { PERMISSIONS_KEY } from '@/common';
import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  resetActiveProvider,
} from '@/modules/customer-provider';
import {
  planTagBind,
  ToolTagBindController,
  ToolTagBindService,
} from '@/modules/hooks';

const byName = (n: string) => {
  const p = CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n);
  if (!p) throw new Error('no provider ' + n);
  return p;
};

const TOOL_ID = 'a0d000000000000000000014';
const ALL_KEYS = LOAN_V1_SEED_BUNDLE.tool.endpoints.map((e) => e.key);
const MARK = LOAN_V1_SEED_BUNDLE.tagMarker;
const NAMES = LOAN_V1_SEED_BUNDLE.tags.map((t) => t.tag);
const PROFILE_TAGS = LOAN_V1_SEED_BUNDLE.tags
  .filter((t) => t.sub_type === 'CUSTOMER_PROFILE')
  .map((t) => t.tag);
const INSTALLMENT_TAGS = LOAN_V1_SEED_BUNDLE.tags
  .filter((t) => t.sub_type === 'INSTALLMENT_CURRENT')
  .map((t) => t.tag);

type Row = Record<string, unknown>;

const chain = (v: unknown) => ({
  select: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(v) }) }),
});

function build(opts: {
  tool?: { endpoints: { key: string }[] } | null;
  hooks?: { _id: string; alias?: string }[];
  tags?: Row[];
}) {
  const created: Row[] = [];
  const updates: { filter: Row; update: Row }[] = [];
  const tagModel = {
    find: jest.fn(() => chain(opts.tags ?? [])),
    create: jest.fn((doc: Row) => {
      created.push(doc);
      return Promise.resolve({ _id: `new-${created.length}`, ...doc });
    }),
    updateOne: jest.fn((filter: Row, update: Row) => {
      updates.push({ filter, update });
      return { exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    }),
  };
  /* READ-ONLY fakes: no write method exists, so a write would throw */
  const toolModel = {
    findOne: jest.fn(() =>
      chain(
        opts.tool === null
          ? null
          : {
              _id: TOOL_ID,
              name: 'loan_demo',
              ...(opts.tool ?? { endpoints: ALL_KEYS.map((key) => ({ key })) }),
            },
      ),
    ),
  };
  const hookModel = { find: jest.fn(() => chain(opts.hooks ?? [])) };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const svc = new ToolTagBindService(
    tagModel as never,
    toolModel as never,
    hookModel as never,
    audit as never,
  );
  return { svc, created, updates, tagModel, toolModel, hookModel, audit };
}

const USER = { userId: 'a0d000000000000000000067', username: 'dev' } as never;
const META = {} as never;
const H1 = 'a0d00000000000000000003b';
const H2 = 'a0d000000000000000000059';

const marked = (tag: string, extra: Row = {}): Row => ({
  _id: `id-${tag}`,
  tag,
  detail: `x [${MARK} · sub_type เดิม: y]`,
  hook_id: null,
  hook_ids: [],
  deleted_at: null,
  ...extra,
});

afterEach(() => resetActiveProvider());

describe('[TAGBIND] PIN — shop-api: nothing is read, nothing is written', () => {
  it('⭐ 404 before any query', async () => {
    bindActiveProvider(byName('shopapi_v1'));
    const b = build({});
    await expect(
      b.svc.bindToolTags(TOOL_ID, USER, META),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(b.toolModel.findOne).not.toHaveBeenCalled();
    expect(b.tagModel.find).not.toHaveBeenCalled();
    expect(b.tagModel.create).not.toHaveBeenCalled();
  });
});

describe('[TAGBIND] loan_v1', () => {
  beforeEach(() => bindActiveProvider(byName('loan_v1')));

  it('a bad id ⇒ 400 · an unknown / deleted tool ⇒ 404', async () => {
    await expect(
      build({}).svc.bindToolTags('nope', USER, META),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      build({ tool: null }).svc.bindToolTags(TOOL_ID, USER, META),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the tool is looked up alive only · the OAs are the ones with custom_tool_id = the tool', async () => {
    const b = build({});
    await b.svc.bindToolTags(TOOL_ID, USER, META);
    expect(b.toolModel.findOne).toHaveBeenCalledWith({
      _id: TOOL_ID,
      deleted_at: null,
    });
    expect(b.hookModel.find).toHaveBeenCalledWith({ custom_tool_id: TOOL_ID });
    /* every row with one of the names — no deleted_at filter, or a reserved name is invisible */
    expect(b.tagModel.find).toHaveBeenCalledWith({ tag: { $in: NAMES } });
  });

  it('⭐ TARGET — empty site: all 15 template tags inserted, bound to both OAs, with the marker', async () => {
    const b = build({ hooks: [{ _id: H1, alias: 'loan-demo' }, { _id: H2 }] });
    const r = await b.svc.bindToolTags(TOOL_ID, USER, META);
    expect(r.inserted).toEqual(NAMES);
    expect(r.hooks).toEqual(['loan-demo', H2]);
    expect(b.created).toHaveLength(15);
    for (const doc of b.created) {
      expect(doc['hook_ids']).toEqual([H1, H2]);
      expect(String(doc['detail'])).toContain(MARK);
      expect(doc['type']).toBe('api');
      expect(doc['hook_id']).toBeNull();
      expect(doc['created_by']).toBeTruthy();
    }
    expect(b.audit.write).toHaveBeenCalledTimes(15);
  });

  it('⭐ ONE SHAPE — an inserted row is the seed CLI row, only the OAs (and who) differ', async () => {
    const b = build({ hooks: [{ _id: H1 }] });
    await b.svc.bindToolTags(TOOL_ID, USER, META);
    const seed = planTags(LOAN_V1_SEED_BUNDLE, [], null, new Date(0));
    const strip = (d: Row) => {
      const {
        created_at,
        updated_at,
        hook_ids,
        created_by,
        updated_by,
        ...rest
      } = d;
      void created_at;
      void updated_at;
      void hook_ids;
      void created_by;
      void updated_by;
      return rest;
    };
    expect(b.created.map(strip)).toEqual(
      seed.flatMap((a) => (a.kind === 'insert' ? [strip(a.doc)] : [])),
    );
  });

  it('⭐ TARGET — template tags missing an OA get it ADDED ($addToSet $each), nothing removed', async () => {
    const b = build({
      hooks: [{ _id: H1 }, { _id: H2 }],
      tags: NAMES.map((t) => marked(t, { hook_ids: [H1] })),
    });
    const r = await b.svc.bindToolTags(TOOL_ID, USER, META);
    expect(r.bound).toEqual(NAMES);
    expect(b.created).toHaveLength(0);
    expect(b.updates).toHaveLength(15);
    for (const u of b.updates) {
      expect(u.update['$addToSet']).toEqual({ hook_ids: { $each: [H2] } });
      expect(u.update['$pull']).toBeUndefined();
      expect(JSON.stringify(u.update)).not.toContain('"hook_ids":[');
    }
  });

  it('⭐ IDEMPOTENT — every OA already there ⇒ no write, no audit row', async () => {
    const b = build({
      hooks: [{ _id: H1 }],
      tags: NAMES.map((t) => marked(t, { hook_ids: [H1] })),
    });
    const r = await b.svc.bindToolTags(TOOL_ID, USER, META);
    expect(r.already).toEqual(NAMES);
    expect(b.updates).toHaveLength(0);
    expect(b.created).toHaveLength(0);
    expect(b.audit.write).not.toHaveBeenCalled();
  });

  it('🔴 PIN — an admin tag with the same name (no marker) is never touched', async () => {
    const b = build({
      hooks: [{ _id: H1 }],
      tags: [{ ...marked(NAMES[0]!), detail: 'แอดมินสร้างเอง' }],
    });
    const r = await b.svc.bindToolTags(TOOL_ID, USER, META);
    expect(r.skipped).toContainEqual({ tag: NAMES[0], reason: 'not_template' });
    expect(
      b.updates.find((u) => u.filter['_id'] === `id-${NAMES[0]}`),
    ).toBeUndefined();
    expect(b.created.find((d) => d['tag'] === NAMES[0])).toBeUndefined();
  });

  it('🔴 PIN — a deleted template tag is not re-created (its name is reserved) nor bound', async () => {
    const b = build({
      hooks: [{ _id: H1 }],
      tags: [marked(NAMES[1]!, { deleted_at: new Date() })],
    });
    const r = await b.svc.bindToolTags(TOOL_ID, USER, META);
    expect(r.skipped).toContainEqual({ tag: NAMES[1], reason: 'deleted' });
    expect(b.created.find((d) => d['tag'] === NAMES[1])).toBeUndefined();
    expect(b.updates).toHaveLength(0);
  });

  it("🔴 PIN — a template tag in single-OA mode is left alone (mode is the admin's decision)", async () => {
    const b = build({
      hooks: [{ _id: H1 }],
      tags: [marked(NAMES[2]!, { hook_id: H2 })],
    });
    const r = await b.svc.bindToolTags(TOOL_ID, USER, META);
    expect(r.skipped).toContainEqual({ tag: NAMES[2], reason: 'single_oa' });
    expect(b.updates).toHaveLength(0);
  });

  it('⭐ DYNAMIC — a tool without CUSTOMER_PROFILE never gets the profile tags; the rest still bind', async () => {
    const b = build({
      tool: {
        endpoints: ALL_KEYS.filter((k) => k !== 'CUSTOMER_PROFILE').map(
          (key) => ({ key }),
        ),
      },
      hooks: [{ _id: H1 }],
    });
    const r = await b.svc.bindToolTags(TOOL_ID, USER, META);
    expect(r.inserted).toEqual(INSTALLMENT_TAGS);
    expect(r.skipped.map((s) => s.tag)).toEqual(PROFILE_TAGS);
    expect(r.skipped.every((s) => s.reason === 'endpoint_absent')).toBe(true);
    expect(PROFILE_TAGS.length + INSTALLMENT_TAGS.length).toBe(15);
  });

  it('no OA uses the tool yet (the mint path) ⇒ tags inserted bound to nobody, nothing bound', async () => {
    const b = build({ hooks: [] });
    const r = await b.svc.bindToolTags(TOOL_ID, USER, META);
    expect(r.inserted).toHaveLength(15);
    expect(
      b.created.every(
        (d) =>
          Array.isArray(d['hook_ids']) &&
          (d['hook_ids'] as unknown[]).length === 0,
      ),
    ).toBe(true);
    expect(r.bound).toEqual([]);
  });
});

describe('[TAGBIND] the plan is pure and follows the endpoint keys case-insensitively', () => {
  it('a lower-case stored key still matches the template sub_type', () => {
    const a = planTagBind({
      template: LOAN_V1_SEED_BUNDLE,
      toolEndpointKeys: ['installment_current'],
      existing: [],
      hookIds: [],
      now: new Date(0),
    });
    expect(a.filter((x) => x.kind === 'insert').map((x) => x.tag)).toEqual(
      INSTALLMENT_TAGS,
    );
  });
});

describe('[TAGBIND] the controller', () => {
  it('⭐ behind custom_tools.manage', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ToolTagBindController)).toEqual(
      ['custom_tools.manage'],
    );
  });
  it('POST /api/custom-tool-tag-bind/:toolId wraps the report', async () => {
    bindActiveProvider(byName('loan_v1'));
    const ctl = new ToolTagBindController(build({ hooks: [{ _id: H1 }] }).svc);
    const out = await ctl.bind(
      TOOL_ID,
      { headers: {}, ip: '127.0.0.1' } as never,
      USER,
    );
    expect(out.success).toBe(true);
    expect(out.data.inserted).toHaveLength(15);
  });
});
