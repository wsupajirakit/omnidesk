import { createHmac } from 'node:crypto';

import { Logger } from '@nestjs/common';
import axios from 'axios';

import {
  AiProviderUnavailableError,
  AssistSummaryUnavailableError,
  type AiReplyRequest,
  type AiReplyResponse,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';

import {
  DEFAULT_CUSTOMER_PROVIDER,
  bindActiveProvider,
  buildCustomerProviderRegistry,
  resetActiveProvider,
} from '@/modules/customer-provider';
import { CustomToolService } from '@/modules/external';

import { freezeLogRows, settleLogWrites } from '../lib/freeze-log-rows';
import { LOAN_FIXTURE, LOAN_TOOL, loanCombined } from '../lib/loan-v1-upstream';

/* [FLOWTEST-20261014-LOANV1FLOW] the real extractor, detached from DI (it is pure). */
const REAL_TOOL = Object.create(
  CustomToolService.prototype,
) as CustomToolService;

/* [FIX-20260815-IMGTAGDEAD] The carousel branch posts to LINE with RAW axios
   (webhook.service.ts:3770) instead of going through `lineApi`, because its
   payload is a message ARRAY that the helper cannot wrap. Without this mock a
   carousel case would make a REAL network call to api.line.me.
   Safe for every other case in this file: `axios.post` appears exactly once in
   webhook.service.ts, and slip-flex.handler imports only the AxiosResponse TYPE
   and sends through the injected `deps.sendLineFlexReply`. Verified by grep
   before mocking. */
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * ==== [TEST-20260810-FLOWMATRIX] webhook end-to-end, สองเคส เคสละ 10 แบบ ====
 *
 * เจ้าของสั่ง: "test webhook be แบบจริงจัง · flow test แบบจริงไม่ใช่ดูแค่เครื่องมือเทส"
 *
 * ⚠️ WHAT MAKES THIS A FLOW TEST, NOT A UNIT TEST
 * Every case below calls the REAL `WebhookService.processWebhook` with a real
 * signed body, and runs the whole 2,600-line pipeline: signature → hook resolve
 * → rate limit → assist gate → profile fetch → chat log → slip/QR → AI → reply
 * tags → flex build → LINE send → history rewrite. Nothing is stubbed INSIDE
 * that path. What is faked is only the OUTSIDE WORLD — Mongo, Redis, LINE,
 * Swiftcheck, Gemini — and each fake RECORDS what it was asked to do, so the
 * assertions are about the pipeline's real decisions and their ORDER.
 *
 * ⚠️ NOTHING IS BILLED AND NOTHING REACHES A PERSON. `aiReply.generate` rejects
 * unless a case stages a scripted answer; the LINE access token is dead; the
 * Swiftcheck and Gemini seams return canned values and record the call.
 *
 * ⚠️ These are CHARACTERISATION tests: they pin what the pipeline does TODAY, so
 * a future edit that changes it fails here instead of in production. Where the
 * current behaviour is arguably wrong, the case says so rather than asserting a
 * behaviour the code does not have.
 *
 * เคส A = dynamic tag + flex + profile + site rules · เคส B = slip + topup + walletpay
 * รวม 20 แบบ ไม่ซ้ำกัน — สลับชนิด event/สถานะทุกแบบตามที่เจ้าของสั่ง.
 */

const CHANNEL_SECRET = 'flowmatrix-channel-secret';
const HOOK_ID = 'a0d000000000000000000014';
// [FEAT-20260901-OBJSCOPE] A real ObjectId: the scope filter refuses anything else.
const GROUP_ID = 'a0d000000000000000000092';
/* [FIX-20260901-MENUKINDMISSING] the marker an operator pastes into a hook
   fallback field, copied from the Flex page. */
const MENU_MARKER = '[[[menu_main_00010]]]';
/* [FIX-20260901-MENUKINDMISSING] a stored menu card the marker can resolve to.
   Every field is load-bearing — `stored-card.renderer.ts:207-221` refuses on a
   missing one and the reply silently degrades to no card at all:
     flex_type 'menu'  — the type the tag door pins (`menu-engine.service.ts:147`)
     content_json      — a card with no bubble is 'empty-content'
     group_ids         — must CONTAIN the hook's `group`, or it is 'other-group',
                         which is the cross-OA guard and must stay enforced here. */
const MENU_CARD = {
  flex_type: 'menu',
  flex_sub_type: 'main',
  name: 'เมนู หลัก',
  group_ids: [GROUP_ID],
  content_json: {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: 'เลือกเมนู' }],
    },
  },
};
const USER_ID = 'Uflow0000000000000000000000000001';

interface Trace {
  steps: string[];
  aiRequests: AiReplyRequest[];
  replies: string[];
  flexReplies: Array<{ altText: string; contents: unknown }>;
  /* [FEAT-20260901-OBJSCOPE] Every filter the album lookup was called with, in
     order. Empty means the lookup never ran — which is itself an outcome worth
     asserting, since an unidentifiable OA must skip it rather than run unscoped. */
  objImageFilters: unknown[];
  chatRows: Array<Record<string, unknown>>;
  /** [FIX-20260901-MENUKINDMISSING] what the menu card source was ASKED for. */
  menuCardQueries: Array<Record<string, unknown>>;
  chatUpdates: Array<{ filter: unknown; update: Record<string, unknown> }>;
  slipVerifyInputs: Array<Record<string, unknown>>;
  slipCallbacks: Array<Record<string, unknown>>;
  externalCalls: Array<Record<string, unknown>>;
  logRows: Array<Record<string, unknown>>;
}

/** Chainable Mongoose query stub — every method returns itself, then resolves. */
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

interface Opts {
  hook?: Record<string, unknown>;
  room?: Record<string, unknown> | null;
  profileData?: Record<string, unknown>;
  aiReplyText?: string;
  flexProfileDoc?: Record<string, unknown> | null;
  flexDoc?: Record<string, unknown> | null;
  slipVerifyResult?: Record<string, unknown>;
  qrIsSlip?: boolean;
  withImageStorage?: boolean;
  rateLimited?: boolean;
  /** [RULER] the ObjectImage a `[[[img_*]]]` tag resolves to. */
  objImage?: Record<string, unknown> | null;
  /** [RULER] the ImageStorage rows that object owns. */
  imageStorages?: Array<Record<string, unknown>>;
  /** [RULER] the AI turn's tag status — `'not_found'` opens the Telegram branch. */
  tagStatus?: AiReplyResponse['tagStatus'];
  /** [DOOR] make every webhook_logs write reject, as Mongoose does on a bad enum. */
  logWriteFails?: boolean;
  /* [FIX-20260901-MENUKINDMISSING] the stored card a `[[[menu_*]]]` tag resolves
     to. OMITTED BY DEFAULT ON PURPOSE: absent means the service is built with NO
     menu source at all, which is how every case above already builds it. The
     postback seat (`webhook.service.ts:1977`) gates on this same dependency, so
     handing a source to every case would change what a postback event does — a
     behaviour change smuggled in through a fixture. */
  menuCard?: Record<string, unknown> | null;
  /* [FLOWTEST-20261014-LOANV1FLOW] OPT-IN: the hook's custom tool and what its real engine
     answered (`z-test/lib/loan-v1-upstream.ts`). Absent = the stub every case above uses. */
  customTool?: { tool: unknown; combined: Record<string, unknown> };
  /* [FEAT-20261019-CALLBACKLINEPROFILE] OPT-IN: what LINE's getProfile answers. Absent =
     `null`, the failed fetch every case above already runs with. */
  lineProfile?: Record<string, unknown> | null;
}

function baseHook(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: 'flowmatrix',
    status: 1,
    channel_secret: CHANNEL_SECRET,
    // Syntactically valid and DEAD — every outbound LINE call 401s.
    access_token: 'flowmatrix-dead-token',
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
    ...over,
  };
}

/** A hook with the slip legs armed — the เคส B baseline. */
function slipHook(over: Record<string, unknown> = {}): Record<string, unknown> {
  return baseHook({
    // ⚠️ REQUIRED, not decoration. `webhook.service.ts:1842` gates the ENTIRE
    // non-text work block on `isAutoReplyType && hook.image_answer_text` — the
    // slip verify→card→callback path AND the missing-profile guard all sit
    // inside it. An OA with no image answer configured skips the whole block,
    // so a fixture that omits this silently tests nothing at all.
    image_answer_text: 'รับสลิปแล้ว',
    slip_check: true,
    slip_verify_key: 'enc:swiftcheck-key',
    match_account: false,
    flex_success: 'fx-success',
    flex_duplicate: 'fx-duplicate',
    flex_not_found: 'fx-notfound',
    flex_error: 'fx-error',
    flex_success_not_match: 'fx-notmatch',
    ...over,
  });
}

/** Combined external data that resolves a name, so the N/A guard passes. */
const LINKED_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'สมชาย ทดสอบ', customer_tel: '0800000000' },
    },
  },
};

