/**
 * [FEAT-20260905-CUSTPROV] `shopapi_v1` — the ported mapping, proven equal to the
 * dashboard's rather than assumed equal.
 *
 * 🔗 CROSS-REPO, AND THE COMPARISON POINTS AT THE SCREEN. The drift guard at the
 * bottom reads `omnidesk-console/components/member/PersonalPanel.tsx` — the file
 * the browser actually runs — and compares its expressions against this repo's,
 * text for text.
 *
 * ⚠️ IT USED TO POINT SOMEWHERE ELSE, AND THAT WAS THE BUG. Until 05/09 the
 * dashboard carried an extracted `profile/shopapiFields.ts` and this guard compared
 * against THAT. Three copies of one mapping, and the middle one rendered no
 * pixel: nothing imported it but its own test. The owner called it debt, and it
 * was — so the file is gone and the comparison now runs between the two copies
 * that are real. ตัวกลางที่ไม่มีใครใช้ = หนี้ ลบทิ้ง เทียบของจริงสองฝั่งพอ
 *
 * ## Why the vectors are duplicated instead of imported
 * The two repos have no shared package and no build-time link, so a literal
 * import is not available. What IS available — this repo's established answer,
 * used by `noticeCardGate.value.test.ts` — is a spec that READS the other side's
 * source and fails when the two diverge. Copying vectors without that guard would
 * be two lists free to drift; with it, a change on either side turns something
 * red.
 *
 * ## 🔴 These assert the CURRENT behaviour, including the parts that look odd
 * The mapping came from two live API runs (2026-07-31, 2026-08-01, hook
 * `demo-oa-three`) after real cards rendered "-" against real data, and it had no test
 * coverage at all until 05/09. Anything "corrected" here is a card that stops
 * rendering in production.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  composeFields,
  DEFAULT_CUSTOMER_PROVIDER,
} from '@/modules/customer-provider';

/* Through `composeFields`, the same entry point the service uses — a spec that
   assembled the halves itself could prove an order the runtime never performs. */
const fields = (blob: unknown) =>
  composeFields(DEFAULT_CUSTOMER_PROVIDER, blob);

/** The demo/mock upstream: sections sit BESIDE `profile`, old field names. */
const MOCK = {
  data: {
    profile: { name: 'mock user' },
    finance: {
      credit_balance: 100,
      wallet_pending: 20,
      deposit_total: 900,
      withdraw_total: 400,
      auto_deposit: 'enabled',
      auto_withdraw: 'disabled',
      recent_deposits: [{ amount: 50, at: '2026-08-01T00:00:00Z' }],
      recent_withdrawals: [{ amount: 10, at: '2026-08-02T00:00:00Z' }],
    },
    bonus: {
      cashback: { pending: 5, claimed_total: 50, history: [{ amount: 5 }] },
      referral: {
        pending: 1,
        claimed_total: 10,
        history: [{ amount: 1 }],
        friends_count: 7,
      },
    },
    activity: {
      coins: { balance: 30, history: [{ amount: 3 }] },
      point_round: { history: [{ n: 1 }] },
    },
    promotion: {
      current: 'PROMO A',
      activity_volume: { done: 10, required: 20 },
      outstanding: 3,
      top_products: [
        { name: 'g1', at: 2 },
        { name: 'g2', at: 9 },
      ],
    },
  },
};

/** The real Shop-API: sections NESTED inside `profile`, new field names. */
const REAL = {
  data: {
    profile: {
      name: 'real user',
      finance: {
        balances: [
          { asset_code: 'credit', amount: 50085.46 },
          { asset_code: 'cash', amount: 12 },
          { asset_code: 'coin', amount: 77 },
        ],
        total_deposit: 8000,
        total_withdraw: 3000,
        is_auto_deposit: true,
        is_auto_withdraw: false,
        transactions: {
          deposit: [{ amount: 500, date: 1756684800000, status: 'success' }],
          withdraw: [{ amount: 200, date: 1756684800000, status: 'success' }],
        },
      },
      bonus: {
        pending_cashback: 9,
        claimed_cashback: 90,
        cashback_history: [{ amount: 9 }, { amount: 8 }],
        pending_referral_bonus: 2,
        claimed_referral_bonus: 20,
        referral_history: [{ amount: 2 }, { amount: 3 }, { amount: 4 }],
      },
      activity: {
        coin_received: [{ amount: 5, date: 100 }],
        coin_spent: [{ amount: 2, date: 900 }],
        point_round_history: [{ n: 2 }],
      },
      promotion: {
        current_promotion_info: { name: 'PROMO REAL' },
        activity_volume_done: { total: 111, fashion: 60, home_living: 51 },
        activity_volume_required: {
          total: 222,
          fashion: 120,
          outdoor_activity: 40,
        },
        outstanding: { total: 33 },
        recent_products: [
          { name: 'r1', played_at: 5 },
          { name: 'r2', played_at: 50 },
        ],
      },
    },
  },
};

