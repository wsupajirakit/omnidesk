/**
 * =============================================================================
 * [FEAT-20260902-SLIPBASELINE] The OUTBOUND slip-verify request, pinned.
 * =============================================================================
 *
 * WHY THIS EXISTS
 * `docs/slip-spec.md` §7.1 sets one rule for adding a second slip provider:
 * *with no second provider bound, every byte on the wire must be what it is
 * today.* Nothing in this repo recorded those bytes, so the rule had nothing to
 * be checked against:
 *   · `webhook_logs` holds the request — but 0 rows with `channel:'swiftcheck_api'`
 *     exist on the working database (measured 2026-09-02)
 *   · `slip_verifications.raw_request` is written by the code and absent from
 *     every stored row, because the rows predate it
 *   · `z-test/run-full-flow.sh` S2 substitutes the slip through
 *     `make-swiftcheck-slip.mjs` and therefore NEVER calls the provider at all —
 *     the full-flow suite would pass with the outbound call completely broken
 *
 * ⇒ This spec is the before-picture, and it has to be taken BEFORE the provider
 * split. Once the code is edited the original bytes cannot be recovered.
 * เก็บภาพ "ก่อน" ให้ได้ก่อนแตะโค้ด · แก้แล้วย้อนเก็บไม่ได้.
 *
 * WHAT IT PINS — everything the wire carries:
 *   the URL · the HTTP method · every header name and value · every body key
 *   and value · the timeout · and the `webhook_logs` entry the call writes.
 *
 * HOW THE IMAGE IS HANDLED
 * The body's `base64` is recorded as `{ bytes, sha256 }` rather than the string.
 * That is not a weakening: the hash changes if the bytes or the encoding change,
 * which is exactly what the assertion is for, and it keeps slip images — real
 * customer data — out of a committed fixture. Same reasoning the production code
 * already applies when it logs `[BINARY_DATA]` (`BINARY_PLACEHOLDER` in
 * `slip-flow.service.ts`).
 *
 * The image itself is SYNTHETIC and deterministic (a fixed byte pattern written
 * to a temp file), so the golden reproduces on any machine and depends on no
 * file outside the repo.
 *
 * ── RECORD MODE ─────────────────────────────────────────────────────────────
 * With the fixture absent the spec WRITES it and then FAILS, so a missing golden
 * can never be mistaken for a passing test:
 *
 *   rm z-test/fixtures/slip-outbound-baseline.json
 *   pnpm jest z-test/unit/slip-outbound-baseline.spec.ts   # writes, then fails
 *   git add z-test/fixtures/slip-outbound-baseline.json
 *
 * ⚠️ NEVER re-record to make a red test green. A diff here means the bytes on the
 * wire changed — that is the finding, not the problem. Re-record only when the
 * change is intended, and say so in the commit.
 *
 * revert: delete this file and its fixture. Nothing imports it.
 */
import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { integrationConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto/crypto.service';
import { SlipFlowService, SlipVerification } from '@/modules/slip';
import { WebhookLogService } from '@/modules/system';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const FIXTURE = resolve(__dirname, '../fixtures/slip-outbound-baseline.json');

/** Frozen so `SWIFTCHECK_<ms>`/`FAIL_<ms>` refs and durations are comparable. */
const FIXED_NOW = new Date('2026-09-02T12:00:00.000Z').getTime();

/** The base URL the config supplies; the fallback constant is asserted separately. */
const SWIFTCHECK_BASE = 'https://api.swiftcheck.example.com/v2';

/**
 * A deterministic stand-in for a slip image. Not a real slip on purpose — the
 * assertion is about the request shape, and a committed fixture must not carry
 * anybody's payment data.
 */
function syntheticImage(): Buffer {
  return Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 7 + 13) % 256));
}

interface CapturedCall {
  url: string;
  timeout: unknown;
  headers: Record<string, unknown>;
  /** Body with `base64` replaced by its size + digest. */
  body: Record<string, unknown>;
  /** The `webhook_logs` entry the call writes, minus the volatile duration. */
  webhookLog: Record<string, unknown>;
}

