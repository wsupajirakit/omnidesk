/**
 * [FEAT-20260822-NOTICERUNTIME] site_rule_check — is the deposit / withdraw
 * side of the site actually OFF, judged from the site-rules payload.
 * ===========================================================================
 * D7 was decided on 22/08 from the owner's own pasted payload plus the rule
 * the model already follows (docs/train_docs/training-doc-general-information__
 * suggestion_text.md:309-335) — ONE contract for BE and AI, so the two can
 * never disagree about whether a side is open:
 *
 *   deposit side counts OPEN cards from BOTH groups:
 *     account_type "deposit"          → open when is_view === true
 *                                       (is_view decides — NOT status; doc :318)
 *     account_type "deposit-withdraw" → open when status === "enable"
 *   withdraw side counts OPEN cards from BOTH groups:
 *     account_type "withdraw" | "deposit-withdraw" → open when status === "enable"
 *     (status decides — NOT is_view; never swap the two sides' fields)
 *   status !== "enable" (disable, maintenance) = closed — no third state.
 *   ≥1 open card = the side is open · 0 open cards = the side is OFF.
 *
 * ⚠️ FAIL-OPEN IS THE OWNER'S OWN RULE, verbatim: "ถ้าไม่เจอ array account นี้
 * ห้ามพัง หรือหาไม่เจอห้ามพัง ให้ออก xxxx off service = false". Every unknown —
 * no payload, no accounts array, empty array, cards missing the field that
 * decides their side — answers `false` (NOT off), never throws. No data =
 * no notice = the webhook behaves exactly as before. ไม่รู้ = ไม่เตือน.
 *
 * Only account_type / is_view / status are ever read — the rest of
 * bank_account must never influence, or reach, anything customer-facing
 * (doc :193, :341-345).
 *
 * ⚠️ FEED IT THE TURN'S OWN BLOCK, NOT `hook.raw_site_rules_data`: the hook
 * column is a panel cache written AFTER the hook was cached for this request
 * (stale-by-one-request; legacy-external hooks never write it at all). The
 * caller passes the site-rules block from the request's `profileData`, the same
 * source the AI block reads. `pickShop` absorbs every envelope shape.
 *
 * Pure — borrow it directly; nothing here touches the database or the clock.
 * revert: delete this file with the rest of `notice-runtime/`.
 */
import { pickShop } from '@/modules/system';

export interface NoticeSiteRuleStatus {
  /** true = the deposit side has ZERO open cards — deposit is off-service. */
  deposit_off: boolean;
  /** true = the withdraw side has ZERO open cards — withdraw is off-service. */
  withdraw_off: boolean;
}

const OPEN: NoticeSiteRuleStatus = { deposit_off: false, withdraw_off: false };

type Card = Record<string, unknown>;

function cardsOf(raw: unknown): Card[] | null {
  const shop = pickShop(raw) as Record<string, unknown> | null | undefined;
  if (!shop || typeof shop !== 'object') return null;
  const bank = shop['bank_account'] as Record<string, unknown> | undefined;
  const accounts = bank?.['accounts'];
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  return accounts.filter((a): a is Card => typeof a === 'object' && a !== null);
}

function depositCardOpen(card: Card): boolean | null {
  if (card['account_type'] === 'deposit') {
    // is_view decides the deposit side; a card without it is skipped (null).
    if (!('is_view' in card)) return null;
    return card['is_view'] === true;
  }
  if (card['account_type'] === 'deposit-withdraw') {
    /* [FEAT-20260823-MIXEDDEPVIEW] Owner, 23/08, verbatim: "ปรับในแพลน
     * deposit-withdraw ถ้าเป็นขาบัญชีฝาก จะดูแค่ is_view" — followed by
     * "ถอนเหมือนเดิมไม่แก้อะไร". The ONE deliberate logic change in the
     * check-flags work; everything else in this file is frozen.
     *
     * WAS: `status === 'enable'` (same as the withdraw leg). NOW the deposit
     * leg of a mixed card reads `is_view`, exactly like a pure deposit card —
     * absent `is_view` skips the card (null), the same shape as above. Real
     * payloads carry `is_view` on every account, so the skip is a definition,
     * not a path that occurs.
     *
     * ⚠️ ONE mixed card is now judged by DIFFERENT fields per side — deposit
     * by `is_view`, withdraw (below) by `status`. Deliberate, not a bug.
     * ใบผสมใบเดียว ตัดสินคนละ field ต่อฝั่ง — ตั้งใจ.
     *
     * What actually flips (only where the two fields disagree):
     *   is_view=false · status=enable   deposit was OPEN  → now CLOSED (B/F can fire)
     *   is_view=true  · status=disable  deposit was CLOSED → now OPEN  (B/F go quiet)
     * The withdraw verdict is untouched in every cell — pinned against the
     * BEFORE fixture (notice-before-20260823.json) by notice-flags-parity.spec.
     * revert: return card['status'] === 'enable'; and flip the checker spec back. */
    if (!('is_view' in card)) return null;
    return card['is_view'] === true;
  }
  return null; // not a deposit-side card
}

function withdrawCardOpen(card: Card): boolean | null {
  if (
    card['account_type'] === 'withdraw' ||
    card['account_type'] === 'deposit-withdraw'
  ) {
    if (!('status' in card)) return null;
    return card['status'] === 'enable';
  }
  return null; // not a withdraw-side card
}

/**
 * The two off-service verdicts for one site-rules payload.
 * A side is OFF only when it had countable cards and ALL of them are closed —
 * a side with nothing countable is unknown, and unknown = not off (fail-open).
 */
export function noticeSiteRuleCheck(raw: unknown): NoticeSiteRuleStatus {
  try {
    const cards = cardsOf(raw);
    if (!cards) return OPEN;

    let depSeen = 0;
    let depOpen = 0;
    let wdSeen = 0;
    let wdOpen = 0;
    for (const card of cards) {
      const dep = depositCardOpen(card);
      if (dep !== null) {
        depSeen += 1;
        if (dep) depOpen += 1;
      }
      const wd = withdrawCardOpen(card);
      if (wd !== null) {
        wdSeen += 1;
        if (wd) wdOpen += 1;
      }
    }
    return {
      deposit_off: depSeen > 0 && depOpen === 0,
      withdraw_off: wdSeen > 0 && wdOpen === 0,
    };
  } catch {
    // ห้ามพัง — any surprise shape answers "not off" and the flow moves on.
    return OPEN;
  }
}