describe('[CUSTPROV/FIELDS] the mock keeps its exact previous values', () => {
  const f = fields(MOCK);

  it('finance', () => {
    expect(f.finCredit).toBe(100);
    expect(f.finWallet).toBe(20);
    expect(f.finDepTotal).toBe(900);
    expect(f.finWdTotal).toBe(400);
    expect(f.finAutoDep).toBe(true); // 'enabled'
    expect(f.finAutoWd).toBe(false); // 'disabled'
    expect(f.depRows).toHaveLength(1);
    expect(f.wdRows).toHaveLength(1);
  });

  it('bonus, activity, promotion', () => {
    expect(f.cbPending).toBe(5);
    expect(f.rfFriends).toBe(7);
    expect(f.acCoinBal).toBe(30);
    expect(f.promoName).toBe('PROMO A'); // a bare string, not an object
    expect(f.promoOutstanding).toBe(3); // a scalar, not {total}
  });
});

describe('[CUSTPROV/FIELDS] the real upstream resolves through the new names', () => {
  const f = fields(REAL);

  it('⭐ credit comes out of balances[] by asset_code', () => {
    // The exact defect this mapping exists for: 50,085.46 in the payload and
    // "-" on the screen, hook `demo-oa-three`, 2026-08-01.
    expect(f.finCredit).toBe(50085.46);
    expect(f.finWallet).toBe(12);
    expect(f.acCoinBal).toBe(77);
  });

  it('⭐ is_auto_deposit is a BOOLEAN, not the string "enabled"', () => {
    expect(f.finAutoDep).toBe(true);
    expect(f.finAutoWd).toBe(false);
  });

  it('⭐ coin history merges received + spent, newest first, each tagged', () => {
    expect(f.acCoinHistory).toEqual([
      { amount: 2, date: 900, type: 'spend' },
      { amount: 5, date: 100, type: 'earn' },
    ]);
  });

  it('friends_count falls back to the referral row COUNT, not to 0', () => {
    expect(f.rfFriends).toBe(3);
  });

  it('promotion: object current, {total} outstanding, key-union breakdown', () => {
    expect(f.promoName).toBe('PROMO REAL');
    expect(f.promoOutstanding).toBe(33);
    expect(f.promoToDone).toBe(111);
    expect(f.promoToBreakdown).toEqual([
      { key: 'fashion', done: 60, required: 120 },
      { key: 'home_living', done: 51, required: undefined },
      { key: 'outdoor_activity', done: undefined, required: 40 },
    ]);
  });

  it('⭐ outstanding splits per product the same way — the value the port MISSED', () => {
    /* [FIX-20260905-OSBREAKDOWN] Rendered at `PersonalPanel.tsx:2491-2503`, where
       the panel picks between these rows and a one-line summary. It was written
       down as ported and was not; the census found it. Same key set as the
       activity volume breakdown, `total` dropped because it has its own row above. */
    const withProducts = fields({
      data: {
        profile: {
          promotion: {
            outstanding: { total: 33, fashion: 20, home_living: 13 },
          },
        },
      },
    });
    expect(withProducts.promoOsBreakdown).toEqual([
      { key: 'fashion', amount: 20 },
      { key: 'home_living', amount: 13 },
    ]);
    // The one-line summary still reads the total, unchanged.
    expect(withProducts.promoOutstanding).toBe(33);
  });

  it('⭐ the totals resolve through the SECOND spelling — the real vendor key', () => {
    /* Found by a surviving mutation: dropping `finance.total_deposit` from the
       chain changed nothing, because no case ever read these two on the real
       shape. Every chain's second path needs a vector or it is unprotected. */
    expect(f.finDepTotal).toBe(8000);
    expect(f.finWdTotal).toBe(3000);
  });

  it('a SCALAR outstanding produces no rows — the mock screen is untouched', () => {
    // `promoOsBreakdown.length > 0` is the panel's switch: an empty list is what
    // keeps the demo on its single summary row.
    expect(fields(MOCK).promoOsBreakdown).toEqual([]);
  });

  it('recent_products sorted newest first', () => {
    expect(f.promoProducts.map((g: { name: string }) => g.name)).toEqual([
      'r2',
      'r1',
    ]);
  });
});

