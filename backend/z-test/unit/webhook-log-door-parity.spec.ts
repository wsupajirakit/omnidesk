/**
 * ==== [FEAT-20260827-WLOGONEDOOR] byte-parity ของแถว webhook_logs ที่เคยเขียนตรง ====
 *
 * WHAT THIS PROVES: the eight write sites that used to call
 * `webhookLogModel.create({...})` directly still produce the **exact same row**
 * now that they go through `WebhookLogWriter.persist`. Nothing added, nothing
 * stripped, nothing resolved — the door forwards verbatim.
 *
 * WHY THIS FILE IS WRITTEN THE WAY IT IS — read before "tidying" it:
 *
 * 1. ⭐ THE FAKE ANSWERS TO BOTH APIs (`create` AND `persist`) and is assigned to
 *    BOTH field names (`webhookLogModel` AND `wlog`). That is deliberate: the
 *    SAME file, with the SAME expectations, runs green on the code BEFORE the
 *    move and AFTER it. A parity claim proved by a test that was edited in
 *    between proves nothing. เทสไฟล์เดียว รันได้ทั้งก่อนและหลังย้าย
 *    (the dead half is removed in a separate follow-up commit, once parity has
 *    been demonstrated on both sides.)
 *
 * 2. `toStrictEqual`, never `toEqual`. `toEqual` treats `{a: 1, b: undefined}`
 *    and `{a: 1}` as equal, so it would NOT catch a door that strips `undefined`
 *    keys the way `WebhookLogEmitter.write` does. Those keys decide whether
 *    Mongoose materialises a schema default, so they are part of the row.
 *
 * 3. Instances are built with `Object.create(X.prototype)` and only the fields
 *    the logged path actually touches are assigned. These services take 6-8
 *    constructor dependencies that have nothing to do with logging; a positional
 *    construction here would break every time someone adds one, and would test
 *    the constructor rather than the row. Wiring is covered separately by the
 *    Nest module tests and by `tsc`.
 *
 * The eight sites: external-api ×6 (`acme_api_*`), custom-tool ×1
 * (`customer_link_fetch_*`) and customer-link `logUpstreamCall` ×1. The other
 * three sites already have row-level assertions elsewhere and are NOT duplicated
 * here — customer-link `reg_push` in `customer-link-success-push.spec.ts`,
 * and the two `send_broadcast` writers in `broadcast-send.spec.ts` /
 * `broadcast-new-send-service.spec.ts`.
 */
import { CustomerLinkService } from '@/modules/customer-link';
import { CustomToolService, ExternalApiService } from '@/modules/external';

/** Captures every row that reaches the persistence layer, under either API. */
function makeDoor() {
  const rows: Record<string, unknown>[] = [];
  const take = jest.fn((row: Record<string, unknown>) => {
    rows.push(row);
    return Promise.resolve({ _id: 'wlog-1' });
  });
  return { rows, door: { create: take, persist: take }, take };
}

/** Build an instance without running the constructor, then wire only what the
 *  logged path reads. Both door field names are set — see note 1 in the header. */
function bare<T>(proto: object, fields: Record<string, unknown>): T {
  const inst = Object.create(proto) as Record<string, unknown>;
  inst['logger'] = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  Object.assign(inst, fields);
  return inst as T;
}

const USER = 'Uparity0001';

