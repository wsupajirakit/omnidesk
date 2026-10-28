import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import type { AxiosResponse } from 'axios';

import type { AuthenticatedUser } from '@/common';
import { BroadcastsService } from '@/modules/content';

/**
 * [FIX-20260808-BROADCASTSEND] `BroadcastsService.sendBroadcastNow`, pinned
 * against a stubbed HTTP client — NO real LINE traffic.
 *
 * ── WHY MOCKS, NOT A LIVE CALL ──────────────────────────────────────────────
 * `/message/broadcast` fans out to EVERY follower of the OA. One accidental real
 * send would deliver to real customers on a token that is live in the legacy
 * clone. So `axios.post` and `globalThis.fetch` are both replaced with
 * implementations that REJECT by default; a request a case did not stub is a
 * hard failure naming the URL, not a silent fallthrough. Every case also asserts
 * the exact `axios.post` call count, so an edit that adds a request fails loudly.
 * (Pattern copied from z-test/unit/line-api.spec.ts — the reason that file is
 * trustworthy.)
 *
 * ── WHAT IS PORTED, AND FROM WHERE ──────────────────────────────────────────
 * The expectations transcribe legacy `dispatchBroadcast`
 * (legacy-api dev_sec src/controllers/content/broadcastController.js ~213-326):
 * one axios.post per hook to LINE_BROADCAST_URL with `{ messages:[lineMessage] }`
 * and a Bearer header; success/error webhook_log rows; result shape; the
 * sent/failed status transition; and "one hook's failure never aborts the rest".
 *
 * ── NO CREDENTIALS ──────────────────────────────────────────────────────────
 * Every token here is an obvious fake, asserted as such. No value came from a
 * hook row, a `.env`, or a captured request.
 */

const LINE_BROADCAST_URL = 'https://api.line.me/v2/bot/message/broadcast';
const TIMEOUT_MS = 5_000;

/** Never a real channel token. */
const FAKE_TOKEN_A = 'unit-test-not-a-real-token-A';
const FAKE_TOKEN_B = 'unit-test-not-a-real-token-B';

const HOOK_A = 'a0d000000000000000000017';
const HOOK_B = 'a0d000000000000000000018';
const HOOK_MISSING = 'a0d000000000000000000019';
const BROADCAST_ID = 'a0d000000000000000000039';

const USER: AuthenticatedUser = {
  userId: 'unit-test-user',
  roleName: 'superadmin',
} as unknown as AuthenticatedUser;

/** What a caller reads off a resolved LINE call: `.status` and `.data`. */
const lineOk = (data: unknown = {}): AxiosResponse<unknown> =>
  ({
    status: 200,
    statusText: 'OK',
    data,
    headers: {},
    config: {},
  }) as unknown as AxiosResponse<unknown>;

/** An axios rejection: with `status` it is an HTTP failure carrying LINE's body. */
const axiosError = (
  message: string,
  status?: number,
  data?: unknown,
): Error & { response?: { status: number; data: unknown } } => {
  const err = new Error(message) as Error & {
    isAxiosError: boolean;
    code?: string;
    response?: { status: number; data: unknown };
  };
  err.isAxiosError = true;
  if (status === undefined) {
    err.code = 'ECONNABORTED';
  } else {
    err.response = { status, data };
  }
  return err;
};

interface PostCall {
  url: string;
  body: Record<string, unknown>;
  config: { headers: Record<string, string>; timeout: number };
}

