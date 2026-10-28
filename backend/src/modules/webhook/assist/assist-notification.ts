/**
 * =====================================================================
 * The [[[assist]]] hand-off — bot to human.
 * =====================================================================
 *
 * TRANSCRIBED, not redesigned. Source of truth:
 *   legacy-api/src/controllers/core-bot/webhookController.js
 *   · triggerAssistNotification  260-780
 *   · runAssistGuarded           800-821
 *
 * When the model answers with `[[[assist]]]` the bot is saying "a human should
 * take this". Three things have to happen for that to be true, and before this
 * file existed none of them did: the room is claimed so the bot stops replying,
 * a ticket is created so the case appears in the operator's queue, and Telegram
 * is told so somebody looks. The customer was already being told
 * "ขอส่งให้พี่แอดมินดูแลต่อนะคะ" — this is the part that made it true.
 *
 * ⚠️ THE ORDER OF THE FIRST THREE STEPS IS LOAD-BEARING and is not the order a
 *    fresh design would pick. Legacy claims the room and creates the ticket
 *    BEFORE asking the model for a summary, then patches the summary in
 *    afterwards. Its comment at `:177` says why: "สร้าง ticket ทันทีก่อนเรียก AI
 *    — AI ช้าหรือพังก็ยังมีเคสให้แอดมินเห็นไม่หลุด". A model call is the slowest
 *    and least reliable step, and a hand-off that loses the case when it fails
 *    is worse than one with a placeholder summary. Do not "tidy" this into
 *    summarise-then-write.
 *
 * ⚠️ THE MODEL IS NEVER CALLED FROM HERE. The one generative call sits behind
 *    `AssistSummaryProvider.summarise`; see `assist-summary.provider.ts` for why
 *    that is a hard seam. Everything else in this file runs without it.
 */

import { adoptsModelCategory } from '@/modules/customer-provider';

import { errText } from '../logging/coerce-mask.util';
import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';

import type {
  AssistSummaryProvider,
  AssistSummaryResponse,
} from '../ai-vendors/gemini/assist-summary.provider';

import type { WebhookLogEvent } from '../logging';
import { buildRoomFilter } from '../room-bootstrap/room-filter';

const logger = new Logger('AssistNotification');

/** legacy:254 — matches the marker with either three or two closing brackets. */
const ASSIST_PATTERN = /\[\[\[assist\]\]\]?/i;

/** Same pattern, global, for stripping. legacy:280 and :4497. */
const ASSIST_STRIP_PATTERN = /\[\[\[assist\]\]\]?/gi;

/**
 * legacy:183 — "ตรงกับอายุ replyToken ตามสเปค LINE".
 *
 * A job that woke up later than this must not act: by then an operator has most
 * likely already picked the case up by hand, and a late claim would steal it
 * back from them.
 */
const STALE_ASSIST_MS = 60 * 1000;

/**
 * legacy:549 — the ceiling on how long the customer's reply waits for assist.
 *
 * 25s, against a LINE reply token that expires at 60s. See `runAssistGuarded`.
 */
export const ASSIST_BUDGET_MS = 25 * 1000;

/** legacy:100 — the number that was hardcoded as `.limit(10)`. Do not change it. */
const NEED_DETAIL_DEFAULT = 10;

/**
 * legacy:101 — how many messages the flex-error check looks back over.
 *
 * ⚠️ The same number as `NEED_DETAIL_DEFAULT` BY COINCIDENCE ONLY, and legacy's
 *    comment at `:90-94` is emphatic that they must not be merged. This one is
 *    pinned at 10 forever; the other is operator-configurable. If they were
 *    allowed to move together, an operator raising "how many messages to
 *    summarise" to 30 would silently flip ticket CATEGORIES, because a longer
 *    window changes whether prior customer messages are found below.
 */
const FLEX_HISTORY_WINDOW = 10;

/** legacy:112 — a bad DB value must not pull thousands of rows. */
const NEED_DETAIL_MAX = 30;

/** legacy:391 — every Telegram call carries a timeout. */
const TELEGRAM_HTTP_TIMEOUT_MS = 10_000;

