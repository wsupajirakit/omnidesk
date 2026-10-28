/**
 * =============================================================================
 * [FEAT-20260908-CHATTRANS] the language registry, and the pipe that serves it
 * =============================================================================
 *
 * WHAT THIS FILE IS FOR. Three claims, each of which fails silently if nobody
 * pins it:
 *
 *  1. 🔴 THE CODES ARE A CONTRACT, NOT A DISPLAY DETAIL. They are stored in
 *     `chat_messages.translations[].lang/from/to`, they travel on the wire, and
 *     the dashboard has all seven written by hand into `i18n/translations/
 *     th.json` and `en.json` because it cannot import anything from here.
 *     Re-spelling `zh-Hans` as `zh-CN` would not break a build on either side —
 *     it would strand stored rows under a code that changed meaning and drop
 *     that language's label to a raw i18n key on screen. So the seven are
 *     written out literally ONCE, below, and everything else is derived.
 *
 *  2. 🔴 A BARE CODE MUST NEVER REACH A MODEL. `prompt_name` exists because a
 *     model told `into zh-Hant` is given strictly less than one told `into
 *     Traditional Chinese`. That field is the whole reason this registry is not
 *     an array of strings.
 *
 *  3. 🔴 ADDING A KEY TO THE OPTIONS PIPE MUST NOT DISTURB THE ONE ALREADY
 *     THERE. `slip_provider` feeds the hook/slip lane — the value that decides
 *     which vendor verifies money. The last describe below is the case that
 *     proves this work did not touch it, and it is written HERE rather than
 *     left to `field-options-pipe.spec.ts` so the proof travels with the change
 *     that could have broken it.
 *
 * ⚠️ NO VENDOR CALL IS POSSIBLE FROM THIS FILE. It imports a data registry, a
 * pure options source and a pure lookup — no transport, no provider, no axios,
 * no network. That is a property of what is imported, not a promise.
 *
 * revert: delete with `src/modules/ai-translate/languages.ts`.
 */
import {
  isTranslateLanguage,
  knownTranslateLanguageCodes,
  translateLanguage,
  translateLanguageOptions,
  translatePromptName,
  TRANSLATE_LANGUAGE_CODES,
  TRANSLATE_LANGUAGE_LABEL_NS,
  TRANSLATE_LANGUAGES,
} from '@/modules/ai-translate';
import {
  FIELD_OPTION_SOURCES,
  fieldOptionsFor,
  realChoiceCount,
} from '@/modules/options';
import { slipProviderOptions } from '@/modules/slip';

import { aiTranslateConfig } from '@/config/app.config';
import { envSchema, validateEnv } from '@/config/env.schema';

/** The key the list is registered under, i.e. `GET /api/field-options/<this>`. */
const FIELD_KEY = 'translate_target_lang';

/**
 * 🔴 THE ONLY HAND-WRITTEN COPY IN THIS FILE, and it is hand-written on
 * purpose. Every other assertion derives from `TRANSLATE_LANGUAGES` so it keeps
 * working when an eighth language is added — but a derived-only file would pass
 * on the day someone re-spells a code, which is precisely the change that
 * cannot be allowed to pass. Seven pairs, owner's list, 09/09.
 */
const SEVEN: readonly (readonly [code: string, promptName: string])[] = [
  ['th', 'Thai'],
  ['en', 'English'],
  ['my', 'Burmese'],
  ['zh-Hans', 'Simplified Chinese'],
  ['zh-Hant', 'Traditional Chinese'],
  ['lo', 'Lao'],
  ['km', 'Khmer'],
];

