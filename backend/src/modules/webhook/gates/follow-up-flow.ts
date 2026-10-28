import type { Model } from 'mongoose';

/* [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE TOUCHING A
   KEY: `src/modules/chat/config/member-config.registry.ts`. It is the only place a key may
   be declared, it carries the checklist for adding one, the measured index/query rules,
   and a CONSUMERS list naming every file that touches the bag — THIS ONE INCLUDED.
   `member-config.spec.ts` and `member-config-consumers.spec.ts` grep the code and fail if
   that list stops matching reality, so the two cannot drift apart silently.

   ⚠️ THIS NOTE ARRIVED WITH THE CODE, from `webhook.service.ts`, at [PROG-20260905-G23].
   The service wrote this key until the follow-up flow was lifted into this file; the note
   travelled so the rule stays beside the call it governs rather than in the file the code
   left. The registry list took three save points to catch up, because neither of its
   specs was in the gate set of the save point that moved the code. That is the whole
   argument for keeping this text next to the call.

   ⚠️ CHANGING WHAT THIS FILE DOES WITH A KEY MEANS UPDATING THAT LIST in the same commit —
   adding a read, dropping a write, or moving the call to yet another file.
   แตะคีย์เมื่อไหร่ ต้องไปอัปเดตบัญชีที่จุดกลางด้วยเสมอ.

   ── BOTH ENDS ────────────────────────────────────────────────────────────────────────
   WRITES `follow_up.line.request_reg_at`  (writeMemberConfigOnce, first writer wins)
   → WHO TAKES IT: NOBODY through the door, and that is stated rather than left blank. It
     is a RECORD, counted with `countDocuments` from mongosh — the command is in
     `member.schema.ts` beside its index — and it is read by a RAW AGGREGATION in the
     tickets insight service, which no guard in this repo can see. A reader appearing
     later means this line, and the registry's list, both need updating.
   ← WHO CLEARS IT: NOTHING, EVER. Owner, 2026-08-20: "request_reg_at =
     ห้ามเคลียร์ห้ามยุ่ง >>> คงค่าเดิม". A clearer added here would erase the only record of
     who came through.

   [FEAT-20260820-REQUESTREG] The KEY lives with the rest of the follow-up names; the
   WRITER is the shared member-config helper, reached by a relative path on purpose (an
   `@/modules/chat/config` alias would be a layering error, a relative path is not). */
import { writeMemberConfigOnce } from '../../chat/config';
import { openTicketBySystem } from '../../tickets/create-by-admin';
import { ACTIVE_REGISTER_SCENARIO, handoffToRegister } from '../register';

import { sentMessageIds } from '@/infra/line';

import { asString } from '../logging/coerce-mask.util';

import {
  FOLLOW_UP_REGISTER_ASK_TEXT,
  REQUEST_REG_KEY,
  runFollowUpGate,
} from '../follow-up';

type Doc = Record<string, unknown>;

/**
 * [PROG-20260905-G23] The follow-up gate
 *
 * ⚠️ WHY IT LIVES IN `gates/` AND NOT IN `follow-up/`. It was put in `follow-up/` first and
 * `follow-up-boundaries.spec.ts` refused it: that module must not import `register/` — the
 * arrow points one way, so either module can be deleted on its own. This file legitimately
 * needs BOTH, which means it belongs to neither. It is a spine gate that COMPOSES them,
 * and `gates/` is where a composition lives. The spec was right and the placement was
 * wrong; the fix was the placement. — the ONE place the flow is cut for the
 * follow-up levels.
 *
 * WHY IT SITS WHERE IT DOES, kept verbatim from the spine because the position IS the
 * behaviour:
 *   · AFTER the customer's message is stored and published, so the dashboard behaves
 *     identically whatever this decides;
 *   · ABOVE the `customer-register` keyword handler, by the owner's rule — a customer in a
 *     follow-up level must be answered by the level, not by the keyword.
 *
 * ⚠️ IT RETURNS A BOOLEAN AND THE CALLER RETURNS ON TRUE. That is the whole contract: true
 * means the turn was consumed (a level answered, or the customer was handed off to
 * registration), false means carry on down the ladder byte-for-byte as before.
 *
 * ⚠️ THE HAND-OFF WRITES BEFORE IT REPLIES. A customer who is handed to registration must
 * exist in the register scenario before the card that points at it goes out — the reverse
 * order produces a card whose link resolves to nothing.
 */

