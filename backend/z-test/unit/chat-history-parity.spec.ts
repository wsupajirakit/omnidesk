import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';
import {
  ChatHistoryService,
  ChatMessage,
  ChatRoom,
  Member,
} from '@/modules/chat';
import { Hook } from '@/modules/hooks';

import {
  createChatHistoryFakes,
  type ChatHistoryFakes,
  type ChatHistoryScenario,
} from '../lib/chat-history-fakes';

/**
 * DIFFERENTIAL test: the ported service against the legacy JavaScript it was
 * ported from, driven through the SAME fake models on identical inputs.
 *
 * WHY THIS AND NOT ONLY A TABLE OF EXPECTATIONS
 * An expectation table records what I believed the legacy code does. This runs
 * it. For a write path that matters more than usual: the service's behaviour is
 * *the sequence of things it asks the database to do*, and several of those —
 * which query key the E11000 recovery uses, whether `$inc` is present, whether
 * the duplicate branch skips the room update as well as the insert — are easy
 * to describe correctly in prose and get subtly wrong in code.
 *
 * HOW IT RUNS WITHOUT A DATABASE
 * `chatHistoryService.js` reaches the outside world through exactly five
 * modules: four Mongoose models and the realtime publisher. All five are
 * replaced (`jest.doMock`) with the same scripted fakes the port is given, so
 * neither side opens a socket. Nothing here connects to Mongo, Redis, or any
 * network host.
 *
 * WHAT IS COMPARED
 * For every case: the ordered list of model calls with their arguments, the
 * realtime events that would reach Redis, and the returned value (or the thrown
 * error). A difference in any of the three fails.
 *
 * The suite SKIPS rather than fails when the legacy checkout is not beside this
 * one, so it never turns red for a reason unrelated to the code under test.
 */
const LEGACY_SRC = resolve(__dirname, '../../../legacy-api/src');
const LEGACY_SERVICE = `${LEGACY_SRC}/services/core-bot/chatHistoryService.js`;
const legacyAvailable = existsSync(LEGACY_SERVICE);

/**
 * The fakes the mocked legacy modules currently delegate to.
 *
 * Legacy captures its models at module load and is exported as a singleton, so
 * the mocks cannot be swapped per case — they forward to this holder instead,
 * which is repointed before each run. Named `mock*` so Jest's factory-scope
 * rule is satisfied whatever hoisting the transform applies.
 */
let mockCurrent: ChatHistoryFakes;

type LooseFn = (...args: unknown[]) => unknown;
const delegate =
  (pick: (fakes: ChatHistoryFakes) => unknown, method: string): LooseFn =>
  (...args: unknown[]) =>
    ((pick(mockCurrent) as Record<string, LooseFn>)[method] as LooseFn).apply(
      pick(mockCurrent),
      args,
    );

if (legacyAvailable) {
  jest.doMock(`${LEGACY_SRC}/models/chat/lineUserModel`, () => ({
    findOne: delegate((f) => f.Member, 'findOne'),
    findOneAndUpdate: delegate((f) => f.Member, 'findOneAndUpdate'),
  }));
  jest.doMock(`${LEGACY_SRC}/models/chat/chatRoomModel`, () => ({
    findOne: delegate((f) => f.ChatRoom, 'findOne'),
    findOneAndUpdate: delegate((f) => f.ChatRoom, 'findOneAndUpdate'),
    updateOne: delegate((f) => f.ChatRoom, 'updateOne'),
  }));
  jest.doMock(`${LEGACY_SRC}/models/chat/chatMessageModel`, () => {
    // Legacy builds messages with `new ChatMessage(doc)`, so the mock has to be
    // constructible. Returning an object from a constructor replaces `this`.
    function MockChatMessage(this: unknown, doc: Record<string, unknown>) {
      const Ctor = mockCurrent.ChatMessage as new (
        d: Record<string, unknown>,
      ) => unknown;
      return new Ctor(doc);
    }
    (MockChatMessage as unknown as Record<string, unknown>)['findOne'] =
      delegate((f) => f.ChatMessage, 'findOne');
    return MockChatMessage;
  });
  jest.doMock(`${LEGACY_SRC}/models/hook/lineChatBotModel`, () => ({
    findById: delegate((f) => f.Hook, 'findById'),
  }));
  // Replaced so the legacy Redis client is never loaded, let alone connected.
  jest.doMock(`${LEGACY_SRC}/services/infra/wsPublisher`, () => ({
    publishMessageEvent: (...args: unknown[]) =>
      (mockCurrent.publishMessageEvent as LooseFn)(...args),
  }));
}

