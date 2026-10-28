import { asString } from '../logging/coerce-mask.util';
import { HELPER_ALT_TEXT } from './customer-helper-flex';

/**
 * [PROG-20260905-G35] The api-error refusal reply (helper door S4).
 *
 * WHEN IT RUNS. The external API failed AND the AI answer carried a tag that would have
 * quoted data the API never delivered. Answering with that text would tell a customer a
 * number nobody stands behind, so the flow replies with the operator's
 * `missing_api_data_text` instead and ends the turn.
 *
 * ⚠️ ONE OF THE FOUR HELPER DOORS the `helper-stamp-doors` census fences. Its build/stamp
 * pair had to survive the move, which is why that census was converted to count across
 * role directories BEFORE this cut. Four doors are still four doors.
 *
 * ⚠️ THE HISTORY ROW IS DELIBERATELY WEAKER THAN ITS TWIN. The image-side door files its
 * row as the card it actually sent; this one files `messageType: 'text'` even when a card
 * went out, so an S4 card is invisible to the abandon lookback. Fossilized behaviour, not
 * a bug to fix while moving code — the lookback reads that field.
 *
 * ⚠️ Every path ends the turn, so the call site hoists one `return`.
 *
 * The request values are DESTRUCTURED at the top rather than renamed through the body: a
 * blind rename turns `hook,` in an object literal into `args.hook,` and a positional
 * argument into a property. Both happened on the first attempt and only the compiler
 * noticed.
 */

type Doc = Record<string, unknown>;

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

export interface ApiErrorReplyArgs {
  hook: Doc | null | undefined;
  accessToken: string;
  userId?: string;
  channelId?: string;
  replyToken?: string;
  eventId?: string;
  apiMissingSource: string;
  logContext: Doc;
}

export interface ApiErrorReplyDeps {
  logger: { log: (m: string) => void; error: (m: string) => void };
  resolveHookTextReply: (input: Doc) => { text?: string };
  resolveHookTextReplyMode: (hook: Doc | null | undefined) => unknown;
  buildHookHelperFlexFor: (...a: unknown[]) => Promise<unknown>;
  stampIfHelperCardDelivered: (...a: unknown[]) => unknown;
  sendFlexReply: (
    ...a: unknown[]
  ) => Promise<{ status?: number; data?: unknown }>;
  sendTextReply: (
    ...a: unknown[]
  ) => Promise<{ status?: number; data?: unknown }>;
  sentMessageIds: (response: unknown) => Doc;
  wlogEmit: (row: Doc) => Promise<void>;
  chatHistory: { logMessage: (row: Doc) => Promise<unknown> };
}

export async function replyApiErrorRefusal(
  args: ApiErrorReplyArgs,
  deps: ApiErrorReplyDeps,
): Promise<void> {
  const {
    hook,
    accessToken,
    userId,
    channelId,
    replyToken,
    eventId,
    logContext,
  } = args;

  deps.logger.log(
    `[EXTERNAL API] Blocking response due to api_error and detected tag in AI answer.`,
  );
  /* [FIX-20260812-HELPERMARKERLEAK] third and last site that sends an
   operator-written field without resolving markers. Same field as the
   profile guard, so fixing only one would still leak here.
   revert: restore the two-line original below the tag. */
  const apiMissingText =
    deps.resolveHookTextReply({
      rawText: hook?.['missing_api_data_text'],
      hook,
      mode: deps.resolveHookTextReplyMode(hook),
    }).text || 'api_data_missing';
  /* [FEAT-20260812-HOOKHELPERFLEX] site 3 of 3 — same field as site 1, so the
   card must be offered here too or the customer's experience would depend on
   which of the two guards happened to fire.
   revert: delete this const and the ternary below. */
  const apiMissingCard = await deps.buildHookHelperFlexFor(
    hook?.['missing_api_data_text'],
    hook,
    userId,
  );
  const lineResponse = apiMissingCard
    ? await deps.sendFlexReply(
        accessToken,
        replyToken ?? '',
        apiMissingCard,
        (apiMissingText || HELPER_ALT_TEXT).slice(0, 400),
        /* [FIX-20260902-FLEXLADDER] the reply→push ladder, the
         same one the text sender in the `else` below already
         had. Without it a refused reply token lost the CARD
         while the sentence beside it arrived. `userId` is the
         LINE id — it is what the neighbouring
         `stampIfHelperCardDelivered(card, userId, …)` uses and
         what the one already-laddered flex site passes. */
        null,
        userId,
      )
    : await deps.sendTextReply(
        accessToken,
        // Passed through EXACTLY as legacy passes it: possibly undefined, which
        // JSON.stringify then drops from the body and LINE answers 400 for. A
        // guard here would skip the call AND the webhook_logs row legacy writes.
        replyToken,
        apiMissingText,
      );
  // [FIX-20260827-HELPERSTAMPDOORS] door S4 — see the method's note.
  deps.stampIfHelperCardDelivered(apiMissingCard, userId, lineResponse?.status);
  await deps.wlogEmit({
    ...logContext,
    channel: 'line_api',
    action_type: 'api_missing_data_reply',
    method: 'POST',
    endpoint: LINE_REPLY_ENDPOINT,
    status: 'success',
    http_status: lineResponse.status,
    payload_summary: {
      reply_token: replyToken,
      text: apiMissingText,
    },
    response_summary: lineResponse.data,
    line_event_id: eventId,
  });
  void deps.chatHistory
    .logMessage({
      userId,
      senderType: 'bot',
      messageType: 'text',
      content: apiMissingText,
      hookId: asString(hook?.['_id']),
      channelType: hook?.['channel_type'],
      channelId,
      replyToken: replyToken,
      // [FEAT-20260831-QUOTESRC] see the rate-limit site for the contract
      ...deps.sentMessageIds(lineResponse),
      metadata: { event_id: eventId, reason: 'api_missing' },
    })
    .catch((e: Error) =>
      deps.logger.error(`[APIMISSING] Log failed: ${e.message}`),
    );
  return;
}
