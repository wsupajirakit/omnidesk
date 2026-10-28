/*
 * The legacy implementation is plain CommonJS in a sibling checkout, so it can
 * only be reached through `require` with an explicit resolution path — there is
 * no import specifier that names it. `no-base-to-string` is off for the same
 * narrow reason: the `fetch` stub stringifies whatever it is handed purely to
 * put the attempted URL in a failure message, and that argument may legitimately
 * be a `Request`.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-base-to-string */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import type { AxiosResponse } from 'axios';

import { aiConfig } from '@/config/app.config';
import { QrVisionService } from '@/modules/slip';

/**
 * DIFFERENTIAL test: `QrVisionService` against the legacy JavaScript it was
 * ported from, driven through the SAME stubbed HTTP client on identical inputs.
 *
 * ── ⚠️ NOT ONE BYTE REACHES GEMINI ──────────────────────────────────────────
 * This is the file that bills. Three independent layers stand between this
 * suite and a real request, and none of them is defeated anywhere below:
 *
 *  1. `axios.get`, `axios.post` and `globalThis.fetch` are ALL replaced for the
 *     whole file with implementations that REJECT. An outbound call a case did
 *     not explicitly stub is a hard failure naming the attempted URL, not a
 *     silent fallthrough — the property copied from `line-api.spec.ts`. Both
 *     implementations share the one stub, which is also what makes the diff
 *     meaningful: the legacy module's own `axios` (a different physical copy,
 *     resolved out of the legacy checkout's `node_modules`) is `jest.doMock`ed
 *     onto the same recorder.
 *  2. `jest.config.ts`'s `setupFiles` installs `z-test/lib/no-ai-outbound.ts`,
 *     which throws on any `fetch` whose URL matches a provider host. Untouched.
 *  3. No real key is present. The key below is an obvious fake and is asserted
 *     to be exactly what appears in the URL — nothing was read from `.env`.
 *
 * `dotenv` is mocked out too, so requiring the legacy module cannot load the
 * legacy checkout's `.env` into this process's environment.
 *
 * ── WHAT IS COMPARED ────────────────────────────────────────────────────────
 * For every case: the returned boolean AND the ordered list of HTTP calls both
 * implementations attempted, with full arguments. A difference in either fails.
 * That covers the download options, the request URL (model id + key), the
 * Gemini payload, and the YES/TRUE parsing.
 *
 * The suite SKIPS rather than fails when the legacy checkout is not beside this
 * one, so it never turns red for a reason unrelated to the code under test.
 */
const LEGACY_ROOT = resolve(__dirname, '../../../legacy-api');
const LEGACY_SERVICE = `${LEGACY_ROOT}/src/services/core-bot/qrVisionService.js`;
const legacyAvailable = existsSync(LEGACY_SERVICE);

/** Never a real key — asserted below to be exactly what lands in the URL. */
const FAKE_KEY = 'unit-test-not-a-real-gemini-key';
/** Pinned on both sides so the URL is comparable and names no real model. */
const FAKE_MODEL_ID = 'unit-test-model';
const IMAGE_URL = 'http://localhost:4900/uploads/images/unit-test-slip.jpg';

/** One recorder, shared by the port and by legacy. */
interface HttpRecorder {
  get: jest.Mock;
  post: jest.Mock;
}
let recorder: HttpRecorder;

if (legacyAvailable) {
  /**
   * The legacy module resolves `axios` and `dotenv` out of ITS OWN
   * `node_modules`, which is a different physical copy from the one this repo
   * imports — spying on the port's `axios` therefore does nothing to legacy.
   * Mocking the resolved absolute paths is what puts both on one recorder.
   */
  const legacyAxios = require.resolve('axios', { paths: [LEGACY_ROOT] });
  const legacyDotenv = require.resolve('dotenv', { paths: [LEGACY_ROOT] });

  jest.doMock(legacyAxios, () => ({
    get: (...args: unknown[]) => recorder.get(...args),
    post: (...args: unknown[]) => recorder.post(...args),
  }));
  // Neutralised so `require("dotenv").config()` at legacy:1 cannot read the
  // legacy checkout's `.env` into this process.
  jest.doMock(legacyDotenv, () => ({ config: () => ({ parsed: {} }) }));
}

