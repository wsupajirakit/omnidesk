/**
 * [FEAT-20260822-BCASTSPECCLONE] Part of the cloned flex variable spec.
 *
 * Split across several files ONLY to stay under the 400-line rule — the
 * original keeps it in one file because that file carries a by-name waiver, and
 * `dev-local §6.1` says the waiver list may shrink, never grow. The content is
 * still a verbatim copy; see `broadcast-var-spec.ts` for why this clone exists
 * and what holds it to the original. แยกไฟล์เพราะกฏบรรทัด ไม่ใช่เพราะเนื้อหาต่างกัน.
 */

import {
  BALANCE_KEYS,
  COIN_FIELDS,
  EACH,
  PRODUCT_FIELDS,
  INDEXED,
  LIST,
  MONEY_FIELDS,
  ONE,
  PROMO_ACTIVITY_KEYS,
  REFERRAL_FIELDS,
  ACTIVITY_VOLUME_KEYS,
  TX_FIELDS,
  POINT_ROUND_FIELDS,
  type SpecRow,
} from './spec-rows.types';

export const FLEX_VAR_SPEC: readonly SpecRow[] = [
  ONE('web_code', 'web_code', 'รหัสเว็บของลูกค้า'),
  ONE('line_user_id', 'line_user_id', 'LINE user id'),
  ONE('status', 'status', 'สถานะบัญชี'),
  ONE('line_of_work', 'line_of_work', 'อาชีพ'),
  ONE('phone', 'phone', 'เบอร์โทรที่ผูกกับบัญชี'),
  ONE('registered_at', 'registered_at', 'วันที่สมัคร'),
  ONE('truewallet', 'truewallet', 'เบอร์ทรูวอลเล็ต'),

  ONE('tier_code', 'tier.code', 'รหัสระดับสมาชิก'),
  ONE('tier_name', 'tier.name', 'ชื่อระดับสมาชิก'),
  ONE('tier_level', 'tier.level', 'เลเวลของระดับสมาชิก'),

  ONE(
    'bank_code',
    'bank.code',
    'ชื่อธนาคาร (แปลงจากโค้ดเป็นชื่อสวยให้แล้ว เช่น bbl → Bangkok Bank)',
  ),
  ONE('bank_account_no', 'bank.account_no', 'เลขบัญชี (ปิดบางส่วน)'),
  ONE('bank_account_name', 'bank.account_name', 'ชื่อบัญชีธนาคาร (ชื่อลูกค้า)'),
  ONE('bank_name', 'finance.bank.name', 'ชื่อธนาคารแบบเต็ม'),

  ONE(
    'has_active_promotion',
    'promotion.has_active_promotion',
    'กำลังติดโปรอยู่หรือไม่',
  ),
  ONE('promo_id', 'promotion.current_promotion_info.id', 'รหัสโปรโมชัน'),
  ONE('promo_name', 'promotion.current_promotion_info.name', 'ชื่อโปรโมชัน'),
  ONE(
    'promo_desc',
    'promotion.current_promotion_info.desc',
    'คำอธิบายโปรโมชัน',
  ),
  ONE(
    'promo_img',
    'promotion.current_promotion_info.img_path',
    'รูปแบนเนอร์โปรโมชัน (ใส่ใน image ได้)',
  ),
  ONE(
    'promo_status',
    'promotion.current_promotion_info.status',
    'สถานะโปรโมชัน',
  ),
  ONE(
    'promo_mode',
    'promotion.current_promotion_info.promotion_mode',
    'โหมดโปรโมชัน',
  ),
  ONE(
    'promo_type',
    'promotion.current_promotion_info.promotion_type',
    'ประเภทโปรโมชัน',
  ),
  ONE(
    'promo_type_clear',
    'promotion.current_promotion_info.promotion_type_clear',
    'ประเภทการทำยอดกิจกรรมครบ',
  ),
  ONE(
    'promo_clear',
    'promotion.current_promotion_info.promotion_clear',
    'ค่าทำยอดกิจกรรมครบ',
  ),
  ONE(
    'promo_deposit_amount',
    'promotion.current_promotion_info.deposit_amount',
    'ยอดฝากที่โปรกำหนด',
  ),
  ONE(
    'promo_max_per_user',
    'promotion.current_promotion_info.max_per_user',
    'จำกัดต่อคน',
  ),
  ONE(
    'promo_max_user',
    'promotion.current_promotion_info.max_user',
    'จำกัดจำนวนคนทั้งหมด',
  ),
  ONE(
    'promo_start_date',
    'promotion.current_promotion_info.start_date',
    'เวลาเริ่มโปร',
  ),
  ONE(
    'promo_end_date',
    'promotion.current_promotion_info.end_date',
    'เวลาสิ้นสุดโปร',
  ),
  ONE(
    'promo_created_at',
    'promotion.current_promotion_info.created_at',
    'เวลาที่สร้างโปร',
  ),
  ONE(
    'promo_updated_at',
    'promotion.current_promotion_info.updated_at',
    'เวลาที่แก้ไขโปรล่าสุด',
  ),
  ONE(
    'promo_agent_id',
    'promotion.current_promotion_info.agent_id',
    'รหัส agent ของโปร',
  ),
  ONE(
    'promo_asset_code',
    'promotion.current_promotion_info.asset_code',
    'สกุลที่โปรจ่าย',
  ),
  ONE(
    'promo_mtk_code',
    'promotion.current_promotion_info.mtk_code',
    'รหัสการตลาด',
  ),
  ONE(
    'promo_tier_accepts',
    'promotion.current_promotion_info.tier_accepts',
    'ระดับสมาชิกที่ร่วมโปรได้',
  ),
  ONE(
    'promo_is_cal_cashback',
    'promotion.current_promotion_info.is_cal_cashback',
    'คิดแคชแบ็กหรือไม่',
  ),
  ONE(
    'promo_is_view',
    'promotion.current_promotion_info.is_view',
    'แสดงโปรนี้หรือไม่',
  ),
  ONE(
    'promo_use_true_money',
    'promotion.current_promotion_info.use_true_money',
    'ใช้ทรูมันนี่ได้หรือไม่',
  ),
  ONE(
    'promo_withdraw_all_open',
    'promotion.current_promotion_info.withdraw_all_open',
    'ถอนได้ทั้งหมดหรือไม่',
  ),
  ONE(
    'promo_withdraw_mode',
    'promotion.current_promotion_info.withdraw_mode',
    'โหมดการถอน',
  ),
  ONE(
    'promo_deleted_at',
    'promotion.current_promotion_info.deleted_at',
    'เวลาที่โปรถูกลบ (ยังอยู่ = ว่าง)',
  ),

  ONE(
    'promo_amount_bonus',
    'promotion.current_promotion_info.promotion_info.amount_bonus',
    'โบนัสแบบจำนวนเงิน',
  ),
  ONE(
    'promo_balance_amount',
    'promotion.current_promotion_info.promotion_info.balance_amount',
    'ยอดคงเหลือของโปร',
  ),
  ONE(
    'promo_deposit_per_day',
    'promotion.current_promotion_info.promotion_info.deposit_per_day',
    'ฝากต่อวันที่โปรกำหนด',
  ),
  ONE(
    'promo_max_bonus',
    'promotion.current_promotion_info.promotion_info.max_bonus',
    'โบนัสสูงสุด',
  ),
  ONE(
    'promo_percent_bonus',
    'promotion.current_promotion_info.promotion_info.percent_bonus',
    'โบนัสแบบเปอร์เซ็นต์',
  ),

  ONE(
    'promo_withdraw_max',
    'promotion.current_promotion_info.promotion_config_info.withdraw_max_amount',
    'ถอนได้สูงสุด',
  ),
  ONE(
    'promo_withdraw_min',
    'promotion.current_promotion_info.promotion_config_info.withdraw_min_amount',
    'ถอนขั้นต่ำ',
  ),
  ONE(
    'promo_withdraw_min_balance',
    'promotion.current_promotion_info.promotion_config_info.withdraw_min_balance',
    'ยอดคงเหลือขั้นต่ำที่ถอนได้',
  ),

  EACH(
    PROMO_ACTIVITY_KEYS,
    'promo_act_{k}',
    'promotion.current_promotion_info.promotion_config_info.act_{k}',
    'ยอดกิจกรรมที่โปรกำหนด — {label}',
  ),
  EACH(
    PROMO_ACTIVITY_KEYS,
    'promo_act_{k}_open',
    'promotion.current_promotion_info.activity_volume_open_info.act_{k}_open',
    'เปิดให้ทำยอดกิจกรรมหรือไม่ — {label}',
  ),

  EACH(
    ACTIVITY_VOLUME_KEYS,
    'outstanding_{k}',
    'promotion.outstanding.{k}',
    'ยอดกิจกรรมค้าง — {label}',
  ),
  EACH(
    ACTIVITY_VOLUME_KEYS,
    'act_done_{k}',
    'promotion.activity_volume_done.{k}',
    'ยอดกิจกรรมที่ทำไปแล้ว — {label}',
  ),
  EACH(
    ACTIVITY_VOLUME_KEYS,
    'act_required_{k}',
    'promotion.activity_volume_required.{k}',
    'ยอดกิจกรรมที่ต้องทำ — {label}',
  ),

  INDEXED(
    'balance',
    'finance.balances',
    'asset_code',
    BALANCE_KEYS,
    [
      ['', 'amount', 'ยอดคงเหลือ'],
      ['_desc', 'asset_description', 'คำอธิบายกระเป๋า'],
      ['_updated_at', 'updated_at', 'อัปเดตล่าสุด'],
    ],
    'ยอดเงิน',
  ),

  ONE('total_deposit', 'finance.total_deposit', 'ยอดฝากสะสมทั้งหมด'),
  ONE('total_withdraw', 'finance.total_withdraw', 'ยอดถอนสะสมทั้งหมด'),
  ONE('is_auto_deposit', 'finance.is_auto_deposit', 'เปิดฝากออโต้หรือไม่'),
  ONE('is_auto_withdraw', 'finance.is_auto_withdraw', 'เปิดถอนออโต้หรือไม่'),

  ONE('truewallet_name', 'finance.true_wallet.name', 'ชื่อบัญชีทรูวอลเล็ต'),
  ONE('truewallet_number', 'finance.true_wallet.number', 'เบอร์ทรูวอลเล็ต'),
  ONE('truewallet_type', 'finance.true_wallet.type', 'ประเภททรูวอลเล็ต'),
  ONE(
    'truewallet_username',
    'finance.true_wallet.username',
    'ชื่อผู้ใช้ทรูวอลเล็ต',
  ),

  LIST('deposit', 'finance.transactions.deposit', TX_FIELDS, 'รายการฝาก'),
  LIST('withdraw', 'finance.transactions.withdraw', TX_FIELDS, 'รายการถอน'),

  ONE('pending_cashback', 'bonus.pending_cashback', 'แคชแบ็กที่รอรับ'),
  ONE(
    'pending_referral_bonus',
    'bonus.pending_referral_bonus',
    'โบนัสแนะนำเพื่อนที่รอรับ',
  ),
  ONE('friend_count', 'bonus.friend_count', 'จำนวนเพื่อนที่แนะนำมา'),
  LIST('cashback', 'bonus.cashback_history', MONEY_FIELDS, 'ประวัติแคชแบ็ก'),
  LIST(
    'referral',
    'bonus.referral_history',
    REFERRAL_FIELDS,
    'ประวัติแนะนำเพื่อน',
  ),

  LIST('coin_recv', 'activity.coin_received', COIN_FIELDS, 'เหรียญที่ได้รับ'),
  LIST('coin_spent', 'activity.coin_spent', COIN_FIELDS, 'เหรียญที่ใช้ไป'),
  LIST(
    'point_round',
    'activity.point_round_history',
    POINT_ROUND_FIELDS,
    'ประวัติรอบสะสมแต้ม',
  ),
  ONE(
    'point_round_tickets',
    'activity.point_round_tickets',
    'ตั๋วรอบสะสมแต้มคงเหลือ',
  ),

  LIST(
    'recent_product',
    'promotion.recent_products',
    PRODUCT_FIELDS,
    'สินค้าที่ซื้อล่าสุด',
  ),
];

/**
 * Walk the profile spec once, calling `visit(tag, path, desc)` per variable.
 *
 * Lifted verbatim from legacy `walkFlexVarSpec` — including the `console.error`
 * on an unknown kind, which is how a newly added row without a reader is meant
 * to surface instead of vanishing.
 */
