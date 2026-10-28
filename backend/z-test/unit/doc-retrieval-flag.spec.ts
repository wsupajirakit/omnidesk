import { createHmac } from 'node:crypto';

/* eslint-disable no-restricted-imports -- [FEAT-20261026-RAGENGINE] the engine's internals are
   assembled by hand here so the real engine runs on this harness without Mongo or AI */
import { RagIndexService } from '@/modules/rag/indexing/rag-index.service';
import type { RagVectorStore } from '@/modules/rag/ports/vector-store.port';
import { RagRetrievalService } from '@/modules/rag/rag-retrieval.service';
/* eslint-enable no-restricted-imports */
import {
  AssistSummaryUnavailableError,
  type AiReplyRequest,
  type DocRetrievalRequest,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';

/**
 * ==== [FEAT-20260810-DOCRETRIEVAL] the flag, driven through the real pipeline ====
 *
 * `doc-retrieval-baseline.spec.ts` pins the OFF path (and had to survive this
 * feature untouched). This file pins what the flag ADDS: the seam runs only when
 * an OA opted in, it receives what the pipeline actually knows, and it can fail
 * in every way without costing the customer an answer.
 *
 * ⚠️ FLOW TEST: the real `WebhookService.processWebhook()` with a real
 * HMAC-signed body. The retrieval seam is a RECORDER — it captures the request
 * the pipeline hands it and returns a canned passage, so nothing is billed and
 * the assertions are about the pipeline's real decisions.
 */

const CHANNEL_SECRET = 'docflag-channel-secret';
const HOOK_ID = 'a0d000000000000000000014';
const USER_ID = 'Udocf0000000000000000000000000001';
const DOC_ID = 'doc-id-under-test';
const PASSAGE = 'ร้านเปิด 9 โมงถึง 3 ทุ่มทุกวัน';

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

const LINKED_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'สมชาย ทดสอบ', customer_tel: '0800000000' },
    },
  },
};

interface Opts {
  hook?: Record<string, unknown>;
  /** What the seam returns. Default: a passage. */
  retrieve?: (req: DocRetrievalRequest) => Promise<string>;
  /** Omit the provider entirely — the unbound case. */
  noProvider?: boolean;
  ignoreDocId?: string;
  /** [FEAT-20261026-RAGENGINE] bind THIS provider (e.g. the real RAG engine) instead of the passage stub. */
  provider?: {
    retrieve: (req: DocRetrievalRequest) => Promise<string>;
    retrieveContext?: (
      req: DocRetrievalRequest,
    ) => Promise<{ docText: string; suggestionOverride?: string | null }>;
  };
}

function buildHarness(opts: Opts = {}): {
  aiRequests: AiReplyRequest[];
  docRequests: DocRetrievalRequest[];
  post: (events: unknown[]) => Promise<void>;
} {
  const hook: Record<string, unknown> = {
    _id: HOOK_ID,
    alias: 'docflag',
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'docflag-dead-token',
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
    custom_tool_id: 'tool-1',
    doc_id: DOC_ID,
    ...opts.hook,
  };

  const aiRequests: AiReplyRequest[] = [];
  const docRequests: DocRetrievalRequest[] = [];

  const passthrough = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'x' }),
    updateOne: () => query({ acknowledged: true }),
    findById: () => query(null),
    countDocuments: () => query(0),
  };

  const docProvider = opts.provider
    ? {
        retrieve: (req: DocRetrievalRequest) => {
          docRequests.push(req);
          return opts.provider!.retrieve(req);
        },
        ...(opts.provider.retrieveContext && {
          retrieveContext: (req: DocRetrievalRequest) => {
            docRequests.push(req);
            return opts.provider!.retrieveContext!(req);
          },
        }),
      }
    : {
        retrieve: (req: DocRetrievalRequest) => {
          docRequests.push(req);
          return opts.retrieve ? opts.retrieve(req) : Promise.resolve(PASSAGE);
        },
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
        return Promise.resolve({ text: 'ok', noData: false, tagStatus: null });
      },
    },
    { summarise: () => Promise.reject(new AssistSummaryUnavailableError()) },
    { getConfigByKey: () => Promise.resolve(null) } as never,
    { telegramWebhookSecret: undefined, multiEventDelivery: false },
    { geminiApiKey: undefined, modelId: 'gemini-3.5-flash' } as never,
    { ignoreDocId: opts.ignoreDocId } as never,
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
    // ⚠️ POSITION MATTERS — the three optional tail params, in order:
    //    configCacheInvalidator, paymentRunner, docRetrievalProvider.
    //    Getting this wrong binds the seam to the wrong slot and it is simply
    //    never called, with no error to show for it.
    undefined, // configCacheInvalidator
    undefined, // paymentRunner — not part of this path
    opts.noProvider ? undefined : docProvider,
  );

  const post = async (events: unknown[]): Promise<void> => {
    const body = { destination: 'Udocf', events };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: '/docflag/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(body, hook, 'cache', 'docflag', meta);
  };

  return { aiRequests, docRequests, post };
}

