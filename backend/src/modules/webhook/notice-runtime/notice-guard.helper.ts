/**
 * [FEAT-20260822-NOTICERUNTIME] R3c — the ONE impure step of the notice mode.
 * ===========================================================================
 * Everything before this file decides; this file ACTS: pick a case that can
 * actually send → load and render the card → the customer's row → the LINE
 * reply → the bot's row → the member stamp → the rate ladder → the webhook
 * log. (The cooldown step is still in the chain but ships switched off — see
 * NOTICE_COOLDOWN_ENABLED in notice-policy.ts.) The
 * webhook reaches it as one guarded call that early-returns (the extension
 * rule in webhook.service.ts's header), with every house-specific ability
 * injected as a dep — the same shape `runFollowUpGate` set.
 *
 * ⚠️ FAIL-OPEN, BOTH DIRECTIONS, NEVER THROW (owner: "ห้ามพังเด็ดขาด"):
 *   · anything missing BEFORE the send (no decision, no card configured, card
 *     unloadable, cooldown) → `false` — the webhook continues byte-identical;
 *   · an error AFTER the send → still `true` — the customer already got the
 *     card, and falling through would hand the same event to the AI for a
 *     second reply. `sent` is the pivot.
 *
 * ⭐ WRITE ORDER, and it changed on 22/08 — read [FIX-20260822-NOTICEHARDEN
 * #10] below before touching it: customer row → LINE reply → bot row → stamp
 * → ladder → webhook log. The refusal branch writes its bot row FIRST because
 * it always reaches its send; this guard fails open, so a row written before a
 * rejected send would claim a card the customer never saw. ส่งก่อน ค่อยบันทึก.
 *
 * [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
 * TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.
 *
 * ── BOTH ENDS ─────────────────────────────────────────────────────────────
 * READ  `notice_deposit_at` / `notice_withdraw_at` / `notice_payment_at`
 *       (via the decision's stampKey) — WHERE IT CAME FROM: written by this
 *       same file, right below, after a successful send. One file holds both
 *       ends of these keys on purpose.
 * WRITE — WHO TAKES IT: the read above, on the member's NEXT qualifying
 *       message. ⚠️ 22/08: that read is now INERT in production —
 *       NOTICE_COOLDOWN_ENABLED ships `false`, so the stamp is read and never
 *       blocks. It is still written on every send, which is what makes the
 *       cooldown a one-line flip. Nothing else reads these stamps today; the
 *       registry's CONSUMERS block mirrors this and must move with it.
 * CLEAR: NOBODY, AND THAT IS THE DESIGN — a stamp goes inert by aging past
 *       NOTICE_COOLDOWN_MINUTES; deleting it buys nothing.
 *
 * revert: delete this file, its barrel line, `tryNoticeGuard` in
 * webhook.service.ts and that method's two call lines.
 */
import type { Model } from 'mongoose';

import { readMemberConfig, writeMemberConfig } from '../../chat/config';

import { buildNoticeContext } from './notice-context';
import { noticeCooldownBlocks } from './notice-cooldown';
import {
  NOTICE_COOLDOWN_ENABLED,
  NOTICE_FALLBACK_SCOPE,
  NOTICE_QUOTA_CHARGE,
} from './notice-policy';
import { decideNoticeAll } from './notice-decide';
import type { NoticeCase } from './cases';
import type { NoticeDecision } from './cases/notice-case.types';

/** LINE alt text for every notice card — one string, editable here. */
export const NOTICE_ALT_TEXT = 'แจ้งเตือนจากระบบ';

