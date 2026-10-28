import { createHmac } from 'node:crypto';

import {
  AiProviderUnavailableError,
  AssistSummaryUnavailableError,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';

/**
 * Characterisation of two gates in `src/modules/webhook/webhook.service.ts` that had no
 * assertion of their own before this file existed.
 *
 *   B1 — the inbound VIDEO gate, anchor `event.message?.type === 'video' && event.message.id`.
 *        It decides whether the customer's chat row is stored as `video` or as
 *        `video_pending`.
 *   B3 — the events RE-READ, anchor `const reread = (body['events'] as LineEvent[]...)?.[0]`.
 *        It decides WHICH event the locked run actually processes.
 *
 * WHY THE CUSTOMER CHAT ROW IS THE OBSERVABLE IN ALL FOUR CASES. `POST /webhook` has
 * already answered 200 before any of this runs, so there is no HTTP surface to assert
 * against. Both gates write their decision into exactly one place a human can later see:
 * the row `chatHistory.logMessage` receives. Everything else they touch (a local `let`, a
 * log line) is invisible the moment the request ends.
 *
 * HARNESS PROVENANCE. Mirrored from `z-test/unit/room-bootstrap-before-pack.spec.ts`
 * (`buildHarness` there is file-local, not exported, so it is mirrored rather than
 * imported) and trimmed to what these four cases need, plus one addition: the whole chat
 * row is recorded, not just a `senderType:messageType` string, because B3 asserts the
 * row's CONTENT. Fakes record; nothing is billed; the LINE token is dead.
 *
 * revert: delete this file. No production import, no snapshot.
 */

const CHANNEL_SECRET = 'gatevid-channel-secret';
const HOOK_ID = 'a0d000000000000000000054';
const USER_ID = 'Ugatevid000000000000000000000001';

interface Trace {
  /** Every row handed to `chatHistory.logMessage`, in the order it was handed over. */
  chatRows: Array<Record<string, unknown>>;
}

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
  /**
   * What `lineContent.downloadAndSaveVideo` resolves to. `null` (the default) is LINE
   * answering "still transcoding" — the case the whole `video_pending` design exists for.
   */
  videoStorageId?: string | null;
  /** Text the fake AI answers with. Undefined ⇒ the provider is unavailable. */
  aiReplyText?: string;
}

function baseHook(): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: 'gatevid',
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'gatevid-dead-token', // dead — any real send would 401
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
  };
}

/** A customer the profile API knows, so the flow takes its ordinary registered path. */
const LINKED_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'Somchai Test', customer_tel: '0800000000' },
    },
  },
};

