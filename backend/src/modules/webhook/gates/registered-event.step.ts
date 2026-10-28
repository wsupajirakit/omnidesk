/**
 * [FEAT-20260905-EVENTREG] The seat for event types the spine has no gate for.
 *
 * legacy:3916-3920 listed them and did nothing: follow, unfollow, join, leave,
 * memberJoined, memberLeft, videoPlayComplete, beacon, accountLink, things. They have ONE
 * home — `event-handlers/`, one file per type, one line in `handler-entries.ts`.
 *
 * ⚠️ ITS POSITION, unchanged from the spine: ABOVE the no-text return, because that return
 * is where those events have always ended. Anything registered is by construction a type
 * the spine ignores (the registry throws at boot on `message`/`postback`), so an
 * unregistered type falls through to exactly the line it fell through to before — the
 * feature stays additive until a handler file exists.
 */

import { dispatchRegisteredEvent } from '../event-handlers/dispatch';

import type { LadderStep } from './ladder.types';

export const registeredEventStep: LadderStep = {
  id: 'registered-event',
  describe:
    'dispatch a LINE event type owned by event-handlers/, if one owns it',
  enabled: true,
  mustPrecede: ['require-user-text'],
  orderNote:
    'the no-text return is where these event types have always ended, so the seat has ' +
    'to sit above it (webhook.service.ts:4141)',
  reads: ['event', 'hook', 'alias', 'logContext'],

  run: async (ctx, deps) =>
    (await dispatchRegisteredEvent(
      {
        event: ctx.event,
        hook: ctx.hook,
        alias: ctx.alias,
        logContext: ctx.logContext,
      },
      { log: deps.log, error: deps.error, emitWlog: deps.emitWlog },
    ))
      ? 'done'
      : 'continue',
};
