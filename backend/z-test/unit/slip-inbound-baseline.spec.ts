/**
 * =============================================================================
 * [FEAT-20260902-SLIPBASELINE] The INBOUND side: a provider reply → the row.
 * =============================================================================
 *
 * WHY THIS EXISTS — the other half of the before-picture.
 * `slip-outbound-baseline.spec.ts` pins what we SEND. This pins what we do with
 * what comes BACK: the mapping from a provider envelope onto the
 * `slip_verifications` row, in all three write variants.
 *
 * Nothing covered it. `run-full-flow.sh` S2 obtains its slip from
 * `make-swiftcheck-slip.mjs`, which REPRODUCES this mapping rather than exercising
 * it, so the two could drift apart silently and every stage would stay green.
 * S9 covers which CARD an envelope selects — a different contract, and already
 * pinned. The row mapping sat between them, uncovered.
 *
 * WHY IT MATTERS: a second provider has to fold its reply into exactly this
 * shape. The mapping is not a rename — every account/name/bank field has a two-
 * or three-step fallback, and those fallbacks ARE the contract (the VARIANT 1
 * success branch of `verifySlip`, `slip-flow.service.ts`). An adapter that fills `name.th` but not
 * `name.en`, or that supplies a bank account where a PromptPay proxy is
 * expected, produces a row that looks fine and reads wrong.
 *
 * ── THE ENVELOPES ARE SYNTHETIC, AND THAT IS THE STRONGER CHOICE ────────────
 * `z-test/fixtures/swiftcheck-*.json` hold real captured replies, but a single real
 * slip exercises ONE branch of each fallback — whichever way that customer's
 * bank happened to answer. The envelopes below are built to take a DIFFERENT
 * branch in each case, so the golden covers combinations no real slip on this
 * machine does. They also carry no customer names or account numbers, so the
 * committed golden is safe to read.
 *
 * ⚠️ One real-data fact is asserted directly, because it contradicts the type:
 * Swiftcheck returns `matchedAccount` as an OBJECT (bank / nameTh / nameEn /
 * bankNumber — see `fixtures/swiftcheck-success.json`), while
 * `SlipVerifyResultLike` declares it `boolean`. Consumers only test it for
 * truthiness so nothing breaks, but an adapter author reading the type would
 * emit the wrong thing. Pinned below so the lie cannot be inherited.
 *
 * revert: delete this file and its fixture. Nothing imports it.
 */
import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import axios from 'axios';
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

const FIXTURE = resolve(__dirname, '../fixtures/slip-inbound-baseline.json');
const FIXED_NOW = new Date('2026-09-02T12:00:00.000Z').getTime();

/** Every capture writes exactly one row; this is what the row contained. */
type Row = Record<string, unknown>;

