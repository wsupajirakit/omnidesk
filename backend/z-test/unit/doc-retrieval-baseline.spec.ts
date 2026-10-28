import { createHmac } from 'node:crypto';

import {
  AssistSummaryUnavailableError,
  type AiReplyRequest,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';

/**
 * ==== [TEST-20260810-DOCBASELINE] the "before" of the retrieval port ====
 *
 * `webhook.service.ts:2256` says document retrieval is UNPORTED: a hook with a
 * `doc_id` logs a warning and reaches the model with `docText: ''`, exactly as a
 * hook with no `doc_id` does. This file PINS that, so when the retrieval port
 * lands (`todo/be_todo18_10082026.md`) there is a recorded "before" to compare
 * against — not a memory of one.
 *
 * ⚠️ FLOW TEST, not a unit test: every case calls the real
 * `WebhookService.processWebhook()` with a real HMAC-signed body and asserts on
 * the `AiReplyRequest` the pipeline actually handed the model seam. Only the
 * outside world (Mongo/Redis/LINE/Gemini) is faked, and the AI seam records the
 * request instead of billing one.
 *
 * ⚠️ WHAT THIS FILE MUST DO AFTER THE PORT LANDS: with the flag OFF these
 * assertions must STILL pass unchanged. If they need editing to stay green, the
 * port changed default behaviour and that is the bug — เปิด flag เท่านั้นที่ควรเปลี่ยน.
 */

const CHANNEL_SECRET = 'docbaseline-channel-secret';
const HOOK_ID = 'a0d000000000000000000014';
const USER_ID = 'Udoc00000000000000000000000000001';
const DOC_ID = 'a-real-looking-google-doc-id';

function query(result: unknown): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of [
    'populate',
    'lean',
    'sort',
    'limit',
    'skip',
    'select',
    'session',
  ]) {
    q[m] = () => q;
  }
  q['exec'] = () => Promise.resolve(result);
  q['then'] = (res: (v: unknown) => unknown) =>
    Promise.resolve(result).then(res);
  return q;
}

/** Combined external data carrying a name, so the N/A guard does not fire. */
const LINKED_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'สมชาย ทดสอบ', customer_tel: '0800000000' },
    },
  },
};

function buildHarness(hookOver: Record<string, unknown> = {}): {
  aiRequests: AiReplyRequest[];
  warnings: string[];
  post: (events: unknown[]) => Promise<void>;
} {
  const hook: Record<string, unknown> = {
    _id: HOOK_ID,
    alias: 'docbaseline',
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'docbaseline-dead-token',
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
    custom_tool_id: 'tool-1',
    ...hookOver,
  };

  const aiRequests: AiReplyRequest[] = [];
  const warnings: string[] = [];

  const passthrough = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'x' }),
    updateOne: () => query({ acknowledged: true }),
    findById: () => query(null),
    countDocuments: () => query(0),
  };

  const service = new WebhookService(
    { findOne: () => query(hook) } as never,
    {
      findOne: () => query(null),
      findOneAndUpdate: () => query({ _id: 'room-1' }),
      updateOne: () => query({ acknowledged: true }),
    } as never,
    {
      findOne: () => query(null),
      find: () => query([]),
      create: () => Promise.resolve({ _id: 'msg-1', room_id: 'room-1' }),
      updateOne: () => query({ acknowledged: true }),
      countDocuments: () => query(0),
    } as never,
    passthrough as never,
    passthrough as never,
    passthrough as never,
    passthrough as never,
    passthrough as never,
    { safeDecrypt: (v: string) => v } as never,
    {
      cacheHook: () => Promise.resolve(),
      getHookByAlias: () => Promise.resolve(hook),
      getHookByAliasWithSource: () =>
        Promise.resolve({ hook, source: 'cache' }),
    } as never,
    {
      logMessage: () => Promise.resolve({ _id: 'msg-1', room_id: 'room-1' }),
      logSystemMessage: () => Promise.resolve({ _id: 'sys-1' }),
      resolveRoom: () => Promise.resolve({ _id: 'room-1' }),
    } as never,
    {
      sendLineReplyMessage: () => Promise.resolve({ status: 200, data: {} }),
      sendLineFlexReply: () =>
        Promise.resolve({ status: 200, data: { sentMessages: [] } }),
      sendLineLoadingIndicator: () =>
        Promise.resolve({ status: 200, data: {} }),
      sendLinePushMessage: () => Promise.resolve({ status: 200, data: {} }),
      sendLinePushFlexMessage: () => Promise.resolve({ status: 200, data: {} }),
      getLineProfile: () => Promise.resolve(null),
    } as never,
    {
      downloadAndSaveImage: () => Promise.resolve(null),
      downloadAndSaveVideo: () => Promise.resolve(null),
    } as never,
    { createLog: () => Promise.resolve() } as never,
    { getCombinedData: () => Promise.resolve(LINKED_PROFILE) } as never,
    {
      getToolForHook: () => Promise.resolve(null),
      getCombinedData: () => Promise.resolve(LINKED_PROFILE),
      extractProfile: () => null,
    } as never,
    { consume: () => Promise.resolve({ limited: false }) } as never,
    {
      getClient: () => {
        throw new Error('no redis in unit test');
      },
    } as never,
    {
      generate: (req: AiReplyRequest) => {
        aiRequests.push(req);
        // A scripted answer, never a billed one — the point is the REQUEST.
        return Promise.resolve({ text: 'ok', noData: false, tagStatus: null });
      },
    },
    { summarise: () => Promise.reject(new AssistSummaryUnavailableError()) },
    { getConfigByKey: () => Promise.resolve(null) } as never,
    { telegramWebhookSecret: undefined, multiEventDelivery: false },
    { geminiApiKey: undefined, modelId: 'gemini-3.5-flash' } as never,
    // `ignoreDocId` unset — the state in which legacy WOULD retrieve.
    { ignoreDocId: undefined } as never,
    { publish: () => Promise.resolve() } as never,
    {
      mintLinkToken: () => ({
        url: 'https://link.test/x',
        token: 'tok',
        expiresAt: 0,
      }),
    } as never,
    { findOne: () => query(null), findById: () => query(null) } as never,
    {
      translate: (_d: string, k: string | number | null) => `${k ?? ''}`,
    } as never,
    {
      isSlipVerifyEnabled: () => false,
      verifySlip: () =>
        Promise.resolve({
          slipVerifyResult: null,
          slipRecordId: null,
          slipCreatedAt: null,
          slipCondition: null,
          attempted: false,
        }),
      handleSlipCallback: () => Promise.resolve(),
    } as never,
    { checkIfSlipWithQrCode: () => Promise.resolve(false) } as never,
  );

  /* Capture the `[DOC]` line the flag-off branch emits.
   *
   * ⚠️ BOTH `warn` and `log` are captured on purpose. Before the retrieval port
   * this was a WARNING ("retrieval is not ported"); with the port in place and
   * the flag off it is an ordinary LOG ("doc_retrieval is off for this OA"),
   * because the state is now a setting rather than a missing feature. The
   * severity changed; the observable behaviour — empty context — did not, which
   * is what the docText assertions below pin. */
  const logger = (
    service as unknown as {
      logger: { warn: (m: string) => void; log: (m: string) => void };
    }
  ).logger;
  const originalWarn = logger.warn.bind(logger);
  const originalLog = logger.log.bind(logger);
  logger.warn = (msg: string) => {
    warnings.push(String(msg));
    originalWarn(msg);
  };
  logger.log = (msg: string) => {
    warnings.push(String(msg));
    originalLog(msg);
  };

  const post = async (events: unknown[]): Promise<void> => {
    const body = { destination: 'Udoc', events };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: '/docbaseline/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(body, hook, 'cache', 'docbaseline', meta);
  };

  return { aiRequests, warnings, post };
}

