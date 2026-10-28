import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { freezeLogRows, settleLogWrites } from '../lib/freeze-log-rows';

/* [FEAT-20260902-NOWBLOCK] the ON lever for the seat cases at the bottom of this
   file. A DEEP path on purpose (same shape as broadcast-new-path-switch.spec.ts:19):
   the door imports `./now-block.mode` directly, so a spy placed on the barrel would
   be a different binding and the door would never see it. Test-only; the layering
   rule is about production code. */
/* eslint-disable-next-line no-restricted-imports */
import * as nowBlockMode from '@/modules/webhook/now-block/now-block.mode';

import {
  AiProviderUnavailableError,
  AssistSummaryUnavailableError,
  type AiReplyRequest,
  type AssistDeps,
  triggerAssistNotification,
  ScriptedAssistSummaryProvider,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';

/**
 * The ingest pipeline's CONTROL FLOW — which terminal each inbound event
 * reaches, and in what order the things on the way to it happen.
 *
 * WHY THIS EXISTS AS A UNIT TEST
 * `POST /webhook` always answers 200 "OK", before any of this runs. There is no
 * HTTP surface to assert against, so the only observable behaviour is the set of
 * side effects — and the only way to check the ORDER of those side effects
 * (which is the part legacy encodes as 2,650 lines of straight-line control
 * flow) is to record them as they are attempted.
 *
 * Every collaborator is a recorder. No Mongo, no Redis, no LINE, and — the point
 * of the whole exercise — no model. `aiReply.generate` records the request it
 * was handed and then REJECTS, exactly as the shipped binding does, so the tests
 * that prove the AI branch is reached also prove nothing is billed to reach it.
 */

const CHANNEL_SECRET = 'unit-test-channel-secret';
const HOOK_ID = 'a0d000000000000000000014';
const USER_ID = 'Uwh7unit0000000000000000000000001';

/** Every side effect the pipeline attempts, in the order it attempts them. */
interface Trace {
  steps: string[];
  aiRequests: AiReplyRequest[];
  replies: string[];
  logRows: Array<Record<string, unknown>>;
  chatRows: Array<Record<string, unknown>>;
  roomUpdates: Array<Record<string, unknown>>;
  assignHistories: Array<Record<string, unknown>>;
  /* [FIX-20260812-REFUSEDMARKERS] tickets created by `runAssistGuarded`. The stub
     used to expose only `findOne`, so no test in this file could tell whether a
     ticket was actually raised — a blind spot that hid a real bug. */
  ticketsCreated: Array<Record<string, unknown>>;
  // [FIX-20260808-SLIPFLOW] the slip verify inputs and callback inputs recorded.
  slipVerifyInputs: Array<Record<string, unknown>>;
  slipCallbacks: Array<Record<string, unknown>>;
  // Every LINE flex reply the slip branch sent, as {altText, contents}.
  flexReplies: Array<{ altText: string; contents: unknown }>;
  // [FEAT-20260808-GROUPB-FLEXHISTORY] every chatMessage.updateOne {filter,update}.
  chatUpdates: Array<{ filter: unknown; update: Record<string, unknown> }>;
  // [FEAT-20260808-GROUPB-FLEXHISTORY] every realtime publish {type,data}.
  realtimeEvents: Array<{ type: string; data: Record<string, unknown> }>;
}

/**
 * A Mongoose query stub: every chainable method returns itself and the chain
 * resolves to `result`. Enough for `findOne().lean().exec()`,
 * `find().sort().limit().lean().exec()` and `updateOne().exec()` alike.
 */
function query(result: unknown): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of ['sort', 'limit', 'lean', 'select', 'populate']) {
    q[m] = () => q;
  }
  q['exec'] = () => Promise.resolve(result);
  q['then'] = (res: (v: unknown) => unknown) =>
    Promise.resolve(result).then(res);
  return q;
}

interface HarnessOptions {
  hook?: Record<string, unknown>;
  /**
   * [FEAT-20260905-MULTIEVENT] `WEBHOOK_MULTI_EVENT`, injected rather than read from the
   * environment. Default `false` = the behaviour every case below was written against.
   * A case that wants the loop asks for it here, so the flag is never global state that
   * one test can leave switched on for the next.
   */
  multiEvent?: boolean;
  /** The room `findOne` resolves to — the assist state. */
  room?: Record<string, unknown> | null;
  /** The newest customer message in that room — drives auto-unassist. */
  lastCustomerMsg?: Record<string, unknown> | null;
  rateLimited?: boolean;
  /** What the combined external fetch resolves to. */
  profileData?: Record<string, unknown>;
  // [FIX-20260808-SLIPFLOW] canned SlipFlowService.verifySlip result. When set,
  // `imageStorageModel.findById` also resolves a storage row so the Swiftcheck gate
  // (which needs `file_path`) can fire.
  slipVerifyResult?: Record<string, unknown>;
  /** The FlexMessage.findById result the slip flex branch resolves. */
  flexDoc?: Record<string, unknown> | null;
  /** The QrVisionService.checkIfSlipWithQrCode return for the VALIDATION path. */
  qrIsSlip?: boolean;
  /** When true, downloadAndSaveImage yields a storage id + row. */
  withImageStorage?: boolean;
  /**
   * [FEAT-20260812-QRPRESCAN] override the staged row's `file_path` so the pre QR
   * check reads a REAL image instead of the non-existent `/tmp/slip.jpg`. Without
   * this the reader always answers `undecodable`, which fails open and can never
   * exercise the `no_qr` branch.
   */
  imageFilePath?: string;
  /** [FIX-20260812-REFUSEDMARKERS] stage a member row so assist can raise a ticket. */
  withMemberRow?: boolean;
  // [FEAT-20260808-GROUPB-FLEXHISTORY] a SCRIPTED AI reply text — when set,
  // aiReply.generate resolves it (no billing) so the AI-reply branch runs.
  aiReplyText?: string;
  // [FEAT-20260808-GROUPB-FLEXHISTORY] the profile flex card FlexMessage.findOne
  // resolves for the AI-reply flex build.
  flexProfileDoc?: Record<string, unknown> | null;
  /* [FIX-20260830-STABLEPIN] review-found blind spots: the harness could never
     stage REAL prior messages (find was hardcoded []) nor a failing room
     lookup, so the opt-out's real-history branch and the §5.4 error-path strip
     were untestable. Both opt-in — absent keeps every older case byte-same. */
  historyMsgs?: Array<{ sender_type?: string; content?: unknown }>;
  roomLookupRejects?: boolean;
}

/** A combined-data result that resolves a customer name, so the N/A guard passes. */
const LINKED_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'สมชาย ทดสอบ', customer_tel: '0800000000' },
    },
  },
};

function baseHook(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: 'wh7unit',
    // Explicit on every field the pipeline branches on — the fixture rule.
    status: 1,
    channel_secret: CHANNEL_SECRET,
    // Syntactically valid and DEAD: every outbound LINE call 401s, so nothing
    // reaches a real person while every upstream DB write still happens.
    access_token: 'wh7unit-dead-access-token',
    channel_type: 'line',
    slip_check: false,
    // ⚠️ custom_ai_key UNSET. With it set, the masked value would still never
    //    leave this process — but leaving it unset is the belt to that brace.
    auto_unassist_minutes: 30,
    ...over,
  };
}

