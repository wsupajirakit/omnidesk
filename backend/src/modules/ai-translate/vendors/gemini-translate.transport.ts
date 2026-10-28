/**
 * [FEAT-20260818-TRANSLATE] GeminiTranslateTransport — the FIRST
 * TranslateTransport, not "the" translate path. Mirrors
 * `gemini-summary.transport.ts` (consumer #2's gemini leg).
 *
 * ⚠️ The ONLY translate file allowed to name Gemini or build its JSON.
 * ⚠️ [FEAT-20260908-CHATTRANS] Lives in `ai-translate/vendors/`. The note that
 *    stood here explained the location as an avoidance — "NOT webhook/ai-vendors/,
 *    because this module must not import the webhook barrel; webhook already
 *    imports tickets and a reverse import would close a TS-level cycle." That
 *    was a description of a wall, and the wall is gone: the vendor code this
 *    file calls now sits behind `@/modules/ai-vendor`, a leaf that imports no
 *    module, and this folder is no longer inside tickets. The location is now a
 *    CHOICE — a translate transport belongs to the translate module — not a
 *    workaround, and the next reader should not go looking for a cycle to fix.
 *    The family-default constant below stays per-vendor-file, the same pattern
 *    every other funnel uses: it is this feature's value, not a vendor fact.
 *
 * Wire shape follows the summary leg deliberately: `/v1/` endpoint, key on the
 * query string (transcribed hazard, preserved for parity), one user part, low
 * fixed knobs — translation wants determinism, same as summarising.
 *
 * revert: delete with the funnel folder.
 */
import { Logger } from '@nestjs/common';

// modules/ai is a lower layer (imports neither tickets nor webhook — verified
// 18/08); the 30s stall ceiling is shared app-wide from there.
/* [FEAT-20260907-AIVENDORCORE] 🔴 THE REASON THIS FILE KEPT ITS OWN COPY IS GONE.
   The header above says this module "must not import the webhook barrel" because
   webhook already imports tickets — true then, irrelevant now. The door is a LEAF
   that imports no module at all, so tickets reaches it with no cycle, and the
   duplicated URL, body builder and reader go with it.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
import {
  geminiHttpOpts,
  buildGeminiBody,
  geminiUrl,
  readGeminiText as readVendorText,
  familyModel,
  resolveModelId as resolveVendorModelId,
  vendorFailure,
  dig,
  vendorSuccess,
  postToVendor,
} from '@/modules/ai-vendor';

import type {
  TranslateCall,
  TranslateTransportResult,
} from '../translate-neutral';
import type { TranslateTransport } from '../translate-transport';
import { buildTranslatePrompt } from '../translate-prompt';
import { translateTimeoutMs } from '../translate-http-timeout';

const logger = new Logger('GeminiTranslateTransport');

/** The family default when the hook picked no model — same value the reply and
 *  summary legs default to, owned per vendor file by convention. */
/* [FEAT-20260908-AIVENDORMODELS] value from the door; name kept for importers. */
export const GEMINI_TRANSLATE_FAMILY_MODEL = familyModel('gemini', 'translate');

function resolveModelId(modelId?: string | null): string {
  return resolveVendorModelId(modelId, GEMINI_TRANSLATE_FAMILY_MODEL);
}

/** `a?.b?.c` over unknown — same helper the sibling transports carry. */
/* [FEAT-20260908-AIVENDORERR] `dig` was declared in seven transports,
   identically. It comes from the door now. */

export class GeminiTranslateTransport implements TranslateTransport {
  async send(call: TranslateCall): Promise<TranslateTransportResult> {
    /* [FEAT-20260908-GEMINIKEYHEADER] key moved to the x-goog-api-key header. */
    const url = geminiUrl(resolveModelId(call.modelId));
    /* ⚠️ No system instruction is passed, so that key is never written.
       Determinism knobs stay fixed, same intent as the summary leg.

       [FEAT-20260909-DSREASONING] `generationExtra` is the door's OWN extension
       point — it documents "ABSENT MEANS ABSENT … only written when supplied" —
       so a thinking config can be added without editing the door at all, which
       is both forbidden and would reach the reply and summary lanes.
       🔴 UNSET ⇒ THE ARGUMENT IS NOT PASSED, not passed as `{}`. An empty
       object would still spread into `generationConfig` harmlessly today, but
       it makes "the OA chose nothing" and "the OA chose nothing to add" the
       same call, and the whole no-backfill guarantee rests on those staying
       distinguishable.
       ⚠️ The value is RESOLVED BY THE CALLER, through the same
       `[HOTFIX-20260826-THINK36]` function the reply lane uses — so `0` means
       the same thing in both boxes, and the Gemini-3 `thinkingLevel` case is
       handled once rather than copied here. This file may not import that
       function; forwarding its output costs nothing and duplicates nothing. */
    const generationExtra = call.reasoning?.generationExtra;
    const body = buildGeminiBody({
      model: resolveModelId(call.modelId),
      apiKey: call.apiKey ?? '',
      parts: [{ text: buildTranslatePrompt(call) }],
      knobs: { temperature: 0.1, topP: 0.1, topK: 1 },
      ...(generationExtra === undefined ? {} : { generationExtra }),
    });

    try {
      const res = await postToVendor(
        url,
        body,
        /* [FEAT-20260918-TRANSLATETIMEOUT] the shared door supplies the headers
           and the 45s reply-lane ceiling; this lane overrides ONLY the ceiling.
           Spread-then-override rather than a new builder, so a header the door
           adds later arrives here without anyone remembering to copy it. */
        { ...geminiHttpOpts(call.apiKey ?? ''), timeout: translateTimeoutMs() },
      );
      /* [FEAT-20260908-AIVENDORERR] the success envelope all six lanes shared. */
      return vendorSuccess(res, readVendorText(res.data));
    } catch (err) {
      const errPayload = dig(err, 'response', 'data') ?? dig(err, 'message');
      logger.error(
        `translate error: ${typeof errPayload === 'string' ? errPayload : JSON.stringify(errPayload)}`,
      );
      /* [FEAT-20260908-AIVENDORERR] the mapping all six lanes shared, verbatim. */
      return vendorFailure(err);
    }
  }
}
