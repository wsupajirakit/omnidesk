/**
 * [P2-20260813] DeepSeek assist-summary transport — vendor #2 on the summary seam.
 *
 * Mirrors `deepseek-reply.transport.ts`: neutral call in, neutral result out,
 * every DeepSeek-shaped decision contained here. Two things are deliberately
 * NOT owned by this file:
 *   · the PROMPT — shared domain text (`summary-prompt.ts`), identical for
 *     every vendor so the two can never drift;
 *   · the PARSE — `summary-interpreter.ts` owns the JSON extraction and the
 *     three fallback strings, so a DeepSeek reply is interpreted by the same
 *     code as a Gemini one. transport = ยิงอย่างเดียว ไม่ตีความ.
 *
 * ⚠️ NOT registered yet (same reason as the reply transport): the registry entry
 *    lands in T13 together with the spec that currently asserts the fallback.
 *
 * ⚠️ Summary has NO knobs on the neutral call — Gemini hardcodes 0.1/0.1/1
 *    (legacy parity). DeepSeek gets the same intent: lowest sensible temperature
 *    and top_p, no top_k field (it has none). ค่าตายตัวเหมือนฝั่ง gemini.
 *
 * revert: delete this file (and its registry entry if T13 already landed).
 */

import { Logger } from '@nestjs/common';

import type {
  SummaryCall,
  SummaryTransportResult,
} from '../../assist/summary-neutral';
import type { SummaryTransport } from '../../assist/summary-transport';
import { buildSummaryPrompt } from '../../assist/summary-prompt';
/* [FEAT-20260907-AIVENDORCORE] The URL and the timeout come from the leaf door.
   [FEAT-20260908-AIVENDORMODELS] …and so does the model default. This file used
   to import `resolveDeepSeekModelId` from its REPLY sibling, which meant the
   summary lane's default was literally the reply lane's constant — borrowed
   across files because there was nowhere else to put it. Both now come from the
   door, so this file imports no sibling at all and the two lanes can diverge
   without one editing the other.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
import {
  DEEPSEEK_CHAT_URL,
  deepSeekHttpOpts,
  readDeepSeekText as readVendorText,
  familyModel,
  resolveModelId as resolveVendorModelId,
  vendorFailure,
  vendorSuccess,
  postToVendor,
  deepSeekReasoningWire,
} from '@/modules/ai-vendor';
/* [FEAT-20260908-AIVENDORMODELS] The sibling edge is gone: the model default and
   the trim-or-fallback rule both come from the door now. Same value
   (one shared literal) and same behaviour — this lane's default WAS the reply
   lane's constant, borrowed across files because there was nowhere else to put
   it. It has its own registry entry now, so the two lanes can diverge without
   one editing the other's file. */

const logger = new Logger('DeepSeekSummaryTransport');

/** Same 30s ceiling both other transports use. */
/* [FEAT-20260907-AIVENDORCORE] the third copy of one number, now from the door. */

/** ⚠️ Same `a?.b?.c`-over-unknown helper the other transports use. */
/* [FEAT-20260908-AIVENDORERR] `dig` was declared in seven transports,
   identically. It comes from the door now. */

/* [FEAT-20260907-AIVENDORCORE] The THIRD verbatim copy of the same DeepSeek reader
   (`deepseek-reply.transport.ts`, `tickets/translate/vendors/deepseek-translate.
   transport.ts`, and here). All three carried both guards and all three would have
   had to be edited together if the vendor ever changed its shape. One definition
   now, in the leaf door; the local name is kept as an alias so nothing that
   imports it by name has to move.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
export { readVendorText as readDeepSeekSummaryText };

interface DeepSeekSummaryBody {
  model: string;
  messages: { role: 'user'; content: string }[];
  temperature: number;
  top_p: number;
  /**
   * [FEAT-20260909-DSREASONING] Present ONLY when the OA chose a setting.
   * Optional in the type for the same reason it is conditional in the builder:
   * a body without it must be the object it always was.
   */
  thinking?: { type: string };
  /** [FIX-20261014-DSEFFORTTOP] top level — where DeepSeek reads it. */
  reasoning_effort?: string;
}

/**
 * Neutral call → DeepSeek body.
 *
 * One user message carrying the shared prompt: the prompt already contains its
 * own instructions and the JSON contract, exactly as the Gemini transport sends
 * it as a single `contents.parts[0].text`. Nothing is added, reordered or
 * reworded here.
 */
export function buildDeepSeekSummaryBody(
  call: SummaryCall,
): DeepSeekSummaryBody {
  const base: DeepSeekSummaryBody = {
    model: resolveVendorModelId(
      call.modelId,
      familyModel('deepseek', 'summary'),
    ),
    messages: [{ role: 'user', content: buildSummaryPrompt(call) }],
    // ⚠️ Mirrors Gemini's hardcoded 0.1/0.1 (legacy `:1827-1831`). DeepSeek has
    //    no top_k, so there is nothing to drop and nothing to log.
    temperature: 0.1,
    top_p: 0.1,
  };
  /* [FEAT-20260909-DSREASONING] The OA's reasoning choice — the SAME setting the
     reply lane reads, because the owner ruled the summary shares the main bot's
     rather than getting one of its own.
     🔴 NO CHOICE ⇒ `base` IS RETURNED UNCHANGED, the same object, not a copy
     with a key omitted. Every hook written before the columns resolves to null,
     so this lane's wire bytes are what they always were.
     ⚠️ Attached here and not in the shared door, which declares it always sends
     exactly four keys — a fifth there would reach every DeepSeek lane at once. */
  const r = call.reasoning;
  if (!r) return base;
  /* [FIX-20261014-DSEFFORTTOP] effort at the top level, not inside `thinking` (ft17). */
  return { ...base, ...deepSeekReasoningWire(r) };
}

export class DeepSeekSummaryTransport implements SummaryTransport {
  async send(call: SummaryCall): Promise<SummaryTransportResult> {
    const body = buildDeepSeekSummaryBody(call);
    try {
      // ⚠️ Key on the Authorization header — never the URL, never a log.
      const res = await postToVendor(
        DEEPSEEK_CHAT_URL,
        body,
        deepSeekHttpOpts(call.apiKey ?? ''),
      );
      /* [FEAT-20260908-AIVENDORERR] the success envelope all six lanes shared. */
      return vendorSuccess(res, readVendorText(res.data));
    } catch (err) {
      // The Gemini transport logs its request failure here (divergence D2 in the
      // W2 notes — the team debugs from this line), so this one does too.
      /* [FEAT-20260908-AIVENDORERR] This lane needs the message TWICE — once for
         its log and once in the result — so it takes the shared message helper
         and the shared mapping rather than computing the string twice. Computing
         it twice is how the log and the stored value drift apart. */
      const failure = vendorFailure(err);
      logger.error(`AI Analysis error: ${failure.errorMessage}`);
      return failure;
    }
  }
}
