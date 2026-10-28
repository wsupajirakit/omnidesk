/**
 * [FEAT-20260820-OPENBYSYSTEM] a case a rule opened — and one an admin did
 * ===========================================================================
 * Owner: "สร้างเคสเฉย ๆ ไม่ได้อยากให้มีคนรับเคส" · "ข ห้ามตีกับ admin ticket".
 *
 * The two paths share one door, so the risk is that they blur into each other:
 * a system case that looks assigned, or an admin case that quietly changes shape
 * because the door was edited. Both halves are pinned here — a mutation that
 * gave the system case an owner, and one that made it `job_status: 1`, both
 * survived the rest of the suite until this file existed.
 */
import {
  SYSTEM_CASE_CHAT_STATUS,
  SYSTEM_CASE_DIRECT_TICKET,
  SYSTEM_CASE_JOB_STATUS,
  openTicketBySystem,
  openTicketFromRoom,
} from '@/modules/tickets/create-by-admin';

const ROOM_ID = 'a0d000000000000000000073';
const MEMBER = 'a0d00000000000000000004e';
const HOOK = 'a0d00000000000000000004f';
const ADMIN = 'a0d000000000000000000074';

const makeDeps = (over: { room?: unknown } = {}) => {
  const created: Record<string, unknown>[] = [];
  const history: Record<string, unknown>[] = [];
  const room =
    'room' in over
      ? over.room
      : { _id: ROOM_ID, user_id: MEMBER, hook_id: HOOK };
  return {
    created,
    history,
    deps: {
      ticketModel: {
        create: (doc: Record<string, unknown>) => {
          created.push(doc);
          return Promise.resolve({ ...doc, _id: 't1' });
        },
      },
      chatRoomModel: {
        findById: () => ({ lean: () => Promise.resolve(room) }),
        findOneAndUpdate: () => ({ lean: () => Promise.resolve(room) }),
        updateOne: () => ({ exec: () => Promise.resolve({}) }),
      },
      chatMessageModel: {
        create: () => Promise.resolve({ _id: 'd1' }),
        findOne: () => ({
          sort: () => ({ lean: () => Promise.resolve(null) }),
        }),
      },
      assignHistoryModel: {
        create: (doc: Record<string, unknown>) => {
          history.push(doc);
          return Promise.resolve(doc);
        },
      },
      warn: jest.fn(),
    } as never,
  };
};

const SYSTEM_INPUT = {
  roomId: ROOM_ID,
  category: 'Other',
  needDetail: 'ลูกค้าต้องการลงทะเบียน',
  dividerContent: 'เคสนี้สร้างโดยระบบ ลูกค้าต้องการลงทะเบียน',
};

describe('a case the SYSTEM opened', () => {
  it('⭐ belongs to nobody and waits in the queue', async () => {
    const { deps, created } = makeDeps();
    await openTicketBySystem(SYSTEM_INPUT, deps);
    const t = created[0]!;
    expect(t['job_status']).toBe(SYSTEM_CASE_JOB_STATUS);
    expect(SYSTEM_CASE_JOB_STATUS).toBe(0); // waiting, not taken
    expect(t['admin_user_id']).toBeNull();
    expect(t['assigned_at']).toBeUndefined();
    expect(t['chat_status']).toBe(SYSTEM_CASE_CHAT_STATUS);
  });

  it('is marked as opened by a rule, with the reason on it', async () => {
    const { deps, created } = makeDeps();
    await openTicketBySystem(SYSTEM_INPUT, deps);
    const t = created[0]!;
    expect(t['direct_ticket']).toBe(SYSTEM_CASE_DIRECT_TICKET);
    expect(t['direct_ticket_detail']).toBe(SYSTEM_INPUT.needDetail);
  });

  it('carries the caller’s words — nothing is decided in here', async () => {
    const { deps, created } = makeDeps();
    await openTicketBySystem(SYSTEM_INPUT, deps);
    const t = created[0]!;
    expect(t['need_detail']).toBe(SYSTEM_INPUT.needDetail);
    expect(t['category']).toBe(SYSTEM_INPUT.category);
    expect(t['hook_id']).toBe(HOOK);
    expect(t['chat_user_id']).toBe(MEMBER);
  });

  it('records an UNASSIGNED history row — no invented user', async () => {
    const { deps, history } = makeDeps();
    await openTicketBySystem(SYSTEM_INPUT, deps);
    const h = history[0]!;
    expect(h['assign_to']).toBeNull();
    expect(h['changed_by_id']).toBeNull();
    expect(h['chat_room_id']).toBe(ROOM_ID);
  });

  it('a room already in a case is refused — the duplicate guard, for free', async () => {
    const { deps } = makeDeps();
    const models = deps as unknown as {
      chatRoomModel: { findOneAndUpdate: () => unknown };
    };
    models.chatRoomModel.findOneAndUpdate = () => ({
      lean: () => Promise.resolve(null),
    });
    await expect(openTicketBySystem(SYSTEM_INPUT, deps)).rejects.toThrow(
      /มีเคสเปิดอยู่แล้ว/,
    );
  });

  it('an unknown room is refused before anything is written', async () => {
    const { deps, created } = makeDeps({ room: null });
    await expect(openTicketBySystem(SYSTEM_INPUT, deps)).rejects.toThrow();
    expect(created).toHaveLength(0);
  });
});

describe('a case an ADMIN opened — unchanged by any of this', () => {
  const auth = { userId: ADMIN, username: 'somchai', displayName: 'สมชาย' };

  it('⭐ is taken by that admin, exactly as before', async () => {
    const { deps, created } = makeDeps();
    await openTicketFromRoom(
      { roomId: ROOM_ID, auth, category: 'Other', needDetail: 'x' },
      deps,
    );
    const t = created[0]!;
    expect(t['job_status']).toBe(1);
    expect(t['chat_status']).toBe('admin');
    expect(String(t['admin_user_id'])).toBe(ADMIN);
    expect(t['assigned_at']).toBeInstanceOf(Date);
  });

  it('is NOT marked as opened by a rule', async () => {
    const { deps, created } = makeDeps();
    await openTicketFromRoom({ roomId: ROOM_ID, auth }, deps);
    const t = created[0]!;
    expect(t['direct_ticket']).toBeUndefined();
    expect(t['direct_ticket_detail']).toBeUndefined();
  });

  it('still records who took it', async () => {
    const { deps, history } = makeDeps();
    await openTicketFromRoom({ roomId: ROOM_ID, auth }, deps);
    const h = history[0]!;
    expect(String(h['assign_to'])).toBe(ADMIN);
    expect(String(h['changed_by_id'])).toBe(ADMIN);
  });

  it('the two cases can always be told apart', async () => {
    const a = makeDeps();
    await openTicketFromRoom({ roomId: ROOM_ID, auth }, a.deps);
    const b = makeDeps();
    await openTicketBySystem(SYSTEM_INPUT, b.deps);
    expect(a.created[0]!['job_status']).not.toBe(b.created[0]!['job_status']);
    expect(a.created[0]!['admin_user_id']).not.toBe(
      b.created[0]!['admin_user_id'],
    );
    expect(a.created[0]!['direct_ticket']).not.toBe(
      b.created[0]!['direct_ticket'],
    );
  });
});
