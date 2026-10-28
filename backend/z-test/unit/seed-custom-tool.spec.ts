/**
 * [FEAT-20261014-TOOLSEED] The seed CLI — any vendor's bundle, written safely.
 * ============================================================================
 * The CLI it replaces had no test at all. Its three defects are the TARGET cases here
 * (base_url from the capture host, `hook_ids` overwritten, a name collision throwing half-way);
 * the PIN cases are what it already did right and must keep doing (dry run writes nothing,
 * hooks are never written, re-runs are idempotent, the password is encrypted per deployment).
 *
 * ⚠️ RED-FIRST, STATED HONESTLY: the old CLI ran `void runCli()` at import and had no seam a
 * test could drive, so it could not be put under test unchanged. Its defects are cited from
 * its source (`seed-loan-v1-tool.ts:200` base_url, `:234/:250` `hook_ids: [hookId]`, no
 * collision handling) and each new rule is proven to have teeth by mutation instead.
 *
 * Everything runs the shipped plan + run functions against fake collections; no Mongo.
 */
import type { ConfigType } from '@nestjs/config';

import type { authConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto';

import { SEED_BUNDLES } from '../../src/cli/custom-tool-seed/bundles';
import {
  planTags,
  resolveSeedBaseUrl,
} from '../../src/cli/custom-tool-seed/seed-plan';
import {
  runSeed,
  type SeedCollections,
} from '../../src/cli/custom-tool-seed/seed-run';

const LOAN = SEED_BUNDLES.get('loan_v1')!;
const CAPTURE = LOAN.tool.base_url;
const NOW = new Date('2026-10-14T00:00:00Z');
const DEPLOY = 'https://loan-partner.invalid';

type Doc = Record<string, unknown>;

/** In-memory collections that record every write; `hooks` throws on anything but a read. */
function fakeDb(seed: { tools?: Doc[]; tags?: Doc[]; hooks?: Doc[] } = {}) {
  const tools = [...(seed.tools ?? [])];
  const tags = [...(seed.tags ?? [])];
  const hooks = [...(seed.hooks ?? [])];
  const writes: { col: string; op: string; args: unknown[] }[] = [];
  const match = (row: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in (v as Doc)) {
        return (v as { $in: unknown[] }).$in.includes(row[k]);
      }
      return row[k] === v;
    });
  const cols: SeedCollections = {
    tools: {
      findOne: (f) => Promise.resolve(tools.find((r) => match(r, f)) ?? null),
      findOneAndUpdate: (f, u, o) => {
        writes.push({ col: 'tools', op: 'findOneAndUpdate', args: [f, u, o] });
        return Promise.resolve(null);
      },
    },
    tags: {
      find: (f) => ({
        toArray: () => Promise.resolve(tags.filter((r) => match(r, f))),
      }),
      updateOne: (f, u) => {
        writes.push({ col: 'tags', op: 'updateOne', args: [f, u] });
        return Promise.resolve(null);
      },
      insertOne: (d) => {
        writes.push({ col: 'tags', op: 'insertOne', args: [d] });
        return Promise.resolve(null);
      },
    },
    hooks: new Proxy(
      {
        findOne: (f: Doc) =>
          Promise.resolve(hooks.find((r) => match(r, f)) ?? null),
      },
      {
        get(target, prop) {
          if (prop === 'findOne') return target.findOne;
          throw new Error(
            `hooks.${String(prop)} — the seed CLI must never write a hook`,
          );
        },
      },
    ),
  };
  return { cols, writes };
}

const crypto = new CryptoService({
  encryptionKey: 'unit-test-key',
} as ConfigType<typeof authConfig>);
const input = (over: Partial<Parameters<typeof runSeed>[1]> = {}) => ({
  bundle: LOAN,
  baseUrl: DEPLOY,
  apply: true,
  username: 'seed-user',
  encryptPassword: () => crypto.encrypt('s3cret') ?? '',
  now: NOW,
  ...over,
});
const markedTag = (tag: string, hook_ids: unknown[] = []): Doc => ({
  _id: `id-${tag}`,
  tag,
  detail: `x [${LOAN.tagMarker}]`,
  hook_ids,
});

