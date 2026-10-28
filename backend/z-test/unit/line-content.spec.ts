import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { Types } from 'mongoose';
import * as fs from 'node:fs';
import type * as NodeFs from 'node:fs';
import { join, resolve } from 'node:path';

import * as imageProcessor from '@/common/utils/image-processor';
import { ImageStorage } from '@/modules/content';
import { LineContentService } from '@/modules/webhook';

/**
 * `downloadAndSaveImage` and `downloadAndSaveVideo`, pinned against a stubbed
 * HTTP client and a stubbed filesystem.
 *
 * ── WHY THIS IS A UNIT TEST AND NOT A GOLDEN COMPARISON ─────────────────────
 * The service is deliberately not wired into `webhook.service.ts` — that is a
 * later stage — so there is no route to drive and nothing to diff end to end.
 * What CAN be pinned is everything the caller and the database can observe: the
 * request each method puts on the wire, the path and bytes it writes, the
 * `image_storages` document it builds, and the exact value it returns on
 * success, on a 404, on an oversized body, on a wrong content-type and on a
 * timeout. Every expectation is transcribed from
 * legacy-api/src/services/core-bot/lineContentService.js with the legacy line
 * named, so a reviewer can check the source rather than trust the test name.
 *
 * Stated plainly: this proves the port matches the legacy *code*, not that a
 * legacy *process* answers this way today.
 *
 * ── WHY NOTHING HERE CAN REACH THE NETWORK ──────────────────────────────────
 * `axios.get`, `axios.post` AND `globalThis.fetch` are replaced for this whole
 * file with implementations that REJECT by default, so an outbound call a case
 * did not explicitly stub is a hard failure naming the attempted URL, not a
 * silent fallthrough. Property copied from z-test/unit/line-api.spec.ts. Every
 * case also asserts the call count, so an edit that adds a second request fails
 * loudly.
 *
 * ⚠️ This matters more here than for the other LINE calls. The image path is
 * the one that reaches a slip flow, and legacy's slip flow calls Google Gemini
 * (legacy-api/src/services/.../qrVisionService.js:23, driven from
 * webhookController.js:3132 and :3626) — which bills a real account per token.
 * Nothing in this file drives that flow, posts an image to a hook, or holds a
 * channel token: `downloadAndSaveImage` is exercised in isolation with a
 * stubbed client and an obviously fake token.
 *
 * ── WHY NOTHING HERE TOUCHES DISK ───────────────────────────────────────────
 * `existsSync` / `mkdirSync` / `writeFileSync` are spied, so the assertions are
 * about the path and bytes the service WOULD write. No file is created, so
 * none needs cleaning up, and a run cannot leave a stray binary in
 * `public/uploads/`.
 *
 * ── NO CREDENTIALS ──────────────────────────────────────────────────────────
 * The token and message ids below are obvious fakes, asserted as such. No value
 * in this file came from a hook row, a `.env`, or a captured request.
 */

/**
 * The three `node:fs` calls the service makes, replaced at the module registry.
 *
 * `jest.spyOn` cannot be used: Node 26 exports these as non-configurable
 * properties, so redefining one throws. The factory keeps every other export —
 * and the real implementations as the default — so anything else loaded in this
 * process still reads and writes normally; `beforeEach` then neuters exactly
 * these three for the duration of a case. `readFileSync` is deliberately left
 * real, because one assertion below reads the service's own source.
 */
jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof NodeFs>('node:fs');
  return {
    ...actual,
    existsSync: jest.fn(actual.existsSync),
    mkdirSync: jest.fn(actual.mkdirSync),
    writeFileSync: jest.fn(actual.writeFileSync),
  };
});

/** Never a real channel token — asserted below to be exactly what is sent. */
const FAKE_TOKEN = 'unit-test-not-a-real-channel-token';
/** Not a LINE message id: real ones are all digits. */
const FAKE_MESSAGE_ID = 'unit-test-message-id';

