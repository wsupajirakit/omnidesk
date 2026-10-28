/* [FEAT-20260822-NOTICERUNTIME] the four pure checkers of the notice runtime
 * ===========================================================================
 * R1 of todo6: time window (Thai +7, crosses midnight) · word screens ·
 * site-rule off-service verdicts (D7, fail-open by owner's rule) · cooldown
 * (code-switchable, duration editable). No webhook wiring yet — these must be
 * provably correct BEFORE anything reads them on the hot path.
 */
import {
  NOTICE_DEPOSIT_AT_KEY,
  NOTICE_WITHDRAW_AT_KEY,
  NOTICE_PAYMENT_AT_KEY,
  NOTICE_WINDOW_START_MIN,
  NOTICE_WINDOW_END_MIN,
  noticeTimeWindow,
  DEPOSIT_WORDS,
  WITHDRAW_WORDS,
  matchDepositWord,
  matchWithdrawWord,
  noticeSiteRuleCheck,
  NOTICE_COOLDOWN_DEFAULT_ENABLED,
  NOTICE_COOLDOWN_MINUTES,
  noticeCooldownBlocks,
  NOTICE_TEXT_EVENTS,
  noticeTextEventAllowed,
} from '@/modules/webhook';

/** A UTC instant whose BANGKOK wall clock reads hh:mm. */
const bkk = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 22, h - 7, m));

describe('⭐ noticeTimeWindow — 23:00-02:00 Thai wall clock, crosses midnight', () => {
  it('⭐ the configured window is 23:00 → 02:00', () => {
    expect(NOTICE_WINDOW_START_MIN).toBe(23 * 60);
    expect(NOTICE_WINDOW_END_MIN).toBe(2 * 60);
  });

  it('⭐ inside: 23:00 (inclusive start), 23:59, 00:30, 01:59', () => {
    expect(noticeTimeWindow(bkk(23, 0))).toBe(true);
    expect(noticeTimeWindow(bkk(23, 59))).toBe(true);
    expect(noticeTimeWindow(bkk(24 + 0, 30))).toBe(true); // 00:30 next day
    expect(noticeTimeWindow(bkk(24 + 1, 59))).toBe(true); // 01:59
  });

  it('⭐ outside: 02:00 (exclusive end), 12:00, 22:59', () => {
    expect(noticeTimeWindow(bkk(24 + 2, 0))).toBe(false); // 02:00 sharp
    expect(noticeTimeWindow(bkk(12, 0))).toBe(false);
    expect(noticeTimeWindow(bkk(22, 59))).toBe(false);
  });

  it('⭐ it reads the THAI wall clock, not UTC — 16:00Z is 23:00 Bangkok', () => {
    /* the mutation this kills: dropping the +7 offset would flip both. */
    expect(noticeTimeWindow(new Date('2026-08-22T16:00:00.000Z'))).toBe(true);
    expect(noticeTimeWindow(new Date('2026-08-22T23:00:00.000Z'))).toBe(false); // 06:00 BKK
  });

  it('a non-crossing override behaves as a plain range', () => {
    expect(noticeTimeWindow(bkk(10, 0), 9 * 60, 17 * 60)).toBe(true);
    expect(noticeTimeWindow(bkk(18, 0), 9 * 60, 17 * 60)).toBe(false);
    // zero-length window = never on
    expect(noticeTimeWindow(bkk(10, 0), 600, 600)).toBe(false);
  });
});

