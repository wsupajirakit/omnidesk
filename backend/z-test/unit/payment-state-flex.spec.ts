/**
 * ==== [FEAT-20260810-PAYSTATEFLEX] per-state card resolution ====
 *
 * The point of these tests is the FALLBACKS, not the happy path. This resolver runs
 * after the payment legs have already decided what happened to the money, so every
 * way it can fail must end in "keep the previous reply" rather than an exception
 * that leaves the customer with nothing. Each case below is one such way.
 *
 * T2/T3/T4/T5 from the plan in `todo/be_todo20_10082026.md`.
 */
import {
  resolveStateFlex,
  withSwiftcheckDuplicateFallback,
} from '@/modules/payment/payment-state-flex.resolver';

const tagContext = {
  vData: {
    amount: { amount: 1500 },
    date: '2026-04-06T08:03:07+07:00',
    sender: { bank: { id: 'ktb' }, account: {} },
    receiver: { bank: { id: 'scb' }, account: {} },
  },
  baseUrl: 'https://cdn.example.test',
  slipCreatedAt: new Date('2026-04-06T15:26:10+07:00'),
  formatThaiDateTime: () => '06/04/2569 15:26:10',
};

const makeDeps = (card: unknown | null, throws = false) => {
  const warn = jest.fn();
  return {
    warn,
    findFlexById: jest.fn(() =>
      throws
        ? Promise.reject(new Error('mongo down'))
        : Promise.resolve(card as never),
    ),
  };
};

const CARD = {
  _id: 'card1',
  name: '[PAY] review',
  flex_type: 'slip',
  content_json: { type: 'bubble', body: { text: 'ยอด {{amount}} บาท' } },
};