/** [FIX-20260823-B8LIES] Explicit 404 — รูปแบบเดียวที่ด่าน require-profile บล็อก
 *  (`require-profile.gate.ts:67-71` เช็ค `status === 404` เป๊ะ ๆ)
 *  ย้ายมาระดับไฟล์ 23/08 เพราะ B8 ต้องใช้ — เดิมค่านี้ซ่อนอยู่ใน describe ท้ายไฟล์
 *  B8 จึงส่ง `profileData: {}` ซึ่งไม่ใช่ 404 ⇒ ด่านไม่ทำงาน ⇒ เส้นสลิปไม่เคยเดิน
 *  ⇒ เทสเขียวด้วยเหตุผลผิดมาตลอด */
const PROFILE_404 = {
  'Path : api/v1/customer': {
    success: false,
    status: 404,
    data: { message: 'customer not found' },
  },
};

const CARD = {
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [] },
};

function buildHarness(opts: Opts = {}): {
  trace: Trace;
  post: (events: unknown[]) => Promise<void>;
} {
  const hook = opts.hook ?? baseHook();
  const trace: Trace = {
    steps: [],
    aiRequests: [],
    replies: [],
    flexReplies: [],
    objImageFilters: [],
    chatRows: [],
    menuCardQueries: [],
    chatUpdates: [],
    slipVerifyInputs: [],
    slipCallbacks: [],
    externalCalls: [],
    logRows: [],
  };

  const hookModel = { findOne: () => query(hook) };
  const chatRoomModel = {
    findOne: () => query(opts.room ?? null),
    findOneAndUpdate: () => query({ _id: 'room-1' }),
    updateOne: () => query({ acknowledged: true }),
  };
  const chatMessageModel = {
    findOne: () => query(null),
    find: () => query([]),
    create: (row: Record<string, unknown>) => {
      trace.chatRows.push(row);
      return Promise.resolve({ _id: 'msg-1', room_id: 'room-1', ...row });
    },
    updateOne: (filter: unknown, update: Record<string, unknown>) => {
      trace.chatUpdates.push({ filter, update });
      return query({ acknowledged: true });
    },
    countDocuments: () => query(0),
  };
  const passthrough = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'x' }),
    updateOne: () => query({ acknowledged: true }),
    findById: () => query(null),
    countDocuments: () => query(0),
  };

  const externalApi = {
    getCombinedData: (input: Record<string, unknown>) => {
      trace.steps.push('external.fetch');
      trace.externalCalls.push(input);
      return Promise.resolve(opts.profileData ?? {});
    },
  };

  const lineApi = {
    sendLineReplyMessage: (_t: string, _r: string, text: string) => {
      trace.steps.push('line.reply');
      trace.replies.push(text);
      return Promise.resolve({ status: 200, data: {} });
    },
    sendLineFlexReply: (
      _t: string,
      _r: string,
      contents: unknown,
      altText: string,
    ) => {
      trace.steps.push('line.flex');
      trace.flexReplies.push({ altText, contents });
      // A real card send succeeds, so the branch reaches isFlexSent = true and
      // goes on to the slip callback. `sentMessages` is what the caller reads.
      return Promise.resolve({ status: 200, data: { sentMessages: [] } });
    },
    sendLineLoadingIndicator: () => Promise.resolve({ status: 200, data: {} }),
    sendLinePushMessage: () => Promise.resolve({ status: 200, data: {} }),
    sendLinePushFlexMessage: () => Promise.resolve({ status: 200, data: {} }),
    getLineProfile: () => Promise.resolve(opts.lineProfile ?? null),
  };

  const service = new WebhookService(
    hookModel as never,
    chatRoomModel as never,
    chatMessageModel as never,
    passthrough as never, // memberModel
    passthrough as never, // assignHistoryModel
    passthrough as never, // ticketModel
    /* [RULER-20260815-WLOGGOLDEN] opt-in staging for the tag→image carousel
       branch, which writes `line_reply_image` / `line_reply_flex`. Both default
       to the previous null/[] answers, so every existing case is untouched.

       [FEAT-20260901-OBJSCOPE] The filter is now CAPTURED on `trace`, not
       discarded. It used to be `findOne: () => query(...)` — the argument was
       thrown away, so every carousel case passed identically whether the lookup
       was scoped to the conversation's OA or not scoped at all. A test that
       cannot tell those apart is not covering the scope; the answer it returns
       is unchanged, so nothing that passed before behaves differently now. */
    {
      ...passthrough,
      findOne: (filter?: unknown) => {
        trace.objImageFilters.push(filter);
        return query(opts.objImage ?? null);
      },
    } as never, // objectImageModel
    {
      findById: () =>
        query(
          opts.slipVerifyResult || opts.withImageStorage
            ? {
                _id: 'store1',
                image_url: '/uploads/slip.jpg',
                file_path: '/tmp/slip.png',
              }
            : null,
        ),
      find: () => query(opts.imageStorages ?? []),
    } as never, // imageStorageModel
    { safeDecrypt: (v: string) => v } as never,
    {
      cacheHook: () => Promise.resolve(),
      getHookByAlias: () => Promise.resolve(hook),
      getHookByAliasWithSource: () =>
        Promise.resolve({ hook, source: 'cache' }),
    } as never, // hookCache
    {
      logMessage: (row: Record<string, unknown>) => {
        trace.steps.push('chat.log');
        trace.chatRows.push(row);
        return Promise.resolve({ _id: 'msg-1', room_id: 'room-1' });
      },
      logSystemMessage: () => Promise.resolve({ _id: 'sys-1' }),
      resolveRoom: () => Promise.resolve({ _id: 'room-1' }),
    } as never,
    lineApi as never,
    {
      downloadAndSaveImage: () =>
        Promise.resolve(
          opts.slipVerifyResult || opts.withImageStorage ? 'store1' : null,
        ),
      downloadAndSaveVideo: () => Promise.resolve(null),
    } as never,
    {
      createLog: (row: Record<string, unknown>) => {
        trace.logRows.push(row);
        /* [FEAT-20260815-WLOGDOOR] opt-in failure. Mongoose rejects a document
           whose `status` is outside the enum, which is how two audit rows were
           lost silently this month — so the swallow that keeps such a failure
           away from the customer needs a case, not an assumption. Default is
           unchanged: every existing test still gets a resolving sink. */
        return opts.logWriteFails === true
          ? Promise.reject(new Error('WebhookLog validation failed'))
          : Promise.resolve();
      },
    } as never,
    externalApi as never,
    (opts.customTool
      ? {
          getToolForHook: () => Promise.resolve(opts.customTool!.tool),
          getCombinedData: () => Promise.resolve(opts.customTool!.combined),
          /* the SHIPPED extractor — profile_map decides name / phone / contract */
          extractProfile: (d: unknown, t: unknown) =>
            REAL_TOOL.extractProfile(d as never, t as never),
        }
      : {
          getToolForHook: () => Promise.resolve(null),
          getCombinedData: () => Promise.resolve(opts.profileData ?? {}),
          extractProfile: () => null,
        }) as never,
    {
      consume: () => Promise.resolve({ limited: opts.rateLimited === true }),
      /* [FEAT-20260824-RATEPEEK] the read-only twin. Traced separately so a case
         can assert it was ASKED (or deliberately not asked) — the short-circuit
         that keeps it off every non-slip image is part of the contract. */
      peek: () => {
        trace.steps.push('rate.peek');
        return Promise.resolve({
          limited: opts.rateLimited === true,
          level: 1,
          current: null,
          limit: 3,
        });
      },
    } as never,
    {
      getClient: () => {
        throw new Error('no redis in unit test');
      },
    } as never,
    {
      generate: (req: AiReplyRequest) => {
        trace.steps.push('ai.generate');
        trace.aiRequests.push(req);
        if (opts.aiReplyText !== undefined) {
          return Promise.resolve({
            text: opts.aiReplyText,
            noData: false,
            /* [RULER] `'not_found'` is what opens the Telegram "no answer found"
               branch, the only writer of the service's `get_profile` row. Opt-in:
               every existing case keeps the null it had. */
            tagStatus: opts.tagStatus ?? null,
          });
        }
        return Promise.reject(new AiProviderUnavailableError());
      },
    },
    {
      summarise: () => Promise.reject(new AssistSummaryUnavailableError()),
    },
    { getConfigByKey: () => Promise.resolve(null) } as never,
    { telegramWebhookSecret: undefined, multiEventDelivery: false },
    { geminiApiKey: undefined, modelId: 'gemini-3.5-flash' } as never,
    { ignoreDocId: undefined } as never,
    { publish: () => Promise.resolve() } as never,
    {
      mintLinkToken: () => {
        trace.steps.push('mint');
        return { url: 'https://link.test/x', token: 'tok', expiresAt: 0 };
      },
    } as never,
    {
      findOne: () => query(opts.flexProfileDoc ?? null),
      findById: () => query(opts.flexDoc ?? null),
    } as never,
    {
      translate: (_d: string, k: string | number | null) => `${k ?? ''}`,
    } as never,
    {
      isSlipVerifyEnabled: (h: Record<string, unknown> | null | undefined) =>
        h?.['slip_check'] === true && !!h?.['slip_verify_key'],
      verifySlip: (i: Record<string, unknown>) => {
        trace.steps.push('slip.verify');
        trace.slipVerifyInputs.push(i);
        return Promise.resolve(
          opts.slipVerifyResult ?? {
            slipVerifyResult: null,
            slipRecordId: null,
            slipCreatedAt: null,
            slipCondition: null,
            attempted: false,
          },
        );
      },
      handleSlipCallback: (i: Record<string, unknown>) => {
        trace.steps.push('slip.callback');
        trace.slipCallbacks.push(i);
        return Promise.resolve();
      },
    } as never,
    {
      checkIfSlipWithQrCode: () => {
        trace.steps.push('qr.check');
        return Promise.resolve(opts.qrIsSlip === true);
      },
    } as never,

    undefined, // configCacheInvalidator · paymentRunner · docRetrieval · strike
    undefined,
    undefined,
    undefined,
    /* [FEAT-20260828-PUSHCORE-A1] `LinePushDispatcher` — mirrors the `lineApi`
       double above, which resolves on both kinds, and records into the same
       trace arrays so every step-order assertion keeps its meaning. */
    {
      dispatch: (req: { messages?: Array<Record<string, unknown>> }) => {
        const m = req.messages?.[0];
        if (m?.['type'] === 'flex') {
          trace.steps.push('line.flex');
          trace.flexReplies.push({
            altText: typeof m['altText'] === 'string' ? m['altText'] : '',
            contents: m['contents'],
          });
          return Promise.resolve({
            ok: true,
            status: 200,
            attempts: 1,
            durationMs: 0,
            // flex answered `{ sentMessages: [] }` — the caller logs it verbatim
            data: { sentMessages: [] },
          });
        }
        trace.steps.push('line.reply');
        trace.replies.push(typeof m?.['text'] === 'string' ? m['text'] : '');
        /* ⚠️ `{}` for text, NOT `{ sentMessages: [] }`. The two legacy doubles
           answered DIFFERENT bodies and `response_summary` is copied straight
           into webhook_logs, so a single shared body silently rewrote seven
           byte-frozen rows. Caught by those snapshots, 28/08. */
        return Promise.resolve({
          ok: true,
          status: 200,
          attempts: 1,
          durationMs: 0,
          data: {},
        });
      },
    } as never,
    /* [FIX-20260901-MENUKINDMISSING] `StoredMenuCardSource`, the LAST positional
       dependency. `undefined` unless a case asks for a card — see the opt. */
    opts.menuCard === undefined
      ? undefined
      : {
          find: (query: Record<string, unknown>) => {
            trace.steps.push('menu.find');
            trace.menuCardQueries.push(query);
            return Promise.resolve(opts.menuCard ?? null);
          },
        },
  );

  const post = async (events: unknown[]): Promise<void> => {
    const body = { destination: 'Uflow', events };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: '/flowmatrix/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(body, hook, 'cache', 'flowmatrix', meta);
  };

  return { trace, post };
}

