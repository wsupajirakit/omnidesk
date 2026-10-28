/**
 * legacy:4487-4529 — read the markers out of the answer, and decide what is left to say.
 *
 * ⚠️ BUILT FROM `replyText`, NOT `replyTextRaw`. The stored chat row and the sent message
 * must agree, and the row was written from the RESOLVED text — so resolving tags from the
 * raw answer would send something the history does not record.
 *
 * ⚠️ IT ALSO CARRIES `imageTag`, and that is a fix rather than a detail.
 * [FIX-20260815-IMGTAGSTRIPPED]: `finalReplyForLine` has already been through the
 * no-marker-leak catch-all, which removes every `[[[…]]]` it does not recognise —
 * `[[[img_promo]]]` included, by name. Re-scanning the finished text for the carousel tag
 * therefore always found nothing, and that branch was DEAD from 7 Aug 2026, silently. The
 * resolver reads the tag BEFORE the strip, exactly as it already did for the four card
 * markers.
 */

import { resolveReplyTags } from '../hook-reply/reply-tags.util';

import type { LadderStep, StepVerdict } from './ladder.types';

export const resolveReplyTagsStep: LadderStep = {
  id: 'resolve-reply-tags',
  describe: 'read the answer`s markers and settle the text that will be sent',
  enabled: true,
  mustFollow: ['resolve-reply-text'],
  orderNote:
    'the tags come from the RESOLVED reply, so what is sent matches the row that was ' +
    'already stored (webhook.service.ts:4358)',
  reads: ['replyText', 'hook'],
  writes: ['tags', 'finalReplyForLine'],

  run: (ctx): StepVerdict => {
    const tags = resolveReplyTags(
      ctx.replyText,
      (ctx.hook?.['answer_link'] as string) || '',
    );
    ctx.tags = tags;
    ctx.finalReplyForLine = tags.finalReplyForLine;
    return 'continue';
  },
};
