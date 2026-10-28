/**
 * [FEAT-20260905-CUSTPROV] The envelope guard — ONE schema, every provider.
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §40 (the honest cost) and §41 proof 1.
 *
 * ## Why this file exists at all
 * §40 states the price of a 100% dynamic view plainly: *"TypeScript stops
 * checking card content. `view` is data, so a section whose rows do not match
 * its `type` fails at runtime, not at build."* This is the mitigation it names —
 * the envelope is validated on the way OUT of the back end, so a malformed
 * section never reaches a browser. หน้าบ้านต้องไม่เคยเห็นของเสีย
 *
 * ## What tsc already covers, and what it demonstrably does not
 * Being honest about the overlap, because a guard that only repeats the compiler
 * is dead weight:
 *
 *   · `type` — the compiler DOES reject a literal outside `SectionType`. It does
 *     not reject `x as SectionType`, and `as never` is already an established
 *     idiom for provider stubs in this repo (`customer-provider.spec.ts:126`).
 *     A value computed from a vendor blob and cast is the reachable case.
 *   · a MISSING `id` — same: reachable through a cast or a value read from data.
 *   · a DUPLICATE `id` — no type system in this language can see it. Two sections
 *     sharing an id make the dashboard's React key ambiguous: one card's
 *     collapse state drives the other's, and rows appear under the wrong title.
 *   · a section or row with NEITHER `label` NOR `labelKey` — both are optional by
 *     design (`view.types.ts` measured 17 literals against 14 keys on the current
 *     panel), so "at least one" is a rule only a runtime check can hold.
 *
 * Three of the five rules are therefore beyond the compiler entirely, and the
 * other two survive a cast. ตัวตรวจนี้ไม่ได้ทำงานซ้ำกับ tsc
 *
 * ## 🔴 THE REJECTION POLICY: DROP THE SECTION, SERVE THE REST, SAY SO
 *
 * The alternative considered and REJECTED was to throw, which becomes a 500 on
 * the customer's panel. The deciding question is the one an operator has to live
 * with: WHICH FAILURE CAN AN ADMIN RECOVER FROM?
 *
 *   · throw ⇒ the whole profile answer dies, including `data` — which is the raw
 *     blob, is correct, and had nothing to do with the bad section. The admin
 *     cannot see the customer at all, cannot work the ticket, and there is no
 *     action available to them: the fix is a back-end deploy. One bad card takes
 *     the room down.
 *   · drop ⇒ one card is missing, everything else on the panel draws, `data` is
 *     untouched, and the admin keeps working. A WARN naming the provider, the
 *     section and the reason is what turns it into a bug report.
 *
 * The dashboard already made the same trade for the same reason: §40 has it
 * render an unknown `type` as a visible labelled fallback rather than a blank
 * space. A back end that answered 500 where the front end degrades would be the
 * two halves disagreeing about how this system fails.
 *
 * ⚠️ DROPPING IS NOT SILENCE. `problems` is returned in full to the caller, and
 * `CustomerProviderService.viewOf` logs each distinct reason once per process.
 * A drop nobody hears about is worse than a throw. ตัดทิ้งได้ แต่ต้องดัง
 *
 * ⚠️ It never sees `data`. This validator is handed a `view` and nothing else, so
 * it cannot reshape the stored blob even by accident — the property
 * `customer-provider-envelope.spec.ts` byte-compares on every answer. §41 proof 1
 * is this file; §41 proof 2 is that byte-compare, and they are deliberately
 * separate checks over separate inputs.
 *
 * revert: in `customer-provider.service.ts`, make `viewOf` return
 *         `this.active.buildView(this.fieldsOf(blob))` again and delete this
 *         file. Nothing else imports it.
 */

import {
  SECTION_TYPES,
  type CustomerView,
  type Labelled,
  type Section,
} from './view.types';

/**
 * Every way a section can be refused. A closed union so a caller can branch, and
 * so the log key below has a bounded set of values.
 */
export type ViewRejection =
  | 'malformed_view'
  | 'unknown_type'
  | 'missing_id'
  | 'duplicate_id'
  | 'unlabelled_section'
  | 'unlabelled_item';

/** One refusal, with enough to find it in the provider that emitted it. */
export interface ViewProblem {
  /** Position in the ORIGINAL array — the offset survives the drop. */
  readonly index: number;
  /** The offending id, or `'<missing>'` when that is the problem itself. */
  readonly id: string;
  readonly reason: ViewRejection;
}

export interface ViewValidation {
  /** Only the sections that passed. Order preserved. */
  readonly view: CustomerView;
  /** Every refusal, in the order they were found. Empty on a clean view. */
  readonly problems: readonly ViewProblem[];
}

