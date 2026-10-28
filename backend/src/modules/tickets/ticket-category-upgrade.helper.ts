import type { Model } from 'mongoose';

/**
 * ==== [FEAT-20260815-CATUPGRADE] Other → Payment when a slip arrives ====
 *
 * ## WHAT IT DOES
 * A ticket opened by the assist flow starts as `category: 'Other'`, because at
 * that moment nobody knows what the customer wants. If the customer then sends a
 * SLIP while the room is still waiting for an admin, the case is plainly about
 * payment — but the ticket keeps saying `Other`, so the admin queue sorts and
 * filters it under the wrong label. This upgrades it, once.
 *
 * ## THE RULE — owner-stated 15/08/2026. All four must hold TOGETHER:
 *
 *   1. `tickets.category === 'Other'`      — a hand-set category is never touched
 *   2. `chat_rooms.assist_status === true` — the room asked for a human
 *   3. `tickets.job_status === 0`          — no admin has claimed it yet
 *   4. a slip actually arrived             — the caller decides this; see below
 *
 *   plus the latch: `category_upgraded_at === null` — it has not run before.
 *
 * ⚠️ `job_status` IS THE CLAIM SIGNAL, verified against live data 15/08/2026,
 * not assumed. `tickets.service.ts:892` sets `assigned_at` when `job_status`
 * becomes 1, and `:1326` sets `job_status: 2` + `resolved_at` on close:
 *     0 = open, nobody claimed   ← the only state we upgrade
 *     1 = claimed by an admin
 *     2 = closed
 * Using `admin_user_id == null` instead would have been wrong: 129 of 138 rows
 * carry one, and 128 of those are already closed.
 *
 * ## HOW "ONLY ONCE" IS GUARANTEED
 * `category_upgraded_at: null` sits in the FILTER of a single
 * `findOneAndUpdate`, so the check and the write are one atomic operation in
 * MongoDB. Two slips arriving together race: exactly one matches, the other
 * matches nothing and returns null. Read-then-write would leave a window where
 * both think they are first. (Same technique as `openPaymentTicketIfIdle`.)
 *
 * ## SEAMLESS — what this canNOT do
 * - never DOWNGRADES: `category: 'Other'` is in the filter, so a ticket an admin
 *   set to something else is invisible to this code
 * - never touches a claimed or closed ticket: `job_status: 0`
 * - never touches another customer's ticket: filtered by (member, hook)
 * - never throws: the caller sits on the slip path and a label is not worth
 *   failing a payment flow for. Every error is swallowed and logged.
 * - never runs twice: the latch above
 *
 * ## WHY IT IS ITS OWN FILE
 * `webhook.service.ts` is ~5k lines; the owner's standing instruction is to stop
 * it growing. The caller is one line. It lives beside `ticket-divider.helper.ts`
 * because both are small ticket-side effects driven from the webhook.
 *
 * ## revert
 * Delete this file, its export in `tickets/index.ts`, the single call in
 * `webhook.service.ts`, and the `category_upgraded_at` prop on the schema.
 * Tickets already upgraded keep their category — which is the correct label
 * anyway — and the timestamp is simply never read again.
 */

