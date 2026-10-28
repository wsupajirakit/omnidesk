/**
 * [PROG-20260905-G19] The unlinked-slip refusal, lifted out of the spine.
 *
 * WHEN IT RUNS. The pre-QR check found a QR (so the image is a slip) AND
 * `slip_require_profile` is on AND the profile lookup answered an explicit 404. The GATE
 * that decides all that stays in the spine — this file is only what happens afterwards.
 * Every path through it ends the turn, which is why the call site can hoist a single
 * unconditional `return` and the exit stays at exactly the spine position it had.
 *
 * ⚠️⚠️ THE ORDER OF THE FOUR STEPS IS THE FEATURE, NOT A STYLE:
 *
 *        customer chat row → bot chat row → LINE reply → assist
 *
 * Every one of them was found by LIVE TESTING on hook `demo-oa-three` (2026-08-12, 17:38-17:59)
 * — each looked correct until a real message proved it was not. Full log in
 * `todo/task/12082026/be_todo11_12082026.md` §11. The five defects, in the order they were
 * uncovered:
 *   1. markers leaked verbatim — this was the ONLY operator-written field that never ran
 *      the tag resolver;
 *   2. the chat room had NO row for this reply at all (webhook_logs had 2, chat_messages 0);
 *   3. no ticket was created: assist needs `chatMsgId`, and this branch returns long before
 *      the normal message-logging site;
 *   4. fixing (3) reversed the visible order — the answer was stored before the slip that
 *      prompted it;
 *   5. the ticket was filed as 'Other' although the case is about money.
 * Moving any step re-introduces one of those. The reasons are restated at each site below.
 *
 * ⚠️ COLLABORATORS ARRIVE THROUGH `deps`; this file imports no service. Same convention as
 * `out-of-hours-reply.handler.ts` and `api-error-reply.handler.ts` in this directory.
 *
 * ⚠️ IT KEEPS ITS OWN try/catch PLACEMENT. The customer row is wrapped because a failed
 * history write must not cost the customer their reply; the send is wrapped because a
 * failed reply must not resurrect the slip check. Neither swallows the other's failure,
 * and that separation is what makes each defect above stay fixed.
 */

import { asString } from '../logging/coerce-mask.util';

import {
  resolveHookTextReply,
  type HookTextReplyMode,
} from './hook-text-reply';
import { resolveRefusalReplyMode } from './refusal-reply-mode';
import { resolveSuppressedCheckText } from './suppressed-check-divider';

type Doc = Record<string, unknown>;

/** The response shape the spine's own senders return. */
export interface RefusalSendResponse {
  status?: number;
  data?: unknown;
}

export interface UnlinkedSlipRefusalInput {
  hook: Doc | null | undefined;
  /** The LINE user id. `undefined` only on sources that carry none. */
  userId?: string;
  channelId?: string;
  /**
   * `assist_status` — an admin is holding the room. It is READ here, never assigned.
   * It changes three things and nothing else: no card is minted, no bot row is written,
   * and the reply is replaced by a system divider. The customer's own row still goes in.
   */
  skipBotProcessing: boolean;
  /** What the customer sent, as the spine already resolved it for history. */
  msgType: string;
  msgContent: string;
  internalContentId: string | null;
  profileForLog: unknown;
  /** The delivery body, stored verbatim as `raw_content` on the customer row. */
  body: Doc;
  /** Event facts the two rows and the log row carry. */
  replyToken?: string;
  eventId?: string;
  messageId?: string;
  quoteToken?: string;
  quotedMessageId?: string;
  /** The bag every log row spreads. */
  logContext: Doc;
  /** `LINE_REPLY_ENDPOINT` — passed in so this file redeclares nothing. */
  endpoint: string;
  /** `HELPER_ALT_TEXT` — the alt text LINE requires when a card goes out. */
  helperAltText: string;
}

