import { createHmac } from 'node:crypto';

import {
  AiProviderUnavailableError,
  AssistSummaryUnavailableError,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';

/**
 * ==== [FEAT-20260814-STATUSOFFQUIET] hook off ⇒ no image checks, no assist ====
 *
 * Owner, 14/08 (after the live finding that a switched-off OA still opened
 * tickets): "ถ้าทำให้เป็นแบบ hook off ไม่ตรวจภาพ / ไม่ assist เลย" — and the
 * hard rule for the change: "hook ON ห้ามแก้ไข" (the on-path may not move at
 * all) while history storage stays exactly as it is ("เก็บประวัติ = ถูกต้อง").
 *
 * Root cause being fixed: the only status gate sits at the out-of-hours block
 * (after the non-text branch — a deliberate legacy mirror), so the WHOLE
 * image/slip pipeline above it still ran while off: QR prescan, the
 * slip_require_profile refusal (reply + `[[[assist]]]` ticket), the paid
 * Swiftcheck verify, the image_answer_text reply and its `[[[assist]]]` ticket.
 *
 * Two suites, deliberately:
 *   [PIN] — status ON flows (text/AI, image answer + assist ticket, slip
 *           refusal + ticket, slip verify) and the already-correct OFF-text
 *           silence. GREEN on BOTH trees — this is the "on ห้ามแก้" proof.
 *   [OFF] — the target behaviour while off: image/slip arrive ⇒ history + the
 *           picture are still stored, but NO prescan, NO refusal, NO Swiftcheck,
 *           NO reply, NO ticket, NO assist claim. RED on the pre-fix tree.
 *
 * Harness pattern copied from room-bootstrap-before-pack.spec.ts (project
 * convention: specs are self-contained). Fakes record; nothing is billed.
 *
 * revert: delete this file. No prod import.
 */

const CHANNEL_SECRET = 'statusoff-quiet-secret';
const HOOK_ID = 'a0d000000000000000000094';
const USER_ID = 'Ustatusoffquiet000000000000000001';

/** Marker-carrying copy, as an operator would configure it. */
const IMAGE_ANSWER_RAW = 'รับรูปแล้วนะคะ [[[assist]]]';
const REFUSAL_RAW = 'ผูกบัญชีก่อนส่งสลิปนะคะ [[[assist]]]';

const LINKED_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'สมชาย ทดสอบ', customer_tel: '0800000000' },
    },
  },
};
/** The only shape the refusal gate accepts as "provably no account". */
const UNLINKED_404_PROFILE = {
  'Path : api/v1/customer': { success: false, status: 404, data: null },
};

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
  steps: string[];
  replies: string[];
  ticketsCreated: Record<string, unknown>[];
  slipVerifyCalls: number;
  chatRows: string[]; // senderType:messageType of every stored row
}

interface Opts {
  hookOver?: Record<string, unknown>;
  profileData?: Record<string, unknown>;
  withImageStorage?: boolean;
  /** Drive the limiter: `true` makes every message hit the cap. */
  rateLimited?: boolean;
}

function baseHook(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: 'statusoffquiet',
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'statusoff-dead-token',
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
    ...over,
  };
}

