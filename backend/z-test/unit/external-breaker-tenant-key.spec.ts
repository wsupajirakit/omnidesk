/**
 * [FIX-20260818-CBTENANTKEY] The circuit breaker is keyed per OA, not globally.
 * audit_18_aug H7.
 *
 * ## The hole
 * `cb:open:${endpointKey}` and `cb:fails:${endpointKey}` were keyed on the
 * ENDPOINT NAME alone. Every OA wired to the same integration shares one
 * endpoint key — measured live, `omnideskdevoa` and `demo-oa-three` both point at custom
 * tool `a0d000000000000000000051` — so five failures against ONE customer's
 * upstream opened the breaker for EVERY customer on that integration.
 *
 * It needs no LINE traffic and no elevated account to trigger: any dashboard
 * user with access to any hook can drive `execute-external-endpoint` at a dead
 * endpoint until the breaker opens, and take the other tenants down with it.
 *
 * ## Why the key was available all along
 * `hookContext` is already a parameter of `_executeRequest`, the same method
 * that calls all three breaker helpers. Nothing had to be threaded through.
 *
 * ## Anti-bloat: this REMOVES a copy rather than adding a helper
 * The "derive a key from hookContext" expression already existed twice in this
 * one file — `_loginFailKey` and `getCombinedData`. Both now call a single
 * `_hookKey`, so the file ends up with one definition where it had two, and the
 * breaker becomes its third consumer rather than a fourth copy.
 *
 * The two differed: `_loginFailKey` also accepted a plain string. Checked every
 * caller of both — webhook.service.ts:1512-1513, members.service.ts:251,412,
 * customer-link.service.ts:1201, hook-outbound.service.ts:971,976 — and all of
 * them pass an OBJECT, never a string. So unifying on the more permissive
 * version is a strict superset that no live path exercises differently.
 *
 * ## `global` is still shared, and that is correct
 * `hook-outbound.service.ts:976` passes a literal config object carrying neither
 * `alias` nor `_id`. It resolves to `global` and keeps sharing one bucket, which
 * is right: there is no tenant to separate it by. Pinned below so nobody
 * "fixes" it into an unbounded key later.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ExternalApiService } from '@/modules/external';

type Svc = Record<string, unknown> & {
  _cbIsOpen: (endpointKey: string, hookContext?: unknown) => Promise<boolean>;
  _cbRecordFailure: (
    endpointKey: string,
    reason: string,
    hookContext?: unknown,
  ) => Promise<void>;
  _loginFailKey: (hookContext: unknown) => string;
};

const HOOK_A = { _id: 'a0d000000000000000000017', alias: 'omnideskdevoa' };
const HOOK_B = { _id: 'a0d000000000000000000018', alias: 'demo-oa-three' };
/** The literal config object `hook-outbound` passes — no alias, no _id. */
const NO_IDENTITY = { external_api_url: 'https://x.test' };

/* [FIX-20260905-GLOBALNS] `envNamespace` is normally set by the constructor,
   which `Object.create` skips — so it is assigned here. A default keeps every
   pre-existing case reading the way it did; the cross-environment cases below
   pass a second value. */
function makeService(envNamespace = 'dev.aaaaaaaa'): {
  svc: Svc;
  keys: string[];
} {
  const keys: string[] = [];
  const client = {
    get: (k: string) => {
      keys.push(k);
      return Promise.resolve(null);
    },
    set: (k: string) => {
      keys.push(k);
      return Promise.resolve('OK');
    },
    del: (k: string) => {
      keys.push(k);
      return Promise.resolve(1);
    },
    incr: (k: string) => {
      keys.push(k);
      return Promise.resolve(1);
    },
    expire: () => Promise.resolve(1),
  };
  const svc = Object.create(ExternalApiService.prototype) as Svc;
  Object.assign(svc, {
    redisService: { getClient: () => client },
    envNamespace,
  });
  return { svc, keys };
}

/** Every redis key this call touched that belongs to the breaker. */
const cbKeys = (keys: string[]): string[] =>
  keys.filter((k) => k.startsWith('cb:'));

