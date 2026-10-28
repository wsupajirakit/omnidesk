/**
 * [PROG-20260905-LADDER] legacy:4316-4330 — the bot's own chat row, written BEFORE the
 * send, because its id is what the helper/flex history rewrites patch afterwards.
 *
 * ⚠️ AWAITED, and that is the whole reason it is written here rather than after the send:
 * `botChatMsg._id` travels into `sendAiReply`, which rewrites this very row to
 * `message_type: 'flex'` once a card is built. No id, no rewrite.
 *
 * ⚠️ [FIX-20260901-FALLBACKMARKERROW] THE ROW AN ADMIN READS MUST NOT CARRY A RAW MARKER.
 * `replyText` here is the OPERATOR'S OWN field — `default_answer_text` or
 * `ai_generative_error_text` — and `resolveReplyText` is a pure chooser that strips
 * nothing. An operator who wrote `[[[menu_main_00010]]]` into one of those had it stored
 * verbatim and the chat page showed the brackets. What goes to LINE was always clean; only
 * this row, written before the tag resolution, kept the raw text.
 *
 * ⚠️ `HELPER_ALT_TEXT` ON EMPTY, NOT `|| replyText`. A field holding ONLY a marker strips
 * to `''`, and falling back to the raw text there would restore the very brackets this
 * removes — which is exactly the reported case. A blank row is no better: it tells the
 * admin nothing.
 */

import { resolveReplyTags } from '../hook-reply/reply-tags.util';
import { asString, maskToken } from '../logging/coerce-mask.util';

import type { LadderStep, StepVerdict } from './ladder.types';

export const botChatRowStep: LadderStep = {
  id: 'bot-chat-row',
  describe:
    'store what the bot is about to say, before the send, so the id exists',
  enabled: true,
  /* `replyText` null means the OA chose silence — no row, exactly as before. */
  when: (ctx) => Boolean(ctx.replyText),
  reads: [
    'replyText',
    'tagStatus',
    'hook',
    'userId',
    'creds',
    'event',
    'helperAltText',
  ],
  writes: ['botChatMsg'],

  run: async (ctx, deps): Promise<StepVerdict> => {
    const replyText = ctx.replyText as string;
    const stripped = resolveReplyTags(
      replyText,
      (ctx.hook?.['answer_link'] as string) || '',
    ).finalReplyForLine;

    ctx.botChatMsg = await deps.logMessageAwaited({
      userId: ctx.userId,
      senderType: 'bot',
      messageType: 'text',
      content: stripped || ctx.helperAltText,
      hookId: asString(ctx.hook?.['_id']),
      channelType: ctx.hook?.['channel_type'],
      channelId: ctx.creds.channelId,
      aiKey: maskToken(ctx.creds.aiKeyForMaskOnly),
      replyToken: ctx.event.replyToken,
      metadata: { event_id: ctx.event.eventId, tag_status: ctx.tagStatus },
    });
    return 'continue';
  },
};