function buildHarness(opts: Opts = {}) {
  const hook = baseHook(opts.hookOver ?? {});
  const trace: Trace = {
    steps: [],
    replies: [],
    ticketsCreated: [],
    slipVerifyCalls: 0,
    chatRows: [],
  };

  const hookModel = { findOne: () => query(hook), findById: () => query(hook) };
  const chatRoomModel = {
    findOne: () => query({ _id: 'room-1', assist_status: false }),
    find: () => query([]),
    findOneAndUpdate: () => {
      trace.steps.push('room.claim');
      return query({ _id: 'room-1' });
    },
    updateOne: () => query({ acknowledged: true }),
    countDocuments: () => query(0),
  };
  const chatMessageModel = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'msg-x' }),
    updateOne: () => query({ acknowledged: true }),
    countDocuments: () => query(0),
  };
  // Member EXISTS with a real name: the assist path then has a userMongoId and
  // can create the ticket without the first-message materialise detour.
  const memberModel = {
    findOne: () =>
      query({
        _id: 'mem-1',
        member_user_id: USER_ID,
        line_user_id: USER_ID,
        display_name: 'ลูกค้าทดสอบ',
        nickname: 'ลูกค้าทดสอบ',
        last_synced_at: new Date(),
      }),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'mem-1' }),
    updateOne: () => query({ acknowledged: true }),
    findOneAndUpdate: () => query({ _id: 'mem-1' }),
    findById: () => query(null),
    countDocuments: () => query(0),
  };
  const ticketModel = {
    findOne: () => query(null),
    find: () => query([]),
    create: (row: Record<string, unknown>) => {
      trace.steps.push('ticket.create');
      trace.ticketsCreated.push(row);
      return Promise.resolve({ _id: 'tick-1', ...row });
    },
    updateOne: () => query({ acknowledged: true }),
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

  const lineApi = {
    sendLineReplyMessage: (_t: string, _r: string, text: string) => {
      trace.steps.push('line.reply');
      trace.replies.push(text);
      return Promise.resolve({ status: 200, data: {} });
    },
    sendLineFlexReply: (
      _t: string,
      _r: string,
      _c: unknown,
      altText: string,
    ) => {
      trace.steps.push('line.flex');
      trace.replies.push(`[flex] ${altText}`);
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
    ticketModel as never, // ⭐ recorded — "no ticket while off" is the claim
    passthrough as never, // objectImageModel
    {
      findById: () =>
        query(
          opts.withImageStorage
            ? {
                _id: 'store1',
                image_url: '/uploads/slip.jpg',
                file_path: '/tmp/statusoff-quiet-not-a-real-file.png',
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
    } as never, // hookCache
    {
      logMessage: (row: Record<string, unknown>) => {
        trace.steps.push('chat.log');
        trace.chatRows.push(
          `${String(row['senderType'])}:${(row['messageType'] as string | undefined) ?? '?'}`,
        );
        return Promise.resolve({ _id: 'msg-1', room_id: 'room-1' });
      },
      logSystemMessage: () => Promise.resolve({ _id: 'sys-1' }),
      resolveRoom: () => Promise.resolve({ _id: 'room-1' }),
      getOrCreateRoom: () => Promise.resolve({ _id: 'room-1' }),
    } as never, // chatHistory
    lineApi as never,
    {
      downloadAndSaveImage: () => {
        trace.steps.push('image.download');
        return Promise.resolve(opts.withImageStorage ? 'store1' : null);
      },
      downloadAndSaveVideo: () => Promise.resolve(null),
    } as never,
    { createLog: () => Promise.resolve() } as never,
    { getCombinedData: () => Promise.resolve(opts.profileData ?? {}) } as never,
    {
      getToolForHook: () => Promise.resolve(null),
      getCombinedData: () => Promise.resolve(opts.profileData ?? {}),
      extractProfile: () => null,
    } as never,
    {
      // Recorded: the counter must keep charging even while the OA is off, or a
      // switched-off hook becomes a free spam window whose quota is wrong the
      // moment it is switched back on.
      consume: () => {
        trace.steps.push('ratelimit.consume');
        return Promise.resolve({ limited: opts.rateLimited === true });
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
    } as never,
    {
      getClient: () => {
        throw new Error('no redis in unit test');
      },
    } as never,
    {
      generate: () => {
        trace.steps.push('ai.generate');
        return Promise.reject(new AiProviderUnavailableError());
      },
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
    } as never,
    { findOne: () => query(null), findById: () => query(null) } as never, // flexModel
    {
      translate: (_d: string, k: string | number | null) => `${k ?? ''}`,
    } as never,
    {
      // Same identity check production uses — slip verification is "enabled"
      // exactly when the hook says so, and the call itself is only recorded.
      isSlipVerifyEnabled: (h: Record<string, unknown> | null | undefined) =>
        h?.['slip_check'] === true && !!h?.['slip_verify_key'],
      verifySlip: () => {
        trace.steps.push('slip.verify');
        trace.slipVerifyCalls += 1;
        return Promise.resolve({
          slipVerifyResult: null,
          slipRecordId: null,
          slipCreatedAt: null,
          slipCondition: null,
          attempted: true,
        });
      },
      handleSlipCallback: () => Promise.resolve(),
    } as never, // slipFlow
    { checkIfSlipWithQrCode: () => Promise.resolve(false) } as never, // qrVision
    undefined, // configCacheInvalidator
    undefined, // paymentRunner
    undefined, // docRetrievalProvider
    undefined, // strike
    /* [FEAT-20260828-PUSHCORE-A2] `LinePushDispatcher`. The fourteen direct reply
       sites moved onto the push core, so they no longer reach the `lineApi`
       double above — without this the recorded replies come back EMPTY and the
       cases read as "the bot said nothing". Records into the same arrays and
       mirrors the same bodies (`{}` for text, `{ sentMessages: [] }` for flex),
       because `response_summary` is copied verbatim into webhook_logs. */
    {
      dispatch: (req: { messages?: Array<Record<string, unknown>> }) => {
        const m = req.messages?.[0];
        if (m?.['type'] === 'flex') {
          // mirrors the `lineApi` double above exactly: step name + "[flex] alt"
          trace.steps.push('line.flex');
          trace.replies.push(
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
        trace.steps.push('line.reply');
        trace.replies.push(typeof m?.['text'] === 'string' ? m['text'] : '');
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
    const body = { destination: 'Ustatusoffquiet', events };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: '/statusoffquiet/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(body, hook, 'cache', 'statusoffquiet', meta);
  };

  return { trace, post };
}

function textEvent(text = 'สวัสดี'): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-t1',
    replyToken: 'rt-statusoffquiet-00000000000000t1',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'mt1', text },
  };
}

function imageEvent(): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-i1',
    replyToken: 'rt-statusoffquiet-00000000000000i1',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'image', id: 'mi1' },
  };
}

/** Hook fixtures — ON and OFF versions of the SAME configuration. */
const IMAGE_ANSWER_HOOK = { image_answer_text: IMAGE_ANSWER_RAW };
const REFUSAL_HOOK = {
  slip_check: true,
  slip_verify_key: 'swiftcheck-key',
  slip_require_profile: true,
  slip_require_profile_text: REFUSAL_RAW,
  image_answer_text: IMAGE_ANSWER_RAW,
};
const SLIP_ONLY_HOOK = {
  slip_check: true,
  slip_verify_key: 'swiftcheck-key',
  image_answer_text: IMAGE_ANSWER_RAW,
};

// ═══════════════════════════════════════════════════════════════════════════
// [PIN] — GREEN on BOTH trees. The ON flows must not move at all.
// ═══════════════════════════════════════════════════════════════════════════

describe('[STATUSOFFQUIET] pin — hook ON flows are untouched', () => {
  it('ON text: AI path runs (flow reaches generate)', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE });
    await h.post([textEvent()]);
    expect(h.trace.steps).toContain('ai.generate');
    expect(h.trace.chatRows).toContain('customer:text');
  });

  it('ON image + image_answer_text with [[[assist]]]: replies (marker stripped) AND opens the assist ticket', async () => {
    const h = buildHarness({
      hookOver: IMAGE_ANSWER_HOOK,
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });
    await h.post([imageEvent()]);
    expect(h.trace.replies.length).toBeGreaterThan(0);
    expect(h.trace.replies.join(' ')).not.toContain('[[[assist]]]');
    expect(h.trace.steps).toContain('ticket.create');
    expect(h.trace.chatRows.some((r) => r.startsWith('customer:'))).toBe(true);
  });

  it('ON slip refusal (unlinked + require-profile) with [[[assist]]]: refusal reply goes out AND opens the assist ticket, Swiftcheck not billed', async () => {
    const h = buildHarness({
      hookOver: REFUSAL_HOOK,
      profileData: UNLINKED_404_PROFILE,
      withImageStorage: true,
    });
    await h.post([imageEvent()]);
    // NOTE: marker stripping here is opt-in via `hook_text_reply_mode` — this
    // fixture leaves the default 'off', so the raw text (marker included) is
    // what goes out. Pinned as observed; that gate is not this change's scope.
    expect(h.trace.replies.join(' ')).toContain('ผูกบัญชีก่อนส่งสลิป');
    expect(h.trace.steps).toContain('ticket.create');
    // refusal sits ABOVE the paid call on purpose — that stays true
    expect(h.trace.slipVerifyCalls).toBe(0);
  });

  it('ON slip verify (linked customer): the Swiftcheck call happens', async () => {
    const h = buildHarness({
      hookOver: SLIP_ONLY_HOOK,
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });
    await h.post([imageEvent()]);
    expect(h.trace.slipVerifyCalls).toBe(1);
  });

  it('OFF text: silent but stored (already correct — must stay exactly so)', async () => {
    // `status_off_action: 'silent'` is what the live demo-shop hook runs with —
    // the legacy default (unset) still REPLIES the out-of-hours text instead.
    const h = buildHarness({
      hookOver: { status: 0, status_off_action: 'silent' },
      profileData: LINKED_PROFILE,
    });
    await h.post([textEvent()]);
    expect(h.trace.chatRows).toContain('customer:text');
    expect(h.trace.steps).not.toContain('line.reply');
    expect(h.trace.steps).not.toContain('ai.generate');
    expect(h.trace.steps).not.toContain('ticket.create');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [OFF] — the target: off ⇒ no image checks, no assist. RED pre-fix.
// ═══════════════════════════════════════════════════════════════════════════

describe('[STATUSOFFQUIET] off — images are stored, never processed', () => {
  it('OFF image + image_answer_text with [[[assist]]]: history + picture stored, NO reply, NO ticket', async () => {
    const h = buildHarness({
      hookOver: {
        ...IMAGE_ANSWER_HOOK,
        status: 0,
        status_off_action: 'silent',
      },
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });
    await h.post([imageEvent()]);
    // history keeps working — the picture and the row both land
    expect(h.trace.steps).toContain('image.download');
    expect(h.trace.chatRows.some((r) => r.startsWith('customer:'))).toBe(true);
    // …but nothing is said and nothing is opened
    expect(h.trace.replies).toEqual([]);
    expect(h.trace.steps).not.toContain('ticket.create');
    expect(h.trace.steps).not.toContain('room.claim');
  });

  it('OFF slip refusal fixture: NO refusal reply, NO ticket, NO Swiftcheck — row still stored', async () => {
    const h = buildHarness({
      hookOver: { ...REFUSAL_HOOK, status: 0, status_off_action: 'silent' },
      profileData: UNLINKED_404_PROFILE,
      withImageStorage: true,
    });
    await h.post([imageEvent()]);
    expect(h.trace.replies).toEqual([]);
    expect(h.trace.steps).not.toContain('ticket.create');
    expect(h.trace.slipVerifyCalls).toBe(0);
    expect(h.trace.chatRows.some((r) => r.startsWith('customer:'))).toBe(true);
  });

  /* [FIX-20260814-RATELIMITOFF] Owner, 14/08, after seeing a switched-off OA
   * answer "กรุณารอสักครู่และลองใหม่อีกครั้ง" three times in a row: "ถ้า hook off
   * limit ติดก็ไม่ต้องตอบ ย้ำว่าถ้า off".
   * The limiter block sits ABOVE every status gate (it was moved up by
   * [FIX-20260728-RATELIMIT] so images would be counted too), so it was the one
   * reply that still escaped while the OA was silent. */
  it('OFF + rate limited: counted but SILENT — no reply, no bot row', async () => {
    const h = buildHarness({
      hookOver: { status: 0, status_off_action: 'silent' },
      profileData: LINKED_PROFILE,
      rateLimited: true,
    });
    await h.post([textEvent()]);
    // the quota is still charged — off must not become a free spam window
    expect(h.trace.steps).toContain('ratelimit.consume');
    // …but nothing is said, and no bot bubble is written into the transcript
    expect(h.trace.replies).toEqual([]);
    expect(h.trace.chatRows.filter((r) => r.startsWith('bot:'))).toEqual([]);
  });

  it('PIN — ON + rate limited still answers, exactly as before', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE, rateLimited: true });
    await h.post([textEvent()]);
    expect(h.trace.steps).toContain('ratelimit.consume');
    expect(h.trace.replies).toEqual(['กรุณารอสักครู่และลองใหม่อีกครั้ง']);
    expect(h.trace.chatRows).toContain('bot:text');
  });

  it('OFF slip verify fixture (linked customer): Swiftcheck is NOT billed', async () => {
    const h = buildHarness({
      hookOver: { ...SLIP_ONLY_HOOK, status: 0, status_off_action: 'silent' },
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });
    await h.post([imageEvent()]);
    expect(h.trace.slipVerifyCalls).toBe(0);
    expect(h.trace.replies).toEqual([]);
    expect(h.trace.chatRows.some((r) => r.startsWith('customer:'))).toBe(true);
  });
});
