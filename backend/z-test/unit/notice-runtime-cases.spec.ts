/* [FEAT-20260822-NOTICERUNTIME] R3 — the six cases, the order, the funnel
 * ===========================================================================
 * One file per case (owner: "ทุกเคสอิสระแยกหมด"), precedence as DATA in
 * cases/index.ts (owner D13: time-first today, must reswap easily). These
 * cases decide only — nothing here sends, stamps, or touches the webhook.
 */
import {
  NOTICE_CASE_ORDER,
  NOTICE_DEPOSIT_AT_KEY,
  NOTICE_WITHDRAW_AT_KEY,
  NOTICE_PAYMENT_AT_KEY,
  buildNoticeContext,
  decideNotice,
  decideNoticeAll,
  NOTICE_SLIP_SIDE,
  NOTICE_RESPECTS_HOOK_STATUS,
  NOTICE_RESPECTS_ASSIST,
  ABANDON_SKIPPED_REPLY_PREFIXES,
  abandonBotRowFilter,
  type NoticeContext,
} from '@/modules/webhook';

/** a context where nothing fires; cases override just what they need. */
const base: NoticeContext = {
  eventKind: 'text',
  hookStatusOff: false,
  assisted: false,
  depositOn: false,
  withdrawOn: false,
  depositScope: 'text',
  depositWord: false,
  withdrawWord: false,
  qrFound: false,
  inWindow: false,
  /* [FEAT-20260829-STATUSFIRST] the ctx gained two fields; `false` = the switch
     is off, which is the default and what every pre-existing row means. */
  depositSiteStatusFirst: false,
  withdrawSiteStatusFirst: false,
  depositOff: false,
  withdrawOff: false,
};
const ctx = (over: Partial<NoticeContext>): NoticeContext => ({
  ...base,
  ...over,
});

describe('⭐ each case fires on exactly its spec conditions', () => {
  it('⭐ A: text · deposit ON · deposit word · in window → deposit off-time card', () => {
    const d = decideNotice(
      ctx({ depositOn: true, depositWord: true, inWindow: true }),
    );
    expect(d).toEqual({
      caseId: 'A',
      cardField: 'notice_deposit_offtime_flex_id',
      stampKey: NOTICE_DEPOSIT_AT_KEY,
    });
  });

  it('⭐ B: text · deposit ON · deposit word · site deposit_off → deposit disable card', () => {
    const d = decideNotice(
      ctx({ depositOn: true, depositWord: true, depositOff: true }),
    );
    expect(d?.caseId).toBe('B');
    expect(d?.cardField).toBe('notice_deposit_flex_id');
    expect(d?.stampKey).toBe(NOTICE_DEPOSIT_AT_KEY);
  });

  it('⭐ C: text · withdraw ON · withdraw word · in window → withdraw off-time card', () => {
    const d = decideNotice(
      ctx({ withdrawOn: true, withdrawWord: true, inWindow: true }),
    );
    expect(d?.caseId).toBe('C');
    expect(d?.cardField).toBe('notice_withdraw_offtime_flex_id');
    expect(d?.stampKey).toBe(NOTICE_WITHDRAW_AT_KEY);
  });

  it('⭐ D: text · withdraw ON · withdraw word · site withdraw_off → withdraw disable card', () => {
    const d = decideNotice(
      ctx({ withdrawOn: true, withdrawWord: true, withdrawOff: true }),
    );
    expect(d?.caseId).toBe('D');
    expect(d?.cardField).toBe('notice_withdraw_flex_id');
  });

  it('⭐ E: image · deposit ON + scope slip · QR found · in window → all off-time card', () => {
    const d = decideNotice(
      ctx({
        eventKind: 'image',
        depositOn: true,
        depositScope: 'slip',
        qrFound: true,
        inWindow: true,
      }),
    );
    expect(d?.caseId).toBe('E');
    expect(d?.cardField).toBe('notice_all_offtime_flex_id');
    expect(d?.stampKey).toBe(NOTICE_PAYMENT_AT_KEY);
  });

  it('⭐ F: image · deposit ON + scope slip · QR found · DEPOSIT side off → all disable card', () => {
    /* changed 22/08 by owner decision ("ให้สลิปอ่านค่า ฝาก"): the spec's OR
       let a withdraw-only outage swallow a deposit slip. NOTICE_SLIP_SIDE
       carries the decision; the policy case below pins the withdraw-only
       side staying silent. */
    for (const off of [
      { depositOff: true },
      { depositOff: true, withdrawOff: true },
    ]) {
      const d = decideNotice(
        ctx({
          eventKind: 'image',
          depositOn: true,
          depositScope: 'slip',
          qrFound: true,
          ...off,
        }),
      );
      expect(d?.caseId).toBe('F');
      expect(d?.cardField).toBe('notice_all_disable_flex_id');
    }
  });
});

