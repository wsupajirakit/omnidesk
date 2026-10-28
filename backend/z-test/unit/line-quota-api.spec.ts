import axios from 'axios';

import { LineQuotaApi } from '@/infra/line';

/**
 * ==== [FEAT-20260820-LINEPUSH25] quota reads — the neutral GET side ====
 *
 * Phase 2.5. Pins `LineQuotaApi` against the behaviour of the LIVE quota
 * proxy it may one day replace: `hooks.service.ts:805-867` (`lineGet` +
 * `getHookQuota`) serving `GET /hook/:id/quota` (hooks.controller.ts:210),
 * which the dashboard's useHookQuota reads. Differences are deliberate and
 * documented in the source header: envelope result instead of throw, axios
 * instead of fetch. The SEMANTICS pinned here are the live ones:
 *   · two GETs — /v2/bot/message/quota and /quota/consumption
 *   · summary keeps LINE's payloads UNFLATTENED + a computed `remaining`
 *     (hooks.service.ts:844-846, 859-866)
 *   · quota.type === 'none' (unlimited) has no `value` → remaining null,
 *     never 0
 * Token policy (access_token ONLY, owner 15/08 — hooks.service.ts:837-842)
 * stays with the CALLER at migration time; this layer takes a plain string.
 *
 * No real LINE traffic: axios.get/post and fetch reject by default.
 */

const FAKE_TOKEN = 'unit-test-not-a-real-channel-token';
const QUOTA_URL = 'https://api.line.me/v2/bot/message/quota';
const CONSUMPTION_URL = 'https://api.line.me/v2/bot/message/quota/consumption';

const okResponse = (data: unknown, requestId = 'req-q-1') => ({
  status: 200,
  statusText: 'OK',
  data,
  headers: { 'x-line-request-id': requestId },
  config: {},
});

const httpError = (status: number, data: unknown) => {
  const err = new Error(
    `Request failed with status code ${status}`,
  ) as Error & {
    isAxiosError: boolean;
    response: {
      status: number;
      data: unknown;
      headers: Record<string, string>;
    };
  };
  err.isAxiosError = true;
  err.response = { status, data, headers: {} };
  return err;
};

describe('LineQuotaApi — quota + consumption reads (no real LINE traffic)', () => {
  let api: LineQuotaApi;
  let getSpy: jest.SpyInstance;
  let postSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    const reject = (target: unknown) =>
      Promise.reject(
        new Error(`unstubbed outbound request: ${String(target)}`),
      );
    getSpy = jest
      .spyOn(axios, 'get')
      .mockImplementation((url: unknown) => reject(url));
    postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementation((url: unknown) => reject(url));
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        reject(input instanceof Request ? input.url : String(input)),
      );
    api = new LineQuotaApi();
  });

  afterEach(() => {
    expect(postSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('getMessageQuota: one GET with Bearer and the 5s budget the live proxy uses (hooks.service.ts:122)', async () => {
    getSpy.mockResolvedValueOnce(okResponse({ type: 'limited', value: 1000 }));
    const res = await api.getMessageQuota(FAKE_TOKEN);

    expect(getSpy).toHaveBeenCalledTimes(1);
    const [url, config] = getSpy.mock.calls[0] as [
      string,
      { headers: Record<string, string>; timeout: number },
    ];
    expect(url).toBe(QUOTA_URL);
    expect(config.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(config.timeout).toBe(5_000);
    expect(res).toMatchObject({
      ok: true,
      status: 200,
      lineRequestId: 'req-q-1',
      data: { type: 'limited', value: 1000 },
    });
  });

  it('getQuotaConsumption hits the consumption URL', async () => {
    getSpy.mockResolvedValueOnce(okResponse({ totalUsage: 250 }));
    const res = await api.getQuotaConsumption(FAKE_TOKEN);
    expect((getSpy.mock.calls[0] as [string])[0]).toBe(CONSUMPTION_URL);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ totalUsage: 250 });
  });

  it('summary: LINE payloads stay UNFLATTENED + remaining = max(limit-used, 0) (hooks.service.ts:859-866)', async () => {
    getSpy
      .mockResolvedValueOnce(okResponse({ type: 'limited', value: 1000 }))
      .mockResolvedValueOnce(okResponse({ totalUsage: 250 }));
    const res = await api.getQuotaSummary(FAKE_TOKEN);
    expect(res).toEqual({
      ok: true,
      status: 200,
      quota: { type: 'limited', value: 1000 },
      consumption: { totalUsage: 250 },
      remaining: 750,
    });
  });

  it('summary: overspent clamps remaining to 0, never negative', async () => {
    getSpy
      .mockResolvedValueOnce(okResponse({ type: 'limited', value: 100 }))
      .mockResolvedValueOnce(okResponse({ totalUsage: 150 }));
    const res = await api.getQuotaSummary(FAKE_TOKEN);
    expect(res.remaining).toBe(0);
  });

  it('summary: type "none" (unlimited, no value) → remaining null, never 0 (hooks.service.ts:844-846)', async () => {
    getSpy
      .mockResolvedValueOnce(okResponse({ type: 'none' }))
      .mockResolvedValueOnce(okResponse({ totalUsage: 250 }));
    const res = await api.getQuotaSummary(FAKE_TOKEN);
    expect(res.ok).toBe(true);
    expect(res.remaining).toBeNull();
  });

  it('summary: a 401 on either GET → ok:false with the status and reason, remaining null — never throws', async () => {
    getSpy
      .mockRejectedValueOnce(
        httpError(401, { message: 'Authentication failed' }),
      )
      .mockResolvedValueOnce(okResponse({ totalUsage: 250 }));
    const res = await api.getQuotaSummary(FAKE_TOKEN);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.reason).toContain('HTTP 401');
    expect(res.remaining).toBeNull();
  });

  it('empty token: no network call, ok:false status 0', async () => {
    const res = await api.getMessageQuota('');
    expect(getSpy).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.reason).toMatch(/token/i);
  });
});
