/**
 * [FEAT-20261016-TOOLMINT] The mint routes — `GET /api/custom-tool-mint` + `POST /api/custom-tool-mint/:company`.
 *
 * Owner 16/10/2026: env complete ⇒ the server creates the company's tool through
 * `CustomToolsService.create` (password encrypted · config validated · audit written) ·
 * incomplete ⇒ refused, the screen fills the form instead · a name already used (even by a
 * deleted tool) ⇒ refused, never overwritten · shop-api ⇒ no button, route 404 before any read.
 *
 * ⚠️ The create path here is the REAL `CustomToolsService.create` (only its Mongo model is a
 *    fake that records the row), so the round trip "template → normalizeEndpoints → stored row"
 *    is the one production takes — a spy on `create` would prove nothing about what is stored.
 */
import {
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { LOAN_V1_SEED_BUNDLE } from '@/cli/custom-tool-seed/bundles/loan-v1.bundle';
import { AllExceptionsFilter, PERMISSIONS_KEY } from '@/common';
import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  resetActiveProvider,
} from '@/modules/customer-provider';
import {
  CustomToolsService,
  ToolMintController,
  ToolMintService,
} from '@/modules/hooks';

const byName = (n: string) => {
  const p = CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n);
  if (!p) throw new Error('no provider ' + n);
  return p;
};

const PW = 'pw-SENTINEL-demo';
const FULL_DEMO = {
  LOAN_TOOL_DEMO_BASE_URL: 'https://acme.example.test/',
  LOAN_TOOL_DEMO_USERNAME: 'demo-user',
  LOAN_TOOL_DEMO_PASSWORD: PW,
};

function build(opts: {
  env?: Record<string, string>;
  taken?: { _id: string; deleted_at?: Date | null } | null;
}) {
  const stored: Record<string, unknown>[] = [];
  /* the CustomTool model as `create` uses it — records the row it would write */
  const customToolModel = {
    create: jest.fn((payload: Record<string, unknown>) => {
      const row = { _id: 'tool-new-1', ...payload };
      stored.push(row);
      return Promise.resolve({ ...row, toObject: () => ({ ...row }) });
    }),
  };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const customTools = new CustomToolsService(
    customToolModel as never,
    {} as never,
    { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v } as never,
    audit as never,
    { invalidateHookCache: async () => {} } as never,
  );
  const createSpy = jest.spyOn(customTools, 'create');
  /* the name check the mint does itself (deleted rows included) */
  const toolModel = {
    findOne: jest.fn(() => ({
      select: () => ({
        lean: () => ({ exec: jest.fn().mockResolvedValue(opts.taken ?? null) }),
      }),
    })),
  };
  const tagReport = {
    tool: { id: 'tool-new-1', name: 'loan_demo' },
    hooks: [],
    inserted: ['ins_x_9000004'],
    bound: [],
    already: [],
    skipped: [],
  };
  const tagBind = { bindToolTags: jest.fn().mockResolvedValue(tagReport) };
  const svc = new ToolMintService(
    { values: opts.env ?? {} },
    toolModel as never,
    customTools,
    tagBind as never,
  );
  return { svc, stored, createSpy, toolModel, tagBind, audit };
}

const USER = { userId: 'a0d000000000000000000014', username: 'dev' } as never;
const META = {} as never;

afterEach(() => resetActiveProvider());