describe('[CUSTPROV/FIELDS] the edges that a rewrite would smooth over', () => {
  it('⭐ when BOTH shapes are present, the OLD key wins', () => {
    // The `??` order is what let real-shape support ship without touching a
    // single demo or tool.
    const f = fields({
      data: {
        profile: {},
        finance: {
          credit_balance: 1,
          balances: [{ asset_code: 'credit', amount: 999 }],
          deposit_total: 2,
          total_deposit: 888,
        },
      },
    });
    expect(f.finCredit).toBe(1);
    expect(f.finDepTotal).toBe(2);
  });

  it('⭐ auto_deposit uses `!== undefined`, NOT `??`', () => {
    // A `??` would let `is_auto_deposit: true` beat an explicit 'disabled',
    // flipping a badge on a customer whose deposits are switched off.
    const f = fields({
      data: {
        profile: {},
        finance: { auto_deposit: 'disabled', is_auto_deposit: true },
      },
    });
    expect(f.finAutoDep).toBe(false);
  });

  it('null / empty blob ⇒ empty collections, never a throw', () => {
    for (const blob of [null, undefined, {}, { data: {} }]) {
      const f = fields(blob);
      expect(f.depRows).toEqual([]);
      expect(f.cbHistory).toEqual([]);
      expect(f.finAutoDep).toBe(false);
      expect(f.promoToBreakdown).toEqual([]);
    }
  });
});

/**
 * ⭐⭐ THE BACKTEST — the port is a MOVE, and this is the measurement that says so.
 *
 * ## What it compares, and why THAT
 * `PersonalPanel.tsx` still maps the blob inline; this repo now does the same
 * work as paths plus nine algorithms. The claim being made is narrow and
 * checkable: *the nine algorithms were copied, not rewritten*. So it reads both
 * sources and diffs the right-hand sides.
 *
 * 🔴 WITHOUT THIS, "ported verbatim" IS SOMETHING I TYPED, NOT SOMETHING ANYONE
 * MEASURED. The mapping had no coverage for five weeks while carrying knowledge
 * that only existed in it. It stays until the panel reads the server's answer and
 * its inline block is deleted — at which point this describe deletes with it.
 *
 * ⚠️ The `path` half is NOT compared textually and cannot be: it stopped being an
 * expression and became a table. It is proven instead by the vectors above, which
 * run the SAME two blobs the panel's code was built against and assert the same
 * 26 values. Text for the algorithms, behaviour for the paths.
 */