function textEvent(text: string): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-docf',
    replyToken: 'rt-docf',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'm1', text },
  };
}

describe('[FEAT-20260810-DOCRETRIEVAL] the per-hook retrieval flag', () => {
  it('flag ON: the retrieved passage becomes the docText the model receives', async () => {
    const { aiRequests, docRequests, post } = buildHarness({
      hook: { doc_retrieval: true },
    });
    await post([textEvent('ร้านเปิดกี่โมง')]);

    expect(docRequests).toHaveLength(1);
    expect(aiRequests[0]!.docText).toBe(PASSAGE);
  });

  it('flag OFF: the seam is never called and docText stays empty', async () => {
    const { aiRequests, docRequests, post } = buildHarness({
      hook: { doc_retrieval: false },
    });
    await post([textEvent('ร้านเปิดกี่โมง')]);

    expect(docRequests).toEqual([]);
    expect(aiRequests[0]!.docText).toBe('');
  });

  it('flag ABSENT (every existing hook): identical to OFF — no call, no cost', async () => {
    // The seamless guarantee: a row that predates the field must behave exactly
    // as it did before the feature existed.
    const { aiRequests, docRequests, post } = buildHarness();
    await post([textEvent('ร้านเปิดกี่โมง')]);

    expect(docRequests).toEqual([]);
    expect(aiRequests[0]!.docText).toBe('');
  });

  it('the seam receives the question and doc id the pipeline resolved', async () => {
    const { docRequests, post } = buildHarness({
      hook: { doc_retrieval: true },
    });
    await post([textEvent('เปิดกี่โมงครับ')]);

    expect(docRequests[0]!.question).toBe('เปิดกี่โมงครับ');
    expect(docRequests[0]!.docId).toBe(DOC_ID);
  });

  it("the seam receives the OA's own model knobs, not global defaults", async () => {
    const { docRequests, post } = buildHarness({
      hook: {
        doc_retrieval: true,
        fast_mode: 2,
        gemini_temperature: 0.7,
        gemini_top_k: 5,
        gemini_top_p: 0.9,
      },
    });
    await post([textEvent('ถามหน่อย')]);

    expect(docRequests[0]!.fastMode).toBe(2);
    expect(docRequests[0]!.temperature).toBe(0.7);
    expect(docRequests[0]!.topK).toBe(5);
    expect(docRequests[0]!.topP).toBe(0.9);
  });

  /* [FEAT-20260826-DOCMODEL] เจ้าของ 26/08: "ปรับให้มันใช้ hook.ai_model
     ถ้าไม่มีค่อย fallback MODEL_ID env"
     🔴 ชั้นนี้คือชั้นที่บั๊กอยู่จริง: ตัวแปลงในเอนจินคิดถูกอย่างเดียวไม่พอ
        ถ้า webhook ไม่ได้หยิบค่าจาก hook ส่งเข้ามา เอนจินก็ตกไปใช้ของกลางเงียบ ๆ
     คู่กับ `doc-retrieval-model.spec.ts` ที่พิสูจน์ฝั่งเอนจิน (URL) */
  it("the seam receives the OA's own ai_model, not the system default", async () => {
    const { docRequests, post } = buildHarness({
      hook: { doc_retrieval: true, ai_model: 'gemini-3.6-flash' },
    });
    await post([textEvent('ถามหน่อย')]);

    expect(docRequests[0]!.modelId).toBe('gemini-3.6-flash');
  });

  it('OA ที่ไม่ได้เลือกรุ่น ⇒ ไม่ส่งอะไรมา แล้วปลายทางตกไป MODEL_ID เอง', async () => {
    /* 29/29 hook ในฐานเป็นแบบนี้ = เส้นที่ของจริงวิ่งอยู่วันนี้ ห้ามเปลี่ยน */
    const { docRequests, post } = buildHarness({
      hook: { doc_retrieval: true },
    });
    await post([textEvent('ถามหน่อย')]);

    expect(docRequests[0]!.modelId ?? null).toBeNull();
  });

  // ── FALLBACK: retrieval is an enhancement, never a dependency ──────────────

  it('FALLBACK a rejected retrieval still answers the customer', async () => {
    const { aiRequests, post } = buildHarness({
      hook: { doc_retrieval: true },
      retrieve: () => Promise.reject(new Error('google docs is down')),
    });

    // The throw must not escape the reply path…
    await expect(post([textEvent('ถามตอนระบบล่ม')])).resolves.toBeUndefined();
    // …and the model is still asked, with empty context.
    expect(aiRequests).toHaveLength(1);
    expect(aiRequests[0]!.docText).toBe('');
  });

  it('FALLBACK an empty passage is passed through as empty context', async () => {
    const { aiRequests, post } = buildHarness({
      hook: { doc_retrieval: true },
      retrieve: () => Promise.resolve(''),
    });
    await post([textEvent('ไม่มีอะไรตรง')]);

    expect(aiRequests[0]!.docText).toBe('');
  });

  it('FALLBACK no provider bound at all: empty context, no crash', async () => {
    const { aiRequests, post } = buildHarness({
      hook: { doc_retrieval: true },
      noProvider: true,
    });
    await post([textEvent('provider ไม่ได้ผูก')]);

    expect(aiRequests).toHaveLength(1);
    expect(aiRequests[0]!.docText).toBe('');
  });

  /* [FEAT-20261026-RAGENGINE] FLIPPED 26/10 — the two cases below used to pin "no doc_id ⇒ no
     seam call" and "IGNORE_DOC_ID=1 ⇒ no seam call". The owner moved the source of retrieval to
     the Training Doc boxes (the text every OA already has), so a `doc_id` is no longer needed
     and `IGNORE_DOC_ID` — the retired Google-Doc lane's switch — no longer gates it. The
     engine's fleet-wide switch is in code (`rag/rag.config.ts` `engineEnabled`).
     Plan: todo/task/26102026/be_todo1_26102026_rag-engine-overhaul_demo.md
     เจ้าของเปลี่ยนแหล่งเป็น Training Doc — ไม่ต้องมี doc_id · IGNORE_DOC_ID ไม่คุมเส้นนี้แล้ว */
  it('a hook with the flag ON but NO doc_id DOES call the seam (source = Training Doc)', async () => {
    const { aiRequests, docRequests, post } = buildHarness({
      hook: {
        doc_retrieval: true,
        doc_id: '',
        suggestion_text: 'ร้านเปิด 10 โมง',
      },
    });
    await post([textEvent('ไม่มีเอกสาร')]);

    expect(docRequests).toHaveLength(1);
    expect(docRequests[0]!.sections).toEqual([
      {
        start: '[START_OF_BASIC_INFO]',
        end: '[END_OF_BASIC_INFO]',
        text: 'ร้านเปิด 10 โมง',
      },
    ]);
    expect(aiRequests[0]!.docText).toBe(PASSAGE);
  });

  it('IGNORE_DOC_ID=1 no longer gates retrieval — the flag alone decides', async () => {
    const { aiRequests, docRequests, post } = buildHarness({
      hook: { doc_retrieval: true },
      ignoreDocId: '1',
    });
    await post([textEvent('ปิดทั้งระบบ')]);

    expect(docRequests).toHaveLength(1);
    expect(aiRequests[0]!.docText).toBe(PASSAGE);
  });
});

