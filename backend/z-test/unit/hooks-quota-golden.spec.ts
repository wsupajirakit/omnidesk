/**
 * [PHASE3-I-QUOTA] the golden the migration must not move
 * ============================================================================
 * LINE push Phase 3, candidate I — the safest one, migrated first by the order
 * in `todo/task/20082026/todo1_20082026_line-push-phase12.md`
 * ("I → D → F → C → E → G → B → A", safest first).
 *
 * WHAT THIS FILE IS FOR. The playbook's rule is that a migration swaps ONLY the
 * transport and every observable thing around it comes out byte-identical. This
 * spec is the BEFORE capture: it pins what `getHookQuota` returns and throws
 * TODAY, written and run against the un-migrated code first, so the AFTER run is
 * a comparison and not an opinion. เขียนก่อนแก้ · หลังแก้ต้องผ่านไฟล์เดิมนี้เป๊ะ.
 *
 * ⚠️ IT STUBS THE NETWORK, NOT THE PRIVATE METHOD — and that choice is the whole
 * point. The first draft faked `lineGet`, which the migration DELETES from this
 * path, so the AFTER run could not have used the same file and "byte-identical"
 * would have been a claim rather than a comparison. Both transports are stubbed
 * here instead — `fetch` (the old `lineGet`) and `axios.get` (the new
 * `LineQuotaApi`) — so this exact file runs unchanged on both sides of the swap.
 * สตับที่ชั้นเน็ต ไม่ใช่เมธอดข้างใน ⇒ ไฟล์เดียวใช้เทียบได้ทั้งก่อนและหลัง.
 *
 * VERIFIED BEFORE WRITING (dev-local §9 — the plan is a claim, the code is the
 * truth), against `hooks.service.ts` at the time of the swap:
 *   · `lineGet` throws `InternalServerErrorException` with LINE's status in the
 *     message, and uses a 5s abort timeout (`LINE_TIMEOUT_MS = 5000`)
 *   · `LineQuotaApi` uses `QUOTA_TIMEOUT_MS = 5_000` — the same, so the swap
 *     carries no timing change
 *   · `getHookQuota` returns LINE's two payloads UNFLATTENED plus `remaining`
 *   · `remaining` clamps at 0 and is `null` when either number is not finite
 *     (`type:'none'` unlimited quota carries no `value` → NaN → null, never 0)
 *   · the token is `access_token` ONLY — owner's decision 15/08, no `line_key`
 *     fallback on this path, unlike the send paths
 */
import axios from 'axios';

import { HooksService } from '@/modules/hooks/hooks.service';
import { LineQuotaApi } from '@/infra/line';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type Json = Record<string, unknown>;

/** LINE's two GET urls, told apart by the one word that differs. */
const isConsumption = (url: string): boolean => url.includes('consumption');

/**
 * Answer both LINE reads with fixed payloads, on BOTH transports at once.
 * Whichever one the service uses today, the same bodies come back.
 */
function stubLine(quota: Json, usage: Json): void {
  mockedAxios.get.mockImplementation((url: string) =>
    Promise.resolve({
      status: 200,
      headers: {},
      data: isConsumption(url) ? usage : quota,
    }),
  );
  global.fetch = jest.fn((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(isConsumption(String(url)) ? usage : quota),
    }),
  ) as never;
}

/** Make both transports fail the way LINE does on a bad token. */
function stubLineStatus(status: number): void {
  const err = Object.assign(
    new Error(`Request failed with status code ${status}`),
    {
      isAxiosError: true,
      response: { status, data: {} },
    },
  );
  mockedAxios.get.mockImplementation(() => Promise.reject(err));
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) }),
  ) as never;
}

/**
 * The service with only what `getHookQuota` reaches. `lineQuotaApi` is the real
 * class over the stubbed axios — faking it would test the fake, not the swap.
 */
function serviceWith(token = 'tok-real'): HooksService {
  const svc = Object.create(HooksService.prototype) as HooksService;
  /* both are private on the class, so they are set through an index cast rather
     than an intersection — TS collapses `Class & {privateName}` to `never`. */
  const seat = svc as unknown as Record<string, unknown>;
  seat['loadHookAccessToken'] = () => Promise.resolve(token);
  seat['lineQuotaApi'] = new LineQuotaApi();
  return svc;
}

/* axios is module-mocked, so its call record survives between cases — the
   "nothing was sent" assertions below would read a neighbour's calls without
   this. mock ต้องล้างทุกเคส ไม่งั้นนับของเคสก่อนหน้าติดมา */
