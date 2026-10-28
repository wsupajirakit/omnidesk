/**
 * 📖 DOC: `docs/flow/ticket-and-customer-provider-flow.md` §4 — the vocabulary (four
 * section types, four chip tones, the row `key`) and §7, the rules that stop it
 * growing. Adding anything here without reading §7 is how a closed set stops
 * being closed.
 *
 * [FEAT-20260905-CUSTPROV] `view` — the ONE varying part of the answer.
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` (PART 7)
 *
 * ## The whole design, in one paragraph
 * Every profile route answers the same envelope: same route, same method, same
 * auth, same cache, same `data` (the raw blob, untouched). `view` is the only
 * part that varies by provider, and it describes WHAT TO DRAW using a CLOSED set
 * of section types. The dashboard knows the types; it never learns a vendor's
 * name or a vendor's field names. That is what makes adding provider B a
 * back-end-only change. เพิ่มเจ้าใหม่ = แก้ BE อย่างเดียว
 *
 * ## 🔴 THE TYPE LIST IS CLOSED, AND EVERY ENTRY HAS AN EMITTER TODAY
 * Not one type here was invented for a future that has not arrived —
 * `field-options.registry.ts:25-29` rules that out: *"'flexible' is where
 * speculative machinery gets in… Add them on the day a second entry actually
 * needs one."* Each was read off the current screen AND is emitted by
 * `build-view.ts` right now:
 *
 *   kv           โปรโมชั่น — label/value rows
 *   list         สินค้าที่ซื้อล่าสุด, เหรียญ, รอบสะสมแต้ม — a title with a trailing value
 *   amount_rows  ประวัติฝาก/ถอน, เงินคืน, แนะนำเพื่อน — dated signed amounts
 *   empty        สินค้าที่ซื้อล่าสุด with nothing in it → "ยังไม่มีสินค้าที่ซื้อล่าสุด"
 *
 * ## 🔴 WHY THIS IS FOUR AND NOT THE SIX THE PLAN'S TABLE LISTS
 * PART 7 §37 tabulates six, and two of them were dropped on 05/09 after the
 * panel's eight cards were walked one by one. The table was counting cards, not
 * emitters, and it over-counted:
 *
 *   · `chips` — the ฝาก/ถอน pair is drawn in the CARD HEADER, and this file
 *     already models that as `badge?: Chip[]` on a section (`Chip` is very much
 *     alive). There is no card whose BODY is a row of chips. The remaining
 *     candidate, the tier badge, belongs to PART 4 and to `tierPaths`.
 *   · `raw` — the JSON viewer is the "ข้อมูลเว็บ" card, which renders the
 *     SITE-RULES payload (`GET /api/hooks/:hookId/site-rules`), not the customer
 *     blob. A different answer entirely. The other `<pre>` on this panel is the
 *     debug modal inside "รอทำรายการ", a card deliberately not emitted at all.
 *
 * Keeping them would have shipped two renderers on the dashboard that no
 * provider output can ever reach — the exact dead weight this module's own rule
 * above forbids, and it would have made the count below dishonest. When
 * site-rules gains a view, `raw` arrives WITH its renderer and its test, which
 * is the documented process rather than a shortcut around it.
 * ไม่มีใครยิง = ยังไม่ใส่ · ใส่วันที่มีคนใช้จริง พร้อม renderer และเทส
 *
 * A provider composes THESE. Adding a fifth is an FE release, so the count of
 * them is the honest measure of whether this design is holding. The dashboard
 * renders an unknown `type` as a visible, labelled fallback (PART 7 §40), so a
 * provider that emits one is degraded, never blank.
 *
 * ## Why LABEL and LABEL_KEY both exist — measured, not preferred
 * Counted on the current panel (05/09): **17 labels are Thai literals in the
 * code** (6 card titles, 9 tab labels, 2 rows) and **14 go through `t('ticket.*')`**
 * with real th/en values. Both forms are on screen today.
 *
 *   · `labelKey` — for the 14 that already translate. Sending a literal instead
 *     would be a REGRESSION: an admin on English sees `Phone` today and would
 *     start seeing `เบอร์โทร`.
 *   · `label` — for everything else, and for every NEW vendor. A vendor that
 *     invents a card called "กระเป๋าเงิน" ships that string and it appears. If
 *     titles were keys only, that vendor would need an FE release to add the
 *     key — which is precisely the property this design exists to remove.
 *
 * The front end prefers `labelKey` when it resolves and falls back to `label`.
 * Neither present ⇒ the row is not drawn, because a blank label is a bug that
 * looks like a design. สองแบบเพราะจอวันนี้มีสองแบบจริง ไม่ได้เผื่ออนาคต
 *
 * revert: delete this file and `build-view.ts`; the payload goes back to
 *         carrying only `customer_provider` (git 105122c).
 */

