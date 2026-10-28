/**
 * [FEAT-20260831-ADMINVIAWITHDRAW] "เส้น withdraw" — which notice cases the
 * withdraw-side door screens, and in what order.
 * ===========================================================================
 * The owner's rule for `{{paylink.contact_admin_via_withdraw}}`: before a
 * customer reaches an admin, walk the WITHDRAW notice conditions in the order
 * they are configured; the first one that fires sends its card and ends there,
 * exactly like an ordinary notice. Nothing fires ⇒ the customer goes to the
 * admin as before.
 *
 * ── 🔴 DERIVED, NEVER RE-LISTED ─────────────────────────────────────────────
 * The lane is a FILTER over `NOTICE_CASE_ORDER`, so:
 *   · precedence still lives in exactly one array — reorder it there and this
 *     door reorders with it;
 *   · a withdraw case added later joins this door automatically;
 *   · there is no second list to forget to update.
 * A copied list is the debt this file exists to avoid. ลำดับอยู่ที่เดียว.
 *
 * ── ⭐ HOW TO CHANGE WHAT COUNTS AS THE LANE ────────────────────────────────
 * Owner 31/08: *ทำเผื่อไว้เปลี่ยนเงื่อนไข เพิ่ม ลด ได้*. Edit ONE array below:
 *
 *   · today          `[NOTICE_WITHDRAW_AT_KEY]`  → cases C and D
 *   · to include the whole-site cases E and F (นอกเวลาทั้งเว็บ / ปิดทั้งเว็บ),
 *     add `NOTICE_PAYMENT_AT_KEY` — they stamp that key, not the withdraw one
 *   · to narrow it again, remove a key
 *
 * They are DELIBERATELY excluded today (owner's call, 31/08): "เส้น withdraw"
 * means the withdraw cases, so a site-wide outage still sends the customer to an
 * admin rather than answering a withdrawal question with a whole-site card. The
 * decision is recorded here rather than in a commit message because this is the
 * line someone will come looking for when they want to change it.
 *
 * ⚠️ WHY `stampKey` AND NOT `caseId`: the stamp key IS the lane — it is what the
 * cooldown reads and what the fallback walk refuses to cross (see the guard).
 * Matching on `caseId` would be matching on a label; matching on the stamp
 * matches on the behaviour.
 *
 * revert: delete this file and the branch that calls it in webhook.service.ts.
 */
import { NOTICE_CASE_ORDER, type NoticeCase } from './cases';
import { NOTICE_WITHDRAW_AT_KEY } from './notice.keys';

/**
 * ⭐ THE ONE PLACE TO CHANGE THE LANE. Add or remove a stamp key.
 * `NOTICE_PAYMENT_AT_KEY` would pull in E/F (the whole-site cases).
 */
export const WITHDRAW_LANE_STAMP_KEYS: readonly string[] = [
  NOTICE_WITHDRAW_AT_KEY,
];

/**
 * The withdraw cases, in `NOTICE_CASE_ORDER`'s order — today `[C, D]`.
 *
 * `filter` preserves array order, which is the whole point: this is a VIEW of
 * the one ordered list, not a second one.
 */
export const WITHDRAW_CASE_ORDER: readonly NoticeCase[] =
  NOTICE_CASE_ORDER.filter((c) =>
    WITHDRAW_LANE_STAMP_KEYS.includes(c.stampKey),
  );