function buildHarness(opts: Opts = {}): {
  trace: Trace;
  /** The public path: `processWebhook` unpacks the array and re-reads `events[0]`. */
  post: (events: unknown[]) => Promise<void>;
  /**
   * The locked run, reached DIRECTLY so `body` and `event` can disagree. See the B3
   * describe block for why the public path cannot produce that disagreement.
   */
  runLocked: (
    body: Record<string, unknown>,
    event: Record<string, unknown>,
  ) => Promise<void>;
} {
  const hook = baseHook();
  const trace: Trace = { chatRows: [] };

  const hookModel = { findOne: () => query(hook) };
  const chatRoomModel = {
    findOne: () => query(null),
    findOneAndUpdate: () => query({ _id: 'room-1' }),
    updateOne: () => query({ acknowledged: true }),
  };
  const passthrough = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'x' }),
    updateOne: () => query({ acknowledged: true }),
    findOneAndUpdate: () => query({ _id: 'x' }),
    findById: () => query(null),
    countDocuments: () => query(0),
  };

  const service = new WebhookService(
    hookModel as never,
    chatRoomModel as never,
    { ...passthrough } as never, // chatMessageModel
    { ...passthrough } as never, // memberModel
    { ...passthrough } as never, // assignHistoryModel
    { ...passthrough } as never, // ticketModel
    { ...passthrough } as never, // objectImageModel
    { ...passthrough } as never, // imageStorageModel
    { safeDecrypt: (v: string) => v } as never,
    {
      cacheHook: () => Promise.resolve(),
      getHookByAlias: () => Promise.resolve(hook),
      getHookByAliasWithSource: () =>
        Promise.resolve({ hook, source: 'cache' }),
    } as never, // hookCache
    {
      // The seam under test in every case here: the row as the spine hands it over.
      logMessage: (row: Record<string, unknown>) => {
        trace.chatRows.push(row);
        return Promise.resolve({ _id: 'msg-1', room_id: 'room-1' });
      },
      logSystemMessage: () => Promise.resolve({ _id: 'sys-1' }),
      resolveRoom: () => Promise.resolve({ _id: 'room-1' }),
      getOrCreateRoom: () => Promise.resolve({ _id: 'room-1' }),
    } as never, // chatHistory
    {
      sendLineReplyMessage: () => Promise.resolve({ status: 200, data: {} }),
      sendLineFlexReply: () =>
        Promise.resolve({ status: 200, data: { sentMessages: [] } }),
      sendLineLoadingIndicator: () =>
        Promise.resolve({ status: 200, data: {} }),
      sendLinePushMessage: () => Promise.resolve({ status: 200, data: {} }),
      sendLinePushFlexMessage: () => Promise.resolve({ status: 200, data: {} }),
      getLineProfile: () => Promise.resolve(null),
    } as never, // lineApi
    {
      downloadAndSaveImage: () => Promise.resolve(null),
      /* The ONE call the B1 gate makes. `null` is not a failure — it is LINE saying the
         file is not transcoded yet, which is the whole reason the gate exists. */
      downloadAndSaveVideo: () => Promise.resolve(opts.videoStorageId ?? null),
    } as never, // lineContent
    { createLog: () => Promise.resolve() } as never, // webhookLogs
    { getCombinedData: () => Promise.resolve(LINKED_PROFILE) } as never,
    {
      getToolForHook: () => Promise.resolve(null),
      getCombinedData: () => Promise.resolve(LINKED_PROFILE),
      extractProfile: () => null,
    } as never, // customTool
    { consume: () => Promise.resolve({ limited: false }) } as never,
    {
      getClient: () => {
        throw new Error('no redis in unit test');
      },
    } as never,
    {
      generate: () =>
        opts.aiReplyText === undefined
          ? Promise.reject(new AiProviderUnavailableError())
          : Promise.resolve({
              text: opts.aiReplyText,
              noData: false,
              tagStatus: null,
            }),
    },
    { summarise: () => Promise.reject(new AssistSummaryUnavailableError()) },
    { getConfigByKey: () => Promise.resolve(null) } as never,
    { telegramWebhookSecret: undefined, multiEventDelivery: false },
    { geminiApiKey: undefined, modelId: 'gemini-3.5-flash' } as never,
    { ignoreDocId: undefined } as never,
    { publish: () => Promise.resolve() } as never,
    {
      mintLinkToken: () => ({
        url: 'https://link.test/x',
        token: 'tok',
        expiresAt: 0,
      }),
    } as never, // customerLink
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
    } as never, // slipFlow
    { checkIfSlipWithQrCode: () => Promise.resolve(false) } as never,
    undefined, // configCacheInvalidator
    undefined, // paymentRunner
    undefined, // docRetrievalProvider
    undefined, // strike
    {
      /* `ok` is what the caller branches on: the push core answers `{ok:false,...}`
         instead of rejecting, so a double answering only `status` would let a refused
         send read as delivered. */
      dispatch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          attempts: 1,
          durationMs: 0,
          data: {},
        }),
    } as never, // linePush
  );

  /** A meta whose signature is over exactly the bytes of the body being handed in. */
  const metaFor = (body: Record<string, unknown>): WebhookRequestMeta => {
    const raw = Buffer.from(JSON.stringify(body));
    return {
      method: 'POST',
      originalUrl: '/gatevid/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
  };

  const post = async (events: unknown[]): Promise<void> => {
    const body = { destination: 'Ugatevid', events };
    await service.processWebhook(body, hook, 'cache', 'gatevid', metaFor(body));
  };

  const runLocked = async (
    body: Record<string, unknown>,
    event: Record<string, unknown>,
  ): Promise<void> => {
    /* Element access, not a cast to a hand-written signature: `processLockedEvent` is
       private, and TypeScript's index-access escape hatch keeps the REAL parameter list
       under the compiler's eye. The same hatch `webhook-ingest-flow.spec.ts` uses for
       `service['logger']`. */
    await service['processLockedEvent'](
      body,
      event,
      hook,
      'cache',
      'gatevid',
      metaFor(body),
    );
  };

  return { trace, post, runLocked };
}

function ev(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-1',
    replyToken: 'rt-1',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'm1', text: 'hello' },
    ...over,
  };
}

/** The customer's own row — the bot's replies land in the same sink. */
const customerRow = (t: Trace): Record<string, unknown> | undefined =>
  t.chatRows.find((r) => r['senderType'] === 'customer');

