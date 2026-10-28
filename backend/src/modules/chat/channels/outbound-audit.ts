/**
 * [FEAT-20260814-ADMINPUSHLOG] One audit row per outbound message an ADMIN sends.
 * ===========================================================================
 *
 * WHY THIS EXISTS
 * Every other call to the LINE API writes a `webhook_logs` row — the bot's text
 * reply, its image reply, and the image an admin sends from the chat screen
 * (`chat-media.service.ts:392`). The admin's *text* push was the one path that
 * sent nothing: `ChatService.deliverOutbound` called the adapter and returned.
 *
 * Owner, 14/08, filtering the Webhook History page by "LINE Push" and finding it
 * empty: "หมายถึง push ticket support admin push ก็ควรบันทึกนะ ว่าเกิดอะไรขึ้น".
 * Without a row nobody can answer who sent what, when, or why LINE rejected it —
 * and a push spends real LINE quota, so the silence hides both cost and failure.
 *
 * WHY A SEPARATE FILE
 * The equivalent block inside `chat-media.service.ts` is ~50 lines of payload
 * shaping. Pasting a second copy into `chat.service.ts` (1.7k lines) would grow a
 * file that must not grow AND leave two payload shapes free to drift apart. This
 * module owns the shape once; `deliverOutbound` spends one line on it.
 *
 * WHY IT SITS IN `channels/`
 * It describes an OUTBOUND delivery, which is exactly what this directory is for
 * (`send-adapter.ts`, `line-send-adapter.ts`, `outbound-message.ts`). Placing it
 * beside them keeps every outbound concern in one place; nothing new is created
 * at the module root. ไฟล์ใหม่ต้องอยู่กับพวกเดียวกัน ไม่กองที่ราก.
 *
 * SAFETY — this can never break a send
 * `logOutboundPush` is fire-and-forget by contract: it never throws, never
 * awaits the caller, and swallows its own failure into a warning. A missing
 * audit row must not cost the customer their message, which is the same posture
 * the media path already takes. เขียน log ไม่ได้ ห้ามทำให้ส่งข้อความพัง.
 *
 * revert: delete this file, its two call sites in `chat.service.ts`, and the
 *         `WebhookLogService` injection there.
 */

/** The subset of `WebhookLogService` this helper needs — keeps it testable. */
export interface OutboundAuditLogger {
  createLog(entry: Record<string, unknown>): Promise<unknown>;
}

/** Just enough of the room and hook to describe the delivery. */
export interface OutboundAuditContext {
  /** Customer id the message was addressed to (channel_user_id / line_user_id). */
  to: string | null;
  hookId?: string | null;
  hookAlias?: string | null;
  /** `line`, or whatever the hook declares — never hardcoded here. */
  channelType?: string | null;
  groupId?: string | null;
  /** Who pressed send; `null` when the caller could not resolve a user. */
  actorId?: string | null;
  actorName?: string | null;
}

/** What was sent, and how it went. */
export interface OutboundAuditResult {
  /** `text` today; `sticker` and future kinds reuse the same row shape. */
  kind: string;
  /** Message body for text; omitted for kinds that carry none. */
  text?: string | null;
  /** Extra payload fields, e.g. sticker ids. Merged into `payload_summary`. */
  payload?: Record<string, unknown>;
  durationMs: number;
  error?: unknown;
  /** [FEAT-20260821-QUOTEREPLY] which endpoint really carried it. Absent = push (legacy callers). */
  sendKind?: 'reply' | 'push';
  /** [FEAT-20260821-QUOTEREPLY] `kept` on the wire · `dropped` = LINE refused it, resent plain · `none`. */
  quote?: 'kept' | 'dropped' | 'none';
}

/** The endpoint every one of these deliveries lands on — unless the ladder replied. */
const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
// [FEAT-20260821-QUOTEREPLY] the reply rung of channels/outbound-send-strategy.ts.
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