/** Injected so the helper is testable without the Nest container. */
export interface TicketCategoryUpgradeDeps {
  ticketModel: Model<Record<string, unknown>>;
  chatRoomModel: Model<Record<string, unknown>>;
  /** Resolves the member `_id` from a LINE id — see the id trap below. */
  memberModel: Model<Record<string, unknown>>;
  /**
   * [FEAT-20260815-CATUPGRADELOG] Writes the audit row into `webhook_logs`.
   *
   * WHY IT IS HERE AT ALL: the console line below is gone the moment the process
   * restarts, and `category_upgraded_at` on the ticket says WHEN but not WHY or
   * FROM WHAT. Without a row, "who changed this ticket to Payment" has no answer
   * after the fact — and this is code that edits a ticket an admin is looking at.
   * Owner-requested 15/08/2026 after noticing the upgrade left no trace in the
   * webhook log.
   *
   * OPTIONAL ON PURPOSE: a caller that does not pass it keeps the previous
   * behaviour exactly (console only), so this cannot break an existing call site
   * and the helper stays usable from tests and scripts without a log pipe.
   *
   * ⚠️ It is the SAME `persistWebhookLog` the rest of the webhook uses, which
   * already swallows its own errors (`webhook.service.ts:624`) — so a failed log
   * write can never reach the payment flow. Do not replace it with a direct
   * model write, which would not have that guard.
   */
  persistWebhookLog?: (entry: Record<string, unknown>) => Promise<void>;
  /**
   * [FEAT-20260815-CATUPGRADEWS] Emits `ticket:updated` so the ticket card
   * relabels itself without a refresh.
   *
   * ⚠️ THE FE END ALREADY EXISTS — nothing was built for it. `TicketSupport.tsx`
   * has handled `'ticket:new' || 'ticket:updated'` since
   * `[FIX-20260728-REALTIME-SCALE]`, routing it into `scheduleTicketPatch`,
   * which debounces and patches ONLY the ticket that changed. The backend simply
   * never emitted `ticket:updated`. This connects the two; no FE change.
   *
   * ⚠️ `hook_id` MUST BE A STRING. `RealtimePublisherService.publish` drops any
   * payload without a truthy `hook_id` (realtime-publisher.service.ts:73) to stop
   * an unscoped event fanning out to every operator — and the FE discards it a
   * second time for the same reason (`TicketSupport.tsx:818`). An ObjectId that
   * serialises oddly would be silently dropped at either end.
   *
   * ⚠️ CANNOT DISTURB EXISTING REALTIME. `ticket:updated` is a type this backend
   * has never published, so no current listener changes behaviour; `ticket:new`
   * and the `customer:*`/`message:*` events are untouched. Only fired when an
   * upgrade actually happened — a no-op emits nothing.
   *
   * OPTIONAL, like the log pipe above: a caller that omits it keeps the previous
   * behaviour exactly (the card updates on the next refresh).
   */
  publishTicketUpdated?: (data: Record<string, unknown>) => void;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface TicketCategoryUpgradeInput {
  /** LINE user id of the customer (NOT our member `_id`). */
  channelUserId: string;
  /** `_id` of the hook (OA). */
  hookId: unknown;
  /**
   * [FEAT-20260815-CATUPGRADELOG] The caller's `logContext` — hook_alias,
   * group_id, key masks and the rest that every other `webhook_logs` row
   * carries. Spread as-is so this row is filterable beside its neighbours on the
   * Webhook Logs page rather than being an odd one out. Optional: without it the
   * row is still written, just with fewer columns to filter on.
   */
  logContext?: Record<string, unknown>;
  /** The slip that triggered the upgrade, recorded for traceability. */
  slipRecordId?: unknown;
}

/** The category a fresh assist ticket carries until something says otherwise. */
const FROM_CATEGORY = 'Other';
/** What a slip proves the case is about. */
const TO_CATEGORY = 'Payment';
/** `job_status` 0 = open and unclaimed. See the note above. */
const JOB_STATUS_OPEN = 0;

/**
 * Upgrade the customer's open ticket from `Other` to `Payment`, at most once.
 *
 * @returns the ticket `_id` that was upgraded, or `null` when nothing matched —
 *          which is the ordinary outcome and never an error.
 */
export async function upgradeTicketCategoryOnSlip(
  input: TicketCategoryUpgradeInput,
  deps: TicketCategoryUpgradeDeps,
): Promise<unknown | null> {
  const { channelUserId, hookId } = input;
  if (!channelUserId || !hookId) return null;

  try {
    /* ⚠️ THE ID TRAP, read off live rows — these look alike and are NOT the same:
         the LINE id           `Ubd88e2612…`   ← what the webhook holds
         the member `_id`      `6a6de682…33d`  ← what tickets.chat_user_id holds
                                                 and what chat_rooms.user_id holds
       Matching a ticket on the LINE id finds nothing and fails SILENTLY, so the
       member is resolved first, exactly as `payment-ticket.helper.ts` does.
       ห้ามเอา LINE id ไป match ticket ตรง ๆ. */
    const member = await deps.memberModel
      .findOne({
        $or: [
          { member_user_id: channelUserId },
          { line_user_id: channelUserId },
        ],
      })
      .select('_id')
      .lean<{ _id?: unknown } | null>()
      .exec();
    if (!member?._id) return null;

    /* CONDITION 2 — the room must still be waiting for a human. Read before the
       ticket write because it lives on a different collection and cannot be
       folded into the same atomic filter. A room that gets claimed between this
       read and the write is harmless: the ticket's own `job_status` would still
       be 0 for that instant, and the label is right either way. */
    const room = await deps.chatRoomModel
      .findOne({ user_id: member._id, hook_id: hookId as never })
      .select('assist_status')
      .lean<{ assist_status?: boolean } | null>()
      .exec();
    if (room?.assist_status !== true) return null;

    /* CONDITIONS 1, 3 and the latch — one atomic operation.
       `sort` picks the NEWEST matching ticket: a room can hold several over
       time, and the one this slip belongs to is the current one. */
    const upgraded = await deps.ticketModel
      .findOneAndUpdate(
        {
          chat_user_id: member._id,
          hook_id: hookId as never,
          category: FROM_CATEGORY,
          job_status: JOB_STATUS_OPEN,
          category_upgraded_at: null,
        },
        { $set: { category: TO_CATEGORY, category_upgraded_at: new Date() } },
        { sort: { created_at: -1 }, new: true },
      )
      .select('_id')
      .lean<{ _id?: unknown } | null>()
      .exec();

    if (!upgraded?._id) return null;

    deps.log(
      `[CATUPGRADE] ticket ${String(upgraded._id)} ${FROM_CATEGORY} → ${TO_CATEGORY} ` +
        `(slip received while the room was unclaimed)`,
    );

    /* [FEAT-20260815-CATUPGRADEWS] relabel the card in place, no refresh.
       Same shape as the `ticket:new` payload in `payment-ticket.helper.ts:228`,
       so the FE patch path receives the fields it already knows. Wrapped
       because the publisher is injected and a caller's implementation could
       throw before reaching the service (which swallows its own errors). */
    try {
      deps.publishTicketUpdated?.({
        _id: String(upgraded._id),
        hook_id: String(hookId),
        line_oa_hook_id: String(hookId),
        line_user_id: member._id,
        category: TO_CATEGORY,
      });
    } catch (pubErr) {
      deps.warn(
        `[CATUPGRADE] realtime publish failed: ${(pubErr as Error)?.message}`,
      );
    }

    /* [FEAT-20260815-CATUPGRADELOG] the durable half of that line.
       `persistWebhookLog` swallows its own errors, and the `await` is inside the
       outer try, so neither a slow nor a failing log write can affect the
       upgrade that already happened above. */
    if (deps.persistWebhookLog) {
      await deps.persistWebhookLog({
        ...(input.logContext ?? {}),
        channel: 'system',
        action_type: 'ticket_category_upgrade',
        method: 'INTERNAL',
        // No endpoint: nothing was called. `status: 'success'` because the
        // upgrade DID happen — a no-op never reaches this line at all.
        status: 'success',
        payload_summary: {
          ticket_id: String(upgraded._id),
          from: FROM_CATEGORY,
          to: TO_CATEGORY,
          reason: 'slip received while the room was unclaimed',
          member_id: String(member._id),
          ...(input.slipRecordId
            ? { slip_record_id: String(input.slipRecordId) }
            : {}),
        },
      });
    }

    return upgraded._id;
  } catch (err) {
    // A label must never be able to fail a slip.
    deps.warn(
      `[CATUPGRADE] could not upgrade the ticket category: ${
        (err as Error)?.message ?? 'unknown'
      }`,
    );
    return null;
  }
}
