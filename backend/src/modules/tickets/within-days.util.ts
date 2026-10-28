/**
 * [FEAT-20260808-TKTSCOPE] Optional FE date-scope filter for the TICKET page —
 * a NEW additive param, not a legacy parity port. (Applies to the ticket list +
 * tab counts only; assign-history is intentionally NOT scoped.)
 *
 * Maps a `within_days` query value to a `created_at >= now - N*24h` cutoff.
 * Callers apply the returned Date to the SAME `created_at` field the ticket list
 * already sorts/date-filters by, so "last N days" matches the date shown on
 * each card AND every count/aggregation scoped by the same cutoff stays coherent
 * with its list.
 *
 * Allowed set is fixed {2,3,4,5,7}. Anything outside it — omitted, empty,
 * non-numeric, or out-of-set — resolves to `null` = UNBOUNDED = today's exact
 * behaviour. Treating unknown as omitted (rather than 400) is the safer choice:
 * the "ทั้งหมด" case sends no param, and a stray value can never widen the
 * window or become an injection — it only ever falls back to unbounded. This is
 * a READ-ONLY filter: no DB writes, no schema/structure change.
 *
 * ทั้งหมด (ไม่ส่ง param) = เหมือนเดิมทุกอย่าง; ค่านอกชุด = ตกกลับเป็น unbounded.
 */
export const WITHIN_DAYS_ALLOWED: ReadonlySet<number> = new Set([
  2, 3, 4, 5, 7,
]);

export function resolveWithinDaysCutoff(
  raw: unknown,
  now: Date = new Date(),
): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || !WITHIN_DAYS_ALLOWED.has(n)) return null;
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
}
