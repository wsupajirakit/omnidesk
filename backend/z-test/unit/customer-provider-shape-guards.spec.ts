import { deriveShopapiV1Fields } from '@/modules/customer-provider/providers/shopapi-v1/derive-fields';
import { buildShopapiV1View } from '@/modules/customer-provider/providers/shopapi-v1/build-view';
/* The row table and the engine's resolver, imported rather than re-stated: the
   point round cases below must exercise the SHIPPED table, or they would prove only
   that the spec agrees with itself. เทสต้องอ่านตารางจริง */
import { SHOPAPI_V1_ROW_PATHS } from '@/modules/customer-provider/providers/shopapi-v1/row-paths';
import { resolveRows } from '@/modules/customer-provider/providers/engine/resolve-fields';

/**
 * [FIX-20260906-LISTSHAPE + FIX-20260906-COINLABEL] Two shapes an upstream really
 * sends, and what they used to cost.
 * ===========================================================================
 * Both were found by an adversarial review of the customer-provider merge and both
 * were reproduced end to end before being fixed — not deduced from reading.
 *
 * 1. A LIST THAT IS NOT A LIST. `?? []` and `|| []` defend against a list that is
 *    MISSING; neither defends against one that is present and the wrong shape. An
 *    upstream that switches `activity.coin_received` from `[…]` to `{"0":{…}}`
 *    yields a truthy object, `.map` is not a function, and the TypeError escapes
 *    `GET /api/line-users/:id/raw-profile` as a 500 — one customer's stored blob
 *    breaks the profile route for that customer entirely. Absorbing shape variation
 *    is this module's entire premise, so throwing on one is the opposite of the job.
 *
 * 2. AN UNLABELLED ITEM CONDEMNS ITS WHOLE SECTION. The coin label chain is TRUTHY,
 *    so a `note` sent as `{th,en}` wins it, `asText` answers '' for a non-primitive,
 *    and `validate-view` refuses the item as `unlabelled_item`. That refusal drops
 *    the section — and `labelledChildren` spans ROWS as well as items, so the
 *    balance row dies with the bad history row: a customer holding 5,000 coins is
 *    shown nothing at all.
 *
 * ⚠️ WHY THESE CASES ARE HERE AND NOT IN `customer-provider-fields.spec.ts`.
 * That file BACKTESTS the nine algorithms against the panel's own source, comparing
 * each right-hand side as text to prove the extraction was a MOVE and not a rewrite.
 * These are new rules about shapes the panel never survived either, so they belong
 * beside it rather than inside it — and the fix was deliberately written so that
 * backtest keeps passing untouched (the guard repairs the binding, never the
 * expression). If someone "simplifies" the guard back into the expressions, that
 * file goes red and this one stays green; both signals are wanted.
 * ห้ามแก้ที่นิพจน์ ไม่งั้น backtest พัง
 */