describe('[CUSTPROV/FIELDS] backtest — the algorithms match the panel, expression for expression', () => {
  /**
   * The dashboard checkout that matches THIS one.
   *
   * ⚠️ Written after the first version silently skipped: it hardcoded
   * `../omnidesk-console`, but this suite also runs from a worktree
   * (`omnidesk-api-custprov`), whose sibling is `omnidesk-console-custprov` — so
   * the guard reported SKIPPED and compared nothing while looking green. The lane
   * suffix is derived from the current directory, plain checkout as a fallback.
   * หา path ไม่เจอแล้วข้าม = เขียวโดยไม่ได้ตรวจ
   */
  const PANEL =
    [
      join(
        process.cwd(),
        '..',
        basename(process.cwd()).replace('omnidesk-api', 'omnidesk-console'),
      ),
      join(process.cwd(), '..', 'omnidesk-console'),
    ]
      .map((d) => join(d, 'components/member/PersonalPanel.tsx'))
      .find((f) => existsSync(f)) ?? '';

  const OURS = join(
    process.cwd(),
    'src/modules/customer-provider/providers/shopapi-v1/derive-fields.ts',
  );

  /**
   * Whitespace out, then the two purely-syntactic differences prettier
   * introduces. Both were MEASURED before being written here, not guessed:
   * 3 of the 9 differed by a trailing comma alone, and the two helpers differ by
   * an explicit return type this repo's lint requires and a `.tsx` component does
   * not.
   *
   * 🔴 A normaliser can hide a real difference, so the case below feeds it two
   * genuinely different expressions and asserts they STAY different. A harness
   * that cannot fail proves nothing. ตัวปรับรูปต้องพิสูจน์ว่ายังจับของต่างได้
   */
  const normalise = (s: string): string =>
    s
      .replace(/\s+/g, '')
      .replace(/,(?=[)\]}])/g, '') // prettier's trailing commas
      .replace(/\):[A-Za-z[\]]+=>/g, ')=>'); // an explicit arrow return type

  /**
   * `const NAME = <rhs>;` → the rhs with ALL whitespace removed.
   *
   * ⚠️ REMOVED, not collapsed. The panel writes these one per line; this repo is
   * prettier-formatted across several. An earlier version of this harness
   * collapsed instead, and 17 of 22 names came out "missing" — caught only by the
   * FOUND-on-both-sides case below.
   * ⚠️ `\s*` before the optional type annotation is load-bearing too: without it
   * every name declared WITHOUT one went missing, because the type group requires
   * a leading `:`. Same failure, same catch.
   */
  const rhsMap = (src: string, names: string[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const n of names) {
      const m = new RegExp(
        `const ${n}\\s*(?::[^=]+)?=\\s*([\\s\\S]*?);\\n`,
        'm',
      ).exec(src);
      if (m?.[1]) out[n] = normalise(m[1]);
    }
    return out;
  };

  /** The nine that are code on both sides, plus the two shared time helpers. */
  const MOVED = [
    'finAutoDep',
    'finAutoWd',
    'rfFriends',
    'acCoinHistory',
    'promoName',
    'promoOutstanding',
    'promoProducts',
    'promoToBreakdown',
    'promoOsBreakdown',
  ];
  const HELPERS = ['xpTs', 'xpProductTs'];

  const skip = (): boolean => {
    if (PANEL) return false;
    // Not a silent pass: name the check that did not run, and why.
    expect('SKIPPED — dashboard checkout not found beside this one').toContain(
      'SKIPPED',
    );
    return true;
  };

  it('⭐ the normaliser still tells genuinely different expressions apart', () => {
    expect(normalise('a ?? b')).not.toBe(normalise('a || b'));
    /* Added after a mutation that widened the normaliser to strip `?.` survived
       every test: optional chaining is the difference between a missing section
       reading as empty and throwing, so collapsing it would hide a real change. */
    expect(normalise('a?.b')).not.toBe(normalise('a.b'));
    expect(normalise('a === b')).not.toBe(normalise('a == b'));
    expect(normalise('[...a]')).not.toBe(normalise('a'));
    expect(normalise('x !== undefined')).not.toBe(normalise('x != undefined'));
    // …while the two differences it exists for do collapse.
    expect(normalise('[a, b,]')).toBe(normalise('[a, b]'));
    expect(normalise('(h: any): number => 1')).toBe(normalise('(h: any) => 1'));
  });

  it('⭐ every compared expression was FOUND on both sides', () => {
    if (skip()) return;
    const panel = rhsMap(readFileSync(PANEL, 'utf8'), MOVED);
    const ours = rhsMap(readFileSync(OURS, 'utf8'), MOVED);
    // A name that stopped matching would make the comparison vacuous — green
    // because it compared nothing.
    expect(Object.keys(panel).sort()).toEqual([...MOVED].sort());
    expect(Object.keys(ours).sort()).toEqual([...MOVED].sort());
  });

  /**
   * [FIX-20260906-REALFIELDS] The ONE expression that deliberately differs, and
   * the difference is recorded here rather than exempted.
   *
   * The panel reads `friends_count` (with an s). The live Shop-API sends
   * `friend_count` (without). Neither is wrong — they are two upstreams — but with
   * only the panel's spelling the chain fell through to the row count, so a
   * customer whose payload says `friend_count: 1` beside a five-row
   * `referral_history` was shown **5**. On `dev` too, since the chain was
   * transcribed faithfully.
   *
   * 🔴 THIS IS NOT AN EXEMPTION. The case below still compares the WHOLE
   * expression; it just compares against the panel's text with exactly this
   * insertion applied. Any other edit — reordering the chain, replacing the
   * panel's spelling instead of appending after it, changing the fallback — makes
   * the two differ again and the case goes red. The vacuity guard underneath
   * asserts the replacement really applied, so a typo here cannot quietly turn
   * this into "compare the panel with itself".
   * บันทึกความต่างไว้ ไม่ใช่ยกเว้น
   */
  const DIVERGED: Record<string, { from: string; to: string }> = {
    rfFriends: {
      from: 'bonus?.referral?.friends_count ??',
      to: 'bonus?.referral?.friends_count ?? bonus?.friend_count ??',
    },
  };

  it.each(MOVED)('⭐ %s is identical to the panel', (name) => {
    if (skip()) return;
    const panel = rhsMap(readFileSync(PANEL, 'utf8'), [name]);
    const ours = rhsMap(readFileSync(OURS, 'utf8'), [name]);

    const d = DIVERGED[name];
    if (!d) {
      expect(ours[name]).toBe(panel[name]);
      return;
    }
    const expected = panel[name]!.replace(normalise(d.from), normalise(d.to));
    // vacuity: the recorded insertion must actually apply to the panel's text —
    // otherwise this case would compare the panel against itself and pass on
    // anything.
    expect(expected).not.toBe(panel[name]);
    expect(ours[name]).toBe(expected);
  });

  it.each(HELPERS)(
    '⭐ the shared helper %s is identical to the panel',
    (name) => {
      if (skip()) return;
      const engine = join(
        process.cwd(),
        'src/modules/customer-provider/providers/engine/time.ts',
      );
      const panel = rhsMap(readFileSync(PANEL, 'utf8'), [name]);
      const ours = rhsMap(readFileSync(engine, 'utf8'), [name]);
      expect(panel[name]).toBeDefined();
      expect(ours[name]).toBe(panel[name]);
    },
  );
});

