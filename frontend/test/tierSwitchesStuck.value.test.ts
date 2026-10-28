/**
 * [FIX-20260905-TIERFILTERSTUCK] Hiding the tier filter must also LET GO of it.
 *
 * ## The defect, stated once
 * PART 4's first cut hid the tier-filter control and left `filterTier` alone,
 * on the reasoning that a hidden control never gets set. True for a page loaded
 * with the switch already off; false for a page already open with a tier chosen
 * when the switch flips — and the dashboard is a long-lived SPA, so that is the
 * ordinary case. The operator keeps a shortened list (the value still drives two
 * row predicates, the tab counts and the server's `tier:` parameter) with no
 * control left to clear it.
 *
 * Everything below is a real assertion on the rule, plus source anchors proving
 * the page actually routes through it. The anchors matter: a correct rule that
 * nothing calls fixes nothing, which is the failure mode this whole session has
 * been avoiding. กติกาถูกแต่ไม่มีใครเรียก = ไม่ได้แก้อะไร
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tierSwitchesFrom } from '../utils/tierSwitches';

const SRC = readFileSync(
  join(process.cwd(), 'pages/chat/TicketChat.tsx'),
  'utf8',
);

describe('[TIERSWITCH] absent means ON — a back end that predates the keys looks like today', () => {
  it('⭐ an empty response leaves both switches ON and clears nothing', () => {
    expect(tierSwitchesFrom({})).toEqual({
      showBadge: true,
      showFilter: true,
      clearSelection: false,
      /* [FEAT-20260907-PROVCONDS] the three added switches, same
         absent-means-ON rule as the tier pair */
      showFollowUps: true,
      showRegisterAction: true,
      showWalletpayCard: true,
    });
  });

  it('[PROVCONDS] register/walletpay: only literal false hides them', () => {
    expect(
      tierSwitchesFrom({ show_register_action: false }).showRegisterAction,
    ).toBe(false);
    expect(tierSwitchesFrom({ show_walletpay_card: false }).showWalletpayCard).toBe(
      false,
    );
    expect(tierSwitchesFrom({ show_register_action: null }).showRegisterAction).toBe(true);
    expect(tierSwitchesFrom(null).showWalletpayCard).toBe(true);
  });

  it('[PROVCONDS] follow-up world: only literal false hides it', () => {
    expect(tierSwitchesFrom({ show_follow_ups: false }).showFollowUps).toBe(false);
    expect(tierSwitchesFrom({ show_follow_ups: 0 }).showFollowUps).toBe(true);
    expect(tierSwitchesFrom({ show_follow_ups: null }).showFollowUps).toBe(true);
    expect(tierSwitchesFrom(null).showFollowUps).toBe(true);
  });

  it('null / undefined behave the same as an empty response', () => {
    expect(tierSwitchesFrom(null).showFilter).toBe(true);
    expect(tierSwitchesFrom(undefined).showBadge).toBe(true);
  });

  it('⭐ only the literal `false` switches anything off — not 0, not ""', () => {
    /* `!== false`, not a truthiness test. A falsy-but-not-false value arriving
       from a mis-serialised envelope must not blank an operator's screen: the
       switch is a deliberate OFF, never an accident of encoding. */
    expect(tierSwitchesFrom({ show_tier_filter: 0 }).showFilter).toBe(true);
    expect(tierSwitchesFrom({ show_tier_filter: '' }).showFilter).toBe(true);
    expect(tierSwitchesFrom({ show_tier_filter: null }).showFilter).toBe(true);
    expect(tierSwitchesFrom({ show_tier_filter: false }).showFilter).toBe(false);
  });
});

describe('[TIERSWITCH] 🔴 the filter going off must clear the selection', () => {
  it('⭐ filter OFF ⇒ clearSelection is true', () => {
    expect(tierSwitchesFrom({ show_tier_filter: false }).clearSelection).toBe(
      true,
    );
  });

  it('⭐ filter ON ⇒ clearSelection is false — it must not wipe a live choice', () => {
    // The other half of the rule, and the one a naive fix breaks: clearing on
    // every response would reset the operator's filter on each poll.
    expect(tierSwitchesFrom({ show_tier_filter: true }).clearSelection).toBe(
      false,
    );
    expect(tierSwitchesFrom({}).clearSelection).toBe(false);
  });

  it('the BADGE switch alone never clears a filter selection', () => {
    // Two independent switches. Hiding the badge is a display change with no
    // bearing on which rows are on screen.
    expect(
      tierSwitchesFrom({ show_tier_badge: false }).clearSelection,
    ).toBe(false);
    expect(tierSwitchesFrom({ show_tier_badge: false }).showFilter).toBe(true);
  });
});

describe('[TIERSWITCH] the page really routes through this rule', () => {
  it('⭐ all three fetch paths call the helper — none reads the keys directly', () => {
    /* The three are: the fresh active list, each page of a deep refresh, and
       the completed list. A fourth appearing later without the helper is
       exactly the drift this counts. */
    const calls = SRC.split('applyTierSwitches(res)').length - 1;
    expect(`applyTierSwitches call sites: ${calls}`).toBe(
      'applyTierSwitches call sites: 3',
    );
    expect(SRC).not.toContain('setShowTierFilter(res.show_tier_filter');
    expect(SRC).not.toContain('setShowTierBadge(res.show_tier_badge');
  });

  it('⭐ the helper clears the selection, and does it CONDITIONALLY', () => {
    expect(SRC).toContain('if (sw.clearSelection) setFilterTier(');
    // Unconditional clearing would reset an operator's filter on every poll.
    expect(SRC).not.toContain("setFilterTier('');\n    setShowTierFilter");
  });

  it('⭐ the stale "UI stub only" comment is gone', () => {
    /* It claimed selecting a tier does not filter the list. `filterTier` now
       drives two predicates, the counts and the server query, so anyone
       trusting that wording would conclude hiding the control was free. A
       comment that is confidently wrong is worse than no comment. */
    expect(SRC).not.toContain('tier filter — UI stub only');
    expect(SRC).not.toContain('ยังไม่กรองอะไร** เพราะ ticket');
  });

  it('the filter value still reaches the predicates and the query — unchanged', () => {
    // Pins that this fix did NOT quietly disconnect the filter it was
    // protecting. The value must still do its job when the control is shown.
    expect(SRC).toContain('tier: filterTier || undefined');
    expect(SRC).toContain('if (filterTier && tierKeyOf(');
  });
});
