/**
 * [FEAT-20260802-FLEXPCWRAP] A `flex_pc` answer is a whole JSON wrapper with no delimiter
 * to strip. **If the card cannot be built, the raw JSON must NOT go out as a text message.**
 *
 * ⚠️ IT REWRITES BOTH TEXTS, and both matter. `finalReplyForLine` is what the staleness
 * warn logs; `replyBodyForLine` is what would be SENT. Blanking only one leaves the other
 * carrying a JSON blob to either a customer or an operator's log.
 *
 * ⚠️ `looksFlexPcJson` is a SHAPE test, not a tag test, and that is deliberate: the answer
 * may carry the wrapper without the resolver having recognised a tag. Both routes into this
 * guard exist because both have been seen.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const flexPcSafeTextStep: LadderStep = {
  id: 'flex-pc-safe-text',
  describe: 'never let an unbuilt flex_pc wrapper leave as raw JSON',
  enabled: true,
  mustFollow: ['tag-strip-probe'],
  orderNote:
    'the probe reports what was NOT built; this then blanks the text that would have ' +
    'carried the raw wrapper (webhook.service.ts:4492)',
  reads: ['tags', 'finalReplyForLine', 'flexProfileContents'],
  writes: ['finalReplyForLine', 'replyBodyForLine'],

  when: (ctx) =>
    Boolean(ctx.tags.wantedFlexPcTag) ||
    (/^\s*\{/.test(String(ctx.finalReplyForLine)) &&
      /flex_pc\d{5}/i.test(String(ctx.finalReplyForLine))),

  run: (ctx): StepVerdict => {
    const safeText = ctx.flexProfileContents
      ? ''
      : 'ขออภัย ระบบแสดงข้อมูลไม่ได้ชั่วคราวค่ะ';
    ctx.finalReplyForLine = safeText;
    ctx.replyBodyForLine = safeText;
    return 'continue';
  },
};
