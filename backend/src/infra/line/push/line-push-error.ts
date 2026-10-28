/**
 * ==== [FEAT-20260820-LINEPUSHCORE] ONE failure normalizer for LINE calls ====
 *
 * Today the same axios error is decoded five different ways
 * (chat/channels/line-send-adapter.ts:29 `extractLineReason`,
 * chat/channels/outbound-audit.ts:107 `reasonOf`, chat-media.service.ts
 * `extractErrorReason`, line-api.service.ts:408 `axiosErrorData`, and an
 * inline block in broadcasts.service.ts). This file is the single decoder the
 * new core uses. It READS the error and never rewraps it — the original axios
 * shape must survive to the caller (`.response.status` and `.response.data`
 * are contract, see line-api.service.ts:15-25). ห้ามห่อ error ใหม่ให้ shape หาย.
 *
 * Reason format (superset of extractLineReason):
 *   `HTTP <status> - <message> (<prop: detail, …>) [reqId: <id>] [retry-after: <s>]`
 * Transport failure (no response): status 0, reason = err.message.
 *
 * revert: delete `src/infra/line/` entirely (no external importers yet).
 */

export interface LineFailure {
  status: number;
  reason: string;
  lineRequestId?: string;
  data?: unknown;
}

interface AxiosErrorish {
  message?: unknown;
  response?: {
    status?: number;
    data?: unknown;
    headers?: Record<string, string | undefined>;
  };
}

/**
 * `err.message` as JS reads it — but never the literal string "undefined":
 * a rejection like `{}` or `undefined` (an interceptor gone wrong) must still
 * produce a reason a log reader can act on.
 */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message) return message;
  if (typeof err === 'string' && err) return err;
  try {
    // JSON, not String(): an object would stringify to '[object Object]'.
    return JSON.stringify(err) ?? 'unknown error (empty rejection)';
  } catch {
    return 'unrecognized error';
  }
}

/** The `x-line-request-id` header, from a response or an error alike. */
export function lineRequestIdOf(
  headers: Record<string, string | undefined> | undefined,
): string | undefined {
  if (!headers) return undefined;
  return headers['x-line-request-id'] || headers['x-request-id'];
}

/** Decode a rejected LINE call into a flat, loggable failure. */
export function describeLineFailure(err: unknown): LineFailure {
  const response = (err as AxiosErrorish | null)?.response;

  // Transport failure — timeout / DNS / connection reset. No HTTP happened.
  if (!response || typeof response.status !== 'number') {
    return { status: 0, reason: messageOf(err) };
  }

  const status = response.status;
  const data = response.data;
  const headers = response.headers ?? {};
  const reqId = lineRequestIdOf(headers);

  let reason = `HTTP ${status}`;
  if (typeof data === 'string' && data) {
    reason += ` - ${data}`;
  } else if (data && typeof data === 'object') {
    const obj = data as {
      message?: unknown;
      details?: Array<{ property?: string; message?: string }>;
    };
    if (typeof obj.message === 'string' && obj.message) {
      reason += ` - ${obj.message}`;
    }
    if (Array.isArray(obj.details) && obj.details.length > 0) {
      const detailStr = obj.details
        .map((d) => (d.property ? `${d.property}: ${d.message}` : d.message))
        .filter(Boolean)
        .join(', ');
      if (detailStr) reason += ` (${detailStr})`;
    }
  } else {
    reason += ` - ${messageOf(err)}`;
  }
  if (reqId) reason += ` [reqId: ${reqId}]`;

  // 429 carries LINE's cool-down; surface it so an operator/log reader knows
  // how long the channel is throttled (per-endpoint, per-channel rate limit).
  const retryAfter = headers['retry-after'];
  if (status === 429 && retryAfter) reason += ` [retry-after: ${retryAfter}]`;

  return { status, reason, lineRequestId: reqId, data };
}