/** legacy:32 / :119 — the content endpoint, on the data host. */
const CONTENT_URL = `https://api-data.line.me/v2/bot/message/${FAKE_MESSAGE_ID}/content`;

/** legacy:98 — 60 MB, video only. */
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
/** legacy:127 — video only. */
const VIDEO_TIMEOUT_MS = 30_000;

/**
 * The directories the service resolves, recomputed here from THIS file's
 * location rather than imported, so a change to the service's own resolution is
 * a failure and not a silently-agreeing constant. `z-test/unit` → two levels up
 * is the checkout root, which is where `src/modules/webhook` also lands after
 * its three.
 */
const REPO_ROOT = resolve(__dirname, '..', '..');
const EXPECTED_IMAGE_DIR = join(REPO_ROOT, 'public', 'uploads', 'images');
const EXPECTED_VIDEO_DIR = join(REPO_ROOT, 'public', 'uploads', 'videos');

/** Pinned so the generated filename is an exact assertion, not a pattern. */
const FAKE_UUID = '00000000-0000-4000-8000-000000000026';
/** Pinned `_id` of the row the fake model hands back. */
const FAKE_STORAGE_ID = new Types.ObjectId('a0d000000000000000000014');

/** A resolved axios response as the service reads it. */
const contentOk = (data: Buffer, contentType?: string): AxiosResponse<Buffer> =>
  ({
    status: 200,
    statusText: 'OK',
    data,
    headers: contentType === undefined ? {} : { 'content-type': contentType },
    config: {},
  }) as unknown as AxiosResponse<Buffer>;

/**
 * An axios rejection as legacy sees it.
 *
 * With `status`, this is an HTTP failure and `response.data` carries LINE's
 * body — a BUFFER, because `responseType: "arraybuffer"` applies to error
 * bodies too, which is the whole reason legacy calls `.toString()` on it.
 * Without `status` there is no `response` at all: a timeout, a DNS failure, or
 * axios aborting an oversized body.
 */
const axiosError = (message: string, status?: number, body?: string): Error => {
  const err = new Error(message) as Error & {
    isAxiosError: boolean;
    code?: string;
    response?: { status: number; data: Buffer };
  };
  err.isAxiosError = true;
  if (status === undefined) {
    err.code = 'ECONNABORTED';
  } else {
    err.response = { status, data: Buffer.from(body ?? '') };
  }
  return err;
};

/** The two positional arguments of an `axios.get` call. */
interface GetCall {
  url: string;
  config: Record<string, unknown>;
}

/** The document handed to the model constructor. */
type StoragePayload = Record<string, unknown>;

