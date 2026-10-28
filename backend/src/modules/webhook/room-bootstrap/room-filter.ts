/**
 * [PROG-20260905-ROOMFILTER] `legacy:250` — one room per user per hook, matching EITHER
 * id field name. One copy, for the whole webhook module.
 *
 * WHY THIS FILE EXISTS, STATED PLAINLY: there were FOUR copies of this function —
 * `webhook.service.ts`, `ai-reply/prompt-assembly.ts`, `assist/assist-notification.ts` and
 * `assist/assist-state.gate.ts`. Three of them were created BY the spine reduction program
 * itself: a role file cannot call a module-private function in the service, and importing
 * back from the service is a cycle, so each extraction copied the helper along with the
 * body it moved. That is the failure mode the owner named — *"ย้ายไปก็ไม่มีความหมาย ไปบวมที่ใหม่"* —
 * and a filter is the worst thing to duplicate, because it is not a formatting choice:
 * it encodes a SCHEMA FACT.
 *
 * ⚠️ THE `$or` IS THE FACT, AND IT IS NOT OPTIONAL. `chat_rooms` rows carry the customer
 * id under `channel_user_id` on rows written since the multi-channel rename and under
 * `line_user_id` on everything older. A lookup that matches only one name finds only half
 * the rooms — and finds them SILENTLY, because "no room" is a legal answer everywhere this
 * is used. Four copies meant four chances for one of them to be "tidied" to a single field
 * and for the resulting hole to show up as an occasional missing history, months later.
 *
 * ⚠️ `hookId` IS `unknown` ON PURPOSE. Callers hold it as an ObjectId, as a string, or as
 * `logContext['hook_id']` typed `unknown`; every copy took it loosely and passed it
 * straight to Mongo, which compares it as it arrives. Narrowing the type here would force
 * a cast at every call site and change nothing about the query.
 *
 * revert: this file is a pure extraction with no behaviour of its own — paste the body
 *         back into any caller and delete the import.
 */

/** The `chat_rooms` filter both id spellings satisfy. */
export function buildRoomFilter(
  userId: string,
  hookId: unknown,
): Record<string, unknown> {
  return {
    $or: [{ channel_user_id: userId }, { line_user_id: userId }],
    hook_id: hookId,
  };
}
