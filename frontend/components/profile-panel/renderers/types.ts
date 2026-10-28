/**
 * [FEAT-20260905-CUSTPROV PART 7] The wire shape of `view.sections`, as the
 * DASHBOARD sees it.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §37 (the closed set) · §38 (this folder) · §40 (unknown type)
 * 📖 CONTRACT: `omnidesk-api/src/modules/customer-provider/providers/engine/view.types.ts`
 *          — read its header for WHY there are four types and not six, and why
 *          `label` and `labelKey` both exist.
 *
 * ## WHY A SECOND DECLARATION AND NOT AN IMPORT
 * The contract lives in another repo and another deploy unit. There is no
 * package boundary between them today, so the choice was: reach across two repo
 * roots with a relative path (breaks the moment either repo moves, and couples
 * the FE build to a BE checkout), or restate the shape here. Restated — the
 * shape is ~40 lines of pure structure and the envelope is validated on the way
 * OUT of the BE (§40), so a mismatch is caught there, not by tsc here.
 * REJECTED: a shared npm package for one interface file. That is a build system
 * for a type, and nothing else would live in it.
 *
 * ## 🔴 `Section.type` IS `string`, NOT A UNION — ON PURPOSE
 * The BE declares `SectionType = 'kv' | 'list' | 'amount_rows' | 'empty'`. This
 * file deliberately WIDENS it, because this side of the wire is receiving
 * untrusted JSON: a union here would be a claim tsc cannot check and would make
 * the §40 unknown-type branch look unreachable, which is the exact branch that
 * has to exist. The closed set is therefore a RUNTIME fact, held in exactly one
 * place — the registry in `./index.tsx` — and nowhere else.
 * ชนิดที่มาจากสายไม่ใช่ของที่ tsc การันตีได้ · ชุดปิดอยู่ที่ registry ที่เดียว
 *
 * ## Everything is optional, including things the BE marks required
 * `KvRow.value`, `AmountRow.at/amount/sign` are required on the producer's side.
 * Here they are optional: a renderer that assumes a field is present because the
 * producer promised it crashes a customer's panel when a provider ships a bug.
 * Each renderer states what it draws when a field is missing.
 *
 * revert: delete this folder (`components/profile-panel/renderers/`) and
 *         `test/profilePanelView.dom.test.tsx`. Nothing outside the folder
 *         imports it yet, so removal is a single `rm -r`.
 */

/** One label, in whichever of the two forms the value actually has. */
export interface Labelled {
  /** An i18n key the dashboard already has, e.g. `ticket.phone`. Preferred. */
  readonly labelKey?: string;
  /** A literal, for labels that are literals today and for new vendors. */
  readonly label?: string;
}

/**
 * A stable identifier for one row or chip, independent of what it is CALLED.
 *
 * 🔴 THIS IS WHAT THE HAND-BUILT CARDS LOOK VALUES UP BY (`./sectionValues.ts`).
 * A label is a display string — translate it, or let a vendor rename it, and a
 * card matching on it goes blank. A position is an accident of what the vendor
 * sent — omit one row and every card below reads the wrong number. The key is
 * the provider PORT's own vocabulary (`finCredit`, `cbPending`), identical
 * across vendors because it names the slot, never the field.
 * ป้ายไว้โชว์ · key ไว้หา
 *
 * Optional, because a section drawn by the GENERIC renderers has nothing to look
 * anything up by — it draws what it is given, in the order it is given.
 */
export interface Keyed {
  readonly key?: string;
}

/** `kv` — a label/value row. */
export interface KvRow extends Labelled, Keyed {
  readonly value?: unknown;
  readonly copy?: boolean;
  /**
   * Monospace the value — for an id or a code, where a proportional font makes
   * two similar strings hard to compare.
   * ⚠️ The contract's doc line on this field ("renders as `-` when absent")
   * describes the DASH rule, not this flag; that rule is `Value` in
   * `./values.tsx` and applies to every row regardless. Read as written, the
   * name is unambiguous and no producer sets it today, so the flag is honoured
   * as monospace and nothing on screen changes either way.
   */
  readonly mono?: boolean;
  /**
   * The value's TARGET. Present ⇒ the row is PROGRESS, not a plain number, and
   * the pair is coloured by comparing the two (`xpActivityTone`). The contract's own
   * header records why this travels as a pair rather than a pre-joined
   * `'12 / 100'` string: joining renders the same characters and throws the
   * comparison away, so every activity volume row goes one flat colour.
   */
  readonly target?: unknown;
  /** A short trailing note beside the value, e.g. `(87%)`. */
  readonly suffix?: string;
}