function buildHarness(opts: HarnessOptions = {}): {
  service: WebhookService;
  trace: Trace;
  post: (
    events: unknown[],
    over?: { signature?: string; alias?: string },
  ) => Promise<void>;
} {
  const hook = opts.hook ?? baseHook();
  const trace: Trace = {
    steps: [],
    aiRequests: [],
    replies: [],
    logRows: [],
    chatRows: [],
    roomUpdates: [],
    assignHistories: [],
    ticketsCreated: [],
    slipVerifyInputs: [],
    slipCallbacks: [],
    flexReplies: [],
    chatUpdates: [],
    realtimeEvents: [],
  };

  const hookModel = { findOne: () => query(hook) };
  const chatRoomModel = {
    findOne: () =>
      opts.roomLookupRejects
        ? { lean: () => ({ exec: () => Promise.reject(new Error('boom')) }) }
        : query(opts.room ?? null),
    /* [FIX-20260812-REFUSEDMARKERS] `runAssistGuarded` claims the room with an
       atomic `findOneAndUpdate({assist_status: {$ne: true}})` and STOPS when it
       returns null. The stub had no such method, so the claim always failed and no
       test in this file could observe a ticket — the blind spot that let a real
       "assist runs but no ticket" bug through. Opt-in, so existing tests are
       untouched. */
    findOneAndUpdate: (_f: unknown, update: unknown) => {
      trace.steps.push('room.findOneAndUpdate');
      trace.roomUpdates.push(update as Record<string, unknown>);
      return query(opts.withMemberRow ? { _id: 'room1' } : null);
    },
    updateOne: (_filter: unknown, update: unknown) => {
      trace.steps.push('room.updateOne');
      trace.roomUpdates.push(update as Record<string, unknown>);
      return query({ acknowledged: true });
    },
  };
  const chatMessageModel = {
    findOne: () => query(opts.lastCustomerMsg ?? null),
    find: () => query(opts.historyMsgs ?? []),
    // [FEAT-20260808-GROUPB-FLEXHISTORY] record the flex-history / helper-history
    // patch so a test can assert the `$set` shape.
    updateOne: (filter: unknown, update: Record<string, unknown>) => {
      trace.steps.push('chat.updateOne');
      trace.chatUpdates.push({ filter, update });
      return query({ acknowledged: true });
    },
  };
  const memberModel = {
    /* [FIX-20260812-REFUSEDMARKERS] a ticket needs BOTH a chat message id and a
       member `_id`; with no member row assist silently creates nothing. Opt-in so
       every existing test keeps the old null behaviour. */
    findOne: () => query(opts.withMemberRow ? { _id: 'member1' } : null),
    updateOne: () => {
      trace.steps.push('member.updateOne');
      return query({ acknowledged: true });
    },
  };
  const assignHistoryModel = {
    create: (doc: Record<string, unknown>) => {
      trace.steps.push('assignHistory.create');
      trace.assignHistories.push(doc);
      return Promise.resolve(doc);
    },
  };
  const ticketModel = {
    findOne: () => query(null),
    /* [FIX-20260812-REFUSEDMARKERS] assist creates the ticket through this. */
    create: (doc: Record<string, unknown>) => {
      trace.steps.push('ticket.create');
      trace.ticketsCreated.push(doc);
      return Promise.resolve({ _id: 'ticket1', ...doc });
    },
  };
  const objectImageModel = { findOne: () => query(null) };
  const imageStorageModel = {
    // [FIX-20260808-SLIPFLOW] a slip test stages a storage row with a
    // `file_path`, which the Swiftcheck gate requires.
    findById: () =>
      query(
        opts.slipVerifyResult || opts.withImageStorage
          ? {
              _id: 'store1',
              image_url: '/uploads/slip.jpg',
              file_path: opts.imageFilePath || '/tmp/slip.jpg',
            }
          : null,
      ),
    find: () => query([]),
  };

  const crypto = {
    // The fixture stores plaintext; safeDecrypt on a non-`enc:` value is
    // identity in the real service too.
    safeDecrypt: (v: string | null | undefined) => v ?? null,
  };
  const hookCache = {
    getHookByAliasWithSource: () =>
      Promise.resolve({ hook, source: 'cache' as const }),
    cacheHook: () => Promise.resolve(),
    getHookByAlias: () => Promise.resolve(hook),
  };
  const chatHistory = {
    logMessage: (input: Record<string, unknown>) => {
      trace.steps.push(`chat.logMessage:${String(input['senderType'])}`);
      trace.chatRows.push(input);
      return Promise.resolve({ _id: 'msg1', room_id: 'room1' });
    },
  };
  const lineApi = {
    sendLineReplyMessage: (_t: string, _r: string, text: string) => {
      trace.steps.push('line.reply');
      trace.replies.push(text);
      // A dead token 401s. Legacy lets that rejection escape on most reply
      // paths, so the stub must reject too or the tests would exercise a
      // success path that cannot happen with the fixture.
      return Promise.reject(
        Object.assign(new Error('Request failed with status code 401'), {
          response: { status: 401, data: { message: 'Authentication failed' } },
        }),
      );
    },
    // [FIX-20260808-SLIPFLOW] the slip flex card send. Records altText+contents
    // and RESOLVES (a real card send succeeds), unlike the dead text reply, so
    // the branch reaches `isFlexSent = true` and the callback + return.
    sendLineFlexReply: (
      _t: string,
      _r: string,
      contents: unknown,
      altText: string,
    ) => {
      trace.steps.push('line.flex');
      trace.flexReplies.push({ altText, contents });
      return Promise.resolve({ status: 200, data: { sentMessages: [] } });
    },
    sendLineLoadingIndicator: () => {
      trace.steps.push('line.loading');
      return Promise.resolve(undefined);
    },
    getLineProfile: () => {
      trace.steps.push('line.getProfile');
      return Promise.resolve(null);
    },
  };
  const lineContent = {
    downloadAndSaveImage: () => {
      trace.steps.push('media.image');
      // [FIX-20260808-SLIPFLOW] a slip test needs a stored image id so the
      // Swiftcheck/flex branch runs; other cases keep the null (no-store) path.
      return Promise.resolve(
        opts.slipVerifyResult || opts.withImageStorage ? 'store1' : null,
      );
    },
    downloadAndSaveVideo: () => {
      trace.steps.push('media.video');
      return Promise.resolve(null);
    },
  };
  const webhookLogs = {
    createLog: (row: Record<string, unknown>) => {
      trace.steps.push(`log:${String(row['action_type'])}`);
      trace.logRows.push(row);
      return Promise.resolve(row);
    },
  };
  const externalApi = {
    getCombinedData: () => {
      trace.steps.push('profile.fetch');
      return Promise.resolve(opts.profileData ?? {});
    },
  };
  const customTool = {
    getCombinedData: () => Promise.resolve({}),
    getToolForHook: () => Promise.resolve(null),
    extractProfile: () => ({ name: 'N/A', phone: 'N/A', code: 'N/A' }),
  };
  const rateLimit = {
    consume: () => {
      trace.steps.push('ratelimit.consume');
      return Promise.resolve({
        limited: opts.rateLimited === true,
        current: 1,
        limit: 2,
        windowSeconds: 30,
      });
    },
    /* [FEAT-20260824-RATEPEEK] read-only twin — the service asks it before
       spending a paid slip verification. Never writes, so it is stubbed
       separately from `consume`. */
    peek: () => {
      trace.steps.push('ratelimit.peek');
      return Promise.resolve({
        limited: opts.rateLimited === true,
        level: 1,
        current: null,
        limit: 3,
      });
    },
  };
  // No Redis: `getClient` throwing is the documented in-memory fallback path.
  const redis = {
    getClient: () => {
      throw new Error('no redis in unit test');
    },
  };
  const aiReply = {
    generate: (req: AiReplyRequest) => {
      trace.steps.push('ai.generate');
      trace.aiRequests.push(req);
      // [FEAT-20260808-GROUPB-FLEXHISTORY] a SCRIPTED (not billed) reply — the
      // same seam ScriptedAiReplyProvider uses. When a test stages
      // `opts.aiReplyText`, resolve it so the AI-reply flex/text branch runs;
      // otherwise keep the production reject (no provider bound).
      if (opts.aiReplyText !== undefined) {
        return Promise.resolve({
          text: opts.aiReplyText,
          noData: false,
          tagStatus: null,
        });
      }
      return Promise.reject(new AiProviderUnavailableError());
    },
  };

  const service = new WebhookService(
    hookModel as never,
    chatRoomModel as never,
    chatMessageModel as never,
    memberModel as never,
    assignHistoryModel as never,
    ticketModel as never,
    objectImageModel as never,
    imageStorageModel as never,
    crypto as never,
    hookCache as never,
    chatHistory as never,
    lineApi as never,
    lineContent as never,
    webhookLogs as never,
    externalApi as never,
    customTool as never,
    rateLimit as never,
    redis as never,
    aiReply,
    // The assist-summary seam. Rejecting is its bound production behaviour, so
    // this exercises the same fallback path the running service takes.
    {
      summarise: () => {
        trace.steps.push('assist.summarise');
        return Promise.reject(new AssistSummaryUnavailableError());
      },
    },
    // `acme_category` absent → the flag reads false, as it does by default.
    { getConfigByKey: () => Promise.resolve(null) } as never,
    {
      telegramWebhookSecret: undefined,
      multiEventDelivery: opts.multiEvent === true,
    },
    { geminiApiKey: undefined, modelId: 'gemini-3.5-flash' } as never,
    { ignoreDocId: undefined } as never,
    // [FIX-20260808-ASSISTTICKETRT] realtime publisher — records the ticket:new
    // emit so this control-flow suite stays a recorder. No socket.
    {
      publish: (type: string, data: Record<string, unknown>) => {
        trace.steps.push(`realtime.${type}`);
        trace.realtimeEvents.push({ type, data });
        return Promise.resolve();
      },
    } as never,
    // [FIX-20260808-CUSTREG] CustomerLinkService — only used by the register
    // keyword path, which these cases do not trigger. A recording stub.
    {
      mintLinkToken: () => {
        trace.steps.push('customerLink.mintLinkToken');
        return { url: 'https://link.test/x', token: 'tok', expiresAt: 0 };
      },
    } as never,
    // [FIX-20260808-FLEXBUILDER] FlexMessage model — the card lookup. These
    // control-flow cases never resolve a card, so findOne returns null.
    // [FIX-20260808-SLIPFLOW] findById resolves the staged slip card.
    {
      // [FEAT-20260808-GROUPB-FLEXHISTORY] the AI-reply flex path looks the
      // profile card up by _id via findOne; stage it with opts.flexProfileDoc.
      findOne: () => query(opts.flexProfileDoc ?? null),
      findById: () => query(opts.flexDoc ?? null),
    } as never,
    // [FIX-20260808-FLEXBUILDER] TranslationDictCacheService — translate stub.
    {
      translate: (_d: string, k: string | number | null) => `${k ?? ''}`,
    } as never,
    // [FIX-20260808-SLIPFLOW] SlipFlowService — records the Swiftcheck verify and
    // the callback, and returns whatever the fixture staged. NEVER hits Swiftcheck.
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
    // [FIX-20260808-SLIPFLOW] QrVisionService — the Gemini seam. Returns the
    // staged boolean, records the call, and NEVER issues a generateContent
    // request. A test that reaches this proves nothing is billed to reach it.
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
    /* [FEAT-20260828-PUSHCORE-A1] `LinePushDispatcher`. The slip-flex card send
       moved onto the push core, so it no longer reaches the `lineApi` double
       above. This one MIRRORS that double exactly rather than being convenient:
         · flex  → resolves, so the branch still reaches `isFlexSent = true`
         · text  → answers `{ok:false}` carrying the SAME 401 axios error, which
                   `replyViaCore` rethrows — reproducing the dead-token rejection
                   the old stub produced. A double that resolved everything would
                   quietly move these cases onto a success path the fixture
                   cannot actually reach.
       สร้าง double ให้เหมือนของเดิม ไม่ใช่ให้เทสผ่านง่าย */
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
            data: { sentMessages: [] },
          });
        }
        trace.steps.push('line.reply');
        trace.replies.push(typeof m?.['text'] === 'string' ? m['text'] : '');
        return Promise.resolve({
          ok: false,
          status: 401,
          attempts: 1,
          durationMs: 0,
          reason: 'HTTP 401',
          raw: Object.assign(new Error('Request failed with status code 401'), {
            response: {
              status: 401,
              data: { message: 'Authentication failed' },
            },
          }),
        });
      },
    } as never,
  );

  const post = async (
    events: unknown[],
    over: { signature?: string; alias?: string } = {},
  ): Promise<void> => {
    const body = { destination: 'Uwh7', events };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: `/${over.alias ?? 'wh7unit'}/webhook`,
      rawBody: raw,
      signature:
        over.signature ??
        createHmac('SHA256', CHANNEL_SECRET).update(raw).digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(
      body,
      hook,
      'cache',
      over.alias ?? 'wh7unit',
      meta,
    );
  };

  return { service, trace, post };
}

// ── event fixtures ──────────────────────────────────────────────────────────

const now = (): number => Date.now();

function textEvent(text = 'สวัสดี'): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-text',
    replyToken: 'rt-text',
    timestamp: now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'm1', text },
  };
}

function typedEvent(type: string): Record<string, unknown> {
  return {
    type,
    eventId: `ev-${type}`,
    // follow carries one; unfollow does NOT — that asymmetry is the whole point
    // of [FIX-20260728-REPLYTOKEN].
    ...(type === 'unfollow' ? {} : { replyToken: `rt-${type}` }),
    timestamp: now(),
    source: { type: 'user', userId: USER_ID },
  };
}

function messageEvent(messageType: string): Record<string, unknown> {
  return {
    type: 'message',
    eventId: `ev-${messageType}`,
    replyToken: `rt-${messageType}`,
    timestamp: now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: messageType, id: `m-${messageType}` },
  };
}

// ── the tests ───────────────────────────────────────────────────────────────

