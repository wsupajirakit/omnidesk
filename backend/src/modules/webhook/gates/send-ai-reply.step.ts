/**
 * [PROG-20260905-G45] Send the AI answer, then make the record match it — body in
 * `ai-reply/send-ai-reply.handler.ts`.
 *
 * The guards ABOVE this step decide WHETHER to send; this one sends. That split is why the
 * empty-reply and staleness guards are their own rows: when a gate fires is a gate-order
 * fact, and the handler has no business owning it.
 *
 * ⚠️ THE HANDLER RETHROWS ON A FAILED SEND, exactly as the original block did, and the
 * runner deliberately does not catch — so the failure reaches the spine's outer catch and
 * still writes its `handle_webhook` row. That row is what an incident is opened from.
 * Wrapping this in a try that swallows would trade a visible failure for a customer who
 * was answered by nothing at all.
 *
 * ⚠️ THE PERF SUMMARY IS PART OF THIS STEP, not a separate one. It measures the whole
 * pre-send turn, so it has to be the last thing before the send and nothing may come
 * between them.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const sendAiReplyStep: LadderStep = {
  id: 'send-ai-reply',
  describe: 'send the answer and reconcile the four records with what went out',
  enabled: true,
  mustFollow: ['staleness-guard', 'bot-chat-row'],
  orderNote:
    'the last decision before the send is the staleness guard, and the bot row must ' +
    'already exist because its id is what the flex-history patch rewrites ' +
    '(webhook.service.ts:4556)',
  reads: [
    'replyBodyForLine',
    'replyText',
    'useHelperQr',
    'flexProfileContents',
    'flexKind',
    'flexOut',
    'botChatMsg',
    'categorySettled',
    'responseAi',
    'userText',
    'hook',
    'userId',
    'event',
    'alias',
    'logContext',
    'lineReplyEndpoint',
    'helperAltText',
    'perfT0',
    'perfProfileMs',
    'aiMs',
  ],

  run: async (ctx, deps): Promise<StepVerdict> => {
    /* [FIX-20260801-HELPEREMPTY] logs the text ACTUALLY sent, not `finalReplyForLine` —
       the two differ exactly when customer-helper fires, which is the case the previous
       version could not diagnose. */
    deps.log(`[REPLY-DEBUG] Reply with Final Text: ${ctx.replyBodyForLine}`);

    const perfTotalMs = Date.now() - ctx.perfT0;
    const pct = (n: number): number =>
      perfTotalMs ? Math.round((n / perfTotalMs) * 100) : 0;
    deps.log(
      `[PERF-20260802-TIMING] SUMMARY total(pre-send)=${perfTotalMs}ms | ` +
        `profile=${ctx.perfProfileMs}ms(${pct(ctx.perfProfileMs)}%) | ` +
        `ai=${ctx.aiMs}ms(${pct(ctx.aiMs)}%) | ` +
        `อื่นๆ=${perfTotalMs - ctx.perfProfileMs - ctx.aiMs}ms`,
    );

    await deps.sendAiReply({
      hook: ctx.hook,
      userId: ctx.userId,
      replyToken: ctx.event.replyToken,
      eventId: ctx.event.eventId,
      replyBody: ctx.replyBodyForLine,
      replyText: ctx.replyText,
      useHelperQr: ctx.useHelperQr,
      flexProfileContents: ctx.flexProfileContents,
      flexKind: ctx.flexKind,
      flexOut: ctx.flexOut,
      botChatMsg: ctx.botChatMsg,
      categorySettled: ctx.categorySettled,
      responseAi: ctx.responseAi,
      /* [PROG-20260905-G45] `lineStart` lives inside the handler with the send, so the
         duration on both log rows is measured around the call that makes it. */
      linePayload: {
        reply_token: ctx.event.replyToken,
        user_id: ctx.event.source?.userId,
        message: ctx.userText,
        doc_id: ctx.hook?.['doc_id'],
        alias: ctx.alias,
      },
      logContext: ctx.logContext,
      endpoint: ctx.lineReplyEndpoint,
      helperAltText: ctx.helperAltText,
    });
    // legacy:4949 — the normal terminal.
    return 'done';
  },
};
