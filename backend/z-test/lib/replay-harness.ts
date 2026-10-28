import { createHmac } from 'node:crypto';

import { WebhookService } from '../../src/modules/webhook/webhook.service';

import type { EffectEvent, EffectTrace } from './effect-transcript';

/**
 * [PROG-20260905-P8] The replay harness: drive the REAL `processLockedEvent` with a
 * captured LINE delivery and record everything it does.
 *
 * WHY A SECOND SET OF DOUBLES, WHEN `webhook-flow-matrix.spec.ts` ALREADY HAS SOME.
 * That spec is one of the ten suites that pin this flow today. Refactoring a pin to
 * share its harness would mean editing the thing that is supposed to be holding still
 * while the spine is cut — the one change this program must not make. So the doubles
 * are modelled on its proven shapes (same return bodies, including the deliberate
 * difference between the text and flex send results) and live here, where changing them
 * cannot redden a pin.
 *
 * WHAT MAKES THIS DIFFERENT FROM A NORMAL TEST HARNESS. A test double answers; this one
 * answers AND records. Every collaborator call becomes an entry in one ordered effect
 * stream, so the transcript covers the three channels the program promised — outbound
 * LINE calls, Mongo writes, and webhook_log rows — plus everything nobody thought to
 * assert. That last part is the point: the proof is "nothing else changed", and only a
 * recorder that captures the uninteresting calls can say that.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No network, no database, no Redis, no AI. A replay
 * that reached outside the process would be neither deterministic nor safe to run in a
 * suite, and the AI cap ledger is real money.
 */

export interface ReplayOptions {
  /** The hook row the delivery is processed against. */
  hook?: Record<string, unknown>;
  /** Text the fake AI answers with. Left undefined, the provider is unavailable. */
  aiReplyText?: string;
  /** Profile payload the external API returns. */
  profileData?: Record<string, unknown>;
}

export interface ReplayResult extends EffectTrace {
  /** Non-fatal problems the harness itself noticed; empty is the expected state. */
  notes: string[];
}

const CHANNEL_SECRET = 'replay-channel-secret';
const HOOK_ID = 'a0d000000000000000000012';

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
    'exec',
  ]) {
    q[m] = () => (m === 'exec' ? Promise.resolve(result) : q);
  }
  q['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return q;
}

export function baseHook(): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: 'replay',
    name: 'replay hook',
    status: 1,
    channel_secret: CHANNEL_SECRET,
    channel_access_token: 'replay-access-token',
    channel_id: 'replay-channel-id',
    ai_key: null,
    ai_vendor: null,
    slip_check: false,
    assist_status: false,
  };
}

/**
 * Wrap an object so every method call is appended to `effects` before the real double
 * runs. `name` becomes the effect's prefix, so a transcript line reads
 * `007 lineApi.sendLineReplyMessage {...}`.
 *
 * Arguments are recorded, not just the call: a move that passes the same collaborator a
 * different argument is a behaviour change, and it is exactly the kind a green suite
 * misses.
 */
function record<T extends Record<string, unknown>>(
  effects: EffectEvent[],
  name: string,
  impl: T,
): T {
  const wrapped: Record<string, unknown> = {};
  for (const key of Object.keys(impl)) {
    const value = impl[key];
    if (typeof value !== 'function') {
      wrapped[key] = value;
      continue;
    }
    wrapped[key] = (...args: unknown[]) => {
      effects.push({
        kind: `${name}.${key}`,
        detail: args.length === 1 ? args[0] : args,
      });
      return (value as (...a: unknown[]) => unknown)(...args);
    };
  }
  return wrapped as T;
}

/**
 * Build a service wired to recording doubles, plus the function that posts a captured
 * delivery through it.
 */