/** The LINE event, as this gate reads it. */
interface FollowUpEvent {
  type?: string;
  replyToken?: string;
  eventId?: string;
  message?: { type?: string; id?: string; text?: string };
}

export interface FollowUpFlowDeps {
  logger: {
    log: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
  chatHistory: { logMessage: (row: Doc) => Promise<unknown> };
  /* Mongoose models, typed as the follow-up helpers already declare them — deriving
     rather than re-declaring keeps this file from drifting when they change. */
  chatRoomModel: Model<Record<string, unknown>>;
  chatMessageModel: Model<Record<string, unknown>>;
  memberModel: Model<Record<string, unknown>>;
  ticketModel: Model<Record<string, unknown>>;
  assignHistoryModel: Model<Record<string, unknown>>;
  /** Only `generate` is reached from here; the vendor rules live downstream. */
  aiReply: {
    generate: (
      req: unknown,
    ) => Promise<{ text?: string | null } | null | undefined>;
  };
  sendTextReply: (
    ...a: unknown[]
  ) => Promise<{ status?: number; data?: unknown }>;
  publishTicketCreated: (...a: unknown[]) => unknown;
}

export interface FollowUpFlowArgs {
  hook: Doc | null | undefined;
  userId?: string;
  event: FollowUpEvent;
  accessToken: string;
  channelId?: string;
  /** The room the turn belongs to, as the assist gate resolved it. */
  inboundRoom: Doc | null;
  /** The member row, when one was found — the levels read its config. */
  existingUser: Record<string, unknown> | null;
  /**
   * Whether the profile lookup found anything — the level rules read it.
   *
   * ⚠️ `boolean`, not `boolean | undefined`. The spine declares it `let … = false`, so it
   * is never undefined by the time the gate is asked. Typing it wider here forced a
   * `?? false` at the call — inventing a default that does not exist in the original, and
   * `abandon-trigger.spec.ts` caught the changed text before it could become a changed
   * behaviour.
   */
  followUpHasProfile: boolean;
  msgContent: string;
}

export async function runFollowUpFlow(
  args: FollowUpFlowArgs,
  deps: FollowUpFlowDeps,
): Promise<boolean> {
  /* Destructured at the top; the body is untouched. Renaming values through a moved body
     turned an object property into a positional argument twice on earlier cuts. */
  const {
    hook,
    userId,
    event,
    accessToken,
    channelId,
    inboundRoom,
    followUpHasProfile,
    existingUser,
    msgContent,
  } = args;

  /* [FIX-20260821-NOIMAGEFOLLOWUP] an IMAGE never enters the follow-up
   flow. Owner, 21/08/2026, on seeing a real conversation: a customer
   who had been asked to register answered by SENDING A SCREENSHOT of
   their dashboard — name, account number and phone all visible — and
   the bot asked for the very same details again, because nothing in
   the flow reads an image. The customer had answered; the bot could
   not tell. ลูกค้าตอบแล้ว แต่บอทอ่านรูปไม่ออก เลยทวงซ้ำ.

   WHY THE FLOW LET IT IN. Level 1 does not look at what the CUSTOMER
   sent at all — `abandon-trigger.rule.ts` decides purely on whether
   the bot's last three messages contained the registration card. So
   any inbound event that reaches this closure qualifies, and an image
   reaches it: `SILENT_MESSAGE_TYPES` is sticker/file/video/audio only,
   so an image takes the main path where this runs BEFORE the non-text
   branch. It was never excluded — this predates the sticker work and
   is not a side effect of it.

   WHAT AN IMAGE DOES INSTEAD, now: it falls through to the branch it
   would have taken if the flow did not exist — `handleSlipFlex` and
   the `image_answer_text` path. For a customer mid-registration that
   is the better answer: a slip gets verified instead of being met
   with a repeat of a question they may already have answered.

   ⚠️ THIS ALSO TAKES LEVEL 2 OUT FOR IMAGES, deliberately. The block
   below still says levels 2 and 3 answer 'images included' — that
   sentence describes the behaviour this guard replaces. A marked
   customer sending an image is now handled by the normal image path.
   A text or a sticker from the same customer still reaches the flow
   exactly as before.

   ⚠️ TYPE CHECKED HERE, NOT INSIDE `./follow-up`. Message types are a
   webhook concept and that folder's rule 1 forbids it knowing what a
   webhook is; the gate takes rows and returns a verdict, nothing more.

   ⭐ CONFIRMED BY THE OWNER, 22/08/2026 — reviewed with the use case
   spelled out (a customer mid-registration answers with a SCREENSHOT
   of their dashboard, and the bot asks for the same details again)
   and the answer was "ถูกต้องแล้ว". Recorded because until that day
   this was a session's own judgement from a real conversation, with
   no written instruction behind it — and a decision nobody signed is
   the kind that gets reverted by the next person who reads it.
   เจ้าของยืนยันแล้ว 22/08 · จดไว้เผื่อเปลี่ยนใจ.

   revert: delete this `if` block. Images go straight back to reaching
   levels 1 and 2 as they did before 21/08/2026 — nothing else changes,
   and no stored data is involved either way. The cost of going back
   is the use case above: a screenshot answer is met with a repeat of
   the question it answered. */
  if (event.message?.type === 'image') return false;

  /* [FEAT-20260820-FOLLOWUP] gate — the follow-up levels, and the only
   place the flow is cut for them.
   WHY HERE, EXACTLY
     · AFTER the customer's message was stored and published, so the
       dashboard behaves identically whatever this decides;
     · ABOVE the `customer-register` keyword handler, by the owner's
       decision (2026-08-20): once a customer is in level 2 or 3 this
       flow owns the conversation and the old self-service link must
       not intercept it. ⚠️ That keyword is therefore NOT a way out any
       more — the only way out is the customer gaining a real profile,
       after which the gate clears both marks on the very next message
       and everything behaves exactly as it did before.
       ทางออกคือได้ raw profile ไม่ใช่คีย์เวิร์ดเดิมแล้ว;
     · BEFORE the non-text branch and the AI, because levels 2 and 3 must
       answer instead of the bot, images included.
   The gate decides; this block acts. Everything it calls lives in
   `./follow-up` and `./register` and knows nothing about webhooks, so
   deleting this block restores the previous behaviour exactly.
   เก็บข้อความ + realtime ปกติ · ตัดเฉพาะส่วนที่บอทจะตอบ. */
  const followUp = await runFollowUpGate(
    {
      hasProfile: followUpHasProfile,
      room: inboundRoom,
      member: existingUser,
      channelUserId: userId,
      /* [FEAT-20260821-IGNOREABANDON] the OA's own copy of the switch.
       `hook` is already in scope here — nothing is fetched for this.
       revert: delete this line; the gate treats it as absent. */
      hook,
    },
    {
      chatMessageModel: deps.chatMessageModel,
      memberModel: deps.memberModel,
      warn: (m: string) => deps.logger.warn(m),
    },
  );

  if (followUp.handOffToRegister) {
    /* Level 2 — say nothing, hand the message over, and let the CHOSEN
     scenario say whether this is the end of the flow. The choice is
     made here, at the moment level 2 fires, because the webhook is the
     only thing that knows what should happen next.
     ใครเลือก scenario = webhook ตอน trigger level 2. */
    const handed = handoffToRegister(
      {
        hookId: asString(hook?.['_id']) ?? '',
        lineUserId: userId ?? '',
        /* One message today. The door also takes `string[]`, so sending
         a stretch of history later is a change to THIS line and
         nothing inside `register/`. ส่งเดี่ยววันนี้ · ส่ง history วันหน้า
         แก้บรรทัดนี้บรรทัดเดียว. */
        messages: msgContent,
        /* eslint-disable-next-line @typescript-eslint/no-base-to-string -- a Mongo `_id`; `String()` on an ObjectId is its hex, which is what every consumer reads. Ported verbatim, and the three sites in this program guard differently (`? :`, none, `?? ''`), so one shared helper would flatten three behaviours into one. */
        roomId: String(inboundRoom?.['_id'] ?? ''),
        scenario: ACTIVE_REGISTER_SCENARIO,
      },
      {
        log: (m) => deps.logger.log(m),
        /* [FEAT-20260820-MEMBERINFO] the project's AI provider, handed over
         as a plain function so `register/` stays free of every vendor.
         The hand-off fires it without waiting, so nothing here changes
         how fast the customer is answered. ลูกค้าไม่รอ. */
        generate: (r) => deps.aiReply.generate(r),
        /* [FEAT-20260820-OPENBYSYSTEM] opening a case, handed over as a
         plain function so `register/` still knows no database. The case
         belongs to nobody and waits in the queue — see
         `openTicketBySystem`. ผูกประตูเปิดเคสเข้ามา ไม่ใช่เขียนใหม่. */
        /* [FEAT-20260820-OPENBYSYSTEM] the case opener, handed over as a
         plain function so `register/` still knows no database. It is
         the SAME door the dashboard's "open case" button uses
         (`openTicketBySystem` → `claimRoomAndOpenCase`), with no auth,
         so the case waits in the queue owned by nobody. The models are
         the ones this service already holds, and `ticket:new` goes out
         through the emitter the assist path already uses — nothing is
         duplicated and no module is imported for it.
         ประตูเดียวกับปุ่มเปิดเคส · ไม่ import โมดูลเพิ่ม. */
        openCase: async (i) => {
          const { ticket, roomId: openedRoomId } = await openTicketBySystem(i, {
            ticketModel: deps.ticketModel as never,
            chatRoomModel: deps.chatRoomModel as never,
            chatMessageModel: deps.chatMessageModel as never,
            assignHistoryModel: deps.assignHistoryModel as never,
            warn: (m: string) => deps.logger.warn(m),
          });
          deps.publishTicketCreated(
            ticket['_id'],
            ticket['hook_id'],
            0,
            ticket['category'] ?? null,
          );
          return { ticketId: String(ticket['_id']), roomId: openedRoomId };
        },
        /* [FEAT-20260820-REQUESTREG] record that this customer was asked
         to register. `writeMemberConfigOnce` is first-writer-wins in its
         own filter, so a customer asked again in a later round keeps the
         FIRST date — "when were they first asked" cannot be overwritten.
         Never cleared by anything, unlike the abandon mark beside it.
         revert: delete this property and its `markRequested` dep. */
        markRequested: () =>
          writeMemberConfigOnce(
            { line_user_id: userId ?? '' },
            REQUEST_REG_KEY,
            new Date(),
            { memberModel: deps.memberModel as never },
          ),
      },
    );
    /* The scenario declares this; nothing is computed at run time, so the
     answer is here before its work has even started. A scenario that one
     day should let the bot carry on flips ONE field in its own file. */
    if (handed.endFlow) return true;
  }

  if (followUp.memberNeedRegister) {
    // Level 2 — ask for the details, log the reply like any other, stop.
    if (accessToken && event.replyToken) {
      const askText = FOLLOW_UP_REGISTER_ASK_TEXT;
      /* [FEAT-20260831-QUOTESRC] the response was discarded here; it is
       kept now only to read the ids LINE returns. The call, its
       arguments and its await are unchanged. */
      const askRes = await deps.sendTextReply(
        accessToken,
        event.replyToken,
        askText,
      );
      void deps.chatHistory
        .logMessage({
          userId,
          senderType: 'bot',
          messageType: 'text',
          content: askText,
          hookId: asString(hook?.['_id']),
          channelType: hook?.['channel_type'],
          channelId,
          replyToken: event.replyToken,
          ...sentMessageIds(askRes),
          metadata: {
            event_id: event.eventId,
            reason: 'follow_up_need_register',
          },
        })
        .catch(() => undefined);
    }
    return true;
  }
  return false;
}
