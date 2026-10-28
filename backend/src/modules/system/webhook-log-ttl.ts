/**
 * [FEAT-20260821-WLOGTTLDRIFT] The ONE number for webhook_logs retention, and the
 * check that tells you when a live database disagrees with it.
 *
 * WHY THIS EXISTS: Mongo refuses to change `expireAfterSeconds` on an existing
 * index and Mongoose's ensureIndex silently keeps the old one — so editing the
 * schema changes nothing on a database that already has the index. On 21/08 the
 * schema said 45 days while the local database still expired at 30, and nothing
 * had said so for six days. Every environment that predates the change has the
 * same gap until `dist/cli/set-log-retention.js --yes` is run against it.
 *
 * The check is READ-ONLY (listIndexes) and logs; it never creates, drops or
 * alters an index — retention changes stay a deliberate CLI step with a count.
 * โค้ดบอกเจตนา · DB บอกความจริง · ตัวนี้บอกตอนที่สองอย่างไม่ตรงกัน.
 */

export const WEBHOOK_LOG_TTL_DAYS = 45;
export const WEBHOOK_LOG_TTL_SECONDS = WEBHOOK_LOG_TTL_DAYS * 86_400; // 3_888_000
export const WEBHOOK_LOG_TTL_INDEX_NAME = `created_at_ttl${WEBHOOK_LOG_TTL_DAYS}`;

export interface IndexInfo {
  name?: string;
  key?: Record<string, unknown>;
  expireAfterSeconds?: number;
}

/**
 * null = the live index matches the code; otherwise a one-line, human-readable
 * description of the drift, ready for a log line and the CLI to run.
 */
export function webhookLogTtlDrift(indexes: IndexInfo[]): string | null {
  const ttl = indexes.find(
    (i) =>
      i.key &&
      Object.keys(i.key).join(',') === 'created_at' &&
      i.expireAfterSeconds !== undefined,
  );
  if (!ttl) {
    return `webhook_logs has NO TTL index on created_at — code expects ${WEBHOOK_LOG_TTL_DAYS} days (${WEBHOOK_LOG_TTL_INDEX_NAME}). Run: node dist/cli/set-log-retention.js --yes`;
  }
  const days = (ttl.expireAfterSeconds ?? 0) / 86_400;
  if (ttl.expireAfterSeconds !== WEBHOOK_LOG_TTL_SECONDS) {
    return `webhook_logs TTL drift: database expires at ${days} days (index "${ttl.name ?? '?'}"), code says ${WEBHOOK_LOG_TTL_DAYS}. Run: node dist/cli/set-log-retention.js --yes`;
  }
  if (ttl.name !== WEBHOOK_LOG_TTL_INDEX_NAME) {
    // same seconds, wrong name — the trap the schema comment warns about
    return `webhook_logs TTL index is named "${ttl.name ?? '?'}" but holds ${days} days; expected "${WEBHOOK_LOG_TTL_INDEX_NAME}". Run: node dist/cli/set-log-retention.js --yes`;
  }
  return null;
}
