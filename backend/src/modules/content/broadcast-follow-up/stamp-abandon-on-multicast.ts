/**
 * [FEAT-20260825-MCASTABANDON] A multicast that asks for details arms the follow-up gate.
 * ===========================================================================
 * Owner, 25/08/2026:
 *   *"กรณีที่เป็นเงื่อนไข ได้รับการ์ดแต่ยังไม่ลงทะเบียน และไม่ติ๊กเปิดเคส
 *     ให้ทำแบบนี้ใน flow multicast — member นั้น ๆ เมื่อสำเร็จให้ stamp เวลา
 *     ... เฉพาะเงื่อนไขนี้เท่านั้น นอกนั้นทำเหมือนเดิม ห้ามกระทบเงื่อนไขอื่น"*
 *
 * ── 🔴 READ THIS BEFORE CHANGING ANYTHING: WHAT THE STAMP ACTUALLY DOES ────
 * `abandon_trigger_at` is NOT a record. It is the FLAG the webhook's follow-up
 * gate reads, and its presence IS the whole of level 2
 * (`webhook/follow-up/follow-up.gate.ts`). Writing it here has a consequence
 * that is easy to miss and impossible to take back once messages are out:
 *
 *   the customer's NEXT inbound message — ANY message, a sticker included —
 *   is handed to the register scenario, which opens a case and ends the flow.
 *
 * That is not an inference. `register/scenarios/scenario-a.ts` declares
 * `endsFlow: true` unconditionally under [FEAT-20260820-AALWAYSENDS], and the
 * early return that used to skip the case when no digits were found was deleted
 * in the same change. Owner, 20/08: *"ไม่นับตัวเลขแล้ว ไม่ว่าจะเป็น text ส่งมา
 * หรือ sticker ... endflow = true ทันที ไม่มี false แล้ว"*.
 *
 * ⇒ Reaching N people with one of these campaigns means every one of them who
 *   replies at all becomes a case waiting for a human, and the bot stops
 *   answering that room. That is the intended outcome here — send a request for
 *   details, and let a human take over the moment anyone responds — but it is
 *   also the reason this file is scoped as narrowly as it is.
 *
 * ⚠️⚠️ ==== การตั้งแคมเปญ: ห้ามผสมขาใน `or` งานเดียว (31/08/2026) ====
 * THE DECISION IS PER JOB, THE WRITE IS PER PERSON — and that gap is a rule
 * about how campaigns are built, not a defect to code around (owner, 31/08,
 * asked and answered).
 *
 * `shouldStamp` below asks only whether the JOB's rules mention a trigger key;
 * the caller (`new-send.service.ts`) then hands it EVERYONE the run reached.
 * On a `match: 'or'` job that mixes this leg with `follow_up.notice_deposit_at`
 * / `notice_withdraw_at`, people who came in through those legs are armed too —
 * and per the paragraphs above, arming them means the bot stops answering their
 * room on their next message, for a campaign that never asked them anything.
 *
 * ⇒ THE RULE: keep the two audiences in SEPARATE campaigns.
 *     · แคมเปญ "ฝาก or ถอน"        — no trigger key ⇒ arms nobody
 *     · แคมเปญ "ตามการ์ดลงทะเบียน"  — everyone reached IS this leg ⇒ all correct
 *   Cost of the split: someone matching both audiences gets two messages.
 *   ห้ามผสมขาลงทะเบียนกับขาฝาก/ถอนใน `or` เดียวกัน — แยกเป็นสองแคมเปญ
 *
 * ⚠️ NOTHING ENFORCES THIS TODAY. Neither the form nor the API refuses the
 *    mixed shape, and getting it wrong produces no error anywhere — only quiet
 *    rooms. If that ever needs enforcing, the save-time door is
 *    `broadcasts.service.ts` beside `[FIX-20260831-BCASTPROFILEGATE]`, and the
 *    behaviour is pinned by the mixed-`or` case in
 *    `z-test/unit/broadcast-fullflow-matrix.spec.ts`.
 * 📖 todo/task/30082026/be_todo102_31082026.md
 *
 * ⚠️ THE GATE CLEANS UP AFTER ITSELF. Two clearers remove the flag the moment
 * the customer turns out to have a profile — `webhook/follow-up/clear-follow-up
 * .helper.ts` and `customer-link/clear-follow-up-on-register.helper.ts` — so
 * nobody is left armed for ever. Nothing here needs to undo anything.
 *
 * ⚠️ WRITTEN ONCE, NOT OVERWRITTEN. `writeMemberConfigOnce` is first-writer-wins
 * in its own filter, matching the only other writer of this key. Someone already
 * stuck keeps their original date, so "since when" survives a second campaign.
 *
 * ⚠️ NOT A WEBHOOK CHANGE. Owner: *"ไม่เกี่ยวกับ webhook ห้ามแก้ไข"*. Nothing
 * under `webhook/` is touched — this writes the same key through the same public
 * door the webhook uses, and the gate reads it exactly as it already did.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 📌 CHANGING YOUR MIND LATER — every case is an edit in THIS FILE only
 * ═══════════════════════════════════════════════════════════════════════════
 * ① Stop stamping entirely      → `STAMP_ABANDON_ENABLED = false`
 * ② Cover more audience filters → add to `TRIGGER_SOURCE_KEYS`
 * ③ Stamp even when the case
 *    checkbox IS ticked         → drop the `directTicket` clause in `shouldStamp`
 * ④ Let a later round move the
 *    date forward               → swap `writeMemberConfigOnce` for
 *                                 `writeMemberConfig`, and rewrite the note
 *                                 above: the key stops meaning "since when"
 * ⑤ Stamp a different key       → `STAMP_KEY`, and update the CONSUMERS block in
 *                                 `chat/config/member-config.registry.ts` in the
 *                                 same commit or `member-config.spec.ts` goes red
 *
 * ⚠️ MULTICAST ONLY, and not by a check written here: the caller hands over the
 * people actually REACHED, which `/message/broadcast` cannot produce. A broadcast
 * job arrives with an empty list and this does nothing.
 *
 * ⚠️ NEVER THROWS. The messages are already on customers' phones; a failed
 * bookkeeping write must not turn a delivered campaign into a failed one — the
 * rule the transcript writer and the notice-clearer beside it both follow.
 *
 * [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
 * TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.
 *
 * ── BOTH ENDS ─────────────────────────────────────────────────────────────
 * WRITE `follow_up.line.abandon_trigger_at` (via `writeMemberConfigOnce`)
 * → WHO TAKES IT: `webhook/follow-up/follow-up.gate.ts` — its presence IS the
 *   whole of level 2. That reader is why this write has teeth: an armed customer
 *   is handed to the register scenario on their next inbound message, and that
 *   scenario opens a case and ends the flow unconditionally. This file writes a
 *   DECISION, not a note.
 * → WHO ELSE WRITES IT: `webhook/follow-up/abandon-trigger.helper.ts`, when the
 *   bot's own history check finds the register card. Same key, same door, same
 *   first-writer-wins rule — two entrances to one condition.
 * → WHO CLEARS IT: `webhook/follow-up/clear-follow-up.helper.ts` (chat route)
 *   and `customer-link/clear-follow-up-on-register.helper.ts` (link route).
 *   Both remove it the moment the customer turns out to have a profile, so
 *   nothing written here is permanent and nothing here needs to undo it.
 *
 * revert: delete this file, its line in `broadcast-follow-up/index.ts`, the
 *         `[FEAT-20260825-MCASTABANDON]` block in `broadcast-run/new-send.service.ts`,
 *         this file's entry in the registry CONSUMERS block, and its line in
 *         `z-test/unit/member-config.spec.ts`.
 */
