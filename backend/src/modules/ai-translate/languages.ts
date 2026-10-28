/**
 * ==== [FEAT-20260908-CHATTRANS] the language registry — data in code ==========
 *
 * The ONE list of languages this capability can translate between. It lives
 * inside `ai-translate/` because the module is the only thing that knows what a
 * language means to a prompt, and it is a plain `as const` array — **never
 * Mongo**. `ai-vendor/models.ts` is the direct precedent: a data registry that
 * stayed in its own module while only URL constants went to `common`.
 * (`ai-endpoints.ts` sits in `common` for a CYCLE reason — `modules/ai` imports
 * `hooks` — which does not apply to a module every caller can already reach.)
 *
 * ── ANY PAIR, EITHER DIRECTION ───────────────────────────────────────────────
 * 🔴 This is a FLAT LIST, not a "from Thai into X" table. Nothing here, and
 * nothing that reads it, may assume Thai is one end of the pair: a room where an
 * admin writes English to a Burmese customer uses the same registry the other
 * way round. แปลจากภาษาไหนไปภาษาไหนก็ได้.
 *
 * ── THE FOUR FIELDS, AND WHY EACH ONE EXISTS ─────────────────────────────────
 *
 *   `code`           the BCP-47 subtag. Stored in `chat_messages.translations[]`
 *                    (`lang`/`from`/`to`) AND sent on the wire, so it is the one
 *                    string that must never be re-spelled: a row stored under a
 *                    code that later changes meaning is a data question, not a
 *                    rename. 🔴 Chinese is TWO entries (owner, 09/09) —
 *                    Simplified and Traditional are different model OUTPUTS, so
 *                    a single `zh` would have to be split later, stranding every
 *                    row already written under it.
 *
 *   `prompt_name`    🔴 THE ENGLISH NAME THE PROMPT ACTUALLY SAYS, and the
 *                    reason this file is not just a list of codes. A model told
 *                    `into zh-Hant` is being given strictly less than one told
 *                    `into Traditional Chinese` — the code is an identifier for
 *                    US, the name is the instruction for IT. This field is not
 *                    decoration; it is the difference between a correct
 *                    translation and a plausible one.
 *
 *   `label_key`      an i18n KEY, never a sentence — the label belongs to
 *                    whoever renders it. Same convention the options pipe
 *                    already uses (`field_options.slip_provider.swiftcheck`); a
 *                    server that ships display text cannot be re-worded without
 *                    a back-end release.
 *
 *   `fallback_label` 🔴 MANDATORY ON EVERY ENTRY, and typed as required so it
 *                    cannot be forgotten. The dashboard resolves a label as
 *                    "translation for `label_key`" → "`fallback_label`" → "the
 *                    raw key on screen". An entry that reaches the third rung
 *                    shows an operator `field_options.translate_target_lang.km`
 *                    in a dropdown. Unlike slip's list — where the shipped-with-
 *                    the-client default deliberately carries none — every entry
 *                    here is one the server can add on its own, so every entry
 *                    carries a name. It is a PROPER NOUN (the language's name in
 *                    Thai), never a sentence.
 *
 *   `enabled`        retires a language WITHOUT deleting it. Deleting a row's
 *                    language is how a stored translation becomes unreadable;
 *                    flipping this leaves `translateLanguage()` resolving old
 *                    rows forever while the picker and new requests stop
 *                    offering it. ปิดได้ แต่ห้ามลบ.
 *
 * ── THE TWO LOOKUPS ARE DELIBERATELY DIFFERENT, AND THIS IS THE SUBTLE PART ──
 *   `isTranslateLanguage(code)` — "may a NEW request ask for this?"  listed AND
 *                                  enabled. This is the guard.
 *   `translateLanguage(code)`   — "what is this code?"  listed, enabled or not.
 *                                  This is the resolver, and the reason a
 *                                  retired language keeps rendering.
 * Today all seven are enabled, so the two answer identically; they diverge only
 * on the day someone retires one, which is exactly when the difference matters.
 *
 * ⚠️ VALIDATE TWICE. A caller's DTO uses `@IsIn(TRANSLATE_LANGUAGE_CODES)`
 * (precedent `ticket.dto.ts:92`) **and** the module checks again on the way in,
 * because a future non-interactive caller — a job, a queue consumer — never
 * meets Nest's `ValidationPipe`.
 *
 * revert: delete this file, `translate-lang.options.ts`, and their two lines in
 * `index.ts` + `modules/options/field-options.registry.ts`.
 */

