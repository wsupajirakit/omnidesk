/**
 * [FEAT-20260808-PAYTOOL-P2] Before/after proof for the payment runtime core with
 * the CORRECTED control flow: topup `success` is TERMINAL SUCCESS (no
 * walletpay); the 4 topup fail statuses fall through to walletpay (the ALTERNATIVE
 * credit path). Also covers the money-safety CAS lock, the finalize/release
 * rules, the reply-per-state config map, the Shop-API multipart HMAC aligned to the
 * ground-truth .sh, the money-leg no-retry guard, and the legacy-faithful
 * chain-log — all with FAKES ONLY (no DB, no network, no real keys).
 *
 * Sections:
 *  A. normalizePayment whitelist + reply_detail "-" fallback (P2B).
 *  B. executor form-data BYTE-IDENTICAL when no fileParts; additive with a file;
 *     money-leg disableRetry suppresses the idempotency auto-retry (P2D).
 *  C. Shop-API validate-slip multipart signer = ground-truth .sh (incl. `&` web_code).
 *  D. runner — corrected flow: success→SUCCESS(no walletpay); the 4 fails→
 *     walletpay; duplicate == others; statement-not-found→fallback+RELEASE; walletpay
 *     success/pending/no_match-exhausted/ambiguous-200; CAS race; chain-log.
 *
 * revert: delete this file with the [FEAT-20260808-PAYTOOL-P2] edits.
 */
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import axios from 'axios';
import { Types } from 'mongoose';

/* [COPY-20260810-AMOUNTMISMATCH] Assert against the copy SOURCE, not a literal.
 * This test previously hardcoded the sentence, so an owner-approved wording change
 * failed it for no real reason. What matters here is that the runner returns the
 * `statement_not_found` copy — not what that copy currently says. เทียบกับต้นทางของคำ
 * ไม่ใช่ตัวอักษร ⇒ แก้ข้อความแล้วเทสไม่แดงเปล่า ๆ. */
// [FIX-20260811-LINTBARREL] through the barrel, like production callers.
import { REPLY_TEXT } from '@/modules/payment';

import { normalizePayment } from '@/modules/hooks';
import { CustomToolService } from '@/modules/external';
import {
  PaymentRunnerService,
  buildValidateSlipHeaders,
} from '@/modules/payment';

/** ObjectId-safe string equality for the stateful fakes. */
const idEq = (a: unknown, b: unknown): boolean => String(a) === String(b);

/* [FIX-20260811-LINTMOCK] Field comparison that cannot fall into Object's
 * default '[object Object]' — under a bare String() ANY two objects compare
 * equal, so a filter carrying an object field could match a run it should not.
 * ObjectId/Date get their real string forms (hex/ISO), which keeps the
 * string-vs-ObjectId id comparisons working exactly as before. */
const cmpStr = (u: unknown): string => {
  if (u == null) return '';
  if (u instanceof Types.ObjectId) return u.toHexString();
  if (u instanceof Date) return u.toISOString();
  if (typeof u === 'string') return u;
  if (typeof u === 'object') return JSON.stringify(u) ?? '';
  if (
    typeof u === 'number' ||
    typeof u === 'boolean' ||
    typeof u === 'bigint'
  ) {
    return String(u);
  }
  return ''; // symbol/function — never a filter value in these fakes
};

/** A minimal chainable Mongoose query stub resolving to `value`. */
function q<T>(value: T) {
  const stub: Record<string, unknown> = {};
  for (const m of ['lean', 'sort', 'populate', 'select', 'limit']) {
    stub[m] = () => stub;
  }
  stub.exec = () => Promise.resolve(value);
  return stub;
}

// ═══════════════════════ A. normalizePayment ═══════════════════════

describe('[PAYTOOL-P2] normalizePayment whitelist + reply_detail fallback', () => {
  it('defaults every knob and stores reply_detail empty when absent', () => {
    const p = normalizePayment({})!;
    expect(p.statement_tx_path).toBe('data.profile.transaction');
    expect(p.statement_provider_code).toBe('walletpay');
    expect(p.statement_status).toBe('waiting-deposit');
    expect(p.walletpay_ref_id_field).toBe('ref_id');
    expect(p.walletpay_file_field).toBe('slip');
    expect(p.topup_to_walletpay_map).toEqual({});
    expect(p.reply_detail).toBe(''); // "-" fallback is applied by the runner
    expect(p.topup_payload_path).toBe('');
  });

  it('[P2C] whitelists the reply-per-state override texts', () => {
    const p = normalizePayment({
      reply_success_text: 'เครดิตเข้าแล้ว',
      pending_reply_text: 'รอแอดมิน',
      review_reply_text: 'ติดต่อแอดมิน',
      not_found_reply_text: 'หายอดไม่พบ',
    })!;
    expect(p.reply_success_text).toBe('เครดิตเข้าแล้ว');
    expect(p.pending_reply_text).toBe('รอแอดมิน');
    expect(p.review_reply_text).toBe('ติดต่อแอดมิน');
    expect(p.not_found_reply_text).toBe('หายอดไม่พบ');
  });

  it('returns undefined for a non-object (generic tool keeps no payment key)', () => {
    expect(normalizePayment(undefined)).toBeUndefined();
    expect(normalizePayment('x')).toBeUndefined();
  });
});

// ═══════════ B. executor form-data byte-identical (custool unchanged) ═══════════

jest.mock('axios', () => ({ __esModule: true, default: jest.fn() }));

const mockAxios = axios as unknown as jest.Mock;

function makeExecutor(): CustomToolService {
  const redis = {
    getClient: () => {
      throw new Error('no redis in unit');
    },
  };
  const noop = { create: jest.fn(), findOne: jest.fn(() => q(null)) };
  return new CustomToolService(
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    { safeDecrypt: () => '' } as never,
    redis as never,
    /* [FIX-20260905-GLOBALNS] the environment segment the constructor derives */
    { wsEnv: 'dev' } as never,
    { uri: 'mongodb://127.0.0.1:27017/testdb' },
  );
}

const formTool = {
  _id: new Types.ObjectId(),
  name: 't',
  auth_type: 'none',
  base_url: 'https://walletpay.test',
  timeout_ms: 8000,
  hmac: {},
  endpoints: [
    {
      key: 'WALLETPAY',
      method: 'POST',
      path: 'api/v1/public/payin/REF/slip',
      request_type: 'form-data',
      require_jwt: false,
      payload: { note: 'x', kind: 'slip' },
      status: true,
    },
  ],
};

describe('[PAYTOOL-P2] executor form-data — generic path byte-identical', () => {
  beforeEach(() => {
    mockAxios.mockReset();
    mockAxios.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  it('(B1) NO fileParts ⇒ fields only, NO file part (byte-identical to today)', async () => {
    await makeExecutor().call(formTool as never, 'WALLETPAY', 'U1', {}, {});
    const cfg = mockAxios.mock.calls[0][0];
    const body = (cfg.data.getBuffer() as Buffer).toString('utf8');
    expect(body).toContain('name="note"');
    expect(body).toContain('name="kind"');
    expect(body).not.toContain('filename='); // file loop is a no-op
    expect(body).not.toContain('name="slip"');
    expect(String(cfg.headers['content-type'] || '')).toMatch(
      /multipart\/form-data/,
    );
  });

  it('(B2) WITH fileParts + extraHeaders ⇒ same fields PLUS file + headers', async () => {
    await makeExecutor().call(
      formTool as never,
      'WALLETPAY',
      'U1',
      {},
      {
        fileParts: [
          {
            field: 'slip',
            buffer: Buffer.from('JPEGBYTES'),
            filename: 'slip.jpg',
            contentType: 'image/jpeg',
          },
        ],
        extraHeaders: { 'X-Signature': 'sig123', 'X-Timestamp': '111' },
      },
    );
    const cfg = mockAxios.mock.calls[0][0];
    const body = (cfg.data.getBuffer() as Buffer).toString('utf8');
    expect(body).toContain('name="note"'); // fields unchanged
    expect(body).toContain('name="slip"'); // file added
    expect(body).toContain('filename="slip.jpg"');
    expect(body).toContain('JPEGBYTES');
    expect(cfg.headers['X-Signature']).toBe('sig123'); // extraHeaders passed through
    expect(cfg.headers['X-Timestamp']).toBe('111');
  });
});

describe('[PAYTOOL-P2D] executor money-leg no-retry (disableRetry)', () => {
  // A JSON endpoint with idempotency + retry_on_timeout enabled — the exact
  // config a money leg might be given by mistake.
  const retryTool = {
    _id: new Types.ObjectId(),
    name: 'r',
    auth_type: 'none',
    base_url: 'https://shop-api.test',
    timeout_ms: 8000,
    hmac: {},
    endpoints: [
      {
        key: 'TOPUP',
        method: 'POST',
        path: 'validate-slip',
        request_type: 'json',
        require_jwt: false,
        payload: {},
        status: true,
        idempotency: { enabled: true, retry_on_timeout: 2 },
      },
    ],
  };
  const timeoutErr = Object.assign(new Error('timeout of 8000ms exceeded'), {
    code: 'ECONNABORTED',
  });

  beforeEach(() => mockAxios.mockReset());

  it('(B3a) idempotency retry FIRES for a generic caller (baseline)', async () => {
    mockAxios.mockRejectedValue(timeoutErr);
    await makeExecutor().call(
      retryTool as never,
      'TOPUP',
      'U1',
      {},
      {
        idempotencyKey: 'K1',
      },
    );
    // 1 initial + 2 retries = 3 attempts (existing behaviour, unchanged).
    expect(mockAxios).toHaveBeenCalledTimes(3);
  });

  it('(B3b) disableRetry BARS the retry for a money leg (1 attempt only)', async () => {
    mockAxios.mockRejectedValue(timeoutErr);
    await makeExecutor().call(
      retryTool as never,
      'TOPUP',
      'U1',
      {},
      {
        idempotencyKey: 'K1',
        disableRetry: true,
      },
    );
    expect(mockAxios).toHaveBeenCalledTimes(1); // no blind re-POST of a money leg
  });
});

// ═══════════ C. Shop-API validate-slip multipart signer ═══════════

describe('[PAYTOOL-P2] validate-slip multipart HMAC signer (ground-truth algo)', () => {
  it('reproduces canonical + HMAC exactly as standalone-validate-slip.sh', () => {
    const secret = 'testsecret';
    const webCode = 'a1-test';
    const fileBuf = Buffer.from('IMGDATA');
    const fileSha = createHash('sha256').update(fileBuf).digest('hex');
    const out = buildValidateSlipHeaders({
      secret,
      webCode,
      fields: { web_code: webCode, line_user_id: 'UTEST01' },
      file: { field: 'upload_file', buffer: fileBuf, filename: 'slip.jpg' },
      now: 1_700_000_000_000,
    });
    // canonical = sorted-key compact JSON, file reduced to sha256;filename.
    const expectedCanonical = JSON.stringify({
      line_user_id: 'UTEST01',
      upload_file: `sha256:${fileSha};filename:slip.jpg`,
      web_code: webCode,
    });
    expect(out.canonical).toBe(expectedCanonical);
    expect(out.timestamp).toBe('1700000000');
    const expectedSig = createHmac('sha256', secret)
      .update(`${webCode}1700000000${expectedCanonical}`, 'utf8')
      .digest('hex');
    expect(out.headers['X-Signature']).toBe(expectedSig);
    expect(out.headers['X-Timestamp']).toBe('1700000000');
  });

  it('(HMAC vs .sh) a web_code containing `&` signs identically — NO Go-escape', () => {
    // The ground-truth .sh uses python json.dumps(ensure_ascii=False) which does
    // NOT escape & < >. This recomputes canonical THAT way and asserts a match —
    // an earlier goEscape build would diverge (\\u0026) and 401 on the server.
    // NOT A REAL KEY. This test proves the CANONICALISATION (no Go-escape), and
    // for that any secret works — both sides of the assertion use this same
    // value, so it cancels out. Owner rule 2026-08-09: never commit a demo or
    // real key, in code or in .md. ห้าม push ไฟล์ที่มีคีย์.
    const secret = 'unit-test-not-a-real-hmac-secret';
    const webCode = 'a1&b<c>';
    const fileBuf = Buffer.from('IMGDATA');
    const fileSha = createHash('sha256').update(fileBuf).digest('hex');
    const out = buildValidateSlipHeaders({
      secret,
      webCode,
      fields: { web_code: webCode, line_user_id: 'U&1' },
      file: { field: 'upload_file', buffer: fileBuf, filename: 'slip.jpg' },
      now: 1_700_000_000_000,
    });
    // The .sh's canonical: json.dumps(sort_keys, separators=(',',':'),
    // ensure_ascii=False) — literal &, <, >. JSON.stringify(sorted) matches it.
    const shCanonical = JSON.stringify({
      line_user_id: 'U&1',
      upload_file: `sha256:${fileSha};filename:slip.jpg`,
      web_code: webCode,
    });
    expect(out.canonical).toBe(shCanonical);
    expect(out.canonical).not.toContain('\\u0026'); // NOT go-escaped
    const shSig = createHmac('sha256', secret)
      .update(`${webCode}1700000000${shCanonical}`, 'utf8')
      .digest('hex');
    expect(out.headers['X-Signature']).toBe(shSig);
  });
});

// ═══════════════════════ D. payment runner ═══════════════════════

const SLIP_ID = new Types.ObjectId();
const IMG_ID = new Types.ObjectId();
const HOOK_ID = new Types.ObjectId();
const PAY_TOOL_ID = new Types.ObjectId();

let imgPath: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'paytool-p2-'));
  imgPath = join(dir, 'slip.jpg');
  writeFileSync(imgPath, Buffer.from('SLIPIMAGE'));
});

function paymentTool(payment: Record<string, unknown> = {}) {
  return {
    _id: PAY_TOOL_ID,
    name: 'pay',
    category: 'payment',
    status: true,
    api_key: 'ENC(secret)',
    payment,
    endpoints: [
      {
        key: 'TOPUP',
        role: 'pay_topup',
        method: 'POST',
        request_type: 'form-data',
        status: true,
      },
      {
        key: 'WALLETPAY',
        role: 'pay_walletpay',
        method: 'POST',
        request_type: 'form-data',
        status: true,
      },
    ],
  };
}

