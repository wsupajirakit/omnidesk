/**
 * [FEAT-20260824-BCASTTAGPRE] 🔴 THE ONE THING THAT WOULD HAVE SENT A CAMPAIGN
 * TO THE WHOLE OA. Do not delete this without deleting the prefilter with it.
 * ===========================================================================
 * A pre-resolved rule is the FIRST audience source whose clause is keyed on
 * `_id`. That collides with the recipient pager's keyset cursor:
 *
 *     recipient.pager.ts:70-77
 *       export function withCursor(filter, point, toCursor) {
 *         if (point.afterId === null) return { ...filter };
 *         return { ...filter, _id: { $gt: toCursor(point.afterId) } };   ← here
 *       }
 *
 * The spread OVERWRITES any `_id` the audience filter already carried. So a
 * campaign whose ONLY condition is a customer tag builds `{_id: {$in: […]}}`,
 * page 1 is correct, and from page 2 onward the `$in` is simply GONE — the pager
 * walks every remaining member of the collection and the campaign reaches the
 * entire OA. Page 1 being right is what makes it invisible in a small test:
 * it only appears once the audience is larger than one page.
 * หน้าแรกถูก หน้าสองหลุดทั้ง OA — เจอยากมากถ้าข้อมูลน้อย.
 *
 * ⚠️ THE FIX IS ONE LEVEL OF NESTING, NOT AN EDIT TO THE PAGER.
 *    `{$and: [<filter>]}` has no top-level `_id`, so `withCursor` ADDS its
 *    cursor beside the `$and` instead of replacing anything, and Mongo's
 *    implicit AND between the two means exactly what it should. The pager
 *    belongs to another lane and stays untouched, which also keeps this feature
 *    deletable as a folder. แก้ที่ฝั่งเรา ไม่ไปยุ่ง pager.
 *
 * 🔑 IDENTITY IN, IDENTITY OUT when there is nothing to fix. Today no registry
 *    source has `path: '_id'` except the pre-resolved ones, so a campaign with
 *    no tag rule gets the SAME OBJECT back — byte-identical behaviour, asserted
 *    with `toBe` (reference equality) in the spec, not merely `toEqual`.
 *
 * MEASURED ON REAL ROWS — lane db `boardcast_lane_24aug`, 25 members, explain
 * executionStats, 2026-08-24. Three real member ids stood in for a resolved
 * tag, and the cursor was set to the first of them:
 *
 *     page 1  wrapped                      nReturned  3   keys 4   IXSCAN _id_
 *     page 2  wrapped + cursor             nReturned  2   keys 3   IXSCAN _id_
 *     page 2  UNWRAPPED + cursor  🔴       nReturned 24   keys 24  IXSCAN _id_
 *
 * 24 of the 25 members — the entire rest of the collection — from a campaign
 * that named three people. That is the bug, on real data. The wrap costs
 * nothing: same index, one fewer key examined.
 * ห่อแล้วยังใช้ index เหมือนเดิม · ไม่ห่อ = หน้าสองได้ทั้ง collection.
 *
 * revert: delete this file with the rest of `prefilter/`.
 */

/**
 * Make a filter safe to hand to a keyset pager that owns `_id`.
 *
 * Returns the SAME reference when the filter has no top-level `_id`.
 */
export function keysetSafeFilter(
  filter: Record<string, unknown>,
): Record<string, unknown> {
  if (filter === null || typeof filter !== 'object') return filter;
  // `in` and not `filter._id !== undefined`: a filter that explicitly carries
  // `_id: undefined` is still a key the spread would overwrite.
  if (!('_id' in filter)) return filter;
  return { $and: [filter] };
}