/**
 * `action_type` for the Webhook History page's "LINE Push" filter.
 * ⚠️ Must stay `push_message` — the admin-image path already writes that exact
 *    value (`chat-media.service.ts:402`), and the two belong in one bucket.
 */
export const OUTBOUND_PUSH_ACTION = 'push_message';

/**
 * Read one field off a thrown value without trusting its shape.
 *
 * ⚠️ Returns a PRIMITIVE or `undefined`, never the raw value: an axios error's
 *    `code` is normally a string but nothing guarantees it, and stringifying an
 *    object here would write `[object Object]` into the audit row — a log line
 *    that looks filled in while telling you nothing.
 */
const primitive = (v: unknown): string | number | undefined =>
  typeof v === 'string' || typeof v === 'number' ? v : undefined;

const errorField = (
  error: unknown,
  path: 'status' | 'code' | 'message',
): string | number | undefined => {
  const e = error as
    | {
        code?: unknown;
        message?: unknown;
        response?: { status?: unknown; data?: unknown };
      }
    | null
    | undefined;
  if (path === 'status') return primitive(e?.response?.status);
  if (path === 'code') return primitive(e?.code);
  return primitive(e?.message);
};

/** LINE puts the useful reason in `response.data.message`; fall back to the throw. */
const reasonOf = (error: unknown): string => {
  const data = (error as { response?: { data?: { message?: unknown } } } | null)
    ?.response?.data;
  if (data && typeof data.message === 'string') return data.message;
  return String(errorField(error, 'message') ?? 'unknown');
};

/**
 * Write the audit row. Call it WITHOUT awaiting — it settles on its own.
 *
 * @param warn where to report a logging failure; the send itself is unaffected.
 */
export function logOutboundPush(
  logger: OutboundAuditLogger,
  ctx: OutboundAuditContext,
  result: OutboundAuditResult,
  warn: (message: string) => void,
): void {
  const failed = result.error !== undefined && result.error !== null;
  const status = errorField(result.error, 'status');

  // ⚠️ `try` wraps the CALL as well as the promise: a logger that throws
  //    synchronously (bad injection, a mock in a test) would otherwise escape
  //    into the caller and take the send down with it.
  try {
    void Promise.resolve(
      logger.createLog({
        hook_id: ctx.hookId || undefined,
        hook_alias: ctx.hookAlias || undefined,
        channel_type: ctx.channelType || 'line',
        group_id: ctx.groupId || undefined,
        channel: 'line_api',
        log_source: 'line_api',
        action_type: OUTBOUND_PUSH_ACTION,
        method: 'POST',
        endpoint:
          result.sendKind === 'reply'
            ? LINE_REPLY_ENDPOINT
            : LINE_PUSH_ENDPOINT,
        status: failed ? 'error' : 'success',
        http_status: failed ? (status ?? 500) : 200,
        error_code: failed
          ? String(errorField(result.error, 'code') ?? status ?? 500)
          : undefined,
        error_message: failed ? reasonOf(result.error) : undefined,
        duration_ms: result.durationMs,
        payload_summary: {
          to: ctx.to,
          kind: result.kind,
          // The admin's identity is the point of this row: a chat_messages row
          // alone cannot say who pressed send when several operators share a room.
          actor_id: ctx.actorId || null,
          actor_name: ctx.actorName || null,
          ...(result.text ? { text: result.text } : {}),
          ...(result.payload ?? {}),
          // [FEAT-20260821-QUOTEREPLY] only when the caller went through the
          // ladder; a legacy caller's summary is byte-identical to before.
          ...(result.sendKind
            ? { send: { kind: result.sendKind, quote: result.quote ?? 'none' } }
            : {}),
        },
        response_summary: failed ? undefined : { status: 'success' },
      }),
    ).catch((e: unknown) => warn(auditFailure(e)));
  } catch (e) {
    warn(auditFailure(e));
  }
}

const auditFailure = (e: unknown): string =>
  `[ADMINPUSHLOG] audit row failed (message was still sent): ${
    e instanceof Error ? e.message : String(e)
  }`;