/**
 * The shape the caller supplies for reading and writing rooms/messages/tickets.
 *
 * ⚠️ `Model<any>` is deliberate and is the narrowest thing that actually works.
 *    The three collections arrive here under three different generics —
 *    `Model<ChatRoom>` is a hydrated document type, the other two are
 *    `Model<Record<string, unknown>>` — and Mongoose's overloaded `findOne` /
 *    `findOneAndUpdate` signatures are not mutually assignable across them.
 *    Naming a concrete type forces a cast at every call site AND in every test,
 *    which buys no safety: every field this file touches is read through
 *    `doc['field']` and typed at the point of use.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AssistDeps {
  chatRoomModel: Model<any>;
  chatMessageModel: Model<any>;
  ticketModel: Model<any>;
  /**
   * [FIX-20260808-FIRSTMSGTICKET] The members collection, so the ticket gate
   * below can materialise a Member when the customer's very first message
   * triggers assist (see the gate for the full rationale). Optional so existing
   * callers/tests that never hit that path need no change.
   */
  memberModel?: Model<any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  /** The seam. Rejecting is a supported state — see the provider header. */
  summaryProvider: AssistSummaryProvider;
  /**
   * legacy:314 — `aiCategoryConfig.isAiSumCategoryEnabled()`. With it false the
   * model's category is discarded and the payment-flex default stands.
   */
  isAiCategoryEnabled: () => Promise<boolean>;
  /** legacy `persistWebhookLog`. */
  /* [FEAT-20260815-WLOGDOOR] typed to the door's contract. TYPE-ONLY: the
     literals below are untouched and TypeScript erases this at compile time —
     the emitted JS is byte-identical, which is how this change is proved.
     Import is relative because `logging/` is deliberately NOT on the module
     barrel (other modules must not reach the door). */
  persistWebhookLog: (entry: WebhookLogEvent) => Promise<void>;
  /**
   * [FIX-20260808-ASSISTTICKETRT] Emit the realtime `ticket:new` event so an
   * assist-created ticket appears on the operator's board immediately, instead
   * of only on the next poll. Ports legacy `publishTicketEvent("ticket:new",…)`
   * (webhookController.js:509-527) — the API create path already emits this via
   * TicketsService; the webhook/assist path was the missing half. Optional so
   * tests that do not assert realtime need no change.
   */
  publishTicketEvent?: (
    ticketId: unknown,
    hookId: unknown,
    jobStatus: number,
    category: string | null,
  ) => void;
  /** legacy:267 — the auto-ticket divider. Fire-and-forget, cosmetic. */
  logSystemMessage?: (args: {
    memberId: unknown;
    hookId: unknown;
    messageType: string;
    content: string;
    metadata: Record<string, unknown>;
  }) => Promise<unknown>;
  /** Injectable so tests never open a socket. Defaults to `fetch`. */
  postJson?: (
    url: string,
    body: unknown,
    timeoutMs: number,
  ) => Promise<{ status: number; data: unknown }>;
}

/** legacy:11-53 — the parameter list, one for one. Defaults are legacy's. */
export interface AssistNotificationArgs {
  userId: string;
  userText: string;
  rawAnswer: string | null | undefined;
  telegramKey?: string | null;
  telegramChatId?: string | null;
  customerName?: string;
  customerTel?: string;
  contractCode?: string;
  bangkokTime?: string;
  geminiApiKey?: string;
  alias?: string;
  eventId?: string;
  logContext?: Record<string, unknown>;
  skipAI?: boolean;
  mediaUrl?: string | null;
  lineDisplayName?: string;
  slipError?: { code?: string; message?: string } | null;
  telegramNotiType?: string | null;
  incomingMsgType?: string;
  chatMsgId?: unknown;
  userMongoId?: unknown;
  isPaymentFlex?: boolean;
  /**
   * [FIX-20260812-REFUSEDMARKERS] force the ticket's category, bypassing the
   * payment-flex/AI resolution below.
   *
   * WHY IT EXISTS: a caller sometimes KNOWS what the case is about before any of the
   * usual signals are available. The unlinked-slip refusal is the first such caller —
   * see its note in `webhook.service.ts` (grep REFUSEDMARKERS).
   *
   * ⚠️ SEPARATE FROM `isPaymentFlex` ON PURPOSE. That flag does more than pick a
   *    category (it also skips the slip-error branch at `:654`), so reusing it to mean
   *    "category = Payment" would drag unrelated behaviour along with it. This field
   *    touches the category and nothing else.
   *
   * null/undefined ⇒ nothing changes; every existing caller keeps the old resolution.
   */
  forcedTicketCategory?: string | null;
  /** legacy:37 — LINE's own event stamp, for the staleness guard. null = no check. */
  eventTimestamp?: number | null;
  /** legacy:45 — set only when an automatic un-assign preceded this call. */
  autoUnassistMinutes?: number | null;
  /** legacy:52 — raw `hook.ai_need_detail_limit`; null means "never configured". */
  aiNeedDetailLimit?: number | string | null;
  /**
   * [P2-20260813] The hook's AI vendor and model, carried to the summary
   * provider so a hand-off summary uses the same vendor the OA answers with.
   * Both nullable — absent means the default vendor / that vendor's default
   * model, which is what every hook resolves to today.
   */
  aiVendor?: string | null;
  aiModel?: string | null;
  /**
   * [FEAT-20260909-DSREASONING] The MAIN lane's reasoning choice, threaded from
   * the same credentials bundle the reply path uses — the owner ruled the
   * summary shares the bot's setting rather than having one of its own.
   * Optional and null for every OA that has not set it.
   */
  aiReasoning?: {
    type: 'enabled' | 'disabled';
    effort?: 'low' | 'high' | 'max';
  } | null;
}

