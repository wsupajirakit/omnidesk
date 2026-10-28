/**
 * [FIX-20261014-CUSTOMCIRCUIT] A custom-tool profile whose breaker is open is reported as such.
 * ============================================================================
 * `fetchCombinedProfile` decided "circuit open" by comparing the profile block's top-level
 * `message` with the LEGACY external-API text. A custom tool says it differently — status 503,
 * `data.message` = `circuit_open: endpoint "<KEY>" temporarily suspended` — so on every
 * custom-tool hook (shop-api's tools and the loan tool alike) the flag was always false and the
 * PROFILE-CHECK log blamed the partner ("ปลายทางไม่สำเร็จ status=503") instead of the breaker.
 *
 * What it does NOT change: the slip gates. `shouldReviewUnknownProfile` answers `true` for an
 * open breaker AND for any non-404 failure, `shouldBlockUnlinkedSlip` answers `false` for both,
 * so the verdict is the same either way — pinned below so that stays a measured fact.
 *
 * TARGET: the real circuit-open answer, produced by the shipped `_request` with the breaker
 * open and assembled by the shipped `getCombinedData`, reads as open.
 * PIN: the legacy line, a 404, and a 503 that is not the breaker all read exactly as before.
 */
import { CustomToolService } from '@/modules/external';
import {
  fetchCombinedProfile,
  shouldBlockUnlinkedSlip,
  shouldReviewUnknownProfile,
} from '@/modules/webhook';

const TOOL = {
  _id: 't1',
  name: 'any-tool',
  base_url: 'https://partner.invalid',
  auth_type: 'none',
  endpoints: [
    {
      key: 'CUSTOMER_PROFILE',
      method: 'GET',
      path: 'customer/{{line_user_id}}',
      purpose: 'data',
      is_profile: true,
      status: true,
      require_jwt: false,
      payload: {},
      result_rules: [],
      profile_map: { name: '', phone: '', code: '', tier: '' },
    },
  ],
};

/** The shipped engine with ONLY the breaker forced open — nothing leaves the process. */
async function combinedWithOpenBreaker(): Promise<Record<string, unknown>> {
  const svc = Object.create(CustomToolService.prototype) as Record<
    string,
    unknown
  >;
  svc['logger'] = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc['wlog'] = { persist: jest.fn().mockResolvedValue({}) };
  svc['getToolForHook'] = jest.fn().mockResolvedValue(TOOL);
  svc['getToken'] = jest.fn().mockResolvedValue(null);
  svc['_cbIsOpen'] = jest.fn().mockResolvedValue(true);
  svc['memberModel'] = { updateOne: jest.fn() };
  svc['hookModel'] = { updateOne: jest.fn() };
  return await (svc as unknown as CustomToolService).getCombinedData('U1', {
    _id: 'h1',
    alias: 'oa',
  } as never);
}

const run = async (
  profileData: Record<string, unknown>,
  custom: boolean,
): Promise<{ open: boolean; log: string; block: unknown }> => {
  const lines: string[] = [];
  const out = await fetchCombinedProfile(
    {
      hook: {
        alias: 'oa',
        custom_tool_status: custom,
        custom_tool_id: custom ? 't1' : undefined,
      },
      userId: 'U1',
    },
    {
      logger: {
        log: (m: string) => lines.push(m),
        error: (m: string) => lines.push(m),
      },
      usesCustomTool: () => custom,
      loadCombinedProfile: () => Promise.resolve(profileData),
      memberModel: { updateOne: () => ({ exec: () => Promise.resolve() }) },
      customTool: {
        getToolForHook: () => Promise.resolve(TOOL),
        extractProfile: () => ({ name: 'N/A', phone: 'N/A', code: 'N/A' }),
      },
    },
  );
  return {
    open: out.profileCircuitOpen,
    log: lines.find((l) => l.startsWith('[PROFILE-CHECK]')) ?? '',
    block: out.profileBlock,
  };
};

describe('[CUSTOMCIRCUIT] TARGET — a custom tool with its breaker open', () => {
  it('the real circuit-open answer is reported as circuit_open, and the log says so', async () => {
    const combined = await combinedWithOpenBreaker();
    const r = await run(combined, true);
    expect(r.open).toBe(true);
    expect(r.log).toContain('(circuit_open)');
    expect(r.log).toContain('why=circuit_open');
  });

  it('🔴 PIN: the slip gates give the SAME verdict as before the fix (review, not block)', async () => {
    const combined = await combinedWithOpenBreaker();
    const r = await run(combined, true);
    const hook = { slip_require_profile: true };
    for (const circuitOpen of [false, r.open]) {
      const probe = {
        profileBlock: r.block as Record<string, unknown>,
        circuitOpen,
      };
      expect(shouldBlockUnlinkedSlip(hook, probe)).toBe(false);
      expect(shouldReviewUnknownProfile(hook, probe)).toBe(true);
    }
  });
});

describe('[CUSTOMCIRCUIT] 🔴 PIN — every other answer reads as before', () => {
  it('legacy line: its own circuit message still reads as open', async () => {
    const r = await run(
      {
        'Path : api/v1/customer': {
          message: 'circuit_open: upstream temporarily unavailable',
        },
      },
      false,
    );
    expect(r.open).toBe(true);
  });

  it('legacy line: a block shaped like the custom tool’s does NOT (legacy rule unchanged)', async () => {
    const r = await run(
      {
        'Path : api/v1/customer': {
          success: false,
          status: 503,
          data: { message: 'circuit_open: endpoint "X" temporarily suspended' },
        },
      },
      false,
    );
    expect(r.open).toBe(false);
  });

  it.each([
    [
      'a 404 (customer not linked)',
      { success: false, status: 404, data: { message: 'not found' } },
    ],
    [
      'a 503 from the partner itself',
      { success: false, status: 503, data: { message: 'Service Unavailable' } },
    ],
    ['a success', { success: true, status: 200, data: { data: {} } }],
  ])('custom tool: %s is not circuit_open', async (_l, block) => {
    const r = await run({ CUSTOMER_PROFILE: block }, true);
    expect(r.open).toBe(false);
  });
});
