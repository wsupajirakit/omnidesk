/**
 * [FEAT-20260827-BPPREFETCHPOST] prefetch ตัดสินจาก `purpose` ไม่ใช่ HTTP method
 * ============================================================================
 * `getCombinedData` เคยกรอง `method === 'GET'` ⇒ พาร์ตเนอร์ที่ให้อ่านข้อมูลผ่าน POST
 * หายไปทั้งชุดแบบเงียบ ๆ: ไม่มี error, `combined` แค่ขาดคีย์, dynamic tag ที่ชี้
 * endpoint นั้นกลายเป็น `N/A` แล้ว AI ตอบว่าไม่มีข้อมูลทั้งที่พาร์ตเนอร์ตอบ 200
 *
 * ⭐ สิ่งที่ไฟล์นี้ตรึง เรียงตามความสำคัญ:
 *   1. **`write` / `auth` ห้ามถูก prefetch เด็ดขาด** — ยิงเองโดยไม่มีใครสั่งคือการ
 *      ผูกบัญชี/ส่งสลิป/แก้ข้อมูลลูกค้าโดยไม่ตั้งใจ · ข้อนี้มาก่อนเพราะมันคือ
 *      อันตรายจริงข้อเดียวของการถอดเงื่อนไข method ออก
 *   2. POST ที่เป็น `data` ต้องถูก prefetch (นี่คือของที่พังอยู่)
 *   3. GET เดิมต้องไม่เปลี่ยนพฤติกรรมแม้แต่นิดเดียว
 *   4. endpoint ที่ไม่ได้ตั้ง purpose ยังทำงานเหมือนเดิม (normalize เติม 'data')
 *
 * ⚠️ ทำไมเทสอ่าน "ตัวกรอง" ผ่านพฤติกรรมของ `getCombinedData` แทนที่จะ export
 *    ตัวกรองออกมา: ตัวกรองไม่ใช่ของสาธารณะ และสิ่งที่ต้องรับประกันคือ "endpoint
 *    ไหนถูกยิงจริง" ไม่ใช่ "ฟังก์ชันคืน array อะไร" — เทสจึงนับการยิงของจริง
 */
import {
  DEFAULT_CUSTOMER_PROVIDER,
  bindActiveProvider,
  buildCustomerProviderRegistry,
  resetActiveProvider,
} from '@/modules/customer-provider';
import { CustomToolService } from '@/modules/external/custom-tool.service';

type Ep = Record<string, unknown>;

const ep = (o: Ep): Ep => ({
  status: true,
  require_jwt: false,
  request_type: 'json',
  payload: {},
  profile_map: { name: '', phone: '', code: '', tier: '' },
  result_rules: [],
  ...o,
});

/** service ที่ยิงจริงไม่ได้ — บันทึกไว้ว่า "ถ้าไม่โดนกรอง จะยิง endpoint ไหน" */
function makeSvc(endpoints: Ep[]) {
  const fired: string[] = [];
  /* ⚠️ เขียนผ่าน `Record<string, unknown>` เท่านั้น — ฟิลด์ของ service เป็น
     `readonly` (private readonly) ⇒ assign ผ่าน type ของ service ตรง ๆ จะไม่ผ่าน tsc
     (เจอจริงตอน merge dev 28/08) · harness ตัวนี้เลี่ยง constructor เพราะ deps
     6 ตัวไม่เกี่ยวกับสิ่งที่วัด แต่ต้องเติมทุกตัวที่ "เส้นทางที่วัด" แตะจริง */
  const svc = Object.create(CustomToolService.prototype) as Record<
    string,
    unknown
  >;
  svc['logger'] = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  /* ประตู webhook_logs — getCombinedData เขียนหนึ่งแถวต่อ endpoint ที่ยิงจริง
     (`[FEAT-20260827-WLOGONEDOOR]`) จึงต้องมี ไม่งั้นพังคนละเรื่องกับที่วัด */
  svc['wlog'] = { persist: jest.fn().mockResolvedValue({ _id: 'w1' }) };
  svc['getToolForHook'] = jest
    .fn()
    .mockResolvedValue({ _id: 't1', name: 'x', endpoints });
  svc['getToken'] = jest.fn().mockResolvedValue('tok');
  const rec = (_t: unknown, e: unknown) => {
    fired.push(String((e as Ep)['key']));
    return Promise.resolve({ success: true, status: 200, data: {}, url: '' });
  };
  svc['_request'] = jest.fn(rec);
  svc['_fetchWithCache'] = jest.fn(rec);
  return { svc: svc as unknown as CustomToolService, fired };
}

