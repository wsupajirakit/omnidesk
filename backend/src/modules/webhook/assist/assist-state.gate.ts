import { errText } from '../logging/coerce-mask.util';
import { type FlowState, initialFlowState } from '../spine';
import { buildRoomFilter } from '../room-bootstrap/room-filter';

/**
 * [PROG-20260905-C2] The assist-state gate: is an operator holding this room, and has the
 * hold timed out?
 *
 * WHAT IT DECIDES. Four values the rest of the ladder reads: whether the bot must stay
 * silent (`skipBotProcessing`, read at thirteen later code lines), the room this turn
 * belongs to, whether to re-assist after replying (read only by the method's finally),
 * and the timeout that fired.
 *
 * ⚠️ THE VERDICT IS MUTATED IN PLACE, NOT BUILT AT THE END, AND THAT IS LOAD-BEARING.
 * `inboundRoom` is assigned BEFORE the awaits that follow it. If a later await throws,
 * the original code kept the room it had already found — the catch swallows the error and
 * the follow-up gate still sees a room. Building the verdict at the end of the try and
 * returning it after the catch would hand those later gates `null` on exactly that path,
 * silently changing which room a customer's follow-up is filed against. Measured on the
 * real gate; the shape exists to preserve it.
 *
 * ⚠️ ZERO EXITS. The original block returns nothing and throws nothing outward — every
 * failure is caught here and logged. The call site is one `await`, in the same slot.
 *
 * ⚠️ `errText` and `buildRoomFilter` are IMPORTED from their role files, not redeclared.
 * They used to be redeclared here — importing back from `webhook.service.ts` would be a
 * cycle, so every extraction copied them along, and `errText` reached TWELVE copies before
 * [PROG-20260905-ERRTEXT] consolidated it into `logging/coerce-mask.util.ts`. Role files
 * may import each other freely; only the service is out of bounds.
 */

/* `buildRoomFilter` is imported, not redeclared — `room-bootstrap/room-filter.ts` holds
   the one copy. */

type Doc = Record<string, unknown>;

export interface AssistStateDeps {
  chatRoomModel: {
    findOne: (filter: Doc) => {
      lean: <T = Doc>() => { exec: () => Promise<T | null> };
    };
    updateOne: (filter: Doc, update: Doc) => { exec: () => Promise<unknown> };
  };
  chatMessageModel: {
    findOne: (filter: Doc) => {
      sort: (order: Record<string, number>) => {
        lean: <T = Doc>() => { exec: () => Promise<T | null> };
      };
    };
  };
  ticketModel: {
    findOne: (filter: Doc) => {
      sort: (order: Record<string, number>) => {
        lean: <T = Doc>() => { exec: () => Promise<T | null> };
      };
    };
  };
  assignHistoryModel: { create: (row: Doc) => Promise<unknown> };
  logger: { log: (m: string) => void; error: (m: string) => void };
}

/**
 * Runs the gate and returns the four values. The caller assigns them back to its own
 * method-scope state in the same slot the block occupied.
 */
