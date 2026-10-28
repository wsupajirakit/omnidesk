/**
 * Event reception and routing for the LINE webhook.
 * Legacy `webhookController.js:2320-3920` — the gate sequence, extracted.
 *
 * ⚠️ These gates are ORDERED, and the order is the behaviour. Two examples that
 *    look arbitrary and are not:
 *
 *    · The silent-type gate sits BEFORE the rate limiter, so a sticker is
 *      neither answered nor counted against the customer's quota. Moving the
 *      limiter up would start charging quota for stickers.
 *      ([FIX-20260728-RATELIMIT] moved the limiter to exactly this spot so that
 *      images WOULD be counted — they previously slipped past it entirely.)
 *    · The out-of-hours gate (`hook.status === 0`) sits AFTER the non-text
 *      branch, so a disabled OA still answers an image with `image_answer_text`.
 *
 * This module DECIDES; it performs no I/O. That is what makes every branch
 * testable without a database, a LINE token, or a model call.
 */
import { providerFeatureOn } from '@/modules/customer-provider';

/** Message types that are logged and then answered with silence. Legacy:3010. */
export const SILENT_MESSAGE_TYPES = ['sticker', 'file', 'video', 'audio'];

/** Non-text types eligible for `image_answer_text`. Legacy:3389. */
export const NON_TEXT_AUTO_REPLY_TYPES = ['image', 'video', 'sticker', 'audio'];

/** The keyword that mints a customer-registration link. Legacy CUSTREG. */
export const CUSTOMER_REGISTER_KEYWORD = 'customer-register';

/**
 * Every terminal outcome of the ingest pipeline.
 *
 * `reachesAi` on each is the answer to the question this port exists to make
 * checkable: which inbound events can cost money. Only ONE outcome does.
 */
export type RouteOutcome =
  /** `events` absent or empty — legacy returns OK without touching anything. */
  | { kind: 'no_event'; reachesAi: false }
  /** Alias in the path resolved to no hook. Legacy:2358 — HTTP 404 on the
   *  background path, which the caller has already answered 200 for. */
  | { kind: 'unknown_alias'; reachesAi: false }
  /** Our own retry-button postback, consumed by the handoff chain. Legacy:2487. */
  | { kind: 'chain_postback'; reachesAi: false }
  /** An admin is handling this room; the message is stored, nothing is sent. */
  | { kind: 'assist_skip'; reachesAi: false }
  /** Sticker / file / video / audio: stored, silent. Legacy:3010-3013. */
  | { kind: 'silent_type'; messageType: string; reachesAi: false }
  /** Quota exceeded — the fixed "please wait" reply. Legacy:3301. */
  | { kind: 'rate_limited'; reachesAi: false }
  /** The `customer-register` keyword handler answered. Legacy:3369. */
  | { kind: 'customer_register_keyword'; reachesAi: false }
  /** Non-text with `image_answer_text` configured. Legacy:3392. */
  | { kind: 'image_answer'; messageType: string; reachesAi: false }
  /** Non-text with nothing configured to say. Legacy:3855. */
  | { kind: 'non_text_no_answer'; messageType: string; reachesAi: false }
  /** OA switched off. `silent` follows `status_off_action`. Legacy:3859. */
  | { kind: 'out_of_hours'; silent: boolean; text: string; reachesAi: false }
  /** OA off and the event carries no reply token (e.g. unfollow). Legacy:3867. */
  | { kind: 'out_of_hours_no_reply_token'; reachesAi: false }
  /** No text to ask about — follow, unfollow, join, leave, postback, … Legacy:3917. */
  | { kind: 'no_text'; eventType: string; reachesAi: false }
  /** The ONLY outcome that reaches the model. */
  | { kind: 'ai_reply'; userText: string; reachesAi: true };

export interface RoutingEvent {
  type?: string;
  replyToken?: string;
  timestamp?: number;
  source?: { userId?: string };
  message?: { type?: string; text?: string; id?: string };
  postback?: { data?: string };
}

export interface RoutingHook {
  status?: number;
  status_off_action?: string;
  status_off_text?: string;
  image_answer_text?: string;
  customer_link_enabled?: boolean;
}

