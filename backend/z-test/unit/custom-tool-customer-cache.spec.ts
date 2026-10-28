/**
 * [FEAT-20261016-CUSTCACHE] Per-customer answer cache on the loan site (owner 16/10/2026:
 * "เอาแบบ 12/30 เฉพาะสินเชื่อ" — found 12 h · not found 30 min · other endpoints 12 h · one
 * place in code · every loan OA only).
 *
 * TARGET: loan + webhook (`use`) ⇒ the second message calls the partner ZERO times, writes no
 *         audit row and does not restamp `raw_profile_data` · a not-found profile is kept 30
 *         min and skips the rest · admin refresh (`refresh`) always calls and re-keeps.
 * PIN:    shop-api (no policy) ⇒ Redis never touched, every message live · a caller that does not
 *         ask (slip detail, customer-link) ⇒ live · a transient failure is never kept · no
 *         Redis ⇒ live · the key carries the customer AND the tool version.
 * SITE:   the webhook asks `use`, the refresh route asks `refresh`, the slip detail asks nothing
 *         (source pins, comments stripped).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  resetActiveProvider,
} from '@/modules/customer-provider';
import {
  classifyCustomerAnswer,
  customerAnswerTtlSec,
  customerCacheKey,
  CustomToolService,
  fetchThroughCustomerCache,
} from '@/modules/external';

const byName = (n: string) => {
  const p = CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n);
  if (!p) throw new Error('no provider ' + n);
  return p;
};
const LOAN = byName('loan_v1');
const POLICY = LOAN.customerDataCache!;

type Ep = Record<string, unknown>;
type Answer = { success: boolean; status: number; data: unknown; url?: string };

const ep = (o: Ep): Ep => ({
  status: true,
  purpose: 'data',
  method: 'POST',
  require_jwt: true,
  request_type: 'json',
  payload: {},
  profile_map: { name: '', phone: '', code: '', tier: '' },
  result_rules: [],
  ...o,
});
const LOAN_ENDPOINTS = [
  ep({ key: 'CUSTOMER_PROFILE', method: 'GET', is_profile: true }),
  ep({ key: 'INSTALLMENT_CURRENT' }),
  ep({ key: 'PAYMENT_HISTORY' }),
  ep({ key: 'CONTRACT_INFO' }),
  ep({ key: 'ALL_INSTALLMENTS' }),
];

function fakeRedis() {
  const store = new Map<string, { ttl: number; value: string }>();
  return {
    store,
    get: jest.fn((k: string) => Promise.resolve(store.get(k)?.value ?? null)),
    setex: jest.fn((k: string, ttl: number, value: string) => {
      store.set(k, { ttl, value });
      return Promise.resolve('OK');
    }),
  };
}

function makeSvc(opts: {
  answer: (key: string) => Answer;
  redis?: ReturnType<typeof fakeRedis> | null | 'throws';
  toolUpdatedAt?: string;
}) {
  const fired: string[] = [];
  const svc = Object.create(CustomToolService.prototype) as Record<
    string,
    unknown
  >;
  svc['logger'] = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc['wlog'] = { persist: jest.fn().mockResolvedValue({ _id: 'w1' }) };
  svc['envNamespace'] = 'spec.db';
  svc['getToolForHook'] = jest.fn().mockResolvedValue({
    _id: 't1',
    name: 'loan_demo',
    updated_at: opts.toolUpdatedAt ?? '2026-10-16T00:00:00.000Z',
    endpoints: LOAN_ENDPOINTS,
  });
  svc['getToken'] = jest.fn().mockResolvedValue('tok');
  svc['memberModel'] = {
    updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({}) })),
  };
  svc['hookModel'] = {
    updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({}) })),
  };
  const redis = opts.redis === undefined ? fakeRedis() : opts.redis;
  svc['redisService'] = {
    getClient: () => {
      if (redis === 'throws') throw new Error('redis down');
      return redis;
    },
  };
  const live = (_t: unknown, e: unknown) => {
    const key = String((e as Ep)['key']);
    fired.push(key);
    return Promise.resolve(opts.answer(key));
  };
  svc['_request'] = jest.fn(live);
  svc['_fetchWithCache'] = jest.fn(live);
  return {
    svc: svc as unknown as CustomToolService,
    raw: svc,
    fired,
    redis: redis === 'throws' ? null : redis,
  };
}

const OK = (): Answer => ({
  success: true,
  status: 200,
  data: { data: { customer: { customer_name: 'masked' } } },
});
const NOT_LINKED = (): Answer => ({
  success: false,
  status: 404,
  data: { success: false },
});
const DOWN = (): Answer => ({
  success: false,
  status: 0,
  data: { message: 'timeout' },
});

const HOOK = { _id: 'h1', alias: 'loan-demo' } as never;

afterEach(() => resetActiveProvider());

describe('[CUSTCACHE] the policy (pure)', () => {
  it('⭐ loan declares 12 h / 30 min / 12 h', () => {
    expect(POLICY).toEqual({
      foundTtlSec: 43200,
      notFoundTtlSec: 1800,
      otherTtlSec: 43200,
    });
  });
  it.each([
    ['profile 200 ok', true, { success: true, status: 200 }, 'found'],
    ['profile 404', true, { success: false, status: 404 }, 'not_found'],
    [
      'profile 2xx rule-failed',
      true,
      { success: false, status: 200 },
      'not_found',
    ],
    ['profile timeout (0)', true, { success: false, status: 0 }, 'transient'],
    ['profile 500', true, { success: false, status: 500 }, 'transient'],
    ['profile 401', true, { success: false, status: 401 }, 'transient'],
    ['profile 403', true, { success: false, status: 403 }, 'transient'],
    ['profile 429', true, { success: false, status: 429 }, 'transient'],
    ['other 200 ok', false, { success: true, status: 200 }, 'other_ok'],
    [
      'other 200 rule-failed',
      false,
      { success: false, status: 200 },
      'transient',
    ],
    ['other 404', false, { success: false, status: 404 }, 'transient'],
  ])('%s ⇒ (isProfile=%s) %j ⇒ %s', (_l, isProfile, r, want) => {
    expect(classifyCustomerAnswer(isProfile, r)).toBe(want);
  });
  it('ttl per kind · 0 for transient · a 0 / negative policy number disables that kind', () => {
    expect(
      customerAnswerTtlSec(POLICY, true, { success: true, status: 200 }),
    ).toBe(43200);
    expect(
      customerAnswerTtlSec(POLICY, true, { success: false, status: 404 }),
    ).toBe(1800);
    expect(
      customerAnswerTtlSec(POLICY, false, { success: true, status: 200 }),
    ).toBe(43200);
    expect(
      customerAnswerTtlSec(POLICY, true, { success: false, status: 0 }),
    ).toBe(0);
    expect(
      customerAnswerTtlSec({ ...POLICY, notFoundTtlSec: 0 }, true, {
        success: false,
        status: 404,
      }),
    ).toBe(0);
    expect(
      customerAnswerTtlSec({ ...POLICY, foundTtlSec: -5 }, true, {
        success: true,
        status: 200,
      }),
    ).toBe(0);
  });
  it('🔴 the key carries env ns, tool, tool version, endpoint and the CUSTOMER', () => {
    const k = (o: Partial<Parameters<typeof customerCacheKey>[0]>) =>
      customerCacheKey({
        envNamespace: 'dev.db1',
        toolId: 't1',
        toolUpdatedAt: '2026-10-16T00:00:00.000Z',
        endpointKey: 'customer_profile',
        userId: 'Ua',
        ...o,
      });
    expect(k({})).toBe(
      `custool:dev.db1:cust:t1:${Date.parse('2026-10-16T00:00:00.000Z')}:CUSTOMER_PROFILE:Ua`,
    );
    expect(k({ userId: 'Ub' })).not.toBe(k({}));
    expect(k({ toolUpdatedAt: '2026-10-17T00:00:00.000Z' })).not.toBe(k({}));
    expect(k({ envNamespace: 'prod.db2' })).not.toBe(k({}));
  });
});

describe('[CUSTCACHE] the store (fail-open)', () => {
  const base = {
    policy: POLICY,
    key: 'k',
    isProfile: true,
    label: 'P',
    log: () => {},
  };
  it('use + nothing kept ⇒ live, then kept', async () => {
    const r = fakeRedis();
    const fetch = jest.fn().mockResolvedValue(OK());
    const out = await fetchThroughCustomerCache({
      ...base,
      mode: 'use',
      redis: r,
      fetch,
    });
    expect(out.fromCache).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r.store.get('k')?.ttl).toBe(43200);
  });
  it('use + kept ⇒ no live call', async () => {
    const r = fakeRedis();
    r.store.set('k', { ttl: 1, value: JSON.stringify({ result: OK() }) });
    const fetch = jest.fn();
    const out = await fetchThroughCustomerCache({
      ...base,
      mode: 'use',
      redis: r,
      fetch,
    });
    expect(out).toEqual({ result: OK(), fromCache: true });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refresh + kept ⇒ STILL live, and re-kept', async () => {
    const r = fakeRedis();
    r.store.set('k', { ttl: 1, value: JSON.stringify({ result: OK() }) });
    const fetch = jest.fn().mockResolvedValue(NOT_LINKED());
    const out = await fetchThroughCustomerCache({
      ...base,
      mode: 'refresh',
      redis: r,
      fetch,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out.fromCache).toBe(false);
    expect(r.store.get('k')?.ttl).toBe(1800);
    expect(r.get).not.toHaveBeenCalled();
  });
  it('refresh + transient ⇒ the kept answer is left alone', async () => {
    const r = fakeRedis();
    r.store.set('k', { ttl: 1, value: JSON.stringify({ result: OK() }) });
    await fetchThroughCustomerCache({
      ...base,
      mode: 'refresh',
      redis: r,
      fetch: () => Promise.resolve(DOWN()),
    });
    expect(JSON.parse(r.store.get('k')!.value).result).toEqual(OK());
  });
  it('🔴 no Redis / read throws / write throws / garbage entry ⇒ the live answer, no error', async () => {
    const fetch = jest.fn().mockResolvedValue(OK());
    expect(
      (
        await fetchThroughCustomerCache({
          ...base,
          mode: 'use',
          redis: null,
          fetch,
        })
      ).result,
    ).toEqual(OK());
    const broken = {
      get: jest.fn().mockRejectedValue(new Error('x')),
      setex: jest.fn().mockRejectedValue(new Error('y')),
    };
    expect(
      (
        await fetchThroughCustomerCache({
          ...base,
          mode: 'use',
          redis: broken,
          fetch,
        })
      ).result,
    ).toEqual(OK());
    const garbage = fakeRedis();
    garbage.store.set('k', { ttl: 1, value: '{not json' });
    expect(
      (
        await fetchThroughCustomerCache({
          ...base,
          mode: 'use',
          redis: garbage,
          fetch,
        })
      ).fromCache,
    ).toBe(false);
  });
});

describe('[CUSTCACHE] inside getCombinedData', () => {
  it('⭐ PIN — shop-api (no policy): asked to `use`, Redis is never touched and every message is live', async () => {
    const m = makeSvc({ answer: () => OK() });
    await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    expect(m.redis?.get).not.toHaveBeenCalled();
    expect(m.redis?.setex).not.toHaveBeenCalled();
    expect(m.fired).toHaveLength(10);
  });

  it('⭐ PIN — loan, caller does not ask (slip detail / customer-link) ⇒ live, Redis untouched', async () => {
    bindActiveProvider(LOAN);
    const m = makeSvc({ answer: () => OK() });
    await m.svc.getCombinedData('U1', HOOK);
    await m.svc.getCombinedData('U1', HOOK, { logSource: 'x' });
    expect(m.redis?.get).not.toHaveBeenCalled();
    expect(m.redis?.setex).not.toHaveBeenCalled();
    expect(m.fired).toHaveLength(10);
  });

  it('⭐ TARGET — loan webhook: 2nd message = 0 partner calls, same answer, no audit row, no restamp', async () => {
    bindActiveProvider(LOAN);
    const m = makeSvc({ answer: () => OK() });
    const first = await m.svc.getCombinedData('U1', HOOK, {
      customerCache: 'use',
    });
    expect(m.fired).toHaveLength(5);
    const wlog = (m.raw['wlog'] as { persist: jest.Mock }).persist;
    const member = (m.raw['memberModel'] as { updateOne: jest.Mock }).updateOne;
    expect(wlog).toHaveBeenCalledTimes(5);
    expect(member).toHaveBeenCalledTimes(1);
    expect([...m.redis!.store.values()].map((v) => v.ttl)).toEqual([
      43200, 43200, 43200, 43200, 43200,
    ]);

    const second = await m.svc.getCombinedData('U1', HOOK, {
      customerCache: 'use',
    });
    expect(m.fired).toHaveLength(5); /* nothing new fired */
    expect(second).toEqual(first);
    expect(wlog).toHaveBeenCalledTimes(
      5,
    ); /* no row for an answer nobody fetched */
    expect(member).toHaveBeenCalledTimes(
      1,
    ); /* profile_data_updated_at not moved */
  });

  it('⭐ TARGET — loan webhook: NOT LINKED kept 30 min; the 2nd message calls nobody', async () => {
    bindActiveProvider(LOAN);
    const m = makeSvc({
      answer: (k) => (k === 'CUSTOMER_PROFILE' ? NOT_LINKED() : OK()),
    });
    await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    expect(m.fired).toEqual([
      'CUSTOMER_PROFILE',
    ]); /* profile-first: the rest skipped */
    expect([...m.redis!.store.values()].map((v) => v.ttl)).toEqual([1800]);
    await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    expect(m.fired).toEqual(['CUSTOMER_PROFILE']);
  });

  it('🔴 PIN — a transient profile failure is never kept: the next message asks again', async () => {
    bindActiveProvider(LOAN);
    const m = makeSvc({
      answer: (k) => (k === 'CUSTOMER_PROFILE' ? DOWN() : OK()),
    });
    await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    expect(m.fired).toEqual(['CUSTOMER_PROFILE', 'CUSTOMER_PROFILE']);
    expect(m.redis!.setex).not.toHaveBeenCalled();
  });

  it('⭐ TARGET — admin refresh always calls, and its answer is what the next message gets', async () => {
    bindActiveProvider(LOAN);
    let linked = false;
    const m = makeSvc({
      answer: (k) =>
        k === 'CUSTOMER_PROFILE' && !linked ? NOT_LINKED() : OK(),
    });
    await m.svc.getCombinedData('U1', HOOK, {
      customerCache: 'use',
    }); /* not linked, kept */
    linked = true; /* the customer links at the partner */
    await m.svc.getCombinedData('U1', HOOK, {
      customerCache: 'refresh',
    }); /* admin presses Refresh */
    const before = m.fired.length;
    const out = await m.svc.getCombinedData('U1', HOOK, {
      customerCache: 'use',
    });
    expect(m.fired.length).toBe(before); /* served from what the refresh kept */
    expect((out['CUSTOMER_PROFILE'] as { success: boolean }).success).toBe(
      true,
    );
  });

  it('🔴 two customers never share an answer', async () => {
    bindActiveProvider(LOAN);
    const m = makeSvc({ answer: () => OK() });
    await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    await m.svc.getCombinedData('U2', HOOK, { customerCache: 'use' });
    expect(m.fired).toHaveLength(10);
  });

  it('editing the tool (updated_at moves) ⇒ old answers are not served', async () => {
    bindActiveProvider(LOAN);
    const m = makeSvc({ answer: () => OK() });
    await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    (m.raw['getToolForHook'] as jest.Mock).mockResolvedValue({
      _id: 't1',
      name: 'loan_demo',
      updated_at: '2026-10-17T00:00:00.000Z',
      endpoints: LOAN_ENDPOINTS,
    });
    await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    expect(m.fired).toHaveLength(10);
  });

  it('🔴 Redis down ⇒ every message live, same answer, nothing thrown', async () => {
    bindActiveProvider(LOAN);
    const m = makeSvc({ answer: () => OK(), redis: 'throws' });
    const a = await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    const b = await m.svc.getCombinedData('U1', HOOK, { customerCache: 'use' });
    expect(a).toEqual(b);
    expect(m.fired).toHaveLength(10);
  });

  it('no customer (Refresh site rules / broadcast) ⇒ never cached', async () => {
    bindActiveProvider(LOAN);
    const m = makeSvc({ answer: () => OK() });
    await m.svc.getCombinedData('', HOOK, { customerCache: 'use' });
    expect(m.redis?.get).not.toHaveBeenCalled();
  });
});

