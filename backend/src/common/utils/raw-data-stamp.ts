export const SITE_RULES_TTL_MS = 30 * 60 * 1000; // 30 mins

export function hasContent(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  if (typeof data === 'string') return data.trim() !== '';
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === 'object') return Object.keys(data).length > 0;
  return true;
}

export interface FetchResultBlock {
  success?: boolean;
  status?: number;
  data?: unknown;
}

export function isFetchOk(block: FetchResultBlock | null | undefined): boolean {
  if (!block) return false;
  return (
    block.success === true && block.status === 200 && hasContent(block.data)
  );
}

export function stampNow(): Date {
  return new Date();
}

export function withStamp<T extends Record<string, unknown>>(
  $set: T,
  field: string,
  atField: string,
  data: unknown,
  at?: Date | string | number | null,
): T {
  $set[field as keyof T] = data as T[keyof T];
  const t = at ? new Date(at) : null;
  $set[atField as keyof T] = (
    t && Number.isFinite(t.getTime()) ? t : stampNow()
  ) as T[keyof T];
  return $set;
}

export function isFresh(
  at: Date | string | number | null | undefined,
  ttlMs = SITE_RULES_TTL_MS,
): boolean {
  if (!at) return false;
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (!Number.isFinite(t)) return false;
  const age = Date.now() - t;
  if (age < 0) return false;
  return age < ttlMs;
}
