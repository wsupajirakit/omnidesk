/**
 * legacy:3836-3846 — SETTING 3, "ค่าตอบกลับเมื่อพบรูปภาพ": resolve the text the customer
 * will actually be told.
 *
 * ⚠️ [FIX-20260808-SLIPFLOW] `textReplyOverride` — the QR-fail text the flex branch sets
 * when no error card exists — takes PRECEDENCE over `image_answer_text`, exactly as
 * legacy:3837 does.
 *
 * ⚠️ [FIX-20260812-HELPERMARKERLEAK] the resolver runs because `image_answer_text` is
 * operator-written, and an operator can put a marker in it. The `[[[assist]]]` strip below
 * is KEPT as well: it predates the resolver and covers a marker the resolver also removes,
 * so both is harmless and the diff stays small.
 *
 * ⚠️ IT ONLY RESOLVES — it does not send. The send is the frozen `try` below it, whose
 * bytes belong to `docs/menu-plug-in.patch` (the menu card, the stamp, the wlog row and
 * the history row). This step hands it `cleanImageAnswer` and stops there.
 */

import {
  resolveHookTextReply,
  resolveHookTextReplyMode,
} from '../hook-reply/hook-text-reply';

import type { LadderStep, StepVerdict } from './ladder.types';

export const imageAnswerTextStep: LadderStep = {
  id: 'image-answer-text',
  describe:
    'resolve the media reply text — the override first, then image_answer_text',
  enabled: true,
  mustFollow: ['missing-profile-reply'],
  orderNote:
    'the missing-API-data line answers instead of this one for an unregistered ' +
    'customer, so it must have had its turn first (webhook.service.ts:3964)',
  reads: ['media', 'hook'],
  writes: ['media'],

  run: (ctx, deps): StepVerdict => {
    const rawAnswerToUse = resolveHookTextReply({
      rawText: ctx.media.textReplyOverride || ctx.media.rawImageAnswer || '',
      hook: ctx.hook,
      mode: resolveHookTextReplyMode(ctx.hook),
    }).text;
    ctx.media.cleanImageAnswer = String(rawAnswerToUse)
      .replace(/\[\[\[assist\]\]\]?/gi, '')
      .trim();
    deps.log(
      `[REPLY-DEBUG] Reply with Image Answer Text: ${ctx.media.cleanImageAnswer}`,
    );
    deps.log(
      `[ASSIST] Non-text message detected (${ctx.media.incomingType}). Replying with clean answer.`,
    );
    return 'continue';
  },
};