/** What axios hands back on 200. */
const httpOk = (
  data: unknown,
  headers: Record<string, string> = {},
): AxiosResponse<unknown> =>
  ({
    status: 200,
    statusText: 'OK',
    data,
    headers,
    config: {},
  }) as unknown as AxiosResponse<unknown>;

/** A Gemini body carrying one text part, the only path either side reads. */
const geminiSays = (text: string): unknown => ({
  candidates: [{ content: { parts: [{ text }] } }],
});

/** An axios rejection, with or without an HTTP response attached. */
const axiosError = (
  message: string,
  data?: unknown,
): Error & { response?: { data: unknown } } => {
  const err = new Error(message) as Error & {
    isAxiosError: boolean;
    response?: { data: unknown };
  };
  err.isAxiosError = true;
  if (data !== undefined) err.response = { data };
  return err;
};

/** The shape legacy exposes. */
interface LegacyQrVision {
  checkIfSlipWithQrCode(
    imageUrl: string | null | undefined,
    geminiKey?: string,
  ): Promise<boolean>;
}

const describeOrSkip = legacyAvailable ? describe : describe.skip;

describeOrSkip('qr-vision — port vs legacy, on one stubbed HTTP client', () => {
  let port: QrVisionService;
  let legacy: LegacyQrVision;
  let getSpy: jest.SpyInstance;
  let postSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;
  let loggerLog: jest.SpyInstance;
  let loggerError: jest.SpyInstance;
  let legacyConsoleLog: jest.SpyInstance;
  let legacyConsoleError: jest.SpyInstance;

  beforeAll(() => {
    // Set BEFORE requiring legacy: it reads MODEL_ID at module load (legacy:5).
    process.env['MODEL_ID'] = FAKE_MODEL_ID;
    legacy = require(LEGACY_SERVICE) as LegacyQrVision;
  });

  beforeEach(async () => {
    /**
     * Default implementation REJECTS. With the real client these are the calls
     * that would download an image and bill a Gemini generation, so an
     * unstubbed one must fail the test rather than escape the process.
     */
    recorder = {
      get: jest
        .fn()
        .mockImplementation((url: string) =>
          Promise.reject(new Error(`unstubbed outbound GET: ${url}`)),
        ),
      post: jest
        .fn()
        .mockImplementation((url: string) =>
          Promise.reject(new Error(`unstubbed outbound POST: ${url}`)),
        ),
    };

    // The port's own axios copy, pointed at the same recorder.
    getSpy = jest
      .spyOn(axios, 'get')
      .mockImplementation((...args: unknown[]) => recorder.get(...args));
    postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementation((...args: unknown[]) => recorder.post(...args));
    // Stubbed even though neither implementation uses it, so a future rewrite
    // onto `fetch` cannot quietly escape this net.
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        Promise.reject(new Error(`unstubbed outbound fetch: ${String(input)}`)),
      );

    // Both sides log the analysed URL and the model's raw text; silenced so the
    // run stays readable, on both the Nest logger and legacy's console.
    loggerLog = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    legacyConsoleLog = jest.spyOn(console, 'log').mockImplementation();
    legacyConsoleError = jest.spyOn(console, 'error').mockImplementation();

    const moduleRef = await Test.createTestingModule({
      providers: [
        QrVisionService,
        {
          provide: aiConfig.KEY,
          useValue: { geminiApiKey: FAKE_KEY, modelId: FAKE_MODEL_ID },
        },
      ],
    }).compile();
    port = moduleRef.get(QrVisionService);
  });

  afterEach(() => {
    getSpy.mockRestore();
    postSpy.mockRestore();
    fetchSpy.mockRestore();
    loggerLog.mockRestore();
    loggerError.mockRestore();
    legacyConsoleLog.mockRestore();
    legacyConsoleError.mockRestore();
  });

  /** Every call both implementations attempted, in order, with arguments. */
  const calls = (): unknown[][] => [
    ...recorder.get.mock.calls.map((c) => ['GET', ...c]),
    ...recorder.post.mock.calls.map((c) => ['POST', ...c]),
  ];

  /**
   * Runs BOTH implementations on the same input, each against a freshly primed
   * recorder, and returns their answers plus their attempted calls.
   *
   * `prime` is re-applied per side because a `mockResolvedValueOnce` queue is
   * consumed by whichever side runs first.
   */
  const runBoth = async (
    prime: () => void,
    imageUrl: string | null | undefined,
  ): Promise<{
    portResult: boolean;
    legacyResult: boolean;
    portCalls: unknown[][];
    legacyCalls: unknown[][];
  }> => {
    prime();
    const portResult = await port.checkIfSlipWithQrCode(imageUrl, FAKE_KEY);
    const portCalls = calls();

    recorder.get.mockClear();
    recorder.post.mockClear();
    prime();
    const legacyResult = await legacy.checkIfSlipWithQrCode(imageUrl, FAKE_KEY);
    const legacyCalls = calls();

    return { portResult, legacyResult, portCalls, legacyCalls };
  };

  /** Asserts the two agree on both the answer and the wire traffic. */
  const expectIdentical = (r: {
    portResult: boolean;
    legacyResult: boolean;
    portCalls: unknown[][];
    legacyCalls: unknown[][];
  }): void => {
    expect(r.portResult).toBe(r.legacyResult);

    /**
     * ⚠️ TWO deliberate divergences, both isolated here and both pinned below.
     *
     * [FEAT-20260908-GEMINIKEYHEADER] The port sends the API key in the
     * `x-goog-api-key` header; legacy appends it to the URL. Measured against the
     * live vendor on 08/09/2026: a forced 404 carried the LIVE KEY in
     * `err.config.url` in the query form and none in the header form, and axios
     * attaches that URL to every error this codebase logs.
     *
     * ⚠️ [FIX-20260809-QRTIMEOUT] the older divergence, unchanged.
     *
     * The port now sets `timeout` on both calls; legacy sets none. That is
     * intentional — no timeout means an axios call waits forever on a dead
     * socket, and the webhook task holding it never completes. Rather than
     * weaken this assertion (which is the whole value of a parity test), the
     * timeout is stripped from the port's calls before comparing, and asserted
     * SEPARATELY below. Everything else — method, URL, payload, order, count —
     * must still match legacy byte for byte.
     * ต่างจาก legacy จุดเดียวคือ timeout · ที่เหลือต้องเหมือนเป๊ะ.
     */
    const withoutTimeout = (calls: unknown[][]): unknown[][] =>
      calls.map((call) =>
        call
          .map((arg) => {
            if (arg && typeof arg === 'object' && 'timeout' in arg) {
              const {
                timeout: _t,
                headers: _h,
                ...rest
              } = arg as Record<string, unknown>;
              return rest;
            }
            /* the key left the URL — strip legacy's query so the PATH still
               compares byte for byte */
            if (typeof arg === 'string') {
              return arg.replace(/\?key=[^&]*/, '');
            }
            return arg;
          })
          // The POST previously passed NO config object at all, so removing its
          // only key must remove the argument too — otherwise the comparison
          // sees a trailing `{}` that legacy never sent.
          .filter(
            (arg) =>
              !(
                arg &&
                typeof arg === 'object' &&
                !Array.isArray(arg) &&
                Object.keys(arg).length === 0
              ),
          ),
      );

    /* Both sides go through the normaliser: it removes the port's timeout and
       key header, and the key query from whichever side still carries one — so
       legacy's URL and the port's URL are compared on their PATH, byte for byte,
       and every other argument is compared untouched. */
    expect(withoutTimeout(r.portCalls)).toEqual(withoutTimeout(r.legacyCalls));

    // …and the divergence itself is pinned, so it cannot silently disappear.
    for (const call of r.portCalls) {
      const cfg = call.find(
        (a) => a && typeof a === 'object' && 'timeout' in a,
      ) as Record<string, unknown> | undefined;
      expect(cfg?.timeout).toBe(15_000);
      /* [FEAT-20260908-GEMINIKEYHEADER] and the key really is on the request —
         stripping it above must not be able to hide its absence. Only the POST
         to the vendor carries it; the GET that downloads the image does not. */
      const isVendorPost = call.some(
        (a) => typeof a === 'string' && a.includes(':generateContent'),
      );
      if (isVendorPost) {
        expect(cfg?.['headers']).toEqual({ 'x-goog-api-key': FAKE_KEY });
      }
      /* no call may carry the key in its URL any more */
      for (const a of call) {
        if (typeof a === 'string') expect(a).not.toContain('key=');
      }
    }
  };

  it('a YES answer means true, and both build the same two requests', async () => {
    const r = await runBoth(() => {
      recorder.get.mockResolvedValueOnce(
        httpOk(Buffer.from('fake-image-bytes'), {
          'content-type': 'image/png',
        }),
      );
      recorder.post.mockResolvedValueOnce(httpOk(geminiSays('YES')));
    }, IMAGE_URL);

    expectIdentical(r);
    expect(r.portResult).toBe(true);
    expect(r.portCalls).toHaveLength(2);

    // legacy:18 — download options.
    //
    // ⚠️ [FIX-20260809-QRTIMEOUT] `timeout` is a DELIBERATE break from legacy.
    // Legacy sets none, which means an axios call waits FOREVER on a dead
    // socket and the webhook task holding it never finishes. The parity
    // assertion is updated rather than the code reverted — this is the one
    // place in this file where the port intentionally differs, and it is
    // asserted explicitly so the divergence stays visible instead of being
    // mistaken for drift. ตั้งใจต่างจาก legacy ตรงนี้จุดเดียว.
    expect(r.portCalls[0]).toEqual([
      'GET',
      IMAGE_URL,
      { responseType: 'arraybuffer', timeout: 15_000 },
    ]);

    /* legacy:23 put the model id AND the key, unencoded, in the query string.
       [FEAT-20260908-GEMINIKEYHEADER] the model id is still in the path; the key
       is not in the URL at all any more. */
    const [, url, payload, cfg] = r.portCalls[1] as [
      string,
      string,
      unknown,
      Record<string, unknown>,
    ];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${FAKE_MODEL_ID}:generateContent`,
    );
    // 🔴 no credential travels in the URL — the property the move bought
    expect(url).not.toContain(FAKE_KEY);
    expect(url).not.toContain('key=');
    // …and it really is sent, on the header, so the line above cannot pass by
    // the key having been dropped altogether
    expect(cfg['headers']).toEqual({ 'x-goog-api-key': FAKE_KEY });

    // legacy:24-45 — the payload, whole.
    expect(payload).toEqual({
      contents: [
        {
          parts: [
            {
              text: 'Is this image a money transfer slip containing a QR Code or Barcode? Answer only YES or NO.',
            },
            {
              inlineData: {
                mimeType: 'image/png',
                data: Buffer.from('fake-image-bytes').toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.1, topK: 1, topP: 0.1 },
    });
    /* legacy:48 sent no headers on the Gemini POST, and that used to be true of
       the port too. [FEAT-20260908-GEMINIKEYHEADER] it now sends exactly ONE, and
       the exact-keys assertion is kept (rather than loosened to `toContain`) so a
       THIRD header appearing here is still a failure. */
    const postCfg = r.portCalls[1]![3] as Record<string, unknown>;
    expect(Object.keys(postCfg).sort()).toEqual(['headers', 'timeout']);
    expect(postCfg.timeout).toBe(15_000);
    /* ⚠️ 15s, NOT the shared 45s ceiling. This lane keeps its own budget — see
       QR_HTTP_TIMEOUT_MS. Adopting `geminiHttpOpts` wholesale here would have
       tripled it silently. */
    expect(postCfg.headers).toEqual({ 'x-goog-api-key': FAKE_KEY });
  });

  it('a NO answer means false', async () => {
    const r = await runBoth(() => {
      recorder.get.mockResolvedValueOnce(
        httpOk(Buffer.from('x'), { 'content-type': 'image/jpeg' }),
      );
      recorder.post.mockResolvedValueOnce(httpOk(geminiSays('NO')));
    }, IMAGE_URL);

    expectIdentical(r);
    expect(r.portResult).toBe(false);
  });

  it('matches YES anywhere in the text, case-insensitively — legacy uses includes(), not equality', async () => {
    const r = await runBoth(() => {
      recorder.get.mockResolvedValueOnce(
        httpOk(Buffer.from('x'), { 'content-type': 'image/jpeg' }),
      );
      recorder.post.mockResolvedValueOnce(
        httpOk(geminiSays('  yes, it is a transfer slip with a QR code.  ')),
      );
    }, IMAGE_URL);

    expectIdentical(r);
    expect(r.portResult).toBe(true);
  });

  it('accepts TRUE as well as YES, and matches it mid-sentence', async () => {
    // Deliberately NOT the bare word: a bare "true" uppercases to exactly
    // "TRUE", so it cannot tell `includes('TRUE')` from `=== 'TRUE'`. A
    // mutation swapping those survived until this case was phrased this way.
    const r = await runBoth(() => {
      recorder.get.mockResolvedValueOnce(
        httpOk(Buffer.from('x'), { 'content-type': 'image/jpeg' }),
      );
      recorder.post.mockResolvedValueOnce(
        httpOk(geminiSays('Answer: true, a QR is present.')),
      );
    }, IMAGE_URL);

    expectIdentical(r);
    expect(r.portResult).toBe(true);
  });

  it('a "NO" that happens to contain YES still passes — the known false positive, transcribed not fixed', async () => {
    const r = await runBoth(() => {
      recorder.get.mockResolvedValueOnce(
        httpOk(Buffer.from('x'), { 'content-type': 'image/jpeg' }),
      );
      recorder.post.mockResolvedValueOnce(
        httpOk(geminiSays('NO — I cannot answer YES to that.')),
      );
    }, IMAGE_URL);

    expectIdentical(r);
    // Both say true. This documents legacy's behaviour; it is not an endorsement.
    expect(r.portResult).toBe(true);
  });

  it('falls back to image/jpeg when the download reports no content-type', async () => {
    const r = await runBoth(() => {
      recorder.get.mockResolvedValueOnce(httpOk(Buffer.from('x'), {}));
      recorder.post.mockResolvedValueOnce(httpOk(geminiSays('YES')));
    }, IMAGE_URL);

    expectIdentical(r);
    const [, , payload] = r.portCalls[1] as [
      string,
      string,
      { contents: { parts: { inlineData?: { mimeType: string } }[] }[] },
    ];
    expect(payload.contents[0]?.parts[1]?.inlineData?.mimeType).toBe(
      'image/jpeg',
    );
  });

  it('an empty candidates list means false', async () => {
    const r = await runBoth(() => {
      recorder.get.mockResolvedValueOnce(
        httpOk(Buffer.from('x'), { 'content-type': 'image/jpeg' }),
      );
      recorder.post.mockResolvedValueOnce(httpOk({ candidates: [] }));
    }, IMAGE_URL);

    expectIdentical(r);
    expect(r.portResult).toBe(false);
  });

  it('a failed download means false, and Gemini is never asked', async () => {
    const r = await runBoth(() => {
      recorder.get.mockRejectedValueOnce(axiosError('ECONNREFUSED'));
    }, IMAGE_URL);

    expectIdentical(r);
    expect(r.portResult).toBe(false);
    // The billing call is not reached when the image cannot be fetched.
    expect(recorder.post).toHaveBeenCalledTimes(0);
    expect(r.portCalls).toHaveLength(1);
  });

  it('a rejected Gemini call means false, not a throw', async () => {
    const r = await runBoth(() => {
      recorder.get.mockResolvedValueOnce(
        httpOk(Buffer.from('x'), { 'content-type': 'image/jpeg' }),
      );
      recorder.post.mockRejectedValueOnce(
        axiosError('Request failed with status code 400', {
          error: { message: 'API key not valid' },
        }),
      );
    }, IMAGE_URL);

    expectIdentical(r);
    expect(r.portResult).toBe(false);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])(
    'a falsy imageUrl (%s) returns false with ZERO requests',
    async (_label, value) => {
      const r = await runBoth(() => undefined, value);

      expectIdentical(r);
      expect(r.portResult).toBe(false);
      expect(r.portCalls).toEqual([]);
      expect(recorder.get).toHaveBeenCalledTimes(0);
      expect(recorder.post).toHaveBeenCalledTimes(0);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    },
  );

  it('never touches globalThis.fetch on any path exercised here', () => {
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});
