import { Logger } from '@nestjs/common';
import axios from 'axios';

import { describeLineFailure, LinePushService } from '@/infra/line';
import type { LineSendRequest } from '@/infra/line';

/**
 * ==== [FEAT-20260820-LINEPUSHCORE] the neutral LINE send core, pinned ====
 *
 * TARGET suite for the new `src/infra/line/push/` core (Phase 1 of the central
 * LINE push layer). The core is NOT wired to any caller yet — no route reaches
 * it, so the wire shape and the result envelope are pinned here the same way
 * `line-api.spec.ts` pins the ported legacy client: every expectation names the
 * rule it enforces, and each rule below has a mutation partner recorded in the
 * task note.
 *
 * ── WHY NOTHING HERE CAN REACH LINE ─────────────────────────────────────────
 * Same absolute rule as line-api.spec.ts: `axios.post`, `axios.get` AND
 * `globalThis.fetch` are replaced for the whole file with implementations that
 * REJECT by default — an outbound call a case did not explicitly stub is a hard
 * failure carrying the attempted URL. Every case asserts the call count.
 *
 * ── NO CREDENTIALS ──────────────────────────────────────────────────────────
 * Token / user ids below are obvious fakes. No value came from a hook row, a
 * .env, or a captured request. ไม่มีของจริงแม้แต่ค่าเดียว.
 *
 * Rules pinned here (the design contract, decided 2026-08-20):
 *   R1  one wire style: JSON + Bearer + one default timeout (15_000 — the
 *       measured budget line-api.service.ts:62 already uses)
 *   R2  X-Line-Retry-Key: auto-UUID on push/multicast/broadcast, NEVER on
 *       reply/loading (LINE docs: reply tokens are single-use, no retry-key)
 *   R3  no retry by default — one attempt, exactly like every current call site
 *   R4  retry is opt-in, push-family only, 5xx/transport only, same retry key
 *       on every attempt; 4xx never retries; 409 = already accepted = success
 *   R5  programmer misuse (bad target/kind combo, 0 or >5 messages, retry on
 *       reply) throws BEFORE any network call; runtime failure never throws
 *       from send() — it returns { ok:false } with the raw error preserved
 *   R6  every call emits exactly one audit event (LINE guideline: log request
 *       id + endpoint + status — the caller decides where the row goes)
 */

const FAKE_TOKEN = 'unit-test-not-a-real-channel-token';
const FAKE_USER_ID = 'unit-test-user-id';
const FAKE_REPLY_TOKEN = 'unit-test-reply-token';

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast';
const BROADCAST_URL = 'https://api.line.me/v2/bot/message/broadcast';
const LOADING_URL = 'https://api.line.me/v2/bot/chat/loading/start';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEXT_MSG = { type: 'text', text: 'hello' };

/** A resolved LINE 200, with the request id LINE always returns. */
const lineOk = (data: unknown = {}, requestId = 'req-id-1') => ({
  status: 200,
  statusText: 'OK',
  data,
  headers: { 'x-line-request-id': requestId },
  config: {},
});

/** An axios rejection: HTTP failure (status set) or transport failure. */
const axiosError = (
  message: string,
  status?: number,
  data?: unknown,
  headers: Record<string, string> = {},
): Error & { response?: unknown } => {
  const err = new Error(message) as Error & {
    isAxiosError: boolean;
    code?: string;
    response?: {
      status: number;
      data: unknown;
      headers: Record<string, string>;
    };
  };
  err.isAxiosError = true;
  if (status === undefined) {
    err.code = 'ECONNABORTED';
  } else {
    err.response = { status, data, headers };
  }
  return err;
};

