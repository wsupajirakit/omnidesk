import { createHmac } from 'node:crypto';

import { Logger } from '@nestjs/common';

import {
  AiProviderUnavailableError,
  AssistSummaryUnavailableError,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';

/**
 * ==== [TEST-20260905-GATEALIAS] the two alias gates at the top of the spine ====
 *
 * `processLockedEvent` opens with two gates, twenty-four lines apart, and until this file
 * existed NO spec asserted either of them. Ten suites drive this method, and every one of
 * them hands in a hook that is already resolved — so the re-resolve never ran, and the
 * unknown-alias return was never taken, in the whole test tree.
 *
 *   · the RE-RESOLVE  `if (!hook && alias)`  — the caller may arrive with only a URL
 *     segment. This asks the hook cache once and adopts the answer, and everything
 *     downstream (the log rows, the credentials, the room key) is built from it.
 *   · the 404 TWIN    `if (alias && !hook)`  — the alias resolved to nothing. The turn
 *     ends here, above the re-assist `finally` (installed ~200 lines below) and above the
 *     first write.
 *
 * WHAT THESE CASES PIN, AND WHAT THEY DO NOT. Each case names ONE observable. They are
 * characterisation tests: they record what the code does today so a later cut of the
 * spine has something to disagree with. They do not assert the log LINE wording anywhere
 * it is not the only effect, and they do not snapshot the whole turn — the full-flow
 * cameras (`room-bootstrap-before-pack.spec.ts` and friends) already own that.
 *
 * HARNESS. The doubles are modelled on `room-bootstrap-before-pack.spec.ts`, whose
 * `buildHarness` is file-private, so the shapes are mirrored rather than imported. Two
 * things differ, both because these gates need them: `post()` takes the hook and the
 * alias per call (that pair IS the input to both gates), and the webhook_logs double
 * keeps the WHOLE row instead of its `action_type`, because `hook_id` is the observable.
 *
 * Nothing here is billed, nothing leaves the process: the AI double rejects, the LINE
 * token is dead, and there is no Redis. revert: delete this file. No prod import.
 */

const CHANNEL_SECRET = 'gatealias-channel-secret';
const HOOK_ID = 'a0d000000000000000000053';
const ALIAS = 'gatealias';
const GHOST_ALIAS = 'no-such-oa';
const USER_ID = 'Ugatealias000000000000000000001';

interface Trace {
  /** Ordered collaborator calls — the "did anything else happen" channel. */
  steps: string[];
  /** Whole `webhook_logs` rows, not their kinds: `hook_id` is what B6 reads. */
  logRows: Array<Record<string, unknown>>;
  /** `chatHistory.logMessage` rows — the first customer-visible write of a turn. */
  chatRows: Array<Record<string, unknown>>;
  /** Direct `chatHistory.getOrCreateRoom` calls — the room/member bootstrap. */
  roomEnsure: unknown[];
  /** Every alias handed to `getHookByAliasWithSource`, in call order. */
  aliasLookups: Array<string | undefined | null>;
}

/** A mongoose-ish chainable query that resolves to `result`. */
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

function baseHook(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: ALIAS,
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'gatealias-dead-token', // dead — any real send would 401
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
    ...over,
  };
}

/** The shape the refusal gate reads as "this customer has an account". */
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
  /**
   * What the hook cache answers. A hook ⇒ `{hook, source:'db'}`; `null` ⇒
   * `{hook:null, source:'miss'}`, which is the real service's own miss shape
   * (`hook-cache.service.ts:308`) rather than a shape invented here.
   */
  cacheResolves?: Record<string, unknown> | null;
  aiReplyText?: string;
  profileData?: Record<string, unknown>;
}

