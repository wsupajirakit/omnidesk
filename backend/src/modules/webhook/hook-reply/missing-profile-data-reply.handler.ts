import { asString } from '../logging/coerce-mask.util';
import {
  HELPER_ALT_TEXT,
  stripHelperUriForHistory,
} from './customer-helper-flex';

/**
 * [PROG-20260905-G31] The missing-profile-data reply (helper door S2).
 *
 * WHEN IT RUNS. The profile lookup came back with nothing for a customer the flow was
 * about to answer, so the operator's `missing_api_data_text` goes out instead and the turn
 * ends. Every path returns, so the call site hoists one `return`.
 *
 * ⚠️ IT IS THE TWIN OF `api-error-reply.handler.ts` AND THEY MUST NOT BE MERGED. They read
 * the same operator field and offer the same card, which makes merging look obvious. It
 * would change behaviour in four places, every one of them recorded rather than accidental:
 *   · the log line (`[GUARD]` here, `[EXTERNAL API]` there) — an operator greps for these;
 *   · the fallback text when the field is empty (`'missing api data'` vs `'api_data_missing'`);
 *   · the `action_type` on the webhook_logs row, which dashboards group by;
 *   · **the history row.** This door files the row as the CARD when a card went out; its
 *     twin files `'text'` even then, which is fossilized behaviour its own header calls out
 *     — the abandon lookback reads that field, so "fixing" it there is a behaviour change
 *     wearing a refactor's clothes.
 * ฝาแฝดไม่ใช่ตัวเดียวกัน · รวมเมื่อไหร่ = เปลี่ยนพฤติกรรม
 *
 * ⚠️ ONE OF THE FOUR HELPER DOORS the `helper-stamp-doors` census fences, and the dep names
 * here are deliberately identical to the service methods they bind — `buildHookHelperFlexFor`,
 * `stampIfHelperCardDelivered`. That census counts build/stamp pairs by those exact names
 * across the role directories; a tidier local name makes a door that MOVED read as a door
 * that was DELETED, which is what happened at SP28.
 *
 * ⚠️ Collaborators arrive through `deps`; this file imports no service.
 */

type Doc = Record<string, unknown>;

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

export interface MissingProfileDataReplyArgs {
  hook: Doc | null | undefined;
  accessToken: string;
  userId?: string;
  channelId?: string;
  /**
   * ⚠️ Passed to the TEXT sender exactly as legacy passes it: possibly undefined, which
   * `JSON.stringify` then drops from the body and LINE answers 400 for. A guard here would
   * skip the call AND the `webhook_logs` row legacy writes, so the row would disappear
   * along with the failure it records. Ported as found.
   */
  replyToken?: string;
  /** `event.source?.userId` — what the card builder is given, distinct from `userId`. */
  sourceUserId?: string;
  eventId?: string;
  logContext: Doc;
}

export interface MissingProfileDataReplyDeps {
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

export async function replyMissingProfileData(
  args: MissingProfileDataReplyArgs,
  deps: MissingProfileDataReplyDeps,
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

  /* [FIX-20260812-HELPERMARKERLEAK] OAs routinely set this field to the marker
     `[[[customer-helper]]]`, which used to reach the customer as literal brackets because
     this send site never ran the tag resolver. `resolveHookTextReply` returns the text that
     is safe to send; in the default 'off' mode it returns the field unchanged, so every
     existing OA is byte-identical to before. */
  const missingDataMsg =
    deps.resolveHookTextReply({
      rawText: hook?.['missing_api_data_text'],
      hook,
      mode: deps.resolveHookTextReplyMode(hook),
    }).text || 'missing api data';
  deps.logger.log(
    `[GUARD] User ${userId} has no profileData. Replying with: ${missingDataMsg}`,
  );
  /* [FEAT-20260812-HOOKHELPERFLEX] site 1 of 3 — send the helper CARD (bound
     `flex_customerhelper_id` + minted button) instead of the text, matching what the AI
     path already does for this marker. Returns null in every mode but 'flex', when the
     field has no marker, and on any failure ⇒ the text send below stays the default path. */
  const missingDataCard = (await deps.buildHookHelperFlexFor(
    hook?.['missing_api_data_text'],
    hook,
    args.sourceUserId,
  )) as Doc | null;
  const lineResponse = missingDataCard
    ? await deps.sendFlexReply(
        accessToken,
        replyToken ?? '',
        missingDataCard,
        /* altText: LINE rejects an empty one, and the stripped text is what a
           notification-only client will read. */
        (missingDataMsg || HELPER_ALT_TEXT).slice(0, 400),
        /* [FIX-20260902-FLEXLADDER] the reply→push ladder, the same one the text sender in
           the `else` below already had. Without it a refused reply token lost the CARD
           while the sentence beside it arrived. `userId` is the LINE id. */
        null,
        userId,
      )
    : await deps.sendTextReply(
        accessToken,
        // Possibly undefined, on purpose — see `replyToken` on the args interface.
        replyToken,
        missingDataMsg,
      );
  // [FIX-20260827-HELPERSTAMPDOORS] door S2 — see the method's note.
  deps.stampIfHelperCardDelivered(
    missingDataCard,
    userId,
    lineResponse?.status,
  );
  await deps.wlogEmit({
    ...logContext,
    channel: 'line_api',
    action_type: 'missing_profile_data_reply',
    method: 'POST',
    endpoint: LINE_REPLY_ENDPOINT,
    status: 'success',
    http_status: lineResponse.status,
    payload_summary: {
      reply_token: replyToken,
      text: missingDataMsg,
    },
    response_summary: lineResponse.data,
    line_event_id: eventId,
  });
  /* [FEAT-20260812-HOOKHELPERFLEX] same mirror as the image_answer site: the chat room
     shows the card when the card is what went out. See that site for why the uri is
     stripped before storing. */
  void deps.chatHistory
    .logMessage({
      userId,
      senderType: 'bot',
      messageType: missingDataCard ? 'flex' : 'text',
      content: missingDataCard
        ? `[Flex] ${missingDataMsg || HELPER_ALT_TEXT}`
        : missingDataMsg,
      hookId: asString(hook?.['_id']),
      channelType: hook?.['channel_type'],
      channelId,
      replyToken,
      // [FEAT-20260831-QUOTESRC] the card's own LINE id, when it went out
      ...deps.sentMessageIds(lineResponse),
      metadata: {
        event_id: eventId,
        reason: 'missing_profile_data',
        ...(missingDataCard && {
          auto_reply_type: 'flex_customerhelper',
          flex_json: stripHelperUriForHistory(missingDataCard),
          flex_doc_id: hook?.['flex_customerhelper_id'] ?? null,
        }),
      },
    })
    .catch((e: Error) => deps.logger.error(`[GUARD] Log failed: ${e.message}`));
}