describe('[FIX-20260906] the provider absorbs bad shapes instead of throwing', () => {
  /** The shape the real Shop-API sends, trimmed to what these cases read. */
  const base = () => ({
    bonus: {},
    finance: {},
    activity: { coins: { balance: 5000 } },
    promotion: {},
  });

  /* ⚠️ `resolved` is not optional decoration. `acCoinBal` is a PATH-TABLE value,
     not one of the nine algorithms, so it arrives through this argument and not
     from `sections`. The first version of this file passed `{}` and the balance
     assertion below read 0 — which looks exactly like the defect under test and
     would have been a false green in the other direction.
     ค่าที่มาจากตาราง ต้องส่งผ่าน resolved ไม่ใช่ sections */
  const derive = (
    sections: Record<string, unknown>,
    resolved: Record<string, unknown> = {},
  ) => deriveShopapiV1Fields(sections, resolved);

  it('⭐ a keyed map where `coin_received` should be an array does not throw', () => {
    /* The exact shape from the finding: an upstream that turned an array into a
       map keyed by index. Before the fix this was a TypeError, and it left the
       route with nothing to answer. */
    const s = base();
    (s.activity as Record<string, unknown>)['coin_received'] = {
      '0': { amount: 5 },
    };
    expect(() => derive(s)).not.toThrow();
    expect(derive(s).acCoinHistory).toEqual([]);
  });

  it('a wrong-shaped `coin_spent` is treated as absent, not as a value', () => {
    const s = base();
    (s.activity as Record<string, unknown>)['coin_spent'] = 'not-a-list';
    expect(derive(s).acCoinHistory).toEqual([]);
  });

  it('⭐ a wrong-shaped `coins.history` falls through to the real upstream pair', () => {
    /* `??` used to let a truthy non-array WIN, and the throw then happened further
       downstream where the cause was unreadable. Falling through puts it exactly
       where an ABSENT history has always landed. */
    const s = base();
    (s.activity as Record<string, unknown>)['coins'] = {
      balance: 5000,
      history: { nope: true },
    };
    (s.activity as Record<string, unknown>)['coin_received'] = [
      { amount: 7, at: 1 },
    ];
    const out = derive(s).acCoinHistory;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amount: 7, type: 'earn' });
  });

  it('a wrong-shaped `top_products` does not throw on the spread', () => {
    /* The spread is what throws here — a TypeError before `.sort` is reached. */
    const s = base();
    (s.promotion as Record<string, unknown>)['top_products'] = { a: 1 };
    expect(() => derive(s)).not.toThrow();
    expect(derive(s).promoProducts).toEqual([]);
  });

  it('a WELL-SHAPED blob is untouched — the guard is a no-op on real data', () => {
    /* The guard must not be visible to anyone sending correct data: same values,
       and the section object is returned by identity rather than copied. */
    const s = base();
    (s.activity as Record<string, unknown>)['coin_received'] = [
      { amount: 3, at: 2 },
    ];
    (s.activity as Record<string, unknown>)['coin_spent'] = [
      { amount: 1, at: 1 },
    ];
    const out = derive(s).acCoinHistory;
    expect(out.map((h: { amount: number }) => h.amount)).toEqual([3, 1]);
    expect(out.map((h: { type: string }) => h.type)).toEqual(['earn', 'spend']);
  });

  it('⭐ a coin row whose `note` is an object no longer costs the whole section', () => {
    /* The balance is the part that hurts: it is a ROW, not an item, and it was
       being discarded with the history item that failed validation. */
    const s = base();
    (s.activity as Record<string, unknown>)['coin_received'] = [
      { amount: 3, at: 1, note: { th: 'ฝากเงิน', en: 'deposit' } },
    ];
    const view = buildShopapiV1View(derive(s, { acCoinBal: 5000 }));
    const coins = view.sections.find((x) => x.id === 'activity.coins');
    expect(coins).toBeDefined();
    const labels = (coins as { items?: { label: string }[] }).items?.map(
      (i) => i.label,
    );
    // '-' is what the two SIBLING list sections in build-view.ts already emit.
    expect(labels).toContain('-');
    const rows = (coins as { rows?: { key: string; value: unknown }[] }).rows;
    expect(rows?.find((r) => r.key === 'acCoinBal')?.value).toBe(5000);
  });

  /* ── [FIX-20260906-REALFIELDS] the two names the live upstream really uses ──
     Both fixtures below are lifted from a REAL captured customer, not invented:
     `friend_count: 1` beside a five-row `referral_history`, and a point round row of
     `{date, note, reward_amount, reward_type}`. Before the fallbacks the first
     rendered 5 and the second rendered `-`. */

  it('⭐ rfFriends reads the upstream`s `friend_count` when the panel`s spelling is absent', () => {
    const s = base();
    (s.bonus as Record<string, unknown>)['friend_count'] = 1;
    const fields = derive(s, {
      rfHistory: [{}, {}, {}, {}, {}], // five rows, as the real customer has
    });
    // 1, not 5 — the count is the LAST resort, not the first answer
    expect(fields.rfFriends).toBe(1);
  });

  it('the panel`s `friends_count` still wins when both are present', () => {
    /* The safety argument for appending rather than replacing: a customer whose
       upstream sends the panel's spelling must read exactly what they read before
       this fallback existed. */
    const s = base();
    (s.bonus as Record<string, unknown>)['referral'] = { friends_count: 9 };
    (s.bonus as Record<string, unknown>)['friend_count'] = 1;
    expect(derive(s, { rfHistory: [{}, {}] }).rfFriends).toBe(9);
  });

  it('with neither name it still falls back to the row count', () => {
    const s = base();
    expect(derive(s, { rfHistory: [{}, {}, {}] }).rfFriends).toBe(3);
  });

  it('⭐ a point round row carries its prize in `note` on the live upstream', () => {
    const rows = resolveRows(
      [
        {
          date: 1778762825811,
          note: 'ได้รับของสมนาคุณจำนวน 5 เครดิต',
          reward_amount: 5,
          reward_type: 'credit',
        },
      ],
      SHOPAPI_V1_ROW_PATHS['pointRound']!,
    );
    expect(rows[0]?.['prize']).toBe('ได้รับของสมนาคุณจำนวน 5 เครดิต');
    expect(rows[0]?.['at']).toBe(1778762825811);
    /* ⚠️ `cost` stays undefined ON PURPOSE — `reward_amount` is what the round PAID
       OUT, and this column is what it COST. The charge lives in
       `activity.coin_spent`, a different list. A fallback here would print a
       reward as a charge. */
    expect(rows[0]?.['cost']).toBeUndefined();
  });

  it('the panel`s point round names still win over `note`', () => {
    const rows = resolveRows(
      [{ date: 1, prize: 'ของสมนาคุณใหญ่', note: 'ignored' }],
      SHOPAPI_V1_ROW_PATHS['pointRound']!,
    );
    expect(rows[0]?.['prize']).toBe('ของสมนาคุณใหญ่');
  });

  it('a normal string note still labels the row with the note itself', () => {
    /* The vacuity guard for the case above: if `|| '-'` were widened to replace
       every label, this would go red. */
    const s = base();
    (s.activity as Record<string, unknown>)['coin_received'] = [
      { amount: 3, at: 1, note: 'ฝากเงิน' },
    ];
    const view = buildShopapiV1View(derive(s));
    const coins = view.sections.find((x) => x.id === 'activity.coins');
    const labels = (coins as { items?: { label: string }[] }).items?.map(
      (i) => i.label,
    );
    expect(labels).toEqual(['ฝากเงิน']);
  });
});
