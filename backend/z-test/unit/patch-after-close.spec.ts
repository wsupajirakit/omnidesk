/**
 * [FEAT-20260827-PATCHAFTERCLOSE] what an admin's close-case answers actually do.
 *
 * ⭐ THE OWNER'S RULE THIS FILE EXISTS TO PROVE, stated twice on 27/08:
 *    **a section that does not appear must change nothing** — "ถ้าไม่มีให้ติ๊ก
 *    = ปิดเคสปกติ". So the FIRST cases here are the ones where the answer is
 *    "do nothing", and they outnumber the acting ones on purpose. A feature
 *    that only gets tested when it fires is a feature nobody proved is optional.
 */
import { buildPatchAfterClose } from '@/modules/tickets/patch-after-close.helper';

/** A member carrying exactly the stamps named. */
const memberWith = (...leaves: string[]) => ({
  config: {
    follow_up: {
      line: Object.fromEntries(
        leaves.map((l) => [l, new Date('2026-08-20T03:00:00.000Z')]),
      ),
    },
  },
});

const BOTH_REG = ['abandon_trigger_at', 'request_reg_at'];

describe('[PATCHAFTERCLOSE] nothing shown ⇒ nothing happens (ปิดเคสปกติ)', () => {
  it('(N1) 🔴 no answers at all — the shape a close without any section sends', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: undefined,
        member: memberWith(...BOTH_REG, 'notice_deposit_at'),
      }),
    ).toStrictEqual({ setIgnoreAbandon: false, clearKeys: [], isNoop: true });
  });

  it('(N2) 🔴 an empty object — every field materialised as undefined by the pipe', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: {
          registration: undefined,
          deposit: undefined,
          withdraw: undefined,
        },
        member: memberWith(
          ...BOTH_REG,
          'notice_deposit_at',
          'notice_withdraw_at',
        ),
      }),
    ).toStrictEqual({ setIgnoreAbandon: false, clearKeys: [], isNoop: true });
  });

  it('(N3) 🔴 a member with NO stamps at all — no section could have been shown', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: {
          registration: 'stop',
          deposit: 'unfollow',
          withdraw: 'unfollow',
        },
        member: { config: {} },
      }),
    ).toStrictEqual({ setIgnoreAbandon: false, clearKeys: [], isNoop: true });
  });

  it('(N4) 🔴 not a close — the same endpoint also assigns and renames', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: false,
        answers: { registration: 'stop', deposit: 'unfollow' },
        member: memberWith(...BOTH_REG, 'notice_deposit_at'),
      }),
    ).toStrictEqual({ setIgnoreAbandon: false, clearKeys: [], isNoop: true });
  });

  it('(N5) every "keep"/"follow" answer is a decision to do nothing', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: {
          registration: 'keep',
          deposit: 'follow',
          withdraw: 'follow',
        },
        member: memberWith(
          ...BOTH_REG,
          'notice_deposit_at',
          'notice_withdraw_at',
        ),
      }),
    ).toStrictEqual({ setIgnoreAbandon: false, clearKeys: [], isNoop: true });
  });

  it('(N6) a null member never throws', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { registration: 'stop' },
        member: null,
      }).isNoop,
    ).toBe(true);
  });
});

