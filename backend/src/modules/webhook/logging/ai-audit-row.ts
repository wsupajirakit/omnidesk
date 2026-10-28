import {
  describeReplyEndpoint,
  resolveReplyVendorName,
} from '../ai-reply/reply-transport.registry';
import { extractAnswerTags, thaiClock } from '../ai-reply/prompt-log.util';

import type { WebhookLogEvent } from './webhook-log.contract';

/**
 * [PROG-20260905-AIROW] The `generate_response` audit row — the heaviest write on the
 * webhook path, and the row every wrong-answer investigation opens.
 *
 * WHY IT MOVED. `logging/` now owns the inbound delivery row and the two rows the customer
 * reply produces. This is the fourth and by far the largest: it carries the whole model
 * request and response. Left inline it was a sixty-line literal in the middle of the AI
 * path, where the only way to compare it with the reply rows was to scroll a thousand
 * lines. It also qualifies on the rule SP25 established for row extractions — **fields far
 * outnumber inputs**: eighteen fields out, and the four helpers that build them come with
 * it rather than staying behind as orphaned imports in the spine.
 *
 * ⚠️ A PURE BUILDER. The `void` stays at the call site, because WHEN this row is written is
 * the spine's contract, not this file's: [PERF-20260824-WLOGVOID] made it fire-and-forget
 * on purpose. It sits ~600 lines above the send and awaiting it put a Mongo round-trip in
 * front of the customer's reply, against a token that expires at 60s, for a row nobody
 * reads synchronously. `webhook-log-emitter.spec.ts` pins that `void` by name.
 *
 * ⚠️ [FIX-20260816-WLOGVENDOR] THE ROW NAMES THE VENDOR THAT ANSWERED. Both fields were
 * hard-coded to Gemini, written before a hook could choose a vendor. After P2 they lied
 * twice over: a DeepSeek OA filed its rows under `gemini`, so the dashboard's log-source
 * filter counted them as Gemini, and the URL claimed `/v1/models/` with the ENV model while
 * the real call goes to `/v1beta/` with the HOOK's model — or to api.deepseek.com, which
 * has no model in the URL at all.
 *
 * `aiVendor` is the hook's RAW field and may be a typo. The registry decides which
 * transport actually runs, so both helpers ask IT rather than trusting the field. A typo
 * therefore logs `gemini`, which is what really answered.
 *
 * ⚠️ [FEAT-20260908-GEMINIKEYHEADER] `endpoint` NO LONGER CARRIES A KEY AT ALL.
 * This used to read "the key stays masked: this string is persisted", because
 * Gemini's key rode the query string and the label had to be built from a masked
 * copy. The key is a header now, so both vendors' labels are bare URLs. The mask
 * is still recorded — in its own column, not inside this string.
 *
 * revert: paste the literal back at the call site and restore the four imports.
 */

type Doc = Record<string, unknown>;

export interface AiAuditRowInput {
  /** The bag every row spreads, FIRST — it carries hook/group ids and the key masks. */
  logContext: Doc;
  /** The hook's raw vendor/model fields. Raw on purpose — see the header. */
  aiVendor?: string | null;
  aiModel?: string | null;
  aiKeyForMaskOnly?: string | null;
  /** Present only when the model call failed; it decides `status` and `fallback`. */
  errorMessage?: string | null;
  httpStatus?: number | null;
  /** Nullable at the call site — required KEY, so tsc refuses an omission. */
  userText: string | null | undefined;
  docId: string | null | undefined;
  effectiveFastMode?: unknown;
  eventId: string | null | undefined;
  replyToken: string | null | undefined;
  /** [FEAT-20260822-AIPROMPTLOG] which prompt version answered — merged in as-is. */
  promptDocMeta: Doc;
  /** The Thai wall clock the prompt was built with, so the row and the prompt agree. */
  thaiNow: Date | string | number | null | undefined;
  /** The model's answer, markers and all — the tag extractor reads it. */
  replyTextRaw: string | null | undefined;
  noData?: unknown;
  tagStatus?: unknown;
  responseAi?: unknown;
  /** `Date.now() - aiStart`, computed by the caller that owns the clock. */
  durationMs: number;
}

/** legacy:4331 — the AI audit row. */
export function buildAiAuditRow(input: AiAuditRowInput): WebhookLogEvent {
  return {
    ...input.logContext,
    channel: resolveReplyVendorName(
      input.aiVendor,
    ) as WebhookLogEvent['channel'],
    action_type: 'generate_response',
    method: 'POST',
    // A LABEL on a log row, not a URL called from this file — but it is built by the
    // vendor's own URL builder, so it cannot drift from the request the transport sends.
    /* [FEAT-20260908-GEMINIKEYHEADER] The masked key is no longer passed: no
       vendor label carries a key now that Gemini's rides the x-goog-api-key
       header. The mask itself is NOT lost from the audit trail — it has its own
       column, written from the same `aiKeyForMaskOnly` value. */
    endpoint: describeReplyEndpoint(input.aiVendor, input.aiModel),
    status: input.errorMessage ? 'error' : 'success',
    http_status: input.httpStatus ?? 0,
    error_message: input.errorMessage ?? undefined,
    payload_summary: {
      question: input.userText,
      doc_id: input.docId,
      fast_mode: input.effectiveFastMode,
      event_id: input.eventId,
      // [FEAT-20260822-AIPROMPTLOG] which prompt version answered, at what Thai time, and
      // what markers the model emitted — the three questions every wrong-answer
      // investigation starts with. Mixed field: no schema change; the FE detail modal
      // renders new keys as-is.
      ...input.promptDocMeta,
      thai_time: thaiClock(input.thaiNow),
      answer_tags: extractAnswerTags(input.replyTextRaw),
    },
    response_summary: {
      text: input.replyTextRaw,
      noData: input.noData,
      tag_status: input.tagStatus,
      fallback: Boolean(input.errorMessage),
      response_ai: input.responseAi,
    },
    doc_id: input.docId,
    duration_ms: input.durationMs,
    /* The contract's `line_event_id` is `string | undefined`, and the spine holds the id
       nullable — `?? undefined` is the coercion the inline literal made implicitly by
       never having a null there. Written out so the narrowing is visible. */
    line_event_id: input.eventId ?? undefined,
    request_meta: {
      event_id: input.eventId,
      reply_token: input.replyToken,
    },
  };
}
