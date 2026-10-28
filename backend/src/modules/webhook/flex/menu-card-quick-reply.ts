/**
 * [FEAT-20260831-MENUSLIPQR] Which stored card ships which quick reply.
 * ===========================================================================
 * A LOOKUP TABLE, not an `if`. The owner asked for this to be changeable and
 * extendable — a second card, or a different picker on this one, is a row here
 * and nothing else moves. เผื่อเปลี่ยนเงื่อนไข/เพิ่มได้.
 *
 * ── WHY A QUICK REPLY AND NOT A BUTTON ──────────────────────────────────────
 * Proven 31/08 by asking LINE itself (`POST /v2/bot/message/validate/push`,
 * which validates without sending):
 *
 *     the card with a `cameraRoll` BUTTON   → 400
 *       {"details":[{"message":"{0} action is not available for flex message"}]}
 *     the same card without it              → 200
 *
 * `cameraRoll` is a quick-reply action. Inside a flex button LINE refuses the
 * WHOLE message, so `sub-slip-request` could never be delivered: the dashboard
 * showed the card and the phone never received it. The picker belongs on the
 * message, which is exactly what this table puts it on.
 *
 * ── WHAT IT MUST NOT DO ─────────────────────────────────────────────────────
 * ⚠️ IT DOES NOT TOUCH THE SLIP PATH. `SLIP_QUICK_REPLY` is the slip flow's own
 *    picker and keeps every one of its existing uses; this file only READS it.
 *    It is `as const`, and nothing here copies or mutates it — so the day the
 *    owner changes that button, both places change together. Owner: ห้ามกระทบ
 *    quick reply เส้นสลิป.
 * ⚠️ A slug that is not listed gets NOTHING — no key on the message at all, so
 *    every other card is byte-identical to before this file existed.
 *
 * revert: delete this file and the `quickReplyFor` line at the menu seat.
 */
import { SLIP_QUICK_REPLY } from '../slip-flex/slip-flex.handler';

/**
 * `flex_slug` → the quick reply sent with that card.
 *
 * Add a row to extend. The value is handed to LINE verbatim, so it must be a
 * real `quickReply` object (`{ items: [...] }`), and reusing a constant that
 * already exists is preferred over writing a new literal — one spelling of a
 * button means one place to change it.
 */
export const MENU_CARD_QUICK_REPLIES: Readonly<Record<string, unknown>> = {
  'sub-slip-request': SLIP_QUICK_REPLY,
};

/**
 * The quick reply for a stored card, or `undefined` when it has none.
 *
 * Trims and lower-cases so an operator's stray capital or space cannot silently
 * cost the picker — a slug is operator-typed, and `normalizeFlexSlug` is not
 * guaranteed to have run on a row written before it existed.
 */
export function quickReplyForCardSlug(slug: unknown): unknown | undefined {
  if (typeof slug !== 'string') return undefined;
  const key = slug.trim().toLowerCase();
  return key ? MENU_CARD_QUICK_REPLIES[key] : undefined;
}
