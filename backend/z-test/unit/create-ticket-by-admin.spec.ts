/**
 * [FEAT-20260817-REOPENBYADMIN] "เปิดเคสอีกครั้ง" — the admin reopens a CLOSED
 * case as a NEW ticket. The old ticket stays closed (history); the helper does
 * claim → create → divider → history in one block, and the atomic claim on
 * `chat_rooms (user_id, hook_id)` is BOTH the duplicate guard and the bot mute
 * (assist_status=true) in a single command.
 *
 * Pinned here, in isolation (models are jest fns — the real write shapes are
 * asserted, no network/DB):
 *   · losing the claim (findOneAndUpdate → null) creates NOTHING — no ticket,
 *     no divider, no history — and throws 409
 *   · a non-closed source ticket throws 409 BEFORE the claim runs
 *   · a missing ticket throws 404
 *   · the winning path creates the ticket with the verified field template
 *     (new names hook_id/chat_user_id — pre('save') dual-writes the legacy
 *     ones), writes the divider variant `reopen_by_admin` with the actor
 *     content, writes the assign_histories row with action `reopen_by_admin`,
 *     and returns the room id so the FE can dispatch tc:assist-changed
 *   · a history write failure does NOT undo the reopen (warn + continue — the
 *     admin already owns the case; killing the request would strand them)
 */
import { Types } from 'mongoose';

import { createTicketByAdmin } from '@/modules/tickets';
import { TicketsService } from '@/modules/tickets/tickets.service';

const oldTicketId = new Types.ObjectId();
const memberId = new Types.ObjectId();
const hookId = new Types.ObjectId();
const roomId = new Types.ObjectId();
const adminId = new Types.ObjectId();

const AUTH = {
  userId: String(adminId),
  username: 'op1',
  displayName: 'Operator One',
};

describe('[FEAT-20260817-REOPENBYADMIN] createTicketByAdmin', () => {
  let ticketModel: {
    findById: jest.Mock;
    create: jest.Mock;
  };
  let chatRoomModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock };
  let chatMessageModel: { create: jest.Mock };
  let assignHistoryModel: { create: jest.Mock };
  let warn: jest.Mock;
  let deps: Record<string, unknown>;

  const closedTicket = () => ({
    _id: oldTicketId,
    job_status: 2,
    chat_user_id: memberId,
    hook_id: hookId,
    category: 'Payment',
    need_detail: 'สลิปมีปัญหา',
  });

  beforeEach(() => {
    ticketModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(closedTicket()),
      }),
      create: jest
        .fn()
        .mockImplementation((doc: Record<string, unknown>) =>
          Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
        ),
    };
    chatRoomModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue({ _id: roomId, channel_type: 'line' }),
      }),
      // writeTicketDivider resolves the room itself
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

  const run = () =>
    createTicketByAdmin(
      { ticketId: String(oldTicketId), auth: AUTH },
      deps as never,
    );

  it('winning path → claim, ticket, divider, history, and the room id back', async () => {
    const out = await run();

    // 1) the atomic claim IS the duplicate guard + bot mute in one command
    const [filter, update] = chatRoomModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      user_id: memberId,
      hook_id: hookId,
      assist_status: { $ne: true },
    });
    expect(update.$set.assist_status).toBe(true);
    expect(update.$set.last_assist_changed_at).toBeInstanceOf(Date);

    // 2) the new ticket uses the VERIFIED template (new field names only —
    //    pre('save') mirrors the legacy ones)
    const doc = ticketModel.create.mock.calls[0][0];
    expect(doc).toMatchObject({
      hook_id: hookId,
      chat_user_id: memberId,
      job_status: 1,
      chat_status: 'admin',
      category: 'Payment',
      need_detail: 'สลิปมีปัญหา',
    });
    expect(String(doc.admin_user_id)).toBe(String(adminId));
    expect(doc.assigned_at).toBeInstanceOf(Date);

    // 3) divider — its own variant (report-countable) with the actor content
    const divider = chatMessageModel.create.mock.calls[0][0];
    expect(divider).toMatchObject({
      message_type: 'divider',
      room_id: roomId,
    });
    expect(divider.metadata.variant).toBe('reopen_by_admin');
    expect(divider.content).toBe('เปิดเคส โดย op1 (Operator One)');

    // 4) history row — countable apart from 'accept'
    const hist = assignHistoryModel.create.mock.calls[0][0];
    expect(hist).toMatchObject({
      chat_room_id: roomId,
      action: 'reopen_by_admin',
    });
    expect(String(hist.assign_to)).toBe(String(adminId));
    expect(String(hist.changed_by_id)).toBe(String(adminId));
    expect(hist.ticket_id).toBeDefined();

    // 5) the FE needs the room id for tc:assist-changed
    expect(out.roomId).toBe(String(roomId));
    expect(out.ticket).toBeDefined();
  });

  it('losing the atomic claim → 409 and creates NOTHING', async () => {
    chatRoomModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(run()).rejects.toMatchObject({ status: 409 });
    expect(ticketModel.create).not.toHaveBeenCalled();
    expect(chatMessageModel.create).not.toHaveBeenCalled();
    expect(assignHistoryModel.create).not.toHaveBeenCalled();
  });

  it('source ticket not closed → 409 BEFORE the claim ever runs', async () => {
    ticketModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...closedTicket(), job_status: 1 }),
    });
    await expect(run()).rejects.toMatchObject({ status: 409 });
    expect(chatRoomModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ticketModel.create).not.toHaveBeenCalled();
  });

  it('source ticket missing → 404', async () => {
    ticketModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(run()).rejects.toMatchObject({ status: 404 });
  });

  it('legacy-named source ticket (line_user_id / line_oa_hook_id) still resolves', async () => {
    ticketModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: oldTicketId,
        job_status: 2,
        line_user_id: memberId,
        line_oa_hook_id: hookId,
        category: 'Other',
      }),
    });
    await run();
    expect(chatRoomModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      user_id: memberId,
      hook_id: hookId,
    });
  });

  it('a history write failure warns but does NOT undo the reopen', async () => {
    assignHistoryModel.create.mockRejectedValue(new Error('mongo down'));
    const out = await run();
    expect(out.ticket).toBeDefined();
    expect(warn).toHaveBeenCalled();
  });
});

