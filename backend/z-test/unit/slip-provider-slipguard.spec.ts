/**
 * =============================================================================
 * [FEAT-20260903-SLIPGUARD] the SlipGuard adapter — every claim measured, not read
 * =============================================================================
 *
 * The provider is WRITTEN AND NOT REGISTERED, so none of this can reach a
 * customer yet. These cases are what makes registering it a one-line decision
 * instead of a leap: each one pins a fact that was captured from the live API on
 * 02/09 (`docs/slipguard-proof/*.local.json`, gitignored — they carry slip data).
 *
 * 🔴 THE THREE THAT WOULD COST REAL MONEY OR REAL TRUST IF WRONG:
 *   1. the DATE. `transDate` is eight digits with NO separators, and
 *      `transTimestamp` is UTC. Get it wrong one way and every slip reads seven
 *      hours old ⇒ every one is answered with the expired-slip card. Get it
 *      wrong the other way and the parser matches nothing ⇒ the out-of-time
 *      check is SILENTLY SKIPPED for every slip.
 *   2. SUCCESS FROM THE HTTP STATUS. SlipGuard sends `data.success: true` inside an
 *      error envelope; reading it reports a wrong-account slip as verified.
 *   3. ONLY `1012` AND `1014` ARE CLAIMED from the error path. Folding an
 *      unrecognised code would tell the payment leg a slip is good on a verdict
 *      nobody has read.
 *
 * ⚠️ The fixtures below are SHAPES, not copies of a captured file: field names
 * and formats come from the capture, values are invented. A captured slip must
 * not enter the repository.
 *
 * revert: delete with `src/modules/slip/providers/slipguard/`.
 */
import {
  SLIP_PROVIDERS,
  SLIPGUARD_ERROR_VERDICTS,
  slipGuardBangkokDate,
  slipGuardVerdictFor,
  slipguardProvider,
} from '@/modules/slip';
import { pickByPath } from '@/modules/external';

/** The shape a success comes back in — names and formats from the capture. */
const successBody = {
  success: true,
  data: {
    success: true, // 🔴 present, and must never be what we read
    transRef: 'AB12345C6D7890123',
    sendingBank: '004',
    receivingBank: '006',
    transDate: '20260812',
    transTime: '17:08:36',
    transTimestamp: '2026-08-12T10:08:36.000Z',
    sender: {
      displayName: 'SENDER DISPLAY',
      name: 'SENDER NAME',
      account: { type: 'BANKAC', value: 'XXX-X-XX111-1' },
      proxy: { type: null, value: null },
    },
    receiver: {
      displayName: 'SHOP DISPLAY',
      name: 'SHOP NAME',
      account: { type: 'BANKAC', value: 'XXX-X-XX503-4' },
      proxy: { type: null, value: null },
    },
    amount: 1000,
    qrcodeData: 'QR-STRING',
  },
};

/** A 400 body: no top-level `success`, no `data.success`, no `qrcodeData`. */
const errorBody = (code: number) => ({
  code,
  message: 'ข้อความจากผู้ให้บริการ',
  data: { ...successBody.data, success: undefined, qrcodeData: undefined },
});

const rejectionWith = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

describe('[SLIPGUARD] ⭐ the date — the field that silently breaks the time check', () => {
  it('⭐ composes YYYYMMDD + HH:mm:ss into a form the parser can read, stamped +07:00', () => {
    /* 🔴 `transDate` has NO separators — measured, and the spec's own mapping
       table does not say so. `parseBangkokSlipDateMs` anchors on
       `YYYY-MM-DD[ T]HH:mm[:ss]`, so `"20260812 17:08:36"` matches nothing, the
       handler logs and leaves `violationDetected` false, and the out-of-time
       check is skipped for every slip with no error and no card. */
    expect(slipGuardBangkokDate('20260812', '17:08:36')).toBe(
      '2026-08-12T17:08:36+07:00',
    );
  });

  it('⭐ never forwards `transTimestamp`, which is UTC and reads 7 hours early', () => {
    /* The capture's `transTimestamp` is the SAME INSTANT as transDate+transTime,
       written in UTC. The parser discards a trailing `Z` and stamps `+07:00`, so
       forwarding it makes every slip look seven hours older than it is — and any
       `slip_check_out_of_time` under seven hours then fires on every single one. */
    const composed = slipGuardBangkokDate(
      successBody.data.transDate,
      successBody.data.transTime,
    );

    expect(composed).not.toContain('Z');
    expect(composed).toContain('+07:00');
    // and it is the LOCAL wall time, not the UTC one that sits in the capture
    expect(composed?.startsWith('2026-08-12T17:08:36')).toBe(true);
    expect(successBody.data.transTimestamp).toContain('10:08:36'); // the trap value
  });

  it('returns undefined rather than a half-built string it cannot vouch for', () => {
    /* A string the parser cannot read is WORSE than an absent one: absent is
       visible in the row, unparseable is skipped in silence. */
    for (const [d, t] of [
      ['2026-08-12', '17:08:36'], // already separated — not the measured shape
      ['20260812', '17:08'], // no seconds
      ['', ''],
      [null, null],
      ['not-a-date', 'nope'],
    ] as [string | null, string | null][]) {
      expect(slipGuardBangkokDate(d, t)).toBeUndefined();
    }
  });
});

