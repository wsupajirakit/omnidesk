/**
 * One question for the caller: what should happen to this message?
 * ===========================================================================
 * The three levels and the clear step are independent functions with their own
 * conditions and their own files. This composes them in the one order that makes
 * sense and returns a VERDICT — it sends nothing, replies to nobody and stops no
 * flow. Acting on the verdict is the caller's job, which is what keeps every
 * piece here removable and reusable outside a webhook.
 * ตัวนี้ตอบอย่างเดียว ไม่ทำอะไรเอง · คนเรียกเป็นคนตัดสินใจ.
 *
 * THE ORDER, AND WHY
 *   0. registered  → clear the mark, and nothing else applies. Being gated on
 *      "no profile" alone would keep this quiet, but leaving the mark behind
 *      makes a customer look stuck for ever to anything that reads it. This runs
 *      on EVERY event, which is what guarantees nobody is left in the loop.
 *   2. already marked → hand this message off; the bot says nothing at all. No
 *      history is read, because the mark already answered that question once.
 *   1. not marked  → read the recent bot history; if the registration card is
 *      there, mark the customer AND ask them for their details.
 *   A customer matches exactly one of them, and the cheap checks — reading the
 *   member the request already has — come before the one that reads chat history.
 *
 * ⚠️ Level 2 can never fire on the message that created its input: the member is
 * the snapshot the request loaded at its start, so a mark written during this
 * request is invisible until the next one. ระดับ 2 เร็วสุดคือรอบถัดไป.
 *
 * revert: delete this file; the levels stand alone without it.
 */
import type { Model } from 'mongoose';

/* [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
   TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.

   THIS FILE READS `follow_up.line.abandon_trigger_at` — its presence IS level 2.

   That file is the only place a key may be declared, it carries the checklist
   for adding one, the measured index/query rules, and a CONSUMERS list naming
   every file that touches the bag — this one included. `member-config.spec.ts`
   greps the code and fails if that list stops matching reality, so the two
   cannot drift apart silently.
   ⚠️ CHANGING WHAT THIS FILE DOES WITH A KEY MEANS UPDATING THAT LIST in the
   same commit — adding a read, dropping a write, moving to another key.
   แตะคีย์เมื่อไหร่ ต้องไปอัปเดตบัญชีที่จุดกลางด้วยเสมอ.

   ── BOTH ENDS ─────────────────────────────────────────────────────────────
   READS `follow_up.line.abandon_trigger_at`
   ← WHERE IT CAME FROM: `follow-up/abandon-trigger.helper.ts`, written once
     per customer. If this read is always empty, that writer is the one hop to
     check — not a repo-wide grep.
   ← WHO CLEARS IT: `follow-up/clear-follow-up.helper.ts` (webhook route) and
     `customer-link/clear-follow-up-on-register.helper.ts` (link route), so a
     value can disappear between two events and that is correct behaviour. */
import { readMemberConfig } from '../../chat/config';
import { providerFeatureOn } from '@/modules/customer-provider';

import { stampAbandonTriggerOnce } from './abandon-trigger.helper';
import { abandonIsSwitchedOff } from './ignore-abandon.rule';
import { ABANDON_TRIGGER_KEY } from './follow-up.keys';
import { clearFollowUpOnRegistered } from './clear-follow-up.helper';

/* [MAINPORT-20260823-ABANDONFIX] ⚠️ THIS FILE CONFLICTS if the abandon fix
   (`f4e0d81`) is cherry-picked to `main` ahead of the full merge. Resolve by
   taking `dev` whole — `git checkout --theirs -- <this file>` — never by
   hand-merging the hunks. Full reasoning, the measured conflict list and how to
   re-check it: `abandon-trigger.rule.ts`, same tag. */
export interface FollowUpGateDeps {
  chatMessageModel: Model<Record<string, unknown>>;
  memberModel: Model<Record<string, unknown>>;
  warn: (msg: string) => void;
}