function textEvent(text: string): Record<string, unknown> {
  return {
    type: 'message',
    eventId: `ev-${text.slice(0, 8)}`,
    replyToken: 'rt-1',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'm1', text },
  };
}

function imageEvent(): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-image',
    replyToken: 'rt-img',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'image', id: 'img1' },
  };
}

/** A Swiftcheck success body carrying the fields the slip tag map reads. */
function successVerify(
  data: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    slipVerifyResult: {
      success: true,
      data: {
        isDuplicate: false,
        matchedAccount: true,
        amountInSlip: 500,
        rawSlip: {
          date: '2026-08-10 10:00:00',
          transRef: 'TX-FLOW-1',
          amount: { amount: 500 },
          sender: { bank: { id: '002', name: 'BBL' }, account: {} },
          receiver: { bank: { id: '004', name: 'KBANK' }, account: {} },
        },
        ...data,
      },
    },
    slipRecordId: 'slip-row-1',
    slipCreatedAt: new Date('2026-08-10T03:00:00Z'),
    slipCondition: null,
    attempted: true,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   เคส A — dynamic tag + flex message + profile + site rules
   10 แบบ ไม่ซ้ำกัน สลับ tag/ชนิด event/สถานะโปรไฟล์
   ══════════════════════════════════════════════════════════════════════════ */
describe('[TEST-20260810-FLOWMATRIX] เคส A — dynamic tag + flex + profile + site', () => {
  it('A1 · plain text answer: no tag, no card, the AI text is what the customer gets', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ยอดคงเหลือของคุณคือ 1,200 บาทค่ะ',
      hook: baseHook({ custom_tool_id: 'tool-1' }),
    });
    await post([textEvent('ยอดเงินเท่าไหร่')]);
    expect(trace.replies).toEqual(['ยอดคงเหลือของคุณคือ 1,200 บาทค่ะ']);
    expect(trace.steps).not.toContain('line.flex');
  });

  it('A2 · [[[flex_profile]]] builds the bound card and REPLACES the text', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'นี่คือข้อมูลของคุณ [[[flex_profile]]]',
      hook: baseHook({
        flex_profile_id: 'fx-profile',
        custom_tool_id: 'tool-1',
      }),
      flexProfileDoc: {
        _id: 'fx-profile',
        content_json: CARD,
        flex_type: 'profile',
      },
    });
    await post([textEvent('ขอดูโปรไฟล์')]);
    expect(trace.steps).toContain('line.flex');
    // A flex reply REPLACES the text — the altText carries the words instead.
    expect(trace.replies).toEqual([]);
    expect(trace.flexReplies[0]!.altText).not.toContain('[[[');
  });

  it('A3 · the marker is stripped from the altText — no brackets ever reach LINE', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ข้อมูลของคุณ [[[flex_profile]]]',
      hook: baseHook({
        flex_profile_id: 'fx-profile',
        custom_tool_id: 'tool-1',
      }),
      flexProfileDoc: {
        _id: 'fx-profile',
        content_json: CARD,
        flex_type: 'profile',
      },
    });
    await post([textEvent('โปรไฟล์')]);
    const sent = JSON.stringify(trace.flexReplies[0]?.altText ?? '');
    expect(sent).not.toContain('[[[');
    expect(sent).not.toContain(']]]');
  });

  it('A4 · an UNKNOWN marker the model invented is stripped, prose survives', async () => {
    // The catch-all: the marker set is open, so a tag nobody wrote a strip for
    // must still not reach a customer.
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'สวัสดีค่ะ [[[some_invented_tag]]] ยินดีให้บริการ',
      hook: baseHook({ custom_tool_id: 'tool-1' }),
    });
    await post([textEvent('หวัดดี')]);
    const reply = trace.replies[0] ?? '';
    expect(reply).not.toContain('[[[');
    expect(reply).toContain('สวัสดีค่ะ');
    expect(reply).toContain('ยินดีให้บริการ');
  });

  it('A5 · the training-document fences [START_OF_*] never leak', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: '[START_OF_BASIC_INFO] ร้านเปิด 9 โมง [END_OF_BASIC_INFO]',
      hook: baseHook({ custom_tool_id: 'tool-1' }),
    });
    await post([textEvent('เปิดกี่โมง')]);
    const reply = trace.replies[0] ?? '';
    expect(reply).not.toContain('START_OF_');
    expect(reply).not.toContain('END_OF_');
    expect(reply).toContain('ร้านเปิด 9 โมง');
  });

  it('A6 · profile fetch runs before the AI, and its data is handed to the model', async () => {
    // ORDER is the contract: an answer built without the profile would quote
    // numbers from nothing.
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ok',
      hook: baseHook({ custom_tool_id: 'tool-1' }),
    });
    await post([textEvent('ข้อมูลผม')]);
    expect(trace.steps.indexOf('external.fetch')).toBeGreaterThanOrEqual(0);
    expect(trace.steps.indexOf('external.fetch')).toBeLessThan(
      trace.steps.indexOf('ai.generate'),
    );
  });

  it('A7 · an IMAGE from an unlinked customer hits the missing-profile guard', async () => {
    // ⚠️ CHARACTERISATION, and the placement matters: this guard
    // (`webhook.service.ts:2023`) sits in the NON-TEXT branch. A text message
    // from the same unlinked customer does NOT hit it — it goes to the model and
    // is answered normally (pinned by A7b). Asserting it on a text event would
    // have been asserting a behaviour the pipeline does not have.
    const { trace, post } = buildHarness({
      profileData: {}, // customerName resolves to N/A
      withImageStorage: true,
      hook: baseHook({
        custom_tool_id: 'tool-1',
        // ⚠️ The guard needs BOTH: it sits INSIDE the `image_answer_text` block
        // (webhook.service.ts:1842) and fires ABOVE the image answer itself, so
        // an OA with no image answer never reaches it at all.
        image_answer_text: 'รับรูปแล้ว',
        missing_api_data_text: 'กรุณาผูกบัญชีก่อนนะคะ',
      }),
    });
    await post([imageEvent()]);
    expect(trace.replies).toEqual(['กรุณาผูกบัญชีก่อนนะคะ']);
    expect(trace.steps).not.toContain('ai.generate');
  });

  it('A7b · the same unlinked customer sending TEXT is still answered by the AI', async () => {
    // The other half of the guard's scope — proves A7 pins a branch, not a
    // global rule. ลูกค้าที่ยังไม่ผูกบัญชีพิมพ์ข้อความ ยังคุยกับบอทได้ปกติ.
    const { trace, post } = buildHarness({
      profileData: {},
      aiReplyText: 'ยินดีให้บริการค่ะ',
      hook: baseHook({
        custom_tool_id: 'tool-1',
        missing_api_data_text: 'กรุณาผูกบัญชีก่อนนะคะ',
      }),
    });
    await post([textEvent('สวัสดี')]);
    expect(trace.steps).toContain('ai.generate');
    expect(trace.replies).toEqual(['ยินดีให้บริการค่ะ']);
  });

  it('A8 · the customer message is logged to chat history before the reply goes out', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ได้ค่ะ',
      hook: baseHook({ custom_tool_id: 'tool-1' }),
    });
    await post([textEvent('สอบถามหน่อย')]);
    expect(trace.steps.indexOf('chat.log')).toBeLessThan(
      trace.steps.indexOf('line.reply'),
    );
  });

  it('A9 · a rate-limited customer is told to wait — no AI, no external fetch', async () => {
    const { trace, post } = buildHarness({
      rateLimited: true,
      profileData: LINKED_PROFILE,
      hook: baseHook({ custom_tool_id: 'tool-1' }),
    });
    await post([textEvent('ถามรัว ๆ')]);
    expect(trace.replies).toEqual(['กรุณารอสักครู่และลองใหม่อีกครั้ง']);
    expect(trace.steps).not.toContain('ai.generate');
  });

  it('A10 · a sticker is stored but never answered — silent by design', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      hook: baseHook({ custom_tool_id: 'tool-1' }),
    });
    await post([
      {
        type: 'message',
        eventId: 'ev-sticker',
        replyToken: 'rt-st',
        timestamp: Date.now(),
        source: { type: 'user', userId: USER_ID },
        message: { type: 'sticker', id: 's1', packageId: '1', stickerId: '2' },
      },
    ]);
    expect(trace.replies).toEqual([]);
    expect(trace.steps).not.toContain('ai.generate');
  });

  it('⭐ A11 · [FEAT-20260820-STICKERFOLLOWUP] a sticker from an UNREGISTERED customer now enters the follow-up flow — and still leaks nowhere', async () => {
    /* A10 above covers the registered customer and is untouched by the change:
       the new call is gated on `!followUpHasProfile`, so that path never runs it.
       This case takes the other branch — no profile — and proves that opening the
       door did NOT open it onto anything else: no answer, no AI, no keyword
       handler, no non-text branch. The customer here carries no abandon mark and
       matches no level-1 rule, so the gate stays quiet and the event ends exactly
       as it did before: stored, unanswered.
       เปิดทางให้ sticker เข้า flow ได้ แต่ต้องไม่มีอะไรรั่วไปทางอื่น. */
    const { trace, post } = buildHarness({
      profileData: {}, // ⬅ the only difference from A10
      hook: baseHook({ custom_tool_id: 'tool-1' }),
    });
    await post([
      {
        type: 'message',
        eventId: 'ev-sticker-noprofile',
        replyToken: 'rt-st2',
        timestamp: Date.now(),
        source: { type: 'user', userId: USER_ID },
        message: { type: 'sticker', id: 's2', packageId: '1', stickerId: '2' },
      },
    ]);
    expect(trace.replies).toEqual([]);
    expect(trace.flexReplies).toEqual([]);
    expect(trace.steps).not.toContain('ai.generate');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   เคส B — สลิป + topup + walletpay
   10 แบบ ไม่ซ้ำกัน สลับผลตรวจสลิป/สถานะ/ชนิด event
   ══════════════════════════════════════════════════════════════════════════ */
describe('[TEST-20260810-FLOWMATRIX] เคส B — slip + topup + walletpay', () => {
  it('B1 · slip_check OFF: Swiftcheck is never called, no money path is entered', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ image_answer_text: 'รับรูปแล้ว', slip_check: false }),
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });
    await post([imageEvent()]);
    expect(trace.steps).not.toContain('slip.verify');
    expect(trace.steps).not.toContain('slip.callback');
    expect(trace.replies).toEqual(['รับรูปแล้ว']);
  });

  it('B2 · slip_check ON but the message is TEXT: no verify — a slip needs an image', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      aiReplyText: 'ok',
    });
    await post([textEvent('โอนแล้วนะ')]);
    expect(trace.steps).not.toContain('slip.verify');
  });

  it('B3 · slip_check ON + image: Swiftcheck is called with the STORED file path', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
    });
    await post([imageEvent()]);
    expect(trace.steps).toContain('slip.verify');
    expect(JSON.stringify(trace.slipVerifyInputs[0] ?? {})).toContain(
      '/tmp/slip.png',
    );
  });

  it('B4 · a verified slip sends the success CARD, not a text message', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
    });
    await post([imageEvent()]);
    expect(trace.steps).toContain('line.flex');
  });

  it('B5 · a DUPLICATE slip is flagged as duplicate on the way to the callback', async () => {
    /* ⚠️ CORRECTED EXPECTATION — this test first asserted `slipCallbacks` stayed
       EMPTY, and it "passed" only because the whole non-text block was being
       skipped (the fixture was missing `image_answer_text`). Once the block
       actually ran, the truth showed: production DOES send the duplicate card and
       DOES fire the callback (`slip-flex.handler.ts:455-461` sets the condition
       and picks `flex_duplicate`; `webhook.service.ts:1998` then fires the
       callback on `isFlexSent`, with no duplicate check of its own).

       That is not a leak. The money guard lives DOWNSTREAM, and asserting it
       here would have been asserting a behaviour the pipeline does not have:
         · [FEAT-20260815-DUPFORWARD] the runner's duplicate gate is GONE. It
           used to return `{ran:false, skipped:'duplicate_slip'}`; the owner
           removed it on 15 Aug ("เราเป็นคนกลาง") so a duplicate now reaches
           topup, and Shop-API refuses to credit it upstream. Nothing in THIS test
           depended on that gate — the assertions below are about labelling.
         · `slip-flow.service.ts:604-613` — with `callback_action:'success'` the
           callback itself returns early unless the card's `callback_tag` is
           `success`, which a duplicate card is not
       ⇒ what this case pins is that the duplicate is CORRECTLY LABELLED on the
       way through, which is what those downstream gates key on.
       สลิปซ้ำยังส่งการ์ด+ยิง callback ได้ แต่ต้องติดป้ายว่าซ้ำ ตัวกันเงินอยู่ปลายทาง. */
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify({ isDuplicate: true }),
      flexDoc: { _id: 'fx-duplicate', content_json: CARD },
    });
    await post([imageEvent()]);

    expect(trace.slipCallbacks).toHaveLength(1);
    const cb = trace.slipCallbacks[0]!;
    expect(String(cb['condition'])).toMatch(/Duplicate/);
    // The DUPLICATE card was chosen, not the success card.
    expect((cb['flexDoc'] as Record<string, unknown>)?.['_id']).toBe(
      'fx-duplicate',
    );
  });

  it('B5b · the duplicate card is what the customer sees — not the success card', async () => {
    // The other half: a duplicate must never be answered with `flex_success`.
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify({ isDuplicate: true }),
      flexDoc: { _id: 'fx-duplicate', content_json: CARD },
    });
    await post([imageEvent()]);
    expect(trace.steps).toContain('line.flex');
    expect(trace.flexReplies).toHaveLength(1);
  });

  it('B6 · Swiftcheck failing does not silence the bot — the customer still gets a reply', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: {
        slipVerifyResult: { success: false, message: 'read failed' },
        slipRecordId: 'slip-err',
        slipCreatedAt: new Date(),
        slipCondition: null,
        attempted: true,
      },
      flexDoc: { _id: 'fx-error', content_json: CARD },
    });
    await post([imageEvent()]);
    const answered =
      trace.steps.includes('line.flex') || trace.steps.includes('line.reply');
    expect(answered).toBe(true);
    expect(trace.slipCallbacks).toEqual([]);
  });

  it('B7 · the slip verification runs BEFORE anything that could credit money', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
    });
    await post([imageEvent()]);
    const verifyAt = trace.steps.indexOf('slip.verify');
    const callbackAt = trace.steps.indexOf('slip.callback');
    expect(verifyAt).toBeGreaterThanOrEqual(0);
    if (callbackAt >= 0) expect(verifyAt).toBeLessThan(callbackAt);
  });

  /* [FIX-20260823-B8LIES] ⚠️ เทสนี้เคย **ไม่ได้พิสูจน์สิ่งที่ชื่อมันบอก**
   *
   * ชื่อบอกว่า "refused before Swiftcheck is paid for" แต่ assert เดียวที่มีคือ
   * `steps ไม่มี 'slip.callback'` ซึ่งเป็นคนละขั้นกับการเรียก Swiftcheck —
   * ขั้นที่เสียเงินคือ `'slip.verify'` · B9 บรรทัดถัดไปใช้ `trace.slipVerifyInputs`
   * ถูกอยู่แล้ว แสดงว่า harness ทำได้มาตลอด B8 แค่ไม่ได้ใช้
   * ⇒ ถอด `slip_require_profile` ออกจากโค้ดทั้งก้อน เทสนี้ก็ยังเขียว
   *
   * เจอ 23/08/2026 ตอนเจ้าของถามว่า "ถ้า no profile ต้องตรวจไม่ได้" — เทสที่ควร
   * เป็นหลักฐานยืนยันกลับอ่อนเกินกว่าจะใช้ค้านอะไรได้
   *
   * ตอนนี้ตรึงครบตามที่ `webhook.service.ts:2035-2037` สัญญาไว้:
   *   "STOP: no Swiftcheck call, no slip row, no slip card, and no payment run"
   */
  it('B8 · an unlinked customer sending a slip is refused before Swiftcheck is paid for', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook({
        slip_require_profile: true,
        slip_require_profile_text: 'ผูกบัญชีก่อนส่งสลิปนะคะ',
      }),
      // ⭐ ต้องเป็น 404 เป๊ะ ๆ — รูปแบบเดียวที่ด่านนี้บล็อก
      profileData: PROFILE_404,
    });
    await post([imageEvent()]);

    // ⭐ ข้อสำคัญที่สุด — ขั้นที่ "เสียเงิน" ต้องไม่ถูกเรียก
    expect(trace.slipVerifyInputs).toEqual([]);
    expect(trace.steps).not.toContain('slip.verify');

    // ไม่มี callback ปลายทาง และไม่มีการ์ดสลิป
    expect(trace.steps).not.toContain('slip.callback');
    expect(trace.steps).not.toContain('line.flex');

    // ลูกค้าต้องได้คำตอบที่ OA ตั้งไว้ ไม่ใช่เงียบหาย
    expect(trace.replies).toContain('ผูกบัญชีก่อนส่งสลิปนะคะ');
  });

  /* [FIX-20260823-B8LIES] ด้านกลับของ B8 — ถ้าไม่มีข้อนี้ B8 ผ่านได้ด้วยเหตุผลผิด
     (เช่น harness ไม่เคยเรียก Swiftcheck เลยไม่ว่ากรณีไหน) ⇒ อ่านคู่กันเสมอ */
  it('B8b · ลูกค้าที่ผูกบัญชีแล้ว ยังถูกตรวจตามปกติ (กัน B8 ผ่านด้วยเหตุผลผิด)', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook({
        slip_require_profile: true,
        slip_require_profile_text: 'ผูกบัญชีก่อนส่งสลิปนะคะ',
      }),
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
    });
    await post([imageEvent()]);

    expect(trace.steps).toContain('slip.verify');
    expect(trace.slipVerifyInputs.length).toBeGreaterThan(0);
    expect(trace.replies).not.toContain('ผูกบัญชีก่อนส่งสลิปนะคะ');
  });

  it('B9 · a slip arriving as TEXT-only never reaches the money path', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      aiReplyText: 'รับทราบค่ะ',
    });
    await post([textEvent('สลิปอยู่ในรูปนะ')]);
    expect(trace.slipVerifyInputs).toEqual([]);
    expect(trace.slipCallbacks).toEqual([]);
  });

  it('B10 · the whole slip run writes a webhook log — the money path is never silent', async () => {
    // An unlogged money path is unauditable; this pins that something is recorded.
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
    });
    await post([imageEvent()]);
    expect(trace.logRows.length).toBeGreaterThan(0);
  });
});