export interface NoticeGuardDeps {
  /**
   * [FEAT-20260831-ADMINVIAWITHDRAW] Consult only these cases. Omitted ⇒ all of
   * them, which is what every caller before this feature did and still does.
   *
   * ⚠️ The fallback walk below is unaffected: it still refuses to cross sides
   * (it filters candidates to the FIRST one's `stampKey`), so a one-lane slice
   * simply arrives with nothing to cross to.
   */
  cases?: readonly NoticeCase[];
  /** the member row already loaded by the webhook (lean doc or null). */
  member: unknown;
  memberModel: Model<Record<string, unknown>>;
  channelUserId: string;
  /** load + fully render the card by id — null = cannot (guard stays quiet). */
  loadCard: (flexId: string) => Promise<unknown>;
  /**
   * image path only: write the customer's OWN row before anything else (the
   * text path has already written it). Errors are swallowed by the caller of
   * this dep — a failed history row must not cost the customer the reply.
   */
  logCustomerRow?: () => Promise<unknown>;
  /** fire-and-forget bot history row for the card that went out. */
  logBotRow: (args: {
    card: unknown;
    flexDocId: string;
    caseId: string;
  }) => void;
  /** the LINE reply itself. */
  sendFlex: (
    card: unknown,
    altText: string,
  ) => Promise<{ status: number; data?: unknown }>;
  /**
   * [FIX-20260822-NOTICECOLLIDE] Charge the inbound rate ladder — image path
   * only, where the guard answers ~600 lines ABOVE `rateLimit.consume` and the
   * event would otherwise never reach a counter. Without it a customer could
   * push slips through the off-service window for free: no quota, no strike,
   * no escalation — the very defence the removed cooldown was justified by.
   * Omitted on the text path, where the webhook has already charged the event
   * before the guard runs; charging twice there would halve the real limit.
   *
   * ⭐ [FIX-20260822-NOTICEQUOTA] CALLED ONLY AFTER A CARD REALLY WENT OUT, so
   * the count is exactly one per event on every path — see NOTICE_QUOTA_CHARGE
   * in notice-policy.ts for the arithmetic and for the switch that removes it.
   * The returned verdict is COUNTED, NOT OBEYED: silencing the card on
   * `limited` would hand the same event back to the flow, which charges it a
   * second time. เรียกหลังส่งสำเร็จเท่านั้น · นับ ไม่ใช่สั่งเงียบ.
   */
  consumeQuota?: () => Promise<{ limited: boolean }>;
  /** webhook log, after a successful send. */
  wlog: (args: {
    actionType: string;
    httpStatus: number;
    responseSummary?: unknown;
  }) => Promise<void>;
  warn: (msg: string) => void;
  now: Date;
}

/**
 * true = a notice card was sent — the caller must `return` (no AI, and on the
 * image path no Swiftcheck, no payment, for THIS event only). false = the caller
 * proceeds exactly as if the notice mode did not exist.
 */
/** A card reference as comparable text: a string, an ObjectId, or nothing. */
function readCardId(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  /* [FIX-20260822-CARDSHAPE] an ARRAY is never a card reference, and it is the
     one junk shape that does not fail loudly: `['<an id>']` stringifies to that
     id, so a hand-edited or mis-migrated row would send a card the operator
     never bound to this case — and a two-element array ends the same-side walk
     on an id that can never resolve. Rejecting it here means the field reads as
     "not configured", which is the honest answer. array ไม่ใช่ id ของการ์ด. */
  if (Array.isArray(raw)) return '';
  if (
    raw !== null &&
    typeof raw === 'object' &&
    typeof (raw as { toString?: unknown }).toString === 'function' &&
    (raw as { toString: () => string }).toString !== Object.prototype.toString
  ) {
    return (raw as { toString: () => string }).toString();
  }
  return '';
}

