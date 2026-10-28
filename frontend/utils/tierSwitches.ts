/**
 * 📖 DOC: `omnidesk-api/docs/flow/ticket-and-customer-provider-flow.md` §6 — how a
 * per-provider CONDITION is added, including rule 5: a switch that owns a
 * value must CLEAR that value when it hides. This file is that rule's home.
 *
 * [FIX-20260905-TIERFILTERSTUCK] What a ticket-list response means for the two
 * tier switches — including the part that is easy to forget: hiding the filter
 * has to LET GO of the filter.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          (PART 4 §18-23)
 *
 * ## Why this is a module and not three lines inside the page
 * Three fetch paths in `pages/chat/TicketChat.tsx` read the same response (the
 * fresh active list, each page of a deep refresh, and the completed list). The
 * rule written three times is the shape that drifts the moment one copy is
 * changed — and this rule has a branch in it now, so a drifted copy would not
 * look wrong, it would just leave one path stuck. One definition, three callers.
 *
 * ## 🔴 THE BUG THIS EXISTS TO PREVENT
 * The first cut of PART 4 hid the tier-filter CONTROL and left `filterTier`
 * alone, reasoning that a hidden control simply never gets set. That holds for a
 * page LOADED with the switch already off. It does not hold for a page that was
 * already open with a tier chosen when the switch flipped — and the dashboard is
 * a long-lived SPA, so that is the ordinary case, not a corner one.
 *
 * `filterTier` is not decoration. It drives:
 *   · the ACTIVE row predicate            (`TicketChat.tsx`, tier mismatch ⇒ row dropped)
 *   · the COMPLETED row predicate         (same rule, second list)
 *   · `hasFilter`, which the tab COUNTS read
 *   · the SERVER query, as `tier:`
 *
 * So the operator would have been left with a shortened list — server-side and
 * client-side — a tab count computed over the shortened set, and no control on
 * screen to clear any of it. ซ่อนตัวกรองต้องล้างค่าด้วย ไม่งั้นรายการหายโดยไม่มีปุ่มแก้
 *
 * Clearing it also puts the request back on the byte-identical "no filter" path
 * that the unset-provider proof already covers, so the OFF state stays a state
 * somebody has already tested rather than a new one.
 *
 * ## `!== false`, not `=== true`
 * An absent or `undefined` key means ON. That is the same absent-means-default
 * rule the back-end port declares for a provider entry that omits its tier
 * block, and it is what makes a response from a back end that predates these
 * keys render exactly like today. ไม่ส่งมา = เปิด
 *
 * revert: delete this file and its spec, and set the two flags directly at the
 *         three call sites in `TicketChat.tsx`, accepting the stuck-filter case.
 */

/** Only the keys this rule reads. Anything else on the envelope is ignored. */
export interface TierSwitchResponse {
  readonly show_tier_badge?: unknown;
  readonly show_tier_filter?: unknown;
  /* [FEAT-20260907-PROVCONDS] third §6 switch on the same envelope: the
     FOLLOW-UP world (follow-up card · ignore-abandon shield · contacts follow
     filter). Absent = ON, exactly like its two siblings. */
  readonly show_follow_ups?: unknown;
  /* [FEAT-20260907-PROVCONDS] these two must survive a NULL profile answer
     (the register box renders exactly then), so they ride the list envelope
     beside the tier switches. Absent = ON, like every sibling. */
  readonly show_register_action?: unknown;
  readonly show_walletpay_card?: unknown;
}

export interface TierSwitchState {
  /** Draw the 💎 badge — at BOTH sites, the ticket card and the room header. */
  readonly showBadge: boolean;
  /** Draw the tier filter CONTROL. */
  readonly showFilter: boolean;
  /** Draw the follow-up world (card · shield · contacts filter). */
  readonly showFollowUps: boolean;
  /** Draw the admin register action (shop-api customer-link flow). */
  readonly showRegisterAction: boolean;
  /** Draw the WalletPay-results card (shop-api payment world). */
  readonly showWalletpayCard: boolean;
  /**
   * Clear any tier the operator had selected.
   *
   * 🔴 Reported SEPARATELY from `showFilter` rather than inferred from it by the
   * caller. Inferring it is exactly the step that got skipped the first time,
   * and a caller that forgets produces no error, no warning and no visible
   * difference until an operator's list is quietly short.
   */
  readonly clearSelection: boolean;
}

export function tierSwitchesFrom(
  res: TierSwitchResponse | null | undefined,
): TierSwitchState {
  const showFilter = res?.show_tier_filter !== false;
  return {
    showBadge: res?.show_tier_badge !== false,
    showFilter,
    clearSelection: !showFilter,
    showFollowUps: res?.show_follow_ups !== false,
    showRegisterAction: res?.show_register_action !== false,
    showWalletpayCard: res?.show_walletpay_card !== false,
  };
}