const HOOK = { _id: 'h1', alias: 'oa' } as never;

describe('[BPPREFETCHPOST] 🔴 write/auth ต้องไม่ถูกยิงเองเด็ดขาด', () => {
  it.each([
    ['POST + write', 'POST', 'write'],
    ['PATCH + write', 'PATCH', 'write'],
    ['GET + write', 'GET', 'write'],
    ['POST + auth', 'POST', 'auth'],
    ['GET + auth', 'GET', 'auth'],
  ])('%s ⇒ ไม่ถูก prefetch', async (_l, method, purpose) => {
    const { svc, fired } = makeSvc([
      ep({ key: 'DANGER', method, purpose }),
      ep({ key: 'SAFE', method: 'GET', purpose: 'data' }),
    ]);
    await svc.getCombinedData('U1', HOOK);
    expect(fired).toEqual(['SAFE']);
  });

  it('🔴 endpoint ที่ตั้ง is_login/is_refresh ก็ยังถูกกันเหมือนเดิม', async () => {
    const { svc, fired } = makeSvc([
      ep({ key: 'LOGIN', method: 'POST', purpose: 'data', is_login: true }),
      ep({ key: 'REFRESH', method: 'POST', purpose: 'data', is_refresh: true }),
      ep({ key: 'SAFE', method: 'GET', purpose: 'data' }),
    ]);
    await svc.getCombinedData('U1', HOOK);
    expect(fired).toEqual(['SAFE']);
  });
});

describe('[BPPREFETCHPOST] ⭐ POST ที่เป็น data ต้องถูก prefetch', () => {
  it('⭐ php แบบ acme (POST + data) ถูกยิงครบทุกเส้น', async () => {
    const { svc, fired } = makeSvc([
      ep({ key: 'CUSTOMER_PROFILE', method: 'GET', purpose: 'data' }),
      ep({ key: 'INSTALLMENT_CURRENT', method: 'POST', purpose: 'data' }),
      ep({ key: 'PAYMENT_HISTORY', method: 'POST', purpose: 'data' }),
      ep({ key: 'CONTRACT_INFO', method: 'POST', purpose: 'data' }),
      ep({ key: 'ALL_INSTALLMENTS', method: 'POST', purpose: 'data' }),
    ]);
    const out = await svc.getCombinedData('U1', HOOK);
    expect(fired.sort()).toEqual(
      [
        'ALL_INSTALLMENTS',
        'CONTRACT_INFO',
        'CUSTOMER_PROFILE',
        'INSTALLMENT_CURRENT',
        'PAYMENT_HISTORY',
      ].sort(),
    );
    // และคีย์ต้องโผล่ใน combined ให้ dynamic tag หาเจอ
    expect(Object.keys(out).sort()).toEqual(fired.sort());
  });
});

describe('[BPPREFETCHPOST] ของเดิมต้องไม่ขยับ', () => {
  it('GET + data ยังถูก prefetch เหมือนเดิม', async () => {
    const { svc, fired } = makeSvc([
      ep({ key: 'A', method: 'GET', purpose: 'data' }),
    ]);
    await svc.getCombinedData('U1', HOOK);
    expect(fired).toEqual(['A']);
  });

  it('endpoint ที่ไม่ตั้ง purpose (แถวเก่า) ยังถูก prefetch เหมือนเดิม', async () => {
    const { svc, fired } = makeSvc([
      ep({ key: 'LEGACY_GET', method: 'GET' }),
      ep({ key: 'LEGACY_NO_METHOD' }),
    ]);
    await svc.getCombinedData('U1', HOOK);
    expect(fired.sort()).toEqual(['LEGACY_GET', 'LEGACY_NO_METHOD']);
  });

  it('status:false ยังถูกกันเหมือนเดิม', async () => {
    const { svc, fired } = makeSvc([
      ep({ key: 'OFF', method: 'GET', purpose: 'data', status: false }),
      ep({ key: 'ON', method: 'GET', purpose: 'data' }),
    ]);
    await svc.getCombinedData('U1', HOOK);
    expect(fired).toEqual(['ON']);
  });
});

