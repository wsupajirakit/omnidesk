import type { LineMessage } from '../line-push.types';

/**
 * ==== [FEAT-20260820-LINEPUSHADAPTERS] candidate A — webhook reply path ====
 *
 * Three builders, parity with the live webhook senders (all untouched until
 * Phase 3):
 *  · text  → line-api.service.ts:113-119 (quickReply attaches IN the message)
 *  · flex  → line-api.service.ts:154-169; the English altText default is
 *    unreachable in practice (every call site passes Thai) but preserved —
 *    "unreachable today" is not "unreachable" (their comment, kept true here)
 *  · image carousel → webhook.service.ts:4140-4199, the ONE payload that
 *    forced a raw-axios bypass because the old client wraps a single message.
 *    media mode = one image message per item; flex mode = ONE flex carousel.
 *    http→https rewrite and the Thai fallback chain are behaviour, not style.
 * revert: delete `src/infra/line/` entirely (no runtime importers yet).
 */

export function buildReplyTextMessage(
  text: string,
  quickReply?: Record<string, unknown> | null,
): LineMessage {
  const message: LineMessage = { type: 'text', text };
  if (quickReply) message['quickReply'] = quickReply;
  return message;
}

export function buildReplyFlexMessage(
  flexContents: Record<string, unknown>,
  altText = 'Bank Transfer Details',
  quickReply?: Record<string, unknown> | null,
): LineMessage {
  const message: LineMessage = {
    type: 'flex',
    altText,
    contents: flexContents,
  };
  if (quickReply) message['quickReply'] = quickReply;
  return message;
}

/** One row of the image-tag carousel (object-image storages). */
export interface CarouselItem {
  image_url: string;
  detail_link?: string;
  detail_text?: string;
}

export interface CarouselOptions {
  /** 'media' = plain image messages · 'flex' = one carousel of bubbles. */
  mode: 'media' | 'flex';
  /** `objImage.detail` — feeds the altText and the per-bubble text fallback. */
  fallbackDetail?: string;
}

export function buildImageCarouselMessages(
  items: CarouselItem[],
  opts: CarouselOptions,
): LineMessage[] {
  // webhook.service.ts:4158 — stored URLs may be http; LINE requires https.
  const secure = (u: string): string => u.replace(/^http:\/\//i, 'https://');

  if (opts.mode === 'media') {
    // webhook.service.ts:4139-4141 — the live query fetches up to 10 rows but
    // LINE caps a reply at 5 messages, so media mode trims to the first 5.
    // (flex mode below deliberately does NOT trim: it is ONE carousel message.)
    return items.slice(0, 5).map((s) => {
      const secureUrl = secure(s.image_url);
      return {
        type: 'image',
        originalContentUrl: secureUrl,
        previewImageUrl: secureUrl,
      };
    });
  }

  const bubbles = items.map((s) => {
    const hero: Record<string, unknown> = {
      type: 'image',
      url: secure(s.image_url),
      size: 'full',
      aspectRatio: '2:3',
      aspectMode: 'fit',
    };
    if (s.detail_link) {
      hero['action'] = { type: 'uri', uri: s.detail_link };
    }
    return {
      type: 'bubble',
      hero,
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: s.detail_text || opts.fallbackDetail || 'ดูรายละเอียด',
            weight: 'bold',
            size: 'xs',
            wrap: true,
          },
        ],
      },
    };
  });
  return [
    {
      type: 'flex',
      altText: opts.fallbackDetail || 'ดูรายการรูปภาพ',
      contents: { type: 'carousel', contents: bubbles },
    },
  ];
}
