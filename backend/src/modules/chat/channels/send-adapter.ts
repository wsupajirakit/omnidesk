/**
 * [FIX-20260808-CHANNELSEND] The send-adapter contract every channel implements.
 *
 * Mirrors the legacy `channels/lineSendAdapter.js` export shape
 * (`{ channelType, capabilities, send(ctx, message) }`). A new provider (e.g.
 * Facebook) implements this same interface and is registered in
 * `channel-registry.ts` — no call-site changes anywhere.
 */
import type { OutboundMessage, SendContext } from './outbound-message';

/**
 * [FIX-20260808-CHANNELSEND] What the adapter can send. `capabilities` drives
 * which composer buttons the FE shows (a channel that can't send stickers hides
 * that button), mirroring legacy's `capabilities` object.
 */
export interface SendAdapter {
  /** Provider key, e.g. "line". Matches the registry key. */
  channelType: string;
  capabilities: {
    text: boolean;
    image: boolean;
    sticker: boolean;
    flex: boolean;
  };
  /** Deliver one neutral OutboundMessage. Throws on non-2xx / transport error. */
  send(ctx: SendContext, msg: OutboundMessage): Promise<void>;
}
