import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import type { AxiosResponse } from 'axios';

import { LineApiService } from '@/modules/webhook';

/**
 * The five LINE Messaging API calls, pinned against a stubbed HTTP client.
 *
 * ── WHY THIS IS A UNIT TEST AND NOT A GOLDEN COMPARISON ─────────────────────
 * These five are not reachable over HTTP on either backend yet: the service is
 * deliberately not wired into `webhook.service.ts` (that is a later stage), so
 * there is no route to drive and nothing to diff end to end. What *can* be
 * pinned is the request each function would put on the wire and the exact value
 * it hands back on 200 / 401 / 5xx / network failure — which is precisely what
 * the callers branch on. Each expectation below is transcribed from
 * legacy-api/src/controllers/core-bot/webhookController.js line by line, with
 * the legacy line number named, so a reviewer can check the source rather than
 * trusting the test name.
 *
 * That limit is stated plainly: this proves the port matches the legacy *code*,
 * not that a legacy *process* answers this way today.
 *
 * ── WHY NOTHING HERE CAN REACH LINE ─────────────────────────────────────────
 * Two constraints, both absolute:
 *   · a real send would deliver a real message to a real customer — legacy is a
 *     clone of production and its channel tokens are live;
 *   · a reply token is single-use, so even one accidental send corrupts state.
 *
 * So `axios.post`, `axios.get` AND `globalThis.fetch` are all replaced for this
 * whole file with implementations that REJECT by default. An outbound call a
 * case did not explicitly stub is a hard failure with the attempted URL in the
 * message, not a silent fallthrough — the property copied from
 * z-test/unit/model-list.spec.ts, and the reason that file is trustworthy.
 * Every case also asserts the call count, so an edit that adds a second request
 * fails loudly. `fetch` is stubbed even though the service does not use it,
 * so that a future rewrite onto `fetch` cannot quietly escape this net.
 *
 * ── NO CREDENTIALS ──────────────────────────────────────────────────────────
 * The token and user id below are obvious fakes, asserted as such. No value in
 * this file came from a hook row, a `.env`, or a captured request.
 */

/** Never a real channel token — asserted below to be exactly what is sent. */
const FAKE_TOKEN = 'unit-test-not-a-real-channel-token';
/** Not a LINE user id: real ones are `U` + 32 hex. This is neither. */
const FAKE_USER_ID = 'unit-test-user-id';
const FAKE_REPLY_TOKEN = 'unit-test-reply-token';

const REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LOADING_URL = 'https://api.line.me/v2/bot/chat/loading/start';
const PROFILE_URL_PREFIX = 'https://api.line.me/v2/bot/profile/';

/** legacy:2168 — `LINE_HTTP_TIMEOUT_MS`, shared by all five. */
const TIMEOUT_MS = 15_000;

/** What a caller reads off a resolved LINE call: `.status` and `.data`. */
const lineOk = (data: unknown = {}): AxiosResponse<unknown> =>
  ({
    status: 200,
    statusText: 'OK',
    data,
    headers: {},
    config: {},
  }) as unknown as AxiosResponse<unknown>;

/**
 * An axios rejection as legacy sees it.
 *
 * With `status`, this is an HTTP failure and `response.data` carries LINE's
 * body. Without, it is a transport failure (timeout / DNS / reset) and there is
 * no `response` at all — the case `sendLineFlexReply`'s
 * `err.response?.data || err.message` falls back on.
 */
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

/** LINE's own 401 body, as the docs describe it. */
const UNAUTHORIZED_BODY = { message: 'Authentication failed' };
/** LINE's 404 on a user who never added the OA. */
const NOT_FOUND_BODY = { message: 'Not found' };

/** The three positional arguments of an `axios.post` call. */
interface PostCall {
  url: string;
  body: Record<string, unknown>;
  config: { headers: Record<string, string>; timeout: number };
}