import type { Model } from 'mongoose';

/* 🔴 Deep path, NOT `@/modules/chat`. `chat.module.ts` imports `@/modules/content`,
   so pulling the chat barrel back from inside `content/` closes a cycle that fails
   as an undefined schema at boot — the same escape the notice-clearer uses. */
import { writeMemberConfigOnce } from '../../chat/config';
import { providerFeatureOn } from '@/modules/customer-provider';

/** One switch. `false` = nothing is stamped and every other behaviour is untouched. */
export const STAMP_ABANDON_ENABLED = true;

/**
 * The member-config key this writes.
 * Declared in `webhook/follow-up/follow-up.keys.ts` as `ABANDON_TRIGGER_KEY`;
 * spelled out here rather than imported so `content/` keeps its distance from
 * `webhook/`, which this change is explicitly not allowed to touch.
 * ⚠️ If it is ever renamed there, this string must move with it — grep the
 *    dotted form, not the constant.
 */
export const STAMP_KEY = 'follow_up.line.abandon_trigger_at';

/**
 * Which audience filters mean "this campaign is asking for their details".
 *
 * ⚠️ AUDIENCE SOURCE KEYS as stored in `audience.rules[].key`, not member paths.
 * ⚠️ Deliberately ONE entry. Every other filter — the other follow-up ones
 *    included — must keep behaving exactly as it did, ticked or not.
 */