describe('[PATCHAFTERCLOSE] each section is judged ALONE', () => {
  it('(S1) ⭐ only notice_deposit_at ⇒ deposit acts, registration cannot', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        // a stale tab could send both; only the shown one may act
        answers: { registration: 'stop', deposit: 'unfollow' },
        member: memberWith('notice_deposit_at'),
      }),
    ).toStrictEqual({
      setIgnoreAbandon: false,
      clearKeys: ['follow_up.line.notice_deposit_at'],
      isNoop: false,
    });
  });

  it('(S2) ⭐ only notice_withdraw_at ⇒ withdraw acts, deposit is dropped', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { deposit: 'unfollow', withdraw: 'unfollow' },
        member: memberWith('notice_withdraw_at'),
      }),
    ).toStrictEqual({
      setIgnoreAbandon: false,
      clearKeys: ['follow_up.line.notice_withdraw_at'],
      isNoop: false,
    });
  });

  /* [FEAT-20260904-REGANYSTAMP] This case pinned the OLD pair rule — one stamp
     was dropped. That is exactly what the owner asked to change on 04/09,
     because `request_reg_at` only exists for customers who ACTUALLY replied, so
     the pair rule hid the section from everyone still being chased. The case is
     rewritten to the new rule rather than deleted: it still guards the same
     boundary, from the other side. */
  it('(S3) 🔴 ONE registration stamp is enough — and it clears only what is there', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { registration: 'stop' },
        member: memberWith('abandon_trigger_at'),
      }),
    ).toStrictEqual({
      setIgnoreAbandon: true,
      clearKeys: ['follow_up.line.abandon_trigger_at'],
      isNoop: false,
    });
  });

  it('(S3b) 🔴 the helper stamp ALONE also qualifies — it never used to', () => {
    /* `customer_helper_trigger_at` was not consulted at all under the pair
       rule, so a member offered only the helper card could not be stopped. */
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { registration: 'stop' },
        member: memberWith('customer_helper_trigger_at'),
      }),
    ).toStrictEqual({
      setIgnoreAbandon: true,
      clearKeys: ['follow_up.line.customer_helper_trigger_at'],
      isNoop: false,
    });
  });

  it('(S3c) 🔴 NO registration stamp at all ⇒ still dropped', () => {
    /* The boundary the old S3 protected has to keep holding: "any one" is not
       "none". A stop answer from a member carrying only a notice stamp is a
       stale tab and must change nothing on the registration side. */
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { registration: 'stop' },
        member: memberWith('notice_deposit_at'),
      }),
    ).toStrictEqual({ setIgnoreAbandon: false, clearKeys: [], isNoop: true });
  });

  it('(S3d) 🔴 a REGISTERED member is refused, even carrying every stamp', () => {
    /* The hard line, owner 04/09: มีโปรไฟล์ = ห้ามมีตัวเลือกนี้เด็ดขาด. The FE hides
       the section; this proves the BE refuses the answer on its own, which is
       what protects against a stale tab posting it anyway. */
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { registration: 'stop' },
        member: {
          ...memberWith(
            'abandon_trigger_at',
            'request_reg_at',
            'customer_helper_trigger_at',
          ),
          raw_profile_data: { phone: '0900000000' },
        },
      }),
    ).toStrictEqual({ setIgnoreAbandon: false, clearKeys: [], isNoop: true });
  });

  it('(S3e) an EMPTY raw_profile_data is NOT registered — the chase can stop', () => {
    /* A failed profile refresh can leave `{}` behind (seen live: "profile
       endpoint not successful — skip updating raw_profile_data"). Reading that
       as registered would strand the member with no way to stop the chase. */
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { registration: 'stop' },
        member: {
          ...memberWith('abandon_trigger_at'),
          raw_profile_data: {},
        },
      }).setIgnoreAbandon,
    ).toBe(true);
  });

  it('(S4) both notice stamps ⇒ both cleared, deposit first, withdraw second', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { deposit: 'unfollow', withdraw: 'unfollow' },
        member: memberWith('notice_deposit_at', 'notice_withdraw_at'),
      }).clearKeys,
    ).toEqual([
      'follow_up.line.notice_deposit_at',
      'follow_up.line.notice_withdraw_at',
    ]);
  });

  it('(S5) one topic unfollow, the other follow — only the first is touched', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { deposit: 'follow', withdraw: 'unfollow' },
        member: memberWith('notice_deposit_at', 'notice_withdraw_at'),
      }).clearKeys,
    ).toEqual(['follow_up.line.notice_withdraw_at']);
  });
});