export interface FollowUpGateInput {
  hasProfile: boolean;
  room: { _id?: unknown } | null | undefined;
  member: unknown;
  channelUserId: string | null | undefined;
  /**
   * [FEAT-20260821-IGNOREABANDON] the OA the message arrived on, read only for
   * its `ignore_abandon_assist` column.
   *
   * OPTIONAL ON PURPOSE — that is what makes this seamless. Every existing
   * caller and every existing test compiles untouched, and a caller that omits
   * it gets byte-identical behaviour to before this field existed. ไม่ส่งมา = เหมือนเดิมเป๊ะ.
   *
   * It is a plain row, not a service or a client, so folder rule 1 ("NOTHING
   * HERE KNOWS WHAT A WEBHOOK IS") still holds — the same shape `member` and
   * `room` already arrive as.
   */
  hook?: {
    ignore_abandon_assist?: unknown;
    /* [FIX-20260821-SLIPHELPERMARK] the card this OA has bound, handed to level 1
       so a row can be recognised by its id when a sender forgets to name it. */
    flex_customerhelper_id?: unknown;
  } | null;
}

export interface FollowUpVerdict {
  /**
   * Ask this customer for their details, then stop the flow.
   * Level 1: the registration card was the bot's recent word and they wrote back.
   */
  memberNeedRegister: boolean;
  /**
   * Hand this message to the register flow, then stop. Say nothing.
   * Level 2: they are already marked, so the asking has been done.
   */
  handOffToRegister: boolean;
  /** The customer has a profile, so the mark was removed and the loop is over. */
  cleared: boolean;
}

const QUIET: FollowUpVerdict = {
  memberNeedRegister: false,
  handOffToRegister: false,
  cleared: false,
};

export async function runFollowUpGate(
  input: FollowUpGateInput,
  deps: FollowUpGateDeps,
): Promise<FollowUpVerdict> {
  const channelUserId = String(input?.channelUserId ?? '');
  if (!channelUserId) return QUIET;

  // 0 — the way out, checked on every event
  if (input.hasProfile) {
    const cleared = await clearFollowUpOnRegistered(
      { hasProfile: true, member: input.member, channelUserId },
      { memberModel: deps.memberModel, warn: deps.warn },
    );
    return { ...QUIET, cleared };
  }

  /* [FEAT-20260821-IGNOREABANDON] the abandon check starts HERE, and this is
     where the owner asked for the switch to sit (20/08/2026: "เงื่อนไขการวางก็
     วางไว้ตรงที่เชค abadnon นั้นแหละ").

     ⚠️ AFTER LEVEL 0, NEVER BEFORE IT. Level 0 is the way OUT of the loop — it
     clears the mark once a customer finally registers, and it runs on every
     event. Short-circuiting the whole gate would strand every already-marked
     row: the customer registers, nothing clears, and the mark sits there
     forever waiting for a chase that no longer happens. Turning the chase off
     must not also turn the cleanup off. ปิดการตาม ≠ ปิดการล้างค่า.

     Levels 2 and 1 below are the abandon check in full — 2 reads the mark, 1
     earns it — so one guard here covers both, and neither needs to know the
     switch exists.
     revert: delete this block and the `hook` field above. */
  if (abandonIsSwitchedOff({ hook: input.hook, member: input.member })) {
    return QUIET;
  }
  /* [FEAT-20261014-PROVFEATURES] the site has no follow-up world (loan_v1): levels 2 and 1
     are skipped exactly like the switch above — and, like it, only AFTER level 0. */
  if (!providerFeatureOn('followUp')) return QUIET;

  /* 2 — already marked. Nothing is read and nothing is written: the mark IS the
     answer, and it was earned by a history check on an earlier message. */
  if (
    readMemberConfig(input.member, ABANDON_TRIGGER_KEY as never, null as never)
  ) {
    return { ...QUIET, handOffToRegister: true };
  }

  // 1 — not marked yet: the only branch that reads chat history
  const { matched } = await stampAbandonTriggerOnce(
    {
      hasProfile: false,
      room: input.room,
      member: input.member,
      channelUserId,
      /* [FIX-20260821-SLIPHELPERMARK] the bound card id, taken from the hook this
         gate already holds — no extra query, no new argument at the webhook.
         It lets the rule recognise a card by ITS ID when a sender forgets to name
         the row. Null for an OA that binds none, and the rule ignores it then. */
      helperCardId: input.hook?.flex_customerhelper_id,
    },
    {
      chatMessageModel: deps.chatMessageModel,
      memberModel: deps.memberModel,
      warn: deps.warn,
    },
  );
  /* Answered on `matched`, not on who won the write: two messages arriving
     together both match, only one stamps, and both customers must be answered.
     ตอบทุกคนที่เข้ากติกา ไม่ใช่เฉพาะคนที่ชนะการเขียน. */
  return { ...QUIET, memberNeedRegister: matched };
}