/* legacy:250 — `buildRoomFilter` is imported from `room-bootstrap/room-filter.ts`, which
   holds the one copy for the whole module. */

/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

/** The default transport. Kept out of the flow so a test can replace it. */
async function defaultPostJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Telegram HTTP ${res.status}`) as Error & {
      response?: { status: number; data: unknown };
    };
    err.response = { status: res.status, data };
    throw err;
  }
  return { status: res.status, data };
}

/**
 * legacy:107-113 — interpret the per-OA `ai_need_detail_limit`.
 *
 * ⚠️ THE NULL CHECK MUST COME BEFORE THE NUMBER CONVERSION, and legacy's comment
 *    at `:103-106` explains the trap: `Number(null)` is `0`, and `0` is a
 *    MEANINGFUL value in this feature — it means "do not call the model at all".
 *    Convert first and every OA that never configured the field reads as a
 *    deliberate 0, which would switch AI summaries off across the entire system
 *    in one deploy. Hence `>= 0`, not `> 0`.
 */
export function resolveNeedDetailLimit(
  raw: number | string | null | undefined,
): number {
  const isSet =
    (typeof raw === 'number' || typeof raw === 'string') &&
    String(raw).trim() !== '';
  const parsed = isSet ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(Math.trunc(parsed), NEED_DETAIL_MAX)
    : NEED_DETAIL_DEFAULT;
}

/** legacy:80 — what Telegram is shown. The stored row keeps its marker. */
export function stripAssistMarker(text: string | null | undefined): string {
  return (text ?? '').replace(ASSIST_STRIP_PATTERN, '').trim();
}

/**
 * legacy:260-780 — the hand-off itself.
 *
 * Returns nothing; every failure below is contained rather than thrown, because
 * the caller is on the customer's reply path.
 */
export async function triggerAssistNotification(
  args: AssistNotificationArgs,
  deps: AssistDeps,
): Promise<void> {
  const {
    userId,
    userText,
    rawAnswer,
    telegramKey,
    telegramChatId,
    customerName = 'N/A',
    customerTel = 'N/A',
    contractCode = 'N/A',
    bangkokTime = '',
    geminiApiKey,
    alias,
    eventId,
    logContext,
    skipAI = false,
    mediaUrl = null,
    lineDisplayName = 'N/A',
    slipError = null,
    telegramNotiType = 'all',
    incomingMsgType = 'text',
    chatMsgId = null,
    userMongoId = null,
    isPaymentFlex = false,
    forcedTicketCategory = null,
    eventTimestamp = null,
    autoUnassistMinutes = null,
    aiNeedDetailLimit = null,
    aiVendor = null,
    aiModel = null,
    aiReasoning = null,
  } = args;

  const postJson = deps.postJson ?? defaultPostJson;

  /**
   * `chatMsgId` arrives as `unknown` — an ObjectId off a lean document at one
   * call site, a plain string at the other. Normalised once here so the log line
   * and the flex-error comparison below agree on its text form.
   *
   * ⚠️ Goes through the object's own `toString`, which for an ObjectId is its
   *    24-char hex. `JSON.stringify` would wrap it in quotes and the id
   *    comparison in the flex-error block would then never match.
   */
  const idText = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    // An ObjectId. Its own `toString` is the 24-char hex; anything without a
    // meaningful one yields '[object Object]', which simply never matches — the
    // safe direction, since a false match would drop a real prior message.
    return (v as { toString(): string }).toString();
  };
  const chatMsgIdStr = idText(chatMsgId);

  // legacy:254-256 — no marker, nothing to do. This is the microsecond return
  // that makes wrapping the whole thing in a 25s race free on the normal path.
  if (!ASSIST_PATTERN.test(rawAnswer ?? '')) return;

  // legacy:58-66 — the per-OA notification filter, checked before any work.
  const effectiveNotiType = telegramNotiType || 'all';
  if (effectiveNotiType === 'text' && incomingMsgType !== 'text') {
    logger.log(
      `[ASSIST] Notification skipped. Type is 'text' but incoming was '${incomingMsgType}'.`,
    );
    return;
  }
  if (effectiveNotiType === 'image' && incomingMsgType !== 'image') {
    logger.log(
      `[ASSIST] Notification skipped. Type is 'image' but incoming was '${incomingMsgType}'.`,
    );
    return;
  }

  logger.log(`[ASSIST] Tag detected for user: ${userId}.`);

  // legacy:70-77 — handing a conversation to an admin means creating a ticket
  // and stopping the bot from replying. Telegram is how that hand-off is
  // announced, not what it consists of — so a hook with no Telegram credentials
  // still performs the hand-off, it just does not announce it.
  const canNotifyTelegram = !!(telegramKey && telegramChatId);
  if (!canNotifyTelegram) {
    logger.log(
      '[ASSIST] No Telegram credentials on this hook — continuing without a notification.',
    );
  }

  const telegramStart = Date.now();
  const cleanAnswerForTelegram = stripAssistMarker(rawAnswer);

  const needDetailLimit = resolveNeedDetailLimit(aiNeedDetailLimit);
  // legacy:115 — configured 0 means no model call; inbound media already skips it.
  const useAiSummary = !skipAI && needDetailLimit > 0;
  // legacy:117 — fetch enough for whichever window is longer, then slice per use.
  const historyFetchLimit = Math.max(FLEX_HISTORY_WINDOW, needDetailLimit);

  // ── 1. Room and history ──────────────────────────────────────────────
  let historyStr = '';
  let mongoChatId = '';
  let historyMsgs: Array<Record<string, unknown>> = [];
  try {
    const room = await deps.chatRoomModel
      .findOne(buildRoomFilter(userId, logContext?.['hook_id']))
      .lean<Record<string, unknown>>()
      .exec();

    if (room) {
      mongoChatId = String(room['_id']);

      // legacy:135-138 — already assisted, so a human owns this conversation.
      // Bail before the ticket and before Telegram: a second card for a case an
      // operator is already handling is noise, and a second ticket is a duplicate.
      if (room['assist_status'] === true) {
        logger.log(
          `[ASSIST] User is currently assisted. Bypassing Telegram and Ticket creation.`,
        );
        return;
      }

      if (!skipAI) {
        historyMsgs = await deps.chatMessageModel
          .find({ room_id: room['_id'] })
          .sort({ created_at: -1 })
          .limit(historyFetchLimit)
          .lean<Array<Record<string, unknown>>>()
          .exec();

        // legacy:151-157 — only assemble the transcript if it will be sent.
        if (useAiSummary) {
          historyStr = historyMsgs
            .slice(0, needDetailLimit)
            .reverse()
            .map(
              (m) =>
                `${m['sender_type'] === 'customer' ? 'ลูกค้า' : 'บอท'}: ${
                  typeof m['content'] === 'string' ? m['content'] : ''
                }`,
            )
            .join('\n');
        }
      }
    }
  } catch (err) {
    logger.error(`[ASSIST] History fetch error: ${errText(err)}`);
  }

  // ── 2. Staleness guard ───────────────────────────────────────────────
  //
  // legacy:164-194. The incident this exists for, from legacy's own comment:
  // on 2026-07-27 a request hung on the query above for 986 seconds (a dead
  // socket with no `socketTimeoutMS`). While it hung the customer wrote again,
  // the second request read `assist_status` as false too — because the first had
  // not reached the write — and BOTH passed the duplicate check. Two tickets,
  // and the first one woke up at 22:49 and sent a ghost message.
  //
  // The read above is not a guard against that; it is a snapshot that can be
  // stale by the time it is used. This block and the atomic claim below are.
  if (eventTimestamp) {
    const ageMs = Date.now() - Number(eventTimestamp);
    if (ageMs > STALE_ASSIST_MS) {
      logger.warn(
        `[ASSIST] Stale event (${Math.round(ageMs / 1000)}s old, limit ${STALE_ASSIST_MS / 1000}s) — ` +
          `suppressing ticket/assist for ${userId}. งานนี้ค้างนานเกินไป แอดมินน่าจะรับเคสไปแล้ว`,
      );
      return;
    }
  }

  // ── 3. Atomic claim ──────────────────────────────────────────────────
  //
  // legacy:199-202. `findOneAndUpdate` with `assist_status: {$ne: true}` in the
  // FILTER is what makes this safe: MongoDB applies the match and the update as
  // one operation, so of any number of concurrent events exactly one gets a
  // document back and the rest get null. Reading then writing — which is what
  // the code before this fix did — leaves a window between the two where both
  // callers believe they are first.
  let claimedRoom: unknown = null;
  try {
    claimedRoom = await deps.chatRoomModel
      .findOneAndUpdate(
        {
          ...buildRoomFilter(userId, logContext?.['hook_id']),
          assist_status: { $ne: true },
        },
        { $set: { assist_status: true, last_assist_changed_at: new Date() } },
      )
      .exec();
  } catch (claimErr) {
    logger.error(`[ASSIST] Claim failed: ${errText(claimErr)}`);
    return;
  }

  if (!claimedRoom) {
    // legacy:209-226 — no document came back, and the two reasons for that need
    // OPPOSITE responses, so they must be told apart:
    //   1) the room exists and is already claimed → someone else won, stop.
    //   2) no room matches the filter at all → there was never anything to race
    //      over, and legacy's pre-fix behaviour was to create the ticket anyway.
    // Returning on both looks tidier and drops a ticket on the floor. Legacy's
    // comment records finding exactly that: "เจอจริงตอนเทส endpoint เคส 3b
    // ticket หายไป 1 ใบ".
    const existingRoom = await deps.chatRoomModel
      .findOne(buildRoomFilter(userId, logContext?.['hook_id']))
      .lean<Record<string, unknown>>()
      .exec()
      .catch(() => null);
    if (existingRoom) {
      logger.log(
        `[ASSIST] Hand-off already claimed for ${userId} — skipping duplicate ticket.`,
      );
      return;
    }
    logger.warn(
      `[ASSIST] No chat room matched for ${userId} — creating the ticket without an assist claim ` +
        `(คงพฤติกรรมเดิม: ไม่มีห้องก็ยังต้องออก ticket)`,
    );
  } else {
    logger.log(`[ASSIST] Claimed hand-off (assist_status=true) for ${userId}.`);
  }

  // ── 4. Ticket, with a placeholder summary ────────────────────────────
  //
  // legacy:231-281. Created here, before the model call, so a slow or failed
  // summary cannot cost the operator the case. The real summary is patched in at
  // the end.
  // [FIX-20260808-FIRSTMSGTICKET] First-message quirk, fixed here to match legacy
  // byte-for-byte (webhookController.js ticket gate).
  //
  // The gate below needs a Member `_id`. On a customer's VERY FIRST message the
  // Member row does not exist yet — the profile sync upstream only upserts it
  // when the LINE profile fetch succeeds, so if that fetch returns nothing (no
  // token / LINE slow / network) `userMongoId` arrives null, the gate fails, and
  // the room is claimed with NO ticket. Legacy and this port shared that gap.
  //
  // Decision (owner, 2026-08-08): when assist fires with a message but no Member,
  // materialise a MINIMAL Member (ids only, no profile fields — the next message
  // fills those via the normal sync) and use its `_id`. Scoped hard to the exact
  // quirk: it runs ONLY when `chatMsgId` is present AND `userMongoId` is missing,
  // so every already-linked customer keeps the identical path. Applied
  // identically in legacy webhookController.js:483.
  let effectiveUserMongoId = userMongoId;
  if (chatMsgId && !effectiveUserMongoId && userId && deps.memberModel) {
    try {
      await deps.memberModel
        .updateOne(
          { line_user_id: userId },
          { $set: { line_user_id: userId, member_user_id: userId } },
          { upsert: true },
        )
        .exec();
      const created = await deps.memberModel
        .findOne({ member_user_id: userId })
        .lean<{ _id?: unknown }>()
        .exec();
      effectiveUserMongoId = created?._id;
      logger.log(
        `[ASSIST] First-message Member materialised for ${userId} so the ticket can be created.`,
      );
    } catch (err) {
      // A failed upsert must never break the assist claim already made — fall
      // through with a null id, exactly the pre-fix behaviour.
      logger.warn(
        `[ASSIST] First-message Member upsert failed for ${userId}: ${errText(err)}`,
      );
    }
  }

  let createdTicket: { _id?: unknown } | null = null;
  if (chatMsgId && effectiveUserMongoId) {
    try {
      createdTicket = await deps.ticketModel.create({
        line_oa_hook_id: logContext?.['hook_id'],
        chat_msg_id: chatMsgId,
        // [FIX-20260808-FIRSTMSGTICKET] Use effectiveUserMongoId, NOT userMongoId
        // — on a first message the id comes from the fallback upsert above. Every
        // other case it equals userMongoId, so the linked path is unchanged.
        line_user_id: effectiveUserMongoId,
        // legacy:240 — the same value `ticketCategory` starts at below.
        /* [FIX-20260812-REFUSEDMARKERS] an explicit category from the caller wins;
           otherwise the original payment-flex rule is untouched. */
        category: forcedTicketCategory ?? (isPaymentFlex ? 'Payment' : 'Other'),
        need_detail: 'ลูกค้าต้องการความช่วยเหลือ',
        chat_status: 'bot',
        job_status: 0,
      });
      logger.log(
        `[ASSIST] Ticket created successfully for msgId ${chatMsgIdStr}`,
      );

      // [FIX-20260808-TICKETRTMOVE] P1-4 — the ticket:new emit MOVED to after the
      // AI-summary enrich below (see section 8), so the event carries the FINAL
      // category + job_status instead of the placeholder. Legacy emits post-enrich
      // (webhookController.js:797-807), which is what the FE badge/category chip
      // reads live.

      // legacy:247-277 — when the re-assist timeout un-assigned this conversation
      // and the customer wrote again, a case appears in the transcript from
      // nowhere. This divider says which threshold opened it. Fires only when
      // `autoUnassistMinutes` was passed, which is one call path.
      //
      // Fire-and-forget: a missing divider is cosmetic and must never be able to
      // fail the ticket that was just created.
      if (
        autoUnassistMinutes &&
        // [FIX-20260808-FIRSTMSGTICKET] effectiveUserMongoId here too, so the
        // divider references the same Member the ticket was opened for.
        effectiveUserMongoId &&
        logContext?.['hook_id'] &&
        deps.logSystemMessage
      ) {
        void deps
          .logSystemMessage({
            memberId: effectiveUserMongoId,
            hookId: logContext['hook_id'],
            messageType: 'divider',
            content: `เปิดเคสอัตโนมัติ จากเงื่อนไข re-assist ${autoUnassistMinutes} นาที`,
            metadata: {
              variant: 'auto_ticket',
              auto_unassist_minutes: autoUnassistMinutes,
            },
          })
          .catch((e: unknown) =>
            logger.error(
              `[AUTOTICKET] divider ไม่สำเร็จ (ticket ยังถูกสร้างปกติ): ${errText(e)}`,
            ),
          );
      }
    } catch (ticketErr) {
      logger.error(`[ASSIST] Failed to create Ticket: ${errText(ticketErr)}`);
    }
  }

  // ── 5. Summary and category ──────────────────────────────────────────
  let aiAnalysis = '';
  let ticketCategory =
    forcedTicketCategory ?? (isPaymentFlex ? 'Payment' : 'Other');
  if (isPaymentFlex) {
    logger.log(
      "[ASSIST] Payment flex detected. Category locked to 'Payment'. AI will only provide summary.",
    );
  }

  if (skipAI) {
    // legacy:292
    aiAnalysis = `(Media Message) ลูกค้าส่งไฟล์สื่อ (${userText}) เข้ามาในระบบครับ`;
  } else if (!useAiSummary) {
    // legacy:293-309 — the operator set the limit to 0, so `need_detail` is the
    // customer's own latest message.
    //
    // ⚠️ `ticketCategory` is deliberately left at the default here. Legacy's
    //    comment at `:300-303` confirms it is intended, not an oversight: the
    //    line that adopts the model's category lives in the `else` branch below,
    //    which this path never enters. So a slip is still "Payment" and
    //    everything else "Other" — with no model call made.
    logger.log(
      "[ASSIST] need_detail limit = 0 — skipping AI, using the customer's latest message.",
    );
    aiAnalysis = (userText || '').trim() || 'ลูกค้าต้องการความช่วยเหลือ';
  } else {
    logger.log('[ASSIST] Invoking AI Analysis for Admin...');
    // legacy:312-314 — started BEFORE the model call and awaited after it, so the
    // config lookup overlaps the request instead of delaying it.
    const aiCategoryEnabledPromise = deps.isAiCategoryEnabled();
    let aiResult: AssistSummaryResponse | string;
    try {
      aiResult = await deps.summaryProvider.summarise({
        history: historyStr,
        currentQuestion: userText,
        currentAnswer: cleanAnswerForTelegram,
        geminiApiKey,
        aiVendor,
        aiModel,
        reasoning: aiReasoning,
      });
    } catch (aiErr) {
      // Not in legacy, because legacy's `analyzeConversationForAdmin` swallows
      // its own failures and returns the Thai error string as the summary. With
      // the call behind a seam the rejection surfaces here instead, so it is
      // mapped to the SAME string legacy would have produced
      // (`rag-engine.service.ts:1832`) and the flow continues — the ticket
      // already exists and the operator still gets the case.
      logger.error(`[ASSIST] AI analysis failed: ${errText(aiErr)}`);
      aiResult = {
        summary: 'เกิดข้อผิดพลาดในการวิเคราะห์บทสนทนา',
        category: 'Other',
      };
    }
    const aiCategoryEnabled = await aiCategoryEnabledPromise.catch(() => false);
    if (typeof aiResult === 'object') {
      aiAnalysis = aiResult.summary;
      // legacy:324-331 — the model's category is adopted ONLY when categorisation
      // is switched on. With it off the ticket keeps the category resolved from
      // the payment-flex condition alone; the summary is unaffected either way.
      /* [FIX-20260812-REFUSEDMARKERS] `!forcedTicketCategory` — a caller that stated
         the category must not have it overwritten by the model. */
      /* [FEAT-20261015-TICKETCATADOPT] a provider that declares categories (loan) decides
         instead of the config row: the answer is adopted iff it is in its list. shop-api
         declares none ⇒ `aiCategoryEnabled` exactly as before. */
      if (
        !isPaymentFlex &&
        !forcedTicketCategory &&
        adoptsModelCategory(aiResult.category, aiCategoryEnabled)
      ) {
        ticketCategory = aiResult.category;
      }
    } else {
      // legacy:332-334 — `analyzeConversationForAdmin` is documented to return an
      // object, but legacy guards the string case anyway and so does this. The
      // branch is unreachable through the typed provider; it exists so a future
      // provider returning a bare string degrades to "that string is the
      // summary" rather than writing `undefined` into need_detail.
      aiAnalysis = aiResult;
    }
  }

  // ── 6. Flex-error override ───────────────────────────────────────────
  //
  // legacy:337-369. A customer whose very first action is a failed slip has no
  // conversation to summarise, so whatever the model produced is guesswork.
  if (!isPaymentFlex) {
    const isFlexErrorOrNotFound =
      !!(
        slipError &&
        (slipError.code === 'VALIDATION_ERROR' ||
          slipError.code === 'SLIP_NOT_FOUND' ||
          slipError.code === 'flex_error' ||
          slipError.code === 'flex_not_found' ||
          /flex_error|flex_not_found/i.test(slipError.message || ''))
      ) ||
      /\[Flex-Error\]\s*(flex_error|flex_not_found)/i.test(historyStr || '') ||
      /\[Flex-Error\]\s*(flex_error|flex_not_found)/i.test(rawAnswer || '') ||
      /\[Flex-Error\]\s*(flex_error|flex_not_found)/i.test(userText || '');

    if (isFlexErrorOrNotFound) {
      // legacy:352-358 — sliced back to 10 REGARDLESS of the configured summary
      // window. See FLEX_HISTORY_WINDOW: without this slice, raising the summary
      // limit would change ticket categories as a side effect.
      const priorCustomerMsgs = historyMsgs
        .slice(0, FLEX_HISTORY_WINDOW)
        .filter(
          (m) =>
            m['sender_type'] === 'customer' &&
            (!chatMsgId || idText(m['_id']) !== chatMsgIdStr),
        );

      if (priorCustomerMsgs.length === 0) {
        logger.log(
          "[ASSIST] Flex error/not found with no prior customer messages. Setting category to 'Other' and summary to 'ลูกค้าต้องการความช่วยเหลือ'.",
        );
        ticketCategory = 'Other';
        aiAnalysis = 'ลูกค้าต้องการความช่วยเหลือ';
      } else {
        logger.log(
          '[ASSIST] Flex error/not found with prior customer messages. Relying on AI analysis category and summary.',
        );
      }
    }
  }

  // ── 7. Telegram card ─────────────────────────────────────────────────
  if (canNotifyTelegram) {
    // legacy:373 — note this is "- (ไม่ได้ลงทะเบียน )" with the stray space, and
    // it differs from the "no answer found" card's wording, which interpolates
    // the display name. Both are verbatim.
    const displayUser =
      customerName === 'N/A' ? '- (ไม่ได้ลงทะเบียน )' : customerName;
    const assistPayload = {
      chat_id: telegramChatId,
      text:
        `[!!] ต้องการ Support จาก Admin (AI Analysis)\n\n- ผู้ใช้งาน: ${displayUser}\n` +
        `- line displayname : ${lineDisplayName}\n- เบอร์โทร: ${customerTel}\n` +
        `- เลขที่สัญญา: ${contractCode}\n\n- ${aiAnalysis}\n\n- เวลา: ${bangkokTime}`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '✅ ตอบด้วย Admin (On)',
              callback_data: `on:${alias}:${mongoChatId}`,
            },
          ],
          [
            {
              text: '❌ ปิดการตอบด้วย Admin (Off)',
              callback_data: `off:${alias}:${mongoChatId}`,
            },
          ],
        ],
      },
    };

    logger.log(
      `[ASSIST] Sending Telegram notification summary to ${telegramChatId}`,
    );
    try {
      const telegramResponse = await postJson(
        `https://api.telegram.org/bot${telegramKey}/sendMessage`,
        assistPayload,
        TELEGRAM_HTTP_TIMEOUT_MS,
      );
      logger.log(
        `[ASSIST] Telegram response (summary): ${telegramResponse.status}`,
      );
      await deps.persistWebhookLog({
        ...logContext,
        channel: 'telegram',
        action_type: 'send_assist_message',
        method: 'POST',
        endpoint: 'https://api.telegram.org/bot<redacted>/sendMessage',
        status: 'success',
        http_status: telegramResponse.status,
        payload_summary: { chat_id: telegramChatId, event_id: eventId },
        response_summary: telegramResponse.data,
        duration_ms: Date.now() - telegramStart,
        line_event_id: eventId,
      });

      // legacy:408-435 — the photo goes as a SECOND call, inside the same try, so
      // a failed photo is logged under the same error row as a failed card.
      if (mediaUrl) {
        logger.log(
          `[ASSIST] Sending Telegram photo to ${telegramChatId}: ${mediaUrl}`,
        );
        const photoStart = Date.now();
        const photoResponse = await postJson(
          `https://api.telegram.org/bot${telegramKey}/sendPhoto`,
          {
            chat_id: telegramChatId,
            photo: mediaUrl,
            caption: `[รูปถ่าย] - ${displayUser}`,
          },
          TELEGRAM_HTTP_TIMEOUT_MS,
        );
        logger.log(`[ASSIST] Telegram photo response: ${photoResponse.status}`);
        await deps.persistWebhookLog({
          ...logContext,
          channel: 'telegram',
          action_type: 'send_assist_photo',
          method: 'POST',
          endpoint: 'https://api.telegram.org/bot<redacted>/sendPhoto',
          status: 'success',
          http_status: photoResponse.status,
          payload_summary: { chat_id: telegramChatId, media_url: mediaUrl },
          response_summary: photoResponse.data,
          duration_ms: Date.now() - photoStart,
          line_event_id: eventId,
        });
      }
    } catch (telegramErr) {
      logger.error(
        `[ASSIST] Telegram notification failed: ${errText(telegramErr)}`,
      );
      const resp = (
        telegramErr as { response?: { status?: number; data?: unknown } }
      )?.response;
      await deps
        .persistWebhookLog({
          ...logContext,
          channel: 'telegram',
          action_type: 'send_assist_message',
          method: 'POST',
          endpoint:
            'https://api.telegram.org/bot<redacted>/sendMessage_or_sendPhoto',
          status: 'error',
          http_status: resp?.status,
          error_message: errText(telegramErr),
          payload_summary: {
            chat_id: telegramChatId,
            alias,
            event_id: eventId,
          },
          response_summary: resp?.data,
          duration_ms: Date.now() - telegramStart,
          line_event_id: eventId,
        })
        .catch((errLog: unknown) =>
          logger.error(
            `[ASSIST] Failed to write telegram error log: ${errText(errLog)}`,
          ),
        );
    }
  }

  // ── 8. Patch the real summary onto the ticket ────────────────────────
  //
  // legacy:498-528. The ticket already exists with the placeholder; this is the
  // only thing left of what used to be "4. Create Ticket".
  if (createdTicket) {
    try {
      await deps.ticketModel
        .updateOne(
          { _id: createdTicket._id },
          { $set: { category: ticketCategory, need_detail: aiAnalysis } },
        )
        .exec();
    } catch (enrichErr) {
      // The ticket survives with the fallback summary — the operator still sees
      // the case, which is the outcome that matters.
      logger.error(
        `[ASSIST] Failed to enrich Ticket with AI summary: ${errText(enrichErr)}`,
      );
    }

    // [FIX-20260808-TICKETRTMOVE] P1-4 — emit ticket:new HERE (post-enrich), so the
    // event carries the ticket's final `category` and `job_status:0` (legacy
    // webhookController.js:797-807). The FE (useTicketWS) can then show the waiting
    // badge + category chip live for an organically-created ticket instead of
    // waiting for the next poll. Fire-and-forget: a missed emit must never fail the
    // ticket. (Was emitted early in the create block above with a leaner payload.)
    if (deps.publishTicketEvent) {
      try {
        deps.publishTicketEvent(
          createdTicket._id,
          logContext?.['hook_id'],
          0,
          ticketCategory ?? null,
        );
      } catch (rtErr) {
        logger.warn(`[ASSIST] ticket:new emit failed: ${errText(rtErr)}`);
      }
    }
  }
}