describe('[SLIPGUARD] ⭐ the fold — a 4xx that is really an answer', () => {
  it('⭐ claims 1012 and 1014 from the error path, and NOTHING else', () => {
    /* Claiming an unrecognised code would fold it into the success shape and
       tell the payment leg a slip is good on a verdict nobody read. `1001`
       (branch not found), `1002` (bad key) and `1004` (over quota) are real
       failures and must keep their `ERR_` meaning. */
    expect(
      slipguardProvider.recoverFromError(rejectionWith(400, errorBody(1012))),
    ).not.toBeNull();
    expect(
      slipguardProvider.recoverFromError(rejectionWith(400, errorBody(1014))),
    ).not.toBeNull();

    for (const code of [
      1000, 1001, 1002, 1003, 1004, 1009, 1010, 1011, 1013, 1015,
    ]) {
      expect(
        slipguardProvider.recoverFromError(rejectionWith(400, errorBody(code))),
      ).toBeNull();
    }
  });

  it('claims nothing from a transport failure — a timeout is not an answer', () => {
    for (const err of [
      new Error('timeout of 30000ms exceeded'),
      Object.assign(new Error('no body'), { response: undefined }),
      'a string',
      null,
      undefined,
    ]) {
      expect(slipguardProvider.recoverFromError(err)).toBeNull();
    }
  });

  it('hands back the RAW reply, so the fold runs exactly once', () => {
    /* `sendWithRecovery` passes this straight into `normaliseResponse`.
       Translating here as well would run the fold twice. */
    const raw = errorBody(1012);
    const claimed = slipguardProvider.recoverFromError(rejectionWith(400, raw));

    expect(claimed?.data).toBe(raw);
    expect(claimed?.status).toBe(400);
  });
});