export interface RoutingInput {
  event: RoutingEvent | undefined;
  hook: RoutingHook | null | undefined;
  /** True when the path carried an alias that resolved to nothing. */
  unknownAlias?: boolean;
  /** The handoff chain claimed this postback. */
  chainHandledPostback?: boolean;
  /** An admin holds this room and the auto-unassist timeout did not fire. */
  skipBotProcessing?: boolean;
  /** The `customer-register` handler ran and reported success. */
  customerRegisterHandled?: boolean;
  /** The per-user quota was exceeded. */
  rateLimited?: boolean;
}

/** The exact wording the bot has always sent when closed. Legacy statusOffReply.js:20. */
export const LEGACY_OFF_TEXT =
  'อยู่นอกเวลาทำการ กรุณาติดต่อใหม่อีกครั้งในภายหลังหรือติดต่อเจ้าหน้าที่';

/**
 * How a switched-off OA should respond. Legacy `services/core-bot/statusOffReply.js`.
 *
 * ⚠️ `silent` means "do not REPLY" only. The inbound message was already stored
 *    earlier in the pipeline, so "เงียบแต่เก็บแชท" holds without the storage
 *    path knowing anything about this setting.
 *
 * An OA that never set these fields resolves to `{ silent:false, LEGACY_OFF_TEXT }`
 * — exactly the pre-feature behaviour.
 */
export function resolveStatusOffReply(hook: RoutingHook | null | undefined): {
  silent: boolean;
  text: string;
} {
  const action =
    hook && typeof hook.status_off_action === 'string'
      ? hook.status_off_action
      : '';
  if (action === 'silent') return { silent: true, text: '' };
  // '' (unset / legacy) and 'reply' both reply; a blank custom text falls back.
  const custom =
    hook && typeof hook.status_off_text === 'string'
      ? hook.status_off_text.trim()
      : '';
  return { silent: false, text: custom || LEGACY_OFF_TEXT };
}

/** Does this text exactly match the registration keyword? Legacy:3373. */
export function isCustomerRegisterKeyword(
  event: RoutingEvent | undefined,
  hook: RoutingHook | null | undefined,
): boolean {
  return (
    event?.type === 'message' &&
    event.message?.type === 'text' &&
    hook?.customer_link_enabled === true &&
    /* [FEAT-20261014-PROVFEATURES] no register world on this site (loan_v1) ⇒ the keyword is
       ordinary text: the ladder step and the assist bypass both ask this one predicate. */
    providerFeatureOn('register') &&
    String(event.message.text ?? '')
      .trim()
      .toLowerCase() === CUSTOMER_REGISTER_KEYWORD
  );
}

/**
 * Run the gates in legacy's order and report where the event comes to rest.
 *
 * ⚠️ THIS FUNCTION JUDGES EXACTLY ONE EVENT, and always will. It is given an event, not a
 *    delivery, and it holds no state between calls — which is what lets the caller ask it
 *    the same question about several events in a row.
 *
 * ⚠️ [FEAT-20260905-MULTIEVENT] Iteration now lives in `processWebhook`
 *    (`event-iteration/run-delivery-events.ts`), which is the one place the event array
 *    is unpacked. It used to be true that only `events[0]` was ever considered anywhere —
 *    legacy read `req.body.events?.[0]` and never iterated, so every later event in a
 *    batch was silently discarded. That is no longer a property of the system; it is a
 *    property of the switch being off. Nothing about THIS function changed either way.
 */
