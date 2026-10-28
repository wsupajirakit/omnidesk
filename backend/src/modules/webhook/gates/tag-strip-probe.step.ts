/**
 * [FEAT-20260822-AIPROMPTLOG] The rare-event line: the model asked for a card and no card
 * will be sent.
 *
 * Not in the group · not in the hook's allowlist · a bad flex row · the push path. This is
 * the exact silent failure that makes *"ทำไมการ์ดไม่ออก"* cost hours, and nothing else
 * records it.
 *
 * ⚠️ LOG-ONLY, TOTAL. The try/catch is not belt-and-braces: a diagnostic that can throw is
 * a diagnostic that can cost the customer their reply. It swallows everything, on purpose.
 */

import { asString } from '../logging/coerce-mask.util';

import type { LadderStep, StepVerdict } from './ladder.types';

export const tagStripProbeStep: LadderStep = {
  id: 'tag-strip-probe',
  describe: 'warn when the model asked for a card that could not be built',
  enabled: true,
  reads: ['tags', 'flexProfileContents', 'hook', 'replyViaPush', 'userId'],

  run: (ctx, deps): StepVerdict => {
    try {
      const wantedCard =
        ctx.tags.wantsFlexProfile ||
        ctx.tags.wantedFlexTag ||
        ctx.tags.wantedFlexPcTag;
      if (wantedCard && !ctx.flexProfileContents) {
        deps.warn(
          `[TAG-STRIP] hook=${asString(ctx.hook?.['_id']) ?? '?'} tag=${String(
            ctx.tags.wantedFlexTag ??
              ctx.tags.wantedFlexPcTag ??
              'flex_profile',
          )} — card requested by the model but none was built${
            ctx.replyViaPush && ctx.userId ? ' (push path)' : ''
          }`,
        );
      }
    } catch {
      /* log-only — never let diagnostics touch the reply */
    }
    return 'continue';
  },
};
