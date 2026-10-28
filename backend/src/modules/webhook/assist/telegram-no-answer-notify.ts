import { errText } from '../logging/coerce-mask.util';
import type { EventHandlerDeps } from '../event-handlers/event-handler.port';

/**
 * [PROG-20260905-TGNOTIFY] The Telegram "no answer found" notification.
 *
 * WHEN IT RUNS. The AI answered with the not-found tag and the hook carries Telegram
 * credentials. It tells the operator, on Telegram, that a customer asked something the
 * knowledge base could not answer — the one signal that a gap exists.
 *
 * ⚠️ IT MUST NEVER COST THE CUSTOMER THEIR REPLY. The customer has already been answered
 * by the time this runs. Every failure inside is caught and logged; nothing propagates.
 *
 * ⚠️ IT WRITES NOTHING THE SPINE READS. Every value it declares dies here — verified
 * before extracting, because a block that quietly feeds a later gate cannot be lifted out
 * behind a single call.
 */

type Doc = Record<string, unknown>;

/* Redeclared rather than imported from the service — importing back would be a cycle. */
/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

export interface TelegramNoAnswerArgs {
  accessToken: string;
  userId?: string;
  telegramKey?: string | null;
  telegramChatId?: string | null;
  /* `replyTextRaw` can be null on the not-found path — the spine's own type. */
  userText?: string | null;
  eventId?: string;
  alias?: string;
  /* The profile facts the notification quotes. They are read-only here: this block is
     the LAST consumer of them on the AI path, and it writes none of them back. */
  customerName?: string;
  customerTel?: string;
  contractCode?: string;
  bangkokTime?: string;
  /** The raw AI answer. Empty means the not-found tag was the whole reply. */
  replyTextRaw?: string | null;
  logContext: Doc;
}

export interface TelegramNoAnswerDeps {
  lineApi: {
    getLineProfile: (
      token: string,
      userId: string,
    ) => Promise<{ displayName?: string } | null>;
  };
  logger: {
    log: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
  wlogEmit: EventHandlerDeps['emitWlog'];
}

export async function notifyTelegramNoAnswer(
  args: TelegramNoAnswerArgs,
  deps: TelegramNoAnswerDeps,
): Promise<void> {
  const telegramStart = Date.now();
  let displayName = 'Unknown';
  const profileResponseData = await deps.lineApi.getLineProfile(
    args.accessToken,
    args.userId ?? '',
  );
  displayName = profileResponseData?.displayName || displayName;
  await deps.wlogEmit({
    ...args.logContext,
    channel: 'line_api',
    action_type: 'get_profile',
    method: 'GET',
    endpoint: 'https://api.line.me/v2/bot/profile/{userId}',
    status: profileResponseData ? 'success' : 'error',
    // ⚠️ getLineProfile collapses 404, 401, 500 and timeout into null,
    //    so every failure is recorded as 0 and every success as 200
    //    whether or not that is what LINE returned. Ported as found.
    http_status: profileResponseData ? 200 : 0,
    payload_summary: { user_id: args.userId, alias: args.alias },
    response_summary: profileResponseData,
    duration_ms: Date.now() - telegramStart,
    line_event_id: args.eventId,
  });

  if (!args.replyTextRaw) {
    deps.logger.log(
      '[ASSIST] No answer found. Sending notification to Admin...',
    );
    const displayUser =
      args.customerName === 'N/A'
        ? `${displayName} (ไม่ได้ลงทะเบียน )`
        : args.customerName;
    try {
      await fetch(
        `https://api.telegram.org/bot${args.telegramKey}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: args.telegramChatId,
            text:
              `[!] ไม่พบคำตอบในระบบ\n- ผู้ใช้งาน: ${displayUser}\n` +
              `- เบอร์โทร: ${args.customerTel}\n- เลขที่สัญญา: ${args.contractCode}\n` +
              `- คำถาม: ${args.userText}\n- เวลา: ${args.bangkokTime}`,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (telegramErr) {
      deps.logger.warn(
        `Telegram 'no answer' notification failed: ${errText(telegramErr)}`,
      );
    }
  }
}
