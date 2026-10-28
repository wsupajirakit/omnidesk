/**
 * [FEAT-20260822-BCASTFORMATCLONE] Cloned copy of the format-rule table.
 *
 * Copied from `system/dict-spec/flex-var-format-rules.ts`.
 *
 * ⚠️ ORDER IS BEHAVIOUR, NOT STYLE — the original says so and it is true here
 *    too: the boolean catch-all sits after the specific paths so
 *    `promotion.has_active_promotion` gets `yesno` rather than `bool`.
 *    Do not sort this table. ห้ามเรียงใหม่.
 *
 * revert: delete this file with the rest of `format/`.
 */

export interface FormatRule {
  /** Index-collapsed path this rule matches, e.g. `finance...deposit[].status`. */
  readonly canonical?: string;
  /** Field name to match anywhere it appears — a string, or a regex for dates. */
  readonly field?: string | RegExp;
  /** Matches every boolean value, whatever its path. */
  readonly isBoolean?: boolean;
  /** Dictionary that translates the matched value. */
  readonly dict?: string;
  /** Built-in formatter instead of a dictionary (currently only `datetime`). */
  readonly format?: string;
}

export const FORMAT_RULES: readonly FormatRule[] = [
  {
    canonical: 'finance.transactions.deposit[].status',
    dict: 'deposit_status',
  },
  {
    canonical: 'finance.transactions.withdraw[].status',
    dict: 'withdraw_status',
  },
  { canonical: 'bonus.cashback_history[].status', dict: 'cashback_status' },
  // Same value domain as cashback (pending/cancel/success) — shares its dict on
  // purpose so an admin edits the word once.
  { canonical: 'bonus.referral_history[].status', dict: 'cashback_status' },

  { canonical: 'status', dict: 'acc_status' },
  // ⚠️ must precede the isBoolean catch-all, or this becomes "เปิด/ปิด".
  { canonical: 'promotion.has_active_promotion', dict: 'yesno' },
  { field: 'reward_type', dict: 'reward_type' },
  { field: 'action', dict: 'coin_action' },
  // ⚠️ never a bare `field: "code"` — that would also catch bank.code.
  {
    canonical: 'promotion.current_promotion_info.asset_code',
    dict: 'asset_code',
  },
  {
    canonical: 'promotion.current_promotion_info.status',
    dict: 'promo_status',
  },
  {
    canonical: 'promotion.current_promotion_info.promotion_mode',
    dict: 'promo_mode',
  },
  {
    canonical: 'promotion.current_promotion_info.promotion_type',
    dict: 'promo_type',
  },
  {
    canonical: 'promotion.current_promotion_info.promotion_type_clear',
    dict: 'promo_clear_type',
  },
  {
    canonical: 'promotion.current_promotion_info.withdraw_mode',
    dict: 'promo_withdraw_mode',
  },
  // ⚠️ product_type only — product_name is the studio (PG/NOVA) and must not translate.
  {
    canonical: 'promotion.recent_products[].product_type',
    dict: 'product_type',
  },

  { canonical: 'cashback.cashback.cashback_type', dict: 'cashback_type' },
  {
    canonical: 'wallet.wallet_setting.deposit_amount_mode',
    dict: 'deposit_mode',
  },
  {
    canonical: 'wallet.wallet_setting.show_bank_member_deposit_mode',
    dict: 'show_bank_mode',
  },
  {
    canonical: 'wallet.wallet_setting.withdraw_truemoney_mode',
    dict: 'withdraw_truemoney_mode',
  },
  // Shop promotions carry the same value domain as the profile block, but rules
  // match on path — so the pairs are repeated rather than shared.
  { canonical: 'promotions.promotions[].status', dict: 'promo_status' },
  { canonical: 'promotions.promotions[].promotion_mode', dict: 'promo_mode' },
  { canonical: 'promotions.promotions[].promotion_type', dict: 'promo_type' },
  {
    canonical: 'promotions.promotions[].promotion_type_clear',
    dict: 'promo_clear_type',
  },
  {
    canonical: 'promotions.promotions[].withdraw_mode',
    dict: 'promo_withdraw_mode',
  },
  { canonical: 'promotions.promotions[].asset_code', dict: 'asset_code' },
  {
    canonical: 'products.products[].default_config.spend_asset',
    dict: 'asset_code',
  },
  { canonical: 'finance.balances[].asset_code', dict: 'asset_code' },
  // ⚠️ not cashback_type: that dict also has a "deposit" key meaning something else.
  {
    canonical: 'finance.transactions.deposit[].type',
    dict: 'transaction_type',
  },
  {
    canonical: 'finance.transactions.withdraw[].type',
    dict: 'transaction_type',
  },

  { isBoolean: true, dict: 'bool' },

  // ⚠️ must accept a bare `date`, not only `_date` — list rows use that name.
  { field: /^(date|time)$|(_at|_date)$/, format: 'datetime' },
];