describe('[TOOLSEED] bundles', () => {
  it('the registry is keyed by bundle.id and holds the loan bundle', () => {
    for (const [id, b] of SEED_BUNDLES) expect(b.id).toBe(id);
    expect(LOAN.tool.endpoints.length).toBeGreaterThan(0);
    for (const t of LOAN.tags) expect(t.detail).toContain(LOAN.tagMarker);
  });
});

describe('[TOOLSEED] TARGET — where the tool points', () => {
  it('a write with no address is refused (the old CLI wrote the capture host)', () => {
    const r = resolveSeedBaseUrl(LOAN, {
      apply: true,
      allowCaptureHost: false,
    });
    expect(r.ok).toBe(false);
  });

  it('a write to the capture host itself is refused unless explicitly allowed', () => {
    expect(
      resolveSeedBaseUrl(LOAN, {
        requested: CAPTURE,
        apply: true,
        allowCaptureHost: false,
      }).ok,
    ).toBe(false);
    expect(
      resolveSeedBaseUrl(LOAN, {
        requested: CAPTURE,
        apply: true,
        allowCaptureHost: true,
      }),
    ).toEqual({ ok: true, url: CAPTURE, isCaptureHost: true });
  });

  it('a real deployment address is used as given (trailing slash trimmed)', () => {
    expect(
      resolveSeedBaseUrl(LOAN, {
        requested: `${DEPLOY}/`,
        apply: true,
        allowCaptureHost: false,
      }),
    ).toEqual({ ok: true, url: DEPLOY, isCaptureHost: false });
  });

  it('not an http(s) address ⇒ refused', () => {
    expect(
      resolveSeedBaseUrl(LOAN, {
        requested: 'loan-partner',
        apply: true,
        allowCaptureHost: false,
      }).ok,
    ).toBe(false);
  });

  it('🔴 PIN: a dry run may show the plan against the capture host, flagged', () => {
    expect(
      resolveSeedBaseUrl(LOAN, { apply: false, allowCaptureHost: false }),
    ).toEqual({
      ok: true,
      url: CAPTURE,
      isCaptureHost: true,
    });
  });

  it('the written tool carries the chosen address, never the capture host', async () => {
    const { cols, writes } = fakeDb();
    await runSeed(cols, input());
    const set = (writes[0]!.args[1] as Doc)['$set'] as Doc;
    expect(set['base_url']).toBe(DEPLOY);
  });
});

describe('[TOOLSEED] TARGET — binding tags to a second OA keeps the first', () => {
  it('an existing bundle tag is updated with $addToSet, never `hook_ids: [id]`', async () => {
    const all = LOAN.tags.map((t) => markedTag(t.tag, ['OA1']));
    const { cols, writes } = fakeDb({
      tags: all,
      hooks: [{ _id: 'OA2', alias: 'second' }],
    });
    const r = await runSeed(cols, input({ hookAlias: 'second' }));
    expect(r.exitCode).toBe(0);
    const updates = writes.filter((w) => w.op === 'updateOne');
    expect(updates).toHaveLength(LOAN.tags.length);
    for (const u of updates) {
      const upd = u.args[1] as Doc;
      expect(upd['$addToSet']).toEqual({ hook_ids: 'OA2' });
      expect((upd['$set'] as Doc)['hook_ids']).toBeUndefined();
    }
  });

  it('a new tag is inserted bound to that OA', () => {
    const actions = planTags(LOAN, [], 'OA9', NOW);
    for (const a of actions) {
      expect(a.kind).toBe('insert');
      if (a.kind === 'insert') expect(a.doc['hook_ids']).toEqual(['OA9']);
    }
  });
});