describe('LineContentService — inbound LINE media (no network, no disk)', () => {
  let service: LineContentService;
  let getSpy: jest.SpyInstance;
  let postSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;
  const writeSpy = fs.writeFileSync as unknown as jest.Mock;
  const existsSpy = fs.existsSync as unknown as jest.Mock;
  const mkdirSpy = fs.mkdirSync as unknown as jest.Mock;
  let compressSpy: jest.SpyInstance;
  let uuidSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  /** Every document passed to `new Model(...)`, in order. */
  let created: StoragePayload[];
  let saveMock: jest.Mock;

  beforeEach(async () => {
    const reject = (target: unknown) =>
      Promise.reject(
        new Error(`unstubbed outbound request: ${String(target)}`),
      );

    getSpy = jest
      .spyOn(axios, 'get')
      .mockImplementation((url: unknown) => reject(url));
    postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementation((url: unknown) => reject(url));
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        reject(input instanceof Request ? input.url : String(input)),
      );

    // Nothing reaches the filesystem. `existsSync` answers true by default so
    // the constructor's mkdir branch stays quiet; one case below flips it.
    existsSpy.mockReset().mockReturnValue(true);
    mkdirSpy.mockReset().mockImplementation(() => undefined);
    writeSpy.mockReset().mockImplementation(() => undefined);

    // legacy:57 — `imageProcessor.compressImage`. Default: the file was already
    // under the 0.9 MB threshold, which is what it answers for a normal photo.
    compressSpy = jest
      .spyOn(imageProcessor, 'compressImage')
      .mockResolvedValue({ processed: false, size: 4 });

    // legacy:50 / :144 — `crypto.randomUUID()`, pinned so the filename is exact.
    uuidSpy = jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue(FAKE_UUID);

    // Legacy writes these with console.*; captured here both to keep the run
    // quiet and because WHAT each method logs is part of what was ported.
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    created = [];
    saveMock = jest.fn().mockResolvedValue(undefined);

    /**
     * Stands in for the Mongoose model. The service builds the document with
     * `new Model(doc)` and then `.save()`s it — legacy's exact shape — so the
     * stub has to be a constructor, and `created` records the document
     * field-for-field before any schema casting can normalise it. That is the
     * point: an invented or dropped field shows up here.
     */
    const FakeModel = function (
      this: Record<string, unknown>,
      doc: StoragePayload,
    ) {
      created.push(doc);
      Object.assign(this, doc);
      this['_id'] = FAKE_STORAGE_ID;
      this['save'] = saveMock;
    } as unknown as new (doc: StoragePayload) => unknown;

    const moduleRef = await Test.createTestingModule({
      providers: [
        LineContentService,
        { provide: getModelToken(ImageStorage.name), useValue: FakeModel },
      ],
    }).compile();

    service = moduleRef.get(LineContentService);

    // Nest itself logs "RootTestModule dependencies initialized" through the
    // same Logger. Dropped here so the assertions below count only what the
    // service under test wrote.
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The nth `axios.get`, unpacked. */
  const getCall = (n = 0): GetCall => {
    const call = getSpy.mock.calls[n] as unknown[];
    return {
      url: call[0] as string,
      config: call[1] as Record<string, unknown>,
    };
  };

  /** Nothing left the process except the one request under test. */
  const expectOneOutbound = () => {
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  };

  /** Nothing left the process at all. */
  const expectNoOutbound = () => {
    expect(getSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  };

  const errorLines = (): string[] =>
    errorSpy.mock.calls.map((c) => String((c as unknown[])[0]));

  // ── shared guards ────────────────────────────────────────────────────────

  describe('the paths it resolves', () => {
    /**
     * R7 — no absolute path carrying a home directory or a username may reach a
     * committed file. Asserted on the source text, because that is the artefact
     * the rule is about; the resolved value at runtime necessarily contains the
     * checkout location.
     */
    it('hard-codes no absolute path in its own source', () => {
      const source = fs.readFileSync(
        join(REPO_ROOT, 'src', 'modules', 'webhook', 'line-content.service.ts'),
        'utf8',
      );
      expect(source).not.toMatch(/\/Users\//);
      expect(source).not.toMatch(/\/home\//);
      // The resolution it does use.
      expect(source).toContain('__dirname');
    });

    it('writes images under <root>/public/uploads/images (legacy:8)', async () => {
      getSpy.mockResolvedValueOnce(
        contentOk(Buffer.from('abcd'), 'image/jpeg'),
      );
      await service.downloadAndSaveImage(FAKE_MESSAGE_ID, FAKE_TOKEN);
      expect(writeSpy.mock.calls[0]?.[0]).toBe(
        join(EXPECTED_IMAGE_DIR, `${FAKE_UUID}.jpg`),
      );
    });

    it('writes videos under <root>/public/uploads/videos (legacy:91)', async () => {
      getSpy.mockResolvedValueOnce(contentOk(Buffer.from('abcd'), 'video/mp4'));
      await service.downloadAndSaveVideo(FAKE_MESSAGE_ID, FAKE_TOKEN);
      expect(writeSpy.mock.calls[0]?.[0]).toBe(
        join(EXPECTED_VIDEO_DIR, `${FAKE_UUID}.mp4`),
      );
    });

    /** legacy:11-13 / :92-94 — created once, at boot, only when absent. */
    it('creates both directories recursively when they do not exist', async () => {
      jest.clearAllMocks();
      existsSpy.mockReturnValue(false);
      const moduleRef = await Test.createTestingModule({
        providers: [
          LineContentService,
          {
            provide: getModelToken(ImageStorage.name),
            useValue: function () {},
          },
        ],
      }).compile();
      moduleRef.get(LineContentService);

      expect(mkdirSpy).toHaveBeenCalledTimes(2);
      expect(mkdirSpy).toHaveBeenCalledWith(EXPECTED_IMAGE_DIR, {
        recursive: true,
      });
      expect(mkdirSpy).toHaveBeenCalledWith(EXPECTED_VIDEO_DIR, {
        recursive: true,
      });
    });
  });

  // ── downloadAndSaveImage — legacy:23 ─────────────────────────────────────

  describe('downloadAndSaveImage (legacy:23)', () => {
    it('sends the legacy request plus a timeout — and STILL no size cap (legacy:33-40)', async () => {
      getSpy.mockResolvedValueOnce(
        contentOk(Buffer.from('abcd'), 'image/jpeg'),
      );

      await service.downloadAndSaveImage(FAKE_MESSAGE_ID, FAKE_TOKEN);

      expectOneOutbound();
      const { url, config } = getCall();
      expect(url).toBe(CONTENT_URL);
      /* [FIX-20260824-IMGTIMEOUT] HALF-FLIPPED, not deleted.
       *
       * This case used to demand NO timeout and NO caps, pinning byte-for-byte
       * legacy parity on the image request. Owner decision 2026-08-24 split that
       * pin in two, and only one half was retired:
       *
       *   TIMEOUT — retired. Legacy waits on axios' default of `0`, i.e. forever,
       *   so a half-open socket to api-data.line.me held the worker until the OS
       *   abandoned the TCP connection: minutes, while still holding that user's
       *   lock, for a picture that was never going to arrive. A deadline cannot
       *   lose an image legacy would have delivered, because a socket that never
       *   delivers bytes delivers none under either version.
       *
       *   SIZE CAP — NOT retired, and the assertions below are the guard. A cap
       *   WOULD turn a download legacy completes into a `null`, which silently
       *   drops the customer's picture from the chat stream. The service's
       *   MAX_VIDEO_BYTES note explains it; that note still stands.
       *
       * So: adding maxContentLength/maxBodyLength here must still fail.
       */
      expect(config).toEqual({
        headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
        responseType: 'arraybuffer',
        timeout: 30_000,
      });
      expect(config['timeout']).toBe(30_000);
      // The cap half of the original pin, kept verbatim and deliberately.
      expect(config['maxContentLength']).toBeUndefined();
      expect(config['maxBodyLength']).toBeUndefined();
    });

    it('writes the body verbatim and stores the row legacy stores (legacy:50-77)', async () => {
      const body = Buffer.from('binary-image-bytes');
      getSpy.mockResolvedValueOnce(contentOk(body, 'image/jpeg'));
      compressSpy.mockResolvedValueOnce({
        processed: false,
        size: body.length,
      });

      const result = await service.downloadAndSaveImage(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      // The file: absolute path under the images dir, the exact bytes received.
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const [path, data] = writeSpy.mock.calls[0] as [string, Buffer];
      expect(path).toBe(join(EXPECTED_IMAGE_DIR, `${FAKE_UUID}.jpg`));
      expect(data).toBe(body);

      // legacy:57 — compression runs on the file that was just written.
      expect(compressSpy).toHaveBeenCalledTimes(1);
      expect(compressSpy).toHaveBeenCalledWith(path);

      // The row: every field legacy sets, and nothing else. `toEqual` on the
      // whole document is what catches an invented or dropped field.
      expect(created).toHaveLength(1);
      expect(created[0]).toEqual({
        object_image_id: null,
        image_url: `/uploads/images/${FAKE_UUID}.jpg`,
        origin_path: 'internal',
        storage_type: 'internal',
        image_type: 'jpg',
        file_path: join(EXPECTED_IMAGE_DIR, `${FAKE_UUID}.jpg`),
        file_size: body.length,
        priority: 1,
        source: 'chat',
        media_kind: 'image',
      });
      expect(saveMock).toHaveBeenCalledTimes(1);

      // The return: the row's `_id`, which the caller stores as
      // `internal_content_id` (legacy:2801).
      expect(result).toBe(FAKE_STORAGE_ID);

      expect(logSpy.mock.calls.map((c) => String((c as unknown[])[0]))).toEqual(
        [
          `[LineContentService] Downloading image content for messageId: ${FAKE_MESSAGE_ID}`,
          `[LineContentService] Image saved and record created: ${FAKE_STORAGE_ID.toString()}`,
        ],
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('prefers the COMPRESSED size when compression ran (legacy:58)', async () => {
      const body = Buffer.alloc(2_000_000, 1);
      getSpy.mockResolvedValueOnce(contentOk(body, 'image/jpeg'));
      compressSpy.mockResolvedValueOnce({ processed: true, size: 800_000 });

      await service.downloadAndSaveImage(FAKE_MESSAGE_ID, FAKE_TOKEN);

      expect(created[0]?.['file_size']).toBe(800_000);
    });

    it('falls back to the raw byte length when compression FAILS (legacy:58)', async () => {
      const body = Buffer.alloc(1234, 7);
      getSpy.mockResolvedValueOnce(contentOk(body, 'image/jpeg'));
      // `compressImage` never throws — it answers `{ error }`. `processed.size`
      // is then undefined and the `||` picks the original length.
      compressSpy.mockResolvedValueOnce({ error: 'sharp is not installed' });

      const result = await service.downloadAndSaveImage(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      expect(created[0]?.['file_size']).toBe(1234);
      // A failed compression is NOT a failed download.
      expect(result).toBe(FAKE_STORAGE_ID);
    });

    // ── extension derivation, quirks and all (legacy:42-48) ────────────────

    it.each([
      ['image/jpeg', 'jpg'], // legacy:48 rewrites jpeg → jpg
      ['image/png', 'png'],
      ['image/gif', 'gif'],
      ['image/webp', 'webp'],
      // A WRONG content-type is stored as-is. Legacy has no allow-list and does
      // not reject: an HTML error page saved by a proxy becomes a `.html` file
      // with `image_type: "html"`, and the caller treats the row as an image.
      ['text/html', 'html'],
      ['application/json', 'json'],
      // ⚠️ No `;` strip on the IMAGE path. The parameter lands in the filename
      // and in `image_type`, and the jpeg→jpg rewrite misses it because it
      // compares the whole value. The video path below does strip it.
      ['image/jpeg; charset=utf-8', 'jpeg; charset=utf-8'],
      // ⚠️ No lowercasing on the IMAGE path either.
      ['image/PNG', 'PNG'],
      // ⚠️ No emptiness check: `image/` yields "", so the file is `<uuid>.`
      ['image/', ''],
    ])('content-type %p yields extension %p', async (ct, ext) => {
      getSpy.mockResolvedValueOnce(contentOk(Buffer.from('abcd'), ct));

      await service.downloadAndSaveImage(FAKE_MESSAGE_ID, FAKE_TOKEN);

      expect(writeSpy.mock.calls[0]?.[0]).toBe(
        join(EXPECTED_IMAGE_DIR, `${FAKE_UUID}.${ext}`),
      );
      expect(created[0]?.['image_type']).toBe(ext);
      expect(created[0]?.['image_url']).toBe(
        `/uploads/images/${FAKE_UUID}.${ext}`,
      );
    });

    it('defaults to jpg when the response carries no content-type (legacy:43)', async () => {
      getSpy.mockResolvedValueOnce(contentOk(Buffer.from('abcd')));

      await service.downloadAndSaveImage(FAKE_MESSAGE_ID, FAKE_TOKEN);

      expect(created[0]?.['image_type']).toBe('jpg');
    });

    it('names the file from a fresh UUID, not from the messageId (legacy:50)', async () => {
      getSpy.mockResolvedValueOnce(
        contentOk(Buffer.from('abcd'), 'image/jpeg'),
      );

      await service.downloadAndSaveImage(FAKE_MESSAGE_ID, FAKE_TOKEN);

      expect(uuidSpy).toHaveBeenCalledTimes(1);
      const written = String(writeSpy.mock.calls[0]?.[0]);
      expect(written.endsWith(`${FAKE_UUID}.jpg`)).toBe(true);
      // Nothing about the message is in the name — two calls for the same
      // message id would produce two files, which is what the video retry
      // button depends on.
      expect(written).not.toContain(FAKE_MESSAGE_ID);
    });

    // ── failure modes ──────────────────────────────────────────────────────

    it.each([
      ['no messageId', undefined, FAKE_TOKEN],
      ['empty messageId', '', FAKE_TOKEN],
      ['no accessToken', FAKE_MESSAGE_ID, undefined],
      ['empty accessToken', FAKE_MESSAGE_ID, ''],
    ])(
      'returns null without any request when %s (legacy:25-28)',
      async (_label, id, token) => {
        const result = await service.downloadAndSaveImage(id, token);

        expect(result).toBeNull();
        expectNoOutbound();
        expect(writeSpy).not.toHaveBeenCalled();
        expect(created).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
          '[LineContentService] Missing messageId or accessToken',
        );
      },
    );

    it('returns null on a 404 and logs the status AND the body (legacy:78-85)', async () => {
      getSpy.mockRejectedValueOnce(
        axiosError(
          'Request failed with status code 404',
          404,
          '{"message":"Not found"}',
        ),
      );

      const result = await service.downloadAndSaveImage(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      expect(result).toBeNull();
      expectOneOutbound();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
      // Three lines, in order. The third is legacy's `.toString()` on a Buffer
      // — without it this logs a byte dump instead of LINE's message.
      expect(errorLines()).toEqual([
        '[LineContentService] Error downloading/saving image: Request failed with status code 404',
        '- LINE API Status: 404',
        '- LINE API Data: {"message":"Not found"}',
      ]);
    });

    it('returns null on a 401 (dead token) — indistinguishable from a 404', async () => {
      getSpy.mockRejectedValueOnce(
        axiosError(
          'Request failed with status code 401',
          401,
          '{"message":"Authentication failed"}',
        ),
      );

      await expect(
        service.downloadAndSaveImage(FAKE_MESSAGE_ID, FAKE_TOKEN),
      ).resolves.toBeNull();
      expect(errorLines()[1]).toBe('- LINE API Status: 401');
    });

    it('returns null on a TIMEOUT and logs no status line (legacy:80)', async () => {
      // No `response` on a transport failure, so the `if (err.response)` block
      // is skipped entirely — one log line, not three.
      getSpy.mockRejectedValueOnce(axiosError('timeout of 0ms exceeded'));

      const result = await service.downloadAndSaveImage(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      expect(result).toBeNull();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
      expect(errorLines()).toEqual([
        '[LineContentService] Error downloading/saving image: timeout of 0ms exceeded',
      ]);
    });

    it('returns null when the row fails to save — the file is already on disk', async () => {
      getSpy.mockResolvedValueOnce(
        contentOk(Buffer.from('abcd'), 'image/jpeg'),
      );
      saveMock.mockRejectedValueOnce(new Error('E11000 duplicate key'));

      const result = await service.downloadAndSaveImage(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      expect(result).toBeNull();
      // ⚠️ Legacy writes the file BEFORE the row and has no rollback, so a save
      // failure orphans the file. Reproduced, not repaired.
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(errorLines()).toEqual([
        '[LineContentService] Error downloading/saving image: E11000 duplicate key',
      ]);
    });

    it('⚠️ stores a 0-byte image rather than skipping it, unlike video (legacy:54 vs :139)', async () => {
      const empty = Buffer.alloc(0);
      getSpy.mockResolvedValueOnce(contentOk(empty, 'image/jpeg'));
      compressSpy.mockResolvedValueOnce({ processed: false, size: 0 });

      const result = await service.downloadAndSaveImage(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      // The image path has NO empty-body guard. A 200 with no bytes writes a
      // 0-byte file and returns a real id, so the caller renders it as an image.
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(created[0]?.['file_size']).toBe(0);
      expect(result).toBe(FAKE_STORAGE_ID);
    });
  });

  // ── downloadAndSaveVideo — legacy:112 ────────────────────────────────────

  describe('downloadAndSaveVideo (legacy:112)', () => {
    it('sends the legacy request WITH the 60 MB cap and 30 s timeout (legacy:120-128)', async () => {
      getSpy.mockResolvedValueOnce(contentOk(Buffer.from('abcd'), 'video/mp4'));

      await service.downloadAndSaveVideo(FAKE_MESSAGE_ID, FAKE_TOKEN);

      expectOneOutbound();
      const { url, config } = getCall();
      expect(url).toBe(CONTENT_URL);
      expect(config).toEqual({
        headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
        responseType: 'arraybuffer',
        maxContentLength: MAX_VIDEO_BYTES,
        maxBodyLength: MAX_VIDEO_BYTES,
        timeout: VIDEO_TIMEOUT_MS,
      });
      expect(config['maxContentLength']).toBe(62_914_560);
      expect(config['timeout']).toBe(30_000);
    });

    it('writes the body verbatim and stores the row legacy stores (legacy:144-162)', async () => {
      const body = Buffer.from('binary-video-bytes');
      getSpy.mockResolvedValueOnce(contentOk(body, 'video/mp4'));

      const result = await service.downloadAndSaveVideo(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const [path, data] = writeSpy.mock.calls[0] as [string, Buffer];
      expect(path).toBe(join(EXPECTED_VIDEO_DIR, `${FAKE_UUID}.mp4`));
      expect(data).toBe(body);

      // No transcode and no compression on this path — the raw byte count is
      // what is stored.
      expect(compressSpy).not.toHaveBeenCalled();

      expect(created).toHaveLength(1);
      expect(created[0]).toEqual({
        object_image_id: null,
        image_url: `/uploads/videos/${FAKE_UUID}.mp4`,
        origin_path: 'internal',
        storage_type: 'internal',
        image_type: 'mp4',
        file_path: join(EXPECTED_VIDEO_DIR, `${FAKE_UUID}.mp4`),
        file_size: body.length,
        priority: 1,
        source: 'chat',
        media_kind: 'video',
      });
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(result).toBe(FAKE_STORAGE_ID);

      // ⚠️ No "Downloading…" line on this path — the image path has one, this
      // one does not.
      expect(logSpy.mock.calls.map((c) => String((c as unknown[])[0]))).toEqual(
        [
          `[LineContentService] Video saved and record created: ${FAKE_STORAGE_ID.toString()} (${body.length} bytes)`,
        ],
      );
    });

    it.each([
      ['video/mp4', 'mp4'],
      ['video/quicktime', 'mov'], // legacy:135
      // The video path DOES strip parameters, trim and lowercase — every quirk
      // the image path leaves in place.
      ['video/mp4; codecs=avc1.42E01E', 'mp4'],
      ['VIDEO/MP4', 'mp4'],
      ['video/QuickTime', 'mov'],
      // Same absence of an allow-list as the image path: a wrong content-type
      // is stored as-is.
      ['text/html', 'html'],
      // Empty subtype falls back to the default here, unlike the image path.
      ['video/', 'mp4'],
    ])('content-type %p yields extension %p', async (ct, ext) => {
      getSpy.mockResolvedValueOnce(contentOk(Buffer.from('abcd'), ct));

      await service.downloadAndSaveVideo(FAKE_MESSAGE_ID, FAKE_TOKEN);

      expect(writeSpy.mock.calls[0]?.[0]).toBe(
        join(EXPECTED_VIDEO_DIR, `${FAKE_UUID}.${ext}`),
      );
      expect(created[0]?.['image_type']).toBe(ext);
    });

    it('defaults to mp4 when the response carries no content-type (legacy:131-132)', async () => {
      getSpy.mockResolvedValueOnce(contentOk(Buffer.from('abcd')));

      await service.downloadAndSaveVideo(FAKE_MESSAGE_ID, FAKE_TOKEN);

      expect(created[0]?.['image_type']).toBe('mp4');
    });

    it.each([
      ['no messageId', undefined, FAKE_TOKEN],
      ['no accessToken', FAKE_MESSAGE_ID, undefined],
    ])(
      'returns null without any request when %s (legacy:114-117)',
      async (_label, id, token) => {
        const result = await service.downloadAndSaveVideo(id, token);

        expect(result).toBeNull();
        expectNoOutbound();
        expect(created).toHaveLength(0);
        // Note the "(video)" suffix — the only thing that tells the two guards
        // apart in a log.
        expect(warnSpy).toHaveBeenCalledWith(
          '[LineContentService] Missing messageId or accessToken (video)',
        );
      },
    );

    it('returns null on an EMPTY body without writing anything (legacy:138-142)', async () => {
      // The ordinary case, not an edge case: LINE answers before transcoding
      // finishes. The caller turns this null into `video_pending`.
      getSpy.mockResolvedValueOnce(contentOk(Buffer.alloc(0), 'video/mp4'));

      const result = await service.downloadAndSaveVideo(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      expect(result).toBeNull();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        `[LineContentService] Empty video body, skipping: ${FAKE_MESSAGE_ID}`,
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('returns null when axios aborts an OVERSIZED body (legacy:125-126)', async () => {
      // What axios raises when `maxContentLength` trips: no `response`, so the
      // status line is not logged — the cap is invisible in the log beyond the
      // message itself.
      getSpy.mockRejectedValueOnce(
        axiosError('maxContentLength size of 62914560 exceeded'),
      );

      const result = await service.downloadAndSaveVideo(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      expect(result).toBeNull();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
      expect(errorLines()).toEqual([
        '[LineContentService] Error downloading/saving video: maxContentLength size of 62914560 exceeded',
      ]);
    });

    it('returns null on a 404 and logs the status but NOT the body (legacy:163-170)', async () => {
      getSpy.mockRejectedValueOnce(
        axiosError(
          'Request failed with status code 404',
          404,
          '{"message":"Not found"}',
        ),
      );

      const result = await service.downloadAndSaveVideo(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      expect(result).toBeNull();
      // ⚠️ Two lines, not three. The image path logs the response body; this
      // one deliberately does not.
      expect(errorLines()).toEqual([
        '[LineContentService] Error downloading/saving video: Request failed with status code 404',
        '- LINE API Status: 404',
      ]);
    });

    it('returns null on a TIMEOUT and logs no status line', async () => {
      getSpy.mockRejectedValueOnce(axiosError('timeout of 30000ms exceeded'));

      const result = await service.downloadAndSaveVideo(
        FAKE_MESSAGE_ID,
        FAKE_TOKEN,
      );

      expect(result).toBeNull();
      expect(created).toHaveLength(0);
      expect(errorLines()).toEqual([
        '[LineContentService] Error downloading/saving video: timeout of 30000ms exceeded',
      ]);
    });

    it('returns null when the row fails to save', async () => {
      getSpy.mockResolvedValueOnce(contentOk(Buffer.from('abcd'), 'video/mp4'));
      saveMock.mockRejectedValueOnce(new Error('connection timed out'));

      await expect(
        service.downloadAndSaveVideo(FAKE_MESSAGE_ID, FAKE_TOKEN),
      ).resolves.toBeNull();
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
