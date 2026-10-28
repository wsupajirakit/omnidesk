/**
 * [FEAT-20260905-CUSTPROV] `view.sections` — today's cards, and the rules the
 * envelope must keep.
 *
 * ## What this proves and what it cannot
 * It proves the SHAPE and the VALUES: every section carries a label, every type
 * is in the closed set, the tab groups match the three tabbed cards on screen,
 * and each value traces to a field already proven equal to the panel's own
 * expression. It does NOT prove pixels — that arrives with the renderers, and
 * the panel's own DOM characterization test
 * (`omnidesk-console/test/personalPanelCards.dom.test.tsx`) is what will hold
 * them to it.
 *
 * 🔴 THE CLOSED SET IS THE DESIGN. A fifth `type` means an FE release, which is
 * the property this whole module exists to avoid. Two cases below hold the line
 * from both sides: one counts the set, so growing it is a decision somebody has
 * to make on purpose, and one asserts every declared type is actually EMITTED,
 * so the set cannot quietly carry a renderer nobody can reach. It was six until
 * 05/09 — see `view.types.ts` for the walk that removed `chips` and `raw`.
 */
import {
  CHIP_TONES,
  composeFields,
  DEFAULT_CUSTOMER_PROVIDER,
  isLabelled,
  SECTION_TYPES,
  type Section,
} from '@/modules/customer-provider';

const view = (blob: unknown) =>
  DEFAULT_CUSTOMER_PROVIDER.buildView(
    composeFields(DEFAULT_CUSTOMER_PROVIDER, blob),
  );

/** The mock upstream — sections beside `profile`, old field names. */
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
      recent_deposits: [
        { amount: 50, at: '2026-08-01T00:00:00Z', status: 'success' },
      ],
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
      coins: {
        balance: 30,
        history: [{ amount: 3, type: 'earn', note: 'ฝากเงิน' }],
      },
    },
    promotion: {
      current: 'PROMO A',
      outstanding: 3,
      top_products: [{ product: 'Mock Fashion', provider: 'MockCo', at: 2 }],
    },
  },
};

/** The real upstream — nested inside `profile`, new field names. */
const REAL = {
  data: {
    profile: {
      finance: {
        balances: [{ asset_code: 'credit', amount: 50085.46 }],
        is_auto_deposit: true,
        is_auto_withdraw: false,
        transactions: {
          deposit: [{ amount: 500, date: 1756684800000, status: 'success' }],
        },
      },
      bonus: {
        referral_history: [{ amount: 2 }, { amount: 3 }, { amount: 4 }],
      },
      activity: {
        coin_received: [{ amount: 5, date: 100 }],
        point_round_history: [{ reward: 'Free Round', coin_spent: 3 }],
      },
      promotion: {
        current_promotion_info: { name: 'PROMO REAL' },
        outstanding: { total: 33, fashion: 20 },
        recent_products: [
          {
            catalog_name: 'Real Target',
            product_name: 'RealCo',
            product_type: 'ELECTRONICS',
            played_at: 5,
          },
        ],
      },
    },
  },
};

const byId = (v: { sections: readonly Section[] }, id: string): Section => {
  const s = v.sections.find((x) => x.id === id);
  expect(`${id} present: ${s !== undefined}`).toBe(`${id} present: true`);
  return s!;
};

