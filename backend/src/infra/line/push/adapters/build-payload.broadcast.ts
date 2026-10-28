import type { LineMessage } from '../line-push.types';

/**
 * ==== [FEAT-20260820-LINEPUSHADAPTERS] candidate E — broadcast ====
 *
 * Parity with `buildLineMessage` (content/broadcasts.service.ts:77-96, live
 * and untouched until Phase 3), quirks preserved on purpose:
 *  · altText is hardcoded 'Broadcast message'
 *  · any type that is not text/image falls into the flex branch — including
 *    an undefined message, whose `contents` then rides as undefined. Parity
 *    means keeping that, not fixing it here. แก้ quirk = งาน Phase 3 พร้อม approve.
 * revert: delete `src/infra/line/` entirely (no runtime importers yet).
 */

export interface BroadcastMessageInput {
  type?: string;
  text?: string;
  image_url?: string;
  flex_json?: unknown;
}

export function buildBroadcastMessage(
  message: BroadcastMessageInput | undefined,
): LineMessage {
  const type = message?.type;
  if (type === 'text') {
    return { type: 'text', text: message?.text };
  }
  if (type === 'image') {
    return {
      type: 'image',
      originalContentUrl: message?.image_url,
      previewImageUrl: message?.image_url,
    };
  }
  return {
    type: 'flex',
    altText: 'Broadcast message',
    contents: message?.flex_json,
  };
}
