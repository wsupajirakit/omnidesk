/**
 * ==== [FEAT-20260903-FIELDOPTIONS] one pipe: "what may this field be set to?" =
 *
 * WHY IT EXISTS. The dashboard had a free-text box for a value that decides which
 * vendor verifies money, and nothing validated it on either side — a typo saved,
 * displayed back to the operator, and did nothing. The only honest owner of "what
 * may this be set to" is the server: it is the side that can actually act on the
 * value.
 *
 * 🔴 THE RULE THIS ENFORCES: **NEVER OFFER A VALUE THE SERVER CANNOT ACT ON.**
 * A client that lists a choice the back end does not implement gives the operator
 * a control that saves, is ignored at runtime, and reports nothing anywhere. That
 * exact failure is already recorded in this codebase.
 *
 * ── THIS FILE KNOWS NOTHING ABOUT ANY DOMAIN, AND THAT IS THE DESIGN ────────
 * Owner, 03/09: it is a central pipe, and slip is just one SUB-entry — do not
 * hardcode it here, leave room to serve other things.
 *
 * So each domain owns HOW its list is built, in its own module, next to the thing
 * it reads. This file holds only `key -> source`: one line per field. Adding the
 * next list touches no route, no controller and no client beyond asking for the
 * new key. The shape is the one this repo already uses twice — `SLIP_PROVIDERS`
 * (name -> provider) and `resolve-info/index.ts` (name -> resolver).
 *
 * ⚠️ WHAT IS DELIBERATELY *NOT* BUILT, because "flexible" is where speculative
 * machinery gets in: no cache, no per-key permissions, no dynamic registration at
 * runtime, no database-backed lists, no index route enumerating the keys. There
 * is ONE entry today; each of those would be a mechanism with no caller. Add them
 * on the day a second entry actually needs one.
 *
 * ⚠️ SOURCES MUST BE PURE, SYNCHRONOUS AND CHEAP — they answer on a request that
 * renders a form. Anything that queries a database or calls out belongs behind
 * its own endpoint; this pipe promises an immediate answer and must keep doing so.
 *
 * ── WHY ITS OWN MODULE ──────────────────────────────────────────────────────
 * `slip` already imports `hooks`, so hanging this off the hooks controller would
 * make `hooks -> slip -> hooks`, a cycle. A leaf module that nothing imports has
 * no such problem — and independence is what was asked for.
 *
 * revert: delete `src/modules/options/` and its line in `app.module.ts`.
 */
import { translateLanguageOptions } from '@/modules/ai-translate';
import { slipProviderOptions } from '@/modules/slip';

/** One selectable value. */
export interface FieldOption {
  /** Stored verbatim in the field this list is for. */
  value: string;
  /**
   * An i18n KEY, not a sentence — the label belongs to whoever renders it. Same
   * convention `GET /hook/field-tabs` already uses for its own fields.
   */
  label_key: string;
  /**
   * [FEAT-20260903-FALLBACKLABEL] A plain display name for clients that have no
   * translation for `label_key` yet — a LAST RESORT, never the primary label.
   *
   * 🔴 WHY IT EXISTS. Without it, this pipe's central promise was only half
   * true: the day a provider is registered the control appears with no client
   * release, but its NAME does not — a client's i18n falls back to the raw key,
   * so the operator would be offered a choice reading
   * `field_options.slip_provider.slipguard`. A control that appears by itself and
   * names itself with an i18n key is not the property that was claimed.
   *
   * ⚠️ IT IS NOT A TRANSLATION AND MUST NOT BECOME ONE. A source fills it with a
   * proper noun the value already IS (a vendor's own name), never with a
   * sentence — a server that ships display text cannot be re-worded without a
   * back-end release, which is what `label_key` exists to avoid. So: sources
   * carry it for values THE SERVER CAN ADD ON ITS OWN, and omit it for entries
   * that shipped as part of the contract with the client, which by definition
   * already have a translation. ชื่อเฉพาะเท่านั้น ห้ามใส่ประโยค
   */
  fallback_label?: string;
  /**
   * Marks the value the field falls back to when nothing is set. At most one
   * option carries it, and a client may render it differently ("use the system
   * default") rather than as an ordinary choice.
   */
  is_default?: boolean;
}

/** A source answers with the values the server can actually honour, in order. */
export type FieldOptionSource = () => FieldOption[];

/**
 * key -> source. **One line per field.** The key is the FIELD NAME as the client
 * knows it, so a reader goes from the form straight to the list with no
 * translation table in between.
 */
export const FIELD_OPTION_SOURCES: Readonly<Record<string, FieldOptionSource>> =
  {
    slip_provider: slipProviderOptions,
    translate_target_lang: translateLanguageOptions,
  };

/**
 * @returns the options for `key`, or `null` when nothing is registered under
 * that name. Never throws — an unknown key is a client asking for something that
 * does not exist, which the caller answers as a 404, not a 500.
 */
export function fieldOptionsFor(
  key: string | null | undefined,
): FieldOption[] | null {
  const source = FIELD_OPTION_SOURCES[String(key ?? '').trim()];
  return source ? source() : null;
}

/**
 * How many options represent an ACTUAL choice — the default excluded.
 *
 * 🔴 The server answers this rather than letting a client count, because
 * counting requires knowing which entry is the fallback, and that is exactly the
 * knowledge this pipe exists to keep on one side. It also lets a form drop a
 * control that cannot change anything without shipping a flag someone has to
 * remember to flip: the control appears by itself the day a second value is
 * registered.
 */
export const realChoiceCount = (options: readonly FieldOption[]): number =>
  options.filter((o) => !o.is_default).length;