// Real walletpay bodies per the owner contract (all HTTP 200).
const walletpayMatched = {
  refId: 'REF-OK',
  messageType: 'SINGLE_MATCHED',
  message: 'สำเร็จ',
  uploadResult: [
    {
      matchResult: {
        status: 'matched',
        confirmed: true,
        transactionId: 'TXN9',
        bankExpectId: 'BE9',
      },
    },
  ],
};
const walletpayPending = {
  messageType: 'SINGLE_MATCHED',
  message: 'PROCESSING',
  uploadResult: [{ matchResult: { status: 'matched', confirmed: false } }],
};
const walletpayNoMatch = {
  messageType: 'SINGLE_NOT_MATCHED',
  uploadResult: [{ matchResult: { status: 'no_match' } }],
};
// Ambiguous 200: SINGLE_MATCHED but `confirmed` OMITTED — must NOT be SUCCESS.
const walletpayAmbiguous = {
  messageType: 'SINGLE_MATCHED',
  message: 'weird',
  uploadResult: [{ matchResult: { status: 'matched' } }],
};
// topup validate-slip CallResults — `.data` is the response BODY
// `{ data: { slip_status: { status } } }` (classified via `data.slip_status.status`).
// [FIX-20260811-TOPUPSUCCESS] terminal-success = 'success' (เดิม 'process-wallet').
// Shop-API เปลี่ยน spec — เจ้าของยืนยัน 2026-08-11 ("ใช้ success อย่างเดียว").
const topupProceed = {
  success: true,
  status: 200,
  data: { data: { slip_status: { status: 'success', message: 'ok' } } },
  method: 'POST',
  url: 'http://shop-api/validate-slip',
};
const topupReject = (status: string, message: string) => ({
  success: true,
  status: 200,
  data: { data: { slip_status: { status, message } } },
  method: 'POST',
  url: 'http://shop-api/validate-slip',
});
const walletOk = {
  success: true,
  status: 200,
  data: walletpayMatched,
  method: 'POST',
  url: 'http://walletpay',
};

interface RunnerFakes {
  /** [FEAT-20260810-PAYTICKET] ticket ที่ถูกสร้างระหว่างรัน — ตรวจจำนวน/ฟิลด์ได้ */
  ticketsCreated: Record<string, unknown>[];
  /** [FEAT-20260810-PAYTICKET] realtime event ที่ถูกยิงระหว่างรัน */
  published: { t: string; d: unknown }[];
  chatRoomModel: { findOneAndUpdate: jest.Mock; findOne?: jest.Mock };
  ticketModel: { create: jest.Mock };
  /** [FIX-20260811-PAYDIVIDER] เส้นคั่นที่ถูกเขียนตอนห้องถูก claim อยู่แล้ว */
  dividersCreated: Record<string, unknown>[];
  chatMessageModel: { create: jest.Mock };
  slipState: Record<string, unknown>;
  slipModel: Record<string, jest.Mock>;
  runModel: Record<string, jest.Mock>;
  jobModel: Record<string, jest.Mock>;
  resultModel: Record<string, jest.Mock>;
  customTool: { getTool: jest.Mock; call: jest.Mock };
  hookModel: Record<string, jest.Mock>;
  runs: Array<Record<string, unknown>>;
  results: Array<[unknown, unknown]>;
}

function makeRunner(opts: {
  tool?: Record<string, unknown> | null;
  slip?: Record<string, unknown>;
  rawProfile?: unknown;
  /** [2c] What the resume path re-reads for the hook. `null` = hook gone. */
  hookDoc?: Record<string, unknown> | null;
  /** [2c] Seed an existing chain-run doc (the paused run a retry resumes). */
  seedRun?: Record<string, unknown>;
  callImpl: (body: Record<string, unknown>, o: { role?: string }) => unknown;
  /** [FEAT-20260810-PAYTICKET] false = ห้องถูก claim อยู่แล้ว (จำลองว่ามีคนดูแล) */
  roomClaimable?: boolean;
  /** [FEAT-20260816-DUPSUCCESSLOCK] what slipModel.findOne answers for the
   *  prior-success lookup. Default null (no prior row) — every pre-existing
   *  test keeps its behaviour. 'THROW' simulates a dead DB (fail-open case). */
  priorSuccessSlip?: Record<string, unknown> | null | 'THROW';
}): { runner: PaymentRunnerService; f: RunnerFakes } {
  const slipState: Record<string, unknown> = {
    _id: SLIP_ID,
    api_status: 'success',
    amount: 100,
    trans_ref: 'TR1',
    internal_content_id: IMG_ID,
    sender_member_user_id: 'M1',
    raw_content: { success: true, data: { amountInSlip: 100 } },
    consumed: false,
    lock_reason: '',
    consumed_by_run: null,
    ...(opts.slip || {}),
  };

  const slipModel = {
    findById: jest.fn(() => q({ ...slipState })),
    // [FEAT-20260816-DUPSUCCESSLOCK] the prior-success lookup. Filter shape is
    // asserted by DS1; the returned row is whatever the test injected.
    findOne: jest.fn(() => {
      if (opts.priorSuccessSlip === 'THROW') throw new Error('db down');
      return q(opts.priorSuccessSlip ?? null);
    }),
    updateOne: jest.fn(
      (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const set = (update.$set || {}) as Record<string, unknown>;
        let modifiedCount = 0;
        const cons = filter.consumed;
        const isCas =
          cons &&
          typeof cons === 'object' &&
          (cons as { $ne?: unknown }).$ne === true;
        if (isCas) {
          if (slipState.consumed !== true) {
            Object.assign(slipState, set);
            modifiedCount = 1;
          }
        } else if (filter.consumed === true) {
          if (
            slipState.consumed === true &&
            idEq(slipState.consumed_by_run, filter.consumed_by_run)
          ) {
            Object.assign(slipState, set);
            modifiedCount = 1;
          }
        } else if (filter.consumed_by_run !== undefined) {
          if (idEq(slipState.consumed_by_run, filter.consumed_by_run)) {
            Object.assign(slipState, set);
            modifiedCount = 1;
          }
        }
        return q({
          acknowledged: true,
          matchedCount: modifiedCount,
          modifiedCount,
        });
      },
    ),
  };

  const runs: Array<Record<string, unknown>> = [];
  if (opts.seedRun) runs.push({ ...opts.seedRun });
  const runModel = {
    findOne: jest.fn(() => q(null)),
    // [2c] The resume path loads the paused run by id. Reads from the SAME
    // `runs` array the updates mutate, so a test can assert the run's state
    // after a resume exactly as it does after a first run.
    findById: jest.fn((id: unknown) =>
      q(runs.find((x) => String(x._id) === String(id)) ?? null),
    ),
    // Push a COPY so later updateOne mutations don't rewrite the create snapshot.
    create: jest.fn((doc: Record<string, unknown>) => {
      runs.push({ ...doc });
      return Promise.resolve(doc);
    }),
    updateOne: jest.fn(
      (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const r = runs.find((x) => String(x._id) === String(filter._id));
        if (r) Object.assign(r, (update.$set || {}) as Record<string, unknown>);
        return q({ modifiedCount: 1 });
      },
    ),
    /* [FIX-20260810-RESUMECLAIM] The resume path claims the run with ONE
     * findOneAndUpdate whose filter carries every precondition, so the fake must
     * honour the WHOLE filter — matching on `_id` alone would hand the document to
     * a second tap and the double-tap test would pass while production regressed.
     * Real semantics reproduced: all filter fields must match, the update applies
     * atomically, and a non-match returns `null`. */
    findOneAndUpdate: jest.fn(
      (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const r = runs.find((x) =>
          Object.entries(filter).every(([k, v]) => cmpStr(x[k]) === cmpStr(v)),
        );
        if (!r) return q(null);
        Object.assign(r, (update.$set || {}) as Record<string, unknown>);
        return q({ ...r });
      },
    ),
  };

  const jobs: Array<Record<string, unknown>> = [];
  const jobModel = {
    create: jest.fn((doc: Record<string, unknown>) => {
      const j = { _id: new Types.ObjectId(), ...doc };
      jobs.push(j);
      return Promise.resolve(j);
    }),
    updateOne: jest.fn(() => q({ modifiedCount: 1 })),
    findOne: jest.fn((filter: Record<string, unknown>) =>
      q(
        [...jobs]
          .reverse()
          .find(
            (j) =>
              j.chain_step === filter.chain_step &&
              String(j.chain_run_id) === String(filter.chain_run_id),
          ) || null,
      ),
    ),
  };

  const results: Array<[unknown, unknown]> = [];
  const resultModel = {
    updateOne: jest.fn((filter: unknown, update: unknown) => {
      results.push([filter, update]);
      return q({ modifiedCount: 1 });
    }),
  };

  /* [FEAT-20260810-PAYTICKET] mock ต้องรองรับ 2 รูปแบบที่โค้ดจริงเรียก:
       runner  : findOne().lean().exec()            → raw_profile_data
       helper  : findOne().select('_id').lean().exec() → { _id }
     `select` คืน this เพื่อให้ chain ต่อได้ — ถ้าไม่มี helper จะ throw แล้ว
     กลืน error เงียบ ๆ ทำให้เทส "ไม่เปิด ticket" ผ่านแบบหลอก ๆ */
  const MEMBER_MONGO_ID = 'MEMBER_OID_1';
  const memberQuery: {
    select: jest.Mock;
    lean: jest.Mock;
    exec: jest.Mock;
  } = {
    select: jest.fn(() => memberQuery),
    lean: jest.fn(() => memberQuery),
    exec: jest.fn(() =>
      Promise.resolve({
        _id: MEMBER_MONGO_ID,
        raw_profile_data: opts.rawProfile ?? null,
      }),
    ),
  };
  const memberModel = { findOne: jest.fn(() => memberQuery) };
  const imageModel = { findById: jest.fn(() => q({ file_path: imgPath })) };
  // [2c] Read-only, resume path only: a [ลองใหม่] postback carries a runId, so
  // the hook is re-read to re-check the payment kill-switch before a money leg.
  const hookModel = {
    findById: jest.fn(() =>
      q(opts.hookDoc === undefined ? HOOK : opts.hookDoc),
    ),
  };

  const customTool = {
    getTool: jest.fn(() =>
      Promise.resolve(opts.tool === undefined ? paymentTool() : opts.tool),
    ),
    call: jest.fn(
      (
        _t: unknown,
        _k: string,
        _u: string,
        body: Record<string, unknown>,
        o: { role?: string },
      ) => Promise.resolve(opts.callImpl(body, o)),
    ),
  };

  /* [FEAT-20260810-PAYTICKET] mock ของ chat_rooms / tickets
     - chatRoomModel.findOneAndUpdate: คืน object = claim ได้ (ห้องยัง idle)
       ตั้ง `roomClaimable: false` ใน opts เพื่อจำลองห้องที่มีคนดูแลอยู่แล้ว
     - ticketModel.create: บันทึกไว้ให้เทสตรวจว่าเปิดกี่ใบ ด้วย field อะไร */
  const ticketsCreated: Record<string, unknown>[] = [];
  const published: { t: string; d: unknown }[] = [];
  const chatRoomModel = {
    findOneAndUpdate: jest.fn(() => ({
      exec: () =>
        Promise.resolve(opts.roomClaimable === false ? null : { _id: 'ROOM1' }),
    })),
  };
  const ticketModel = {
    create: jest.fn((doc: Record<string, unknown>) => {
      ticketsCreated.push(doc);
      return Promise.resolve({ _id: `TICKET${ticketsCreated.length}` });
    }),
  };

  /* [FIX-20260811-PAYDIVIDER] เก็บ divider ที่ถูกเขียน เพื่อให้เทสตรวจได้ว่า
     "ห้องถูก claim แล้วยังมีเส้นคั่น" · `findOne` คืนห้องเสมอ เพราะ
     `writeTicketDivider` ต้องหา room_id ก่อนเขียน */
  const dividersCreated: Record<string, unknown>[] = [];
  const chatMessageModel = {
    create: jest.fn((doc: Record<string, unknown>) => {
      dividersCreated.push(doc);
      return Promise.resolve({ _id: `DIV${dividersCreated.length}` });
    }),
  };
  (chatRoomModel as Record<string, unknown>).findOne = jest.fn(() => ({
    select: () => ({
      lean: () => ({
        exec: () => Promise.resolve({ _id: 'ROOM1', channel_type: 'line' }),
      }),
    }),
  }));

  const runner = new PaymentRunnerService(
    slipModel as never,
    runModel as never,
    jobModel as never,
    resultModel as never,
    memberModel as never,
    hookModel as never,
    chatRoomModel as never,
    ticketModel as never,
    chatMessageModel as never,
    /* [FEAT-20260810-PAYTICKET] mock realtime — บันทึก event เพื่อให้เทสตรวจได้ว่า
       ticket:new ถูกยิงจริง (ถ้าไม่ยิง ticket เข้า DB แต่แอดมินต้องกด refresh) */
    {
      publish: jest.fn((t: string, d: unknown) => {
        published.push({ t, d });
      }),
    } as never,
    imageModel as never,
    customTool as never,
    { safeDecrypt: () => 'plainsecret' } as never, // CryptoService
    { wsEnv: 'dev' },
  );

  return {
    runner,
    f: {
      slipState,
      ticketsCreated,
      dividersCreated, // [FIX-20260811-PAYDIVIDER]
      published,
      chatRoomModel,
      ticketModel,
      chatMessageModel,
      slipModel,
      runModel,
      jobModel,
      resultModel,
      customTool,
      hookModel,
      runs,
      results,
    },
  };
}

/* [FEAT-20260810-PAYSTATEFLEX] The same fields, NOT cast — `HOOK` is `as never`,
 * and spreading that yields an empty object, so a test adding one field silently
 * loses the tool binding and the run aborts before it starts. */
const HOOK_FIELDS = {
  _id: HOOK_ID,
  payment_tool_status: true,
  payment_tool_id: PAY_TOOL_ID,
  customer_link_web_code: 'demo-web',
};

const HOOK = HOOK_FIELDS as never;

const walletpayStatement = (ref: string, amount = 100) => ({
  provider_code: 'walletpay',
  status: 'waiting-deposit',
  amount,
  ref_id: ref,
});
const rawWith = (...stmts: unknown[]) => ({
  data: { profile: { transaction: { statement: stmts } } },
});

/** Only role affects the outcome for most cases: topup then (maybe) walletpay. */
const route =
  (topup: unknown, wallet: unknown) =>
  (_b: Record<string, unknown>, o: { role?: string }) =>
    o.role === 'pay_topup' ? topup : wallet;