function buildHarness(opts: Opts = {}): {
  trace: Trace;
  post: (
    events: unknown[],
    hookIn: Record<string, unknown> | undefined,
    alias: string | undefined,
  ) => Promise<void>;
} {
  const trace: Trace = {
    steps: [],
    logRows: [],
    chatRows: [],
    roomEnsure: [],
    aliasLookups: [],
  };

  const passthrough = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'x' }),
    updateOne: () => query({ acknowledged: true }),
    findById: () => query(null),
    countDocuments: () => query(0),
  };

  const service = new WebhookService(
    {
      findOne: () => {
        trace.steps.push('hook.findOne');
        return query(opts.cacheResolves ?? null);
      },
    } as never, // hookModel
    {
      findOne: () => {
        trace.steps.push('room.findOne');
        return query(null);
      },
      findOneAndUpdate: () => {
        trace.steps.push('room.upsert');
        return query({ _id: 'room-1' });
      },
      updateOne: () => {
        trace.steps.push('room.update');
        return query({ acknowledged: true });
      },
    } as never, // chatRoomModel
    {
      findOne: () => query(null),
      find: () => query([]),
      create: () => Promise.resolve({ _id: 'msg-x' }),
      updateOne: () => query({ acknowledged: true }),
      countDocuments: () => query(0),
    } as never, // chatMessageModel
    {
      findOne: () => {
        trace.steps.push('member.read');
        return query(null);
      },
      find: () => query([]),
      create: () => Promise.resolve({ _id: 'mem-1' }),
      updateOne: () => {
        trace.steps.push('member.write');
        return query({ acknowledged: true });
      },
      findOneAndUpdate: () => {
        trace.steps.push('member.write');
        return query({ _id: 'mem-1' });
      },
      findById: () => query(null),
      countDocuments: () => query(0),
    } as never, // memberModel
    passthrough as never, // assignHistoryModel
    passthrough as never, // ticketModel
    passthrough as never, // objectImageModel
    { findById: () => query(null) } as never, // imageStorageModel
    { safeDecrypt: (v: string) => v } as never, // crypto
    {
      cacheHook: () => Promise.resolve(),
      getHookByAlias: () => Promise.resolve(opts.cacheResolves ?? null),
      // ⭐ The seam under test. Records the alias it was asked for, so "called once,
      //    with THIS alias" and "never called" are both readable off one array.
      getHookByAliasWithSource: (alias: string | undefined | null) => {
        trace.steps.push('hookCache.byAlias');
        trace.aliasLookups.push(alias);
        const hit = opts.cacheResolves ?? null;
        return Promise.resolve(
          hit ? { hook: hit, source: 'db' } : { hook: null, source: 'miss' },
        );
      },
    } as never, // hookCache
    {
      logMessage: (row: Record<string, unknown>) => {
        trace.steps.push('chat.log');
        trace.chatRows.push(row);
        return Promise.resolve({ _id: 'msg-1', room_id: 'room-1' });
      },
      logSystemMessage: () => {
        trace.steps.push('chat.systemLog');
        return Promise.resolve({ _id: 'sys-1' });
      },
      resolveRoom: () => Promise.resolve({ _id: 'room-1' }),
      getOrCreateRoom: (...args: unknown[]) => {
        trace.steps.push('room.ensure');
        trace.roomEnsure.push(args);
        return Promise.resolve({ _id: 'room-1' });
      },
    } as never, // chatHistory
    {
      sendLineReplyMessage: () => {
        trace.steps.push('line.reply');
        return Promise.resolve({ status: 200, data: {} });
      },
      sendLineFlexReply: () => {
        trace.steps.push('line.flex');
        return Promise.resolve({ status: 200, data: { sentMessages: [] } });
      },
      sendLineLoadingIndicator: () =>
        Promise.resolve({ status: 200, data: {} }),
      sendLinePushMessage: () => Promise.resolve({ status: 200, data: {} }),
      sendLinePushFlexMessage: () => Promise.resolve({ status: 200, data: {} }),
      getLineProfile: () => {
        trace.steps.push('line.profile');
        return Promise.resolve(null);
      },
    } as never, // lineApi
    {
      downloadAndSaveImage: () => Promise.resolve(null),
      downloadAndSaveVideo: () => Promise.resolve(null),
    } as never, // lineContent
    {
      // The whole row, verbatim: `hook_id` is the observable B6 reads, and the
      // emitter has already stripped the undefined keys by the time it lands here.
      createLog: (row: Record<string, unknown>) => {
        trace.steps.push('wlog');
        trace.logRows.push(row);
        return Promise.resolve();
      },
    } as never, // webhookLogs
    {
      getCombinedData: () => {
        trace.steps.push('external.fetch');
        return Promise.resolve(opts.profileData ?? {});
      },
    } as never, // externalApi
    {
      getToolForHook: () => Promise.resolve(null),
      getCombinedData: () => Promise.resolve(opts.profileData ?? {}),
      extractProfile: () => null,
    } as never, // customTool
    { consume: () => Promise.resolve({ limited: false }) } as never, // rateLimit
    {
      getClient: () => {
        throw new Error('no redis in unit test');
      },
    } as never, // redis
    {
      generate: () => {
        trace.steps.push('ai.generate');
        if (opts.aiReplyText !== undefined) {
          return Promise.resolve({
            text: opts.aiReplyText,
            noData: false,
            tagStatus: null,
          });
        }
        return Promise.reject(new AiProviderUnavailableError());
      },
    },
    { summarise: () => Promise.reject(new AssistSummaryUnavailableError()) },
    { getConfigByKey: () => Promise.resolve(null) } as never, // systemConfig
    { telegramWebhookSecret: undefined, multiEventDelivery: false }, // channel
    { geminiApiKey: undefined, modelId: 'gemini-3.5-flash' } as never, // ai
    { ignoreDocId: undefined } as never, // integration
    { publish: () => Promise.resolve() } as never, // realtimePublisher
    {
      mintLinkToken: () => ({
        url: 'https://link.test/x',
        token: 'tok',
        expiresAt: 0,
      }),
    } as never, // customerLink
    { findOne: () => query(null), findById: () => query(null) } as never, // flexModel
    {
      translate: (_d: string, k: string | number | null) => `${k ?? ''}`,
    } as never, // translationDict
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
    { checkIfSlipWithQrCode: () => Promise.resolve(false) } as never, // qrVision
    undefined, // configCacheInvalidator
    undefined, // paymentRunner
    undefined, // docRetrievalProvider
    undefined, // strike
    {
      // The push core carries the reply on some arms; without it a send throws
      // "not bound" and the turn dies before the line these gates care about.
      dispatch: (req: { messages?: Array<Record<string, unknown>> }) => {
        const isFlex = req.messages?.[0]?.['type'] === 'flex';
        trace.steps.push(isFlex ? 'line.flex' : 'line.reply');
        return Promise.resolve({
          ok: true,
          status: 200,
          attempts: 1,
          durationMs: 0,
          data: isFlex ? { sentMessages: [] } : {},
        });
      },
    } as never, // linePush
  );

  const post = async (
    events: unknown[],
    hookIn: Record<string, unknown> | undefined,
    alias: string | undefined,
  ): Promise<void> => {
    const body = { destination: 'Ugatealias', events };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: `/${alias ?? ''}/webhook`,
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    // `hookSource` is 'cache' only when a hook came with the request; an
    // alias-only delivery has no source yet, which is what the re-resolve fills in.
    await service.processWebhook(
      body,
      hookIn,
      hookIn ? 'cache' : undefined,
      alias,
      meta,
    );
  };

  return { trace, post };
}

