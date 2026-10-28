/**
 * [FEAT-20261016-TOOLMINT] Which companies a site can mint a custom tool for — the declaration,
 * the wire the browser gets, and the server-only credential read.
 *
 * Owner 16/10/2026: loan site Custom Tools page = one mint button per company
 * (demo · Acme · Globex), three tools, three credential sets · env complete ⇒ a
 * ready tool · incomplete ⇒ the skeleton · "ห้ามส่งรหัสผ่านออกไปที่เบราว์เซอร์" · shop-api unchanged.
 *
 * TARGET: loan_v1 declares 3 companies on the ONE template (the seed bundle, by reference) ·
 *         the wire reports readiness per company by env KEY NAME · credentials only server-side.
 * PIN:    shop-api / unbound ⇒ null everywhere · the wire never carries a username or password.
 */
import { LOAN_V1_SEED_BUNDLE } from '@/cli/custom-tool-seed/bundles/loan-v1.bundle';
import { toolMintConfig } from '@/config/app.config';
import { envSchema, validateEnv } from '@/config/env.schema';
import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  providerToolMint,
  resetActiveProvider,
  TOOL_MINT_ENV_SUFFIXES,
  toolMintCredentials,
  toolMintWire,
  type ProviderToolMint,
} from '@/modules/customer-provider';

const byName = (n: string) => {
  const p = CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n);
  if (!p) throw new Error('no provider ' + n);
  return p;
};
const loanV1Provider = byName('loan_v1');
const shopapiV1Provider = byName('shopapi_v1');

/* sentinels — if either ever appears in the wire, the password/username leaked */
const PW = 'pw-SENTINEL-must-never-leave';
const USER = 'user-SENTINEL-not-for-browser';

const fullEnv = (prefix: string): Record<string, string> => ({
  [`${prefix}BASE_URL`]: 'https://partner.example.test/',
  [`${prefix}USERNAME`]: USER,
  [`${prefix}PASSWORD`]: PW,
});
const lookup =
  (o: Record<string, string>) =>
  (k: string): string | undefined =>
    o[k];

const decl = (): ProviderToolMint => {
  const d = loanV1Provider.toolMint;
  if (!d) throw new Error('loan_v1 declares no toolMint');
  return d;
};

afterEach(() => resetActiveProvider());