describe('[CUSTCACHE] who asks for the cache (source pins, comments stripped)', () => {
  const src = (p: string) =>
    readFileSync(join(__dirname, '../../src/modules', p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it('⭐ the webhook prefetch asks `use`', () => {
    const s = src('webhook/webhook.service.ts');
    const body = s.slice(
      s.indexOf('private loadCombinedProfile('),
      s.indexOf('private paymentSender('),
    );
    expect(body).toMatch(
      /this\.customTool\.getCombinedData\(\s*userId,\s*hook,\s*\{\s*customerCache:\s*'use'\s*\}\s*\)/,
    );
    /* the shop-api external-API line is untouched */
    expect(body).toMatch(/this\.externalApi\.getCombinedData\(userId, hook\)/);
  });

  it('⭐ the admin refresh route asks `refresh`', () => {
    const s = src('chat/members.service.ts');
    expect(s).toMatch(
      /getCombinedData\(member\.line_user_id, hook, \{[\s\S]{0,200}customerCache: 'refresh'/,
    );
  });

  it('PIN — the slip detail and customer-link do not ask (they stay live)', () => {
    expect(src('slip/slip-verification.service.ts')).not.toContain(
      'customerCache',
    );
    expect(src('customer-link/customer-link.service.ts')).not.toContain(
      'customerCache',
    );
  });
});