describe('[CBTENANTKEY] one OA cannot open the breaker for another', () => {
  it('⭐ two OAs on the SAME endpoint use different breaker keys', async () => {
    const a = makeService();
    const b = makeService();

    await a.svc._cbIsOpen('CUSTOMER_PROFILE', HOOK_A);
    await b.svc._cbIsOpen('CUSTOMER_PROFILE', HOOK_B);

    const ka = cbKeys(a.keys);
    const kb = cbKeys(b.keys);
    expect(ka.length).toBeGreaterThan(0);
    expect(kb.length).toBeGreaterThan(0);
    expect(ka).not.toEqual(kb);
  });

  it('⭐ recording a failure for one OA does not touch another OA`s counter', async () => {
    const a = makeService();

    await a.svc._cbRecordFailure('CUSTOMER_PROFILE', 'timeout', HOOK_A);

    const touched = cbKeys(a.keys);
    expect(touched.length).toBeGreaterThan(0);
    // Whatever the exact shape, no key may name the other tenant.
    expect(touched.join(' ')).not.toContain('demo-oa-three');
    expect(touched.join(' ')).toContain('omnideskdevoa');
  });

  it('the same OA and endpoint keep ONE key — the breaker still works', async () => {
    const a = makeService();
    const b = makeService();

    await a.svc._cbIsOpen('CUSTOMER_PROFILE', HOOK_A);
    await b.svc._cbIsOpen('CUSTOMER_PROFILE', { ...HOOK_A });

    expect(cbKeys(a.keys)).toEqual(cbKeys(b.keys));
  });

  it('a context with no identity still shares one bucket, deliberately', async () => {
    // hook-outbound passes a literal config object. There is no tenant to
    // separate it by, so `global` is the honest answer — and it keeps the key
    // space bounded, which an attacker-chosen component would not.
    const a = makeService();

    await a.svc._cbIsOpen('CUSTOMER_PROFILE', NO_IDENTITY);

    expect(cbKeys(a.keys).join(' ')).toContain('global');
  });
});

describe('[CBTENANTKEY] the login-fail key keeps its behaviour', () => {
  it('an object context is unchanged', () => {
    const { svc } = makeService();
    expect(svc._loginFailKey(HOOK_A)).toBe(
      'login:dev.aaaaaaaa:fail:omnideskdevoa',
    );
  });

  it('a string context is still accepted — the superset is preserved', () => {
    // No live caller passes a string, but `_loginFailKey` accepted one before
    // the two expressions were unified, so the shared helper must too.
    const { svc } = makeService();
    expect(svc._loginFailKey('some-key')).toBe(
      'login:dev.aaaaaaaa:fail:some-key',
    );
  });

  it('no identity falls back to global', () => {
    const { svc } = makeService();
    expect(svc._loginFailKey(NO_IDENTITY)).toBe(
      'login:dev.aaaaaaaa:fail:global',
    );
  });
});

/**
 * A STRUCTURAL pin, added because this exact gap opened while writing this file.
 *
 * The behavioural cases above call the breaker helpers DIRECTLY with a context,
 * so they went green the moment the helpers accepted one — while the three real
 * call sites inside `_executeRequest` were still passing none, which resolves to
 * `global` and leaves every tenant sharing one key exactly as before. The tests
 * would have passed and production would have been unchanged.
 *
 * เทสเขียวได้โดยที่ของจริงยังไม่เปลี่ยน — จุดนี้จึงต้องตรึงที่ call site ด้วย
 */
