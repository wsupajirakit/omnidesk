/**
 * [PROG-20260905-SENDROWS] The two webhook_log rows the customer reply produces.
 *
 * WHY THEY ARE BUILT HERE. They are the last forensic record of a turn — the pair an
 * incident investigation opens first — and they were two 25-line object literals buried
 * at the bottom of a 5,000-line method, where the only way to compare them was to scroll.
 * Side by side, the ONE difference that matters is visible: the success row carries the
 * AI answer in `response_summary`, the error row carries whatever the failure returned.
 *
 * ⚠️ FIELD ORDER IS BEHAVIOUR HERE, NOT FORMATTING. These rows are frozen byte-for-byte
 * in golden flow-matrix snapshots and `response_summary` is copied verbatim into
 * `webhook_logs`. Reordering keys "for readability" rewrites recorded history.
 *
 * ⚠️ THE ERROR ROW READS THE FAILURE DEFENSIVELY. An axios rejection may carry no
 * `response` at all (a timeout, a DNS failure), so both reads are optional chains and the
 * row is still written. A row that throws while reporting a failure loses both facts.
 *
 * Pure builders: they take values and return an object. The emit stays at the call site,
 * because WHEN the row is written — awaited, before the turn ends — is the spine's
 * contract, not this file's.
 */

import type { WebhookLogEvent } from './webhook-log.contract';

type Doc = Record<string, unknown>;

/* The builders return the emitter's own contract type rather than a loose object. The
   inline literals they replace were only structurally checked; a missing `action_type`
   now fails at compile time instead of at the moment somebody needs the row. */

export interface SendOutcomeRowInput {
  logContext: Doc;
  endpoint: string;
  linePayload: unknown;
  eventId?: string;
  replyToken?: string;
  /** `Date.now() - lineStart`, computed by the caller that owns the clock. */
  durationMs: number;
}

/**
 * What the send returned — passed WHOLE, on purpose.
 *
 * 🔴 THE FIRST VERSION OF THIS BUILDER TOOK `status` AND `data` AS SEPARATE INPUTS AND
 * SILENTLY DROPPED `via`. The original literal read
 * `lineResponse.via === 'push' ? 'push_message' : 'line_reply'`; the builder hard-coded
 * `'line_reply'`, so for nine save points every push fallback filed itself as a reply —
 * the row stopped naming the leg that actually delivered the message, which is the entire
 * point of [FEAT-20260830-REPLYPUSH]. Nothing failed to compile: an input that is DROPPED
 * rather than renamed produces no type error. `wrap-ai-fullflow.spec.ts` P2 was red the
 * whole time and was not in that save point's gate set.
 *
 * Taking the response as ONE object is the structural answer to that class of loss: the
 * builder reads the fields it needs from the same object the call site already holds, so
 * a field can no longer go missing at the boundary — only at the source. รับมาทั้งก้อน
 * ฟิลด์จะได้ไม่หายตอนส่งต่อ
 */
export interface SendResponseLike {
  status?: number;
  data?: unknown;
  /**
   * Which leg delivered it. Set ONLY by the send ladder, so anything that does not use the
   * ladder leaves it undefined and the row says `line_reply` exactly as it always did.
   */
  via?: string;
}

export interface SendSuccessRowInput extends SendOutcomeRowInput {
  response: SendResponseLike;
  /** The AI answer, when there was one — merged into `response_summary`. */
  responseAi?: unknown;
}

/** The row written when LINE accepted the reply. */
export function buildSendSuccessRow(
  input: SendSuccessRowInput,
): WebhookLogEvent {
  const {
    logContext,
    endpoint,
    linePayload,
    eventId,
    replyToken,
    durationMs,
    response,
    responseAi,
  } = input;
  const { status, data, via } = response;
  return {
    ...logContext,
    channel: 'line_api',
    /* [FEAT-20260830-REPLYPUSH] the row must name the leg that actually delivered it. A
       row that says `push_message` is the honest record that the reply token was refused
       and the push saved the answer. Both action types already exist in webhook_logs. */
    action_type: via === 'push' ? 'push_message' : 'line_reply',
    method: 'POST',
    endpoint,
    status: 'success',
    http_status: status,
    payload_summary: linePayload,
    response_summary: responseAi
      ? {
          ...(data as Doc),
          response_ai: responseAi,
        }
      : data,
    duration_ms: durationMs,
    line_event_id: eventId,
    request_meta: {
      event_id: eventId,
      reply_token: replyToken,
    },
  };
}

export interface SendErrorRowInput extends SendOutcomeRowInput {
  /** The rejection as thrown — read defensively; it may carry no response at all. */
  error: unknown;
  errorMessage: string;
}

/** The row written when the send threw. */
export function buildSendErrorRow(input: SendErrorRowInput): WebhookLogEvent {
  const {
    logContext,
    endpoint,
    linePayload,
    eventId,
    replyToken,
    durationMs,
    error,
    errorMessage,
  } = input;
  return {
    ...logContext,
    channel: 'line_api',
    action_type: 'line_reply',
    method: 'POST',
    endpoint,
    status: 'error',
    http_status: (error as { response?: { status?: number } } | null)?.response
      ?.status,
    error_message: errorMessage,
    payload_summary: linePayload,
    response_summary: (error as { response?: { data?: unknown } } | null)
      ?.response?.data,
    duration_ms: durationMs,
    line_event_id: eventId,
    /* The error row carries `request_meta` too — checked against the original rather than
       assumed. A failure row without the reply token is the one row an investigation
       cannot tie back to the message that caused it. */
    request_meta: {
      event_id: eventId,
      reply_token: replyToken,
    },
  };
}
