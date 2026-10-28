/**
 * [FIX-20260808-CHANNELSEND] The neutral outbound-message contract.
 *
 * Mirrors the legacy `channels/` module (legacy-api/src/channels/): a channel-
 * agnostic `OutboundMessage` the chat service builds without knowing which
 * provider will deliver it, plus the resolved recipient + token in `SendContext`.
 * A send adapter maps each `kind` to its provider payload — see
 * `line-send-adapter.ts`, ported from `channels/lineSendAdapter.js`.
 */

/**
 * [FIX-20260808-CHANNELSEND] Discriminated union of what an admin can push.
 * Mirrors the shape lineSendAdapter.js switches on (`text` | `image` | `sticker`).
 */
export type OutboundMessage =
  | { kind: 'text'; text: string }
  | { kind: 'image'; imageUrl: string; text?: string }
  // [FEAT-20260816-MULTIIMG] one push call carrying up to 5 objects total.
  // `textFirst` puts the caption BEFORE the images — used only by the overflow
  // call the batch planner emits (outbound-image-batch.ts); everywhere else the
  // caption trails, same as the legacy single-image order.
  | { kind: 'images'; imageUrls: string[]; text?: string; textFirst?: boolean }
  | { kind: 'sticker'; packageId: string; stickerId: string };

/**
 * [FIX-20260808-CHANNELSEND] Resolved delivery context.
 * `to` = the room's customer id (line_user_id / channel_user_id); `accessToken`
 * = the OA's decrypted token. Mirrors legacy `resolveRoomHook` ctx.
 */
export interface SendContext {
  to: string;
  accessToken: string;
}