/** The closed set. Adding one is an FE release — see the header. */
export type SectionType = 'kv' | 'list' | 'amount_rows' | 'empty';

/**
 * The same four, as a value the specs and the envelope validator can iterate.
 *
 * 🔴 ONE DEFINITION, NOT TWO. A hand-written array beside a union is the shape
 * that drifts: the union gains a member, the array does not, and the validator
 * starts rejecting a type the compiler accepts — silently, because both halves
 * still compile on their own. The two assertions below close it in BOTH
 * directions, at build time, with no runtime cost:
 *
 *   · `satisfies` — nothing in the array is outside the union.
 *   · `SectionTypesAreExhaustive` — nothing in the union is missing from the
 *     array. Add a fifth `SectionType` without listing it here and tsc fails on
 *     that line with the missing member named.
 */
export const SECTION_TYPES = [
  'kv',
  'list',
  'amount_rows',
  'empty',
] as const satisfies readonly SectionType[];

/**
 * Compile-time only. Resolves to `true` while the two agree; the day they do
 * not, it resolves to the UNLISTED member and tsc rejects the assignment,
 * naming it. Exported so no lint rule can decide it is unused and delete the
 * guard along with it.
 */
export type SectionTypesAreExhaustive =
  Exclude<SectionType, (typeof SECTION_TYPES)[number]> extends never
    ? true
    : Exclude<SectionType, (typeof SECTION_TYPES)[number]>;
export const SECTION_TYPES_ARE_EXHAUSTIVE: SectionTypesAreExhaustive = true;

/**
 * One label, in whichever of the two forms the value actually has today.
 *
 * 🔴 NOT BOTH-OPTIONAL-BY-ACCIDENT. A section or row with neither is not drawn;
 * `build-view.spec.ts` asserts every emitted item carries at least one, so an
 * unlabelled row cannot reach a browser and render as a blank line.
 */
export interface Labelled {
  /** An i18n key the dashboard already has, e.g. `ticket.phone`. Preferred. */
  readonly labelKey?: string;
  /** A literal, for labels that are literals today and for new vendors. */
  readonly label?: string;
}

/**
 * A stable identifier for one row or chip, independent of what it is CALLED.
 *
 * 🔴 WHY THIS IS NOT THE LABEL. A hand-built card has to find a particular value
 * — the finance card puts `เครดิตคงเหลือ` in a grid cell, `ยอดฝากรวม` in a green
 * strip and the history below, three different places. Matching on the label to
 * find them would make a card break the moment a vendor renamed one, or the day
 * somebody translated it, which is the coupling this whole module removes.
 * Matching on POSITION would break the moment a vendor omitted a row.
 *
 * The key is the provider port's own vocabulary — `finCredit`, `cbPending` —
 * shared by every provider because it is the PORT's name, never a vendor's. A
 * new vendor fills `field-paths.ts` with the same keys and different paths, and
 * the dashboard needs no release. That is the entire point.
 * key = ชื่อของ port ไม่ใช่ชื่อของเจ้าไหน · ป้ายไว้โชว์ key ไว้หา
 *
 * Optional, because a generic card drawn by the primitive renderers has nothing
 * to look anything up BY — it renders whatever it is given, in order.
 */