describe('[CBTENANTKEY] the real call sites actually pass the tenant', () => {
  /**
   * Read RAW and filter comment LINES, rather than stripping `/* … *\/` blocks.
   *
   * The obvious strip is wrong on this file specifically: a non-greedy block
   * strip pairs an opening marker with a later closing one and swallows the code
   * between them. Measured here — 3 call sites in the raw source, 1 after
   * stripping. A pin built on that would have quietly asserted almost nothing.
   * ตัวตัดคอมเมนต์กินโค้ดในไฟล์นี้ — เลยอ่านดิบแล้วกรองทีละบรรทัดแทน
   */
  const lines = readFileSync(
    join(__dirname, '../../src/modules/external/external-api.service.ts'),
    'utf8',
  )
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });

  it('every breaker call in the request path names hookContext', () => {
    const calls = lines.filter((l) =>
      /this\._cb(IsOpen|RecordSuccess|RecordFailure)\(/.test(l),
    );

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call).toContain('hookContext');
    }
  });

  it('the key rule has ONE definition, not four', () => {
    // It existed FOUR times in this file before this change — `_loginFailKey`,
    // `getCombinedData`, and two byte-identical blocks further down. That is the
    // drift this codebase has already been bitten by, so the count is pinned.
    const copies = lines.filter((l) => l.includes('alias || ('));
    expect(copies).toHaveLength(1);
  });
});

/**
 * [FIX-20260905-GLOBALNS] The 18/08 fix above separated one OA from another. It
 * could not separate one ENVIRONMENT from another, and the reason is the very
 * thing it pinned as correct: `global`.
 *
 * `global` is a LITERAL. It is the same six characters on staging and on
 * production, so `cb:open:global:<endpoint>` was one key shared by both
 * deployments — the same shape as `qcache:v1:webhooklog:ALL:<params>`, the key
 * that put staging's rows on the production broadcast screen on 05/09/2026.
 * Staging and production run against one Redis host and one `REDIS_DB`.
 *
 * What that cost, concretely: five qualifying failures in 60s on STAGING's
 * `global` context opened PRODUCTION's breaker for 30s against an upstream that
 * was answering perfectly, and a staging login failure suppressed a production
 * login for 60s. Neither is fail-open — fail-open covers a Redis error, never a
 * genuine trip.
 *
 * ⚠️ The `global` bucket itself is UNCHANGED and still shared, exactly as the
 *    block above argues it should be. What changed is that the bucket is now per
 *    deployment. หนึ่ง environment หนึ่งถัง ไม่ใช่ถังเดียวทั้งโลก
 */
describe('[GLOBALNS] one environment cannot open another environment`s breaker', () => {
  const STG = 'dev.5555aaaa';
  const PRD = 'prod.9999bbbb';

  it('⭐ the `global` context no longer collides across environments', async () => {
    const stg = makeService(STG);
    const prd = makeService(PRD);

    await stg.svc._cbIsOpen('CUSTOMER_PROFILE', NO_IDENTITY);
    await prd.svc._cbIsOpen('CUSTOMER_PROFILE', NO_IDENTITY);

    const a = cbKeys(stg.keys);
    const b = cbKeys(prd.keys);
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
    // Both still resolve to the SAME tenant bucket — proving the separation came
    // from the environment segment and not from losing `global`.
    expect(a.join(' ')).toContain('global');
    expect(b.join(' ')).toContain('global');
  });

  it('⭐ a failure recorded on one environment leaves the other`s counter alone', async () => {
    const stg = makeService(STG);
    const prd = makeService(PRD);

    await stg.svc._cbRecordFailure('CUSTOMER_PROFILE', 'timeout', NO_IDENTITY);
    await prd.svc._cbIsOpen('CUSTOMER_PROFILE', NO_IDENTITY);

    // No key staging touched may be a key production reads.
    for (const k of cbKeys(prd.keys)) {
      expect(cbKeys(stg.keys)).not.toContain(k);
    }
  });

  it('the login cooldown is per environment too', () => {
    expect(makeService(STG).svc._loginFailKey(NO_IDENTITY)).not.toBe(
      makeService(PRD).svc._loginFailKey(NO_IDENTITY),
    );
  });

  it('within ONE environment the bucket is still shared — the breaker still works', async () => {
    // The point of `global`: two callers with no tenant identity must keep
    // sharing a bucket, or the breaker stops protecting anything.
    const a = makeService(STG);
    const b = makeService(STG);

    await a.svc._cbIsOpen('CUSTOMER_PROFILE', NO_IDENTITY);
    await b.svc._cbIsOpen('CUSTOMER_PROFILE', {
      external_api_url: 'https://other.test',
    });

    expect(cbKeys(a.keys)).toEqual(cbKeys(b.keys));
  });
});