describe('⭐ word screens — substring over editable lists, independent answers', () => {
  it('⭐ deposit: bare word, embedded, and the spec phrases', () => {
    expect(matchDepositWord('ฝาก')).toBe(true);
    expect(matchDepositWord('xxฝากxx')).toBe(true); // substring per spec
    expect(matchDepositWord('ฝากไม่เข้าครับ')).toBe(true);
    expect(matchDepositWord('เงินเข้าช้ามาก')).toBe(true);
  });

  it('⭐ withdraw: the proposed list answers on its own', () => {
    expect(matchWithdrawWord('ถอน')).toBe(true);
    expect(matchWithdrawWord('ถอนไม่ได้เลย')).toBe(true);
    expect(matchWithdrawWord('เงินไม่ออก')).toBe(true);
    expect(matchWithdrawWord('สวัสดีครับ')).toBe(false);
  });

  it('no match on unrelated text, empty, or non-strings', () => {
    expect(matchDepositWord('สวัสดีครับ')).toBe(false);
    expect(matchDepositWord('')).toBe(false);
    expect(matchDepositWord(undefined)).toBe(false);
    expect(matchWithdrawWord(null)).toBe(false);
  });

  it('⭐ the shared block is on BOTH lists, byte for byte (owner, 22/08)', () => {
    /* Ten substrings the owner added to both sides verbatim. Pinned as a SET
       so a one-sided edit — the kind that silently changes which card fires —
       shows up here instead of in production. ตัดข้างเดียวไม่ได้ ต้องเห็นตรงนี้ก่อน. */
    const SHARED = [
      'เงิน',
      'เครดิต',
      'เคดิต',
      'บัญชี',
      'ไม่มา',
      'ไม่ขึ้น',
      'ไม่มี',
      'เป็นอะไร',
      'เหรียญ',
      'ไม่เข้า',
      'ตัง',
    ];
    for (const w of SHARED) {
      expect(DEPOSIT_WORDS).toContain(w);
      expect(WITHDRAW_WORDS).toContain(w);
    }
  });

  it('⭐ side-specific words never cross over (owner: ฝากช้า = ฝาก · ถอนช้า = ถอน)', () => {
    /* 'ฝากช้า' rode in with the shared block and made a DEPOSIT complaint fire
       the WITHDRAW card whenever the withdraw side was off. A word that names
       one side belongs to that side only. คำที่ระบุฝั่ง ห้ามข้ามฝั่ง. */
    expect(DEPOSIT_WORDS).toContain('ฝากช้า');
    expect(WITHDRAW_WORDS).not.toContain('ฝากช้า');
    expect(WITHDRAW_WORDS).toContain('ถอนช้า');
    expect(DEPOSIT_WORDS).not.toContain('ถอนช้า');
    expect(matchWithdrawWord('ฝากช้าจัง')).toBe(false);
    expect(matchDepositWord('ฝากช้าจัง')).toBe(true);
    expect(matchDepositWord('ถอนช้าจัง')).toBe(false);
    expect(matchWithdrawWord('ถอนช้าจัง')).toBe(true);
  });

  it('⭐ neither list carries an EXACT duplicate', () => {
    /* owner asked for a duplicate check when the lists grew (22/08). Exact
       repeats are the only real defect — a repeat is invisible at runtime and
       hides that somebody added a word twice believing it was missing.
       COVERED entries (a longer word a shorter one already matches, e.g.
       'เงินไม่เข้า' under 'ไม่เข้า') are NOT an error and are kept on purpose;
       see the note in notice-word-match.ts. คำซ้ำเป๊ะ = ผิด · คำซ้อน = ตั้งใจ. */
    for (const list of [DEPOSIT_WORDS, WITHDRAW_WORDS]) {
      expect(list.length).toBe(new Set(list).size);
    }
  });

  it('⭐ the newest entries work as substrings on both sides', () => {
    for (const text of ['เงินไม่เข้าเลย', 'ตังหาย', 'ยอดไม่เข้า']) {
      expect(matchDepositWord(text)).toBe(true);
      expect(matchWithdrawWord(text)).toBe(true);
    }
  });

  it('⭐ a shared-word text matches BOTH screens — the tie is real', () => {
    /* these are the words a customer uses before saying which side broke.
       Which CARD fires is decided by NOTICE_CASE_ORDER, never here — the
       cases spec pins that deposit wins the tie today. */
    for (const text of [
      'เงินไม่มา',
      'เครดิตไม่ขึ้น',
      'บัญชีเป็นอะไร',
      'เหรียญไม่มี',
    ]) {
      expect(matchDepositWord(text)).toBe(true);
      expect(matchWithdrawWord(text)).toBe(true);
    }
  });

  it('⭐ side-specific words still break the tie', () => {
    expect(matchDepositWord('ฝากมา 500')).toBe(true);
    expect(matchWithdrawWord('ฝากมา 500')).toBe(false);
    expect(matchWithdrawWord('ถอนที')).toBe(true);
    expect(matchDepositWord('ถอนที')).toBe(false);
  });
});

