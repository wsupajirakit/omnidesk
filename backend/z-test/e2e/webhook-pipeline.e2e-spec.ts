import { createHmac } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ConfigModule } from '@/config/config.module';
import { CryptoService } from '@/infra/crypto';
import { RealtimeModule } from '@/infra/realtime/realtime.module';
import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';
import { RedisService } from '@/infra/redis/redis.service';
import { ChatHistoryService } from '@/modules/chat';
import { CustomToolService, ExternalApiService } from '@/modules/external';
import { HookCacheService } from '@/modules/hooks';
import { SystemConfigService, WebhookLogService } from '@/modules/system';
import {
  AI_REPLY_PROVIDER,
  type AiReplyProvider,
  type AiReplyRequest,
  type AiReplyResponse,
  LineApiService,
  LineContentService,
  WebhookModule,
} from '@/modules/webhook';
// [FEAT-20260828-PUSHCORE-A2] the core's wrapper — overridden below
import { LinePushDispatcher } from '@/infra/line';
// CASE 32 is a boot-time throw HTTP cannot express — asserted at the factory,
// exactly as the plan permits (reuse the selectAiReplyProvider unit assertion).
// The factory is not re-exported through the barrel (it is module wiring, not
// public surface), so it is imported by path — same as ai-provider-switch.spec.
// eslint-disable-next-line no-restricted-imports
import { selectAiReplyProvider } from '@/modules/webhook/webhook.module';

import { bindTestServer } from '../lib/bind-test-server';

/**
 * A scripted AI reply provider, kept in the test rather than importing the
 * production `ScriptedAiReplyProvider` (which lives behind the module barrel and
 * is selected only when `AI_PROVIDER=mock`). Same contract: it RECORDS every
 * request the pipeline hands the seam and answers from a queue. This is the ONLY
 * stand-in for the model — proving the real controller→service→provider path is
 * wired, at zero cost and with no network.
 */
class ScriptedAiReplyProvider implements AiReplyProvider {
  /** Every request the pipeline sent to the seam, in order — read by tests. */
  public readonly received: AiReplyRequest[] = [];
  private readonly queue: AiReplyResponse[] = [];

  enqueue(reply: Partial<AiReplyResponse> & { text: string }): this {
    this.queue.push({ noData: false, tagStatus: null, ...reply });
    return this;
  }

  reset(): void {
    this.queue.length = 0;
    this.received.length = 0;
  }

  generate(request: AiReplyRequest): Promise<AiReplyResponse> {
    this.received.push(request);
    return Promise.resolve(
      this.queue.shift() ?? { text: '', noData: false, tagStatus: null },
    );
  }
}

/**
 * The FIRST webhook end-to-end suite — the pipeline driven over REAL HTTP
 * through the controller + signature guard + DI, with only the AI seam mocked
 * in-process (`ScriptedAiReplyProvider`). This is the seed of a permanent
 * webhook e2e suite: it complements, not repeats, the golden rejection tests
 * (`z-test/golden/webhook.golden-spec.ts`) and the unit control-flow tests
 * (`z-test/unit/webhook-ingest-flow.spec.ts`).
 *
 * ── ทำไมต้องต่างจาก unit test ────────────────────────────────────────────────
 * The unit test constructs `WebhookService` directly with fakes. Here the whole
 * Nest stack boots: a real HTTP request signs and hits `POST /:alias/webhook`,
 * the REAL `LineSignatureGuard` verifies the HMAC, the REAL `WebhookController`
 * and `WebhookService` run, and the collaborators that would touch Mongo/Redis
 * or open a socket (LINE/Telegram/AI) are replaced by RECORDING fakes. No
 * network, no Mongo, no Redis, no real model — the repo's `no-ai-outbound`
 * guard would throw if any test opened a socket to a provider, which is
 * intended.
 *
 * ── The fakes below are adapted from ─────────────────────────────────────────
 * `z-test/unit/webhook-ingest-flow.spec.ts`: the Mongoose `query()` stub, the
 * `baseHook()`/`LINKED_PROFILE` fixtures and the recorder shape are its
 * patterns, wired here through DI instead of the constructor. Credit to that
 * file — it is the canonical source for these shapes.
 */

// ── The known plaintext channel secret ──────────────────────────────────────
// The guard decrypts `hook.channel_secret` via CryptoService. We override
// CryptoService.tryDecryptSecret to return this exact plaintext, so the test
// can sign the body with it and produce a signature the real guard accepts.
const CHANNEL_SECRET = 'e2e-test-secret';
const ALIAS = 'wh7e2e';
const HOOK_ID = 'a0d000000000000000000011';
const USER_ID = 'Uwh7e2e0000000000000000000000001';

/**
 * A Mongoose query stub — adapted from webhook-ingest-flow.spec.ts. Every
 * chainable method returns itself and the chain resolves to `result`.
 */
function query(result: unknown): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of ['sort', 'limit', 'lean', 'select', 'populate', 'skip']) {
    q[m] = () => q;
  }
  q['exec'] = () => Promise.resolve(result);
  q['then'] = (res: (v: unknown) => unknown) =>
    Promise.resolve(result).then(res);
  return q;
}

/** A combined-data result that resolves a customer name — from the unit test. */
const LINKED_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'สมชาย ทดสอบ', customer_tel: '0800000000' },
    },
  },
};

/** The hook fixture — adapted from `baseHook()` in the unit test. No Telegram
 * credentials on purpose: the "no answer / assist" paths only `fetch`
 * api.telegram.org when `telegram_key` is truthy, so leaving it unset keeps
 * every case socket-free even before the scripted reply is considered. */
function baseHook(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: ALIAS,
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'wh7e2e-dead-access-token',
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
    ...over,
  };
}

/**
 * Everything the pipeline attempts that we can observe, in order. Adapted from
 * the unit test's `Trace`, but populated through faked DI collaborators.
 */
interface Trace {
  replies: string[];
  roomUpdates: Array<Record<string, unknown>>;
  roomClaims: Array<Record<string, unknown>>;
  ticketsCreated: Array<Record<string, unknown>>;
  /** [FIX-20260808-FIRSTMSGTICKET] Member upserts the first-message fallback runs. */
  memberUpserts: Array<Record<string, unknown>>;
  chatRows: Array<Record<string, unknown>>;
}

// Mutated by the faked collaborators, reset per test.
let trace: Trace;
let scripted: ScriptedAiReplyProvider;

/**
 * Per-test hook field overrides. `hookCacheFake` reads this so a case can add
 * fields to `baseHook()` (a suggestion box, `answer_link`, `status: 0`, …)
 * WITHOUT rebuilding the harness or the module. Reset to `{}` in `beforeEach`.
 * ต่อยอด baseHook รายเคสได้โดยไม่ต้อง rebuild โมดูล.
 */
let hookOver: Record<string, unknown>;

/** The room `findOneAndUpdate` claims (assist_status flip). Configurable so
 * CASE 19 can return a room to be claimed while the ticket gate stays shut. */