/** The shape both implementations expose, to the extent this test drives it. */
interface ChatHistoryLike {
  getOrCreateRoom(
    userId: string,
    profile?: Record<string, unknown>,
    channelId?: string | null,
    hookId?: string | null,
    channelType?: string,
  ): Promise<unknown>;
  logMessage(input: Record<string, unknown>): Promise<unknown>;
  logSystemMessage(input: Record<string, unknown>): Promise<unknown>;
}

/**
 * `new Date()` is called on both sides at different instants, so a raw compare
 * would fail on the clock rather than on behaviour. Every Date collapses to one
 * marker; a field that is a Date on one side and absent on the other still
 * differs, which is the property that matters.
 */
function normalise(value: unknown): unknown {
  if (value instanceof Date) return '<Date>';
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalise(source[key]);
    }
    return out;
  }
  return value;
}

interface Observation {
  calls: unknown;
  publishes: unknown;
  result: unknown;
  thrown: string | null;
}

/**
 * [FEAT-20260819-MSGEVENTUSER] ONE deliberate, owner-approved divergence.
 *
 * The port's `message:new` carries `line_user_id`; legacy's does not. It was
 * added because the ticket list is keyed by CUSTOMER — it returns neither
 * `chat_room_id` nor a top-level `hook_id`, only `line_user_data.line_user_id` —
 * so without it the dashboard cannot tell which card an incoming message belongs
 * to. Legacy has no such consumer, so it will never grow the field.
 *
 * The key is dropped from BOTH observations rather than the assertion being
 * loosened: every other field of every other event still has to match legacy
 * exactly, so this hides one known difference and nothing else. Its presence and
 * value are pinned separately in `chat-history.spec.ts` ('publishes one
 * message:new carrying the id, room, sender and a 120-char preview'), which is
 * where a regression on the field itself would surface.
 *
 * ต่างจาก legacy จุดเดียว ตั้งใจ · ตัดออกเฉพาะ key นี้ ที่เหลือยังต้องตรงเป๊ะ.
 * revert: delete this function and its call site, then delete the field.
 */
/**
 * [FEAT-20260820-BOTCAREQUIET] the SECOND deliberate divergence, same shape.
 *
 * The port's `message:new` also carries `bot_care` — "this row belongs to the
 * บอทดูแล tab" — because the dashboard's chime fires app-wide from one websocket
 * subscription that holds the event and nothing else: no ticket list, no room, no
 * tab. Owner: "กลุ่มบอทดูแล ไม่ต้องมีเสียง". Legacy has no chime and no such tab,
 * so it will never grow the field either.
 *
 * Dropped from both observations for the same reason as the key above — every
 * other field still has to match legacy exactly. The value itself is pinned in
 * `bot-care-flag.spec.ts`, which is where a regression on the RULE surfaces, and
 * the wiring is pinned in `chat-history.spec.ts`.
 *
 * revert: remove the key here and in `chat-history.service.ts`.
 */
const PORT_ONLY_EVENT_KEYS = ['line_user_id', 'bot_care'] as const;