describe('[TOOLSEED] TARGET — a name collision refuses the whole run', () => {
  it('a same-named tag this bundle did not write ⇒ exit 2, NOTHING written', async () => {
    const first = LOAN.tags[0]!.tag;
    const { cols, writes } = fakeDb({
      tags: [{ _id: 'other', tag: first, detail: 'somebody else’s tag' }],
    });
    const r = await runSeed(cols, input());
    expect(r.exitCode).toBe(2);
    expect(writes).toEqual([]);
    expect(r.lines.join('\n')).toContain(first);
  });
});

describe('[TOOLSEED] 🔴 PIN — what the old CLI already did right', () => {
  it('a dry run writes nothing at all and needs no secret', async () => {
    const { cols, writes } = fakeDb();
    const encrypt = jest.fn(() => 'x');
    const r = await runSeed(
      cols,
      input({ apply: false, encryptPassword: encrypt }),
    );
    expect(r.exitCode).toBe(0);
    expect(writes).toEqual([]);
    expect(encrypt).not.toHaveBeenCalled();
  });

  it('hooks are only READ — the Proxy throws on any write method', async () => {
    const { cols } = fakeDb({ hooks: [{ _id: 'OA1', alias: 'one' }] });
    await expect(
      runSeed(cols, input({ hookAlias: 'one' })),
    ).resolves.toMatchObject({
      exitCode: 0,
    });
  });

  it('an unknown hook alias stops before any write', async () => {
    const { cols, writes } = fakeDb();
    const r = await runSeed(cols, input({ hookAlias: 'nope' }));
    expect(r.exitCode).toBe(1);
    expect(writes).toEqual([]);
  });

  it('the tool is upserted by name with every endpoint completed to the schema', async () => {
    const { cols, writes } = fakeDb();
    await runSeed(cols, input());
    const [filter, update, opts] = writes[0]!.args as [Doc, Doc, Doc];
    expect(filter).toEqual({ name: LOAN.tool.name });
    expect(opts).toMatchObject({ upsert: true });
    const eps = (update['$set'] as Doc)['endpoints'] as Doc[];
    expect(eps).toHaveLength(LOAN.tool.endpoints.length);
    const profile = eps.find((e) => e['is_profile'] === true)!;
    /* the bundle's own profile_map survives the defaults (it is what L1 reads) */
    expect((profile['profile_map'] as Doc)['code']).toBe(
      'data.contract.contract_number',
    );
    for (const e of eps) expect(e).toHaveProperty('idempotency');
  });

  it('the password is encrypted by the real CryptoService and decrypts back on this key', async () => {
    const { cols, writes } = fakeDb();
    await runSeed(cols, input());
    const pw = ((writes[0]!.args[1] as Doc)['$set'] as Doc)[
      'password'
    ] as string;
    expect(pw).not.toContain('s3cret');
    expect(crypto.safeDecrypt(pw)).toBe('s3cret');
  });

  it('a re-run on a seeded DB updates, never duplicates', async () => {
    const { cols, writes } = fakeDb({
      tools: [{ name: LOAN.tool.name }],
      tags: LOAN.tags.map((t) => markedTag(t.tag)),
    });
    const r = await runSeed(cols, input());
    expect(r.toolExisted).toBe(true);
    expect(writes.filter((w) => w.op === 'insertOne')).toEqual([]);
    expect(writes.filter((w) => w.op === 'updateOne')).toHaveLength(
      LOAN.tags.length,
    );
  });
});

/* [FEAT-20261014-LOANCODES] D5 — the loan API's error codes are named for the API, not an OA.
   They only surface in webhook_logs.error_message (no code reads them — grep 14/10), so the
   rename moves no behaviour; this pins the decision so an old OA name does not creep back. */
describe('[LOANCODES] D5 — every error code the loan bundle writes is LOAN_*', () => {
  it('no ACME_* code is left in the bundle', () => {
    const codes = LOAN.tool.endpoints.flatMap((e) =>
      ((e['result_rules'] as { error_code?: string }[] | undefined) ?? [])
        .map((r) => r.error_code)
        .filter((c): c is string => !!c),
    );
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(c).toMatch(/^LOAN_/);
  });
});