describe('[TOOLMINT] PIN — shop-api: no button, nothing runs', () => {
  beforeEach(() => bindActiveProvider(byName('shopapi_v1')));

  it('⭐ catalog ⇒ null even with every env set', () => {
    expect(build({ env: FULL_DEMO }).svc.catalog()).toBeNull();
  });

  it('⭐ mint ⇒ 404 before any read or write', async () => {
    const b = build({ env: FULL_DEMO });
    await expect(b.svc.mint('demo', USER, META)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(b.toolModel.findOne).not.toHaveBeenCalled();
    expect(b.createSpy).not.toHaveBeenCalled();
    expect(b.tagBind.bindToolTags).not.toHaveBeenCalled();
  });
});

describe('[TOOLMINT] loan_v1 — env complete ⇒ a ready tool, through the real create door', () => {
  beforeEach(() => bindActiveProvider(byName('loan_v1')));

  it('⭐ TARGET — one create, the company name, the env base URL (no trailing slash), jwt_login, 4000 ms', async () => {
    const b = build({ env: FULL_DEMO });
    await b.svc.mint('demo', USER, META);
    expect(b.createSpy).toHaveBeenCalledTimes(1);
    expect(b.stored).toHaveLength(1);
    expect(b.stored[0]).toMatchObject({
      name: 'loan_demo',
      base_url: 'https://acme.example.test',
      auth_type: 'jwt_login',
      username: 'demo-user',
      timeout_ms: 4000,
      status: true,
      category: 'generic',
    });
  });

  it('🔴 the stored password is the ENCRYPTED one — the plain value is never written', async () => {
    const b = build({ env: FULL_DEMO });
    await b.svc.mint('demo', USER, META);
    expect(b.stored[0]?.['password']).toBe(`enc:${PW}`);
  });

  it('🔴 the answer and the audit row never carry the password', async () => {
    const b = build({ env: FULL_DEMO });
    const out = await b.svc.mint('demo', USER, META);
    expect(JSON.stringify(out)).not.toContain(PW);
    expect(JSON.stringify(b.audit.write.mock.calls)).not.toContain(PW);
  });

  it('⭐ ROUND TRIP — every load-bearing endpoint field of the template survives normalisation into the row', async () => {
    const b = build({ env: FULL_DEMO });
    await b.svc.mint('demo', USER, META);
    const eps = b.stored[0]?.['endpoints'] as Record<string, unknown>[];
    expect(eps.map((e) => e['key'])).toEqual(
      LOAN_V1_SEED_BUNDLE.tool.endpoints.map((e) => e.key),
    );
    for (const want of LOAN_V1_SEED_BUNDLE.tool.endpoints) {
      const got = eps.find((e) => e['key'] === want.key) ?? {};
      for (const f of [
        'method',
        'path',
        'purpose',
        'require_jwt',
        'request_type',
        'payload',
        'result_rules',
      ]) {
        expect({ key: want.key, f, v: got[f] }).toEqual({
          key: want.key,
          f,
          v: want[f],
        });
      }
      expect(got['is_login'] === true).toBe(want['is_login'] === true);
      expect(got['is_profile'] === true).toBe(want['is_profile'] === true);
      const pm = want['profile_map'] as Record<string, string> | undefined;
      if (pm) {
        expect(got['profile_map']).toMatchObject({
          name: pm['name'],
          phone: pm['phone'],
          code: pm['code'],
        });
      }
    }
    const login = eps.find((e) => e['is_login'] === true);
    expect(login?.['token_path']).toBe('data.access_token');
    const profile = eps.find((e) => e['is_profile'] === true);
    expect(profile?.['key']).toBe('CUSTOMER_PROFILE');
    expect(profile?.['path']).toBe('api/v1/customer/{{line_user_id}}');
  });

  it('⭐ the template tags are made sure to exist for the NEW tool (bind service, by its id)', async () => {
    const b = build({ env: FULL_DEMO });
    const out = await b.svc.mint('demo', USER, META);
    expect(b.tagBind.bindToolTags).toHaveBeenCalledWith(
      'tool-new-1',
      USER,
      META,
    );
    expect(out.tags.inserted).toEqual(['ins_x_9000004']);
  });

  it('the template object is not mutated by the mint (each press starts from the same bundle)', async () => {
    const before = JSON.stringify(LOAN_V1_SEED_BUNDLE);
    await build({ env: FULL_DEMO }).svc.mint('demo', USER, META);
    expect(JSON.stringify(LOAN_V1_SEED_BUNDLE)).toBe(before);
  });
});

describe('[TOOLMINT] loan_v1 — refusals (nothing written)', () => {
  beforeEach(() => bindActiveProvider(byName('loan_v1')));

  it('⭐ env incomplete ⇒ 400 naming the missing KEYS, no create', async () => {
    const b = build({
      env: { LOAN_TOOL_ACME_BASE_URL: 'https://b.example.test' },
    });
    const err = await b.svc.mint('acme', USER, META).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      missing: ['LOAN_TOOL_ACME_USERNAME', 'LOAN_TOOL_ACME_PASSWORD'],
    });
    expect(b.createSpy).not.toHaveBeenCalled();
  });

  it('⭐ OVER THE WIRE — through the real AllExceptionsFilter the 400 still names the missing KEYS (live 16/10)', async () => {
    /* any object without `success: false` is cut to `{ error }` by the filter — the key
       names were lost on the wire while `getResponse()` (above) still had them */
    const b = build({
      env: { LOAN_TOOL_ACME_BASE_URL: 'https://b.example.test' },
    });
    const err = await b.svc.mint('acme', USER, META).catch((e: unknown) => e);
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    new AllExceptionsFilter().catch(err, {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({
          method: 'POST',
          url: '/api/custom-tool-mint/acme',
        }),
      }),
    } as never);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]?.[0]).toMatchObject({
      success: false,
      error: expect.stringContaining('ยังไม่ครบ'),
      missing: ['LOAN_TOOL_ACME_USERNAME', 'LOAN_TOOL_ACME_PASSWORD'],
    });
  });

  it('unknown company ⇒ 404, no create', async () => {
    const b = build({ env: FULL_DEMO });
    await expect(b.svc.mint('initech', USER, META)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(b.createSpy).not.toHaveBeenCalled();
  });

  it('⭐ a live tool already has the name ⇒ 409 "ไม่เขียนทับ", no create', async () => {
    const b = build({ env: FULL_DEMO, taken: { _id: 't0', deleted_at: null } });
    const err = await b.svc.mint('demo', USER, META).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(String((err as Error).message)).toContain('ไม่เขียนทับ');
    expect(b.createSpy).not.toHaveBeenCalled();
    expect(b.tagBind.bindToolTags).not.toHaveBeenCalled();
  });

  it('⭐ a DELETED tool still holds the name ⇒ 409 that says so, no create', async () => {
    const b = build({
      env: FULL_DEMO,
      taken: { _id: 't0', deleted_at: new Date() },
    });
    const err = await b.svc.mint('demo', USER, META).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(String((err as Error).message)).toContain('ลบไปแล้ว');
    expect(b.createSpy).not.toHaveBeenCalled();
  });

  it('the name check looks up the company tool name (deleted rows are NOT filtered out)', async () => {
    const b = build({ env: FULL_DEMO });
    await b.svc.mint('demo', USER, META);
    expect(b.toolModel.findOne).toHaveBeenCalledWith({ name: 'loan_demo' });
  });
});

