/**
 * Stamp the member who is ignoring the registration card — once.
 * ===========================================================================
 * The webhook calls this one function and nothing else from this folder. What
 * DECIDES lives in `abandon-trigger.rule.ts` and touches no database; what is
 * STORED lives in `chat/config` and is reached only through its helpers. This
 * file is the wiring between them, and the only place that knows both.
 *
 * ⚠️ COST — it is ordered so the common case pays nothing:
 *     (a) no room / no customer  → 0 queries
 *     (b) already stamped        → 0 queries   ← the usual case for a stuck customer
 *     (c) read the last 3 bot messages         ← one indexed, capped, projected read
 *     (d) rule says no           → 0 further
 *     (e) stamp, first-writer-wins             ← one write, once per member ever
 * A customer who was stamped yesterday and writes ten more times today costs
 * NOTHING beyond (b). ลูกค้าที่ติดอยู่แล้วพิมพ์ซ้ำ ไม่เสียคิวรี่เพิ่มเลย.
 *
 * ⚠️ Best-effort by design: every failure is swallowed and logged. This runs on
 * the inbound message path, and a bookkeeping stamp must never delay or break a
 * customer's reply. ห้ามให้ลูกค้ารอ หรือพังเพราะเรื่องนี้.
 *
 * revert: delete this folder and its single call in webhook.service.
 */
import type { Model } from 'mongoose';

/* [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
   TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.

   THIS FILE WRITES `follow_up.line.abandon_trigger_at` (once — first writer wins).

   That file is the only place a key may be declared, it carries the checklist
   for adding one, the measured index/query rules, and a CONSUMERS list naming
   every file that touches the bag — this one included. `member-config.spec.ts`
   greps the code and fails if that list stops matching reality, so the two
   cannot drift apart silently.
   ⚠️ CHANGING WHAT THIS FILE DOES WITH A KEY MEANS UPDATING THAT LIST in the
   same commit — adding a read, dropping a write, moving to another key.
   แตะคีย์เมื่อไหร่ ต้องไปอัปเดตบัญชีที่จุดกลางด้วยเสมอ.

   ── BOTH ENDS ─────────────────────────────────────────────────────────────
   WRITES `follow_up.line.abandon_trigger_at`  (writeMemberConfigOnce)
   → WHO TAKES IT: `follow-up/follow-up.gate.ts` — its presence IS level 2's
     whole condition. Nothing else reads it.
   ← WHO CLEARS IT: TWO files, one per route into registration —
     `follow-up/clear-follow-up.helper.ts` (webhook) and
     `customer-link/clear-follow-up-on-register.helper.ts` (link).
     Both are load-bearing: drop either and that route strands the flag. */
import { writeMemberConfigOnce } from '../../chat/config';

import {
  ABANDON_BOT_LOOKBACK,
  abandonBotRowFilter,
  shouldStampAbandonTrigger,
  type AbandonHistoryRow,
} from './abandon-trigger.rule';
import { ABANDON_TRIGGER_KEY } from './follow-up.keys';

/* The key lives in `follow-up.keys.ts` so the clear step and the gate can use it
   without importing this file. Re-exported here for callers that already had it.
   ชื่อคีย์อยู่ไฟล์กลาง เพื่อให้หยิบทีละชิ้นได้. */
export { ABANDON_TRIGGER_KEY };

/* [MAINPORT-20260823-ABANDONFIX] ⚠️ THIS FILE CONFLICTS if the abandon fix
   (`f4e0d81`) is cherry-picked to `main` ahead of the full merge. Resolve by
   taking `dev` whole — `git checkout --theirs -- <this file>` — never by
   hand-merging the hunks. Full reasoning, the measured conflict list and how to
   re-check it: `abandon-trigger.rule.ts`, same tag. */
export interface AbandonTriggerResult {
  /**
   * Did the RULE match — the registration card in the recent bot history?
   *
   * Separate from `stamped` on purpose. Two messages arriving together both
   * match, but only one of them wins the write; the customer must be answered on
   * both, so the caller reads this and not `stamped`.
   * กติกาผ่าน กับ เราเป็นคนเขียน คนละเรื่อง.
   */
  matched: boolean;
  /** Was THIS call the one that wrote the mark? */
  stamped: boolean;
}

const NO: AbandonTriggerResult = { matched: false, stamped: false };

export interface AbandonTriggerDeps {
  /**
   * [FIX-20260822-NOTICEHARDEN] Optional: reply-type prefixes the lookback
   * skips. Omitted by every caller today, which means
   * ABANDON_SKIPPED_REPLY_PREFIXES applies — this is the plug for a lane, an
   * experiment or a test that needs its own policy without editing production.
   */
  skippedReplyPrefixes?: readonly string[];

  chatMessageModel: Model<Record<string, unknown>>;
  memberModel: Model<Record<string, unknown>>;
  warn: (msg: string) => void;
}