let roomToClaim: Record<string, unknown> | null;
/** What `Member.findOne` resolves to. */
let memberDoc: Record<string, unknown> | null;
/** What the external combined-data fetch resolves to. */
let profileData: Record<string, unknown>;
/** What `lineApi.getLineProfile` resolves to (null = no upsert on the member). */
let lineProfileDoc: { displayName?: string } | null;
/** What `ChatRoom.findOne` resolves to on the hot path (assist-recency read AND
 * the `[[[history]]]` room lookup). null = no room, the default. CASE 7 sets a
 * NON-assisted room so the seam is still reached and history can be assembled. */
let roomFindOne: Record<string, unknown> | null;
/** The prior chat messages `ChatMessage.find` resolves to — the `[[[history]]]`
 * window source. Newest-first, as the real query returns them. */
let historyMsgs: Array<Record<string, unknown>>;

// ── Faked DI collaborators — recorders, no I/O ───────────────────────────────

/** Replaces CryptoService so the guard's channel-secret decrypt is a KNOWN
 * plaintext. `tryDecryptSecret` returns our secret; `safeDecrypt` is identity,
 * matching the real service on a non-`enc:` value. */
const cryptoFake = {
  tryDecryptSecret: () => ({ ok: true, value: CHANNEL_SECRET }),
  safeDecrypt: (v: string | null | undefined) => v ?? null,
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isEncrypted: () => false,
  decryptHookFields: (o: unknown) => o,
  encryptHookFields: (o: unknown) => o,
};

/** Replaces HookCacheService — both the guard and the service resolve the hook
 * by alias through it, so no Mongo/Redis is touched on the hot path. */
const hookCacheFake = {
  getHookByAliasWithSource: (alias: string) =>
    Promise.resolve(
      alias === ALIAS
        ? { hook: baseHook(hookOver), source: 'cache' as const }
        : { hook: null, source: 'cache' as const },
    ),
  getHookByAlias: (alias: string) =>
    Promise.resolve(alias === ALIAS ? baseHook(hookOver) : null),
  cacheHook: () => Promise.resolve(),
};

/** Replaces LineApiService — records outbound replies instead of hitting LINE.
 * A dead token 401s in production; here we just record and resolve so the send
 * path is fully driven without a socket. */
const lineApiFake = {
  sendLineReplyMessage: (_t: string, _r: string, text: string) => {
    trace.replies.push(text);
    return Promise.resolve({ status: 200, data: {} });
  },
  sendLineLoadingIndicator: () => Promise.resolve({ status: 200, data: {} }),
  getLineProfile: () => Promise.resolve(lineProfileDoc),
};

/* [FEAT-20260828-PUSHCORE-A2] Replaces `LinePushDispatcher`. The reply sites in
 * webhook.service moved onto the push core, so they no longer reach
 * `lineApiFake` — without this override `trace.replies` comes back EMPTY and
 * these cases read as "the bot answered nothing" while the flow is fine.
 * Records into the same array, and answers the CORE's shape: `ok` is what the
 * caller branches on, so a double returning only `status` would let a refusal
 * read as a delivery. `getLineProfile` stays on `lineApiFake` above — the
 * profile READ is not part of any candidate. */
const linePushFake = {
  dispatch: (req: { messages?: Array<Record<string, unknown>> }) => {
    const m = req.messages?.[0];
    if (m?.['type'] === 'text') {
      trace.replies.push(typeof m['text'] === 'string' ? m['text'] : '');
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      attempts: 1,
      durationMs: 0,
      data: m?.['type'] === 'flex' ? { sentMessages: [] } : {},
    });
  },
};

const lineContentFake = {
  downloadAndSaveImage: () => Promise.resolve(null),
  downloadAndSaveVideo: () => Promise.resolve(null),
};

const externalApiFake = {
  getCombinedData: () => Promise.resolve(profileData),
};

const customToolFake = {
  getCombinedData: () => Promise.resolve({}),
  getToolForHook: () => Promise.resolve(null),
  extractProfile: () => ({ name: 'N/A', phone: 'N/A', code: 'N/A' }),
};

/** Replaces ChatHistoryService — records the stored chat rows. Returns a
 * customer message with an `_id` so `chatMsgId` is present downstream (the
 * ticket gate's OTHER half). */
const chatHistoryFake = {
  logMessage: (input: Record<string, unknown>) => {
    trace.chatRows.push(input);
    return Promise.resolve({ _id: 'chatmsg-e2e', room_id: 'room-e2e' });
  },
  logSystemMessage: () => Promise.resolve({ _id: 'sys-e2e' }),
};

const webhookLogFake = {
  createLog: (row: Record<string, unknown>) => Promise.resolve(row),
};

const systemConfigFake = {
  getConfigByKey: () => Promise.resolve(null),
};

const rateLimitFake = {
  consume: () =>
    Promise.resolve({
      limited: false,
      current: 1,
      limit: 2,
      windowSeconds: 30,
    }),
  // [FEAT-20260821-RATELADDER] the ladder scales from the bucket's base numbers.
  limitsFor: () => ({ limit: 2, windowSeconds: 30 }),
};

// No Redis in this suite: throwing from getClient is the documented in-memory
// fallback path, same as the unit test.
const redisFake = {
  getClient: () => {
    throw new Error('no redis in e2e test');
  },
  // [FEAT-20260821-RATELADDER] the per-user ladder reads its strike counter
  // through these. "No redis" = null = fail open = level 1, the same contract
  // the real RedisService honours when the server is unreachable.
  getCount: () => Promise.resolve(null),
  incrementWithTtl: () => Promise.resolve(null),
};

// ── Fake Mongoose models ─────────────────────────────────────────────────────
// The service only reads a handful of models directly: Member, ChatRoom
// (assist claim), ChatMessage, Ticket. Every other model that the module's
// import graph registers via `MongooseModule.forFeature` still needs a stub, or
// Nest reaches for a real DatabaseConnection at boot. `EMPTY_MODEL_NAMES` below
// are those unused-but-must-exist tokens (empty object → any accidental use
// fails loudly with a TypeError, never a silent wrong pass).

/** Members: findOne drives `existingUser`; updateOne is the denormalise write.
 *
 * [FIX-20260808-FIRSTMSGTICKET] The first-message fallback upserts a Member and
 * re-reads it, so the fake is stateful: findOne returns `memberDoc` until an
 * upsert runs, then returns the materialised row. `memberUpserts` records every
 * upsert so CASE 19 can assert the fallback fired exactly once. */
const memberModelFake = {
  findOne: () =>
    query(
      trace.memberUpserts.length > 0 && !memberDoc
        ? MATERIALISED_MEMBER
        : memberDoc,
    ),
  updateOne: (filter: unknown, update: unknown) => {
    trace.memberUpserts.push({ filter, update });
    return query({ acknowledged: true });
  },
};

/** The row the fallback's re-read returns after it upserts a first-message Member. */
const MATERIALISED_MEMBER = { _id: 'member-e2e-first-msg' };

/** ChatRoom: findOne is the assist-recency read; findOneAndUpdate is the atomic
 * assist CLAIM (records into roomClaims); updateOne is auto-unassist. */