describe('⭐ what must NOT fire', () => {
  it('⭐ toggle OFF = silence, whatever else is true (ปิด = เหมือนเดิมเป๊ะ)', () => {
    expect(
      decideNotice(
        ctx({ depositWord: true, inWindow: true, depositOff: true }),
      ),
    ).toBeNull();
    expect(
      decideNotice(
        ctx({
          eventKind: 'image',
          depositScope: 'slip',
          qrFound: true,
          inWindow: true,
        }),
      ),
    ).toBeNull();
  });

  it('⭐ E/F demand scope slip — scope text or all stays silent (D15)', () => {
    for (const depositScope of ['text', 'all'] as const) {
      expect(
        decideNotice(
          ctx({
            eventKind: 'image',
            depositOn: true,
            depositScope,
            qrFound: true,
            inWindow: true,
            depositOff: true,
          }),
        ),
      ).toBeNull();
    }
  });

  it('A-D never fire on an image; E/F never fire on text', () => {
    expect(
      decideNotice(
        ctx({
          eventKind: 'image',
          depositOn: true,
          depositWord: true,
          inWindow: true,
        }),
      ),
    ).toBeNull();
    expect(
      decideNotice(
        ctx({
          depositOn: true,
          depositScope: 'slip',
          qrFound: true,
          inWindow: true,
        }),
      ),
    ).toBeNull();
  });

  it('no QR = no E/F — a plain photo passes through untouched', () => {
    expect(
      decideNotice(
        ctx({
          eventKind: 'image',
          depositOn: true,
          depositScope: 'slip',
          inWindow: true,
          depositOff: true,
        }),
      ),
    ).toBeNull();
  });

  it('nothing matches = null — the webhook cannot tell the feature exists', () => {
    expect(decideNotice(base)).toBeNull();
  });
});

describe('⭐ precedence — time-first, ONE card per event (D13, order is data)', () => {
  it('⭐ A beats B when both match', () => {
    const d = decideNotice(
      ctx({
        depositOn: true,
        depositWord: true,
        inWindow: true,
        depositOff: true,
      }),
    );
    expect(d?.caseId).toBe('A');
  });

  it('⭐ C beats D when both match', () => {
    const d = decideNotice(
      ctx({
        withdrawOn: true,
        withdrawWord: true,
        inWindow: true,
        withdrawOff: true,
      }),
    );
    expect(d?.caseId).toBe('C');
  });

  it('⭐ E beats F when both match', () => {
    const d = decideNotice(
      ctx({
        eventKind: 'image',
        depositOn: true,
        depositScope: 'slip',
        qrFound: true,
        inWindow: true,
        depositOff: true,
        withdrawOff: true,
      }),
    );
    expect(d?.caseId).toBe('E');
  });

  it('⭐ a shared-word text lands on the DEPOSIT card — order decides, not the list', () => {
    /* [22/08] both word screens answer true for "เงินไม่มา"; A precedes C in
       NOTICE_CASE_ORDER, so the deposit off-time card is what goes out. Reorder
       that array to flip this — the lists stay untouched. */
    const both = ctx({
      depositOn: true,
      withdrawOn: true,
      depositWord: true,
      withdrawWord: true,
      inWindow: true,
    });
    expect(decideNotice(both)?.caseId).toBe('A');
    // site-rule tie, same rule: B (deposit) precedes D (withdraw)
    const bothOff = ctx({
      depositOn: true,
      withdrawOn: true,
      depositWord: true,
      withdrawWord: true,
      depositOff: true,
      withdrawOff: true,
    });
    expect(decideNotice(bothOff)?.caseId).toBe('B');
  });

  it('the order array carries all six exactly once — the reswap surface', () => {
    expect(NOTICE_CASE_ORDER.map((c) => c.caseId).sort()).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
    ]);
  });
});