describe('[FEAT-20260827-WLOGONEDOOR] external-api — the six acme rows', () => {
  /** One result object shared by the five read endpoints: a failed upstream
   *  call, which is the branch that exercises the `|| { message }` fallback. */
  const failed = {
    success: false,
    data: null,
    error: 'upstream down',
    status: 502,
    duration: 41,
    method: 'GET',
    url: 'https://upstream.invalid/api/line/v1/x.php',
  };

  function svcWith(execResult: Record<string, unknown>) {
    const { rows, door } = makeDoor();
    const svc = bare<ExternalApiService>(ExternalApiService.prototype, {
      webhookLogModel: door,
      wlog: door,
      _executeRequest: jest.fn().mockResolvedValue(execResult),
    });
    return { svc, rows };
  }

  it('(E1) login — success upstream, no access_token in the body', async () => {
    const { rows, door } = makeDoor();
    const svc = bare<ExternalApiService>(ExternalApiService.prototype, {
      webhookLogModel: door,
      wlog: door,
      _isLoginInCooldown: jest.fn().mockResolvedValue(false),
      _getApiConfig: jest.fn().mockResolvedValue({
        config: {},
        endpoints: { LOGIN: { is_login: true } },
        source: 'hook',
      }),
      _markLoginFail: jest.fn().mockResolvedValue(undefined),
      _executeRequest: jest.fn().mockResolvedValue({
        success: true,
        data: {},
        status: 200,
        duration: 12,
        method: 'POST',
        url: 'https://upstream.invalid/api/v1/auth/login',
      }),
    });

    const out = await svc.login(USER, { alias: 'oa1' });

    expect(out).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toStrictEqual({
      channel: 'acme_api_login',
      log_source: 'acme_api_login',
      action_type: 'login',
      method: 'POST',
      endpoint: 'https://upstream.invalid/api/v1/auth/login',
      status: 'success',
      http_status: 200,
      raw_request: { userId: USER },
      raw_response: {},
      duration_ms: 12,
      reference_id: USER,
    });
  });

  it('(E2) getCustomerProfile — raw_request/raw_response pair, log_source mirrored in code', async () => {
    const { svc, rows } = svcWith(failed);

    await svc.getCustomerProfile(USER, 'tok', { alias: 'oa1' });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toStrictEqual({
      channel: 'acme_api_get_profile',
      log_source: 'acme_api_get_profile',
      action_type: 'get_profile',
      method: 'GET',
      endpoint: failed.url,
      status: 'error',
      http_status: 502,
      raw_request: { userId: USER },
      raw_response: { message: 'upstream down' },
      duration_ms: 41,
      reference_id: USER,
    });
  });

  /** The four remaining endpoints share one shape: the *_summary pair, and NO
   *  `log_source` of their own (the schema's pre-save mirror fills it). */
  const summaryEndpoints: Array<{
    label: string;
    call: (s: ExternalApiService) => Promise<unknown>;
    channel: string;
    action: string;
    payloadSummary: Record<string, unknown>;
  }> = [
    {
      label: 'E3 getInstallment',
      call: (s) => s.getInstallment(USER, 'tok', { alias: 'oa1' }),
      channel: 'acme_api_get_installment',
      action: 'get_installment',
      payloadSummary: { userId: USER },
    },
    {
      label: 'E4 getPaymentHistory',
      call: (s) => s.getPaymentHistory(USER, 'tok', { alias: 'oa1' }),
      channel: 'acme_api_get_payment_history',
      action: 'get_payment_history',
      payloadSummary: { userId: USER },
    },
    {
      label: 'E5 getContract',
      call: (s) => s.getContract(USER, 'tok', { alias: 'oa1' }),
      channel: 'acme_api_get_contract_info',
      action: 'get_contract_info',
      payloadSummary: { userId: USER },
    },
    {
      label: 'E6 getInstallmentList — payload_summary also carries the url',
      call: (s) => s.getInstallmentList(USER, 'tok', { alias: 'oa1' }),
      channel: 'acme_api_get_installment_list',
      action: 'get_installment_list',
      payloadSummary: { userId: USER, url: failed.url },
    },
  ];

  it.each(summaryEndpoints)('($label)', async (c) => {
    const { svc, rows } = svcWith(failed);

    await c.call(svc);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toStrictEqual({
      channel: c.channel,
      action_type: c.action,
      method: 'GET',
      endpoint: failed.url,
      status: 'error',
      http_status: 502,
      payload_summary: c.payloadSummary,
      response_summary: { message: 'upstream down' },
      duration_ms: 41,
      reference_id: USER,
    });
  });
});