describe('webhook ingest — which terminal each event reaches', () => {
  it('an empty events array does nothing at all — not even a log row', async () => {
    const { trace, post } = buildHarness();
    await post([]);
    // legacy:2321-2322 returns BEFORE the incoming webhook_log is written.
    expect(trace.steps).toEqual([]);
  });

  it('a bad signature stops after the incoming log, before any work', async () => {
    const { trace, post } = buildHarness();
    await post([textEvent()], { signature: 'not-the-right-signature' });
    // The raw payload is logged (legacy:2346, above the check); nothing else.
    expect(trace.steps).toEqual(['log:incoming_line_webhook']);
    expect(trace.chatRows).toHaveLength(0);
    expect(trace.aiRequests).toHaveLength(0);
  });

  it('WITH THE SWITCH OFF, only events[0] is processed — a batch of three logs one message', async () => {
    const { trace, post } = buildHarness();
    await post([
      messageEvent('sticker'),
      textEvent('second'),
      textEvent('third'),
    ]);
    /* The sticker is stored and answered with silence; the two texts behind it are
       DISCARDED. [FEAT-20260905-MULTIEVENT] This case used to assert a property of the
       system; it now asserts a property of the switch, and it is the proof that the
       default is byte-identical to the world before the loop existed. The only thing
       that changed is that the discard is no longer silent — see the warn case below. */
    expect(trace.chatRows).toHaveLength(1);
    expect(trace.chatRows[0]!['messageType']).toBe('sticker');
    expect(trace.aiRequests).toHaveLength(0);
  });

  /**
   * [FEAT-20260905-MULTIEVENT] The loop, through the REAL spine.
   *
   * 📖 PLAN: `todo/task/05092026/webhook_multi_event_design.md` (track B).
   *
   * WHY THESE CASES ASSERT CONTENT AND ORDER, NEVER COUNTS ALONE. The bug a naive loop
   * produces is processing `events[0]` N times, and chat dedup (`provider_msg_id`) HIDES
   * it: the duplicate rows are skipped, so a count-only assertion passes while the quota
   * was charged twice and the customer was answered twice. Only the CONTENT of the rows,
   * in order, can tell "three different messages" from "one message three times".
   */
  describe('[FEAT-20260905-MULTIEVENT] the switch on', () => {
    it('processes every event in the batch, in the order LINE sent them', async () => {
      const { trace, post } = buildHarness({ multiEvent: true });
      await post([
        messageEvent('sticker'),
        textEvent('second'),
        textEvent('third'),
      ]);
      // Content, not counts: a re-clobbered loop stores the sticker three times.
      expect(trace.chatRows.map((r) => r['content'])).toEqual([
        '[sticker]',
        'second',
        'third',
      ]);
      expect(trace.chatRows.map((r) => r['messageType'])).toEqual([
        'sticker',
        'text',
        'text',
      ]);
    });

    it('writes exactly ONE incoming_line_webhook row, and it carries the whole delivery', async () => {
      /* The accounting contract. One row per delivery is what makes the webhook_logs
         count mean "deliveries"; a row per event would silently redefine every historical
         number. The row must also carry the FULL body — a per-event slice would turn the
         only record of what LINE sent into a summary of it. */
      const { trace, post } = buildHarness({ multiEvent: true });
      await post([messageEvent('sticker'), textEvent('second')]);

      const incoming = trace.logRows.filter(
        (r) => r['action_type'] === 'incoming_line_webhook',
      );
      expect(incoming).toHaveLength(1);
      expect(
        (incoming[0]!['raw_request'] as { events: unknown[] }).events,
      ).toHaveLength(2);
    });

    it('stops at the cap and says so — the drop is never silent', async () => {
      // A dropped event is a customer message lost forever: the 200 went out long ago and
      // LINE does not redeliver. The warn is the only audit trail there will ever be.
      const warns: string[] = [];
      const { trace, service, post } = buildHarness({ multiEvent: true });
      jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation((m: unknown) => void warns.push(String(m)));

      await post([
        textEvent('one'),
        textEvent('two'),
        textEvent('three'),
        textEvent('four'),
        textEvent('five'),
        textEvent('six'),
        textEvent('seven'),
      ]);

      expect(trace.chatRows.map((r) => r['content'])).toEqual([
        'one',
        'two',
        'three',
        'four',
        'five',
      ]);
      const capWarn = warns.filter((w) => w.includes('[EVENTCAP]'));
      expect(capWarn).toHaveLength(1);
      expect(capWarn[0]).toContain('carried 7 events');
      expect(capWarn[0]).toContain('dropped 2');
    });

    it('an empty delivery still does nothing at all — not even a log row', async () => {
      // The LINE "Verify" button posts `events: []`. The guard that answers it sits above
      // the loop and above the lock, and this proves the loop did not move it.
      const { trace, post } = buildHarness({ multiEvent: true });
      await post([]);
      expect(trace.steps).toEqual([]);
    });
  });

  it('WITH THE SWITCH OFF, the discard is announced instead of silent', async () => {
    /* The defect this feature exists to fix is not "events are dropped" — it is that they
       were dropped WITHOUT A TRACE. That half is fixed in both modes: even with the loop
       switched off, a batched delivery now says what it threw away. This is what lets the
       owner learn whether batches happen at all before deciding to flip the switch. */
    const warns: string[] = [];
    const { service, post } = buildHarness();
    jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation((m: unknown) => void warns.push(String(m)));

    await post([textEvent('first'), textEvent('second')]);

    const batchWarn = warns.filter((w) => w.includes('[EVENTBATCH]'));
    expect(batchWarn).toHaveLength(1);
    expect(batchWarn[0]).toContain('carried 2 events');
  });

  it.each([['sticker'], ['file'], ['video'], ['audio']])(
    '%s is stored and then silent — and IS charged quota (owner 21/08: นับทุก event, เงียบเหมือนเดิม)',
    async (type) => {
      const { trace, post } = buildHarness();
      await post([messageEvent(type)]);
      expect(trace.chatRows.map((r) => r['senderType'])).toEqual(['customer']);
      expect(trace.replies).toHaveLength(0);
      /* [FEAT-20260821-RATELADDER] The silent-type gate still sits ABOVE the
         limiter — but it now charges the window itself, exactly once, before its
         unconditional return. Before 21/08 these four types cost nothing; the
         owner asked for every event to count and for these to stay silent. */
      expect(trace.steps.filter((s) => s === 'ratelimit.consume')).toHaveLength(
        1,
      );
      expect(trace.aiRequests).toHaveLength(0);
    },
  );

  it('an image with no image_answer_text is stored and answered with nothing', async () => {
    const { trace, post } = buildHarness();
    await post([messageEvent('image')]);
    expect(trace.steps).toContain('media.image');
    expect(trace.chatRows.map((r) => r['senderType'])).toEqual(['customer']);
    expect(trace.replies).toHaveLength(0);
    expect(trace.aiRequests).toHaveLength(0);
  });

  it('an image WITH image_answer_text is answered with it, assist tag stripped', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ image_answer_text: 'ได้รับรูปแล้วค่ะ [[[assist]]]' }),
      profileData: LINKED_PROFILE,
    });
    await post([messageEvent('image')]);
    expect(trace.replies).toEqual(['ได้รับรูปแล้วค่ะ']);
    expect(trace.aiRequests).toHaveLength(0);
  });

  /**
   * ⚠️ The N/A guard (legacy:3767) sits ABOVE the image_answer_text reply, so a
   *    customer who has not linked an account gets `missing_api_data_text` and
   *    NOT the image answer — even though the OA configured one. Surprising, and
   *    reproduced deliberately: an OA that relies on image_answer_text reaching
   *    unregistered customers is relying on something legacy does not do.
   */
  it('an unlinked customer gets missing_api_data_text instead of image_answer_text', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        image_answer_text: 'ได้รับรูปแล้วค่ะ',
        missing_api_data_text: 'กรุณาผูกบัญชีก่อนค่ะ',
      }),
    });
    await post([messageEvent('image')]);
    expect(trace.replies).toEqual(['กรุณาผูกบัญชีก่อนค่ะ']);
  });

  it.each([['follow'], ['unfollow'], ['join'], ['leave']])(
    '%s carries no text and stops at the no-text gate',
    async (type) => {
      const { trace, post } = buildHarness();
      await post([typedEvent(type)]);
      expect(trace.chatRows.map((r) => r['senderType'])).toEqual(['customer']);
      expect(trace.replies).toHaveLength(0);
      expect(trace.aiRequests).toHaveLength(0);
    },
  );

  /* ⚠️⚠️ CHANGED 31/08/2026 — [FIX-20260831-NOPOSTBACKROW], a DELIBERATE
     divergence from legacy, kept visible rather than quietly rewritten.
     ────────────────────────────────────────────────────────────────────────
     This case used to read "a postback is stored but its data is NOT read as
     user text" and pinned `chatRows[0].content === 'action=buy&item=1'` — legacy
     wrote the payload into `chat_messages` as a customer row.

     That surfaced for real 31/08: the ticket chat filled up with rows reading
     `{{paylink.contact_admin}}` — a machine payload, raw variable name and
     all, displayed as if the customer had typed it. Owner: postback ห้ามเก็บ
     เข้าประวัติ. A button press is not a message, so no row.

     The HALF of this case that was never about storage is unchanged and still
     asserted: `postback.data` must never reach the model. */
  it('a postback is NOT stored, and its data still never reaches the model', async () => {
    const { trace, post } = buildHarness();
    await post([
      {
        ...typedEvent('postback'),
        postback: { data: 'action=buy&item=1' },
      },
    ]);
    expect(trace.chatRows).toHaveLength(0);
    // ⚠️ It must NOT reach the model. `postback.data` is machine input.
    expect(trace.aiRequests).toHaveLength(0);
    expect(trace.replies).toHaveLength(0);
  });

  it('⭐⭐ a MESSAGE event is still stored — only the postback is exempt', async () => {
    /* the guard must key on the event TYPE and nothing else: a text that
       happens to look like a payload is still something a customer typed. */
    const { trace, post } = buildHarness();
    await post([
      {
        ...textEvent(),
        message: { type: 'text', text: 'menu:v1:open:x', id: 'm1' },
      },
    ]);
    expect(trace.chatRows).toHaveLength(1);
    expect(trace.chatRows[0]!['content']).toBe('menu:v1:open:x');
  });

  it('a location message is stored and answered with nothing', async () => {
    const { trace, post } = buildHarness();
    await post([messageEvent('location')]);
    expect(trace.chatRows.map((r) => r['messageType'])).toEqual(['location']);
    // location is NOT in the silent list, so it IS charged quota — then falls
    // out of the non-text branch with nothing configured to say.
    expect(trace.steps).toContain('ratelimit.consume');
    expect(trace.replies).toHaveLength(0);
    expect(trace.aiRequests).toHaveLength(0);
  });

  /**
   * ⚠️ COPIED BECAUSE LEGACY DOES IT, and it is worth recording as odd. Legacy
   *    calls `sendLineReplyMessage` here with NO try/catch, so a send failure
   *    (a dead token, which is exactly what this fixture has) propagates all the
   *    way to the outer catch at legacy:4950. The `rate_limit_reply` row is
   *    therefore NEVER written when the send fails — the only trace left is a
   *    `handle_webhook` error row. The same is true of the out-of-hours,
   *    missing-profile and api-missing replies.
   *
   *    Wrapping it would be an improvement and is deliberately not done: a catch
   *    here would write a row legacy does not write, and the whole parity claim
   *    rests on the rows matching.
   */
  it('a rate-limited text is told to wait and never reaches the model', async () => {
    const { trace, post } = buildHarness({ rateLimited: true });
    await post([textEvent()]);
    expect(trace.replies).toEqual(['กรุณารอสักครู่และลองใหม่อีกครั้ง']);
    expect(trace.aiRequests).toHaveLength(0);
    // The send threw, so the reply's own row is lost and the outer catch's row
    // is what remains — legacy's behaviour, asserted so a "fix" would show up.
    expect(
      trace.logRows.some((r) => r['action_type'] === 'rate_limit_reply'),
    ).toBe(false);
    const errRow = trace.logRows.find(
      (r) => r['action_type'] === 'handle_webhook',
    );
    expect(errRow?.['status']).toBe('error');
  });

  it('follow/unfollow do NOT consume quota', async () => {
    for (const type of ['follow', 'unfollow', 'postback']) {
      const { trace, post } = buildHarness({ rateLimited: true });
      await post([typedEvent(type)]);
      expect(trace.steps).not.toContain('ratelimit.consume');
      expect(trace.replies).toHaveLength(0);
    }
  });
});

describe('webhook ingest — a switched-off OA (status: 0)', () => {
  it('replies with the legacy message and stores it', async () => {
    const { trace, post } = buildHarness({ hook: baseHook({ status: 0 }) });
    await post([textEvent()]);
    expect(trace.replies).toEqual([
      'อยู่นอกเวลาทำการ กรุณาติดต่อใหม่อีกครั้งในภายหลังหรือติดต่อเจ้าหน้าที่',
    ]);
    expect(trace.aiRequests).toHaveLength(0);
  });

  it('replies with the OA custom text when one is set', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        status: 0,
        status_off_action: 'reply',
        status_off_text: 'ปิดปรับปรุงค่ะ',
      }),
    });
    await post([textEvent()]);
    expect(trace.replies).toEqual(['ปิดปรับปรุงค่ะ']);
  });

  it('silent mode stores the inbound message and sends nothing', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ status: 0, status_off_action: 'silent' }),
    });
    await post([textEvent()]);
    // "เงียบแต่เก็บแชท" — the customer row is already written above the gate.
    expect(trace.chatRows.map((r) => r['senderType'])).toEqual(['customer']);
    expect(trace.replies).toHaveLength(0);
  });

  it('an unfollow at a closed OA does NOT fire a reply with an undefined token', async () => {
    const { trace, post } = buildHarness({ hook: baseHook({ status: 0 }) });
    await post([typedEvent('unfollow')]);
    // [FIX-20260728-REPLYTOKEN] — this used to LINE-400 on every block/unfriend.
    expect(trace.replies).toHaveLength(0);
  });

  /* [FEAT-20260814-STATUSOFFQUIET] FLIPPED on the owner's order (14/08):
   * this case used to pin the legacy mirror — "a switched-off OA still answers
   * an image with image_answer_text" (the off gate sat BELOW the non-text
   * branch, deliberately). That very hole also let `[[[assist]]]` markers open
   * tickets while the OA was off, which is what surfaced live. New rule:
   * off ⇒ images are STORED but never processed — no reply, no ticket.
   * The full envelope is pinned in webhook-statusoff-quiet.spec.ts. */
  it('does NOT answer an image while off — stored only (was: still answered via image_answer_text)', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ status: 0, image_answer_text: 'รับรูปแล้ว' }),
      profileData: LINKED_PROFILE,
    });
    await post([messageEvent('image')]);
    expect(trace.replies).toEqual([]);
    expect(trace.chatRows.map((r) => r['senderType'])).toEqual(['customer']);
  });
});

describe('webhook ingest — the AI seam', () => {
  it('a text message REACHES the seam, exactly once, with the request assembled', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        suggestion_text: 'คุณคือแอดมิน',
        group: 'a0d000000000000000000092',
        ai_raw_json_analysis: true,
        ai_raw_json_rules: 'ห้ามเดา',
      }),
    });
    await post([textEvent('ยอดค้างเท่าไหร่')]);

    expect(trace.aiRequests).toHaveLength(1);
    const req = trace.aiRequests[0]!;
    expect(req.question).toBe('ยอดค้างเท่าไหร่');
    expect(req.suggestionText).toContain('คุณคือแอดมิน');
    /* [FLIP-20260830-STABLEPROMPT] FLIPPED on the owner's order (30/08,
       "ทำเลย — default โค้ดใหม่"): stable layout is now the DEFAULT, so the
       time line NO LONGER rides the suggestion — it rides timeContextText and
       becomes a contents block. The old expectation (startsWith === true) is
       pinned on the opt-out path below instead. */
    expect(req.suggestionText.startsWith('Today is ')).toBe(false);
    expect(
      String((req as unknown as Record<string, unknown>)['timeContextText']),
    ).toMatch(/^Today is .+\(Bangkok Time\)$/);
    expect(req.hookId).toBe(HOOK_ID);
    expect(req.hookGroupId).toBe('a0d000000000000000000092');
    expect(req.sendRawJson).toBe(true);
    expect(req.rawJsonRules).toBe('ห้ามเดา');
    expect(req.sendSiteRules).toBe(false);
  });

  it('the OA key crosses the seam as request.apiKey, but NEVER into a log row', async () => {
    // [FIX-20260808-HOOKAIKEY] The decrypted custom_ai_key now DOES reach the
    // provider — that is how the real Gemini turn fires the OA's own key
    // (legacy webhookController.js:2417). What must still never happen is the key
    // leaking into webhook_logs (only the mask is recorded there).
    const { trace, post } = buildHarness({
      hook: baseHook({
        custom_ai_key: 'AIzaTHIS-MUST-NEVER-LEAVE-THE-PROCESS',
      }),
    });
    await post([textEvent()]);

    // It DOES ride on the request now — as `apiKey`, decrypted, never as the raw
    // `custom_ai_key` field name.
    const req = trace.aiRequests[0]!;
    expect(req.apiKey).toBe('AIzaTHIS-MUST-NEVER-LEAVE-THE-PROCESS');
    expect(JSON.stringify(req)).not.toContain('custom_ai_key');

    // The webhook_logs row still records only the MASK, never the value.
    const aiRow = trace.logRows.find(
      (r) => r['action_type'] === 'generate_response',
    );
    expect(JSON.stringify(aiRow)).not.toContain(
      'AIzaTHIS-MUST-NEVER-LEAVE-THE-PROCESS',
    );
    expect(aiRow?.['gemini_api_key_mask']).toBe('AI...SS');
  });

  it('`ai_raw_json_analysis` is checked with ===true, so a truthy string is OFF', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ ai_raw_json_analysis: 'true', ai_raw_site_rules: 1 }),
    });
    await post([textEvent()]);
    expect(trace.aiRequests[0]!.sendRawJson).toBe(false);
    expect(trace.aiRequests[0]!.sendSiteRules).toBe(false);
  });

  it('the provider rejecting is survivable — the row is written, nothing is sent', async () => {
    const { trace, post } = buildHarness();
    await post([textEvent()]);
    const aiRow = trace.logRows.find(
      (r) => r['action_type'] === 'generate_response',
    );
    expect(aiRow?.['status']).toBe('error');
    expect(aiRow?.['http_status']).toBe(0);
    // No answer → no bot chat row and no send.
    expect(trace.chatRows.map((r) => r['senderType'])).toEqual(['customer']);
    expect(trace.replies).toHaveLength(0);
  });

  /* [FEAT-20260830-REPLYPUSH] UN-FLIPPED 30/08/2026, back to the original.
     This fixture refuses every reply with 401 on purpose. The ladder was
     briefly broad enough to push on that, which made one answer record two
     send attempts; the owner then narrowed it to `Invalid reply token` only,
     and a 401 is a channel-token problem a push cannot fix. So this case is
     exactly what it always was — and that is now a PIN on the narrow rule. */
  it('the default_answer_text is sent when the model produced nothing', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ default_answer_text: 'ขออภัย ไม่พบข้อมูลค่ะ' }),
    });
    await post([textEvent()]);
    expect(trace.replies).toEqual(['ขออภัย ไม่พบข้อมูลค่ะ']);
    expect(trace.chatRows.map((r) => r['senderType'])).toEqual([
      'customer',
      'bot',
    ]);
  });
});

