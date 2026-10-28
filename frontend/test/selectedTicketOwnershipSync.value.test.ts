/**
 * [FIX-20260829-SELECTEDSTATUSSYNC] the footer must follow who holds the case
 * ===========================================================================
 * Reported 29/08: another admin accepted the open case, the transcript showed
 * "รับเคส โดย …", and the bar underneath still offered "กดรับเคสเพื่อสนทนา"
 * instead of the held-by banner with "รับเคสต่อ".
 *
 * 🔴 A SYNC ALREADY EXISTED AND CARRIED TWO FIELDS TOO FEW.
 *    `[FIX-20260823-CLAIMCAS]` copies `admin_user_id` + `admin_user_data` from the
 *    refreshed list row onto `selectedTicket` — but NOT `job_status`. The footer
 *    is gated on `selectedJobStatus === 1 && !isMyCase`, so with the status still
 *    reading 0 the held-by banner could never appear, no matter how correct the
 *    owner fields were. The 23/08 fix corrected the NAME shown in a banner that
 *    was not being shown.
 *
 * 🔴 IT ALSO ONLY WOKE ON AN OWNER CHANGE. Guarding on `admin_user_id` alone
 *    means a row whose status moved while the owner string stayed equal is
 *    skipped — so the guard has to ask about both fields it now copies.
 *
 * ⚠️ REALTIME UNTOUCHED, DELIBERATELY. No socket handler, no fetch, no debounce
 *    and no new state: the same effect that already reconciled the open card
 *    against `activeTickets` simply carries one more field. `usePartialTicketFetch`
 *    keeps its single job of writing `setActiveTickets`.
 * ⚠️ STILL A PATCH, NEVER A WHOLE-ROW OVERWRITE — `selectedTicket` holds values
 *    the screen itself wrote (customer_tags), and replacing the row drops them.
 * ⚠️ Returning `null` when nothing moved is what keeps the effect from writing
 *    state on every list tick and re-rendering the chat for nothing.
 *
 * revert: drop `job_status` from `ownershipPatch` and delete this spec.
 */
import { describe, expect, it } from 'vitest';

import { ownershipPatch } from '../utils/selectedTicketSync';

const prev = { _id: 't1', job_status: 0, admin_user_id: '', admin_user_data: null, customer_tags: ['vip'] };

describe('[SELECTEDSTATUSSYNC] the open card follows the list row', () => {
  it('⭐⭐ 🔴 another admin accepted ⇒ the status comes across, not just the name', () => {
    const patch = ownershipPatch(prev, { _id: 't1', job_status: 1, admin_user_id: 'u9', admin_user_data: { username: 'cs_02' } });
    expect(patch).not.toBeNull();
    expect(patch!.job_status).toBe(1);
    expect(patch!.admin_user_id).toBe('u9');
  });

  it('⭐⭐ 🔴 status moved but the owner string did not ⇒ still syncs', () => {
    /* The old guard compared the owner alone and returned early here, which is
       the second half of the same bug. */
    const patch = ownershipPatch(prev, { _id: 't1', job_status: 1, admin_user_id: '', admin_user_data: null });
    expect(patch).not.toBeNull();
    expect(patch!.job_status).toBe(1);
  });

  it('⭐⭐ 🔴 nothing moved ⇒ null, so the effect writes no state', () => {
    expect(ownershipPatch(prev, { _id: 't1', job_status: 0, admin_user_id: '', admin_user_data: null })).toBeNull();
  });

  it('⭐⭐ what the screen owns is never in the patch', () => {
    /* `customer_tags` is written by the page itself; a whole-row copy would
       silently revert it, which is why this is a patch of named fields. */
    const patch = ownershipPatch(prev, { _id: 't1', job_status: 1, admin_user_id: 'u9', admin_user_data: null, customer_tags: [] });
    expect(Object.keys(patch!).sort()).toEqual(['admin_user_data', 'admin_user_id', 'job_status']);
  });

  it('⭐ a different row is never applied to the open card', () => {
    expect(ownershipPatch(prev, { _id: 'OTHER', job_status: 1, admin_user_id: 'u9', admin_user_data: null })).toBeNull();
  });

  it('⭐ junk in either side never throws', () => {
    expect(ownershipPatch(null, { _id: 't1', job_status: 1 })).toBeNull();
    expect(ownershipPatch(prev, null)).toBeNull();
    expect(ownershipPatch(prev, undefined)).toBeNull();
  });
});