describe('[PAYTOOL-P2] runner — corrected flow, money-safety + outcomes', () => {
  it('(D0) gate: off payment binding ⇒ not_working, no lock, no legs', async () => {
    const { runner, f } = makeRunner({ tool: null, callImpl: () => ({}) });
    const r = await runner.runForSlip({
      hook: { payment_tool_status: false },
      slipRecordId: SLIP_ID,
    });
    expect(r.skipped).toBe('not_working');
    expect(f.customTool.call).not.toHaveBeenCalled();
    expect(f.slipModel.updateOne).not.toHaveBeenCalled();
  });

  it('(D1 ★) topup success ⇒ TERMINAL SUCCESS, lock success, NO walletpay', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupProceed, walletOk),
    });
    const r = await runner.runForSlip({
      hook: HOOK,
      slipRecordId: SLIP_ID,
      replyToken: 'RT',
    });
    expect(r.outcome).toBe('SUCCESS');
    expect(f.slipState.consumed).toBe(true);
    expect(f.slipState.lock_reason).toBe('success');
    /* [FEAT-20260810-TOPUPCARD] success ไม่ตอบเอง — ปล่อยการ์ด flex_success
       ของ Swiftcheck ตอบแทน (เจ้าของสั่ง 2026-08-10) เดิมเทสนี้ยืนยันข้อความของ payment
       ตอนนี้ยืนยันสิ่งที่สำคัญกว่า: **ต้องไม่มี reply** เพื่อให้ webhook.service.ts:3468
       คืน false แล้วการ์ดสลิปเดิมได้ทำงาน
       ⚠️ ถ้าเทสนี้พังเพราะมี reply กลับมา = การ์ดเดิมจะถูกกลบ ลูกค้าเห็นข้อความแทนการ์ด */
    expect(r.reply).toBeUndefined();
    // แต่ผลของ "เงิน" ต้องไม่เปลี่ยน — ยัง SUCCESS และล็อกยัง finalize
    expect(r.outcome).toBe('SUCCESS');
    // ONLY topup ran — walletpay is NOT the credit path when topup credited.
    expect(f.customTool.call).toHaveBeenCalledTimes(1);
    const topupCall = f.customTool.call.mock.calls[0];
    expect(topupCall[4].role).toBe('pay_topup');
    expect(topupCall[4].disableRetry).toBe(true); // money leg no auto-retry
    expect(topupCall[4].fileParts[0].field).toBe('upload_file');
    expect(typeof topupCall[4].extraHeaders['X-Signature']).toBe('string');
    expect(topupCall[3].web_code).toBe('demo-web');
    expect(topupCall[3].line_user_id).toBe('M1');
    expect(typeof topupCall[3].payload).toBe('string'); // Swiftcheck result canonicalised
    expect(f.runs[0]!.status).toBe('succeeded');
  });

  /* ==== [FEAT-20260810-PAYSTATEFLEX] a bound card OVERRIDES the Swiftcheck card ====
   * The test above pins the default: a success state answers with nothing so the
   * Swiftcheck `flex_success` card can. Owner's rule (Q3, 2026-08-10) is that binding
   * a card to a state must WIN, including on the success states — otherwise the
   * dashboard lets an admin pick a card that silently never appears.
   * These two assert both directions: bound ⇒ a reply exists for the webhook to
   * render the card from; not bound ⇒ still undefined, i.e. every existing OA is
   * untouched. ⚠️ If the "not bound" case ever returns a reply, the Swiftcheck card
   * gets buried and customers see text where a card used to be. */
  it('(D1b ★) topup success WITH a bound card ⇒ payment answers', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupProceed, walletOk),
    });
    const r = await runner.runForSlip({
      hook: {
        ...HOOK_FIELDS,
        payment_flex_ids: { topup_success: 'CARD1' },
      },
      slipRecordId: SLIP_ID,
      replyToken: 'RT',
    });
    // Money outcome must be identical to the unbound case — only WHO answers moved.
    expect(r.outcome).toBe('SUCCESS');
    expect(f.slipState.consumed).toBe(true);
    expect(f.slipState.lock_reason).toBe('success');
    // A reply now exists; webhook.service resolves the card from it.
    expect(r.reply).toBeDefined();
    expect(r.reply!.state).toBe('topup_success');
  });

  it('(D1c) a card bound to ANOTHER state does not affect topup_success', async () => {
    // 1 state = 1 card: a binding must never leak across states.
    const { runner } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupProceed, walletOk),
    });
    const r = await runner.runForSlip({
      hook: { ...HOOK_FIELDS, payment_flex_ids: { review: 'CARD1' } },
      slipRecordId: SLIP_ID,
      replyToken: 'RT',
    });
    expect(r.reply).toBeUndefined();
  });

  it('(D2) chain-log parity (topup fail→walletpay): 1 run + 2 jobs + storeRaw/context', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.runModel.create).toHaveBeenCalledTimes(1);
    const run = f.runModel.create!.mock.calls[0][0];
    expect(run.status).toBe('running');
    expect(run.subject_type).toBe('slip');
    expect(run.slip_record_id).toBe(SLIP_ID);
    expect(run.env_tag).toBe('dev');
    expect(run.raw_transaction).toBeTruthy();

    const jobTargets = f.jobModel.create!.mock.calls.map(
      (c) => c[0].target_key,
    );
    expect(jobTargets).toEqual(['pay_topup', 'pay_walletpay']);
    const walletJob = f.jobModel.create!.mock.calls[1][0];
    expect(walletJob.chain_step).toBe(2);
    expect(walletJob.chain_run_id).toBe(run._id);
    expect(walletJob.snapshot.walletpay_ref_id).toBe('REF-OK');

    // storeRaw shape: $setOnInsert base + $set.request + $set.final
    const storeRaw = f.results.find(
      ([, u]) => (u as { $set?: { final?: unknown } }).$set?.final,
    );
    const set = (storeRaw![1] as { $set: Record<string, unknown> }).$set;
    expect((set.request as Record<string, unknown>).headers_redacted).toEqual(
      {},
    );
    expect((set.final as Record<string, unknown>).received_via).toBe('sync');
    expect(typeof (set.final as Record<string, unknown>).raw_sha256).toBe(
      'string',
    );

    // walletpay context carries the money-audit anchors from the walletpay body
    const ctxWrite = f.results.find(([, u]) => {
      const c = (u as { $set?: { context?: { transaction_id?: string } } }).$set
        ?.context;
      return c && c.transaction_id === 'TXN9';
    });
    expect(ctxWrite).toBeTruthy();
    const ctx = (ctxWrite![1] as { $set: { context: Record<string, unknown> } })
      .$set.context;
    expect(ctx.bank_expect_id).toBe('BE9');
    // topup leg NEVER stores raw image bytes
    const topupReq = f.results.find(([, u]) => {
      const b = (
        u as { $set?: { request?: { body?: { upload_file?: string } } } }
      ).$set?.request?.body;
      return b && b.upload_file === '<slip-image>';
    });
    expect(topupReq).toBeTruthy();
  });

  it('(D3 · MONEY-SAFETY) CAS race: two concurrent runs ⇒ exactly ONE topup', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupProceed, walletOk),
    });
    const [a, b] = await Promise.all([
      runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID }),
      runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID }),
    ]);
    const outcomes = [a, b].map((x) => x.outcome || x.skipped).sort();
    expect(outcomes).toEqual(['SUCCESS', 'already_locked']);
    const topupCalls = f.customTool.call.mock.calls.filter(
      (c) => c[4].role === 'pay_topup',
    );
    expect(topupCalls).toHaveLength(1); // NO double topup
    expect(f.runModel.create).toHaveBeenCalledTimes(1); // no orphan run for the loser
  });

  it('(D4) topup TIMEOUT ⇒ REVIEW hard-stop, lock timeout, NO walletpay, mint-flex', async () => {
    const { runner, f } = makeRunner({
      callImpl: route(
        {
          success: false,
          status: 0,
          data: {},
          outcome_unknown: true,
          timed_out: true,
        },
        walletOk,
      ),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('REVIEW');
    expect(r.needs_review).toBe(true);
    expect(f.slipState.consumed).toBe(true);
    expect(f.slipState.lock_reason).toBe('timeout');
    expect(f.customTool.call).toHaveBeenCalledTimes(1); // no walletpay after timeout
    expect(f.runs[0]!.status).toBe('locked_review');
    // REVIEW is the ONE flex state — retry + contact-admin buttons.
    expect(r.reply?.kind).toBe('flex');
    expect(r.reply?.actions).toEqual(['retry', 'contact_admin']);
  });

  /* [FEAT-20260810-MEMBERNOTMATCH] เอา 'member-not-match' ออกจากชุดนี้ —
     มันไม่ตกไป walletpay แล้ว (หยุดที่ topup + ตอบข้อความ + แจ้งแอดมิน)
     เคสของมันมีเทสแยกด้านล่าง 'member-not-match หยุดก่อน walletpay'
     ⚠️ 'account-not-match' ยังอยู่ในชุดนี้ตามเดิม — เจ้าของสั่งห้ามแตะ */
  /* ══ [FEAT-20260810-MEMBERNOTMATCH] ══════════════════════════════════════
   * `member-not-match` = บัญชีต้นทางที่โอนมาไม่ใช่ของลูกค้าคนนี้
   * เจ้าของสั่ง 2026-08-10: หยุดที่ topup ไม่ไป walletpay + ตอบข้อความ + แจ้งแอดมิน
   * เทสนี้ล็อกทั้ง 4 ข้อที่ตกลงกัน — พังข้อไหนแปลว่าหลุดจากที่สั่ง
   */
  /* ══ [FEAT-20260810-PAYTICKET] เปิด ticket ให้เองเมื่อ member-not-match ══
   * ข้อความที่ตอบลูกค้าบอกว่า "จะแจ้งพี่แอดมินให้มาดูแลต่อ" — เทสชุดนี้พิสูจน์ว่า
   * คำพูดนั้นเป็นจริง (มี ticket ให้แอดมินเห็นจริง) และไม่เปิดซ้ำ
   */
  it('(D5c) member-not-match + ห้องยัง idle ⇒ เปิด ticket 1 ใบ', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('member-not-match', 'msg'), walletOk),
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.ticketsCreated).toHaveLength(1);
    const t = f.ticketsCreated[0]!;
    // ฟิลด์ต้องตรงกับที่ webhook สร้าง ticket จริง ไม่งั้นหน้าเคสแสดงเพี้ยน
    expect(t.category).toBe('Payment');
    expect(t.chat_status).toBe('bot');
    expect(t.job_status).toBe(0);
    // หัวเรื่องต้องไม่ว่าง — และต้องเป็น string จริง ไม่ใช่ object ที่แปลงร่างมา
    expect(typeof t.need_detail).toBe('string');
    expect(t.need_detail).not.toBe('');
    /* line_user_id ต้องเป็น `_id` ของ member ไม่ใช่ LINE id
       ถ้าใส่ LINE id ลงไป ticket จะชี้ไปที่ไม่มีอยู่จริง แอดมินเปิดห้องไม่ได้
       MEMBER_MONGO_ID คือค่าที่ mock ของ memberModel คืนมา */
    expect(t.line_user_id).toBe('MEMBER_OID_1');
    expect(t.line_oa_hook_id).toBeDefined();

    /* [FEAT-20260810-PAYTICKET] ทำเครื่องหมายว่าระบบเปิดเอง — แยกจาก ticket
       ที่มาจากทาง assist ได้ (ticket ปกติไม่มี 2 field นี้ ⇒ default false/null) */
    expect(t.direct_ticket).toBe(true);
    /* [FEAT-20260810-DIRECTTICKET] ข้อความนี้ไปโผล่บน divider ในห้องแชต
       จึงต้องเป็นภาษาที่แอดมินอ่านรู้เรื่อง ไม่ใช่โค้ดภายใน */
    expect(String(t.direct_ticket_detail)).toContain(
      'ไม่ใช่บัญชีของคุณลูกค้าเอง',
    );

    /* ⭐ ต้องยิง realtime ด้วย ไม่งั้น ticket เข้า DB แต่แอดมินต้องกด refresh
       ถึงจะเห็น (เจอจริงตอนเทสกับหน้าเว็บ) */
    const ev = f.published.find((p) => p.t === 'ticket:new');
    expect(ev).toBeDefined();
    // publisher จะ drop ถ้าไม่มี hook_id — ต้องเป็น string ด้วย
    expect(typeof (ev!.d as Record<string, unknown>).hook_id).toBe('string');
  });

  it('(D5d ★) ห้องถูก claim อยู่แล้ว ⇒ ไม่เปิด ticket ซ้ำ', async () => {
    const { runner, f } = makeRunner({
      roomClaimable: false, // จำลองว่ามีคนดูแล/มี ticket ค้างอยู่
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('member-not-match', 'msg'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.ticketsCreated).toHaveLength(0);
    // ไม่เปิด ticket ⇒ ต้องไม่ยิง realtime ด้วย ไม่งั้นหน้าเว็บจะเด้ง ticket ผี
    expect(f.published.filter((p) => p.t === 'ticket:new')).toHaveLength(0);
    // ⭐ แต่ลูกค้าต้องยังได้รับคำตอบเหมือนเดิม — การไม่เปิด ticket ไม่ใช่ error
    expect(r.reply?.state).toBe('member_not_match');
    expect(r.outcome).toBe('RELEASED');
  });

  /* ==== [FIX-20260811-PAYDIVIDER] ==================================================
   * เจ้าของแจ้ง 2026-08-11: "divider ไม่เก็บ เฉพาะตอนที่ ticket เปิดอยู่ …
   * ต้องการให้สร้างทุกครั้งที่ตรวจสลิป"
   *
   * ต้นเหตุ: divider บนหน้าแอดมินเป็นแถว **สังเคราะห์** ที่ FE ปั้นจาก
   * `ticket.direct_ticket` ⇒ ผูกกับการมี ticket ใบใหม่ ⇒ ห้องที่ถูก claim แล้ว
   * (`assist_status: true`) ไม่เปิด ticket ⇒ ไม่มีเส้นเลย ทั้งที่ตรวจสลิปสำเร็จ
   * ⇒ เขียน divider แถวจริงลง `chat_messages` แทน (ท่อเดียวกับ รับเคส/ปิดเคส)
   * ================================================================================= */
  it('(D5f ★) ห้องถูก claim แล้ว ⇒ ไม่เปิด ticket แต่ต้องเขียน divider แถวจริง', async () => {
    const { runner, f } = makeRunner({
      roomClaimable: false,
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('member-not-match', 'msg'), walletOk),
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.ticketsCreated).toHaveLength(0); // ticket ยังไม่เปิดซ้ำ (กฎเดิม)
    expect(f.dividersCreated).toHaveLength(1); // แต่มีเส้นคั่นแล้ว (ของใหม่)

    const d = f.dividersCreated[0] as Record<string, unknown>;
    expect(d.message_type).toBe('divider');
    expect(d.room_id).toBe('ROOM1'); // ผูกกับห้อง ไม่ใช่ member — ผิดคือเส้นหาย
    expect((d.metadata as Record<string, unknown>).variant).toBe(
      'direct_ticket',
    );
    // ข้อความต้องอ่านรู้เรื่องเหมือนของสังเคราะห์ที่ FE ปั้น
    expect(String(d.content)).toContain('เคสนี้สร้างโดยระบบ เนื่องจาก');
    expect(String(d.content)).toContain(
      'บัญชีที่โอนมา ไม่ใช่บัญชีของคุณลูกค้าเอง',
    );
  });

  it('(D5f2 ★★) รายงาน dividerDone กลับไป ⇒ delivery layer ไม่เขียนเส้นซ้ำ', async () => {
    /* 🔴 บั๊กที่เทสนี้กัน — เจอจากการยิงจริง 5 เคส (2026-08-11):
     * `openPaymentTicketIfIdle` ถูกเรียก 2 รอบในการตรวจ **ครั้งเดียว** ได้ —
     * รอบ runner (state ที่ ticket เอง) และรอบ `cardTicket()` ของ webhook เมื่อการ์ด
     * ที่ผูกมี flag เปิด · ตอนแรกผมต่อ `writeDivider` ทั้งสองจุดเพราะคิดว่ายิ่งครบยิ่งดี
     * ⇒ divider เพิ่ม **2 แถวต่อการตรวจ 1 ครั้ง** (ยืนยันจาก DB: `ยอดในสลิป 888 …`
     * จาก runner + `ยอดที่โอนมา …` จากการ์ด) ทั้งที่เจ้าของสั่งว่า 1 เส้นต่อการตรวจ
     *
     * runner จึงต้องรายงาน `dividerDone: true` กลับไป เพื่อให้ delivery layer ข้าม
     * ⚠️ ห้ามตัดด้วย `reply.state` — `statement_not_found` มีทั้งเส้นที่ ticket
     *    (`:1957`) และไม่ ticket (`:1102`)
     * ⚠️ ห้ามตัดด้วย `directTicketId` — ตอนห้องถูก claim ค่านั้นเป็น null ทั้งที่
     *    runner เขียนเส้นไปแล้ว = เคสหลักของงานนี้พอดี */
    const { runner, f } = makeRunner({
      roomClaimable: false, // ห้องถูก claim ⇒ runner เขียนเส้นแทนการเปิด ticket
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('member-not-match', 'msg'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.dividersCreated).toHaveLength(1);
    // ตัวธงที่ delivery layer อ่าน — ไม่มีค่านี้คือเส้นซ้ำกลับมา
    expect(r.dividerDone).toBe(true);
    // เปิด ticket ไม่ได้ (ห้องถูก claim) แต่ยังต้องรายงานว่าเขียนเส้นแล้ว
    expect(r.directTicketId).toBeUndefined();
  });

  it('(D5g2) เปิด ticket ได้ ⇒ ไม่รายงาน dividerDone (ไม่ได้เขียนเส้น)', async () => {
    // ห้องว่าง ⇒ runner เปิด ticket และไม่เขียนเส้น (FE ปั้นสังเคราะห์ให้)
    // ⇒ ต้องไม่ตั้งธง ไม่งั้น delivery layer จะข้ามการเขียนทั้งที่ควรเขียน
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('member-not-match', 'msg'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.dividersCreated).toHaveLength(0);
    expect(r.dividerDone).toBeUndefined();
    expect(r.directTicketId).toBeDefined();
  });

  it('(D5g) เปิด ticket ได้ ⇒ ไม่เขียน divider ซ้ำ (FE ปั้นสังเคราะห์ให้แล้ว)', async () => {
    // กันเส้นซ้ำสองอัน: ทางที่เปิด ticket สำเร็จ FE มี divider ของตัวเองอยู่แล้ว
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('member-not-match', 'msg'), walletOk),
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.ticketsCreated).toHaveLength(1);
    expect(f.dividersCreated).toHaveLength(0);
  });

  it('(D5h) เขียน divider ล้มเหลว ⇒ flow เงินไม่พัง ลูกค้ายังได้คำตอบ', async () => {
    const { runner, f } = makeRunner({
      roomClaimable: false,
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('member-not-match', 'msg'), walletOk),
    });
    // จำลอง DB ล้มตอนเขียนเส้นคั่น — เส้นคั่นเป็นของประกอบ ห้ามล้มเส้นทางเงิน
    f.chatMessageModel.create.mockRejectedValueOnce(new Error('mongo down'));
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.reply?.state).toBe('member_not_match');
    expect(r.outcome).toBe('RELEASED');
  });

  /* [FEAT-20260823-TOPUPDUP] ยังรวม `duplicate` ไว้โดยตั้งใจ — ตั้งแต่ 23/08 มัน
     หยุดก่อน walletpay แล้ว แต่ข้อตกลงว่า "ไม่เปิด ticket" ยังเหมือนเดิม
     ⇒ เทสนี้คือตัวที่จะแดงถ้าวันหนึ่งมีคนเพิ่ม ticket ให้ duplicate โดยไม่ได้สั่ง */
  it('(D5e) status อื่นไม่เปิด ticket — เฉพาะ member-not-match เท่านั้น', async () => {
    for (const status of ['fail', 'duplicate', 'account-not-match']) {
      const { runner, f } = makeRunner({
        rawProfile: rawWith(walletpayStatement('REF-OK')),
        callImpl: route(topupReject(status, 'msg'), walletOk),
      });
      await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
      expect(f.ticketsCreated).toHaveLength(0);
    }
  });

  it('(D5b ★) topup member-not-match ⇒ หยุดก่อน walletpay + ปล่อยสลิป + แจ้งแอดมิน', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      // ตั้ง walletpay ให้สำเร็จไว้ด้วย — ถ้าโค้ดเผลอเรียก walletpay จะได้ SUCCESS
      // แล้วเทสนี้จะจับได้ทันที
      callImpl: route(topupReject('member-not-match', 'msg'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    // 1) ⭐ ห้ามเรียก walletpay เด็ดขาด — นี่คือหัวใจของงานนี้
    const roles = f.customTool.call.mock.calls.map((c) => c[4].role);
    expect(roles).toEqual(['pay_topup']);
    expect(roles).not.toContain('pay_walletpay');

    // 2) ปล่อยสลิป (เจ้าของเลือกข้อ ข) — ลูกค้าส่งใบใหม่ได้ทันที ไม่ต้องรอปลดล็อก
    expect(r.outcome).toBe('RELEASED');
    expect(f.slipState.consumed).toBe(false);
    expect(f.slipState.lock_reason).toBe('');

    // 3) แจ้งแอดมิน — ข้อความบอกลูกค้าว่าจะมีคนมาดู ถ้าไม่ตั้ง flag ก็ไม่มีใครเห็น
    expect(r.needs_review).toBe(true);

    // 4) ตอบเป็นข้อความตามที่เจ้าของกำหนด (ไม่ใช่การ์ด ไม่มีปุ่ม)
    expect(r.reply?.state).toBe('member_not_match');
    expect(r.reply?.kind).toBe('text');
    expect(r.reply?.text).toContain('ไม่ใช่บัญชีของคุณลูกค้าเอง');
  });

  /* [FEAT-20260823-TOPUPDUP] `duplicate` ออกจากลิสต์นี้แล้ว — เจ้าของสั่ง 23/08/2026
     ให้มัน **หยุดก่อน walletpay** และตอบการ์ด duplicate ของ Swiftcheck (เทสของมันอยู่
     ที่ describe `[TOPUPDUP]` ท้ายไฟล์). เหลือสองตัวนี้ที่ยังไหลต่อ. */
  it.each(['fail', 'account-not-match'])(
    '(D5 ★) topup %s ⇒ FALL THROUGH to walletpay',
    async (status) => {
      const { runner, f } = makeRunner({
        rawProfile: rawWith(walletpayStatement('REF-OK')),
        callImpl: route(topupReject(status, 'msg'), walletOk),
      });
      const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
      expect(r.outcome).toBe('SUCCESS'); // walletpay credited (alternative path)
      /* [FEAT-20260810-TOPUPCARD] walletpay สำเร็จก็ไม่ตอบเอง — ใช้การ์ด flex_success
         ตัวเดียวกับ topup เพราะจากมุมลูกค้าทั้งคู่แปลว่า "เงินเข้าแล้ว" เหมือนกัน */
      expect(r.reply).toBeUndefined();
      const roles = f.customTool.call.mock.calls.map((c) => c[4].role);
      expect(roles).toEqual(['pay_topup', 'pay_walletpay']); // topup THEN walletpay
      const walletCall = f.customTool.call.mock.calls[1];
      expect(walletCall[3].refId).toBe('REF-OK');
      expect(walletCall[4].fileParts[0].field).toBe('slip');
      expect(walletCall[4].disableRetry).toBe(true); // money leg no auto-retry
      expect(f.slipState.lock_reason).toBe('success');
    },
  );

  it('(D6) topup fail → walletpay matched+confirmed:false ⇒ MATCHED_PENDING, locked', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-P')),
      callImpl: route(topupReject('fail', 'x'), {
        success: true,
        status: 200,
        data: walletpayPending,
      }),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('MATCHED_PENDING');
    expect(r.needs_review).toBe(true);
    expect(f.slipState.consumed).toBe(true);
    expect(f.slipState.lock_reason).toBe('matched_pending');
    expect(r.reply?.state).toBe('matched_pending');
    expect(r.reply?.text).toBe('กำลังดำเนินการเติมเงิน'); // default pending text
  });

  it('(D7) [2c] topup fail → walletpay no_match with statements left ⇒ PAUSE for [ลองใหม่], does NOT auto-advance', async () => {
    // ⚠️ BEHAVIOUR CHANGED IN 2c — this test previously asserted the opposite.
    // It used to pin an AUTO-LOOP: one webhook delivery walked REF1 then REF2
    // and returned SUCCESS. Per ans23_43.md the runner must instead STOP at the
    // first no_match and wait for the customer to tap [ลองใหม่]; the resume
    // (2c-3) is what tries REF2. Auto-advancing uploads the slip once per
    // statement with no customer visibility between attempts.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(
        walletpayStatement('REF1'),
        walletpayStatement('REF2'),
      ),
      callImpl: (body, o) => {
        if (o.role === 'pay_topup') return topupReject('fail', 'x');
        return body.refId === 'REF1'
          ? { success: true, status: 200, data: walletpayNoMatch }
          : walletOk;
      },
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('AWAITING_RETRY');
    expect(r.needs_review).toBe(false); // a pause is not an incident

    // The decisive assertion: REF2 was NOT tried on this delivery.
    const refs = f.customTool.call.mock.calls
      .filter((c) => c[4].role === 'pay_walletpay')
      .map((c) => c[3].refId);
    expect(refs).toEqual(['REF1']);

    // The slip stays CLAIMED so a re-delivered webhook cannot start a second
    // run while we wait, but it is in-flight ('processing'), not terminal.
    expect(f.slipState.consumed).toBe(true);
    expect(r.lock?.lock_reason).toBe('processing');

    // The customer is told what happened and offered the retry button.
    expect(r.reply?.state).toBe('no_match_retry');
    expect(r.reply?.kind).toBe('flex');
    expect(r.reply?.actions).toContain('retry');
  });

  it('(D7b) [2c] the run stays open with the cursor to resume from (x+1)', async () => {
    // The pause must leave enough state behind for [ลองใหม่] to continue at the
    // NEXT statement — never re-POSTing the one already uploaded.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(
        walletpayStatement('REF1'),
        walletpayStatement('REF2'),
      ),
      callImpl: (_body, o) =>
        o.role === 'pay_topup'
          ? topupReject('fail', 'x')
          : { success: true, status: 200, data: walletpayNoMatch },
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    const run = f.runs[0]!;
    expect(run['status']).toBe('awaiting_retry');
    expect(run['cursor']).toBe(0); // the statement just tried
    expect(run['resume_cursor']).toBe(1); // where the retry picks up
    // NOT ended: `ended_at` is what _endRun stamps on a terminal outcome, and a
    // paused run must stay open for the resume to continue it.
    expect(run['ended_at']).toBeUndefined();
  });

  it('(D8) topup fail → walletpay all no_match ⇒ REVIEW, KEPT locked (uploaded, awaiting admin)', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: route(topupReject('fail', 'x'), {
        success: true,
        status: 200,
        data: walletpayNoMatch,
      }),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('REVIEW');
    expect(r.needs_review).toBe(true);
    // slip WAS uploaded to walletpay ⇒ never released
    expect(f.slipState.consumed).toBe(true);
    // [FIX-20260811-PAYLOG] locked FOR REVIEW, not "outcome unknown": the 200s
    // all succeeded, so the lock word is 'review' and the log outcome is TRUE
    // ("200 + SINGLE_NOT_MATCHED = success + review" — owner convention).
    expect(f.slipState.lock_reason).toBe('review');
    const ctx = f.results
      .map(
        ([, u]) => (u as Record<string, Record<string, unknown>>).$set?.context,
      )
      .filter(Boolean)
      .filter(
        (c) => (c as Record<string, unknown>).target_key === 'pay_walletpay',
      )
      .pop() as Record<string, unknown>;
    expect(ctx.outcome).toBe('TRUE');
    expect(ctx.review_reason).toBe('walletpay_exhausted');
  });

  it('(D9) topup fail → walletpay transport failure (non-200) ⇒ REVIEW, locked, no blind retry', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: route(topupReject('fail', 'x'), {
        success: false,
        status: 502,
        data: {},
        outcome_unknown: true,
      }),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('REVIEW');
    expect(f.slipState.consumed).toBe(true);
    expect(f.runs[0]!.status).toBe('locked_review');
  });

  it('(D10) topup fail → walletpay refId from a slipUploadUrl ?refid= param', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith({
        provider_code: 'walletpay',
        status: 'waiting-deposit',
        amount: 100,
        ref_id: 'https://slipupload.walletpay.example.com/?refid=UUID-XYZ',
      }),
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    const walletCall = f.customTool.call.mock.calls.find(
      (c) => c[4].role === 'pay_walletpay',
    );
    expect(walletCall[3].refId).toBe('UUID-XYZ');
  });

  it('(D11 · P2B) reply_detail: "-" fallback when absent, value when set', async () => {
    /* [FEAT-20260810-TOPUPCARD] เดิมใช้เส้น topup เป็นตัวอย่าง แต่ทั้ง topup_success
       และ walletpay_success ไม่มี reply แล้ว (ปล่อยการ์ด flex_success ตอบ) จึงย้ายมาใช้
       `matched_pending` ซึ่งยังตอบเอง — เจตนาเทสไม่เปลี่ยน: reply_detail ตกเป็น "-"
       เมื่อไม่ตั้ง และใช้ค่าที่ตั้งเมื่อมี (reply_detail ใช้ได้กับทุก state) */
    const mk = (payment: Record<string, unknown>) =>
      makeRunner({
        tool: paymentTool(payment),
        rawProfile: rawWith(walletpayStatement('REF-OK')),
        callImpl: route(topupReject('fail', 'msg'), {
          success: true,
          status: 200,
          data: walletpayPending,
        }),
      });
    const r1 = await mk({}).runner.runForSlip({
      hook: HOOK,
      slipRecordId: SLIP_ID,
    });
    expect(r1.reply?.detail).toBe('-');
    const r2 = await mk({ reply_detail: 'เติมเงินที่นี่' }).runner.runForSlip({
      hook: HOOK,
      slipRecordId: SLIP_ID,
    });
    expect(r2.reply?.detail).toBe('เติมเงินที่นี่');
  });

  it('(D12 ⭐ ENTRY GATE) only a Swiftcheck-success slip may reach the money path', async () => {
    // THE most important condition in the feature: topup MOVES MONEY, so a slip
    // Swiftcheck could not verify must never reach it. `api_status === 'success'`
    // is the single door in. ถ้า swiftcheck ไม่ใช่ success = ไม่เข้า topup เด็ดขาด.
    for (const api_status of [
      'pending',
      'failed',
      'error',
      '',
      undefined as unknown as string,
    ]) {
      const { runner, f } = makeRunner({
        slip: { api_status },
        callImpl: () => ({}),
      });
      const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

      expect(r.skipped).toBe('not_success');
      expect(r.ran).toBe(false);
      // No lock claimed, no external call, no run created — the runner leaves
      // absolutely no trace, so the slip is exactly as the legacy flow found it.
      expect(f.slipModel.updateOne).not.toHaveBeenCalled();
      expect(f.customTool.call).not.toHaveBeenCalled();
      expect(f.runModel.create).not.toHaveBeenCalled();

      // And it produces NO reply: the legacy slip flow answers with Swiftcheck's
      // own flex card. Phase 3 suppresses that card only when payment actually
      // replied, so a non-success slip still behaves exactly as before this
      // feature existed. (swiftcheck ไม่ success ⇒ ตอบตาม flow เดิม)
      expect(r.reply).toBeUndefined();
    }
  });

  /* [FEAT-20260815-DUPFORWARD] gate C removed — a duplicate is forwarded.
   *
   * WAS: `isDuplicate: true` returned `skipped:'duplicate_slip'` before topup,
   * so a re-sent slip reached neither leg. The owner ended that on 15 Aug:
   *
   *   "ใช่ให้ยิงทุกรอบ เพราะเราเป็นคนกลาง"
   *   "swiftcheck duplicate เราจะส่ง x api ตาม flow เดิม"
   *
   * WHY THE OWNER IS RIGHT ON THE FACTS: we are the middleman, not the ledger.
   * Shop-API already refuses to credit a duplicate — `_classifyTopup` maps that
   * status to REJECT — so the decision belongs upstream, where the account
   * balance actually lives. Holding the slip here only hid a re-send from a
   * system that is entitled to see it.
   *
   * WHAT IS DELIBERATELY ACCEPTED: the old gate also stopped walletpay from
   * pairing a re-sent slip with a different statement. That protection is gone
   * by choice — upstream owns it now. เราเป็นคนกลาง ปลายทางเป็นคนกัน.
   *
   * NOT CHANGED: `_classifyTopup` and the topup→walletpay fall-through are
   * untouched (owner: "ห้ามแก้ไขเงื่อนไข x api > walletpay"). A duplicate travels
   * the SAME road every other REJECT status travels.
   */
  it('(D12b ⭐ DUPFORWARD) a duplicate slip is forwarded to topup like any other', async () => {
    const { runner, f } = makeRunner({
      slip: { api_status: 'success', raw_content: { isDuplicate: true } },
      callImpl: route(topupProceed, walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    // No longer skipped — the run starts.
    expect(r.skipped).toBeUndefined();
    // The upstream call really happened; this is the assertion the old gate
    // inverted (`not.toHaveBeenCalled`), so it fails on the pre-change code.
    expect(f.customTool.call).toHaveBeenCalled();
    expect(f.runModel.create).toHaveBeenCalled();
  });

  /* The duplicate must take the ORDINARY road, not a special one: whatever
     `_classifyTopup` decides is what happens. Here topup credits, so the run
     ends at SUCCESS and walletpay never runs — identical to a non-duplicate slip.
     Guards the owner's constraint that the shop-api→walletpay rule is untouched. */
  it('(D12b-2) a forwarded duplicate obeys the normal topup outcome', async () => {
    const { runner } = makeRunner({
      slip: { api_status: 'success', raw_content: { isDuplicate: true } },
      callImpl: route(topupProceed, walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('SUCCESS');
    expect(r.skipped).toBeUndefined();
  });

  it('(D12c) a NON-duplicate slip is unaffected by gate C', async () => {
    // Strict `=== true`, matching the legacy read: an absent or false flag must
    // never be treated as "duplicate", or every slip stored before the field
    // existed would be blocked.
    for (const raw_content of [
      { isDuplicate: false },
      { isDuplicate: undefined },
      {},
      null,
    ]) {
      const { runner } = makeRunner({
        slip: { api_status: 'success', raw_content },
        callImpl: route(topupProceed, walletOk),
      });
      const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
      expect(r.skipped).toBeUndefined();
      // topup credited ⇒ terminal success, walletpay never runs.
      expect(r.outcome).toBe('SUCCESS');
      // [FEAT-20260810-TOPUPCARD] ไม่ตอบเอง ปล่อยการ์ด flex_success เดิม
      expect(r.reply).toBeUndefined();
    }
  });

  // ───────────────── [2c] the [ลองใหม่] resume ─────────────────
  //
  // The customer tapped the button after a no_match pause. The resume must
  // continue the SAME run at the NEXT statement with the SAME stored slip image
  // — never re-POSTing a statement that was already uploaded.

  const RUN_ID = new Types.ObjectId();
  const pausedRun = (over: Record<string, unknown> = {}) => ({
    _id: RUN_ID,
    status: 'awaiting_retry',
    cursor: 0,
    resume_cursor: 1,
    hook_id: HOOK_ID,
    slip_record_id: SLIP_ID,
    ...over,
  });

  it('(D14a ⭐ RESUME) continues at x+1 with the stored slip — never re-POSTs statement 0', async () => {
    const { runner, f } = makeRunner({
      seedRun: pausedRun(),
      rawProfile: rawWith(
        walletpayStatement('REF1'),
        walletpayStatement('REF2'),
      ),
      callImpl: (_body, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });

    const r = await runner.resumeForRetry({ runId: RUN_ID, nextIdx: 1 });

    expect(r.outcome).toBe('SUCCESS');
    // THE money-safety assertion: REF1 was uploaded before the pause and must
    // NOT be sent again. Only REF2 is tried.
    const refs = f.customTool.call.mock.calls
      .filter((c) => c[4].role === 'pay_walletpay')
      .map((c) => c[3].refId);
    expect(refs).toEqual(['REF2']);

    // Same run continued — no second run doc was created.
    expect(f.runModel.create).not.toHaveBeenCalled();
  });

  it('(D14b ⭐) a double-tap cannot resume twice', async () => {
    // The second tap arrives after the first already moved the run out of
    // `awaiting_retry`. It must be a no-op, not a second walletpay POST.
    const { runner, f } = makeRunner({
      seedRun: pausedRun({ status: 'succeeded' }),
      rawProfile: rawWith(
        walletpayStatement('REF1'),
        walletpayStatement('REF2'),
      ),
      callImpl: () => walletOk,
    });

    const r = await runner.resumeForRetry({ runId: RUN_ID, nextIdx: 1 });

    expect(r.ran).toBe(false);
    expect(r.skipped).toBe('not_awaiting_retry');
    expect(f.customTool.call).not.toHaveBeenCalled();
  });

  it('(D14c ⭐) a stale/forged index is refused — the RUN decides, not the payload', async () => {
    // The button carries the index, but the run is the authority. An index that
    // does not match `resume_cursor` must never move the walk backwards onto a
    // statement already uploaded.
    for (const nextIdx of [0, 2, 99]) {
      const { runner, f } = makeRunner({
        seedRun: pausedRun({ resume_cursor: 1 }),
        rawProfile: rawWith(
          walletpayStatement('REF1'),
          walletpayStatement('REF2'),
        ),
        callImpl: () => walletOk,
      });

      const r = await runner.resumeForRetry({ runId: RUN_ID, nextIdx });

      expect(r.skipped).toBe('stale_retry');
      expect(f.customTool.call).not.toHaveBeenCalled();
    }
  });

  it('(D14d) refuses to resume when the payment tool was switched off', async () => {
    // An admin may disable payment while the customer sits on the button. A
    // money leg never runs on a disabled tool.
    const { runner, f } = makeRunner({
      seedRun: pausedRun(),
      tool: null, // resolvePaymentTool finds nothing
      callImpl: () => walletOk,
    });

    const r = await runner.resumeForRetry({ runId: RUN_ID, nextIdx: 1 });

    expect(r.skipped).toBe('not_working');
    expect(f.customTool.call).not.toHaveBeenCalled();
  });

  it('(D14e) resuming past the last statement ends in REVIEW, never wraps to 0', async () => {
    // Every candidate was tried across the pause/retry cycles. Walking off the
    // end must reach the same terminal state as a first run that exhausted —
    // and must NOT wrap around and re-pay statement 0.
    const { runner, f } = makeRunner({
      seedRun: pausedRun({ resume_cursor: 2 }),
      rawProfile: rawWith(
        walletpayStatement('REF1'),
        walletpayStatement('REF2'),
      ),
      callImpl: (_body, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });

    const r = await runner.resumeForRetry({ runId: RUN_ID, nextIdx: 2 });

    expect(r.outcome).toBe('REVIEW');
    const walletpayCalls = f.customTool.call.mock.calls.filter(
      (c) => c[4].role === 'pay_walletpay',
    );
    expect(walletpayCalls).toHaveLength(0);
  });

  it('(D14f) a missing run / missing hook is refused safely', async () => {
    const { runner } = makeRunner({ callImpl: () => walletOk });
    const gone = await runner.resumeForRetry({
      runId: new Types.ObjectId(),
      nextIdx: 1,
    });
    expect(gone.skipped).toBe('no_run');

    const { runner: r2, f: f2 } = makeRunner({
      seedRun: pausedRun(),
      hookDoc: null, // hook deleted since the pause
      callImpl: () => walletOk,
    });
    const noHook = await r2.resumeForRetry({ runId: RUN_ID, nextIdx: 1 });
    expect(noHook.skipped).toBe('no_hook');
    expect(f2.customTool.call).not.toHaveBeenCalled();
  });

  it('(D13 ★) topup fail + NO matching statement ⇒ fallback reply + lock RELEASED', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OTHER', 999)), // amount mismatch
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('RELEASED');
    expect(f.slipState.consumed).toBe(false); // released — nothing credited/uploaded
    expect(f.slipState.lock_reason).toBe('');
    expect(r.reply?.state).toBe('statement_not_found');
    expect(r.reply?.text).toBe(REPLY_TEXT.statement_not_found);
    // walletpay was NEVER called (no refId to post to)
    const roles = f.customTool.call.mock.calls.map((c) => c[4].role);
    expect(roles).toEqual(['pay_topup']);
  });

  it('(D14 ★) topup fail → walletpay AMBIGUOUS 200 (confirmed omitted) ⇒ REVIEW, NOT success', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: route(topupReject('fail', 'x'), {
        // res.success===true (2xx) but the body is NOT decisive — must be REVIEW.
        success: true,
        status: 200,
        data: walletpayAmbiguous,
      }),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('REVIEW'); // never inferred SUCCESS from the 2xx flag
    expect(r.needs_review).toBe(true);
    expect(f.slipState.consumed).toBe(true); // uploaded ⇒ kept locked
  });

  it('(D15) reply text is config-overridable per state', async () => {
    /* [FEAT-20260810-TOPUPCARD] ย้ายมาใช้ `matched_pending` + `pending_reply_text`
       เพราะ state success ทั้งสองตัวไม่ตอบเองแล้ว เจตนาเทสไม่เปลี่ยน:
       พิสูจน์ว่าค่าที่ตั้งใน config ชนะข้อความ default */
    const { runner } = makeRunner({
      tool: paymentTool({ pending_reply_text: 'เครดิตกำลังเข้า' }),
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('fail', 'msg'), {
        success: true,
        status: 200,
        data: walletpayPending,
      }),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.reply?.text).toBe('เครดิตกำลังเข้า'); // override wins over default
  });
});

describe('[NOTLINKED] topup CUSTOMER_NOT_LINKED — release, do not lock', () => {
  // LIVE-VERIFIED 2026-08-09: the real Shop-API answers
  //   HTTP 404 {"error":{"code":"CUSTOMER_NOT_LINKED","message":"LINE นี้ยังไม่ผูกบัญชี"}}
  // for a LINE with no linked web account. Before this branch that fell into the
  // "non-2xx, no slip_status" rule ⇒ TIMEOUT ⇒ slip LOCKED for human review, so
  // every unlinked new customer became an admin ticket.
  const notLinked = {
    success: false,
    status: 404,
    data: {
      error: { code: 'CUSTOMER_NOT_LINKED', message: 'LINE นี้ยังไม่ผูกบัญชี' },
      success: false,
    },
  };

  it('releases the lock and tells the customer to link — no review, no walletpay', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: (_b, o) => (o.role === 'pay_topup' ? notLinked : walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('RELEASED');
    expect(r.reply?.state).toBe('not_linked');
    expect(r.needs_review).toBe(false);
    // RELEASED ⇒ the customer can link and resend the SAME slip.
    expect(f.slipState.consumed).toBe(false);
    expect(f.slipState.lock_reason).toBe('');
    // walletpay cannot help — there is no member — so it must not be attempted.
    const walletpayCalls = f.customTool.call.mock.calls.filter(
      (c) => c[4].role === 'pay_walletpay',
    );
    expect(walletpayCalls).toHaveLength(0);
  });

  it('⭐ a 404 WITHOUT the code still fails safe (locked, review)', async () => {
    // THE SAFETY BOUNDARY: a bare 404 (moved path, bad base_url, proxy) means we
    // do NOT know whether money moved, so it must keep the fail-safe TIMEOUT.
    // Releasing on any 404 would be a double-credit path.
    const { runner, f } = makeRunner({
      callImpl: (_b, o) =>
        o.role === 'pay_topup'
          ? { success: false, status: 404, data: { message: 'Not Found' } }
          : walletOk,
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('REVIEW');
    expect(r.needs_review).toBe(true);
    expect(f.slipState.consumed).toBe(true);
  });
});

describe('[WALLETPAYTOOL] walletpay may live in its own tool (different host)', () => {
  // WHY THIS EXISTS: `url = tool.base_url + '/' + endpoint.path`, so ONE tool
  // physically cannot address two hosts. topup is a sub-endpoint of the OA's
  // existing Shop-API tool; walletpay is a different system on a different host.
  // LIVE-CONFIRMED 2026-08-09: without the binding leg 2 posted to the TOPUP
  // host; with it, leg 2 posted to the walletpay host.
  const walletpayTool = () => ({
    _id: new Types.ObjectId(),
    name: 'walletpay',
    base_url: 'https://walletpay.example',
    status: true,
    endpoints: [
      {
        key: 'PAY_WALLETPAY',
        role: 'pay_walletpay',
        method: 'POST',
        path: 'payin/{{refId}}/slip',
        status: true,
      },
    ],
  });

  it('uses the BOUND walletpay tool for leg 2, not the payment tool', async () => {
    const bt = walletpayTool();
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    // getTool is asked for the walletpay tool by id on the resume/binding path.
    f.customTool.getTool.mockImplementation((id: unknown) =>
      Promise.resolve(String(id) === String(bt._id) ? bt : paymentTool()),
    );

    await runner.runForSlip({
      hook: {
        ...(HOOK as Record<string, unknown>),
        walletpay_tool_status: true,
        walletpay_tool_id: bt._id,
      },
      slipRecordId: SLIP_ID,
    });

    const walletpayCall = f.customTool.call.mock.calls.find(
      (c) => c[4].role === 'pay_walletpay',
    );
    expect(walletpayCall).toBeDefined();
    // The FIRST argument is the tool whose base_url builds the URL.
    expect(String((walletpayCall![0] as { _id: unknown })._id)).toBe(
      String(bt._id),
    );
  });

  it('⭐ a bound-but-unusable walletpay tool FAILS CLOSED, never silently falls back', async () => {
    // An operator who bound a walletpay tool expects THAT one to be used. Quietly
    // posting the slip to a different host instead would be a money-path
    // surprise, so the run releases (nothing uploaded) rather than guessing.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    f.customTool.getTool.mockImplementation((id: unknown) =>
      Promise.resolve(
        String(id).length === 24 && String(id) !== String(PAY_TOOL_ID)
          ? null // the bound walletpay tool is gone
          : paymentTool(),
      ),
    );

    const r = await runner.runForSlip({
      hook: {
        ...(HOOK as Record<string, unknown>),
        walletpay_tool_status: true,
        walletpay_tool_id: new Types.ObjectId(),
      },
      slipRecordId: SLIP_ID,
    });

    expect(r.outcome).toBe('RELEASED');
    const walletpayCalls = f.customTool.call.mock.calls.filter(
      (c) => c[4].role === 'pay_walletpay',
    );
    expect(walletpayCalls).toHaveLength(0);
  });
});

describe('[WALLETPAYTOOL] SEAMLESS when unset — most OAs never set this', () => {
  // The whole point: an OA that never touches these two fields — including every
  // row created before they existed — must behave EXACTLY as before.
  // ไม่ตั้ง = ทำงานเหมือนเดิมทุกอย่าง.
  const cases: Array<[string, Record<string, unknown>]> = [
    ['neither field set (every pre-existing OA)', {}],
    [
      'id bound but flag OFF',
      { walletpay_tool_status: false, walletpay_tool_id: new Types.ObjectId() },
    ],
    [
      'flag ON but no id',
      { walletpay_tool_status: true, walletpay_tool_id: null },
    ],
    // Junk must never flip a money leg to another host — hence `=== true`.
    [
      'flag is the STRING "false" (truthy in JS!)',
      {
        walletpay_tool_status: 'false',
        walletpay_tool_id: new Types.ObjectId(),
      },
    ],
    [
      'flag is 1, not true',
      { walletpay_tool_status: 1, walletpay_tool_id: new Types.ObjectId() },
    ],
  ];

  it.each(cases)(
    '%s ⇒ uses the payment tool, never looks up another',
    async (_label, extra) => {
      const { runner, f } = makeRunner({
        rawProfile: rawWith(walletpayStatement('REF1')),
        callImpl: (_b, o) =>
          o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
      });

      const r = await runner.runForSlip({
        hook: { ...(HOOK as Record<string, unknown>), ...extra },
        slipRecordId: SLIP_ID,
      });

      // walletpay still ran — on the payment tool's own endpoint.
      const walletpayCall = f.customTool.call.mock.calls.find(
        (c) => c[4].role === 'pay_walletpay',
      );
      expect(walletpayCall).toBeDefined();
      expect(String((walletpayCall![0] as { _id: unknown })._id)).toBe(
        String(PAY_TOOL_ID),
      );
      expect(r.outcome).toBe('SUCCESS');
    },
  );
});

describe('[PENDINGREASON] every review case names its cause', () => {
  /**
   * WHY: an admin screen filters review rows by `review_reason`. A row with
   * `needs_review: true` but an EMPTY reason is invisible to that filter — it
   * looks handled while it is actually waiting. `matched_pending` was exactly
   * that case: the only review outcome with no reason attached.
   */
  it('matched_pending carries a reason, not an empty string', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-P')),
      callImpl: route(topupReject('fail', 'x'), {
        success: true,
        status: 200,
        data: walletpayPending,
      }),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('MATCHED_PENDING');
    expect(r.needs_review).toBe(true);

    const ctx = f.results
      .map(
        ([, update]) =>
          (update as Record<string, Record<string, unknown>>).$set?.context,
      )
      .filter(Boolean)
      .pop() as Record<string, unknown> | undefined;

    expect(ctx?.needs_review).toBe(true);
    // The regression this pins: needs_review true ⇒ reason must be non-empty.
    expect(ctx?.review_reason).toBe('awaiting_admin_confirm');
  });
});

describe('[CONFIGREVIEW] our-side config faults flag review but do NOT lock', () => {
  /**
   * Three reasons reach `_statementFallback` and all three RELEASE the slip.
   * Two are OUR misconfiguration and must reach an admin — the customer cannot
   * clear them by resending. The third is ordinary and must stay silent, or the
   * review queue fills with noise.
   *
   * The pairing under test is unusual and worth pinning: RELEASED **and**
   * needs_review at the same time. Releasing is a MONEY decision (nothing was
   * uploaded here, so resending is safe); the flag is a BROKEN-SETTING signal.
   */
  // Pick the pay_walletpay context row — the topup leg also writes one, and it is
  // NOT the row under test here.
  const ctxOf = (f: RunnerFakes) =>
    f.results
      .map(
        ([, u]) => (u as Record<string, Record<string, unknown>>).$set?.context,
      )
      .filter(Boolean)
      .find(
        (c) => (c as Record<string, unknown>).target_key === 'pay_walletpay',
      ) as Record<string, unknown> | undefined;

  it('no_walletpay_endpoint ⇒ review flagged, slip NOT locked', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      // A tool with topup but NO pay_walletpay endpoint.
      tool: {
        ...paymentTool(),
        endpoints: paymentTool().endpoints.filter(
          (e: Record<string, unknown>) => e.role !== 'pay_walletpay',
        ),
      },
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('RELEASED');
    // Released: the customer may resend the SAME slip immediately.
    expect(f.slipState.consumed).toBe(false);

    const ctx = ctxOf(f);
    expect(ctx?.reason).toBe('no_walletpay_endpoint');
    expect(ctx?.slip_locked).toBe(false);
    // …but an admin still has to fix the tool.
    expect(ctx?.needs_review).toBe(true);
    expect(ctx?.review_reason).toBe('no_walletpay_endpoint');
  });

  it('walletpay_tool_invalid ⇒ review flagged, slip NOT locked', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    // A walletpay tool is bound but resolves to nothing (deleted / disabled).
    f.customTool.getTool.mockImplementation((id: unknown) =>
      Promise.resolve(
        String(id) === String(PAY_TOOL_ID) ? paymentTool() : null,
      ),
    );

    const r = await runner.runForSlip({
      hook: {
        ...(HOOK as Record<string, unknown>),
        walletpay_tool_status: true,
        walletpay_tool_id: new Types.ObjectId(),
      },
      slipRecordId: SLIP_ID,
    });

    expect(r.outcome).toBe('RELEASED');
    expect(f.slipState.consumed).toBe(false);

    const ctx = ctxOf(f);
    expect(ctx?.reason).toBe('walletpay_tool_invalid');
    expect(ctx?.slip_locked).toBe(false);
    expect(ctx?.needs_review).toBe(true);
    expect(ctx?.review_reason).toBe('walletpay_tool_invalid');
  });

  it('⭐ no_matching_statement stays SILENT — it is not a fault', async () => {
    // THE BOUNDARY. This is the common case (statement not landed yet, or a
    // different amount) and it resolves itself. Flagging it would drown the
    // review queue, which is why the split exists at all.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OTHER', 999)), // amount mismatch
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('RELEASED');
    const ctx = ctxOf(f);
    expect(ctx?.reason).toBe('no_matching_statement');
    expect(ctx?.needs_review).toBe(false);
    // No reason string either — a flagged row with an empty reason is the bug
    // this codebase already hit once; an UNflagged row must not carry one.
    expect(ctx?.review_reason).toBe('');
  });
});

describe('[FEAT-20260811-WALLETPAY4040] the REAL walletpay error bodies (captured 2026-08-11)', () => {
  /**
   * Pinned against the ACTUAL bodies the live host `api.walletpay.example.com`
   * returned on 2026-08-11 (allow-listed IP, captures in
   * `log_error/walletpay-real-response.md`) — not hand-written guesses.
   *
   *   4040 → the payin transaction behind the refId no longer exists. DEFINITE:
   *          nothing uploaded ⇒ skip to the next statement, never lock on it.
   *   4001 → our multipart was rejected before processing (file field). OUR
   *          config fault ⇒ release + review, walking on is pointless.
   *   Express HTML 404 (wrong host, NO `code` field) → still fail-safe REVIEW.
   */
  const walletpay4040 = {
    success: false,
    status: 404,
    data: { code: 4040, message: 'PayIn transaction not found' },
    method: 'POST',
    url: 'https://api.walletpay.example.com/api/v1/public/payin/x/slip',
  };
  const walletpay4001 = {
    success: false,
    status: 400,
    data: { code: 4001, message: 'Missing slip file (field name: slip)' },
    method: 'POST',
    url: 'https://api.walletpay.example.com/api/v1/public/payin/x/slip',
  };
  // The wrong-host answer that produced all 27 historical failures: Express's
  // default HTML page — no JSON, no `code`. MUST stay in the REVIEW family.
  const expressHtml404 = {
    success: false,
    status: 404,
    data: '<!DOCTYPE html><html><body><pre>Cannot POST /api/v1/public/payin/x/slip</pre></body></html>',
    method: 'POST',
    url: 'https://rn4-api.walletpay.example.com/api/v1/public/payin/x/slip',
  };

  const ctxRows = (f: RunnerFakes) =>
    f.results
      .map(
        ([, u]) => (u as Record<string, Record<string, unknown>>).$set?.context,
      )
      .filter(Boolean)
      .filter(
        (c) => (c as Record<string, unknown>).target_key === 'pay_walletpay',
      ) as Array<Record<string, unknown>>;

  it('(B1 ⭐) 4040 on statement 0 ⇒ SKIP to statement 1, which can still SUCCEED', async () => {
    // The behaviour the whole feature exists for: a stale statement must not
    // end the walk — the next candidate may be the live one.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(
        walletpayStatement('REF-DEAD'),
        walletpayStatement('REF-LIVE'),
      ),
      callImpl: (body, o) => {
        if (o.role === 'pay_topup') return topupReject('fail', 'x');
        return body.refId === 'REF-DEAD' ? walletpay4040 : walletOk;
      },
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('SUCCESS');
    const refs = f.customTool.call.mock.calls
      .filter((c) => c[4].role === 'pay_walletpay')
      .map((c) => c[3].refId);
    expect(refs).toEqual(['REF-DEAD', 'REF-LIVE']); // walked on, same delivery
    // The dead statement is visible in the log with its own reason.
    const dead = ctxRows(f).find((c) => c.reason === 'walletpay_txn_not_found');
    expect(dead).toBeDefined();
    expect(dead?.statement_ref).toBe('REF-DEAD');
  });

  it('(B1b ⭐) a statement with NO refId is skipped WITH a row saying which field was read', async () => {
    // The one per-statement outcome in the walk that used to be silent. Its two
    // siblings (4040 expired, 4000 malformed) each write a row, so a walk that
    // ended `walletpay_exhausted` read the same whether every candidate had been
    // uploaded or every candidate had been dropped before walletpay was called.
    // Live case: production run 6a83e019…1131, where the second candidate's
    // `info` was null and `walletpay_ref_id_field` resolved to nothing.
    const noRef = {
      provider_code: 'walletpay',
      status: 'waiting-deposit',
      amount: 100,
    };
    const { runner, f } = makeRunner({
      rawProfile: rawWith(noRef, walletpayStatement('REF-LIVE')),
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    // Behaviour is unchanged: the unusable statement is still skipped, and only
    // the usable one is ever POSTed.
    expect(r.outcome).toBe('SUCCESS');
    const refs = f.customTool.call.mock.calls
      .filter((c) => c[4].role === 'pay_walletpay')
      .map((c) => c[3].refId);
    expect(refs).toEqual(['REF-LIVE']);

    // What is new: the skip is no longer invisible, and it names the PATH so an
    // operator can tell "field misconfigured" from "statement genuinely empty".
    const skipped = ctxRows(f).find((c) => c.reason === 'walletpay_no_ref_id');
    expect(skipped).toBeDefined();
    expect(skipped?.ref_id_field).toBe('ref_id');
    expect(skipped?.statement_total).toBe(2);
    expect(skipped?.needs_review).toBe(false);
  });

  it('(B1c ⭐) a reason that never carried a diagnosis now carries one', async () => {
    // Owner-asked 18/08: "ทำไมบางอันบอกละเอียด บางอันไม่บอก … รวมกันเลย".
    // `diag` used to be built for `no_matching_statement` alone, on the theory
    // that the other reasons were "already explained by their reason". They are
    // not: the WORD says walletpay was not attempted, the SETTINGS say why — which
    // tool was bound, which switch was off, which field the refIds were read
    // from. Here every candidate lacks a refId, so the walk ends
    // `walletpay_stale_statements`, a reason that carried nothing before.
    const noRef = {
      provider_code: 'walletpay',
      status: 'waiting-deposit',
      amount: 100,
    };
    const { runner, f } = makeRunner({
      rawProfile: rawWith(noRef, { ...noRef }),
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    // Behaviour unchanged: nothing was sent, so the slip is released, not locked.
    expect(r.outcome).toBe('RELEASED');
    expect(
      f.customTool.call.mock.calls.filter((c) => c[4].role === 'pay_walletpay'),
    ).toHaveLength(0);

    const diag = f.results
      .map(
        ([, u]) =>
          (
            u as Record<
              string,
              Record<string, Record<string, Record<string, unknown>>>
            >
          ).$setOnInsert?.final?.parsed?.diag,
      )
      .find(Boolean) as Record<string, unknown> | undefined;

    expect(diag).toBeDefined();
    // The two blocks that answer "what did we compare, and with what settings".
    expect(diag!['rule']).toMatchObject({ ref_id_field: 'ref_id' });
    expect(diag!['tools']).toBeDefined();
    // `after_amount` is MEASURED now. It was hard-coded 0, which on this walk
    // would have claimed no statement matched the slip amount — two did.
    expect(diag!['narrowing']).toMatchObject({
      rows_total: 2,
      after_provider: 2,
      after_status: 2,
      after_amount: 2,
    });
  });

  it('(B1d ⭐⭐) NO pause when the only statement left cannot be sent', async () => {
    // The money-path half of the 18/08 report. `hasMore` counted SLOTS, so a run
    // paused and showed [ลองใหม่] pointing at a statement whose refId it had
    // already failed to read. The tap could only ever walk into the exhaustion
    // path and answer with the terminal `review` card — measured in production:
    // 5 taps in one log window, 4 of them made no walletpay call at all.
    // Run 6a83e019…1131: two statements matched the slip amount, the second
    // carried `info: null`.
    const noRef = {
      provider_code: 'walletpay',
      status: 'waiting-deposit',
      amount: 100,
    };
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1'), noRef),
      callImpl: (_b, o) =>
        o.role === 'pay_topup'
          ? topupReject('fail', 'x')
          : { success: true, status: 200, data: walletpayNoMatch },
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    // No promise the run cannot keep: the customer gets the terminal answer now
    // instead of a button, a wait, and the same answer later.
    expect(r.outcome).toBe('REVIEW');
    expect(r.outcome).not.toBe('AWAITING_RETRY');
    expect((r as unknown as Record<string, unknown>)['resume']).toBeUndefined();

    // Unchanged where it matters: REF1 was still uploaded exactly once, and the
    // unusable statement was never POSTed.
    const refs = f.customTool.call.mock.calls
      .filter((c) => c[4].role === 'pay_walletpay')
      .map((c) => c[3].refId);
    expect(refs).toEqual(['REF1']);

    // The walk still visits the unusable entry, so it says why it was skipped.
    const rows = f.results
      .map(
        ([, u]) => (u as Record<string, Record<string, unknown>>).$set?.context,
      )
      .filter(Boolean) as Array<Record<string, unknown>>;
    expect(rows.some((c) => c['reason'] === 'walletpay_no_ref_id')).toBe(true);
  });

  it('(B1e ⭐) a sendable statement ahead still pauses exactly as before', async () => {
    // The guard on the change above: withdrawing an empty promise must not
    // withdraw a real one.
    const { runner } = makeRunner({
      rawProfile: rawWith(
        walletpayStatement('REF1'),
        walletpayStatement('REF2'),
      ),
      callImpl: (_b, o) =>
        o.role === 'pay_topup'
          ? topupReject('fail', 'x')
          : { success: true, status: 200, data: walletpayNoMatch },
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('AWAITING_RETRY');
    expect((r as unknown as Record<string, unknown>)['resume']).toMatchObject({
      next_idx: 1,
    });
  });

  it('(B2 ⭐) ALL statements 4040 on a first walk ⇒ RELEASED silently — walletpay never got the slip', async () => {
    // Before this feature an all-4040 walk fell into `walletpay_exhausted` and
    // LOCKED a slip walletpay never received. Zero uploads ⇒ releasing is safe:
    // the customer opens a fresh deposit request and resends.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(
        walletpayStatement('REF-D1'),
        walletpayStatement('REF-D2'),
      ),
      callImpl: route(topupReject('fail', 'x'), walletpay4040),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('RELEASED');
    expect(f.slipState.consumed).toBe(false);
    expect(f.slipState.lock_reason).toBe('');
    expect(r.reply?.state).toBe('statement_not_found');
    // Silent like no_matching_statement — self-correctable, not a fault.
    const fallback = ctxRows(f).find(
      (c) => c.reason === 'walletpay_stale_statements',
    );
    expect(fallback).toBeDefined();
    expect(fallback?.needs_review).toBe(false);
    expect(fallback?.review_reason).toBe('');
  });

  it('(B3 ⭐) 4001 ⇒ RELEASED + review flagged (our config fault), no pointless walk-on', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(
        walletpayStatement('REF1'),
        walletpayStatement('REF2'),
      ),
      callImpl: route(topupReject('fail', 'x'), walletpay4001),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('RELEASED');
    expect(f.slipState.consumed).toBe(false);
    // The admin-queue flag lives on the RUN doc (`listRuns` filters it there),
    // not on the fallback's result object — same as the other config faults.
    expect(f.runs[0]?.needs_review).toBe(true);
    // Every later statement would 4001 identically — exactly ONE POST went out.
    const walletpayCalls = f.customTool.call.mock.calls.filter(
      (c) => c[4].role === 'pay_walletpay',
    );
    expect(walletpayCalls).toHaveLength(1);
    const ctx = ctxRows(f).find((c) => c.reason === 'walletpay_bad_request');
    expect(ctx?.needs_review).toBe(true);
    expect(ctx?.review_reason).toBe('walletpay_bad_request');
  });

  it('(B4 ⭐ FAIL-SAFE) a bare 404 WITHOUT code 4040 (wrong-host Express page) stays REVIEW, locked', async () => {
    // THE mutation-catcher: widening the 4040 match to "any 404" must turn this
    // red. A bare 404 is ambiguous (wrong host / moved path / proxy) — we do
    // NOT know whether the upload was consumed, so the slip must stay locked.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: route(topupReject('fail', 'x'), expressHtml404),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('REVIEW');
    expect(f.slipState.consumed).toBe(true);
    expect(f.slipState.lock_reason).toBe('timeout');
  });

  it('(B5 ⭐ RESUME) all-4040 on a RESUMED walk ⇒ REVIEW, locked — the pause proves a prior upload', async () => {
    // A pause only ever happens AFTER a no_match, i.e. after walletpay consumed an
    // upload. So even though THIS walk uploaded nothing, the slip is already on
    // walletpay's side and releasing it could double-credit. `from > 0` is the
    // proof the ending must respect.
    const RUN_ID2 = new Types.ObjectId();
    const { runner, f } = makeRunner({
      seedRun: {
        _id: RUN_ID2,
        status: 'awaiting_retry',
        cursor: 0,
        resume_cursor: 1,
        hook_id: HOOK_ID,
        slip_record_id: SLIP_ID,
      },
      // The pause keeps the slip CLAIMED by the paused run (see D7: consumed
      // stays true, lock 'processing') — seed that state, or the lock update
      // that keys on `consumed_by_run` matches nothing.
      slip: {
        consumed: true,
        consumed_by_run: RUN_ID2,
        lock_reason: 'processing',
      },
      rawProfile: rawWith(
        walletpayStatement('REF1'),
        walletpayStatement('REF-D2'),
      ),
      callImpl: route(topupReject('fail', 'x'), walletpay4040),
    });
    const r = await runner.resumeForRetry({ runId: RUN_ID2, nextIdx: 1 });

    expect(r.outcome).toBe('REVIEW');
    expect(f.slipState.consumed).toBe(true);
  });

  // `400 {"code":4000}` — caught LIVE in the 2026-08-11 full-flow run: the
  // member statement carried a malformed ref_id (13-char final UUID segment)
  // and walletpay validates the format before anything else.
  const walletpay4000 = {
    success: false,
    status: 400,
    data: { code: 4000, message: 'Invalid refId' },
    method: 'POST',
    url: 'https://api.walletpay.example.com/api/v1/public/payin/x/slip',
  };

  it('(B7 ⭐) 4000 Invalid refId ⇒ skip the statement; zero-upload ending is RELEASED but FLAGGED', async () => {
    // Unlike 4040 (routine expiry ⇒ silent), a malformed refId is upstream
    // data damage — released (nothing uploaded) but an admin must see it.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-BAD-FORMAT')),
      callImpl: route(topupReject('fail', 'x'), walletpay4000),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('RELEASED');
    expect(f.slipState.consumed).toBe(false);
    expect(f.runs[0]?.needs_review).toBe(true); // flagged, not silent
    const skip = ctxRows(f).find((c) => c.reason === 'walletpay_invalid_ref');
    expect(skip).toBeDefined(); // the per-statement skip row
    const fallback = ctxRows(f).find(
      (c) => c.review_reason === 'walletpay_invalid_ref',
    );
    expect(fallback?.needs_review).toBe(true);
  });

  it('(B8) 4000 on statement 0 does not stop statement 1 from succeeding', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(
        walletpayStatement('REF-BAD'),
        walletpayStatement('REF-LIVE'),
      ),
      callImpl: (body, o) => {
        if (o.role === 'pay_topup') return topupReject('fail', 'x');
        return body.refId === 'REF-BAD' ? walletpay4000 : walletOk;
      },
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('SUCCESS');
    const refs = f.customTool.call.mock.calls
      .filter((c) => c[4].role === 'pay_walletpay')
      .map((c) => c[3].refId);
    expect(refs).toEqual(['REF-BAD', 'REF-LIVE']);
  });

  it('(B6) string "4040" body code is the same app error as the number', async () => {
    // Tolerant parse of the SAME code — a serializer flip on walletpay's side must
    // not silently turn a definite answer back into a locked review.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(
        walletpayStatement('REF-DEAD'),
        walletpayStatement('REF-LIVE'),
      ),
      callImpl: (body, o) => {
        if (o.role === 'pay_topup') return topupReject('fail', 'x');
        return body.refId === 'REF-DEAD'
          ? {
              ...walletpay4040,
              data: { code: '4040', message: 'PayIn transaction not found' },
            }
          : walletOk;
      },
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('SUCCESS');
    const refs = f.customTool.call.mock.calls
      .filter((c) => c[4].role === 'pay_walletpay')
      .map((c) => c[3].refId);
    expect(refs).toEqual(['REF-DEAD', 'REF-LIVE']);
  });
});

describe('[LIVEBODY] classifier vs the REAL topup response (captured 2026-08-09)', () => {
  /**
   * These bodies are the ACTUAL ones the production Shop-API returned, kept in
   * `log_error/case/topup-2026-08-09-response.json`. Pinning against a captured
   * body — not a hand-written guess — is what proves the classifier reads the
   * real contract rather than the one we imagined.
   *
   * ⚠️ THE TRAP THIS PINS: the envelope carries `success: true` at the TOP level
   * while `data.slip_status.status` says `"fail"`. The top-level flag means
   * "the request was handled", NOT "the slip was credited". Reading it as the
   * outcome would credit nothing and report success — the worst possible
   * direction on a money path. เชื่อ slip_status ห้ามเชื่อ success ข้างนอก.
   */
  const realFailBody = {
    data: {
      phone_number: '0965550015',
      slip_status: {
        img_url: 'https://cdn.example.com/.../slip.png',
        message: 'สลิปไม่ถูกต้อง หรือ ไม่สามารถอ่านสลิปได้',
        status: 'fail',
      },
      payload: { agent_id: 'x', image_url: 'y' },
    },
    success: true, // ⬅ true, even though the slip failed
  };

  it('⭐ reads slip_status.status, NOT the top-level success flag', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: (_b, o) =>
        o.role === 'pay_topup'
          ? { success: true, status: 200, data: realFailBody }
          : walletOk,
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    // 'fail' ⇒ topup did NOT credit ⇒ must fall through to walletpay.
    // If the top-level `success:true` were trusted, this would wrongly report
    // SUCCESS and no money would ever have moved.
    const walletpayCalls = f.customTool.call.mock.calls.filter(
      (c) => c[4].role === 'pay_walletpay',
    );
    expect(walletpayCalls.length).toBeGreaterThan(0);
    expect(r.outcome).toBe('SUCCESS'); // credited by WALLETPAY, not topup
    /* [FEAT-20260810-TOPUPCARD] state success ไม่ตอบเองแล้ว (ปล่อยการ์ด flex_success)
       เจตนาเทสนี้คือ "classifier อ่าน slip_status.status ไม่ใช่ success ชั้นบน"
       ซึ่งพิสูจน์ครบแล้วด้วย 2 assert ข้างบน: walletpay ถูกเรียก + outcome เป็น SUCCESS */
    expect(r.reply).toBeUndefined();
  });

  // [FIX-20260811-TOPUPSUCCESS] terminal-success ใช้ 'success' แทน 'process-wallet'
  it('the same envelope with success is TERMINAL — walletpay never runs', async () => {
    const credited = {
      ...realFailBody,
      data: {
        ...realFailBody.data,
        slip_status: {
          ...realFailBody.data.slip_status,
          status: 'success',
        },
      },
    };
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: (_b, o) =>
        o.role === 'pay_topup'
          ? { success: true, status: 200, data: credited }
          : walletOk,
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('SUCCESS');
    // [FEAT-20260810-TOPUPCARD] ไม่ตอบเอง ปล่อยการ์ด flex_success เดิม
    expect(r.reply).toBeUndefined();
    // THE double-credit guard: money already moved, so walletpay must NOT run.
    expect(
      f.customTool.call.mock.calls.filter((c) => c[4].role === 'pay_walletpay'),
    ).toHaveLength(0);
  });

  // [FIX-20260811-TOPUPSUCCESS] ยืนยันพฤติกรรมใหม่: 'process-wallet' เลิกใช้แล้ว ⇒
  // ตกเป็น REJECT → ไหลไป walletpay (ไม่ถือเป็น terminal success อีกต่อไป).
  it('legacy process-wallet is now a REJECT ⇒ walletpay DOES run', async () => {
    const legacy = {
      ...realFailBody,
      data: {
        ...realFailBody.data,
        slip_status: {
          ...realFailBody.data.slip_status,
          status: 'process-wallet',
        },
      },
    };
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: (_b, o) =>
        o.role === 'pay_topup'
          ? { success: true, status: 200, data: legacy }
          : walletOk,
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    // process-wallet no longer credits ⇒ falls through to walletpay.
    expect(
      f.customTool.call.mock.calls.filter((c) => c[4].role === 'pay_walletpay'),
    ).toHaveLength(1);
  });

  it('a 200 with NO slip_status is a REJECT, not a timeout', async () => {
    // The server answered and did not say success ⇒ it did not credit.
    // Treating this as TIMEOUT would lock the slip for review unnecessarily.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      callImpl: (_b, o) =>
        o.role === 'pay_topup'
          ? { success: true, status: 200, data: { data: {}, success: true } }
          : walletOk,
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(
      f.customTool.call.mock.calls.filter((c) => c[4].role === 'pay_walletpay')
        .length,
    ).toBeGreaterThan(0);
    expect(r.outcome).toBe('SUCCESS');
  });
});

describe('[CTXNOJOB] the no-job upsert key cannot collide with a real leg row', () => {
  /**
   * REVIEW POINT raised 2026-08-10: `_context` falls back to keying on
   * (chain_run_id, chain_step, target_key) when no job row exists. walletpay
   * [FIX-20260809-CTXUPSERT] ชื่อ field คือ `target_key` ตามที่ handoff-result.schema.ts:117
   * ใช้จริง — เดิมเทสนี้ (และโค้ด) เขียน `step_target_key` ซึ่งไม่มีในสคีมา ทำให้ upsert
   * throw ทั้ง run ตอนรันจริง เทสไม่จับเพราะ mock ไม่ได้บังคับ strict schema
   * walks several statements and calls `_context` each time with the SAME step
   * (2) and role (`pay_walletpay`) — so could a later write clobber an earlier one?
   *
   * NO, and the reason is structural: those calls happen AFTER the walletpay POST,
   * so a job row exists and they take the `{_id: jobId}` branch — a different
   * key per statement. The no-job branch is reachable ONLY before any walletpay
   * job is created, which is exactly once per run. These tests hold that line.
   */
  const ctxRows = (f: RunnerFakes) =>
    f.results.map(([filter, u]) => ({
      filter: filter as Record<string, unknown>,
      ctx: (u as Record<string, Record<string, unknown>>).$set?.context as
        Record<string, unknown> | undefined,
    }));

  it('⭐ real walletpay legs key on _id — never on (run,step,role)', async () => {
    // Two statements ⇒ two walletpay attempts ⇒ two context writes, same step+role.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(
        walletpayStatement('REF1'),
        walletpayStatement('REF2'),
      ),
      callImpl: (_b, o) =>
        o.role === 'pay_topup'
          ? topupReject('fail', 'x')
          : { success: true, status: 200, data: walletpayNoMatch },
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    const walletpayWrites = ctxRows(f).filter(
      (r) => r.ctx?.target_key === 'pay_walletpay',
    );
    expect(walletpayWrites.length).toBeGreaterThan(0);
    // Every one of them is keyed by _id, so each lands on its own job's row.
    for (const w of walletpayWrites) {
      expect(w.filter).toHaveProperty('_id');
      expect(w.filter).not.toHaveProperty('target_key');
    }
  });

  it('the no-job path uses the composite key, and fires at most once', async () => {
    // A config fault aborts BEFORE any walletpay job exists ⇒ composite key.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      tool: {
        ...paymentTool(),
        endpoints: paymentTool().endpoints.filter(
          (e: Record<string, unknown>) => e.role !== 'pay_walletpay',
        ),
      },
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    const composite = ctxRows(f).filter((r) => 'target_key' in r.filter);
    // Exactly one — so there is nothing for it to overwrite.
    expect(composite).toHaveLength(1);
    expect(composite[0]!.filter).toMatchObject({
      chain_step: 2,
      target_key: 'pay_walletpay',
    });
    expect(composite[0]!.ctx?.review_reason).toBe('no_walletpay_endpoint');
  });
});