beforeEach(() => {
  jest.clearAllMocks();
  (global as { fetch?: unknown }).fetch = undefined;
});

const QUOTA_LIMITED: Json = { type: 'limited', value: 1000 };
const QUOTA_UNLIMITED: Json = { type: 'none' };
const USAGE = (totalUsage: unknown): Json => ({ totalUsage });

describe('⭐ the shape callers and the widget depend on', () => {
  it("returns LINE's two payloads UNFLATTENED, plus remaining", async () => {
    /* the FE reads `quota.type`, `quota.value` and `consumption.totalUsage`
       straight off these objects — flattening them would break the widget. */
    stubLine(QUOTA_LIMITED, USAGE(250));
    const svc = serviceWith();
    await expect(svc.getHookQuota('h1')).resolves.toEqual({
      quota: QUOTA_LIMITED,
      consumption: USAGE(250),
      remaining: 750,
    });
  });

  it('⭐ remaining clamps at zero — never negative', async () => {
    stubLine(QUOTA_LIMITED, USAGE(1500));
    const svc = serviceWith();
    await expect(svc.getHookQuota('h1')).resolves.toMatchObject({
      remaining: 0,
    });
  });

  it('⭐ an unlimited quota gives remaining null, NOT zero', async () => {
    /* `type:'none'` carries no `value` → NaN → null. Zero here would read as
       "out of quota" on a plan that has no limit at all.
       ไม่จำกัด = null ไม่ใช่ 0 */
    stubLine(QUOTA_UNLIMITED, USAGE(40));
    const svc = serviceWith();
    await expect(svc.getHookQuota('h1')).resolves.toEqual({
      quota: QUOTA_UNLIMITED,
      consumption: USAGE(40),
      remaining: null,
    });
  });

  it('a non-numeric usage also gives null', async () => {
    stubLine(QUOTA_LIMITED, USAGE('n/a'));
    const svc = serviceWith();
    await expect(svc.getHookQuota('h1')).resolves.toMatchObject({
      remaining: null,
    });
  });

  it('both LINE reads happen, and both carry the same token', async () => {
    stubLine(QUOTA_LIMITED, USAGE(1));
    const seen: string[] = [];
    const auth: string[] = [];
    mockedAxios.get.mockImplementation((url: string, cfg?: unknown) => {
      seen.push(url);
      const headers = (cfg as { headers?: Record<string, string> })?.headers;
      auth.push(String(headers?.['Authorization'] ?? ''));
      return Promise.resolve({
        status: 200,
        headers: {},
        data: isConsumption(url) ? USAGE(1) : QUOTA_LIMITED,
      });
    });
    global.fetch = jest.fn(
      (url: string, init?: { headers?: Record<string, string> }) => {
        seen.push(String(url));
        auth.push(String(init?.headers?.['Authorization'] ?? ''));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              isConsumption(String(url)) ? USAGE(1) : QUOTA_LIMITED,
            ),
        });
      },
    ) as never;

    await serviceWith().getHookQuota('h1');
    expect(seen).toHaveLength(2);
    expect(seen.some((u) => u.includes('quota'))).toBe(true);
    expect(seen.some((u) => isConsumption(u))).toBe(true);
    /* one token for both calls — the migration must not start resolving twice */
    expect(new Set(auth).size).toBe(1);
    expect(auth[0]).toBe('Bearer tok-real');
  });
});

describe('⭐ the failure callers already handle', () => {
  it('a LINE error surfaces as InternalServerError carrying the status', async () => {
    /* the exact sentence the dashboard shows. `line-quota-api.spec.ts` builds
       the same string, which is what makes the migrated path comparable.
       ข้อความนี้ขึ้นหน้าจอจริง ⇒ ห้ามเปลี่ยนแม้แต่ตัวอักษรเดียว */
    stubLineStatus(401);
    await expect(serviceWith().getHookQuota('h1')).rejects.toThrow(
      'Request failed with status code 401',
    );
  });

  it('the token guard runs before any LINE call', async () => {
    /* `loadHookAccessToken` throws for a bad id / missing hook / no access —
       nothing must reach LINE in that case. ยังไม่มี token = ห้ามยิงออกไป */
    stubLine(QUOTA_LIMITED, USAGE(1));
    const svc = Object.create(HooksService.prototype) as HooksService;
    const seat = svc as unknown as Record<string, unknown>;
    seat['loadHookAccessToken'] = () =>
      Promise.reject(new Error('Line access token is required'));
    seat['lineQuotaApi'] = new LineQuotaApi();
    await expect(svc.getHookQuota('h1')).rejects.toThrow(
      'Line access token is required',
    );
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
