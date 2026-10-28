/**
 * ==== SINGLE SOURCE OF TRUTH: TRANSLATE LANGUAGES (FRONTEND) ====
 *
 * 🔴 CROSS-REPO CONTRACT & CANONICAL DEFINITION:
 * This file is the Frontend Single Source of Truth for all supported translation languages,
 * strictly mirroring the backend authoritative registry at:
 * `omnidesk-api/src/modules/ai-translate/languages.ts`
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
 * 1. Backend: Update the canonical list in `omnidesk-api/src/modules/ai-translate/languages.ts`.
 * 2. Frontend: Update this mirrored list in `omnidesk-console/config/translateLanguages.ts`.
 * 3. i18n: Update translation entries in `omnidesk-console/i18n/translations/th.json` and `en.json`
 *    under the key `${TRANSLATE_LANGUAGE_LABEL_NS}.<code>` (e.g. `field_options.translate_target_lang.<code>`).
 *
 * The seven languages are kept in the exact canonical display order (Thai and English first),
 * matching backend TRANSLATE_LANGUAGES.
 */

export const TRANSLATE_LANGUAGE_LABEL_NS = 'field_options.translate_target_lang';

export const TRANSLATE_LANGUAGE_CODES = [
  'th',
  'en',
  'my',
  'zh-Hans',
  'zh-Hant',
  'lo',
  'km',
] as const;

export type TranslateLanguageCode = (typeof TRANSLATE_LANGUAGE_CODES)[number];

export interface TranslateLanguage {
  /** BCP-47 subtag code. Stored in DB and sent over wire */
  readonly code: TranslateLanguageCode;
  /** Emoji flag for UI display */
  readonly flag: string;
  /** Thai display name */
  readonly nameTh: string;
  /** English display name */
  readonly nameEn: string;
  /** i18n key resolved by t() */
  readonly labelKey: string;
  /** Fallback label (Thai display name) */
  readonly fallbackLabel: string;
  /** English prompt name */
  readonly promptName: string;
  /** Whether the language is active for new requests */
  readonly enabled: boolean;
}

export const TRANSLATE_LANGUAGES: readonly TranslateLanguage[] = [
  {
    code: 'th',
    flag: '🇹🇭',
    nameTh: 'ไทย',
    nameEn: 'Thai',
    labelKey: `${TRANSLATE_LANGUAGE_LABEL_NS}.th`,
    fallbackLabel: 'ไทย',
    promptName: 'Thai',
    enabled: true,
  },
  {
    code: 'en',
    flag: '🇬🇧',
    nameTh: 'อังกฤษ',
    nameEn: 'English',
    labelKey: `${TRANSLATE_LANGUAGE_LABEL_NS}.en`,
    fallbackLabel: 'อังกฤษ',
    promptName: 'English',
    enabled: true,
  },
  {
    code: 'my',
    flag: '🇲🇲',
    nameTh: 'พม่า',
    nameEn: 'Burmese',
    labelKey: `${TRANSLATE_LANGUAGE_LABEL_NS}.my`,
    fallbackLabel: 'พม่า',
    promptName: 'Burmese',
    enabled: true,
  },
  {
    code: 'zh-Hans',
    flag: '🇨🇳',
    nameTh: 'จีนตัวย่อ',
    nameEn: 'Simplified Chinese',
    labelKey: `${TRANSLATE_LANGUAGE_LABEL_NS}.zh-Hans`,
    fallbackLabel: 'จีนตัวย่อ',
    promptName: 'Simplified Chinese',
    enabled: true,
  },
  {
    code: 'zh-Hant',
    flag: '🇹🇼',
    nameTh: 'จีนตัวเต็ม',
    nameEn: 'Traditional Chinese',
    labelKey: `${TRANSLATE_LANGUAGE_LABEL_NS}.zh-Hant`,
    fallbackLabel: 'จีนตัวเต็ม',
    promptName: 'Traditional Chinese',
    enabled: true,
  },
  {
    code: 'lo',
    flag: '🇱🇦',
    nameTh: 'ลาว',
    nameEn: 'Lao',
    labelKey: `${TRANSLATE_LANGUAGE_LABEL_NS}.lo`,
    fallbackLabel: 'ลาว',
    promptName: 'Lao',
    enabled: true,
  },
  {
    code: 'km',
    flag: '🇰🇭',
    nameTh: 'เขมร',
    nameEn: 'Khmer',
    labelKey: `${TRANSLATE_LANGUAGE_LABEL_NS}.km`,
    fallbackLabel: 'เขมร',
    promptName: 'Khmer',
    enabled: true,
  },
] as const;

/** List of active language codes */
export const ACTIVE_TRANSLATE_LANGUAGE_CODES: readonly TranslateLanguageCode[] =
  TRANSLATE_LANGUAGES.filter((l) => l.enabled).map((l) => l.code);

/** Check if a code is a valid active translation language */
export const isTranslateLanguage = (code: unknown): code is TranslateLanguageCode =>
  typeof code === 'string' &&
  TRANSLATE_LANGUAGES.some((l) => l.code === code && l.enabled);

/** Safe parse into TranslateLanguageCode or null */
export const asTranslateLanguage = (code: unknown): TranslateLanguageCode | null =>
  isTranslateLanguage(code) ? code : null;