describe('[CONFIGREVIEW] the flag reaches the RUN, not only the context row', () => {
  /**
   * ⚠️ THE DEFECT THIS PINS. The admin list filters
   * `handoff_chain_runs.needs_review` (handoff-chain.service.ts → listRuns), so
   * a flag set only on the context row is INVISIBLE to the dashboard. Caught in
   * review 2026-08-10 — the feature would have looked finished and shown
   * nothing. ต้องติดที่ run ไม่ใช่แค่ context row.
   */
  it('config fault sets run.needs_review = true', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF1')),
      tool: {
        ...paymentTool(),
        endpoints: paymentTool().endpoints.filter(
          (e: Record<string, unknown>) => e.role !== 'pay_walletpay',
        ),
      },
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.runs[0]!.status).toBe('stopped');
    // The row the dashboard actually queries.
    expect(f.runs[0]!.needs_review).toBe(true);
  });

  it('⭐ no_matching_statement leaves run.needs_review false — no noise', async () => {
    // The boundary: the ordinary case must NOT reach the admin queue.
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OTHER', 999)),
      callImpl: (_b, o) =>
        o.role === 'pay_topup' ? topupReject('fail', 'x') : walletOk,
    });
    await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.runs[0]!.status).toBe('stopped');
    expect(f.runs[0]!.needs_review).toBe(false);
  });
});

