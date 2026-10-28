// Channel registry (plan: peppy / A1.5) — single source of per-channel display
// metadata, mirroring the backend CHANNEL_TYPES. Drives dynamic UI labels so
// "LINE" is no longer hardcoded in generic presentation. LINE renders identically
// today; new entries (e.g. facebook) light up when a 2nd channel exists.

// What a channel can SEND from the ticket-support composer. Mirrors the backend
// send adapter's `capabilities` (src/channels/*SendAdapter.js). The composer reads
// this to decide which buttons to show — NEVER hardcode `if (channel === 'line')`.
// A new channel just declares its capabilities here (+ a backend adapter) and the
// UI adapts automatically (e.g. facebook.sticker:false hides the sticker button).
export interface ChannelCapabilities {
  text: boolean;
  image: boolean;
  sticker: boolean;
  flex: boolean;
}

export interface ChannelMeta {
  key: string;
  label: string;        // brand display name, e.g. "LINE", "Facebook"
  accountNoun: string;  // what an account is called, e.g. "OA", "Page"
  color: string;        // brand color for chips/badges
  brandActions: boolean; // whether LINE-specific actions (Open LINE, QR, Simulator) apply
  capabilities: ChannelCapabilities; // what the composer may let the admin send
  // Whether the BACKEND currently accepts creating a hook of this channel_type
  // (mirror of backend CHANNEL_TYPES). Only `enabled` channels are offered in the
  // create/edit picker so the UI can never submit a channel_type the backend would
  // reject. Flip facebook -> true in the SAME change that adds "facebook" to backend
  // CHANNEL_TYPES (plan peppy, Phase G). Label/gating below still work for any value.
  enabled: boolean;
}

export const CHANNELS: Record<string, ChannelMeta> = {
  line: { key: "line", label: "LINE", accountNoun: "OA", color: "#06C755", brandActions: true,
    capabilities: { text: true, image: true, sticker: true, flex: true }, enabled: true },
  // Future — schema/back end ready; UI lights up when backend supports it (enabled:false until then).
  // FB has no LINE-style stickers → sticker:false will auto-hide the sticker button.
  facebook: { key: "facebook", label: "Facebook", accountNoun: "Page", color: "#1877F2", brandActions: false,
    capabilities: { text: true, image: true, sticker: false, flex: false }, enabled: false },
};

export const DEFAULT_CHANNEL = "line";

// Capabilities for a channel_type (falls back to LINE for legacy hooks w/o channel_type).
export const capabilitiesOf = (t?: string | null): ChannelCapabilities => channelOf(t).capabilities;

// Channels the backend actually accepts today — the only ones the create/edit
// picker may offer. LINE-only now; facebook joins automatically once enabled above.
export const enabledChannels = (): ChannelMeta[] =>
  Object.values(CHANNELS).filter((c) => c.enabled);

export const channelOf = (t?: string | null): ChannelMeta =>
  CHANNELS[(t as string) in CHANNELS ? (t as string) : DEFAULT_CHANNEL];

// Convenience: the interpolation vars most labels need.
export const channelVars = (t?: string | null) => {
  const c = channelOf(t);
  return { channel: c.label, accountNoun: c.accountNoun };
};