/**
 * ⭐⭐ THE CENSUS — every blob value the panel reads is either served here or
 * excluded ON PURPOSE, with a reason.
 *
 * ## Why this exists
 * `promoOsBreakdown` was written down as ported and was not. It is rendered at
 * `PersonalPanel.tsx:2491-2503`, where the panel picks between per-product rows and
 * a one-line summary — so the day the panel reads the server's answer, those rows
 * would have vanished with nothing erroring and no test failing. A comment saying
 * "the fields are complete" is what let that through.
 *
 * This case is that comment, made falsifiable: it walks the panel's own mapping
 * block, and any name that is neither a field nor a listed exclusion fails.
 * ลิสต์ที่เขียนไว้เฉย ๆ จะเก่า · ลิสต์ที่เทสเดินนับ จะไม่เก่า
 */
describe('[CUSTPROV/FIELDS] census — nothing the panel derives is unaccounted for', () => {
  const PANEL =
    [
      join(
        process.cwd(),
        '..',
        basename(process.cwd()).replace('omnidesk-api', 'omnidesk-console'),
      ),
      join(process.cwd(), '..', 'omnidesk-console'),
    ]
      .map((d) => join(d, 'components/member/PersonalPanel.tsx'))
      .find((f) => existsSync(f)) ?? '';

  /** Intermediates and helpers — they hold no card value of their own. */
  const INTERNAL = [
    'xp',
    'profile',
    'promotion',
    'finance',
    'bonus',
    'activity',
    'xpBal',
    'xpProductTs',
    'isPendingRow',
  ];

  /**
   * 🔴 OUT ON PURPOSE. Each line is a decision, not an omission. Anything added
   * here needs a reason of the same kind — "not done yet" is not one, and the
   * fifth entry is exactly why.
   */
  const EXCLUDED: Record<string, string> = {
    acPointRound:
      'needs the site-rules spend_amount — a DIFFERENT payload. pointRounds.ts owns it.',
    acRounds: 'the value of acPointRound; same reason.',
    acctMasked:
      'part of the account-number group, whose result mixes the blob with our own line_user_data.',
    acctFull: 'reads ud.bank_account — our record, not the vendor blob.',
    acctDigits: 'derived from acctMasked; travels with the group.',
    acctCopy: 'the group result; cross-source.',
    xpUnmasked: 'a predicate used only by that group.',
  };

  it('⭐ every derived const is a field, an internal, or a stated exclusion', () => {
    if (!PANEL) {
      expect(
        'SKIPPED — dashboard checkout not found beside this one',
      ).toContain('SKIPPED');
      return;
    }
    const src = readFileSync(PANEL, 'utf8');
    // Unique anchors, asserted unique: a marker that appears twice would clip the
    // region silently, which has already happened once in this repo's FE work.
    const A = '[FEAT-20260801-SHOPAPIV1SHAPE] START';
    const B = '[FEAT-20260801-SHOPAPIV1FIELDS] END';
    expect(src.split(A)).toHaveLength(2);
    expect(src.split(B)).toHaveLength(2);

    const block = src.slice(src.indexOf(A), src.indexOf(B));
    const declared = [...block.matchAll(/^ {2}const ([A-Za-z0-9_]+)/gm)].map(
      (m) => m[1]!,
    );
    expect(declared.length).toBeGreaterThan(25); // the block was actually found

    const served = Object.keys(fields(REAL));
    const unaccounted = declared.filter(
      (n) => !served.includes(n) && !INTERNAL.includes(n) && !(n in EXCLUDED),
    );
    expect(unaccounted).toEqual([]);
  });

  it('⭐ the census can fail — an unknown name is not quietly tolerated', () => {
    // The same classification applied to a name nobody declared anywhere.
    const served = Object.keys(fields(REAL));
    const unaccounted = ['someNewCardValue'].filter(
      (n) => !served.includes(n) && !INTERNAL.includes(n) && !(n in EXCLUDED),
    );
    expect(unaccounted).toEqual(['someNewCardValue']);
  });
});