describe('[SLIPBASELINE] the outbound slip-verify request is byte-stable', () => {
  let service: SlipFlowService;
  let tmpDir: string;
  let imagePath: string;
  const loggerSpies: jest.SpyInstance[] = [];
  const webhookLogCalls: unknown[] = [];

  beforeAll(async () => {
    for (const m of ['log', 'error', 'warn', 'debug'] as const) {
      loggerSpies.push(jest.spyOn(Logger.prototype, m).mockImplementation());
    }

    tmpDir = mkdtempSync(join(tmpdir(), 'slip-baseline-'));
    imagePath = join(tmpDir, 'slip.jpg');
    writeFileSync(imagePath, syntheticImage());

    const moduleRef = await Test.createTestingModule({
      providers: [
        SlipFlowService,
        {
          provide: getModelToken(SlipVerification.name),
          useValue: {
            // The row write is not what this spec pins; it only has to succeed.
            create: (doc: unknown) =>
              Promise.resolve({ ...(doc as object), _id: 'baseline-row' }),
            findByIdAndUpdate: () => ({ exec: () => Promise.resolve(null) }),
          },
        },
        {
          provide: CryptoService,
          // Fixed plaintext so the Authorization header is deterministic.
          useValue: { safeDecrypt: () => 'BASELINE-KEY' },
        },
        {
          provide: WebhookLogService,
          useValue: {
            createLog: (p: unknown) => {
              webhookLogCalls.push(p);
              return Promise.resolve(null);
            },
          },
        },
        {
          provide: integrationConfig.KEY,
          useValue: { swiftcheckApiBaseUrl: SWIFTCHECK_BASE },
        },
      ],
    }).compile();

    service = moduleRef.get(SlipFlowService);

    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(FIXED_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
    loggerSpies.forEach((s) => s.mockRestore());
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Run the real service once and record exactly what left the process. */
  async function capture(): Promise<CapturedCall> {
    webhookLogCalls.length = 0;
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: { success: true, data: { rawSlip: { transRef: 'BASELINE-REF' } } },
    });

    await service.verifySlip({
      hook: {
        _id: 'baseline-hook' as never,
        alias: 'baseline',
        slip_check: true,
        slip_verify_key: 'enc:baseline',
        match_account: true,
      },
      storage: { file_path: imagePath },
      storageId: null,
      userId: 'Ubaseline',
      messageId: 'mbaseline',
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockedAxios.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];

    // Narrowed rather than String()-ed: the body is typed `unknown` per key, and
    // stringifying a non-string would silently record '[object Object]' as the
    // image — a golden that then matches nothing real.
    const b64 = typeof body['base64'] === 'string' ? body['base64'] : '';
    const log = { ...(webhookLogCalls[0] as Record<string, unknown>) };
    // Duration is wall-clock and cannot be pinned; its PRESENCE is what matters.
    log['duration_ms'] =
      typeof log['duration_ms'] === 'number' ? '<number>' : log['duration_ms'];

    return {
      url,
      timeout: (config as { timeout?: unknown }).timeout,
      headers: (config as { headers?: Record<string, unknown> }).headers ?? {},
      body: {
        ...body,
        base64: {
          bytes: Buffer.from(b64, 'base64').length,
          sha256: createHash('sha256').update(b64).digest('hex'),
        },
      },
      webhookLog: log,
    };
  }

  it('matches the recorded baseline, byte for byte', async () => {
    const actual = await capture();

    if (!existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
      throw new Error(
        `[SLIPBASELINE] no golden existed, so one was RECORDED at\n` +
          `  ${FIXTURE}\n` +
          `Review it, commit it, and re-run. This failure is deliberate: a ` +
          `missing golden must never look like a pass.`,
      );
    }

    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8')) as CapturedCall;
    expect(actual).toEqual(expected);
  });

  it('sends exactly the three body keys, and no more', async () => {
    // Pinned separately from the golden so an ADDED key is named in the failure
    // rather than buried in an object diff.
    const actual = await capture();
    expect(Object.keys(actual.body).sort()).toEqual([
      'base64',
      'checkDuplicate',
      'matchAccount',
    ]);
  });

  it('carries the two headers the provider is authenticated by', async () => {
    const actual = await capture();
    expect(Object.keys(actual.headers).sort()).toEqual([
      'Authorization',
      'Content-Type',
    ]);
    expect(actual.headers['Authorization']).toBe('Bearer BASELINE-KEY');
    expect(actual.headers['Content-Type']).toBe('application/json');
  });

  it('addresses /verify/bank on the configured base, with the 30s budget', async () => {
    const actual = await capture();
    expect(actual.url).toBe(`${SWIFTCHECK_BASE}/verify/bank`);
    expect(actual.timeout).toBe(30_000);
  });

  it('never lets the image reach the webhook log', async () => {
    // The log is an operator-facing record; a slip image in it would be both a
    // data leak and a storage problem. `BINARY_PLACEHOLDER` replaces it.
    const actual = await capture();
    const raw = actual.webhookLog['raw_request'] as Record<string, unknown>;
    expect(raw['base64']).toBe('[BINARY_DATA]');
    expect(JSON.stringify(actual.webhookLog)).not.toContain(
      syntheticImage().toString('base64').slice(0, 32),
    );
  });
});
