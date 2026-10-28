/**
 * The way out of the follow-up loop: the customer registered.
 * ===========================================================================
 * Every level is gated on the customer having no profile, so a registered
 * customer already stops triggering them. This goes one step further and REMOVES
 * the marks, because a stamp that outlives the reason for it is a trap: the day
 * somebody writes a query, a report or a screen over these keys, a customer who
 * registered months ago would still be counted as stuck.
 * ลงทะเบียนแล้วต้องล้างทิ้ง ไม่งั้นค้าง loop ในสายตาของคนที่มาอ่านทีหลัง.
 *
 * ⚠️ COST — zero queries unless there is something to remove. The decision is
 * made from the member the request already loaded; only a member who actually
 * carries a stamp causes a write.
 *
 * ⚠️ Its own file, its own question: the levels ask "should this customer be
 * marked", this asks "should the marks go". No Nest injection, no webhook types
 * — anything can call it, and deleting it changes nothing else.
 *
 * revert: delete this file and its call in the gate.
 */
import type { Model } from 'mongoose';

/* [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
   TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.

   THIS FILE CLEARS `follow_up.line.abandon_trigger_at` on the WEBHOOK path.
   The link path has a second clearer — see the CONSUMERS list; miss one and a
   customer stays marked for ever on that route.

   That file is the only place a key may be declared, it carries the checklist
   for adding one, the measured index/query rules, and a CONSUMERS list naming
   every file that touches the bag — this one included. `member-config.spec.ts`
   greps the code and fails if that list stops matching reality, so the two
   cannot drift apart silently.
   ⚠️ CHANGING WHAT THIS FILE DOES WITH A KEY MEANS UPDATING THAT LIST in the
   same commit — adding a read, dropping a write, moving to another key.
   แตะคีย์เมื่อไหร่ ต้องไปอัปเดตบัญชีที่จุดกลางด้วยเสมอ.

   ── BOTH ENDS ─────────────────────────────────────────────────────────────
   CLEARS `follow_up.line.abandon_trigger_at` — WHOSE? the flag written by
   `follow-up/abandon-trigger.helper.ts`, read by `follow-up/follow-up.gate.ts`.
   ON WHICH ROUTE: the WEBHOOK one, when an event shows the customer now has a
   profile.
   ⚠️ THE OTHER ROUTE HAS ITS OWN CLEARER:
   `customer-link/clear-follow-up-on-register.helper.ts` handles registration
   through the link. Neither covers the other. ลบตัวใดตัวหนึ่ง = เส้นนั้นค้างตลอด.
   ⚠️ It clears ONE leaf by dot-path, so a sibling key of another feature is not
   just spared — it is not addressable from this call. */
import { clearMemberConfig, readMemberConfig } from '../../chat/config';

import { ABANDON_TRIGGER_KEY } from './follow-up.keys';

export interface ClearFollowUpDeps {
  memberModel: Model<Record<string, unknown>>;
  warn: (msg: string) => void;
}

export interface ClearFollowUpInput {
  /** The profile check THIS request already performed. */
  hasProfile: boolean;
  /** The member this request already loaded. */
  member: unknown;
  /** The customer, by their channel id. */
  channelUserId: string | null | undefined;
}

/**
 * @returns true when something was actually removed.
 */
export async function clearFollowUpOnRegistered(
  input: ClearFollowUpInput,
  deps: ClearFollowUpDeps,
): Promise<boolean> {
  try {
    const channelUserId = String(input?.channelUserId ?? '');
    if (!channelUserId || !input?.hasProfile || !input?.member) return false;

    /* ⚠️ ONE KEY, AND THE OTHER ONE IS LEFT OUT ON PURPOSE.
       `follow-up.keys.ts` declares TWO keys. Only the FLAG belongs here:
         · `abandon_trigger_at` — "stuck right now" ⇒ registering ends it
         · `request_reg_at`     — "was asked at some point" ⇒ **NEVER CLEARED**,
           not here, not by the customer-link clearer, not by unlinking
       Owner: "request_reg_at = ห้ามเคลียร์ห้ามยุ่ง คงค่าเดิม".
       Adding it to this array would erase, on the very event that proves the
       feature worked, exactly the customers the count exists to measure.
       Both ends of this are written down: see the CONSUMERS table in
       `src/modules/chat/config/member-config.registry.ts`.
       Pinned by `z-test/unit/clear-follow-up-on-register.spec.ts:40`, which
       fails if the name appears in the list OR anywhere in the call payload. */
    const keys = [ABANDON_TRIGGER_KEY].filter((k) =>
      readMemberConfig(input.member, k as never, null as never),
    );
    if (!keys.length) return false;

    const filter = { line_user_id: channelUserId };
    let cleared = false;
    for (const key of keys) {
      // one leaf at a time — see clearMemberConfig; a sibling key belonging to
      // another feature must survive
      cleared =
        (await clearMemberConfig(filter, key, {
          memberModel: deps.memberModel,
        })) || cleared;
    }
    return cleared;
  } catch (err) {
    deps.warn(`[FOLLOW-UP] clear skipped: ${(err as Error)?.message}`);
    return false;
  }
}
