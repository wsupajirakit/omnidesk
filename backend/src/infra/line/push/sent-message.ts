/**
 * [FEAT-20260831-QUOTESRC] Read the ids LINE returns for a message it accepted.
 * ===========================================================================
 * WHAT LINE ANSWERS. Every accepted reply and push comes back with
 * `{"sentMessages":[{"id":"…","quoteToken":"…"}]}` — verified against real rows
 * in `webhook_logs` on this machine (`line_reply`, `payment_reply`,
 * `slip_flex_reply`, `notice_case_a_flex`, `image_answer_reply`,
 * `rate_limit_reply`, `missing_profile_data_reply`), not against documentation.
 * The values were already being logged there; they were simply never written
 * onto the bot's own chat row, which is why a customer quoting the bot could
 * never be resolved back to the message quoted.
 *
 * WHY [0] IS SAFE HERE. Every reply this repo sends carries exactly ONE message
 * object (`reply-via-core.ts` builds a 1-element array), and of 979 real
 * responses carrying `sentMessages`, none held more than one. If a future path
 * ever sends several in one call, that path must map them itself — do not widen
 * this. หนึ่ง call = หนึ่งข้อความ ตรวจแล้วทั้งโค้ดและข้อมูลจริง.
 *
 * ⚠️ THE EMPTY CASE IS THE CONTRACT. When LINE returned nothing usable this
 * yields an object with NO KEYS, so a call site spreading it into
 * `logMessage({ … })` builds the exact object it builds today. A key holding
 * `undefined` would be a behaviour change dressed as a no-op.
 *
 * revert: delete this file, its line in `../index.ts`, and the spreads at the
 *         call sites; bot rows stop carrying the id, nothing else moves.
 */

/** Exactly the two params `ChatHistoryService.logMessage` already accepts. */
export interface SentMessageIds {
  providerMsgId?: string;
  quoteToken?: string;
}

/* Deliberately loose: the four senders that feed this declare `data` as
   `unknown` (line-api.service.ts and the reply-via-core mirrors), so a narrow
   parameter type would push a cast into every call site. The narrowing happens
   below, once, where it can be tested. */
type SendResponse = { data?: unknown } | null;

type SentMessage = { id?: unknown; quoteToken?: unknown };

export function sentMessageIds(res: SendResponse | undefined): SentMessageIds {
  const list = (res?.data as { sentMessages?: unknown } | null | undefined)
    ?.sentMessages;
  const first = Array.isArray(list)
    ? (list[0] as SentMessage | undefined)
    : undefined;
  if (!first || typeof first !== 'object') return {};
  const id = typeof first.id === 'string' && first.id ? first.id : null;
  const token =
    typeof first.quoteToken === 'string' && first.quoteToken
      ? first.quoteToken
      : null;
  return {
    ...(id ? { providerMsgId: id } : {}),
    ...(token ? { quoteToken: token } : {}),
  };
}
