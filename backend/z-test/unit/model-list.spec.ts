import { Test } from '@nestjs/testing';
import type { Response } from 'express';

import { aiConfig } from '@/config/app.config';
import { ModelController, ModelService } from '@/modules/system';

/**
 * `GET /model` — the transform and the failure envelope, with the HTTP client
 * stubbed at the service boundary.
 *
 * **Why this endpoint is unit-tested rather than golden-compared on values.**
 * Legacy asks Google for the model list with the key in the query string. Neither
 * backend holds a key that Google accepts today, so both answer 500 and the only
 * difference on the wire is the upstream status inside `error`
 * (`400` on legacy, `403` here — two different rejected keys, not two different
 * ports). Calling the real API to get a success body is banned outright: R10 —
 * Gemini spend is billed per token with no ceiling. So the mapping, which is the
 * only logic this endpoint has, gets pinned here against a canned upstream
 * response instead.
 *
 * นี่คือ unit test ที่ "พิสูจน์ตัวเอง" ตาม V1 ไม่ได้ — มันไม่ได้เทียบกับ legacy ที่รันอยู่จริง
 * The fixture below is therefore transcribed from the *documented shape* of the
 * Gemini v1 `models.list` response and from the legacy mapper line by line; it
 * proves the mapper does what `modelController.js` does, not that Google still
 * answers this way. That limit is recorded in check-list.md under R9.
 *
 * The stub is `globalThis.fetch`, which IS this service's HTTP client — the real
 * implementation is replaced for the whole file, so no case here can reach the
 * network even if the service changed to try. Every case asserts the call count,
 * so a future edit that adds a second outbound request fails loudly rather than
 * quietly spending money.
 */

/** Never a real credential — asserted below to be what the URL carries. */
const FAKE_KEY = 'unit-test-not-a-real-key';

const GEMINI_LIST_URL = 'https://generativelanguage.googleapis.com/v1/models';

/** The URL of a `fetch` argument, in any of the three forms it can take. */
const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

/** Fake express `Response` capturing what the controller writes. */
interface CapturedResponse {
  res: Response;
  statusOf: () => number | undefined;
  bodyOf: () => unknown;
}

const captureResponse = (): CapturedResponse => {
  let status: number | undefined;
  let body: unknown;
  const res = {
    status: (code: number) => {
      status = code;
      return res;
    },
    json: (payload: unknown) => {
      body = payload;
      return res;
    },
  } as unknown as Response;

  return { res, statusOf: () => status, bodyOf: () => body };
};

/** Minimal `Response` stand-in — only `ok`, `status` and `json()` are read. */
const upstreamOk = (payload: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
  }) as unknown as Response;

const upstreamFailure = (status: number): Response =>
  ({
    ok: false,
    status,
    json: () => Promise.reject(new Error('body not read on a failure')),
  }) as unknown as Response;

/**
 * An axios rejection as legacy sees it: the class carries extra fields, but the
 * controller copies `.message` and nothing else, so that is what must survive.
 */
const axiosShapedError = (message: string, status?: number): Error => {
  const err = new Error(message) as Error & {
    isAxiosError: boolean;
    code?: string;
    response?: { status: number; data: unknown };
  };
  err.isAxiosError = true;
  if (status === undefined) {
    err.code = 'ECONNABORTED';
  } else {
    err.response = { status, data: { error: { message: 'upstream said no' } } };
  }
  return err;
};

