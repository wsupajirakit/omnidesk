/**
 * [FEAT-20260823-NOTICECHECKFLAGS] + [FEAT-20260823-MIXEDDEPVIEW]
 * THE BEFORE/AFTER PROOF — asserted against a fixture captured from the code
 * AS IT WAS before either change (commit e246a32, tag
 * ckpt-before-noticeflags-23082026, file notice-before-20260823.json).
 *
 * Two very different claims, each pinned the hard way:
 *
 *  1. THE FLAGS CHANGE NOTHING WHEN ABSENT. Every one of the 1,538 captured
 *     decisions (all 1,536 context combinations + the two suppressor rows) is
 *     replayed with the four flags absent and must come back byte-identical —
 *     same cases, same ORDER (the owner's "ลำดับการเช็คห้ามเปลี่ยน" is asserted
 *     by comparing the ordered arrays, not sets).
 *
 *  2. THE MIXED-ACCOUNT CHANGE FLIPS EXACTLY THE PREDICTED CELLS AND NO OTHERS.
 *     The owner ordered ONE logic change ("deposit-withdraw ถ้าเป็นขาบัญชีฝาก
 *     จะดูแค่ is_view" · "ถอนเหมือนเดิมไม่แก้อะไร"). The 12-cell table captured
 *     before the change is replayed; the deposit verdict must differ exactly
 *     where `is_view` and `status==='enable'` disagree, and the withdraw
 *     verdict must equal the fixture in every cell.
 *
 * If either file is edited, this spec is the tripwire. Delete it only with the
 * fixture, and only when the flags themselves are being removed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildNoticeContext,
  decideNoticeAll,
  noticeSiteRuleCheck,
  type NoticeContext,
} from '@/modules/webhook';
import {
  diffNoticeChanges,
  parseNoticeFields,
  readNoticeCheckFlag,
} from '@/modules/hooks';

interface DecideRow {
  ctx: NoticeContext;
  out: string[];
}
interface MixedRow {
  is_view: boolean | 'ABSENT';
  status: string;
  verdict: { deposit_off: boolean; withdraw_off: boolean };
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), 'z-test/fixtures/notice-before-20260823.json'),
    'utf8',
  ),
) as { decide: DecideRow[]; mixed: MixedRow[] };

describe('⭐⭐ parity — flags absent = the captured world, all 1,538 rows', () => {
  it('has the full capture (1,536 combinations + 2 suppressor rows)', () => {
    expect(fixture.decide.length).toBe(1538);
  });

  it('⭐ every captured decision replays byte-identical, ORDER included', () => {
    const diffs: string[] = [];
    for (const row of fixture.decide) {
      /* the fixture ctx predates the flag fields — spreading it builds a ctx
         with all four ABSENT, which is the legacy-row shape in prod */
      const out = decideNoticeAll({ ...row.ctx }).map((d) => d.caseId);
      if (JSON.stringify(out) !== JSON.stringify(row.out)) {
        diffs.push(
          `${JSON.stringify(row.ctx)} → ${row.out.join()} now ${out.join()}`,
        );
      }
    }
    expect(diffs).toEqual([]);
  });

  it('⭐ explicit true on all four flags is ALSO byte-identical', () => {
    /* true must mean the same as absent — only false may change anything */
    const diffs: string[] = [];
    for (const row of fixture.decide) {
      const out = decideNoticeAll({
        ...row.ctx,
        depositTimeCheckOn: true,
        depositSiteStatusCheckOn: true,
        withdrawTimeCheckOn: true,
        withdrawSiteStatusCheckOn: true,
      }).map((d) => d.caseId);
      if (JSON.stringify(out) !== JSON.stringify(row.out))
        diffs.push(row.out.join());
    }
    expect(diffs).toEqual([]);
  });
});

