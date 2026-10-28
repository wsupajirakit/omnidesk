/**
 * [FEAT-20260829-STATUSFIRST] the per-side "status decides first" switch
 * ===========================================================================
 * Owner 29/08: a new OPTIONAL toggle per side. ON = inside 23:00–02:00, if that
 * side still has an account OPEN, the off-time notice must NOT fire — the
 * message flows on normally. OFF (and absent, and junk) = today's behaviour,
 * byte for byte. Default OFF was an explicit order: "default ปิดห้ามเป็นหนี้".
 *
 * 🔴 WHY A NEW CONDITION AND NOT A REORDER — measured first, in
 *    `todo/task/29082026/be_switch-priority-notice_29082026.md`: CASE A never
 *    reads `depositOff`, so no ordering of the case array can make "accounts
 *    open" silence the time card. Reordering only changes which card wins when
 *    BOTH match.
 *
 * 🔴 CASE E IS PART OF THIS. The slip off-time card (image + QR) fires on the
 *    same window under the same deposit-side time-check flag; guarding only A/C
 *    would let a TEXT "ฝาก" flow on while a slip IMAGE still got the off-time
 *    card. E's notion of "off" is the one F already uses for the slip path
 *    (`depositOff || withdrawOff` when scope is slip) — using plain
 *    `depositOff` would disagree with the very F card the customer would get.
 *
 * ⚠️ The site rule block is SIMULATED here on purpose — open/closed per side in
 *    every combination, both polarities of the flag, junk values, positive and
 *    negative — because the decision table is the contract.
 *
 * revert: drop the two schema props, the two `NOTICE_TOGGLE_FIELDS` entries,
 *         the two `hook-field-tabs` rows, the two ctx fields and the three
 *         case-guard clauses; delete this spec.
 */
import { buildNoticeContext } from '../../src/modules/webhook/notice-runtime/notice-context';
import { decideNotice } from '../../src/modules/webhook/notice-runtime/notice-decide';

/**
 * The turn's site-rules block, in the REAL envelope the checker parses
 * (`pickShop` → `data.shop.bank_account.accounts`) — shape copied from
 * `notice-abandon-interplay.spec.ts`, which the checker is already proven
 * against. Deposit side reads `is_view`, withdraw side reads `status`.
 */
const site = (depositOpen: boolean, withdrawOpen: boolean) => ({
  data: {
    shop: {
      bank_account: {
        accounts: [
          { account_type: 'deposit', is_view: depositOpen },
          {
            account_type: 'withdraw',
            status: withdrawOpen ? 'enable' : 'disable',
          },
        ],
      },
    },
  },
});

const HOOK = {
  notice_deposit_status: true,
  notice_withdraw_status: true,
  notice_deposit_scope: 'text',
  notice_withdraw_scope: 'text',
  notice_deposit_flex_id: 'b'.repeat(24),
  notice_deposit_offtime_flex_id: 'a'.repeat(24),
  notice_withdraw_flex_id: 'd'.repeat(24),
  notice_withdraw_offtime_flex_id: 'c'.repeat(24),
};

const AT_2330 = new Date('2026-08-29T16:30:00.000Z'); // 23:30 Bangkok
const AT_1400 = new Date('2026-08-29T07:00:00.000Z'); // 14:00 Bangkok

const decide = (
  hook: Record<string, unknown>,
  text: string,
  now: Date,
  rules: unknown,
) =>
  decideNotice(
    buildNoticeContext({
      eventKind: 'text',
      hook,
      text,
      siteRulesRaw: rules,
      now,
    }),
  );

describe('[STATUSFIRST] deposit side', () => {
  const ON = { ...HOOK, notice_deposit_sitestatus_first: true };

  it('⭐⭐ 🔴 THE ASK: 23:30, deposit open, flag ON ⇒ no card at all', () => {
    expect(decide(ON, 'ฝาก', AT_2330, site(true, true))).toBeNull();
  });

  it('⭐⭐ 🔴 flag OFF (absent) ⇒ same input still gets the off-time card — today, unchanged', () => {
    const got = decide(HOOK, 'ฝาก', AT_2330, site(true, true));
    expect(got?.cardField).toBe('notice_deposit_offtime_flex_id');
  });

  it('⭐⭐ flag explicitly false behaves exactly like absent', () => {
    const off = { ...HOOK, notice_deposit_sitestatus_first: false };
    expect(decide(off, 'ฝาก', AT_2330, site(true, true))?.cardField).toBe(
      'notice_deposit_offtime_flex_id',
    );
  });

  it('⭐⭐ 🔴 flag ON but the side really is OFF ⇒ the off-time card still fires', () => {
    /* "status first" has nothing to prefer when the status agrees the side is
       closed — muting here would silence the night notice entirely. */
    const got = decide(ON, 'ฝาก', AT_2330, site(false, false));
    expect(got?.cardField).toBe('notice_deposit_offtime_flex_id');
  });

  it('⭐⭐ daytime is untouched in every combination', () => {
    expect(decide(ON, 'ฝาก', AT_1400, site(true, true))).toBeNull();
    expect(decide(ON, 'ฝาก', AT_1400, site(false, false))?.cardField).toBe(
      'notice_deposit_flex_id',
    );
  });

  it('⭐⭐ junk values read as OFF — "true", 1, null all keep today\'s card', () => {
    for (const junk of ['true', 1, null]) {
      const h = { ...HOOK, notice_deposit_sitestatus_first: junk };
      expect(decide(h, 'ฝาก', AT_2330, site(true, true))?.cardField).toBe(
        'notice_deposit_offtime_flex_id',
      );
    }
  });

  it('⭐⭐ a BOTH-sides word ("ไม่เข้า") with only deposit muted still gets the WITHDRAW card', () => {
    /* Found while writing this spec, kept as a pin: 'ไม่เข้า' matches both word
       lists. Muting A does not mute C — the message falls through to the next
       matching case, exactly as the order array intends. If the owner wants a
       shared word silenced by ONE side's flag, that is a different feature. */
    const got = decide(ON, 'ไม่เข้า', AT_2330, site(true, true));
    expect(got?.cardField).toBe('notice_withdraw_offtime_flex_id');
  });

  it('⭐ the deposit flag never mutes the WITHDRAW side', () => {
    const got = decide(ON, 'ถอน', AT_2330, site(true, true));
    expect(got?.cardField).toBe('notice_withdraw_offtime_flex_id');
  });
});

