import { showsNewGlow } from './groupTabGlow';

/**
 * [FEAT-20260903-TABNAMEGLOW] should this group's NAME be tinted?
 * ===========================================================================
 * Owner 03/09: a new message arriving in a group's กำลังคุย channel lit NOTHING
 * on the parent group tab. It should tint that group's NAME in the same colour
 * the badge uses when something arrives.
 *
 * 🔴 WHY THE NAME AND NOT THE BADGE — the badge number is not about messages.
 *    `c` counts รอรับเคส only (`job_status === 0`, `TicketChat.tsx:3242`), so a
 *    conversation already being handled (`job_status === 1`) contributes nothing
 *    to it, and `showsNewGlow` refuses to paint while that number is 0. That is
 *    precisely why a message into กำลังคุย with an empty queue showed no mark at
 *    all. The name is a second, separate signal that does not have to lie about
 *    a count. ⇒ เลข badge อิงรอรับเคส ไม่ใช่ข้อความ — ห้ามยุ่งกับเลข.
 *
 * 🔴 NOTHING HERE TOUCHES THE BADGE. The count, the badge's classes and
 *    `showsNewGlow`'s three call sites in `TicketChat.tsx` are left exactly as
 *    they are. This module only ever answers a question about the name.
 *
 * ⚠️ IT RAISES NO FLAG OF ITS OWN. The input is the EXISTING `groupHasNew`,
 *    already set by the realtime handler (`[FEAT-20260820-MSGGLOW]`,
 *    `TicketChat.tsx:2187-2192`) and already cleared by `selectGroup`. No socket
 *    handler, no timer, no new state ⇒ realtime is untouched.
 *    ไม่แตะ realtime เลย ใช้ธงเดิมที่มีอยู่แล้ว.
 *
 * ⚠️ IT CALLS `showsNewGlow` RATHER THAN RESTATING IT, and that is load-bearing
 *    for two reasons:
 *      1. the "is the badge already orange" rule stays in ONE place, so the two
 *         cannot drift — the same reason `groupTabGlow.ts` exists at all;
 *      2. `groupTabOrangeNeedsCount.value.test.ts:71` pins `showsNewGlow(` to
 *         EXACTLY three occurrences in `TicketChat.tsx`. Taking the count here
 *         instead of a pre-computed boolean keeps every call site in that file
 *         byte-identical, so the existing guard still guards what it was written
 *         to guard.
 *
 * revert: delete this file, the `nameGlow` const + the span around
 *   `{g.group_name}`, and the two glow props in `SearchableSelect`. The badge
 *   behaves identically with or without any of it.
 */

/**
 * `true` when the group has something new AND the badge is NOT already orange.
 *
 * Takes the SAME two arguments the badge rule takes, so both answers are derived
 * from one pair of inputs. When the badge is already lit there is nothing left to
 * announce, and tinting the name too would double up on a single event — the name
 * speaks only while the badge stays silent.
 */
export function showsNameGlow(hasNew: boolean, count: unknown): boolean {
  if (!hasNew) return false;
  return !showsNewGlow(hasNew, count);
}