describe('webhook ingest — the two silent invariants', () => {
  /**
   * ⚠️ The staleness check is AFTER the model call, not before. It suppresses a
   *    reply that has ALREADY been paid for, which is the whole point: on
   *    2026-07-27 a request stalled 986 seconds and then delivered a ghost reply
   *    with a 16-minute-old token. Moving it above the call would change which
   *    requests are suppressed AND stop suppressing that case.
   */
  it('a stale event still reaches the model, and is then not sent', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ default_answer_text: 'คำตอบสำรอง' }),
    });
    await post([{ ...textEvent(), timestamp: Date.now() - 121_000 }]);
    // Reached the seam …
    expect(trace.aiRequests).toHaveLength(1);
    // … the answer was resolved and STORED …
    expect(trace.chatRows.map((r) => r['senderType'])).toEqual([
      'customer',
      'bot',
    ]);
    // … and then suppressed on the way out.
    expect(trace.replies).toHaveLength(0);
  });

  /* [FEAT-20260830-REPLYPUSH] UN-FLIPPED — see the AI-seam case above. A 401
     refusal takes no push, so this stays the single send it always was. */
  it('an event 119s old is NOT stale and is sent', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ default_answer_text: 'คำตอบสำรอง' }),
    });
    await post([{ ...textEvent(), timestamp: Date.now() - 119_000 }]);
    expect(trace.replies).toEqual(['คำตอบสำรอง']);
  });

  /**
   * ⚠️ `forceReAssistAfterReply` fires on EVERY terminal, because legacy
   *    implements it by patching `res.send` and every terminal calls it —
   *    including `res.status(500).send(...)` and the outer catch. The
   *    try/finally here has to behave the same.
   */
  describe('forceReAssistAfterReply', () => {
    const assistedRoom = {
      _id: 'room1',
      user_id: 'member1',
      hook_id: HOOK_ID,
      assist_status: true,
    };
    /** Older than the 30-minute threshold → the timeout fires. */
    const staleLastMsg = {
      _id: 'prev',
      created_at: new Date(Date.now() - 31 * 60_000),
    };

    it('auto-unassists, writes the AssignHistory row, then re-assists on the way out', async () => {
      const { trace, post } = buildHarness({
        room: assistedRoom,
        lastCustomerMsg: staleLastMsg,
      });
      await post([textEvent()]);

      // Off on the way in …
      expect(trace.roomUpdates[0]).toEqual({
        $set: {
          assist_status: false,
          last_assist_changed_at: expect.any(Date),
        },
      });
      expect(trace.assignHistories[0]).toMatchObject({
        action: 'auto_unassist',
        detail: 'bot_automate_condition_30_minutes',
        // ⚠️ Written explicitly as null, not omitted — the stored document has
        //    to match legacy field for field.
        assign_to: null,
        changed_by_id: null,
        ticket_id: null,
      });
      // … and back on on the way out.
      expect(trace.roomUpdates[1]).toEqual({
        $set: { assist_status: true, last_assist_changed_at: expect.any(Date) },
      });
    });

    it('fires on a NON-reply terminal too — a sticker returns silently and still re-assists', async () => {
      const { trace, post } = buildHarness({
        room: assistedRoom,
        lastCustomerMsg: staleLastMsg,
      });
      await post([messageEvent('sticker')]);
      expect(trace.replies).toHaveLength(0);
      expect(
        trace.roomUpdates.map(
          (u) => (u['$set'] as Record<string, unknown>)['assist_status'],
        ),
      ).toEqual([false, true]);
    });

    it('does NOT fire when the room is assisted but the timeout has not elapsed', async () => {
      const { trace, post } = buildHarness({
        room: assistedRoom,
        lastCustomerMsg: {
          _id: 'prev',
          created_at: new Date(Date.now() - 60_000),
        },
      });
      await post([textEvent()]);
      expect(trace.roomUpdates).toHaveLength(0);
      expect(trace.assignHistories).toHaveLength(0);
      // The room is held by an admin: stored, silent, never near the model.
      expect(trace.chatRows.map((r) => r['senderType'])).toEqual(['customer']);
      expect(trace.aiRequests).toHaveLength(0);
    });

    it('an explicit auto_unassist_minutes of 0 disables the timeout entirely', async () => {
      const { trace, post } = buildHarness({
        hook: baseHook({ auto_unassist_minutes: 0 }),
        room: assistedRoom,
        // Two hours old — far past any threshold.
        lastCustomerMsg: {
          _id: 'prev',
          created_at: new Date(Date.now() - 120 * 60_000),
        },
      });
      await post([textEvent()]);
      expect(trace.roomUpdates).toHaveLength(0);
      expect(trace.aiRequests).toHaveLength(0);
    });

    it('a room with NO previous customer message stays assisted', async () => {
      const { trace, post } = buildHarness({
        room: assistedRoom,
        lastCustomerMsg: null,
      });
      await post([textEvent()]);
      expect(trace.roomUpdates).toHaveLength(0);
      expect(trace.aiRequests).toHaveLength(0);
    });
  });
});

describe('webhook ingest — order of operations', () => {
  it('the loading indicator fires before the profile fetch and the message row', async () => {
    const { trace, post } = buildHarness();
    await post([textEvent()]);
    const i = (s: string): number => trace.steps.indexOf(s);
    expect(i('line.loading')).toBeGreaterThanOrEqual(0);
    expect(i('line.loading')).toBeLessThan(i('profile.fetch'));
    expect(i('profile.fetch')).toBeLessThan(i('chat.logMessage:customer'));
    expect(i('chat.logMessage:customer')).toBeLessThan(i('ratelimit.consume'));
    expect(i('ratelimit.consume')).toBeLessThan(i('ai.generate'));
  });

  it('no loading indicator for an assisted room', async () => {
    const { trace, post } = buildHarness({
      room: { _id: 'room1', hook_id: HOOK_ID, assist_status: true },
      lastCustomerMsg: { _id: 'p', created_at: new Date() },
    });
    await post([textEvent()]);
    expect(trace.steps).not.toContain('line.loading');
  });

  it('the raw inbound payload is logged before anything else happens', async () => {
    const { trace, post } = buildHarness();
    await post([textEvent()]);
    expect(trace.steps[0]).toBe('log:incoming_line_webhook');
  });
});

/**
 * [FIX-20260808-ASSISTSUMMARYFIRE] THROUGH-THE-PIPELINE: the assist summary reaches
 * ticket.need_detail.
 *
 * The summary seam now fires under the same AI_PROVIDER flag as the reply seam.
 * These cases bind the REAL `ScriptedAssistSummaryProvider` — the exact class the
 * factory selects for AI_PROVIDER=mock — into the hand-off, drive an
 * assist-triggering reply, and assert the recorded ticket update's
 * `$set.need_detail`. This proves the whole path summary → ticket.need_detail
 * (what the operator board / FE reads) with NO real key anywhere. Reaching the
 * hand-off through POST /webhook needs a real model reply carrying [[[assist]]],
 * which is exactly what the seam lets us avoid: the marker is injected as
 * `rawAnswer`, the same string the pipeline would have handed this function.
 */
describe('assist hand-off — the scripted summary reaches ticket.need_detail', () => {
  const HANDOFF_HOOK_ID = 'a0d000000000000000000014';
  const HANDOFF_USER = 'Uassistpipe000000000000000000001';

  function summaryQuery(result: unknown): Record<string, unknown> {
    const q: Record<string, unknown> = {};
    for (const m of ['sort', 'limit', 'lean', 'select']) q[m] = () => q;
    q['exec'] = () => Promise.resolve(result);
    q['then'] = (res: (v: unknown) => unknown) =>
      Promise.resolve(result).then(res);
    q['catch'] = () => q;
    return q;
  }

  function handoffHarness(scripted: ScriptedAssistSummaryProvider): {
    deps: AssistDeps;
    ticketUpdates: Array<{ filter: unknown; update: unknown }>;
  } {
    const ticketUpdates: Array<{ filter: unknown; update: unknown }> = [];
    const deps: AssistDeps = {
      chatRoomModel: {
        findOne: () => summaryQuery({ _id: 'room1' }),
        findOneAndUpdate: () => summaryQuery({ _id: 'room1' }),
      } as never,
      chatMessageModel: { find: () => summaryQuery([]) } as never,
      ticketModel: {
        create: (doc: Record<string, unknown>) =>
          Promise.resolve({ _id: 'ticket1', ...doc }),
        updateOne: (filter: unknown, update: unknown) => {
          ticketUpdates.push({ filter, update });
          return summaryQuery({ acknowledged: true });
        },
      } as never,
      // The bound scripted provider — NOT an inline stub. This is the class the
      // AI_PROVIDER=mock factory selects.
      summaryProvider: scripted,
      isAiCategoryEnabled: () => Promise.resolve(false),
      persistWebhookLog: () => Promise.resolve(),
      postJson: () => Promise.resolve({ status: 200, data: { ok: true } }),
    };
    return { deps, ticketUpdates };
  }

  const handoffArgs = (
    over: Record<string, unknown> = {},
  ): Parameters<typeof triggerAssistNotification>[0] => ({
    userId: HANDOFF_USER,
    userText: 'ช่วยปลดล็อกเครื่องให้หน่อยครับ',
    rawAnswer: 'รอสักครู่นะคะ [[[assist]]]',
    telegramKey: 'k',
    telegramChatId: '-100',
    customerName: 'สมชาย ทดสอบ',
    alias: 'assistpipe',
    logContext: { hook_id: HANDOFF_HOOK_ID },
    // Both required for the ticket-create gate (chatMsgId && userMongoId).
    chatMsgId: 'a0d000000000000000000018',
    userMongoId: 'a0d000000000000000000019',
    ...over,
  });

  it('with ai_need_detail_limit > 0, need_detail is patched to the SCRIPTED summary', async () => {
    const scripted = new ScriptedAssistSummaryProvider();
    scripted.enqueue({
      summary: 'ลูกค้าต้องการปลดล็อกเครื่องหลังผ่อนครบ',
      category: 'IT',
    });
    const { deps, ticketUpdates } = handoffHarness(scripted);

    // limit > 0 → the summarise() call fires and its value flows to the ticket.
    await triggerAssistNotification(
      handoffArgs({ aiNeedDetailLimit: 5 }),
      deps,
    );

    // The seam WAS called through the pipeline …
    expect(scripted.received).toHaveLength(1);
    // … the answer handed to it had the marker stripped …
    expect(scripted.received[0]!.currentAnswer).not.toContain('[[[assist]]]');
    // … and the EXACT scripted summary landed on ticket.need_detail.
    const set = (ticketUpdates[0]!.update as Record<string, never>)[
      '$set'
    ] as unknown as Record<string, unknown>;
    expect(set['need_detail']).toBe('ลูกค้าต้องการปลดล็อกเครื่องหลังผ่อนครบ');
  });

  it('with ai_need_detail_limit = 0, no summarise call and need_detail is the customer text', async () => {
    const scripted = new ScriptedAssistSummaryProvider();
    scripted.enqueue({ summary: 'SHOULD NOT BE USED', category: 'IT' });
    const { deps, ticketUpdates } = handoffHarness(scripted);

    await triggerAssistNotification(
      handoffArgs({ aiNeedDetailLimit: 0, userText: 'เข้าเว็บไม่ได้' }),
      deps,
    );

    // limit 0 means "do not call the model at all".
    expect(scripted.received).toHaveLength(0);
    const set = (ticketUpdates[0]!.update as Record<string, never>)[
      '$set'
    ] as unknown as Record<string, unknown>;
    expect(set['need_detail']).toBe('เข้าเว็บไม่ได้');
  });
});

/**
 * [FIX-20260808-SLIPFLOW] The inbound slip flow, wired into the image branch.
 *
 * WHY THIS EXISTS
 * Two things had to become observable at once: (1) the Swiftcheck gate — verifySlip
 * is called ONLY for a slip-enabled hook with an image + stored file, and NEVER
 * otherwise; (2) the customer-facing card selection — each verify outcome
 * (success / duplicate / min_amount / out_of_time / not_match) must pick the
 * MATCHING `hook.flex_*` id, send that card, and SKIP the AI reply.
 *
 * NOTHING REAL IS CALLED. SlipFlowService is a recorder that returns a staged
 * `VerifySlipResult`; QrVisionService returns a staged boolean and records the
 * call. So a test that reaches the QR path proves no Gemini request is issued to
 * reach it, and a Swiftcheck call is never made from any of these.
 */