/* ── [FIX-20261014-EMPTYUIDFETCH] a fetch with NO member fires only the site-rules endpoint ──
   Both callers that pass an empty user id (site-rules Refresh button, broadcast refresh) say
   so themselves: "site rules are per hook, the identity only shapes per-member endpoints,
   which this call is not here for". The engine fired every data endpoint anyway — measured on
   the local DB clones 14/10: 90 empty-uid partner calls on the loan DB, 152 on the dev DB, 82
   on the shop-api DB, every one a failure (the loan profile answered a 404 HTML page). GET
   endpoints carry the identity in the query even with no placeholder in the path, so "has a
   placeholder" cannot tell them apart; the site-rules identity can, and it already exists
   (`isSiteRulesEndpoint`, the same test the cache and the `raw_site_rules_data` writer use). */
describe('[EMPTYUIDFETCH] no member ⇒ only the site-rules endpoint is fired', () => {
  const withHookModel = (endpoints: Ep[]) => {
    const made = makeSvc(endpoints);
    const updateOne = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    const raw = made.svc as unknown as Record<string, unknown>;
    raw['hookModel'] = { updateOne };
    raw['memberModel'] = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };
    return { ...made, updateOne, raw };
  };

  it('TARGET: shop-api shape — the profile is NOT fired with an empty id, site rules still are', async () => {
    const { svc, fired } = withHookModel([
      ep({
        key: 'CUSTOMER_PROFILE',
        method: 'GET',
        purpose: 'data',
        is_profile: true,
        role: 'profile',
      }),
      ep({ key: 'SITE_RULES', method: 'GET', purpose: 'data' }),
    ]);
    await svc.getCombinedData('', HOOK);
    expect(fired).toEqual(['SITE_RULES']);
  });

  it('TARGET: loan shape (no site-rules endpoint) — nothing fires and nobody logs in', async () => {
    const { svc, fired, raw } = withHookModel(
      [
        'CUSTOMER_PROFILE',
        'INSTALLMENT_CURRENT',
        'PAYMENT_HISTORY',
        'CONTRACT_INFO',
        'ALL_INSTALLMENTS',
      ].map((key) =>
        ep({
          key,
          method: key === 'CUSTOMER_PROFILE' ? 'GET' : 'POST',
          purpose: 'data',
        }),
      ),
    );
    expect(await svc.getCombinedData('', HOOK)).toEqual({});
    expect(fired).toEqual([]);
    expect(raw['getToken']).not.toHaveBeenCalled();
  });

  it('🔴 PIN: a role-tagged site-rules endpoint with an odd key still fires', async () => {
    const { svc, fired } = withHookModel([
      ep({
        key: 'RULES_V2',
        method: 'GET',
        purpose: 'data',
        role: 'site_rules',
      }),
    ]);
    await svc.getCombinedData('', HOOK);
    expect(fired).toEqual(['RULES_V2']);
  });

  it('🔴 PIN: raw_site_rules_data is still written from the site-rules answer', async () => {
    const { svc, updateOne, raw } = withHookModel([
      ep({ key: 'CUSTOMER_PROFILE', method: 'GET', purpose: 'data' }),
      ep({ key: 'SITE_RULES', method: 'GET', purpose: 'data' }),
    ]);
    const rules = { bank_account: { accounts: [{ deposit: true }] } };
    (raw['_fetchWithCache'] as jest.Mock).mockResolvedValue({
      success: true,
      status: 200,
      data: rules,
      url: '',
    });
    await svc.getCombinedData('', HOOK);
    const set = (
      updateOne.mock.calls[0]?.[1] as { $set: Record<string, unknown> }
    ).$set;
    expect(set['raw_site_rules_data']).toEqual(rules);
  });

  it('🔴 PIN: with a real member every data endpoint still fires', async () => {
    const { svc, fired } = withHookModel([
      ep({ key: 'CUSTOMER_PROFILE', method: 'GET', purpose: 'data' }),
      ep({ key: 'SITE_RULES', method: 'GET', purpose: 'data' }),
    ]);
    await svc.getCombinedData('U1', HOOK);
    expect(fired.sort()).toEqual(['CUSTOMER_PROFILE', 'SITE_RULES']);
  });
});