describe('[CUSTPROV/VIEW] the envelope rules every provider must keep', () => {
  /* 🔴 THE SET ITSELF, not a copy of it. This case used to hold its own array,
     which is the drift shape: the union could grow and the test would still
     pass while the dashboard had no renderer for the new member. */
  const ALLOWED: readonly string[] = SECTION_TYPES;

  it('⭐ every section uses a type from the CLOSED set', () => {
    for (const s of view(REAL).sections) {
      expect(`${s.id}:${ALLOWED.includes(s.type)}`).toBe(`${s.id}:true`);
    }
  });

  it('⭐ the closed set is FOUR — growing it is an FE release', () => {
    /* Not a style rule. A fifth type means the dashboard ships a new renderer,
       which is the one cost this design exists to remove.

       Was six until 05/09. `chips` and `raw` came off after walking the panel's
       eight cards: the ฝาก/ถอน chips are a card HEADER badge (still modelled, as
       `badge?: Chip[]`), and the JSON viewer renders the SITE-RULES payload, a
       different answer. Neither had an emitter, so both would have shipped a
       dead renderer to the dashboard. See `view.types.ts` for the walk. */
    expect(ALLOWED).toHaveLength(4);
  });

  it('⭐ every chip TONE is emitted too, and each one means ONE colour', () => {
    /* 🔴 THE COLLISION THIS CASE EXISTS FOR. `off` used to be emitted for both
       the RED `ฝาก: ปิด` chip and the GREY `ไม่มีโปรโมชั่น` chip. One token, two
       colours on the real screen — so the dashboard had to guess, and either
       guess is wrong somewhere: grey mutes a real alarm (deposits switched off
       reads as merely inactive) and red invents one (a customer with no
       promotion looks like a problem). Meanwhile `warn` had no emitter at all.
       Now: four tones, four colours, each with exactly one emitter. */
    /* ⚠️ THREE shapes, not two. Both fixtures carry a promotion, so `muted` —
       the "ไม่มีโปรโมชั่น" chip — only appears on a blob that has none. Walking
       just the two rich fixtures reported a tone as dead when it is not, which
       is the same mistake in the opposite direction from the one this case
       exists to catch. */
    const tones = new Set(
      [
        ...view(REAL).sections,
        ...view(MOCK).sections,
        ...view({ data: { profile: {} } }).sections,
      ]
        .flatMap((s) => s.badge ?? [])
        .map((c) => c.tone),
    );
    expect([...CHIP_TONES].sort()).toEqual([...tones].sort());
  });

  it('⭐ the promotion chips are info/muted — never the finance card’s red', () => {
    const withPromo = byId(view(MOCK), 'promotion').badge ?? [];
    expect(withPromo[0]?.tone).toBe('info');
    const without =
      byId(view({ data: { profile: {} } }), 'promotion').badge ?? [];
    expect(without[0]?.label).toBe('ไม่มีโปรโมชั่น');
    expect(without[0]?.tone).toBe('muted');
  });

  it('⭐ every type in the set is actually EMITTED — no dead renderers', () => {
    /* The rule that removed `chips` and `raw`, kept as a live gate rather than a
       paragraph. A type nobody emits is a renderer nobody can reach: FE weight
       with no BE consumer, which is the debt shape this module was written to
       avoid. Both vendor shapes are walked because `empty` only appears on one
       of them. ทุกชนิดต้องมีคนยิงจริง ไม่งั้นคือ renderer ตายเปล่า */
    const emitted = new Set(
      [
        ...view(REAL).sections,
        ...view(MOCK).sections,
        ...view({ data: { profile: { promotion: { recent_products: [] } } } })
          .sections,
      ].map((s) => s.type),
    );
    expect([...ALLOWED].sort()).toEqual([...emitted].sort());
  });

  it('⭐ every section and every row carries a label — a blank line is a bug', () => {
    /* 🔴 THE WIRE'S OWN PREDICATE, not a second opinion. This case used to ask
       `Boolean(label ?? labelKey)`, which is a DIFFERENT rule: `??` falls
       through only on null/undefined, so a section carrying `label: ''` beside a
       perfectly good `labelKey` read as unlabelled here and as labelled at the
       validator. It failed safe, but two rules for one word drift until one of
       them starts lying — and this one would have been the one to lie, because
       the validator is what actually refuses a section. */
    for (const s of view(REAL).sections) {
      expect(`${s.id} labelled: ${isLabelled(s)}`).toBe(
        `${s.id} labelled: true`,
      );
      for (const r of s.rows ?? []) {
        expect(`${s.id} row labelled: ${isLabelled(r)}`).toBe(
          `${s.id} row labelled: true`,
        );
      }
    }
  });

  it('⭐ an empty-string label with a good labelKey still counts as labelled', () => {
    // The exact disagreement the shared predicate removed. Pinned so the two
    // halves cannot drift apart again without a red test.
    expect(isLabelled({ label: '', labelKey: 'ticket.phone' })).toBe(true);
    expect(isLabelled({ label: '   ' })).toBe(false);
    expect(isLabelled({})).toBe(false);
  });

  it('⭐ every row and chip carries a stable KEY, and it is unique per section', () => {
    /* 🔴 THE KEY IS HOW A HAND-BUILT CARD FINDS ONE VALUE. The finance card puts
       `เครดิตคงเหลือ` in a grid cell, `ยอดฝากรวม` in a green strip and the history
       below — three different places, so it has to select. Matching on the LABEL
       would break the day a vendor renamed one or somebody translated it, which
       is exactly the coupling this module removes. Matching on POSITION would
       break the day a vendor omitted a row.
       A missing key is therefore not cosmetic: the card silently draws `-` where
       a real number belongs, and no exception is thrown. คีย์หาย = การ์ดโชว์ขีด */
    for (const s of [...view(REAL).sections, ...view(MOCK).sections]) {
      /* ⚠️ UNIQUE WITHIN A COLLECTION, not across the section. `rows` and
         `badge` are separate lists and a card selects from one of them, so the
         promotion card's chip and its row may both be keyed `promoName` — and
         SHOULD be, because they are the same value in two places. Checking
         across the whole section reported that as a collision when it is the
         port vocabulary working correctly. */
      for (const group of [s.rows ?? [], s.badge ?? []]) {
        const keys: string[] = [];
        for (const r of group) {
          expect(
            `${s.id} keyed: ${typeof r.key === 'string' && r.key.length > 0}`,
          ).toBe(`${s.id} keyed: true`);
          keys.push(r.key!);
        }
        expect(`${s.id} unique: ${keys.length}`).toBe(
          `${s.id} unique: ${new Set(keys).size}`,
        );
      }
    }
  });

  it('⭐ the promotion chip and its row share ONE key — same value, same name', () => {
    // Two places on screen, one fact. A card asking either collection for
    // `promoName` gets the promotion's name, which is the point of a port
    // vocabulary: the name follows the MEANING, not the widget.
    const s = byId(view(MOCK), 'promotion');
    expect(s.badge?.[0]?.key).toBe('promoName');
    expect(s.rows?.[0]?.key).toBe('promoName');
  });

  it('⭐ the two promotion tables never collide on a shared product key', () => {
    /* A vendor can send `fashion` to BOTH activity volume and outstanding. Bare keys would
       give the promotion section two rows called `fashion` and no way to tell which
       table each belongs to — the prefix is what makes them selectable. */
    const rows =
      view({
        data: {
          profile: {},
          promotion: {
            activity_volume_done: { fashion: 1 },
            activity_volume_required: { fashion: 2 },
            outstanding: { fashion: 3 },
          },
        },
      }).sections.find((s) => s.id === 'promotion')?.rows ?? [];
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('activity_volume:fashion');
    expect(keys).toContain('outstanding:fashion');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('⭐ section ids are unique — the dashboard keys React on them', () => {
    const ids = view(REAL).sections.map((s) => s.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it('a blob with nothing in it still answers a well-formed view', () => {
    // No profile at all ⇒ every field falls back ⇒ sections still valid, so the
    // dashboard never has to special-case an absent `view`.
    const v = view({});
    expect(v.sections.length).toBeGreaterThan(0);
    for (const s of v.sections) expect(ALLOWED).toContain(s.type);
  });
});

describe('[CUSTPROV/VIEW] the three tabbed cards keep their tabs', () => {
  it('⭐ finance, bonus and activity each group exactly two sections', () => {
    // The screen has tabs on these three today. A `view` that flattened them
    // would be a visible change dressed up as a refactor.
    const groups = new Map<string, string[]>();
    for (const s of view(REAL).sections) {
      if (!s.group) continue;
      groups.set(s.group, [...(groups.get(s.group) ?? []), s.id]);
    }
    expect(groups.get('finance')).toEqual([
      'finance.deposits',
      'finance.withdrawals',
    ]);
    expect(groups.get('bonus')).toEqual(['bonus.cashback', 'bonus.referral']);
    expect(groups.get('activity')).toEqual([
      'activity.coins',
      'activity.point_round',
    ]);
  });

  it('the products and promotion cards are NOT grouped — they have no tabs today', () => {
    expect(byId(view(REAL), 'products').group).toBeUndefined();
    expect(byId(view(REAL), 'promotion').group).toBeUndefined();
  });
});

describe('[CUSTPROV/VIEW] the mock upstream, value for value', () => {
  const v = view(MOCK);

  it('⭐ finance: the numbers and BOTH auto badges', () => {
    const dep = byId(v, 'finance.deposits');
    expect(dep.rows?.map((r) => r.value)).toEqual([100, 20, 900]);
    // 'enabled' / 'disabled' are STRINGS on this shape — the chips must disagree.
    expect(dep.badge?.map((c) => `${c.label}/${c.tone}`)).toEqual([
      'ฝาก: เปิด/ok',
      'ถอน: ปิด/off',
    ]);
    /* 🔴 `off` here means RED. It is a different token from the GREY chip on the
       promotion card, and that separation is the point — a customer whose
       deposits are switched off must not read as merely inactive. */
    expect(dep.amountRows).toEqual([
      { at: '2026-08-01T00:00:00Z', amount: 50, sign: '+', status: 'success' },
    ]);
  });

  it('withdrawals carry the minus sign and their own total', () => {
    const wd = byId(v, 'finance.withdrawals');
    expect(wd.rows?.[0]?.value).toBe(400);
    expect(wd.amountRows?.[0]?.sign).toBe('-');
  });

  it('bonus: pending, claimed, and the friend COUNT', () => {
    expect(byId(v, 'bonus.referral').rows?.map((r) => r.value)).toEqual([
      1, 10, 7,
    ]);
  });

  it('⭐ a coin row reads its TEXT from `note`, not from the type default', () => {
    // The truthy chain lives in this composer, not in the path table, because
    // `''` must fall through and the fallback depends on `type`.
    expect(byId(v, 'activity.coins').items?.[0]?.label).toBe('ฝากเงิน');
  });

  it('⭐ with no text keys at all, the default is chosen by `type` — both ways', () => {
    /* Added after a mutation SURVIVED: replacing the type-driven default with a
       constant 'ได้รับ' changed nothing, because every fixture carried a `note`.
       A spend row rendering "ได้รับ" is a customer being told they received
       coins they spent. Both branches are pinned now. */
    const both = view({
      data: {
        profile: {},
        activity: {
          coins: {
            history: [
              { amount: 3, type: 'earn' },
              { amount: 2, type: 'spend' },
            ],
          },
        },
      },
    });
    expect(byId(both, 'activity.coins').items?.map((i) => i.label)).toEqual([
      'ได้รับ',
      'ใช้ไป',
    ]);
  });

  it('⭐ an EMPTY-STRING note falls through — that is why it is `||`, not `??`', () => {
    // `??` here would print a blank row where the panel prints "ได้รับ".
    const blank = view({
      data: {
        profile: {},
        activity: {
          coins: { history: [{ amount: 1, type: 'earn', note: '' }] },
        },
      },
    });
    expect(byId(blank, 'activity.coins').items?.[0]?.label).toBe('ได้รับ');
  });

  it('⭐ a SCALAR outstanding produces the single summary row', () => {
    const rows = byId(v, 'promotion').rows ?? [];
    expect(rows.some((r) => r.label === 'Outstanding' && r.value === 3)).toBe(
      true,
    );
  });

  it('⭐ with no per-product activity volume the SUMMARY row is still emitted', () => {
    /* Added 05/09 after walking the card's second branch. The first revision of
       `build-view.ts` emitted activity volume rows ONLY from `promoToBreakdown`, so on
       this upstream — which sends activity volume as one number — the view carried NO
       activity volume row while the card drew one. A section one row short of the
       screen it claims to describe. ต้องเดินทั้งสองสาขา ไม่ใช่สาขาที่ข้อมูลสวย */
    const rows = byId(v, 'promotion').rows ?? [];
    const summary = rows.find((r) => r.label?.startsWith('Activity volume'));
    expect(`summary row: ${summary !== undefined}`).toBe('summary row: true');
    // No `activity_volume.unit` on this blob ⇒ the literal the card falls back to.
    expect(summary?.label).toBe('Activity volume (activity volume)');
  });
});

describe('[CUSTPROV/VIEW] activity volume travels as a PAIR, because a colour depends on it', () => {
  const withActivityVolume = (activityVolume: unknown) =>
    view({
      data: { profile: {}, promotion: { activity_volume: activityVolume } },
    });

  it('⭐ done and required stay two values — flattening them loses the colour', () => {
    /* The card colours `done` by comparing it with `required` (`xpActivityTone`).
       An earlier revision emitted the string `'12 / 100'`: same characters on
       screen, comparison gone, so a customer who had MET their activity volume and one
       who had not would have rendered the same colour. This case is what stops
       that being re-introduced as a tidy-up. */
    const row = (
      withActivityVolume({ done: 12, required: 100 }).sections.find(
        (s) => s.id === 'promotion',
      )?.rows ?? []
    ).find((r) => r.label?.startsWith('Activity volume'));
    expect(row?.value).toBe(12);
    expect(row?.target).toBe(100);
    expect(typeof row?.value).toBe('number');
  });

  it('the unit names the row and the percent rides as a suffix', () => {
    const row = (
      withActivityVolume({
        done: 1,
        required: 2,
        unit: 'บาท',
        percent: 50,
      }).sections.find((s) => s.id === 'promotion')?.rows ?? []
    ).find((r) => r.label?.startsWith('Activity volume'));
    expect(row?.label).toBe('Activity volume (บาท)');
    expect(row?.suffix).toBe('(50%)');
  });

  it('⭐ a NON-NUMERIC percent produces no suffix at all, never "(NaN%)"', () => {
    // `typeof === 'number'` is the gate the card uses; a vendor sending "50%"
    // as a string must not print `(50%%)` or `(NaN%)` on a customer's card.
    const row = (
      withActivityVolume({ done: 1, required: 2, percent: '50' }).sections.find(
        (s) => s.id === 'promotion',
      )?.rows ?? []
    ).find((r) => r.label?.startsWith('Activity volume'));
    expect(row?.suffix).toBeUndefined();
  });

  it('⭐ per-product rows carry the pair too, and then there is NO summary row', () => {
    /* ⚠️ The per-product breakdown does NOT live under `activity_volume` — it is the union
       of two SIBLING objects, `activity_volume_done` and `activity_volume_required`, keyed by
       product type. Writing this case against the wrong shape is what surfaced the
       distinction, and the vector is kept in the real shape rather than tidied
       so the next reader sees the two-object union for what it is. */
    const rows =
      view({
        data: {
          profile: {},
          promotion: {
            activity_volume_done: { fashion: 3 },
            activity_volume_required: { fashion: 9 },
          },
        },
      }).sections.find((s) => s.id === 'promotion')?.rows ?? [];
    const fashion = rows.find((r) => r.label === 'fashion');
    expect(fashion?.value).toBe(3);
    expect(fashion?.target).toBe(9);
    // Two views of one number would be two places for it to disagree.
    expect(rows.some((r) => r.label?.startsWith('Activity volume'))).toBe(
      false,
    );
  });
});

describe('[CUSTPROV/VIEW] the real upstream resolves through its own names', () => {
  const v = view(REAL);

  it('⭐ credit comes out of balances[] — the defect the mapping was written for', () => {
    expect(byId(v, 'finance.deposits').rows?.[0]?.value).toBe(50085.46);
  });

  it('⭐ is_auto_deposit is a BOOLEAN here and the chips still disagree', () => {
    expect(byId(v, 'finance.deposits').badge?.map((c) => c.tone)).toEqual([
      'ok',
      'off',
    ]);
  });

  it('⭐ friends_count is absent ⇒ the ROW COUNT, not 0', () => {
    const rows = byId(v, 'bonus.referral').rows ?? [];
    expect(rows[2]?.value).toBe(3);
  });

  it('⭐ an OBJECT outstanding becomes per-product rows, not one summary', () => {
    const rows = byId(v, 'promotion').rows ?? [];
    expect(rows.some((r) => r.label === 'fashion' && r.value === 20)).toBe(
      true,
    );
    expect(rows.some((r) => r.label === 'Outstanding')).toBe(false);
  });

  it('⭐ a product row reads the vendor names and joins provider · type', () => {
    const item = byId(v, 'products').items?.[0];
    expect(item?.label).toBe('Real Target');
    expect(item?.secondary).toBe('REALCO · ELECTRONICS');
  });

  it('⭐ the point round HISTORY is carried; the round COUNT is not and cannot be', () => {
    // The count needs the site-rules `spend_amount`, a different payload.
    const pointRound = byId(v, 'activity.point_round');
    expect(pointRound.items?.[0]?.label).toBe('Free Round');
    expect(JSON.stringify(v)).not.toContain('rounds'); // the count key, renamed with the upstream (was the plural of the old word)
  });
});

describe('[CUSTPROV/VIEW] what stays OUT, asserted rather than commented', () => {
  it('⭐ no customer-info section — those values are not this provider’s to give', () => {
    // `profile.phone`, `member_id`, `bank.*` are still read inline in the panel
    // and are not among the 26 fields. Emitting a section for them would mean
    // inventing values. The census in `customer-provider-fields.spec.ts` is what
    // keeps that gap visible instead of forgotten.
    const ids = view(REAL).sections.map((s) => s.id);
    expect(ids).not.toContain('customer');
    expect(ids).not.toContain('profile');
    expect(JSON.stringify(view(REAL))).not.toContain('truewallet');
  });

  it('⭐ the products card survives an empty list instead of vanishing', () => {
    // `[FIX-20260801-GAMESEMPTY]` — it used to disappear on `recent_products: []`,
    // which moved every card below it depending on the customer.
    const g = byId(
      view({ data: { profile: { promotion: { recent_products: [] } } } }),
      'products',
    );
    expect(g.type).toBe('empty');
    expect(g.text).toBe('ยังไม่มีสินค้าที่ซื้อล่าสุด');
  });
});