describe('[STATUSFIRST] withdraw side mirrors', () => {
  const ON = { ...HOOK, notice_withdraw_sitestatus_first: true };

  it('⭐⭐ 🔴 23:30, withdraw open, flag ON ⇒ silent', () => {
    expect(decide(ON, 'ถอน', AT_2330, site(true, true))).toBeNull();
  });

  it('⭐⭐ withdraw closed ⇒ off-time card still fires with the flag ON', () => {
    expect(decide(ON, 'ถอน', AT_2330, site(true, false))?.cardField).toBe(
      'notice_withdraw_offtime_flex_id',
    );
  });

  it('⭐ the withdraw flag never mutes the DEPOSIT side', () => {
    expect(decide(ON, 'ฝาก', AT_2330, site(true, true))?.cardField).toBe(
      'notice_deposit_offtime_flex_id',
    );
  });
});

describe('[STATUSFIRST] the two EXISTING check flags keep their exact meaning', () => {
  /* Owner 29/08, verbatim warning: "ระวังพวกเงื่อนไขนี้ … ต้องทำงานได้เหมือนเดิม
     ทั้งฝากและถอน ไม่กระทบ". Each cell here exercises an old flag WITH the new
     one present, both polarities, both sides. */

  it('⭐⭐ 🔴 อ่านเช็คเวลา OFF still silences the night card — new flag on or off', () => {
    for (const first of [true, false]) {
      const h = {
        ...HOOK,
        notice_deposit_time_check: false,
        notice_deposit_sitestatus_first: first,
      };
      /* everything closed: the TIME card is muted, but case B (the site-rule
         card, which never reads the clock) fires exactly as it does today —
         first drafted as toBeNull and the runtime corrected the author. */
      expect(decide(h, 'ฝาก', AT_2330, site(false, false))?.caseId).toBe('B');
      expect(decide(h, 'ฝาก', AT_2330, site(true, true))).toBeNull();
    }
  });

  it('⭐⭐ 🔴 อ่านเช็คสถานะระบบ OFF still silences the B card, and the new flag does not revive it', () => {
    for (const first of [true, false]) {
      const h = {
        ...HOOK,
        notice_deposit_sitestatus_check: false,
        notice_deposit_sitestatus_first: first,
      };
      // daytime + everything closed = case B territory; the check flag mutes it
      expect(decide(h, 'ฝาก', AT_1400, site(false, false))).toBeNull();
    }
  });

  it('⭐⭐ time-check OFF + new flag ON: the withdraw side mirrors', () => {
    for (const first of [true, false]) {
      const h = {
        ...HOOK,
        notice_withdraw_time_check: false,
        notice_withdraw_sitestatus_first: first,
      };
      expect(decide(h, 'ถอน', AT_2330, site(true, true))).toBeNull();
      /* same shape as the deposit cell above — D is B's withdraw mirror */
      expect(decide(h, 'ถอน', AT_2330, site(false, false))?.caseId).toBe('D');
    }
  });

  it('⭐⭐ both old flags ON + new flag ON, side closed at night ⇒ the SAME off-time card as today', () => {
    const h = {
      ...HOOK,
      notice_deposit_time_check: true,
      notice_deposit_sitestatus_check: true,
      notice_deposit_sitestatus_first: true,
    };
    expect(decide(h, 'ฝาก', AT_2330, site(false, false))?.cardField).toBe(
      'notice_deposit_offtime_flex_id',
    );
  });
});

describe('[STATUSFIRST] the slip card (case E) belongs to the deposit family', () => {
  const slipHook = {
    ...HOOK,
    notice_deposit_scope: 'slip',
    notice_all_offtime_flex_id: 'e'.repeat(24),
    notice_all_disable_flex_id: 'f'.repeat(24),
  };
  const decideSlip = (
    hook: Record<string, unknown>,
    rules: unknown,
    now: Date,
  ) =>
    decideNotice(
      buildNoticeContext({
        eventKind: 'image',
        hook,
        qrReason: 'qr_found',
        siteRulesRaw: rules,
        now,
      }),
    );

  it('⭐⭐ 🔴 flag ON + something open ⇒ the slip off-time card is silent too', () => {
    const on = { ...slipHook, notice_deposit_sitestatus_first: true };
    expect(decideSlip(on, site(true, true), AT_2330)).toBeNull();
  });

  it('⭐⭐ flag ON + EVERYTHING closed ⇒ slip off-time card still fires', () => {
    /* "off" for the slip path is F's expression — deposit OR withdraw off. */
    const on = { ...slipHook, notice_deposit_sitestatus_first: true };
    expect(decideSlip(on, site(false, false), AT_2330)?.cardField).toBe(
      'notice_all_offtime_flex_id',
    );
  });

  it('⭐⭐ flag absent ⇒ slip off-time card exactly as today', () => {
    expect(decideSlip(slipHook, site(true, true), AT_2330)?.cardField).toBe(
      'notice_all_offtime_flex_id',
    );
  });
});