export async function runNoticeGuard(
  ctxInput: Parameters<typeof buildNoticeContext>[0],
  deps: NoticeGuardDeps,
): Promise<boolean> {
  let sent = false;
  try {
    /* [FIX-20260822-NOTICEHARDEN #9] EVERY matching case, in order — not just
       the first. A case whose card is NOT CONFIGURED (a state only a clone or
       a hand edit can reach) used to silence the whole guard, so a fully
       configured case behind it never got its turn and nothing was logged.
       The first candidate that HAS A CARD ID wins; precedence is still
       entirely NOTICE_CASE_ORDER.
       ⚠️ THE FALLBACK IS DELIBERATELY SHALLOW — it answers "is a card bound?",
       not "does that card load?". A bound id whose flex document is missing or
       unrenderable stops the guard right there (`loadCard` → null → false) and
       the flow carries on to the AI; it does NOT walk to the next case. Trying
       the next one would mean a DB read per candidate on a path that runs on
       every qualifying message, to rescue a state that is already broken and
       visible in the panel. If that trade ever changes, move the loadCard call
       INTO this loop — one edit, same shape. ผูกการ์ดไว้แต่โหลดไม่ได้ = เงียบ ไม่ไล่ต่อ. */
    const ctx = buildNoticeContext(ctxInput);
    const candidates = decideNoticeAll(ctx, deps.cases);
    if (candidates.length === 0) return false;

    /* [FIX-20260822-NOTICEFALLBACK] the walk stays on ONE SIDE of the business.
       The word lists share twelve substrings, so a plain sentence matches the
       deposit and the withdraw screens together; walking freely would answer a
       deposit complaint with the withdraw card whenever the deposit card is
       unset. Policy: NOTICE_FALLBACK_SCOPE. เดินได้เฉพาะฝั่งเดียวกัน. */
    const firstStamp = candidates[0]?.stampKey;
    const reachable =
      NOTICE_FALLBACK_SCOPE === 'any'
        ? candidates
        : candidates.filter((c) => c.stampKey === firstStamp);

    let decision: NoticeDecision | null = null;
    let flexDocId = '';
    for (const c of reachable) {
      const rawCard = ctxInput.hook[c.cardField];
      /* An ObjectId from a lean row carries its own `toString`, which yields
         the id text; anything else — a plain object, an array — would
         stringify to "[object Object]" and be a card reference that can never
         resolve. Accept the two shapes that exist and reject the rest, the
         same rule `idText` in abandon-trigger.rule.ts applies. */
      const id = readCardId(rawCard);
      if (id) {
        decision = c;
        flexDocId = id;
        break;
      }
    }
    // D6 keeps these configured on every write path; a row that slipped past
    // it simply stays quiet — fail-open, never throw.
    if (!decision) return false;

    const lastAt = readMemberConfig(
      deps.member as never,
      decision.stampKey as never,
      null as never,
    );
    /* [FIX-20260822-NOTICEPOLICY] REMOVED by default — the inbound rate ladder
       already throttles floods, and on the slip path a cooldown that blocked a
       CARD also decided whether MONEY was processed. Kept as one policy flip
       (notice-policy.ts NOTICE_COOLDOWN_ENABLED) with its module and tests
       intact. ถอดออกตามคำสั่ง · เอากลับได้ที่บรรทัดเดียว. */
    if (
      noticeCooldownBlocks(lastAt, deps.now, {
        enabled: NOTICE_COOLDOWN_ENABLED,
      })
    ) {
      /* ⚠️ A COOLDOWN EXIT DOES NOT WALK TO THE SIBLING CASE, by construction:
         the sibling on this side shares the SAME stamp key, so it would be
         inside the same cooldown anyway. Latent today (the cooldown ships off)
         and correct when it is switched back on. ติดคูลดาวน์ = ทั้งฝั่งเงียบ. */
      return false;
    }

    const card = await deps.loadCard(flexDocId);
    if (!card) return false;

    // customer row first (image path) — its failure must not stop the reply.
    if (deps.logCustomerRow) {
      try {
        await deps.logCustomerRow();
      } catch (e) {
        deps.warn(
          `[NOTICERUNTIME] customer row failed: ${(e as Error).message}`,
        );
      }
    }

    /* [FIX-20260822-NOTICEHARDEN #10] THE SEND COMES FIRST, and the bot row
       only after it succeeds — the opposite of the refusal branch, on purpose.
       That branch reaches its send unconditionally, so writing the row first is
       safe there. This guard FAILS OPEN: a rejected send (LINE 400 on a card it
       dislikes, a timeout) returns false and the flow carries on to the AI. A
       row written beforehand would then claim a card the customer never saw —
       the admin screen and the phone would disagree — and it would occupy a
       slot in the abandon lookback (#11) for a card that does not exist.
       ส่งสำเร็จก่อน ค่อยบันทึกว่าส่ง. */
    const res = await deps.sendFlex(card, NOTICE_ALT_TEXT);
    sent = true;

    deps.logBotRow({ card, flexDocId, caseId: decision.caseId });

    /* [FIX-20260822-NOTICEHARDEN #8] THE STAMP IS WRITTEN BEFORE THE LOG.
       `wlog` is awaited, so a throw from it used to skip the stamp entirely —
       the record of "this member was already warned" lost to a log hiccup,
       exactly when the system is under stress. The stamp is the durable half;
       the webhook log is the observable half. Durable first. */
    try {
      await writeMemberConfig(
        { line_user_id: deps.channelUserId },
        decision.stampKey,
        deps.now,
        { memberModel: deps.memberModel },
      );
    } catch (e) {
      deps.warn(`[NOTICERUNTIME] stamp write failed: ${(e as Error).message}`);
    }

    /* [FIX-20260822-NOTICEQUOTA] THE LADDER IS CHARGED HERE — after the card
       has gone out, never before. Charging when the case merely MATCHED meant
       every non-sending path (limited · card not configured · send rejected)
       returned false and let the webhook's own limiter charge the SAME event
       again, two units for one image. Best-effort like the stamp: the ladder
       is a counter, and losing one count must never cost the customer their
       card. นับหลังส่งจริง ครั้งเดียว. */
    if (NOTICE_QUOTA_CHARGE === 'after-send' && deps.consumeQuota) {
      try {
        await deps.consumeQuota();
      } catch (e) {
        deps.warn(
          `[NOTICERUNTIME] quota charge failed: ${(e as Error).message}`,
        );
      }
    }

    await deps.wlog({
      actionType: `notice_case_${decision.caseId.toLowerCase()}_flex`,
      httpStatus: res.status,
      responseSummary: res.data,
    });
    return true;
  } catch (e) {
    deps.warn(`[NOTICERUNTIME] guard failed: ${(e as Error).message}`);
    return sent;
  }
}