function textEvent(): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-1',
    replyToken: 'rt-1',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'm1', text: 'ยอดเท่าไหร่' },
  };
}

const incomingRow = (trace: Trace): Record<string, unknown> | undefined =>
  trace.logRows.find((r) => r['action_type'] === 'incoming_line_webhook');

afterEach(() => {
  jest.restoreAllMocks();
});

describe('[TEST-20260905-GATEALIAS] B6 — an alias-only delivery adopts the hook the cache answers with', () => {
  /**
   * PROTECTS AGAINST: the resolved hook being looked up and then dropped on the floor.
   * Every row, credential and room key of the turn is derived from `hook` after this
   * gate, so a re-resolve that asks and does not adopt produces a turn that runs to
   * completion against NO hook — an `incoming_line_webhook` row with no `hook_id` is the
   * first place that shows, and it is the row an incident opens with. The lookup and the
   * adoption are asserted together on purpose: asserting the call alone would stay green
   * if the assignment were deleted.
   */
  it('asks the cache once for that alias and files the answer under the resolved hook', async () => {
    const hook = baseHook();
    const h = buildHarness({
      cacheResolves: hook,
      profileData: LINKED_PROFILE,
      aiReplyText: 'ตอบแล้วค่ะ',
    });

    await h.post([textEvent()], undefined, ALIAS);

    // One lookup, for THIS alias — the array carries the count and the argument.
    expect(h.trace.aliasLookups).toEqual([ALIAS]);
    // …and the answer became the turn's hook, which is what the inbound row records.
    expect(incomingRow(h.trace)?.['hook_id']).toBe(HOOK_ID);
  });

  /**
   * PROTECTS AGAINST: a cache read on the hot path that nobody asked for. The controller
   * guard has already resolved the alias and handed the hook down; re-asking here would
   * put an L1/Redis/Mongo round trip on EVERY inbound message of every OA, and it would
   * be invisible — the reply would be identical, only slower and more expensive. That is
   * the shape of regression this repo has been bitten by before (see the vendor-column
   * note at the cache re-read twenty lines below the gate).
   */
  it('never consults the cache when the caller already resolved the hook', async () => {
    const hook = baseHook();
    const h = buildHarness({
      cacheResolves: hook,
      profileData: LINKED_PROFILE,
      aiReplyText: 'ตอบแล้วค่ะ',
    });

    await h.post([textEvent()], hook, ALIAS);

    expect(h.trace.aliasLookups).toEqual([]);
  });
});

