/**
 * [PROG-20260905-C4] The out-of-hours reply, lifted out of the spine.
 *
 * WHEN IT RUNS. The hook is switched off (`status === 0`) and the turn has already
 * reached the text path — deliberately AFTER the non-text branch, because a switched-off
 * OA still answers an image with `image_answer_text`. The guard and the position stay in
 * the spine; only the body moved.
 *
 * THREE OUTCOMES, all of which end the turn. That is why this extraction needs no
 * verdict object: every path through the original block returned, so the call site can
 * hoist a single unconditional `return` and the exit stays at exactly the spine position
 * it occupied before.
 *   1. no reply token — an unfollow carries none, and firing a reply with `undefined`
 *      made LINE answer 400 every time somebody blocked the account.
 *   2. status-off SILENT — do not reply. The inbound message was already stored, which
 *      is what makes "เงียบแต่เก็บแชท" true.
 *   3. otherwise — reply, log the row, file the bot's chat row.
 *
 * ⚠️ ORDER IS THE CONTRACT: send, then the AWAITED webhook_log row, then the
 * fire-and-forget chat row. The wlog row carries `http_status` from the real response and
 * is frozen byte-for-byte in a golden flow-matrix snapshot, so its field order is part of
 * the behaviour, not formatting. The chat row is `void` on purpose — a history failure
 * must not cost the customer their reply.
 *
 * ⚠️ Collaborators arrive through `deps`; this file imports no service. Same convention
 * as `customer-register.handler.ts` in this directory, and it is what keeps the handler
 * unit-testable with plain objects.
 */

/** The response shape the spine's own `sendTextReply` returns. */
export interface ReplyResponse {
  status?: number;
  data?: unknown;
}

export interface OutOfHoursInput {
  /** `event.replyToken` — absent for unfollow/leave, which is outcome 1. */
  replyToken?: string;
  /** `event.type`, for the log line that explains why nothing was sent. */
  eventType?: string;
  /** `event.eventId`, copied onto both rows. */
  eventId?: string;
  userId?: string;
  hookId?: string;
  channelType?: string;
  channelId?: string;
  /** The bag every log row spreads; the outer catch reads the same object. */
  logContext: Record<string, unknown>;
  /** `LINE_REPLY_ENDPOINT` — passed in so this file redeclares nothing. */
  endpoint: string;
}

export interface OutOfHoursDeps {
  /**
   * `resolveStatusOffReply(hook)` as a thunk, NOT a resolved value.
   *
   * ⚠️ Order: the original calls this AFTER the reply-token guard, so an unfollow (which
   * carries no token) never resolved the status-off text at all. Passing the resolved
   * value in would call it one step earlier — invisible today because the resolver is
   * pure, and exactly the kind of quiet reordering this program exists to not do.
   */
  resolveReply: () => { silent: boolean; text: string };
  log: (message: string) => void;
  error: (message: string) => void;
  /** `sendTextReply(accessToken, replyToken, text)` bound by the caller. */
  sendTextReply: (replyToken: string, text: string) => Promise<ReplyResponse>;
  /** Awaited: the row must exist before the turn ends. Receives the finished row. */
  emitWlog: (row: Record<string, unknown>) => Promise<void>;
  /** Fire-and-forget. Receives the finished row; the caller owns the `.catch`. */
  logBotMessage: (row: Record<string, unknown>) => void;
  /** `sentMessageIds(response)` — the quote-source contract lives in infra, not here. */
  sentMessageIds: (response: ReplyResponse) => Record<string, unknown>;
}

export async function replyOutOfHours(
  input: OutOfHoursInput,
  deps: OutOfHoursDeps,
): Promise<void> {
  // [FIX-20260728-REPLYTOKEN] An unfollow carries no reply token. Firing a reply with
  // `undefined` made LINE answer 400 every single time somebody blocked the account.
  if (!input.replyToken) {
    deps.log(
      `[WEBHOOK] Out of hours but event.type=${input.eventType} has no replyToken — nothing to reply to.`,
    );
    return;
  }

  // [FEAT-20260806-STATUSOFF] silent → do NOT reply. The inbound message was already
  // stored above, so "เงียบแต่เก็บแชท" holds.
  const { silent, text } = deps.resolveReply();
  if (silent) {
    deps.log(
      `[WEBHOOK] status-off SILENT (hook=${input.hookId}) — inbound chat stored, no reply sent.`,
    );
    return;
  }

  const response = await deps.sendTextReply(input.replyToken, text);

  /* Row shapes are byte-for-byte the originals. The wlog row is frozen in a golden
     flow-matrix snapshot and `response_summary` is copied straight into webhook_logs, so
     field order here is behaviour, not formatting. */
  await deps.emitWlog({
    ...input.logContext,
    channel: 'line_api',
    action_type: 'out_of_hours_reply',
    method: 'POST',
    endpoint: input.endpoint,
    status: 'success',
    http_status: response.status,
    payload_summary: {
      reply_token: input.replyToken,
      text,
    },
    response_summary: response.data,
    line_event_id: input.eventId,
  });

  deps.logBotMessage({
    userId: input.userId,
    senderType: 'bot',
    messageType: 'text',
    content: text,
    hookId: input.hookId,
    channelType: input.channelType,
    channelId: input.channelId,
    replyToken: input.replyToken,
    // [FEAT-20260831-QUOTESRC] see the rate-limit site for the contract
    ...deps.sentMessageIds(response),
    metadata: { event_id: input.eventId, reason: 'out_of_hours' },
  });
}
