/**
 * [FEAT-20260810-DOCRETRIEVAL] The document context for the prompt — legacy:4017-4078.
 *
 * The decision itself lives in `doc-retrieval/fetch-related-text.ts`, beside the seam and
 * the shipped adapter. What is here is the ladder position and the substitution that has
 * to follow it.
 *
 * ⚠️ SEAMLESS BY DEFAULT. `doc_retrieval` is off for every existing OA, so this step
 * answers `''` with no seam call, no extra model call and no extra spend — exactly as
 * before the feature existed. `doc-retrieval-baseline.spec.ts` pins that and must keep
 * passing untouched.
 *
 * ⚠️⚠️ SUBSTITUTION RUNS AFTER RETRIEVAL, NEVER BEFORE, and it is why the two are one step
 * rather than two. Retrieval caches by `doc_id`; substituting first would make the cached
 * body hook-specific, and **two hooks sharing one document could then read each other's
 * domain**. Splitting them into separate ladder rows would let a future reorder put the
 * substitution first with nothing objecting. แทนค่าหลังดึงเสมอ ไม่งั้นแคชปนกันข้าม OA
 */

import {
  buildSuggestionSections,
  hasProfileData,
  substituteCtxVars,
} from '../ai-reply/prompt-context.util';
import { fetchDocContext } from '../doc-retrieval/fetch-related-text';
import { asString, errText } from '../logging/coerce-mask.util';

import type { LadderStep, StepVerdict } from './ladder.types';

export const docRetrievalStep: LadderStep = {
  id: 'doc-retrieval',
  describe:
    'fetch the training-document context for the prompt, or answer empty',
  enabled: true,
  mustFollow: ['require-user-text'],
  mustPrecede: ['ask-model'],
  orderNote:
    'it needs the question, and its result is the prompt`s docText — retrieval caches by ' +
    'doc_id, so the ctx-var substitution inside it must stay after the fetch',
  reads: ['hook', 'creds', 'userText', 'ignoreDocId', 'profileData'],
  writes: ['relatedText', 'suggestionOverride'],

  run: async (ctx, deps): Promise<StepVerdict> => {
    /* [FEAT-20261026-RAGENGINE] the Training Doc boxes are built ONLY for an OA that turned
       retrieval on — the default path does no extra work at all. */
    const on = ctx.hook?.['doc_retrieval'] === true;
    const docCtx = await fetchDocContext(
      {
        hook: ctx.hook,
        docId: ctx.creds.docId,
        question: ctx.userText,
        // [P2] GEMINI's key by name — this value goes into a Google URL downstream.
        geminiOnlyKey: ctx.creds.geminiOnlyKey,
        ignoreDocId: ctx.ignoreDocId,
        hookId: on ? (asString(ctx.hook?.['_id']) ?? null) : null,
        sections: on
          ? buildSuggestionSections(ctx.hook, hasProfileData(ctx.profileData))
          : [],
      },
      {
        retrieve: deps.retrieveDoc,
        log: deps.log,
        warn: deps.warn,
        errText,
      },
    );
    // [FEAT-20260804-DOCCTXVAR] / [FIX-20260804-SUGGESTCTXVAR] — after retrieval.
    ctx.relatedText = substituteCtxVars(docCtx.docText, ctx.hook, ctx.userText);
    /* [FEAT-20261026-RAGENGINE] `replace` mode: the reduced Training Doc. It is NOT substituted
       here — `ask-model` hands it to the same assembly the full suggestion goes through, so
       history, ctx vars and dynamic tags are applied by the unchanged pipeline. */
    ctx.suggestionOverride = docCtx.suggestionOverride ?? null;
    return 'continue';
  },
};