/* ════ [RULER-20260815-WLOGGOLDEN] webhook_logs rows — frozen byte-for-byte ════
 *
 * The second half of the ruler (see the twin block at the end of
 * `webhook-ingest-flow.spec.ts`, and docs/lockdown_step.md → todo/be_todo6).
 * THIS harness resolves LINE sends with 200, so the reply-family rows that the
 * ingest harness's dead token can never persist (`rate_limit_reply`,
 * `image_answer_reply`, `missing_profile_data_reply`, `slip_flex_reply`,
 * `slip_refused_no_profile`, the success `line_reply`) freeze HERE.
 *
 * Any snapshot diff that was not explicitly intended is a FAILURE of the
 * logging refactor, not drift to accept — no `--updateSnapshot` without a
 * written reason. สแนปช็อตต่างโดยไม่ได้ตั้งใจ = พัง ไม่ใช่อัปทับ.
 *
 * revert: delete this describe block + its entries in __snapshots__.
 */
describe('[RULER-20260815-WLOGGOLDEN] webhook_logs rows are byte-frozen (reply family)', () => {
  const frozen = freezeLogRows;
  const settle = settleLogWrites;

  it('M1 text + linked profile + AI answer — generate_response + line_reply rows', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ยอดคงเหลือของคุณคือ 1,200 บาทค่ะ',
      hook: baseHook({ custom_tool_id: 'tool-1' }),
    });
    await post([textEvent('ยอดเงินเท่าไหร่')]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('M2 rate-limited — rate_limit_reply row', async () => {
    const { trace, post } = buildHarness({ rateLimited: true });
    await post([textEvent('สวัสดี')]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('M3 image + image_answer_text + linked profile — image_answer_reply row', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ image_answer_text: 'รับรูปแล้วค่ะ' }),
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });
    await post([imageEvent()]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('M4 image + unregistered customer — missing_profile_data_reply row', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        image_answer_text: 'รับรูปแล้วค่ะ',
        missing_api_data_text: 'กรุณาผูกบัญชีก่อนค่ะ',
      }),
      profileData: PROFILE_404,
      withImageStorage: true,
    });
    await post([imageEvent()]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('M5 verified slip + success card — the slip_flex_reply row', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
    });
    await post([imageEvent()]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  /* M7/M8 were added for batch B2: `out_of_hours_reply` and
     `api_missing_data_reply` had NO frozen row, and lockdown_step §2 forbids
     migrating a site the ruler does not cover. The ingest harness cannot produce
     them — its LINE token is dead, so the write that follows a successful send is
     never reached. Here the send resolves 200, so both rows land. */
  it('M7 hook status 0 (out of hours) — out_of_hours_reply row', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ status: 0, status_off_text: 'ร้านปิดแล้วค่ะ' }),
    });
    await post([textEvent('เปิดอยู่ไหม')]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('M8 AI quoted an API number while the fetch failed — api_missing_data_reply row', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        missing_api_data_text: 'ระบบข้อมูลขัดข้อง กรุณาลองใหม่ค่ะ',
      }),
      // `_error_trigger` is what the pipeline reads as "the profile fetch failed".
      profileData: {
        _error_trigger: { status: 500, message: 'upstream down' },
      },
      // A CRITICAL_API_TAG in the answer is the other half of the guard.
      aiReplyText: 'ยอดที่ต้องชำระคือ [[[total_due_amount]]] บาทค่ะ',
    });
    await post([textEvent('ยอดเท่าไหร่')]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  /* ⚠️ M9 was RETIRED on purpose — do not re-add it here. It pinned the carousel
   * as a dead branch, which `[FIX-20260815-IMGTAGDEAD]` then fixed, and the case
   * did NOT go red the way its own comment promised. It stayed green for a new
   * reason: this describe block never stages `axios.post`, so once the branch
   * became reachable the mocked call resolved `undefined`, the read of
   * `lineResponse.status` threw, and the flow fell back to the plain reply —
   * producing the same rows for a completely different reason.
   *
   * A snapshot that is green for the wrong reason is worse than no snapshot: it
   * reads as coverage. The carousel now has real flow cases with axios staged, in
   * the `[FIX-20260815-IMGTAGDEAD]` describe at the end of this file — which is
   * also where a fallback is asserted deliberately rather than by accident.
   * สแนปช็อตที่เขียวเพราะเหตุผลผิด = อันตรายกว่าไม่มี.
   */

  it('M6 slip from a provably-unlinked customer — slip_refused_no_profile row', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook({
        slip_require_profile: true,
        slip_require_profile_text: 'ผูกบัญชีก่อนส่งสลิปนะคะ',
      }),
      profileData: PROFILE_404,
    });
    await post([imageEvent()]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });
});