describe('⭐ each flag silences EXACTLY its own cases across all 1,538 rows', () => {
  const silences = (flag: keyof NoticeContext, owned: string[]): void => {
    const diffs: string[] = [];
    for (const row of fixture.decide) {
      const out = decideNoticeAll({ ...row.ctx, [flag]: false }).map(
        (d) => d.caseId,
      );
      const expected = row.out.filter((c) => !owned.includes(c));
      if (JSON.stringify(out) !== JSON.stringify(expected)) {
        diffs.push(
          `${row.out.join()} → ${out.join()}, expected ${expected.join()}`,
        );
      }
    }
    expect(diffs).toEqual([]);
  };

  it('⭐ deposit time flag off ⇒ only A and E vanish; order of the rest holds', () => {
    silences('depositTimeCheckOn', ['A', 'E']);
  });
  it('⭐ deposit sitestatus flag off ⇒ only B and F vanish', () => {
    silences('depositSiteStatusCheckOn', ['B', 'F']);
  });
  it('⭐ withdraw time flag off ⇒ only C vanishes', () => {
    silences('withdrawTimeCheckOn', ['C']);
  });
  it('⭐ withdraw sitestatus flag off ⇒ only D vanishes', () => {
    silences('withdrawSiteStatusCheckOn', ['D']);
  });
});

describe('⭐⭐ ALL 16 flag combinations × all 1,538 contexts — every setting shape', () => {
  /* the owner's question, answered exhaustively: for EVERY way the four flags
     can be set (2⁴ = 16), every captured decision must equal the capture minus
     exactly the union of the silenced cases — 24,608 assertions in one pass. */
  const OWNED: Record<string, string[]> = {
    depositTimeCheckOn: ['A', 'E'],
    depositSiteStatusCheckOn: ['B', 'F'],
    withdrawTimeCheckOn: ['C'],
    withdrawSiteStatusCheckOn: ['D'],
  };
  const FLAGS = Object.keys(OWNED);

  it('⭐ every combination removes exactly the union of its owned cases', () => {
    const diffs: string[] = [];
    for (let mask = 0; mask < 16; mask++) {
      const offs = FLAGS.filter((_, i) => (mask >> i) & 1);
      const removed = new Set(offs.flatMap((f) => OWNED[f]!));
      const patch: Record<string, boolean> = {};
      for (const f of offs) patch[f] = false;
      for (const row of fixture.decide) {
        const out = decideNoticeAll({ ...row.ctx, ...patch }).map(
          (d) => d.caseId,
        );
        const expected = row.out.filter((c) => !removed.has(c));
        if (JSON.stringify(out) !== JSON.stringify(expected)) {
          diffs.push(
            `mask=${mask} ${row.out.join()}→${out.join()}≠${expected.join()}`,
          );
          if (diffs.length > 5) break;
        }
      }
    }
    expect(diffs).toEqual([]);
  });
});

describe('⭐ the write layer accepts the flags with the same strictness as the toggles', () => {
  it('a real boolean passes; the STRING "false" is refused, as everywhere else', () => {
    expect(
      parseNoticeFields({ notice_deposit_time_check: false })[
        'notice_deposit_time_check'
      ],
    ).toBe(false);
    expect(() =>
      parseNoticeFields({ notice_withdraw_sitestatus_check: 'false' }),
    ).toThrow(/must be a boolean/);
  });

  it('⭐ the audit diff reads the FROM through the absent=ON rule — no false→true lie', () => {
    /* a legacy row has no column; effective state is ON. Writing true must
       therefore diff as true→true (no change), never false→true. */
    const changes = diffNoticeChanges(
      { notice_deposit_time_check: true },
      {}, // legacy row
    );
    const row = changes.find(
      (c: { field: string; from: unknown }) =>
        c.field === 'notice_deposit_time_check',
    );
    expect(row ? row.from : true).toBe(true);
  });
});

describe('⭐ the two scenarios the owner walked (pinned verbatim)', () => {
  const base: NoticeContext = {
    eventKind: 'text',
    hookStatusOff: false,
    assisted: false,
    depositOn: true,
    withdrawOn: true,
    depositScope: 'text',
    depositWord: false,
    withdrawWord: true, // "ถอน" — withdraw-only word
    qrFound: false,
    inWindow: true,
    /* [FEAT-20260829-STATUSFIRST] the ctx gained two fields; `false` = the switch
     is off, which is the default and what every pre-existing row means. */
    depositSiteStatusFirst: false,
    withdrawSiteStatusFirst: false,
    depositOff: false,
    withdrawOff: true, // site rules: withdraw closed
  };
  const ids = (ctx: NoticeContext): string[] =>
    decideNoticeAll(ctx).map((d) => d.caseId);

  it('S-A: in the window · sitestatus off ⇒ the OFF-TIME card still fires (C)', () => {
    expect(ids({ ...base, withdrawSiteStatusCheckOn: false })).toEqual(['C']);
  });
  it('S-A: in the window · time off ⇒ C gone, D fires only because rules say closed', () => {
    expect(ids({ ...base, withdrawTimeCheckOn: false })).toEqual(['D']);
  });
  it('S-A: both off ⇒ silent — the guard returns nothing and the flow reaches AI', () => {
    expect(
      ids({
        ...base,
        withdrawTimeCheckOn: false,
        withdrawSiteStatusCheckOn: false,
      }),
    ).toEqual([]);
  });
  it('S-B: 14:00 (out of window) · sitestatus off ⇒ silent even though rules say closed', () => {
    expect(
      ids({ ...base, inWindow: false, withdrawSiteStatusCheckOn: false }),
    ).toEqual([]);
  });
});