/* [FEAT-20261026-RAGENGINE] the RAG engine through the REAL webhook ladder — no AI, no network:
   the engine runs bm25 with an in-memory store and no embedder. */
describe('[FEAT-20261026-RAGENGINE] RAG engine on the live ladder', () => {
  const NO_STORE: RagVectorStore = {
    load: () => Promise.resolve(new Map()),
    replace: () => Promise.resolve(),
  };
  const engine = () =>
    new RagRetrievalService(new RagIndexService(NO_STORE, null));
  const TRAINING = {
    suggestion_text: [
      'คุณคือแอดมินร้าน ตอบสุภาพ',
      '',
      'เวลาทำการ:',
      'ร้านเปิดทุกวันจันทร์ถึงศุกร์ 10:00-19:00 น.',
      '',
      'สินเชื่อ:',
      'สมัครสินเชื่อใช้บัตรประชาชนใบเดียว อนุมัติไวภายใน 30 นาที',
    ].join('\n'),
    suggestion_company_text: 'ที่อยู่สาขา:\nสาขาบางนา ชั้น 2',
  };

  it('🔴 PIN engine bound but flag OFF ⇒ the prompt is byte-identical to no engine at all', async () => {
    const withEngine = buildHarness({
      hook: { ...TRAINING, doc_retrieval: false },
      provider: engine(),
    });
    const without = buildHarness({
      hook: { ...TRAINING, doc_retrieval: false },
      noProvider: true,
    });
    await withEngine.post([textEvent('ร้านเปิดกี่โมง')]);
    await without.post([textEvent('ร้านเปิดกี่โมง')]);
    expect(withEngine.docRequests).toEqual([]);
    // clock lines may tick between the two runs
    const strip = (t: unknown) =>
      String(t).replace(/\d{1,2}:\d{2}(:\d{2})?/g, '<t>');
    expect(strip(withEngine.aiRequests[0]!.suggestionText)).toBe(
      strip(without.aiRequests[0]!.suggestionText),
    );
    expect(withEngine.aiRequests[0]!.docText).toBe('');
  });

  it('⭐ add ⇒ the passage reaches docText, the Training Doc stays whole', async () => {
    const h = buildHarness({
      hook: { ...TRAINING, doc_retrieval: true },
      provider: engine(),
    });
    await h.post([textEvent('ร้านเปิดกี่โมงครับ')]);
    const req = h.aiRequests[0]!;
    expect(req.docText).toContain('10:00-19:00');
    expect(req.docText).not.toContain('อนุมัติไว');
    expect(String(req.suggestionText)).toContain('อนุมัติไว'); // full doc untouched
    expect(String(req.suggestionText)).toContain('สาขาบางนา');
  });

  it('⭐ replace ⇒ the reduced Training Doc stands in for the full one', async () => {
    const h = buildHarness({
      hook: { ...TRAINING, doc_retrieval: true, rag_prompt_mode: 'replace' },
      provider: engine(),
    });
    await h.post([textEvent('ร้านเปิดกี่โมงครับ')]);
    const req = h.aiRequests[0]!;
    const sug = String(req.suggestionText);
    expect(req.docText).toBe('');
    expect(sug).toContain('[START_OF_BASIC_INFO]');
    expect(sug).toContain('คุณคือแอดมินร้าน'); // pinned preamble
    expect(sug).toContain('10:00-19:00'); // retrieved
    expect(sug).not.toContain('อนุมัติไว'); // not relevant ⇒ left out
    expect(sug).not.toContain('สาขาบางนา');
  });

  it('replace but nothing relevant ⇒ the full Training Doc, exactly as without the engine', async () => {
    const h = buildHarness({
      hook: { ...TRAINING, doc_retrieval: true, rag_prompt_mode: 'replace' },
      provider: engine(),
    });
    await h.post([textEvent('quantum chromodynamics')]);
    const sug = String(h.aiRequests[0]!.suggestionText);
    expect(sug).toContain('อนุมัติไว');
    expect(sug).toContain('สาขาบางนา');
  });
});