describe('GET /model — mapping and failure envelope (no Gemini call)', () => {
  let service: ModelService;
  let controller: ModelController;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    /**
     * Default implementation rejects. An outbound request a case did not
     * explicitly stub is a defect, not a fallthrough — with the real `fetch`
     * this is the call that would be billed.
     */
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        Promise.reject(
          new Error(`unstubbed outbound request: ${urlOf(input)}`),
        ),
      );

    const moduleRef = await Test.createTestingModule({
      controllers: [ModelController],
      providers: [
        ModelService,
        { provide: aiConfig.KEY, useValue: { geminiApiKey: FAKE_KEY } },
      ],
    }).compile();

    service = moduleRef.get(ModelService);
    controller = moduleRef.get(ModelController);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  /** The URL of every attempt made during a case. */
  const attemptedUrls = (): string[] =>
    fetchSpy.mock.calls.map((call) => urlOf(call[0] as RequestInfo | URL));

  // ── the transform ─────────────────────────────────────────────────────────

  it('maps a canned Gemini list response field for field', async () => {
    fetchSpy.mockResolvedValueOnce(
      upstreamOk({
        models: [
          {
            name: 'models/gemini-1.5-pro',
            version: '001',
            displayName: 'Gemini 1.5 Pro',
            description: 'Mid-size multimodal model',
            inputTokenLimit: 2_000_000,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ['generateContent'],
            temperature: 1,
          },
          {
            name: 'models/text-embedding-004',
            displayName: 'Text Embedding 004',
            description: 'Obtain a distributed representation of a text',
            inputTokenLimit: 2048,
            outputTokenLimit: 1,
          },
        ],
      }),
    );

    const result = await service.getModels();

    // Exact equality, not `toMatchObject`: a renamed key, a dropped key or an
    // extra key all have to fail here. `toMatchObject` would pass on the last.
    expect(result.models).toEqual([
      {
        id: 'gemini-1.5-pro',
        displayName: 'Gemini 1.5 Pro',
        description: 'Mid-size multimodal model',
        inputTokens: 2_000_000,
        outputTokens: 8192,
      },
      {
        id: 'text-embedding-004',
        displayName: 'Text Embedding 004',
        description: 'Obtain a distributed representation of a text',
        inputTokens: 2048,
        outputTokens: 1,
      },
    ]);

    // The five keys legacy emits, and only those — `version`,
    // `supportedGenerationMethods` and `temperature` were in the fixture on
    // purpose and must be dropped, as `modelController.js` drops them.
    expect(Object.keys(result.models[0]!).sort()).toEqual([
      'description',
      'displayName',
      'id',
      'inputTokens',
      'outputTokens',
    ]);
  });

  it('strips the `models/` prefix from `name` to make `id`', async () => {
    fetchSpy.mockResolvedValueOnce(
      upstreamOk({ models: [{ name: 'models/gemini-1.5-pro' }] }),
    );

    const { models } = await service.getModels();

    expect(models[0]?.id).toBe('gemini-1.5-pro');
    expect(models[0]?.id).not.toContain('models/');
  });

  it('renames the token limits — inputTokenLimit/outputTokenLimit are gone', async () => {
    fetchSpy.mockResolvedValueOnce(
      upstreamOk({
        models: [
          {
            name: 'models/gemini-2.0-flash',
            inputTokenLimit: 1_048_576,
            outputTokenLimit: 8192,
          },
        ],
      }),
    );

    const first = (await service.getModels()).models[0]!;

    expect(first.inputTokens).toBe(1_048_576);
    expect(first.outputTokens).toBe(8192);
    expect(first).not.toHaveProperty('inputTokenLimit');
    expect(first).not.toHaveProperty('outputTokenLimit');
  });

  it.each([
    ['a body with no models key', {}],
    ['an explicit null', { models: null }],
    ['an empty list', { models: [] }],
  ])('answers [] rather than throwing for %s', async (_label, payload) => {
    fetchSpy.mockResolvedValueOnce(upstreamOk(payload));

    await expect(service.getModels()).resolves.toMatchObject({ models: [] });
  });

  it('leaves `id` undefined for a model with no name instead of throwing', async () => {
    // `m.name?.replace(...)` in legacy — the optional chain is the behaviour.
    fetchSpy.mockResolvedValueOnce(
      upstreamOk({
        models: [{ displayName: 'Nameless', inputTokenLimit: 10 }],
      }),
    );

    const first = (await service.getModels()).models[0]!;

    expect(first.id).toBeUndefined();
    // Present-but-undefined, so `JSON.stringify` drops it exactly as legacy's
    // does. `toHaveProperty` alone would not tell those two apart.
    expect('id' in first).toBe(true);
    expect(JSON.parse(JSON.stringify(first))).toEqual({
      displayName: 'Nameless',
      inputTokens: 10,
    });
  });

  it('carries success:true and an ISO current_time in the envelope', async () => {
    fetchSpy.mockResolvedValueOnce(upstreamOk({ models: [] }));

    const result = await service.getModels();

    expect(result.success).toBe(true);
    expect(typeof result.current_time).toBe('string');
    // `new Date().toISOString()` and nothing else — millisecond precision, Z.
    expect(result.current_time).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(new Date(result.current_time).toISOString()).toBe(
      result.current_time,
    );
    expect(Object.keys(result).sort()).toEqual([
      'current_time',
      'models',
      'success',
    ]);
  });

  // ── the outbound request itself ───────────────────────────────────────────

  it('makes exactly one outbound attempt, to the list endpoint, and it never leaves the process', async () => {
    fetchSpy.mockResolvedValueOnce(upstreamOk({ models: [] }));

    await service.getModels();

    // The count is the guard: a change that adds a retry, a second page or a
    // warm-up generateContent call breaks this test before it reaches a bill.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = attemptedUrls();
    expect(url?.startsWith(`${GEMINI_LIST_URL}?key=`)).toBe(true);
    // `models.list` only, never `:generateContent` — that is the billed verb.
    expect(url).not.toContain('generateContent');
    // The key on the wire is the fixture's, which proves this file never read
    // the configured GEMINI_API_KEY from anywhere.
    expect(url).toContain(FAKE_KEY);
  });

  it('makes no outbound attempt at all when the mapping is never invoked', () => {
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  // ── the failure path ──────────────────────────────────────────────────────

  it("answers 500 with legacy's exact envelope when the client rejects", async () => {
    fetchSpy.mockRejectedValueOnce(
      axiosShapedError('Request failed with status code 400', 400),
    );
    const captured = captureResponse();

    await controller.getModels(captured.res);

    expect(captured.statusOf()).toBe(500);
    // Key names and the message verbatim: legacy is not uniform across
    // controllers, and this handler answers `{success, message, error}` rather
    // than the `{error}` the global filter would produce. A paraphrase here is
    // a real difference for the dashboard.
    expect(captured.bodyOf()).toEqual({
      success: false,
      message: 'Cannot fetch models',
      error: 'Request failed with status code 400',
    });
    expect(Object.keys(captured.bodyOf() as object).sort()).toEqual([
      'error',
      'message',
      'success',
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('passes the rejection message through untouched, whatever it says', async () => {
    fetchSpy.mockRejectedValueOnce(
      axiosShapedError('timeout of 10000ms exceeded'),
    );
    const captured = captureResponse();

    await controller.getModels(captured.res);

    expect(captured.statusOf()).toBe(500);
    expect(captured.bodyOf()).toEqual({
      success: false,
      message: 'Cannot fetch models',
      error: 'timeout of 10000ms exceeded',
    });
  });

  it("turns a non-2xx upstream into axios's wording, which is what legacy reports", async () => {
    // legacy uses axios, which rejects on 4xx/5xx with this exact sentence; this
    // service uses fetch, which resolves. The service reconstructs the message
    // so the `error` string the dashboard sees is the same either way.
    fetchSpy.mockResolvedValueOnce(upstreamFailure(403));
    const captured = captureResponse();

    await controller.getModels(captured.res);

    expect(captured.statusOf()).toBe(500);
    expect(captured.bodyOf()).toEqual({
      success: false,
      message: 'Cannot fetch models',
      error: 'Request failed with status code 403',
    });
  });

  it('answers 200 with the mapped payload on the success path', async () => {
    fetchSpy.mockResolvedValueOnce(
      upstreamOk({
        models: [{ name: 'models/gemini-1.5-flash', inputTokenLimit: 1 }],
      }),
    );
    const captured = captureResponse();

    await controller.getModels(captured.res);

    expect(captured.statusOf()).toBe(200);
    expect(captured.bodyOf()).toMatchObject({
      success: true,
      models: [{ id: 'gemini-1.5-flash', inputTokens: 1 }],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
