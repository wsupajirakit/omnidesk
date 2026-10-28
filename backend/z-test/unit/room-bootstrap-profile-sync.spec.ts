import { createHmac } from 'node:crypto';

import {
  AssistSummaryUnavailableError,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';
import { ChatHistoryService } from '@/modules/chat';

/**
 * ==== [FIX-20260814-EAGERPROFILE] eager-room vs LINE profile sync ====
 *
 * Full-flow proof of the bug the eager-room feature (13/08) introduced, and
 * the fix's safety envelope. Unlike room-bootstrap-before-pack.spec.ts (which
 * fakes chatHistory whole), this file wires the REAL ChatHistoryService and
 * the REAL WebhookService onto ONE shared stateful member store that emulates
 * Mongo upsert semantics + the schema mirror hooks (member.schema.ts:125-140),
 * because the bug lives in the INTERPLAY:
 *
 *   eager getOrCreateRoom({}) inserts a placeholder Member whose
 *   display_name:'Unknown' (truthy) + last_synced_at:now satisfy the
 *   needsRefresh guard (webhook.service.ts:1332-1335) — so the real LINE
 *   getProfile sync a few hundred lines later NEVER RUNS, and the customer
 *   stays "Unknown" (nickname: forever — :1351 only seeds a falsy nickname).
 *
 * RED-FIRST: the [BUG] tests below FAIL on the pre-fix tree (verified before
 * the fix landed); the [PIN] tests pass on BOTH trees — they freeze the flows
 * that must not move (existing members, fresh/stale refresh, hinted seeding).
 * เทสชุด BUG ต้องแดงบนโค้ดก่อนแก้ · ชุด PIN ต้องเขียวทั้งก่อนและหลัง.
 *
 * revert: delete this file. No prod import.
 */

const CHANNEL_SECRET = 'eagerprofile-secret';
const HOOK_ID = 'a0d000000000000000000054';
const USER_ID = 'Ueagerprofile00000000000000000001';

const REAL_PROFILE = {
  displayName: 'Real Name',
  pictureUrl: 'https://pic.example/p.jpg',
  statusMessage: 'hi',
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

type Row = Record<string, unknown>;
type Update = { $set?: Row; $setOnInsert?: Row };

/**
 * In-memory `members` collection with the semantics the real one has:
 *  - upsert-insert merges filter-eq fields + $setOnInsert + $set;
 *  - schema defaults ('' strings, null last_synced_at) apply on insert
 *    (Mongoose 9 setDefaultsOnInsert default);
 *  - line_user_id <-> member_user_id mirrored on every write, as the
 *    mirrorPair/mirrorUpdatePair schema hooks do on the real model.
 * Every write's update doc is recorded so tests can assert the exact seed shape.
 */
function makeMemberDb(seed: Row[] = []) {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  const writes: Update[] = [];

  const find1 = (q: Row): Row | null =>
    rows.find((r) => Object.entries(q).every(([k, v]) => r[k] === v)) ?? null;

  const mirror = (d: Row): void => {
    if (d['line_user_id'] !== undefined && d['member_user_id'] === undefined) {
      d['member_user_id'] = d['line_user_id'];
    } else if (
      d['member_user_id'] !== undefined &&
      d['line_user_id'] === undefined
    ) {
      d['line_user_id'] = d['member_user_id'];
    }
  };

  const defaults = (): Row => ({
    display_name: '',
    picture_url: '',
    status_message: '',
    nickname: '',
    last_synced_at: null,
    phone_number: '',
    contract_code: '',
    full_name: '',
  });

  const upsert = (filter: Row, update: Update): Row => {
    writes.push(JSON.parse(JSON.stringify(update)) as Update);
    const existing = find1(filter);
    if (existing) {
      const set = { ...(update.$set ?? {}) };
      mirror(set);
      Object.assign(existing, set);
      return existing;
    }
    const doc: Row = {
      _id: `mem-${rows.length + 1}`,
      ...defaults(),
      ...filter,
      ...(update.$setOnInsert ?? {}),
      ...(update.$set ?? {}),
    };
    mirror(doc);
    rows.push(doc);
    return doc;
  };

  const model = {
    findOne: (q: Row) => query(find1(q)),
    find: () => query([]),
    findById: () => query(null),
    countDocuments: () => query(0),
    findOneAndUpdate: (q: Row, u: Update) => query(upsert(q, u)),
    updateOne: (q: Row, u: Update) => {
      upsert(q, u);
      return query({ acknowledged: true });
    },
  };

  return { rows, writes, model, find1 };
}

interface Opts {
  seedMembers?: Row[];
  lineProfile?: typeof REAL_PROFILE | null;
}

function buildHarness(opts: Opts = {}) {
  const hook: Row = {
    _id: HOOK_ID,
    alias: 'eagerprofile',
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'eagerprofile-dead-token',
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
  };

  const members = makeMemberDb(opts.seedMembers ?? []);
  const steps: string[] = [];

  const hookModel = {
    findOne: () => query(hook),
    findById: () => query(hook),
  };
  const chatRoomModel = {
    findOne: () => query(null),
    findOneAndUpdate: () => {
      steps.push('room.upsert');
      return query({ _id: 'room-1' });
    },
    updateOne: () => query({ acknowledged: true }),
  };
  const chatMessageModel = {
    findOne: () => query(null),
    find: () => query([]),
    create: (d: Row) =>
      Promise.resolve({ ...d, _id: 'msg-1', room_id: 'room-1' }),
    updateOne: () => query({ acknowledged: true }),
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

  // ⭐ REAL ChatHistoryService on the SAME member store the webhook sync uses.
  const chatHistory = new ChatHistoryService(
    chatRoomModel as never,
    chatMessageModel as never,
    members.model as never,
    hookModel as never,
    { publish: () => Promise.resolve() } as never,
  );

  const lineApi = {
    sendLineReplyMessage: () => Promise.resolve({ status: 200, data: {} }),
    sendLineFlexReply: () =>
      Promise.resolve({ status: 200, data: { sentMessages: [] } }),
    sendLineLoadingIndicator: () => Promise.resolve({ status: 200, data: {} }),
    sendLinePushMessage: () => Promise.resolve({ status: 200, data: {} }),
    sendLinePushFlexMessage: () => Promise.resolve({ status: 200, data: {} }),
    getLineProfile: () => {
      steps.push('line.profile');
      return Promise.resolve(
        opts.lineProfile === undefined ? REAL_PROFILE : opts.lineProfile,
      );
    },
  };

  const service = new WebhookService(
    hookModel as never,
    chatRoomModel as never,
    chatMessageModel as never,
    members.model as never,
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
    chatHistory, // ⭐ real service, not a fake
    lineApi as never,
    {
      downloadAndSaveImage: () => Promise.resolve(null),
      downloadAndSaveVideo: () => Promise.resolve(null),
    } as never,
    { createLog: () => Promise.resolve() } as never,
    { getCombinedData: () => Promise.resolve({}) } as never,
    {
      getToolForHook: () => Promise.resolve(null),
      getCombinedData: () => Promise.resolve({}),
      extractProfile: () => null,
    } as never,
    { consume: () => Promise.resolve({ limited: false }) } as never,
    {
      getClient: () => {
        throw new Error('no redis in unit test');
      },
    } as never,
    {
      generate: () =>
        Promise.resolve({ text: 'ok', noData: false, tagStatus: null }),
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
  );

  const post = async (events: unknown[]): Promise<void> => {
    const body = { destination: 'Ueagerprofile', events };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: '/eagerprofile/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(body, hook, 'cache', 'eagerprofile', meta);
  };

  return { members, steps, post, chatHistory };
}

function textEvent(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-1',
    replyToken: 'rt-eagerprofile-000000000000000001',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'm1', text: 'สวัสดี' },
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// [BUG] — RED on the pre-fix tree. The fix makes them green.
// ═══════════════════════════════════════════════════════════════════════════

describe('[FIX-20260814-EAGERPROFILE] first-contact profile sync (bug set)', () => {
  it('BRAND-NEW customer: LINE getProfile IS called and the member gets the real name, picture and nickname in the SAME request', async () => {
    const h = buildHarness(); // empty member store = true first contact
    await h.post([textEvent()]);

    // The sync must fire — pre-fix the eager placeholder suppressed it.
    expect(h.steps).toContain('line.profile');

    const m = h.members.find1({ member_user_id: USER_ID });
    expect(m).not.toBeNull();
    expect(m!['display_name']).toBe('Real Name');
    expect(m!['picture_url']).toBe('https://pic.example/p.jpg');
    // nickname seeded from the first REAL profile — never the 'Unknown' stamp.
    expect(m!['nickname']).toBe('Real Name');
    // mirror pair intact (unique-index safety).
    expect(m!['line_user_id']).toBe(USER_ID);
  });

  it('eager room still comes FIRST: placeholder write precedes the profile fetch (EAGERROOM ordering preserved)', async () => {
    const h = buildHarness();
    await h.post([textEvent()]);
    // First member write = the eager placeholder insert; profile fetch follows
    // within the same request. Pre-fix the fetch never happened at all.
    expect(h.members.writes.length).toBeGreaterThan(0);
    expect(h.steps.indexOf('room.upsert')).toBeGreaterThanOrEqual(0);
    expect(h.steps).toContain('line.profile');
  });

  it('placeholder write shape: an empty profile hint seeds IDs only — no display_name, no nickname, no last_synced_at', async () => {
    const h = buildHarness();
    await h.chatHistory.getOrCreateRoom(USER_ID, {}, null, HOOK_ID, 'line');
    const placeholder = h.members.writes[0]!;
    expect(placeholder).toBeDefined();
    const soi = placeholder.$setOnInsert ?? {};
    expect(soi['line_user_id']).toBe(USER_ID);
    // The three fields that made the placeholder impersonate a synced profile
    // (and thereby switch the needsRefresh guard off) must be absent.
    expect(soi).not.toHaveProperty('display_name');
    expect(soi).not.toHaveProperty('nickname');
    expect(soi).not.toHaveProperty('last_synced_at');
  });

  it('LINE fetch fails on first contact: member stays a visible placeholder (empty fields, null last_synced_at) and the NEXT event retries', async () => {
    const h = buildHarness({ lineProfile: null });
    await h.post([textEvent()]);
    const m = h.members.find1({ member_user_id: USER_ID });
    expect(m).not.toBeNull();
    // Not stamped 'Unknown' + now — the doc says truthfully "never synced",
    // so the guard retries on the next event instead of sleeping an hour.
    expect(m!['display_name']).toBe('');
    expect(m!['last_synced_at']).toBeNull();
    const firstCalls = h.steps.filter((s) => s === 'line.profile').length;
    expect(firstCalls).toBeGreaterThanOrEqual(1);

    await h.post([
      textEvent({
        eventId: 'ev-2',
        message: { type: 'text', id: 'm2', text: 'อีกครั้ง' },
      }),
    ]);
    const totalCalls = h.steps.filter((s) => s === 'line.profile').length;
    expect(totalCalls).toBeGreaterThan(firstCalls);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [PIN] — GREEN on BOTH trees. Existing customers' flow must not move.
// ═══════════════════════════════════════════════════════════════════════════

describe('[FIX-20260814-EAGERPROFILE] untouched flows (pin set)', () => {
  const freshMember = (): Row => ({
    _id: 'mem-old',
    line_user_id: USER_ID,
    member_user_id: USER_ID,
    display_name: 'ลูกค้าเดิม',
    picture_url: 'https://pic.example/old.jpg',
    nickname: 'ชื่อเล่นจากแอดมิน',
    last_synced_at: new Date(),
  });

  it('EXISTING member, freshly synced: getProfile NOT called, doc byte-identical', async () => {
    const h = buildHarness({ seedMembers: [freshMember()] });
    const before = JSON.parse(JSON.stringify(h.members.rows[0])) as Row;
    await h.post([textEvent()]);
    expect(h.steps).not.toContain('line.profile');
    expect(JSON.parse(JSON.stringify(h.members.rows[0]))).toEqual(before);
  });

  it('EXISTING member, stale (>1h): getProfile called once, name/picture refreshed, operator nickname PRESERVED', async () => {
    const stale = freshMember();
    stale['last_synced_at'] = new Date(Date.now() - 2 * 3600_000);
    const h = buildHarness({ seedMembers: [stale] });
    await h.post([textEvent()]);
    expect(h.steps.filter((s) => s === 'line.profile')).toHaveLength(1);
    const m = h.members.rows[0]!;
    expect(m['display_name']).toBe('Real Name');
    expect(m['picture_url']).toBe('https://pic.example/p.jpg');
    // The nickname belongs to the operator once set — refresh must not touch it.
    expect(m['nickname']).toBe('ชื่อเล่นจากแอดมิน');
  });

  it('a REAL profile hint still seeds the member exactly as before (FB / non-empty-hint path unchanged)', async () => {
    const h = buildHarness();
    await h.chatHistory.getOrCreateRoom(
      USER_ID,
      { displayName: 'FB Name', pictureUrl: 'https://pic.example/fb.jpg' },
      null,
      HOOK_ID,
      'line',
    );
    const soi = h.members.writes[0]?.$setOnInsert ?? {};
    expect(soi['display_name']).toBe('FB Name');
    expect(soi['nickname']).toBe('FB Name');
    expect(soi['picture_url']).toBe('https://pic.example/fb.jpg');
    expect(soi['last_synced_at']).toBeDefined();
  });
});
