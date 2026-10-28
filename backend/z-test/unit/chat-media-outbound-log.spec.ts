/**
 * [FEAT-20260808-MEDIALOG] Outbound chat-image webhook_logs row, pinned in
 * isolation — the log legacy writes on `sendChatImage` (chatRoomController.js:1036
 * → logOutboundWebhookLog) that the new BE was skipping (MEDIA_SEND_UNPORTED).
 *
 * ⚠️ [FEAT-20260821-CHATPUSHCORE] THE COLLABORATOR CHANGED, THE BEHAVIOUR DID NOT.
 * The image send now goes through the push core's `LinePushDispatcher` instead of
 * `LineSendAdapter`. These cases went RED on the migration and that is correct —
 * swapping the sender IS the change, and a suite that stayed green through it
 * would have been asserting nothing about who sends.
 *
 * TWO SHAPES DIFFER, AND BOTH MATTER:
 *   · the old adapter REJECTED on failure; the core RESOLVES `{ok:false, raw}`
 *     (`line-push.ts:38-40`) and the service turns that back into a throw. `raw`
 *     is the untouched axios error the audit still reads.
 *   · `dispatch` takes ONE request object where the adapter took `(ctx, msg)`,
 *     so payload assertions now read `.messages` — the WIRE objects, which is
 *     what actually reaches LINE. That the core builds the same wire objects the
 *     adapter did is proven separately, for every kind, in
 *     `z-test/unit/chat-pushcore-parity.spec.ts`.
 *
 * These cases assert, WITHOUT any real LINE traffic (the dispatcher is a jest.fn):
 *   1. the send's normal result is UNCHANGED — `{ success:true, data }` on
 *      success, the `{ success:false, error }` envelope on a LINE failure;
 *   2. exactly one webhook_logs row is written per send, via WebhookLogService
 *      (the one path that applies the channel↔log_source mirror), with legacy's
 *      fixed fields (channel/log_source "line_api", action_type "push_message",
 *      POST to the push endpoint) and the right status/http_status/payload.
 *
 * Constructor ORDER (verified against the @Injectable service):
 *   chatRoomModel, chatMessageModel, hookModel, imageStorageModel,
 *   realtimePublisher, crypto, channels, lineContent, config, webhookLogService.
 */
import { Types } from 'mongoose';

import {
  ChatMediaService,
  isChatMediaError,
  type ChatMediaError,
} from '@/modules/chat/chat-media.service';
import { PushOnlySendStrategy } from '@/modules/chat';

const FAKE_TOKEN = 'unit-test-not-a-real-token';
const PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