describe('[SLIPBASELINE] a provider reply maps onto the slip row the same way', () => {
  let service: SlipFlowService;
  let tmpDir: string;
  let imagePath: string;
  let written: Row[] = [];
  const loggerSpies: jest.SpyInstance[] = [];

  beforeAll(async () => {
    for (const m of ['log', 'error', 'warn', 'debug'] as const) {
      loggerSpies.push(jest.spyOn(Logger.prototype, m).mockImplementation());
    }
    tmpDir = mkdtempSync(join(tmpdir(), 'slip-inbound-'));
    imagePath = join(tmpDir, 'slip.jpg');
    writeFileSync(imagePath, Buffer.from([1, 2, 3, 4]));

    const moduleRef = await Test.createTestingModule({
      providers: [
        SlipFlowService,
        {
          provide: getModelToken(SlipVerification.name),
          useValue: {
            create: (doc: Row) => {
              written.push(doc);
              return Promise.resolve({ ...doc, _id: 'row' });
            },
          },
        },
        { provide: CryptoService, useValue: { safeDecrypt: () => 'K' } },
        {
          provide: WebhookLogService,
          useValue: { createLog: () => Promise.resolve(null) },
        },
        {
          provide: integrationConfig.KEY,
          useValue: {
            swiftcheckApiBaseUrl: 'https://api.swiftcheck.example.com/v2',
          },
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

  /**
   * Run the real service against one canned reply and return the row it wrote.
   * `reply` may be a resolved body or an Error to reject with.
   */
  async function rowFor(
    reply: unknown,
    isError = false,
    /**
     * Keep `raw_request` on the returned row. Off by default because the golden
     * must not carry a base64 image, but the presence/absence of the key is
     * itself a contract — VARIANT 3 has never had it — so one test needs to see
     * it. See the assertion in "three DIFFERENT field sets".
     */
    keepRawRequest = false,
  ): Promise<Row> {
    written = [];
    mockedAxios.post.mockReset();
    if (isError) mockedAxios.post.mockRejectedValue(reply);
    else mockedAxios.post.mockResolvedValue({ status: 200, data: reply });

    await service.verifySlip({
      hook: {
        _id: 'hook1' as never,
        alias: 'baseline',
        display_name: 'Display Name',
        line_oa_name: 'OA Name',
        slip_check: true,
        slip_verify_key: 'enc:k',
        match_account: true,
      },
      storage: { file_path: imagePath },
      storageId: null,
      userId: 'Uxyz',
      messageId: 'mid',
    });

    expect(written).toHaveLength(1);
    const row = { ...written[0] };
    // The image is not part of this contract and is large; the outbound spec
    // already proves it is redacted before it is stored.
    if (!keepRawRequest) delete row['raw_request'];
    return row;
  }

  /** Success, taking the FIRST branch of every fallback: th name, bank.short,
   *  a real bank account on the receiver. */
  const SUCCESS_PRIMARY = {
    success: true,
    data: {
      isDuplicate: false,
      amountInSlip: 1200,
      rawSlip: {
        transRef: 'REF-PRIMARY',
        date: '2026-08-09T19:00:25+07:00',
        amount: { amount: 1200 },
        sender: {
          bank: { short: 'SENDSHORT', name: 'sender bank name' },
          account: {
            name: { th: 'sender-th', en: 'sender-en' },
            bank: { account: 'S-ACC' },
          },
        },
        receiver: {
          bank: { short: 'RECVSHORT', name: 'receiver bank name' },
          account: {
            name: { th: 'receiver-th', en: 'receiver-en' },
            bank: { account: 'R-ACC' },
          },
        },
      },
    },
  };

  /** Success, taking the SECOND branch everywhere: no th name, no bank.short,
   *  and a PromptPay proxy instead of a bank account on the receiver. This is
   *  the combination the receiver's `bank.account || proxy.account` fallback
   *  exists for. */
  const SUCCESS_FALLBACK = {
    success: true,
    data: {
      isDuplicate: false,
      amountInSlip: 55,
      rawSlip: {
        transRef: 'REF-FALLBACK',
        date: '2026-08-10T11:49:34+07:00',
        amount: { amount: 55 },
        sender: {
          bank: { name: 'sender bank name only' },
          account: {
            name: { en: 'sender-en-only' },
            bank: { account: 'S-ACC2' },
          },
        },
        receiver: {
          bank: { name: 'receiver bank name only' },
          account: {
            name: { en: 'receiver-en-only' },
            proxy: { account: 'PROMPTPAY-1' },
          },
        },
      },
    },
  };

  /** Success with NOTHING optional present — every fallback falls to its last
   *  step. `transRef` absent is what mints the synthetic `SWIFTCHECK_<ms>` ref. */
  const SUCCESS_EMPTY = { success: true, data: { rawSlip: {} } };

  /**
   * Receiver carrying BOTH a bank account and a proxy, so the PRECEDENCE between
   * them is pinned rather than merely the presence of one.
   *
   * ⚠️ ADDED BECAUSE A MUTATION SURVIVED. Swapping
   * `bank.account || proxy.account` to `proxy.account || bank.account`
   * (the receiver fallback in `verifySlip`) left every test green: the two cases above
   * supply one field each, so the order could not matter. A real slip can carry
   * both, and then the order decides which account number is recorded against
   * the money. Without this case that line was untested and looked tested.
   */
  const SUCCESS_BOTH_RECEIVER_FORMS = {
    success: true,
    data: {
      isDuplicate: false,
      amountInSlip: 77,
      rawSlip: {
        transRef: 'REF-BOTH',
        date: '2026-08-11T09:00:00+07:00',
        amount: { amount: 77 },
        sender: {
          bank: { short: 'S' },
          account: { name: { th: 'sender-th' }, bank: { account: 'S-ACC3' } },
        },
        receiver: {
          bank: { short: 'R' },
          account: {
            name: { th: 'receiver-th' },
            bank: { account: 'BANK-WINS' },
            proxy: { account: 'PROXY-LOSES' },
          },
        },
      },
    },
  };

  it('matches the recorded baseline for every variant', async () => {
    /* The row carries a real `Date` in `transaction_date`, which the golden can
     * only hold as an ISO string. Compare both sides AFTER the same JSON round
     * trip, or the test fails on the representation rather than on the mapping.
     * ⚠️ Found by the mutation pass: without this the spec was red from the
     * moment the golden was written, and three mutations "changed nothing"
     * because they could not make an already-red test redder. */
    const serialise = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

    const actual = serialise({
      v1_success_primary: await rowFor(SUCCESS_PRIMARY),
      v1_success_fallback: await rowFor(SUCCESS_FALLBACK),
      v1_success_empty: await rowFor(SUCCESS_EMPTY),
      v1_receiver_has_both: await rowFor(SUCCESS_BOTH_RECEIVER_FORMS),
      v2_api_said_no: await rowFor({ success: false, message: 'nope' }),
      v3_call_threw: await rowFor(new Error('boom'), true),
    }) as Record<string, Row>;

    if (!existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
      throw new Error(
        `[SLIPBASELINE] no golden existed, so one was RECORDED at\n  ${FIXTURE}\n` +
          `Review it, commit it, and re-run. This failure is deliberate.`,
      );
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  });

  it('the three variants write three DIFFERENT field sets, not one shape with a flag', async () => {
    // Called out in the service header as behaviour a tidy-up would erase.
    const ok = await rowFor(SUCCESS_PRIMARY);
    const no = await rowFor({ success: false });
    const err = await rowFor(new Error('x'), true);

    expect(ok['slip_type']).toBe('Bank Transfer');
    expect(no).not.toHaveProperty('slip_type');
    expect(err).not.toHaveProperty('slip_type');

    expect(ok).toHaveProperty('raw_content');
    expect(no).not.toHaveProperty('raw_content'); // only the success variant carries it
    expect(err).not.toHaveProperty('raw_content');

    /* 🔴 VARIANT 3 HAS NEVER CARRIED `raw_request`, and this is the only thing
     * asserting it. The golden cannot: `rowFor` strips `raw_request` from every
     * row before comparing. The port's own note used to claim the opposite, and
     * a wiring engineer who trusted it would "restore" the field onto the `ERR_`
     * row — a silent schema change on the money path's failure row. */
    expect(await rowFor(SUCCESS_PRIMARY, false, true)).toHaveProperty(
      'raw_request',
    );
    expect(await rowFor({ success: false }, false, true)).toHaveProperty(
      'raw_request',
    );
    expect(await rowFor(new Error('x'), true, true)).not.toHaveProperty(
      'raw_request',
    );

    expect(err['metadata']).toEqual({ error_type: 'exception', message: 'x' });
    expect(ok).not.toHaveProperty('metadata');
    expect(no).not.toHaveProperty('metadata');
  });

  it('the three trans_ref prefixes stay distinguishable', async () => {
    // An operator tells an outage from a rejection by this prefix alone —
    // the comment on the `ERR_` branch in `verifySlip` says so explicitly.
    expect(await rowFor(SUCCESS_PRIMARY).then((r) => r['trans_ref'])).toBe(
      'REF-PRIMARY',
    );
    expect(String((await rowFor(SUCCESS_EMPTY))['trans_ref'])).toMatch(
      /^SWIFTCHECK_\d+$/,
    );
    expect(String((await rowFor({ success: false }))['trans_ref'])).toMatch(
      /^FAIL_\d+$/,
    );
    expect(String((await rowFor(new Error('x'), true))['trans_ref'])).toMatch(
      /^ERR_\d+$/,
    );
  });

  it('the receiver falls back to a PromptPay proxy and the sender never does', async () => {
    // The asymmetry is deliberate: a sender is always a real account, a receiver
    // may be a proxy — see the `receiver_account_no` comment in `verifySlip`.
    const r = await rowFor(SUCCESS_FALLBACK);
    expect(r['receiver_account_no']).toBe('PROMPTPAY-1');
    expect(r['sender_account_no']).toBe('S-ACC2');
    expect(r['receiver_account_name']).toBe('receiver-en-only'); // th absent → en
    expect(r['receiver_bank']).toBe('receiver bank name only'); // short absent → name

    /* PRECEDENCE, not just presence. With both forms on the receiver the BANK
     * account wins and the proxy is ignored. Added after a mutation swapping the
     * two survived every other assertion — see the fixture's own note. */
    const both = await rowFor(SUCCESS_BOTH_RECEIVER_FORMS);
    expect(both['receiver_account_no']).toBe('BANK-WINS');
  });

  it('records that Swiftcheck sends matchedAccount as an OBJECT, not the declared boolean', () => {
    // Guard against an adapter author trusting `SlipVerifyResultLike`.
    const real = JSON.parse(
      readFileSync(
        resolve(__dirname, '../fixtures/swiftcheck-success.json'),
        'utf8',
      ),
    ) as { matchedAccount?: unknown };
    expect(typeof real.matchedAccount).toBe('object');
    expect(real.matchedAccount).not.toBeNull();
    // And the consumer only ever asks whether it is truthy.
    expect(Boolean(real.matchedAccount)).toBe(true);
  });
});