describe('[EMPTYUIDFETCH] a token is never stored against an empty member id', () => {
  const svcWithMembers = () => {
    const svc = Object.create(CustomToolService.prototype) as Record<
      string,
      unknown
    >;
    const updateOne = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    svc['memberModel'] = { updateOne };
    return { svc: svc as unknown as CustomToolService, updateOne };
  };

  it('TARGET: empty id ⇒ no upsert (it would create a member whose line_user_id is "")', async () => {
    const { svc, updateOne } = svcWithMembers();
    await svc._writeToken({ _id: 't1' } as never, '', { access_token: 'x' });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('🔴 PIN: a real member still gets its token stored', async () => {
    const { svc, updateOne } = svcWithMembers();
    await svc._writeToken({ _id: 't1' } as never, 'U1', { access_token: 'x' });
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0]?.[0]).toEqual({ line_user_id: 'U1' });
  });
});

/* ── [FIX-20261015-EMPTYUIDTOKEN] the hook-level token is kept — in the process, not on a member ──
   Review 15/10 of EMPTYUIDFETCH: with the empty-id write skipped, the next empty-id call found
   no token and logged in again — every Refresh / broadcast / preview on a jwt_login tool (the
   dev data holds such tools: "Demo Shop-API (v3)", "ddd"). Before the branch the token sat on a
   member row whose line_user_id is "" (the defect EMPTYUIDFETCH removed) and was reused until it
   expired. Now it sits in the service, keyed by tool, with the same expiry check. */
describe('[EMPTYUIDTOKEN] a hook-level token is reused, never written to a member', () => {
  const svcWithMembers = () => {
    const svc = Object.create(CustomToolService.prototype) as Record<
      string,
      unknown
    >;
    const updateOne = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    const findOne = jest.fn().mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue(null) }),
    });
    svc['memberModel'] = { updateOne, findOne };
    return { svc: svc as unknown as CustomToolService, updateOne, findOne };
  };
  const TOOL = { _id: 't-jwt', auth_type: 'jwt_login' } as never;

  it('⭐ TARGET: write with an empty id, read with an empty id ⇒ the same token, no member touched', async () => {
    const { svc, updateOne, findOne } = svcWithMembers();
    await svc._writeToken(TOOL, '', { access_token: 'A' });
    const doc = await svc._readTokenDoc(TOOL, '');
    expect(doc?.access_token).toBe('A');
    expect(updateOne).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled(); // an old "" member row is never read either
  });

  it('⭐ TARGET: two hook-level getToken calls ⇒ ONE login', async () => {
    const { svc } = svcWithMembers();
    const raw = svc as unknown as Record<string, unknown>;
    const login = jest.fn(async (tool: never, uid: string) => {
      await svc._writeToken(tool, uid, {
        access_token: 'A',
        expires_at: new Date(Date.now() + 3_600_000),
      });
      return 'A';
    });
    raw['login'] = login;
    raw['logger'] = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    expect(await svc.getToken(TOOL, '')).toBe('A');
    expect(await svc.getToken(TOOL, '')).toBe('A');
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('🔴 PIN: a real member still reads from and writes to its own row', async () => {
    const { svc, updateOne, findOne } = svcWithMembers();
    await svc._writeToken(TOOL, 'U1', { access_token: 'x' });
    await svc._readTokenDoc(TOOL, 'U1');
    expect(updateOne.mock.calls[0]?.[0]).toEqual({ line_user_id: 'U1' });
    expect(findOne.mock.calls[0]?.[0]).toEqual({ line_user_id: 'U1' });
  });
});

/* ── [FIX-20261015-PROFILEWARN] no false "has no endpoint flagged is_profile" on an empty-id call ──
   Review 15/10: EMPTYUIDFETCH drops the profile endpoint from an empty-id fetch, and the warning
   looked for it in that SHORTENED list — so every shop-api Refresh / broadcast logged that "Shop-API v1"
   has no profile endpoint, a false lead for whoever reads the log. The warning now asks the
   tool's own list, exactly the list it asked before the branch. */