describe('webhook ingest — the slip flow (Swiftcheck gate + flex card selection)', () => {
  /** A slip-enabled image hook with all five payment cards + the two error cards. */
  function slipHook(
    over: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return baseHook({
      image_answer_text: 'รับสลิปแล้ว',
      slip_check: true,
      slip_verify_key: 'enc:swiftcheck-key',
      match_account: false,
      slip_check_min_amount: null,
      slip_check_out_of_time: null,
      flex_success: 'fx-success',
      flex_duplicate: 'fx-duplicate',
      flex_min_amount: 'fx-min',
      flex_out_of_time: 'fx-oot',
      flex_success_not_match: 'fx-notmatch',
      flex_not_found: 'fx-notfound',
      flex_error: 'fx-error',
      ...over,
    });
  }

  /** A Swiftcheck success body with the rawSlip fields the tag map reads. */
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
            date: '2026-08-08 10:00:00',
            transRef: 'TX123',
            amount: { amount: 500 },
            sender: { bank: { id: '002', name: 'BBL' }, account: {} },
            receiver: { bank: { id: '004', name: 'KBANK' }, account: {} },
          },
          ...data,
        },
      },
      slipRecordId: 'slip-row-1',
      slipCreatedAt: new Date('2026-08-08T03:00:00Z'),
      slipCondition: null,
      attempted: true,
    };
  }

  const CARD = {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', contents: [] },
  };

  it('slip_check OFF: verifySlip is NOT called, no flex, the image_answer_text reply is sent', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ image_answer_text: 'รับรูปแล้ว', slip_check: false }),
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });
    await post([messageEvent('image')]);
    expect(trace.steps).not.toContain('slip.verify');
    expect(trace.steps).not.toContain('line.flex');
    expect(trace.replies).toEqual(['รับรูปแล้ว']);
  });

  it('slip_check ON but no image (text): verifySlip is NOT called', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
    });
    await post([textEvent('hello')]);
    expect(trace.steps).not.toContain('slip.verify');
  });

  it('slip_check ON + image: verifySlip IS called with the stored file_path', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', name: 'Success', content_json: CARD },
    });
    await post([messageEvent('image')]);
    expect(trace.steps).toContain('slip.verify');
    expect(trace.slipVerifyInputs[0]!.storage).toEqual({
      file_path: '/tmp/slip.jpg',
    });
  });

  // Each outcome → the matching hook.flex_* id, sent, AI reply skipped.
  const cases: Array<{
    name: string;
    verify: Record<string, unknown>;
    hookOver: Record<string, unknown>;
    expectFlexId: string;
  }> = [
    {
      name: 'success → flex_success',
      verify: successVerify(),
      hookOver: {},
      expectFlexId: 'fx-success',
    },
    {
      name: 'duplicate → flex_duplicate',
      verify: successVerify({ isDuplicate: true }),
      hookOver: {},
      expectFlexId: 'fx-duplicate',
    },
    {
      name: 'below minimum → flex_min_amount',
      verify: successVerify({ amountInSlip: 100 }),
      hookOver: { slip_check_min_amount: 300 },
      expectFlexId: 'fx-min',
    },
    {
      name: 'account not match → flex_success_not_match',
      verify: successVerify({ matchedAccount: false }),
      hookOver: { match_account: true, match_account_number: '1234' },
      expectFlexId: 'fx-notmatch',
    },
    {
      name: 'out of time → flex_out_of_time',
      verify: successVerify({
        rawSlip: {
          date: '2020-01-01 10:00:00',
          transRef: 'OLD',
          amount: { amount: 500 },
          sender: { bank: {}, account: {} },
          receiver: { bank: {}, account: {} },
        },
      }),
      hookOver: { slip_check_out_of_time: 10 },
      expectFlexId: 'fx-oot',
    },
  ];

  for (const c of cases) {
    it(`${c.name}: sends that card and SKIPS the AI/image_answer reply`, async () => {
      const flexId = c.expectFlexId;
      const { trace, post } = buildHarness({
        hook: slipHook(c.hookOver),
        profileData: LINKED_PROFILE,
        slipVerifyResult: c.verify,
        flexDoc: { _id: flexId, name: flexId, content_json: CARD },
      });
      await post([messageEvent('image')]);

      // The card was sent as a flex message.
      expect(trace.steps).toContain('line.flex');
      expect(trace.flexReplies).toHaveLength(1);
      // The slip callback ran (isFlexSent → handleSlipCallback), and the AI /
      // plain image_answer_text reply did NOT (the branch returned).
      expect(trace.steps).toContain('slip.callback');
      expect(trace.steps).not.toContain('ai.generate');
      expect(trace.replies).toEqual([]);
      // A slip_flex_reply log row names the chosen card.
      const flexLog = trace.logRows.find(
        (r) => r['action_type'] === 'slip_flex_reply',
      );
      expect(flexLog).toBeDefined();
      expect(
        (flexLog!['payload_summary'] as Record<string, unknown>)['flex_doc_id'],
      ).toBe(flexId);
    });
  }

  /* [OFF-20260812-QRVISION] This case used to prove the Gemini seam was consulted on
     VALIDATION_ERROR. That call is now switched off — Swiftcheck answering
     VALIDATION_ERROR already means "no QR seen", so asking Gemini re-asked a settled
     question (verified on a real message: Swiftcheck said VALIDATION_ERROR, Gemini said
     "NO"). The test therefore pins the opposite: the seam is NOT consulted, and the
     image falls through to ordinary media handling instead of the QR-error text.
     revert: restore the two `qr.check` / override assertions together with the
     commented call in slip-flex.handler.ts. */
  /**
   * ==== [FIX-20260817-QRNOTIMAGE] a QR slip is not "an image" ====
   *
   * THE RULE (owner, 17/08): **no QR ⇒ answer with `image_answer_text` exactly as
   * before. QR detected ⇒ `image_answer_text` must not be used at all** — the
   * message is a slip, and a slip has its own reply cards.
   *
   * WHAT WAS WRONG: the reply itself already obeyed this (`webhook.service.ts`
   * returns right after a slip card is sent, "SKIPPING the normal AI /
   * image_answer reply entirely"), but the `[[[assist]]]` hand-off did NOT: the
   * gate was `isNormalMedia || isSuccessfulQr`, so a slip that VERIFIED still
   * read the marker out of `image_answer_text` and opened a case.
   *
   * WHY THAT MATTERED, beyond tidiness — the two ticket mechanisms collided.
   * `openPaymentTicketIfIdle` can only open a ticket while the room is IDLE
   * (webhook.service.ts:5031 says so). assist claimed the room first, so the
   * payment run — the half that carries the CARD's own reason into
   * `direct_ticket_detail` — was locked out. Live evidence: 162 tickets, only 11
   * with `direct_ticket: true`. A card explicitly configured NOT to open a case
   * (`PAYnomatchretry`, `direct_ticket_on_reply = false`) had one opened anyway.
   *
   * AFTER: the gate is `isNormalMedia` alone. `direct_ticket_on_reply` on the
   * card becomes the single authority for a slip, which is what an operator
   * ticking "เปิดเคสให้แอดมินอัตโนมัติ" already expects.
   * รูปธรรมดา = เหมือนเดิมทุกอย่าง · สลิป = การ์ดเป็นคนตัดสิน
   */
  describe('[FIX-20260817-QRNOTIMAGE] image_answer_text belongs to plain images only', () => {
    const ASSIST_IMG = 'ได้รับรูปแล้วค่ะ [[[assist]]]';

    it('🔴 NO QR: unchanged — the image answer is sent and the case is still opened', async () => {
      const { trace, post } = buildHarness({
        hook: baseHook({ image_answer_text: ASSIST_IMG }),
        profileData: LINKED_PROFILE,
        // the harness only lets assist raise a ticket when a member row exists —
        // opt-in, same as the other assist cases in this file
        withMemberRow: true,
      });
      await post([messageEvent('image')]);
      // the customer still gets the text, marker stripped — exactly as before
      expect(trace.replies).toEqual(['ได้รับรูปแล้วค่ะ']);
      // and the hand-off still raises a case for a plain image
      expect(trace.ticketsCreated.length).toBeGreaterThan(0);
    });

    it('⭐ QR slip that VERIFIED: no case from image_answer_text', async () => {
      const { trace, post } = buildHarness({
        hook: slipHook({ image_answer_text: ASSIST_IMG }),
        profileData: LINKED_PROFILE,
        slipVerifyResult: successVerify(),
        qrIsSlip: true,
        // a real card must be resolvable, or the flow falls through to the image
        // answer and the case under test never happens
        flexDoc: {
          _id: 'fx-success',
          name: 'success',
          content_json: { type: 'bubble' },
        },
        withMemberRow: true,
      });
      await post([messageEvent('image')]);
      // the slip card answered; the image text was never sent (pre-existing rule)
      expect(trace.replies).not.toContain('ได้รับรูปแล้วค่ะ');
      // ⭐ and no case is opened off the back of a text this flow never uses
      expect(trace.ticketsCreated).toHaveLength(0);
    });

    it('a QR slip that FAILED verification opens no case either (unchanged)', async () => {
      const { trace, post } = buildHarness({
        hook: slipHook({ image_answer_text: ASSIST_IMG }),
        profileData: LINKED_PROFILE,
        slipVerifyResult: {
          slipVerifyResult: { success: false, error: { code: 'SLIP_PENDING' } },
          slipRecordId: null,
          slipCreatedAt: null,
          slipCondition: null,
          attempted: true,
        },
        qrIsSlip: true,
        flexDoc: {
          _id: 'fx-error',
          name: 'error',
          content_json: { type: 'bubble' },
        },
        // staged so a ticket COULD be created — otherwise this passes vacuously
        withMemberRow: true,
      });
      await post([messageEvent('image')]);
      expect(trace.ticketsCreated).toHaveLength(0);
    });
  });

  it('VALIDATION_ERROR no longer consults the Gemini seam — Swiftcheck already said no QR', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook({ flex_error: null, flex_not_found: null }),
      profileData: LINKED_PROFILE,
      slipVerifyResult: {
        slipVerifyResult: {
          success: false,
          error: { code: 'VALIDATION_ERROR' },
        },
        slipRecordId: null,
        slipCreatedAt: null,
        slipCondition: null,
        attempted: true,
      },
      qrIsSlip: true,
    });
    await post([messageEvent('image')]);
    // The billed seam is NOT consulted any more — this is the saving.
    expect(trace.steps).not.toContain('qr.check');
    // Treated as an ordinary image: the QR-failure text is no longer selected, so
    // the hook's normal image answer goes out instead.
    expect(trace.replies).not.toContain(
      'ไม่สามารถตรวจสอบข้อมูล QR Code ได้ กรุณาลองใหม่อีกครั้ง',
    );
    expect(trace.steps).not.toContain('line.flex');
  });

  /* ==== [FEAT-20260812-QRPRESCAN] the pre-scan gate, at flow level ====
   * Proves the switch works in both directions on the real service: identical hook
   * config, only `qr_prescan_mode` differs. 'off' must leave the Swiftcheck call exactly
   * where it was; 'skip' must remove it when the image has no QR.
   * The harness fakes SlipFlowService, so `trace.steps` containing 'slip.verify' is
   * the observable stand-in for "the provider was called".
   */
  it("[QRPRESCAN] mode 'off' (default) ⇒ ยังยิง slip verify เหมือนเดิม", async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });

    await post([messageEvent('image')]);

    expect(trace.steps).toContain('slip.verify');
  });

  it("[QRPRESCAN] mode 'skip' + รูปไม่มี QR ⇒ ไม่ยิง slip verify (นี่คือส่วนที่ประหยัด)", async () => {
    const { trace, post } = buildHarness({
      hook: slipHook({ qr_prescan_mode: 'skip' }),
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });

    await post([messageEvent('image')]);

    /* The staged storage row points at a path that does not exist, so the reader
       cannot decode it — which is exactly the "undecodable" case, and undecodable
       must NOT skip. Asserting the call still happens pins fail-open at flow level. */
    expect(trace.steps).toContain('slip.verify');
  });

  /* ==== [FEAT-20260812-QRPRESCAN] "รับสลิปเฉพาะลูกค้าที่ผูกบัญชีแล้ว" is a SLIP rule ====
   *
   * Owner, 2026-08-12: *"รับสลิปเฉพาะลูกค้าที่ผูกบัญชีแล้ว = active เงื่อนไขนี้จะอ่าน
   * ก็ต่อเมื่อ js = qr นะ"* — the setting may only be consulted once the pre QR check
   * has established the image actually carries a code.
   *
   * WHAT WENT WRONG WITHOUT THIS (observed on live traffic, hook `demo-oa-three`):
   *   an unregistered customer sent an ORDINARY PHOTO and was answered
   *   "ลงทะเบียนก่อนนะจะ" and the flow stopped — no image reply, no ticket. The photo
   *   was never a slip, so the account rule had no business judging it.
   *
   * These two tests are the pair that pins the rule: same hook, same unregistered
   * customer, ONLY the image differs.
   */
  const NO_QR_IMAGE = join(process.cwd(), 'todo', 'sample', '1.png');
  const QR_IMAGE = join(
    process.cwd(),
    'todo',
    'slip',
    'Screenshot 2569-08-11 at 11.00.54.png',
  );
  /** An explicit 404 from the profile upstream — the ONLY thing the gate blocks on. */
  const UNLINKED_PROFILE = {
    'Path : api/v1/customer': { success: false, status: 404 },
  };
  const requireProfileHook = () =>
    slipHook({
      qr_prescan_mode: 'skip',
      slip_require_profile: true,
      slip_require_profile_text: 'ลงทะเบียนก่อนนะจะ',
    });

  (existsSync(NO_QR_IMAGE) ? it : it.skip)(
    '[QRPRESCAN] ภาพธรรมดา (ไม่มี QR) + ไม่ลงทะเบียน ⇒ ไม่อ่าน slip_require_profile เลย',
    async () => {
      const { trace, post } = buildHarness({
        hook: requireProfileHook(),
        profileData: UNLINKED_PROFILE,
        withImageStorage: true,
        imageFilePath: NO_QR_IMAGE,
      });

      await post([messageEvent('image')]);

      /* ⭐ The regression this fixes: the customer must NOT be told to link an
         account, because they did not send a slip. */
      expect(trace.replies).not.toContain('ลงทะเบียนก่อนนะจะ');
      // …and no billed verification either, since there is no code to verify.
      expect(trace.steps).not.toContain('slip.verify');
    },
  );

  /**
   * ⭐ [FEAT-20260812-QRPRESCAN] where a plain photo must END.
   *
   * Owner, 2026-08-12: *"ถ้า รูป ไม่ใช่ qr / ไม่ได้ลงทะเบียน จบที่ ค่าตอบกลับเมื่อพบ
   * รูปภาพ จบแค่นี้"*.
   *
   * The bug this pins, seen live on hook `demo-oa-three`: an unregistered customer sent an
   * ordinary photo and got `missing_api_data_text` ("ข้อความเมื่อไม่พบข้อมูล API"),
   * because that guard fires on `customerName === 'N/A'` alone and then RETURNS — so
   * `image_answer_text` was never reached even though the customer had simply sent a
   * picture and asked nothing that needed their profile.
   */
  (existsSync(NO_QR_IMAGE) ? it : it.skip)(
    '[QRPRESCAN] ภาพธรรมดา + ไม่ลงทะเบียน ⇒ จบที่ image_answer_text ไม่ใช่ missing_api_data_text',
    async () => {
      const { trace, post } = buildHarness({
        hook: slipHook({
          qr_prescan_mode: 'skip',
          missing_api_data_text: 'ไม่พบข้อมูล API',
          image_answer_text: 'ได้รับรูปแล้วนะคะ',
        }),
        profileData: UNLINKED_PROFILE,
        withImageStorage: true,
        imageFilePath: NO_QR_IMAGE,
      });

      await post([messageEvent('image')]);

      // The photo ends at SETTING 3…
      expect(trace.replies.join(' ')).toContain('ได้รับรูปแล้วนะคะ');
      // …and SETTING 2 never gets a turn.
      expect(trace.replies.join(' ')).not.toContain('ไม่พบข้อมูล API');
    },
  );

  /**
   * The other side of the same rule: an image that DOES carry a QR is a slip, so every
   * existing check keeps its turn. Narrowing the guard must not disable it.
   */
  (existsSync(QR_IMAGE) ? it : it.skip)(
    '[QRPRESCAN] ภาพมี QR + ไม่ลงทะเบียน ⇒ missing_api_data_text ยังทำงานเหมือนเดิม',
    async () => {
      const { trace, post } = buildHarness({
        hook: slipHook({
          qr_prescan_mode: 'skip',
          missing_api_data_text: 'ไม่พบข้อมูล API',
          image_answer_text: 'ได้รับรูปแล้วนะคะ',
        }),
        profileData: UNLINKED_PROFILE,
        withImageStorage: true,
        imageFilePath: QR_IMAGE,
      });

      await post([messageEvent('image')]);

      expect(trace.replies.join(' ')).toContain('ไม่พบข้อมูล API');
    },
  );

  (existsSync(QR_IMAGE) ? it : it.skip)(
    '[QRPRESCAN] ภาพมี QR + ไม่ลงทะเบียน ⇒ อ่าน slip_require_profile ตามเดิม (block)',
    async () => {
      const { trace, post } = buildHarness({
        hook: requireProfileHook(),
        profileData: UNLINKED_PROFILE,
        withImageStorage: true,
        imageFilePath: QR_IMAGE,
      });

      await post([messageEvent('image')]);

      /* The other half of the rule: a real slip from an unlinked sender is still
         refused exactly as before. Narrowing the gate must not disable it. */
      expect(trace.replies).toContain('ลงทะเบียนก่อนนะจะ');
      // Refused ⇒ still no billed call, which was already true.
      expect(trace.steps).not.toContain('slip.verify');

      /* ⭐ [FIX-20260812-REFUSEDNOHISTORY] the admin's room must show the same reply
         the customer got — owner: *"ทั้ง chat message + ลูกค้า"*. Before the fix this
         branch replied to LINE and wrote a webhook_log but never a chat row, so the
         room showed the slip with no answer under it. */
      const refusalRow = trace.chatRows.find(
        (r) => r['content'] === 'ลงทะเบียนก่อนนะจะ',
      );
      expect(refusalRow).toBeDefined();
      expect(refusalRow).toMatchObject({
        senderType: 'bot',
        messageType: 'text',
      });
    },
  );

  /**
   * ⭐ [FIX-20260812-REFUSEDMARKERS] `slip_require_profile_text` was the one
   * operator-written field with NO marker handling.
   *
   * Seen live on hook `demo-oa-three`: the operator wrote `[[[assist]]]` in the refusal copy
   * — the same marker they use in every other field — and the customer received the
   * literal brackets while no ticket was raised. Both halves are pinned here.
   */
  (existsSync(QR_IMAGE) ? it : it.skip)(
    '[REFUSEDMARKERS] [[[assist]]] ใน slip_require_profile_text ⇒ ไม่หลุดดิบ + สร้าง ticket',
    async () => {
      const { trace, post } = buildHarness({
        hook: slipHook({
          qr_prescan_mode: 'skip',
          slip_require_profile: true,
          slip_require_profile_text: 'ลงทะเบียนก่อนนะจะ [[[assist]]]',
          hook_text_reply_mode: 'strip',
        }),
        profileData: UNLINKED_PROFILE,
        withImageStorage: true,
        imageFilePath: QR_IMAGE,
        withMemberRow: true,
      });

      await post([messageEvent('image')]);

      /* ⭐ half 1 — the CUSTOMER never sees the marker. */
      expect(trace.replies.join(' ')).not.toContain('[[[assist]]]');
      // The operator's real words survive; only the marker is removed.
      expect(trace.replies.join(' ')).toContain('ลงทะเบียนก่อนนะจะ');

      /* ⭐ half 2 — the ADMIN row keeps the WHOLE sentence, marker included.
         Owner: *"ลูกค้าต้องตัด assist ออก ... ฝั่ง admin ต้องเก็บ ทั้งประโยค +
         [[[assist]]] ไม่ตัด"*. The two surfaces deliberately differ, so this asserts
         the opposite of the line above rather than repeating it. */
      const botRow = trace.chatRows.find((r) => r['senderType'] === 'bot');
      expect(String(botRow?.['content'])).toContain('[[[assist]]]');
      // …and the stripped text the customer got is kept alongside it, not lost.
      expect(
        (botRow?.['metadata'] as Record<string, unknown>)?.['sent_text'],
      ).not.toContain('[[[assist]]]');

      /* ⭐ half 3 — a ticket is actually raised.
         The bug this catches: assist logged "Tag detected" and claimed the room, but
         created NO ticket, because `assist-notification.ts:518` needs a `chatMsgId`
         and this branch returns before the normal message-logging site. Observed on
         the 17:40 live test; the row is now written before assist runs. */
      expect(trace.ticketsCreated).toHaveLength(1);
      /* ⭐ The category. A refused slip is a money case, so it must be filed under
         'Payment' and not buried in 'Other' with every unrelated hand-off. Set via
         `forcedTicketCategory`, deliberately NOT by reusing `isPaymentFlex` (which
         also alters slip-error handling). */
      expect(trace.ticketsCreated[0]).toMatchObject({
        chat_status: 'bot',
        category: 'Payment',
      });

      /* ⭐ half 4 — ORDER. Chat rows are rendered by `created_at`, so the customer's
         slip must be written BEFORE the bot's answer or the admin page shows the
         conversation backwards while LINE shows it correctly (seen live 17:47).
         Asserting on the recorded order is what catches a re-ordering of these two
         writes; the timestamps themselves are assigned inside the service. */
      const order = trace.chatRows.map((r) => String(r['senderType']));
      expect(order.indexOf('customer')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('customer')).toBeLessThan(order.indexOf('bot'));
    },
  );

  /**
   * ⭐ [FIX-20260812-REFUSEDSILENTWHENASSISTED] an operator already holds the room.
   *
   * Owner, 2026-08-12: *"ถ้า assist = true ... ไม่ต้อง reply ลูกค้า"* and
   * *"ตรวจทุกอย่าง flow เดิม ยกเว้นไม่ตอบเฉย ๆ"* — so this asserts BOTH halves: the
   * reply is gone, and everything else still happened.
   *
   * Seen live 17:59: the room had been claimed 12s earlier and the bot answered on top
   * of the operator anyway, because this branch sits above the general assist bypass.
   */
  (existsSync(QR_IMAGE) ? it : it.skip)(
    '[REFUSEDSILENT] assist_status=true ⇒ ไม่ reply ลูกค้า แต่ flow อื่นทำงานครบ',
    async () => {
      const { trace, post } = buildHarness({
        hook: slipHook({
          qr_prescan_mode: 'skip',
          slip_require_profile: true,
          slip_require_profile_text: 'ลงทะเบียนก่อนนะจะ [[[assist]]]',
          hook_text_reply_mode: 'strip',
        }),
        profileData: UNLINKED_PROFILE,
        withImageStorage: true,
        imageFilePath: QR_IMAGE,
        withMemberRow: true,
        // an admin is already in the room
        room: {
          _id: 'room1',
          user_id: 'member1',
          hook_id: HOOK_ID,
          assist_status: true,
        },
      });

      await post([messageEvent('image')]);

      // ⭐ half 1 — the customer is NOT answered.
      expect(trace.replies).toHaveLength(0);

      /* ⭐ half 2 — the ADMIN page must not show a bubble for a message that was
         never sent. Seen live at 18:10:55: the customer correctly got nothing, but the
         chat page still rendered a bot reply, so the operator saw two answers where the
         customer saw one. The bot row is therefore skipped along with the send. */
      const senders = trace.chatRows.map((r) => String(r['senderType']));
      expect(senders).not.toContain('bot');

      /* ⭐ half 3 — "ไม่ใช่ไม่ทำงาน": the CUSTOMER's own image is still recorded. It
         really did arrive, and the operator has to see what was sent to them. */
      expect(senders).toContain('customer');
    },
  );

  (existsSync(QR_IMAGE) ? it : it.skip)(
    '[REFUSEDMARKERS] ไม่มี marker ⇒ ไม่สร้าง ticket (ไม่ page แอดมินโดยไม่จำเป็น)',
    async () => {
      const { trace, post } = buildHarness({
        hook: slipHook({
          qr_prescan_mode: 'skip',
          slip_require_profile: true,
          slip_require_profile_text: 'ลงทะเบียนก่อนนะจะ',
          hook_text_reply_mode: 'strip',
        }),
        profileData: UNLINKED_PROFILE,
        withImageStorage: true,
        imageFilePath: QR_IMAGE,
      });

      await post([messageEvent('image')]);

      expect(trace.replies.join(' ')).toContain('ลงทะเบียนก่อนนะจะ');
      // The operator wrote no marker, so the text goes out unchanged.
      expect(trace.replies.join(' ')).not.toContain('[[[');
    },
  );

  it('SLIP_NOT_FOUND (404) does NOT consult Gemini — the short-circuit', async () => {
    const { trace, post } = buildHarness({
      hook: slipHook(),
      profileData: LINKED_PROFILE,
      slipVerifyResult: {
        slipVerifyResult: {
          success: false,
          error: { code: 'SLIP_NOT_FOUND' },
        },
        slipRecordId: null,
        slipCreatedAt: null,
        slipCondition: null,
        attempted: true,
      },
      flexDoc: { _id: 'fx-notfound', name: 'NotFound', content_json: CARD },
    });
    await post([messageEvent('image')]);
    // 404 implies a QR was detected without asking Gemini.
    expect(trace.steps).not.toContain('qr.check');
    // flex_not_found is an error card → sent, but as slip_error_flex_reply.
    expect(trace.steps).toContain('line.flex');
    const errLog = trace.logRows.find(
      (r) => r['action_type'] === 'slip_error_flex_reply',
    );
    expect(errLog).toBeDefined();
  });
});

