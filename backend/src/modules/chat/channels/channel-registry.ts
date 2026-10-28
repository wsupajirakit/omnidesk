/**
 * [FIX-20260808-CHANNELSEND] The send-adapter registry.
 *
 * Port of `legacy-api/src/channels/index.js` — `getSendAdapter(channelType)`
 * returns the adapter or NULL. Callers stay channel-neutral: they resolve the
 * hook's channel_type and ask the registry, never branching on 'line'.
 *
 * ── HOW TO ADD A NEW CHANNEL (e.g. Facebook) ───────────────────────────────
 *   1. write facebook-send-adapter.ts implementing SendAdapter
 *   2. inject it here and add `facebook: this.facebookAdapter` to ADAPTERS
 *   3. 🔴 AND GIVE IT A TRANSPORT. This used to read "done — ZERO call-site
 *      changes", which stopped being true when the chat console's send moved to
 *      the LINE core ([FIX-20260827-CGATECHANNEL]). Registering an adapter no
 *      longer makes a channel sendable: `chat.service.ts` / `chat-media.service.ts`
 *      deliver through `LinePushDispatcher`, which is LINE-only by construction
 *      (`infra/line/push/line-push.ts` KIND_URL — six LINE URLs, no channel
 *      parameter). Those two call sites therefore gate on `servedByLineCore`
 *      below, and a newly registered channel is REFUSED there until its own
 *      transport exists — deliberately, because passing it through would post a
 *      Facebook hook's message to api.line.me with the wrong token, which is the
 *      exact disaster this registry was built to prevent.
 *      ลงทะเบียน adapter อย่างเดียวไม่พอแล้ว ต้องมีเส้นส่งของตัวเองด้วย
 */
import { Injectable } from '@nestjs/common';

import { LineSendAdapter } from './line-send-adapter';
import type { SendAdapter } from './send-adapter';

@Injectable()
export class ChannelRegistry {
  private readonly adapters: Record<string, SendAdapter>;

  constructor(private readonly lineAdapter: LineSendAdapter) {
    // [FIX-20260808-CHANNELSEND] Register built adapters. Mirrors legacy
    // channels/index.js ADAPTERS. Facebook is a one-line add once its adapter
    // exists — nothing else changes.
    this.adapters = {
      line: this.lineAdapter,
      // facebook: this.facebookAdapter,   // ← future: uncomment when FB push is built
    };
  }

  /**
   * [FIX-20260808-CHANNELSEND] Resolve the send adapter for a channel_type.
   *
   * Legacy null-safety rule, ported exactly (channels/index.js:25-43):
   *   · legacy hook (channel_type null/empty) → LINE (the historical default).
   *   · a channel_type that is SET but has no adapter yet (e.g. "facebook"
   *     before it is built) → NULL. It must NOT fall back to LINE — that would
   *     push a FB hook's messages to api.line.me with the wrong token. It simply
   *     cannot send yet.
   */
  public getSendAdapter(channelType?: string): SendAdapter | null {
    // Legacy hook whose channel_type was never set = LINE.
    if (channelType == null || channelType === '') {
      return this.adapters['line'] ?? null;
    }
    // Declared-but-unbuilt channel → null (cannot send), never a LINE fallback.
    return this.adapters[channelType] ?? null;
  }
}

/**
 * [FIX-20260827-CGATECHANNEL] Is this adapter the one the LINE CORE serves?
 * 📖 todo/task/27082026/todo2_27082026_candidate-c-gate-channel-mismatch.md
 *
 * 🔴 THE QUESTION THE SEND PATH ACTUALLY NEEDS. The two chat send paths used to
 * resolve an adapter and test it for null, which answers "is an adapter
 * registered for this channel". That stopped being the right question when
 * candidate C moved delivery to `LinePushDispatcher` (`chat.service.ts:853`):
 * that core is LINE-only — `KIND_URL` (`infra/line/push/line-push.ts:80-87`)
 * maps every kind to an api.line.me URL and takes no channel argument at all.
 * The resolved adapter was then never used again; `adapter.send()` has no
 * caller left in `src/`.
 *
 * The day a second adapter is registered — which the note at the top of this
 * file openly invites — the old gate would answer `true` and that channel's
 * message would be POSTed to api.line.me carrying its own, non-LINE token:
 * exactly the failure this registry exists to prevent.
 * เกตต้องถามแทนเส้นที่ส่งจริง ไม่ใช่ถามว่ามีใครลงทะเบียนไว้
 *
 * ⚠️ A FREE FUNCTION, NOT A METHOD ON `ChannelRegistry`, and that is deliberate.
 * The registry is an INJECTED collaborator, so three specs stand in for it with
 * a small object carrying only `getSendAdapter`
 * (`chat-media-reply-reuse` · `chat-media-outbound-log` · `chat-service-quote-reply`).
 * Adding a method would break all three today and quietly tax every double
 * written afterwards. A predicate over the value they already produce costs the
 * doubles nothing and still keeps the rule in ONE place.
 * เพิ่มเมธอดบนของที่ถูก inject = double ทุกตัวต้องตามแก้ตลอดไป
 *
 * ⚠️ Behaviour is byte-identical TODAY — only `line` is registered, so every
 * input gives the answer it gave before. It diverges exactly on the day the bug
 * would otherwise have fired.
 *
 * revert: drop this function and put `if (!adapter)` back at the two call sites.
 */
export function servedByLineCore(adapter: SendAdapter | null): boolean {
  return adapter?.channelType === 'line';
}
