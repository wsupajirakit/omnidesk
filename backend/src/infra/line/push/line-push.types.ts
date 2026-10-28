/**
 * ==== [FEAT-20260820-LINEPUSHCORE] the neutral send contract — types only ====
 *
 * The core knows NOBODY: no hook, no room, no Mongo, no crypto. A caller hands
 * it a decrypted token string, a target, and 1-5 wire-ready message objects.
 * Everything domain-shaped (which OA, which flex doc, dedupe, suppress,
 * reply→push ladders) stays with the caller. ตัวกลางเป็นกลางจริง ไม่รู้จักใคร.
 *
 * `LineMessage` is deliberately open (same reasoning as `LineFlexContents` in
 * line-api.service.ts:72-73, and LINE's own forward-compat guideline): the core
 * must pass tomorrow's message types through untouched, so it never validates
 * message internals — only the count.
 *
 * revert: delete `src/infra/line/` entirely (no external importers yet).
 */

/** One entry of LINE's `messages[]` — passed to the wire untouched. */
export type LineMessage = Record<string, unknown>;

/** Which pipe the request rides. `loading` is the typing indicator. */
export type LineSendKind =
  'reply' | 'push' | 'multicast' | 'broadcast' | 'narrowcast' | 'loading';

/**
 * Opt-in retry. Allowed on push/multicast/broadcast/narrowcast ONLY (the
 * kinds LINE's retry-key doc covers) — a reply token is single-use (the
 * standing rule line-api.service.ts:27-29 already documents), so asking for
 * retry on a reply or loading call is programmer error and throws.
 * Backoff: baseDelayMs * 2^(attempt-1); tests pass 0 to stay instant.
 */
export interface LineRetryOption {
  maxAttempts: number;
  baseDelayMs?: number;
}

export interface LineSendRequest {
  kind: LineSendKind;
  /** Decrypted channel access token. Empty ⇒ `{ok:false,status:0}`, no call. */
  token: string;
  /** push: user/room/group id · multicast: id[] · loading: chatId. */
  to?: string | string[];
  /** reply only. */
  replyToken?: string;
  /** 1-5 wire-ready objects (ignored by `loading`). */
  messages: LineMessage[];
  /** loading only; LINE accepts 5-60, default 20 (legacy value). */
  loadingSeconds?: number;
  /**
   * narrowcast only: recipient / filter / limit objects, merged into the POST
   * body UNTOUCHED (forward-compatible, same stance as LineMessage). Nobody
   * in the product uses narrowcast yet (grep 2026-08-20: zero hits) — the
   * pipe exists so a targeted-broadcast feature can plug in without core work.
   */
  narrowcast?: Record<string, unknown>;
  /**
   * Idempotency key (X-Line-Retry-Key). Auto-generated UUID for the
   * push-family when omitted; never sent on reply/loading.
   */
  retryKey?: string;
  retry?: LineRetryOption;
  /** Per-call override of LINE_DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Exactly one event per send() call, success or failure — the fields LINE's
   * dev guidelines require to be logged. The core does not know where logs
   * live; the caller maps this onto webhook_logs (or anything else).
   * A throwing sink is swallowed: logging must never break delivery.
   */
  onAudit?: (event: LineAuditEvent) => void;
}

export interface LineSendResult {
  /** true on 2xx — and on 409, which means an earlier retryKey attempt WON. */
  ok: boolean;
  /** HTTP status; 0 = transport failure (timeout/DNS/reset) or no call made. */
  status: number;
  /** `x-line-request-id` — LINE's correlation id, present on success & error. */
  lineRequestId?: string;
  /** The idempotency key that was sent, if any. */
  retryKey?: string;
  attempts: number;
  durationMs: number;
  /** Human-readable failure: `HTTP 400 - <msg> (<details>) [reqId: …]`. */
  reason?: string;
  /** Response body from LINE (success body, or the error body on failure). */
  data?: unknown;
  /** The UNTOUCHED axios error on failure — `.response.status` must survive. */
  raw?: unknown;
}

/** What gets logged per call — see LINE "development guidelines" (2026-08). */
export interface LineAuditEvent {
  kind: LineSendKind;
  endpoint: string;
  method: 'POST';
  ok: boolean;
  status: number;
  lineRequestId?: string;
  retryKey?: string;
  attempts: number;
  durationMs: number;
  reason?: string;
}
