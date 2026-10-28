import { errText } from '../logging/coerce-mask.util';
type Doc = Record<string, unknown>;

/* Redeclared rather than imported from the service — importing back would be a cycle. */
/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

/**
 * [PROG-20260905-G22] The inbound customer chat row.
 *
 * WHAT IT DOES. Stores what the customer sent, so the conversation exists in history and
 * the realtime feed, and hands back the stored row — later gates put its id on assist and
 * ticket payloads.
 *
 * ⚠️ A POSTBACK IS DELIBERATELY NOT STORED. A button press is not a message: storing it
 * would put machine payloads in a customer's chat history and publish a `message:new` for
 * something nobody typed. The event is NOT lost — `webhook_logs` still records it with its
 * postback data, and the seats that ACT on a postback run further up, untouched.
 *
 * ⚠️ A FAILURE HERE MUST NOT END THE TURN. The write is wrapped and swallowed: the row is
 * worth less than the reply. `stored` then stays null, so `chatMsgId` on the assist and
 * ticket payloads is undefined — a value both read sites already handled with `?.` because
 * that is exactly what happened whenever this write threw before.
 */

export interface InboundChatRowDeps {
  chatHistory: { logMessage: (row: Doc) => Promise<Doc | null> };
  logger: { log: (m: string) => void; error: (m: string) => void };
}

/**
 * @returns the stored row, or null when nothing was stored (a postback, or a failed
 *          write). Null is a value the callers already expect.
 */
export async function storeInboundChatRow(
  event: { type?: string; postback?: { data?: string } },
  row: Doc,
  deps: InboundChatRowDeps,
): Promise<Doc | null> {
  let stored: Doc | null = null;

  try {
    if (event.type === 'postback') {
      deps.logger.log(
        `[NOPOSTBACKROW] postback not stored: ${String(
          event.postback?.data ?? '',
        ).slice(0, 80)}`,
      );
    } else {
      stored = await deps.chatHistory.logMessage(row);
    }
  } catch (err) {
    deps.logger.error(`Error logging event ${event.type}: ${errText(err)}`);
  }
  return stored;
}
