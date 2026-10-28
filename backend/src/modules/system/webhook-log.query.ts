import { Types } from 'mongoose';
import { isSuperRoleName } from '@/common';

/**
 * Query-shaping helpers shared by the webhook-log list and stats services.
 *
 * They live outside both services because the two endpoints must scope and
 * filter identically — a caller who cannot see a log in the list must not see
 * it counted in the chart either. Keeping one copy is what makes that true by
 * construction rather than by review.
 */

export interface StatsRow {
  type: 'webhooklog';
  date?: string;
  count_success: number;
  count_failed: number;
}

/** Re-exported from the shared predicate so this module has one definition. */
export const isSuperUser = isSuperRoleName;

/** Clamped to 1..100, defaulting to 20 — junk coerces rather than erroring. */
export const sanitizePagination = (
  page?: string,
  limit?: string,
): { sanitizedPage: number; sanitizedLimit: number } => {
  const parsedLimit = parseInt(String(limit ?? ''), 10);
  const parsedPage = parseInt(String(page ?? ''), 10);
  return {
    sanitizedLimit: Math.min(
      Math.max(Number.isNaN(parsedLimit) ? 20 : parsedLimit || 20, 1),
      100,
    ),
    sanitizedPage: Math.max(Number.isNaN(parsedPage) ? 1 : parsedPage || 1, 1),
  };
};

/** An unparsable bound is ignored rather than rejected, matching legacy. */
export const buildDateFilter = (
  from?: string,
  to?: string,
): Record<string, Date> | null => {
  const dateFilter: Record<string, Date> = {};
  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime())) dateFilter['$gte'] = fromDate;
  }
  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime())) dateFilter['$lte'] = toDate;
  }
  return Object.keys(dateFilter).length > 0 ? dateFilter : null;
};

export const summarize = (
  rows: StatsRow[],
): { count_success: number; count_failed: number } =>
  rows.reduce(
    (acc, item) => ({
      count_success: acc.count_success + (item.count_success || 0),
      count_failed: acc.count_failed + (item.count_failed || 0),
    }),
    { count_success: 0, count_failed: 0 },
  );

export const toObjectIds = (ids: string[]): Types.ObjectId[] =>
  ids
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