/**
 * The closed set, as a lookup.
 *
 * 🔴 BUILT FROM `SECTION_TYPES`, NEVER RE-TYPED HERE. A hand-written copy is the
 * drift shape `view.types.ts` documents: the union grows, this list does not, and
 * the validator starts rejecting a type the compiler accepts — silently, because
 * both halves still compile. Built once at module load; the set is fixed for the
 * life of the process. อ่านจากชุดเดียว ห้ามพิมพ์ซ้ำ
 */
const KNOWN_TYPES: ReadonlySet<string> = new Set<string>(SECTION_TYPES);

/**
 * Has a label a human can read.
 *
 * ⚠️ EMPTY IS ABSENT. `label: ''` renders exactly like no label at all — a blank
 * line that looks like a design decision rather than the bug it is
 * (`view.types.ts`, the `Labelled` note). Whitespace is trimmed for the same
 * reason: `' '` draws nothing.
 */
export const isLabelled = (x: Labelled): boolean =>
  (typeof x.labelKey === 'string' && x.labelKey.trim().length > 0) ||
  (typeof x.label === 'string' && x.label.trim().length > 0);
/* 🔴 EXPORTED SO THERE IS EXACTLY ONE ANSWER TO "IS THIS LABELLED?".
   `customer-provider-view.spec.ts` asked the same question with its own
   expression, `Boolean(label ?? labelKey)`. That is a DIFFERENT rule: `??` falls
   through only on null/undefined, so a section carrying `label: ''` alongside a
   perfectly good `labelKey` read as unlabelled there and as labelled here. It
   failed safe — a false red, never a false green — but two rules for one word is
   how the pair drifts until one of them starts lying. The provider spec now asks
   the wire's own question. หนึ่งกติกา ที่เดียว */

/**
 * Every child of a section that MUST carry a label, flattened.
 *
 * ⚠️ `amountRows` is deliberately absent: `AmountRow` does not extend `Labelled`
 * at all (it is a date, a signed amount and a status — it labels itself), so
 * requiring one would reject every finance and bonus card this provider emits.
 * `badge` is included because a `Chip` does extend `Labelled` and an unlabelled
 * chip is a coloured dot with no meaning.
 */
const labelledChildren = (s: Section): readonly Labelled[] => [
  ...(s.rows ?? []),
  ...(s.items ?? []),
  ...(s.chips ?? []),
  ...(s.badge ?? []),
];

/**
 * The whole schema, applied to one provider's answer.
 *
 * Pure, like everything else in `providers/engine/`: it reads a view and returns
 * a view. No I/O, no logging, no throwing — the caller decides what a problem
 * sounds like. That is what lets a spec assert the refusals directly instead of
 * scraping a log.
 */
export function validateView(
  view: CustomerView | null | undefined,
): ViewValidation {
  const declared: unknown = view?.sections;
  if (!Array.isArray(declared)) {
    /* Reachable through the `as never` provider stubs this repo already uses,
       and the one case where the guard must be most careful: throwing here would
       turn the exact failure this file exists to contain into the 500 the header
       rejects. An empty view plus one loud problem is the containing answer. */
    return {
      view: { sections: [] },
      problems: [{ index: -1, id: '<none>', reason: 'malformed_view' }],
    };
  }
  /* ⚠️ Asserted rather than inferred. `Array.isArray` narrows to `any[]`, and an
     `any` walking through the one guard that stands between a provider and a
     browser is the last place to accept one — every field below would be
     unchecked. The assertion is safe because nothing here TRUSTS the shape: each
     rule tests the value it reads before using it. */
  const sections = declared as readonly Section[];

  const kept: Section[] = [];
  const problems: ViewProblem[] = [];
  const seenIds = new Set<string>();

  sections.forEach((section, index) => {
    const id =
      typeof section?.id === 'string' && section.id.trim().length > 0
        ? section.id
        : null;
    const refuse = (reason: ViewRejection): void => {
      problems.push({ index, id: id ?? '<missing>', reason });
    };

    if (id === null) {
      refuse('missing_id');
      return;
    }
    if (seenIds.has(id)) {
      /* The SECOND one goes. The first was unambiguous when it was read, and
         keeping neither would punish a correct section for a later one's fault. */
      refuse('duplicate_id');
      return;
    }
    if (!KNOWN_TYPES.has(section.type)) {
      refuse('unknown_type');
      return;
    }
    if (!isLabelled(section)) {
      refuse('unlabelled_section');
      return;
    }
    if (!labelledChildren(section).every(isLabelled)) {
      /* 🔴 ONE BAD ROW CONDEMNS THE SECTION, and that is the deliberate choice.
         Dropping only the row leaves a card that looks complete and is not: an
         admin reading a finance card with "ยอดฝากรวม" quietly removed concludes
         the customer never deposited. A missing CARD is visibly missing and is
         in the log; a missing ROW is a card that lies. การ์ดโกหกแย่กว่าการ์ดหาย */
      refuse('unlabelled_item');
      return;
    }

    seenIds.add(id);
    kept.push(section);
  });

  return { view: { sections: kept }, problems };
}
