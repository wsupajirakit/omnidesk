/**
 * Profile & Data timestamping utilities.
 * Ported from legacy rawDataStamp.js.
 */

export function hasContent(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  if (typeof data === 'string') return data.trim() !== '';
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === 'object') return Object.keys(data).length > 0;
  return true;
}

/** Type predicate, so callers can reach `block.data` without re-checking null. */
export function isFetchOk<
  T extends { success?: boolean; status?: number; data?: unknown },
>(block: T | null | undefined): block is T {
  if (!block) return false;
  return (
    block.success === true && block.status === 200 && hasContent(block.data)
  );
}

export function stampNow(): Date {
  return new Date();
}

export function withStamp(
  $set: Record<string, unknown>,
  field: string,
  atField: string,
  data: unknown,
  at?: Date | string | null,
): Record<string, unknown> {
  $set[field] = data;
  const t = at ? new Date(at) : null;
  $set[atField] = t && Number.isFinite(t.getTime()) ? t : stampNow();
  return $set;
}

export const SITE_RULES_TTL_MS = 30 * 60 * 1000; // 30 mins

export function isFresh(
  at: Date | string | null | undefined,
  ttlMs = SITE_RULES_TTL_MS,
): boolean {
  if (!at) return false;
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (!Number.isFinite(t)) return false;
  const age = Date.now() - t;
  if (age < 0) return false;
  return age < ttlMs;
}
