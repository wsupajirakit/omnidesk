import type { TranslateReasoning } from '@/modules/ai-translate';

/**
 * [FIX-20260910-ZHHANTFORCE] One vendor, one language, one knob — turned on for
 * the length of a single request because the alternative is silent and wrong.
 * ===========================================================================
 * FOUND BY FIRING IT, NOT BY READING: on 10/09 a live run asked DeepSeek to
 * translate `ขอสอบถามยอดหน่อยครับ` into Traditional Chinese and got
 * `ขอสอบถามยอดหน่อยครับ` back — the Thai, returned as the translation, with
 * HTTP 200, a stored entry, and no error anywhere. An admin who cannot read
 * Chinese would have pressed ➤ and sent Thai to a Chinese-speaking customer.
 *
 * ── WHAT THE EVIDENCE SAYS, AND WHAT IT DOES NOT ───────────────────────────
 *   DeepSeek · thinking OFF · effort low   → zh-Hant  ✗ Thai came back
 *   DeepSeek · thinking OFF · effort high  → zh-Hant  ✗ Thai came back
 *   DeepSeek · thinking ON  · effort low   → zh-Hant  ✅ 想請問一下金額
 *   DeepSeek · thinking OFF                → zh-Hans  ✅ 想询问一下余额。
 *   DeepSeek · thinking OFF                → en/my/km ✅
 *   Gemini   · any setting                 → zh-Hant  ✅ 想詢問一下金額
 *
 * ⇒ the deciding variable is the THINKING knob, not the effort, not the prompt,
 *   and not the model in general. So this raises exactly that knob, leaves
 *   `effort` at whatever the OA chose, and touches nothing else.
 *
 * ## 🔴 EVERY CONDITION MUST HOLD. A narrow rule is the point.
 *
 *   1. the TRANSLATE lane — this file is reached only from `callVendor` in
 *      `chat-translate.service.ts`, which no other lane uses. The reply and
 *      summary lanes cannot see it.
 *   2. vendor === 'deepseek' — a null vendor means the registry default, which
 *      is Gemini, and Gemini has no symptom.
 *   3. the target is in `FORCED_TARGET_LANGS` — one entry today, `zh-Hant`.
 *      Simplified Chinese was tested and is fine, so it is not in the list.
 *   4. thinking is not already on — an OA that chose `enabled` is left exactly
 *      as it asked.
 *
 * ⚠️ `disabled` AND unset both qualify (owner's call, 10/09). They are not the
 *    same thing — unset means the request says nothing and DeepSeek applies its
 *    own default, which was never tested for this pair — so the honest reading
 *    is "we do not know that unset is safe", and the owner chose to cover it
 *    rather than find out through a customer.
 *
 * ⚠️ NOTHING IS WRITTEN TO THE HOOK. The override lives for one request; the
 *    operator's column is untouched and the dashboard still shows what they
 *    chose. A silent write-back would make the next person debug a setting
 *    nobody set.
 *
 * ## The switch
 *
 * `FORCE_DEEPSEEK_THINKING_ON_ZH_HANT = false` restores the previous behaviour
 * completely — this function then returns its input unchanged and nothing else
 * in the codebase behaves differently. Owner asked for a variable rather than
 * an env value so removing it is one edit in one file, not a deployment
 * question.
 *
 * revert: flip the constant to `false`, or delete this file and the single
 *   `forceTranslateThinking(...)` call in `chat-translate.service.ts`.
 */
export const FORCE_DEEPSEEK_THINKING_ON_ZH_HANT = true;

/**
 * The target languages that showed the symptom — a LIST with one entry today.
 *
 * 🔴 A list rather than an `if (to === 'zh-Hant')` because that is the edit the
 *    next person will actually need to make: another pair turns up, one line
 *    goes in here, and no logic moves. It is not speculative generality — the
 *    set is exactly what was measured, and `zh-Hans` is deliberately NOT in it
 *    because Simplified Chinese was tested and works with thinking off.
 * ⚠️ Adding a code here without testing it makes this file a guess. Each entry
 *    should arrive with a run behind it, the way `zh-Hant` did.
 */
export const FORCED_TARGET_LANGS: readonly string[] = ['zh-Hant'];

export function forceTranslateThinking(
  reasoning: TranslateReasoning | null,
  vendor: string | null,
  targetLang: string,
): { reasoning: TranslateReasoning | null; forced: boolean } {
  if (
    !FORCE_DEEPSEEK_THINKING_ON_ZH_HANT ||
    vendor !== 'deepseek' ||
    !FORCED_TARGET_LANGS.includes(targetLang)
  ) {
    return { reasoning, forced: false };
  }
  const thinking = reasoning?.thinking ?? null;
  /* already thinking ⇒ the OA asked for it and gets it, untouched */
  if (thinking?.type === 'enabled') return { reasoning, forced: false };
  return {
    reasoning: {
      ...(reasoning ?? {}),
      /* effort rides along exactly as stored — the tests above show a low
         effort is enough once thinking is on, so raising it would spend the
         OA's money on a change nothing measured. */
      thinking: { ...(thinking ?? {}), type: 'enabled' },
    },
    forced: true,
  };
}
