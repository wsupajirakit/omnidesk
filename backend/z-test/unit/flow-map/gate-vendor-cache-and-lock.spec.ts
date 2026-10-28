import { createHmac } from 'node:crypto';

import {
  AI_VENDORS,
  resolveVendorColumns,
  type AiVendor,
} from '@/modules/hooks';
import {
  type AiReplyRequest,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';

/**
 * [TEST-20260905-SPINECUT] Two gates on the webhook spine that today are only
 * described, never observed: the vendor-aware hook cache, and the per-user lock.
 *
 * ── WHY A HARNESS AND NOT A SOURCE READ ──────────────────────────────────────
 * Both properties are about WHAT HAPPENS, not about what the file says. The
 * cache gate is a count of database round-trips; the lock is an ordering. Neither
 * can be read off the source, and the one spec that touches the lock today —
 * `z-test/unit/lock-wait-vs-stale-budget.spec.ts` — deliberately does arithmetic
 * on `webhook.service.ts`'s source text (`constFromSource`) because it is pinning
 * CONSTANTS, not behaviour. It is a tripwire for the reply-token budget and it
 * says so. Nothing here duplicates it: no constant is read, no source is parsed,
 * and this file would stay green if every one of those numbers changed.
 *
 * The harness is the `buildHarness` pattern from
 * `z-test/unit/room-bootstrap-before-pack.spec.ts` — the real `WebhookService`,
 * built positionally with recording fakes, driven through its real public entry.
 * That spec does not export its harness (project convention: specs are
 * self-contained), so this one is mirrored rather than imported.
 *
 * ⚠️ `processWebhook` IS reachable, so both targets are tested at the real seam.
 *    The lock lives inside it (`processWebhook` → `runDeliveryEvents` →
 *    `withUserLock` → `processLockedEvent`), which is exactly why the ordering
 *    case can exist at all: the lock is not a collaborator that can be faked out,
 *    it is a wrapper the spine applies itself. What IS faked is the lock STORE —
 *    `redis.getClient()` answers a Map-backed double that speaks the three ioredis
 *    calls the lock makes (`set NX PX`, `get`, `del`).
 *
 * Nothing is billed: the AI provider is a double, and `z-test/lib/no-ai-outbound.ts`
 * (a jest `setupFiles` entry) throws on any real provider request anyway. The LINE
 * token is dead.
 *
 * revert: delete this file. No product import, no snapshot, no fixture.
 */

const CHANNEL_SECRET = 'spinecut-channel-secret';
const ALIAS = 'spinecut';
const HOOK_ID = 'a0d000000000000000000054';

const LINKED_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'ทดสอบ', customer_tel: '0800000000' },
    },
  },
};

/**
 * Which column each vendor owns, asked of the product's own table rather than
 * typed out here.
 *
 * ⚠️ THE SPEC MUST NOT SPELL A COLUMN NAME. If it hard-coded `custom_ai_key` /
 *    `custom_ai_key_sec` it would encode the same assumption the gate under test
 *    is accused of making, and a wrong pair would agree with a wrong gate. The
 *    NAMES themselves are pinned by `z-test/unit/ai-vendor-sec-columns.spec.ts`;
 *    this file only asks "the key column of THIS vendor" and counts reads.
 */
const VENDOR_KEY_FIELD: ReadonlyMap<AiVendor, string> = new Map(
  AI_VENDORS.map((vendor) => [vendor, resolveVendorColumns(vendor).keyField]),
);

/** Every key column that does NOT belong to `vendor` — the wrong-column set. */
const otherKeyFields = (vendor: AiVendor): string[] => {
  const own = VENDOR_KEY_FIELD.get(vendor);
  return [...new Set(VENDOR_KEY_FIELD.values())].filter((f) => f !== own);
};

