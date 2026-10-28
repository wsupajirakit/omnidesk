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
  type CallRecord,
  type ChatHistoryFakes,
  type ChatHistoryScenario,
} from '../lib/chat-history-fakes';

/**
 * Behaviour of the ported chat-history service, one documented rule per test.
 *
 * Every rule here is one whose loss would be invisible in normal traffic and
 * expensive later: the E11000 recovery only fires on rooms written before the
 * Member re-key, the channel_type hint only matters under reply-token latency,
 * and a duplicate provider id only arrives on a redelivery. Each is mutation
 * tested — see the report — so a test that would stay green with the behaviour
 * removed is not counted as covering it.
 */
describe('ChatHistoryService', () => {
  let fakes: ChatHistoryFakes;
  let service: ChatHistoryService;

  const MEMBER = { _id: 'member-1' };
  /* [FEAT-20260819-MSGEVENTUSER] a real room row always carries the LINE user id;
     the fixture now does too, because the published event forwards it. */
  const ROOM = { _id: 'room-1', line_user_id: 'U-room-1' };
  const HOOK_ID = 'hook-1';

  const build = async (scenario: ChatHistoryScenario): Promise<void> => {
    fakes = createChatHistoryFakes(scenario);
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
    service = moduleRef.get(ChatHistoryService);
  };

  /** Calls of one kind, in order. */
  const opsOf = (model: string, op: string): CallRecord[] =>
    fakes.calls.filter((c) => c.model === model && c.op === op);

  const duplicateKeyError = (): Error =>
    Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

  beforeAll(() => {
    // The service logs on every path by design; the output is not under test.
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('getOrCreateRoom', () => {
    it('resolves the Member before the room, and keys the room on (line_user_id, hook_id)', async () => {
      await build({ memberFindOne: MEMBER, roomUpsert: ROOM });

      const room = await service.getOrCreateRoom(
        'U1',
        {},
        'C1',
        HOOK_ID,
        'line',
      );

      expect(room).toBe(ROOM);
      // Order matters: the room's user_id comes from the Member.
      expect(fakes.calls.map((c) => `${c.model}.${c.op}`)).toEqual([
        'Member.findOne',
        'ChatRoom.findOneAndUpdate',
      ]);
      expect(opsOf('Member', 'findOne')[0]!.args[0]).toEqual({
        member_user_id: 'U1',
      });
      expect(opsOf('ChatRoom', 'findOneAndUpdate')[0]!.args[0]).toEqual({
        line_user_id: 'U1',
        hook_id: HOOK_ID,
      });
      expect(opsOf('ChatRoom', 'findOneAndUpdate')[0]!.args[1]).toEqual({
        $set: {
          user_id: 'member-1',
          line_user_id: 'U1',
          hook_id: HOOK_ID,
          channel_id: 'C1',
          channel_type: 'line',
        },
        $setOnInsert: { status: 'active', unread_count: 0 },
      });
      expect(opsOf('ChatRoom', 'findOneAndUpdate')[0]!.args[2]).toEqual({
        upsert: true,
        new: true,
        runValidators: true,
      });
    });

    it('creates a placeholder Member when the read-cutover lookup misses', async () => {
      await build({
        memberFindOne: null,
        memberUpsert: MEMBER,
        roomUpsert: ROOM,
      });

      await service.getOrCreateRoom(
        'U1',
        { displayName: 'Ann', pictureUrl: 'p.png' },
        null,
        HOOK_ID,
      );

      const upsert = opsOf('Member', 'findOneAndUpdate')[0]!;
      expect(upsert.args[0]).toEqual({ line_user_id: 'U1' });
      const setOnInsert = (
        upsert.args[1] as { $setOnInsert: Record<string, unknown> }
      ).$setOnInsert;
      expect(setOnInsert['line_user_id']).toBe('U1');
      expect(setOnInsert['display_name']).toBe('Ann');
      expect(setOnInsert['picture_url']).toBe('p.png');
      // nickname falls back to the display name, not to null.
      expect(setOnInsert['nickname']).toBe('Ann');
      expect(upsert.args[2]).toEqual({ upsert: true, new: true });
    });

    it('recovers from E11000 by re-resolving on (user_id, hook_id) and backfilling line_user_id', async () => {
      const recovered = { _id: 'room-legacy' };
      await build({
        memberFindOne: MEMBER,
        roomUpsert: duplicateKeyError(),
        roomRecovery: recovered,
      });

      const room = await service.getOrCreateRoom('U1', {}, null, HOOK_ID);

      expect(room).toBe(recovered);
      const attempts = opsOf('ChatRoom', 'findOneAndUpdate');
      expect(attempts).toHaveLength(2);
      // The recovery is keyed on the field the unique index actually uses.
      expect(attempts[1]!.args[0]).toEqual({
        user_id: 'member-1',
        hook_id: HOOK_ID,
      });
      // The same update object, so the row comes back whole — this is the
      // backfill: the legacy row had no line_user_id and now has one.
      expect(
        (attempts[1]!.args[1] as { $set: Record<string, unknown> }).$set[
          'line_user_id'
        ],
      ).toBe('U1');
      // Not an upsert: the row exists, and inserting is what just failed.
      expect(attempts[1]!.args[2]).toEqual({
        new: true,
        runValidators: true,
      });
    });

    it('rethrows the ORIGINAL E11000 when the recovery finds nothing', async () => {
      const original = duplicateKeyError();
      await build({
        memberFindOne: MEMBER,
        roomUpsert: original,
        roomRecovery: null,
      });

      await expect(
        service.getOrCreateRoom('U1', {}, null, HOOK_ID),
      ).rejects.toBe(original);
    });

    it('does not attempt recovery for an error that is not a duplicate key', async () => {
      const other = Object.assign(new Error('connection reset'), { code: 89 });
      await build({ memberFindOne: MEMBER, roomUpsert: other });

      await expect(
        service.getOrCreateRoom('U1', {}, null, HOOK_ID),
      ).rejects.toBe(other);
      expect(opsOf('ChatRoom', 'findOneAndUpdate')).toHaveLength(1);
    });
  });

  describe('channel_type resolution', () => {
    it('uses the caller hint and never touches the Hook collection', async () => {
      await build({
        memberFindOne: MEMBER,
        roomUpsert: ROOM,
        hookFindById: { channel_type: 'facebook' },
      });

      await service.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'telegram',
      });

      // The hint wins AND the lookup is skipped — this sits on the
      // reply-token-critical path.
      expect(opsOf('Hook', 'findById')).toHaveLength(0);
      const doc = opsOf('ChatMessage', 'constructor')[0]!.args[0] as Record<
        string,
        unknown
      >;
      expect(doc['channel_type']).toBe('telegram');
    });

    it('falls back to a Hook lookup when there is no hint', async () => {
      await build({
        memberFindOne: MEMBER,
        roomUpsert: ROOM,
        hookFindById: { channel_type: 'facebook' },
      });

      await service.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
      });

      expect(opsOf('Hook', 'findById')[0]!.args[0]).toBe(HOOK_ID);
      expect(opsOf('Hook', 'findById.select')[0]!.args[0]).toBe('channel_type');
      const doc = opsOf('ChatMessage', 'constructor')[0]!.args[0] as Record<
        string,
        unknown
      >;
      expect(doc['channel_type']).toBe('facebook');
    });

    it('defaults to "line" when the hook is missing, and skips the query with no hookId', async () => {
      await build({
        memberFindOne: MEMBER,
        roomUpsert: ROOM,
        hookFindById: null,
      });
      await service.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
      });
      expect(
        (
          opsOf('ChatMessage', 'constructor')[0]!.args[0] as Record<
            string,
            unknown
          >
        )['channel_type'],
      ).toBe('line');

      await build({ memberFindOne: MEMBER, roomUpsert: ROOM });
      await service.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
      });
      expect(opsOf('Hook', 'findById')).toHaveLength(0);
      expect(
        (
          opsOf('ChatMessage', 'constructor')[0]!.args[0] as Record<
            string,
            unknown
          >
        )['channel_type'],
      ).toBe('line');
    });
  });

  describe('duplicate suppression by provider_msg_id', () => {
    it('returns the EXISTING document and writes nothing', async () => {
      const existing = { _id: 'already-stored' };
      await build({
        memberFindOne: MEMBER,
        roomUpsert: ROOM,
        messageFindOne: existing,
      });

      const result = await service.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
        providerMsgId: 'PMSG-1',
      });

      expect(result).toBe(existing);
      expect(opsOf('ChatMessage', 'findOne')[0]!.args[0]).toEqual({
        provider_msg_id: 'PMSG-1',
      });
      // No second row, no preview churn, no duplicate bubble on the dashboard.
      expect(opsOf('ChatMessage', 'constructor')).toHaveLength(0);
      expect(opsOf('ChatMessage', 'save')).toHaveLength(0);
      expect(opsOf('ChatRoom', 'updateOne')).toHaveLength(0);
      expect(fakes.publishes).toHaveLength(0);
    });

    it('skips the duplicate query entirely when there is no provider id', async () => {
      await build({ memberFindOne: MEMBER, roomUpsert: ROOM });

      await service.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
      });

      expect(opsOf('ChatMessage', 'findOne')).toHaveLength(0);
      expect(opsOf('ChatMessage', 'save')).toHaveLength(1);
    });
  });

  describe('room metadata', () => {
    const metadataUpdate = async (senderType: string, content: unknown) => {
      await build({ memberFindOne: MEMBER, roomUpsert: ROOM });
      await service.logMessage({
        userId: 'U1',
        senderType,
        content,
        messageType: typeof content === 'string' ? 'text' : 'image',
        hookId: HOOK_ID,
        channelType: 'line',
      });
      return opsOf('ChatRoom', 'updateOne')[0]!;
    };

    it('increments unread_count for a customer message', async () => {
      const call = await metadataUpdate('customer', 'hello');
      expect(call.args[0]).toEqual({ _id: 'room-1' });
      const update = call.args[1] as Record<string, unknown>;
      expect(update['$set']).toEqual({
        'last_message.text': 'hello',
        'last_message.sender_type': 'customer',
        'last_message.timestamp': expect.any(Date),
      });
      expect(update['$inc']).toEqual({ unread_count: 1 });
    });

    it('does NOT increment unread_count for a bot message', async () => {
      const update = (await metadataUpdate('bot', 'hello')).args[1] as Record<
        string,
        unknown
      >;
      expect(update['$set']).toBeDefined();
      // An outbound reply must not make the room look unread to the admin who
      // just sent it.
      expect(update['$inc']).toBeUndefined();
    });

    it('does NOT increment unread_count for an admin message', async () => {
      const update = (await metadataUpdate('admin', 'hello')).args[1] as Record<
        string,
        unknown
      >;
      expect(update['$inc']).toBeUndefined();
    });

    it('previews a non-string body as [message_type]', async () => {
      const update = (
        await metadataUpdate('customer', { originalContentUrl: 'x' })
      ).args[1] as { $set: Record<string, unknown> };
      expect(update.$set['last_message.text']).toBe('[image]');
    });
  });

  describe('realtime fan-out', () => {
    it('publishes one message:new carrying the id, room, sender and a 120-char preview', async () => {
      await build({ memberFindOne: MEMBER, roomUpsert: ROOM });
      const long = 'x'.repeat(300);

      await service.logMessage({
        userId: 'U1',
        senderType: 'admin',
        senderId: 'admin-9',
        senderName: 'Ann',
        content: long,
        hookId: HOOK_ID,
        channelType: 'line',
      });

      expect(fakes.publishes).toHaveLength(1);
      const { type, data } = fakes.publishes[0]!;
      expect(type).toBe('message:new');
      expect(data['hook_id']).toBe(HOOK_ID);
      expect(data['room_id']).toBe('room-1');
      expect(data['sender_id']).toBe('admin-9');
      expect(data['sender_name']).toBe('Ann');
      expect(String(data['preview'])).toHaveLength(120);
      /* [FEAT-20260819-MSGEVENTUSER] the LINE user id rides along so a list that
         is keyed by CUSTOMER (the ticket cards) can attribute the event without a
         second lookup. `room_id` alone cannot do that: the ticket list returns
         neither `chat_room_id` nor `hook_id` at the top level, only
         `line_user_data.line_user_id` — checked against the live endpoint before
         this field was added. คีย์ที่การ์ดมีจริงคือ line_user_id เท่านั้น. */
      expect(data['line_user_id']).toBe('U-room-1');
    });

    it('does not publish when there is no hook to scope the event to', async () => {
      await build({ memberFindOne: MEMBER, roomUpsert: ROOM });

      await service.logMessage({
        userId: 'U1',
        senderType: 'customer',
        content: 'hi',
      });

      expect(fakes.publishes).toHaveLength(0);
    });

    it('copies an admin sender_name into metadata so it survives the user being deleted', async () => {
      await build({ memberFindOne: MEMBER, roomUpsert: ROOM });

      await service.logMessage({
        userId: 'U1',
        senderType: 'admin',
        senderName: 'Ann',
        content: 'hi',
        hookId: HOOK_ID,
        channelType: 'line',
        metadata: { source: 'panel' },
      });

      const doc = opsOf('ChatMessage', 'constructor')[0]!.args[0] as Record<
        string,
        unknown
      >;
      expect(doc['metadata']).toEqual({
        source: 'panel',
        sender_name: 'Ann',
      });
    });
  });

  describe('logMessage failure handling', () => {
    it('returns null without a userId and touches nothing', async () => {
      await build({});
      await expect(
        service.logMessage({ senderType: 'customer', content: 'hi' }),
      ).resolves.toBeNull();
      expect(fakes.calls).toHaveLength(0);
    });

    it('swallows a save failure — a history write must not fail the reply', async () => {
      await build({
        memberFindOne: MEMBER,
        roomUpsert: ROOM,
        messageSaveError: new Error('write concern failed'),
      });

      await expect(
        service.logMessage({
          userId: 'U1',
          senderType: 'customer',
          content: 'hi',
          hookId: HOOK_ID,
          channelType: 'line',
        }),
      ).resolves.toBeNull();
      expect(opsOf('ChatRoom', 'updateOne')).toHaveLength(0);
    });
  });

  describe('logSystemMessage', () => {
    it('never creates a room, never touches last_message, never bumps unread_count', async () => {
      await build({ roomFindOne: { _id: 'room-1', channel_type: 'facebook' } });

      const message = await service.logSystemMessage({
        lineUserId: 'U1',
        hookId: HOOK_ID,
        messageType: 'divider',
        content: 'ปิดเคส',
        metadata: { variant: 'close' },
      });

      expect(message).not.toBeNull();
      // Read-only room resolution: findOne, never findOneAndUpdate.
      expect(opsOf('ChatRoom', 'findOneAndUpdate')).toHaveLength(0);
      expect(opsOf('ChatRoom', 'updateOne')).toHaveLength(0);
      expect(opsOf('Member', 'findOne')).toHaveLength(0);
      expect(fakes.publishes).toHaveLength(0);

      expect(opsOf('ChatRoom', 'findOne')[0]!.args[0]).toEqual({
        $or: [{ line_user_id: 'U1' }, { channel_user_id: 'U1' }],
        hook_id: HOOK_ID,
      });
      const doc = opsOf('ChatMessage', 'constructor')[0]!.args[0] as Record<
        string,
        unknown
      >;
      // Reuses the existing sender_type enum; message_type is the real
      // discriminator, and channel_type is inherited from the room.
      expect(doc['sender_type']).toBe('admin');
      expect(doc['message_type']).toBe('divider');
      expect(doc['channel_type']).toBe('facebook');
      expect(doc['metadata']).toEqual({ variant: 'close' });
    });

    it('accepts a Member _id instead of a platform id', async () => {
      await build({ roomFindOne: { _id: 'room-1' } });

      await service.logSystemMessage({
        memberId: 'member-1',
        hookId: HOOK_ID,
        messageType: 'inline_note',
        content: 'note',
      });

      expect(opsOf('ChatRoom', 'findOne')[0]!.args[0]).toEqual({
        $or: [{ user_id: 'member-1' }],
        hook_id: HOOK_ID,
      });
    });

    it('returns null when no room exists — a system line never spawns one', async () => {
      await build({ roomFindOne: null });

      await expect(
        service.logSystemMessage({
          lineUserId: 'U1',
          hookId: HOOK_ID,
          messageType: 'divider',
          content: 'x',
        }),
      ).resolves.toBeNull();
      expect(opsOf('ChatMessage', 'save')).toHaveLength(0);
    });

    it.each([
      ['no identifier', { hookId: 'hook-1' }],
      ['no hookId', { lineUserId: 'U1' }],
      ['no content', { lineUserId: 'U1', hookId: 'hook-1' }],
    ])('returns null and queries nothing: %s', async (_name, partial) => {
      await build({});
      const result = await service.logSystemMessage({
        messageType: 'divider',
        content: '',
        ...partial,
      } as Parameters<ChatHistoryService['logSystemMessage']>[0]);
      expect(result).toBeNull();
      expect(fakes.calls).toHaveLength(0);
    });
  });
});
