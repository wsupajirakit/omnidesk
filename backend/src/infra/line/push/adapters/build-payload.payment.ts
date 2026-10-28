import type { LineMessage } from '../line-push.types';

/**
 * ==== [FEAT-20260820-LINEPUSHADAPTERS] candidate B — payment ladder ====
 *
 * The payment delivery ladder (webhook.service.ts:5221-5698) sends the SAME
 * message body down two pipes — reply first, push when the token is spent
 * (the whole point of [FEAT-20260808-PAYTOOL-P3]: "send the same kind, just
 * change the pipe"). So the adapter builds ONE message; the caller picks the
 * kind ('reply' vs 'push') on the send request. altText default matches the
 * shared legacy default (line-api.service.ts:158, 283).
 * revert: delete `src/infra/line/` entirely (no runtime importers yet).
 */

export type PaymentReplyBody =
  | { kind: 'text'; text: string }
  | {
      kind: 'flex';
      flexContents: Record<string, unknown>;
      altText?: string;
    };

export function buildPaymentMessage(body: PaymentReplyBody): LineMessage {
  if (body.kind === 'text') {
    return { type: 'text', text: body.text };
  }
  return {
    type: 'flex',
    altText: body.altText ?? 'Bank Transfer Details',
    contents: body.flexContents,
  };
}