describe('LineApiService — the five LINE calls (no real LINE traffic)', () => {
  let service: LineApiService;
  let postSpy: jest.SpyInstance;
  let getSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
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

    // Legacy writes these with console.*; captured here both to keep the run
    // quiet and because WHAT each function logs is part of what was ported.
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    const moduleRef = await Test.createTestingModule({
      providers: [LineApiService],
    }).compile();

    service = moduleRef.get(LineApiService);

    // Nest itself logs "RootTestModule dependencies initialized" through the
    // same Logger. Dropped here so the log assertions below count only what the
    // service under test wrote.
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The nth `axios.post`, unpacked. */
  const postCall = (n = 0): PostCall => {
    const call = postSpy.mock.calls[n] as unknown[];
    return {
      url: call[0] as string,
      body: call[1] as Record<string, unknown>,
      config: call[2] as PostCall['config'],
    };
  };

  /** Nothing left the process except the one call under test. */
  const expectExactlyOneOutbound = (kind: 'post' | 'get') => {
    expect(postSpy).toHaveBeenCalledTimes(kind === 'post' ? 1 : 0);
    expect(getSpy).toHaveBeenCalledTimes(kind === 'get' ? 1 : 0);
    expect(fetchSpy).not.toHaveBeenCalled();
  };

  // ── sendLineReplyMessage — legacy:958 ────────────────────────────────────

  describe('sendLineReplyMessage (legacy:958)', () => {
    it('posts the reply endpoint with the exact body, headers and timeout', async () => {
      const response = lineOk({ sentMessages: [{ id: '1', quoteToken: 'q' }] });
      postSpy.mockResolvedValueOnce(response);

      const result = await service.sendLineReplyMessage(
        FAKE_TOKEN,
        FAKE_REPLY_TOKEN,
        'hello',
      );

      expectExactlyOneOutbound('post');
      const { url, body, config } = postCall();

      expect(url).toBe(REPLY_URL);
      // Exact equality, not toMatchObject: an extra key on the message is a
      // different request to LINE and must fail here.
      expect(body).toEqual({
        replyToken: FAKE_REPLY_TOKEN,
        messages: [{ type: 'text', text: 'hello' }],
      });
      expect(config.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FAKE_TOKEN}`,
      });
      expect(config.timeout).toBe(TIMEOUT_MS);

      // The WHOLE response, not the body — legacy:3779-3787 reads `.status`
      // into http_status and `.data` into response_summary.
      expect(result).toBe(response);
    });

    it('omits quickReply entirely when it is null (the default)', async () => {
      postSpy.mockResolvedValueOnce(lineOk());

      await service.sendLineReplyMessage(FAKE_TOKEN, FAKE_REPLY_TOKEN, 'hi');

      const message = (
        postCall().body['messages'] as Record<string, unknown>[]
      )[0]!;
      // `in`, not a truthiness check: `quickReply: undefined` would serialise
      // away but is still a different object, and legacy never creates the key.
      expect('quickReply' in message).toBe(false);
      expect(Object.keys(message)).toEqual(['type', 'text']);
    });

    it('appends quickReply after the text when one is given', async () => {
      postSpy.mockResolvedValueOnce(lineOk());
      const quickReply = {
        items: [
          {
            type: 'action',
            action: { type: 'message', label: 'ok', text: 'ok' },
          },
        ],
      };

      await service.sendLineReplyMessage(
        FAKE_TOKEN,
        FAKE_REPLY_TOKEN,
        'hi',
        quickReply,
      );

      expect(postCall().body['messages']).toEqual([
        { type: 'text', text: 'hi', quickReply },
      ]);
    });

    it('lets a 401 escape unchanged — legacy has no try/catch here', async () => {
      const failure = axiosError(
        'Request failed with status code 401',
        401,
        UNAUTHORIZED_BODY,
      );
      postSpy.mockRejectedValue(failure);

      // The identity matters: legacy:3851 catches this and reads `.message`.
      await expect(
        service.sendLineReplyMessage(FAKE_TOKEN, FAKE_REPLY_TOKEN, 'hi'),
      ).rejects.toBe(failure);

      // and it is catchable in the shape that caller uses.
      const caught = await service
        .sendLineReplyMessage(FAKE_TOKEN, FAKE_REPLY_TOKEN, 'hi')
        .catch((err: Error) => err.message);
      expect(caught).toBe('Request failed with status code 401');

      // No retry: legacy has none, so two calls for two invocations.
      expect(postSpy).toHaveBeenCalledTimes(2);
      // and it logs NOTHING itself — the caller owns the logging.
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('lets a 500 escape unchanged and does not retry', async () => {
      const failure = axiosError('Request failed with status code 500', 500, {
        message: 'internal error',
      });
      postSpy.mockRejectedValueOnce(failure);

      await expect(
        service.sendLineReplyMessage(FAKE_TOKEN, FAKE_REPLY_TOKEN, 'hi'),
      ).rejects.toBe(failure);
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    it('lets a transport failure escape unchanged', async () => {
      const failure = axiosError('timeout of 15000ms exceeded');
      postSpy.mockRejectedValueOnce(failure);

      await expect(
        service.sendLineReplyMessage(FAKE_TOKEN, FAKE_REPLY_TOKEN, 'hi'),
      ).rejects.toBe(failure);
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    it('still sends when the token is absent — legacy does not check it', async () => {
      postSpy.mockResolvedValueOnce(lineOk());

      // The wiring stage decrypts `hook.line_key`, which can be missing. Legacy
      // interpolates regardless and lets LINE answer 401; a guard added here
      // would short-circuit and change which branch the webhook takes.
      await service.sendLineReplyMessage(
        undefined as unknown as string,
        FAKE_REPLY_TOKEN,
        'hi',
      );

      expectExactlyOneOutbound('post');
      expect(postCall().config.headers['Authorization']).toBe(
        'Bearer undefined',
      );
    });
  });

  // ── sendLineFlexReply — legacy:129 ───────────────────────────────────────

  describe('sendLineFlexReply (legacy:129)', () => {
    const CONTENTS = {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [] },
    };

    it('posts a flex message to the reply endpoint with the same headers and timeout', async () => {
      const response = lineOk({ sentMessages: [] });
      postSpy.mockResolvedValueOnce(response);

      const result = await service.sendLineFlexReply(
        FAKE_TOKEN,
        FAKE_REPLY_TOKEN,
        CONTENTS,
        'รายละเอียดการโอนเงิน',
      );

      expectExactlyOneOutbound('post');
      const { url, body, config } = postCall();

      expect(url).toBe(REPLY_URL);
      expect(body).toEqual({
        replyToken: FAKE_REPLY_TOKEN,
        messages: [
          {
            type: 'flex',
            altText: 'รายละเอียดการโอนเงิน',
            contents: CONTENTS,
          },
        ],
      });
      expect(config.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FAKE_TOKEN}`,
      });
      expect(config.timeout).toBe(TIMEOUT_MS);
      expect(result).toBe(response);
    });

    it('defaults altText to the English "Bank Transfer Details"', async () => {
      postSpy.mockResolvedValueOnce(lineOk());

      await service.sendLineFlexReply(FAKE_TOKEN, FAKE_REPLY_TOKEN, CONTENTS);

      const message = (
        postCall().body['messages'] as Record<string, unknown>[]
      )[0]!;
      expect(message['altText']).toBe('Bank Transfer Details');
      expect(Object.keys(message)).toEqual(['type', 'altText', 'contents']);
    });

    it('appends quickReply when one is given', async () => {
      postSpy.mockResolvedValueOnce(lineOk());
      const quickReply = { items: [] };

      await service.sendLineFlexReply(
        FAKE_TOKEN,
        FAKE_REPLY_TOKEN,
        CONTENTS,
        'alt',
        quickReply,
      );

      const message = (
        postCall().body['messages'] as Record<string, unknown>[]
      )[0]!;
      expect(message['quickReply']).toBe(quickReply);
    });

    it('logs the whole payload on the success path — unconditionally, on one line', async () => {
      postSpy.mockResolvedValueOnce(lineOk());

      await service.sendLineFlexReply(FAKE_TOKEN, FAKE_REPLY_TOKEN, CONTENTS);

      // legacy:139 — no debug flag guards this; operators read it.
      expect(logSpy).toHaveBeenCalledTimes(1);
      const line = String(logSpy.mock.calls[0]![0]);
      expect(line).toContain(
        '[FLEX-DEBUG] Sending Flex Message. Payload Contents:',
      );
      /* [PERF-20260824-FLEXLOGCOMPACT] FLIPPED, not deleted.
       *
       * This case used to demand `JSON.stringify(CONTENTS, null, 2)` — the
       * indented form. Owner decision 2026-08-24: the operator signal stays, the
       * padding goes. The pretty-print ran synchronously on the reply path before
       * every send, and on a carousel (up to 10 bubbles) the indentation roughly
       * tripled the bytes and turned one log entry into hundreds of lines.
       *
       * The DATA assertion is not weakened — it still demands the complete
       * payload, and the compact form is NOT a substring of the indented one, so
       * putting `null, 2` back turns this red rather than passing either way.
       */
      expect(line).toContain(JSON.stringify(CONTENTS));
      // ...and the entry must stay on ONE line. Restoring the indentation puts
      // real newlines back into the payload segment; this is what catches it.
      expect(line.split('\n')).toHaveLength(1);
      // The token never appears in that log.
      expect(line).not.toContain(FAKE_TOKEN);
    });

    it('on a 401 logs LINE’s response body and rethrows the same error', async () => {
      const failure = axiosError(
        'Request failed with status code 401',
        401,
        UNAUTHORIZED_BODY,
      );
      postSpy.mockRejectedValueOnce(failure);

      await expect(
        service.sendLineFlexReply(FAKE_TOKEN, FAKE_REPLY_TOKEN, CONTENTS),
      ).rejects.toBe(failure);

      // `err.response?.data` won the `||`, so the BODY is logged, not the message.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]![0])).toBe(
        `Failed to send LINE Flex reply: ${JSON.stringify(UNAUTHORIZED_BODY, null, 2)}`,
      );
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    it('on a 5xx logs the response body and rethrows', async () => {
      const body = { message: 'internal error' };
      const failure = axiosError(
        'Request failed with status code 500',
        500,
        body,
      );
      postSpy.mockRejectedValueOnce(failure);

      await expect(
        service.sendLineFlexReply(FAKE_TOKEN, FAKE_REPLY_TOKEN, CONTENTS),
      ).rejects.toBe(failure);
      expect(String(errorSpy.mock.calls[0]![0])).toBe(
        `Failed to send LINE Flex reply: ${JSON.stringify(body, null, 2)}`,
      );
    });

    it('on a transport failure falls back to the message, JSON-quoted', async () => {
      const failure = axiosError('timeout of 15000ms exceeded');
      postSpy.mockRejectedValueOnce(failure);

      await expect(
        service.sendLineFlexReply(FAKE_TOKEN, FAKE_REPLY_TOKEN, CONTENTS),
      ).rejects.toBe(failure);

      // There is no `response`, so `|| err.message` fires and JSON.stringify
      // wraps the bare string in quotes. That double-quoting is legacy's.
      expect(String(errorSpy.mock.calls[0]![0])).toBe(
        'Failed to send LINE Flex reply: "timeout of 15000ms exceeded"',
      );
    });
  });

  // ── sendLinePushMessage — legacy:1985 ────────────────────────────────────

  describe('sendLinePushMessage (legacy:1985)', () => {
    it('posts the push endpoint with `to` and a single text message', async () => {
      const response = lineOk({ sentMessages: [] });
      postSpy.mockResolvedValueOnce(response);

      const result = await service.sendLinePushMessage(
        FAKE_TOKEN,
        FAKE_USER_ID,
        'pushed',
      );

      expectExactlyOneOutbound('post');
      const { url, body, config } = postCall();

      expect(url).toBe(PUSH_URL);
      expect(body).toEqual({
        to: FAKE_USER_ID,
        messages: [{ type: 'text', text: 'pushed' }],
      });
      expect(config.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FAKE_TOKEN}`,
      });
      expect(config.timeout).toBe(TIMEOUT_MS);
      expect(result).toBe(response);
    });

    it('has no quickReply parameter at all — a push cannot carry one', () => {
      // Not cosmetic: the reply path computes a quick reply for slip errors and
      // silently loses it whenever the flow falls back to push (legacy:4788).
      expect(service.sendLinePushMessage.length).toBe(3);
    });

    it('lets a 401 escape unchanged, logging nothing, without retrying', async () => {
      const failure = axiosError(
        'Request failed with status code 401',
        401,
        UNAUTHORIZED_BODY,
      );
      postSpy.mockRejectedValueOnce(failure);

      await expect(
        service.sendLinePushMessage(FAKE_TOKEN, FAKE_USER_ID, 'x'),
      ).rejects.toBe(failure);
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('lets a 5xx and a transport failure escape unchanged', async () => {
      const httpFailure = axiosError(
        'Request failed with status code 503',
        503,
        {},
      );
      postSpy.mockRejectedValueOnce(httpFailure);
      await expect(
        service.sendLinePushMessage(FAKE_TOKEN, FAKE_USER_ID, 'x'),
      ).rejects.toBe(httpFailure);

      const netFailure = axiosError('timeout of 15000ms exceeded');
      postSpy.mockRejectedValueOnce(netFailure);
      await expect(
        service.sendLinePushMessage(FAKE_TOKEN, FAKE_USER_ID, 'x'),
      ).rejects.toBe(netFailure);
    });
  });

  // ── sendLineLoadingIndicator — legacy:2007 ───────────────────────────────

  describe('sendLineLoadingIndicator (legacy:2007)', () => {
    it('posts chatId and the default 20 loadingSeconds', async () => {
      const response = lineOk({});
      postSpy.mockResolvedValueOnce(response);

      const result = await service.sendLineLoadingIndicator(
        FAKE_TOKEN,
        FAKE_USER_ID,
      );

      expectExactlyOneOutbound('post');
      const { url, body, config } = postCall();

      expect(url).toBe(LOADING_URL);
      expect(body).toEqual({ chatId: FAKE_USER_ID, loadingSeconds: 20 });
      expect(config.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FAKE_TOKEN}`,
      });
      expect(config.timeout).toBe(TIMEOUT_MS);
      expect(result).toBe(response);
    });

    it('passes an explicit loadingSeconds through', async () => {
      postSpy.mockResolvedValueOnce(lineOk());
      await service.sendLineLoadingIndicator(FAKE_TOKEN, FAKE_USER_ID, 5);
      expect(postCall().body['loadingSeconds']).toBe(5);
    });

    it.each([
      [
        '401',
        axiosError(
          'Request failed with status code 401',
          401,
          UNAUTHORIZED_BODY,
        ),
      ],
      ['5xx', axiosError('Request failed with status code 500', 500, {})],
      ['transport failure', axiosError('timeout of 15000ms exceeded')],
    ])('swallows a %s and resolves undefined', async (_label, failure) => {
      postSpy.mockRejectedValueOnce(failure);

      // RESOLVES. It must never reject: legacy:2583 fires it without awaiting,
      // and a cosmetic indicator is not allowed to abort a customer reply.
      await expect(
        service.sendLineLoadingIndicator(FAKE_TOKEN, FAKE_USER_ID),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]![0])).toBe(
        `Failed to send LINE loading indicator: ${failure.message}`,
      );
      // The message only — LINE's body is NOT logged here, unlike the flex path.
      expect(String(errorSpy.mock.calls[0]![0])).not.toContain(
        'Authentication failed',
      );
      expect(postSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── getLineProfile — legacy:2028 ─────────────────────────────────────────

  describe('getLineProfile (legacy:2028)', () => {
    const PROFILE = {
      userId: FAKE_USER_ID,
      displayName: 'Test Display Name',
      pictureUrl: 'https://example.invalid/p.jpg',
      statusMessage: 'hi',
    };

    it('GETs the profile URL with only Authorization, and returns the BODY', async () => {
      getSpy.mockResolvedValueOnce(lineOk(PROFILE));

      const result = await service.getLineProfile(FAKE_TOKEN, FAKE_USER_ID);

      expectExactlyOneOutbound('get');
      const call = getSpy.mock.calls[0] as unknown[];
      const config = call[1] as {
        headers: Record<string, string>;
        timeout: number;
      };

      expect(call[0]).toBe(`${PROFILE_URL_PREFIX}${FAKE_USER_ID}`);
      // No Content-Type on this GET — legacy sends Authorization alone.
      expect(config.headers).toEqual({ Authorization: `Bearer ${FAKE_TOKEN}` });
      expect(config.timeout).toBe(TIMEOUT_MS);

      // `response.data`, not the response — this is the one of the five that
      // unwraps (legacy:2038).
      expect(result).toEqual(PROFILE);
    });

    it('returns the body verbatim, keeping fields the webhook never reads', async () => {
      const withExtras = { ...PROFILE, language: 'th', somethingNew: 1 };
      getSpy.mockResolvedValueOnce(lineOk(withExtras));

      await expect(
        service.getLineProfile(FAKE_TOKEN, FAKE_USER_ID),
      ).resolves.toEqual(withExtras);
    });

    it.each([
      [
        '404',
        axiosError('Request failed with status code 404', 404, NOT_FOUND_BODY),
      ],
      [
        '401',
        axiosError(
          'Request failed with status code 401',
          401,
          UNAUTHORIZED_BODY,
        ),
      ],
      ['500', axiosError('Request failed with status code 500', 500, {})],
      ['transport failure', axiosError('timeout of 15000ms exceeded')],
    ])('returns null on a %s — never throws', async (_label, failure) => {
      getSpy.mockRejectedValueOnce(failure);

      await expect(
        service.getLineProfile(FAKE_TOKEN, FAKE_USER_ID),
      ).resolves.toBeNull();
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('gives a 404 and a network error the SAME answer — callers cannot tell them apart', async () => {
      getSpy.mockRejectedValueOnce(
        axiosError('Request failed with status code 404', 404, NOT_FOUND_BODY),
      );
      const onNotFound = await service.getLineProfile(FAKE_TOKEN, FAKE_USER_ID);

      getSpy.mockRejectedValueOnce(axiosError('timeout of 15000ms exceeded'));
      const onTimeout = await service.getLineProfile(FAKE_TOKEN, FAKE_USER_ID);

      // Both null. legacy:4382 then records BOTH as status "error",
      // http_status 0. Documented as a limitation, reproduced as behaviour.
      expect(onNotFound).toBeNull();
      expect(onTimeout).toBeNull();
      expect(onNotFound).toBe(onTimeout);
    });

    it('warns rather than errors on failure, naming the user id', async () => {
      const failure = axiosError(
        'Request failed with status code 404',
        404,
        NOT_FOUND_BODY,
      );
      getSpy.mockRejectedValueOnce(failure);

      await service.getLineProfile(FAKE_TOKEN, FAKE_USER_ID);

      // console.warn in legacy, not console.error — a missing profile is
      // expected traffic, not an incident.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
      const line = String(warnSpy.mock.calls[0]![0]);
      expect(line).toContain(FAKE_USER_ID);
      expect(line).toContain('Request failed with status code 404');
      expect(line).not.toContain(FAKE_TOKEN);
    });

    it('sends `undefined` in the path when the source carries no userId', async () => {
      getSpy.mockRejectedValueOnce(
        axiosError('Request failed with status code 400', 400, {}),
      );

      // legacy:4373 passes `event.source?.userId`, which is undefined for a
      // source type without one. No guard, no encoding: the request goes out.
      const result = await service.getLineProfile(
        FAKE_TOKEN,
        undefined as unknown as string,
      );

      expectExactlyOneOutbound('get');
      expect(getSpy.mock.calls[0]![0]).toBe(`${PROFILE_URL_PREFIX}undefined`);
      expect(result).toBeNull();
    });
  });

  // ── the shared budget ────────────────────────────────────────────────────

  it('applies the same 15000 ms timeout to all five calls', async () => {
    postSpy.mockResolvedValue(lineOk());
    getSpy.mockResolvedValue(lineOk({}));

    await service.sendLineReplyMessage(FAKE_TOKEN, FAKE_REPLY_TOKEN, 'a');
    await service.sendLineFlexReply(FAKE_TOKEN, FAKE_REPLY_TOKEN, {
      type: 'bubble',
    });
    await service.sendLinePushMessage(FAKE_TOKEN, FAKE_USER_ID, 'a');
    await service.sendLineLoadingIndicator(FAKE_TOKEN, FAKE_USER_ID);
    await service.getLineProfile(FAKE_TOKEN, FAKE_USER_ID);

    const timeouts = [
      ...postSpy.mock.calls.map((c) => (c[2] as { timeout: number }).timeout),
      ...getSpy.mock.calls.map((c) => (c[1] as { timeout: number }).timeout),
    ];
    expect(timeouts).toEqual([
      TIMEOUT_MS,
      TIMEOUT_MS,
      TIMEOUT_MS,
      TIMEOUT_MS,
      TIMEOUT_MS,
    ]);
  });

  it('sends a Bearer Authorization header on all five calls', async () => {
    postSpy.mockResolvedValue(lineOk());
    getSpy.mockResolvedValue(lineOk({}));

    await service.sendLineReplyMessage(FAKE_TOKEN, FAKE_REPLY_TOKEN, 'a');
    await service.sendLineFlexReply(FAKE_TOKEN, FAKE_REPLY_TOKEN, {
      type: 'bubble',
    });
    await service.sendLinePushMessage(FAKE_TOKEN, FAKE_USER_ID, 'a');
    await service.sendLineLoadingIndicator(FAKE_TOKEN, FAKE_USER_ID);
    await service.getLineProfile(FAKE_TOKEN, FAKE_USER_ID);

    const auths = [
      ...postSpy.mock.calls.map(
        (c) =>
          (c[2] as { headers: Record<string, string> }).headers[
            'Authorization'
          ],
      ),
      ...getSpy.mock.calls.map(
        (c) =>
          (c[1] as { headers: Record<string, string> }).headers[
            'Authorization'
          ],
      ),
    ];
    expect(auths).toEqual(Array(5).fill(`Bearer ${FAKE_TOKEN}`));
  });
});
