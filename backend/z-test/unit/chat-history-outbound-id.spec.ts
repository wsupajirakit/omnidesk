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
 * [FEAT-20260831-QUOTESRC] The bot's own row may now carry LINE's message id —
 * and carrying it must not cost a read.
 * ===========================================================================
 * The de-dup lookup in `logMessage` exists for ONE thing: LINE redelivering an
 * inbound webhook. It fires whenever a provider id is passed, and until this
 * lane no outbound caller ever passed one (checked: every site that does is
 * `senderType: 'customer'`). Now that the reply paths pass the id LINE returned,
 * an unnarrowed guard would add a query to every bot message on the
 * reply-token-critical path — for a collision that cannot happen, because the id
 * was minted by LINE seconds earlier for this very message.
 *
 * ขาออกไม่ใช่ redelivery ⇒ ห้ามยิง findOne เพิ่ม.
 */
describe('logMessage — an outbound row records the id without paying for a read', () => {
  let fakes: ChatHistoryFakes;
  let service: ChatHistoryService;

  const MEMBER = { _id: 'member-1' };
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

  const opsOf = (model: string, op: string): CallRecord[] =>
    fakes.calls.filter((c) => c.model === model && c.op === op);

  beforeAll(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  it('⭐ a bot row with a provider id issues NO de-dup read', async () => {
    await build({ memberFindOne: MEMBER, roomUpsert: ROOM });

    await service.logMessage({
      userId: 'U1',
      senderType: 'bot',
      content: 'รับทราบค่ะ',
      hookId: HOOK_ID,
      channelType: 'line',
      providerMsgId: '628874250056892966',
      quoteToken: 'qt-abc',
    });

    expect(opsOf('ChatMessage', 'findOne')).toHaveLength(0);
  });

  it('stores what LINE returned on that row — id in its column, token in its own', async () => {
    await build({ memberFindOne: MEMBER, roomUpsert: ROOM });

    await service.logMessage({
      userId: 'U1',
      senderType: 'bot',
      content: 'รับทราบค่ะ',
      hookId: HOOK_ID,
      channelType: 'line',
      providerMsgId: '628874250056892966',
      quoteToken: 'qt-abc',
    });

    const saved = opsOf('ChatMessage', 'constructor')[0]!.args[0] as Record<
      string,
      unknown
    >;
    expect(saved['provider_msg_id']).toBe('628874250056892966');
    expect(saved['quote_token']).toBe('qt-abc');
    expect(saved['sender_type']).toBe('bot');
  });

  it('⭐ the inbound guard is untouched — a customer row still checks for a redelivery', async () => {
    await build({ memberFindOne: MEMBER, roomUpsert: ROOM });

    await service.logMessage({
      userId: 'U1',
      senderType: 'customer',
      content: 'hi',
      hookId: HOOK_ID,
      channelType: 'line',
      providerMsgId: 'PM-IN',
    });

    expect(opsOf('ChatMessage', 'findOne')).toHaveLength(1);
    expect(opsOf('ChatMessage', 'findOne')[0]!.args[0]).toEqual({
      provider_msg_id: 'PM-IN',
    });
  });

  it('an outbound row without an id is byte-identical to today — no id, no read', async () => {
    await build({ memberFindOne: MEMBER, roomUpsert: ROOM });

    await service.logMessage({
      userId: 'U1',
      senderType: 'bot',
      content: 'plain',
      hookId: HOOK_ID,
      channelType: 'line',
    });

    expect(opsOf('ChatMessage', 'findOne')).toHaveLength(0);
    const saved = opsOf('ChatMessage', 'constructor')[0]!.args[0] as Record<
      string,
      unknown
    >;
    expect(saved['provider_msg_id']).toBeNull();
    expect('quote_token' in saved).toBe(false);
  });
});
