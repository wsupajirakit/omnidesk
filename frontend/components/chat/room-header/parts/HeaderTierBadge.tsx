/**
 * [FEAT-20260905-CUSTPROV PART 5] The 💎 tier badge in the chat-room header.
 * ============================================================================
 * WHAT: the purple `💎 Normal 0` pill on the header's second row, and the two
 *       conditions that decide whether it is drawn at all.
 *
 * WHY:  it is one of the two badge SITES the tier switch governs, and it is the
 *       only piece of the bar that PART 4's `showTierBadge` can remove. Pulling
 *       it into its own component makes that gate a single readable line in
 *       `RoomHeader.tsx` instead of a condition buried in 250 lines of JSX.
 *
 * 🔴 BOTH SITES OR NEITHER — [FIX-20260810-TIERSOURCE]. This header badge and
 *    the ticket-CARD badge in `pages/chat/TicketChat.tsx` read the SAME flag
 *    from the SAME ticket-list response. They once disagreed for a real
 *    customer, and a caller that gates its card but forgets to pass
 *    `showTierBadge` down to the room header recreates that bug in a new
 *    costume. `test/tierSwitch.dom.test.tsx` guards both sites; this file's own
 *    gate is guarded by `test/roomHeaderCharacterization.dom.test.tsx` §4.
 *    สองที่ต้องตรงกันเสมอ — ที่เดียวเปลี่ยน = บั๊กเดิมกลับมา
 *
 * ⚠️ THE GATE ORDER IS CARRIED VERBATIM: `tier && show`. A tier-less member
 *    shows nothing regardless of the flag — that is pre-existing behaviour and
 *    has nothing to do with this switch.
 *
 * The text itself comes from `tierBadgeText` (`utils/memberTier`), which is
 * where "Normal" + level 0 becomes `Normal 0`. Level 0 is falsy but NOT absent,
 * and that function already handles it; do not add a truthiness check here.
 *
 * revert: delete this file and paste the `{headerTier && showTierBadge && (…)}`
 *         block back into `RoomHeader.tsx` at the mount site.
 */
import React from 'react';
import { tierBadgeText, type MemberTier } from '../../../../utils/memberTier';

interface HeaderTierBadgeProps {
  /** The member's tier as `tierOfMember()` resolved it — null when there is none. */
  tier: MemberTier;
  /** PART 4's `showTierBadge`. Already defaulted to `true` by the caller. */
  show: boolean;
}

export const HeaderTierBadge: React.FC<HeaderTierBadgeProps> = ({ tier, show }) => {
  /* [FEAT-2708-TIERFIRST] ป้ายเทียร์ — เจ้าของสั่ง 27/08 (งาน 5.6):
     ย้ายมาหน้าสุด ก่อนโลโก้ LINE · เนื้อป้ายเดิมทุกอย่าง
     revert: ย้ายบล็อกนี้กลับไปท้ายแถว (หลังเกจโควตา) */
  /* [FEAT-20260905-CUSTPROV PART 4] `showTierBadge` — the OTHER
     of the two badge sites; TicketChat.tsx's ticket-card badge
     is the first. Both read the SAME flag from the SAME
     ticket-list response ([FIX-20260810-TIERSOURCE] rule:
     both sites or neither). */
  if (!tier || !show) return null;
  return (
    <span className="panel-badge panel-badge-purple inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 shrink-0">
      💎 {tierBadgeText(tier)}
    </span>
  );
};