describe('[SLIPGUARD] ⭐ the envelope — synthesised flags and a status-only success', () => {
  const normalise = (status: number, data: unknown) =>
    slipguardProvider.normaliseResponse({ status, data }) as {
      status: number;
      data: {
        success: boolean;
        error?: { code?: number };
        data?: Record<string, unknown>;
      };
    };

  it('⭐ 200 becomes success with BOTH flags synthesised', () => {
    /* A SlipGuard success carries neither `isDuplicate` nor `matchedAccount` —
       measured; they exist only as absences. Swiftcheck sends them, so the flow
       reads them, so this has to supply them. */
    const out = normalise(200, successBody);

    expect(out.data.success).toBe(true);
    expect(out.data.data?.isDuplicate).toBe(false);
    expect(out.data.data?.matchedAccount).toBe(true);
  });

  it('⭐ 1012 folds to success + isDuplicate, and does NOT claim matchedAccount', () => {
    /* The vendor does not tell us whether the receiver matched on a duplicate,
       so claiming it did would be inventing a money-path fact. */
    const out = normalise(400, errorBody(1012));

    expect(out.data.success).toBe(true);
    expect(out.data.data?.isDuplicate).toBe(true);
    expect(out.data.data?.matchedAccount).toBeUndefined();
  });

  it('⭐ 1014 folds to success + matchedAccount:false', () => {
    // Swiftcheck reports a wrong receiver inside a 200 with this same flag, which
    // is what makes the wrong-receiver card reachable for both vendors.
    const out = normalise(400, errorBody(1014));

    expect(out.data.success).toBe(true);
    expect(out.data.data?.matchedAccount).toBe(false);
  });

  it('⭐ an unfolded code becomes a FAILURE carrying the vendor’s own number', () => {
    /* Not translated into Swiftcheck's string vocabulary: the flex router branches
       on those strings and falls through to `hook.flex_error` for anything else,
       which is the recorded decision for SlipGuard's operational codes. */
    const out = normalise(400, errorBody(1010));

    expect(out.data.success).toBe(false);
    expect(out.data.error?.code).toBe(1010);
  });

  it('⭐ success is decided by the HTTP STATUS, never by a body field', () => {
    /* SlipGuard sends `data.success: true` INSIDE an error envelope. Reading it
       would report a wrong-account slip as verified, on the money path. */
    const poisoned = {
      code: 1014,
      data: { ...successBody.data, success: true },
    };
    const out = normalise(400, poisoned);

    expect(out.data.data?.matchedAccount).toBe(false);
    // and the vendor's own `success` is kept where nothing reads it as ours
    expect((out.data.data?.slipguard as { success?: boolean })?.success).toBe(
      true,
    );
    expect(slipguardProvider.isSuccess(out.data)).toBe(true); // folded ⇒ a real answer
  });

  it('re-nests into the tree the row builder actually reads', () => {
    /* The row builder reads `data.rawSlip.sender.account.bank.account`,
       `…receiver.account.proxy.account`, `…bank.short`, `…amount.amount` and
       `…transRef`. SlipGuard is flat under `data`, so this is a re-nest, not a
       rename — and a missed branch here writes an empty column, silently. */
    const slip = normalise(200, successBody).data.data?.rawSlip as {
      transRef: string;
      amount: { amount: number };
      sender: { account: { bank: { account: string }; name: { th: string } } };
      receiver: {
        account: { bank: { account: string }; proxy: { account: string } };
        bank: { short: string };
      };
    };

    /* 🔴 ADDED AFTER A MUTATION SURVIVED. The date cases above drive
       `slipGuardBangkokDate` directly, which proves the HELPER is right and proves
       nothing about whether the envelope USES it — swapping this line for
       `d.transTimestamp` left the whole suite green while re-introducing the
       seven-hour error on every slip. Asserting it here is what closes that. */
    expect((slip as unknown as { date: string }).date).toBe(
      '2026-08-12T17:08:36+07:00',
    );
    expect((slip as unknown as { date: string }).date).not.toContain('Z');

    expect(slip.transRef).toBe('AB12345C6D7890123');
    expect(slip.amount.amount).toBe(1000);
    expect(slip.sender.account.bank.account).toBe('XXX-X-XX111-1');
    expect(slip.sender.account.name.th).toBe('SENDER NAME');
    expect(slip.receiver.account.bank.account).toBe('XXX-X-XX503-4');
    expect(slip.receiver.account.proxy.account).toBe('');
    // a 3-DIGIT CODE, not a word — which is what the bank-logo map wants
    expect(slip.receiver.bank.short).toBe('006');
  });

  it('survives a reply with every optional field missing', () => {
    // Field counts differ by outcome (21 on success, 18 on 1012). Reading
    // anything as required would throw on a live conversation.
    expect(() => normalise(200, { data: {} })).not.toThrow();
    expect(() => normalise(200, {})).not.toThrow();
    expect(() => normalise(400, null)).not.toThrow();
  });
});

describe('[SLIPGUARD] the request, and the switch that is deliberately not thrown', () => {
  const build = (over: Record<string, unknown> = {}) =>
    slipguardProvider.buildRequest({
      imageBase64: 'IMAGE',
      checkDuplicate: true,
      matchAccount: true,
      apiKey: 'KEY',
      baseUrl: 'https://api.slipguard.example',
      branchId: '75134',
      ...over,
    });

  it('⭐ puts the branch in the PATH and the key in `x-authorization`', () => {
    /* The account is part of the endpoint for this vendor, which is why the
       hook carries `slip_verify_branch` at all. And a bearer token answers
       `1002` — the header name is its own, not Swiftcheck's. */
    const r = build();

    expect(r.url).toBe('https://api.slipguard.example/api/line/apikey/75134');
    expect(r.headers['x-authorization']).toBe('KEY');
    expect(r.headers.Authorization).toBeUndefined();
    expect(r.endpoint).toBe('/api/line/apikey/75134');
  });

  it('⭐ names the image field `files`, so redaction strips the right key', () => {
    /* Naming it `base64` would add a phantom key AND leave the whole slip image
       in `webhook_logs.raw_request` and `slip_verifications.raw_request`. */
    const r = build();

    expect(r.imageField).toBe('files');
    expect(r.body.files).toBe('IMAGE');
    expect(r.body.base64).toBeUndefined();
  });

  it('⭐ sends `log: true`, because that is what performs the checks at all', () => {
    /* `log` is not a logging flag: with it OFF there is no receiver check and no
       duplicate detection, and this flow has no store to do either itself. */
    expect(build().body.log).toBe(true);
  });

  it('does not throw on a missing branch — the vendor reports it instead', () => {
    /* `buildRequest` is pure and its caller has no catch for it. A throw would
       turn a misconfiguration into a crash on a live conversation; the vendor's
       `1001` is visible in the log and on the row. */
    expect(() => build({ branchId: undefined })).not.toThrow();
    expect(build({ branchId: undefined }).url).toContain('/api/line/apikey/');
  });

  it('⭐ is NOT registered — nothing can select it yet', () => {
    /* The one line that switches it on is gated on the owner's condition: Shop-API
       must confirm it reads a new vendor's envelope before a second provider is
       enabled for a payment-ON hook. This case is what makes that a decision
       rather than a drift. */
    expect(Object.keys(SLIP_PROVIDERS)).not.toContain('slipguard');
    expect(Object.values(SLIP_PROVIDERS)).not.toContain(slipguardProvider);
  });
});