describe('[TEST-20260905-GATEALIAS] B5 — an alias that resolves to nothing ends the turn', () => {
  /**
   * PROTECTS AGAINST: an unknown alias reaching the writes. The first write on this path
   * is the room/member bootstrap ~260 lines below; a delivery for an OA that does not
   * exist must not create a room, a member or a chat row, because nothing would ever
   * clean them up and no operator could explain them. The inbound row is the ONE thing
   * that must still be written — it is the only record that the delivery arrived at all,
   * and it is written above this gate on purpose.
   *
   * ⚠️ The `hook resolved` assertion is not decoration, and it is not "asserting a log
   * line" for its own sake: the caller already has its 200 (the controller answered
   * before this method ran), so on this path the log IS the whole observable behaviour.
   * It is also the only assertion here that a single-line mutation of the gate can kill —
   * see the note under the describe block below for why the three emptiness assertions
   * cannot, today.
   */
  it('warns and stops before the room bootstrap, leaving only the inbound row behind', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const h = buildHarness({ cacheResolves: null });

    await h.post([textEvent()], undefined, GHOST_ALIAS);

    // Exactly one row: the raw delivery, filed above the gate.
    expect(h.trace.logRows.map((r) => r['action_type'])).toEqual([
      'incoming_line_webhook',
    ]);
    // Nothing was written for a customer of an OA that does not exist.
    expect(h.trace.chatRows).toEqual([]);
    expect(h.trace.roomEnsure).toEqual([]);
    // The turn ended AT the gate: the warn fired…
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(
      `[WEBHOOK] 404 Unknown alias: ${GHOST_ALIAS}`,
    );
    // …and `hook resolved`, the first line below the gate, never ran.
    expect(
      log.mock.calls.filter((c) => String(c[0]).startsWith('hook resolved')),
    ).toEqual([]);
  });
});

/**
 * ⚠️ WHAT THE EMPTINESS ABOVE DOES AND DOES NOT PROVE — read before trusting it.
 *
 * Deleting the gate's `return` would NOT, on its own, make `chatRows`/`roomEnsure`
 * non-empty. Two sites say so between them: with no hook,
 * `ai-vendors/request-credentials.ts` derives `channelSecret` as
 * `safeDecrypt(undefined) || ''`, and `validateSignature` answers false on an empty
 * secret before it hashes anything (`if (!signature || !channelSecret || !body) return
 * false`). The signature re-check therefore catches the same delivery further down and
 * returns above the room bootstrap anyway — the unknown-alias path is double-netted.
 *
 * So the emptiness is pinned as a FORWARD guard, not as evidence that THIS gate is what
 * stops the turn. It goes red the day a write is moved above these gates, which is
 * exactly the drift `[FEAT-20260826-STRIKESUSPEND]` warns about twenty lines below the
 * gate ("THE POSITION IS THE FEATURE"). The `hook resolved` assertion is the one that
 * fails when the gate itself is broken, which is why it is in the case.
 * เก็บทั้งสองแบบ · อย่าเชื่อว่า "ว่างเปล่า" แปลว่าเกตทำงาน
 *
 * ⚠️ HOW THESE CASES WERE PROVEN KILLABLE. The product file was being edited in another
 * lane at the time, so each expectation was inverted HERE — flipped to the value a broken
 * gate would produce — and confirmed red one at a time, six inversions across the three
 * cases. That proves every assertion reads a real recorded value; it does not substitute
 * for a mutation run against the gate itself, which is still owed.
 */