/**
 * [FIX-20260808-ASSISTSLIP] regression: slip uploaded in assist mode still fires
 * the deposit callback.
 *
 * H-C2. When an operator is holding the room (`assist_status:true`, and the
 * auto-unassist window has NOT elapsed → `skipBotProcessing` becomes true), a
 * SLIP image used to be verified above the assist gate and then DROPPED — the
 * `if (skipBotProcessing)` branch just `return`ed, so the deposit was never
 * credited. The fix runs `handleSlipFlex` inside that branch and, when a card was
 * sent, fires `slipFlow.handleSlipCallback` (the deposit callback) — the exact
 * pair the non-assist path uses. `handleSlipCallback` self-gates on
 * `hook.callback_slip`, so an OA with it off stays a no-op.
 *
 * NOTHING REAL IS CALLED: verifySlip and handleSlipCallback are the harness
 * recorders, QrVision is stubbed. A test reaching any of them proves no
 * Swiftcheck/LINE/Gemini request is issued to reach it.
 */
describe('assist-mode slip (H-C2) — deposit callback still fires under assist', () => {
  /** An operator holds this room. */
  const assistedRoom = {
    _id: 'room1',
    user_id: 'member1',
    hook_id: HOOK_ID,
    assist_status: true,
  };
  /** One minute old → inside the 30-min window → skipBotProcessing stays true. */
  const recentCustomerMsg = {
    _id: 'prev',
    created_at: new Date(Date.now() - 60_000),
  };

  /** A slip-enabled image hook with a success card and the callback switch ON. */
  function assistSlipHook(
    over: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return baseHook({
      image_answer_text: 'รับสลิปแล้ว',
      slip_check: true,
      slip_verify_key: 'enc:swiftcheck-key',
      match_account: false,
      slip_check_min_amount: null,
      slip_check_out_of_time: null,
      flex_success: 'fx-success',
      // callback_slip IS the OA on/off switch the real handleSlipCallback gates
      // on. Set here for the positive case; the mock records regardless.
      callback_slip: [{ url: 'https://deposit.test/credit', method: 'POST' }],
      ...over,
    });
  }

  const successVerify = (): Record<string, unknown> => ({
    slipVerifyResult: {
      success: true,
      data: {
        isDuplicate: false,
        matchedAccount: true,
        amountInSlip: 500,
        rawSlip: {
          date: '2026-08-08 10:00:00',
          transRef: 'TX-ASSIST',
          amount: { amount: 500 },
          sender: { bank: { id: '002', name: 'BBL' }, account: {} },
          receiver: { bank: { id: '004', name: 'KBANK' }, account: {} },
        },
      },
    },
    slipRecordId: 'slip-row-assist',
    slipCreatedAt: new Date('2026-08-08T03:00:00Z'),
    slipCondition: null,
    attempted: true,
  });

  const CARD = {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', contents: [] },
  };

  it('POSITIVE: success slip + matching card ⇒ deposit callback fires ONCE and the card is sent', async () => {
    const { trace, post } = buildHarness({
      hook: assistSlipHook(),
      room: assistedRoom,
      lastCustomerMsg: recentCustomerMsg,
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', name: 'Success', content_json: CARD },
    });
    await post([messageEvent('image')]);

    // We are genuinely in assist mode: no loading indicator, no auto-unassist.
    expect(trace.steps).not.toContain('line.loading');
    expect(trace.roomUpdates).toHaveLength(0);

    // The slip was verified above the assist gate …
    expect(trace.steps).toContain('slip.verify');
    // … the card was sent …
    expect(trace.steps).toContain('line.flex');
    expect(trace.flexReplies).toHaveLength(1);
    // … and the deposit callback fired EXACTLY ONCE (credited even in assist).
    expect(trace.steps.filter((s) => s === 'slip.callback')).toHaveLength(1);
    expect(trace.slipCallbacks).toHaveLength(1);
    expect(trace.slipCallbacks[0]!.userId).toBe(USER_ID);

    // The operator keeps the room: nothing reached the model.
    expect(trace.steps).not.toContain('ai.generate');
    expect(trace.aiRequests).toHaveLength(0);
  });

  it('SELF-GATE: no card sent (isFlexSent false) ⇒ the deposit callback is NOT fired', async () => {
    // Same success verify, but NO flex card resolves (findById → null), so
    // handleSlipFlex reports isFlexSent=false and the branch must skip the
    // callback — proving the gate that stops a credit when nothing was shown.
    const { trace, post } = buildHarness({
      hook: assistSlipHook(),
      room: assistedRoom,
      lastCustomerMsg: recentCustomerMsg,
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      // flexDoc omitted → flexModel.findById resolves null → no card sent.
    });
    await post([messageEvent('image')]);

    // Still reached the slip branch (verify ran) …
    expect(trace.steps).toContain('slip.verify');
    // … but no card was sent …
    expect(trace.steps).not.toContain('line.flex');
    expect(trace.flexReplies).toHaveLength(0);
    // … so the callback was gated off — no deposit credited.
    expect(trace.steps).not.toContain('slip.callback');
    expect(trace.slipCallbacks).toHaveLength(0);
  });

  it('REGRESSION: the SAME slip in a NON-assist room still fires the callback (fix left the old path alone)', async () => {
    // room:null → skipBotProcessing stays false → the pre-existing non-assist
    // slip path handles it. Proves the assist-branch addition did not disturb
    // the money path that already worked.
    const { trace, post } = buildHarness({
      hook: assistSlipHook(),
      room: null,
      profileData: LINKED_PROFILE,
      slipVerifyResult: successVerify(),
      flexDoc: { _id: 'fx-success', name: 'Success', content_json: CARD },
    });
    await post([messageEvent('image')]);

    expect(trace.steps).toContain('line.flex');
    expect(trace.steps.filter((s) => s === 'slip.callback')).toHaveLength(1);
    expect(trace.slipCallbacks).toHaveLength(1);
  });
});

