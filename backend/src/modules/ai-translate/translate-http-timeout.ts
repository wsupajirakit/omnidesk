/**
 * [FEAT-20260918-TRANSLATETIMEOUT] The translate lane's own stall ceiling.
 * ===========================================================================
 * Owner, 18/09: *"กำหนด timeout ด้วย เข้าและออก 30 วิ (เผื่อแก้ไขอนาคต) = timeout
 * แล้ว fallback เลย"* — 30 seconds, both directions, and changeable without a
 * code edit.
 *
 * ## Why this exists instead of a smaller `AI_HTTP_TIMEOUT_MS`
 *
 * That constant is 45s and is shared by nine call sites, including the webhook
 * REPLY lane whose budget is measured against `REPLY_STALE_MS` (45 + a 30s retry
 * = 75s, against a 120s ceiling). Lowering it to satisfy translation would cut
 * off healthy-but-slow customer replies, which is the exact failure the 08/09
 * raise from 30s existed to stop. `http.ts` states the rule in its own header:
 * a lane that needs a different ceiling gets its own value; the shared one does
 * not move. เพดานของเส้นแปล ไม่ใช่เพดานของเส้นตอบลูกค้า
 *
 * ## Why a shorter ceiling is right HERE specifically
 *
 * Both translate directions have somewhere to fall back to, and the reply lane
 * does not:
 *   · inbound  — the message keeps the customer's original text and simply
 *                carries no translation entry
 *   · outbound — the draft is sent exactly as the operator typed it
 * So a stall costs a missing convenience, never a missing message. Making an
 * operator watch 45 seconds before that happens is strictly worse than
 * answering at 30. แปลไม่ทัน = ได้ของเดิม ไม่ใช่ไม่ได้อะไร
 *
 * ## Read per call, and it MUST NOT THROW
 *
 * `getValidatedEnv()` is only populated after the config module has validated
 * `process.env`, and it THROWS when it has not been. A module-level constant
 * would freeze whatever existed at import time; a bare call would put a throwing
 * read inside the vendor request path.
 *
 * 🔴 That is not theoretical — it happened. The first version called
 * `getValidatedEnv()` directly and 24 cases across two suites went red, all with
 * `errorMessage: "Environment accessed before validation"` and `httpStatus: 0`.
 * The transports wrap their call in a try/catch, so the throw did not crash:
 * it was silently reshaped into a VENDOR ERROR. Every translation would have
 * reported the vendor as broken while the vendor was never contacted.
 *
 * So the read is guarded and falls back to the same 30s the schema declares.
 * A timeout value has one honest default, and reaching for it is always better
 * than turning a config question into a failed translation.
 * ค่านี้ห้ามโยน error เด็ดขาด อ่านไม่ได้ก็ใช้ค่า default
 *
 * revert: delete this file and the two `timeout:` overrides in
 * `vendors/*-translate.transport.ts`; both lanes then share the 45s ceiling
 * again, which is the behaviour before 18/09.
 */
import { getValidatedEnv } from '@/config/env.schema';

/**
 * The schema's default, repeated here ONLY as the unreachable-config fallback.
 * `env.schema.ts` stays the source of truth; if it changes, change it there and
 * this line follows in the same commit — `translate-timeout.spec.ts` asserts the
 * two agree.
 */
const DEFAULT_TRANSLATE_TIMEOUT_MS = 30_000;

/** Milliseconds a translate HTTP call may stall before it is abandoned. */
export function translateTimeoutMs(): number {
  try {
    return getValidatedEnv().AI_TRANSLATE_TIMEOUT_MS;
  } catch {
    return DEFAULT_TRANSLATE_TIMEOUT_MS;
  }
}
