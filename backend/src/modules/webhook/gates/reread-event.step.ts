/**
 * legacy:2476-2482 — re-read `events[0]` from the body, and let it become the turn's event.
 *
 * ⚠️⚠️ THIS STEP REASSIGNS THE TURN'S IDENTITY, which is why `event` and `userId` are the
 * only two context fields that are not `readonly`. Legacy re-reads here and the line is
 * unchanged on purpose.
 *
 * ⚠️ [FEAT-20260905-MULTIEVENT] It reads `events[0]` of the body THIS CALL was given, and
 * the delivery loop hands every iteration after the first a body sliced to its own single
 * event — so the same bytes now select the caller's event instead of re-selecting the
 * batch's first one. That is how the loop neutralises this re-read without touching it.
 * Passing the original body to every iteration would process `events[0]` N times: N quota
 * charges, N model calls, N pushes of one answer, with chat dedup hiding the duplicate rows.
 *
 * ⚠️ `if (!reread) return;` is a DEFENSIVE TWIN and is dead on today's only caller —
 * `processWebhook` refuses an empty delivery above the lock. Kept because it is what legacy
 * wrote and because the loop is not the only conceivable caller;
 * `flow-map/gate-video-and-reread.spec.ts` drives it directly and says so.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

interface EventsBody {
  events?: { source?: { userId?: string } }[];
}

export const rereadEventStep: LadderStep = {
  id: 'reread-event',
  describe: 're-take events[0] from the body; end the turn when there is none',
  enabled: true,
  reads: ['body'],
  writes: ['event', 'userId'],

  run: (ctx): StepVerdict => {
    const reread = (ctx.body as EventsBody).events?.[0];
    if (!reread) return 'done';
    ctx.event = reread;
    ctx.userId = reread.source?.userId;
    return 'continue';
  },
};
