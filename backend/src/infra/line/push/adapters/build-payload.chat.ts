import type { LineMessage } from '../line-push.types';

/**
 * ==== [FEAT-20260820-LINEPUSHADAPTERS] candidate C — admin chat console ====
 *
 * Pure payload builder, parity with chat/channels/line-send-adapter.ts:103-163
 * (which stays live and untouched until candidate C migrates in Phase 3).
 * The input union mirrors chat's `OutboundMessage` but is DECLARED HERE —
 * infra must not import from modules (lint-enforced layering), so at migration
 * time chat maps its own type onto this one field-for-field.
 *
 * Rules ported exactly:
 *  · a caption rides as its OWN text message, AFTER the image(s)
 *  · `textFirst` (overflow batch from outbound-image-batch.ts) leads with text
 *  · ≤5 objects per push, counted INCLUDING the caption — over is programmer
 *    error, failed loudly before a network call LINE would 400 anyway
 * revert: delete `src/infra/line/` entirely (no runtime importers yet).
 */

/**
 * [FEAT-20260821-QUOTEREPLY] `quoteToken` — LINE's quote-reply handle. It is a
 * property of the MESSAGE OBJECT, not of the request, so it lives here and not in
 * the core's request type. LINE's OpenAPI declares it on `TextMessage` and
 * `StickerMessage` only; `ImageMessage` has no such field, which is why the two
 * image variants below do not accept it (the type is the guard, pinned in
 * line-push-adapters.spec.ts). The token never expires and is accepted by both
 * reply and push — which kind carries it is the CALLER's decision, never this
 * builder's. Absent → the emitted object is byte-identical to before.
 * revert: drop the two `quoteToken?` members and the two spreads below.
 */
export type ChatOutboundMessage =
  | { kind: 'text'; text: string; quoteToken?: string }
  | { kind: 'image'; imageUrl: string; text?: string }
  | { kind: 'images'; imageUrls: string[]; text?: string; textFirst?: boolean }
  | {
      kind: 'sticker';
      packageId: string;
      stickerId: string;
      quoteToken?: string;
    };

export function buildChatMessages(msg: ChatOutboundMessage): LineMessage[] {
  switch (msg.kind) {
    case 'text':
      return [
        {
          type: 'text',
          text: msg.text,
          ...(msg.quoteToken ? { quoteToken: msg.quoteToken } : {}),
        },
      ];
    case 'image': {
      const out: LineMessage[] = [
        {
          type: 'image',
          originalContentUrl: msg.imageUrl,
          previewImageUrl: msg.imageUrl,
        },
      ];
      if (msg.text) out.push({ type: 'text', text: msg.text });
      return out;
    }
    case 'images': {
      const objectCount = msg.imageUrls.length + (msg.text ? 1 : 0);
      if (msg.imageUrls.length === 0) {
        throw new Error(
          'buildChatMessages: images batch needs at least 1 image',
        );
      }
      if (objectCount > 5) {
        throw new Error(
          `buildChatMessages: ${objectCount} objects exceed LINE's 5-per-push limit — split via the batch planner`,
        );
      }
      const imageObjs: LineMessage[] = msg.imageUrls.map((u) => ({
        type: 'image',
        originalContentUrl: u,
        previewImageUrl: u,
      }));
      const textObj: LineMessage[] = msg.text
        ? [{ type: 'text', text: msg.text }]
        : [];
      return msg.textFirst
        ? [...textObj, ...imageObjs]
        : [...imageObjs, ...textObj];
    }
    case 'sticker':
      return [
        {
          type: 'sticker',
          packageId: msg.packageId,
          stickerId: msg.stickerId,
          ...(msg.quoteToken ? { quoteToken: msg.quoteToken } : {}),
        },
      ];
    default: {
      const exhaustive: never = msg;
      throw new Error(
        `buildChatMessages: unsupported message kind "${(exhaustive as { kind?: string }).kind}"`,
      );
    }
  }
}