describe("⭐ noticeSiteRuleCheck — D7 rule, fail-open by the owner's own words", () => {
  const card = (
    account_type: string,
    status?: string,
    is_view?: boolean,
  ): Record<string, unknown> => {
    const c: Record<string, unknown> = { account_type };
    if (status !== undefined) c['status'] = status;
    if (is_view !== undefined) c['is_view'] = is_view;
    return c;
  };
  const payload = (accounts: unknown[]) => ({
    data: { shop: { bank_account: { accounts } } },
  });

  it('⭐ one open card keeps the side ON (≥1 = open)', () => {
    const raw = payload([
      card('deposit', 'disable', true), // is_view decides — deposit OPEN (doc :318)
      card('withdraw', 'disable', false),
    ]);
    expect(noticeSiteRuleCheck(raw)).toEqual({
      deposit_off: false,
      withdraw_off: true,
    });
  });

  it('⭐ all cards closed = the side is OFF · maintenance counts as closed', () => {
    const raw = payload([
      card('deposit', 'enable', false), // is_view false → deposit closed
      card('deposit', 'maintenance', false),
      card('withdraw', 'maintenance'),
      card('withdraw', 'disable'),
    ]);
    expect(noticeSiteRuleCheck(raw)).toEqual({
      deposit_off: true,
      withdraw_off: true,
    });
  });

  /* [FEAT-20260823-MIXEDDEPVIEW] REWRITTEN — the old case here pinned
     "deposit-withdraw counts on BOTH sides, by status only", and the owner
     ordered the deposit leg onto `is_view` (23/08). The two literals below are
     exactly the two cells that flip; the withdraw half of every expectation is
     unchanged from the old test. */
  it('⭐ deposit-withdraw: deposit leg by is_view, withdraw leg by status', () => {
    // is_view=false · status=enable — deposit WAS open, is now closed
    const raw = payload([card('deposit-withdraw', 'enable', false)]);
    expect(noticeSiteRuleCheck(raw)).toEqual({
      deposit_off: true,
      withdraw_off: false, // withdraw: by status, unchanged
    });
    // is_view=true · status=disable — deposit WAS closed, is now open
    const closed = payload([card('deposit-withdraw', 'disable', true)]);
    expect(noticeSiteRuleCheck(closed)).toEqual({
      deposit_off: false,
      withdraw_off: true, // withdraw: by status, unchanged
    });
  });

  it('⭐ mixed card where the two fields AGREE — both sides as before', () => {
    const open = payload([card('deposit-withdraw', 'enable', true)]);
    expect(noticeSiteRuleCheck(open)).toEqual({
      deposit_off: false,
      withdraw_off: false,
    });
    const shut = payload([card('deposit-withdraw', 'disable', false)]);
    expect(noticeSiteRuleCheck(shut)).toEqual({
      deposit_off: true,
      withdraw_off: true,
    });
  });

  it('mixed card WITHOUT is_view: deposit leg skips it (null), withdraw still counts', () => {
    const c: Record<string, unknown> = {
      account_type: 'deposit-withdraw',
      status: 'disable',
    };
    expect(noticeSiteRuleCheck(payload([c]))).toEqual({
      // deposit side saw nothing countable → unknown → fail-open (not off)
      deposit_off: false,
      withdraw_off: true,
    });
  });

  it('⭐ FAIL-OPEN: missing everything answers false/false and never throws', () => {
    /* owner, verbatim: "ถ้าไม่เจอ array account นี้ห้ามพัง … ให้ออก
       xxxx off service = false" */
    const open = { deposit_off: false, withdraw_off: false };
    expect(noticeSiteRuleCheck(undefined)).toEqual(open);
    expect(noticeSiteRuleCheck(null)).toEqual(open);
    expect(noticeSiteRuleCheck({})).toEqual(open);
    expect(noticeSiteRuleCheck({ data: { shop: {} } })).toEqual(open);
    expect(noticeSiteRuleCheck(payload([]))).toEqual(open);
    expect(noticeSiteRuleCheck('garbage')).toEqual(open);
    expect(noticeSiteRuleCheck(payload(['not-an-object', 42]))).toEqual(open);
  });

  it('⭐ a card missing its deciding field is skipped, not counted as closed', () => {
    // deposit card without is_view → unknown; the OTHER open one still counts
    const raw = payload([card('deposit'), card('deposit', 'enable', true)]);
    expect(noticeSiteRuleCheck(raw).deposit_off).toBe(false);
    // ONLY unknowable cards on a side → side unknown → not off (fail-open)
    const onlyUnknown = payload([card('deposit'), card('withdraw')]);
    expect(noticeSiteRuleCheck(onlyUnknown)).toEqual({
      deposit_off: false,
      withdraw_off: false,
    });
  });

  it('envelope variants all resolve — pickShop absorbs the wrapper', () => {
    const accounts = [card('withdraw', 'enable')];
    const bare = { shop: { bank_account: { accounts } } };
    const naked = { bank_account: { accounts } };
    expect(noticeSiteRuleCheck(bare).withdraw_off).toBe(false);
    expect(noticeSiteRuleCheck(naked).withdraw_off).toBe(false);
  });
});