/** One language this capability can translate into or out of. */
export interface TranslateLanguage {
  /** BCP-47 subtag. Stored on the row and sent on the wire — never re-spelled. */
  readonly code: string;
  /** i18n key the client resolves. Never a sentence. */
  readonly label_key: string;
  /** Last-resort display name. Required, so no entry can render as a raw key. */
  readonly fallback_label: string;
  /** The ENGLISH name the prompt says, e.g. `Traditional Chinese`. */
  readonly prompt_name: string;
  /** `false` retires the language for NEW requests; stored rows still resolve. */
  readonly enabled: boolean;
}

/**
 * The i18n namespace clients look these labels up under.
 *
 * 🔴 CROSS-REPO CONTRACT. The dashboard has all seven keys written into
 * `i18n/translations/th.json` and `en.json` by hand, because it cannot import
 * anything from here. Exported as one constant so the FE has a single string to
 * mirror rather than a pattern to reconstruct — the same job
 * `SLIP_PROVIDER_LABEL_NS` does for slip — and so a spec can assert it matches
 * the key this list is registered under in the options pipe. Renaming either
 * side without the other goes RED there rather than silently showing raw keys.
 */
export const TRANSLATE_LANGUAGE_LABEL_NS =
  'field_options.translate_target_lang';

/**
 * ==== SINGLE SOURCE OF TRUTH: TRANSLATE LANGUAGES (BACKEND) ====
 *
 * 🔴 CROSS-REPO CONTRACT & CANONICAL DEFINITION:
 * This list is the authoritative Single Source of Truth for all supported translation languages across both repositories.
 * Mirrored in Frontend: `omnidesk-console/config/translateLanguages.ts`
 *
 * Origin and Purpose of the Supported Languages:
 * The list ['th', 'en', 'my', 'zh-Hans', 'zh-Hant', 'lo', 'km'] originated from the business requirements
 * for multi-language customer support in Southeast Asia and Greater China:
 * - `th`      : Thai (Primary console operator language & core domestic market)
 * - `en`      : English (International lingua franca & operator communication)
 * - `my`      : Burmese / Myanmar (Cross-border regional customer support)
 * - `zh-Hans` : Simplified Chinese (Standard simplified script for mainland China)
 * - `zh-Hant` : Traditional Chinese (Traditional script for Taiwan/HK/Macau; requires distinct prompt instruction and model output)
 * - `lo`      : Lao (Regional neighboring cross-border market)
 * - `km`      : Khmer / Cambodian (Regional neighboring cross-border market)
 *
 * Two-Way / Bidirectional Maintenance Note:
 * When updating (adding/modifying/retiring) languages:
 * 1. Backend: Update this canonical list in `omnidesk-api/src/modules/ai-translate/languages.ts`.
 * 2. Frontend: Update the mirrored list in `omnidesk-console/config/translateLanguages.ts`.
 * 3. i18n: Update translation entries in `omnidesk-console/i18n/translations/th.json` and `en.json`
 *    under the key `${TRANSLATE_LANGUAGE_LABEL_NS}.<code>` (e.g. `field_options.translate_target_lang.<code>`).
 *
 * The seven, in the owner's display order (09/09) — NOT alphabetical and not
 * sorted at render time. Thai and English lead because they are what this
 * console's operators actually work in; the rest follow as the owner listed
 * them. A sort here would be this file quietly overruling that decision.
 */
