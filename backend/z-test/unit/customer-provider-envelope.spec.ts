/**
 * [FEAT-20260905-CUSTPROV] The envelope, proved end to end.
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` PART 7 §41
 *
 * Three of the plan's five proofs live here, and they are deliberately in ONE
 * file because they are one claim: *the answer is the same envelope whoever
 * produced it, and only `view` varies.*
 *
 *   §41.1  every provider's view validates against ONE schema — an unknown
 *          `type`, a missing or duplicate `id`, or an unlabelled section/row is
 *          refused (`providers/engine/validate-view.ts`).
 *   §41.2  `data` is byte-identical to the stored blob, whichever provider ran.
 *   §41.3  the fake-provider test — the definition of "easy to switch", and it
 *          adds NO front-end file. (§39: *"If the test needs an FE change, the
 *          design failed and this part is re-cut rather than patched."*)
 *
 * ## What this file does NOT prove
 * It says nothing about pixels. The section VALUES are
 * `customer-provider-view.spec.ts`'s job and are not re-asserted here; this file
 * is about the container. §41.4 (unset env ⇒ identical screen) is
 * `customer-provider.spec.ts`, unchanged.
 *
 * ## 🔴 A NOTE ON THE FAKE PROVIDER, because it is not driven by the env var
 * `CustomerProviderService.resolveAtBoot` reads the module-level
 * `CUSTOMER_PROVIDER_ENTRIES` — there is no seam to hand it a different list, and
 * widening the registry so a TEST could reach it would be paying real design
 * cost for a test's convenience. So the service is built through its own
 * prototype with `active` set to the fake, which is the idiom this repo already
 * uses for `MembersService`. The REAL `viewOf`, the REAL validator and the REAL
 * `stampedProfile` all run; only the resolution step is bypassed, and THAT step
 * is separately proven in `customer-provider.spec.ts` ("a second entry resolves
 * to itself, not to the default"). ไม่ขยาย registry เพื่อให้เทสผ่าน
 */
import {
  CustomerProviderService,
  DEFAULT_CUSTOMER_PROVIDER,
  SECTION_TYPES,
  composeFields,
  validateView,
  type CustomerProvider,
  type Section,
} from '@/modules/customer-provider';

// The service is not on the chat barrel, and putting it there to satisfy a test
// would widen that module's public surface for no runtime reason. Same exemption
// `customer-provider-stamp.spec.ts:27` already takes.
// eslint-disable-next-line no-restricted-imports
import { MembersService } from '@/modules/chat/members.service';

/* ────────────────────────────────────────────────────────────────────────────
   Fixtures
   ──────────────────────────────────────────────────────────────────────────── */

/** A section that passes every rule. Everything below is this, broken one way. */
const OK: Section = { id: 'ok', type: 'kv', label: 'ปกติ', rows: [] };

const sectionsOf = (input: readonly Section[]): readonly string[] =>
  validateView({ sections: input }).view.sections.map((s) => s.id);

const reasonsOf = (input: readonly Section[]): readonly string[] =>
  validateView({ sections: input }).problems.map((p) => p.reason);

/* ────────────────────────────────────────────────────────────────────────────
   §41.1 — one schema, and what it refuses
   ──────────────────────────────────────────────────────────────────────────── */