describe('[FEAT-20260810-PAYSTATEFLEX] resolveStateFlex', () => {
  it('(T3) returns the substituted card when the state is bound', async () => {
    const deps = makeDeps(CARD);
    const res = await resolveStateFlex(
      { state: 'review', boundIds: { review: 'card1' }, tagContext },
      deps,
    );
    expect(res).not.toBeNull();
    expect((res!.contents as any).body.text).toBe('ยอด 1,500.00 บาท');
    expect(res!.cardName).toBe('[PAY] review');
    expect(res!.leftover).toEqual([]);
  });

  it('(T2) returns null — and does not even query — when nothing is bound', async () => {
    // The common case for every existing OA: behaviour must be untouched, and we
    // must not pay for a lookup to discover that.
    for (const bound of [
      undefined,
      null,
      {},
      { review: null },
      { review: '' },
    ]) {
      const deps = makeDeps(CARD);
      const res = await resolveStateFlex(
        { state: 'review', boundIds: bound, tagContext },
        deps,
      );
      expect(res).toBeNull();
      expect(deps.findFlexById).not.toHaveBeenCalled();
    }
  });

  it('(T2) ignores a card bound to a DIFFERENT state', async () => {
    const deps = makeDeps(CARD);
    const res = await resolveStateFlex(
      { state: 'review', boundIds: { no_match_retry: 'card1' }, tagContext },
      deps,
    );
    // 1 state = 1 card: another state's binding must never leak into this one.
    expect(res).toBeNull();
    expect(deps.findFlexById).not.toHaveBeenCalled();
  });

  it('(T4) falls back and warns when the bound card was deleted', async () => {
    const deps = makeDeps(null);
    const res = await resolveStateFlex(
      { state: 'review', boundIds: { review: 'gone' }, tagContext },
      deps,
    );
    expect(res).toBeNull();
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining('no longer exists'),
    );
  });

  it('(T4) falls back — never throws — when the lookup itself fails', async () => {
    const deps = makeDeps(null, true);
    await expect(
      resolveStateFlex(
        { state: 'review', boundIds: { review: 'card1' }, tagContext },
        deps,
      ),
    ).resolves.toBeNull();
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining('lookup failed'),
    );
  });

  it('(T5) refuses a card that is not flex_type slip', async () => {
    const deps = makeDeps({ ...CARD, flex_type: 'profile' });
    const res = await resolveStateFlex(
      { state: 'review', boundIds: { review: 'card1' }, tagContext },
      deps,
    );
    // A profile card is written against a different variable set — sending it
    // would show the customer raw {{…}}.
    expect(res).toBeNull();
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining("not 'slip'"),
    );
  });

  it('(T5) accepts a legacy card with no flex_type at all', async () => {
    const { flex_type: _omit, ...legacy } = CARD;
    const res = await resolveStateFlex(
      { state: 'review', boundIds: { review: 'card1' }, tagContext },
      makeDeps(legacy),
    );
    // Absent reads as 'slip' — same rule as the FE filter and the schema default.
    expect(res).not.toBeNull();
  });

  it('falls back when the card has no content_json', async () => {
    const deps = makeDeps({ ...CARD, content_json: null });
    const res = await resolveStateFlex(
      { state: 'review', boundIds: { review: 'card1' }, tagContext },
      deps,
    );
    expect(res).toBeNull();
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining('no content_json'),
    );
  });

  it('falls back when content_json cannot be serialised', async () => {
    const cyclic: any = { type: 'bubble' };
    cyclic.self = cyclic;
    const deps = makeDeps({ ...CARD, content_json: cyclic });
    await expect(
      resolveStateFlex(
        { state: 'review', boundIds: { review: 'card1' }, tagContext },
        deps,
      ),
    ).resolves.toBeNull();
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be rendered'),
    );
  });

  it('(T6) reports leftover tags instead of shipping them silently', async () => {
    const deps = makeDeps({
      ...CARD,
      content_json: { text: '{{amount}} · {{paylink.retry}}' },
    });
    const res = await resolveStateFlex(
      {
        state: 'no_match_retry',
        boundIds: { no_match_retry: 'c' },
        tagContext,
      },
      deps,
    );
    // {{paylink.*}} is not a slip tag — it is minted later. Until that exists it
    // MUST show up as leftover so the caller can log it rather than let a customer
    // read a raw tag.
    expect(res!.leftover).toEqual(['{{paylink.retry}}']);
  });

  it('accepts an ObjectId-like binding, not just a string', async () => {
    const deps = makeDeps(CARD);
    const oid = { toString: () => 'card1' };
    const res = await resolveStateFlex(
      { state: 'review', boundIds: { review: oid }, tagContext },
      deps,
    );
    expect(res).not.toBeNull();
    expect(deps.findFlexById).toHaveBeenCalledWith('card1');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * [FEAT-20260823-TOPUPDUP] state `topup_duplicate` ยืมการ์ด duplicate ของ Swiftcheck
 * ═══════════════════════════════════════════════════════════════════════════
 * เจ้าของเลือกทางนี้ 23/08/2026 (*"ให้ใช้การ์ด duplicate swiftcheck ได้"*) เพื่อให้
 * ใช้ได้ทันทีโดยไม่ต้องตั้งอะไรเพิ่มในหน้าเว็บและไม่ต้องแตะ FE
 *
 * หัวใจของเทสชุดนี้คือ **ห้ามกระทบ state อื่นแม้แต่ตัวเดียว**
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('[TOPUPDUP] withSwiftcheckDuplicateFallback', () => {
  it('ไม่ได้ผูกเอง + มีการ์ด Swiftcheck ⇒ เติมให้', () => {
    expect(withSwiftcheckDuplicateFallback(undefined, 'CARD_DUP')).toEqual({
      topup_duplicate: 'CARD_DUP',
    });
  });

  it('⭐ ผูกเองไว้แล้ว ⇒ ของที่ผูกเองชนะ ไม่ถูกทับ', () => {
    expect(
      withSwiftcheckDuplicateFallback({ topup_duplicate: 'MINE' }, 'CARD_DUP'),
    ).toEqual({ topup_duplicate: 'MINE' });
  });

  it('ไม่มีการ์ด Swiftcheck ⇒ คืนของเดิมเป๊ะ ไม่เติมคีย์ว่าง', () => {
    const before = { topup_success: 'S1' };
    const after = withSwiftcheckDuplicateFallback(before, null);
    expect(after).toBe(before); // อ็อบเจ็กต์เดิม ไม่ได้ก๊อป ไม่ได้เติม
    expect(
      withSwiftcheckDuplicateFallback(undefined, undefined),
    ).toBeUndefined();
    expect(withSwiftcheckDuplicateFallback(undefined, '')).toBeUndefined();
  });

  it('⭐ state อื่นไม่ถูกแตะเลยแม้แต่ตัวเดียว', () => {
    const before = {
      topup_success: 'S1',
      walletpay_success: 'S2',
      member_not_match: 'S3',
      review: 'S4',
    };
    const after = withSwiftcheckDuplicateFallback(before, 'CARD_DUP');

    for (const k of Object.keys(before)) {
      expect(after?.[k]).toBe(before[k as keyof typeof before]);
    }
    expect(after?.['topup_duplicate']).toBe('CARD_DUP');
    // ของเดิมต้องไม่ถูกแก้ในที่ (คืนอ็อบเจ็กต์ใหม่)
    expect(before).not.toHaveProperty('topup_duplicate');
  });
});