export interface Keyed {
  readonly key?: string;
}

/** `kv` — a label/value row. `copy` draws the copy button that exists today. */
export interface KvRow extends Labelled, Keyed {
  readonly value: unknown;
  readonly copy?: boolean;
  /** Renders as `-` when absent; the panel already does this everywhere. */
  readonly mono?: boolean;
  /**
   * The value's TARGET, when the row is progress rather than a plain number.
   *
   * 🔴 ADDED 05/09 FROM A MEASUREMENT, NOT A GUESS. The โปรโมชั่น card draws
   * activity volume as `done / required` and colours `done` by comparing it to
   * `required` (`xpActivityTone`). An earlier revision flattened the pair into the
   * string `'12 / 100'`, which renders the same characters and loses the
   * comparison — the row would have gone grey for a customer who has met their
   * activity volume and grey again for one who has not. Two values in, one decision on
   * the FE, no rule moved. ค่าคู่ต้องส่งคู่ ไม่งั้นสีหาย
   */
  readonly target?: unknown;
  /**
   * A short trailing note beside the value, e.g. the `(87%)` the activity volume row
   * shows when the upstream sends a percentage. Absent ⇒ nothing is drawn, so a
   * vendor that omits it produces the screen that vendor's data describes.
   */
  readonly suffix?: string;
}

/**
 * A short badge. Drawn in a card HEADER (`Section.badge`) — there is no section
 * whose body is a row of chips, which is why `chips` is not a `SectionType`.
 *
 * ## 🔴 ONE TOKEN PER COLOUR, AFTER A COLLISION WAS FOUND (05/09)
 * The first set was `ok | warn | off | neutral`, and it did not survive contact
 * with the screen. `off` was emitted for TWO different chips that are two
 * different colours today:
 *
 *   ฝาก: ปิด            RED    `text-red-700 bg-red-100 border-red-200`
 *   ไม่มีโปรโมชั่น        GREY   `text-gray-500 bg-gray-100 border-gray-200`
 *
 * A dashboard cannot pick between them from one token, so whichever it chose
 * would have been wrong somewhere: grey for `ฝาก: ปิด` mutes a real alarm — a
 * customer whose deposits are switched off would look merely inactive — and red
 * for `ไม่มีโปรโมชั่น` invents an alarm out of an ordinary state. Meanwhile
 * `warn` (amber) had no emitter at all, so the set was one token short in one
 * place and one too many in another.
 *
 * Four tokens, four colours, each with exactly one emitter today:
 *
 *   ok      GREEN  ฝาก/ถอน: เปิด — a switch that is on
 *   off     RED    ฝาก/ถอน: ปิด — a switch that is OFF, and that is worth seeing
 *   info    BLUE   🎟 the promotion name — a fact, not a state
 *   muted   GREY   ไม่มีโปรโมชั่น — the ordinary absence of a thing
 *
 * `off` means the alarming kind of off; `muted` means "nothing here". Keeping
 * them apart is the whole point, so do not collapse them back into one.
 * หนึ่ง token หนึ่งสี ไม่งั้นปลายทางต้องเดา และเดาผิดที่ใดที่หนึ่งเสมอ
 */
export interface Chip extends Labelled, Keyed {
  readonly tone: 'ok' | 'off' | 'info' | 'muted';
}

/**
 * The same four as a value, so a spec can assert every one is emitted rather
 * than trusting the union. Closed in both directions, exactly as
 * `SECTION_TYPES` is — a tone with no emitter is a colour the dashboard carries
 * for nobody.
 */
export const CHIP_TONES = [
  'ok',
  'off',
  'info',
  'muted',
] as const satisfies readonly Chip['tone'][];
export type ChipTonesAreExhaustive =
  Exclude<Chip['tone'], (typeof CHIP_TONES)[number]> extends never
    ? true
    : Exclude<Chip['tone'], (typeof CHIP_TONES)[number]>;
export const CHIP_TONES_ARE_EXHAUSTIVE: ChipTonesAreExhaustive = true;