describe('⭐ buildNoticeContext — the funnel applies the R1 reading rules', () => {
  const CARD = 'a0d000000000000000000070';
  const inWindowNow = new Date('2026-08-22T16:30:00.000Z'); // 23:30 Bangkok
  const hook = {
    notice_deposit_status: true,
    notice_deposit_scope: 'slip',
    notice_deposit_offtime_flex_id: CARD,
  };

  it('⭐ a lean row that predates the columns reads all-off (=== true rule)', () => {
    const c = buildNoticeContext({
      eventKind: 'text',
      hook: {},
      text: 'ฝาก',
      now: inWindowNow,
    });
    expect(c.depositOn).toBe(false);
    expect(c.withdrawOn).toBe(false);
    expect(c.depositScope).toBe('text');
    expect(decideNotice(c)).toBeNull();
  });

  it('⭐ the full path: hook + text + window resolves to a firing context', () => {
    const c = buildNoticeContext({
      eventKind: 'text',
      hook,
      text: 'ฝากไม่เข้าครับ',
      now: inWindowNow,
    });
    expect(c.depositOn).toBe(true);
    expect(c.depositWord).toBe(true);
    expect(c.inWindow).toBe(true);
    expect(decideNotice(c)?.caseId).toBe('A');
  });

  it('⭐ image: only the literal qr_found verdict counts', () => {
    for (const [reason, expected] of [
      ['qr_found', true],
      ['no_qr', false],
      ['not_run', false],
      [undefined, false],
    ] as const) {
      const c = buildNoticeContext({
        eventKind: 'image',
        hook,
        qrReason: reason,
        now: inWindowNow,
      });
      expect(c.qrFound).toBe(expected);
    }
  });

  it('site rules flow through fail-open — garbage in, all-open out', () => {
    const c = buildNoticeContext({
      eventKind: 'text',
      hook,
      text: 'ฝาก',
      siteRulesRaw: 'garbage',
      now: inWindowNow,
    });
    expect(c.depositOff).toBe(false);
    expect(c.withdrawOff).toBe(false);
  });

  it('text screens never run on an image event', () => {
    const c = buildNoticeContext({
      eventKind: 'image',
      hook,
      text: 'ฝาก', // even if a caller passed it by mistake
      qrReason: 'qr_found',
      now: inWindowNow,
    });
    expect(c.depositWord).toBe(false);
    expect(c.withdrawWord).toBe(false);
  });
});

/* ── [FIX-20260822-NOTICEPOLICY] the owner's 22/08 review decisions ──────────
 * Written RED first, before the code moved: each case below fails against the
 * pre-fix behaviour and passes only once the policy file exists and the cases
 * read it. เขียนให้แดงก่อนแก้ ตามกฏ. */
describe('⭐ policy — the knobs the owner may flip later', () => {
  it('⭐ F reads the DEPOSIT side only (owner 22/08: "ให้สลิปอ่านค่าฝาก")', () => {
    /* The 13:21 spec said "ฝากปิด หรือ ถอนปิด". Reviewed 22/08: F rides the
       DEPOSIT toggle and blocks the DEPOSIT money path, so a withdraw-only
       outage must not swallow a deposit slip. Flip NOTICE_SLIP_SIDE back to
       'either' to restore the spec's OR. */
    const slipCtx = (over: Partial<NoticeContext>) =>
      ctx({
        eventKind: 'image',
        depositOn: true,
        depositScope: 'slip',
        qrFound: true,
        ...over,
      });
    // withdraw side off, deposit side open → must NOT fire (the fix)
    expect(decideNotice(slipCtx({ withdrawOff: true }))).toBeNull();
    // deposit side off → still fires
    expect(decideNotice(slipCtx({ depositOff: true }))?.caseId).toBe('F');
    // both off → fires (deposit is off, which is what F now reads)
    expect(
      decideNotice(slipCtx({ depositOff: true, withdrawOff: true }))?.caseId,
    ).toBe('F');
  });

  it('⭐ the policy file is the ONE place these decisions live', () => {
    /* every knob the owner said "note ไว้เผื่อเปลี่ยนใจ" about must be a named
       constant, not a condition buried in a case or the guard. */
    expect(NOTICE_SLIP_SIDE).toBe('deposit');
    expect(NOTICE_RESPECTS_HOOK_STATUS).toBe(true);
    /* changed 22/08 after the collision review — owner: "เงียบทั้งสอง แต่ต้อง
       ตั้งค่าเปลี่ยนแปลงได้ในอนาคตแบบง่ายๆ ทำท่อไว้". */
    expect(NOTICE_RESPECTS_ASSIST).toBe(true);
  });
});