/* ════ [FIX-20260815-IMGTAGDEAD] the tag → image-set → carousel flow ════════════
 *
 * THE BUG THESE PIN: an OA configures an `object_images` row with a
 * `matching_tag` and a set of images; the model answers with `[[[img_xxx]]]`;
 * the pipeline is supposed to reply with that image set as a carousel INSTEAD of
 * the plain sentence. It never did.
 *
 * `resolveReplyTags` detects every other marker BEFORE stripping
 * (`wantsHelperQuickReply` :189, `wantsFlexProfile` :199, `wantedFlexTag` :204,
 * `wantedFlexPcTag` :210) and then a catch-all removes ALL `[[[...]]]`
 * (reply-tags.util.ts:263). `findImageTag` alone ran AFTER that, on the stripped
 * text (webhook.service.ts:3642), so it could never match.
 *
 * How it died: `619ffda` (07/08 22:44) ported the carousel; `6d9ac39` (07/08
 * 23:36) added the catch-all and listed `[[[img_promo]]]` among the markers it
 * was stopping — it read as leaking rubbish, not as a signal something downstream
 * was waiting for. Dead ever since. เกิดมา 52 นาที แล้วโดนกลบ.
 *
 * PRECEDENCE (owner-facing decision, taken conservatively): the image tag is
 * resolved LAST, after flex_profile / flex_m / flex_pc, extending the existing
 * one-card-per-answer rule instead of inventing a new one. An answer carrying
 * both a flex tag and an image tag therefore behaves exactly as it does today.
 *
 * These are FLOW tests: real `processWebhook`, real pipeline, only the outside
 * world faked. The LINE call is the raw `axios.post` the branch really uses.
 */
