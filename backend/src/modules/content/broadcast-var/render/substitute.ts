/**
 * [FEAT-20260822-BCASTSUBST] Putting the values into the card, and proving no
 * `{{…}}` survived.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock.
 *
 * 🔴 THE FAILURE THIS EXISTS TO STOP
 * `broadcasts.service.ts` ships `flex_json` untouched today, so a card holding
 * `{{bank_account_name}}` reaches the customer with the braces showing. Worse,
 * an unresolved tag inside an image URL makes LINE reject the WHOLE message
 * with 400 and nobody receives anything.
 *
 * ⚠️ ORDER IS LOAD-BEARING, and each step exists for a reason:
 *   1. substitute every known tag
 *   2. `N/A` for anything still empty       (`checks/empty-value.ts`)
 *   3. repair image URLs                    (`checks/image-url.shape.ts`)
 *   4. sweep any tag nobody knew about      ← this file, last
 * Step 4 last, because a tag the map did not carry is exactly the case steps
 * 1-3 cannot see. กวาดท้ายสุด ไม่ใช่ก่อน.
 *
 * revert: delete this folder and its line in the barrel.
 */

/** Matches `{{tag}}` with optional spaces, the same spelling the specs emit. */
import {
  BROADCAST_VAR_EMPTY,
  isEmptyForBroadcast,
} from '../checks/empty-value';

const TAG = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/**
 * 🔴 ANY brace pair, not only a well-formed tag.
 *
 * `TAG` only matches `[A-Za-z0-9_.]`, so `{{member-name}}` (a hyphen) and
 * `{{ชื่อไทย}}` (Thai) matched NOTHING — they were not substituted, and
 * `findLeftoverTags`, which used the SAME pattern, then reported the card
 * clean. Proven: both survived to the customer while `isCardClean` answered
 * `true`. A gate that shares its blind spot with the thing it is guarding is
 * not a gate. ด่านที่ตาบอดจุดเดียวกับสิ่งที่มันเฝ้า ไม่ใช่ด่าน.
 *
 * A typo is still a tag the admin MEANT — so it renders as the fallback rather
 * than shipping braces to a customer.
 *
 * ⚠️⚠️ [FIX-20260823-BCASTNESTBRACE] WAS `\{\{[^{}]*\}\}`, and a character class
 *   that EXCLUDES `{` and `}` cannot match a pair that CONTAINS one. Measured,
 *   all four delivered verbatim while `isCardClean` said true:
 *     `{{ a } b }}` · `hello {{x} }}` · `{{ {tag} }}` · `{{a{{b}}`
 *   Lazy `[\s\S]*?` runs from the FIRST opener to the NEXT closer, so inner
 *   braces ride along and two real tags in one string still match separately.
 *   นับจากปีกกาเปิดตัวแรกถึงปีกกาปิดตัวถัดไป ปีกกาชั้นในจึงหลบไม่ได้.
 */
const ANY_BRACES = /\{\{[\s\S]*?\}\}/g;

/**
 * 🔴 An opener with NO closer — the leak `{{a{{b}}` leaves behind.
 *
 * The tag pass reads `{{b}}` out of the middle of `{{a{{b}}` and leaves
 * `{{aN/A`; no PAIR-shaped pattern can ever see that, so the customer read a
 * raw `{{`. It is swept to the end of the string: a `{{` in a delivered card is
 * never content — the whole point of this file is that braces do not reach a
 * customer. ปีกกาเปิดค้าง = กวาดถึงท้ายข้อความ.
 *
 * ⚠️ Not /g on purpose: it eats to end-of-string, so there is never a second
 *    match to make. A lone `}}` with no opener is deliberately NOT swept — it
 *    is not a tag, and cutting it would edit content nobody complained about.
 */
