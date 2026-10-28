// [FIX-20260808-VIDEORETRY] unit coverage for the ported retryVideoDownload
/**
 * `ChatMediaService.retryVideoDownload`, pinned in isolation — the "โหลดวิดีโอ"
 * button an admin presses for a `video_pending` message.
 *
 * ── FULLY MOCKED, NO OUTBOUND ────────────────────────────────────────────────
 * Every collaborator is hand-built (no Mongo, no DI container, no real
 * LINE/Gemini/Swiftcheck key). `lineContent.downloadAndSaveVideo` — the only thing
 * that would touch the network — is a jest.fn, so the global outbound guard
 * (z-test/lib/no-ai-outbound.ts) is never armed. Direct `new ChatMediaService`
 * instantiation, matching broadcast-send.spec.ts / channel-send.spec.ts.
 *
 * Constructor ORDER (verified against the @Injectable service):
 *   chatRoomModel, chatMessageModel, hookModel, imageStorageModel,
 *   realtimePublisher, crypto, channels, lineContent, config.
 */
import { Types } from 'mongoose';

import {
  ChatMediaService,
  isChatMediaError,
} from '@/modules/chat/chat-media.service';

/** Never a real channel token — safeDecrypt is stubbed identity below. */
const FAKE_TOKEN = 'unit-test-not-a-real-token';