/* ── [FIX-20260822-NOTICEPOLICY] the OA kill switch, PROVEN not just pinned ──
 * ===========================================================================
 * Found by an independent test audit: `hookStatusOff` was asserted nowhere but
 * as a literal in the policy pin above, so deleting BOTH guard lines in
 * notice-decide.ts left the entire 4,500-test suite green. The switch that is
 * supposed to make an OA silent had no proof at all.
 * สวิตช์ปิด OA ต้องมีเทสพฤติกรรม ไม่ใช่แค่ปักค่าคงที่. */
describe('⭐ an OA with its master switch off says nothing', () => {
  /* a context that fires case A loudly — only `hookStatusOff` differs below. */
  const firing = {
    depositOn: true,
    depositWord: true,
    inWindow: true,
  } as const;

  it('⭐ status off silences a case that would otherwise fire', () => {
    expect(decideNotice(ctx({ ...firing }))?.caseId).toBe('A');
    expect(decideNotice(ctx({ ...firing, hookStatusOff: true }))).toBeNull();
  });

  it('⭐ it silences EVERY case at once, not just the winner', () => {
    // deposit + withdraw + both site rules off = four text cases match
    const many = ctx({
      depositOn: true,
      withdrawOn: true,
      depositWord: true,
      withdrawWord: true,
      inWindow: true,
      depositOff: true,
      withdrawOff: true,
    });
    expect(decideNoticeAll(many).length).toBeGreaterThan(1);
    expect(decideNoticeAll({ ...many, hookStatusOff: true })).toEqual([]);
  });

  it('⭐ the context reads it from `hook.status`, and a legacy row means ON', () => {
    const read = (hook: Record<string, unknown>) =>
      buildNoticeContext({
        eventKind: 'text',
        hook,
        text: 'ฝาก',
        now: new Date('2026-08-22T16:30:00.000Z'),
      }).hookStatusOff;
    expect(read({ status: 0 })).toBe(true);
    expect(read({ status: 1 })).toBe(false);
    // absent (rows written before the switch existed) and a string '0' are ON,
    // matching every other reader in the webhook — never guess a row silent.
    expect(read({})).toBe(false);
    expect(read({ status: '0' })).toBe(false);
  });

  it('⭐ the policy can be flipped back — the guard reads the constant, not a literal', () => {
    /* if NOTICE_RESPECTS_HOOK_STATUS were ever set false, the two cases above
       would have to change with it; pinning both together is what keeps the
       knob and its behaviour from drifting apart. */
    expect(NOTICE_RESPECTS_HOOK_STATUS).toBe(true);
    expect(decideNotice(ctx({ ...firing, hookStatusOff: true }))).toBeNull();
  });
});

/* ── [FIX-20260822-NOTICEHARDEN] #11 · screening rows and the abandon window ─
 * RED first. The abandon rule reads the bot's last few rows to answer "was
 * this customer handed the registration card?". A deposit/withdraw SCREENING
 * card is not part of that conversation — it answers a different question —
 * so it must not occupy a slot in that window. Owner, 22/08: it counts as
 * screening, and screening is what gets skipped. */
describe('⭐ #11 screening rows are skipped by the abandon lookback', () => {
  it('⭐ the skip list names the screening prefix, and is switchable', () => {
    expect([...ABANDON_SKIPPED_REPLY_PREFIXES]).toEqual(['flex_notice_']);
  });

  it('⭐ the filter matches ONLY screening rows — a plain bot row is untouched', () => {
    const f = abandonBotRowFilter() as {
      'metadata.auto_reply_type': { $not: RegExp };
    };
    const re = f['metadata.auto_reply_type'].$not;
    expect(re.test('flex_notice_a')).toBe(true); // screening → excluded
    expect(re.test('flex_notice_f')).toBe(true);
    expect(re.test('flex_customerhelper')).toBe(false); // the card it hunts for
    expect(re.test('slip_require_profile_text')).toBe(false); // ordinary rows
  });

  it('⭐ it is pluggable, and switching it off is provably free', () => {
    /* owner, 22/08: "ทำเป็นเสียบใส่ ไม่ hardcode + แก้ไขได้". Empty list = the
       exact query that existed before the fix; a caller may pass its own. */
    expect(abandonBotRowFilter([])).toEqual({});
    const custom = abandonBotRowFilter(['my_prefix_']) as {
      'metadata.auto_reply_type': { $not: RegExp };
    };
    expect(custom['metadata.auto_reply_type'].$not.test('my_prefix_x')).toBe(
      true,
    );
    expect(custom['metadata.auto_reply_type'].$not.test('flex_notice_a')).toBe(
      false,
    );
  });
});
