/**
 * [PROG-20260905-LADDER] Ask the model — legacy:4122-4256.
 *
 * The prompt ASSEMBLY moved to `ai-reply/prompt-assembly.ts` at SP15; what stayed in the
 * spine was the request literal and the call, because *when* the model is asked is a
 * gate-order fact. It still is — it is just declared now instead of implied by a line
 * number.
 *
 * ⚠️⚠️ THE CATCH IS NOT BELT-AND-BRACES, AND ITS SHAPE IS LEGACY'S. The default binding
 * REJECTS; legacy's own model wrapper returned a fallback envelope rather than throwing.
 * The envelope built below is what legacy produces on a model error — no text, `noData`,
 * no tag verdict, the message kept for the log row — so the pipeline then takes exactly
 * the path it takes when the model has nothing to say. Removing it would send the failure
 * to the outer catch, the reply block would never run, and the customer would get nothing.
 *
 * ⚠️ ONLY A MISSING KEY IS A GENERATIVE ERROR (`http_status: 0`), which is what routes to
 * `ai_generative_error_text`. Any other rejection keeps `http_status` null so it flows to
 * the not-found `default_answer_text` path, exactly as before — matched BY NAME rather
 * than `instanceof`, to keep the concrete provider out of this layer.
 */

import { siteRulesReachAi } from '@/modules/customer-provider';

import {
  buildSuggestionForHook,
  hasProfileData,
  resolveDictTool,
} from '../ai-reply/prompt-context.util';
import { buildDocFingerprint } from '../ai-reply/prompt-log.util';
import { extractFlexProfileFields } from '../flex/flex-render.util';
import {
  asString,
  errText,
  formatThaiDateTime,
} from '../logging/coerce-mask.util';

import type { LadderStep, StepVerdict } from './ladder.types';