// ═══════════════════════════════════════════════════════════════════════════
// B1 — the inbound VIDEO gate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The gate makes ONE download attempt, never retries and never polls, and turns the
 * answer into the stored message type. `z-test/unit/retry-video-download.spec.ts` covers
 * the READER of this contract — the "download" button an admin presses later, which
 * refuses any row that is not exactly `video_pending`. Nothing there proves the webhook
 * ever writes that value; these two cases are the writer's half and are deliberately not
 * a copy of it.
 */
describe('inbound video gate — what the customer chat row is stored as', () => {
  /* Protects against: the download succeeding and the row still being written as
     `video_pending`. The admin would then be offered a "download" button for a file that
     is already stored, and pressing it would be refused by `retryVideoDownload`'s
     `message_type !== 'video_pending'` guard — a video the operator can see in the
     database but cannot open from the chat. */
  it('a video LINE could hand over is stored as a playable video', async () => {
    const h = buildHarness({ videoStorageId: 'vid-storage-1' });

    await h.post([ev({ message: { type: 'video', id: 'v1' } })]);

    expect(customerRow(h.trace)?.['messageType']).toBe('video');
  });

  /* Protects against: LINE still transcoding and the row being written as a plain
     `video` anyway. The chat UI would render an empty bubble with no way back — the
     retry endpoint refuses anything that is not `video_pending`, so the customer's video
     would be unrecoverable rather than merely late. This is the regression
     [FIX-20260728-VIDEO-PENDING] was opened for. */
  it('a video LINE is still transcoding is stored as pending, so it can be fetched later', async () => {
    const h = buildHarness({ videoStorageId: null });

    await h.post([ev({ message: { type: 'video', id: 'v1' } })]);

    expect(customerRow(h.trace)?.['messageType']).toBe('video_pending');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3 — the events RE-READ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `const reread = (body['events'] as LineEvent[] | undefined)?.[0]` — the locked run
 * takes its event from the BODY it was handed, not from the `event` argument, and
 * re-derives `userId` from it.
 *
 * ⚠️ WHY THESE TWO CASES CALL THE LOCKED RUN DIRECTLY, AND WHY THAT IS NOT A CONTRADICTION
 * OF THE MULTI-EVENT DESIGN. `event-iteration/run-delivery-events.ts` is built so the two
 * can never disagree: iteration 0 is handed the ORIGINAL body (and selection is a prefix,
 * so `events[0]` IS iteration 0's event), and every later iteration is handed
 * `{...body, events: [thatEvent]}` — a body sliced to contain exactly the event being
 * processed. That is precisely how the loop neutralises this re-read WITHOUT editing it.
 * So there is no delivery, at any switch setting, that reaches `processLockedEvent` with
 * a mismatched pair; driving it through `processWebhook` could only ever assert that the
 * argument equals itself. These cases therefore state the METHOD's own contract — the
 * body is the authority — which is exactly the invariant the loop is written to satisfy,
 * and which a future caller of `processLockedEvent` would have to keep satisfying.
 */
describe('events re-read — which event the locked run actually processes', () => {
  /* Protects against: the re-read being "simplified away" in favour of the `event`
     argument. Today that swap is invisible — the loop keeps the two identical — so it
     would pass every existing suite, and would silently move the load-bearing rule out of
     the spine and into its callers. The day a caller passes a body and an event that
     disagree, the wrong customer's message is stored under the wrong identity. */
  it("stores the body's event, not the event object the caller passed in", async () => {
    const h = buildHarness({ aiReplyText: 'answered' });

    const fromBody = ev({
      eventId: 'ev-body',
      message: { type: 'text', id: 'm-body', text: 'the body event' },
    });
    const fromArgument = ev({
      eventId: 'ev-arg',
      message: { type: 'text', id: 'm-arg', text: 'the argument event' },
    });

    await h.runLocked(
      { destination: 'Ugatevid', events: [fromBody] },
      fromArgument,
    );

    expect(customerRow(h.trace)?.['content']).toBe('the body event');
  });

  /* Protects against: the `if (!reread) return;` being dropped or turned into a fallback
     to the argument. LINE's "Verify" button posts `events: []`; a body with no events
     must leave nothing behind, and a fallback would turn that health check into a chat
     row for a customer who never wrote anything. */
  it('writes no chat row at all when the body carries no events', async () => {
    const h = buildHarness({ aiReplyText: 'answered' });

    await h.runLocked({ destination: 'Ugatevid', events: [] }, ev());

    expect(h.trace.chatRows).toEqual([]);
  });
});