interface Trace {
  /** Calls to `hookModel.findOne` — the ONE observable of the cache gate. */
  hookReReads: number;
  /** Ordered markers, only from the two seams the lock case reasons about. */
  ordered: string[];
  replies: string[];
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

/** The three ioredis calls `withUserLock` makes, over a Map. */
function fakeLockStore(): {
  set: (
    k: string,
    v: string,
    px: string,
    ms: number,
    nx: string,
  ) => Promise<string | null>;
  get: (k: string) => Promise<string | null>;
  del: (k: string) => Promise<number>;
} {
  const held = new Map<string, string>();
  return {
    // `SET key val PX ms NX` — answers 'OK' only when the key is free, which is
    // the whole contract the lock relies on. Decided synchronously so the first
    // caller of a tick always wins and the test is not a race.
    set: (k, v) => {
      if (held.has(k)) return Promise.resolve(null);
      held.set(k, v);
      return Promise.resolve('OK');
    },
    get: (k) => Promise.resolve(held.get(k) ?? null),
    del: (k) => Promise.resolve(held.delete(k) ? 1 : 0),
  };
}

interface Opts {
  hook: Record<string, unknown>;
  /** Present ⇒ the real Redis lock path over a fake store. Absent ⇒ no client. */
  lockStore?: ReturnType<typeof fakeLockStore>;
  /** Real-time delay inside the AI double, so overlap is observable. */
  aiDelayMs?: number;
}

/** `question-one` ⇒ `one`. Lets a recording fake say WHICH run it is serving. */
const tagOf = (text: string): string => {
  if (text.includes('-one')) return 'one';
  if (text.includes('-two')) return 'two';
  return `untagged(${text})`;
};

function buildHarness(opts: Opts): {
  trace: Trace;
  post: (events: unknown[]) => Promise<void>;
} {
  const hook = opts.hook;
  const trace: Trace = { hookReReads: 0, ordered: [], replies: [] };

  const hookModel = {
    // ⭐ THE OBSERVABLE. `this.hookModel` is used at exactly one site in
    //    webhook.service.ts — the cache re-read — so this counter is unambiguous.
    findOne: () => {
      trace.hookReReads += 1;
      return query(hook);
    },
  };
  const chatRoomModel = {
    findOne: () => query(null),
    findOneAndUpdate: () => query({ _id: 'room-1' }),
    updateOne: () => query({ acknowledged: true }),
  };
  const chatMessageModel = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'msg-x' }),
    updateOne: () => query({ acknowledged: true }),
    countDocuments: () => query(0),
  };
  const memberModel = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'mem-1' }),
    updateOne: () => query({ acknowledged: true }),
    findOneAndUpdate: () => query({ _id: 'mem-1' }),
    findById: () => query(null),
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

  const recordReply = (text: string): void => {
    trace.replies.push(text);
    trace.ordered.push(`reply:${tagOf(text)}`);
  };

  const lineApi = {
    sendLineReplyMessage: (_t: string, _r: string, text: string) => {
      recordReply(text);
      return Promise.resolve({ status: 200, data: {} });
    },
    sendLineFlexReply: (
      _t: string,
      _r: string,
      _c: unknown,
      altText: string,
    ) => {
      recordReply(`[flex] ${altText}`);
      return Promise.resolve({ status: 200, data: { sentMessages: [] } });
    },
    sendLineLoadingIndicator: () => Promise.resolve({ status: 200, data: {} }),
    sendLinePushMessage: () => Promise.resolve({ status: 200, data: {} }),
    sendLinePushFlexMessage: () => Promise.resolve({ status: 200, data: {} }),
    getLineProfile: () => Promise.resolve(null),
  };

  const service = new WebhookService(
    hookModel as never,
    chatRoomModel as never,
    chatMessageModel as never,
    memberModel as never,
    passthrough as never, // assignHistoryModel
    passthrough as never, // ticketModel
    passthrough as never, // objectImageModel
    { findById: () => query(null) } as never, // imageStorageModel
    { safeDecrypt: (v: string) => v } as never,
    {
      cacheHook: () => Promise.resolve(),
      getHookByAlias: () => Promise.resolve(hook),
      getHookByAliasWithSource: () =>
        Promise.resolve({ hook, source: 'cache' }),
    } as never, // hookCache
    {
      logMessage: () => Promise.resolve({ _id: 'msg-1', room_id: 'room-1' }),
      logSystemMessage: () => Promise.resolve({ _id: 'sys-1' }),
      resolveRoom: () => Promise.resolve({ _id: 'room-1' }),
      getOrCreateRoom: () => Promise.resolve({ _id: 'room-1' }),
    } as never, // chatHistory
    lineApi as never,
    {
      downloadAndSaveImage: () => Promise.resolve(null),
      downloadAndSaveVideo: () => Promise.resolve(null),
    } as never, // lineContent
    { createLog: () => Promise.resolve() } as never, // webhookLogs
    { getCombinedData: () => Promise.resolve(LINKED_PROFILE) } as never, // externalApi
    {
      getToolForHook: () => Promise.resolve(null),
      getCombinedData: () => Promise.resolve(LINKED_PROFILE),
      extractProfile: () => null,
    } as never, // customTool
    { consume: () => Promise.resolve({ limited: false }) } as never, // rateLimit
    {
      // ⭐ The lock's only outside dependency. Throwing is what the other flow
      //    specs do (no Redis in a unit test) and drops the lock onto its
      //    in-memory fallback; handing back a store exercises the real path.
      getClient: () => {
        if (!opts.lockStore) throw new Error('no redis in unit test');
        return opts.lockStore;
      },
    } as never, // redis
    {
      generate: async (req: AiReplyRequest) => {
        const tag = tagOf(req.question);
        trace.ordered.push(`ai.start:${tag}`);
        // Real elapsed time inside the guarded region: without it every run
        // would finish inside one microtask drain and NOTHING could interleave,
        // so a broken lock would still look serialised.
        await new Promise((r) => setTimeout(r, opts.aiDelayMs ?? 0));
        trace.ordered.push(`ai.end:${tag}`);
        return { text: `answer-${tag}`, noData: false, tagStatus: null };
      },
    },
    /* The summary provider is never reached on this path (no assist marker in the
       answer), so the double only has to satisfy the constructor's type. `null` does not:
       `AssistSummaryResponse` is an object, and typing it away with a cast would hide a
       real signature the day this path DOES reach it. */
    {
      summarise: () => Promise.resolve({ summary: '', category: 'Other' }),
    },
    { getConfigByKey: () => Promise.resolve(null) } as never, // systemConfig
    { telegramWebhookSecret: undefined, multiEventDelivery: false },
    { geminiApiKey: undefined, modelId: 'gemini-3.5-flash' } as never,
    { ignoreDocId: undefined } as never,
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
    { checkIfSlipWithQrCode: () => Promise.resolve(false) } as never, // qrVision
    undefined, // configCacheInvalidator
    undefined, // paymentRunner
    undefined, // docRetrievalProvider
    undefined, // strike
    // LinePushDispatcher — some replies leave through the push core rather than
    // `lineApi`; both land in the same recorder so ordering is complete either way.
    {
      dispatch: (req: { messages?: Array<Record<string, unknown>> }) => {
        const m = req.messages?.[0];
        if (m?.['type'] === 'flex') {
          recordReply(
            `[flex] ${typeof m['altText'] === 'string' ? m['altText'] : ''}`,
          );
          return Promise.resolve({
            ok: true,
            status: 200,
            attempts: 1,
            durationMs: 0,
            data: { sentMessages: [] },
          });
        }
        recordReply(typeof m?.['text'] === 'string' ? m['text'] : '');
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

  const post = async (events: unknown[]): Promise<void> => {
    const body = { destination: 'Uspinecut', events };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: `/${ALIAS}/webhook`,
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(body, hook, 'cache', ALIAS, meta);
  };

  return { trace, post };
}

function baseHook(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: ALIAS,
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'spinecut-dead-token', // dead — any real send would 401
    channel_type: 'line',
    slip_check: false,
    ...over,
  };
}

function ev(userId: string, text: string, n: string): Record<string, unknown> {
  return {
    type: 'message',
    eventId: `ev-${n}`,
    replyToken: `rt-${n}`,
    timestamp: Date.now(),
    source: { type: 'user', userId },
    message: { type: 'text', id: `m-${n}`, text },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   B2 — the hook cache asks for the key column of the hook's OWN vendor
   ═══════════════════════════════════════════════════════════════════════════ */
describe('[SPINECUT-B2] the hook cache reads Mongo only when this OA is really incomplete', () => {
  /* Every vendor gets both arms, so the pair cannot be satisfied by hard-coding
     one vendor's column — and vendor #3 is covered the day it joins the table. */
  for (const vendor of AI_VENDORS) {
    const keyField = VENDOR_KEY_FIELD.get(vendor) as string;

    /**
     * PROTECTS AGAINST: the gate asking for one fixed vendor's key column. A
     * DeepSeek OA keeps its key in a different column from a Gemini one, so a
     * hard-coded column makes every OA of the other vendor look permanently
     * incomplete: this branch fires on EVERY message and re-reads Mongo each
     * time, for the life of the OA. The reply is still correct and nothing is
     * logged — the only symptom is a database read per inbound message that the
     * cache exists to remove, which is why nobody notices.
     */
    it(`a complete ${vendor} OA is answered from cache — nothing goes back to the database`, async () => {
      const h = buildHarness({
        hook: baseHook({
          ai_vendor: vendor,
          doc_id: 'doc-1',
          [keyField]: 'enc:own-key',
        }),
      });

      await h.post([
        ev('Uspinecut0000000000000000000b2a', 'question-one', '1'),
      ]);

      expect(h.trace.hookReReads).toBe(0);
    });

    /**
     * PROTECTS AGAINST: the opposite mistake — the gate declaring an OA complete
     * because SOME vendor's key column is filled. An OA switched to this vendor
     * whose key was never re-entered would then be served forever from a stale
     * cache entry and would never pick up the key once it IS entered, because the
     * only thing that refreshes the entry is this branch.
     */
    it(`a ${vendor} OA missing its own key is refreshed once, even with another vendor's key on the row`, async () => {
      const wrongColumns = Object.fromEntries(
        otherKeyFields(vendor).map((f) => [f, 'enc:someone-elses-key']),
      );
      const h = buildHarness({
        hook: baseHook({ ai_vendor: vendor, doc_id: 'doc-1', ...wrongColumns }),
      });

      await h.post([
        ev('Uspinecut0000000000000000000b2b', 'question-one', '2'),
      ]);

      expect(h.trace.hookReReads).toBe(1);
    });
  }

  /**
   * PROTECTS AGAINST: the vendor work quietly eating the other half of the same
   * condition. The gate refreshes on a missing key OR a missing `doc_id`; an edit
   * that reduces it to the key alone would leave an OA whose Training Document
   * was linked after caching answering from documents it no longer uses.
   */
  it('an OA with its key but no linked document is refreshed too', async () => {
    const geminiKeyField = VENDOR_KEY_FIELD.get(AI_VENDORS[0]) as string;
    const h = buildHarness({
      hook: baseHook({ [geminiKeyField]: 'enc:own-key' }), // no doc_id
    });

    await h.post([ev('Uspinecut0000000000000000000b2c', 'question-one', '3')]);

    expect(h.trace.hookReReads).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B4 — the per-user lock, observed as ordering rather than as arithmetic
   ═══════════════════════════════════════════════════════════════════════════ */
describe('[SPINECUT-B4] two messages from one customer are served one after the other', () => {
  const USER_A = 'Uspinecut0000000000000000000b4a';
  const USER_B = 'Uspinecut0000000000000000000b4b';
  /* Long enough that a second run has every opportunity to slip inside the first
     one's model call — the whole pre-AI path is microtasks against these fakes. */
  const AI_DELAY_MS = 100;

  const completeHook = (): Record<string, unknown> =>
    baseHook({
      doc_id: 'doc-1',
      [VENDOR_KEY_FIELD.get(AI_VENDORS[0]) as string]: 'enc:k',
    });

  /**
   * PROTECTS AGAINST: the lock losing its per-customer key — passed a constant, a
   * blank, or dropped entirely. On 2026-07-27 exactly that concurrency (two
   * requests live for one customer) produced a duplicate ticket, which is why the
   * lock TTL was raised to 90s. The existing lock spec would not see this: it
   * asserts on the SIZE of the wait window read out of the source text, and a
   * lock that serialises nobody keeps every one of those numbers intact.
   */
  it('a customer who sends twice at once has the second message answered only after the first', async () => {
    const h = buildHarness({
      hook: completeHook(),
      lockStore: fakeLockStore(),
      aiDelayMs: AI_DELAY_MS,
    });

    await Promise.all([
      h.post([ev(USER_A, 'question-one', '1')]),
      h.post([ev(USER_A, 'question-two', '2')]),
    ]);

    // Both were answered — the lock delays work, it never drops it.
    expect(h.trace.replies).toEqual(['answer-one', 'answer-two']);
    // ⭐ And the whole of run one closes before run two opens.
    expect(h.trace.ordered).toEqual([
      'ai.start:one',
      'ai.end:one',
      'reply:one',
      'ai.start:two',
      'ai.end:two',
      'reply:two',
    ]);
  });

  /**
   * PROTECTS AGAINST: this file lying to itself. If the harness could not
   * interleave — one fake accidentally synchronous, the delay not really elapsing —
   * the case above would pass against a lock that does nothing at all. Two
   * different customers hold different keys, so here the runs SHOULD overlap, and
   * the overlap is what proves the serialisation above was caused by the lock.
   */
  it('two different customers are not made to wait for each other', async () => {
    const h = buildHarness({
      hook: completeHook(),
      lockStore: fakeLockStore(),
      aiDelayMs: AI_DELAY_MS,
    });

    await Promise.all([
      h.post([ev(USER_A, 'question-one', '1')]),
      h.post([ev(USER_B, 'question-two', '2')]),
    ]);

    // Run two opens while run one is still inside its model call.
    expect(h.trace.ordered.slice(0, 2)).toEqual([
      'ai.start:one',
      'ai.start:two',
    ]);
  });
});