export function buildReplayHarness(opts: ReplayOptions = {}): {
  result: ReplayResult;
  replay: (body: Record<string, unknown>) => Promise<void>;
} {
  const hook = opts.hook ?? baseHook();
  const effects: EffectEvent[] = [];
  const notes: string[] = [];

  const passthrough = {
    findOne: () => query(null),
    find: () => query([]),
    findById: () => query(null),
    create: () => Promise.resolve({ _id: 'created' }),
    updateOne: () => query({ acknowledged: true }),
    countDocuments: () => query(0),
  };

  const service = new WebhookService(
    record(effects, 'hookModel', { findOne: () => query(hook) }) as never,
    record(effects, 'chatRoomModel', {
      findOne: () => query(null),
      findOneAndUpdate: () => query({ _id: 'room-1' }),
      updateOne: () => query({ acknowledged: true }),
    }) as never,
    record(effects, 'chatMessageModel', { ...passthrough }) as never,
    record(effects, 'memberModel', { ...passthrough }) as never,
    record(effects, 'assignHistoryModel', { ...passthrough }) as never,
    record(effects, 'ticketModel', { ...passthrough }) as never,
    record(effects, 'objectImageModel', { ...passthrough }) as never,
    record(effects, 'imageStorageModel', { ...passthrough }) as never,
    { safeDecrypt: (v: string) => v } as never, // not recorded: called per field, pure
    record(effects, 'hookCache', {
      cacheHook: () => Promise.resolve(),
      getHookByAlias: () => Promise.resolve(hook),
      getHookByAliasWithSource: () =>
        Promise.resolve({ hook, source: 'cache' }),
    }) as never,
    record(effects, 'chatHistory', {
      /* The three methods the spine actually calls — confirmed by grepping
         `this.chatHistory.` in webhook.service.ts, not by copying another harness.
         `getOrCreateRoom` was missing on the first attempt and the flow SWALLOWED it
         ("[EAGERROOM] room create failed (continuing…)"), so the replay still went green
         while running a degraded path. Freezing a golden from that would have pinned the
         failure as the expected behaviour. */
      getOrCreateRoom: () => Promise.resolve({ _id: 'room-1' }),
      logMessage: () => Promise.resolve({ _id: 'msg-1', room_id: 'room-1' }),
      logSystemMessage: () => Promise.resolve({ _id: 'sys-1' }),
    }) as never,
    record(effects, 'lineApi', {
      sendLineReplyMessage: () => Promise.resolve({ status: 200, data: {} }),
      sendLineFlexReply: () =>
        Promise.resolve({ status: 200, data: { sentMessages: [] } }),
      sendLineLoadingIndicator: () =>
        Promise.resolve({ status: 200, data: {} }),
      sendLinePushMessage: () => Promise.resolve({ status: 200, data: {} }),
      sendLinePushFlexMessage: () => Promise.resolve({ status: 200, data: {} }),
      getLineProfile: () => Promise.resolve(null),
    }) as never,
    record(effects, 'content', {
      downloadAndSaveImage: () => Promise.resolve(null),
      downloadAndSaveVideo: () => Promise.resolve(null),
    }) as never,
    record(effects, 'webhookLog', {
      createLog: () => Promise.resolve(),
    }) as never,
    record(effects, 'externalApi', {
      getCombinedData: () => Promise.resolve(opts.profileData ?? {}),
    }) as never,
    record(effects, 'customTool', {
      getToolForHook: () => Promise.resolve(null),
      getCombinedData: () => Promise.resolve(opts.profileData ?? {}),
      extractProfile: () => null,
    }) as never,
    record(effects, 'rateLimit', {
      consume: () => Promise.resolve({ limited: false }),
      peek: () =>
        Promise.resolve({ limited: false, level: 1, current: null, limit: 3 }),
    }) as never,
    {
      getClient: () => {
        throw new Error('no redis in replay');
      },
    } as never,
    record(effects, 'ai', {
      generate: () =>
        opts.aiReplyText === undefined
          ? Promise.reject(new Error('AI provider unavailable in replay'))
          : Promise.resolve({
              text: opts.aiReplyText,
              noData: false,
              tagStatus: null,
            }),
    }),
    {
      summarise: () =>
        Promise.reject(new Error('assist summary unavailable in replay')),
    },
    { getConfigByKey: () => Promise.resolve(null) } as never,
    { telegramWebhookSecret: undefined, multiEventDelivery: false },
    { geminiApiKey: undefined, modelId: 'gemini-3.5-flash' } as never,
    { ignoreDocId: undefined } as never,
    record(effects, 'realtime', { publish: () => Promise.resolve() }) as never,
    record(effects, 'linkToken', {
      mintLinkToken: () => ({
        url: 'https://link.test/x',
        token: 'tok',
        expiresAt: 0,
      }),
    }) as never,
    record(effects, 'flexModel', {
      findOne: () => query(null),
      findById: () => query(null),
    }) as never,
    {
      translate: (_d: string, k: string | number | null) => `${k ?? ''}`,
    } as never,
    record(effects, 'slip', {
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
    }) as never,
    record(effects, 'qr', {
      checkIfSlipWithQrCode: () => Promise.resolve(false),
    }) as never,
    undefined, // configCacheInvalidator
    undefined, // paymentRunner
    undefined, // docRetrieval
    undefined, // strike
    record(effects, 'linePush', {
      /* Mirrors the pin suite's double, INCLUDING the difference that matters: a flex
         send answers `{ sentMessages: [] }` and a text send answers `{}`. The two bodies
         are copied verbatim into webhook_logs, so collapsing them into one silently
         rewrites the logged response — a trap this repo has already sprung once. */
      dispatch: (req: { messages?: Array<Record<string, unknown>> }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          attempts: 1,
          durationMs: 0,
          data:
            req.messages?.[0]?.['type'] === 'flex' ? { sentMessages: [] } : {},
        }),
    }) as never,
    undefined, // StoredMenuCardSource — the last positional dependency
  );

  const replay = async (body: Record<string, unknown>): Promise<void> => {
    const raw = JSON.stringify(body);
    const meta = {
      method: 'POST',
      originalUrl: '/replay/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest-replay',
    };
    try {
      await service.processWebhook(body, hook, 'cache', 'replay', meta);
    } catch (err) {
      // A throw is a legitimate outcome to record — the spine has an outer catch, so
      // anything escaping it is itself a fact worth freezing into the transcript.
      notes.push(
        `processWebhook threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return { result: { effects, notes }, replay };
}