describe('[FIX-20260815-IMGTAGDEAD] tag → image set → carousel', () => {
  const settle = settleLogWrites;

  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
  });

  const OBJ_ID = 'obj-img-1';
  const flexObject = {
    _id: OBJ_ID,
    matching_tag: 'img_promo',
    response_type: 'flex',
    detail: 'โปรโมชั่นเดือนนี้',
  };
  const mediaObject = { ...flexObject, response_type: 'media' };
  const twoImages = [
    { _id: 's1', image_url: 'https://cdn.test/p1.jpg', detail_text: 'ใบที่ 1' },
    { _id: 's2', image_url: 'https://cdn.test/p2.jpg', detail_text: 'ใบที่ 2' },
  ];

  it('flex object → a carousel is POSTed and the plain sentence is NOT sent', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ดูโปรโมชั่นได้เลยค่ะ [[[img_promo]]]',
      objImage: flexObject,
      imageStorages: twoImages,
    });
    await post([textEvent('มีโปรอะไรบ้าง')]);
    await settle();

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const body = mockedAxios.post.mock.calls[0]![1] as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!['type']).toBe('flex');
    const contents = body.messages[0]!['contents'] as {
      type: string;
      contents: unknown[];
    };
    expect(contents.type).toBe('carousel');
    // one bubble per configured image — the SET is what the tag resolves to
    expect(contents.contents).toHaveLength(2);
    // the carousel REPLACES the text: no plain reply went out
    expect(trace.replies).toEqual([]);
    // and the row that proves it, which production has never once written
    expect(
      trace.logRows.some((r) => r['action_type'] === 'line_reply_flex'),
    ).toBe(true);
    /* [RULER-20260815-WLOGGOLDEN] freeze the rows byte-for-byte too, so this
       site can be migrated onto the typed door under the same rule as every
       other: no migration without a ruler. */
    expect(freezeLogRows(trace.logRows)).toMatchSnapshot();
  });

  it('media object → up to five image messages, not a flex bubble', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'รูปสินค้าค่ะ [[[img_promo]]]',
      objImage: mediaObject,
      imageStorages: twoImages,
    });
    await post([textEvent('ขอดูรูป')]);
    await settle();

    const body = mockedAxios.post.mock.calls[0]![1] as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]!['type']).toBe('image');
    expect(trace.replies).toEqual([]);
    expect(
      trace.logRows.some((r) => r['action_type'] === 'line_reply_image'),
    ).toBe(true);
    // [RULER-20260815-WLOGGOLDEN] frozen for the same reason as the flex arm.
    expect(freezeLogRows(trace.logRows)).toMatchSnapshot();
  });

  /* ── [FIX-20260901-FALLBACKMARKERROW] + [FIX-20260901-MENUKINDMISSING] ────
     An operator wrote `[[[menu_main_00010]]]` into a hook FALLBACK field. Two
     things went wrong at once and both are pinned here, through the real
     `processLockedEvent` — a spec that reimplements the transform proves
     nothing, which an earlier attempt at these cases demonstrated by staying
     green with the fix deleted.

     1. `resolveReplyText` is a pure CHOOSER: it picks `default_answer_text` /
        `ai_generative_error_text` and returns it untouched. The chat row was
        written from that value BEFORE any stripping, so the admin saw brackets.
     2. `FlexCardKind` has carried `'menu'` since 31/08 and the sender reads
        `flexKind === 'menu'`, but nothing ever SET it — the branch was
        unreachable, so no card was ever sent for a menu tag. */
  describe('a menu marker in a hook fallback field', () => {
    const menuHook = () => baseHook({ default_answer_text: MENU_MARKER });

    it('the chat row the admin reads carries NO raw marker', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        hook: menuHook(),
        /* An empty answer with `noData` is what makes the resolver reach for
           the operator's not-found field — the path in the report. */
        aiReplyText: '',
        tagStatus: 'not_found',
      });
      await post([textEvent('อะไรก็ได้ที่ตอบไม่ได้')]);
      await settle();

      const botRows = trace.chatRows.filter((r) => r['senderType'] === 'bot');
      expect(botRows.length).toBeGreaterThan(0);
      for (const row of botRows) {
        expect(String(row['content'])).not.toContain('[[[');
      }
    });

    /* Not blank either: an empty row tells the admin nothing. The first cut of
       this fix fell back to the RAW text on empty, which put the marker
       straight back — the exact bug being closed. */
    it('a marker-only field still writes a readable row', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        hook: menuHook(),
        aiReplyText: '',
        tagStatus: 'not_found',
      });
      await post([textEvent('อะไรก็ได้ที่ตอบไม่ได้')]);
      await settle();

      const botRows = trace.chatRows.filter((r) => r['senderType'] === 'bot');
      for (const row of botRows) {
        expect(String(row['content']).trim()).not.toBe('');
      }
    });

    it('plain fallback copy is stored byte-for-byte — the untouched case', async () => {
      const PLAIN = 'ขออภัยนะคะ ยังตอบเรื่องนี้ไม่ได้';
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        hook: baseHook({ default_answer_text: PLAIN }),
        aiReplyText: '',
        tagStatus: 'not_found',
      });
      await post([textEvent('อะไรก็ได้ที่ตอบไม่ได้')]);
      await settle();

      const botRows = trace.chatRows.filter((r) => r['senderType'] === 'bot');
      expect(botRows.map((r) => String(r['content']))).toContain(PLAIN);
    });

    /* ── [FIX-20260901-MENUKINDMISSING] the half the row fix does NOT cover ──
       A marker-only field strips to `''`, and an empty string is not sendable —
       so removing the brackets alone would leave the customer with nothing at
       all, which is the worse half of the report. What must go out instead is
       the CARD the tag names. These cases are the ones that hold the `'menu'`
       rung in place; without it `flexKind` is null, no card is built, and the
       customer is answered with silence. */
    it('sends the CARD the marker names, not an empty message', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        hook: baseHook({ default_answer_text: MENU_MARKER, group: GROUP_ID }),
        menuCard: MENU_CARD,
        aiReplyText: '',
        tagStatus: 'not_found',
      });
      await post([textEvent('อะไรก็ได้ที่ตอบไม่ได้')]);
      await settle();

      expect(trace.flexReplies).toHaveLength(1);
      // the card's own name, not the tag — what the customer reads in the list
      expect(trace.flexReplies[0]?.altText).toBe('เมนู หลัก');
      expect(JSON.stringify(trace.flexReplies[0]?.contents)).toContain(
        'เลือกเมนู',
      );
    });

    it('addresses the card by the tag it was given', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        hook: baseHook({ default_answer_text: MENU_MARKER, group: GROUP_ID }),
        menuCard: MENU_CARD,
        aiReplyText: '',
        tagStatus: 'not_found',
      });
      await post([textEvent('อะไรก็ได้ที่ตอบไม่ได้')]);
      await settle();

      expect(trace.menuCardQueries).toHaveLength(1);
      expect(trace.menuCardQueries[0]?.['tag']).toBe('menu_main_00010');
    });

    /* ⚠️ The cross-OA guard must survive this rung. A card owned by another
       group is refused by the renderer, and the reply must fall back to the
       existing behaviour — never to that group's card. */
    it('refuses a card another group owns, and sends no card at all', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        hook: baseHook({ default_answer_text: MENU_MARKER, group: GROUP_ID }),
        menuCard: { ...MENU_CARD, group_ids: ['a0d000000000000000000016'] },
        aiReplyText: '',
        tagStatus: 'not_found',
      });
      await post([textEvent('อะไรก็ได้ที่ตอบไม่ได้')]);
      await settle();

      expect(trace.flexReplies).toHaveLength(0);
    });

    /* The customer never saw the marker even before the fix — `resolveReplyTags`
       runs before the send. Pinned so the row fix cannot drift into changing
       what goes out. */
    it('the customer reply carries no marker either', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        hook: menuHook(),
        aiReplyText: '',
        tagStatus: 'not_found',
      });
      await post([textEvent('อะไรก็ได้ที่ตอบไม่ได้')]);
      await settle();

      for (const reply of trace.replies) {
        expect(String(reply)).not.toContain('[[[');
      }
    });
  });

  it('tag but NO object configured → falls through to the plain reply, unchanged', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ดูโปรโมชั่นได้เลยค่ะ [[[img_nothinghere]]]',
      objImage: null,
    });
    await post([textEvent('มีโปรไหม')]);
    await settle();

    expect(mockedAxios.post).not.toHaveBeenCalled();
    // the marker is still stripped from what the customer reads
    expect(trace.replies).toEqual(['ดูโปรโมชั่นได้เลยค่ะ']);
  });

  /* ── [FEAT-20260901-OBJSCOPE] the album lookup is scoped to this OA ──────
     `matching_tag` is not unique (measured on the live database), so before
     this the bot could answer one group's customer with another group's image.
     These cases assert on the FILTER the lookup was called with, which is why
     the stub had to stop discarding it — every case below passed identically
     with and without the scope until then. */
  describe('the album lookup is scoped to the conversation', () => {
    const scopeOf = (filter: unknown) =>
      JSON.stringify((filter as { $and?: unknown[] })?.$and ?? []);

    it('carries the OA and its group into the SAME query, not a second one', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        aiReplyText: 'ดูรูปค่ะ [[[img_promo]]]',
        objImage: null,
        hook: baseHook({ group: GROUP_ID }),
      });
      await post([textEvent('ขอรูป')]);
      await settle();

      // One lookup, not two: the scope is legs on the existing filter.
      expect(trace.objImageFilters).toHaveLength(1);
      const filter = trace.objImageFilters[0] as Record<string, unknown>;
      expect(filter['matching_tag']).toBe('img_promo');
      expect(scopeOf(filter)).toContain(HOOK_ID);
      expect(scopeOf(filter)).toContain(GROUP_ID);
    });

    it('asks for enabled rows only — a switched-off album is not served', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        aiReplyText: 'ดูรูปค่ะ [[[img_promo]]]',
        objImage: null,
        hook: baseHook({ group: GROUP_ID }),
      });
      await post([textEvent('ขอรูป')]);
      await settle();

      /* `$ne: false`, never `true`: rows saved before `status` existed carry no
         key at all, and an equality match would skip every one of them — every
         image the bot has. */
      expect(scopeOf(trace.objImageFilters[0])).toContain('"$ne":false');
    });

    it('an unidentifiable OA skips the lookup entirely rather than running it unscoped', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        aiReplyText: 'ดูรูปค่ะ [[[img_promo]]]',
        objImage: null,
        hook: baseHook({ _id: 'not-an-object-id', group: GROUP_ID }),
      });
      await post([textEvent('ขอรูป')]);
      await settle();

      expect(trace.objImageFilters).toEqual([]);
      // and the customer still gets the sentence, marker stripped
      expect(trace.replies).toEqual(['ดูรูปค่ะ']);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('an in-scope miss sends NO image and no fallback lookup', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        aiReplyText: 'ดูรูปค่ะ [[[img_promo]]]',
        objImage: null,
        hook: baseHook({ group: GROUP_ID }),
      });
      await post([textEvent('ขอรูป')]);
      await settle();

      /* Owner's decision: not found means not sent. One lookup, one answer —
         a second query here would be the fallback that must never exist. */
      expect(trace.objImageFilters).toHaveLength(1);
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(trace.replies).toEqual(['ดูรูปค่ะ']);
    });

    it('a hook with no group still serves, so unscoped albums keep working', async () => {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        aiReplyText: 'ดูรูปค่ะ [[[img_promo]]]',
        objImage: null,
        hook: baseHook({ group: undefined }),
      });
      await post([textEvent('ขอรูป')]);
      await settle();

      expect(trace.objImageFilters).toHaveLength(1);
      expect(scopeOf(trace.objImageFilters[0])).toContain(HOOK_ID);
    });
  });

  it('object exists but has NO images → falls through, no empty carousel', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ดูรูปค่ะ [[[img_promo]]]',
      objImage: flexObject,
      imageStorages: [],
    });
    await post([textEvent('ขอรูป')]);
    await settle();

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(trace.replies).toEqual(['ดูรูปค่ะ']);
  });

  it('LINE rejects the carousel → the customer still gets the sentence', async () => {
    mockedAxios.post.mockRejectedValue(new Error('401 Unauthorized'));
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ดูโปรค่ะ [[[img_promo]]]',
      objImage: flexObject,
      imageStorages: twoImages,
    });
    await post([textEvent('โปร')]);
    await settle();

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    // NO return on failure — the plain reply is the fallback, by design
    expect(trace.replies).toEqual(['ดูโปรค่ะ']);
  });

  it('PRECEDENCE — a flex_profile tag still wins over an image tag', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ข้อมูลคุณค่ะ [[[flex_profile]]] [[[img_promo]]]',
      hook: baseHook({
        flex_profile_id: 'fx-profile',
        custom_tool_id: 'tool-1',
      }),
      flexProfileDoc: {
        _id: 'fx-profile',
        content_json: CARD,
        flex_type: 'profile',
      },
      objImage: flexObject,
      imageStorages: twoImages,
    });
    await post([textEvent('ดูโปรไฟล์')]);
    await settle();

    // the card route owns the answer; the carousel must not preempt it
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(trace.steps).toContain('line.flex');
  });

  it('an ordinary answer with no tag never touches the carousel path', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ยินดีให้บริการค่ะ',
    });
    await post([textEvent('สวัสดี')]);
    await settle();

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(trace.replies).toEqual(['ยินดีให้บริการค่ะ']);
  });
});