describe('⭐ mixed-account change — exactly the predicted cells flip, nothing else', () => {
  const replay = (
    row: MixedRow,
  ): { deposit_off: boolean; withdraw_off: boolean } => {
    const card: Record<string, unknown> = { account_type: 'deposit-withdraw' };
    if (row.is_view !== 'ABSENT') card['is_view'] = row.is_view;
    if (row.status !== 'ABSENT') card['status'] = row.status;
    return noticeSiteRuleCheck({
      data: { shop: { bank_account: { accounts: [card] } } },
    });
  };

  it('has all 12 cells', () => {
    expect(fixture.mixed.length).toBe(12);
  });

  it('⭐ withdraw verdict equals the BEFORE fixture in every cell — "ถอนเหมือนเดิมไม่แก้อะไร"', () => {
    for (const row of fixture.mixed) {
      expect(replay(row).withdraw_off).toBe(row.verdict.withdraw_off);
    }
  });

  it('⭐ deposit verdict flips exactly where is_view disagrees with status===enable', () => {
    for (const row of fixture.mixed) {
      const after = replay(row).deposit_off;
      if (row.is_view === 'ABSENT') {
        /* no is_view ⇒ the deposit leg now SKIPS the card ⇒ nothing countable
           ⇒ fail-open: never off */
        expect(after).toBe(false);
      } else {
        /* the new rule, stated independently of the code under test */
        expect(after).toBe(row.is_view !== true);
      }
    }
  });

  it('⭐ the PROD path agrees: a hook without the columns builds an all-ON context', () => {
    /* mutation M1 (reader polarity) must be caught HERE too, not only at the
       reader unit — this is the exact construction webhook.service drives. */
    const ctx = buildNoticeContext({
      eventKind: 'text',
      hook: { status: 1, notice_deposit_status: true }, // legacy row — no flag columns
      text: 'ฝาก',
      now: new Date('2026-08-23T17:30:00.000Z'), // 00:30 Bangkok — inside window
    });
    expect(ctx.depositTimeCheckOn).toBe(true);
    expect(ctx.depositSiteStatusCheckOn).toBe(true);
    expect(ctx.withdrawTimeCheckOn).toBe(true);
    expect(ctx.withdrawSiteStatusCheckOn).toBe(true);
    expect(decideNoticeAll(ctx).map((d) => d.caseId)).toEqual(['A']);
  });

  it('⭐ and an explicit false on the hook row switches its leg off through the same path', () => {
    const ctx = buildNoticeContext({
      eventKind: 'text',
      hook: {
        status: 1,
        notice_deposit_status: true,
        notice_deposit_time_check: false,
      },
      text: 'ฝาก',
      now: new Date('2026-08-23T17:30:00.000Z'),
    });
    expect(ctx.depositTimeCheckOn).toBe(false);
    expect(decideNoticeAll(ctx).map((d) => d.caseId)).toEqual([]);
  });

  it('the reader that guards all of this: absent/junk = ON, only false = OFF', () => {
    expect(readNoticeCheckFlag({}, 'notice_deposit_time_check')).toBe(true);
    expect(
      readNoticeCheckFlag(
        { notice_deposit_time_check: null },
        'notice_deposit_time_check',
      ),
    ).toBe(true);
    expect(
      readNoticeCheckFlag(
        { notice_deposit_time_check: 'false' },
        'notice_deposit_time_check',
      ),
    ).toBe(true);
    expect(
      readNoticeCheckFlag(
        { notice_deposit_time_check: true },
        'notice_deposit_time_check',
      ),
    ).toBe(true);
    expect(
      readNoticeCheckFlag(
        { notice_deposit_time_check: false },
        'notice_deposit_time_check',
      ),
    ).toBe(false);
  });
});