function withoutPortOnlyEventKeys(publishes: unknown): unknown {
  if (!Array.isArray(publishes)) return publishes;
  return publishes.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const copy = { ...(entry as Record<string, unknown>) };
    const data = copy['data'];
    if (data && typeof data === 'object') {
      const payload = { ...(data as Record<string, unknown>) };
      for (const key of PORT_ONLY_EVENT_KEYS) delete payload[key];
      copy['data'] = payload;
    }
    for (const key of PORT_ONLY_EVENT_KEYS) delete copy[key];
    return copy;
  });
}

async function observe(
  service: ChatHistoryLike,
  fakes: ChatHistoryFakes,
  drive: (service: ChatHistoryLike) => Promise<unknown>,
): Promise<Observation> {
  let result: unknown = null;
  let thrown: string | null = null;
  try {
    result = await drive(service);
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  return {
    calls: normalise(fakes.calls),
    publishes: withoutPortOnlyEventKeys(normalise(fakes.publishes)),
    result: normalise(result),
    thrown,
  };
}

interface ParityCase {
  name: string;
  scenario: ChatHistoryScenario;
  drive: (service: ChatHistoryLike) => Promise<unknown>;
}

const MEMBER = { _id: 'member-1' };
const ROOM = { _id: 'room-1' };
const HOOK_ID = 'hook-1';
const duplicateKeyError = (): Error =>
  Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

const CASES: ParityCase[] = [
  {
    name: 'customer message with a channel_type hint',
    scenario: { memberFindOne: MEMBER, roomUpsert: ROOM },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        messageType: 'text',
        content: 'สวัสดีครับ',
        hookId: HOOK_ID,
        channelId: 'C1',
        channelType: 'line',
        providerMsgId: 'PM-1',
        replyToken: 'RT-1',
      }),
  },
  {
    name: 'customer message with NO hint — the Hook lookup path',
    scenario: {
      memberFindOne: MEMBER,
      roomUpsert: ROOM,
      hookFindById: { channel_type: 'facebook' },
    },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
      }),
  },
  {
    name: 'no hint and the hook does not exist',
    scenario: { memberFindOne: MEMBER, roomUpsert: ROOM, hookFindById: null },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
      }),
  },
  {
    name: 'bot message — no unread bump',
    scenario: { memberFindOne: MEMBER, roomUpsert: ROOM },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'bot',
        content: 'ตอบกลับ',
        hookId: HOOK_ID,
        channelType: 'line',
      }),
  },
  {
    name: 'admin message with sender id, name and metadata',
    scenario: { memberFindOne: MEMBER, roomUpsert: ROOM },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'admin',
        senderId: 'admin-9',
        senderName: 'Ann',
        content: 'ครับผม',
        hookId: HOOK_ID,
        channelType: 'line',
        metadata: { source: 'panel' },
      }),
  },
  {
    name: 'duplicate provider_msg_id returns the existing row',
    scenario: {
      memberFindOne: MEMBER,
      roomUpsert: ROOM,
      messageFindOne: { _id: 'already-stored', content: 'hi' },
    },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
        providerMsgId: 'PM-DUP',
      }),
  },
  {
    name: 'E11000 on the room upsert, recovery succeeds',
    scenario: {
      memberFindOne: MEMBER,
      roomUpsert: duplicateKeyError(),
      roomRecovery: { _id: 'room-legacy' },
    },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
      }),
  },
  {
    name: 'E11000 on the room upsert, recovery finds nothing',
    scenario: {
      memberFindOne: MEMBER,
      roomUpsert: duplicateKeyError(),
      roomRecovery: null,
    },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
      }),
  },
  {
    name: 'E11000 straight through getOrCreateRoom — the error escapes',
    scenario: {
      memberFindOne: MEMBER,
      roomUpsert: duplicateKeyError(),
      roomRecovery: null,
    },
    drive: (s) => s.getOrCreateRoom('U1', {}, null, HOOK_ID, 'line'),
  },
  {
    name: 'a non-duplicate error is not recovered from',
    scenario: {
      memberFindOne: MEMBER,
      roomUpsert: Object.assign(new Error('connection reset'), { code: 89 }),
    },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
      }),
  },
  {
    name: 'the Member read-cutover misses and a placeholder is created',
    scenario: {
      memberFindOne: null,
      memberUpsert: MEMBER,
      roomUpsert: ROOM,
    },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
        profile: { displayName: 'Ann', pictureUrl: 'p.png' },
      }),
  },
  {
    // [FIX-20260814-EAGERPROFILE] This case used to drive `{}` (empty profile)
    // and pin legacy's 'Unknown' + last_synced_at placeholder stamps. That
    // branch now DELIBERATELY diverges from legacy: since eager room-on-event
    // (13/08) the placeholder is written BEFORE the LINE profile sync of the
    // same request, and legacy's stamps satisfied the sync's needsRefresh
    // guard — every first-contact customer stayed "Unknown". The port now
    // seeds ids only on an empty hint (owner-approved; new behaviour pinned in
    // room-bootstrap-profile-sync.spec.ts). Parity coverage for the nickname
    // fallback chain (`nickname || displayName || 'Unknown'`) stays here via a
    // REAL hint, where port and legacy still agree field-for-field.
    name: 'placeholder with a profile hint — the nickname falls back to displayName',
    scenario: { memberFindOne: null, memberUpsert: MEMBER, roomUpsert: ROOM },
    drive: (s) =>
      s.getOrCreateRoom(
        'U1',
        { displayName: 'Ann', pictureUrl: 'p.png' },
        'C1',
        HOOK_ID,
        'line',
      ),
  },
  {
    name: 'non-string content previews as [message_type]',
    scenario: { memberFindOne: MEMBER, roomUpsert: ROOM },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        messageType: 'image',
        content: { originalContentUrl: 'https://x/y.jpg' },
        hookId: HOOK_ID,
        channelType: 'line',
        rawContent: { id: '1' },
        internalContentId: 'img-1',
      }),
  },
  {
    name: 'a 300-character body is truncated in the preview only',
    scenario: { memberFindOne: MEMBER, roomUpsert: ROOM },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'x'.repeat(300),
        hookId: HOOK_ID,
        channelType: 'line',
      }),
  },
  {
    name: 'no hookId — nothing is published',
    scenario: { memberFindOne: MEMBER, roomUpsert: ROOM },
    drive: (s) =>
      s.logMessage({ userId: 'U1', senderType: 'customer', content: 'hi' }),
  },
  {
    name: 'no userId — nothing happens at all',
    scenario: {},
    drive: (s) => s.logMessage({ senderType: 'customer', content: 'hi' }),
  },
  {
    name: 'the room update reports nothing modified',
    scenario: {
      memberFindOne: MEMBER,
      roomUpsert: ROOM,
      roomUpdateResult: { modifiedCount: 0 },
    },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
      }),
  },
  {
    name: 'the message save fails',
    scenario: {
      memberFindOne: MEMBER,
      roomUpsert: ROOM,
      messageSaveError: new Error('write concern failed'),
    },
    drive: (s) =>
      s.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
      }),
  },
  {
    name: 'system divider resolved by platform id',
    scenario: { roomFindOne: { _id: 'room-1', channel_type: 'facebook' } },
    drive: (s) =>
      s.logSystemMessage({
        lineUserId: 'U1',
        hookId: HOOK_ID,
        messageType: 'divider',
        content: 'รับเคสแล้ว',
        metadata: { variant: 'accept', actor_name: 'Ann' },
      }),
  },
  {
    name: 'system note resolved by Member _id',
    scenario: { roomFindOne: { _id: 'room-1' } },
    drive: (s) =>
      s.logSystemMessage({
        memberId: 'member-1',
        hookId: HOOK_ID,
        messageType: 'inline_note',
        content: 'โน้ตภายใน',
      }),
  },
  {
    name: 'system message with BOTH identifiers',
    scenario: { roomFindOne: { _id: 'room-1', channel_type: 'line' } },
    drive: (s) =>
      s.logSystemMessage({
        lineUserId: 'U1',
        memberId: 'member-1',
        hookId: HOOK_ID,
        messageType: 'divider',
        content: 'ปิดเคส',
      }),
  },
  {
    name: 'system message with no room to attach to',
    scenario: { roomFindOne: null },
    drive: (s) =>
      s.logSystemMessage({
        lineUserId: 'U1',
        hookId: HOOK_ID,
        messageType: 'divider',
        content: 'x',
      }),
  },
  {
    name: 'system message with no identifier',
    scenario: {},
    drive: (s) =>
      s.logSystemMessage({
        hookId: HOOK_ID,
        messageType: 'divider',
        content: 'x',
      }),
  },
  {
    name: 'system message with no hookId',
    scenario: {},
    drive: (s) =>
      s.logSystemMessage({
        lineUserId: 'U1',
        messageType: 'divider',
        content: 'x',
      }),
  },
  {
    name: 'system message with no content',
    scenario: {},
    drive: (s) =>
      s.logSystemMessage({
        lineUserId: 'U1',
        hookId: HOOK_ID,
        messageType: 'divider',
        content: '',
      }),
  },
];