// [FEAT-20260808-GROUPB-FLEXHISTORY] P2-3 — the AI-reply flex-history rewrite.
// When the AI answer is sent as a flex CARD, the bot's chat-history row must be
// patched to the flex shape the panel renders (legacy webhookController.js:4941-
// 4978). Uses the SCRIPTED AI reply seam (no billing) to make the flex build run.
describe('webhook ingest — AI-reply flex-history rewrite (P2-3)', () => {
  const PROFILE_CARD = {
    _id: 'profcard1',
    content_json: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [] },
    },
    content_tags: [],
    source_roles: [],
  };

  function flexHook() {
    // flex_profile_id pins the card; the AI answer's [[[flex_profile]]] marker
    // routes to it. A live (non-assist) room + linked profile so the reply path
    // reaches the flex build rather than an early return.
    return baseHook({ flex_profile_id: 'profcard1' });
  }

  it('patches the bot row to message_type:flex + metadata.flex_json (was raw text)', async () => {
    const { trace, post } = buildHarness({
      hook: flexHook(),
      profileData: LINKED_PROFILE,
      aiReplyText: 'ข้อมูลของคุณ [[[flex_profile]]]',
      flexProfileDoc: PROFILE_CARD,
    });
    await post([textEvent('ขอดูโปรไฟล์')]);
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget chain run

    // the card was sent (not the plain text reply)
    expect(trace.steps).toContain('line.flex');

    // exactly one flex-history patch, with legacy's $set shape
    const flexPatch = trace.chatUpdates.find(
      (u) =>
        (u.update['$set'] as Record<string, unknown> | undefined)?.[
          'message_type'
        ] === 'flex',
    );
    expect(flexPatch).toBeDefined();
    const set = flexPatch!.update['$set'] as Record<string, unknown>;
    expect(set['metadata.flex_json']).toBeDefined();
    expect(set['metadata.auto_reply_type']).toBe('flex_profile');
    expect(set['metadata.flex_doc_id']).toBe('profcard1');
    expect(String(set['content'])).toContain('[Flex]');
  });

  it('emits message:updated with the flex payload after the DB patch (live panel)', async () => {
    const { trace, post } = buildHarness({
      hook: flexHook(),
      profileData: LINKED_PROFILE,
      aiReplyText: 'ข้อมูลของคุณ [[[flex_profile]]]',
      flexProfileDoc: PROFILE_CARD,
    });
    await post([textEvent('ขอดูโปรไฟล์')]);
    await new Promise((r) => setImmediate(r));

    const evt = trace.realtimeEvents.find(
      (e) => e.type === 'message:updated' && e.data['message_type'] === 'flex',
    );
    expect(evt).toBeDefined();
    expect(evt!.data['hook_id']).toBe(HOOK_ID);
    const meta = evt!.data['metadata'] as Record<string, unknown>;
    expect(meta['auto_reply_type']).toBe('flex_profile');
    expect(meta['flex_json']).toBeDefined();
  });

  it('a plain-text AI reply (no card) does NOT write a flex-history patch (unchanged)', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook(), // no flex_profile_id → no card built
      profileData: LINKED_PROFILE,
      aiReplyText: 'ยอดคงเหลือของคุณคือ 100 บาทค่ะ',
    });
    await post([textEvent('ยอด')]);
    await new Promise((r) => setImmediate(r));

    expect(trace.steps).not.toContain('line.flex');
    const flexPatch = trace.chatUpdates.find(
      (u) =>
        (u.update['$set'] as Record<string, unknown> | undefined)?.[
          'message_type'
        ] === 'flex',
    );
    expect(flexPatch).toBeUndefined();
  });

  /* ==== [FIX-20260812-HELPERMARKERLEAK] marker must not reach the customer ====
   * The pair below is the proof the switch works both ways: identical hook config,
   * only `hook_text_reply_mode` differs. 'off' keeps today's (wrong) behaviour so a
   * rollout can be reversed without a deploy; 'strip' is the fix.
   * Self-contained on purpose — it defines its own 404 profile fixture rather than
   * relying on anything another feature's tests added to the harness.
   */
  const NO_PROFILE_404 = {
    'Path : api/v1/customer': { success: false, status: 404 },
  };

  it("[HELPERMARKERLEAK] mode 'strip' ⇒ ลูกค้าได้ข้อความจริง ไม่ใช่วงเล็บดิบ", async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        image_answer_text: 'รับรูปแล้ว',
        missing_api_data_text: '[[[customer-helper]]]',
        customer_helper_text: 'กดปุ่มลงทะเบียนได้เลยค่ะ',
        hook_text_reply_mode: 'strip',
      }),
      profileData: NO_PROFILE_404,
      withImageStorage: true,
    });

    await post([messageEvent('image')]);
    await new Promise((r) => setImmediate(r));

    expect(trace.replies).toEqual(['กดปุ่มลงทะเบียนได้เลยค่ะ']);
    expect(trace.replies.join()).not.toContain('[[[');
  });

  /* [FIX-20260901-OFFMENUTAG] This case used to assert the OPPOSITE:
   *
   *     expect(trace.replies).toEqual(['[[[customer-helper]]]']);
   *
   * i.e. it pinned the CUSTOMER RECEIVING the raw marker as correct behaviour
   * under `off`, on the reading that `off` meant "the feature is switched off".
   * That held until 01/09, when it became clear `off` is not a choice anyone can
   * make — the dashboard has no control for the column, so `off` only ever means
   * "never configured". Measured the same day: 13 of 28 hooks hold this marker,
   * every one of them reads as `off`, so `[FIX-20260812-HELPERMARKERLEAK]` had
   * never actually run on most of the product.
   *
   * This is the end-to-end proof of that leak, inverted into the end-to-end proof
   * that it is closed. It is the only case in the suite that watches the marker
   * travel all the way to `trace.replies`. */
  it("[HELPERMARKERLEAK] mode 'off' (default) ⇒ ถอด marker ไม่ส่งวงเล็บดิบ", async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        image_answer_text: 'รับรูปแล้ว',
        missing_api_data_text: '[[[customer-helper]]]',
        customer_helper_text: 'กดปุ่มลงทะเบียนได้เลยค่ะ',
      }),
      profileData: NO_PROFILE_404,
      withImageStorage: true,
    });

    await post([messageEvent('image')]);
    await new Promise((r) => setImmediate(r));

    /* 🔴 THE CUSTOMER SEES THE CARD. Owner, 01/09: "[[[customer-helper]]]
       ลูกค้าเห็น flex เลย" — the marker means a card, full stop.

       An intermediate version of this fix only STRIPPED the marker under `off`,
       which stopped the raw brackets but left the customer reading
       `customer_helper_text`. That string is the FALLBACK for when a card cannot
       be built (mint down, card missing), not the intended reply. Half a fix
       reads as a whole one until someone opens a real conversation.

       So: no text reply at all, one flex card. */
    expect(trace.replies).toEqual([]);
    expect(trace.flexReplies).toHaveLength(1);
    expect(JSON.stringify(trace.flexReplies[0])).not.toContain('[[[');
  });

  /** An OA that never used a marker must be untouched in every mode. */
  it('[HELPERMARKERLEAK] ข้อความธรรมดา + mode strip ⇒ ไม่เปลี่ยน', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        image_answer_text: 'รับรูปแล้ว',
        missing_api_data_text: 'กรุณาผูกบัญชีก่อนค่ะ',
        hook_text_reply_mode: 'strip',
      }),
      profileData: NO_PROFILE_404,
      withImageStorage: true,
    });

    await post([messageEvent('image')]);
    await new Promise((r) => setImmediate(r));

    expect(trace.replies).toEqual(['กรุณาผูกบัญชีก่อนค่ะ']);
  });
});

/* ════ [RULER-20260815-WLOGGOLDEN] webhook_logs rows — frozen byte-for-byte ════
 *
 * THE RULER for the single-door logging refactor (docs/lockdown_step.md →
 * todo/be_todo6_15082026.md). Each case below drives the REAL pipeline through
 * this file's own harness and freezes EVERY `webhook_logs` payload the run
 * produced — count, order, every key, every value — as one snapshot.
 *
 * WHY IT LIVES IN THIS FILE: line-flow-test §3 — extend the spec that owns the
 * seam. `buildHarness` already records each `createLog` payload into
 * `trace.logRows`; a parallel harness would be a second truth.
 *
 * WHAT A DIFF MEANS: the refactor's contract is byte-identical rows. Any
 * snapshot change here that was not explicitly intended is a FAILURE of that
 * refactor, not drift to accept. Do not `--updateSnapshot` past it without
 * writing down why. สแนปช็อตต่างเมื่อไหร่ = พฤติกรรมเปลี่ยนจริง ห้ามกดอัปทับ.
 *
 * VOLATILE VALUES: event `timestamp` and `duration_ms` are wall-clock and are
 * scrubbed to '<volatile>'; everything else is asserted verbatim. Keys are
 * sorted so the freeze fails on MEANING, not map order.
 *
 * revert: delete this describe block + its entries in __snapshots__.
 */
