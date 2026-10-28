/**
 * ⚠️ [HOTFIX-20260826-THINK36] ค่าที่ตรึงไว้ในไฟล์นี้ถูก **พลิก** เมื่อ 26/08/2026
 * ---------------------------------------------------------------------------
 * ก้อน `thinkingConfig` บนสายเปลี่ยนจาก `{"thinkingBudget":0}` เป็น
 * `{"thinkingLevel":"minimal"}` สำหรับกรณี "ปิดความคิด" บนโมเดล Gemini 3
 *
 * เหตุผล (วัดจากของจริง ไม่ใช่จากเอกสาร): `gemini-3.6-flash` **ตอบ 400
 * INVALID_ARGUMENT** เมื่อได้รับ `thinkingBudget: 0` และ error ที่ส่งกลับมาไม่มี
 * คำว่า "think" ⇒ ตาข่ายกู้ชีพ (`em.includes('think')`) ไม่ติด ⇒ ลูกค้าไม่ได้
 * คำตอบเลย · 24 จาก 29 hook ตั้งค่า "ปิด" ไว้ ⇒ สลับรุ่นเมื่อไหร่ตายพร้อมกัน 24 ตัว
 * `thinkingLevel:"minimal"` ให้ผลเท่ากันเป๊ะบน 3.5 (ไม่มี thoughtsTokenCount =
 * ไม่คิดเลย) และใช้ได้บน 3.6 ด้วย — ยิงยืนยันรุ่นละ 2 รอบ ผ่านทั้ง 4
 *
 * ผู้ตัดสิน: เจ้าของ 26/08 — *"สรุปใช้ minimal ทั้งสองนะ"*
 * รายละเอียดครบ: `src/modules/webhook/ai-vendors/gemini/thinking-config.ts`
 *
 * 🔴 เคสเดิม**ไม่ถูกลบ** แค่พลิกค่าที่คาดหวัง — ถ้าวันหลังใครทำให้สายกลับไปส่ง
 *    `thinkingBudget: 0` บน Gemini 3 เคสพวกนี้จะแดงทันที ซึ่งคือหน้าที่ของมัน
 */
/**
 * [WRAP-AI FULLFLOW] the wrapped funnel INSIDE the real pipeline — the no-bias
 * full-flow smoke the owner asked for ("full flow test no bias ทุกจุดเดิม+ใหม่
 * + คิวรี่ dyntag flex ลองจริง"), with NO real AI call.
 *
 * ⚠️ WHAT THIS ADDS over W0/W1/W2 and over webhook-flow-matrix:
 *   · flow-matrix drives the REAL `processWebhook` but fakes the AI provider
 *     inline — so the wrapped funnel (dyntag → assembler → transport →
 *     interpreter) was never exercised INSIDE the pipeline. Here the REAL
 *     `GeminiReplyProvider` + REAL `RagEngineService` are injected, axios spied.
 *   · every fixture shape below is copied from REAL DB rows read on 2026-08-13
 *     (local_db_10_aug_26, hook demo-oa-three): tag `odk_p_00001 →
 *     data.profile.web_code`, sub_type `CUSTOMER_PROFILE`, scoping via
 *     `group_ids` (all 801 real tags carry hook_id:null/group_id:null and ONLY
 *     group_ids — matching a string hookGroupId works in prod purely because
 *     Mongoose casts it to ObjectId per the schema; mongosh with a raw string
 *     matches 0). The combined-block shape `{success,status,data:{profile},…}`
 *     is `custom-tool.service.ts:1279`. Knobs 0.4/20/0.4 are demo-oa-three's real
 *     hook values.
 *   · a LIVE trial against the real DB (scratchpad, 2026-08-13) already proved
 *     the query+cast+substitution on the real 801 rows; this spec pins the same
 *     shapes in-repo so CI needs no live mongo.
 *
 * ⚠️ NO NETWORK, NO KEY, NO REAL AI — axios.post is spied and REFUSES unless a
 *    case arms a canned response; the LINE token is dead; the no-ai-outbound
 *    global guard is active. ห้ามยิง AI จริง — ทุก post ถูก spy.
 */
import { createHmac } from 'node:crypto';

import axios from 'axios';
import { Logger } from '@nestjs/common';

import { RagEngineService } from '@/modules/ai/rag-engine.service';
import {
  AssistSummaryUnavailableError,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';
import { GeminiReplyProvider } from '@/modules/webhook/ai-vendors/gemini/gemini-reply.provider';

// ── HTTP capture — refuses by default; a case arms one canned model response ──
type HttpArgs = unknown[];
/* [FEAT-20260908-GEMINIKEYHEADER] `config` is recorded now. It was not before,
   because the only thing worth asserting about it lived in the URL. The key moved
   to a header, so a recorder that ignores config would let this file stop seeing
   the credential entirely — coverage lost without a single red test. */
const posts: Array<{ url: string; body: unknown; config?: unknown }> = [];
const httpPost = jest.fn(
  (...args: HttpArgs): Promise<{ status: number; data: unknown }> => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
      config: args[2],
    });
    return Promise.reject(
      new Error(`[FULLFLOW] axios.post un-armed -> ${String(args[0])}`),
    );
  },
);
jest
  .spyOn(axios, 'post')
  .mockImplementation((...a: HttpArgs) => httpPost(...a));
globalThis.fetch = () => Promise.reject(new Error('[FULLFLOW] fetch blocked'));

function armModelText(text: string) {
  httpPost.mockImplementationOnce((...args: HttpArgs) => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
      config: args[2],
    });
    return Promise.resolve({
      status: 200,
      data: { candidates: [{ content: { parts: [{ text }] } }] },
    });
  });
}

/* [FEAT-20260830-AIRETRY] what axios really throws when the socket stalls:
   `code` AND a message, because the repo's timeout test reads both. */
function armModelTimeout() {
  httpPost.mockImplementationOnce((...args: HttpArgs) => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
      config: args[2],
    });
    return Promise.reject(
      Object.assign(new Error('timeout of 30000ms exceeded'), {
        code: 'ECONNABORTED',
      }),
    );
  });
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

// deterministic env — the per-hook key must be the one that fires
const ENV_KEYS = [
  'MODEL_ID',
  'GEMINI_API_KEY',
  'GEMINI_TEST_KEY',
  'GEMINI_TEMPERATURE',
  'GEMINI_TOP_P',
  'GEMINI_TOP_K',
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env['MODEL_ID'] = 'gemini-3.5-flash';
  delete process.env['GEMINI_API_KEY'];
  delete process.env['GEMINI_TEST_KEY'];
  delete process.env['GEMINI_TEMPERATURE'];
  delete process.env['GEMINI_TOP_P'];
  delete process.env['GEMINI_TOP_K'];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

// ── REAL SHAPES (copied from local_db_10_aug_26 on 2026-08-13) ────────────────
const CHANNEL_SECRET = 'fullflow-channel-secret';
const HOOK_ID = 'a0d00000000000000000002e'; // demo-oa-three's real _id
const GROUP_ID = 'a0d00000000000000000001e'; // demo-oa-three's real group (string, as webhook threads)
const USER_ID = 'Ufullflowa0d000000000000000000012';

/** Real dynamic_tags rows — every field a real row carries, values verbatim. */
const REAL_TAG_ROWS = [
  {
    tag: 'odk_p_00001',
    value: 'data.profile.web_code',
    sub_type: 'CUSTOMER_PROFILE',
    status: true,
    deleted_at: null,
    hook_id: null,
    group_id: null,
    hook_ids: [],
    group_ids: [GROUP_ID],
    type: 'api',
  },
  {
    tag: 'odk_p_00002',
    value: 'data.profile.line_user_id',
    sub_type: 'CUSTOMER_PROFILE',
    status: true,
    deleted_at: null,
    hook_id: null,
    group_id: null,
    hook_ids: [],
    group_ids: [GROUP_ID],
    type: 'api',
  },
];

/** The real combined-block shape (`custom-tool.service.ts:1279`) + the legacy
 *  customer block the profile/N-A guard reads. */
const REAL_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'สมชาย ทดสอบ', customer_tel: '0800000000' },
    },
  },
  CUSTOMER_PROFILE: {
    success: true,
    status: 200,
    data: { profile: { web_code: 'AB9-REAL' } }, // line_user_id absent → N/A, as live
    duration: 42,
    is_profile: true,
    role: '',
  },
};