/**
 * A short badge, drawn in a card HEADER. There is no section made of chips.
 *
 * ⚠️ THE TONES ARE THE CONTRACT'S FOUR, corrected 05/09. This file declared
 * `'ok' | 'warn' | 'off' | 'neutral'` — the producer's FIRST set, which was
 * replaced before it ever shipped because `off` was emitted for two chips that
 * are two different colours on screen (`view.types.ts`, `Chip`). `TONE_CLASS` in
 * `./ProfilePanelView.tsx` already keys on the corrected four; only this
 * declaration was stale, so a `tone: 'muted'` off the wire failed tsc while
 * rendering perfectly. `amber` has no emitter and is therefore not listed.
 *
 *   ok  green (a switch that is on) · off red (switched OFF, worth seeing)
 *   info blue (a fact) · muted grey (the ordinary absence of a thing)
 */
export interface Chip extends Labelled, Keyed {
  readonly tone?: 'ok' | 'off' | 'info' | 'muted';
}

/** `list` — a title with a trailing value, and optional secondary text. */
export interface ListItem extends Labelled, Keyed {
  readonly value?: unknown;
  readonly secondary?: string;
  readonly image?: string;
  /** A money figure carried BESIDE `value` — the amount spent, when the row has one. */
  readonly amount?: unknown;
  /**
   * The RAW timestamp, unformatted — `secondary` carries a rendered form for the
   * generic renderer, but a hand-built card formats time its own way (`xpDT`
   * splits epoch seconds from milliseconds by magnitude). A card that parsed
   * `secondary` would be reading a display string as data.
   */
  readonly at?: unknown;
  /**
   * The direction of `value` — `'+'` received, `'-'` spent. The เหรียญ card
   * colours a row from it and prefixes the sign; without it the card would have
   * to re-derive the direction from a vendor's `type` field, which is the exact
   * coupling this module removes.
   */
  readonly sign?: '+' | '-';
  /**
   * The PARTS `secondary` was joined from, still separate. NOT a duplicate: the
   * products card draws `PROVIDER · TYPE` as one badge (that is `secondary`) but
   * builds its two-letter fallback block from the PROVIDER alone.
   */
  readonly tags?: readonly string[];
}

/** `amount_rows` — a dated row with a signed amount and an optional status. */
export interface AmountRow {
  readonly at?: unknown;
  readonly amount?: unknown;
  readonly sign?: '+' | '-';
  readonly status?: unknown;
}

export interface Section extends Labelled {
  /** Stable across providers so React can key on it. */
  readonly id: string;
  /** 🔴 Open by design — see the header. */
  readonly type: string;
  /** Sections sharing a `group` are drawn as TABS of one card, in array order. */
  readonly group?: string;
  readonly collapsed?: boolean;
  readonly badge?: readonly Chip[];
  /**
   * ⚠️ NOT ONLY ON `kv`. The producer emits summary `rows` on `list` and
   * `amount_rows` sections too (`activity.coins` carries เหรียญล่าสุดที่มี;
   * `finance.deposits` carries three). A renderer that draws only its own
   * primary collection drops them silently — see `KvRows` in `./KvSection.tsx`.
   */
  readonly rows?: readonly KvRow[];
  readonly items?: readonly ListItem[];
  readonly amountRows?: readonly AmountRow[];
  /** `empty` carries its message here. */
  readonly text?: string;
}

export interface CustomerView {
  readonly sections?: readonly Section[];
}

/** Every renderer in `./index.tsx` takes exactly this. */
export interface SectionProps {
  readonly section: Section;
}
