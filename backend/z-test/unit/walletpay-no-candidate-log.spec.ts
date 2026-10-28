/* [FEAT-20260815-NOCANDIDATELOG] the walletpay leg must explain a zero-candidate stop
 * ===========================================================================
 * THE GAP THIS CLOSES. When `_matchStatements` returns nothing the run stops
 * before walletpay, and the step-2 handoff result is written with a `reason` and an
 * EMPTY `final`. Owner, 15/08/2026: "ถ้าไม่ทำ walletpay เพราะไม่เข้า ก็ยังต้อง log
 * เก็บ … ต้องโชว์เงื่อนไข candidate ของเราด้วย". Without it you cannot tell a
 * customer with no pending deposit from a misspelled `statement_tx_path`, and the
 * values behind the decision (`info.trade_no`, the statuses actually present) are
 * gone by the time anyone looks.
 *
 * WHAT IS PINNED — the log must carry BOTH halves:
 *   · OUR RULE      the configured provider / status / tx_path / ref field
 *   · WHAT CAME     row counts per narrowing step, and the refId per passing row
 *
 * ⚠️ WHAT IS DELIBERATELY NOT PINNED: exact sentence wording. These assert on the
 * VALUES an operator needs (the configured strings, the counts, the ref state),
 * so the copy can be reworded without a false failure — but it cannot silently
 * drop a value.
 *
 * SAFETY PROPERTY, ALSO PINNED: `_logNoCandidate` is diagnostics on a money path.
 * A profile shape it did not expect must never break a run, so the last case
 * feeds it garbage and asserts it neither throws nor goes silent.
 *
 * Unit-level on purpose: the method is private and reads only its arguments, so
 * driving it directly is a faithful test of what the caller passes it. The CALL
 * SITE (that a zero-candidate stop invokes it at all) is covered by the runner's
 * own flow specs, which already assert the `no_matching_statement` return.
 */
import { PaymentRunnerService } from '@/modules/payment/payment-runner.service';

/** The private surface this spec drives, named once.
 *  `_logNoCandidate` is private, so the prototype is reached through `unknown` —
 *  intersecting with the class type collapses to `never` under `tsc`. */
type RunnerProbe = {
  logger: { log: (m: string) => void; warn: (m: string) => void };
  _logNoCandidate: (
    hook: Record<string, unknown> | undefined,
    slip: unknown,
    cfg: unknown,
    rawProfile: unknown,
  ) => void;
};

/** Capture every `logger.log` line the method emits, in order. */
function makeRunner() {
  const lines: string[] = [];
  const warns: string[] = [];
  const svc = Object.create(
    PaymentRunnerService.prototype,
  ) as unknown as RunnerProbe;
  svc.logger = {
    log: (m: string) => void lines.push(m),
    warn: (m: string) => void warns.push(m),
  };
  return { svc, lines, warns, all: () => lines.join('\n') };
}

/** The live `omnideskdevoa` shape, read from Mongo on 15/08/2026. */
const CFG = {
  statement_provider_code: 'walletpay',
  statement_status: 'fail',
  statement_tx_path: 'data.profile.transaction',
  walletpay_ref_id_field: 'info.trade_no',
  walletpay_ref_id_query_param: 'refid',
} as never;

const profileWith = (statement: unknown) => ({
  data: { profile: { transaction: { statement } } },
});

const HOOK = { alias: 'omnideskdevoa' };
const SLIP = { amount: 500 } as never;