describe('LinePushService — the neutral LINE send core (no real LINE traffic)', () => {
  let service: LinePushService;
  let postSpy: jest.SpyInstance;
  let getSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    const reject = (target: unknown) =>
      Promise.reject(
        new Error(`unstubbed outbound request: ${String(target)}`),
      );
    postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementation((url: unknown) => reject(url));
    getSpy = jest
      .spyOn(axios, 'get')
      .mockImplementation((url: unknown) => reject(url));
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        reject(input instanceof Request ? input.url : String(input)),
      );
    // Keep the run quiet — the audit-sink case makes the service warn on
    // purpose, and that warning is its behaviour, not console noise.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new LinePushService();
  });

  afterEach(() => {
    expect(getSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  /** The nth axios.post call, unpacked. */
  const postCall = (n = 0) => {
    const call = postSpy.mock.calls[n] as unknown[];
    return {
      url: call[0] as string,
      body: call[1] as Record<string, unknown>,
      config: call[2] as {
        headers: Record<string, string>;
        timeout: number;
      },
    };
  };

  const pushReq = (over: Partial<LineSendRequest> = {}): LineSendRequest => ({
    kind: 'push',
    token: FAKE_TOKEN,
    to: FAKE_USER_ID,
    messages: [TEXT_MSG],
    ...over,
  });

  // ── R1 + R2: wire shape per kind ────────────────────────────────────────

  it('push: one JSON POST with Bearer, default 15s timeout and a UUID retry key', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    const res = await service.send(pushReq());

    expect(postSpy).toHaveBeenCalledTimes(1);
    const { url, body, config } = postCall();
    expect(url).toBe(PUSH_URL);
    expect(body).toEqual({ to: FAKE_USER_ID, messages: [TEXT_MSG] });
    expect(config.headers['Content-Type']).toBe('application/json');
    expect(config.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(config.headers['X-Line-Retry-Key']).toMatch(UUID_RE);
    expect(config.timeout).toBe(15_000);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.attempts).toBe(1);
  });

  it('reply: posts {replyToken, messages} and NEVER carries a retry key', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    await service.send({
      kind: 'reply',
      token: FAKE_TOKEN,
      replyToken: FAKE_REPLY_TOKEN,
      messages: [TEXT_MSG],
    });
    const { url, body, config } = postCall();
    expect(url).toBe(REPLY_URL);
    expect(body).toEqual({
      replyToken: FAKE_REPLY_TOKEN,
      messages: [TEXT_MSG],
    });
    expect(config.headers['X-Line-Retry-Key']).toBeUndefined();
  });

  it('multicast: posts {to: string[], messages} with a retry key', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    await service.send({
      kind: 'multicast',
      token: FAKE_TOKEN,
      to: ['u1', 'u2'],
      messages: [TEXT_MSG],
    });
    const { url, body, config } = postCall();
    expect(url).toBe(MULTICAST_URL);
    expect(body).toEqual({ to: ['u1', 'u2'], messages: [TEXT_MSG] });
    expect(config.headers['X-Line-Retry-Key']).toMatch(UUID_RE);
  });

  it('narrowcast: posts {messages} merged with pass-through options, with a retry key', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    await service.send({
      kind: 'narrowcast',
      token: FAKE_TOKEN,
      messages: [TEXT_MSG],
      narrowcast: {
        recipient: { type: 'audience', audienceGroupId: 1 },
        limit: { max: 100 },
      },
    });
    const { url, body, config } = postCall();
    expect(url).toBe('https://api.line.me/v2/bot/message/narrowcast');
    expect(body).toEqual({
      messages: [TEXT_MSG],
      recipient: { type: 'audience', audienceGroupId: 1 },
      limit: { max: 100 },
    });
    expect(config.headers['X-Line-Retry-Key']).toMatch(UUID_RE);
  });

  it('narrowcast without options posts bare {messages}', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    await service.send({
      kind: 'narrowcast',
      token: FAKE_TOKEN,
      messages: [TEXT_MSG],
    });
    expect(postCall().body).toEqual({ messages: [TEXT_MSG] });
  });

  it('narrowcast is retry-eligible (docs list it for X-Line-Retry-Key): 500 then 200 → 2 attempts', async () => {
    postSpy
      .mockRejectedValueOnce(axiosError('boom', 500, {}))
      .mockResolvedValueOnce(lineOk({}));
    const res = await service.send({
      kind: 'narrowcast',
      token: FAKE_TOKEN,
      messages: [TEXT_MSG],
      retry: { maxAttempts: 2, baseDelayMs: 0 },
    });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
  });

  it('broadcast: posts {messages} with no recipient and a retry key', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    await service.send({
      kind: 'broadcast',
      token: FAKE_TOKEN,
      messages: [TEXT_MSG],
    });
    const { url, body, config } = postCall();
    expect(url).toBe(BROADCAST_URL);
    expect(body).toEqual({ messages: [TEXT_MSG] });
    expect(config.headers['X-Line-Retry-Key']).toMatch(UUID_RE);
  });

  it('loading: posts {chatId, loadingSeconds:20} by default, no retry key, messages not required', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    await service.send({
      kind: 'loading',
      token: FAKE_TOKEN,
      to: FAKE_USER_ID,
      messages: [],
    });
    const { url, body, config } = postCall();
    expect(url).toBe(LOADING_URL);
    expect(body).toEqual({ chatId: FAKE_USER_ID, loadingSeconds: 20 });
    expect(config.headers['X-Line-Retry-Key']).toBeUndefined();
  });

  it('a caller-supplied retryKey is sent verbatim, and echoed in the result', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    const res = await service.send(
      pushReq({ retryKey: '00000000-0000-4000-8000-000000000027' }),
    );
    expect(postCall().config.headers['X-Line-Retry-Key']).toBe(
      '00000000-0000-4000-8000-000000000027',
    );
    expect(res.retryKey).toBe('00000000-0000-4000-8000-000000000027');
  });

  it('timeoutMs overrides the default budget for this call only', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    await service.send(pushReq({ timeoutMs: 5000 }));
    expect(postCall().config.timeout).toBe(5000);
  });

  // ── result envelope ─────────────────────────────────────────────────────

  it('200: ok:true with LINE request id and body', async () => {
    postSpy.mockResolvedValueOnce(lineOk({ sentMessages: [] }, 'req-abc'));
    const res = await service.send(pushReq());
    expect(res).toMatchObject({
      ok: true,
      status: 200,
      lineRequestId: 'req-abc',
      attempts: 1,
      data: { sentMessages: [] },
    });
  });

  it('HTTP 400: ok:false, reason carries status + message + details + request id, raw error preserved', async () => {
    postSpy.mockRejectedValueOnce(
      axiosError(
        'Request failed with status code 400',
        400,
        {
          message: 'The request body has 1 error(s)',
          details: [
            { property: 'messages[0].text', message: 'May not be empty' },
          ],
        },
        { 'x-line-request-id': 'req-err-1' },
      ),
    );
    const res = await service.send(pushReq());
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.reason).toContain('HTTP 400');
    expect(res.reason).toContain('The request body has 1 error(s)');
    expect(res.reason).toContain('messages[0].text: May not be empty');
    expect(res.reason).toContain('req-err-1');
    // the raw axios error survives untouched — the line-send-adapter mistake
    // (wrapping into a new Error and losing .response) is forbidden here.
    expect(
      (res.raw as { response?: { status?: number } }).response?.status,
    ).toBe(400);
  });

  it('429: ok:false, never retried even when retry is enabled, Retry-After surfaced', async () => {
    postSpy.mockRejectedValueOnce(
      axiosError(
        'Too Many Requests',
        429,
        { message: 'Too many requests' },
        {
          'retry-after': '7',
        },
      ),
    );
    const res = await service.send(
      pushReq({ retry: { maxAttempts: 3, baseDelayMs: 0 } }),
    );
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    expect(res.reason).toContain('retry-after: 7');
  });

  it('transport failure (timeout/DNS): ok:false with status 0', async () => {
    postSpy.mockRejectedValueOnce(axiosError('timeout of 15000ms exceeded'));
    const res = await service.send(pushReq());
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.reason).toContain('timeout of 15000ms exceeded');
  });

  it('409 Conflict: treated as ALREADY DELIVERED — ok:true, no further attempt', async () => {
    postSpy.mockRejectedValueOnce(
      axiosError('Conflict', 409, { message: 'Already accepted' }),
    );
    const res = await service.send(
      pushReq({ retry: { maxAttempts: 3, baseDelayMs: 0 } }),
    );
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(409);
  });

  it('409 WITHOUT retry opt-in (push family) still means delivered — the key was sent regardless', async () => {
    postSpy.mockRejectedValueOnce(
      axiosError('Conflict', 409, { message: 'Already accepted' }),
    );
    const res = await service.send(pushReq());
    expect(res.ok).toBe(true);
    expect(res.status).toBe(409);
  });

  it('409 on a REPLY is a FAILURE — no retry key was ever sent, so 409 cannot mean delivered', async () => {
    postSpy.mockRejectedValueOnce(
      axiosError('Conflict', 409, { message: 'reply token used' }),
    );
    const res = await service.send({
      kind: 'reply',
      token: FAKE_TOKEN,
      replyToken: FAKE_REPLY_TOKEN,
      messages: [TEXT_MSG],
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(409);
    expect(res.reason).toContain('HTTP 409');
  });

  // ── R3 + R4: retry policy ───────────────────────────────────────────────

  it('DEFAULT IS ONE ATTEMPT: a 500 without opt-in retry is one call, one failure', async () => {
    postSpy.mockRejectedValueOnce(axiosError('boom', 500, { message: 'err' }));
    const res = await service.send(pushReq());
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(1);
  });

  it('opt-in retry: 500,500,200 → 3 attempts, SAME retry key on every attempt', async () => {
    postSpy
      .mockRejectedValueOnce(axiosError('boom', 500, {}))
      .mockRejectedValueOnce(axiosError('boom', 502, {}))
      .mockResolvedValueOnce(lineOk({}));
    const res = await service.send(
      pushReq({ retry: { maxAttempts: 3, baseDelayMs: 0 } }),
    );
    expect(postSpy).toHaveBeenCalledTimes(3);
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(3);
    const keys = [0, 1, 2].map(
      (n) => postCall(n).config.headers['X-Line-Retry-Key'],
    );
    expect(keys[0]).toMatch(UUID_RE);
    expect(new Set(keys).size).toBe(1);
  });

  it('retry stops dead on a 4xx: 500 then 400 → 2 attempts, ok:false', async () => {
    postSpy
      .mockRejectedValueOnce(axiosError('boom', 500, {}))
      .mockRejectedValueOnce(axiosError('bad', 400, { message: 'invalid' }));
    const res = await service.send(
      pushReq({ retry: { maxAttempts: 5, baseDelayMs: 0 } }),
    );
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.attempts).toBe(2);
  });

  it('retry budget exhausts: 500 × maxAttempts → ok:false with the last failure', async () => {
    postSpy
      .mockRejectedValueOnce(axiosError('boom', 500, {}))
      .mockRejectedValueOnce(axiosError('boom', 500, {}))
      .mockRejectedValueOnce(axiosError('boom', 503, {}));
    const res = await service.send(
      pushReq({ retry: { maxAttempts: 3, baseDelayMs: 0 } }),
    );
    expect(postSpy).toHaveBeenCalledTimes(3);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(res.attempts).toBe(3);
  });

  it('transport failure IS retryable when retry is on: timeout then 200 → 2 attempts', async () => {
    postSpy
      .mockRejectedValueOnce(axiosError('timeout of 15000ms exceeded'))
      .mockResolvedValueOnce(lineOk({}));
    const res = await service.send(
      pushReq({ retry: { maxAttempts: 3, baseDelayMs: 0 } }),
    );
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
  });

  it('backoff doubles: baseDelayMs 5 → waits 5 then 10 between attempts', async () => {
    const delays: number[] = [];
    const timeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((fn: () => void, ms?: number) => {
        delays.push(ms ?? 0);
        fn();
        return 0 as unknown as NodeJS.Timeout;
      });
    postSpy
      .mockRejectedValueOnce(axiosError('a', 500, {}))
      .mockRejectedValueOnce(axiosError('b', 500, {}))
      .mockResolvedValueOnce(lineOk({}));
    const res = await service.send(
      pushReq({ retry: { maxAttempts: 3, baseDelayMs: 5 } }),
    );
    timeoutSpy.mockRestore();
    expect(res.attempts).toBe(3);
    expect(delays).toEqual([5, 10]);
  });

  it('a retried send emits ONE audit event total, carrying the final attempts count', async () => {
    postSpy
      .mockRejectedValueOnce(axiosError('boom', 500, {}))
      .mockRejectedValueOnce(axiosError('boom', 500, {}))
      .mockResolvedValueOnce(lineOk({}));
    const events: Array<{ attempts: number }> = [];
    await service.send(
      pushReq({
        retry: { maxAttempts: 3, baseDelayMs: 0 },
        onAudit: (e) => events.push(e),
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ attempts: 3, ok: true });
  });

  it('maxAttempts is capped at 5 — a huge value cannot hot-loop send()', async () => {
    postSpy.mockRejectedValue(axiosError('boom', 500, {}));
    const res = await service.send(
      pushReq({ retry: { maxAttempts: 50, baseDelayMs: 0 } }),
    );
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(5);
  });

  it('retry.maxAttempts of 0 / NaN is clamped to ONE attempt — send never returns undefined', async () => {
    postSpy.mockRejectedValue(axiosError('boom', 500, {}));
    const zero = await service.send(
      pushReq({ retry: { maxAttempts: 0, baseDelayMs: 0 } }),
    );
    expect(zero).toBeDefined();
    expect(zero.ok).toBe(false);
    expect(zero.attempts).toBe(1);
    const nan = await service.send(
      pushReq({ retry: { maxAttempts: Number.NaN, baseDelayMs: 0 } }),
    );
    expect(nan.attempts).toBe(1);
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it('retry on a REPLY is programmer error: throws before any network call', async () => {
    await expect(
      service.send({
        kind: 'reply',
        token: FAKE_TOKEN,
        replyToken: FAKE_REPLY_TOKEN,
        messages: [TEXT_MSG],
        retry: { maxAttempts: 2 },
      }),
    ).rejects.toThrow(/reply/i);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('retry on LOADING is programmer error too: throws before any network call', async () => {
    await expect(
      service.send({
        kind: 'loading',
        token: FAKE_TOKEN,
        to: FAKE_USER_ID,
        messages: [],
        retry: { maxAttempts: 2 },
      }),
    ).rejects.toThrow(/loading/i);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('loadingSeconds overrides the default 20', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    await service.send({
      kind: 'loading',
      token: FAKE_TOKEN,
      to: FAKE_USER_ID,
      messages: [],
      loadingSeconds: 45,
    });
    expect(postCall().body).toEqual({
      chatId: FAKE_USER_ID,
      loadingSeconds: 45,
    });
  });

  // ── R5: guards fail loudly BEFORE the network ───────────────────────────

  it.each([
    ['0 messages', []],
    ['6 messages', Array.from({ length: 6 }, () => TEXT_MSG)],
  ])('%s → throws before any network call', async (_label, messages) => {
    await expect(service.send(pushReq({ messages: messages }))).rejects.toThrow(
      /messages/i,
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('push without `to` → throws before any network call', async () => {
    await expect(service.send(pushReq({ to: undefined }))).rejects.toThrow(
      /to/i,
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('multicast with an empty `to` array → throws before any network call', async () => {
    await expect(
      service.send({
        kind: 'multicast',
        token: FAKE_TOKEN,
        to: [],
        messages: [TEXT_MSG],
      }),
    ).rejects.toThrow(/to/i);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('reply without a replyToken → throws before any network call', async () => {
    await expect(
      service.send({ kind: 'reply', token: FAKE_TOKEN, messages: [TEXT_MSG] }),
    ).rejects.toThrow(/replyToken/i);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('empty token is a RUNTIME failure, not a throw: ok:false, status 0, no network', async () => {
    // hooks legitimately carry no token (line-api.service.ts:31-37 documents
    // the `Bearer undefined` legacy) — the caller decides what that means, so
    // the core reports instead of throwing. ไม่มี token = รายงาน ไม่ใช่ระเบิด
    const events: Array<{ attempts: number; retryKey?: string }> = [];
    const res = await service.send(
      pushReq({ token: '', onAudit: (e) => events.push(e) }),
    );
    expect(postSpy).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.reason).toMatch(/token/i);
    // no call was made, so NO retry key may be reported as "sent" — a caller
    // persisting the result into webhook_logs must not record a phantom key.
    expect(res.retryKey).toBeUndefined();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ attempts: 0 });
    expect(events[0]?.retryKey).toBeUndefined();
  });

  it('sendOrThrow on the empty-token result throws a plain Error naming the reason (raw is not an Error)', async () => {
    await expect(service.sendOrThrow(pushReq({ token: '' }))).rejects.toThrow(
      /token/i,
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('describeLineFailure never yields the literal string "undefined" as a reason', () => {
    expect(describeLineFailure({}).status).toBe(0);
    expect(describeLineFailure({}).reason).not.toBe('undefined');
    expect(describeLineFailure(undefined).reason).not.toBe('undefined');
  });

  // ── R6: audit ───────────────────────────────────────────────────────────

  it('emits exactly one audit event on success, carrying the LINE guideline fields', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}, 'req-audit'));
    const events: unknown[] = [];
    await service.send(pushReq({ onAudit: (e) => events.push(e) }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'push',
      endpoint: PUSH_URL,
      method: 'POST',
      ok: true,
      status: 200,
      lineRequestId: 'req-audit',
      attempts: 1,
    });
    expect(
      (events[0] as { durationMs: number }).durationMs,
    ).toBeGreaterThanOrEqual(0);
  });

  it('emits exactly one audit event on failure too — a failed call is still a logged call', async () => {
    postSpy.mockRejectedValueOnce(axiosError('boom', 500, { message: 'x' }));
    const events: Array<{ ok: boolean; status: number }> = [];
    await service.send(pushReq({ onAudit: (e) => events.push(e) }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ok: false, status: 500 });
  });

  it('an audit callback that itself throws does not break the send', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    const res = await service.send(
      pushReq({
        onAudit: () => {
          throw new Error('audit sink is broken');
        },
      }),
    );
    expect(res.ok).toBe(true);
  });

  // ── sendOrThrow ─────────────────────────────────────────────────────────

  it('sendOrThrow returns the result when ok', async () => {
    postSpy.mockResolvedValueOnce(lineOk({}));
    const res = await service.sendOrThrow(pushReq());
    expect(res.ok).toBe(true);
  });

  it('sendOrThrow rethrows the RAW axios error — .response.status must survive', async () => {
    postSpy.mockRejectedValueOnce(
      axiosError('Request failed with status code 401', 401, {
        message: 'Authentication failed',
      }),
    );
    await expect(service.sendOrThrow(pushReq())).rejects.toMatchObject({
      response: { status: 401 },
    });
  });
});