/** Real flex card shape (`flex_messages` row: name/content_json/flex_type). */
const REAL_CARD = {
  _id: 'fx-profile',
  name: 'flexSuccess',
  flex_type: 'profile',
  content_json: {
    type: 'bubble',
    size: 'mega',
    body: { type: 'box', layout: 'vertical', contents: [] },
  },
};

/** Chainable Mongoose query stub (same as flow-matrix). */
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

interface Trace {
  replies: string[];
  flexReplies: Array<{ altText: string; contents: unknown }>;
  logRows: Array<Record<string, unknown>>;
  tagQueries: Array<Record<string, unknown>>;
  /* [P2-20260813] slip/qr activity, so a vendor-swap case can prove those
     paths behave the same whichever vendor answers. */
  slipVerifies: Array<Record<string, unknown>>;
  slipCallbacks: Array<Record<string, unknown>>;
  qrChecks: number;
  /* [P2-20260813] the key handed to the Training-Doc retrieval path, which
     builds a Google URL — so a non-Gemini value here is a cross-vendor leak. */
  docRetrievalKeys: Array<string | null>;
  /* [FEAT-20260904-VENDORSECCOL] the MODEL the Google doc lane was asked for.
     The key was already captured; the model was not, and that gap let a mutation
     pointing this lane at the vendor-resolved model survive every case. */
  docRetrievalModels: Array<string | null>;
  /* [P2-20260813] every runForSlip call — the topup/walletpay hand-off. */
  paymentRuns: Array<Record<string, unknown>>;
  /* [FEAT-20260830-REPLYPUSH] which leg each outbound message took, in order.
     Without this a push looks identical to a reply in `replies`, and the whole
     point of the ladder is WHICH one delivered. */
  sendKinds: string[];
}

interface Opts {
  hook?: Record<string, unknown>;
  /* [FEAT-20260830-REPLYPUSH] make LINE refuse the reply token, the way the
     real rows show it doing (`400 {"message":"Invalid reply token"}`). Default
     off ⇒ every existing case is untouched. */
  replyRefused?: boolean;
  flexProfileDoc?: Record<string, unknown> | null;
  /* [P2-20260813] slip seams, so the vendor-swap cases can prove the slip and
     payment paths are untouched by the vendor choice. Default off = today. */
  slipEnabled?: boolean;
  slipResult?: Record<string, unknown>;
  qrIsSlip?: boolean;
  /* [P2-20260813] The server-level Gemini key, as `aiConfig` really carries it in
     production. Default undefined = what every other case here assumes. A case
     that sets it is testing the fallback rule, never a real credential: the value
     is a literal fake and no request leaves the process (axios is mocked). */
  envGeminiKey?: string;
  /* [P2-20260813] payment/topup seam — off by default, exactly as today. */
  paymentEnabled?: boolean;
  paymentTool?: Record<string, unknown> | null;
  paymentResult?: Record<string, unknown>;
}

/** demo-oa-three-shaped hook: real knobs 0.4/20/0.4, real group id, a per-OA key. */
function realHook(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: 'fullflow',
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'fullflow-dead-token', // dead — every LINE call is faked anyway
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
    custom_tool_id: 'tool-1',
    group: GROUP_ID,
    custom_ai_key: 'fullflow-per-oa-key', // safeDecrypt is identity in this harness
    /* [FEAT-20260904-VENDORSECCOL] Each vendor owns its own key column now, so a
       DeepSeek hook built from this fixture needs a DeepSeek key of its own —
       before the split the single column served whichever vendor was selected.
       ⚠️ Deliberately a DIFFERENT value from the Gemini one: a case that passes
       with both set to the same string would not notice a resolver reading the
       wrong column. คนละค่าคนละค่าย ไม่งั้นอ่านผิดคอลัมน์ก็ยังเขียว */
    custom_ai_key_sec: 'fullflow-per-oa-key-deepseek',
    gemini_temperature: 0.4, // demo-oa-three's real values
    gemini_top_k: 20,
    gemini_top_p: 0.4,
    // the Training Document — legacy branch ([END_OF_BASIC_INFO]) with a REAL
    // dyntag marker in it, exactly what the live substitution rewrites
    suggestion_text:
      'ข้อมูลเว็บของลูกค้า: odk_p_00001 และไลน์: odk_p_00002 [END_OF_BASIC_INFO]',
    default_answer_text: 'ไม่พบข้อมูลค่ะ ติดต่อแอดมิน',
    ai_generative_error_text: 'AI ล่มชั่วคราว ลองใหม่อีกครั้งนะคะ',
    ...over,
  };
}