export const TRIGGER_SOURCE_KEYS: readonly string[] = [
  'follow_up.customer_helper_at',
];

export interface StampDecisionInput {
  /** Audience source keys this job's rules actually used. */
  readonly usedKeys: readonly string[];
  /** Did the admin tick "open a case for everyone this reaches"? */
  readonly directTicket: boolean;
}

/**
 * Should this job arm the people it reaches?
 *
 * Both halves required. The second is the owner's own line: when the campaign
 * opens cases itself, a human is already taking over and arming the gate would
 * only queue a SECOND case behind the first. Ticked ⇒ behaves exactly as it did
 * before this file existed.
 */
export const shouldStamp = (input: StampDecisionInput): boolean => {
  if (!STAMP_ABANDON_ENABLED) return false;
  /* [FEAT-20261014-PROVFEATURES] no follow-up world on this site (loan_v1) — arm nobody. */
  if (!providerFeatureOn('followUp')) return false;
  if (input.directTicket === true) return false;
  return input.usedKeys.some((k) => TRIGGER_SOURCE_KEYS.includes(k));
};

export interface StampAbandonResult {
  /** Members this call actually wrote a flag onto (already-flagged ones do not count). */
  readonly stamped: number;
  /** True when at least one write threw — reported, never raised. */
  readonly failed: boolean;
}

const NOTHING: StampAbandonResult = { stamped: 0, failed: false };

/**
 * Arm the follow-up gate for everyone a multicast actually reached.
 *
 * @param lineUserIds the people LINE accepted — never the people merely targeted.
 *        Someone the send never reached was not asked anything, and arming them
 *        would open a case about a message they never saw.
 */
export async function stampAbandonForReached(
  memberModel: Model<Record<string, unknown>>,
  input: { readonly lineUserIds: readonly string[] },
  decision: StampDecisionInput,
  warn: (msg: string) => void,
): Promise<StampAbandonResult> {
  if (!shouldStamp(decision)) return NOTHING;

  const ids = [
    ...new Set(input.lineUserIds.map((v) => String(v ?? '').trim())),
  ].filter(Boolean);
  if (ids.length === 0) return NOTHING;

  const now = new Date();
  let stamped = 0;
  let failed = false;

  for (const lineUserId of ids) {
    try {
      /* First-writer-wins lives in the door's own filter, so someone already
         flagged keeps their original date and simply reports `false` here. */
      const wrote = await writeMemberConfigOnce(
        { line_user_id: lineUserId },
        STAMP_KEY,
        now,
        { memberModel },
      );
      if (wrote) stamped += 1;
    } catch (e) {
      failed = true;
      warn(
        `[MCASTABANDON] stamp failed for one member (the send is unaffected): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  return { stamped, failed };
}
