/**
 * [FEAT-20260910-DETECTSOURCE] The model answers with an envelope, and this
 * opens it — or falls back to today's behaviour and loses nothing.
 * ===========================================================================
 * The bubble wants to say `ไทย → จีนตัวเต็ม`, but nothing in the system knew the
 * left-hand side: the dashboard never sends a source language (the admin is not
 * asked), and the prompt used to end with *"Reply with the translation only"* —
 * so the one party that DID work out the source, the model, was told not to
 * mention it. The information existed for the length of one inference and was
 * thrown away.
 *
 * 🔴 SAME REQUEST, NOT A SECOND ONE. A detection call would double the spend on
 *    a lifetime-capped budget to learn something the translator already knew.
 *    The envelope costs a few tokens of the reply it was already paying for.
 *
 * 🔴 THE FALLBACK IS THE WHOLE SAFETY ARGUMENT. Any reply that is not a
 *    well-formed envelope is treated as **the translation itself, with no
 *    source language** — which is byte-for-byte what this feature did before the
 *    envelope existed. A model that ignores the format, a vendor that wraps the
 *    JSON in ``` fences, a future model that adds a field: none of them can
 *    break a translation. The worst case is a missing label.
 *    พังยังไงก็ยังได้คำแปล · อย่างมากคือไม่รู้ภาษาต้นทาง.
 *
 * ⚠️ THE CODE IS VALIDATED, NOT TRUSTED. Models answer `th`, `tha`, `Thai`,
 *    `zh`, `zh-TW`… Only a code the registry already knows is kept; anything
 *    else becomes `null`. A label the UI cannot render, or worse a code that is
 *    almost right, is worse than no label at all — and `null` is a state every
 *    reader on both sides already handles.
 *
 * ⚠️ IT NEVER THROWS. The interpreter above it owns the two real failures
 *    (vendor error / empty answer); this one only ever decides how much of a
 *    successful reply it understood.
 *
 * revert: delete this file, restore the one-line prompt, and have the
 *   interpreter return the trimmed string again.
 */
import { isTranslateLanguage } from './languages';

export interface TranslateEnvelope {
  /** the translation — always present, whatever shape the reply arrived in */
  text: string;
  /** the source language the model reported, if we can trust it */
  from: string | null;
}

/**
 * Strip a ``` fence when the model wrapped its JSON in one.
 *
 * ⚠️ Fenced JSON is the single most common way a well-behaved model breaks a
 * "reply with JSON only" instruction, and unwrapping it is not guesswork: the
 * fence is a wrapper with an unambiguous shape. Anything past this that still
 * does not parse goes down the fallback.
 */
const unfence = (reply: string): string => {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(reply.trim());
  return fenced?.[1]?.trim() ?? reply.trim();
};

export function parseTranslateEnvelope(reply: string): TranslateEnvelope {
  const plain = (reply ?? '').trim();
  const body = unfence(plain);
  /* Not JSON-shaped ⇒ do not even try. `JSON.parse` on a translation that
     happens to start with `{` is the only way this could misfire, and requiring
     both braces keeps the check honest without a try/catch doing the deciding. */
  if (!body.startsWith('{') || !body.endsWith('}')) {
    return { text: plain, from: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { text: plain, from: null };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { text: plain, from: null };
  }
  const { text, from } = parsed as { text?: unknown; from?: unknown };
  const translated = typeof text === 'string' ? text.trim() : '';
  /* An envelope with no `text` is not an envelope we can use — the reply may
     have been a JSON-looking translation. Fall back rather than return empty:
     the interpreter treats empty as a vendor failure and would refuse a call
     that actually succeeded. */
  if (!translated) return { text: plain, from: null };
  const code = typeof from === 'string' ? from.trim() : '';
  return {
    text: translated,
    from: code && isTranslateLanguage(code) ? code : null,
  };
}