describe('[CHATTRANS] the registry — seven languages, any pair, either way', () => {
  it('🔴 holds exactly the seven codes, in the owner’s order', () => {
    /* Order is asserted, not just membership: it is the display order of the
       picker, and the registry is the only place it is decided. A sort added
       downstream would be that decision being overruled somewhere invisible. */
    expect(TRANSLATE_LANGUAGES.map((l) => l.code)).toEqual(
      SEVEN.map(([code]) => code),
    );
  });

  it('🔴 every entry names the ENGLISH language, never the bare code', () => {
    /* The field that stops `into zh-Hant` from reaching a model. Pinned by
       value because "it is non-empty" would pass on `prompt_name: l.code`. */
    expect(TRANSLATE_LANGUAGES.map((l) => [l.code, l.prompt_name])).toEqual(
      SEVEN.map(([code, name]) => [code, name]),
    );
    for (const l of TRANSLATE_LANGUAGES) {
      expect(l.prompt_name).not.toBe(l.code);
    }
  });

  it('🔴 every entry carries a fallback_label — none can render as a raw key', () => {
    /* THE ONE TRUE FAILURE MODE OF THE FE CONTRACT. The dashboard resolves a
       label as: translation for `label_key` → `fallback_label` → the raw key on
       screen. An entry reaching the third rung shows an operator
       `field_options.translate_target_lang.km` inside a dropdown. Unlike slip's
       list, EVERY entry here is one the server can add on its own, so every one
       carries a name — and the type makes it required so it cannot be omitted
       by accident. */
    const missing = TRANSLATE_LANGUAGES.filter(
      (l) => !l.fallback_label || !l.fallback_label.trim(),
    ).map((l) => l.code);
    expect(missing).toEqual([]);
  });

  it('the fallback is a proper noun, never a sentence and never the key', () => {
    // Same rule the options pipe already enforces for slip: a sentence shipped
    // from the server cannot be re-worded without a back-end release.
    for (const l of TRANSLATE_LANGUAGES) {
      expect(l.fallback_label).not.toContain(' ');
      expect(l.fallback_label).not.toBe(l.label_key);
      expect(l.fallback_label).not.toBe(l.code);
    }
  });

  it('🔴 label keys are `field_options.translate_target_lang.<code>` exactly', () => {
    /* A CROSS-REPO CONTRACT the FE has already committed to JSON, extrapolated
       from the only precedent in the repo (`field_options.slip_provider.
       swiftcheck`). Asserted per entry AND against the code, so a key built from
       the wrong language — the failure that is worse than showing a raw key —
       cannot pass. */
    expect(TRANSLATE_LANGUAGE_LABEL_NS).toBe(
      'field_options.translate_target_lang',
    );
    for (const l of TRANSLATE_LANGUAGES) {
      expect(l.label_key).toBe(`${TRANSLATE_LANGUAGE_LABEL_NS}.${l.code}`);
      expect(l.label_key).not.toContain(' ');
    }
  });

  it('🔴 the namespace and the registered field key cannot drift apart', () => {
    /* The FE builds `field_options.<key>.<code>` from the key it fetches. If
       the pipe key and the label namespace stop agreeing, every label falls
       through to `fallback_label` with nothing anywhere reporting it. This is
       the case that makes a rename on EITHER side go red on THIS side. */
    expect(TRANSLATE_LANGUAGE_LABEL_NS).toBe(`field_options.${FIELD_KEY}`);
    expect(Object.keys(FIELD_OPTION_SOURCES)).toContain(FIELD_KEY);
  });
});