/* ==== [FEAT-20260816-MULTISTATUS] `statement_status` accepts a comma-separated
 * list ("waiting-deposit,fail"). Owner 16/08: "ค่าเดียวได้ สองค่าได้ seamless
 * ห้ามพัง" — MS4/MS5 are the ห้ามพัง PINs (green before AND after the change);
 * MS1-MS3, MS6 are the new behaviour (red-first on the unchanged tree). */
describe('[MULTISTATUS] statement_status: single value unchanged, CSV adds statuses', () => {
  const failStatement = (ref: string, amount = 100) => ({
    ...walletpayStatement(ref, amount),
    status: 'fail',
  });

  it('(MS1 ⭐ TARGET) "waiting-deposit,fail" lets a fail-status statement reach walletpay', async () => {
    const { runner, f } = makeRunner({
      tool: paymentTool({ statement_status: 'waiting-deposit,fail' }),
      rawProfile: rawWith(failStatement('REF-F')),
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    const refs = f.customTool.call.mock.calls
      .filter((c) => c[4].role === 'pay_walletpay')
      .map((c) => c[3].refId);
    expect(refs).toEqual(['REF-F']);
    expect(r.outcome).toBe('SUCCESS');
  });

  it('(MS2 TARGET) both statuses are candidates in ONE walk — the pause proves it', async () => {
    // no_match on the waiting-deposit row PAUSES only because the fail-status row
    // counts as "next" — on the old single-value rule this ends REVIEW/exhausted.
    const { runner } = makeRunner({
      tool: paymentTool({ statement_status: 'waiting-deposit,fail' }),
      rawProfile: rawWith(walletpayStatement('REF-W'), failStatement('REF-F')),
      callImpl: (_b: Record<string, unknown>, o: { role?: string }) =>
        o.role === 'pay_topup'
          ? topupReject('fail', 'x')
          : { success: true, status: 200, data: walletpayNoMatch },
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('AWAITING_RETRY');
  });

  it('(MS3 TARGET) spaces around the comma are tolerated', async () => {
    const { runner } = makeRunner({
      tool: paymentTool({ statement_status: 'waiting-deposit, fail' }),
      rawProfile: rawWith(failStatement('REF-F')),
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('SUCCESS');
  });

  it('(MS4 ⭐ PIN ห้ามพัง) single value still EXCLUDES other statuses — old rule intact', async () => {
    const { runner, f } = makeRunner({
      tool: paymentTool({ statement_status: 'waiting-deposit' }),
      rawProfile: rawWith(failStatement('REF-F')),
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    const walletCalls = f.customTool.call.mock.calls.filter(
      (c) => c[4].role === 'pay_walletpay',
    );
    expect(walletCalls).toHaveLength(0); // fail row must NOT become a candidate
    expect(r.outcome).toBe('RELEASED'); // statement_not_found fallback, as today
  });

  it('(MS5 ⭐ PIN ห้ามพัง) empty value still means NO status filter', async () => {
    const { runner } = makeRunner({
      tool: paymentTool({ statement_status: '' }),
      rawProfile: rawWith(failStatement('REF-F')),
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('SUCCESS');
  });

  it('(MS6 TARGET) the admin amounts line honours the SAME rule — a fail-status 400 shows, not "ไม่มี"', async () => {
    // Slip amount (100) matches nothing ⇒ no_matching_statement ticket. The
    // pending list shown to the admin is filtered by the SAME status rule
    // (TICKETAMOUNTS) — with CSV the fail-status 400 must appear.
    const { runner, f } = makeRunner({
      tool: paymentTool({ statement_status: 'waiting-deposit,fail' }),
      rawProfile: rawWith(failStatement('REF-F', 400)),
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.outcome).toBe('RELEASED');
    const created = f.ticketModel.create.mock.calls[0]?.[0] as
      { need_detail?: string } | undefined;
    expect(String(created?.need_detail ?? '')).toContain('400');
  });
});

/* ==== [FEAT-20260816-DUPSUCCESSLOCK] resend AFTER a slip success-lock ⇒ the
 * runner steps aside so the hook's `flex_duplicate` card answers.
 * Owner 16/08: "ถ้าล็อคด้วย success แล้ว [ส่งซ้ำ] ต้องตอบ Flex เมื่อตรวจ QR Code
 * สถานะซ้ำ" + "flow นี้ไม่เกี่ยวกับการที่ topup ตอบ duplicate" — the gate reads
 * OUR OWN slip success lock BEFORE any leg fires; DUPFORWARD stays intact for
 * everything else. DS1/DS4 are red-first TARGETs; DS2/DS3 pin ห้ามพัง. */
describe('[DUPSUCCESS] prior success lock ⇒ ran:false, legacy duplicate card answers', () => {
  it('(DS1 ⭐ TARGET) success-locked trans_ref exists ⇒ runner steps aside, NO legs fire, no claim', async () => {
    const { runner, f } = makeRunner({
      priorSuccessSlip: { _id: 'OLD_SLIP' },
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.ran).toBe(false);
    expect(r.skipped).toBe('duplicate_after_success');
    expect(f.customTool.call).not.toHaveBeenCalled(); // ไม่แตะ topup/walletpay เลย
    expect(f.slipState.consumed).toBe(false); // แถวใหม่ไม่ถูก claim — legacy card ตอบได้อิสระ
    // THE FILTER IS THE RULE — assert it verbatim so widening it is a red test:
    const filter = f.slipModel.findOne!.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(filter.trans_ref).toBe('TR1');
    expect(filter.consumed).toBe(true);
    expect(filter.lock_reason).toBe('success');
    expect(filter._id).toEqual({ $ne: SLIP_ID });
  });

  it('(DS2 ⭐ PIN ห้ามพัง) no prior success row ⇒ flow byte-identical to today', async () => {
    const { runner, f } = makeRunner({
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.ran).toBe(true); // DUPFORWARD path untouched
    expect(
      f.customTool.call.mock.calls.some((c) => c[4].role === 'pay_topup'),
    ).toBe(true);
  });

  it('(DS3 PIN) synthetic trans_ref (SWIFTCHECK_/FAIL_/ERR_) never gates — lookup skipped', async () => {
    const { runner, f } = makeRunner({
      slip: { trans_ref: 'SWIFTCHECK_1755331200000' },
      priorSuccessSlip: { _id: 'OLD_SLIP' }, // even a (bogus) match must not be consulted
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(f.slipModel.findOne).not.toHaveBeenCalled();
    expect(r.ran).toBe(true);
  });

  it('(DS4 TARGET · FAIL-OPEN) lookup throws ⇒ money path proceeds as before', async () => {
    const { runner, f } = makeRunner({
      priorSuccessSlip: 'THROW',
      callImpl: route(topupReject('fail', 'x'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
    expect(r.ran).toBe(true); // a broken gate must never block money processing
    expect(
      f.customTool.call.mock.calls.some((c) => c[4].role === 'pay_topup'),
    ).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * [FEAT-20260823-TOPUPDUP] topup ตอบ duplicate ⇒ หยุด + ตอบการ์ด duplicate
 * ═══════════════════════════════════════════════════════════════════════════
 * เจ้าของสั่ง 23/08/2026 — กลับคำตัดสิน 15/08 (DUPFORWARD) เฉพาะสถานะนี้สถานะเดียว
 *
 * ทางเลือกที่เจ้าของเคาะ (เทสตรึงไว้ทั้ง 4 ข้อ เผื่อวันหน้าเปลี่ยนใจจะได้เห็นว่าแดงตรงไหน):
 *   (ก) ปล่อยสลิป — ลูกค้าส่งใบใหม่ได้ทันที
 *   (ข) ไม่เปิด ticket
 *   (ค) ไม่ตั้ง needs_review
 *   (ง) การ์ดที่ตอบ = `hook.flex_duplicate` ของ Swiftcheck ผ่าน default ใน resolver
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('[TOPUPDUP] topup duplicate ⇒ หยุดก่อน walletpay + ตอบการ์ด duplicate', () => {
  it('⭐ ห้ามเรียก walletpay เด็ดขาด — หัวใจของงานนี้', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      // ตั้ง walletpay ให้สำเร็จไว้ด้วย — ถ้าโค้ดเผลอเรียก จะได้ SUCCESS แล้วเทสจับได้ทันที
      callImpl: route(topupReject('duplicate', 'สลิปซ้ำ'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    const roles = f.customTool.call.mock.calls.map((c) => c[4].role);
    expect(roles).toEqual(['pay_topup']);
    expect(roles).not.toContain('pay_walletpay');
    expect(r.outcome).not.toBe('SUCCESS');
  });

  it('(ก) ปล่อยสลิป — ส่งใบใหม่ได้ทันที ไม่ต้องรอปลดล็อก', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('duplicate', 'สลิปซ้ำ'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('RELEASED');
    expect(f.slipState.consumed).toBe(false);
    expect(f.slipState.lock_reason).toBe('');
  });

  it('(ข)(ค) ไม่เปิด ticket และไม่ตั้ง needs_review', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('duplicate', 'สลิปซ้ำ'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(f.ticketsCreated).toHaveLength(0);
    expect(r.needs_review).toBe(false);
  });

  it('ตอบด้วย state `topup_duplicate` (ไม่ใช่ปล่อยให้การ์ด Swiftcheck ตอบเอง)', async () => {
    const { runner } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupReject('duplicate', 'สลิปซ้ำ'), walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    /* ⚠️ ต้องมี reply เสมอ — ปล่อยให้การ์ด Swiftcheck ตอบเองไม่ได้ เพราะ Swiftcheck
       บอกว่าสลิปใบนี้ **ไม่ซ้ำ** (คนที่บอกว่าซ้ำคือ Shop-API) ⇒ ถ้าปล่อย ลูกค้าจะได้
       `flex_success` = บอกว่าเงินเข้าแล้ว ซึ่งผิด */
    expect(r.reply).toBeDefined();
    expect(r.reply?.state).toBe('topup_duplicate');
    expect(r.reply?.text).toBeTruthy();
  });

  it('สถานะอื่นไม่ถูกลูกหลง — fail / account-not-match ยังไป walletpay เหมือนเดิม', async () => {
    for (const status of ['fail', 'account-not-match']) {
      const { runner, f } = makeRunner({
        rawProfile: rawWith(walletpayStatement('REF-OK')),
        callImpl: route(topupReject(status, 'msg'), walletOk),
      });
      const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });
      expect(r.outcome).toBe('SUCCESS');
      const roles = f.customTool.call.mock.calls.map((c) => c[4].role);
      expect(roles).toEqual(['pay_topup', 'pay_walletpay']);
    }
  });

  it('success ยังหยุดที่ topup เหมือนเดิม (ไม่ได้ไปแตะทางเงินเข้า)', async () => {
    const { runner, f } = makeRunner({
      rawProfile: rawWith(walletpayStatement('REF-OK')),
      callImpl: route(topupProceed, walletOk),
    });
    const r = await runner.runForSlip({ hook: HOOK, slipRecordId: SLIP_ID });

    expect(r.outcome).toBe('SUCCESS');
    expect(f.customTool.call.mock.calls.map((c) => c[4].role)).toEqual([
      'pay_topup',
    ]);
  });
});