describe('[FEAT-20260808-MEDIALOG] ChatMediaService.sendChatImage outbound webhook_log', () => {
  let service: ChatMediaService;

  const roomId = new Types.ObjectId();
  const hookId = new Types.ObjectId();
  const groupId = new Types.ObjectId();
  const msgId = new Types.ObjectId();
  const storageId = new Types.ObjectId();

  let chatRoomModel: { findById: jest.Mock };
  let chatMessageModel: { create: jest.Mock };
  let hookModel: { findById: jest.Mock };
  let imageStorageModel: { create: jest.Mock };
  let realtimePublisher: { publish: jest.Mock };
  let crypto: { safeDecrypt: jest.Mock };
  let adapter: { channelType: string; send: jest.Mock };
  let push: { dispatch: jest.Mock };
  let channels: { getSendAdapter: jest.Mock };
  let webhookLogService: { createLog: jest.Mock };

  const file = {
    filename: 'abc.jpg',
    originalname: 'abc.JPG',
    path: '/tmp/abc.jpg',
    size: 1234,
  };

  const AUTH = {
    userId: 'a0d00000000000000000000a',
    username: 'op1',
    displayName: 'Operator One',
  } as never;

  beforeEach(() => {
    chatRoomModel = {
      findById: jest.fn().mockResolvedValue({
        _id: roomId,
        hook_id: hookId,
        channel_type: 'line',
        line_user_id: 'Uabc',
        channel_user_id: 'Uabc',
      }),
    };
    hookModel = {
      findById: jest.fn().mockResolvedValue({
        _id: hookId,
        alias: 'oa-1',
        group: groupId,
        channel_type: 'line',
        access_token: FAKE_TOKEN,
      }),
    };
    imageStorageModel = {
      create: jest.fn().mockResolvedValue({ _id: storageId }),
    };
    chatMessageModel = {
      create: jest.fn().mockResolvedValue({ _id: msgId }),
    };
    realtimePublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    crypto = { safeDecrypt: jest.fn((v: unknown) => v) };
    /* [FIX-20260827-CGATECHANNEL] `channelType` คือของที่ LineSendAdapter ตัวจริง
       มี (line-send-adapter.ts:92) · เกตของ chat อ่านค่านี้เพื่อถามว่าคอร์ LINE
       ส่ง channel นี้ได้ไหม ⇒ ทำให้ของปลอมตรงกับของจริง ไม่ใช่ผ่อนเทสให้ผ่าน */
    adapter = {
      channelType: 'line',
      send: jest.fn().mockResolvedValue(undefined),
    };
    push = {
      dispatch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        attempts: 1,
        durationMs: 1,
      }),
    };
    channels = { getSendAdapter: jest.fn(() => adapter) };
    webhookLogService = { createLog: jest.fn().mockResolvedValue({}) };

    service = new ChatMediaService(
      chatRoomModel as never,
      chatMessageModel as never,
      hookModel as never,
      imageStorageModel as never,
      realtimePublisher as never,
      crypto as never,
      channels as never,
      {} as never, // lineContent — unused by the image path
      { publicBaseUrl: 'https://cdn.example.test', baseUrl: '' } as never,
      webhookLogService as never,
      /* [FEAT-20260821-CHATPUSHCORE] the push-core dispatcher — appended LAST.
         This spec builds the service POSITIONALLY and tsc caught the missing arg
         at once: appending a DI param protects positional callers at RUNTIME,
         not at compile time. ต่อท้ายไม่ได้แปลว่าไม่ต้องแก้ spec. */
      /* [FEAT-20260821-QUOTEREPLY] the slot now takes the send LADDER. Wrapping
         the same `push` fake in the REAL push-only strategy is the proof that
         nothing on the wire moved: every assertion below on what reached
         `dispatch` is unchanged. */
      new PushOnlySendStrategy(push as never),
    );
  });

  const flush = () => new Promise((r) => setImmediate(r));

  it('success → unchanged {success:true,data} + one success webhook_log row with legacy fixed fields', async () => {
    const out = await service.sendChatImage(
      String(roomId),
      undefined,
      file,
      'hi caption',
      AUTH,
    );

    // Result unchanged.
    expect(isChatMediaError(out)).toBe(false);
    expect(out).toMatchObject({ success: true, data: { _id: msgId } });
    // The image was actually pushed through the adapter (once).
    expect(push.dispatch).toHaveBeenCalledTimes(1);

    await flush();
    expect(webhookLogService.createLog).toHaveBeenCalledTimes(1);
    const row = webhookLogService.createLog.mock.calls[0][0];
    expect(row).toMatchObject({
      hook_id: String(hookId),
      hook_alias: 'oa-1',
      channel_type: 'line',
      group_id: String(groupId),
      channel: 'line_api',
      log_source: 'line_api',
      action_type: 'push_message',
      method: 'POST',
      endpoint: PUSH_ENDPOINT,
      status: 'success',
      http_status: 200,
    });
    // payload_summary carries the recipient, kind and the absolute image url.
    expect(row.payload_summary).toMatchObject({
      to: 'Uabc',
      kind: 'image',
      imageUrl: 'https://cdn.example.test/uploads/images/abc.jpg',
      text: 'hi caption',
    });
    // raw_request has the LINE messages (image bubble + caption).
    expect(row.raw_request.messages[0]).toMatchObject({
      type: 'image',
      originalContentUrl: 'https://cdn.example.test/uploads/images/abc.jpg',
    });
    expect(row.raw_request.messages[1]).toMatchObject({
      type: 'text',
      text: 'hi caption',
    });
    // A success row carries no error fields.
    expect(row.error_message).toBeUndefined();
    expect(typeof row.duration_ms).toBe('number');
  });

  it('LINE failure → unchanged {success:false,error} envelope + one error webhook_log row', async () => {
    /* the core does not reject — it resolves not-ok and hands the untouched
       axios error back on `raw`, which is what the audit reads. */
    push.dispatch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      attempts: 1,
      durationMs: 1,
      raw: {
        response: { status: 400, data: { message: 'Invalid reply token' } },
        message: 'Request failed',
      },
    });

    const out = (await service.sendChatImage(
      String(roomId),
      undefined,
      file,
      '',
      AUTH,
    )) as ChatMediaError;

    // Result unchanged: legacy's {success:false,error,status} envelope with the
    // upstream status (400), NOT an uncaught 500.
    expect(isChatMediaError(out)).toBe(true);
    expect(out.success).toBe(false);
    expect(out.status).toBe(400);
    expect(out.error).toContain('Failed to send image');

    await flush();
    expect(webhookLogService.createLog).toHaveBeenCalledTimes(1);
    const row = webhookLogService.createLog.mock.calls[0][0];
    expect(row).toMatchObject({
      channel: 'line_api',
      log_source: 'line_api',
      action_type: 'push_message',
      endpoint: PUSH_ENDPOINT,
      status: 'error',
      http_status: 400,
    });
    // error_message carries the extracted LINE reason.
    expect(row.error_message).toContain('Invalid reply token');
    // On the error path legacy's payload omits imageUrl (only text).
    expect(row.payload_summary).toMatchObject({ to: 'Uabc', kind: 'image' });
    expect(row.payload_summary.imageUrl).toBeUndefined();
  });

  it('a webhook_log write failure never fails the send (fire-and-forget)', async () => {
    webhookLogService.createLog.mockRejectedValueOnce(new Error('mongo down'));

    const out = await service.sendChatImage(
      String(roomId),
      undefined,
      file,
      '',
      AUTH,
    );
    // The send still succeeds even though the log write rejected.
    expect(out).toMatchObject({ success: true });
  });
});