describe('[PATCHAFTERCLOSE] the registration section sets the FLAG, never clears a stamp', () => {
  /* ⚠️⚠️ R1–R3 WERE FLIPPED 31/08/2026 — [FIX-20260831-STOPCLEARSSTAMPS] — and
     the old wording is quoted in each so the record of what was once agreed is
     not lost. They pinned the 27/08 rule ("stop sets the flag and clears
     nothing"). The owner reversed it on 31/08 after pressing the button and
     finding the rows still there: *"แอดมินตั้งใจกด มันคือการตั้งใจเคลียร์"*, and
     on the cost: *"หลุดจาก audience ไม่เป็นไร"*.
     What was NOT reversed, and is still asserted below: the pair gate, the
     per-section independence, and that a stamp the member does not carry is
     never named in the plan. */
  it('(R1) ⭐ stop + both stamps ⇒ the flag AND the registration stamps go', () => {
    /* was: "…and NO key is cleared" */
    const plan = buildPatchAfterClose({
      becameClosed: true,
      answers: { registration: 'stop' },
      member: memberWith(...BOTH_REG),
    });
    expect(plan).toStrictEqual({
      setIgnoreAbandon: true,
      clearKeys: [
        'follow_up.line.abandon_trigger_at',
        'follow_up.line.request_reg_at',
      ],
      isNoop: false,
    });
  });

  it('(R1b) ⭐⭐ the helper stamp is cleared too — when the member has one', () => {
    const plan = buildPatchAfterClose({
      becameClosed: true,
      answers: { registration: 'stop' },
      member: memberWith(...BOTH_REG, 'customer_helper_trigger_at'),
    });
    expect(plan.clearKeys).toEqual([
      'follow_up.line.abandon_trigger_at',
      'follow_up.line.request_reg_at',
      'follow_up.line.customer_helper_trigger_at',
    ]);
  });

  it('(R1c) ⭐⭐⭐ a stamp the member does NOT carry is never named', () => {
    /* `clearMemberConfig` would accept it, and the audit row would then claim a
       removal that removed nothing. A customer can be chased without ever being
       sent the helper card, so this is the ordinary case, not an edge one. */
    const plan = buildPatchAfterClose({
      becameClosed: true,
      answers: { registration: 'stop' },
      member: memberWith(...BOTH_REG),
    });
    expect(plan.clearKeys).not.toContain(
      'follow_up.line.customer_helper_trigger_at',
    );
  });

  it('(R2) 🔴 owner reversal 31/08 — the registration stamps ARE in the plan', () => {
    const plan = buildPatchAfterClose({
      becameClosed: true,
      answers: {
        registration: 'stop',
        deposit: 'unfollow',
        withdraw: 'unfollow',
      },
      member: memberWith(
        ...BOTH_REG,
        'notice_deposit_at',
        'notice_withdraw_at',
      ),
    });
    /* was: "the two registration stamps survive every combination of answers"
       — the 27/08 rule. They are removed now, and the deposit/withdraw keys
       still come after them, which is what fixes the audit row's order. */
    expect(plan.clearKeys).toContain('follow_up.line.request_reg_at');
    expect(plan.clearKeys).toContain('follow_up.line.abandon_trigger_at');
    expect(
      plan.clearKeys.indexOf('follow_up.line.abandon_trigger_at'),
    ).toBeLessThan(plan.clearKeys.indexOf('follow_up.line.notice_deposit_at'));
  });

  it('(R3) all three sections can act in one close', () => {
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: {
          registration: 'stop',
          deposit: 'unfollow',
          withdraw: 'unfollow',
        },
        member: memberWith(
          ...BOTH_REG,
          'notice_deposit_at',
          'notice_withdraw_at',
        ),
      }),
    ).toStrictEqual({
      setIgnoreAbandon: true,
      /* was: the two notice keys alone */
      clearKeys: [
        'follow_up.line.abandon_trigger_at',
        'follow_up.line.request_reg_at',
        'follow_up.line.notice_deposit_at',
        'follow_up.line.notice_withdraw_at',
      ],
      isNoop: false,
    });
  });

  it('(R4) 🔴 an empty-string stamp counts as ABSENT, like null', () => {
    /* [FEAT-20260904-REGANYSTAMP] Under the OR rule this fixture had to change
       to keep MEASURING what it was written to measure. With the old pair rule,
       `abandon_trigger_at` set + `request_reg_at` null was already dropped for
       being half a pair — so the empty string was never the reason the case
       passed. Now that ANY ONE stamp qualifies, all three must be blank for the
       assertion to be about blankness at all.
       ⇒ every registration key is a falsy-but-present value here, and the
         deposit key is the empty string the case is named after. */
    expect(
      buildPatchAfterClose({
        becameClosed: true,
        answers: { registration: 'stop', deposit: 'unfollow' },
        member: {
          config: {
            follow_up: {
              line: {
                abandon_trigger_at: '',
                request_reg_at: null,
                customer_helper_trigger_at: '',
                notice_deposit_at: '',
              },
            },
          },
        },
      }),
    ).toStrictEqual({ setIgnoreAbandon: false, clearKeys: [], isNoop: true });
  });
});
