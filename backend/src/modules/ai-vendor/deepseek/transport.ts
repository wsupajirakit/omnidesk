/**
 * [FEAT-20260907-AIVENDORCORE] The DeepSeek door — one URL, one reader.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 * ===========================================================================
 * DeepSeek looked tidier than Gemini and was not. `DEEPSEEK_CHAT_URL` is
 * declared TWICE (`webhook/ai-vendors/deepseek/deepseek-reply.transport.ts:40`
 * and `tickets/translate/vendors/deepseek-translate.transport.ts:26`) and
 * `DEEPSEEK_HTTP_TIMEOUT_MS` THREE times — the webhook pair shares one copy,
 * translate keeps its own of both. Same values every time, by luck: nothing
 * would have failed if one had drifted.
 *
 * ⚠️ THE KEY RIDES AN Authorization HEADER, never the query string — the
 *    opposite of Gemini, and that difference is real, not an inconsistency to
 *    tidy. `ai-vendor-wire-baseline.spec.ts` asserts both.
 *
 * ⚠️ Same scope line as the Gemini door: this owns the URL, the body and the
 *    reader; the caller keeps `axios.post` so no retry or logging contract moves.
 *
 * revert: delete this file and restore each transport's own constants.
 */
import { DEEPSEEK_CHAT_URL } from '@/common/ai-endpoints';

import type { VendorCall } from '../call';

export { DEEPSEEK_CHAT_URL };

/** The OpenAI-compatible chat body, exactly as the three transports built it. */
export interface DeepSeekBody {
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  top_p: number;
}

/**
 * Build the request body.
 *
 * 🔴 FOUR KEYS, ALWAYS, IN THIS ORDER — `model`, `messages`, `temperature`,
 *    `top_p`. No `stream`, no `max_tokens`, no `top_k`: all three existing
 *    transports omit them and adding one would change every DeepSeek request in
 *    the system at once.
 *
 * 🔴 ABSENT MEANS ABSENT. A system message appears ONLY when the caller supplies
 *    a system instruction — the reply lane does, summary and translate do not,
 *    and their bodies must stay one-message.
 */
export function buildDeepSeekBody(call: VendorCall): DeepSeekBody {
  const userText = call.parts
    .map((p) => p.text ?? '')
    .filter((t) => t !== '')
    .join('\n\n');
  const messages: { role: string; content: string }[] = [];
  if (call.systemInstruction !== undefined) {
    messages.push({ role: 'system', content: call.systemInstruction });
  }
  messages.push({ role: 'user', content: userText });
  return {
    model: call.model,
    messages,
    temperature: call.knobs.temperature,
    top_p: call.knobs.topP,
  };
}

/**
 * The OpenAI-shaped answer walk.
 *
 * ⚠️ DeepSeek answers `choices[0].message.content`, NOT Gemini's
 *    `candidates[…]`. One door, two readers — the vendors do not agree and
 *    pretending they do is how a caller gets `undefined` with no error.
 *
 * 🔴 TRANSCRIBED FROM THE TWO EXISTING READERS, WHICH WERE IDENTICAL — including
 *    the two guards a naive version drops. The first draft of this file walked
 *    straight to `.content` and would have SILENTLY WEAKENED both callers:
 *      · `finish_reason === 'content_filter'` — a filtered turn answers 200 with
 *        a choice present. Reading its content as an answer sends the customer
 *        whatever the filter left behind.
 *      · `content` is `null`, not absent, on a filtered or tool-call turn, and
 *        this data came from `unknown` so the declared type cannot be trusted.
 *        Narrow on the VALUE: anything that is not a NON-EMPTY string means "no
 *        answer", which is the single meaning both interpreters gate on
 *        (`rawText === undefined`). Returning null slips past that gate and only
 *        survives downstream by `||` truthiness.
 *    Caught by reading the callers before replacing them, not by a test — no
 *    existing test covered the filtered turn.
 */
export function readDeepSeekText(data: unknown): string | undefined {
  const choice = (
    data as
      | {
          choices?: {
            message?: { content?: string };
            finish_reason?: string;
          }[];
        }
      | undefined
  )?.choices?.[0];
  if (!choice) return undefined;
  if (choice.finish_reason === 'content_filter') return undefined;
  const text = choice.message?.content;
  return typeof text === 'string' && text !== '' ? text : undefined;
}
