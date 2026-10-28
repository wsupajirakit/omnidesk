import axios from 'axios';

import {
  InlineLinePushQueue,
  LinePushDispatcher,
  LinePushService,
} from '@/infra/line';
import type { LineSendRequest, LineSendResult } from '@/infra/line';

/**
 * ==== [FEAT-20260820-LINEPUSH25] the wrapper (ตัวห่อ) — pass-through pinned ====
 *
 * Phase 2.5. `LinePushDispatcher` is the seam future callers use so that a
 * real queue (bullmq is ALREADY a declared dependency, package.json:45, with
 * ZERO imports in src today) can slot in later without touching any caller.
 * Until that day the wrapper must be a GLASS PIPE: same request object in,
 * same result object out, exactly one delegation, no transformation, no
 * added failure mode. That is what this file pins — a dispatcher that pages,
 * batches, clones or "improves" the request breaks these cases by design.
 * ตัวห่อวันนี้ต้องใส 100% — ห้ามมีพฤติกรรมของตัวเอง.
 *
 * No real LINE traffic: axios/fetch reject by default in every case.
 */

const FAKE_TOKEN = 'unit-test-not-a-real-channel-token';
const FAKE_USER_ID = 'unit-test-user-id';

const pushReq = (): LineSendRequest => ({
  kind: 'push',
  token: FAKE_TOKEN,
  to: FAKE_USER_ID,
  messages: [{ type: 'text', text: 'hello' }],
});

describe('LinePushDispatcher — the queue-ready wrapper (no real LINE traffic)', () => {
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    const reject = (target: unknown) =>
      Promise.reject(
        new Error(`unstubbed outbound request: ${String(target)}`),
      );
    postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementation((url: unknown) => reject(url));
    jest.spyOn(axios, 'get').mockImplementation((url: unknown) => reject(url));
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        reject(input instanceof Request ? input.url : String(input)),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('dispatch() hands the EXACT request object to send() and returns its EXACT result — a glass pipe', async () => {
    const service = new LinePushService();
    const sentinel = { ok: true, status: 200 } as LineSendResult;
    const sendSpy = jest.spyOn(service, 'send').mockResolvedValueOnce(sentinel);
    const dispatcher = new LinePushDispatcher(new InlineLinePushQueue(service));

    const req = pushReq();
    const result = await dispatcher.dispatch(req);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    // identity, not equality: the wrapper may not clone or rebuild either side
    expect(sendSpy.mock.calls[0]?.[0]).toBe(req);
    expect(result).toBe(sentinel);
  });

  it('end to end through the real send(): one wire call, ok result — the wrapper adds nothing', async () => {
    postSpy.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: {},
      headers: { 'x-line-request-id': 'req-d-1' },
      config: {},
    });
    const dispatcher = new LinePushDispatcher(
      new InlineLinePushQueue(new LinePushService()),
    );
    const result = await dispatcher.dispatch(pushReq());
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.lineRequestId).toBe('req-d-1');
  });

  it('a failing send flows through unchanged — the wrapper never converts a result into a throw', async () => {
    postSpy.mockRejectedValueOnce(
      Object.assign(new Error('boom'), {
        isAxiosError: true,
        response: { status: 500, data: {}, headers: {} },
      }),
    );
    const dispatcher = new LinePushDispatcher(
      new InlineLinePushQueue(new LinePushService()),
    );
    const result = await dispatcher.dispatch(pushReq());
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });
});