/**
 * Service layer — the publish half lives in TicketsService (the private
 * publishScopedTicketEvent). Pinned: the event NAME is `ticket:reopened`
 * (NOT ticket:new — that would light the waiting tab and chime everyone),
 * hook_id goes out as a STRING (the publisher drops non-scoped payloads),
 * and the response carries room_id for the FE's tc:assist-changed dispatch.
 */
describe('[FEAT-20260817-REOPENBYADMIN] TicketsService.reopenTicketByAdmin publish', () => {
  it('publishes ticket:reopened with a string hook_id and returns room_id', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const svc = Object.create(TicketsService.prototype) as Record<string, any>;
    svc.ticketModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: oldTicketId,
          job_status: 2,
          chat_user_id: memberId,
          hook_id: hookId,
          category: 'Payment',
        }),
      }),
      create: jest
        .fn()
        .mockImplementation((doc: Record<string, unknown>) =>
          Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
        ),
    };
    svc.chatRoomModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: roomId }),
      }),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest
          .fn()
          .mockResolvedValue({ _id: roomId, channel_type: 'line' }),
      }),
    };
    svc.chatMessageModel = { create: jest.fn().mockResolvedValue({}) };
    svc.assignHistoryModel = { create: jest.fn().mockResolvedValue({}) };
    svc.realtimePublisher = { publish };
    svc.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };

    const out = await svc.reopenTicketByAdmin(String(oldTicketId), {
      userId: String(adminId),
      username: 'op1',
      displayName: 'Operator One',
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const [type, payload] = publish.mock.calls[0];
    expect(type).toBe('ticket:reopened');
    expect(typeof payload.hook_id).toBe('string');
    expect(payload.job_status).toBe(1);
    expect(payload.admin_user_id).toBe(String(adminId));
    expect(out.room_id).toBe(String(roomId));
    expect(out.success).toBe(true);
  });

  it('a broken token payload (no userId) → 403 before anything runs', async () => {
    const svc = Object.create(TicketsService.prototype) as Record<string, any>;
    svc.ticketModel = { findById: jest.fn() };
    await expect(
      svc.reopenTicketByAdmin(String(oldTicketId), undefined),
    ).rejects.toMatchObject({ status: 403 });
    expect(svc.ticketModel.findById).not.toHaveBeenCalled();
  });
});

/**
 * [FIX-20260817-REOPENDIVIDER] the divider row was written but never announced —
 * the open transcript only picked it up when the NEXT message arrived (owner saw
 * the divider appear only after typing). The reopen must publish message:new for
 * the divider row it just wrote, exactly like every other bubble writer does.
 */
describe('[FIX-20260817-REOPENDIVIDER] the divider is announced live', () => {
  it('publishes message:new for the divider row (id from the write, room from the claim)', async () => {
    const dividerId = new Types.ObjectId();
    const publish = jest.fn().mockResolvedValue(undefined);
    const svc = Object.create(TicketsService.prototype) as Record<string, any>;
    svc.ticketModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: oldTicketId,
          job_status: 2,
          chat_user_id: memberId,
          hook_id: hookId,
          category: 'Other',
        }),
      }),
      create: jest
        .fn()
        .mockImplementation((doc: Record<string, unknown>) =>
          Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
        ),
    };
    svc.chatRoomModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: roomId }),
      }),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest
          .fn()
          .mockResolvedValue({ _id: roomId, channel_type: 'line' }),
      }),
    };
    svc.chatMessageModel = {
      create: jest.fn().mockResolvedValue({ _id: dividerId }),
    };
    svc.assignHistoryModel = { create: jest.fn().mockResolvedValue({}) };
    svc.realtimePublisher = { publish };
    svc.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };

    await svc.reopenTicketByAdmin(String(oldTicketId), {
      userId: String(adminId),
      username: 'op1',
      displayName: 'Operator One',
    });

    const msgCalls = publish.mock.calls.filter((c) => c[0] === 'message:new');
    expect(msgCalls).toHaveLength(1);
    expect(msgCalls[0][1]).toMatchObject({
      hook_id: String(hookId),
      room_id: String(roomId),
      message_id: String(dividerId),
    });
  });
});
