/**
 * [PROG-20260905-G19] THE UNLINKED-SLIP REFUSAL — the gate. The body is in
 * `hook-reply/unlinked-slip-refusal.handler.ts` and has been since SP28.
 *
 * What moved here is the WIRING, which is all that was left: a seventeen-field input
 * literal and a nineteen-line deps literal, thirteen of whose collaborators were already
 * bound once for the turn a thousand lines above. That duplication is the exact habit the
 * turn-deps object exists to end — `log`, `error`, `logBotMessage`, `emitWlog`,
 * `sendTextReply` and `runAssist` are not re-bound here, they are read.
 *
 * ⚠️ IT ENDS THE TURN ON EVERY PATH, which is why it answers `'done'` unconditionally
 * rather than reporting what the handler did. The handler's four inner steps are
 * ORDER-CRITICAL — customer row, bot row, reply, assist — and each order was earned by a
 * live defect on 12/08. The handler states which one at each site; nothing here may
 * reorder them.
 *
 * ⚠️ IT RUNS AFTER THE NOTICE GUARD, and that is the whole of `[FEAT-20260824-NOTICEFIRST]`.
 * The guard is asked first because a slip from a customer with no linked account should
 * meet the off-hours card before it meets "please link your account" (owner, 24/08). The
 * guard is still inline — its `consumeQuota` closure holds a `docs/strike-plug-in.patch`
 * box — so this step is a slice of its own, on the far side of that box.
 *
 * ⚠️ IT IS NOT MERGED WITH `unlinked-slip-decide`. The decision is taken BEFORE the notice
 * guard and the reply is sent AFTER it; folding them into one step would put the reply
 * back above the guard and silently undo the 24/08 change. แยกกันเพราะมี notice คั่น
 */

import { stripHelperUriForHistory } from '../hook-reply/customer-helper-flex';
import { resolveHookTextReplyMode } from '../hook-reply/hook-text-reply';
import { replyUnlinkedSlipRefusal } from '../hook-reply/unlinked-slip-refusal.handler';
import { errText } from '../logging/coerce-mask.util';

import type { LadderStep, StepVerdict } from './ladder.types';

export const unlinkedSlipRefuseStep: LadderStep = {
  id: 'unlinked-slip-refuse',
  describe: 'refuse a slip from a sender with no account, and end the turn',
  enabled: true,
  mustFollow: ['unlinked-slip-decide'],
  orderNote:
    'it sends what the decide step computed; without that write it would refuse ' +
    'nobody, silently (webhook.service.ts:2946)',

  when: (ctx) => ctx.slip.blockUnlinked,
  reads: [
    'hook',
    'userId',
    'creds',
    'skipBotProcessing',
    'msgType',
    'msgContent',
    'media',
    'profileForLog',
    'body',
    'event',
    'logContext',
    'slip',
  ],

  run: async (ctx, deps): Promise<StepVerdict> => {
    await replyUnlinkedSlipRefusal(
      {
        hook: ctx.hook,
        userId: ctx.userId,
        channelId: ctx.creds.channelId,
        skipBotProcessing: ctx.skipBotProcessing,
        msgType: ctx.msgType,
        msgContent: ctx.msgContent,
        internalContentId: ctx.media.internalContentId,
        profileForLog: ctx.profileForLog,
        body: ctx.body,
        replyToken: ctx.event.replyToken,
        eventId: ctx.event.eventId,
        messageId: ctx.event.message?.id,
        quoteToken: ctx.event.message?.quoteToken,
        quotedMessageId: ctx.event.message?.quotedMessageId,
        logContext: ctx.logContext,
        endpoint: ctx.lineReplyEndpoint,
        helperAltText: ctx.helperAltText,
      },
      {
        log: deps.log,
        error: deps.error,
        errText,
        hookReplyMode: () => resolveHookTextReplyMode(ctx.hook),
        buildHookHelperFlexFor: deps.buildHookHelperFlexFor,
        stripHelperUri: (card) => stripHelperUriForHistory(card),
        logCustomerMessage: (row) => deps.logMessageAwaited(row),
        /* ⚠️ THE TWO FIRE-AND-FORGET WRITERS KEEP THEIR OWN CATCHES, and the reason is the
           WORDING. `deps.logBotMessage(row, tag)` would produce `[REQUIREPROFILE] Log
           failed: …`, but this site has always logged `[REQUIREPROFILE] history log
           failed: …` — and the divider's line is a whole Thai sentence, not a prefix.
           Those strings are what an operator greps for, so they stay at the site that owns
           them rather than being rewritten to a shared shape by the move.
           ย้ายโค้ดได้ แต่ข้อความ log ห้ามเปลี่ยน */
        logBotMessage: (row) => {
          void deps
            .logMessageAwaited(row)
            .catch((e: Error) =>
              deps.error(`[REQUIREPROFILE] history log failed: ${e.message}`),
            );
        },
        logSystemMessage: (row) => {
          void deps
            .logSystemMessage(row)
            .catch((e: unknown) =>
              deps.error(
                `[SUPPRESSEDCHECK] เก็บผลตรวจไม่สำเร็จ (flow เดิมไม่กระทบ): ${errText(e)}`,
              ),
            );
        },
        sendFlexReply: deps.sendFlexReply,
        sendTextReply: deps.sendTextReply,
        stampIfHelperCardDelivered: deps.stampIfHelperCardDelivered,
        emitWlog: deps.emitWlog,
        runAssist: (siteArgs) => deps.runAssist(siteArgs),
      },
    );
    return 'done';
  },
};
