import { Types } from 'mongoose';

/**
 * [PROG-20260905-STEP0] Two total, pure helpers lifted out of `webhook.service.ts`.
 *
 * WHY THEY MOVED, AND WHY THEY MOVED FIRST. The spine reduction program extracts bodies
 * out of `processLockedEvent` into role directories. Almost every candidate block calls
 * one of these two, and they were module-PRIVATE (`function`, not `export function`) —
 * so a handler in a new file could not reach them, and exporting them FROM
 * `webhook.service.ts` into a file the service then imports is a cycle. Relocating them
 * is the prerequisite that makes each later extraction a move rather than a rewrite.
 *
 * WHY `logging/`. Both exist for log lines and log rows: `maskToken` is the mask used in
 * every log line and log row, and `asString` was written so the forty places that
 * interpolate ObjectIds and numbers into log text coerce them the same way. They belong
 * with the logging door, not at the module root.
 *
 * BEHAVIOUR IS BYTE-FOR-BYTE THE SAME. Both bodies are the originals, unedited; only
 * `export` was added. Proven by the 22 golden effect transcripts
 * (`z-test/fixtures/spine-transcripts/`) staying identical across this change — masks and
 * coerced ids appear inside those recorded arguments, so a drift here would show there.
 */

/** legacy:55 — the mask used in every log line and log row. */
export function maskToken(
  token: string | null | undefined,
): string | undefined {
  if (!token) return undefined;
  const trimmed = String(token).trim();
  if (trimmed.length <= 4) return trimmed;
  return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
}

/**
 * `String(x)` as JS performs it, spelled out.
 *
 * Legacy interpolates ObjectIds, numbers and undefined into the same template
 * without checking any of them. TypeScript types those reads as `unknown`, so
 * the coercion is written once here rather than cast at forty call sites.
 */
export function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Types.ObjectId) return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && 'toString' in value) {
    return (value as { toString(): string }).toString();
  }
  return JSON.stringify(value) ?? '';
}

/**
 * [PROG-20260905-G25] "วันอังคารที่ 05 สิงหาคม 69 14:03:21" — legacy:177.
 *
 * Moved out of the spine when the assist-bypass gate needed it: a handler in a role
 * directory cannot call a module-private function, and exporting it FROM the service into
 * a file the service imports would be a cycle. Same reason `maskToken` and `asString`
 * moved at step zero; it stayed behind then because nothing outside the spine needed it,
 * and that stopped being true.
 *
 * Total: an unparseable input returns the input as a string rather than throwing, because
 * every caller is a log line or a card, and neither may fail over a date.
 */
export function formatThaiDateTime(
  dateInput?: Date | string | number | null,
): string {
  const now = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(now.getTime())) return String(dateInput ?? '');
  const tz = { timeZone: 'Asia/Bangkok' } as const;
  const weekday = now.toLocaleDateString('th-TH', { weekday: 'long', ...tz });
  const day = now.toLocaleDateString('th-TH', { day: '2-digit', ...tz });
  const month = now.toLocaleDateString('th-TH', { month: 'long', ...tz });
  const yearBE = (
    Number(now.toLocaleString('en-US', { year: 'numeric', ...tz })) + 543
  )
    .toString()
    .slice(-2);
  const timeStr = now.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...tz,
  });
  return `${weekday}ที่ ${day} ${month} ${yearBE} ${timeStr}`;
}

/**
 * [PROG-20260905-ERRTEXT] The message out of an unknown throw. One copy, module-wide.
 *
 * WHY IT IS HERE AND NOT IN TWELVE PLACES. It WAS in twelve places — the service plus
 * eleven role files — and ten of those copies were created by this reduction program
 * itself: a role file cannot call a module-private helper and importing back from the
 * service is a cycle, so every extraction carried the two lines along. Byte-identical,
 * all twelve, verified before they were removed. That is the failure the owner named —
 * *"ย้ายไปก็ไม่มีความหมาย ไปบวมที่ใหม่"* — and the same shape as `buildRoomFilter`, which had
 * grown four copies for the same reason.
 *
 * ⚠️ IT BELONGS WITH THE OTHER COERCIONS, not in a `utils/` drawer. Every caller is a log
 * line or a log row: this answers "what do I print when something threw", exactly as
 * `asString` answers "what do I print for an id" and `maskToken` answers "what do I print
 * for a key". The three are one job.
 *
 * ⚠️ TOTAL, and that is the point. A non-Error throw — a string, a rejected axios object,
 * `undefined` — still produces a message rather than throwing again inside the catch that
 * was supposed to report it.
 */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