const OPEN_BRACE = /\{\{[\s\S]*$/;

export interface SubstituteResult {
  /** The card, with values in place. Never contains `{{`. */
  readonly card: unknown;
  /** Tags that were replaced with a real value. */
  readonly resolved: readonly string[];
  /** Tags nothing in the map knew about — swept to the fallback. */
  readonly unknown: readonly string[];
}

/**
 * Replace every `{{tag}}` in a card.
 *
 * `fallback` is what an unknown tag becomes. It must never be empty: LINE
 * refuses a flex `text` whose value is an empty string, so an unknown tag would
 * turn one missing value into a card that cannot be sent at all.
 */
export function substituteCard(
  card: unknown,
  vars: Readonly<Record<string, string>>,
  fallback: string,
): SubstituteResult {
  const resolved = new Set<string>();
  const unknown = new Set<string>();
  /**
   * 🔴 THE FALLBACK ITSELF MUST BE SENDABLE.
   *
   * This guarded only `''`, so a caller passing `'-'` or `' '` would have every
   * missing value render as the very marker this feature exists to remove —
   * the dash trap, reintroduced by the one function whose own docblock says the
   * fallback "must never be empty". An audit found it.
   * ตัวสำรองเองก็ต้องส่งได้ ไม่ใช่กันแค่ค่าว่าง.
   */
  const safeFallback = isEmptyForBroadcast(fallback)
    ? BROADCAST_VAR_EMPTY
    : fallback;

  /* A second pass for braces the tag pattern could not read — a hyphen, a Thai
     word, a stray space, a brace nested inside another. They reach here only
     because nothing matched them, so they are unknown by definition.
     ปีกกาที่อ่านไม่ออก = ไม่รู้จัก. `inner` is the text between the braces; for an
     unclosed opener there is no closing pair to cut, so only the `{{` comes off. */
  const sweepBrace = (whole: string, closed: boolean): string => {
    unknown.add((closed ? whole.slice(2, -2) : whole.slice(2)).trim());
    return safeFallback;
  };

  const replaceIn = (text: string): string =>
    text
      .replace(TAG, (_whole, tag: string) => {
        const value = vars[tag];
        if (typeof value === 'string' && value !== '') {
          resolved.add(tag);
          return value;
        }
        unknown.add(tag);
        return safeFallback;
      })
      .replace(ANY_BRACES, (whole: string) => sweepBrace(whole, true))
      // ⚠️ ORDER: pairs first, leftovers second. Reversed, an opener would eat
      //    the rest of a string that held a perfectly readable pair after it.
      .replace(OPEN_BRACE, (whole: string) => sweepBrace(whole, false));

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return replaceIn(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        // Keys are substituted too: a card can carry `{{…}}` in a property name
        // through a template, and a stray brace there breaks the JSON contract
        // just as badly as one in a value.
        out[typeof k === 'string' ? replaceIn(k) : k] = walk(v);
      }
      return out;
    }
    return node;
  };

  return {
    card: walk(card),
    resolved: [...resolved],
    unknown: [...unknown],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// [FIX-20260823-BCASTNESTBRACE] the GATE's own mechanism — a scanner, no regex
// ───────────────────────────────────────────────────────────────────────────

/**
 * 🔴 WHY A SCANNER AND NOT THE PATTERN ABOVE.
 *
 * The gate used to share `ANY_BRACES` with the substituter, so the two went
 * blind at the same instant: the nested-brace bug leaked to the customer AND
 * reported the card clean, one flaw counted twice. Index scanning has no
 * character class to get wrong — it walks to the next `{{`, then to the next
 * `}}`, and calls everything between them one run. Two locks now need two
 * different keys. ด่านต้องใช้กลไกคนละตัวกับสิ่งที่มันเฝ้า ไม่งั้นตาบอดพร้อมกัน.
 *
 * ⚠️ A run with no closing `}}` reaches to the end of the string — that is the
 *    `{{aN/A` leak, and it must be visible here or the gate lies again.
 */
export interface BraceRun {
  readonly start: number;
  /** Exclusive. End-of-string when the run never closed. */
  readonly end: number;
  /** What sat between the braces, trimmed — the reported "tag". */
  readonly name: string;
}

export function findBraceRuns(text: string): BraceRun[] {
  const runs: BraceRun[] = [];
  let open = text.indexOf('{{');
  while (open !== -1) {
    const close = text.indexOf('}}', open + 2);
    const end = close === -1 ? text.length : close + 2;
    const inner =
      close === -1 ? text.slice(open + 2) : text.slice(open + 2, close);
    runs.push({ start: open, end, name: inner.trim() });
    if (close === -1) break;
    open = text.indexOf('{{', end);
  }
  return runs;
}

/**
 * Every brace run replaced by `fallback` — the BACKSTOP's cutter.
 *
 * ⚠️ Built by slicing the spans the scanner found, never by another regex:
 *    a backstop that re-uses the substituter's pattern is not a backstop.
 */
export function stripBraceRuns(text: string, fallback: string): string {
  const runs = findBraceRuns(text);
  if (runs.length === 0) return text;
  let out = '';
  let at = 0;
  for (const run of runs) {
    out += text.slice(at, run.start) + fallback;
    at = run.end;
  }
  return out + text.slice(at);
}

/**
 * The last gate before a card is handed to LINE.
 *
 * ⚠️ Checks the SERIALISED card, not the object graph: a brace hiding in a
 * nested array or an object key is invisible to a shallow look and perfectly
 * visible to a customer. ตรวจที่ข้อความจริงที่จะถูกส่ง.
 */
export function findLeftoverTags(card: unknown): string[] {
  let text: string;
  try {
    text = JSON.stringify(card) ?? '';
  } catch {
    // A card we cannot serialise cannot be sent either — say so rather than
    // reporting "clean".
    return ['<unserialisable>'];
  }
  /* ⚠️ The SCANNER, not `TAG` and not `ANY_BRACES`. Using the substitution's
     own pattern meant this function could only ever find what substitution had
     already replaced — structurally incapable of reporting a leftover, twice
     over (the tag pattern, then the pair pattern that could not see a nested
     brace). */
  /* ⚠️ The name is cut at the first `"` — the gate reads SERIALISED JSON, so a
     run that never closed swallows the serialiser's own punctuation
     (`hi {{name` reported `name"}`). The report must name what the ADMIN typed;
     detection is unaffected either way. รายงานชื่อที่คนพิมพ์ ไม่ใช่เศษ JSON. */
  return findBraceRuns(text).map((run) => run.name.split('"')[0]!.trim());
}

/** Is this card safe to send? */
export function isCardClean(card: unknown): boolean {
  return findLeftoverTags(card).length === 0;
}
