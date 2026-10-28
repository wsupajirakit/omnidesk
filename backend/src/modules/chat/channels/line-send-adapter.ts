/**
 * [FIX-20260808-CHANNELSEND] The LINE outbound (push) adapter.
 *
 * Behaviour-preserving port of `legacy-api/src/channels/lineSendAdapter.js`:
 * same endpoint (LINE PUSH API), same per-kind payload mapping, same rich
 * error-reason extraction (status + data.message + details + x-line-request-id).
 * It builds its own payloads and POSTs directly with axios rather than calling
 * `LineApiService.sendLinePushMessage`, which is text-only by contract.
 * Reuses the same URL/auth-header/timeout convention as `line-api.service.ts`.
 */
import { Injectable } from '@nestjs/common';
import axios from 'axios';

import type { OutboundMessage, SendContext } from './outbound-message';
import type { SendAdapter } from './send-adapter';

/**
 * [FIX-20260808-CHANNELSEND] legacy lineSendAdapter.js:47 — the PUSH endpoint.
 * The admin "reply" actually pushes: the customer's reply token has expired by
 * the time an admin answers, so Push (addressable to a user id any time) is used.
 */
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

/**
 * [FIX-20260808-CHANNELSEND] Extracts the human-readable failure reason from an
 * axios error. Ported verbatim in spirit from lineSendAdapter.js:84-105 —
 * status + string/`data.message` + `data.details[]` + `x-line-request-id`.
 */
/**
 * [FEAT-20260821-CHATPUSHCORE] EXPORTED so the migrated call sites can keep the
 * exact wording the operator already sees.
 *
 * The push core produces a reason of its own (`HTTP 400 - … [reqId: …]`,
 * `line-push-error.ts:13`), which is a superset and therefore a DIFFERENT
 * string. Swapping to it would change the error text on the chat screen for a
 * failure that has not changed at all. Reuse the extractor instead — one
 * implementation, one wording, on both the old path and the new.
 * ข้อความที่แอดมินเห็นต้องไม่เปลี่ยนเพราะเราย้ายท่อ.
 */
export function extractLineReason(error: unknown): string | undefined {
  const response = (
    error as {
      response?: {
        status?: number;
        data?: unknown;
        headers?: Record<string, string | undefined>;
      };
    }
  ).response;
  if (!response) return undefined;

  const status = response.status;
  const data = response.data;
  const headers = response.headers ?? {};
  const reqId = headers['x-line-request-id'] || headers['x-request-id'];

  let reason = `HTTP ${status}`;
  if (data) {
    if (typeof data === 'string') {
      reason += ` - ${data}`;
    } else if (typeof data === 'object') {
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
      } else if (Object.keys(obj).length > 1) {
        reason += ` (${JSON.stringify(obj)})`;
      }
    }
  } else if (error instanceof Error && error.message) {
    reason += ` - ${error.message}`;
  }
  if (reqId) reason += ` [reqId: ${reqId}]`;
  return reason;
}

/** A single LINE `messages[]` entry, passed through untouched. */
type LineMessage = Record<string, unknown>;

@Injectable()
export class LineSendAdapter implements SendAdapter {
  /** [FIX-20260808-CHANNELSEND] legacy lineSendAdapter.js:111 — registry key. */
  public readonly channelType = 'line';

  /**
   * [FIX-20260808-CHANNELSEND] legacy lineSendAdapter.js:50 — what LINE can send.
   * Drives which composer buttons the FE shows.
   */
  public readonly capabilities = {
    text: true,
    image: true,
    sticker: true,
    flex: true,
  };

  /**
   * [FIX-20260808-CHANNELSEND] Push one OutboundMessage to a LINE recipient.
   * Maps each kind to LINE `messages[]` (legacy lineSendAdapter.js:61-75), POSTs
   * the PUSH endpoint, and throws on non-2xx with the extracted reason attached.
   */
  public async send(ctx: SendContext, msg: OutboundMessage): Promise<void> {
    const { to, accessToken } = ctx;

    let lineMessages: LineMessage[];
    switch (msg.kind) {
      case 'text':
        lineMessages = [{ type: 'text', text: msg.text }];
        break;
      case 'image':
        // originalContentUrl / previewImageUrl MUST be absolute https — LINE
        // fetches them. A caption rides as its own text message (legacy:68).
        lineMessages = [
          {
            type: 'image',
            originalContentUrl: msg.imageUrl,
            previewImageUrl: msg.imageUrl,
          },
        ];
        if (msg.text) lineMessages.push({ type: 'text', text: msg.text });
        break;
      case 'images': {
        // [FEAT-20260816-MULTIIMG] Several images in ONE push call (cheapest
        // correct shape — LINE bills per call, not per object). The adapter
        // does NOT split: batching is the planner's job (outbound-image-batch),
        // so an over-limit batch here is a programmer error, failed loudly
        // BEFORE spending a network call LINE would 400 anyway.
        const objectCount = msg.imageUrls.length + (msg.text ? 1 : 0);
        if (msg.imageUrls.length === 0) {
          throw new Error(
            'LineSendAdapter: images batch needs at least 1 image',
          );
        }
        if (objectCount > 5) {
          throw new Error(
            `LineSendAdapter: ${objectCount} objects exceed LINE's 5-per-push limit — split via planImagePushBatches`,
          );
        }
        const imageObjs = msg.imageUrls.map((u) => ({
          type: 'image',
          originalContentUrl: u,
          previewImageUrl: u,
        }));
        const textObj = msg.text ? [{ type: 'text', text: msg.text }] : [];
        lineMessages = msg.textFirst
          ? [...textObj, ...imageObjs]
          : [...imageObjs, ...textObj];
        break;
      }
      case 'sticker':
        lineMessages = [
          {
            type: 'sticker',
            packageId: msg.packageId,
            stickerId: msg.stickerId,
          },
        ];
        break;
      default: {
        // Exhaustiveness guard — mirrors legacy's `default: throw`.
        const exhaustive: never = msg;
        throw new Error(
          `LineSendAdapter: unsupported message kind "${(exhaustive as { kind?: string }).kind}"`,
        );
      }
    }

    // legacy lineSendAdapter.js:76 — image gets a longer budget than text/sticker.
    const timeout = msg.kind === 'image' || msg.kind === 'images' ? 8000 : 5000;

    try {
      await axios.post(
        LINE_PUSH_URL,
        { to, messages: lineMessages },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout,
        },
      );
    } catch (error) {
      // Throw with the extracted reason so the caller/FE can surface it.
      const reason = extractLineReason(error);
      throw new Error(
        reason ? `LINE push failed: ${reason}` : `LINE push failed`,
      );
    }
  }
}