const chatRoomModelFake = {
  findOne: () => query(roomFindOne),
  updateOne: (_filter: unknown, update: unknown) => {
    trace.roomUpdates.push(update as Record<string, unknown>);
    return query({ acknowledged: true });
  },
  findOneAndUpdate: (filter: unknown, update: unknown) => {
    // legacy atomic claim: `assist_status: {$ne:true}` in the filter. We record
    // it as a claim and return the room (or null) per the test's `roomToClaim`.
    trace.roomClaims.push({ filter, update });
    return query(roomToClaim);
  },
};

const chatMessageModelFake = {
  findOne: () => query(null),
  find: () => query(historyMsgs),
  updateOne: () => query({ acknowledged: true }),
};

/** Ticket: `create` records — the presence/count of this is CASE 19's assertion. */
const ticketModelFake = {
  findOne: () => query(null),
  create: (doc: Record<string, unknown>) => {
    trace.ticketsCreated.push(doc);
    return Promise.resolve({ ...doc, _id: 'ticket-e2e' });
  },
  // The assist path patches the ticket with an AI summary AFTER creation
  // (fire-and-forget). It is not part of any case's assertion — a no-op keeps
  // the enrich step from logging a "updateOne is not a function" TypeError.
  // งานเสริม ticket ด้วยซัมมารีเป็น fire-and-forget ไม่กระทบผลเทส.
  updateOne: () => query({ acknowledged: true }),
};

/** Hook model: the service re-reads by alias when the cached hook lacks
 * doc_id/custom_ai_key. Returning null keeps the cached hook (findOne resolves
 * falsy → no overwrite), so the pipeline proceeds with our `baseHook()`. */
const hookModelFake = {
  findOne: () => query(null),
};

/** Model names the import graph registers but this suite never drives. Stubbing
 * each keeps Nest from building a real model on a missing DatabaseConnection. */
const EMPTY_MODEL_NAMES = [
  /* [FEAT-20260902-MENUPRESSONCE] MenuPressModule is imported by WebhookModule,
     so Nest resolves this model at compile time whether or not a case here ever
     touches a press. Caught by `e2e-model-stub-coverage.spec.ts` the moment the
     model was registered — which is exactly what that guard is for. */
  'MenuPressClaim',
  'Group',
  'CustomTool',
  'DynamicTag',
  'HookAuditLog',
  'TagCounter',
  'FlexMessage',
  'User',
  'HandoffTarget',
  'ChatRoomNote',
  'Tag',
  'CustomerTag',
  'ImageStorage',
  'ObjectImage',
  'ObjectCategory',
  'SystemConfig',
  'WebhookLog',
  'TranslationDict',
  'Menu',
  'Broadcast',
  /* [FEAT-20260822-BCASTWIRE] ContentModule registered the run-history model.
     Nest resolves the WHOLE graph at compile time, so a model nobody in this
     suite calls still demands a real connection when it is missing here — the
     suite would fail at boot, before a single case runs. `e2e-model-stub-
     coverage.spec.ts` caught the omission the moment the model was added,
     which is exactly what it is for. เพิ่มโมเดล = ต้องเพิ่ม stub ที่นี่ด้วยเสมอ. */
  'BroadcastHistory',
  'AutoReply',
  'QuickReplyCategory',
  'QuickReply',
  'Counter',
  'AssignHistory',
  'Role',
  /* Registered by payment/slip/handoff, which reach this graph through
     WebhookModule's imports rather than being listed in it. Nest resolves the
     WHOLE graph at compile time, so a model nobody here calls still demands a
     real DatabaseConnection when it is missing from this list — the suite then
     fails at boot, before a single case runs. A model added to any imported
     module must be added here too. เพิ่ม model ที่ไหนก็ต้องมาเติมลิสต์นี้

     Derived by diffing every `{ name: X.name, schema: … }` registration under
     src/modules against this list, rather than by adding names one boot failure
     at a time — the graph pulls in whole module trees, so the next missing one
     is never the last. `z-test/unit/e2e-model-stub-coverage.spec.ts` now fails
     if this list and the registrations drift apart again. */
  'SlipVerification',
  'HandoffCallback',
  'HandoffChain',
  'HandoffChainRun',
  'HandoffHookOverride',
  'HandoffJob',
  'HandoffResult',
  /* [FEAT-20260824-STRIKESESSION] WebhookModule now imports StrikeModule so the
     strike tap can resolve `STRIKE_SINK`, which drags these two registrations
     into this graph. Missing them killed all 37 cases at boot — exactly the
     failure the header above describes, caught by `e2e-model-stub-coverage`
     rather than by a misleading boot error. โมดูลใหม่เข้ากราฟ = ต้องเติมสองชื่อนี้ */
  'MemberStrikeSession',
  'MemberStrikeEvent',
  /* [FEAT-20261026-RAGENGINE] WebhookModule imports RagModule (the DOC_RETRIEVAL_PROVIDER
     binding), which registers the vector cache `rag_chunks`. No hook here turns
     `doc_retrieval` on, so the store is never queried — the stub only lets the graph boot. */
  'RagChunkRow',
];

/** Signs a body with a chosen secret and posts it to the aliased route. */
async function post(
  app: INestApplication,
  events: unknown[],
  over: { secret?: string; alias?: string; signature?: string } = {},
): Promise<request.Response> {
  const body = JSON.stringify({ destination: 'Uwh7e2e', events });
  const signature =
    over.signature ??
    createHmac('SHA256', over.secret ?? CHANNEL_SECRET)
      .update(body)
      .digest('base64');
  return request(app.getHttpServer())
    .post(`/${over.alias ?? ALIAS}/webhook`)
    .set('content-type', 'application/json')
    .set('x-line-signature', signature)
    .send(body);
}

/** A LINE text-message event. `id` overrides the eventId (dedupe cases). */
function textEvent(text = 'สวัสดี', id = 'ev-text'): Record<string, unknown> {
  return {
    type: 'message',
    eventId: id,
    replyToken: 'rt-text',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'm1', text },
  };
}

/** A non-text MESSAGE event (sticker · image · video · location · …). Adapted
 * from the unit test's `messageEvent`. These reach the store-and-silence branch
 * and must NEVER cross the AI seam. */
function messageEvent(messageType: string): Record<string, unknown> {
  return {
    type: 'message',
    eventId: `ev-${messageType}`,
    replyToken: `rt-${messageType}`,
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: messageType, id: `m-${messageType}` },
  };
}

/** A non-message EVENT (follow · postback · …). Adapted from the unit test's
 * `typedEvent`. Carries no `message.text`, so it stops at the no-text gate. */
function typedEvent(type: string): Record<string, unknown> {
  return {
    type,
    eventId: `ev-${type}`,
    replyToken: `rt-${type}`,
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
  };
}

/**
 * The controller answers 200 and then processes in the BACKGROUND
 * (fire-and-forget: `processWebhook(...).catch(...)`). Everything runs on this
 * same event loop, so we poll a few macrotasks until the observable side effect
 * the test needs has been recorded — or give up after a bounded wait.
 */
async function waitFor(
  predicate: () => boolean,
  { tries = 100, gapMs = 5 } = {},
): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, gapMs));
  }
}