export function routeEvent(input: RoutingInput): RouteOutcome {
  const { event, hook } = input;

  // 1. No event at all. Legacy:2321-2322 — before the signature check even.
  if (!event) return { kind: 'no_event', reachesAi: false };

  // 2. Alias that resolves to nothing. Legacy:2358.
  if (input.unknownAlias) return { kind: 'unknown_alias', reachesAi: false };

  // 3. Our own retry-button postback. Legacy:2487-2493. A postback without the
  //    chain prefix, or the flag off, falls through to the normal flow.
  if (event.type === 'postback' && input.chainHandledPostback) {
    return { kind: 'chain_postback', reachesAi: false };
  }

  const userId = event.source?.userId;
  const messageType = event.message?.type;

  /**
   * Gates 4-8 live inside `if (userId)` in legacy (2587). An event with no
   * `source.userId` — some group and room events — skips profile fetch, history
   * logging, the silent-type gate, assist, the rate limiter and the non-text
   * branch entirely, and lands on the out-of-hours / no-text gates below.
   */
  if (userId) {
    // 4. Silent types: stored above this point, then nothing. Legacy:3010-3013.
    if (messageType && SILENT_MESSAGE_TYPES.includes(messageType)) {
      return { kind: 'silent_type', messageType, reachesAi: false };
    }

    // 5. An admin holds the room. Legacy:3015. The registration keyword is the
    //    one thing still answered here ([FIX-20260729-CUSTREGASSIST]) — it is
    //    the moment a customer is most likely to type it.
    if (input.skipBotProcessing) {
      if (input.customerRegisterHandled) {
        return { kind: 'customer_register_keyword', reachesAi: false };
      }
      return { kind: 'assist_skip', reachesAi: false };
    }

    // 6. Rate limit. Legacy:3295 — `event.type === 'message'` only, so
    //    follow/unfollow/postback neither consume quota nor get told to wait.
    if (event.type === 'message' && input.rateLimited) {
      return { kind: 'rate_limited', reachesAi: false };
    }

    // 7. Registration keyword on the normal path — after the limiter, so it is
    //    counted like any other message and cannot be used to spam. Legacy:3369.
    if (
      isCustomerRegisterKeyword(event, hook) &&
      input.customerRegisterHandled
    ) {
      return { kind: 'customer_register_keyword', reachesAi: false };
    }

    // 8. Non-text message. Legacy:3388.
    if (event.type === 'message' && messageType !== 'text') {
      const eligible =
        !!messageType && NON_TEXT_AUTO_REPLY_TYPES.includes(messageType);
      if (eligible && hook?.image_answer_text) {
        return {
          kind: 'image_answer',
          messageType: messageType,
          reachesAi: false,
        };
      }
      return {
        kind: 'non_text_no_answer',
        messageType: messageType ?? 'unknown',
        reachesAi: false,
      };
    }
  }

  // 9. OA switched off. Legacy:3859 — deliberately AFTER the non-text branch.
  if (hook?.status === 0) {
    // [FIX-20260728-REPLYTOKEN] An unfollow carries no reply token, and firing
    // a reply with `undefined` made LINE answer 400 every time somebody blocked
    // the account, filling the error log.
    if (!event.replyToken) {
      return { kind: 'out_of_hours_no_reply_token', reachesAi: false };
    }
    const { silent, text } = resolveStatusOffReply(hook);
    return { kind: 'out_of_hours', silent, text, reachesAi: false };
  }

  // 10. Nothing to ask about. Legacy:3916-3920. This is where follow, unfollow,
  //     join, leave, memberJoined, memberLeft, videoPlayComplete, beacon,
  //     accountLink, things, and any future event type come to rest — none of
  //     them carries `message.text`. Also where a postback lands: `postback.data`
  //     is NOT read as user text.
  const userText = event.message?.text;
  if (!userText) {
    return {
      kind: 'no_text',
      eventType: event.type ?? 'unknown',
      reachesAi: false,
    };
  }

  // 11. The single path that reaches the model.
  return { kind: 'ai_reply', userText, reachesAi: true };
}

/**
 * The reply-staleness guard. Legacy:4730-4738.
 *
 * On 2026-07-27 a request stalled 986 seconds and then sent its reply using a
 * reply token minted 16 minutes earlier. LINE accepted it and DELIVERED it, so
 * the customer got a ghost message long after an admin had closed the case.
 *
 * ⚠️ 120s, not 60: the worst normal budget for this flow is a 30s model call
 *    plus a 25s assist budget = 55s. Double that, so nothing healthy is cut.
 */
export const REPLY_STALE_MS = 120 * 1000;

export function isReplyStale(
  eventTimestamp: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!eventTimestamp) return false;
  return now - Number(eventTimestamp) > REPLY_STALE_MS;
}
