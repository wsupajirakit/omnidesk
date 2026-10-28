/**
 * [FEAT-20260819-OPENFROMROOM] "เปิดเคส" for a conversation that NEVER had one.
 *
 * Deliberately not a reopen: the bot-care tab now also lists rooms with no ticket
 * at all, and opening a case for one of those has no earlier ticket to resurrect.
 * The owner asked for the name to say so.
 *
 * What is pinned here (models are jest fns — write shapes asserted, no DB):
 *   · the ROOM decides member + hook (`user_id` is the MEMBER _id, not the LINE id)
 *   · the SAME atomic claim as the reopen path guards duplicates and mutes the bot,
 *     and losing it creates NOTHING
 *   · the admin's category is stored; omitting it stores 'Other' — the value the
 *     collection actually holds for uncategorised cases
 *   · an empty need_detail becomes a stated default, never a blank row
 *   · the divider variant and the history action are `open_by_admin`, distinct
 *     from `reopen_by_admin`, so reports can tell first-case from reopened
 *   · a missing / malformed room is 404, a room without member or hook is 409
 */
import { Types } from 'mongoose';

import { openTicketFromRoom } from '@/modules/tickets';

const memberId = new Types.ObjectId();
const hookId = new Types.ObjectId();
const roomId = new Types.ObjectId();
const adminId = new Types.ObjectId();

const AUTH = {
  userId: String(adminId),
  username: 'op1',
  displayName: 'Operator One',
};

describe('[FEAT-20260819-OPENFROMROOM] openTicketFromRoom', () => {
  let ticketModel: { findById: jest.Mock; create: jest.Mock };
  let chatRoomModel: {
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findOne: jest.Mock;
  };
  let chatMessageModel: { create: jest.Mock };
  let assignHistoryModel: { create: jest.Mock };
  let warn: jest.Mock;
  let deps: Record<string, unknown>;

  const roomDoc = () => ({ _id: roomId, user_id: memberId, hook_id: hookId });

  beforeEach(() => {
    ticketModel = {
      findById: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((doc: Record<string, unknown>) =>
          Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
        ),
    };
    chatRoomModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(roomDoc()),
      }),
      findOneAndUpdate: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue({ _id: roomId, channel_type: 'line' }),
      }),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest
          .fn()
          .mockResolvedValue({ _id: roomId, channel_type: 'line' }),
      }),
    };
    chatMessageModel = { create: jest.fn().mockResolvedValue({}) };
    assignHistoryModel = { create: jest.fn().mockResolvedValue({}) };
    warn = jest.fn();
    deps = {
      ticketModel,
      chatRoomModel,
      chatMessageModel,
      assignHistoryModel,
      warn,
    };
  });

  const run = (over: Record<string, unknown> = {}) =>
    openTicketFromRoom(
      { roomId: String(roomId), auth: AUTH, ...over },
      deps as never,
    );

  it('the ROOM decides the customer and the OA, and the claim matches the member id', async () => {
    const out = await run({ category: 'Payment', needDetail: 'ลูกค้าถามยอด' });

    const [filter, update] = chatRoomModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      user_id: memberId,
      hook_id: hookId,
      assist_status: { $ne: true },
    });
    expect(update.$set.assist_status).toBe(true);
    expect(out.roomId).toBe(String(roomId));
  });

  it('stores the category the admin picked, and the need they typed', async () => {
    await run({ category: 'Payment', needDetail: 'ลูกค้าถามยอด' });
    const doc = ticketModel.create.mock.calls[0][0];
    expect(doc).toMatchObject({
      hook_id: hookId,
      chat_user_id: memberId,
      job_status: 1,
      chat_status: 'admin',
      category: 'Payment',
      need_detail: 'ลูกค้าถามยอด',
    });
  });

  it('omitted category falls back to the value the collection really uses', async () => {
    await run({});
    expect(ticketModel.create.mock.calls[0][0].category).toBe('Other');
  });

  it('a blank need becomes the stated default, never an empty row', async () => {
    await run({ needDetail: '   ' });
    expect(ticketModel.create.mock.calls[0][0].need_detail).toBe(
      'เปิดเคสโดยแอดมิน',
    );
  });

  it('the divider and the history say open_by_admin — not reopen', async () => {
    await run({});
    const divider = chatMessageModel.create.mock.calls[0][0];
    expect(divider.metadata.variant).toBe('open_by_admin');
    expect(String(divider.content)).toContain('เปิดเคส โดย');

    const history = assignHistoryModel.create.mock.calls[0][0];
    expect(history.action).toBe('open_by_admin');
    expect(String(history.detail)).toContain(String(roomId));
  });

  it('losing the claim creates NOTHING and refuses', async () => {
    chatRoomModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(run({})).rejects.toThrow();
    expect(ticketModel.create).not.toHaveBeenCalled();
    expect(chatMessageModel.create).not.toHaveBeenCalled();
    expect(assignHistoryModel.create).not.toHaveBeenCalled();
  });

  it('a room that does not exist is a 404, and nothing is claimed', async () => {
    chatRoomModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(run({})).rejects.toThrow('Chat room not found');
    expect(chatRoomModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('a malformed room id never reaches the database', async () => {
    await expect(run({ roomId: 'not-an-id' })).rejects.toThrow(
      'Chat room not found',
    );
    expect(chatRoomModel.findById).not.toHaveBeenCalled();
  });

  it('a room missing its member or OA is refused rather than half-opened', async () => {
    chatRoomModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: roomId, hook_id: hookId }),
    });
    await expect(run({})).rejects.toThrow();
    expect(ticketModel.create).not.toHaveBeenCalled();
  });

  it('a history failure does not undo the case the admin already owns', async () => {
    assignHistoryModel.create.mockRejectedValue(new Error('boom'));
    const out = await run({});
    expect(out.ticket).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });
});