export interface UnlinkedSlipRefusalDeps {
  log: (message: string) => void;
  error: (message: string) => void;
  /** `errText` — the caller owns the formatting so the log lines stay byte-identical. */
  errText: (err: unknown) => string;
  /**
   * `this.buildHookHelperFlexFor(rawText, hook, userId, mode)` — answers null in every mode
   * but 'flex', when the field carries no marker, and on ANY failure.
   *
   * ⚠️ THE NAME IS DELIBERATELY THE SAME AS THE SERVICE METHOD'S, not a tidier local one.
   * `helper-stamp-doors.spec.ts` counts the four helper-card doors across the spine and its
   * role directories by matching `await this.buildHookHelperFlexFor(` OR
   * `await deps.buildHookHelperFlexFor(`. Renaming the dep to something shorter made the
   * census see three doors instead of four — a door that had merely MOVED read as a door
   * that had been deleted. Keeping the collaborator's name stable across the boundary is
   * what lets that census survive every extraction. ชื่อ collaborator ต้องคงเดิมข้ามขอบเขต
   */
  buildHookHelperFlexFor: (
    rawText: string,
    mode: HookTextReplyMode,
  ) => Promise<Doc | null>;
  /** `stripHelperUriForHistory` — a minted link must never sit in history. */
  stripHelperUri: (card: Doc) => unknown;
  /** Awaited. Returns the stored row, whose `_id` the ticket needs. */
  logCustomerMessage: (row: Doc) => Promise<Doc | null>;
  /** Fire-and-forget; the caller owns the `.catch`. */
  logBotMessage: (row: Doc) => void;
  /** Fire-and-forget; the caller owns the `.catch`. */
  logSystemMessage: (row: Doc) => void;
  sendFlexReply: (
    replyToken: string,
    card: Doc,
    altText: string,
    userId: string | undefined,
  ) => Promise<RefusalSendResponse>;
  sendTextReply: (
    replyToken: string,
    text: string,
  ) => Promise<RefusalSendResponse>;
  /** [FIX-20260827-HELPERSTAMPDOORS] door S1. */
  stampIfHelperCardDelivered: (
    card: Doc | null,
    userId: string | undefined,
    status?: number,
  ) => void;
  /** Awaited: the row must exist before the turn ends. */
  emitWlog: (row: Doc) => Promise<void>;
  /**
   * `runAssistGuarded` with the turn-level context already applied — the caller spreads
   * `assistTurn()` and this handler adds only what it alone knows. Awaited, not
   * fire-and-forget: the guard owns its own 25s budget and claims the hand-off atomically,
   * so two images cannot both open a ticket.
   */
  runAssist: (siteArgs: {
    /* Named rather than `Record<string, unknown>`: the caller merges these over the turn
       context and hands the result to `runAssistGuarded`, whose own type requires
       `userText` and `rawAnswer`. A loose bag compiles here and fails there — which is
       exactly what happened on the first version of this signature, and is the reason the
       five fields this site contributes are spelled out. */
    userText: string;
    rawAnswer: string;
    skipAI: boolean;
    chatMsgId: unknown;
    forcedTicketCategory: string;
  }) => Promise<void>;
  /**
   * `resolveHookTextReplyMode(hook)` as a thunk — the hook's own configured mode.
   *
   * ⚠️ Typed as the real union, not `string`. `resolveRefusalReplyMode` takes a
   * `HookTextReplyMode` and the resolver never answers undefined (it defaults to 'off'),
   * so widening it here would have moved a decision the type system already makes.
   */
  hookReplyMode: () => HookTextReplyMode;
}

