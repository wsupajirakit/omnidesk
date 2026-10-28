/**
 * [FEAT-20260820-FIRSTTICKET] When this customer first had a case — ever.
 * ===========================================================================
 * Owner, 2026-08-20: "first_ticket_at = นับหมดไม่ว่าจะเกิดจากอะไร".
 *
 * ## WHAT IT ANSWERS, AND WHAT IT DOES NOT
 * `members.first_ticket_at` is the date of a customer's FIRST ticket, whatever
 * opened it — the assist marker, an admin pressing "open case", the REST route,
 * the payment runner, or a future fifth path. It is a historical fact and never
 * changes again.
 *
 * ⚠️ IT IS NOT "does this customer have a case open right now". That question is
 * answered by `tickets.job_status`, changes constantly, and must not be read
 * from here. A field that answers one question and gets used for the other is
 * how a report quietly starts lying. คนละคำถามกับ "ตอนนี้มีเคสเปิดอยู่ไหม".
 *
 * ## WHY THE SCHEMA HOOK AND NOT THE FOUR CALL SITES
 * Tickets are created in four places today. All four call `ticketModel.create()`,
 * so `TicketSchema`'s save hook sees every one — including
 * `openTicketBySystem`, which scenario A uses. Stamping at each call site would
 * be four things to keep in step, and a fifth writer added later would silently
 * miss it. ทางเดียวคุมได้ทุกทาง.
 *
 * The seam is proven from live data rather than from reading code: `channel_type`
 * is written ONLY by that hook, and every ticket row in the database carried it
 * (43/43 when this was built).
 *
 * ## FIRST WRITER WINS — enforced in the filter, not by reading first
 * Two tickets can be created in one request, and the four paths can race. The
 * `$or` below means only the first update finds a document; the rest match
 * nothing and write nothing. No lock, no read-then-write window.
 *
 * ## SEAMLESS BY CONSTRUCTION
 * The field has NO schema default, so it is absent on every member alive today
 * and stays absent until that member's first ticket. Nothing reads it for a
 * decision, so a missing value cannot change any behaviour, and there is no
 * migration and no backfill — a guessed date would be a silent lie, the same
 * rule `link_registered_at` and `profile_data_updated_at` already follow.
 * ของเดิมไม่ถูกแตะเลย · ไม่ต้อง migrate · ไม่มีค่า = ยังไม่เคยมีเคส.
 *
 * ⚠️ NO `default: null` ON PURPOSE. `link_registered_by/at` have one, which puts
 * the key into every new document and into every `toJSON()` response even when
 * it means nothing. Absent is the honest representation of "never happened", and
 * it keeps the partial index (`$exists: true`) holding only real values.
 *
 * ## REMOVING IT
 *   1. delete this file and `z-test/unit/first-ticket-stamp.spec.ts`
 *   2. delete the `post('save')` hook and the `$locals` capture in
 *      `ticket.schema.ts` (both carry this tag)
 *   3. delete the `@Prop` in `member.schema.ts` and its partial index
 *      (`dropIndex` removes it from a live database; rows keep their values)
 *   4. optional: `db.members.updateMany({}, { $unset: { first_ticket_at: '' } })`
 * Nothing reads the field, so every step is independent and none of them changes
 * behaviour. ถอดทีละขั้นได้ ไม่มีใครอ่านค่านี้.
 *
 * revert: see "REMOVING IT" above.
 */

/** The one place the field name is written. */
export const FIRST_TICKET_AT_FIELD = 'first_ticket_at';

/** Only what this needs: something that can update one member. */
export interface FirstTicketStampDeps {
  memberModel: {
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => { exec: () => Promise<unknown> };
  };
  warn?: (msg: string) => void;
}

/**
 * Record a member's first ticket. Safe to call on every ticket ever created.
 *
 * @param memberId the ticket's member — `chat_user_id`/`line_user_id` after the
 *   schema's own mirror hook has filled both, so the caller need not know which
 *   of the two a given creation path happened to set.
 * @param at when the ticket was created.
 * @returns true only when THIS call was the one that stamped.
 */
export async function stampFirstTicketAt(
  memberId: unknown,
  at: Date,
  deps: FirstTicketStampDeps,
): Promise<boolean> {
  // no member on the ticket ⇒ nothing to stamp. Never write without a target:
  // an empty filter would match the first member in the collection.
  if (memberId === null || memberId === undefined || memberId === '') {
    return false;
  }
  try {
    const res = (await deps.memberModel
      .updateOne(
        {
          _id: memberId,
          // absent OR an explicit null — both mean "never had a ticket". The
          // null arm exists because another feature's write can leave the key
          // present-as-null on a document.
          $or: [
            { [FIRST_TICKET_AT_FIELD]: { $exists: false } },
            { [FIRST_TICKET_AT_FIELD]: null },
          ],
        },
        { $set: { [FIRST_TICKET_AT_FIELD]: at } },
      )
      .exec()) as { modifiedCount?: number } | null;
    return res?.modifiedCount === 1;
  } catch (err) {
    // Best-effort by design: the ticket is already saved by the time this runs.
    deps.warn?.(
      `[FIRST-TICKET] stamp skipped: ${(err as Error)?.message ?? 'unknown'}`,
    );
    return false;
  }
}
