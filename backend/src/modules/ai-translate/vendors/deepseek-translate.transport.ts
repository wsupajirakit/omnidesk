/**
 * [FEAT-20260818-TRANSLATE] DeepSeek translate transport — vendor #2 on the
 * translate seam. Mirrors `deepseek-summary.transport.ts`.
 *
 * ⚠️ [FEAT-20260908-CHATTRANS] This header used to say the chat URL and the
 *    family default "repeat the VALUES from the webhook-side deepseek files
 *    rather than importing them, because importing the webhook barrel from
 *    tickets would close a TS-level cycle". Both halves have since stopped being
 *    true and the paragraph is replaced rather than carried:
 *      · the URL is NOT a copy any more — it comes from `@/modules/ai-vendor`,
 *        the leaf door (see the note at the constant below);
 *      · the cycle it was avoiding does not exist, and this file is no longer
 *        inside tickets.
 *    Only the family default is still local, deliberately: it is this feature's
 *    choice of model, not a fact about the vendor.
 *
 * revert: delete with the funnel folder.
 */
import { Logger } from '@nestjs/common';

/* [FEAT-20260907-AIVENDORCORE] the one door — see the note at the constants below. */
import {
  DEEPSEEK_CHAT_URL,
  buildDeepSeekBody,
  deepSeekHttpOpts,
  readDeepSeekText as readVendorText,
  familyModel,
  resolveModelId as resolveVendorModelId,
  vendorFailure,
  dig,
  vendorSuccess,
  postToVendor,
  deepSeekReasoningWire,
} from '@/modules/ai-vendor';

import type {
  TranslateCall,
  TranslateTransportResult,
} from '../translate-neutral';
import type { TranslateTransport } from '../translate-transport';
import { buildTranslatePrompt } from '../translate-prompt';
import { translateTimeoutMs } from '../translate-http-timeout';

const logger = new Logger('DeepSeekTranslateTransport');

/* [FEAT-20260907-AIVENDORCORE] The URL and the timeout used to be declared here,
   with a comment admitting they were copies — "a value, not a shared import",
   which was the honest description of a duplicate nobody could remove while the
   only other copy lived under the webhook barrel. `DEEPSEEK_CHAT_URL` was
   declared twice in this repo and `DEEPSEEK_HTTP_TIMEOUT_MS` three times.
   Both now come from the leaf door. The MODEL default stays local: it is this
   feature's choice, not a vendor fact.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
/* [FEAT-20260908-AIVENDORMODELS] value from the door. Stays module-private —
   nothing outside this file ever imported it. */
const DEEPSEEK_TRANSLATE_FAMILY_MODEL = familyModel('deepseek', 'translate');

function resolveModelId(modelId?: string | null): string {
  return resolveVendorModelId(modelId, DEEPSEEK_TRANSLATE_FAMILY_MODEL);
}

/* [FIX-20261014-DSEFFORTTOP] `toThinking` lived here and nested `reasoning_effort` inside
   `thinking` — the shape DeepSeek ignores (ft17). The spelling now comes from the door
   (`deepSeekReasoningWire`), the same one the reply and summary lanes use; `effort` is still
   OMITTED, never null, when the operator chose none. */

/* [FEAT-20260908-AIVENDORERR] `dig` was declared in seven transports,
   identically. It comes from the door now. */

export class DeepSeekTranslateTransport implements TranslateTransport {
  async send(call: TranslateCall): Promise<TranslateTransportResult> {
    /* ⚠️ No system instruction is passed, so `messages` stays ONE user entry —
       the shape this transport has always sent. The reply lane passes one and
       gets two; that difference is the contract, not an accident. */
    const base = buildDeepSeekBody({
      model: resolveModelId(call.modelId),
      apiKey: call.apiKey ?? '',
      parts: [{ text: buildTranslatePrompt(call) }],
      knobs: { temperature: 0.1, topP: 0.1, topK: 1 },
    });
    /* [FEAT-20260909-DSREASONING] `thinking` is attached HERE, never inside the
       door.
       🔴 THE DOOR FORBIDS IT IN ITS OWN WORDS — `ai-vendor/deepseek/transport.ts`
       says "FOUR KEYS, ALWAYS … adding one would change every DeepSeek request
       in the system at once". That is two separate reasons not to touch it: the
       door is shared and must not be modified at all, and a fifth key there
       would reach the reply and summary lanes, which this work must not affect.
       Attaching it in THIS transport reaches translate and nothing else.
       ⚠️ No reasoning ⇒ `body` IS `base`, the same object, so a request from an
       OA that set nothing is byte-identical to the one sent before this existed.
       Not "a body with the key omitted" — the identical object. */
    const thinking = call.reasoning?.thinking;
    const body = thinking
      ? { ...base, ...deepSeekReasoningWire(thinking) }
      : base;
    try {
      /* ⚠️ The key rides an Authorization header here and a query string on
         Gemini. Both are preserved; the door places each where its vendor wants. */
      const res = await postToVendor(
        DEEPSEEK_CHAT_URL,
        body,
        /* [FEAT-20260918-TRANSLATETIMEOUT] the shared door supplies the headers
           and the 45s reply-lane ceiling; this lane overrides ONLY the ceiling.
           Spread-then-override rather than a new builder, so a header the door
           adds later arrives here without anyone remembering to copy it. */
        {
          ...deepSeekHttpOpts(call.apiKey ?? ''),
          timeout: translateTimeoutMs(),
        },
      );
      /* [FEAT-20260908-AIVENDORERR] the success envelope all six lanes shared. */
      return vendorSuccess(res, readVendorText(res.data));
    } catch (err) {
      /* [FEAT-20260908-AIVENDORERR] ⚠️ THE LOG IS NOT `failure.errorMessage`, AND
         THAT IS NOT AN OVERSIGHT. This lane's log line has always omitted the
         final `?? 'error'` that the RESULT carries, so on an error with no
         response body and no message it prints the string "undefined" while the
         stored `errorMessage` reads "error". Routing the log through the shared
         helper would quietly change what this line prints. The mapping is
         shared; this lane's own wording is left exactly as it was. */
      const data = dig(err, 'response', 'data');
      logger.error(
        `translate error: ${typeof data === 'string' ? data : JSON.stringify(data ?? (err as Error)?.message)}`,
      );
      return vendorFailure(err);
    }
  }
}