function buildHarness(opts: Opts = {}): {
  trace: Trace;
  post: (text: string) => Promise<void>;
  postImage: () => Promise<void>;
} {
  const hook = opts.hook ?? realHook();
  const trace: Trace = {
    replies: [],
    flexReplies: [],
    logRows: [],
    tagQueries: [],
    slipVerifies: [],
    slipCallbacks: [],
    qrChecks: 0,
    docRetrievalKeys: [],
    docRetrievalModels: [],
    paymentRuns: [],
    sendKinds: [],
  };

  // ── the REAL chain: RagEngineService (real) + GeminiReplyProvider (real) ──
  // tagModel serves the REAL row shapes and RECORDS the query so the case can
  // assert buildDynamicTagQuery produced the real $or/group_ids match.
  const tagModel = {
    find: (q: Record<string, unknown>) => {
      trace.tagQueries.push(q);
      return { lean: () => Promise.resolve(REAL_TAG_ROWS) };
    },
  };
  const ragChatModel = {
    find: () => ({
      sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
    }),
  };
  const logSink = {
    createLog: (row: Record<string, unknown>) => {
      trace.logRows.push(row);
      return Promise.resolve({});
    },
  };
  const ragEngine = new RagEngineService(
    tagModel as never,
    ragChatModel as never,
    logSink,
    undefined, // formatDeps unbound — exactly as prod (ai.module.ts)
  );
  const realAiProvider = new GeminiReplyProvider(ragEngine);

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
      create: (row: Record<string, unknown>) =>
        Promise.resolve({ _id: 'msg-1', room_id: 'room-1', ...row }),
      updateOne: () => query({ acknowledged: true }),
      countDocuments: () => query(0),
    } as never,
    passthrough as never, // memberModel
    passthrough as never, // assignHistoryModel
    passthrough as never, // ticketModel
    passthrough as never, // objectImageModel
    /* [P2-20260813] imageStorageModel. ⚠️ Returning null here (the original)
       leaves `slipStorageFilePath` null, and the slip-verify gate requires it —
       so NO slip case in this file ever reached Swiftcheck. `slipEnabled` alone was
       never enough. Opt-in per case so untouched cases keep the old behaviour. */
    {
      findById: () =>
        query(
          opts.slipEnabled
            ? {
                _id: 'img-store-1',
                image_url: '/media/slip.jpg',
                file_path: '/tmp/slip.jpg',
              }
            : null,
        ),
    } as never, // imageStorageModel
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
      sendLineReplyMessage: (_t: string, _r: string, text: string) => {
        trace.replies.push(text);
        return Promise.resolve({ status: 200, data: {} });
      },
      sendLineFlexReply: (
        _t: string,
        _r: string,
        contents: unknown,
        altText: string,
      ) => {
        trace.flexReplies.push({ altText, contents });
        return Promise.resolve({ status: 200, data: { sentMessages: [] } });
      },
      sendLineLoadingIndicator: () =>
        Promise.resolve({ status: 200, data: {} }),
      sendLinePushMessage: () => Promise.resolve({ status: 200, data: {} }),
      sendLinePushFlexMessage: () => Promise.resolve({ status: 200, data: {} }),
      getLineProfile: () => Promise.resolve(null),
    } as never,
    {
      /* Paired with the imageStorageModel stub above: the storage row is only
         looked up when a download reports an id. */
      downloadAndSaveImage: () =>
        Promise.resolve(opts.slipEnabled ? 'img-store-1' : null),
      downloadAndSaveVideo: () => Promise.resolve(null),
    } as never,
    {
      createLog: (row: Record<string, unknown>) => {
        trace.logRows.push(row);
        return Promise.resolve();
      },
    } as never,
    {
      getCombinedData: () => Promise.resolve(REAL_PROFILE),
    } as never,
    {
      getToolForHook: () => Promise.resolve(null),
      getCombinedData: () => Promise.resolve(REAL_PROFILE),
      extractProfile: () => null,
    } as never,
    {
      consume: () => Promise.resolve({ limited: false }),
      /* [FEAT-20260824-RATEPEEK] read-only twin, asked before a paid slip
         verification. Always under quota here — this suite is about vendors. */
      peek: () =>
        Promise.resolve({ limited: false, level: 1, current: null, limit: 3 }),
    } as never,
    {
      getClient: () => {
        throw new Error('no redis in unit test');
      },
    } as never,
    realAiProvider, // ⭐ THE POINT — the real wrapped funnel, not a fake
    { summarise: () => Promise.reject(new AssistSummaryUnavailableError()) },
    { getConfigByKey: () => Promise.resolve(null) } as never,
    { telegramWebhookSecret: undefined, multiEventDelivery: false },
    { geminiApiKey: opts.envGeminiKey, modelId: 'gemini-3.5-flash' } as never,
    { ignoreDocId: undefined } as never,
    { publish: () => Promise.resolve() } as never,
    {
      mintLinkToken: () => ({
        url: 'https://link.test/x',
        token: 'tok',
        expiresAt: 0,
      }),
    } as never,
    {
      findOne: () => query(opts.flexProfileDoc ?? null),
      findById: () => query(null),
    } as never,
    {
      translate: (_d: string, k: string | number | null) => `${k ?? ''}`,
    } as never,
    {
      isSlipVerifyEnabled: () => opts.slipEnabled === true,
      verifySlip: (input: Record<string, unknown>) => {
        trace.slipVerifies.push(input);
        return Promise.resolve(
          opts.slipResult ?? {
            slipVerifyResult: null,
            slipRecordId: null,
            slipCreatedAt: null,
            slipCondition: null,
            attempted: false,
          },
        );
      },
      handleSlipCallback: (input: Record<string, unknown>) => {
        trace.slipCallbacks.push(input);
        return Promise.resolve();
      },
    } as never,
    {
      checkIfSlipWithQrCode: () => {
        trace.qrChecks += 1;
        return Promise.resolve(opts.qrIsSlip === true);
      },
    } as never,
    /* ⚠️ THREE optional args stand between the QR seam and the retrieval seam,
       and they are positional: configCacheInvalidator, then paymentRunner, then
       docRetrievalProvider. Getting this count wrong does NOT error — the seam
       silently lands in the wrong slot and retrieval never runs, so the test
       reads as passing while proving nothing. นับให้ครบ ไม่งั้นเทสต์หลอกตัวเอง. */
    /* configCacheInvalidator — absent, as every other case here assumes. */
    undefined,
    /* [P2-20260813] The topup/walletpay runner. Present only when a case opts in,
       so every other case keeps the "absent ⇒ payment seams no-op" behaviour.
       `runForSlip` is what the slip path calls once Swiftcheck returns a record. */
    (opts.paymentEnabled
      ? {
          resolvePaymentTool: () => Promise.resolve(opts.paymentTool ?? null),
          runForSlip: (input: Record<string, unknown>) => {
            trace.paymentRuns.push(input);
            return Promise.resolve(
              opts.paymentResult ?? { ran: false, reply: null },
            );
          },
        }
      : undefined) as never,
    /* [P2-20260813] The Training-Doc retrieval seam, so a case can see WHICH key
       this path receives. It is the last optional constructor arg; leaving it
       undefined keeps the inert provider, which is the old behaviour. */
    {
      retrieve: (req: { apiKey?: string | null; modelId?: string | null }) => {
        trace.docRetrievalKeys.push(req?.apiKey ?? null);
        trace.docRetrievalModels.push(req?.modelId ?? null);
        return Promise.resolve('');
      },
    },
    /* strike — absent, exactly as before this arg existed. */
    undefined,
    /* [FEAT-20260827-PUSHCORE-B] `LinePushDispatcher`. The PAYMENT reply no longer
       rides the `lineApi` double above — candidate B moved that one path onto the
       push core — so without this the payment card/text simply never reaches
       `trace.replies` and P3 reads as "the reply was never sent". It captures into
       the SAME two arrays so every existing assertion keeps its meaning.
       Note the shape: the core resolves `{ok:true,...}` and never rejects; `ok` is
       what the caller branches on, so a double that returns only `status` would let
       a failure read as a success. */
    {
      dispatch: (req: {
        kind: string;
        messages?: Array<Record<string, unknown>>;
      }) => {
        const m = req.messages?.[0];
        trace.sendKinds.push(req.kind);
        if (m?.['type'] === 'flex') {
          trace.flexReplies.push({
            altText: typeof m['altText'] === 'string' ? m['altText'] : '',
            contents: m['contents'],
          });
        } else if (m?.['type'] === 'text') {
          trace.replies.push(typeof m['text'] === 'string' ? m['text'] : '');
        }
        /* [FEAT-20260830-REPLYPUSH] only the REPLY leg is refused; the push
           succeeds. That is the live shape — the token is spent or expired,
           the channel token itself is fine. */
        if (opts.replyRefused && req.kind === 'reply') {
          return Promise.resolve({
            ok: false,
            status: 400,
            attempts: 1,
            durationMs: 0,
            reason: 'Invalid reply token',
            raw: Object.assign(
              new Error('Request failed with status code 400'),
              {
                response: {
                  status: 400,
                  data: { message: 'Invalid reply token' },
                },
              },
            ),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          attempts: 1,
          durationMs: 0,
          data: {},
        });
      },
    } as never,
  );

  const post = async (text: string): Promise<void> => {
    const body = {
      destination: 'Ufullflow',
      events: [
        {
          type: 'message',
          eventId: `ev-${text.slice(0, 8)}`,
          replyToken: 'rt-1',
          timestamp: Date.now(),
          source: { type: 'user', userId: USER_ID },
          message: { type: 'text', id: 'm1', text },
        },
      ],
    };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: '/fullflow/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(body, hook, 'cache', 'fullflow', meta);
  };

  /* [P2-20260813] Same signed delivery, but an image event — the entry point
     for the slip/QR path, so a vendor-swap case can prove that path never
     consults the vendor at all. */
  const postImage = async (): Promise<void> => {
    const body = {
      destination: 'Ufullflow',
      events: [
        {
          type: 'message',
          eventId: 'ev-image',
          replyToken: 'rt-img',
          timestamp: Date.now(),
          source: { type: 'user', userId: USER_ID },
          message: { type: 'image', id: 'img-1' },
        },
      ],
    };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: '/fullflow/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(body, hook, 'cache', 'fullflow', meta);
  };

  return { trace, post, postImage };
}

beforeEach(() => {
  posts.length = 0;
  httpPost.mockClear();
});

/** The system_instruction text of the one captured wire body. */
function wireInstruction(): string {
  const b = posts[0]!.body as {
    system_instruction: { parts: { text: string }[] };
  };
  return b.system_instruction.parts[0]!.text;
}

