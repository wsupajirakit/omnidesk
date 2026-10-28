/**
 * [FEAT-20260824-BCASTWHYFAILED] What LINE actually answered, carried far
 * enough to reach a log a human reads.
 * ===========================================================================
 * Owner, 24/08: *"webhook_logs ไม่เก็บ HTTP status / body ที่ LINE ตอบ … 'quota หมด'
 * กับ 'token เสีย' กับ 'payload ผิด' หน้าตาเหมือนกันหมด กว่าจะรู้ต้องไล่เดาเอง"* ·
 * *"แก้ได้ไหม ห้ามกระทบ"*.
 *
 * ── THE BUG THIS REMOVES, MEASURED 24/08 ─────────────────────────────────────
 * Four campaigns failed against OA `demo-oa-three`. Every artefact said the same
 * three words:
 *
 *     webhook_logs.error_message        "run status: error"
 *     broadcasts_histories.error_message undefined
 *     response_summary                  { run_status, sent, failed, … }
 *
 * The real cause was `HTTP 429 - You have reached your monthly limit.` — LINE's
 * free tier is 300 messages a month and the OA sat at 299. Nothing anywhere
 * held that sentence, so finding it took reading the code, probing the API and
 * comparing OAs. A token that had genuinely expired would have produced a
 * BYTE-IDENTICAL row. เหตุผลจริงมีอยู่แล้ว แค่ไม่มีใครพามันมาถึง log.
 *
 * 🔴 THE STRING ALREADY EXISTS — THIS ADDS NO DECODING.
 *    `infra/line/push/line-push-error.ts#describeLineFailure` already builds
 *    `HTTP <status> - <message> (<prop: detail>) [reqId: <id>]`, and
 *    `sinks/inline.sink.ts` already returns it as `ChunkResult.error` beside
 *    `ChunkResult.status`. Both were read for exactly one purpose — deciding
 *    `sawRateLimit` from `status === 429` (`oa-executor.ts`) — and then
 *    dropped on the floor. This file is the carrier that was missing, not a
 *    new source of truth. ข้อมูลมีครบแล้ว ขาดแค่คนถือมันต่อ.
 *
 * 🔴 WHY IT CANNOT BREAK A SEND — it is written by an observer, never read by
 *    a decision. Nothing in `run-guard.ts`, the resume commit, the counters or
 *    the retry key looks at it; delete every line that fills it and the same
 *    people get the same messages in the same order. That is what makes
 *    "ห้ามกระทบ" a property of the design rather than a hope.
 *    ไม่มีใครเอาค่านี้ไปตัดสินใจ ⇒ ลบทิ้งทั้งหมด การส่งก็เหมือนเดิมเป๊ะ.
 *
 * ⚠️ FIRST FAILURE, NOT LAST, and the choice matters. An OA that starts failing
 *    keeps failing for the same reason, so the first answer is the CAUSE; the
 *    last is merely the most recent symptom. Measured on the 24/08 run: the
 *    campaign that got one message out before dying reported chunk 1 ok and
 *    chunk 2 `HTTP 429` — first-failure names the wall it hit, last-failure
 *    would have named the same thing only by luck.
 *    อันแรกคือสาเหตุ อันหลังคืออาการ.
 *
 * ⚠️ IT IS NOT A NEW COLUMN. `broadcasts_histories.error_message` has been
 *    declared in the schema since the collection existed
 *    (`schemas/broadcast-history.schema.ts:181`) and NOTHING has ever written
 *    it on this path; `webhook_logs.error_message` is likewise already written,
 *    just with a useless value. So this changes no schema, migrates no row, and
 *    every existing document still reads exactly as before.
 *    ไม่เพิ่ม field ใหม่ ไม่ต้อง migrate — ของเดิมประกาศไว้แล้วแต่ไม่มีใครเขียน.
 *
 * revert: delete this file, the `firstFailure` field on `OaRunResult` /
 * `OaOutcome`, and the two `noteFailure(...)` calls in `oa-executor.ts`. Logs
 * go back to saying "run status: error"; sending is untouched either way.
 */

/**
 * The maximum length of a reason we will store.
 *
 * ⚠️ LINE's error bodies are usually one sentence but the format is theirs, not
 * ours — a validation failure can list one entry per bad property. A log row is
 * a diagnostic, not an archive, so it is capped rather than trusted. 600 holds
 * every real LINE error measured here (the longest, a 400 with two property
 * details, was 214) with room to spare, and still cannot bloat a row.
 * ตัดความยาว เพราะ body เป็นของ LINE เราคุมไม่ได้.
 */
export const MAX_FAILURE_REASON = 600;

/**
 * One failed request, in the words the caller can act on.
 *
 * Both fields are optional because a sink is allowed to know neither: a
 * transport failure has no HTTP status, and a sink that refuses before calling
 * has no LINE sentence. `absent ≠ 0` holds here as everywhere — `status: 0`
 * is push core's word for "no HTTP happened", which is a FACT, while an absent
 * status means "nobody recorded one".
 */
export interface ChunkFailure {
  /** HTTP status LINE answered. `0` = transport failure, absent = unrecorded. */
  readonly status?: number;
  /** `HTTP 429 - You have reached your monthly limit. [reqId: …]`, capped. */
  readonly reason?: string;
}

/** Trim, cap, and drop what is empty. Returns `undefined` when nothing is known. */
export function describeChunkFailure(input: {
  readonly status?: number;
  readonly error?: string;
}): ChunkFailure | undefined {
  const status = typeof input.status === 'number' ? input.status : undefined;

  const raw = typeof input.error === 'string' ? input.error.trim() : '';
  const reason =
    raw === ''
      ? undefined
      : raw.length > MAX_FAILURE_REASON
        ? `${raw.slice(0, MAX_FAILURE_REASON)}…`
        : raw;

  /* Neither half known ⇒ no descriptor at all. Writing `{}` would put an empty
     object in a row that means "we looked and found nothing", which is not
     what happened — nothing looked. ไม่รู้อะไรเลย = ไม่ต้องเขียนอะไรเลย. */
  if (status === undefined && reason === undefined) return undefined;

  return {
    ...(status === undefined ? {} : { status }),
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * The sentence a log row shows, built from a failure plus the fallback the
 * caller would otherwise have used.
 *
 * 🔴 THE FALLBACK IS NEVER DISCARDED. `stopped: rate-limited` and
 *    `run status: error` are the run's own verdict; LINE's sentence is the
 *    evidence for it. Showing only the evidence would lose the verdict, and
 *    showing only the verdict is the bug being fixed — so both, in that order.
 *    เก็บทั้งคำตัดสินของเราและหลักฐานจาก LINE ห้ามทิ้งอันใดอันหนึ่ง.
 */
export function failureSentence(
  fallback: string,
  failure: ChunkFailure | undefined,
): string {
  if (failure === undefined) return fallback;
  if (failure.reason !== undefined) return `${fallback} — ${failure.reason}`;
  if (failure.status !== undefined) {
    return `${fallback} — LINE HTTP ${failure.status}`;
  }
  return fallback;
}