const describeIfLegacy = legacyAvailable ? describe : describe.skip;

describeIfLegacy('chat history — parity with the legacy service', () => {
  let legacy: ChatHistoryLike;

  const buildPort = async (
    fakes: ChatHistoryFakes,
  ): Promise<ChatHistoryLike> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatHistoryService,
        { provide: getModelToken(ChatRoom.name), useValue: fakes.ChatRoom },
        {
          provide: getModelToken(ChatMessage.name),
          useValue: fakes.ChatMessage,
        },
        { provide: getModelToken(Member.name), useValue: fakes.Member },
        { provide: getModelToken(Hook.name), useValue: fakes.Hook },
        { provide: RealtimePublisherService, useValue: fakes.publisher },
      ],
    }).compile();
    // No cast: the port satisfies `ChatHistoryLike` structurally, which is
    // itself part of the parity claim — the two expose the same call shape.
    return moduleRef.get(ChatHistoryService);
  };

  beforeAll(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(console, level).mockImplementation(() => undefined);
    }
    // Required only after the mocks above are registered.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    legacy = require(LEGACY_SERVICE) as ChatHistoryLike;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  /** case name → how many model calls the port made. */
  const observedCalls = new Map<string, number>();

  it.each(CASES.map((c) => [c.name, c] as const))(
    'legacy === port — %s',
    async (_name, testCase) => {
      const legacyFakes = createChatHistoryFakes(testCase.scenario);
      mockCurrent = legacyFakes;
      const legacyObserved = await observe(legacy, legacyFakes, testCase.drive);

      const portFakes = createChatHistoryFakes(testCase.scenario);
      const portObserved = await observe(
        await buildPort(portFakes),
        portFakes,
        testCase.drive,
      );

      expect(portObserved).toEqual(legacyObserved);
      observedCalls.set(testCase.name, portFakes.calls.length);
    },
  );

  /**
   * Guards against a harness that compares nothing: two empty call logs are
   * equal, so every case above would pass if the fakes were never reached.
   *
   * The four listed cases return on a guard before touching a model — that is
   * exactly what they assert — so they are the only ones allowed to be empty.
   */
  it('every case reached the models, except the four guard cases', () => {
    expect(observedCalls.size).toBe(CASES.length);

    const guardOnly = new Set([
      'no userId — nothing happens at all',
      'system message with no identifier',
      'system message with no hookId',
      'system message with no content',
    ]);
    for (const [name, count] of observedCalls) {
      if (guardOnly.has(name)) {
        expect({ name, count }).toEqual({ name, count: 0 });
      } else {
        expect({ name, reached: count > 0 }).toEqual({ name, reached: true });
      }
    }
  });
});
