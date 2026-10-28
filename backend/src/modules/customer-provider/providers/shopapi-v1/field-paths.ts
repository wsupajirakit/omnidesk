/**
 * [FEAT-20260905-CUSTPROV] `shopapi_v1` — WHERE its values live. Data, not code.
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` (PART 7)
 *
 * ## 🔴 THIS FILE IS THE ANSWER TO "HOW HARD IS A NEW VENDOR"
 * 17 of this provider's 26 values are a lookup and nothing more, so they are
 * written here as PATHS. A vendor whose credit sits at `wallet.main.amount`
 * instead of `finance.credit_balance` is served by editing one line of this
 * table — no function, no branch, no test of its own beyond its vectors.
 * The 9 that are genuine algorithms live next door in `derive-fields.ts`, and
 * the split is stated as a count so the claim can be checked rather than
 * believed. เจ้าใหม่ที่ต่างแค่ชื่อฟิลด์ = แก้ตารางนี้ ไม่เขียนโค้ด
 *
 * ## THE TWO SHAPES, and why the OLD name is always first
 * The demo/mock upstream and the real Shop-API disagree on ~18 names. Every chain
 * below reads the MOCK name first, so a demo or a tool that was working before
 * the real upstream existed keeps its exact previous value. This ordering is
 * load-bearing and is pinned by a test, not by this comment.
 * (`[FEAT-20260801-SHOPAPIV1FIELDS]` — credit was 50,085.46 while the screen showed
 * "-", hook `demo-oa-three`, 2026-08-01.)
 *
 * revert: this file plus `derive-fields.ts` replace what `build-fields.ts` did in
 *         one piece — `git show 20d301e:…/shopapi-v1/build-fields.ts` restores it.
 */

import type { PathDeclaration } from '../engine/resolve-fields';

/**
 * The container and the sections.
 *
 * `''` means the blob itself. The mock answers `{ data: { profile, finance … } }`
 * and the real Shop-API answers `{ data: { profile: { finance … } } }`, so each
 * section is tried beside `profile` first and then inside it — which is exactly
 * what `readShopapiSections` did before the engine existed.
 *
 * 🔴 `profile` decides the root: a candidate with no profile is not a customer,
 * and every field falls back rather than being read out of a half-shaped blob.
 */
export const SHOPAPI_V1_PATHS: PathDeclaration = {
  rootPaths: ['data', ''],

  sectionPaths: {
    profile: ['profile'],
    finance: ['finance', 'profile.finance'],
    bonus: ['bonus', 'profile.bonus'],
    activity: ['activity', 'profile.activity'],
    promotion: ['promotion', 'profile.promotion'],
  },

  /**
   * Value → where to look, mock name first. `fallback: []` on the five list
   * fields because a card handed `undefined` where it expected rows renders
   * nothing at all, instead of its "ยังไม่มีประวัติ" empty state.
   *
   * ⚠️ `balances[asset_code=…]` is the array-filter form: the real upstream keeps
   * every currency in ONE array keyed by `asset_code`, so credit, cash and coin
   * are three reads of the same list. That is the only reason the engine has a
   * filter syntax at all.
   */
  fieldPaths: {
    /* ── finance ─────────────────────────────────────────────────────────── */
    depRows: {
      paths: ['finance.recent_deposits', 'finance.transactions.deposit'],
      fallback: [],
    },
    wdRows: {
      paths: ['finance.recent_withdrawals', 'finance.transactions.withdraw'],
      fallback: [],
    },
    finCredit: {
      paths: [
        'finance.credit_balance',
        'finance.balances[asset_code=credit].amount',
      ],
    },
    finWallet: {
      paths: [
        'finance.wallet_pending',
        'finance.balances[asset_code=cash].amount',
      ],
    },
    finDepTotal: { paths: ['finance.deposit_total', 'finance.total_deposit'] },
    finWdTotal: { paths: ['finance.withdraw_total', 'finance.total_withdraw'] },

    /* ── bonus ───────────────────────────────────────────────────────────── */
    cbPending: { paths: ['bonus.cashback.pending', 'bonus.pending_cashback'] },
    cbClaimed: {
      paths: ['bonus.cashback.claimed_total', 'bonus.claimed_cashback'],
    },
    cbHistory: {
      paths: ['bonus.cashback.history', 'bonus.cashback_history'],
      fallback: [],
    },
    rfPending: {
      paths: ['bonus.referral.pending', 'bonus.pending_referral_bonus'],
    },
    rfClaimed: {
      paths: ['bonus.referral.claimed_total', 'bonus.claimed_referral_bonus'],
    },
    rfHistory: {
      paths: ['bonus.referral.history', 'bonus.referral_history'],
      fallback: [],
    },

    /* ── activity ────────────────────────────────────────────────────────── */
    acCoinBal: {
      paths: [
        'activity.coins.balance',
        'finance.balances[asset_code=coin].amount',
      ],
    },
    acPointRoundHistory: {
      paths: ['activity.point_round.history', 'activity.point_round_history'],
      fallback: [],
    },

    /* ── promotion ───────────────────────────────────────────────────────── */
    promoCurrent: {
      paths: ['promotion.current', 'promotion.current_promotion_info'],
    },
    promoToDone: {
      paths: [
        'promotion.activity_volume.done',
        'promotion.activity_volume_done.total',
      ],
    },
    promoToReq: {
      paths: [
        'promotion.activity_volume.required',
        'promotion.activity_volume_required.total',
      ],
    },
    /* [FEAT-20260905-CUSTPROV] Added 05/09 while composing `view.sections`.
       The activity volume SUMMARY row — the one drawn when the upstream sends a single
       number instead of a per-product breakdown — labels itself
       `Activity volume (<unit>)` and appends `(<percent>%)`. Both were read straight
       off `promotion` in the card's JSX, which is exactly the vendor-name
       coupling this table exists to remove: a vendor calling it `act_unit`
       would have shown `Activity volume (activity volume)` with no way to fix it but an FE
       release. Missing ⇒ `undefined` ⇒ the card falls back to the literal
       'activity_volume' and draws no percentage, which is what it does today. */
    promoToUnit: { paths: ['promotion.activity_volume.unit'] },
    promoToPercent: { paths: ['promotion.activity_volume.percent'] },
  },
};