describe('[RULER-20260815-WLOGGOLDEN] webhook_logs rows are byte-frozen', () => {
  const frozen = freezeLogRows;
  const settle = settleLogWrites;

  /** 404 from the customer API — the unregistered-customer shape. */
  const PROFILE_404 = {
    'Path : api/v1/customer': {
      success: false,
      status: 404,
      data: { message: 'customer not found' },
    },
  };

  it('S1 plain text, provider rejects — incoming + generate_response fallback rows', async () => {
    const { trace, post } = buildHarness();
    await post([textEvent()]);
    await settle();
    // A frozen [] would "pass" forever — the ruler must be measuring something.
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('S2 text + linked profile + scripted answer — generate_response + line_reply rows', async () => {
    const { trace, post } = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'สวัสดีค่ะ ยินดีให้บริการค่ะ',
    });
    await post([textEvent('ยอดคงเหลือ')]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('S3 rate-limited text — rate_limit_reply row', async () => {
    const { trace, post } = buildHarness({ rateLimited: true });
    await post([textEvent()]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('S4 hook status 0 — the off branch writes what it writes today', async () => {
    const { trace, post } = buildHarness({ hook: baseHook({ status: 0 }) });
    await post([textEvent()]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('S5 image + image_answer_text + linked profile — image_answer_reply row', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ image_answer_text: 'รับสลิปแล้วค่ะ' }),
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });
    await post([messageEvent('image')]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('S6 image + unregistered customer — missing_profile_data_reply row', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        image_answer_text: 'รับสลิปแล้วค่ะ',
        missing_api_data_text: 'กรุณาผูกบัญชีก่อนค่ะ',
      }),
      profileData: PROFILE_404,
      withImageStorage: true,
    });
    await post([messageEvent('image')]);
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });

  it('S7 bad signature — the incoming row and nothing else', async () => {
    const { trace, post } = buildHarness();
    await post([textEvent()], { signature: 'not-the-signature' });
    await settle();
    expect(trace.logRows.length).toBeGreaterThan(0);
    expect(frozen(trace.logRows)).toMatchSnapshot();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * [FEAT-20260830-STABLEPROMPT] the stable-prompt gate at the AI seam.
 *
 * hook.ai_stable_prompt === true moves "Today is …" and the [[[history]]]
 * material OUT of suggestionText and onto two new optional request fields
 * (timeContextText / historyBlockText) so system_instruction is byte-stable
 * for Gemini implicit caching. Default false = today's bytes exactly — the
 * cases above this block ARE that pin and must never move.
 * TARGET cases here were red-first on the unchanged tree; the last case is a
 * PIN. Plan: todo/task/30082026/todo1_30082026_*.md · เกตปิด = ไบต์เดิมเป๊ะ.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('webhook ingest — stable-prompt gate [FEAT-20260830-STABLEPROMPT]', () => {
  const asBag = (r: unknown) => r as Record<string, unknown>;

  it('flag ON + marker: time and history leave the suggestion and ride the new fields', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        ai_stable_prompt: true,
        suggestion_text: 'คุณคือแอดมิน\n[[[history]]]\nจบบริบท',
      }),
    });
    await post([textEvent('ยอดค้างเท่าไหร่')]);

    expect(trace.aiRequests).toHaveLength(1);
    const req = trace.aiRequests[0]!;
    expect(req.suggestionText.startsWith('Today is ')).toBe(false);
    expect(req.suggestionText).not.toContain('[[[history]]]');
    expect(req.suggestionText).toContain('คุณคือแอดมิน');
    expect(req.suggestionText).toContain('จบบริบท');
    expect(String(asBag(req)['historyBlockText'])).toContain(
      '[start-of-history]',
    );
    expect(String(asBag(req)['timeContextText'])).toMatch(
      /^Today is .+\(Bangkok Time\)$/,
    );
  });

  it('flag ON + NO marker: history is never fetched — the field stays absent', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        ai_stable_prompt: true,
        suggestion_text: 'คุณคือแอดมิน',
      }),
    });
    await post([textEvent('สวัสดี')]);

    const req = trace.aiRequests[0]!;
    expect(asBag(req)['historyBlockText']).toBeUndefined();
    expect(String(asBag(req)['timeContextText'])).toMatch(/^Today is /);
    expect(req.suggestionText.startsWith('Today is ')).toBe(false);
  });

  it('flag ON + TWO markers: both are removed (the HISTALL rule carries over)', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        ai_stable_prompt: true,
        suggestion_text: 'ก [[[history]]] ข [[[history]]] ค',
      }),
    });
    await post([textEvent('ถาม')]);
    const req = trace.aiRequests[0]!;
    expect(req.suggestionText).not.toContain('[[[history]]]');
    // Without this line the case is green even pre-change (the OLD replaceAll
    // also cleared both markers) — this is what makes it a real TARGET.
    expect(req.suggestionText.startsWith('Today is ')).toBe(false);
  });

  it('flag ON + LEGACY row shape: the marker inside the legacy blob is removed too', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        ai_stable_prompt: true,
        suggestion_text: 'ตำรา[END_OF_BASIC_INFO]\n[[[history]]]\nท้ายตำรา',
      }),
    });
    await post([textEvent('ถาม')]);
    const req = trace.aiRequests[0]!;
    expect(req.suggestionText).not.toContain('[[[history]]]');
    expect(String(asBag(req)['historyBlockText'])).toContain(
      '[start-of-history]',
    );
  });

  /* [FLIP-20260830-STABLEPROMPT] this PIN used to freeze "flag absent = old
     prepend/inject". Owner order 30/08 flipped the default, so absent now
     means the STABLE layout, and the OLD path is pinned through the explicit
     opt-out (ai_stable_prompt: false) — the per-OA emergency revert. */
  it('flag ABSENT → stable layout is the default (absent means ON)', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ suggestion_text: 'คุณคือแอดมิน\n[[[history]]]' }),
    });
    await post([textEvent('ถาม')]);
    const req = trace.aiRequests[0]!;
    expect(req.suggestionText.startsWith('Today is ')).toBe(false);
    expect(req.suggestionText).not.toContain('[[[history]]]');
    expect(String(asBag(req)['historyBlockText'])).toContain(
      '[start-of-history]',
    );
    expect(String(asBag(req)['timeContextText'])).toMatch(/^Today is /);
  });

  it('PIN: explicit false = the per-OA opt-out — old prepend/inject byte path', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        ai_stable_prompt: false,
        suggestion_text: 'คุณคือแอดมิน\n[[[history]]]',
      }),
    });
    await post([textEvent('ถาม')]);
    const req = trace.aiRequests[0]!;
    expect(req.suggestionText.startsWith('Today is ')).toBe(true);
    expect(req.suggestionText).toContain('[start-of-history]');
    expect(asBag(req)['historyBlockText']).toBeUndefined();
    expect(asBag(req)['timeContextText']).toBeUndefined();
  });

  /* [FIX-20260830-STABLEPIN] the three review-confirmed blind spots, closed.
     Each was proven by a surviving mutation before these cases existed —
     they are the teeth, re-verified red against those exact mutants. */

  it('PIN: opt-out carries REAL prior messages inside the suggestion (not just fences)', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({
        ai_stable_prompt: false,
        suggestion_text: 'คุณคือแอดมิน\n[[[history]]]',
      }),
      room: { _id: 'room-hist' },
      historyMsgs: [
        { sender_type: 'bot', content: 'คำตอบเก่า' },
        { sender_type: 'customer', content: 'คำถามเก่า' },
      ],
    });
    await post([textEvent('ถาม')]);
    const req = trace.aiRequests[0]!;
    // oldest→newest inside the fences, real content — the empty 'none' fence
    // must NOT satisfy this pin.
    expect(req.suggestionText).toContain('Customer: คำถามเก่า');
    expect(req.suggestionText).toContain('Bot: คำตอบเก่า');
    expect(req.suggestionText).not.toContain('\nnone\n');
  });

  it('stable path carries REAL prior messages on historyBlockText', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ suggestion_text: 'คุณคือแอดมิน\n[[[history]]]' }),
      room: { _id: 'room-hist' },
      historyMsgs: [{ sender_type: 'customer', content: 'คำถามเก่า' }],
    });
    await post([textEvent('ถาม')]);
    const hist = String(asBag(trace.aiRequests[0]!)['historyBlockText']);
    expect(hist).toContain('Customer: คำถามเก่า');
    expect(hist).not.toContain('\nnone\n');
  });

  it('§5.4: history DB error on the stable path — marker still stripped, block absent', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ suggestion_text: 'คุณคือแอดมิน\n[[[history]]]\nท้าย' }),
      roomLookupRejects: true,
    });
    await post([textEvent('ถาม')]);
    const req = trace.aiRequests[0]!;
    // the strip lives OUTSIDE the try — a fetch error may cost the history,
    // never leak the raw marker into the prompt.
    expect(req.suggestionText).not.toContain('[[[history]]]');
    expect(req.suggestionText).toContain('ท้าย');
    expect(asBag(req)['historyBlockText']).toBeUndefined();
    expect(String(asBag(req)['timeContextText'])).toMatch(/^Today is /);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * [FEAT-20260902-NOWBLOCK] the seat — does the guarded call actually fire, and
 * does OFF really add nothing?
 *
 * The block's own logic is proven in now-status / now-block-* ; what those files
 * CANNOT prove is that `webhook.service.ts` calls it, on the right branch, with
 * the same instant the time line uses. That is what these cases hold.
 *
 * ⚠️ OFF is the default and the first case is the one that matters most: with the
 * switch unset the request must look exactly as it did before this feature
 * existed. Every other case in this file is that same pin from a different angle.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('webhook ingest — the [START_OF_NOW] seat [FEAT-20260902-NOWBLOCK]', () => {
  const asBag = (r: unknown) => r as Record<string, unknown>;

  /* 🔴 03/09/2026 — the lever changed. These cases used to set
     `process.env.AI_NOW_BLOCK = 'on'`; the owner removed the env layer, so ON is now
     produced by spying the resolver at the module boundary. (18/10 the env layer came
     back — `AI_NOW_BLOCK` via the validated env; the spy here is still the simplest lever.) The OFF case below sets
     nothing at all and was NOT rewritten — it is the pin that matters most, and it
     must keep asserting exactly what it asserted before. */
  let modeSpy: jest.SpyInstance | null = null;
  const switchOn = (): void => {
    modeSpy = jest
      .spyOn(nowBlockMode, 'resolveNowBlockMode')
      .mockReturnValue('on');
  };

  /* Restore THIS spy only — `jest.restoreAllMocks()` would also tear down spies
     that other describes in this 2,500-line file install for their own harness. */
  afterEach(() => {
    modeSpy?.mockRestore();
    modeSpy = null;
  });

  it('PIN: switch untouched → no field, no block text anywhere in the prompt', async () => {
    const { trace, post } = buildHarness({
      hook: baseHook({ suggestion_text: 'คุณคือแอดมิน' }),
    });
    await post([textEvent('สวัสดี')]);

    const req = trace.aiRequests[0]!;
    expect(asBag(req)['nowBlockText']).toBeUndefined();
    expect(req.suggestionText).not.toContain('[START_OF_NOW]');
    // and the line it sits beside is untouched
    expect(String(asBag(req)['timeContextText'])).toMatch(/^Today is /);
  });

  it('switch on, stable layout → the block rides its own field, not the document', async () => {
    switchOn();
    const { trace, post } = buildHarness({
      hook: baseHook({ suggestion_text: 'คุณคือแอดมิน' }),
    });
    await post([textEvent('สวัสดี')]);

    const req = trace.aiRequests[0]!;
    const block = String(asBag(req)['nowBlockText']);
    expect(block.startsWith('[START_OF_NOW]')).toBe(true);
    expect(block).toContain('status = ');
    // the training document must NOT have grown — that is the whole point of the
    // stable layout: system_instruction stays byte-stable for the model cache.
    expect(req.suggestionText).not.toContain('[START_OF_NOW]');
  });

  it('switch on, opt-out branch → the block goes into the document instead', async () => {
    switchOn();
    const { trace, post } = buildHarness({
      hook: baseHook({
        ai_stable_prompt: false,
        suggestion_text: 'คุณคือแอดมิน',
      }),
    });
    await post([textEvent('สวัสดี')]);

    const req = trace.aiRequests[0]!;
    expect(asBag(req)['nowBlockText']).toBeUndefined();
    expect(req.suggestionText).toContain('[START_OF_NOW]');
    expect(req.suggestionText).toContain('[END_OF_NOW]');
    // the old prepend still happens — the block is additive, not a replacement
    expect(req.suggestionText).toContain('Today is ');
  });

  /* ONE instant, not two. If the seat read its own clock the two values could
     straddle a second — or, at 23:59:59.999, a whole day — and the block would
     contradict the very line it was put next to. */
  it('the block quotes the same Thai time string as the time line', async () => {
    switchOn();
    const { trace, post } = buildHarness({
      hook: baseHook({ suggestion_text: 'คุณคือแอดมิน' }),
    });
    await post([textEvent('สวัสดี')]);

    const req = trace.aiRequests[0]!;
    const timeLine = String(asBag(req)['timeContextText']);
    const thai = timeLine
      .replace(/^Today is /, '')
      .replace(/ \(Bangkok Time\)$/, '');
    expect(String(asBag(req)['nowBlockText'])).toContain(
      `datetime_th = ${thai}`,
    );
  });
});