describe('[PROFILEWARN] the missing-profile warning tells the truth', () => {
  const warns = (svc: unknown) =>
    (
      (svc as Record<string, { warn: jest.Mock }>)['logger']!.warn.mock
        .calls as string[][]
    )
      .map((c) => String(c[0]))
      .filter((m) => m.includes('has no endpoint flagged is_profile'));
  const withHookModel = (endpoints: Ep[]) => {
    const made = makeSvc(endpoints);
    const raw = made.svc as unknown as Record<string, unknown>;
    raw['hookModel'] = {
      updateOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    raw['memberModel'] = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };
    return made;
  };
  const SHOPAPI = () => [
    ep({
      key: 'CUSTOMER_PROFILE',
      method: 'GET',
      purpose: 'data',
      is_profile: true,
      role: 'profile',
    }),
    ep({ key: 'SITE_RULES', method: 'GET', purpose: 'data' }),
  ];

  it('⭐ TARGET: shop-api shape, empty id (Refresh / broadcast) ⇒ no warning', async () => {
    const { svc } = withHookModel(SHOPAPI());
    await svc.getCombinedData('', HOOK);
    expect(warns(svc)).toEqual([]);
  });
  it('🔴 PIN: a tool that really has no profile endpoint still warns', async () => {
    const { svc } = withHookModel([
      ep({ key: 'SITE_RULES', method: 'GET', purpose: 'data' }),
    ]);
    await svc.getCombinedData('U1', HOOK);
    expect(warns(svc)).toHaveLength(1);
  });
});

/* ── [FEAT-20261014-PROFILEFIRST] D2 — an unlinked customer costs ONE partner call, not five ──
   The engine fired every data endpoint at once. For the loan partner a customer who is not
   linked answers 404 on the profile and `status:false` on all four php endpoints — four calls
   that can only fail. A provider may now declare `prefetchProfileFirst` (loan_v1 does): the
   profile endpoint goes first; if it does not succeed, only the hook-level site-rules endpoint
   is still fetched. Undeclared (shop-api) = everything in parallel, exactly as before. */
describe('[PROFILEFIRST] D2 — profile first, the rest only when it succeeds (opt-in)', () => {
  const svcAnswering = (endpoints: Ep[], profileOk: boolean) => {
    const made = makeSvc(endpoints);
    const raw = made.svc as unknown as Record<string, unknown>;
    const order: string[] = [];
    const answer = (_t: unknown, e: unknown) => {
      const key = String((e as Ep)['key']);
      order.push(key);
      const ok = (e as Ep)['is_profile'] === true ? profileOk : true;
      return Promise.resolve({
        success: ok,
        status: ok ? 200 : 404,
        data: {},
        url: '',
      });
    };
    raw['_request'] = jest.fn(answer);
    raw['_fetchWithCache'] = jest.fn(answer);
    raw['hookModel'] = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };
    raw['memberModel'] = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };
    return { svc: made.svc, order };
  };
  const LOAN_LIKE = [
    ep({
      key: 'CUSTOMER_PROFILE',
      method: 'GET',
      purpose: 'data',
      is_profile: true,
    }),
    ep({ key: 'INSTALLMENT_CURRENT', method: 'POST', purpose: 'data' }),
    ep({ key: 'PAYMENT_HISTORY', method: 'POST', purpose: 'data' }),
  ];
  afterEach(() => resetActiveProvider());

  it('TARGET: loan_v1 — profile not found ⇒ ONLY the profile is fired', async () => {
    bindActiveProvider(buildCustomerProviderRegistry().get('loan_v1')!);
    const { svc, order } = svcAnswering(LOAN_LIKE, false);
    const out = await svc.getCombinedData('U1', HOOK);
    expect(order).toEqual(['CUSTOMER_PROFILE']);
    expect(Object.keys(out)).toEqual(['CUSTOMER_PROFILE']);
  });

  it('TARGET: loan_v1 — profile found ⇒ profile FIRST, then every other endpoint', async () => {
    bindActiveProvider(buildCustomerProviderRegistry().get('loan_v1')!);
    const { svc, order } = svcAnswering(LOAN_LIKE, true);
    const out = await svc.getCombinedData('U1', HOOK);
    expect(order[0]).toBe('CUSTOMER_PROFILE');
    expect([...order].sort()).toEqual([
      'CUSTOMER_PROFILE',
      'INSTALLMENT_CURRENT',
      'PAYMENT_HISTORY',
    ]);
    /* combined keeps the tool's own endpoint order */
    expect(Object.keys(out)).toEqual([
      'CUSTOMER_PROFILE',
      'INSTALLMENT_CURRENT',
      'PAYMENT_HISTORY',
    ]);
  });

  /* FLIPPED 18/10/2026 ([FEAT-20261018-SITERULESWORLD], owner: "สินเชื่อไม่มี site rules"):
     this case used loan_v1 to prove that profile-first keeps a hook-level site-rules endpoint
     when the profile is not found. loan_v1 now declares `siteRules: false`, so it never fetches
     one at all (pinned in the [SITERULESWORLD] suite below). The MECHANISM it pinned is still
     worth pinning for a future profile-first provider that HAS site rules — so the same
     assertion now runs on loan_v1 with that one world switched back on. */
  it('profile-first + site-rules world ON — profile not found still fetches the hook-level site-rules endpoint', async () => {
    const loanV1 = buildCustomerProviderRegistry().get('loan_v1')!;
    bindActiveProvider({
      ...loanV1,
      features: { ...loanV1.features, siteRules: true },
    });
    const { svc, order } = svcAnswering(
      [...LOAN_LIKE, ep({ key: 'SITE_RULES', method: 'GET', purpose: 'data' })],
      false,
    );
    await svc.getCombinedData('U1', HOOK);
    expect([...order].sort()).toEqual(['CUSTOMER_PROFILE', 'SITE_RULES']);
  });
  it('loan_v1 as declared (no site-rules world) — profile not found fires the profile alone', async () => {
    bindActiveProvider(buildCustomerProviderRegistry().get('loan_v1')!);
    const { svc, order } = svcAnswering(
      [...LOAN_LIKE, ep({ key: 'SITE_RULES', method: 'GET', purpose: 'data' })],
      false,
    );
    await svc.getCombinedData('U1', HOOK);
    expect(order).toEqual(['CUSTOMER_PROFILE']);
  });

  it.each([
    ['unbound', () => resetActiveProvider()],
    ['shopapi_v1 bound', () => bindActiveProvider(DEFAULT_CUSTOMER_PROVIDER)],
  ])(
    '🔴 PIN (%s): profile not found ⇒ every endpoint still fired, as before',
    async (_l, bind) => {
      bind();
      const { svc, order } = svcAnswering(LOAN_LIKE, false);
      await svc.getCombinedData('U1', HOOK);
      expect([...order].sort()).toEqual([
        'CUSTOMER_PROFILE',
        'INSTALLMENT_CURRENT',
        'PAYMENT_HISTORY',
      ]);
    },
  );
});