describe('[FEAT-20260827-WLOGONEDOOR] custom-tool — the prefetch row per endpoint', () => {
  it('(C1) one row per data endpoint, named after the endpoint key', async () => {
    const { rows, door } = makeDoor();
    const hook = {
      _id: 'hook-oid',
      alias: 'oa1',
      group: 'group-oid',
      customer_link_web_code: 'WC1',
    };
    const tool = {
      name: 'walletpay',
      endpoints: [{ key: 'PROFILE', method: 'GET', path: '/p', status: true }],
    };
    const r = {
      success: false,
      status: 404,
      data: { message: 'nope' },
      error: 'nope',
      duration: 9,
      url: 'https://tool.invalid/p',
    };
    const svc = bare<CustomToolService>(CustomToolService.prototype, {
      webhookLogModel: door,
      wlog: door,
      getToolForHook: jest.fn().mockResolvedValue(tool),
      getToken: jest.fn().mockResolvedValue('tok'),
      _request: jest.fn().mockResolvedValue(r),
      _fetchWithCache: jest.fn().mockResolvedValue(r),
    });

    await svc.getCombinedData(USER, hook as never, {});
    // the write is fire-and-forget inside a loop — let the microtask run
    await Promise.resolve();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toStrictEqual({
      hook_id: 'hook-oid',
      hook_alias: 'oa1',
      group_id: 'group-oid',
      channel: 'customer_link',
      action_type: 'customer_link_fetch_profile',
      method: 'GET',
      endpoint: 'https://tool.invalid/p',
      status: 'error',
      http_status: 404,
      error_message: 'nope',
      duration_ms: 9,
      raw_request: {
        line_user_id: USER,
        web_code: 'WC1',
        endpoint_key: 'PROFILE',
      },
      raw_response: { message: 'nope' },
      request_meta: {
        tool_name: 'walletpay',
        endpoint_key: 'PROFILE',
        source: 'webhook_prefetch',
      },
      reference_id: USER,
    });
  });
});

describe('[FEAT-20260827-WLOGONEDOOR] customer-link — logUpstreamCall', () => {
  const call = (svc: CustomerLinkService, input: unknown) =>
    (
      svc as unknown as {
        logUpstreamCall: (i: unknown) => Promise<string | null>;
      }
    ).logUpstreamCall(input);

  it('(L1) the awaited write returns the new row id and sends the full row', async () => {
    const { rows, door } = makeDoor();
    const svc = bare<CustomerLinkService>(CustomerLinkService.prototype, {
      webhookLogModel: door,
      wlog: door,
    });

    const id = await call(svc, {
      hook: { _id: 'hook-oid', alias: 'oa1', group: 'group-oid' },
      op: 'link',
      payload: { line_user_id: USER, web_code: 'WC1' },
      toolName: 'walletpay',
      result: {
        url: 'https://upstream.invalid/link',
        status: 200,
        duration: 33,
        data: { ok: true },
        idempotent_retry: 1,
        idempotency_enabled: true,
      },
      out: { ok: true },
      adminUserId: null,
      awaitWrite: true,
    });

    expect(id).toBe('wlog-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toStrictEqual({
      hook_id: 'hook-oid',
      hook_alias: 'oa1',
      group_id: 'group-oid',
      channel: 'customer_link',
      action_type: 'customer_link_link',
      method: 'POST',
      endpoint: 'https://upstream.invalid/link',
      status: 'success',
      http_status: 200,
      error_code: undefined,
      error_message: undefined,
      duration_ms: 33,
      raw_request: { line_user_id: USER, web_code: 'WC1' },
      raw_response: { ok: true },
      retries: 1,
      request_meta: {
        tool_name: 'walletpay',
        op: 'link',
        line_user_id: USER,
        admin_user_id: null,
        actor: 'customer',
        outcome: 'success',
        failure_type: undefined,
        idempotency_enabled: true,
      },
      reference_id: USER,
    });
  });
});
