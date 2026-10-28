/**
 * [FEAT-20260822-BCASTRETRYKEY] The idempotency key for one chunk.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock.
 *
 * 🔴 WHY THIS TINY FILE MATTERS MORE THAN IT LOOKS
 * `infra/line/push/line-push.ts:113` reads `req.retryKey ?? randomUUID()`.
 * Leave it unset and every retry — ours, a queue's, an operator's re-run —
 * gets a FRESH key, so LINE treats it as a new request and the customer is
 * messaged twice. Set it to something reproducible and LINE answers 409 for
 * an attempt that already won, which the core already counts as success
 * (`line-push.ts:174`).
 *
 * ⇒ same run + same OA + same chunk = same key, forever.
 * ⇒ this is what makes Phase 4's queue safe on the day it is plugged in.
 *
 * ⚠️ The key is only as stable as the CHUNK MEMBERSHIP. If chunk 7 holds a
 *    different set of people on a retry, the key lies. See แผน §Q.4 (snapshot
 *    the recipient list at send time) — D52.
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */

/** Keep well under LINE's documented limit; ours are far shorter than this. */
const MAX_KEY_LEN = 100;

/** Characters an id may contain. Anything else and we refuse the whole key. */
import { createHash } from 'node:crypto';

const SAFE_PART = /^[A-Za-z0-9_-]+$/;

/**
 * Validate one part of the key. Returns null when it is not usable AS GIVEN.
 *
 * 🔴 REJECT, NEVER SANITISE — this was a real bug caught in review.
 * The first version STRIPPED unsafe characters, which quietly maps different
 * ids onto one key:
 *     1.5 → "15" and 15 → "15"          (two runs, one key)
 *     "a.1" → "a1" and "a1" → "a1"
 *     "a+b/c==" → "abc"                 (any base64 id loses + / =)
 * A shared key means LINE answers 409 for the second run, the core counts 409 as a
 * success, and up to 500 people are marked delivered without being sent.
 * ⇒ a key we cannot form EXACTLY is no key at all.
 * ห้ามตัดอักขระทิ้ง — ตัดแล้วสองค่าที่ต่างกันกลายเป็นคีย์เดียว.
 *
 * Numbers must be safe integers: 1.5 and NaN and Infinity have no place in an id.
 * An ObjectId is turned into a string by the CALLER, where its type is known.
 */
function part(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return String(value);
  }
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return SAFE_PART.test(v) ? v : null;
}

/**
 * `<runId>:<hookId>:<chunkIndex>` — reproducible from values the run already has.
 *
 * Returns null when a part is missing or the index is not a whole number ≥ 0:
 * a half-formed key is worse than none, because it looks stable and is not.
 * ⇒ caller must treat null as "do not send yet", never as "send without a key".
 */
export function buildChunkRetryKey(
  runId: unknown,
  hookId: unknown,
  chunkIndex: unknown,
): string | null {
  const run = part(runId);
  const hook = part(hookId);
  if (run === null || hook === null) return null;
  if (typeof chunkIndex !== 'number') return null;
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return null;
  const logical = `${run}:${hook}:${chunkIndex}`;
  if (logical.length > MAX_KEY_LEN) return null;
  return uuidFrom(logical);
}

/**
 * 🔴 LINE REQUIRES `X-Line-Retry-Key` TO BE A UUID. FOUND BY SENDING, NOT BY
 *    READING.
 *
 * Every key this file produced used to be `run:hook:index` — readable, stable,
 * and REJECTED. The first real send to a real OA came back four times with
 * `HTTP 400 - The value for the 'X-Line-Retry-Key' parameter is invalid`, so
 * nothing this feature built could ever have delivered a message. No test
 * could have caught it: every fake sink accepted whatever we handed it, and
 * core's own default (`randomUUID()`) is a UUID, so the requirement was
 * invisible from inside the code.
 * ทดสอบด้วยของปลอมเท่าไหร่ก็ไม่เจอ — ต้องยิงจริงถึงรู้.
 *
 * ⚠️ IT MUST STILL BE DETERMINISTIC. A fresh `randomUUID()` per attempt is a
 *    valid UUID and a useless idempotency key: the retry would be a second
 *    delivery. So the logical key is HASHED into a UUID — same inputs, same
 *    UUID, forever — using the RFC 4122 v5 shape (SHA-1 over a namespace plus
 *    a name, with the version and variant bits set).
 *    ต้องได้ค่าเดิมทุกครั้ง ไม่งั้นคีย์กันซ้ำกลายเป็นตัวส่งซ้ำ.
 *
 * revert: return `logical` instead — and accept that LINE refuses every send.
 */
const RETRY_NAMESPACE = Buffer.from(
  // A fixed, arbitrary namespace for this feature. Never change it: changing
  // it changes every key, which makes every in-flight retry a new delivery.
  '6b1f0c3a9d4e4f2b8a7c5d1e3f60a2b4',
  'hex',
);

function uuidFrom(name: string): string {
  const h = createHash('sha1')
    .update(RETRY_NAMESPACE)
    .update(name, 'utf8')
    .digest();
  h[6] = ((h[6] as number) & 0x0f) | 0x50; // version 5
  h[8] = ((h[8] as number) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = h.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