describe('[TOOLMINT] the controller', () => {
  it('⭐ both routes sit behind custom_tools.manage (class-level, like CustomToolsController)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ToolMintController)).toEqual([
      'custom_tools.manage',
    ]);
  });

  it('GET /api/custom-tool-mint answers { success, data: { tool_mint } }', () => {
    bindActiveProvider(byName('loan_v1'));
    const ctl = new ToolMintController(build({ env: FULL_DEMO }).svc);
    const out = ctl.catalog();
    expect(out.success).toBe(true);
    expect(out.data.tool_mint?.companies.map((c) => c.id)).toEqual([
      'demo',
      'acme',
      'examplepartner',
    ]);
    expect(JSON.stringify(out)).not.toContain(PW);
  });

  it('GET on shop-api ⇒ tool_mint null', () => {
    bindActiveProvider(byName('shopapi_v1'));
    const ctl = new ToolMintController(build({ env: FULL_DEMO }).svc);
    expect(ctl.catalog()).toEqual({ success: true, data: { tool_mint: null } });
  });

  it('POST /api/custom-tool-mint/:company wraps the result', async () => {
    bindActiveProvider(byName('loan_v1'));
    const ctl = new ToolMintController(build({ env: FULL_DEMO }).svc);
    const out = await ctl.mint(
      'demo',
      { headers: {}, ip: '127.0.0.1' } as never,
      USER,
    );
    expect(out.success).toBe(true);
    expect((out.data.tool as { name?: string }).name).toBe('loan_demo');
  });
});