// ═══════════════════════════════════════════════════════════════════════════
describe('[WRAP-AI FULLFLOW] real pipeline → real funnel → wire bytes', () => {
  it('F1 · a text turn substitutes the REAL tag into the wire and answers the customer', async () => {
    armModelText('ยอดของคุณคือ 100 บาท [[[FOUND]]]');
    const { trace, post } = buildHarness();
    await post('ยอดเท่าไหร่');

    // one model call went out through the funnel's transport
    expect(posts).toHaveLength(1);
    // the REAL tag was substituted from the CUSTOMER_PROFILE block…
    expect(wireInstruction()).toContain('AB9-REAL');
    expect(wireInstruction()).not.toContain('odk_p_00001');
    // …and a tag whose path is missing resolves to N/A, exactly as live
    expect(wireInstruction()).toContain('N/A');
    // the customer got the CLEAN text — [[[FOUND]]] stripped by the interpreter
    expect(trace.replies).toEqual(['ยอดของคุณคือ 100 บาท']);
  });

  it('F2 · the wire carries the hook knobs (demo-oa-three 0.4/20/0.4), the per-OA key, v1beta', async () => {
    armModelText('ok [[[FOUND]]]');
    const { post } = buildHarness();
    await post('เช็คค่า');

    const url = posts[0]!.url;
    expect(url).toContain('/v1beta/models/gemini-3.5-flash:generateContent');
    /* the hook key, not an env key — on the header since
       [FEAT-20260908-GEMINIKEYHEADER], and NOT in the URL */
    expect(url).not.toContain('key=');
    expect(
      (posts[0]!.config as { headers?: Record<string, string> })?.headers?.[
        'x-goog-api-key'
      ],
    ).toBe('fullflow-per-oa-key');
    const cfg = (
      posts[0]!.body as {
        generationConfig: Record<string, unknown>;
      }
    ).generationConfig;
    expect(cfg['temperature']).toBe(0.4);
    expect(cfg['topP']).toBe(0.4);
    expect(cfg['topK']).toBe(20);
    /* [HOTFIX-20260826-THINK36] พลิกจาก `{ thinkingBudget: 0 }` — ดูหัวไฟล์ */
    expect(cfg['thinkingConfig']).toEqual({ thinkingLevel: 'minimal' });
  });

  it('F3 · the dyntag DB query is the real scope match (group_ids reaches the $or)', async () => {
    armModelText('ok [[[FOUND]]]');
    const { trace, post } = buildHarness();
    await post('สวัสดี');

    // buildDynamicTagQuery(hookId, hookGroupId) with the REAL string ids — the
    // shape Mongoose casts against group_ids:[ObjectId] (live trial: string in
    // mongosh matches 0; through the model it matches all 801)
    expect(trace.tagQueries).toHaveLength(1);
    expect(trace.tagQueries[0]).toEqual({
      status: true,
      deleted_at: null,
      $or: [
        { hook_id: HOOK_ID },
        { hook_ids: HOOK_ID },
        { group_id: GROUP_ID },
        { group_ids: GROUP_ID },
      ],
    });
  });

  it('F4 · NOT_FOUND from the model → the hook default answer, not the raw text', async () => {
    armModelText('ขออภัย ไม่พบข้อมูลในเอกสาร [[[NOT_FOUND]]]');
    const { trace, post } = buildHarness();
    await post('ถามเรื่องที่ไม่มี');

    expect(trace.replies).toEqual(['ไม่พบข้อมูลค่ะ ติดต่อแอดมิน']);
  });

  it('F4b · BOTH tags in one reply → not-found STILL wins (precedence through the flow)', async () => {
    // the precedence rule lives in the interpreter; this proves it holds when
    // driven through the whole pipeline, not just in the unit spec
    armModelText('เจอบางส่วน [[[FOUND]]] แต่หลักๆ ไม่พบ [[[NOT_FOUND]]]');
    const { trace, post } = buildHarness();
    await post('ถามแบบก้ำกึ่ง');

    expect(trace.replies).toEqual(['ไม่พบข้อมูลค่ะ ติดต่อแอดมิน']);
  });

  it('F5 · a model HTTP failure → the generative-error text (not the not-found line)', async () => {
    // un-armed → the transport reports the failure → interpreter error contract
    const { trace, post } = buildHarness();
    await post('AI ล่มอยู่ไหม');

    expect(trace.replies).toEqual(['AI ล่มชั่วคราว ลองใหม่อีกครั้งนะคะ']);
  });

  it('F6 · an unknown marker in the Training Doc lands in the mismatch log row', async () => {
    armModelText('ตอบปกติ [[[FOUND]]]');
    const { trace, post } = buildHarness({
      hook: realHook({
        suggestion_text:
          'เว็บ: odk_p_00001 และ odk_x_77777 ที่พิมพ์ผิด [END_OF_BASIC_INFO]',
      }),
    });
    await post('ทดสอบ marker');

    const row = trace.logRows.find(
      (r) => r['action_type'] === 'dynamic_tag_marker_mismatch',
    ) as { raw_request?: { unknown_markers?: string[] } } | undefined;
    expect(row).toBeDefined();
    expect(row!.raw_request!.unknown_markers).toContain('odk_x_77777');
    // the resolved real tag must NOT be reported
    expect(row!.raw_request!.unknown_markers).not.toContain('odk_p_00001');
  });

  it('F7 · a flex marker from the model builds the card (real card shape), altText clean', async () => {
    armModelText('นี่คือข้อมูลของคุณ [[[flex_profile]]]');
    const { trace, post } = buildHarness({
      hook: realHook({ flex_profile_id: 'fx-profile' }),
      flexProfileDoc: REAL_CARD,
    });
    await post('ขอโปรไฟล์');

    expect(trace.flexReplies).toHaveLength(1);
    expect(trace.replies).toEqual([]); // the card REPLACES the text
    expect(trace.flexReplies[0]!.altText).not.toContain('[[[');
    const card = JSON.stringify(trace.flexReplies[0]!.contents);
    expect(card).toContain('"type":"bubble"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   [P2-20260813] VENDOR SWAP — the same real pipeline, answered by each vendor.
   The question the owner asked: does the hook load right and does the flow
   survive when ai_vendor flips? Nothing here calls a real model: axios.post is
   the same spy the cases above use, and it refuses unless a case arms it.
   ══════════════════════════════════════════════════════════════════════════ */

/** Arm one canned DeepSeek chat-completion response (shape, not a real call). */
function armDeepSeekText(text: string) {
  httpPost.mockImplementationOnce((...args: HttpArgs) => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
      config: args[2],
    });
    return Promise.resolve({
      status: 200,
      data: { choices: [{ message: { content: text } }] },
    });
  });
}

describe('[P2 FULLFLOW] the hook decides the vendor, inside the real pipeline', () => {
  beforeEach(() => {
    posts.length = 0;
    httpPost.mockClear();
  });

  it('V1 · ai_vendor=deepseek → the DeepSeek endpoint answers, dyntag still substituted', async () => {
    const { trace, post } = buildHarness({
      hook: realHook({ ai_vendor: 'deepseek', ai_model_sec: null }),
    });
    armDeepSeekText('ยอดของคุณคือ 500 บาทค่ะ');
    await post('ยอดเท่าไหร่');

    // 1. it went to DeepSeek, not Google
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toContain('api.deepseek.com');
    expect(posts[0]?.url).not.toContain('googleapis.com');

    // 2. the model is DeepSeek's family default, because the hook chose none
    const body = posts[0]?.body as {
      model: string;
      messages: Array<{ content: string }>;
    };
    expect(body.model).toBe('deepseek-v4-flash');

    // 3. ⭐ the DOMAIN work still happened: the dyntag marker in the Training
    //    Document was substituted before the vendor ever saw the prompt.
    const sent = body.messages.map((m) => m.content).join('\n');
    expect(sent).not.toContain('odk_p_00001');
    expect(trace.tagQueries.length).toBeGreaterThan(0);

    // 4. the customer got the answer
    expect(trace.replies.join(' ')).toContain('500');
  });

  it('V2 · ai_vendor=gemini → unchanged: Google endpoint, same wire as before', async () => {
    const { trace, post } = buildHarness({
      hook: realHook({ ai_vendor: 'gemini', ai_model: null }),
    });
    armModelText('ยอดของคุณคือ 500 บาทค่ะ');
    await post('ยอดเท่าไหร่');

    expect(posts[0]?.url).toContain('generativelanguage.googleapis.com');
    // family default, identical to what MODEL_ID used to supply
    expect(posts[0]?.url).toContain('gemini-3.5-flash');
    expect(trace.replies.join(' ')).toContain('500');
  });

  it('V3 · no ai_vendor at all → behaves exactly like gemini (old rows are safe)', async () => {
    const { trace, post } = buildHarness({ hook: realHook() });
    armModelText('ตอบปกติค่ะ');
    await post('สวัสดี');
    expect(posts[0]?.url).toContain('generativelanguage.googleapis.com');
    expect(trace.replies.join(' ')).toContain('ตอบปกติ');
  });

  it('V4 · per-hook model reaches each vendor', async () => {
    const ds = buildHarness({
      hook: realHook({
        ai_vendor: 'deepseek',
        ai_model_sec: 'deepseek-reasoner',
        // [FEAT-20260904-VENDORSECCOL] a Gemini model sits in the other column
        // at the same time; picking it up here would be reading the wrong one.
        ai_model: 'gemini-2.5-flash',
      }),
    });
    armDeepSeekText('ok');
    await ds.post('ถามหน่อย');
    expect((posts[0]?.body as { model: string }).model).toBe(
      'deepseek-reasoner',
    );

    posts.length = 0;
    const gm = buildHarness({
      hook: realHook({ ai_vendor: 'gemini', ai_model: 'gemini-2.5-flash' }),
    });
    armModelText('ok');
    await gm.post('ถามหน่อย');
    expect(posts[0]?.url).toContain('gemini-2.5-flash');
  });

  it('V5 · a DeepSeek hook with NO key refuses — never borrows the Gemini env key', async () => {
    const savedTest = process.env['GEMINI_TEST_KEY'];
    const savedProd = process.env['GEMINI_API_KEY'];
    try {
      process.env['GEMINI_TEST_KEY'] = 'G-TEST';
      process.env['GEMINI_API_KEY'] = 'G-PROD';
      const { trace, post } = buildHarness({
        hook: realHook({ ai_vendor: 'deepseek', custom_ai_key_sec: '' }),
      });
      await post('ยอดเท่าไหร่');
      // No vendor call at all, and the customer gets the hook's generative-error
      // copy rather than silence.
      expect(posts).toHaveLength(0);
      expect(trace.replies.join(' ')).toContain('AI ล่มชั่วคราว');
    } finally {
      if (savedTest === undefined) delete process.env['GEMINI_TEST_KEY'];
      else process.env['GEMINI_TEST_KEY'] = savedTest;
      if (savedProd === undefined) delete process.env['GEMINI_API_KEY'];
      else process.env['GEMINI_API_KEY'] = savedProd;
    }
  });

  it('V6 · flex marker still renders a card when DeepSeek answered', async () => {
    const { trace, post } = buildHarness({
      hook: realHook({ ai_vendor: 'deepseek', flex_profile_id: 'fx-profile' }),
      flexProfileDoc: REAL_CARD,
    });
    armDeepSeekText('นี่คือข้อมูลของคุณ [[[flex_profile]]]');
    await post('ขอโปรไฟล์');
    expect(posts[0]?.url).toContain('api.deepseek.com');
    // the card came from the flex pipeline, which never learns the vendor
    expect(trace.flexReplies.length).toBeGreaterThan(0);
  });

  it('V7 · an unknown vendor falls back to gemini rather than breaking the reply', async () => {
    const { trace, post } = buildHarness({
      hook: realHook({ ai_vendor: 'deepsek' }), // typo an operator could save via API
    });
    armModelText('ยังตอบได้ค่ะ');
    await post('ทดสอบ');
    expect(posts[0]?.url).toContain('generativelanguage.googleapis.com');
    expect(trace.replies.join(' ')).toContain('ยังตอบได้');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   [P2-20260813] The money paths must not notice the vendor at all.
   Slip verification, the payment/topup runner and the flex cards are domain
   work that happens before or after the model turn — if any of them changed
   when ai_vendor flipped, that would be the vendor leaking out of its adapter.
   ══════════════════════════════════════════════════════════════════════════ */
describe('[P2 FULLFLOW] slip / payment / flex are vendor-blind', () => {
  beforeEach(() => {
    posts.length = 0;
    httpPost.mockClear();
  });

  const slipHook = (vendor: string | null) =>
    realHook({
      ai_vendor: vendor,
      image_answer_text: 'รับสลิปแล้วค่ะ',
      slip_check: true,
      slip_verify_key: 'enc:swiftcheck-key',
    });

  const SLIP_OK = {
    slipVerifyResult: {
      success: true,
      data: {
        isDuplicate: false,
        matchedAccount: true,
        amountInSlip: 500,
        rawSlip: {
          date: '2026-08-13 10:00:00',
          transRef: 'TX-P2-1',
          amount: { amount: 500 },
          sender: { bank: { id: '002', name: 'BBL' }, account: {} },
          receiver: { bank: { id: '004', name: 'KBANK' }, account: {} },
        },
      },
    },
    slipRecordId: 'slip-1',
    slipCreatedAt: new Date('2026-08-13T03:00:00Z'),
    slipCondition: null,
    attempted: true,
  };

  it('S1 · a slip on a DEEPSEEK hook verifies exactly as on a gemini one', async () => {
    const ds = buildHarness({
      hook: slipHook('deepseek'),
      slipEnabled: true,
      slipResult: SLIP_OK,
      qrIsSlip: true,
    });
    await ds.postImage();

    const gm = buildHarness({
      hook: slipHook('gemini'),
      slipEnabled: true,
      slipResult: SLIP_OK,
      qrIsSlip: true,
    });
    await gm.postImage();

    // Swiftcheck was asked the same question on both, and the QR pre-scan ran on
    // both — the slip path does not branch on the vendor.
    expect(ds.trace.slipVerifies.length).toBe(gm.trace.slipVerifies.length);
    expect(ds.trace.qrChecks).toBe(gm.trace.qrChecks);
    // ⭐ and no model was called at all: an image never reaches the AI seam here.
    expect(posts).toHaveLength(0);
  });

  it('S2 · the slip callback (topup/walletpay hand-off) fires the same for both vendors', async () => {
    const ds = buildHarness({
      hook: slipHook('deepseek'),
      slipEnabled: true,
      slipResult: SLIP_OK,
      qrIsSlip: true,
    });
    await ds.postImage();
    const gm = buildHarness({
      hook: slipHook('gemini'),
      slipEnabled: true,
      slipResult: SLIP_OK,
      qrIsSlip: true,
    });
    await gm.postImage();

    expect(ds.trace.slipCallbacks.length).toBe(gm.trace.slipCallbacks.length);
    // If a callback fired, the payload it carried must not mention a vendor.
    const payload = JSON.stringify(ds.trace.slipCallbacks);
    expect(payload).not.toContain('deepseek');
  });

  it('S3 · slip OFF on both vendors behaves identically (no Swiftcheck, no model)', async () => {
    const ds = buildHarness({
      hook: realHook({
        ai_vendor: 'deepseek',
        image_answer_text: 'รับรูปแล้ว',
      }),
    });
    await ds.postImage();
    const gm = buildHarness({
      hook: realHook({ ai_vendor: 'gemini', image_answer_text: 'รับรูปแล้ว' }),
    });
    await gm.postImage();

    expect(ds.trace.slipVerifies).toHaveLength(0);
    expect(gm.trace.slipVerifies).toHaveLength(0);
    expect(ds.trace.replies).toEqual(gm.trace.replies);
    expect(posts).toHaveLength(0);
  });

  /* [FIX-20260816-WLOGVENDOR] S4 REPLACED — the rule it enforced was wrong.
   *
   * The old case ("logs stay vendor-neutral") banned `api.deepseek.com` from the
   * rows, but the row was never neutral: it hard-coded `channel: 'gemini'` and a
   * Google URL for EVERY hook. So a DeepSeek OA was filed under Gemini and the
   * dashboard's log-source filter counted it as Gemini — the audit trail named
   * the wrong vendor rather than no vendor.
   *
   * Owner's call (16/08): the row must name the vendor that actually answered,
   * and the Gemini label must stop lying too (it said `/v1/models/` with the ENV
   * model while the call goes to `/v1beta/` with the HOOK's model).
   * เจ้าของสั่ง: log ต้องตรงค่ายที่ตอบจริง ไม่ใช่ปิดชื่อค่ายแล้วเขียน gemini ทับ
   *
   * revert: restore the `not.toContain('api.deepseek.com')` assertion above and
   *         the hard-coded label in webhook.service.ts.
   */
  it('S4 · the AI log row names the vendor that ANSWERED, with its real endpoint', async () => {
    const ds = buildHarness({ hook: realHook({ ai_vendor: 'deepseek' }) });
    armDeepSeekText('ตอบแล้วค่ะ');
    await ds.post('ทดสอบ log');

    const dsRow = ds.trace.logRows.find(
      (r) => r['action_type'] === 'generate_response',
    )!;
    expect(dsRow['channel']).toBe('deepseek');
    // The URL the DeepSeek transport really posts to — model rides in the body,
    // so it is absent here, and the key never appears (DeepSeek uses a header).
    expect(dsRow['endpoint']).toBe('https://api.deepseek.com/chat/completions');
    // Compared against the URL the axios spy actually received — NOT against
    // the label itself, or the assertion would only compare a value to itself.
    expect(String(dsRow['endpoint'])).toBe(String(posts[0]!.url));
  });

  it('S4b · a Gemini hook logs the /v1beta path and the HOOK model, key masked', async () => {
    const gm = buildHarness({
      hook: realHook({ ai_vendor: 'gemini', ai_model: 'gemini-2.5-flash' }),
    });
    armModelText('ตอบแล้วค่ะ');
    await gm.post('ทดสอบ log');

    const row = gm.trace.logRows.find(
      (r) => r['action_type'] === 'generate_response',
    )!;
    expect(row['channel']).toBe('gemini');
    /* Same path + model the transport used. [FEAT-20260908-GEMINIKEYHEADER] the
       comparison is now EXACT rather than "equal up to the key": neither the
       label nor the request URL carries a credential any more, so there is
       nothing left to split on. */
    const label = String(row['endpoint']);
    expect(label).toContain('/v1beta/models/gemini-2.5-flash:generateContent');
    expect(label).toBe(String(posts[0]!.url));
    /* ⚠️ The row is persisted: the live key must never reach it. The key is on
       the header, and the header must never be written into the label. */
    const liveKey = (posts[0]!.config as { headers?: Record<string, string> })
      ?.headers?.['x-goog-api-key'];
    expect(liveKey).toBeTruthy();
    expect(label).not.toContain(String(liveKey));
    expect(label).not.toContain('key=');
  });

  it('S4c · a MISTYPED vendor logs gemini — the row follows the registry, not the field', async () => {
    /* The hook field is free text. `resolveReplyTransport` falls back to the
     * default on an unknown name, so Gemini is what answers. A row that echoed
     * `hook.ai_vendor` would invent a vendor that never ran. */
    const typo = buildHarness({ hook: realHook({ ai_vendor: 'deepsek' }) });
    armModelText('ตอบแล้วค่ะ');
    await typo.post('ทดสอบ log');

    const row = typo.trace.logRows.find(
      (r) => r['action_type'] === 'generate_response',
    )!;
    expect(row['channel']).toBe('gemini');
    expect(String(row['endpoint'])).toContain(
      'generativelanguage.googleapis.com',
    );
    expect(String(posts[0]!.url)).toContain(
      'generativelanguage.googleapis.com',
    );
  });
});

/**
 * [TEST-20260813-P2-KEYFALLBACK] The Gemini env key must not reach a DeepSeek OA.
 *
 * ⚠️ This case exists because the unit tests were green while production leaked.
 *    `resolveVendorKey` refuses correctly when called directly, but
 *    webhook.service.ts used to apply the env fallback BEFORE the vendor was
 *    known, so the provider received a non-empty key and never reached the rule.
 *    Every earlier test called the resolver or the transport itself, so the
 *    substitution site — the service — was never driven. เทสต์เขียวแต่ของจริงรั่ว
 *    เพราะไม่มีใครวิ่งผ่าน service.
 *
 * A probe with a prod-shaped aiConfig produced, before the fix:
 *   URLS: ["https://api.deepseek.com/chat/completions"]
 *   AUTH-HEADER-SEEN: {"Authorization":"Bearer <the Gemini key>"}
 *
 * The key below is a literal fake and axios is mocked process-wide, so nothing
 * leaves the machine and no real credential is ever read.
 */
const FAKE_ENV_GEMINI_KEY = 'AIza-FAKE-NOT-A-REAL-KEY';

describe('[P2 KEY FALLBACK] the env Gemini key is Gemini-only, at the service', () => {
  beforeEach(() => {
    posts.length = 0;
    httpPost.mockClear();
  });

  it('⭐ a keyless DeepSeek hook sends NOTHING rather than borrowing Google key', async () => {
    const { trace, post } = buildHarness({
      hook: realHook({ ai_vendor: 'deepseek', custom_ai_key_sec: '' }),
      envGeminiKey: FAKE_ENV_GEMINI_KEY,
    });
    await post('ทดสอบ');

    // No outbound call at all: the refusal happens before any transport runs.
    expect(posts).toHaveLength(0);
    // Belt and braces — if a call ever does escape, it must not carry the key.
    expect(JSON.stringify(httpPost.mock.calls)).not.toContain(
      FAKE_ENV_GEMINI_KEY,
    );
    // The customer still gets the ordinary AI-unavailable reply, not silence.
    expect(trace.replies.length).toBeGreaterThan(0);
  });

  it('a keyless GEMINI hook still uses the env key — the fallback is not removed', async () => {
    /* ⚠️ The ladder is read from `process.env` by `resolveVendorEnvKey`, NOT from
       the injected `aiConfig`. Both carry the same variable in production
       (`app.config.ts:126` is `env().GEMINI_API_KEY`), but the harness clears the
       env in its beforeAll, so a case exercising the fallback must set the env —
       injecting aiConfig alone proves nothing. ต้องเซ็ตช่องที่โค้ดอ่านจริง. */
    const saved = process.env['GEMINI_API_KEY'];
    process.env['GEMINI_API_KEY'] = FAKE_ENV_GEMINI_KEY;
    try {
      const { post } = buildHarness({
        hook: realHook({ ai_vendor: 'gemini', custom_ai_key: '' }),
        envGeminiKey: FAKE_ENV_GEMINI_KEY,
      });
      armModelText('ตอบแล้วค่ะ');
      await post('ทดสอบ');

      expect(posts).toHaveLength(1);
      expect(posts[0]?.url).toContain('generativelanguage.googleapis.com');
    } finally {
      if (saved === undefined) delete process.env['GEMINI_API_KEY'];
      else process.env['GEMINI_API_KEY'] = saved;
    }
  });

  it('⭐ and the SAME env key set, a keyless DeepSeek hook still refuses', async () => {
    // The pair that matters: one env value, two vendors, opposite outcomes.
    const saved = process.env['GEMINI_API_KEY'];
    process.env['GEMINI_API_KEY'] = FAKE_ENV_GEMINI_KEY;
    try {
      const { post } = buildHarness({
        hook: realHook({ ai_vendor: 'deepseek', custom_ai_key_sec: '' }),
        envGeminiKey: FAKE_ENV_GEMINI_KEY,
      });
      await post('ทดสอบ');

      expect(posts).toHaveLength(0);
      expect(JSON.stringify(httpPost.mock.calls)).not.toContain(
        FAKE_ENV_GEMINI_KEY,
      );
    } finally {
      if (saved === undefined) delete process.env['GEMINI_API_KEY'];
      else process.env['GEMINI_API_KEY'] = saved;
    }
  });

  it('🔴 a DeepSeek hook holding ONLY a Gemini key refuses — a key cannot cross columns', async () => {
    /* [FEAT-20260904-VENDORSECCOL] THE case the column split exists for, and it
       did not exist before: while both vendors read `custom_ai_key`, this hook
       ANSWERED — Google's credential was posted to api.deepseek.com for a 401
       nobody could explain from the log. The key now lives in a column that says
       whose it is, so DeepSeek simply has none and refuses up front.
       คีย์ gemini อยู่คอลัมน์ gemini · deepseek ไม่มีคีย์ = ปฏิเสธ ไม่ใช่ยืม */
    const { trace, post } = buildHarness({
      hook: realHook({
        ai_vendor: 'deepseek',
        custom_ai_key: 'GEMINI-KEY-THAT-MUST-NOT-TRAVEL',
        custom_ai_key_sec: '',
      }),
    });
    await post('ยอดเท่าไหร่');

    expect(posts).toHaveLength(0);
    expect(JSON.stringify(httpPost.mock.calls)).not.toContain(
      'GEMINI-KEY-THAT-MUST-NOT-TRAVEL',
    );
    // The customer still gets the hook's generative-error copy, not silence.
    expect(trace.replies.join(' ')).toContain('AI ล่มชั่วคราว');
  });

  it('a DeepSeek hook WITH its own key uses that key, never the env one', async () => {
    const { post } = buildHarness({
      hook: realHook({
        ai_vendor: 'deepseek',
        custom_ai_key_sec: 'ds-own-key',
      }),
      envGeminiKey: FAKE_ENV_GEMINI_KEY,
    });
    armDeepSeekText('ตอบแล้วค่ะ');
    await post('ทดสอบ');

    expect(posts[0]?.url).toContain('api.deepseek.com');
    expect(JSON.stringify(httpPost.mock.calls)).not.toContain(
      FAKE_ENV_GEMINI_KEY,
    );
  });
});

/**
 * [TEST-20260813-P2-DOCRETRIEVAL] Which key the Training-Doc path receives.
 *
 * ⚠️ Retrieval is a SECOND outbound path and it is Gemini-only: the engine puts
 *    the key straight into a `generativelanguage.googleapis.com` URL
 *    (`rag-engine.service.ts:538`). The reply path was fixed to stop handing a
 *    DeepSeek OA the Gemini key; this pins the mirror image — a DeepSeek OA's
 *    own key must not travel to Google here either.
 *    เส้นเอกสารก็ยิง Google เหมือนกัน คีย์ผิดค่ายห้ามหลุดไปทางนี้.
 */
describe('[P2 DOC RETRIEVAL] the Gemini-only path never receives a DeepSeek key', () => {
  it('⭐ a DeepSeek hook does not send its own key to the Google embedding call', async () => {
    const { trace, post } = buildHarness({
      hook: realHook({
        ai_vendor: 'deepseek',
        custom_ai_key_sec: 'DEEPSEEK-OWN-KEY',
        doc_id: 'doc-1',
        doc_retrieval: true, // the seam only runs when the OA opted in
      }),
    });
    armDeepSeekText('ตอบแล้วค่ะ');
    await post('ทดสอบเอกสาร');

    // Whatever retrieval got, it must not be the DeepSeek credential.
    expect(trace.docRetrievalKeys).not.toContain('DEEPSEEK-OWN-KEY');
  });

  it('⭐ the MODEL it asks Google for is the GEMINI one, never the DeepSeek one', async () => {
    /* [FEAT-20260904-VENDORSECCOL] The mirror of the key rule, and it was never
       pinned: this lane builds a `generativelanguage.googleapis.com` URL, so the
       model in it must be a Gemini model. Before the column split a DeepSeek OA
       sent `deepseek-chat` to Google — a model that does not exist there — and
       every case still passed, because only the key was ever asserted on.
       Found by mutation M4 on 04/09. เส้นนี้ยิง Google รุ่นต้องเป็นของ Gemini */
    const { trace, post } = buildHarness({
      hook: realHook({
        ai_vendor: 'deepseek',
        ai_model: 'gemini-2.5-flash', // the OA's Gemini-side model
        ai_model_sec: 'deepseek-reasoner', // what DeepSeek will be asked for
        custom_ai_key_sec: 'DEEPSEEK-OWN-KEY',
        doc_id: 'doc-1',
        doc_retrieval: true,
      }),
    });
    armDeepSeekText('ตอบแล้วค่ะ');
    await post('ทดสอบเอกสาร');

    expect(trace.docRetrievalModels).toContain('gemini-2.5-flash');
    expect(trace.docRetrievalModels).not.toContain('deepseek-reasoner');
  });

  it('a Gemini hook still passes its own key — retrieval is unchanged for them', async () => {
    const { trace, post } = buildHarness({
      hook: realHook({
        ai_vendor: 'gemini',
        custom_ai_key: 'GEMINI-OWN-KEY',
        doc_id: 'doc-1',
        doc_retrieval: true,
      }),
    });
    armModelText('ตอบแล้วค่ะ');
    await post('ทดสอบเอกสาร');

    expect(trace.docRetrievalKeys).toContain('GEMINI-OWN-KEY');
  });
});

/**
 * [TEST-20260813-P2-PAYMENT] The payment / topup hand-off across both vendors.
 *
 * S1-S4 proved the slip VERIFY path and the callback are vendor-neutral, but the
 * runner itself was never driven: the harness passed `undefined` for it, so
 * `runForSlip` — the topup/walletpay hand-off — never ran in any case. A vendor
 * swap could have broken it and every test would still have been green.
 * ต้องขับ runner จริง ไม่ใช่แค่ callback.
 *
 * NO REAL AI: the model is never asked on the image path, and axios stays
 * mocked throughout.
 */
describe('[P2 PAYMENT] topup / walletpay runs the same whichever vendor the OA uses', () => {
  beforeEach(() => {
    posts.length = 0;
    httpPost.mockClear();
  });

  const payHook = (vendor: string | null) =>
    realHook({
      ai_vendor: vendor,
      image_answer_text: 'รับสลิปแล้วค่ะ',
      slip_check: true,
      slip_verify_key: 'enc:swiftcheck-key',
    });

  const PAID = {
    slipVerifyResult: {
      success: true,
      data: {
        isDuplicate: false,
        matchedAccount: true,
        amountInSlip: 500,
        rawSlip: {
          date: '2026-08-13 10:00:00',
          transRef: 'TX-P2-PAY',
          amount: { amount: 500 },
          sender: { bank: { id: '002', name: 'BBL' }, account: {} },
          receiver: { bank: { id: '004', name: 'KBANK' }, account: {} },
        },
      },
    },
    slipRecordId: 'slip-pay-1',
    slipCreatedAt: new Date('2026-08-13T03:00:00Z'),
    slipCondition: null,
    attempted: true,
  };

  const runPayment = async (vendor: string | null) => {
    const h = buildHarness({
      hook: payHook(vendor),
      slipEnabled: true,
      slipResult: PAID,
      qrIsSlip: true,
      paymentEnabled: true,
      paymentTool: { id: 'topup-tool', category: 'payment' },
      paymentResult: {
        ran: true,
        reply: { type: 'text', text: 'เติมเงินสำเร็จ 500 บาท' },
      },
    });
    await h.postImage();
    return h;
  };

  it('⭐ P1 · the topup runner fires for a DeepSeek OA, with the same slip record', async () => {
    const ds = await runPayment('deepseek');
    expect(ds.trace.paymentRuns).toHaveLength(1);
    expect(ds.trace.paymentRuns[0]?.['slipRecordId']).toBe('slip-pay-1');
  });

  it('⭐ P2 · gemini and deepseek hand the runner an IDENTICAL payload', async () => {
    // The runner is downstream of the vendor seam, so the vendor must not reach
    // it at all. Comparing the two payloads is the strongest form of that: any
    // vendor-shaped difference shows up as a diff.
    const ds = await runPayment('deepseek');
    const gm = await runPayment('gemini');

    /* ⚠️ NOT asserting that the payload lacks the string "deepseek": the runner
       receives the whole hook row, so `ai_vendor` is naturally in there and its
       presence is not a leak. What matters is that everything the runner ACTS
       on is identical between the two — compare the payload with only that one
       field normalised away. เทียบทุกอย่างยกเว้นตัวที่ต่างโดยนิยาม. */
    const normalise = (runs: Array<Record<string, unknown>>) =>
      JSON.stringify(runs).split('"deepseek"').join('"gemini"');
    expect(normalise(ds.trace.paymentRuns)).toBe(
      normalise(gm.trace.paymentRuns),
    );
    expect(ds.trace.paymentRuns[0]?.['slipRecordId']).toBe('slip-pay-1');
  });

  it('P3 · the payment reply reaches the customer on a DeepSeek OA', async () => {
    const ds = await runPayment('deepseek');
    expect(ds.trace.replies.join(' ')).toContain('เติมเงินสำเร็จ');
  });

  it('P4 · payment absent ⇒ the slip flow behaves exactly as before (no-op seam)', async () => {
    // The default every other case in this file assumes: no runner injected.
    const ds = buildHarness({
      hook: payHook('deepseek'),
      slipEnabled: true,
      slipResult: PAID,
      qrIsSlip: true,
    });
    await ds.postImage();
    expect(ds.trace.paymentRuns).toHaveLength(0);
    // and the customer is still answered by the legacy card path
    expect(ds.trace.slipVerifies.length).toBeGreaterThan(0);
  });

  it('P5 · a runner that declines (ran:false) still lets the legacy card answer', async () => {
    const ds = buildHarness({
      hook: payHook('deepseek'),
      slipEnabled: true,
      slipResult: PAID,
      qrIsSlip: true,
      paymentEnabled: true,
      paymentResult: { ran: false, reply: null },
    });
    await ds.postImage();
    expect(ds.trace.paymentRuns).toHaveLength(1);
    expect(ds.trace.slipVerifies.length).toBeGreaterThan(0);
  });

  it('P6 · NO model call happens anywhere on the payment path, for either vendor', async () => {
    posts.length = 0;
    httpPost.mockClear();
    await runPayment('deepseek');
    await runPayment('gemini');
    // The image/slip/payment path must never bill a vendor.
    expect(posts).toHaveLength(0);
  });
});

/* ==========================================================================
 * [FEAT-20260830-AIRETRY] + [FEAT-20260830-REPLYPUSH] — through the WHOLE pipe
 *
 * The unit spec proves the two rules in isolation. These drive them through the
 * real webhook: real RagEngineService, real GeminiReplyProvider, real funnel,
 * real dynamic-tag substitution, real interpreter, real send. What the owner
 * asked to see is that nothing ELSE moved — the dyntag values, the flex card,
 * the not-found line and the payment/slip seams are asserted here and in the
 * describes above, all on the same harness.
 * ======================================================================== */
describe('[FEAT-20260830-AIRETRY] retry, driven through the real pipeline', () => {
  it('R1 · a first-attempt timeout is retried and the customer gets the REAL answer', async () => {
    armModelTimeout();
    armModelText('ยอดของคุณคือ 100 บาท [[[FOUND]]]');
    const { trace, post } = buildHarness();
    await post('ยอดเท่าไหร่');

    expect(posts).toHaveLength(2); // two model calls, one turn
    expect(trace.replies).toEqual(['ยอดของคุณคือ 100 บาท']);
    expect(trace.sendKinds).toEqual(['reply']); // one delivery, no push
  });

  it('R2 · ⭐⭐ the retry sends the SAME prompt — dyntag values are not re-rolled', async () => {
    /* The tag is substituted BEFORE the transport, so a retry must not produce a
       second, different prompt. If the substitution ever moved below the retry,
       the two bodies would differ and this goes red. */
    armModelTimeout();
    armModelText('ok [[[FOUND]]]');
    const { post } = buildHarness();
    await post('ยอดเท่าไหร่');

    expect(posts).toHaveLength(2);
    expect(JSON.stringify(posts[1]!.body)).toBe(JSON.stringify(posts[0]!.body));
    expect(JSON.stringify(posts[1]!.body)).toContain('AB9-REAL');
  });

  it('R3 · both attempts time out → the generative-error text, unchanged', async () => {
    armModelTimeout();
    armModelTimeout();
    const { trace, post } = buildHarness();
    await post('AI ล่มอยู่ไหม');

    expect(posts).toHaveLength(2);
    expect(trace.replies).toEqual(['AI ล่มชั่วคราว ลองใหม่อีกครั้งนะคะ']);
  });

  it('R4 · a NON-timeout failure is still one call — F5 behaviour is untouched', async () => {
    // un-armed ⇒ the harness default rejects with a plain error, not a timeout
    const { trace, post } = buildHarness();
    await post('AI ล่มอยู่ไหม');

    expect(posts).toHaveLength(1);
    expect(trace.replies).toEqual(['AI ล่มชั่วคราว ลองใหม่อีกครั้งนะคะ']);
  });

  it('R5 · a successful first attempt never fires a second — the 99.6% path', async () => {
    armModelText('สวัสดีค่ะ [[[FOUND]]]');
    const { trace, post } = buildHarness();
    await post('สวัสดี');

    expect(posts).toHaveLength(1);
    expect(trace.replies).toEqual(['สวัสดีค่ะ']);
  });
});

describe('[FEAT-20260830-REPLYPUSH] the send ladder, driven through the real pipeline', () => {
  it('P1 · ⭐⭐⭐ LINE refuses the reply token → the SAME answer goes out as a push', async () => {
    armModelText('ยอดของคุณคือ 100 บาท [[[FOUND]]]');
    const { trace, post } = buildHarness({ replyRefused: true });
    await post('ยอดเท่าไหร่');

    expect(trace.sendKinds).toEqual(['reply', 'push']);
    // the customer is not left with nothing, and the text is identical
    expect(trace.replies).toEqual([
      'ยอดของคุณคือ 100 บาท',
      'ยอดของคุณคือ 100 บาท',
    ]);
  });

  it('P2 · the log row names the leg that actually delivered it', async () => {
    armModelText('คำตอบ [[[FOUND]]]');
    const { trace, post } = buildHarness({ replyRefused: true });
    await post('ถาม');

    const sendRows = trace.logRows.filter(
      (r) =>
        r['action_type'] === 'line_reply' ||
        r['action_type'] === 'push_message',
    );
    expect(sendRows.map((r) => r['action_type'])).toContain('push_message');
  });

  it('P3 · a reply that SUCCEEDS never triggers a push — no extra LINE call', async () => {
    armModelText('คำตอบ [[[FOUND]]]');
    const { trace, post } = buildHarness();
    await post('ถาม');

    expect(trace.sendKinds).toEqual(['reply']);
  });

  it('P4 · a FLEX answer takes the ladder too — the card is not lost', async () => {
    armModelText('ดูข้อมูลของคุณได้เลย [[[flex_profile]]] [[[FOUND]]]');
    const { trace, post } = buildHarness({ replyRefused: true });
    await post('ขอดูโปรไฟล์');

    // whichever shape the pipeline chose, it was attempted on BOTH legs
    expect(trace.sendKinds[0]).toBe('reply');
    expect(trace.sendKinds).toContain('push');
  });

  it('P5 · retry AND ladder together: timeout → retry → refused reply → push', async () => {
    armModelTimeout();
    armModelText('คำตอบหลัง retry [[[FOUND]]]');
    const { trace, post } = buildHarness({ replyRefused: true });
    await post('ยอดเท่าไหร่');

    expect(posts).toHaveLength(2);
    expect(trace.sendKinds).toEqual(['reply', 'push']);
    expect(trace.replies).toEqual(['คำตอบหลัง retry', 'คำตอบหลัง retry']);
  });
});