describe('[NOCANDIDATELOG] a zero-candidate walletpay stop is explained in the log', () => {
  it('states OUR rule — the configured provider, status, tx path and slip amount', () => {
    const { svc, all } = makeRunner();

    svc._logNoCandidate(HOOK, SLIP, CFG, profileWith([]));

    const out = all();
    expect(out).toContain('omnideskdevoa');
    expect(out).toContain('walletpay'); // provider_code we require
    expect(out).toContain('fail'); // status we require
    expect(out).toContain('data.profile.transaction'); // where we looked
    expect(out).toContain('500'); // the slip amount compared against
  });

  /* The single most likely config fault: a misspelled path reads as "no pending
     deposits" and is indistinguishable from a customer who simply has none. */
  it('separates a MISSING tx path from a path that yielded an empty list', () => {
    const missing = makeRunner();
    missing.svc._logNoCandidate(HOOK, SLIP, CFG, { data: {} });
    expect(missing.all()).toContain('PATH NOT FOUND');

    const empty = makeRunner();
    empty.svc._logNoCandidate(HOOK, SLIP, CFG, profileWith([]));
    expect(empty.all()).not.toContain('PATH NOT FOUND');
    expect(empty.all()).toMatch(/PATH OK/);
  });

  it('names the field it would have read the ref id from, even with no rows', () => {
    const { svc, all } = makeRunner();

    svc._logNoCandidate(HOOK, SLIP, CFG, profileWith([]));

    expect(all()).toContain('info.trade_no');
  });

  /* WHICH condition did the narrowing — provider, status, or the amount. */
  it('shows the row count after each condition so the blocker is visible', () => {
    const { svc, all } = makeRunner();

    svc._logNoCandidate(
      HOOK,
      SLIP,
      CFG,
      profileWith([
        { provider_code: 'walletpay', status: 'fail', amount: 300 }, // passes both, wrong amount
        { provider_code: 'walletpay', status: 'waiting-deposit', amount: 500 }, // wrong status
        { provider_code: 'other', status: 'fail', amount: 500 }, // wrong provider
      ]),
    );

    // 3 total -> 2 after provider -> 1 after status -> 0 after amount
    expect(all()).toMatch(/3\D+2\D+1\D+0/);
  });

  /* The rows that passed provider+status are the ones a matching amount would
     have selected, so their amounts and refIds are what an operator needs. */
  it('reports the ref id of each passing row — found, EMPTY, or ABSENT', () => {
    const { svc, all } = makeRunner();

    svc._logNoCandidate(
      HOOK,
      SLIP,
      CFG,
      profileWith([
        {
          provider_code: 'walletpay',
          status: 'fail',
          amount: 100,
          info: { trade_no: 'TN-1' },
        },
        {
          provider_code: 'walletpay',
          status: 'fail',
          amount: 200,
          info: { trade_no: '' },
        },
        { provider_code: 'walletpay', status: 'fail', amount: 300 }, // no `info` at all
      ]),
    );

    const out = all();
    expect(out).toContain('TN-1');
    expect(out).toContain('EMPTY');
    expect(out).toContain('ABSENT');
    // and the amounts that were on offer, so "why not this one" is answerable
    expect(out).toContain('100');
    expect(out).toContain('300');
  });

  /* With nothing past provider+status the passing list is empty and explains
     nothing — the rows that WERE there must be shown instead. */
  it('falls back to showing what the rows carried when none passed', () => {
    const { svc, all } = makeRunner();

    svc._logNoCandidate(
      HOOK,
      SLIP,
      CFG,
      profileWith([
        { provider_code: 'wallet', status: 'success', amount: 500 },
      ]),
    );

    const out = all();
    expect(out).toContain('wallet');
    expect(out).toContain('success');
  });

  /* A long statement list must not flood the log. */
  it('caps the per-row detail and says how many were withheld', () => {
    const { svc, lines, all } = makeRunner();
    const rows = Array.from({ length: 9 }, (_, i) => ({
      provider_code: 'walletpay',
      status: 'fail',
      amount: 10 + i,
      info: { trade_no: `TN-${i}` },
    }));

    svc._logNoCandidate(HOOK, SLIP, CFG, profileWith(rows));

    expect(all()).toContain('TN-0');
    expect(all()).not.toContain('TN-8'); // beyond the cap
    expect(all()).toMatch(/4 more/); // 9 passing, 5 shown
    expect(lines.length).toBeLessThan(12);
  });

  /* THE SAFETY PROPERTY. This runs on a money path; an unexpected shape must
     degrade to a warning, never throw into the caller.
     ⚠️ A malformed profile alone does NOT prove the guard: every read here is
     already defensive, so those inputs never reach the `catch` — mutation M3
     (throwing inside the body) left this green when it only fed bad profiles.
     The throwing LOGGER below is what actually exercises the catch, because it
     fails from inside the try on a perfectly ordinary input. */
  it('never throws on a malformed profile, and still says something', () => {
    for (const bad of [null, undefined, 42, 'nope', { data: null }]) {
      const { svc, lines, warns } = makeRunner();
      expect(() => svc._logNoCandidate(HOOK, SLIP, CFG, bad)).not.toThrow();
      expect(lines.length + warns.length).toBeGreaterThan(0);
    }
  });

  it('swallows an unexpected internal failure and warns instead of throwing', () => {
    const warns: string[] = [];
    const svc = Object.create(
      PaymentRunnerService.prototype,
    ) as unknown as RunnerProbe;
    svc.logger = {
      // Anything inside the try can fail; the logger itself is the cheapest
      // stand-in for "something in there threw".
      log: () => {
        throw new Error('boom');
      },
      warn: (m: string) => void warns.push(m),
    };

    expect(() =>
      svc._logNoCandidate(HOOK, SLIP, CFG, profileWith([])),
    ).not.toThrow();
    expect(warns.join('\n')).toMatch(/diagnostic failed/i);
  });

  /* ══════════════════════════════════════════════════════════════════════════
   * [FEAT-20260815-MATCHDIAG] the SAME facts, stored for the audit PAGE.
   * ══════════════════════════════════════════════════════════════════════════
   * The console log above is invisible to an operator on the handoff screen,
   * which reads the database — where step 2 carried only a short `reason`.
   * Owner, looking at that screen: "ทำไมมันมีแต่การ์ดกับ reason โง่ๆ".
   * These pin that every question asked by name is answerable FROM THE ROW:
   *   `data.profile.transaction` · `fail` · `info.trade_no` · `refid`
   * — and that a missing value reads as missing rather than being omitted. */
  describe('_buildMatchDiag — the stored diagnosis', () => {
    const build = (
      profile: unknown,
      cfg: unknown = CFG,
      slip: unknown = SLIP,
    ) => {
      const svc = Object.create(PaymentRunnerService.prototype) as unknown as {
        _buildMatchDiag: (
          s: unknown,
          c: unknown,
          p: unknown,
        ) => Record<string, unknown>;
      };
      return svc._buildMatchDiag(slip, cfg, profile);
    };

    it('states OUR rule — every configured value, by its own name', () => {
      const rule = build(profileWith([]))['rule'] as Record<string, string>;

      expect(rule['tx_path']).toBe('data.profile.transaction');
      expect(rule['provider_code']).toBe('walletpay');
      expect(rule['status']).toBe('fail');
      expect(rule['ref_id_field']).toBe('info.trade_no');
      expect(rule['ref_query_param']).toBe('refid');
      expect(rule['amount_match']).toMatch(/exact/i);
    });

    it('reports how each condition narrowed the list', () => {
      const diag = build(
        profileWith([
          { provider_code: 'walletpay', status: 'fail', amount: 300 },
          {
            provider_code: 'walletpay',
            status: 'waiting-deposit',
            amount: 500,
          },
          { provider_code: 'other', status: 'fail', amount: 500 },
        ]),
      );

      expect(diag['narrowing']).toEqual({
        rows_total: 3,
        after_provider: 2,
        after_status: 1,
        after_amount: 0,
      });
    });

    /* THE `info.trade_no` QUESTION — found / EMPTY / ABSENT, never omitted. */
    it('reports the ref id state of every row it shows', () => {
      const diag = build(
        profileWith([
          {
            provider_code: 'walletpay',
            status: 'fail',
            amount: 1,
            info: { trade_no: 'TN-9' },
          },
          {
            provider_code: 'walletpay',
            status: 'fail',
            amount: 2,
            info: { trade_no: '' },
          },
          { provider_code: 'walletpay', status: 'fail', amount: 3 },
        ]),
      );

      const refs = (diag['passed_rows'] as Array<{ ref_id: string }>).map(
        (r) => r.ref_id,
      );
      expect(refs).toEqual(['TN-9', 'EMPTY', 'ABSENT']);
    });

    /* Owner-requested: the diagnosis is incomplete without the bindings, because
       the same statement data yields a different verdict depending on which tool
       supplied `cfg`. "walletpay off" and "walletpay on, nothing matched" produced
       identical-looking rows before this. */
    it('records all three tool bindings with their on/off switches', () => {
      const svc = Object.create(PaymentRunnerService.prototype) as unknown as {
        _buildMatchDiag: (
          s: unknown,
          c: unknown,
          p: unknown,
          h?: unknown,
        ) => Record<string, unknown>;
      };

      const tools = svc._buildMatchDiag(SLIP, CFG, profileWith([]), {
        alias: 'omnideskdevoa',
        custom_tool_id: 'TOOL-C',
        custom_tool_status: true,
        payment_tool_id: 'TOOL-P',
        payment_tool_status: true,
        walletpay_tool_id: 'TOOL-B',
        walletpay_tool_status: true,
      })['tools'] as Record<string, unknown>;

      expect(tools['custom_tool_id']).toBe('TOOL-C');
      expect(tools['payment_tool_id']).toBe('TOOL-P');
      expect(tools['walletpay_tool_id']).toBe('TOOL-B');
      expect(tools['walletpay_tool_status']).toBe(true);
      expect(String(tools['walletpay_uses'])).toMatch(/separate/i);
    });

    it('shows an unbound tool as "-" and the leg falling back to the payment tool', () => {
      const svc = Object.create(PaymentRunnerService.prototype) as unknown as {
        _buildMatchDiag: (
          s: unknown,
          c: unknown,
          p: unknown,
          h?: unknown,
        ) => Record<string, unknown>;
      };

      const tools = svc._buildMatchDiag(SLIP, CFG, profileWith([]), {
        payment_tool_id: 'TOOL-P',
        payment_tool_status: true,
        // walletpay bound but switched OFF — must not read as "separate tool"
        walletpay_tool_id: 'TOOL-B',
        walletpay_tool_status: false,
      })['tools'] as Record<string, unknown>;

      expect(tools['custom_tool_id']).toBe('-');
      expect(tools['walletpay_tool_status']).toBe(false);
      expect(String(tools['walletpay_uses'])).toMatch(/payment tool/i);
    });

    it('marks a missing tx path distinctly from an empty list', () => {
      expect(build({ data: {} })['path_state']).toBe('PATH_NOT_FOUND');
      expect(build(profileWith([]))['path_state']).toBe('PATH_OK');
    });

    /* When nothing passed provider+status, `passed_rows` is empty and explains
       nothing — the rows that WERE there must still be visible. */
    it('shows what the rows carried when none passed the filters', () => {
      const diag = build(
        profileWith([
          { provider_code: 'wallet', status: 'success', amount: 500 },
        ]),
      );

      expect(diag['passed_rows']).toEqual([]);
      expect(diag['rows_seen']).toEqual([
        {
          provider_code: 'wallet',
          status: 'success',
          amount: '500',
          ref_id: 'ABSENT',
        },
      ]);
    });

    /* A one-line answer an operator can read without decoding the numbers. */
    it.each([
      [{ data: {} }, /path/i],
      [profileWith([]), /empty/i],
      [
        profileWith([{ provider_code: 'wallet', status: 'fail', amount: 1 }]),
        /provider/i,
      ],
      [
        profileWith([
          { provider_code: 'walletpay', status: 'waiting-deposit', amount: 1 },
        ]),
        /status/i,
      ],
      [
        profileWith([
          { provider_code: 'walletpay', status: 'fail', amount: 1 },
        ]),
        /amount/i,
      ],
    ])('summarises case %# in one sentence', (profile, re) => {
      expect(String(build(profile)['summary'])).toMatch(re);
    });

    it('caps the row detail and flags that it truncated', () => {
      const rows = Array.from({ length: 14 }, (_, i) => ({
        provider_code: 'walletpay',
        status: 'fail',
        amount: i,
      }));

      const diag = build(profileWith(rows));

      expect((diag['passed_rows'] as unknown[]).length).toBeLessThanOrEqual(10);
      expect(diag['truncated']).toBe(true);
    });

    /* THE SAFETY PROPERTY — it runs on a money path. */
    it('never throws on a malformed profile', () => {
      for (const bad of [null, undefined, 42, 'nope', { data: null }]) {
        expect(() => build(bad)).not.toThrow();
      }
    });

    /* [FEAT-20260815-RAWPROFILEDIAG] the whole profile is stored — and it is the
       one field whose size and shape we do not control, so every way it can go
       wrong must degrade to a marker rather than an exception or a silent drop.
       "Absent" would read as "the profile was empty", a different diagnosis. */
    describe('raw_profile snapshot', () => {
      it('stores the profile so an unexpected SHAPE is still inspectable', () => {
        const diag = build(
          profileWith([{ provider_code: 'walletpay', status: 'x', amount: 1 }]),
        );

        expect(diag['raw_profile']).toBeDefined();
        expect(JSON.stringify(diag['raw_profile'])).toContain('transaction');
      });

      it('masks credentials with the shared helper', () => {
        const diag = build({
          data: {
            profile: { transaction: { statement: [] } },
            access_token: 'super-secret-value-1234567890',
            web_code: 'demo-web-code-abcdefg',
          },
        });

        const dump = JSON.stringify(diag['raw_profile']);
        expect(dump).not.toContain('super-secret-value-1234567890');
        expect(dump).not.toContain('demo-web-code-abcdefg');
        expect(dump).toContain('•'); // the masker's fill character
      });

      it('replaces an oversized profile with a marker, never a partial object', () => {
        const huge = {
          data: {
            profile: { transaction: { statement: [] } },
            blob: 'x'.repeat(300_000),
          },
        };

        const rp = build(huge)['raw_profile'] as Record<string, unknown>;
        expect(String(rp['note'])).toMatch(/too large/i);
        expect(rp['approx_chars']).toBeGreaterThan(262_144);
        // the payload itself must NOT be there
        expect(JSON.stringify(rp)).not.toContain('xxxxxxxxxx');
      });

      it('reports an unserialisable profile instead of throwing', () => {
        const cyclic: Record<string, unknown> = {
          data: { profile: { transaction: { statement: [] } } },
        };
        cyclic['self'] = cyclic;

        let diag: Record<string, unknown> | undefined;
        expect(() => {
          diag = build(cyclic);
        }).not.toThrow();
        const rp = diag!['raw_profile'] as Record<string, unknown>;
        expect(String(rp['note'])).toMatch(/could not be serialised/i);
      });

      it('says so when there was no profile at all', () => {
        const rp = build(null)['raw_profile'] as Record<string, unknown>;

        expect(String(rp['note'])).toMatch(/no profile/i);
      });

      /* The field must never simply vanish — see the note above. */
      it.each([null, undefined, 42, 'nope', { data: null }])(
        'always emits raw_profile for input %p',
        (bad) => {
          expect(build(bad)['raw_profile']).toBeDefined();
        },
      );
    });
  });

  /* An empty `statement_status` means "do not filter on status" in
     `_matchStatements`; the log must not claim a status was required. */
  it('says status is unfiltered when the config leaves it blank', () => {
    const { svc, all } = makeRunner();

    svc._logNoCandidate(
      HOOK,
      SLIP,
      { ...(CFG as object), statement_status: '' },
      profileWith([
        { provider_code: 'walletpay', status: 'anything', amount: 1 },
      ]),
    );

    expect(all()).toMatch(/any/i);
  });
});