/**
 * [FEAT-20260816-MULTIIMG] Multi-image sends through the SAME method — the
 * service accepts an array, batches via planImagePushBatches, pushes one
 * adapter call per batch, writes one webhook_log row per CALL (the row mirrors
 * a real HTTP call, never an aggregate), and publishes message:new for EVERY
 * bubble (images + caption — owner decision 16/08: "เด้งครบทุกใบ").
 */
describe('[FEAT-20260816-MULTIIMG] ChatMediaService.sendChatImage — multi image batches', () => {
  let service: ChatMediaService;

  const roomId = new Types.ObjectId();
  const hookId = new Types.ObjectId();

  let chatMessageModel: { create: jest.Mock };
  let realtimePublisher: { publish: jest.Mock };
  let adapter: { channelType: string; send: jest.Mock };
  let push: { dispatch: jest.Mock };
  let webhookLogService: { createLog: jest.Mock };

  const mkFile = (n: number) => ({
    filename: `f${n}.jpg`,
    originalname: `f${n}.jpg`,
    path: `/tmp/f${n}.jpg`,
    size: 10 + n,
  });
  const files = (n: number) =>
    Array.from({ length: n }, (_, i) => mkFile(i + 1));
  const cdn = (n: number) =>
    `https://cdn.example.test/uploads/images/f${n}.jpg`;

  const AUTH = {
    userId: 'a0d00000000000000000000a',
    username: 'op1',
    displayName: 'Operator One',
  } as never;

  beforeEach(() => {
    let msgSeq = 0;
    chatMessageModel = {
      create: jest
        .fn()
        .mockImplementation((doc: Record<string, unknown>) =>
          Promise.resolve({ _id: new Types.ObjectId(), seq: ++msgSeq, ...doc }),
        ),
    };
    realtimePublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    /* [FIX-20260827-CGATECHANNEL] `channelType` คือของที่ LineSendAdapter ตัวจริง
       มี (line-send-adapter.ts:92) · เกตของ chat อ่านค่านี้เพื่อถามว่าคอร์ LINE
       ส่ง channel นี้ได้ไหม ⇒ ทำให้ของปลอมตรงกับของจริง ไม่ใช่ผ่อนเทสให้ผ่าน */
    adapter = {
      channelType: 'line',
      send: jest.fn().mockResolvedValue(undefined),
    };
    push = {
      dispatch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        attempts: 1,
        durationMs: 1,
      }),
    };
    webhookLogService = { createLog: jest.fn().mockResolvedValue({}) };

    service = new ChatMediaService(
      {
        findById: jest.fn().mockResolvedValue({
          _id: roomId,
          hook_id: hookId,
          channel_type: 'line',
          line_user_id: 'Uabc',
          channel_user_id: 'Uabc',
        }),
      } as never,
      chatMessageModel as never,
      {
        findById: jest.fn().mockResolvedValue({
          _id: hookId,
          alias: 'oa-1',
          channel_type: 'line',
          access_token: 'unit-test-not-a-real-token',
        }),
      } as never,
      {
        create: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve({ _id: new Types.ObjectId() }),
          ),
      } as never,
      realtimePublisher as never,
      { safeDecrypt: jest.fn((v: unknown) => v) } as never,
      { getSendAdapter: jest.fn(() => adapter) } as never,
      {} as never,
      { publicBaseUrl: 'https://cdn.example.test', baseUrl: '' } as never,
      webhookLogService as never,
      /* [FEAT-20260821-CHATPUSHCORE] the push-core dispatcher — appended LAST.
         This spec builds the service POSITIONALLY and tsc caught the missing arg
         at once: appending a DI param protects positional callers at RUNTIME,
         not at compile time. ต่อท้ายไม่ได้แปลว่าไม่ต้องแก้ spec. */
      /* [FEAT-20260821-QUOTEREPLY] the slot now takes the send LADDER. Wrapping
         the same `push` fake in the REAL push-only strategy is the proof that
         nothing on the wire moved: every assertion below on what reached
         `dispatch` is unchanged. */
      new PushOnlySendStrategy(push as never),
    );
  });

  const flush = () => new Promise((r) => setImmediate(r));

  it('3 images + caption → ONE adapter call (images then trailing text) + ONE log row + a publish per bubble (4)', async () => {
    const out = await service.sendChatImage(
      String(roomId),
      undefined,
      files(3),
      'cap',
      AUTH,
    );
    expect(isChatMediaError(out)).toBe(false);
    expect(push.dispatch).toHaveBeenCalledTimes(1);
    expect(
      (push.dispatch.mock.calls[0][0] as { messages: unknown[] }).messages,
    ).toEqual([
      { type: 'image', originalContentUrl: cdn(1), previewImageUrl: cdn(1) },
      { type: 'image', originalContentUrl: cdn(2), previewImageUrl: cdn(2) },
      { type: 'image', originalContentUrl: cdn(3), previewImageUrl: cdn(3) },
      { type: 'text', text: 'cap' },
    ]);
    // 4 bubbles stored: 3 images + 1 caption
    expect(chatMessageModel.create).toHaveBeenCalledTimes(4);
    // realtime: EVERY bubble announced (3 images + caption)
    expect(realtimePublisher.publish).toHaveBeenCalledTimes(4);

    await flush();
    expect(webhookLogService.createLog).toHaveBeenCalledTimes(1);
    const row = webhookLogService.createLog.mock.calls[0][0];
    expect(row.raw_request.messages).toHaveLength(4);
    expect(row.payload_summary.imageUrls).toEqual([cdn(1), cdn(2), cdn(3)]);
  });

  it("5 images + caption → TWO calls in the owner's arrangement + TWO log rows", async () => {
    const out = await service.sendChatImage(
      String(roomId),
      undefined,
      files(5),
      'cap',
      AUTH,
    );
    expect(isChatMediaError(out)).toBe(false);
    expect(push.dispatch).toHaveBeenCalledTimes(2);
    expect(
      (push.dispatch.mock.calls[0][0] as { messages: unknown[] }).messages,
    ).toEqual([
      { type: 'text', text: 'cap' },
      { type: 'image', originalContentUrl: cdn(1), previewImageUrl: cdn(1) },
      { type: 'image', originalContentUrl: cdn(2), previewImageUrl: cdn(2) },
      { type: 'image', originalContentUrl: cdn(3), previewImageUrl: cdn(3) },
      { type: 'image', originalContentUrl: cdn(4), previewImageUrl: cdn(4) },
    ]);
    expect(
      (push.dispatch.mock.calls[1][0] as { messages: unknown[] }).messages,
    ).toEqual([
      { type: 'image', originalContentUrl: cdn(5), previewImageUrl: cdn(5) },
    ]);

    await flush();
    expect(webhookLogService.createLog).toHaveBeenCalledTimes(2);
    const rows = webhookLogService.createLog.mock.calls.map((c) => c[0]);
    expect(rows[0].raw_request.messages).toHaveLength(5);
    expect(rows[0].raw_request.messages[0].type).toBe('text');
    expect(rows[1].raw_request.messages).toEqual([
      expect.objectContaining({ type: 'image', originalContentUrl: cdn(5) }),
    ]);
    expect(rows.every((r) => r.status === 'success')).toBe(true);
  });

  it('failure on call 2 of 2 → envelope names the batch, ONE success row + ONE error row', async () => {
    push.dispatch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        attempts: 1,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        attempts: 1,
        durationMs: 1,
        raw: {
          response: { status: 500, data: { message: 'temporary failure' } },
          message: 'Request failed',
        },
      });

    const out = (await service.sendChatImage(
      String(roomId),
      undefined,
      files(5),
      'cap',
      AUTH,
    )) as ChatMediaError;

    expect(isChatMediaError(out)).toBe(true);
    expect(out.error).toContain('Failed to send image');
    expect(out.error).toContain('2/2');
    expect(out.status).toBe(500);

    await flush();
    const rows = webhookLogService.createLog.mock.calls.map((c) => c[0]);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('success');
    expect(rows[1].status).toBe('error');
    expect(rows[1].error_message).toContain('temporary failure');
  });

  it('an ARRAY of one file behaves exactly like the legacy single send (one call, image then caption)', async () => {
    const out = await service.sendChatImage(
      String(roomId),
      undefined,
      files(1),
      'cap',
      AUTH,
    );
    expect(isChatMediaError(out)).toBe(false);
    expect(push.dispatch).toHaveBeenCalledTimes(1);
    expect(
      (push.dispatch.mock.calls[0][0] as { messages: unknown[] }).messages,
    ).toEqual([
      { type: 'image', originalContentUrl: cdn(1), previewImageUrl: cdn(1) },
      { type: 'text', text: 'cap' },
    ]);
    await flush();
    const row = webhookLogService.createLog.mock.calls[0][0];
    // single image keeps the singular field byte-identical to legacy
    expect(row.payload_summary.imageUrl).toBe(cdn(1));
    expect(row.payload_summary.imageUrls).toBeUndefined();
  });

  it('6 files → rejected 400 before any store/push (controller cap defence in depth)', async () => {
    const out = (await service.sendChatImage(
      String(roomId),
      undefined,
      files(6),
      '',
      AUTH,
    )) as ChatMediaError;
    expect(isChatMediaError(out)).toBe(true);
    expect(out.status).toBe(400);
    expect(push.dispatch).not.toHaveBeenCalled();
    expect(chatMessageModel.create).not.toHaveBeenCalled();
  });
});