describe('[CHATTRANS] the guard — an unlisted code is refused', () => {
  it('🔴 refuses a code the registry never knew', () => {
    /* THE CASE MUTATION M5 KILLS. `isTranslateLanguage` returning true for
       anything makes the module's second line of defence vacuous — and it IS a
       second line: a caller's `@IsIn` only runs for requests that meet Nest's
       ValidationPipe, which a job or a queue consumer never does. */
    for (const code of [
      'xx',
      'zh', // deliberately NOT registered: Simplified and Traditional are split
      'zh-CN', // a region tag, not the script tag this registry stores
      'TH', // codes are case-sensitive — `zh-Hant` names a script
      'english',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(isTranslateLanguage(code)).toBe(false);
    }
  });

  it('accepts all seven, and tolerates surrounding whitespace', () => {
    for (const [code] of SEVEN) {
      expect(isTranslateLanguage(code)).toBe(true);
      expect(isTranslateLanguage(`  ${code} `)).toBe(true);
    }
  });

  it('the requestable list is the enabled half, and it resolves', () => {
    /* What a caller's `@IsIn(TRANSLATE_LANGUAGE_CODES)` takes. Derived from the
       live registry on both sides on purpose — a list typed here would pass on
       the day a language is added and the DTO silently keeps refusing it. */
    expect([...TRANSLATE_LANGUAGE_CODES]).toEqual(
      TRANSLATE_LANGUAGES.filter((l) => l.enabled).map((l) => l.code),
    );
    for (const code of TRANSLATE_LANGUAGE_CODES) {
      expect(isTranslateLanguage(code)).toBe(true);
    }
  });

  it('🔴 a retired language still RESOLVES even though it is refused', () => {
    /* `enabled: false` retires a language without deleting it, so a row already
       stored under that code keeps rendering. The two lookups answer different
       questions and today all seven are enabled, so this asserts the SHAPE of
       that split: everything requestable is resolvable, and the resolver's
       vocabulary is the full list — never a subset of it.
       Proved live by the mutation that flips one `enabled` to false: the
       options list drops it, `translateLanguage` still answers. */
    expect([...knownTranslateLanguageCodes()]).toEqual(
      TRANSLATE_LANGUAGES.map((l) => l.code),
    );
    expect(TRANSLATE_LANGUAGE_CODES.length).toBeLessThanOrEqual(
      knownTranslateLanguageCodes().length,
    );
    for (const code of knownTranslateLanguageCodes()) {
      expect(translateLanguage(code)).not.toBeNull();
    }
    expect(translateLanguage('xx')).toBeNull();
  });
});

describe('[CHATTRANS] prompt_name — what the model is actually told', () => {
  it('🔴 maps every code to its English name', () => {
    /* THE CASE MUTATION M6 KILLS: hand the bare code to the prompt instead of
       this, and a model receives `into zh-Hant` where it could have received
       `into Traditional Chinese`. Nothing else in the suite would notice — the
       wire specs pin body key ORDER and the determinism knobs, not the words. */
    for (const [code, name] of SEVEN) {
      expect(translatePromptName(code)).toBe(name);
    }
    expect(translatePromptName('zh-Hant')).toBe('Traditional Chinese');
    expect(translatePromptName('zh-Hant')).not.toBe('zh-Hant');
  });

  it('degrades to the code for an unknown one rather than throwing', () => {
    /* A LAST RESORT, and deliberately not an exception: an unrecognised code —
       a row from a future release, a caller that skipped the guard — must
       degrade that one call to today's behaviour, not turn a translation into a
       500. The guard above is what keeps codes off this path to begin with. */
    expect(translatePromptName('xx')).toBe('xx');
    expect(translatePromptName('  xx  ')).toBe('xx');
    expect(translatePromptName(null)).toBe('');
    expect(translatePromptName(undefined)).toBe('');
  });
});

describe('[CHATTRANS] the options pipe serves the list — with no new route', () => {
  it('🔴 answers under the registered key, through the pipe that already exists', () => {
    /* `GET /api/field-options/translate_target_lang` works the moment the
       registry line lands: same controller, same guard, same shape, nothing new
       for `route-coverage.mjs`. A second endpoint answering the same question
       would sit outside that tested guard and nothing would go red when the two
       drifted. */
    const options = fieldOptionsFor(FIELD_KEY);
    expect(options).not.toBeNull();
    expect(options).toEqual(translateLanguageOptions());
  });

  it('offers exactly the enabled codes, in registry order', () => {
    // Derived from the live registry on both sides — a hand-typed list here
    // would pass on the day a language is added and the pipe forgets it.
    expect((fieldOptionsFor(FIELD_KEY) ?? []).map((o) => o.value)).toEqual(
      TRANSLATE_LANGUAGES.filter((l) => l.enabled).map((l) => l.code),
    );
  });

  it('every offered value survives the guard the module itself uses', () => {
    /* 🔴 NEVER OFFER A VALUE THE SERVER CANNOT ACT ON — the rule the whole
       options pipe exists for. An offered code that the module then refuses
       would let an operator pick a language, see it saved, and get nothing,
       with no report anywhere. */
    const unusable = (fieldOptionsFor(FIELD_KEY) ?? [])
      .filter((o) => !isTranslateLanguage(o.value))
      .map((o) => o.value);
    expect(unusable).toEqual([]);
  });

  it('carries label keys and fallbacks, and marks no default', () => {
    const options = fieldOptionsFor(FIELD_KEY) ?? [];
    for (const o of options) {
      expect(o.label_key).toBe(`${TRANSLATE_LANGUAGE_LABEL_NS}.${o.value}`);
      expect(o.fallback_label).toBeTruthy();
      expect(o.is_default).toBeUndefined();
    }
    /* No `is_default` here, unlike slip: `''` is a real supported state for a
       slip provider ("use whatever the system uses"), while a translation
       target has no language to fall back TO. So every entry is a real choice
       and the count equals the list length — correct, not an oversight. */
    expect(realChoiceCount(options)).toBe(options.length);
    expect(options).toHaveLength(SEVEN.length);
  });

  it('the source is pure — two calls agree and neither can be mutated', () => {
    /* It answers on a request that renders a form, so it must be cheap and
       repeatable. The second half matters more than it looks: returning the
       `as const` array itself would let one caller's `.sort()` reorder the
       picker for everybody, for the rest of the process's life. */
    expect(translateLanguageOptions()).toEqual(translateLanguageOptions());
    expect(translateLanguageOptions()).not.toBe(translateLanguageOptions());
    const first = translateLanguageOptions();
    first.pop();
    first[0]!.value = 'MUTATED';
    expect(translateLanguageOptions()).toHaveLength(SEVEN.length);
    expect(translateLanguageOptions()[0]!.value).toBe(SEVEN[0]![0]);
  });
});

describe('[CHATTRANS] 🔴 the key that was already there is untouched', () => {
  it('`slip_provider` still points at slip’s own source, unchanged', () => {
    /* THE CASE MUTATION M7 KILLS, and the reason it is in THIS file: adding a
       line to a shared registry is exactly the edit that can disturb the lane
       already using it — and that lane decides which vendor verifies MONEY. A
       proof living only in `field-options-pipe.spec.ts` would not travel with
       the change that could break it.
       Identity, not just equality: `toBe` catches the registry being pointed at
       a wrapper, a copy, or at the wrong source entirely. */
    expect(FIELD_OPTION_SOURCES['slip_provider']).toBe(slipProviderOptions);
    expect(fieldOptionsFor('slip_provider')).toEqual(slipProviderOptions());
  });

  it('adding a key changed no answer the pipe already gave', () => {
    /* The unknown-key contract still holds (the controller turns it into a 404,
       so an empty list or a throw would both be wrong answers), and the two
       registered keys do not answer for each other. */
    expect(fieldOptionsFor('nope')).toBeNull();
    expect(fieldOptionsFor('')).toBeNull();
    expect(fieldOptionsFor(null)).toBeNull();
    expect(fieldOptionsFor('slip_provider')).not.toEqual(
      fieldOptionsFor(FIELD_KEY),
    );
    for (const key of Object.keys(FIELD_OPTION_SOURCES)) {
      expect(fieldOptionsFor(key)).not.toBeNull();
    }
  });
});

/**
 * The three env keys live in the same change and nothing else covers them, so
 * they are proved here rather than left to a green suite that never touched
 * them. They are the part of this work that can break someone else: `env.schema
 * .ts` is read by every boot, and `app.config.ts` is imported by webhook, chat,
 * crypto, redis and a dozen harnesses.
 *
 * ⚠️ `validateEnv()` sets a module-level `validatedEnv` that `registerAs`
 * factories read. Jest gives each test FILE its own module registry, so that
 * write cannot reach another spec — but it does mean the cases below must build
 * the env they want rather than assume one.
 */
describe('[CHATTRANS] the three env keys — optional, defaulted, and isolated', () => {
  /**
   * The only three keys the schema actually REQUIRES, so a case can build a
   * valid environment without listing sixty. Values are obvious placeholders:
   * nothing here connects to anything, and none of the three is read by the
   * namespace under test.
   */
  const BASE = {
    MONGODB_URI: 'mongodb://127.0.0.1:27017/not-a-real-db',
    JWT_SECRET: 'unit-test-not-a-real-secret',
    ENCRYPTION_KEY: 'unit-test-not-a-real-key',
  } as const;

  it('🔴 unset means UNSET for the cap, not zero and not five', () => {
    /* The whole fallback rests on this. Every other int key in the file resolves
       to a number when absent; this one must stay `undefined`, because a default
       of 5 here would be indistinguishable from a deliberate 5 and would pin
       translate's ceiling — raising `AI_CAP_LIMIT` would then stop reaching it. */
    expect(
      envSchema.shape.AI_TRANSLATE_CAP_LIMIT.parse(undefined),
    ).toBeUndefined();
    expect(envSchema.shape.AI_TRANSLATE_CAP_LIMIT.parse('')).toBeUndefined();
    expect(envSchema.shape.AI_TRANSLATE_CAP_LIMIT.parse('9')).toBe(9);
    // and it is still validated: a nonsense value must stop the boot, loudly
    expect(() => envSchema.shape.AI_TRANSLATE_CAP_LIMIT.parse('0')).toThrow();
    expect(() => envSchema.shape.AI_TRANSLATE_CAP_LIMIT.parse('abc')).toThrow();
  });

  it('the preview knobs default to 12 per 60s, and env still wins', () => {
    // Owner, 09/09. The numbers come from env, never from a literal at a call
    // site — that is what makes them tunable without shipping code.
    expect(envSchema.shape.AI_TRANSLATE_PREVIEW_MAX.parse(undefined)).toBe(12);
    expect(
      envSchema.shape.AI_TRANSLATE_PREVIEW_WINDOW_SECONDS.parse(undefined),
    ).toBe(60);
    expect(envSchema.shape.AI_TRANSLATE_PREVIEW_MAX.parse('20')).toBe(20);
    expect(() => envSchema.shape.AI_TRANSLATE_PREVIEW_MAX.parse('0')).toThrow();
  });

  it('🔴 the cap falls back to AI_CAP_LIMIT when its own key is unset', () => {
    /* Unset ⇒ byte-identical to today. This is the property that lets the
       feature ship without anyone configuring anything. */
    validateEnv({ ...BASE, AI_CAP_LIMIT: '5' });
    expect(aiTranslateConfig().capLimit).toBe(5);
    expect(aiTranslateConfig().previewMax).toBe(12);
    expect(aiTranslateConfig().previewWindowSeconds).toBe(60);
  });

  it('🔴 its own key wins WITHOUT moving the number the bot lanes read', () => {
    /* The entire reason the key exists. `AI_CAP_LIMIT` is read by three
       decorators — webhook reply, assist summary, and translate — so raising the
       shared one to give translate room would re-ceiling the customer-facing bot
       in the same breath. Both numbers are asserted in one case on purpose: the
       claim is about the PAIR, and asserting only ours would pass even if the
       shared one had moved. */
    const env = validateEnv({
      ...BASE,
      AI_CAP_LIMIT: '5',
      AI_TRANSLATE_CAP_LIMIT: '50',
    });
    expect(aiTranslateConfig().capLimit).toBe(50);
    expect(env.AI_CAP_LIMIT).toBe(5);
  });

  it('adds a namespace instead of widening one — nothing existing moved', () => {
    /* `app.config.ts` records that widening `channelConfig` rippled into TEN
       hand-built spec harnesses, and that the count was believed to be two until
       someone measured it. A new namespace ripples into none, and this case
       states the shape that claim depends on: our three fields are OURS, and no
       existing namespace grew one of them. */
    validateEnv({ ...BASE, AI_CAP_LIMIT: '5' });
    expect(Object.keys(aiTranslateConfig()).sort()).toEqual([
      'capLimit',
      'previewMax',
      'previewWindowSeconds',
    ]);
    expect(aiTranslateConfig.KEY).toBe('CONFIGURATION(aiTranslate)');
  });
});