describe('⭐ noticeCooldownBlocks — switchable in code, duration editable', () => {
  const now = new Date('2026-08-22T16:30:00.000Z');
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

  it('⭐ the module still defaults to ON at 30 minutes — the POLICY is what ships OFF', () => {
    /* owner removed the cooldown 22/08 ("เรามี rate limit อยู่แล้ว … ถอด cooldown
       ออก note ไว้ เผื่อเอากลับ"). The function is untouched so bringing it back
       is one flip in notice-policy.ts; these cases keep proving it still works. */
    expect(NOTICE_COOLDOWN_DEFAULT_ENABLED).toBe(true);
    expect(NOTICE_COOLDOWN_MINUTES).toBe(30);
  });

  it('⭐ a fresh stamp blocks, a stale one does not', () => {
    expect(noticeCooldownBlocks(minsAgo(5), now)).toBe(true);
    expect(noticeCooldownBlocks(minsAgo(29), now)).toBe(true);
    expect(noticeCooldownBlocks(minsAgo(30), now)).toBe(false); // exact edge fires
    expect(noticeCooldownBlocks(minsAgo(90), now)).toBe(false);
  });

  it('⭐ disabled in code = nothing ever blocks', () => {
    expect(noticeCooldownBlocks(minsAgo(1), now, { enabled: false })).toBe(
      false,
    );
  });

  it('the duration is honoured when overridden', () => {
    expect(noticeCooldownBlocks(minsAgo(45), now, { minutes: 60 })).toBe(true);
    expect(noticeCooldownBlocks(minsAgo(45), now, { minutes: 30 })).toBe(false);
  });

  it('⭐ fail-open: absent, junk, or future stamps never starve the card', () => {
    expect(noticeCooldownBlocks(undefined, now)).toBe(false);
    expect(noticeCooldownBlocks(null, now)).toBe(false);
    expect(noticeCooldownBlocks('2026-08-22T16:29:00Z', now)).toBe(false); // string ≠ Date
    expect(noticeCooldownBlocks(new Date('invalid'), now)).toBe(false);
    expect(noticeCooldownBlocks(minsAgo(-10), now)).toBe(false); // future = corrupt
  });
});

describe('[FEAT-20260824-NOTICEWORDS] the two words the owner added', () => {
  it('⭐ "เติม" is a DEPOSIT word — เติมเงิน/ขอเติม now match', () => {
    expect(matchDepositWord('ขอเติมหน่อยครับ')).toBe(true);
    expect(matchDepositWord('เติมเงินไม่ได้')).toBe(true);
    // withdraw side must NOT gain it
    expect(matchWithdrawWord('ขอเติมหน่อยครับ')).toBe(false);
  });

  it('⭐ "ลด" is a WITHDRAW word — ลดยอด/ขอลด now match', () => {
    expect(matchWithdrawWord('ขอลดยอดหน่อย')).toBe(true);
    // deposit side must NOT gain it
    expect(matchDepositWord('ขอลดยอดหน่อย')).toBe(false);
  });

  it("⭐ 'ปรับ' is SHARED — matches both sides; deposit wins the tie by order", () => {
    expect(matchDepositWord('ขอปรับยอดหน่อย')).toBe(true);
    expect(matchWithdrawWord('ขอปรับยอดหน่อย')).toBe(true);
  });

  it('a message with neither still matches nothing new', () => {
    expect(matchDepositWord('สวัสดีครับ')).toBe(false);
    expect(matchWithdrawWord('สวัสดีครับ')).toBe(false);
  });
});

describe('the member keys are the registry-shaped dotted paths', () => {
  it('underscore names under follow_up.line, one per stamp', () => {
    expect(NOTICE_DEPOSIT_AT_KEY).toBe('follow_up.line.notice_deposit_at');
    expect(NOTICE_WITHDRAW_AT_KEY).toBe('follow_up.line.notice_withdraw_at');
    expect(NOTICE_PAYMENT_AT_KEY).toBe('follow_up.line.notice_payment_at');
  });
});

/* ── [FEAT-20260822-NOTICEMODE] NOTICE_TEXT_EVENTS is a real switch now ──────
 * It was declared but read by nobody, so flipping it changed nothing while the
 * doc described a working knob. Wired 22/08 at the text insertion point; these
 * cases prove BOTH answers without editing the constant — the mode is an
 * argument for exactly that reason. ปุ่มต้องพลิกได้จริง และเทสต้องพิสูจน์ทั้งสองด้าน. */
describe('⭐ which events the text cases may read', () => {
  it('⭐ shipped `any-text`: everything the webhook turned into text is allowed', () => {
    expect(NOTICE_TEXT_EVENTS).toBe('any-text');
    expect(noticeTextEventAllowed('message', 'text')).toBe(true);
    expect(noticeTextEventAllowed('postback', undefined)).toBe(true);
    expect(noticeTextEventAllowed(undefined, undefined)).toBe(true);
  });

  it('⭐ flipped to `message-only`: a real text message only', () => {
    const only = 'message-only' as const;
    expect(noticeTextEventAllowed('message', 'text', only)).toBe(true);
    // the case the owner may want to exclude: a rich-menu button
    expect(noticeTextEventAllowed('postback', undefined, only)).toBe(false);
    // and every other shape stays out too
    expect(noticeTextEventAllowed('message', 'image', only)).toBe(false);
    expect(noticeTextEventAllowed('follow', undefined, only)).toBe(false);
  });
});