export const TRANSLATE_LANGUAGES = [
  {
    code: 'th',
    label_key: `${TRANSLATE_LANGUAGE_LABEL_NS}.th`,
    fallback_label: 'ไทย',
    prompt_name: 'Thai',
    enabled: true,
  },
  {
    code: 'en',
    label_key: `${TRANSLATE_LANGUAGE_LABEL_NS}.en`,
    fallback_label: 'อังกฤษ',
    prompt_name: 'English',
    enabled: true,
  },
  {
    code: 'my',
    label_key: `${TRANSLATE_LANGUAGE_LABEL_NS}.my`,
    fallback_label: 'พม่า',
    prompt_name: 'Burmese',
    enabled: true,
  },
  {
    /* 🔴 `zh-Hans`, not `zh-CN`. The subtag names the SCRIPT, which is what the
       model is being asked for; `zh-CN` names a region and would tie a script
       choice to a country. The hyphen is harmless here — it is an array element
       VALUE, never a Mongo field name (§7.2), which is one more reason the
       stored shape is an array and not a keyed map. */
    code: 'zh-Hans',
    label_key: `${TRANSLATE_LANGUAGE_LABEL_NS}.zh-Hans`,
    fallback_label: 'จีนตัวย่อ',
    prompt_name: 'Simplified Chinese',
    enabled: true,
  },
  {
    code: 'zh-Hant',
    label_key: `${TRANSLATE_LANGUAGE_LABEL_NS}.zh-Hant`,
    fallback_label: 'จีนตัวเต็ม',
    prompt_name: 'Traditional Chinese',
    enabled: true,
  },
  {
    code: 'lo',
    label_key: `${TRANSLATE_LANGUAGE_LABEL_NS}.lo`,
    fallback_label: 'ลาว',
    prompt_name: 'Lao',
    enabled: true,
  },
  {
    code: 'km',
    label_key: `${TRANSLATE_LANGUAGE_LABEL_NS}.km`,
    fallback_label: 'เขมร',
    prompt_name: 'Khmer',
    enabled: true,
  },
] as const satisfies readonly TranslateLanguage[];

/** Every code this module has ever known, retired ones included. */
const ALL_CODES: readonly string[] = TRANSLATE_LANGUAGES.map((l) => l.code);

/**
 * The codes a NEW request may name — enabled only.
 *
 * 🔴 This is what a caller's `@IsIn(...)` takes. It excludes retired languages
 * on purpose: a retired code must keep RESOLVING (old rows render) while no
 * longer being REQUESTABLE, and those are two different questions. Use
 * `translateLanguage()` for the first, this list for the second.
 */
export const TRANSLATE_LANGUAGE_CODES: readonly string[] =
  TRANSLATE_LANGUAGES.filter((l) => l.enabled).map((l) => l.code);

/** Trim + exact match. Codes are case-sensitive: `zh-Hant` names a script. */
const normalise = (code: string | null | undefined): string =>
  String(code ?? '').trim();

/**
 * THE RESOLVER — what is this code? Answers for retired languages too, which is
 * the entire reason `enabled` exists rather than deletion.
 *
 * @returns the entry, or `null` for a code this module never knew.
 */
export function translateLanguage(
  code: string | null | undefined,
): TranslateLanguage | null {
  const wanted = normalise(code);
  return TRANSLATE_LANGUAGES.find((l) => l.code === wanted) ?? null;
}

/**
 * THE GUARD — may a new request ask for this language?
 *
 * Listed AND enabled. Never throws: an unknown code is a caller asking for
 * something that does not exist, which the caller answers as a 400, not a 500.
 */
export function isTranslateLanguage(code: string | null | undefined): boolean {
  return translateLanguage(code)?.enabled === true;
}

/**
 * 🔴 THE ENGLISH NAME FOR THE PROMPT — never let a bare code reach a model.
 *
 * @returns `prompt_name` for a known code; the trimmed code itself as a LAST
 * RESORT for one this registry has never seen.
 *
 * ⚠️ THE FALLBACK IS DELIBERATE AND IT IS NOT "SAFE BY ACCIDENT". Throwing here
 * would mean an unrecognised code — a stored row from a future release, a
 * caller that skipped the guard — turns a translation into a 500. Passing the
 * code through degrades exactly one call to today's behaviour instead, which is
 * strictly better than both throwing and than silently translating into a
 * language nobody asked for. It is a floor, not a licence: the guard above is
 * what keeps codes off this path in the first place.
 */
export function translatePromptName(code: string | null | undefined): string {
  return translateLanguage(code)?.prompt_name ?? normalise(code);
}

/** Retired languages included — for specs and for anyone auditing the list. */
export const knownTranslateLanguageCodes = (): readonly string[] => ALL_CODES;