/**
 * legacy:532-821 — the timeout wrapper.
 *
 * Sending the customer's reply is queued BEHIND assist. On 2026-07-27 assist
 * hung for 986 seconds, so the customer got nothing for 16 minutes even though
 * the bot's answer had been written to the database at second 2 — the dashboard
 * showed it, LINE never did.
 *
 * This caps assist at `ASSIST_BUDGET_MS` and lets the flow continue to the send
 * regardless. The customer gets their answer whether assist is slow, broken, or
 * fine.
 *
 * ⚠️ `Promise.race` DOES NOT CANCEL the losing promise. The hung call keeps
 *    running and will wake up later, mid-flight, with stale state. What stops it
 *    doing damage then is not this function — it is the staleness guard and the
 *    atomic claim above. Removing either on the assumption that the race
 *    contains them would reopen the duplicate-ticket bug.
 *
 * The error is swallowed ON PURPOSE. A failing assist must never cost the
 * customer their reply, so there is no rethrow and no rejected promise to
 * handle: the caller cannot tell assist failed, and must not be able to.
 */
export async function runAssistGuarded(
  args: AssistNotificationArgs,
  deps: AssistDeps,
): Promise<void> {
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      triggerAssistNotification(args, deps),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`assist budget ${ASSIST_BUDGET_MS}ms exceeded`)),
          ASSIST_BUDGET_MS,
        );
      }),
    ]);
  } catch (err) {
    // กลืน error ทิ้งโดยตั้งใจ — assist พังต้องไม่ทำให้ลูกค้าไม่ได้รับคำตอบ
    logger.error(
      `[ASSIST] Released reply without waiting for assist: ${errText(err)} ` +
        `(งานเบื้องหลังยังวิ่งอยู่ ถ้าตื่นมาสายจะโดน staleness guard ตัดเอง)`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