/**
 * ⭐⭐ THE POINT OF THE WHOLE SHAPE: a vendor that differs only in field names is
 * added by writing DATA.
 *
 * Owner's design, 05/09: *"เจ้าใหม่ที่ชื่อฟิลด์ต่างอย่างเดียว → แก้แค่ fieldPaths
 * ไม่เขียนโค้ด"*. This case is that sentence as a test — it builds a second
 * provider that reuses `shopapi_v1`'s algorithms untouched and replaces only the path
 * table, and asserts the values come out of the new locations.
 *
 * 🔴 If this ever needs a line of code added to make it pass, the split between
 * data and algorithm was drawn in the wrong place, and that is the signal to
 * re-cut it rather than to special-case the vendor.
 */
describe('[CUSTPROV/FIELDS] a data-only provider needs no code', () => {
  it('⭐ same algorithms, a different path table, different values', () => {
    const acme = {
      paths: {
        rootPaths: [''],
        sectionPaths: { profile: ['customer'], finance: ['customer.wallet'] },
        fieldPaths: {
          finCredit: { paths: ['finance.main_balance'] },
          finDepTotal: { paths: ['finance.lifetime_in'] },
          cbHistory: { paths: ['finance.nothing_here'], fallback: [] },
        },
      },
      deriveFields: DEFAULT_CUSTOMER_PROVIDER.deriveFields, // untouched
    };

    const out = composeFields(acme, {
      customer: {
        name: 'acme user',
        wallet: { main_balance: 42, lifetime_in: 7 },
      },
    }) as unknown as Record<string, unknown>;

    expect(out['finCredit']).toBe(42);
    expect(out['finDepTotal']).toBe(7);
    expect(out['cbHistory']).toEqual([]);
    // And the algorithms still ran, over a blob shaped nothing like shopapi_v1's.
    expect(out['finAutoDep']).toBe(false);
    expect(out['promoToBreakdown']).toEqual([]);
  });

  it('⭐ a table that omits a key an algorithm builds on DEGRADES, it does not throw', () => {
    /* Found by this suite, not by reasoning: `rfFriends` falls back to
       `rfHistory.length`, and the table above never declares `rfHistory`. The
       first version read it straight and died on `.length` — a vendor "added by
       editing data only" crashing on the data it edited. The empty answer is the
       right one: the vendor said nothing about referrals. */
    const acme = {
      paths: {
        rootPaths: [''],
        sectionPaths: { profile: ['customer'] },
        fieldPaths: { finCredit: { paths: ['profile.bal'] } },
      },
      deriveFields: DEFAULT_CUSTOMER_PROVIDER.deriveFields,
    };
    const out = composeFields(acme, {
      customer: { bal: 5 },
    }) as unknown as Record<string, unknown>;
    expect(out['finCredit']).toBe(5);
    expect(out['rfFriends']).toBe(0);
    expect(out['promoName']).toBeUndefined();
  });

  it('⭐ no profile in the blob ⇒ no values invented, even when a section is there', () => {
    // The root guard. A blob carrying `wallet` but no `customer` must not start
    // filling cards for a customer whose profile never loaded.
    const acme = {
      paths: {
        rootPaths: [''],
        sectionPaths: { profile: ['customer'], finance: ['wallet'] },
        fieldPaths: { finCredit: { paths: ['finance.main_balance'] } },
      },
      deriveFields: DEFAULT_CUSTOMER_PROVIDER.deriveFields,
    };
    const out = composeFields(acme, {
      wallet: { main_balance: 999 },
    }) as unknown as Record<string, unknown>;
    expect(out['finCredit']).toBeUndefined();
  });
});