export async function runAssistStateGate(
  userId: string,
  hook: Record<string, unknown> | null | undefined,
  /** `event.message?.text || event.postback?.data || event.message?.type || '[Unknown]'` */
  incoming: string,
  deps: AssistStateDeps,
): Promise<FlowState> {
  const verdict: FlowState = initialFlowState();

  try {
    const room = await deps.chatRoomModel
      .findOne(buildRoomFilter(userId, hook?.['_id']))
      .lean<Record<string, unknown>>()
      .exec();
    verdict.inboundRoom = room ?? null;
    if (room && room['assist_status'] === true) {
      // Default 30 for null, undefined or any unusable number.
      let autoUnassistMinutes = Number(hook?.['auto_unassist_minutes']);
      if (
        !autoUnassistMinutes ||
        isNaN(autoUnassistMinutes) ||
        autoUnassistMinutes <= 0
      ) {
        autoUnassistMinutes = 30;
      }

      const lastCustomerMsg = await deps.chatMessageModel
        .findOne({ room_id: room['_id'], sender_type: 'customer' })
        .sort({ created_at: -1 })
        .lean<Record<string, unknown>>()
        .exec();

      let diffMinutes: number | null = null;
      let hasPreviousMessage = false;
      const lastAt = lastCustomerMsg?.['created_at'];
      if (lastCustomerMsg && lastAt) {
        hasPreviousMessage = true;
        diffMinutes =
          (Date.now() - new Date(lastAt as string).getTime()) / (1000 * 60);
      }

      /* The gate reads ONE derived value off the event — the text it logs. Passing the
         string in rather than the whole event keeps the LINE event shape out of this
         file, and the caller already knows how to read its own event. */
      const incomingText = incoming;
      deps.logger.log(
        `[ASSIST-CHECK] User: ${userId} | Incoming Msg: "${incomingText}" | ` +
          `Has Prev Msg: ${hasPreviousMessage} | ` +
          `Diff Mins: ${diffMinutes !== null ? diffMinutes.toFixed(2) : 'N/A'} | ` +
          `Condition Mins: ${autoUnassistMinutes}`,
      );

      // ⚠️ An EXPLICIT 0 disables the timeout entirely — the OA is saying
      //    "never hand this room back to the bot". Checked against the
      //    raw hook value, not the defaulted one, because the default
      //    above has already turned 0 into 30.
      const autoUnassistDisabled =
        hook?.['auto_unassist_minutes'] === 0 ||
        hook?.['auto_unassist_minutes'] === '0';

      if (hasPreviousMessage) {
        if (
          !autoUnassistDisabled &&
          diffMinutes !== null &&
          diffMinutes >= autoUnassistMinutes
        ) {
          await deps.chatRoomModel
            .updateOne(
              { _id: room['_id'] },
              {
                $set: {
                  assist_status: false,
                  last_assist_changed_at: new Date(),
                },
              },
            )
            .exec();
          verdict.forceReAssistAfterReply = true;
          verdict.autoUnassistTriggeredMinutes = autoUnassistMinutes;
          deps.logger.log(
            `[ASSIST] User ${userId} auto unassisted due to ${diffMinutes.toFixed(2)} mins timeout. Will re-assist after reply.`,
          );

          try {
            const latestTicket = await deps.ticketModel
              .findOne({
                chat_user_id: room['user_id'],
                hook_id: room['hook_id'],
              })
              .sort({ created_at: -1 })
              .lean<Record<string, unknown>>()
              .exec();

            await deps.assignHistoryModel.create({
              chat_room_id: room['_id'],
              ticket_id: latestTicket ? latestTicket['_id'] : null,
              assign_to: null,
              changed_by_id: null,
              action: 'auto_unassist',
              detail: `bot_automate_condition_${autoUnassistMinutes}_minutes`,
            });
            deps.logger.log(
              `[ASSIST] Created AssignHistory record for auto-unassist on room ${String(room['_id'])}.`,
            );
            // NOTE: the "บอทกลับมาดูแลแล้ว" divider is emitted from
            // ticket close, NOT here, so it fires even when this delayed
            // path never runs. Adding one here would double it on close.
          } catch (historyErr) {
            deps.logger.error(
              `[ASSIST] Failed to record AssignHistory for auto-unassist: ${errText(historyErr)}`,
            );
          }
        } else {
          deps.logger.log(
            `[ASSIST] User ${userId} is currently being assisted. Bypassing bot processing (No Telegram/Ticket).`,
          );
          verdict.skipBotProcessing = true;
        }
      } else {
        deps.logger.log(
          `[ASSIST] User ${userId} is currently being assisted. Bypassing bot processing (No Telegram/Ticket).`,
        );
        verdict.skipBotProcessing = true;
      }
    }
  } catch (err) {
    deps.logger.error(`Error checking assist_status: ${errText(err)}`);
  }
  return verdict;
}