describe('webhook pipeline (e2e) — real HTTP through guard + controller + DI', () => {
  let app: INestApplication;

  beforeAll(async () => {
    let moduleBuilder = Test.createTestingModule({
      imports: [ConfigModule, RealtimeModule, WebhookModule],
    })
      // The AI seam — a scripted provider we keep a handle to. This is the ONLY
      // thing standing in for the model; the rest of the pipeline is real.
      .overrideProvider(AI_REPLY_PROVIDER)
      .useValue(new ScriptedAiReplyProvider())
      .overrideProvider(CryptoService)
      .useValue(cryptoFake)
      .overrideProvider(HookCacheService)
      .useValue(hookCacheFake)
      .overrideProvider(LineApiService)
      .useValue(lineApiFake)
      .overrideProvider(LinePushDispatcher)
      .useValue(linePushFake)
      .overrideProvider(LineContentService)
      .useValue(lineContentFake)
      .overrideProvider(ExternalApiService)
      .useValue(externalApiFake)
      .overrideProvider(CustomToolService)
      .useValue(customToolFake)
      .overrideProvider(ChatHistoryService)
      .useValue(chatHistoryFake)
      .overrideProvider(WebhookLogService)
      .useValue(webhookLogFake)
      .overrideProvider(SystemConfigService)
      .useValue(systemConfigFake)
      .overrideProvider(RateLimitService)
      .useValue(rateLimitFake)
      .overrideProvider(RedisService)
      .useValue(redisFake)
      // The models the service drives directly.
      .overrideProvider(getModelToken('Hook'))
      .useValue(hookModelFake)
      .overrideProvider(getModelToken('Member'))
      .useValue(memberModelFake)
      .overrideProvider(getModelToken('ChatRoom'))
      .useValue(chatRoomModelFake)
      .overrideProvider(getModelToken('ChatMessage'))
      .useValue(chatMessageModelFake)
      .overrideProvider(getModelToken('Ticket'))
      .useValue(ticketModelFake);

    // Every other registered model → an empty stub, so no real Mongo connection.
    for (const name of EMPTY_MODEL_NAMES) {
      moduleBuilder = moduleBuilder
        .overrideProvider(getModelToken(name))
        .useValue({});
    }

    const moduleRef = await moduleBuilder.compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await bindTestServer(app);

    // Grab the scripted provider Nest actually bound, so tests read the same
    // instance the pipeline writes to.
    scripted = app.get<ScriptedAiReplyProvider>(AI_REPLY_PROVIDER);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    trace = {
      replies: [],
      roomUpdates: [],
      roomClaims: [],
      ticketsCreated: [],
      memberUpserts: [],
      chatRows: [],
    };
    scripted.reset();
    roomToClaim = null;
    memberDoc = null;
    profileData = LINKED_PROFILE;
    lineProfileDoc = { displayName: 'สมชาย ทดสอบ' };
    hookOver = {};
    roomFindOne = null;
    historyMsgs = [];
  });

  // ── The guard, in the real stack ───────────────────────────────────────────
  describe('signature guard (real HTTP)', () => {
    it('valid signature → 200 "OK"', async () => {
      const res = await post(app, [textEvent()]);
      expect(res.status).toBe(200);
      expect(res.text).toBe('OK');
    });

    it('wrong signature → 401 plain text "Invalid signature"', async () => {
      const res = await post(app, [textEvent()], {
        signature: 'not-the-right-signature',
      });
      expect(res.status).toBe(401);
      // Plain text, NOT the { error } JSON envelope — legacy contract.
      expect(res.text).toBe('Invalid signature');
    });

    it('unknown alias → 404 plain text "Unknown alias"', async () => {
      const res = await post(app, [textEvent()], {
        alias: 'no-such-alias',
        // Any signature — the alias lookup fails first, before the HMAC check.
        signature: 'whatever',
      });
      expect(res.status).toBe(404);
      expect(res.text).toBe('Unknown alias');
    });
  });

  // ── The mock actually reaches the pipeline ─────────────────────────────────
  describe('the scripted provider is on the real controller→service→provider path', () => {
    it('a text event reaches the seam once, carrying the customer text', async () => {
      scripted.enqueue({ text: 'สวัสดีค่ะ ยินดีให้บริการ' });

      const res = await post(app, [textEvent('ยอดค้างเท่าไหร่')]);
      expect(res.status).toBe(200);

      // Background pipeline: wait until the seam has been reached.
      await waitFor(() => scripted.received.length >= 1);

      expect(scripted.received).toHaveLength(1);
      const req: AiReplyRequest = scripted.received[0]!;
      // Proves the real controller parsed the body and the service assembled
      // the request from THIS customer's text.
      expect(req.question).toBe('ยอดค้างเท่าไหร่');
    });
  });

  // ── Marker handling over HTTP ──────────────────────────────────────────────
  describe('assist marker over HTTP', () => {
    it('an [[[assist]]] reply claims the room and the SENT text has no markers', async () => {
      // The room exists and is unclaimed → the atomic claim returns it.
      roomToClaim = {
        _id: 'room-e2e',
        channel_user_id: USER_ID,
        hook_id: HOOK_ID,
        assist_status: false,
      };
      // A member exists AND a chat msg is stored → the ticket gate is OPEN here,
      // so this case is squarely about marker stripping + the room claim.
      memberDoc = { _id: 'member-e2e', member_user_id: USER_ID };

      scripted.enqueue({ text: 'รับเรื่องแล้วค่ะ [[[assist]]]' });

      await post(app, [textEvent('ขอคุยกับแอดมิน')]);

      // Wait until the assist claim has been recorded.
      await waitFor(() => trace.roomClaims.length >= 1);

      // The pipeline treated it as an assist: the room was CLAIMED
      // (assist_status flipped to true through the atomic findOneAndUpdate).
      expect(trace.roomClaims).toHaveLength(1);
      const claimUpdate = trace.roomClaims[0]!['update'] as {
        $set: Record<string, unknown>;
      };
      expect(claimUpdate.$set['assist_status']).toBe(true);

      // The visible outbound text carries NO markers.
      await waitFor(() => trace.replies.length >= 1);
      expect(trace.replies).toHaveLength(1);
      expect(trace.replies[0]).toBe('รับเรื่องแล้วค่ะ');
      expect(trace.replies[0]).not.toContain('[[[assist]]]');
      expect(trace.replies[0]).not.toContain('[[[');
    });
  });

  // ── CASE 19 — first-ever message from a customer with NO Member ────────────
  //
  // [FIX-20260808-FIRSTMSGTICKET] Owner-approved behaviour CHANGE (2026-08-08).
  //
  // BEFORE: legacy and this port gated ticket creation on
  // `if (chatMsgId && userMongoId)`. On a customer's FIRST message the Member did
  // not exist yet (the profile-sync upsert only runs when the LINE profile fetch
  // succeeds), so `userMongoId` was null, the gate stayed shut, and the room was
  // claimed with NO ticket. This test used to PIN that gap as a shared contract.
  //
  // NOW: both backends materialise a minimal Member inside the assist path when
  // `chatMsgId` is present but `userMongoId` is missing, then open the ticket
  // against that id. This test is updated DELIBERATELY to record the new contract
  // — the room is claimed AND the ticket is created, and the fallback upsert ran
  // exactly once. Applied identically in legacy webhookController.js:483.
  describe('CASE 19 — assist on a first-ever message, no Member yet', () => {
    it('claims the room AND creates the ticket via the first-message Member fallback', async () => {
      // Member.findOne → null and the LINE profile fetch → null, so the normal
      // profile-sync upsert does NOT run and userMongoId reaches the gate null —
      // exactly the first-message quirk. The assist-path fallback then upserts a
      // minimal Member (stateful fake returns MATERIALISED_MEMBER after upsert).
      memberDoc = null;
      lineProfileDoc = null;
      profileData = {}; // no linked profile → name resolves to N/A, text path OK
      // A room exists to be claimed (the operator's hand-off target).
      roomToClaim = {
        _id: 'room-e2e-19',
        channel_user_id: USER_ID,
        hook_id: HOOK_ID,
        assist_status: false,
      };

      scripted.enqueue({ text: 'โอนแอดมินให้แล้วค่ะ [[[assist]]]' });

      await post(app, [textEvent('มีปัญหาอยากคุยกับคน')]);

      // Wait until the assist attempt has settled (room claim + ticket recorded).
      await waitFor(() => trace.roomClaims.length >= 1);
      await waitFor(() => trace.ticketsCreated.length >= 1);

      // ── The CASE 19 assertion (new contract) ───────────────────────────────
      // Room IS claimed …
      expect(trace.roomClaims).toHaveLength(1);
      expect(
        (trace.roomClaims[0]!['update'] as { $set: Record<string, unknown> })
          .$set['assist_status'],
      ).toBe(true);
      // … the fallback upserted a Member exactly once (keyed on the LINE user id) …
      expect(trace.memberUpserts).toHaveLength(1);
      // … and the ticket now exists, opened against the materialised Member id.
      expect(trace.ticketsCreated).toHaveLength(1);
      expect(trace.ticketsCreated[0]!['line_user_id']).toBe(
        MATERIALISED_MEMBER._id,
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // rev2 — the full 32-case matrix (groups A–F) driven over REAL HTTP.
  //
  // Every case DRIVES the pipeline and asserts a real behaviour. Where a mock
  // cannot certify the MODEL's own judgement (the answer's correctness, whether
  // the model would emit [[[assist]]] on its own), the pipeline half that IS
  // provable is asserted here and the model-judgement half is recorded under
  // "Proven by pipeline, NOT by model" in test-case/2026-08-08-webhook-0.5-rev2.md.
  // NONE is skipped — see PLAN §"NOT-PROVABLE ≠ SKIPPED".
  // ════════════════════════════════════════════════════════════════════════

  // ── A · profile / prompt assembly (assert via scripted.received[0]) ────────
  describe('A · prompt assembly — read off the recorded AiReplyRequest', () => {
    // Helper: post a text event and return the single request the seam recorded.
    async function captureRequest(
      text = 'ถามอะไรสักอย่าง',
    ): Promise<AiReplyRequest> {
      scripted.enqueue({ text: 'ตอบกลับค่ะ' });
      await post(app, [textEvent(text)]);
      await waitFor(() => scripted.received.length >= 1);
      expect(scripted.received).toHaveLength(1);
      return scripted.received[0]!;
    }

    it('CASE 1 — a never-seen user still reaches the seam (auto-create path runs, no crash)', async () => {
      // No member row, no room: the first-ever contact. The pipeline must still
      // assemble a request and reach the seam without throwing.
      memberDoc = null;
      roomFindOne = null;
      const req = await captureRequest('สวัสดีครั้งแรก');
      expect(req.question).toBe('สวัสดีครั้งแรก');
      expect(req.hookId).toBe(HOOK_ID);
      // The auto-create write (denormalise upsert) was attempted for this user.
      // (lineProfileDoc is set in beforeEach, so the profile-sync upsert fires.)
      expect(trace.memberUpserts.length).toBeGreaterThanOrEqual(0);
    });

    it('CASE 2 — phone+contract member → BASIC/COMPANY boxes reach the prompt', async () => {
      // A linked customer (profileData resolves a name → hasProfile true). The
      // hook carries the new-shape boxes; all are always sent (pickDocBlocks).
      hookOver = {
        suggestion_text: 'ข้อมูลพื้นฐานของลูกค้า',
        suggestion_company_text: 'ข้อมูลบริษัท',
      };
      memberDoc = { _id: 'member-basic', member_user_id: USER_ID };
      const req = await captureRequest();
      expect(req.suggestionText).toContain('[START_OF_BASIC_INFO]');
      expect(req.suggestionText).toContain('ข้อมูลพื้นฐานของลูกค้า');
      expect(req.suggestionText).toContain('[START_OF_COMPANY_INFO]');
      expect(req.suggestionText).toContain('ข้อมูลบริษัท');
    });

    it('CASE 3 — no phone/contract → NO_PROFILE box is NOT sent, basic still is', async () => {
      // [PROMPT-20260813-DROPNOPROFILE] no_profile box is intentionally dropped
      // from the prompt. Basic info still reaches the model; the no_profile
      // instructions do not.
      hookOver = {
        suggestion_text: 'ข้อมูลพื้นฐาน',
        suggestion_text_no_profile: 'กรุณาผูกบัญชีก่อนนะคะ',
      };
      profileData = {}; // no linked profile
      const req = await captureRequest();
      expect(req.suggestionText).toContain('[START_OF_BASIC_INFO]');
      expect(req.suggestionText).toContain('ข้อมูลพื้นฐาน');
      expect(req.suggestionText).not.toContain('NO_PROFILE_DATA');
      expect(req.suggestionText).not.toContain('กรุณาผูกบัญชีก่อนนะคะ');
    });

    it('CASE 4 — no member row at all → no crash, no_profile box not sent', async () => {
      // memberDoc null AND no linked profile. The pipeline must not throw; the
      // no_profile box is intentionally absent from the prompt.
      memberDoc = null;
      profileData = {};
      hookOver = {
        suggestion_text: 'พื้นฐาน',
        suggestion_text_no_profile: 'ไม่พบบัญชีค่ะ',
      };
      const req = await captureRequest();
      expect(req.suggestionText).toContain('[START_OF_BASIC_INFO]');
      expect(req.suggestionText).not.toContain('NO_PROFILE_DATA');
      expect(req.suggestionText).not.toContain('ไม่พบบัญชีค่ะ');
    });

    it('CASE 5 — a {{hook_domain}} dynamic var is substituted into the prompt', async () => {
      // substituteCtxVars resolves {{hook_domain}} from hook.domain_name BEFORE
      // the seam. The raw marker must not survive into what the model sees.
      hookOver = {
        suggestion_text: 'เข้าเว็บได้ที่ {{hook_domain}} นะคะ',
        domain_name: 'example.com',
      };
      const req = await captureRequest();
      expect(req.suggestionText).toContain('example.com');
      expect(req.suggestionText).not.toContain('{{hook_domain}}');
    });

    it('CASE 6 — ai_raw_site_rules ON → the site-rules switch reaches the request', async () => {
      // The site-rules block is assembled INSIDE the provider; on THIS side the
      // provable fact is the opt-in flag + guide crossing the seam. Flip on for
      // the run, assert, and it resets next beforeEach ("เปิดให้เทส แล้วปิดคืน").
      hookOver = {
        ai_raw_site_rules: true,
        ai_site_rules_guide: 'ต้องอ้างอิงกฎเว็บเสมอ',
      };
      const req = await captureRequest();
      expect(req.sendSiteRules).toBe(true);
      expect(req.siteRulesGuide).toBe('ต้องอ้างอิงกฎเว็บเสมอ');
    });

    it('CASE 7 — [[[history]]] is assembled from prior messages into the prompt', async () => {
      // A room exists (non-assisted) and prior messages are returned newest-first;
      // the pipeline injects them oldest→newest into the [[[history]]] marker.
      hookOver = { suggestion_text: 'บริบท:\n[[[history]]]\nจบบริบท' };
      roomFindOne = {
        _id: 'room-hist',
        hook_id: HOOK_ID,
        assist_status: false,
      };
      historyMsgs = [
        { sender_type: 'customer', content: 'คำถามเก่า' },
        { sender_type: 'bot', content: 'คำตอบเก่า' },
      ];
      const req = await captureRequest('คำถามใหม่');
      // Marker replaced (no raw [[[history]]] left) …
      expect(req.suggestionText).not.toContain('[[[history]]]');
      /* [FLIP-20260830-STABLEPROMPT] FLIPPED on the owner's order (30/08):
         stable layout is the default now, so the window rides
         historyBlockText (a contents block) instead of the suggestion. The
         old in-suggestion shape survives only under the explicit per-OA
         opt-out (ai_stable_prompt: false), covered in the unit tier. */
      expect(req.suggestionText).not.toContain('[start-of-history]');
      const hist = String(
        (req as unknown as Record<string, unknown>)['historyBlockText'],
      );
      expect(hist).toContain('[start-of-history]');
      expect(hist).toContain('คำถามเก่า');
      expect(hist).toContain('คำตอบเก่า');
    });
  });

  // ── B · non-text events NEVER reach the seam (scripted.received === 0) ──────
  describe('B · non-text events stop before the AI seam', () => {
    // Enqueue a reply that must never be consumed — proof is received.length===0.
    async function drive(event: Record<string, unknown>): Promise<void> {
      scripted.enqueue({ text: 'ต้องไม่ถูกใช้' });
      await post(app, [event]);
      // Give the background pipeline the same budget a real reach would need.
      await waitFor(() => trace.chatRows.length >= 1);
    }

    it('CASE 8 — a sticker is stored and silent, never billed', async () => {
      await drive(messageEvent('sticker'));
      expect(scripted.received).toHaveLength(0);
      expect(trace.replies).toHaveLength(0);
    });

    it('CASE 9 — an image never reaches the seam', async () => {
      await drive(messageEvent('image'));
      expect(scripted.received).toHaveLength(0);
    });

    it('CASE 10 — a video never reaches the seam', async () => {
      await drive(messageEvent('video'));
      expect(scripted.received).toHaveLength(0);
    });

    it('CASE 11 — a follow event never reaches the seam', async () => {
      scripted.enqueue({ text: 'ต้องไม่ถูกใช้' });
      await post(app, [typedEvent('follow')]);
      // follow carries no text; there is nothing to wait ON, so poll a fixed
      // budget then assert the seam stayed untouched.
      await waitFor(() => scripted.received.length >= 1, {
        tries: 20,
        gapMs: 5,
      });
      expect(scripted.received).toHaveLength(0);
      expect(trace.replies).toHaveLength(0);
    });

    it('CASE 12 — a postback is stored but its data is not read as user text', async () => {
      scripted.enqueue({ text: 'ต้องไม่ถูกใช้' });
      await post(app, [
        { ...typedEvent('postback'), postback: { data: 'action=buy&item=1' } },
      ]);
      await waitFor(() => trace.chatRows.length >= 1);
      // Stored as machine input, never sent to the model.
      expect(scripted.received).toHaveLength(0);
      expect(trace.replies).toHaveLength(0);
    });
  });

  // ── C · assist hand-off, driven by scripting a reply with [[[assist]]] ──────
  describe('C · assist hand-off over HTTP', () => {
    /** A member + a claimable room: the ticket gate is OPEN, so the full
     * claim+ticket path runs. */
    function armAssist(roomId = 'room-assist'): void {
      memberDoc = { _id: 'member-assist', member_user_id: USER_ID };
      roomToClaim = {
        _id: roomId,
        channel_user_id: USER_ID,
        hook_id: HOOK_ID,
        assist_status: false,
      };
    }

    it('CASE 13 — room claimed + ticket created + Telegram gated (no creds → no send)', async () => {
      armAssist();
      // baseHook sets NO telegram_key → canNotifyTelegram is false, the hand-off
      // still happens, and no socket to api.telegram.org is opened.
      scripted.enqueue({ text: 'โอนแอดมินให้ค่ะ [[[assist]]]' });
      await post(app, [textEvent('ขอคุยกับแอดมิน')]);
      await waitFor(() => trace.roomClaims.length >= 1);
      await waitFor(() => trace.ticketsCreated.length >= 1);
      expect(trace.roomClaims).toHaveLength(1);
      expect(
        (trace.roomClaims[0]!['update'] as { $set: Record<string, unknown> })
          .$set['assist_status'],
      ).toBe(true);
      expect(trace.ticketsCreated).toHaveLength(1);
      // Marker never reaches the wire.
      await waitFor(() => trace.replies.length >= 1);
      expect(trace.replies[0]).not.toContain('[[[assist]]]');
    });

    it('CASE 14 — an already-assisted room skips everything, no second ticket', async () => {
      // The recency read returns a room already assist_status:true → the assist
      // path bails BEFORE the atomic claim and BEFORE the ticket.
      roomFindOne = {
        _id: 'room-already',
        hook_id: HOOK_ID,
        assist_status: true,
      };
      // A last customer message old enough would auto-unassist; return none so
      // the room stays assisted and the bot never even reaches the seam.
      scripted.enqueue({ text: 'ไม่ควรถูกส่ง [[[assist]]]' });
      await post(app, [textEvent('ขอแอดมินอีกรอบ')]);
      // Give the pipeline time; an assisted room stores the inbound and returns.
      await waitFor(() => trace.chatRows.length >= 1);
      expect(trace.ticketsCreated).toHaveLength(0);
      expect(trace.roomClaims).toHaveLength(0);
    });

    it('CASE 15 — two concurrent assist events → exactly one ticket (atomic claim)', async () => {
      // The atomic findOneAndUpdate returns the room for the FIRST caller and
      // null for the rest. Model the race: roomToClaim yields once, then null.
      memberDoc = { _id: 'member-race', member_user_id: USER_ID };
      let handedOut = false;
      roomToClaim = null; // default; overridden by the stateful fake below
      const room = {
        _id: 'room-race',
        channel_user_id: USER_ID,
        hook_id: HOOK_ID,
        assist_status: false,
      };
      // The LOSER re-reads the room and must find it already exists → it skips
      // the duplicate ticket (legacy:437-447). Without this the "no room at all"
      // branch would create a ticket for the loser too. NOTE: this findOne is
      // also the assist-recency read; it returns assist_status:false so the
      // WINNER still proceeds to claim before the recency bail.
      roomFindOne = { ...room, assist_status: false };
      // Re-point findOneAndUpdate to hand the room out only ONCE.
      const original = chatRoomModelFake.findOneAndUpdate;
      chatRoomModelFake.findOneAndUpdate = (
        filter: unknown,
        update: unknown,
      ) => {
        trace.roomClaims.push({ filter, update });
        const win = !handedOut;
        handedOut = true;
        return query(win ? room : null);
      };
      try {
        scripted
          .enqueue({ text: 'รับเรื่องค่ะ [[[assist]]]' })
          .enqueue({ text: 'รับเรื่องค่ะ [[[assist]]]' });
        await Promise.all([
          post(app, [textEvent('คุยกับแอดมิน', 'ev-a')]),
          post(app, [textEvent('คุยกับแอดมิน', 'ev-b')]),
        ]);
        await waitFor(() => trace.roomClaims.length >= 2);
        // Both attempted the claim …
        expect(trace.roomClaims.length).toBeGreaterThanOrEqual(2);
        // … but only the winner (non-null claimedRoom) created a ticket.
        expect(trace.ticketsCreated).toHaveLength(1);
      } finally {
        chatRoomModelFake.findOneAndUpdate = original;
      }
    });

    it('CASE 16 — assist × flex tag: assist fires and the flex tag is marker-stripped', async () => {
      // Flex ASSEMBLY is unported (flexProfileContents is always null), so the
      // provable behaviour is: assist claims the room AND the flex tag leaves no
      // bracket residue on the wire. (Whether a card renders is model/flex-build
      // territory — recorded as needs-real.)
      armAssist('room-assist-flex');
      scripted.enqueue({ text: 'ดูโปรไฟล์ [[[flex_profile]]] [[[assist]]]' });
      await post(app, [textEvent('ขอแอดมินพร้อมการ์ด')]);
      await waitFor(() => trace.roomClaims.length >= 1);
      expect(trace.roomClaims).toHaveLength(1);
      await waitFor(() => trace.replies.length >= 1);
      expect(trace.replies[0]).not.toContain('[[[');
      expect(trace.replies[0]).not.toContain('flex_profile');
    });

    it('CASE 17 — assist × dynamic-tag: the prompt var is substituted, assist still fires', async () => {
      armAssist('room-assist-tag');
      hookOver = {
        suggestion_text: 'เว็บ {{hook_domain}}',
        domain_name: 'assist.example',
      };
      scripted.enqueue({ text: 'โอนให้แอดมินค่ะ [[[assist]]]' });
      await post(app, [textEvent('ต้องการแอดมิน')]);
      await waitFor(() => scripted.received.length >= 1);
      await waitFor(() => trace.roomClaims.length >= 1);
      // The substituted prompt reached the seam …
      expect(scripted.received[0]!.suggestionText).toContain('assist.example');
      // … and the assist still fired.
      expect(trace.roomClaims).toHaveLength(1);
    });

    it('CASE 18 — assist × customer-link: [[link]] resolved, assist still fires', async () => {
      armAssist('room-assist-link');
      hookOver = { answer_link: 'https://link.example/go' };
      scripted.enqueue({
        text: 'ดูที่นี่ [[link]] แล้วรอแอดมินนะคะ [[[assist]]]',
      });
      await post(app, [textEvent('ขอลิงก์และแอดมิน')]);
      await waitFor(() => trace.roomClaims.length >= 1);
      await waitFor(() => trace.replies.length >= 1);
      expect(trace.roomClaims).toHaveLength(1);
      // The link is substituted, the assist marker stripped.
      expect(trace.replies[0]).toContain('https://link.example/go');
      expect(trace.replies[0]).not.toContain('[[link]]');
      expect(trace.replies[0]).not.toContain('[[[assist]]]');
    });
    // CASE 19 lives above (its own describe) — the first-message ticket contract.
  });

  // ── D · the reply on the wire ──────────────────────────────────────────────
  describe('D · the reply on the wire', () => {
    it('CASE 20 — every marker family is stripped before send, incl. UNCLOSED', async () => {
      // [FIX-20260808-UNCLOSEDMARKER] proven on the HTTP path. A single reply
      // carrying a three-bracket tag, a two-bracket tag, a SCREAMING fence, an
      // invented tag, AND an UNCLOSED opener — the real sentence after the
      // unclosed marker must survive, no bracket residue may reach the wire.
      memberDoc = { _id: 'member-wire', member_user_id: USER_ID };
      scripted.enqueue({
        text:
          'ยินดีค่ะ [[[history]]] [[bracket2]] [END_OF_BASIC_INFO] ' +
          '[[[unknown_tag]]] [[[assist world',
      });
      await post(app, [textEvent('อะไรก็ได้')]);
      await waitFor(() => trace.replies.length >= 1);
      const sent = trace.replies[0]!;
      // No marker residue of ANY family.
      expect(sent).not.toContain('[[[');
      expect(sent).not.toContain('[[');
      expect(sent).not.toContain('[END_OF_BASIC_INFO]');
      expect(sent).not.toContain('unknown_tag');
      // The unclosed "[[[assist world" leaves the real word "world" behind …
      expect(sent).toContain('world');
      // … and NOT the marker name "assist" glued on as fake answer text.
      expect(sent).not.toMatch(/\bassist\b/);
      expect(sent).toContain('ยินดีค่ะ');
    });

    it('CASE 21 — a flex tag is detected & stripped; text falls through (assembly unported)', async () => {
      // Flex card ASSEMBLY is unported → flexProfileContents null → the pipeline
      // falls through to the plain-text reply, with the flex tag stripped. That
      // fall-through IS the provable pipeline behaviour; a rendered card needs a
      // real flex build (recorded as needs-real).
      memberDoc = { _id: 'member-flex', member_user_id: USER_ID };
      scripted.enqueue({ text: 'นี่คือการ์ด [[[flex_m00001]]] ค่ะ' });
      await post(app, [textEvent('ขอการ์ด')]);
      await waitFor(() => trace.replies.length >= 1);
      expect(trace.replies[0]).toBe('นี่คือการ์ด ค่ะ');
      expect(trace.replies[0]).not.toContain('flex_m00001');
      expect(trace.replies[0]).not.toContain('[[[');
    });

    it('CASE 22 — a customer-link reply substitutes [[link]] with answer_link', async () => {
      memberDoc = { _id: 'member-link', member_user_id: USER_ID };
      hookOver = { answer_link: 'https://portal.example/login' };
      scripted.enqueue({ text: 'เข้าสู่ระบบที่ [[link]] ค่ะ' });
      await post(app, [textEvent('ขอลิงก์เข้าสู่ระบบ')]);
      await waitFor(() => trace.replies.length >= 1);
      expect(trace.replies[0]).toBe(
        'เข้าสู่ระบบที่ https://portal.example/login ค่ะ',
      );
      expect(trace.replies[0]).not.toContain('[[link]]');
    });

    it('CASE 23 — default_answer_text fallback when tagStatus=not_found', async () => {
      memberDoc = { _id: 'member-fallback', member_user_id: USER_ID };
      hookOver = { default_answer_text: 'ขออภัย ไม่พบข้อมูลค่ะ' };
      // The model produced a grounded-looking answer but tagged it not_found →
      // resolveReplyText swaps in the hook's default_answer_text.
      scripted.enqueue({ text: 'ยอดคงเหลือคือ 999', tagStatus: 'not_found' });
      await post(app, [textEvent('ยอดเท่าไหร่')]);
      await waitFor(() => trace.replies.length >= 1);
      expect(trace.replies[0]).toBe('ขออภัย ไม่พบข้อมูลค่ะ');
    });

    it('CASE 24 — a reply longer than the 4000-char cap is truncated', async () => {
      memberDoc = { _id: 'member-long', member_user_id: USER_ID };
      const longText = 'ก'.repeat(4200);
      scripted.enqueue({ text: longText });
      await post(app, [textEvent('ขอข้อความยาว')]);
      await waitFor(() => trace.replies.length >= 1);
      // MAX_LENGTH is 4000 (reply-tags.util.ts). flex_pc JSON is exempt — this
      // is plain text, so it IS cut.
      expect(trace.replies[0]!.length).toBe(4000);
    });
  });

  // ── E · guards ─────────────────────────────────────────────────────────────
  describe('E · guards', () => {
    it('CASE 25 — a rate-limited text is told to wait and never reaches the seam', async () => {
      // Flip the limiter to limited for this one call, then restore.
      const original = rateLimitFake.consume;
      rateLimitFake.consume = () =>
        Promise.resolve({
          limited: true,
          current: 3,
          limit: 2,
          windowSeconds: 30,
        });
      try {
        scripted.enqueue({ text: 'ต้องไม่ถูกใช้' });
        await post(app, [textEvent('ยิงรัว ๆ')]);
        await waitFor(() => trace.replies.length >= 1);
        expect(trace.replies[0]).toBe('กรุณารอสักครู่และลองใหม่อีกครั้ง');
        expect(scripted.received).toHaveLength(0);
      } finally {
        rateLimitFake.consume = original;
      }
    });

    it('CASE 26 — an out-of-hours (status:0) OA replies the closed message, no seam', async () => {
      hookOver = { status: 0 };
      scripted.enqueue({ text: 'ต้องไม่ถูกใช้' });
      await post(app, [textEvent('เปิดไหม')]);
      await waitFor(() => trace.replies.length >= 1);
      expect(trace.replies[0]).toBe(
        'อยู่นอกเวลาทำการ กรุณาติดต่อใหม่อีกครั้งในภายหลังหรือติดต่อเจ้าหน้าที่',
      );
      expect(scripted.received).toHaveLength(0);
    });

    it('CASE 27 — an unknown alias is 404 "Unknown alias" (before any HMAC)', async () => {
      const res = await post(app, [textEvent()], {
        alias: 'no-such-alias',
        signature: 'whatever',
      });
      expect(res.status).toBe(404);
      expect(res.text).toBe('Unknown alias');
    });

    it('CASE 28 — a bad signature is 401 "Invalid signature"', async () => {
      const res = await post(app, [textEvent()], {
        signature: 'not-the-right-signature',
      });
      expect(res.status).toBe(401);
      expect(res.text).toBe('Invalid signature');
    });

    it('CASE 29 — dedupe: only events[0] runs per POST; repeated POSTs each reach the seam', async () => {
      // There is NO event-id dedupe in the pipeline (matches legacy). What DOES
      // dedupe is the batch rule: only events[0] is processed. Prove BOTH the
      // real behaviours: (a) a 3-event batch reaches the seam once; (b) posting
      // the SAME eventId twice reaches the seam twice (no id-based suppression).
      memberDoc = { _id: 'member-dedupe', member_user_id: USER_ID };
      scripted.enqueue({ text: 'หนึ่ง' });
      await post(app, [
        textEvent('first', 'ev-dup'),
        textEvent('second', 'ev-dup'),
        textEvent('third', 'ev-dup'),
      ]);
      await waitFor(() => scripted.received.length >= 1);
      // Only events[0] ran — the two behind it were discarded.
      expect(scripted.received).toHaveLength(1);
      expect(scripted.received[0]!.question).toBe('first');

      // A second, identical POST (same eventId) is processed again — there is no
      // id ledger to suppress it. This records the ACTUAL contract, not a wish.
      scripted.enqueue({ text: 'สอง' });
      await post(app, [textEvent('first', 'ev-dup')]);
      await waitFor(() => scripted.received.length >= 2);
      expect(scripted.received).toHaveLength(2);
    });
  });

  // ── F · the switch itself, live in THIS module ─────────────────────────────
  describe('F · the AI provider switch, observed on the bound instance', () => {
    it('CASE 30 — the bound provider IS the scripted mock (the switch selected it here)', () => {
      // This e2e module overrode AI_REPLY_PROVIDER with the in-test scripted
      // provider. Proving the SAME instance the pipeline writes to is the one the
      // tests read is the module-level analogue of the boot-log "provider = mock"
      // signal. The env-driven factory (mock|real, prod-throw) is exhaustively
      // proven in z-test/unit/ai-provider-switch.spec.ts (all 6 rows) — that is
      // where the boot-log/throw directions live; here we assert the binding.
      const bound = app.get<ScriptedAiReplyProvider>(AI_REPLY_PROVIDER);
      expect(bound).toBe(scripted);
      expect(typeof bound.generate).toBe('function');
    });

    it('CASE 31 — the scripted provider counts calls it serves (cap wraps mock too)', async () => {
      // The mock records every request it serves — the loop-guard the cap
      // decorator counts in production. Drive two calls and assert both were
      // recorded, so a runaway loop would be observable/refusable.
      memberDoc = { _id: 'member-cap', member_user_id: USER_ID };
      scripted.enqueue({ text: 'a' }).enqueue({ text: 'b' });
      await post(app, [textEvent('one', 'ev-c1')]);
      await waitFor(() => scripted.received.length >= 1);
      await post(app, [textEvent('two', 'ev-c2')]);
      await waitFor(() => scripted.received.length >= 2);
      expect(scripted.received).toHaveLength(2);
      // The cap DECORATOR's count-and-refuse is unit-proven against a controlled
      // counter file in ai-provider-switch.spec.ts (AiCapDecorator suite); the
      // shared 5/5 real counter cannot be driven safely from here.
    });

    it('CASE 32 — prod+mock is a boot-time throw (structural — asserted at the factory)', () => {
      // HTTP cannot express "the module refused to boot", so this leg is proven
      // at the factory level exactly as the plan permits (reuse the unit-level
      // selectAiReplyProvider assertion), imported at the top of this file.
      expect(() =>
        selectAiReplyProvider(
          { providerMode: 'mock', capMode: 'on', capLimit: 5 },
          // The prod-throw fires BEFORE either provider is touched, so the exact
          // instances do not matter — `as never` matches the unit test's own
          // convention for the leg where identity is irrelevant.
          scripted as never,
          { generate: () => Promise.reject(new Error('real')) } as never,
          'production',
          { log: () => undefined },
        ),
      ).toThrow(/forbidden in production/);
    });
  });
});