export const askModelStep: LadderStep = {
  id: 'ask-model',
  describe:
    'assemble the prompt and take the model turn, or build legacy`s error envelope',
  enabled: true,
  mustFollow: ['doc-retrieval'],
  orderNote:
    'the request carries docText, so retrieval and its substitution must both be done ' +
    'before the model is asked (webhook.service.ts:4239)',
  reads: [
    'hook',
    'userId',
    'userText',
    'relatedText',
    'suggestionOverride',
    'profileData',
    'apiErrorTrigger',
    'creds',
  ],
  writes: ['replyTextRaw', 'tagStatus', 'responseAi', 'aiMs', 'modelAudit'],

  run: async (ctx, deps): Promise<StepVerdict> => {
    const aiStart = Date.now();
    const hook = ctx.hook;

    const hasProfile = hasProfileData(ctx.profileData);
    /* [FEAT-20261026-RAGENGINE] `replace` mode hands a reduced Training Doc in the same box shape;
       every other OA (override null) builds the full one exactly as before — byte for byte. */
    let processedSuggestion =
      ctx.suggestionOverride ?? buildSuggestionForHook(hook, hasProfile);

    /* [FEAT-20260822-AIPROMPTLOG] fingerprint the RAW doc fields HERE — after this point
       the suggestion gets the time line and chat history substituted in, so a hash taken
       later differs on every call. Log-only. */
    const promptDocMeta = buildDocFingerprint(hook);
    /* [FEAT-20260902-NOWBLOCK] ONE instant, captured once and shared with the block below.
       Two separate clock reads could straddle a second — or at 23:59:59.999 a whole day —
       and the block would then contradict the very time line it sits beside. */
    const nowInstant = new Date();
    const thaiNow = formatThaiDateTime(nowInstant);

    const assembled = await deps.assemblePrompt({
      hook,
      userId: ctx.userId,
      userText: ctx.userText,
      thaiNow,
      nowInstant,
      suggestion: processedSuggestion,
    });
    processedSuggestion = assembled.suggestion;

    const aiRequest = {
      question: ctx.userText,
      docText: ctx.relatedText,
      suggestionText: processedSuggestion,
      // [FEAT-20260830-STABLEPROMPT] undefined on the default path — buildBlocks emits
      // nothing and the wire bytes are unchanged.
      historyBlockText: assembled.historyBlockText,
      timeContextText: assembled.timeContextText,
      // [FEAT-20260902-NOWBLOCK] undefined unless the switch is on.
      nowBlockText: assembled.nowContextText,
      profileData: ctx.apiErrorTrigger ? null : ctx.profileData,
      temperature: ctx.creds.geminiTemp ?? null,
      topK: ctx.creds.geminiTopK ?? null,
      topP: ctx.creds.geminiTopP ?? null,
      thinkingBudget: ctx.creds.geminiThinkingBudget ?? null,
      /* [FEAT-20260909-DSREASONING] carried through unchanged. Null for every OA
         that has not set it, and the Gemini transport never reads it — so this
         line changes nothing for anyone until an admin fills the box. */
      reasoning: ctx.creds.deepseekReasoning ?? null,
      // [P2-20260813] which vendor answers, and which model it asks for.
      aiVendor: ctx.creds.aiVendor,
      aiModel: ctx.creds.aiModel,
      hookId: asString(hook?.['_id']) ?? null,
      // [FEAT-20260728-TAGSCOPE] the hook's group, so group-scoped dynamic tags resolve.
      hookGroupId: asString(hook?.['group']) ?? null,
      // [FEAT-20260731-RAWJSON] `=== true` only: an older hook has no column (undefined)
      // and null means off, so no migration is needed.
      sendRawJson: hook?.['ai_raw_json_analysis'] === true,
      rawJsonRules: (hook?.['ai_raw_json_rules'] as string) || '',
      // [FEAT-20260802-RAWSITERULES] a separate switch from the raw json.
      // [FEAT-20261018-SITERULESWORLD] AND the provider's site-rules world (loan: off ⇒ neither
      // block is sent) · shop-api declares nothing ⇒ the switch alone, as before.
      sendSiteRules: siteRulesReachAi(hook?.['ai_raw_site_rules']),
      siteRulesGuide: (hook?.['ai_site_rules_guide'] as string) || '',
      // [REFACTOR-20260803-DICTIDENTITY] the same vocabulary the OA's flex cards use, so a
      // tool-level or site-level translation applies to both.
      dictOpts: {
        tool: resolveDictTool(hook ?? null),
        scope:
          (extractFlexProfileFields(ctx.profileData)?.profile?.['web_code'] as
            string | undefined) || null,
      },
      // [P2-20260813] the OA's own key only — the provider applies the vendor's fallback
      // rule, if that vendor has one.
      apiKey: ctx.creds.hookAiKey || null,
    };

    let aiResponse;
    try {
      aiResponse = await deps.generateAiReply(aiRequest);
    } catch (aiErr) {
      deps.warn(
        `[AI] provider unavailable — no answer generated: ${errText(aiErr)}`,
      );
      // [FIX-20260808-AIGENERROR] see the header: only a MISSING KEY is a generative error.
      const isKeyMissing =
        aiErr instanceof Error && aiErr.name === 'GeminiKeyMissingError';
      aiResponse = {
        text: null,
        noData: true,
        tagStatus: null,
        error_message: errText(aiErr),
        http_status: isKeyMissing ? 0 : null,
        response_data: null,
      };
    }
    ctx.aiMs = Date.now() - aiStart;
    deps.log(`[PERF-20260802-TIMING] ai generate: ${ctx.aiMs}ms`);

    ctx.replyTextRaw = aiResponse.text;
    ctx.tagStatus = aiResponse.tagStatus;
    ctx.responseAi = aiResponse.response_data ?? null;
    /* Six values that ONLY the audit row reads, grouped into one field rather than six.
       A top-level context field is a promise that anything in the ladder may read it; a
       named group says who it is for. The context is the thing this design must stop from
       becoming the next bag. รวมเป็นก้อนเดียว จะได้รู้ว่าใครใช้ */
    ctx.modelAudit = {
      noData: aiResponse.noData,
      errorMessage: aiResponse.error_message,
      httpStatus: aiResponse.http_status,
      promptDocMeta,
      thaiNow,
      startedAt: aiStart,
    };
    return 'continue';
  },
};