describe('[TOOLMINT] the declaration', () => {
  it('⭐ TARGET — loan_v1 declares demo · Acme · Globex, each its own tool name and env prefix', () => {
    const d = decl();
    expect(
      d.companies.map((c) => [c.id, c.label, c.toolName, c.envPrefix]),
    ).toEqual([
      ['demo', 'demo', 'loan_demo', 'LOAN_TOOL_DEMO_'],
      ['acme', 'Acme', 'loan_acme', 'LOAN_TOOL_ACME_'],
      ['examplepartner', 'Globex', 'loan_examplepartner', 'LOAN_TOOL_GLOBEX_'],
    ]);
  });

  it('⭐ the template IS the seed bundle (same object) — one source for endpoints + tags', () => {
    expect(decl().template).toBe(LOAN_V1_SEED_BUNDLE);
    expect(decl().template.tool.endpoints.map((e) => e.key)).toEqual([
      'LOGIN',
      'CUSTOMER_PROFILE',
      'INSTALLMENT_CURRENT',
      'PAYMENT_HISTORY',
      'CONTRACT_INFO',
      'ALL_INSTALLMENTS',
    ]);
  });

  it('three companies = three distinct tool names and prefixes, none colliding with the seed CLI tool', () => {
    const names = decl().companies.map((c) => c.toolName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain(LOAN_V1_SEED_BUNDLE.tool.name);
    const prefixes = decl().companies.map((c) => c.envPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('⭐ TARGET — bound loan_v1 ⇒ providerToolMint() is the declaration', () => {
    bindActiveProvider(loanV1Provider);
    expect(providerToolMint()).toBe(decl());
  });

  it('⭐ PIN — shop-api declares nothing ⇒ null · unbound ⇒ null · reset forgets', () => {
    expect(shopapiV1Provider.toolMint).toBeUndefined();
    bindActiveProvider(shopapiV1Provider);
    expect(providerToolMint()).toBeNull();
    bindActiveProvider(loanV1Provider);
    resetActiveProvider();
    expect(providerToolMint()).toBeNull();
  });
});

describe('[TOOLMINT] env — every company key is declared, optional, plain string', () => {
  const keys = decl().companies.flatMap((c) =>
    TOOL_MINT_ENV_SUFFIXES.map((s) => `${c.envPrefix}${s}`),
  );
  const shape = (envSchema as unknown as { shape: Record<string, unknown> })
    .shape;

  it.each(keys)('%s is in env.schema.ts', (k) => {
    expect(shape[k]).toBeDefined();
  });

  it('🔴 all absent ⇒ the schema still accepts (shop-api sets none)', () => {
    for (const k of keys) {
      const r = (
        shape[k] as { safeParse: (v: unknown) => { success: boolean } }
      ).safeParse(undefined);
      expect(r.success).toBe(true);
    }
  });

  it('🔴 an empty `KEY=` line does not fail the schema (no .url()) — the server must still boot', () => {
    for (const k of keys) {
      const r = (
        shape[k] as { safeParse: (v: unknown) => { success: boolean } }
      ).safeParse('');
      expect(r.success).toBe(true);
    }
  });

  it('toolMintConfig hands the mint every declared LOAN_TOOL_* key and nothing else', () => {
    /* booted the way ConfigModule boots it — `validateEnv` — with placeholders for the
       unrelated required keys (no real secret in a spec). */
    validateEnv({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/spec',
      JWT_SECRET: 'x'.repeat(32),
      ENCRYPTION_KEY: 'y'.repeat(32),
      LOAN_TOOL_DEMO_USERNAME: 'u',
      LOAN_TOOL_UNDECLARED_KEY: 'dropped by the schema',
      LOAN_TEST_DEMO_LINE_ACCESS_TOKEN: 'not-a-tool-key',
    });
    const cfg = toolMintConfig();
    expect(cfg.values).toEqual({ LOAN_TOOL_DEMO_USERNAME: 'u' });
  });
});

describe('[TOOLMINT] the wire (GET /api/custom-tool-mint)', () => {
  it('⭐ PIN — no declaration ⇒ null', () => {
    expect(toolMintWire(null, lookup(fullEnv('LOAN_TOOL_DEMO_')))).toBeNull();
  });

  it('⭐ TARGET — complete env ⇒ ready, nothing missing, base URL passed', () => {
    const w = toolMintWire(decl(), lookup(fullEnv('LOAN_TOOL_DEMO_')));
    const demo = w?.companies.find((c) => c.id === 'demo');
    expect(demo).toEqual({
      id: 'demo',
      label: 'demo',
      tool_name: 'loan_demo',
      ready: true,
      missing: [],
      invalid: [],
      base_url: 'https://partner.example.test/',
    });
  });

  it.each(TOOL_MINT_ENV_SUFFIXES)(
    '⭐ TARGET — %s missing ⇒ not ready, the KEY NAME is reported',
    (suffix) => {
      const env = fullEnv('LOAN_TOOL_ACME_');
      delete env[`LOAN_TOOL_ACME_${suffix}`];
      const c = toolMintWire(decl(), lookup(env))?.companies.find(
        (x) => x.id === 'acme',
      );
      expect(c?.ready).toBe(false);
      expect(c?.missing).toEqual([`LOAN_TOOL_ACME_${suffix}`]);
    },
  );

  it('whitespace-only counts as missing', () => {
    const env = {
      ...fullEnv('LOAN_TOOL_DEMO_'),
      LOAN_TOOL_DEMO_PASSWORD: '   ',
    };
    const c = toolMintWire(decl(), lookup(env))?.companies[0];
    expect(c?.missing).toEqual(['LOAN_TOOL_DEMO_PASSWORD']);
  });

  it('⭐ an unusable base URL ⇒ not ready, reported as invalid, and not handed to the form', () => {
    const env = {
      ...fullEnv('LOAN_TOOL_GLOBEX_'),
      LOAN_TOOL_GLOBEX_BASE_URL: 'partner.example.com',
    };
    const c = toolMintWire(decl(), lookup(env))?.companies.find(
      (x) => x.id === 'examplepartner',
    );
    expect(c?.ready).toBe(false);
    expect(c?.invalid).toEqual(['LOAN_TOOL_GLOBEX_BASE_URL']);
    expect(c?.base_url).toBe('');
  });

  it('nothing set ⇒ every company lists all three keys', () => {
    const w = toolMintWire(decl(), () => undefined);
    for (const c of w?.companies ?? []) {
      expect(c.ready).toBe(false);
      expect(c.missing).toHaveLength(3);
    }
    expect(w?.companies).toHaveLength(3);
  });

  it('🔴 PIN — the wire NEVER carries a username or password value, for any company', () => {
    const env = {
      ...fullEnv('LOAN_TOOL_DEMO_'),
      ...fullEnv('LOAN_TOOL_ACME_'),
      ...fullEnv('LOAN_TOOL_GLOBEX_'),
    };
    const json = JSON.stringify(toolMintWire(decl(), lookup(env)));
    expect(json).not.toContain(PW);
    expect(json).not.toContain(USER);
    expect(json).not.toMatch(/"(password|username)"\s*:\s*"[^"{]/);
  });

  it("the template endpoints are the bundle's, as a COPY (a form mutating them cannot touch the bundle)", () => {
    const w = toolMintWire(decl(), () => undefined);
    expect(w?.template.endpoints).toEqual(LOAN_V1_SEED_BUNDLE.tool.endpoints);
    (w?.template.endpoints[0] as Record<string, unknown>)['path'] = 'mutated';
    expect(LOAN_V1_SEED_BUNDLE.tool.endpoints[0]?.['path']).toBe(
      'api/v1/auth/login',
    );
    expect(w?.template.auth_type).toBe('jwt_login');
    expect(w?.template.timeout_ms).toBe(4000);
  });
});

describe('[TOOLMINT] server-only credentials', () => {
  it('⭐ PIN — no declaration ⇒ not_declared', () => {
    expect(toolMintCredentials(null, 'demo', () => 'x')).toEqual({
      ok: false,
      reason: 'not_declared',
    });
  });
  it('unknown company ⇒ unknown_company', () => {
    expect(toolMintCredentials(decl(), 'nope', () => 'x')).toEqual({
      ok: false,
      reason: 'unknown_company',
    });
  });
  it('⭐ incomplete ⇒ refused with the key names', () => {
    const r = toolMintCredentials(decl(), 'demo', lookup({}));
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({
      reason: 'incomplete',
      missing: [
        'LOAN_TOOL_DEMO_BASE_URL',
        'LOAN_TOOL_DEMO_USERNAME',
        'LOAN_TOOL_DEMO_PASSWORD',
      ],
    });
  });
  it('⭐ TARGET — complete ⇒ the values, base URL without trailing slash', () => {
    const r = toolMintCredentials(
      decl(),
      'examplepartner',
      lookup(fullEnv('LOAN_TOOL_GLOBEX_')),
    );
    expect(r).toMatchObject({
      ok: true,
      baseUrl: 'https://partner.example.test',
      username: USER,
      password: PW,
    });
  });
  it('🔴 three companies never share credentials — each reads only its own prefix', () => {
    const env = {
      ...fullEnv('LOAN_TOOL_DEMO_'),
      LOAN_TOOL_ACME_BASE_URL: 'https://b.example.test',
    };
    expect(toolMintCredentials(decl(), 'acme', lookup(env)).ok).toBe(false);
    expect(toolMintCredentials(decl(), 'demo', lookup(env)).ok).toBe(true);
  });
});
