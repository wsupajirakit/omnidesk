/**
 * What a case opened by the SYSTEM looks like. Values only — no logic, no imports.
 * ===========================================================================
 * A case an admin opens is a case they have taken: assigned to them, in their
 * hands, `job_status: 1`. A case the system opens is nobody's yet — it belongs
 * in the queue, waiting, with no owner. Those are the only four values that
 * differ between the two, and they are here rather than inline so the difference
 * is readable in one place and changeable without opening the flow.
 * สร้างเคสเฉย ๆ ยังไม่มีคนรับ · ต่างจากเคสที่แอดมินกดแค่สี่ค่านี้.
 *
 * ⚠️ `assign_to` and `changed_by_id` are deliberately left null in the history
 * row. The schema declares both `default: null` and says so itself — "`null`
 * records an unassignment" — so a system-opened case needs no invented user.
 * ไม่ต้องปลอม user id.
 *
 * revert: delete this file and the `actor` branch that reads it.
 */

/** Waiting to be picked up — the same queue an unassigned case sits in. */
export const SYSTEM_CASE_JOB_STATUS = 0;

/** The bot is still the one in the room; no admin has taken over. */
export const SYSTEM_CASE_CHAT_STATUS = 'bot';

/** Marks the case as opened by a rule rather than by a person. */
export const SYSTEM_CASE_DIRECT_TICKET = true;

/** Divider variant + history action for a system-opened case. */
export const SYSTEM_CASE_DIVIDER_VARIANT = 'direct_ticket';
export const SYSTEM_CASE_HISTORY_ACTION = 'open_by_system';