/* ==== [DECISION-20260903-VERIFYFEEDSPAYMENT] the leg AFTER the card ==========
   Verification does not end at the card: with the payment custom tool ON, the
   slip row's `raw_response` is forwarded to Shop-API, optionally narrowed by that
   tool record's `topup_payload_path`.

   🔴 THESE CASES EXIST BECAUSE A COMMENT WAS WRONG. `payment-runner.service.ts`
   claimed a second provider would make the path "find nothing in SlipGuard's tree"
   and drop the payload. That was written before `normaliseResponse` existed —
   the row now holds the SHARED shape, so the path resolves the same way for both
   vendors. The comment is corrected; these prove the corrected version. */
describe('[SLIPGUARD] ⭐ RULE A — the payment leg still finds what it expects', () => {
  const forwarded = (path: string) => {
    const row = slipguardProvider.normaliseResponse({
      status: 200,
      data: successBody,
    }).data;
    // exactly what `_swiftcheckResult` does: no path ⇒ the whole envelope
    return path ? pickByPath(row, path) : row;
  };

  it('⭐ [RULE A] the default path forwards a Swiftcheck-shaped envelope', () => {
    const payload = forwarded('') as { success: boolean; data: unknown };

    expect(payload.success).toBe(true);
    expect(payload.data).toBeDefined();
  });

  it('⭐ [RULE A] `topup_payload_path: "data"` still resolves — it does NOT miss', () => {
    /* This is the exact claim the old comment got wrong. `'data'` is documented
       on `topup_payload_path` as "Swiftcheck's inner object"; SlipGuard's normalised
       reply has the same inner object, so an operator's existing setting keeps
       working when a hook switches provider. */
    const payload = forwarded('data') as Record<string, unknown>;

    expect(payload).toBeDefined();
    expect(payload.rawSlip).toBeDefined();
    expect(payload.amountInSlip).toBe(1000);
    expect(payload.matchedAccount).toBe(true);
  });

  it('the vendor’s own untranslated reply is reachable at `data.slipguard`', () => {
    /* For whoever wants SlipGuard's native shape instead: no code change, no new
       field — the existing per-custom-tool-record path already reaches it. */
    const payload = forwarded('data.slipguard') as Record<string, unknown>;

    expect(payload.transRef).toBe('AB12345C6D7890123');
    expect(payload.transTimestamp).toBe('2026-08-12T10:08:36.000Z');
  });
});

describe('[SLIPGUARD] the error table is this vendor’s own', () => {
  it('folds only the two business codes; every other documented code is a failure', () => {
    expect(slipGuardVerdictFor(1012)).toBe('duplicate');
    expect(slipGuardVerdictFor(1014)).toBe('wrong_receiver');

    const others = Object.keys(SLIPGUARD_ERROR_VERDICTS)
      .map(Number)
      .filter((c) => c !== 1012 && c !== 1014);
    for (const code of others) {
      expect(slipGuardVerdictFor(code)).toBe('failure');
    }
  });

  it('⭐ an unknown code fails toward FAILURE, never toward success', () => {
    /* Failing the other way would move money on a code nobody has read. */
    for (const code of [9999, 0, -1, null, undefined, 'x', {}]) {
      expect(slipGuardVerdictFor(code)).toBe('failure');
    }
  });

  it('covers every code the vendor documents, so an unseen one is distinguishable', () => {
    // 1000-1015 inclusive: "we decided this is a failure" and "we have never
    // heard of this code" are different states and the next reader needs both.
    for (let code = 1000; code <= 1015; code += 1) {
      expect(SLIPGUARD_ERROR_VERDICTS[code]).toBeDefined();
    }
  });
});