/* ── [FEAT-20261018-SITERULESWORLD] a provider without the site-rules world never fetches one ──
   The loan tool has no site-rules endpoint today, so this pins the FUTURE case the owner asked
   for: a provider that declares `siteRules: false` but whose tool happens to carry such an
   endpoint must not call it (no data nobody may use, no partner call, no login for nothing). */
describe('[SITERULESWORLD] prefetch skips a site-rules endpoint when the world is off', () => {
  const tool = () => [
    ep({
      key: 'CUSTOMER_PROFILE',
      method: 'GET',
      purpose: 'data',
      is_profile: true,
    }),
    ep({
      key: 'SITE_RULES',
      method: 'GET',
      purpose: 'data',
      role: 'site_rules',
    }),
  ];
  const withHook = () => {
    const made = makeSvc(tool());
    const raw = made.svc as unknown as Record<string, unknown>;
    raw['hookModel'] = {
      updateOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    raw['memberModel'] = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };
    return { ...made, raw };
  };
  const loan = () =>
    bindActiveProvider(buildCustomerProviderRegistry().get('loan_v1')!);
  afterEach(() => resetActiveProvider());

  it('⭐ TARGET — loan bound, no member: nothing fires and nobody logs in', async () => {
    loan();
    const { svc, fired, raw } = withHook();
    expect(await svc.getCombinedData('', HOOK)).toEqual({});
    expect(fired).toEqual([]);
    expect(raw['getToken']).not.toHaveBeenCalled();
  });
  it('⭐ TARGET — loan bound, a member: the customer endpoint fires, site rules do not', async () => {
    loan();
    const { svc, fired } = withHook();
    await svc.getCombinedData('Uabc', HOOK);
    expect(fired).toContain('CUSTOMER_PROFILE');
    expect(fired).not.toContain('SITE_RULES');
  });
  it('🔴 PIN — shop-api bound: site rules still fire, with or without a member', async () => {
    bindActiveProvider(DEFAULT_CUSTOMER_PROVIDER);
    const a = withHook();
    await a.svc.getCombinedData('', HOOK);
    expect(a.fired).toEqual(['SITE_RULES']);
    const b = withHook();
    await b.svc.getCombinedData('Uabc', HOOK);
    expect([...b.fired].sort()).toEqual(['CUSTOMER_PROFILE', 'SITE_RULES']);
  });
});