function textEvent(text: string): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-doc',
    replyToken: 'rt-doc',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'm1', text },
  };
}

describe('[TEST-20260810-DOCBASELINE] document retrieval is not wired in yet', () => {
  it('a hook WITHOUT doc_id reaches the model with an empty docText', async () => {
    const { aiRequests, post } = buildHarness();
    await post([textEvent('ร้านเปิดกี่โมง')]);

    expect(aiRequests).toHaveLength(1);
    expect(aiRequests[0]!.docText).toBe('');
  });

  it('a hook WITH doc_id reaches the model with an empty docText TOO', async () => {
    // The whole point of the baseline: today the two cases are identical. After
    // the port lands with its flag OFF, they must STILL be identical.
    const { aiRequests, post } = buildHarness({ doc_id: DOC_ID });
    await post([textEvent('ร้านเปิดกี่โมง')]);

    expect(aiRequests).toHaveLength(1);
    expect(aiRequests[0]!.docText).toBe('');
  });

  it('the two cases produce the SAME docText — no divergence today', async () => {
    const without = buildHarness();
    await without.post([textEvent('เหมือนกันไหม')]);
    const withDoc = buildHarness({ doc_id: DOC_ID });
    await withDoc.post([textEvent('เหมือนกันไหม')]);

    expect(withDoc.aiRequests[0]!.docText).toBe(without.aiRequests[0]!.docText);
  });

  it('a doc_id hook SAYS why it is skipping retrieval, so the state is visible', async () => {
    // Skipping must never be silent: if this line disappears, retrieval was
    // dropped by accident rather than by configuration. The wording moved from
    // "not ported" to "doc_retrieval is off" when the port landed — what is
    // pinned is that SOMETHING names the doc and explains the skip.
    const { warnings, post } = buildHarness({ doc_id: DOC_ID });
    await post([textEvent('มีเอกสารไหม')]);

    expect(
      warnings.some((w) => w.includes('[DOC]') && w.includes(DOC_ID)),
    ).toBe(true);
  });

  it('the model is still asked the question — empty context is not a dead end', async () => {
    // Empty docText must not stop the turn: legacy answers from the suggestion
    // text alone for the majority of OAs, which have no doc_id at all.
    const { aiRequests, post } = buildHarness({ doc_id: DOC_ID });
    await post([textEvent('ถามอะไรสักอย่าง')]);

    expect(aiRequests[0]!.question).toContain('ถามอะไรสักอย่าง');
  });
});