describe('BroadcastsService.sendBroadcastNow (no real LINE traffic)', () => {
  let service: BroadcastsService;
  let postSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  // Collaborators, hand-stubbed — no Mongo, no DI container.
  let broadcastModel: {
    findOne: jest.Mock;
    findByIdAndUpdate: jest.Mock;
  };
  let hookModel: { findById: jest.Mock };
  /* [FEAT-20260827-WLOGONEDOOR] the door, not the model. Every row assertion
     below is untouched — the door forwards verbatim. */
  let webhookLogDoor: { persist: jest.Mock };
  let crypto: { safeDecrypt: jest.Mock };

  /** The stored broadcast the `findOne(...).lean()` chain resolves to. */
  let storedBroadcast: Record<string, unknown>;
  /** Per-hook-id lookup table for `hookModel.findById(id).lean()`. */
  let hooks: Record<string, Record<string, unknown> | null>;

  beforeEach(() => {
    const reject = (target: unknown) =>
      Promise.reject(
        new Error(`unstubbed outbound request: ${String(target)}`),
      );
    postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementation((url: unknown) => reject(url));
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        reject(input instanceof Request ? input.url : String(input)),
      );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    storedBroadcast = {
      _id: BROADCAST_ID,
      name: 'promo',
      hook_ids: [HOOK_A, HOOK_B],
      assign_group: { id: null, name: '' },
      target: { mode: 'all', group_ids: [] },
      message: { type: 'text', text: 'hello followers' },
      status: 'draft',
      sent_at: null,
    };

    hooks = {
      [HOOK_A]: {
        _id: HOOK_A,
        alias: 'oa-a',
        group: 'grp-a',
        access_token: FAKE_TOKEN_A,
      },
      [HOOK_B]: {
        _id: HOOK_B,
        alias: 'oa-b',
        group: 'grp-b',
        access_token: FAKE_TOKEN_B,
      },
    };

    broadcastModel = {
      findOne: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue(storedBroadcast),
      })),
      // Echoes the updates onto the stored doc so the returned `data` reflects them.
      findByIdAndUpdate: jest.fn((_id: unknown, updates: object) => ({
        lean: jest.fn().mockResolvedValue({ ...storedBroadcast, ...updates }),
      })),
    };
    hookModel = {
      findById: jest.fn((id: string) => ({
        lean: jest.fn().mockResolvedValue(hooks[id] ?? null),
      })),
    };
    webhookLogDoor = {
      persist: jest.fn().mockResolvedValue({}),
    };
    // Fake tokens are stored plaintext (no `enc:` prefix), so safeDecrypt is
    // identity — exactly how the real one treats a non-prefixed value.
    crypto = { safeDecrypt: jest.fn((v: unknown) => v) };

    service = new BroadcastsService(
      broadcastModel as never,
      hookModel as never,
      {} as never, // groupModel — unused by the send path
      webhookLogDoor as never,
      crypto as never,
      // [FEAT-20260808-AUDITSITE] AuditLogService — the send path fires a
      // fire-and-forget 'send' audit; a resolving stub keeps this suite focused
      // on the LINE traffic it already asserts.
      { createAuditLog: jest.fn().mockResolvedValue({}) } as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const postCall = (n = 0): PostCall => {
    const call = postSpy.mock.calls[n] as unknown[];
    return {
      url: call[0] as string,
      body: call[1] as Record<string, unknown>,
      config: call[2] as PostCall['config'],
    };
  };

  // ── the guards, unchanged from the stub ──────────────────────────────────

  it('rejects an invalid broadcast id before any outbound call', async () => {
    await expect(service.sendBroadcastNow(USER, 'not-an-id')).rejects.toThrow(
      'Invalid broadcast identifier',
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('404s when the broadcast is missing', async () => {
    broadcastModel.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(service.sendBroadcastNow(USER, BROADCAST_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('enforces the assign-group guard for a non-super user', async () => {
    const scopedUser = {
      userId: 'u2',
      roleName: 'admin',
      groups: [],
    } as unknown as AuthenticatedUser;
    storedBroadcast.assign_group = { id: 'grp-x', name: 'X' };
    await expect(
      service.sendBroadcastNow(scopedUser, BROADCAST_ID),
    ).rejects.toThrow(ForbiddenException);
    expect(postSpy).not.toHaveBeenCalled();
  });

  // ── the happy path ───────────────────────────────────────────────────────

  it('posts once per hook to LINE_BROADCAST_URL with the exact body, auth and timeout', async () => {
    postSpy.mockResolvedValue(lineOk({ ok: true }));

    const out = await service.sendBroadcastNow(USER, BROADCAST_ID);

    // One call per hook — no more, no fewer — and nothing via fetch.
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();

    const first = postCall(0);
    expect(first.url).toBe(LINE_BROADCAST_URL);
    expect(first.body).toEqual({
      messages: [{ type: 'text', text: 'hello followers' }],
    });
    expect(first.config.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FAKE_TOKEN_A}`,
    });
    expect(first.config.timeout).toBe(TIMEOUT_MS);
    // The second hook uses its OWN token.
    expect(postCall(1).config.headers['Authorization']).toBe(
      `Bearer ${FAKE_TOKEN_B}`,
    );

    // Result shape: per-hook success rows.
    expect(out.results).toEqual([
      { hook_id: HOOK_A, status: 'success', http_status: 200 },
      { hook_id: HOOK_B, status: 'success', http_status: 200 },
    ]);
  });

  it('writes a success webhook_log row per hook with the fixed fields', async () => {
    postSpy.mockResolvedValue(lineOk({ ok: true }));

    await service.sendBroadcastNow(USER, BROADCAST_ID);

    expect(webhookLogDoor.persist).toHaveBeenCalledTimes(2);
    const row = webhookLogDoor.persist.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      channel: 'line_api',
      action_type: 'send_broadcast',
      method: 'POST',
      endpoint: LINE_BROADCAST_URL,
      hook_id: HOOK_A,
      hook_alias: 'oa-a',
      group_id: 'grp-a',
      status: 'success',
      http_status: 200,
    });
    expect(row['payload_summary']).toEqual({
      broadcast_id: BROADCAST_ID,
      message_type: 'text',
      text: 'hello followers',
      image_url: undefined,
      flex_json: undefined,
    });
  });

  it('transitions status to sent and sets sent_at when every hook succeeds', async () => {
    postSpy.mockResolvedValue(lineOk());

    const out = await service.sendBroadcastNow(USER, BROADCAST_ID);

    const updates = broadcastModel.findByIdAndUpdate.mock
      .calls[0]![1] as Record<string, unknown>;
    expect(updates['status']).toBe('sent');
    expect(updates['sent_at']).toBeInstanceOf(Date);
    expect(updates['updated_by']).toBe(USER.userId);
    expect(out.data?.status).toBe('sent');
  });

  // ── flex + image shaping ─────────────────────────────────────────────────

  it('shapes a flex message the legacy way (altText + contents)', async () => {
    const flex = { type: 'bubble', body: {} };
    storedBroadcast.message = { type: 'flex', flex_json: flex };
    storedBroadcast.hook_ids = [HOOK_A];
    postSpy.mockResolvedValue(lineOk());

    await service.sendBroadcastNow(USER, BROADCAST_ID);

    expect(postCall(0).body).toEqual({
      messages: [
        { type: 'flex', altText: 'Broadcast message', contents: flex },
      ],
    });
  });

  it('shapes an image message with originalContentUrl + previewImageUrl', async () => {
    storedBroadcast.message = {
      type: 'image',
      image_url: 'https://example.invalid/i.jpg',
    };
    storedBroadcast.hook_ids = [HOOK_A];
    postSpy.mockResolvedValue(lineOk());

    await service.sendBroadcastNow(USER, BROADCAST_ID);

    expect(postCall(0).body).toEqual({
      messages: [
        {
          type: 'image',
          originalContentUrl: 'https://example.invalid/i.jpg',
          previewImageUrl: 'https://example.invalid/i.jpg',
        },
      ],
    });
  });

  // ── per-hook failure isolation ───────────────────────────────────────────

  it('records a missing hook as an error and still sends the others', async () => {
    storedBroadcast.hook_ids = [HOOK_MISSING, HOOK_A];
    postSpy.mockResolvedValue(lineOk());

    const out = await service.sendBroadcastNow(USER, BROADCAST_ID);

    // Only the present hook goes out.
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postCall(0).config.headers['Authorization']).toBe(
      `Bearer ${FAKE_TOKEN_A}`,
    );
    expect(out.results).toEqual([
      { hook_id: HOOK_MISSING, status: 'error', error: 'Hook not found' },
      { hook_id: HOOK_A, status: 'success', http_status: 200 },
    ]);
    // A missing hook writes NO log row (legacy `continue`s before logging).
    expect(webhookLogDoor.persist).toHaveBeenCalledTimes(1);
    // Mixed outcome ⇒ status failed, sent_at preserved (not stamped).
    const updates = broadcastModel.findByIdAndUpdate.mock
      .calls[0]![1] as Record<string, unknown>;
    expect(updates['status']).toBe('failed');
    expect(updates['sent_at']).toBeNull();
  });

  it('records a hook with no token as an error without calling LINE', async () => {
    hooks[HOOK_A] = { _id: HOOK_A, alias: 'oa-a', group: 'grp-a' }; // no token
    storedBroadcast.hook_ids = [HOOK_A, HOOK_B];
    postSpy.mockResolvedValue(lineOk());

    const out = await service.sendBroadcastNow(USER, BROADCAST_ID);

    // Only HOOK_B (which has a token) reaches LINE.
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(out.results).toEqual([
      {
        hook_id: HOOK_A,
        status: 'error',
        error: 'Line access token is required',
      },
      { hook_id: HOOK_B, status: 'success', http_status: 200 },
    ]);
  });

  it('falls back to line_key when access_token is absent (dual-write precedence)', async () => {
    hooks[HOOK_A] = {
      _id: HOOK_A,
      alias: 'oa-a',
      group: 'grp-a',
      line_key: FAKE_TOKEN_A,
    };
    storedBroadcast.hook_ids = [HOOK_A];
    postSpy.mockResolvedValue(lineOk());

    await service.sendBroadcastNow(USER, BROADCAST_ID);

    expect(postCall(0).config.headers['Authorization']).toBe(
      `Bearer ${FAKE_TOKEN_A}`,
    );
  });

  it('captures a LINE HTTP error per hook, logs it, and continues to the next', async () => {
    postSpy
      .mockRejectedValueOnce(
        axiosError('Request failed with status code 400', 400, {
          message: 'Invalid broadcast message',
        }),
      )
      .mockResolvedValueOnce(lineOk());

    const out = await service.sendBroadcastNow(USER, BROADCAST_ID);

    // Both hooks were attempted — the first failure did not abort the loop.
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(out.results).toEqual([
      { hook_id: HOOK_A, status: 'error', error: 'Invalid broadcast message' },
      { hook_id: HOOK_B, status: 'success', http_status: 200 },
    ]);

    // An error row carries LINE's status + body.
    const errRow = webhookLogDoor.persist.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(errRow).toMatchObject({
      status: 'error',
      http_status: 400,
      error_message: 'Invalid broadcast message',
    });
    // Mixed ⇒ failed.
    expect(
      (
        broadcastModel.findByIdAndUpdate.mock.calls[0]![1] as Record<
          string,
          unknown
        >
      )['status'],
    ).toBe('failed');
  });

  it('falls back to err.message on a transport failure with no response', async () => {
    storedBroadcast.hook_ids = [HOOK_A];
    postSpy.mockRejectedValueOnce(axiosError('timeout of 5000ms exceeded'));

    const out = await service.sendBroadcastNow(USER, BROADCAST_ID);

    expect(out.results).toEqual([
      { hook_id: HOOK_A, status: 'error', error: 'timeout of 5000ms exceeded' },
    ]);
    const errRow = webhookLogDoor.persist.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(errRow['http_status']).toBeUndefined();
    expect(errRow['error_message']).toBe('timeout of 5000ms exceeded');
  });

  it('a log-write failure never fails the send (fire-and-forget)', async () => {
    storedBroadcast.hook_ids = [HOOK_A];
    postSpy.mockResolvedValue(lineOk());
    webhookLogDoor.persist.mockReturnValueOnce({
      catch: (cb: (e: Error) => void) => {
        cb(new Error('mongo down'));
        return Promise.resolve();
      },
    });

    const out = await service.sendBroadcastNow(USER, BROADCAST_ID);
    expect(out.results[0]).toMatchObject({ status: 'success' });
  });
});