/* ════ [RULER-20260815-WLOGGOLDEN] the Telegram "no answer found" branch ═══════
 *
 * The LAST unmigrated write site inside webhook.service: `get_profile`. It sits
 * behind `tagStatus === 'not_found' && telegram_key && telegram_chat_id`, which
 * neither flow harness could reach until `tagStatus` became stageable — so batch
 * B1 deliberately left it alone rather than convert a site nothing measures
 * (`todo/be_todo7_15082026_wlog.md` §3).
 *
 * ⚠️ That row is written by TWO unrelated files under the same action name: this
 *    one (`channel: 'line_api'`, LINE's profile endpoint) and
 *    `external-api.service.ts` (`channel: 'acme_api_get_profile'`, a
 *    different shape). Production holds exactly one row, and it came from the
 *    OTHER writer. Freezing this one is what makes the difference visible.
 *
 * The Telegram notification itself goes out through the same `axios` the file
 * already mocks, so nothing here reaches a network.
 */
describe('[RULER-20260815-WLOGGOLDEN] get_profile (Telegram not_found branch)', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
  });

  it('R1 the branch writes the get_profile row, frozen byte-for-byte', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        telegram_key: 'tg-dead-key',
        telegram_chat_id: '-1001234567890',
      }),
      profileData: LINKED_PROFILE,
      aiReplyText: 'ยังไม่พบข้อมูลค่ะ',
      tagStatus: 'not_found',
    });
    await post([textEvent('ถามอะไรที่ไม่มีในเอกสาร')]);
    await settleLogWrites();

    expect(trace.logRows.some((r) => r['action_type'] === 'get_profile')).toBe(
      true,
    );
    expect(freezeLogRows(trace.logRows)).toMatchSnapshot();
  });

  it('R2 no telegram credentials → the branch stays shut, no get_profile row', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ยังไม่พบข้อมูลค่ะ',
      tagStatus: 'not_found',
    });
    await post([textEvent('ถามอะไรที่ไม่มีในเอกสาร')]);
    await settleLogWrites();

    expect(trace.logRows.some((r) => r['action_type'] === 'get_profile')).toBe(
      false,
    );
  });
});

/* ════ [FEAT-20260815-WLOGDOOR] a failed log write must never reach the customer ══
 *
 * The door swallows its own failures: an audit row that cannot be stored must not
 * stop a reply the customer is waiting for. Older than this refactor; the reason
 * is money.
 *
 * ⚠️ THE FIRST VERSION OF THIS CASE WAS DECORATION, and a mutation proved it.
 * It asserted "the reply still went out" — which stayed true with the try/catch
 * REMOVED, because the reply is sent before that write and the service's outer
 * catch absorbs whatever escapes. Two green runs, zero information.
 *
 * So it now asserts the one thing only the swallow can produce: the error line
 * it writes. Delete the catch and this goes red, because nothing logs that
 * string any more. เทสต้องจับสิ่งที่มีเฉพาะตอนโค้ดถูก ไม่ใช่สิ่งที่จริงอยู่แล้ว.
 */