export interface AbandonTriggerInput {
  /**
   * The profile check THIS request already performed — never re-queried.
   *
   * A customer the site knows is not being asked to register, so none of this
   * applies to them. It is also what lets a customer LEAVE the follow-up levels
   * without anything clearing the stamps: the moment they register, every level
   * stops firing. ลงทะเบียนเมื่อไหร่ ทุก level เงียบทันที ไม่ต้องรอใครมาล้างค่า.
   */
  hasProfile: boolean;
  /** The room this request already loaded — borrowed, never re-queried. */
  room: { _id?: unknown } | null | undefined;
  /** The member this request already loaded, when it has one. */
  member: unknown;
  /** The customer's channel id, which is how the member row is addressed. */
  channelUserId: string | null | undefined;
  /**
   * [FIX-20260821-SLIPHELPERMARK] `hook.flex_customerhelper_id` — the card this
   * OA has bound, when it has one.
   *
   * Threaded from the hook the gate ALREADY holds (it reads it for the ignore
   * switch), so this costs no query and no new argument at the webhook. Optional
   * on purpose: a caller without a hook keeps working, and the rule falls back
   * to matching by name — which covers every OA anyway.
   * ตัวเลือกเสริม ไม่ใช่ของบังคับ · ไม่มีก็ยังทำงานได้เต็ม.
   */
  helperCardId?: unknown;
}

/**
 * @returns whether the rule matched, and whether this call wrote the mark.
 */
export async function stampAbandonTriggerOnce(
  input: AbandonTriggerInput,
  deps: AbandonTriggerDeps,
): Promise<AbandonTriggerResult> {
  try {
    const roomId = input?.room?._id;
    const channelUserId = String(input?.channelUserId ?? '');
    if (!roomId || !channelUserId) return NO;
    // a registered customer is not being asked to register — nothing to mark
    if (input.hasProfile) return NO;

    /* [FEAT-20260820-L1PURE] ⚠️ THE "ALREADY MARKED" CHECK WAS REMOVED HERE.
       Owner, 2026-08-20: level 1's condition is now exactly two things — no raw
       profile, and the registration card inside the recent bot history. Nothing
       about whether this customer was marked before.
       เงื่อนไข level 1 เหลือสองข้อ: ไม่มี profile + มีการ์ดใน 3 ข้อความล่าสุด.

       WHAT WAS HERE
         An early `return NO` when the member already carried
         `ABANDON_TRIGGER_KEY`. Its own comment called it "only an optimisation":
         it saved the chat-history query for a customer who was already marked.

       WHY REMOVING IT CHANGES NO BEHAVIOUR TODAY
         Two things still stand between a marked customer and this function:
           · `follow-up.gate.ts` checks the mark FIRST and routes a marked
             customer to level 2, returning before level 1 is ever called;
           · the write below is first-writer-wins in its own filter, so even a
             direct call cannot move an existing date.
         What it did cost was clarity: the rule read as three conditions when the
         product rule is two, and the same fact was asserted in two files.
         กติกาจริงมีสองข้อ · เช็คซ้ำอยู่คนละไฟล์ทำให้อ่านแล้วเข้าใจผิด.

       WHAT IT DOES COST
         One indexed `chat_messages` query (`room_id`, limit 3, one field) for a
         marked customer who reaches this function directly — which nothing in
         the webhook does. A caller that wants the old saving can check the mark
         itself before calling.

       HOW TO PUT IT BACK — restore exactly this, right here:
         if (
           input.member &&
           readMemberConfig(input.member, ABANDON_TRIGGER_KEY, null as never)
         ) {
           return NO;
         }
         ⚠️ `readMemberConfig` is NO LONGER IMPORTED — it had no other use here
         once this block went. Put the import back too:
           import { readMemberConfig, writeMemberConfigOnce } from '../../chat/config';
         `ABANDON_TRIGGER_KEY` is still imported for the write below.
         เอากลับ = วางบล็อกคืน + เพิ่ม import กลับด้วย.

       revert: paste the block above back and drop this note. */

    /* (c) the bot's own last words, newest first, capped, and only the one field
       the rule reads. Scoped by `room_id`, which is indexed. */
    const recentBotRows = (await deps.chatMessageModel
      /* [FIX-20260822-NOTICEHARDEN] screening replies do not count as the
         bot's words here — see ABANDON_SKIPPED_REPLY_PREFIXES for why, and
         empty that list to restore this query byte for byte. */
      .find({
        room_id: roomId as never,
        sender_type: 'bot',
        ...abandonBotRowFilter(deps.skippedReplyPrefixes),
      })
      .sort({ created_at: -1 })
      .limit(ABANDON_BOT_LOOKBACK)
      /* [FIX-20260821-SLIPHELPERMARK] two fields, not one. `flex_doc_id` is what
         tells a legacy slip-refusal row that DID send a card apart from one that
         sent plain text — the key is present only in the first case — and it is
         what rule 3 matches against. Still one small projection on an indexed
         `room_id` query; the card BODY (`flex_json`) is deliberately NOT fetched. */
      .select('metadata.auto_reply_type metadata.flex_doc_id')
      .lean()
      .exec()) as unknown as AbandonHistoryRow[];

    if (
      !shouldStampAbandonTrigger(
        recentBotRows ?? [],
        input.helperCardId,
        /* the SAME list the query above used — a caller that overrides one
           overrides both, or the two layers could disagree. */
        deps.skippedReplyPrefixes,
      )
    ) {
      return NO;
    }

    /* Written once and never moved: first writer wins, enforced in the filter, so
       messages arriving together cannot produce two different timestamps and a
       customer stuck for a week keeps the date they got stuck. */
    const stamped = await writeMemberConfigOnce(
      { line_user_id: channelUserId },
      ABANDON_TRIGGER_KEY,
      new Date(),
      { memberModel: deps.memberModel },
    );
    return { matched: true, stamped };
  } catch (err) {
    deps.warn(
      `[FOLLOW-UP] abandon trigger skipped: ${(err as Error)?.message}`,
    );
    return NO;
  }
}
