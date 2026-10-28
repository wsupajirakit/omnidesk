/**
 * [PROG-20260905-LADDER] The `generate_response` audit row — the heaviest webhook_log row
 * on the path, because it carries the whole model request and response.
 *
 * The row is built by `logging/ai-audit-row.ts` (SP31). What is here is WHEN it is
 * written, and that is a spine contract rather than a detail:
 *
 * ⚠️ [PERF-20260824-WLOGVOID] NOT AWAITED. The reply is only sent ~600 lines below, so
 * every millisecond Mongo spends here is a millisecond the customer waits — against a
 * reply token that expires at 60s. Safe to drop the await because nothing downstream reads
 * the result: `wlogEmit` resolves to void and swallows its own failure into the error log,
 * so an unhandled rejection cannot escape and no branch tests it.
 *
 * ⚠️ WHAT IT TRADES AWAY, stated so nobody rediscovers it: if the process dies between the
 * send and the write, this audit row is lost. Accepted — **a lost audit row is cheaper
 * than a lost reply.**
 */

import { buildAiAuditRow } from '../logging/ai-audit-row';

import type { LadderStep, StepVerdict } from './ladder.types';

export const aiAuditRowStep: LadderStep = {
  id: 'ai-audit-row',
  describe: 'write the generate_response audit row, fire-and-forget',
  enabled: true,
  mustFollow: ['ask-model'],
  orderNote:
    'it records the model turn, so it cannot be written before there is one ' +
    '(webhook.service.ts:4519)',
  reads: [
    'modelAudit',
    'replyTextRaw',
    'tagStatus',
    'responseAi',
    'userText',
    'creds',
    'logContext',
    'event',
  ],

  run: (ctx, deps): StepVerdict => {
    const audit = ctx.modelAudit;
    void deps.emitWlog(
      buildAiAuditRow({
        logContext: ctx.logContext,
        aiVendor: ctx.creds.aiVendor,
        aiModel: ctx.creds.aiModel,
        aiKeyForMaskOnly: ctx.creds.aiKeyForMaskOnly,
        errorMessage: audit?.errorMessage,
        httpStatus: audit?.httpStatus,
        userText: ctx.userText,
        docId: ctx.creds.docId,
        effectiveFastMode: ctx.creds.effectiveFastMode,
        eventId: ctx.event.eventId,
        replyToken: ctx.event.replyToken,
        promptDocMeta: audit?.promptDocMeta,
        thaiNow: audit?.thaiNow,
        replyTextRaw: ctx.replyTextRaw,
        noData: audit?.noData,
        tagStatus: ctx.tagStatus,
        responseAi: ctx.responseAi,
        durationMs: Date.now() - (audit?.startedAt ?? Date.now()),
      } as never),
    );
    return 'continue';
  },
};
