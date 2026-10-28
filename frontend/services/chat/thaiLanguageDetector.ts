/**
 * [LEGACY-20260918-THAIDETECT] KEPT, NOT CALLED BY THE APP — owner's call, 18/09.
 * ============================================================================
 * This decision moved to the backend. When auto-translation ran in the browser
 * this file answered "is the incoming line already Thai, so skip it"; that
 * question is now asked once, server-side, where the message is stored:
 *
 *     omnidesk-api/src/modules/chat/translate/auto/should-auto-translate.ts
 *       · INBOUND_TARGET        — inbound always reads into Thai
 *       · looksAlreadyInTarget  — Thai in, nothing spent (owner: "ไทยเราไม่แปล")
 *       · hasTranslatableText   — emoji / digits / links are not sentences
 *
 * Asking it in two places would be two answers to one question, and the vendor's
 * own `translations[].from` is the authority anyway. No application file imports
 * this module any more — only its own spec does.
 *
 * It stays because the rules in it are correct and were tuned against real chat
 * text; if the browser ever needs the check again, it is here and it works.
 * เก็บไว้เฉย ๆ ยังไม่เรียกใช้ · ตัวจริงย้ายไป BE แล้ว
 *
 * revert: import `shouldSkipAutoTranslateForThai` where it is needed again —
 * nothing here changed, only who calls it.
 */

/**
 * [FEAT-20260918-ROOMTRANS] Thai Language Detector for Chat Messages.
 * =====================================================================
 * Deep dive detection for Thai text in real-world chat messages.
 *
 * Requirements:
 * 1. Independent, modular, scalable — easy to change conditions or turn off without breaking the system.
 * 2. If an incoming message is Thai, skip translation and display normally (as-is).
 * 3. If NOT Thai, proceed to normal auto-translate checks.
 * 4. Easily toggleable with `FEATURE_SKIP_TRANSLATE_THAI` or options.enabled.
 *
 * Unicode Thai Block: U+0E00 - U+0E7F
 * - Consonants: \u0E01 - \u0E2E (ก - ฮ)
 * - Vowels & Marks: \u0E30 - \u0E3A, \u0E40 - \u0E4E (ะ, า, ิ, ี, ึ, ื, ุ, ู, เ, แ, โ, ใ, ไ, ฯ, ็, ่, ้, ๊, ๋, ์)
 * - Digits & Symbols: \u0E50 - \u0E59, \u0E4F (๐-๙, ฿)
 */

/** Master feature toggle — set to false to completely disable Thai skipping without refactoring */
export const FEATURE_SKIP_TRANSLATE_THAI = true;

/** Thai script regex covering all Thai letters, vowels, tone marks, and diacritics */
export const THAI_SCRIPT_REGEX = /[\u0E01-\u0E3A\u0E40-\u0E4E]/g;

/** Non-Thai foreign alphabets (Latin, CJK, Myanmar, Lao, Khmer, Cyrillic, Arabic) */
export const FOREIGN_SCRIPT_REGEX = /[a-zA-Z\u4E00-\u9FFF\u1000-\u109F\u0E80-\u0EFF\u1780-\u17FF\u0400-\u04FF\u0600-\u06FF]/g;

/** Common non-translatable noise: URLs, pure digits, symbols, emojis */
export const URL_REGEX = /https?:\/\/\S+/gi;
export const EMOJI_AND_SYMBOLS_REGEX = /[\p{Extended_Pictographic}\p{P}\p{S}\s\d]/gu;

export interface ThaiDetectionOptions {
  /** Master toggle for this specific check. Defaults to FEATURE_SKIP_TRANSLATE_THAI. */
  enabled?: boolean;
  /** Minimum ratio of Thai letters to total alphabetic letters (default 0.15 = 15%). */
  minThaiRatio?: number;
  /** Minimum count of Thai characters required (default 1). */
  minThaiChars?: number;
  /** Whether to treat non-translatable text (emojis, numbers, URLs) as skip (default true). */
  skipNonTranslatable?: boolean;
}

/**
 * Checks whether text contains translatable linguistic content
 * (as opposed to pure emojis, digits, punctuation, or URLs).
 */
export function isTranslatableText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const stripped = text
    .replace(URL_REGEX, '')
    .replace(EMOJI_AND_SYMBOLS_REGEX, '')
    .trim();
  // Must have at least one alphabetic or script character to be worth translating
  return stripped.length > 0;
}

/**
 * Checks whether text is non-translatable (pure emojis, numbers, punctuation, URLs, whitespace).
 */
export const isNonTranslatableText = (text: string): boolean => !isTranslatableText(text);

/**
 * Accurately determines if text is in Thai language.
 * Handles mixed text (e.g. "tracking no. 12345 ส่งแล้วครับ", "โอนเงินแล้ว 500 บาทนะค้าบ").
 */
export function isThaiText(text: string, options?: ThaiDetectionOptions): boolean {
  if (!text || typeof text !== 'string') return false;

  const minRatio = options?.minThaiRatio ?? 0.15;
  const minChars = options?.minThaiChars ?? 1;

  // Clean URLs first
  const cleanText = text.replace(URL_REGEX, '').trim();
  if (!cleanText) return false;

  const thaiMatches = cleanText.match(THAI_SCRIPT_REGEX);
  const thaiCount = thaiMatches ? thaiMatches.length : 0;

  if (thaiCount < minChars) {
    return false; // No Thai script or fewer than required characters
  }

  const foreignMatches = cleanText.match(FOREIGN_SCRIPT_REGEX);
  const foreignCount = foreignMatches ? foreignMatches.length : 0;
  const totalLetters = thaiCount + foreignCount;

  if (totalLetters === 0) {
    return false;
  }

  const thaiRatio = thaiCount / totalLetters;
  return thaiRatio >= minRatio;
}

/**
 * Primary decision function: should auto-translation be SKIPPED for this message?
 *
 * Returns TRUE if:
 * 1. Feature is enabled AND message is Thai language (display normally).
 * 2. Message has no translatable linguistic content (pure digits, pure emojis, URLs).
 *
 * Returns FALSE if:
 * 1. Feature is disabled.
 * 2. Message is foreign language (English, Burmese, Chinese, Lao, Khmer, etc.) needing translation.
 */
export function shouldSkipAutoTranslateForThai(
  text: string,
  options?: ThaiDetectionOptions,
): boolean {
  const isEnabled = options?.enabled ?? FEATURE_SKIP_TRANSLATE_THAI;
  if (!isEnabled) {
    return false;
  }

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return true; // Nothing to translate
  }

  // Non-translatable noise (e.g. "55555", "👍👍", "???", "https://line.me")
  const skipNonTranslatable = options?.skipNonTranslatable ?? true;
  if (skipNonTranslatable && !isTranslatableText(text)) {
    return true;
  }

  // Check if message is Thai
  return isThaiText(text, options);
}
