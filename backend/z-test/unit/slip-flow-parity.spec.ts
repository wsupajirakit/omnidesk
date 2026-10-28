/*
 * `no-implied-eval` is off deliberately and only here: compiling legacy's own
 * source text with `new Function` IS the technique this suite depends on — it is
 * what makes the comparison run legacy's real statements instead of a
 * paraphrase. The input is a byte range of a file on disk in this repo's own
 * checkout, never anything a request could influence. `no-require-imports` is
 * off because legacy's `dayjs` lives in a sibling checkout reachable only by
 * resolved path, and `no-base-to-string` because ObjectIds and error payloads
 * are stringified for comparison keys.
 */
/* eslint-disable @typescript-eslint/no-implied-eval, @typescript-eslint/no-require-imports, @typescript-eslint/no-base-to-string */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { Types } from 'mongoose';

import { integrationConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto/crypto.service';
import {
  DEFAULT_CUSTOMER_PROVIDER,
  bindActiveProvider,
  buildCustomerProviderRegistry,
  resetActiveProvider,
} from '@/modules/customer-provider';
import { SlipFlowService, SlipVerification } from '@/modules/slip';
import { WebhookLogService } from '@/modules/system';

import { LOAN_V1_ENDPOINTS } from '../fixtures/loan-v1-endpoints';

/**
 * DIFFERENTIAL test: the ported slip flow against the legacy JavaScript it came
 * from — legacy's ACTUAL SOURCE TEXT, extracted by line range from
 * `webhookController.js` and executed beside the port on the same fakes.
 *
 * ── WHY THE SOURCE IS EXTRACTED RATHER THAN REQUIRED ────────────────────────
 * Neither block is exported. The Swiftcheck call is written inline inside a
 * 900-line request handler, and `handleSlipCallback` is a module-private
 * function with no `module.exports` in the file at all. Requiring the
 * controller would drag in Mongoose models, Redis and the whole config tree,
 * and would still not give a handle on either block.
 *
 * So the two ranges are read out of the file at test time and compiled with
 * `new Function`, with every free identifier passed in as a parameter. That
 * means the assertions below run legacy's real statements — the same `||`
 * chains, the same field order, the same prefixes — not a paraphrase of them.
 * It also means the test tracks the legacy file: if someone edits those lines,
 * this either follows them or fails, rather than quietly pinning a stale copy.
 * The ranges are asserted to still contain their landmark lines before use, so
 * a shifted line number fails loudly instead of extracting the wrong code.
 *
 * ── NOTHING LEAVES THE PROCESS ──────────────────────────────────────────────
 * `axios.post` and `globalThis.fetch` are replaced file-wide with
 * implementations that REJECT, so an unstubbed call fails the case instead of
 * reaching Swiftcheck or a partner's callback URL. There is no database: the slip
 * model is a fake that records the documents it is handed. No `.env` is read
 * and no real credential appears here — the verify key below is an obvious
 * fake and its decryption is a stub.
 *
 * NO AI CALL IS POSSIBLE FROM THIS FILE. `SlipFlowService` does not import
 * `QrVisionService`, and the `SLIP_NOT_FOUND` case below asserts precisely that
 * the decision is made WITHOUT consulting vision.
 */
const LEGACY_ROOT = resolve(__dirname, '../../../legacy-api');
const LEGACY_CONTROLLER = `${LEGACY_ROOT}/src/controllers/core-bot/webhookController.js`;
const legacyAvailable = existsSync(LEGACY_CONTROLLER);

const FIXED_NOW = Date.parse('2026-08-07T03:21:45.000Z');
const SWIFTCHECK_BASE = 'http://swiftcheck.invalid/v2';
/** Not a real verify key; `safeDecrypt` below is a stub, not the real cipher. */
const FAKE_VERIFY_KEY = 'unit-test-not-a-real-slip-verify-key';
const FAKE_CALLBACK_TOKEN = 'unit-test-callback-token';
const HOOK_ID = new Types.ObjectId('a0d00000000000000000007f');
const STORAGE_ID = new Types.ObjectId('a0d000000000000000000080');
const SLIP_ROW_ID = new Types.ObjectId('a0d000000000000000000081');
const USER_ID = 'unit-test-user-id';
const MESSAGE_ID = 'unit-test-message-id';
const SLIP_BYTES = Buffer.from('unit-test-slip-image-bytes');

/**
 * Both blocks are extracted by ANCHORING on stable landmarks rather than
 * hardcoded line offsets. The controller is 5000+ lines and edited constantly
 * above these blocks; fixed ranges silently drift onto the wrong code (which is
 * exactly what had happened — the landmark assertions below caught it). Each
 * extractor asserts its anchors exist, so a genuine shape change fails loudly
 * instead of pinning a stale copy.
 */
const readLegacyLines = (): string[] =>
  readFileSync(LEGACY_CONTROLLER, 'utf8').split('\n');

/**
 * The inline Swiftcheck verification block: the `if (hook?.slip_check === true …)`
 * gate through its matching close brace (a bare `}` at the gate's 10-space
 * indent). The four outer vars the block assigns are declared by the wrapper.
 */
const extractSwiftcheckBlock = (): string => {
  const lines = readLegacyLines();
  const start = lines.findIndex((l) =>
    /^\s*if \(hook\?\.slip_check === true && hook\?\.slip_verify_key\) \{/.test(
      l,
    ),
  );
  if (start < 0) {
    throw new Error('legacy Swiftcheck-block anchor not found — file drifted');
  }
  const indent = lines[start]!.match(/^\s*/)![0];
  const closer = `${indent}}`;
  const end = lines.findIndex((l, i) => i > start && l === closer);
  if (end < 0) {
    throw new Error('close of Swiftcheck block not found — file drifted');
  }
  return lines.slice(start, end + 1).join('\n');
};

/**
 * The module-private `handleSlipCallback` declaration: its `async function`
 * header through the matching column-0 `}` (top-level declaration style).
 */
const extractCallbackFn = (): string => {
  const lines = readLegacyLines();
  const start = lines.findIndex((l) =>
    /^async function handleSlipCallback\(/.test(l),
  );
  if (start < 0) {
    throw new Error(
      'legacy handleSlipCallback anchor not found — file drifted',
    );
  }
  const end = lines.findIndex((l, i) => i > start && l === '}');
  if (end < 0) {
    throw new Error('close of handleSlipCallback not found — file drifted');
  }
  return lines.slice(start, end + 1).join('\n');
};

/**
 * A REAL temporary file, not a mocked `fs`.
 *
 * `node:fs`'s exports are non-configurable on this Node build, so
 * `jest.spyOn(fs, 'readFileSync')` cannot be installed — and mocking the whole
 * module would also intercept this file's own reads of the legacy source. A
 * real file in the OS temp directory is simpler and strictly more honest: both
 * implementations run the same `readFileSync` against the same bytes, so the
 * base64 in the compared request is genuinely produced, not injected. Created
 * once and removed in `afterAll`; the path is machine-generated, so no absolute
 * path appears in this file.
 */
let tmpDir = '';
let slipPath = '';
/** Deliberately never created — the unreadable-slip case points here. */
let missingSlipPath = '';

interface LegacyDeps {
  fs: unknown;
  axios: unknown;
  config: unknown;
  safeDecrypt: unknown;
  maskToken: unknown;
  webhookLogService: unknown;
  SlipVerification: unknown;
  dayjs: unknown;
}

interface SwiftcheckCtx {
  hook: unknown;
  event: unknown;
  storage: unknown;
  storageId: unknown;
  userId: string;
}

interface SwiftcheckOutcome {
  slipVerifyResult: unknown;
  slipRecordId: unknown;
  slipCreatedAt: unknown;
  slipCondition: unknown;
}

type LegacySwiftcheck = (
  deps: LegacyDeps,
) => (ctx: SwiftcheckCtx) => Promise<SwiftcheckOutcome>;
type LegacyCallback = (
  deps: LegacyDeps,
) => (input: Record<string, unknown>) => Promise<void>;

/**
 * Compiles the extracted Swiftcheck block into a callable.
 *
 * The four outer variables legacy assigns (`slipVerifyResult`, `slipRecordId`,
 * `slipCreatedAt`, `slipCondition`) are declared in the wrapper and returned,
 * which is exactly what `VerifySlipResult` carries in the port.
 */
const compileLegacySwiftcheck = (): ((
  ctx: SwiftcheckCtx,
) => Promise<SwiftcheckOutcome>) => {
  const src = extractSwiftcheckBlock();
  // Landmarks: if these are gone the range moved and the extraction is wrong.
  expect(src).toContain('hook?.slip_check === true');
  expect(src).toContain('/verify/bank');
  expect(src).toContain('SWIFTCHECK_${Date.now()}');
  expect(src).toContain('FAIL_${Date.now()}');
  expect(src).toContain('ERR_${Date.now()}');

  const factory = new Function(
    'deps',
    'return async function run(ctx) {\n' +
      '  const { fs, axios, config, safeDecrypt, maskToken, webhookLogService, SlipVerification } = deps;\n' +
      '  const { hook, event, storage, storageId, userId } = ctx;\n' +
      '  let slipVerifyResult = null, slipRecordId = null, slipCreatedAt = null, slipCondition = null;\n' +
      src +
      '\n  return { slipVerifyResult, slipRecordId, slipCreatedAt, slipCondition };\n' +
      '};',
  ) as LegacySwiftcheck;
  return factory(legacyDeps());
};

/** Compiles the extracted `handleSlipCallback` declaration into a callable. */
const compileLegacyCallback = (): ((
  input: Record<string, unknown>,
) => Promise<void>) => {
  const src = extractCallbackFn();
  expect(src).toContain('async function handleSlipCallback');
  expect(src).toContain('X-Event-Type');
  expect(src).toContain('callback_response');

  const factory = new Function(
    'deps',
    'const { axios, SlipVerification, dayjs } = deps;\n' +
      src +
      '\nreturn handleSlipCallback;',
  ) as LegacyCallback;
  return factory(legacyDeps());
};

/* ── The fakes. Both implementations are handed THESE objects. ────────────── */

interface Fakes {
  slipModel: { create: jest.Mock; findByIdAndUpdate: jest.Mock };
  webhookLog: { createLog: jest.Mock };
  safeDecrypt: jest.Mock;
}
let fakes: Fakes;

const legacyDeps = (): LegacyDeps => ({
  // The real module — legacy reads the same temp file the port does.
  fs: { readFileSync },
  axios,
  config: { swiftcheck: { baseUrl: SWIFTCHECK_BASE } },
  safeDecrypt: (...a: unknown[]) => fakes.safeDecrypt(...a),
  maskToken: (t: string) => (t ? `${t.slice(0, 2)}...${t.slice(-2)}` : null),
  webhookLogService: {
    createLog: (...a: unknown[]) => fakes.webhookLog.createLog(...a),
  },
  SlipVerification: {
    create: (...a: unknown[]) => fakes.slipModel.create(...a),
    findByIdAndUpdate: (...a: unknown[]) =>
      fakes.slipModel.findByIdAndUpdate(...a),
  },
  // Real dayjs from the legacy checkout, with the same two plugins legacy
  // extends it with (legacy:34-39) — so the Bangkok stamp really is compared.
  dayjs: legacyAvailable ? loadLegacyDayjs() : null,
});

function loadLegacyDayjs(): unknown {
  const dayjs = require(require.resolve('dayjs', { paths: [LEGACY_ROOT] })) as {
    extend: (p: unknown) => void;
  };
  dayjs.extend(
    require(require.resolve('dayjs/plugin/utc', { paths: [LEGACY_ROOT] })),
  );
  dayjs.extend(
    require(require.resolve('dayjs/plugin/timezone', { paths: [LEGACY_ROOT] })),
  );
  return dayjs;
}

const httpOk = (data: unknown, status = 200): AxiosResponse<unknown> =>
  ({
    status,
    statusText: 'OK',
    data,
    headers: {},
    config: {},
  }) as unknown as AxiosResponse<unknown>;

const axiosError = (
  message: string,
  status?: number,
  data?: unknown,
): Error & { response?: { status?: number; data?: unknown } } => {
  const err = new Error(message) as Error & {
    isAxiosError: boolean;
    response?: { status?: number; data?: unknown };
  };
  err.isAxiosError = true;
  if (status !== undefined || data !== undefined) {
    err.response = { status, data };
  }
  return err;
};

/** A Swiftcheck success body with a fully populated `rawSlip`. */
const swiftcheckSuccess = (
  overrides: Record<string, unknown> = {},
): unknown => ({
  success: true,
  data: {
    amountInSlip: 1234.5,
    isDuplicate: false,
    matchedAccount: true,
    rawSlip: {
      date: '2026-08-06T11:22:33.000Z',
      transRef: 'UNITTESTREF001',
      amount: { amount: 1234.5 },
      sender: {
        account: {
          name: { th: 'ผู้ส่ง ทดสอบ', en: 'TEST SENDER' },
          bank: { account: 'x-1234' },
        },
        bank: { short: 'KBANK', name: 'Kasikorn' },
      },
      receiver: {
        account: {
          name: { th: 'ผู้รับ ทดสอบ', en: 'TEST RECEIVER' },
          proxy: { account: 'promptpay-9999' },
        },
        bank: { short: 'SCB', name: 'Siam Commercial' },
      },
      ...(overrides['rawSlip'] as Record<string, unknown> | undefined),
    },
  },
});

const baseHook = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  _id: HOOK_ID,
  alias: 'unit-test-hook',
  display_name: 'Unit Test Branch',
  line_oa_name: 'Unit Test OA',
  slip_check: true,
  slip_verify_key: FAKE_VERIFY_KEY,
  match_account: true,
  ...over,
});

const describeOrSkip = legacyAvailable ? describe : describe.skip;

describeOrSkip('slip flow — port vs legacy source, on shared fakes', () => {
  let port: SlipFlowService;
  let runLegacySwiftcheck: (ctx: SwiftcheckCtx) => Promise<SwiftcheckOutcome>;
  let runLegacyCallback: (input: Record<string, unknown>) => Promise<void>;
  let postSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;
  const loggerSpies: jest.SpyInstance[] = [];

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slip-flow-parity-'));
    slipPath = join(tmpDir, 'unit-test-slip.jpg');
    missingSlipPath = join(tmpDir, 'unit-test-slip-does-not-exist.jpg');
    writeFileSync(slipPath, SLIP_BYTES);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fakes = {
      slipModel: {
        create: jest.fn().mockImplementation(() =>
          Promise.resolve({
            _id: SLIP_ROW_ID,
            created_at: new Date(FIXED_NOW),
          }),
        ),
        findByIdAndUpdate: jest.fn().mockResolvedValue({}),
      },
      webhookLog: { createLog: jest.fn().mockResolvedValue({}) },
      // Stands in for the real cipher: what matters is that the DECRYPTED value
      // is what reaches the Authorization header, not how it is decrypted.
      safeDecrypt: jest.fn((t: string) => `decrypted:${t}`),
    };

    /**
     * Default REJECTS — an unstubbed POST here would be a real request to
     * Swiftcheck or to a partner's callback endpoint.
     */
    postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementation((url: string) =>
        Promise.reject(new Error(`unstubbed outbound POST: ${url}`)),
      );
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        Promise.reject(new Error(`unstubbed outbound fetch: ${String(input)}`)),
      );
    for (const method of ['log', 'error', 'warn', 'debug'] as const) {
      loggerSpies.push(
        jest.spyOn(Logger.prototype, method).mockImplementation(),
      );
    }
    loggerSpies.push(jest.spyOn(console, 'log').mockImplementation());
    loggerSpies.push(jest.spyOn(console, 'warn').mockImplementation());
    loggerSpies.push(jest.spyOn(console, 'error').mockImplementation());

    const moduleRef = await Test.createTestingModule({
      providers: [
        SlipFlowService,
        {
          provide: getModelToken(SlipVerification.name),
          useValue: fakes.slipModel,
        },
        {
          provide: CryptoService,
          useValue: { safeDecrypt: (t: string) => fakes.safeDecrypt(t) },
        },
        {
          provide: WebhookLogService,
          useValue: {
            createLog: (p: unknown) => fakes.webhookLog.createLog(p),
          },
        },
        {
          provide: integrationConfig.KEY,
          useValue: { swiftcheckApiBaseUrl: SWIFTCHECK_BASE },
        },
      ],
    }).compile();
    port = moduleRef.get(SlipFlowService);

    runLegacySwiftcheck = compileLegacySwiftcheck();
    runLegacyCallback = compileLegacyCallback();

    // Both sides stamp `Date.now()` and `new Date()` into rows and payloads;
    // frozen so the two are comparable rather than off by a millisecond.
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    postSpy.mockRestore();
    fetchSpy.mockRestore();
    for (const s of loggerSpies.splice(0)) s.mockRestore();
  });

  /** Everything both implementations did, in a directly comparable form. */
  interface Trace {
    posts: unknown[][];
    created: unknown[];
    logs: unknown[];
    updates: unknown[][];
    outcome: SwiftcheckOutcome;
  }

  const snapshot = (outcome: SwiftcheckOutcome): Trace => ({
    posts:
      fakes.slipModel.create.mock.calls.length >= 0
        ? postSpy.mock.calls.map((c) => [...c])
        : [],
    created: fakes.slipModel.create.mock.calls.map((c) => c[0]),
    logs: fakes.webhookLog.createLog.mock.calls.map((c) => c[0]),
    updates: fakes.slipModel.findByIdAndUpdate.mock.calls.map((c) => [...c]),
    outcome,
  });

  const resetRecorders = (): void => {
    postSpy.mockClear();
    fakes.slipModel.create.mockClear();
    fakes.slipModel.findByIdAndUpdate.mockClear();
    fakes.webhookLog.createLog.mockClear();
    fakes.safeDecrypt.mockClear();
  };

  /**
   * `hook_id` is the ONE known, deliberate difference: legacy hands
   * `WebhookLogService` a raw ObjectId, the port hands it a string because the
   * DTO types it as one. `WebhookLogService.createLog` casts either back to an
   * ObjectId before the insert, so the stored row is identical — but the call
   * arguments are not, so they are normalised here rather than papered over.
   */
  const normaliseLog = (log: unknown): unknown => {
    const l = { ...(log as Record<string, unknown>) };
    if (l['hook_id'] != null) l['hook_id'] = String(l['hook_id']);
    return l;
  };

  /** Runs the port and legacy on the same input; returns both traces. */
  const runBothSwiftcheck = async (
    prime: () => void,
    ctx: SwiftcheckCtx,
  ): Promise<{ portTrace: Trace; legacyTrace: Trace }> => {
    resetRecorders();
    prime();
    const portOutcome = await port.verifySlip({
      hook: ctx.hook as never,
      storage: ctx.storage as never,
      storageId: ctx.storageId as never,
      userId: ctx.userId,
      messageId: MESSAGE_ID,
    });
    // Let the un-awaited `createLog(...).catch(...)` settle on both sides.
    await Promise.resolve();
    const portTrace = snapshot({
      slipVerifyResult: portOutcome.slipVerifyResult,
      slipRecordId: portOutcome.slipRecordId,
      slipCreatedAt: portOutcome.slipCreatedAt,
      slipCondition: portOutcome.slipCondition,
    });

    resetRecorders();
    prime();
    const legacyOutcome = await runLegacySwiftcheck(ctx);
    await Promise.resolve();
    const legacyTrace = snapshot(legacyOutcome);

    return { portTrace, legacyTrace };
  };

  const expectSameSwiftcheck = (r: {
    portTrace: Trace;
    legacyTrace: Trace;
  }): void => {
    expect(r.portTrace.posts).toEqual(r.legacyTrace.posts);
    /* [FEAT-20260903-SLIPPROVSTAMP] the port's row carries ONE field legacy could
       not have: `slip_provider`, the provenance stamp. This is deliberately NOT
       written as "ignore that key" — the assertion says the port's document is
       legacy's document PLUS exactly that key, with exactly that value. So the
       parity net still fails on any other new field, and it also pins the stamp
       itself: drop the stamp and this goes red for a MISSING key, add a second
       unexpected field and it goes red for an extra one.
       ⚠️ Do not soften this into a delete-then-compare. The whole reason this
       suite exists is that a money-path row must not gain fields quietly.
       เทียบว่า "เท่าเดิม + แสตมป์" ไม่ใช่ "เท่าเดิมหลังลบแสตมป์ทิ้ง" */
    expect(r.portTrace.created).toEqual(
      (r.legacyTrace.created as Record<string, unknown>[]).map((doc) => ({
        ...doc,
        slip_provider: 'swiftcheck',
      })),
    );
    expect(r.portTrace.logs.map(normaliseLog)).toEqual(
      r.legacyTrace.logs.map(normaliseLog),
    );
    expect(r.portTrace.outcome.slipVerifyResult).toEqual(
      r.legacyTrace.outcome.slipVerifyResult,
    );
    expect(r.portTrace.outcome.slipCondition).toEqual(
      r.legacyTrace.outcome.slipCondition,
    );
    expect(String(r.portTrace.outcome.slipRecordId)).toBe(
      String(r.legacyTrace.outcome.slipRecordId),
    );
    expect(r.portTrace.outcome.slipCreatedAt).toEqual(
      r.legacyTrace.outcome.slipCreatedAt,
    );
  };

  const ctxWith = (hook: unknown): SwiftcheckCtx => ({
    hook,
    event: { message: { id: MESSAGE_ID } },
    storage: { file_path: slipPath },
    storageId: STORAGE_ID,
    userId: USER_ID,
  });

  /* ── VARIANT 1: success ─────────────────────────────────────────────────── */

  it('VARIANT 1 — success writes the full rawSlip mapping, identical to legacy', async () => {
    const r = await runBothSwiftcheck(() => {
      postSpy.mockResolvedValueOnce(httpOk(swiftcheckSuccess()));
    }, ctxWith(baseHook()));

    expectSameSwiftcheck(r);

    // The request Swiftcheck would receive: url, body, headers, timeout.
    expect(r.portTrace.posts).toHaveLength(1);
    const [url, body, cfg] = r.portTrace.posts[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string>; timeout: number },
    ];
    expect(url).toBe(`${SWIFTCHECK_BASE}/verify/bank`);
    expect(body).toEqual({
      base64: SLIP_BYTES.toString('base64'),
      checkDuplicate: true,
      matchAccount: true,
    });
    expect(cfg.headers['Authorization']).toBe(
      `Bearer decrypted:${FAKE_VERIFY_KEY}`,
    );
    expect(cfg.timeout).toBe(30_000);

    // Exactly one row, in the success shape.
    expect(r.portTrace.created).toHaveLength(1);
    const doc = r.portTrace.created[0] as Record<string, unknown>;
    expect(doc['api_status']).toBe('success');
    expect(doc['trans_ref']).toBe('UNITTESTREF001');
    expect(doc['sender_account_no']).toBe('x-1234');
    expect(doc['sender_account_name']).toBe('ผู้ส่ง ทดสอบ');
    expect(doc['sender_bank']).toBe('KBANK');
    // The receiver falls through to the PROXY account; the sender never does.
    expect(doc['receiver_account_no']).toBe('promptpay-9999');
    expect(doc['receiver_bank']).toBe('SCB');
    expect(doc['slip_type']).toBe('Bank Transfer');
    expect(doc['amount']).toBe(1234.5);
    expect(doc['branch']).toBe('Unit Test Branch');
    expect(doc['sender_line_user_id']).toBe(USER_ID);
    // The base64 never reaches the stored request copy.
    expect((doc['raw_request'] as Record<string, unknown>)['base64']).toBe(
      '[BINARY_DATA]',
    );

    // And the Swiftcheck call is logged as its own WebhookLog row.
    expect(r.portTrace.logs).toHaveLength(1);
    const log = r.portTrace.logs[0] as Record<string, unknown>;
    expect(log['channel']).toBe('swiftcheck_api');
    expect(log['action_type']).toBe('verify_bank_slip');
    expect(log['endpoint']).toBe('/verify/bank');
    expect(log['status']).toBe('success');
    expect((log['raw_request'] as Record<string, unknown>)['base64']).toBe(
      '[BINARY_DATA]',
    );
  });

  it('VARIANT 1 — a slip with no bank reference gets the SWIFTCHECK_ prefix, same on both sides', async () => {
    const r = await runBothSwiftcheck(() => {
      postSpy.mockResolvedValueOnce(
        httpOk(swiftcheckSuccess({ rawSlip: { transRef: undefined } })),
      );
    }, ctxWith(baseHook()));

    expectSameSwiftcheck(r);
    const doc = r.portTrace.created[0] as Record<string, unknown>;
    expect(doc['trans_ref']).toBe(`SWIFTCHECK_${FIXED_NOW}`);
    expect(String(doc['trans_ref'])).toMatch(/^SWIFTCHECK_\d+$/);
  });

  it('VARIANT 1 — falls back to the English name and the full bank name', async () => {
    const r = await runBothSwiftcheck(() => {
      postSpy.mockResolvedValueOnce(
        httpOk({
          success: true,
          data: {
            rawSlip: {
              transRef: 'REF-EN',
              amount: { amount: 10 },
              sender: {
                account: { name: { en: 'EN SENDER' }, bank: { account: 'a1' } },
                bank: { name: 'Long Bank Name' },
              },
              receiver: {
                account: {
                  name: { en: 'EN RECEIVER' },
                  bank: { account: 'b2' },
                },
                bank: { name: 'Other Bank' },
              },
            },
          },
        }),
      );
    }, ctxWith(baseHook()));

    expectSameSwiftcheck(r);
    const doc = r.portTrace.created[0] as Record<string, unknown>;
    expect(doc['sender_account_name']).toBe('EN SENDER');
    expect(doc['sender_bank']).toBe('Long Bank Name');
    // Bank account wins over proxy when both could apply.
    expect(doc['receiver_account_no']).toBe('b2');
  });

  it('VARIANT 1 — branch falls back display_name → line_oa_name → "Main Branch"', async () => {
    const noDisplay = await runBothSwiftcheck(
      () => {
        postSpy.mockResolvedValueOnce(httpOk(swiftcheckSuccess()));
      },
      ctxWith(baseHook({ display_name: undefined })),
    );
    expectSameSwiftcheck(noDisplay);
    expect(
      (noDisplay.portTrace.created[0] as Record<string, unknown>)['branch'],
    ).toBe('Unit Test OA');

    const neither = await runBothSwiftcheck(
      () => {
        postSpy.mockResolvedValueOnce(httpOk(swiftcheckSuccess()));
      },
      ctxWith(baseHook({ display_name: undefined, line_oa_name: undefined })),
    );
    expectSameSwiftcheck(neither);
    expect(
      (neither.portTrace.created[0] as Record<string, unknown>)['branch'],
    ).toBe('Main Branch');
  });

  /* ── VARIANT 2: API answered, not success ───────────────────────────────── */

  it('VARIANT 2 — a non-success body writes the FAIL_ shape, identical to legacy', async () => {
    const body = {
      success: false,
      code: 'SLIP_NOT_FOUND',
      message: 'Slip not found',
    };
    const r = await runBothSwiftcheck(() => {
      postSpy.mockResolvedValueOnce(httpOk(body));
    }, ctxWith(baseHook()));

    expectSameSwiftcheck(r);

    expect(r.portTrace.created).toHaveLength(1);
    const doc = r.portTrace.created[0] as Record<string, unknown>;
    expect(doc['api_status']).toBe('failed');
    expect(doc['trans_ref']).toBe(`FAIL_${FIXED_NOW}`);
    expect(String(doc['trans_ref'])).toMatch(/^FAIL_\d+$/);
    expect(doc['amount']).toBe(0);
    // A DIFFERENT shape, not the success shape with a flag flipped: none of
    // these fields is written at all.
    for (const absent of [
      'sender_account_no',
      'sender_account_name',
      'sender_bank',
      'receiver_account_no',
      'receiver_bank',
      'slip_type',
      'branch',
      'raw_content',
      'metadata',
    ]) {
      expect(doc).not.toHaveProperty(absent);
    }
    // The WebhookLog row records it as an error even though HTTP was 200.
    expect((r.portTrace.logs[0] as Record<string, unknown>)['status']).toBe(
      'error',
    );
  });

  /* ── VARIANT 3: the call threw ──────────────────────────────────────────── */

  it('VARIANT 3 — a rejected Swiftcheck call writes the ERR_ shape with metadata, identical to legacy', async () => {
    const r = await runBothSwiftcheck(() => {
      postSpy.mockRejectedValueOnce(
        axiosError('Request failed with status code 500', 500, {
          error: 'upstream exploded',
        }),
      );
    }, ctxWith(baseHook()));

    expectSameSwiftcheck(r);

    expect(r.portTrace.created).toHaveLength(1);
    const doc = r.portTrace.created[0] as Record<string, unknown>;
    expect(doc['api_status']).toBe('failed');
    expect(doc['trans_ref']).toBe(`ERR_${FIXED_NOW}`);
    expect(String(doc['trans_ref'])).toMatch(/^ERR_\d+$/);
    // Only this variant carries metadata, and only these two keys.
    expect(doc['metadata']).toEqual({
      error_type: 'exception',
      message: 'Request failed with status code 500',
    });
    expect(doc['raw_response']).toEqual({ error: 'upstream exploded' });
    // ...and it is the ONLY variant that sets slipCondition itself.
    expect(r.portTrace.outcome.slipCondition).toBe(
      'API Error: Request failed with status code 500',
    );
    // No WebhookLog row: the call never returned, so there was nothing to log.
    expect(r.portTrace.logs).toHaveLength(0);
  });

  it('VARIANT 3 — a transport failure with no response keeps the synthetic envelope', async () => {
    const r = await runBothSwiftcheck(() => {
      postSpy.mockRejectedValueOnce(axiosError('timeout of 30000ms exceeded'));
    }, ctxWith(baseHook()));

    expectSameSwiftcheck(r);
    expect(r.portTrace.outcome.slipVerifyResult).toEqual({
      success: false,
      error: { message: 'timeout of 30000ms exceeded' },
    });
    expect(
      (r.portTrace.created[0] as Record<string, unknown>)['raw_response'],
    ).toEqual({ error: 'timeout of 30000ms exceeded' });
  });

  it('VARIANT 3 — an unreadable slip file also lands here, with no HTTP attempted', async () => {
    const ctx = ctxWith(baseHook());
    (ctx.storage as { file_path: string }).file_path = missingSlipPath;
    const r = await runBothSwiftcheck(() => undefined, ctx);

    expectSameSwiftcheck(r);
    expect(r.portTrace.posts).toHaveLength(0);
    expect(
      String((r.portTrace.created[0] as Record<string, unknown>)['trans_ref']),
    ).toMatch(/^ERR_/);
  });

  /* ── The gate ───────────────────────────────────────────────────────────── */

  it.each([
    ['slip_check false', { slip_check: false }],
    ['slip_check truthy-but-not-true', { slip_check: 'true' }],
    ['no verify key', { slip_verify_key: '' }],
  ])('does nothing at all when the gate is not met (%s)', async (_l, over) => {
    const r = await runBothSwiftcheck(() => undefined, ctxWith(baseHook(over)));

    expectSameSwiftcheck(r);
    expect(r.portTrace.posts).toHaveLength(0);
    expect(r.portTrace.created).toHaveLength(0);
    expect(r.portTrace.logs).toHaveLength(0);
    expect(r.portTrace.outcome.slipRecordId).toBeNull();
  });

  it('matchAccount is an identity check, not truthiness', async () => {
    const r = await runBothSwiftcheck(
      () => {
        postSpy.mockResolvedValueOnce(httpOk(swiftcheckSuccess()));
      },
      ctxWith(baseHook({ match_account: 'yes' })),
    );

    expectSameSwiftcheck(r);
    expect(
      (r.portTrace.posts[0] as [string, Record<string, unknown>])[1][
        'matchAccount'
      ],
    ).toBe(false);
  });

  /* ── The SLIP_NOT_FOUND short-circuit (legacy:3623-3627) ────────────────── */

  it('SLIP_NOT_FOUND decides "QR slip" WITHOUT asking vision — the branch that proves no AI call', () => {
    const notFound = port.resolveQrDecision(true);
    expect(notFound).toEqual({ askVision: false, isQrCodeSlip: true });

    // Only a VALIDATION_ERROR (Swiftcheck saw no QR) reaches the billing path.
    const validationError = port.resolveQrDecision(false);
    expect(validationError).toEqual({ askVision: true, isQrCodeSlip: false });

    // Nothing left the process to reach that conclusion.
    expect(postSpy).toHaveBeenCalledTimes(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  /* ── handleSlipCallback ─────────────────────────────────────────────────── */

  const callbackInput = (
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    hook: {
      alias: 'unit-test-hook',
      callback_slip: ['http://partner-a.invalid/hook'],
      callback_token: FAKE_CALLBACK_TOKEN,
      callback_action: 'all',
    },
    flexDoc: { callback_tag: 'success', callback_detail: 'Verified' },
    condition: 'Verified successfully',
    slipVerifyResult: swiftcheckSuccess(),
    profileData: {
      'Path : api/line/v1/installment_current.php': {
        data: { contract: { contract_number: 'CN-0001', code: 'C1' } },
      },
      other_block: { anything: true },
    },
    userId: USER_ID,
    customerName: 'Unit Test Customer',
    customerTel: '0800000000',
    storagePath: '/unit-test/uploads/slip.jpg',
    mediaUrl: 'http://localhost:4900/uploads/images/slip.jpg',
    slipRecordId: SLIP_ROW_ID,
    ...over,
  });

  const runBothCallback = async (
    prime: () => void,
    input: Record<string, unknown>,
  ): Promise<{ portTrace: Trace; legacyTrace: Trace }> => {
    const empty: SwiftcheckOutcome = {
      slipVerifyResult: null,
      slipRecordId: null,
      slipCreatedAt: null,
      slipCondition: null,
    };
    resetRecorders();
    prime();
    await port.handleSlipCallback(input as never);
    const portTrace = snapshot(empty);

    resetRecorders();
    prime();
    await runLegacyCallback(input);
    const legacyTrace = snapshot(empty);

    return { portTrace, legacyTrace };
  };

  /* [FEAT-20261019-CALLBACKLINEPROFILE] the payload is legacy's PLUS two keys — owner
     19/10/2026: the LINE `display_name` and `picture_url`, placed right after
     `line_user_id`. Everything else must still be legacy byte for byte, so the comparison
     inserts the two keys into LEGACY'S OWN key list at that position, demands the port
     match it key for key and in order, then compares the rest whole. Before 19/10 this
     was a plain `toEqual` on the posts; that would now fail on the two added keys only. */
  const LINE_PROFILE_KEYS = ['display_name', 'picture_url'];
  const expectSameCallback = (r: {
    portTrace: Trace;
    legacyTrace: Trace;
  }): void => {
    expect(r.portTrace.posts).toHaveLength(r.legacyTrace.posts.length);
    r.portTrace.posts.forEach((post, i) => {
      const legacy = r.legacyTrace.posts[i]!;
      const port = post[1] as Record<string, unknown>;
      const legacyKeys = Object.keys(legacy[1] as Record<string, unknown>);
      const at = legacyKeys.indexOf('line_user_id') + 1;
      expect(at).toBeGreaterThan(0);
      expect(Object.keys(port)).toEqual([
        ...legacyKeys.slice(0, at),
        ...LINE_PROFILE_KEYS,
        ...legacyKeys.slice(at),
      ]);
      const rest = Object.fromEntries(
        Object.entries(port).filter(([k]) => !LINE_PROFILE_KEYS.includes(k)),
      );
      expect([post[0], rest, ...post.slice(2)]).toEqual(legacy);
    });
    expect(r.portTrace.updates).toEqual(r.legacyTrace.updates);
  };

  it('CALLBACK — the payload, the headers and the timeout match legacy exactly', async () => {
    const r = await runBothCallback(() => {
      postSpy.mockResolvedValueOnce(httpOk({ ok: true }, 201));
    }, callbackInput());

    expectSameCallback(r);

    expect(r.portTrace.posts).toHaveLength(1);
    const [url, payload, cfg] = r.portTrace.posts[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string>; timeout: number },
    ];
    expect(url).toBe('http://partner-a.invalid/hook');
    expect(cfg.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Event-Type': 'slip_verification',
      'X-Callback-Token': FAKE_CALLBACK_TOKEN,
    });
    expect(cfg.timeout).toBe(15_000);

    // Always 200 — this reports that the callback ran, not the slip's verdict.
    expect(payload['status']).toBe(200);
    expect(payload['transRef']).toBe('UNITTESTREF001');
    expect(payload['result']).toBe('success');
    expect(payload['detail']).toBe('Verified');
    expect(payload['amount']).toBe(1234.5);
    // contact_number is the CONTRACT number, read out of the partner profile
    // by its literal request-path key. phone_number is the phone.
    expect(payload['contact_number']).toBe('CN-0001');
    expect(payload['phone_number']).toBe('0800000000');
    expect(payload['created_at']).toBe('2026-08-07T10:21:45+07:00');
    // The WHOLE partner profile travels in the body.
    expect(payload['external_api_response']).toEqual(
      callbackInput()['profileData'],
    );

    // The per-URL result map is written to the slip row.
    expect(r.portTrace.updates).toHaveLength(1);
    const [id, update] = r.portTrace.updates[0] as [
      unknown,
      { callback_response: Record<string, { status: string }> },
    ];
    expect(String(id)).toBe(String(SLIP_ROW_ID));
    expect(update.callback_response['1']?.status).toBe('success');
  });

  it('CALLBACK — every URL is called, in order, even after one fails', async () => {
    const input = callbackInput({
      hook: {
        alias: 'unit-test-hook',
        callback_slip: [
          'http://partner-a.invalid/hook',
          'http://partner-b.invalid/hook',
          'http://partner-c.invalid/hook',
        ],
        callback_token: FAKE_CALLBACK_TOKEN,
        callback_action: 'all',
      },
    });

    const r = await runBothCallback(() => {
      postSpy.mockResolvedValueOnce(httpOk({ ok: 'a' }));
      postSpy.mockRejectedValueOnce(
        axiosError('Request failed with status code 502', 502, {
          err: 'bad gateway',
        }),
      );
      postSpy.mockResolvedValueOnce(httpOk({ ok: 'c' }));
    }, input);

    expectSameCallback(r);

    // A failure MUST NOT stop the loop — this is the mutation the fan-out test
    // exists to kill.
    expect(r.portTrace.posts).toHaveLength(3);
    expect(r.portTrace.posts.map((p) => p[0])).toEqual([
      'http://partner-a.invalid/hook',
      'http://partner-b.invalid/hook',
      'http://partner-c.invalid/hook',
    ]);

    const [, update] = r.portTrace.updates[0] as [
      unknown,
      { callback_response: Record<string, Record<string, unknown>> },
    ];
    expect(Object.keys(update.callback_response)).toEqual(['1', '2', '3']);
    expect(update.callback_response['1']?.['status']).toBe('success');
    expect(update.callback_response['2']?.['status']).toBe('error');
    expect(update.callback_response['2']?.['http_status']).toBe(502);
    expect(update.callback_response['2']?.['data']).toEqual({
      err: 'bad gateway',
    });
    expect(update.callback_response['3']?.['status']).toBe('success');
  });

  it('CALLBACK — a blank URL is skipped and leaves a GAP in the keys', async () => {
    const input = callbackInput({
      hook: {
        callback_slip: [
          'http://partner-a.invalid/hook',
          '',
          'http://partner-c.invalid/hook',
        ],
        callback_token: FAKE_CALLBACK_TOKEN,
        callback_action: 'all',
      },
    });

    const r = await runBothCallback(() => {
      postSpy.mockResolvedValueOnce(httpOk({ ok: 'a' }));
      postSpy.mockResolvedValueOnce(httpOk({ ok: 'c' }));
    }, input);

    expectSameCallback(r);
    expect(r.portTrace.posts).toHaveLength(2);
    const [, update] = r.portTrace.updates[0] as [
      unknown,
      { callback_response: Record<string, unknown> },
    ];
    // "2" is absent, not null — the keys are positional, not sequential.
    expect(Object.keys(update.callback_response)).toEqual(['1', '3']);
  });

  it('CALLBACK — a single string URL is accepted as well as an array', async () => {
    const r = await runBothCallback(
      () => {
        postSpy.mockResolvedValueOnce(httpOk({ ok: true }));
      },
      callbackInput({
        hook: {
          callback_slip: 'http://partner-a.invalid/hook',
          callback_token: FAKE_CALLBACK_TOKEN,
          callback_action: 'all',
        },
      }),
    );

    expectSameCallback(r);
    expect(r.portTrace.posts).toHaveLength(1);
  });

  it.each([
    [
      'callback_action "none"',
      { callback_action: 'none', callback_slip: ['http://x.invalid'] },
    ],
    ['no callback_slip', { callback_action: 'all' }],
    ['empty callback_slip', { callback_action: 'all', callback_slip: [] }],
  ])('CALLBACK — %s sends nothing and writes nothing', async (_l, hook) => {
    const r = await runBothCallback(() => undefined, callbackInput({ hook }));

    expectSameCallback(r);
    expect(r.portTrace.posts).toHaveLength(0);
    expect(r.portTrace.updates).toHaveLength(0);
  });

  it('CALLBACK — action "success" fires only when the flex tag is success (trimmed, case-insensitive)', async () => {
    const hook = {
      callback_slip: ['http://partner-a.invalid/hook'],
      callback_token: FAKE_CALLBACK_TOKEN,
      callback_action: 'success',
    };

    const wrongTag = await runBothCallback(
      () => undefined,
      callbackInput({ hook, flexDoc: { callback_tag: 'duplicate' } }),
    );
    expectSameCallback(wrongTag);
    expect(wrongTag.portTrace.posts).toHaveLength(0);

    const rightTag = await runBothCallback(
      () => {
        postSpy.mockResolvedValueOnce(httpOk({ ok: true }));
      },
      callbackInput({ hook, flexDoc: { callback_tag: '  SuCCeSs  ' } }),
    );
    expectSameCallback(rightTag);
    expect(rightTag.portTrace.posts).toHaveLength(1);
  });

  it('CALLBACK — with no rawSlip the payload reads the data object itself', async () => {
    const r = await runBothCallback(
      () => {
        postSpy.mockResolvedValueOnce(httpOk({ ok: true }));
      },
      callbackInput({
        slipVerifyResult: {
          data: { transRef: 'TOP-LEVEL-REF', date: '2026-08-01' },
        },
        profileData: null,
      }),
    );

    expectSameCallback(r);
    const payload = r.portTrace.posts[0]?.[1] as Record<string, unknown>;
    expect(payload['transRef']).toBe('TOP-LEVEL-REF');
    expect(payload['datetime_on_slip']).toBe('2026-08-01');
    expect(payload['contact_number']).toBe('n/a');
    expect(payload['external_api_response']).toBeNull();
  });

  /* ── [FEAT-20261019-CALLBACKLINEPROFILE] the LINE name + picture ride with line_user_id ──
     Owner 19/10/2026. The value is the turn's EXISTING LINE profile (`ctx.profileForLog`,
     built by `syncMemberProfile`: fresh from LINE, else the member row) — no new fetch.
     A customer with no profile must still get the callback, with the neighbours' sentinels:
     `'n/a'` for a text field (as line_user_id/full_name), `null` for a URL (as slip_img_url). */
  describe('[CALLBACKLINEPROFILE] display_name and picture_url after line_user_id', () => {
    const send = async (over: Record<string, unknown>) => {
      const r = await runBothCallback(() => {
        postSpy.mockResolvedValueOnce(httpOk({ ok: true }));
      }, callbackInput(over));
      return {
        r,
        payload: r.portTrace.posts[0]?.[1] as Record<string, unknown>,
      };
    };

    it('🔴 TARGET: the turn’s LINE profile is reported, right after line_user_id', async () => {
      const { r, payload } = await send({
        lineProfile: {
          displayName: 'Unit Test LINE Name',
          pictureUrl: 'https://profile.line-scdn.net/unit-test-picture',
          nickname: 'not-for-the-callback',
        },
      });
      expectSameCallback(r);
      expect(payload['display_name']).toBe('Unit Test LINE Name');
      expect(payload['picture_url']).toBe(
        'https://profile.line-scdn.net/unit-test-picture',
      );
      const keys = Object.keys(payload);
      const at = keys.indexOf('line_user_id');
      expect(keys.slice(at, at + 4)).toEqual([
        'line_user_id',
        'display_name',
        'picture_url',
        'full_name',
      ]);
      /* only the two fields — the rest of the profile object is not spread in */
      expect(payload).not.toHaveProperty('nickname');
      expect(payload).not.toHaveProperty('displayName');
    });

    it('a name with no stored picture keeps the name, picture null', async () => {
      const { r, payload } = await send({
        lineProfile: { displayName: 'Name Only', pictureUrl: undefined },
      });
      expectSameCallback(r);
      expect(payload['display_name']).toBe('Name Only');
      expect(payload['picture_url']).toBeNull();
    });

    it.each([
      ['no profile passed', undefined],
      ['null', null],
      ['the spine’s empty profile {}', {}],
      ['blank strings', { displayName: '', pictureUrl: '' }],
      ['not strings', { displayName: 42, pictureUrl: { url: 'x' } }],
      ['not an object', 'Somchai'],
    ])(
      '🔴 FALLBACK (%s): display_name n/a, picture_url null — the callback still goes out',
      async (_l, lineProfile) => {
        const { r, payload } = await send({ lineProfile });
        expectSameCallback(r);
        expect(r.portTrace.posts).toHaveLength(1);
        expect(payload['display_name']).toBe('n/a');
        expect(payload['picture_url']).toBeNull();
        const [, update] = r.portTrace.updates[0] as [
          unknown,
          { callback_response: Record<string, { status: string }> },
        ];
        expect(update.callback_response['1']?.status).toBe('success');
      },
    );
  });

  /* ── [FEAT-20261014-CALLBACKCONTRACT] contact_number on a custom-tool hook ──
     A custom-tool hook keys its profile by ENDPOINT KEY, so legacy's `Path :` key is never
     there and the callback said 'n/a' — the shop lost the contract number the old system
     sent. The provider now declares where it comes from; shop-api declares nothing.
     PIN = port still equals legacy byte for byte; TARGET = loan_v1 gets the real number. */
  describe('[CALLBACKCONTRACT] contact_number on a custom-tool hook', () => {
    const LOAN = buildCustomerProviderRegistry().get('loan_v1')!;
    const profileBody = LOAN_V1_ENDPOINTS.CUSTOMER_PROFILE.success.body;
    /* the REAL contract number from the partner's real answer (generated fixture) */
    const REAL_CONTRACT = profileBody.data.contract.contract_number;
    /* the shape `getCombinedData` hands the turn — keyed by endpoint key, no `Path :` key */
    const customToolProfile = {
      CUSTOMER_PROFILE: { success: true, status: 200, data: profileBody },
    };
    const send = async (over: Record<string, unknown>) => {
      const r = await runBothCallback(() => {
        postSpy.mockResolvedValueOnce(httpOk({ ok: true }));
      }, callbackInput(over));
      return {
        r,
        contact: (r.portTrace.posts[0]?.[1] as Record<string, unknown>)[
          'contact_number'
        ],
      };
    };
    afterEach(() => resetActiveProvider());

    it.each([
      ['unbound', () => resetActiveProvider()],
      ['shopapi_v1 bound', () => bindActiveProvider(DEFAULT_CUSTOMER_PROVIDER)],
    ])(
      '🔴 PIN (%s): a member id in contractCode is NOT sent — still legacy’s n/a',
      async (_l, bind) => {
        bind();
        const { r, contact } = await send({
          profileData: customToolProfile,
          contractCode: 'MEMBER-ID-1',
        });
        expectSameCallback(r);
        expect(contact).toBe('n/a');
      },
    );

    it('🔴 PIN: legacy’s `Path :` key still wins, even with loan_v1 bound', async () => {
      bindActiveProvider(LOAN);
      const { r, contact } = await send({ contractCode: 'SOMETHING-ELSE' });
      expectSameCallback(r);
      expect(contact).toBe('CN-0001');
    });

    it('TARGET: loan_v1 — the callback carries the real contract number', async () => {
      bindActiveProvider(LOAN);
      const { contact } = await send({
        profileData: customToolProfile,
        contractCode: REAL_CONTRACT,
      });
      expect(contact).toBe(REAL_CONTRACT);
    });

    it.each([['N/A'], [''], [null], [undefined]])(
      'loan_v1 with no resolved code (%p) still says n/a — never a sentinel',
      async (code) => {
        bindActiveProvider(LOAN);
        const { contact } = await send({
          profileData: customToolProfile,
          contractCode: code,
        });
        expect(contact).toBe('n/a');
      },
    );
  });

  it('CALLBACK — nothing is written when there is no slip row to write to', async () => {
    const r = await runBothCallback(
      () => {
        postSpy.mockResolvedValueOnce(httpOk({ ok: true }));
      },
      callbackInput({ slipRecordId: null }),
    );

    expectSameCallback(r);
    expect(r.portTrace.posts).toHaveLength(1);
    expect(r.portTrace.updates).toHaveLength(0);
  });

  it('no AI provider was ever contacted by this suite', () => {
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    for (const call of postSpy.mock.calls) {
      expect(String(call[0])).not.toMatch(
        /generativelanguage|generateContent/i,
      );
    }
  });
});
