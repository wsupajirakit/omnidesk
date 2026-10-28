/**
 * [FIX-20260909-SENDFIRST + FIX-20260909-SENDREASON] What a REFUSED send must
 * leave behind, and what it must say.
 * ===========================================================================
 * Two failures reported together on 09/09, both on the admin send path and both
 * older than the translate feature that happened to surface them:
 *
 *   1. LINE refused (a 429 on an OA whose monthly quota was spent) and the
 *      endpoint answered `500 {"error":"internal error"}`. The reason had
 *      already been built — `extractLineReason` turns the axios error into
 *      "HTTP 429 - You have reached your monthly limit" — and was then thrown
 *      away by being wrapped in a bare `Error`, which the global filter is
 *      right to flatten. The operator saw "ส่งข้อความไม่สำเร็จ" and nothing else.
 *
 *   2. The `chat_messages` row was written BEFORE the send, so a refusal left a
 *      bubble in the thread that the customer never received — indistinguishable
 *      from a delivered one. Owner: *"ถ้าส่งสำเร็จ ค่อยเซฟ chat message สิ"*.
 *
 * 🔴 THE TWO ARE ONE STORY: the request failed, so nothing may claim it
 *    succeeded — not the row, and not the message the operator reads.
 *
 * ⚠️ The failed CALL is still recorded. `deliverOutbound` writes a
 *    `webhook_logs` row on both outcomes, which is where a refused LINE call
 *    belongs; `chat_messages` is what the room said. Asserted below, so
 *    "nothing is saved" can never quietly become "nothing is known".
 */
import { Types } from 'mongoose';

import { ChatService, PushOnlySendStrategy } from '@/modules/chat';

const roomId = new Types.ObjectId();
const hookId = new Types.ObjectId();
const ourId = new Types.ObjectId();
const SUPER = {
  userId: 'a0d00000000000000000000a',
  username: 'op1',
  displayName: 'Operator One',
  roleName: 'superadmin',
} as never;

/** an axios-shaped LINE refusal — the exact thing `extractLineReason` reads */
const lineRefusal = (status: number, message: string) => ({
  ok: false as const,
  status,
  raw: {
    response: {
      status,
      data: { message },
      headers: { 'x-line-request-id': 'req-1' },
    },
  },
});

function build(outcome: Record<string, unknown> = { ok: true, status: 200 }) {
  const logs: Record<string, unknown>[] = [];
  const core = {
    dispatch: jest.fn(() =>
      Promise.resolve({ attempts: 1, durationMs: 1, data: {}, ...outcome }),
    ),
  };
  const chatMessageModel = {
    create: jest.fn((doc: Record<string, unknown>) => {
      const row: Record<string, unknown> = { _id: ourId, ...doc };
      row['set'] = (patch: Record<string, unknown>) =>
        Object.assign(row, patch);
      return Promise.resolve(row);
    }),
    findOne: jest.fn(() => {
      const chain = {
        sort: () => chain,
        select: () => chain,
        lean: () => Promise.resolve(null),
      };
      return chain;
    }),
    updateOne: jest.fn(() => ({ exec: () => Promise.resolve({}) })),
  };
  const svc = new ChatService(
    {
      findById: jest.fn().mockResolvedValue({
        _id: roomId,
        hook_id: hookId,
        channel_type: 'line',
        line_user_id: 'Uabc',
      }),
    } as never,
    chatMessageModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      findById: jest.fn().mockResolvedValue({
        _id: hookId,
        alias: 'oa-1',
        channel_type: 'line',
        access_token: 'unit-test-token',
      }),
    } as never,
    { publish: jest.fn().mockResolvedValue(undefined) } as never,
    { safeDecrypt: jest.fn((v: unknown) => v) } as never,
    {} as never,
    {
      getSendAdapter: jest.fn(() => ({ channelType: 'line', send: jest.fn() })),
    } as never,
    {
      createLog: jest.fn((r: Record<string, unknown>) => {
        logs.push(r);
        return Promise.resolve({});
      }),
    } as never,
    new PushOnlySendStrategy(core as never),
  );
  const flush = () => new Promise((r) => setImmediate(r));
  return { svc, chatMessageModel, logs, flush };
}

const send = (h: ReturnType<typeof build>, text = 'ฟหกฟหกฟหก') =>
  h.svc.sendChatReply(String(roomId), undefined, { text }, SUPER);

describe('⭐⭐⭐ a send LINE refused saves NOTHING', () => {
  it('⭐⭐⭐ 429 (quota spent) → no chat_messages row at all', async () => {
    /* 🔴 THE BUG, exactly as reported: the row was inserted, then the send threw,
       and the operator was left with a bubble no customer ever got. */
    const h = build(lineRefusal(429, 'You have reached your monthly limit.'));
    await expect(send(h)).rejects.toBeDefined();
    expect(h.chatMessageModel.create).not.toHaveBeenCalled();
  });

  it('⭐⭐⭐ …and neither does a 400, a 401 or a network failure', async () => {
    for (const bad of [
      lineRefusal(400, 'The property, messages[0].text, may not be empty'),
      lineRefusal(401, 'Authentication failed'),
      { ok: false as const, status: 0, raw: new Error('socket hang up') },
    ]) {
      const h = build(bad);
      await expect(send(h)).rejects.toBeDefined();
      expect(h.chatMessageModel.create).not.toHaveBeenCalled();
    }
  });

  it('⭐⭐ the refusal IS recorded — as a webhook_logs row, where failed calls belong', async () => {
    /* "do not save the message" must never become "lose the evidence". */
    const h = build(lineRefusal(429, 'You have reached your monthly limit.'));
    await expect(send(h)).rejects.toBeDefined();
    await h.flush();
    expect(h.logs).toHaveLength(1);
  });

  it('⭐⭐⭐ a SUCCESSFUL send still writes exactly one row', async () => {
    /* the guard above must not have turned into "never saves". */
    const h = build();
    const out = await send(h);
    expect(h.chatMessageModel.create).toHaveBeenCalledTimes(1);
    expect((out['data'] as Record<string, unknown>)['content']).toBe(
      'ฟหกฟหกฟหก',
    );
  });
});

describe('⭐⭐⭐ and it says WHY, in LINE‘s own words', () => {
  it('⭐⭐⭐ the reason survives instead of becoming "internal error"', async () => {
    /* 🔴 A bare `Error` is flattened to 500 "internal error" by
       `AllExceptionsFilter` — correctly, for anything unexpected. This is not
       unexpected, and the sentence the operator needs was already built. */
    const h = build(lineRefusal(429, 'You have reached your monthly limit.'));
    await expect(send(h)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('You have reached your monthly limit.'),
    });
  });

  it('⭐⭐ it is an HttpException, which is the only reason the message gets out', async () => {
    /* The type is the fix. Asserting the wording alone would still pass with a
       bare Error, and the client would still read "internal error". */
    const h = build(lineRefusal(400, 'may not be empty'));
    const err = await send(h).catch((e: unknown) => e);
    expect(typeof (err as { getStatus?: unknown }).getStatus).toBe('function');
    expect((err as { getStatus: () => number }).getStatus()).toBe(502);
  });

  it('⭐⭐ LINE’s status is NOT mirrored onto our response', async () => {
    /* 502 for every upstream refusal, on purpose: mirroring 401 would sign the
       operator out of the dashboard because an OA token expired, and mirroring
       429 would read as OUR rate limit. WHICH refusal is in the message. */
    const h = build(lineRefusal(401, 'Authentication failed'));
    await expect(send(h)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('HTTP 401'),
    });
  });
});