describe('[CUSTPROV/ENVELOPE] the schema refuses what tsc cannot see', () => {
  it('⭐ a clean view passes through untouched — no problems, same order', () => {
    const second: Section = { id: 'two', type: 'empty', label: 'ว่าง' };
    const out = validateView({ sections: [OK, second] });
    expect(out.problems).toEqual([]);
    expect(out.view.sections.map((s) => s.id)).toEqual(['ok', 'two']);
  });

  it('⭐ an UNKNOWN type is refused', () => {
    /* `as never` rather than a plain literal because the compiler does reject the
       literal — which is the point of the header's honesty note: this rule exists
       for the value that arrives through a cast or out of vendor data. */
    const bad = {
      id: 'weird',
      type: 'carousel',
      label: 'x',
    } as never as Section;
    expect(sectionsOf([OK, bad])).toEqual(['ok']);
    expect(reasonsOf([OK, bad])).toEqual(['unknown_type']);
  });

  it('⭐ a MISSING id is refused — React has nothing to key on', () => {
    const noId = { type: 'kv', label: 'x' } as never as Section;
    const blankId = { id: '   ', type: 'kv', label: 'x' } as never as Section;
    // Whitespace is not an id: it keys as reliably as an empty string does.
    expect(reasonsOf([noId, blankId])).toEqual(['missing_id', 'missing_id']);
  });

  it('⭐ a DUPLICATE id is refused, and the FIRST one survives', () => {
    /* Two sections sharing an id make the dashboard's key ambiguous: one card's
       collapse state drives the other's. Dropping both would punish a section
       that was correct when it was read. */
    const twin: Section = { id: 'ok', type: 'empty', label: 'ซ้ำ' };
    const out = validateView({ sections: [OK, twin] });
    expect(out.view.sections.map((s) => s.label)).toEqual(['ปกติ']);
    expect(out.problems.map((p) => `${p.reason}@${p.index}`)).toEqual([
      'duplicate_id@1',
    ]);
  });

  it('⭐ a section with NEITHER label nor labelKey is refused', () => {
    const bare = { id: 'bare', type: 'kv' } as never as Section;
    expect(reasonsOf([bare])).toEqual(['unlabelled_section']);
  });

  it('⭐ …and `label: ""` counts as absent, because a blank title draws nothing', () => {
    const blank: Section = { id: 'blank', type: 'kv', label: '  ' };
    expect(reasonsOf([blank])).toEqual(['unlabelled_section']);
  });

  it('either form on its own is enough — a labelKey alone passes', () => {
    // 14 of the panel's labels are i18n keys today and 17 are literals; both are
    // valid, which is why "at least one" is the rule rather than "label".
    const keyed: Section = { id: 'k', type: 'kv', labelKey: 'ticket.phone' };
    expect(reasonsOf([keyed])).toEqual([]);
  });

  it('⭐ an unlabelled ROW condemns its whole section', () => {
    /* Dropping just the row leaves a card that looks complete and is not — an
       admin reading a finance card with a row quietly removed concludes the
       customer never deposited. A missing card is visibly missing. */
    const bad: Section = {
      id: 'rows',
      type: 'kv',
      label: 'มีแถวไม่มีป้าย',
      rows: [{ label: 'ดี', value: 1 }, { value: 2 }],
    };
    expect(sectionsOf([OK, bad])).toEqual(['ok']);
    expect(reasonsOf([OK, bad])).toEqual(['unlabelled_item']);
  });

  it('an unlabelled ITEM, CHIP or BADGE is refused the same way', () => {
    const item: Section = {
      id: 'i',
      type: 'list',
      label: 'x',
      items: [{ value: 1 }],
    };
    const chip: Section = {
      id: 'c',
      type: 'kv',
      label: 'x',
      chips: [{ tone: 'ok' }],
    };
    const badge: Section = {
      id: 'b',
      type: 'kv',
      label: 'x',
      badge: [{ tone: 'off' }],
    };
    expect(reasonsOf([item, chip, badge])).toEqual([
      'unlabelled_item',
      'unlabelled_item',
      'unlabelled_item',
    ]);
  });

  it('⭐ `amountRows` are NOT required to carry a label — they have none by design', () => {
    /* `AmountRow` does not extend `Labelled` at all: it is a date, a signed
       amount and a status. A rule that demanded one would reject every finance
       and bonus card `shopapi_v1` emits, which is most of the panel. */
    const money: Section = {
      id: 'money',
      type: 'amount_rows',
      label: 'ประวัติฝาก',
      amountRows: [{ at: 1, amount: 50, sign: '+' }],
    };
    expect(reasonsOf([money])).toEqual([]);
  });

  it('⭐ a refusal DROPS, it does not throw — the rest of the panel still serves', () => {
    /* The policy argued in `validate-view.ts`: a 500 takes the whole customer
       away from an admin who cannot do anything about it; a missing card leaves
       them working. Three bad sections around two good ones. */
    const bad = (id: string) =>
      ({ id, type: 'nope', label: 'x' }) as never as Section;
    const out = validateView({
      sections: [
        bad('a'),
        OK,
        bad('b'),
        { id: 'z', type: 'empty', label: 'ท้าย' },
        bad('c'),
      ],
    });
    expect(out.view.sections.map((s) => s.id)).toEqual(['ok', 'z']);
    expect(out.problems).toHaveLength(3);
  });

  it('⭐ the accepted types ARE `SECTION_TYPES` — not a copy that can drift', () => {
    /* Every member of the exported set must pass, and the guard must be reading
       that set. A hand-written list here would prove nothing about the one the
       validator holds, so the input is generated FROM the export. */
    const all: Section[] = SECTION_TYPES.map((type, i) => ({
      id: `s${i}`,
      type,
      label: type,
    }));
    expect(validateView({ sections: all }).problems).toEqual([]);
    expect(sectionsOf(all)).toHaveLength(SECTION_TYPES.length);
  });

  it('a malformed view is contained, not thrown — the guard cannot be the outage', () => {
    // `as never` provider stubs are an established idiom here, so this is
    // reachable. A guard that died on bad input would cause the 500 it exists
    // to prevent.
    expect(validateView(undefined).view).toEqual({ sections: [] });
    expect(validateView({} as never).problems.map((p) => p.reason)).toEqual([
      'malformed_view',
    ]);
  });

  it('⭐ TODAY behaviour passes the schema clean — the guard is not a regression', () => {
    /* The whole point: `shopapi_v1` is the current screen, and if the schema
       refused any of its eight sections this change would be shipping a defect
       dressed as a guard. */
    const real = DEFAULT_CUSTOMER_PROVIDER.buildView(
      composeFields(DEFAULT_CUSTOMER_PROVIDER, {
        data: { profile: { finance: { balances: [] } } },
      }),
    );
    const out = validateView(real);
    expect(out.problems).toEqual([]);
    expect(out.view.sections).toHaveLength(real.sections.length);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   §41.3 — the fake provider, and §41.2 — `data` untouched
   ──────────────────────────────────────────────────────────────────────────── */

/** The stored blob, verbatim. Any drift in what comes back is a defect. */
const BLOB = {
  data: { profile: { name: 'real customer', tier: { code: 'gold' } } },
  extra: 'kept',
};

const OBJECT_ID = 'a0d000000000000000000049';

/** Two sections and nothing else — §39's definition of a switchable provider. */
const TWO_SECTIONS: readonly Section[] = [
  {
    id: 'zzz.one',
    type: 'kv',
    label: 'หนึ่ง',
    rows: [{ label: 'a', value: 1 }],
  },
  { id: 'zzz.two', type: 'empty', label: 'สอง', text: 'ว่างเปล่า' },
];

/**
 * A provider that shares NOTHING with `shopapi_v1` — different name, different
 * paths, a `buildView` that ignores the fields entirely.
 *
 * ⚠️ `sectionPaths.profile` is required by `resolveSections` (it is the marker
 * that picks the root), so even a provider that maps nothing declares it.
 */
const fakeProvider: CustomerProvider = {
  name: 'zzz_test',
  description: 'test-only entry proving a provider is one folder and one line',
  tierPaths: ['somewhere.else'],
  showTierBadge: false,
  showTierFilter: false,
  paths: {
    rootPaths: [''],
    sectionPaths: { profile: ['profile'] },
    fieldPaths: {},
  },
  deriveFields: () => ({}) as never,
  buildView: () => ({ sections: TWO_SECTIONS }),
};

/** The real service, with the resolution step bypassed — see the file header. */
const serviceFor = (provider: CustomerProvider) => {
  const warn = jest.fn();
  const svc = Object.create(
    CustomerProviderService.prototype,
  ) as CustomerProviderService;
  Object.assign(svc, {
    active: provider,
    logger: { warn, log: jest.fn() },
    reportedViewProblems: new Set<string>(),
  });
  return { svc, warn };
};

/** The real `MembersService.getRawProfile`, answering from a stubbed Mongo. */
const membersWith = (
  customerProvider: CustomerProviderService,
): MembersService => {
  const svc = Object.create(MembersService.prototype) as MembersService;
  Object.assign(svc, {
    customerProvider,
    memberModel: {
      findById: () => ({
        lean: () =>
          Promise.resolve({
            raw_profile_data: BLOB,
            profile_data_updated_at: new Date('2026-09-05T10:00:00Z'),
          }),
      }),
    },
    // The scope gate runs first and is not what this spec is about.
    ensureMemberInScope: () => Promise.resolve(undefined),
  });
  return svc;
};

describe('[CUSTPROV/ENVELOPE] §39 — a fake provider changes the answer and NOTHING else', () => {
  it('⭐⭐ the envelope carries exactly the fake provider’s two sections', async () => {
    /* THE ACCEPTANCE TEST FOR "EASY TO SWITCH". A provider is one object with a
       `buildView`; the response follows it. No route, no controller, no DTO, no
       i18n key — and, most of all, NO front-end file was added to make this
       pass. That is the property PART 7 exists to buy. */
    const { svc } = serviceFor(fakeProvider);
    const res = await membersWith(svc).getRawProfile(OBJECT_ID);

    expect(res['customer_provider']).toBe('zzz_test');
    expect(res['view']).toEqual({ sections: TWO_SECTIONS });
  });

  it('⭐ …exactly those, and nothing of `shopapi_v1` rides along', async () => {
    // "and nothing else" is half the claim: a switch that ADDED the fake's cards
    // to today's would look right on screen and be wrong.
    const { svc } = serviceFor(fakeProvider);
    const res = await membersWith(svc).getRawProfile(OBJECT_ID);
    const view = res['view'] as { sections: readonly Section[] };

    expect(view.sections.map((s) => s.id)).toEqual(['zzz.one', 'zzz.two']);
    expect(JSON.stringify(view)).not.toContain('finance');
    expect(JSON.stringify(view)).not.toContain('promotion');
  });

  it('⭐ the DEFAULT provider through the same door answers today’s cards', async () => {
    // Both halves of the switch, so "the fake wins" cannot be a stub that always
    // wins. The values are `customer-provider-view.spec.ts`'s job; the ids are
    // enough to tell the two providers apart.
    const { svc } = serviceFor(DEFAULT_CUSTOMER_PROVIDER);
    const res = await membersWith(svc).getRawProfile(OBJECT_ID);
    const view = res['view'] as { sections: readonly Section[] };

    expect(res['customer_provider']).toBe('shopapi_v1');
    expect(view.sections.map((s) => s.id)).toContain('finance.deposits');
    expect(view.sections.map((s) => s.id)).not.toContain('zzz.one');
  });

  it('⭐ a provider’s bad section is DROPPED on the way out and logged once', async () => {
    /* End to end: the guard runs where the plan says it must — on the way OUT of
       the back end — so the browser never receives the malformed section. */
    const rogue: CustomerProvider = {
      ...fakeProvider,
      buildView: () => ({
        sections: [
          TWO_SECTIONS[0]!,
          { id: 'zzz.bad', type: 'carousel', label: 'x' } as never,
        ],
      }),
    };
    const { svc, warn } = serviceFor(rogue);
    const res = await membersWith(svc).getRawProfile(OBJECT_ID);
    const view = res['view'] as { sections: readonly Section[] };

    expect(view.sections.map((s) => s.id)).toEqual(['zzz.one']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('unknown_type');
    // A drop nobody hears about is worse than a throw: the provider and the
    // offending id have to be in the line or it is not a bug report.
    expect(String(warn.mock.calls[0]?.[0])).toContain('zzz_test');
    expect(String(warn.mock.calls[0]?.[0])).toContain('zzz.bad');
  });

  it('⭐ …and it stays ONE line however many times the panel is opened', async () => {
    // The panel refetches on every room open. A WARN per admin per room is a log
    // nobody can read, which is the same as no log at all.
    const rogue: CustomerProvider = {
      ...fakeProvider,
      buildView: () =>
        ({ sections: [{ id: 'b', type: 'carousel', label: 'x' }] }) as never,
    };
    const { svc, warn } = serviceFor(rogue);
    const members = membersWith(svc);
    await members.getRawProfile(OBJECT_ID);
    await members.getRawProfile(OBJECT_ID);
    await members.getRawProfile(OBJECT_ID);

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('[CUSTPROV/ENVELOPE] §41.2 — `data` is the stored blob, whoever answered', () => {
  /**
   * 🔴 WHY `JSON.stringify` EQUALITY IS THE RIGHT COMPARISON HERE, and why it is
   * enough.
   *
   * The response is serialised to JSON before it reaches a browser, so
   * `JSON.stringify` is not an approximation of the wire — it IS the wire.
   * Anything two values can differ by that survives stringification is, by
   * definition, invisible to every client of this route.
   *
   * It is also STRICTER than `toEqual` in the direction that matters: `toEqual`
   * passes on reordered keys, and reordering is exactly what a "harmless" tidy-up
   * of the blob does first.
   *
   * Its known blind spots — `undefined` values, `Date` vs an ISO string, `Map` —
   * are covered by the assertion beside it: `toBe`, the same OBJECT REFERENCE
   * that came out of Mongo. A reshape has to build a new object, so reference
   * identity refuses every reshape there is. Together: `toBe` proves nothing was
   * rebuilt, `stringify` proves nothing the wire can see has moved.
   * เทียบทั้ง "ตัวเดียวกัน" และ "หน้าตาบนสาย"
   */
  it('⭐⭐ the fake provider cannot reshape `data` — byte for byte, same object', async () => {
    const { svc } = serviceFor(fakeProvider);
    const res = await membersWith(svc).getRawProfile(OBJECT_ID);

    expect(res['data']).toBe(BLOB); // never rebuilt
    expect(JSON.stringify(res['data'])).toBe(JSON.stringify(BLOB)); // never moved
  });

  it('⭐ the default provider cannot either — the rule is not per provider', async () => {
    const { svc } = serviceFor(DEFAULT_CUSTOMER_PROVIDER);
    const res = await membersWith(svc).getRawProfile(OBJECT_ID);

    expect(res['data']).toBe(BLOB);
    expect(JSON.stringify(res['data'])).toBe(JSON.stringify(BLOB));
  });

  it('⭐ the envelope has exactly the keys §36 names — no more, no fewer', async () => {
    /* The fixed half. `customer_provider` going missing is the failure the plan
       calls out by name (§41 proof 5), and a key silently APPEARING is how the
       front end learns something it was never meant to know. */
    const { svc } = serviceFor(fakeProvider);
    const res = await membersWith(svc).getRawProfile(OBJECT_ID);

    expect(Object.keys(res).sort()).toEqual([
      'customer_provider',
      'data',
      'profile_data_updated_at',
      'success',
      'view',
    ]);
  });

  it('a member with NO stored profile still answers a well-formed envelope', async () => {
    // `data: null` is a real row state (a customer who never registered), and the
    // panel must not have to special-case a missing `view`.
    const { svc } = serviceFor(DEFAULT_CUSTOMER_PROVIDER);
    const members = membersWith(svc);
    Object.assign(members, {
      memberModel: {
        findById: () => ({
          lean: () =>
            Promise.resolve({
              raw_profile_data: null,
              profile_data_updated_at: null,
            }),
        }),
      },
    });
    const res = await members.getRawProfile(OBJECT_ID);

    expect(res['data']).toBeNull();
    const view = res['view'] as { sections: readonly Section[] };
    expect(Array.isArray(view.sections)).toBe(true);
    expect(validateView(view).problems).toEqual([]);
  });
});