describe('ChatMediaService.retryVideoDownload (fully mocked, no outbound)', () => {
  let service: ChatMediaService;

  let chatMessageModel: { findById: jest.Mock };
  let hookModel: { findById: jest.Mock };
  let imageStorageModel: { findById: jest.Mock };
  let realtimePublisher: { publish: jest.Mock };
  let crypto: { safeDecrypt: jest.Mock };
  let lineContent: { downloadAndSaveVideo: jest.Mock };

  /** A `video_pending` message doc with a jest.fn `save` (mutated in place). */
  const validMessageId = new Types.ObjectId();
  const hookId = new Types.ObjectId();
  const roomId = new Types.ObjectId();
  const storageId = new Types.ObjectId();

  let messageDoc: {
    _id: Types.ObjectId;
    hook_id: Types.ObjectId;
    room_id: Types.ObjectId;
    message_type: string;
    provider_msg_id: string | null;
    internal_content_id: Types.ObjectId | null;
    save: jest.Mock;
  };

  /** The hook `findById(...).lean()` resolves to. */
  let hookDoc: Record<string, unknown> | null;
  /** The storage `findById(...).lean()` resolves to. */
  let storageDoc: Record<string, unknown> | null;

  beforeEach(() => {
    messageDoc = {
      _id: validMessageId,
      hook_id: hookId,
      room_id: roomId,
      message_type: 'video_pending',
      provider_msg_id: 'line-msg-123',
      internal_content_id: null,
      save: jest.fn().mockResolvedValue(undefined),
    };

    hookDoc = { _id: hookId, access_token: FAKE_TOKEN };

    storageDoc = {
      _id: storageId,
      image_url: '/uploads/videos/clip.mp4',
      storage_type: 'internal',
      image_type: 'mp4',
      media_kind: 'video',
      file_size: 2048,
    };

    // findById(id) — NOT chained through .lean() in the code, so a bare promise.
    chatMessageModel = {
      findById: jest.fn().mockResolvedValue(messageDoc),
    };
    // hookModel.findById(...).lean() — .lean() chain.
    hookModel = {
      findById: jest.fn(() => ({ lean: () => Promise.resolve(hookDoc) })),
    };
    // imageStorageModel.findById(...).lean() — .lean() chain.
    imageStorageModel = {
      findById: jest.fn(() => ({ lean: () => Promise.resolve(storageDoc) })),
    };
    realtimePublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    // Plaintext fake token → safeDecrypt is identity, mirroring the real one.
    crypto = { safeDecrypt: jest.fn((v: unknown) => v) };
    lineContent = {
      downloadAndSaveVideo: jest.fn().mockResolvedValue(storageId),
    };

    service = new ChatMediaService(
      {} as never, // chatRoomModel — unused by the retry path
      chatMessageModel as never,
      hookModel as never,
      imageStorageModel as never,
      realtimePublisher as never,
      crypto as never,
      {} as never, // channels — unused by the retry path
      lineContent as never,
      {} as never, // config — unused by the retry path
      // [FEAT-20260808-MEDIALOG] WebhookLogService — unused by the retry path,
      // only the image-send path writes the outbound log.
      { createLog: jest.fn().mockResolvedValue({}) } as never,
      /* [FEAT-20260821-CHATPUSHCORE] the push-core dispatcher — appended last.
           This spec builds the service POSITIONALLY, and tsc caught the missing
           arg immediately: appending a DI param protects positional callers at
           RUNTIME, not at compile time. ต่อท้ายไม่ได้แปลว่าไม่ต้องแก้ spec. */
      {
        dispatch: jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          attempts: 1,
          durationMs: 1,
        }),
      } as never,
    );
  });

  // ── guards: every one rejects BEFORE the downloader ──────────────────────

  it('1. invalid messageId → 400, downloader never called', async () => {
    const out = await service.retryVideoDownload('not-an-object-id');
    expect(isChatMediaError(out)).toBe(true);
    if (isChatMediaError(out)) {
      expect(out.status).toBe(400);
      expect(out.error).toMatch(/messageId/);
    }
    expect(chatMessageModel.findById).not.toHaveBeenCalled();
    expect(lineContent.downloadAndSaveVideo).not.toHaveBeenCalled();
  });

  it('2. message not found → 404', async () => {
    chatMessageModel.findById.mockResolvedValueOnce(null);
    const out = await service.retryVideoDownload(String(validMessageId));
    expect(isChatMediaError(out)).toBe(true);
    if (isChatMediaError(out)) expect(out.status).toBe(404);
    expect(lineContent.downloadAndSaveVideo).not.toHaveBeenCalled();
  });

  it("3. message_type not 'video_pending' → 400 ไม่ใช่วิดีโอที่รอโหลด", async () => {
    messageDoc.message_type = 'video';
    const out = await service.retryVideoDownload(String(validMessageId));
    expect(isChatMediaError(out)).toBe(true);
    if (isChatMediaError(out)) {
      expect(out.status).toBe(400);
      expect(out.error).toMatch(/ไม่ใช่วิดีโอที่รอโหลด/);
    }
    expect(lineContent.downloadAndSaveVideo).not.toHaveBeenCalled();
  });

  it('4. missing provider_msg_id → 400', async () => {
    messageDoc.provider_msg_id = null;
    const out = await service.retryVideoDownload(String(validMessageId));
    expect(isChatMediaError(out)).toBe(true);
    if (isChatMediaError(out)) expect(out.status).toBe(400);
    expect(lineContent.downloadAndSaveVideo).not.toHaveBeenCalled();
  });

  it('5. hook not found → 404', async () => {
    hookDoc = null;
    const out = await service.retryVideoDownload(String(validMessageId));
    expect(isChatMediaError(out)).toBe(true);
    if (isChatMediaError(out)) expect(out.status).toBe(404);
    expect(lineContent.downloadAndSaveVideo).not.toHaveBeenCalled();
  });

  it('6. token decrypts to empty → 400 Hook ไม่มี access token, downloader never called', async () => {
    crypto.safeDecrypt.mockReturnValue('');
    const out = await service.retryVideoDownload(String(validMessageId));
    expect(isChatMediaError(out)).toBe(true);
    if (isChatMediaError(out)) {
      expect(out.status).toBe(400);
      expect(out.error).toMatch(/Hook ไม่มี access token/);
    }
    expect(lineContent.downloadAndSaveVideo).not.toHaveBeenCalled();
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it('7. HAPPY PATH: promotes video_pending → video, echoes storage, publishes scoped', async () => {
    const out = await service.retryVideoDownload(String(validMessageId));

    // Downloader received the LINE message id + decrypted token.
    expect(lineContent.downloadAndSaveVideo).toHaveBeenCalledWith(
      'line-msg-123',
      FAKE_TOKEN,
    );

    // The row was promoted and saved.
    expect(messageDoc.message_type).toBe('video');
    expect(messageDoc.internal_content_id).toBe(storageId);
    expect(messageDoc.save).toHaveBeenCalledTimes(1);

    // Storage re-read by id, its fields flow into the payload.
    expect(imageStorageModel.findById).toHaveBeenCalledWith(storageId);

    // Realtime: 'message:updated' with the scoped payload (hook_id REQUIRED).
    expect(realtimePublisher.publish).toHaveBeenCalledTimes(1);
    const [type, data] = realtimePublisher.publish.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(type).toBe('message:updated');
    expect(data['hook_id']).toBe(String(hookId));
    expect(data['hook_id']).toBeTruthy();
    expect(data['room_id']).toBe(String(roomId));
    // Legacy + FE ChatRoomView locate the bubble by `data._id`, not `message_id`.
    expect(data['_id']).toBe(String(validMessageId));
    expect(data['message_id']).toBeUndefined();
    expect(data['message_type']).toBe('video');
    expect(data['internal_content_id']).toMatchObject({
      _id: String(storageId),
      image_url: '/uploads/videos/clip.mp4',
      storage_type: 'internal',
      image_type: 'mp4',
      media_kind: 'video',
      file_size: 2048,
    });

    // Return envelope.
    expect(isChatMediaError(out)).toBe(false);
    const ok = out as { success: boolean; data: Record<string, unknown> };
    expect(ok.success).toBe(true);
    expect(ok.data['message_type']).toBe('video');
    expect(ok.data['_id']).toBe(String(validMessageId));
    expect(ok.data['internal_content_id']).toMatchObject({
      _id: String(storageId),
      image_url: '/uploads/videos/clip.mp4',
    });
  });

  // ── still transcoding ───────────────────────────────────────────────────

  it('8. downloader returns null → success:false ยังไม่พร้อม, no save, no publish', async () => {
    lineContent.downloadAndSaveVideo.mockResolvedValueOnce(null);

    const out = await service.retryVideoDownload(String(validMessageId));

    expect(isChatMediaError(out)).toBe(false);
    const res = out as { success: boolean; message: string };
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/ยังไม่พร้อม/);

    // The row is left untouched and nothing is emitted.
    expect(messageDoc.save).not.toHaveBeenCalled();
    expect(messageDoc.message_type).toBe('video_pending');
    expect(realtimePublisher.publish).not.toHaveBeenCalled();
  });
});