export async function replyUnlinkedSlipRefusal(
  input: UnlinkedSlipRefusalInput,
  deps: UnlinkedSlipRefusalDeps,
): Promise<void> {
  const { hook, userId, skipBotProcessing } = input;

  /* ==== [FIX-20260812-REFUSEDMARKERS] this field never resolved markers ====
   *
   * Owner, 2026-08-12, after seeing `[[[assist]]]` reach a customer as raw brackets: the
   * marker leaked verbatim AND no ticket was raised, and this site must accept BOTH
   * `assist` and `customer-helper`.
   *
   * `slip_require_profile_text` was the ONE operator-written field with no marker handling
   * at all: the other three go through `resolveHookTextReply`, this one was sent verbatim.
   * So an operator writing the same markers they use everywhere else got the literal text
   * delivered AND no ticket. It now behaves like its siblings — markers stripped before
   * sending, `[[[customer-helper]]]` able to send the card, `[[[assist]]]` raising the
   * ticket below. */
  const refusalRaw =
    (asString(hook?.['slip_require_profile_text']) || '').trim() ||
    'ยังไม่ได้ผูกบัญชี กรุณาผูกบัญชีก่อนแล้วส่งสลิปอีกครั้ง';
  /* [FIX-20260819-REFUSALMARKERMODE] the marker IS the opt-in on this field.
     `hook_text_reply_mode` defaults to 'off' and the dashboard has no control for it (zero
     FE references), so an operator's only reachable request for the register button is
     typing the marker in the Slip tab. Seen in production 19/08: a customer uploaded a slip
     and got the literal `[[[customer-helper]]]` twice. The decision lives in
     `refusal-reply-mode.ts` with its own spec; a field with NO marker keeps the hook's own
     mode, so plain-text OAs are byte-identical to before. */
  const refusalMode = resolveRefusalReplyMode(refusalRaw, deps.hookReplyMode());
  const text =
    resolveHookTextReply({
      rawText: refusalRaw,
      hook,
      mode: refusalMode,
    }).text || refusalRaw;
  /* ==== [FEAT-20260818-REFUSEDHELPERFLEX] site 4 of 4 — this field can finally send the
   * CARD ==== Built exactly like its three siblings, through the same builder, which
   * answers null in every mode but 'flex', when the field carries no marker, and on ANY
   * failure ⇒ null keeps the text path below BYTE-IDENTICAL to before.
   *
   * ⚠️ Not built while an admin holds the room. Minting a link token is a real side effect
   *    and nothing is sent in that case — building it anyway would burn a token for a
   *    message no customer receives. ห้อง assist อยู่ = ไม่ mint ไม่ส่ง. */
  const refusalCard = skipBotProcessing
    ? null
    : await deps.buildHookHelperFlexFor(refusalRaw, refusalMode);
  deps.log(
    `[REQUIREPROFILE] slip refused for ${userId ?? 'unknown'} — no linked account`,
  );

  /* [FIX-20260812-REFUSEDMARKERS] the customer's own image must be in history BEFORE the
     bot's reply row and BEFORE assist runs.
     WHY 1 — the ticket points at a chat message (`chat_msg_id`), and assist skips creation
          entirely when that id is missing. This branch returns long before the normal
          logging site, so the row is written here or the ticket silently never appears —
          exactly what happened on the 17:40 live test.
     WHY 2 — the ORDER: chat rows are sorted by `created_at`, so writing the bot's reply
          first put the answer ABOVE the slip that prompted it. The admin page showed the
          conversation backwards while LINE showed it correctly (seen live 17:47: bot
          44.902s, customer 45.085s). The customer's message must be recorded first because
          it genuinely happened first. */
  const refusalWantsAssist = /\[\[\[assist\]\]\]?/i.test(refusalRaw);
  let refusalCustomerMsg: Doc | null = null;
  /* ==== [FIX-20260819-REFUSEDIMGHISTORY] record the image ALWAYS ====
   *
   * Reported from production 19/08 (log …04-44-48, req 3301): a customer uploaded two
   * slips, both refused for having no linked account, and the room showed only the bot's
   * replies — the pictures were nowhere, so an operator opening the room could not see
   * what had been sent.
   *
   * WHAT CHANGED: this write used to sit inside `if (refusalWantsAssist)`, so it only ran
   * when the operator's refusal copy carried `[[[assist]]]`. A hook using
   * `[[[customer-helper]]]`, or plain copy, recorded nothing.
   *
   * WHY THE OLD GATE WAS WRONG: its comment reasoned that writing anyway "would duplicate
   * what the assisted-room path already logs". Read from inside this branch that does not
   * hold — the branch RETURNS before the normal logging site and before the assisted-room
   * bypass, so within it this is the ONLY writer. Verified by reading the whole branch.
   *
   * SCOPE — deliberately one thing: the ROW is unconditional (the customer really sent
   * this); the TICKET stays marker-gated; the money path is untouched.
   * เก็บรูปเสมอ · ticket ยังผูกกับ marker เหมือนเดิม · เส้นเงินไม่แตะ.
   *
   * ⚠️ Knock-on effects of logMessage, stated rather than discovered later: it refreshes
   *   `room.last_message` (immediately overwritten by the bot row below), increments
   *   `unread_count`, and publishes `message:new` so an open dashboard renders the picture
   *   live. All three are correct consequences of a customer message existing. */
  try {
    refusalCustomerMsg = await deps.logCustomerMessage({
      userId,
      senderType: 'customer',
      messageType: input.msgType,
      content: input.msgContent,
      hookId: asString(hook?.['_id']),
      channelType: hook?.['channel_type'],
      channelId: input.channelId,
      providerMsgId: input.messageId,
      replyToken: input.replyToken,
      quoteToken: input.quoteToken,
      quotedProviderMsgId: input.quotedMessageId,
      profile: input.profileForLog,
      metadata: { event_id: input.eventId },
      rawContent: input.body,
      internalContentId: input.internalContentId,
    });
  } catch (err) {
    /* A failed history write must not cost the customer their reply — it is already sent.
       The ticket is what is lost, and that is logged rather than thrown. */
    deps.error(
      `[REQUIREPROFILE] customer message log failed, no ticket: ${deps.errText(err)}`,
    );
  }

  /* ==== [FIX-20260812-REFUSEDNOHISTORY] the chat room was missing this reply entirely ====
   *
   * Owner, 2026-08-12: the refusal must be visible *"ทั้ง chat message + ลูกค้า"*. This
   * branch sent the text to LINE and wrote a `webhook_logs` row, but never called
   * `logMessage` — so an admin opening the room saw the customer's slip with NO reply under
   * it. Measured before the fix: 2 `slip_refused_no_profile` rows in `webhook_logs`, 0
   * matching rows in `chat_messages`.
   *
   * ⚠️ WRITTEN BEFORE THE SEND, ON PURPOSE. The send rejects on a dead reply token (401);
   * placing the history write after it meant a 401 jumped straight to the catch and the room
   * lost the row again — the exact bug being fixed. The refusal is already decided here, so
   * recording it does not depend on LINE accepting the message.
   *
   * ⚠️ [FIX-20260812-REFUSEDSILENTWHENASSISTED] SKIPPED while the room is assisted. The
   *    customer correctly received nothing for the second slip, but the admin page still
   *    showed a bot bubble at 18:10:55 — so the operator saw the bot answer twice while the
   *    customer was answered once. A row for a message that was never sent makes the two
   *    views disagree. The CUSTOMER's own row above is still written. */
  if (!skipBotProcessing) {
    deps.logBotMessage({
      userId,
      senderType: 'bot',
      /* [FEAT-20260818-REFUSEDHELPERFLEX] the room shows the CARD when the card is what
         went out — same mirror the three sibling sites keep. */
      messageType: refusalCard ? 'flex' : 'text',
      /* [FIX-20260812-REFUSEDMARKERS] the ADMIN side keeps the RAW field, markers and all —
         the customer must not see `[[[assist]]]` but the chat room must show the whole
         sentence including it. That is what lets an operator see WHY the room was handed to
         them. `text` (stripped) is what went to LINE; `refusalRaw` is what they wrote. */
      content: refusalRaw,
      hookId: asString(hook?.['_id']),
      channelType: hook?.['channel_type'],
      channelId: input.channelId,
      replyToken: input.replyToken,
      metadata: {
        event_id: input.eventId,
        reason: 'slip_refused_no_profile',
        /* [FIX-20260821-SLIPHELPERMARK] name the row for WHAT WENT OUT, not for the field
           the text came from. เจอจริง 20/08: ลูกค้าส่งสลิปโดยยังไม่ผูกบัญชี ⇒ ได้การ์ด
           customer-helper · พิมพ์ต่อ 5 วินาทีถัดมา ⇒ ไม่เข้า abandon เพราะแถวนี้ชื่อไม่ตรง
           แล้วเลยหลุดไปหา AI ซึ่งส่งการ์ดใบเดิมซ้ำอีกใบ.
           `wasSentRegistrationCard` (follow-up/abandon-trigger.rule.ts) มีชื่อให้เทียบชื่อ
           เดียว และมันคือ `flex_customerhelper`.
           ⚠️ ผูกกับ `refusalCard` ไม่ใช่ประทับดื้อ ๆ — OA ที่ปิดโหมดการ์ดจะส่งข้อความล้วน
              และการเรียกข้อความล้วนว่าการ์ดจะทำให้ abandon เริ่มตามคนที่ไม่เคยได้การ์ดเลย
              ส่งข้อความล้วน ≠ ส่งการ์ด */
        auto_reply_type: refusalCard
          ? 'flex_customerhelper'
          : 'slip_require_profile_text',
        /* What the customer actually received, so the two are never confused. */
        sent_text: text,
        /* [FEAT-20260818-REFUSEDHELPERFLEX] card fields only when a card went out, same
           keys the sibling sites store. The uri is stripped first. */
        ...(refusalCard && {
          flex_json: deps.stripHelperUri(refusalCard),
          flex_doc_id: hook?.['flex_customerhelper_id'] ?? null,
        }),
      },
    });
  }

  if (skipBotProcessing) {
    deps.log(
      `[REQUIREPROFILE] room is assisted — refusal not sent to ${userId ?? 'unknown'} (history + assist still ran)`,
    );
    /* [FEAT-20260813-SUPPRESSEDCHECK] Owner decision (13 Aug): the silence is correct while
       an admin holds the room, but the CHECK RESULT — the reply text that would have been
       sent — must land in chat history so the admin can see it; before this it survived only
       as a log line. Saved as a system divider (sender 'admin'; nothing is sent to LINE, the
       customer never sees it) — the exact pattern the auto-ticket divider already uses. */
    deps.logSystemMessage({
      lineUserId: userId ?? '',
      hookId: asString(hook?.['_id']),
      messageType: 'divider',
      /* [FIX-20260819-DIVIDERHELPERLABEL] a marker is markup, not an answer: for a
         customer-helper field this row reads a sentence an operator can act on. Rule and
         scope live in `suppressed-check-divider.ts` with behavioural tests. The customer's
         reply and card are untouched. */
      content: `🔎 ผลตรวจสลิป: ${resolveSuppressedCheckText(refusalRaw, text)}`,
      metadata: {
        variant: 'suppressed_reply',
        action: 'slip_refused_no_profile',
      },
    });
  } else {
    try {
      /* [FEAT-20260818-REFUSEDHELPERFLEX] the card replaces the text when one was built;
         `refusalCard` is null in every other case, so this ternary's else-branch IS the
         original call, argument for argument. altText: LINE rejects an empty one, and the
         stripped text is what a notification-only client reads.
         One name for the two sends, resolved before the log object so its shape stays
         exactly as it was. */
      const refusalAction = refusalCard
        ? 'slip_refused_no_profile_flex'
        : 'slip_refused_no_profile';
      const res = refusalCard
        ? await deps.sendFlexReply(
            input.replyToken ?? '',
            refusalCard,
            (text || input.helperAltText).slice(0, 400),
            /* [FIX-20260902-FLEXLADDER] the reply→push ladder, the same one the text sender
               in the `else` below already had. Without it a refused reply token lost the
               CARD while the sentence beside it arrived. `userId` is the LINE id. */
            userId,
          )
        : await deps.sendTextReply(input.replyToken ?? '', text);
      // [FIX-20260827-HELPERSTAMPDOORS] door S1 — see the method's note.
      deps.stampIfHelperCardDelivered(refusalCard, userId, res?.status);
      await deps.emitWlog({
        ...input.logContext,
        channel: 'line_api',
        action_type: refusalAction,
        method: 'POST',
        endpoint: input.endpoint,
        status: 'success',
        http_status: res.status,
        payload_summary: { reply_token: input.replyToken, text },
        response_summary: res.data,
        line_event_id: input.eventId,
      });
    } catch (err) {
      // A failed reply must not resurrect the slip check — the customer still has no
      // account. Log and stop.
      deps.error(`[REQUIREPROFILE] reply failed: ${deps.errText(err)}`);
    }
  }

  /* [FIX-20260812-REFUSEDMARKERS] `[[[assist]]]` in this field must raise a ticket, exactly
     as it does in `image_answer_text`.
     WHAT: hand the case to an admin instead of ending the conversation silently.
     WHY:  the customer was just refused and cannot proceed on their own — that is precisely
           when someone should look at it.
     ⚠️ Runs AFTER the reply so the customer is answered first, and the marker is matched on
        the RAW field (the sent text has it stripped). */
  if (refusalWantsAssist) {
    await deps.runAssist({
      userText: input.msgContent,
      rawAnswer: refusalRaw,
      skipAI: false,
      /* ⚠️ `chatMsgId` is REQUIRED for a ticket to exist — assist creates one only when
         both this and `userMongoId` are set. The inbound message is normally written to
         history much further down the spine, but this branch RETURNS before reaching it,
         so the row is written above instead. Without that, assist ran, claimed the room
         and logged "Tag detected", yet no ticket was ever created — observed live 17:40. */
      chatMsgId: refusalCustomerMsg?.['_id'],
      /* [FIX-20260812-REFUSEDMARKERS] file this ticket as 'Payment'.
       *
       * WHAT RAISED IT: the pre QR check read a QR in the image — so it is a slip — and
       * `slip_require_profile` then refused it because the sender has no linked account.
       * The case is about money from the first second, and an operator needs to find it
       * among payment work, not among general hand-offs.
       *
       * WHY IT WAS WRONG BEFORE: this path produced 'Other', the default for anything that
       * is not a payment flex card. Nothing here sends a flex card at all, so the money
       * nature of the case was invisible on the ticket.
       *
       * ⚠️ Set through `forcedTicketCategory`, NOT by reusing `isPaymentFlex`. That flag
       *    also skips the slip-error branch inside assist, so borrowing it would change
       *    behaviour beyond the category. This field only names the category. */
      forcedTicketCategory: 'Payment',
    });
  }
}