/**
 * ⭐ The two things that must NEVER be folded into a provider, asserted rather
 * than left to a comment. Both were called out by the owner on 05/09.
 *
 * 1. THE POINT_ROUND. The round count needs the coin balance AND the site-rules
 *    `spend_amount`, which arrive on a DIFFERENT payload. A provider
 *    that produced a number here would be inventing one — and the rule it would
 *    be guessing at already has an owner (`activity/pointRounds.ts`), whose whole
 *    reason for existing is that the two numbers once contradicted each other on
 *    screen.
 * 2. SITE RULES (ข้อมูลเว็บ). A different route, a different payload, its own
 *    cache. a provider never sees it, and the site-rules answer never carries
 *    `fields` — proven in `customer-provider-stamp.spec.ts`.
 */
describe('[CUSTPROV/FIELDS] the point round and the site rules stay out', () => {
  it('⭐ no round count is produced, even when coins are present', () => {
    /* `as unknown as` because `CustomerFields` has NO index signature — the type
       system already refuses `acRounds`. This case pins the same fact at runtime,
       so removing the type would not quietly remove the rule. */
    const f = fields(REAL) as unknown as Record<string, unknown>;
    // The history is carried (it IS in the profile blob); the derived COUNT is
    // not, because the profile alone cannot answer it.
    expect(f['acPointRoundHistory']).toEqual([{ n: 2 }]);
    expect(f['acRounds']).toBeUndefined();
    expect(f['acPointRound']).toBeUndefined();
  });

  it('⭐ nothing site-rules-shaped leaks in', () => {
    const keys = Object.keys(fields(REAL));
    for (const forbidden of [
      'siteRules',
      'srShop',
      'spendAmount',
      'domain_name',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('a blob that happens to CONTAIN site rules is still ignored', () => {
    // Defensive: an upstream that one day nests its own `site_rules` inside the
    // profile must not start feeding the ข้อมูลเว็บ card from here — that card has
    // its own route, its own cache and its own refresh button.
    const f = fields({
      data: { profile: { site_rules: { spend_amount: 5 }, finance: {} } },
    }) as unknown as Record<string, unknown>;
    expect(f['siteRules']).toBeUndefined();
    expect(Object.keys(f)).not.toContain('site_rules');
  });
});
