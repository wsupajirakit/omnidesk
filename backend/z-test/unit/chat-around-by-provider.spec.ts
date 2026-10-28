/**
 * [FEAT-20260821-QUOTEJUMP] `getMessagesAround` can anchor on LINE's message id.
 * A quote block names what it quoted in LINE's id-space; when that message is
 * outside the loaded window, this is the one read that turns the LINE id into a
 * window the console can scroll. Default mode is untouched — pinned first.
 */
import { Types } from 'mongoose';

import { ChatService, PushOnlySendStrategy } from '@/modules/chat';

const roomId = new Types.ObjectId();
const hookId = new Types.ObjectId();
const targetId = new Types.ObjectId();
const SUPER = {
  userId: 'a0d00000000000000000000a',
  roleName: 'superadmin',
} as never;

function build() {
  const findOneQueries: Record<string, unknown>[] = [];
  const chain = (rows: unknown[]) => {
    const c = {
      select: () => c,
      sort: () => c,
      limit: () => c,
      populate: () => c,
      lean: () => Promise.resolve(rows),
    };
    return c;
  };
  const chatMessageModel = {
    findOne: jest.fn((q: Record<string, unknown>) => {
      findOneQueries.push(q);
      const hit =
        ('provider_msg_id' in q && q['provider_msg_id'] === '625') ||
        ('_id' in q && String(q['_id']) === String(targetId));
      const c = {
        select: () => c,
        lean: () =>
          Promise.resolve(
            hit
              ? { _id: targetId, created_at: new Date('2026-08-21T10:00:00Z') }
              : null,
          ),
      };
      return c;
    }),
    find: jest.fn(() => chain([])),
  };
  const svc = new ChatService(
    {
      findOne: jest.fn().mockResolvedValue({
        _id: roomId,
        hook_id: hookId,
        line_user_id: 'Uabc',
      }),
      findById: jest.fn().mockResolvedValue({
        _id: roomId,
        hook_id: hookId,
        line_user_id: 'Uabc',
      }),
    } as never,
    chatMessageModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { findById: jest.fn().mockResolvedValue({ _id: hookId }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    new PushOnlySendStrategy({ dispatch: jest.fn() } as never),
  );
  return { svc, findOneQueries };
}

describe('getMessagesAround — anchor modes', () => {
  it('default: anchors on our _id, rejects a non-ObjectId (unchanged)', async () => {
    const h = build();
    await expect(
      h.svc.getMessagesAround(String(roomId), 'not-an-id', undefined, SUPER),
    ).rejects.toMatchObject({ status: 400 });
    const out = await h.svc.getMessagesAround(
      String(roomId),
      String(targetId),
      undefined,
      SUPER,
    );
    expect(h.findOneQueries.pop()).toEqual({
      _id: String(targetId),
      room_id: roomId,
    });
    expect(out['anchor_id']).toBe(String(targetId));
  });

  it("by='provider': anchors on provider_msg_id in the same room, and anchor_id is still OUR _id", async () => {
    const h = build();
    const out = await h.svc.getMessagesAround(
      String(roomId),
      '625',
      undefined,
      SUPER,
      'provider',
    );
    expect(h.findOneQueries.pop()).toEqual({
      provider_msg_id: '625',
      room_id: roomId,
    });
    expect(out['anchor_id']).toBe(String(targetId)); // the FE scrolls to msg-<_id>
  });

  it("by='provider' with an unknown LINE id → 404, not a crash", async () => {
    const h = build();
    await expect(
      h.svc.getMessagesAround(
        String(roomId),
        '999',
        undefined,
        SUPER,
        'provider',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