/** `list` — a title with a trailing value, and optional secondary text. */
export interface ListItem extends Labelled, Keyed {
  readonly value?: unknown;
  readonly secondary?: string;
  readonly image?: string;
  /**
   * A money figure carried BESIDE `value`, because the สินค้าที่ซื้อล่าสุด row
   * prints both: `value` is when it was bought and `amount` is the amount spent, drawn
   * only when the upstream sends one (`{g.amount ? ' · …' : ''}` today).
   * Folding them into one field would have made a product with no amount print a
   * stray separator, and a product with no timestamp print its amount as a date.
   */
  readonly amount?: unknown;
  /**
   * The RAW timestamp, unformatted.
   *
   * `secondary` already carries a rendered form for the generic renderer, but a
   * hand-built card formats time its own way — `xpDT` splits epoch SECONDS from
   * epoch MILLISECONDS by magnitude, and a value that has been through
   * `String()` and back has lost nothing but is a needless round trip. More
   * importantly, a card that had to parse `secondary` would be reading a display
   * string as data, which is how a label change becomes a broken card.
   */
  readonly at?: unknown;
  /**
   * The direction of `value` — `'+'` received, `'-'` spent.
   *
   * The เหรียญ card colours a row green or red and prefixes the sign from it.
   * Without this the card would have to re-derive the direction from a vendor's
   * `type` field, which is exactly the vendor coupling being removed here.
   */
  readonly sign?: '+' | '-';
  /**
   * The PARTS `secondary` was joined from, still separate.
   *
   * 🔴 NOT A DUPLICATE OF `secondary`, and the difference is load-bearing. The
   * สินค้าที่ซื้อล่าสุด card renders `PROVIDER · TYPE` as one badge — that is
   * `secondary` — but it ALSO builds a two-letter initials block from the
   * provider ALONE when a product's image fails to load. Splitting a joined string
   * back apart would work until a provider name contained the separator, and
   * falling back to the joined string gives the wrong two letters whenever the
   * provider is missing. Joined for the generic renderer, separate for the card
   * that needs a part. ต่อไว้ให้ตัวกลางวาด แยกไว้ให้การ์ดที่ต้องใช้ชิ้นเดียว
   */
  readonly tags?: readonly string[];
}

/** `amount_rows` — a dated row with a signed amount and an optional status. */
export interface AmountRow {
  readonly at: unknown;
  readonly amount: unknown;
  readonly sign: '+' | '-';
  readonly status?: unknown;
}

export interface Section extends Labelled {
  /** Stable across providers so the dashboard can key React on it. */
  readonly id: string;
  readonly type: SectionType;
  /**
   * Sections sharing a `group` are drawn as TABS of one card, in array order.
   *
   * 🔴 ONE OPTIONAL STRING, NOT A SEVENTH TYPE. Three cards on screen today use
   * tabs — การเงิน (ฝาก/ถอน), โบนัส (เงินคืน/แนะนำเพื่อน), กิจกรรม
   * (เหรียญ/รอบสะสมแต้ม) — so a `view` without this concept could not reproduce the
   * current screen at all. The alternatives were nesting sections inside
   * sections, or a `tabs` type whose payload is a list of sections; both make
   * every renderer recursive to express something that is a grouping, not a
   * shape. เป็นการจัดกลุ่ม ไม่ใช่ชนิดใหม่
   *
   * A group of one renders as a plain card, so a provider that has no tabs never
   * writes this field.
   */
  readonly group?: string;
  /** Cards ship collapsed today except ข้อมูลลูกค้า — that is a measurement. */
  readonly collapsed?: boolean;
  readonly badge?: readonly Chip[];
  readonly rows?: readonly KvRow[];
  readonly chips?: readonly Chip[];
  readonly items?: readonly ListItem[];
  readonly amountRows?: readonly AmountRow[];
  /** `empty` and `raw` carry their message / payload here. */
  readonly text?: string;
  readonly raw?: unknown;
}

export interface CustomerView {
  readonly sections: readonly Section[];
}
