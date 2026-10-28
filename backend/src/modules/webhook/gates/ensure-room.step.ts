/**
 * [FEAT-20260813-EAGERROOM] The room exists the moment a real customer is identified.
 *
 * ⚠️ ITS POSITION IS THE FEATURE: this is the earliest point where `userId` AND `hook` are
 * both validated — the alias 404, the signature re-check and the event re-read all sit
 * above it. Earlier would create rooms for requests that were about to be rejected.
 *
 * ⚠️ AWAITED ON PURPOSE. A fire-and-forget call would race the member sync below on the
 * unique member key — see `room-bootstrap/ensure-room-on-event.ts`. It never throws;
 * dummy and standby test events are filtered inside it.
 *
 * revert: delete this step and its row. The old `logMessage` upsert at the chat.log site
 * keeps creating rooms exactly as before.
 */

import { asString } from '../logging/coerce-mask.util';

import type { LadderStep, StepVerdict } from './ladder.types';

export const ensureRoomStep: LadderStep = {
  id: 'ensure-room',
  describe: 'create the chat room as soon as a real customer is identified',
  enabled: true,
  mustFollow: ['reread-event'],
  orderNote:
    'it must see the RE-READ event, not the one the caller passed, or the room is ' +
    'created for the wrong customer (webhook.service.ts:2099)',
  reads: ['event', 'userId', 'hook', 'creds'],

  run: async (ctx, deps): Promise<StepVerdict> => {
    await deps.ensureRoom({
      event: ctx.event,
      userId: ctx.userId,
      hookId: asString(ctx.hook?.['_id']),
      channelId: ctx.creds.channelId,
      channelType: ctx.hook?.['channel_type'],
    });
    return 'continue';
  },
};