describe('[FEAT-20260815-WLOGDOOR] a failing log sink is swallowed, and says so', () => {
  it('every write rejects → the door logs its own failure and the reply still goes out', async () => {
    const errors: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((msg: unknown) => {
        errors.push(String(msg));
      });

    try {
      const { trace, post } = buildHarness({
        profileData: LINKED_PROFILE,
        aiReplyText: 'ยินดีให้บริการค่ะ',
        logWriteFails: true,
      });

      await expect(post([textEvent('สวัสดี')])).resolves.toBeUndefined();
      await settleLogWrites();

      // 1. the swallow ran — this string exists ONLY inside the door's catch
      expect(errors.some((e) => e.includes('Webhook log persist failed'))).toBe(
        true,
      );
      // 2. and the customer still got their answer
      expect(trace.replies).toEqual(['ยินดีให้บริการค่ะ']);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * [FEAT-20260824-SLIPRATEPEEK] The paid verification is not bought for a
   * customer whose answer has already been decided.
   *
   * THE FACT THAT MAKES THIS SAFE, and the reason these cases assert on
   * `slip.verify` rather than on anything the customer sees: every branch of the
   * limited path in `webhook.service.ts` RETURNS — hook-off, silent-by-config,
   * and the normal "กรุณารอสักครู่" reply all return before the slip card is
   * built and before payment runs. So a limited customer never saw the result of
   * that verification under the old code either. The purchase was the only
   * difference, and B-RATE-1 is what proves it stopped happening.
   *
   * B-RATE-2 is the one that must never be deleted. While an admin holds the
   * room the limiter is never reached at all, so the counter is frozen wherever
   * it stood when they took over; a customer who tripped it one second earlier
   * would peek as limited for as long as the operator stays. Skipping the verify
   * there would mean a slip sent INTO a live human conversation goes uncredited.
   * ห้องที่คนคุยอยู่ ต้องตรวจทุกใบเหมือนเดิม.
   */
  describe('[SLIPRATEPEEK] a customer already over quota does not get a paid verification', () => {
    it('⭐ B-RATE-1 · over quota, bot answering ⇒ Swiftcheck is NOT called', async () => {
      const { trace, post } = buildHarness({
        rateLimited: true,
        withImageStorage: true,
        profileData: LINKED_PROFILE,
        hook: slipHook(),
      });

      await post([imageEvent()]);

      expect(trace.steps).toContain('rate.peek');
      expect(trace.steps).not.toContain('slip.verify');
      // and the customer still gets exactly what they got before
      expect(trace.replies).toEqual(['กรุณารอสักครู่และลองใหม่อีกครั้ง']);
    });

    it('⭐ B-RATE-2 PIN · over quota but an ADMIN HOLDS THE ROOM ⇒ Swiftcheck IS called', async () => {
      const { trace, post } = buildHarness({
        rateLimited: true,
        withImageStorage: true,
        profileData: LINKED_PROFILE,
        hook: slipHook(),
        room: { _id: 'room-1', assist_status: true },
      });

      await post([imageEvent()]);

      // never even asked — an assisted room is out of scope by construction
      expect(trace.steps).not.toContain('rate.peek');
      expect(trace.steps).toContain('slip.verify');
    });

    it('B-RATE-3 PIN · under quota ⇒ nothing changes, Swiftcheck is called as always', async () => {
      const { trace, post } = buildHarness({
        withImageStorage: true,
        profileData: LINKED_PROFILE,
        hook: slipHook(),
      });

      await post([imageEvent()]);

      expect(trace.steps).toContain('slip.verify');
    });

    it('B-RATE-4 · a hook with slip checking OFF never asks — the read is short-circuited', async () => {
      // The conjunct is last so `&&` stops before it. An OA that does not verify
      // slips must not pay one Redis read per image for a question about work it
      // was never going to do.
      const { trace, post } = buildHarness({
        rateLimited: true,
        withImageStorage: true,
        profileData: LINKED_PROFILE,
        hook: slipHook({ slip_check: false }),
      });

      await post([imageEvent()]);

      expect(trace.steps).not.toContain('rate.peek');
      expect(trace.steps).not.toContain('slip.verify');
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
   [FLOWTEST-20261014-LOANV1FLOW] THE LOAN SITE THROUGH THE REAL SPINE
   ═══════════════════════════════════════════════════════════════════════════════════════
   Until now no webhook-level case used the loan custom tool — the custom-tool stub answered
   `extractProfile: () => null`. These rows hand the spine the loan tool (seed bundle) and the
   combined data its REAL engine produced from the partner's REAL answers
   (`z-test/lib/loan-v1-upstream.ts`), with the loan_v1 provider bound as the loan deployment
   binds it at boot. AI is the stub (no key fired); LINE is the trace (no send). */
describe('[LOANV1FLOW] the loan site — real tool, real answers, real spine', () => {
  const LOAN = buildCustomerProviderRegistry().get('loan_v1')!;
  const loanHook = (over: Record<string, unknown> = {}) =>
    baseHook({
      custom_tool_status: true,
      custom_tool_id: 'loan-tool',
      ...over,
    });
  const REAL_CONTRACT = (
    LOAN_FIXTURE['CUSTOMER_PROFILE']!.success.body as {
      data: { contract: { contract_number: string } };
    }
  ).data.contract.contract_number;

  beforeEach(() => bindActiveProvider(LOAN));
  afterEach(() => resetActiveProvider());

  it('LF1 · a linked loan customer: the model is handed every endpoint the tool fetched', async () => {
    const combined = await loanCombined('linked');
    const { trace, post } = buildHarness({
      hook: loanHook(),
      customTool: { tool: LOAN_TOOL, combined },
      aiReplyText: 'ยอดงวดนี้ตามข้อมูลครับ',
    });
    await post([textEvent('งวดนี้ต้องจ่ายเท่าไหร่')]);
    expect(trace.aiRequests).toHaveLength(1);
    const handed = trace.aiRequests[0]!.profileData as Record<
      string,
      { success?: boolean }
    >;
    for (const key of Object.keys(LOAN_FIXTURE)) {
      expect({ key, success: handed[key]?.success }).toEqual({
        key,
        success: true,
      });
    }
    expect(trace.replies.join(' ')).toContain('ยอดงวดนี้ตามข้อมูลครับ');
  });

  it('LF2 · the customer-register keyword is ordinary text on a loan site — no link minted', async () => {
    const { trace, post } = buildHarness({
      hook: loanHook({ customer_link_enabled: true }),
      customTool: { tool: LOAN_TOOL, combined: await loanCombined('linked') },
      aiReplyText: 'ตอบตามปกติ',
    });
    await post([textEvent('customer-register')]);
    expect(trace.steps).not.toContain('mint');
    expect(trace.aiRequests).toHaveLength(1);
  });

  it('🔴 LF2-PIN · the same keyword on shop-api (provider unbound) still mints the link', async () => {
    resetActiveProvider();
    bindActiveProvider(DEFAULT_CUSTOMER_PROVIDER);
    const { trace, post } = buildHarness({
      hook: baseHook({ customer_link_enabled: true }),
      profileData: LINKED_PROFILE,
      aiReplyText: 'ตอบตามปกติ',
    });
    await post([textEvent('customer-register')]);
    expect(trace.steps).toContain('mint');
    expect(trace.aiRequests).toHaveLength(0);
  });

  it('LF3 · a verified slip from a linked loan customer hands the callback the REAL contract number', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook({ custom_tool_status: true, custom_tool_id: 'loan-tool' }),
      customTool: { tool: LOAN_TOOL, combined: await loanCombined('linked') },
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
    });
    await post([imageEvent()]);
    expect(trace.slipCallbacks).toHaveLength(1);
    /* the value comes from the tool's own profile_map.code, through the spine, to the callback */
    expect(trace.slipCallbacks[0]!['contractCode']).toBe(REAL_CONTRACT);
  });

  /* [FEAT-20261019-CALLBACKLINEPROFILE] the name and picture the callback reports are the
     ones the spine already fetched for this turn — through `syncMemberProfile`, onto
     `profileForLog`, through the door, to the callback. No second LINE call. */
  it('🔴 LF3b · the slip callback carries the LINE profile the turn already fetched', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook({ custom_tool_status: true, custom_tool_id: 'loan-tool' }),
      customTool: { tool: LOAN_TOOL, combined: await loanCombined('linked') },
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
      lineProfile: {
        userId: 'U-flow',
        displayName: 'Flow LINE Name',
        pictureUrl: 'https://profile.line-scdn.net/flow',
      },
    });
    await post([imageEvent()]);
    expect(trace.slipCallbacks).toHaveLength(1);
    expect(trace.slipCallbacks[0]!['lineProfile']).toMatchObject({
      displayName: 'Flow LINE Name',
      pictureUrl: 'https://profile.line-scdn.net/flow',
    });
  });

  it('LF3c · LINE gave no profile ⇒ the callback still fires, with the empty profile', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook({ custom_tool_status: true, custom_tool_id: 'loan-tool' }),
      customTool: { tool: LOAN_TOOL, combined: await loanCombined('linked') },
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
    });
    await post([imageEvent()]);
    expect(trace.slipCallbacks).toHaveLength(1);
    expect(trace.slipCallbacks[0]!['lineProfile']).toEqual({});
  });

  it('LF4 · an unlinked loan customer’s slip is refused before verification (real 404)', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook({
        custom_tool_status: true,
        custom_tool_id: 'loan-tool',
        slip_require_profile: true,
      }),
      customTool: { tool: LOAN_TOOL, combined: await loanCombined('unlinked') },
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', content_json: CARD },
    });
    await post([imageEvent()]);
    expect(trace.slipVerifyInputs).toHaveLength(0);
    expect(trace.slipCallbacks).toHaveLength(0);
  });
});
