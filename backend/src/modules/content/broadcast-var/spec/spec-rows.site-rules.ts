/**
 * [FEAT-20260822-BCASTSPECCLONE] Part of the cloned flex variable spec.
 *
 * Split across several files ONLY to stay under the 400-line rule — the
 * original keeps it in one file because that file carries a by-name waiver, and
 * `dev-local §6.1` says the waiver list may shrink, never grow. The content is
 * still a verbatim copy; see `broadcast-var-spec.ts` for why this clone exists
 * and what holds it to the original. แยกไฟล์เพราะกฏบรรทัด ไม่ใช่เพราะเนื้อหาต่างกัน.
 */

import { EACH, ONE, type SpecRow } from './spec-rows.types';

const PRODUCT_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['home_living', 'บ้านและที่อยู่อาศัย'],
  ['online_activity', 'กิจกรรมออนไลน์'],
  ['electronics', 'อิเล็กทรอนิกส์'],
  ['gift_card', 'บัตรของขวัญ'],
  ['collectibles', 'ของสะสม'],
  ['fashion', 'แฟชั่น'],
  ['outdoor_activity', 'กิจกรรมกลางแจ้ง'],
];
// ⚠️ the activity volume block spells it `electronics`, not `electronics` — do not merge with PRODUCT_KEYS.
const ACTIVITY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['home_living', 'บ้านและที่อยู่อาศัย'],
  ['online_activity', 'กิจกรรมออนไลน์'],
  ['electronics', 'อิเล็กทรอนิกส์'],
  ['gift_card', 'บัตรของขวัญ'],
  ['collectibles', 'ของสะสม'],
  ['fashion', 'แฟชั่น'],
  ['outdoor_activity', 'กิจกรรมกลางแจ้ง'],
];
const PRODUCT_SLOTS: ReadonlyArray<readonly [string, string]> = [
  ['0', 'สินค้าที่ 1'],
  ['1', 'สินค้าที่ 2'],
  ['2', 'สินค้าที่ 3'],
  ['3', 'สินค้าที่ 4'],
  ['4', 'สินค้าที่ 5'],
  ['5', 'สินค้าที่ 6'],
];
/**
 * [FEAT-20260814-PROMOSLOT10] 5 → 10 slots, matching what the live API actually
 * sends: `promotions.page.size` is 10 on every one of the 52 production webs
 * measured 2026-08-13, and 10 of them carry 6–10 promotions that the old five
 * slots could never show. LINE's carousel cap is 12 bubbles, so a 10-bubble
 * template stays legal.
 *
 * Downstream is DERIVED, not duplicated — the var-map, the FE guideline table
 * and the promo bubble-drop set all walk this spec, so they follow this list
 * automatically. A card that still has 5 bubbles simply never references the
 * new tags; nothing about existing cards changes.
 */
const PROMO_SLOTS: ReadonlyArray<readonly [string, string]> = [
  ['0', 'โปรที่ 1'],
  ['1', 'โปรที่ 2'],
  ['2', 'โปรที่ 3'],
  ['3', 'โปรที่ 4'],
  ['4', 'โปรที่ 5'],
  ['5', 'โปรที่ 6'],
  ['6', 'โปรที่ 7'],
  ['7', 'โปรที่ 8'],
  ['8', 'โปรที่ 9'],
  ['9', 'โปรที่ 10'],
];
const PROMO_FIELDS: ReadonlyArray<readonly [string, string, string]> = [
  ['name', 'name', 'ชื่อโปร'],
  ['desc', 'desc', 'รายละเอียดโปร'],
  ['id', 'id', 'รหัสโปร'],
  ['img', 'img_path', 'รูปโปร'],
  ['status', 'status', 'สถานะโปร'],
  ['mode', 'promotion_mode', 'โหมดโปร'],
  ['type', 'promotion_type', 'ประเภทโปร'],
  ['type_clear', 'promotion_type_clear', 'วิธีทำยอดกิจกรรมครบ'],
  ['clear', 'promotion_clear', 'ค่าทำยอดกิจกรรมครบ'],
  ['deposit_amount', 'deposit_amount', 'ยอดฝากที่ต้องใช้'],
  ['max_per_user', 'max_per_user', 'รับได้กี่ครั้งต่อคน'],
  ['max_user', 'max_user', 'จำกัดจำนวนคน'],
  ['start_date', 'start_date', 'วันเริ่มโปร'],
  ['end_date', 'end_date', 'วันสิ้นสุดโปร'],
  ['created_at', 'created_at', 'วันที่สร้างโปร'],
  ['updated_at', 'updated_at', 'วันที่แก้โปรล่าสุด'],
  ['asset_code', 'asset_code', 'สกุลที่โปรจ่าย'],
  ['coupon_code', 'coupon_code', 'โค้ดคูปอง'],
  ['mtk_code', 'mtk_code', 'รหัสการตลาด'],
  ['tier_accepts', 'tier_accepts', 'ระดับสมาชิกที่ร่วมได้'],
  ['is_cal_cashback', 'is_cal_cashback', 'คิดแคชแบ็กด้วยหรือไม่'],
  ['is_view', 'is_view', 'แสดงหน้าเว็บหรือไม่'],
  ['use_true_money', 'use_true_money', 'ใช้ทรูวอลเล็ตได้หรือไม่'],
  ['withdraw_all_open', 'withdraw_all_open', 'ถอนได้ทั้งหมดหรือไม่'],
  ['withdraw_mode', 'withdraw_mode', 'โหมดถอนของโปร'],
  ['amount_bonus', 'promotion_info.amount_bonus', 'โบนัสที่ได้'],
  ['balance_amount', 'promotion_info.balance_amount', 'ยอดคงเหลือที่กำหนด'],
  ['deposit_per_day', 'promotion_info.deposit_per_day', 'ฝากได้กี่ครั้งต่อวัน'],
  ['max_bonus', 'promotion_info.max_bonus', 'โบนัสสูงสุด'],
  ['percent_bonus', 'promotion_info.percent_bonus', 'เปอร์เซ็นต์โบนัส'],
  ['withdraw_max', 'promotion_config_info.withdraw_max_amount', 'ถอนสูงสุด'],
  ['withdraw_min', 'promotion_config_info.withdraw_min_amount', 'ถอนต่ำสุด'],
  [
    'withdraw_min_balance',
    'promotion_config_info.withdraw_min_balance',
    'ยอดคงเหลือขั้นต่ำตอนถอน',
  ],
  [
    'act_home_living',
    'promotion_config_info.act_home_living',
    'ยอดกิจกรรมหมวดบ้านและที่อยู่อาศัย',
  ],
  [
    'act_online_activity',
    'promotion_config_info.act_online_activity',
    'ยอดกิจกรรมออนไลน์',
  ],
  [
    'act_electronics',
    'promotion_config_info.act_electronics',
    'ยอดกิจกรรมหมวดอิเล็กทรอนิกส์',
  ],
  [
    'act_gift_card',
    'promotion_config_info.act_gift_card',
    'ยอดกิจกรรมหมวดบัตรของขวัญ',
  ],
  [
    'act_collectibles',
    'promotion_config_info.act_collectibles',
    'ยอดกิจกรรมหมวดของสะสม',
  ],
  ['act_fashion', 'promotion_config_info.act_fashion', 'ยอดกิจกรรมหมวดแฟชั่น'],
  [
    'act_outdoor_activity',
    'promotion_config_info.act_outdoor_activity',
    'ยอดกิจกรรมกลางแจ้ง',
  ],
  [
    'act_home_living_open',
    'activity_volume_open_info.act_home_living_open',
    'เปิดยอดกิจกรรมหมวดบ้านและที่อยู่อาศัยหรือไม่',
  ],
  [
    'act_online_activity_open',
    'activity_volume_open_info.act_online_activity_open',
    'เปิดยอดกิจกรรมออนไลน์หรือไม่',
  ],
  [
    'act_electronics_open',
    'activity_volume_open_info.act_electronics_open',
    'เปิดยอดกิจกรรมหมวดอิเล็กทรอนิกส์หรือไม่',
  ],
  [
    'act_gift_card_open',
    'activity_volume_open_info.act_gift_card_open',
    'เปิดยอดกิจกรรมหมวดบัตรของขวัญหรือไม่',
  ],
  [
    'act_collectibles_open',
    'activity_volume_open_info.act_collectibles_open',
    'เปิดยอดกิจกรรมหมวดของสะสมหรือไม่',
  ],
  [
    'act_fashion_open',
    'activity_volume_open_info.act_fashion_open',
    'เปิดยอดกิจกรรมหมวดแฟชั่นหรือไม่',
  ],
  [
    'act_outdoor_activity_open',
    'activity_volume_open_info.act_outdoor_activity_open',
    'เปิดยอดกิจกรรมกลางแจ้งหรือไม่',
  ],
];

export const SITE_RULES_VAR_SPEC: readonly SpecRow[] = [
  ONE(
    'dep_min',
    'wallet.wallet_setting.deposit_amount_min',
    'ฝากขั้นต่ำ (บาท)',
  ),
  ONE('dep_open', 'wallet.wallet_setting.is_open_deposit', 'เปิดให้ฝากหรือไม่'),
  ONE(
    'dep_approve_amount',
    'wallet.wallet_setting.deposit_amount_approve',
    'ฝากเกินยอดนี้ต้องรออนุมัติ (0 = ไม่ต้อง)',
  ),
  ONE('dep_mode', 'wallet.wallet_setting.deposit_amount_mode', 'โหมดการฝาก'),
  ONE(
    'dep_min_delay',
    'wallet.wallet_setting.deposit_min_delay',
    'เว้นระยะระหว่างฝาก (นาที)',
  ),
  ONE(
    'dep_activity_volume',
    'wallet.wallet_setting.deposit_activity_volume',
    'ยอดกิจกรรมที่ผูกกับการฝาก',
  ),
  ONE(
    'coin_rate',
    'wallet.wallet_setting.deposit_coin_rate',
    'ฝากกี่บาทได้ 1 เหรียญ',
  ),
  ONE('qr_open', 'wallet.wallet_setting.is_qr_open', 'เปิดฝากด้วย QR หรือไม่'),
  ONE(
    'truemoney_register_open',
    'wallet.wallet_setting.is_open_register_truemoney',
    'สมัครทรูมันนี่ได้หรือไม่',
  ),
  ONE(
    'credit_add_open',
    'wallet.wallet_setting.is_open_credit_add',
    'เปิดเติมเครดิตหรือไม่',
  ),

  ONE(
    'wd_min',
    'wallet.wallet_setting.withdraw_amount_min',
    'ถอนขั้นต่ำ (บาท)',
  ),
  ONE(
    'wd_max_per_bill',
    'wallet.wallet_setting.withdraw_max_per_bill',
    'ถอนสูงสุดต่อครั้ง (บาท)',
  ),
  ONE(
    'wd_approve_amount',
    'wallet.wallet_setting.withdraw_amount_approve',
    'ถอนเกินยอดนี้ต้องรอแอดมินอนุมัติ (บาท)',
  ),
  ONE(
    'wd_limit_per_day',
    'wallet.wallet_setting.withdraw_limit_per_day',
    'ถอนได้กี่ครั้งต่อวัน',
  ),
  ONE('wd_open', 'wallet.wallet_setting.is_withdraw_open', 'เปิดให้ถอนหรือไม่'),
  ONE(
    'wd_all',
    'wallet.wallet_setting.is_withdraw_all',
    'ถอนได้ทั้งหมดหรือไม่',
  ),
  ONE(
    'wd_bank_verify',
    'wallet.wallet_setting.is_withdraw_bank_verify',
    'ถอนต้องยืนยันบัญชีธนาคารหรือไม่',
  ),
  ONE(
    'wd_new_user',
    'wallet.wallet_setting.is_withdraw_new_user',
    'สมาชิกใหม่ถอนได้หรือไม่',
  ),
  ONE(
    'wd_truemoney_mode',
    'wallet.wallet_setting.withdraw_truemoney_mode',
    'โหมดถอนเข้าทรูมันนี่',
  ),
  ONE(
    'clear_act',
    'wallet.wallet_setting.clear_act',
    'ค่าทำยอดกิจกรรมครบตอนออกจากโปร',
  ),

  ONE(
    'cashback_open',
    'cashback.cashback.is_cashback_open',
    'เปิดเงินคืนหรือไม่',
  ),
  ONE(
    'cashback_type',
    'cashback.cashback.cashback_type',
    'คิดเงินคืนจากอะไร (net result = ผลสุทธิ)',
  ),
  ONE('cashback_interval', 'cashback.cashback.interval', 'รอบการเงินคืน (วัน)'),
  ONE(
    'cashback_percent',
    'cashback.cashback.percent',
    'เปอร์เซ็นต์เงินคืน (รวม)',
  ),
  EACH(
    PRODUCT_KEYS,
    'cashback_percent_{k}',
    'cashback.cashback.percent_{k}',
    'เปอร์เซ็นต์เงินคืน — {label}',
  ),
  EACH(
    ACTIVITY_KEYS,
    'cashback_act_{k}',
    'cashback.cashback.act_{k}',
    'ยอดกิจกรรมของเงินคืน — {label} (99999 = ปิดไม่ให้ผ่าน)',
  ),

  ONE(
    'referral_open',
    'referral.referral.is_referral_open',
    'เปิดระบบแนะนำเพื่อนหรือไม่',
  ),
  ONE(
    'referral_percent',
    'referral.referral.percent',
    'เปอร์เซ็นต์ค่าแนะนำเพื่อน (รวม)',
  ),
  EACH(
    PRODUCT_KEYS,
    'referral_percent_{k}',
    'referral.referral.percent_{k}',
    'เปอร์เซ็นต์ค่าแนะนำเพื่อน — {label}',
  ),
  EACH(
    ACTIVITY_KEYS,
    'referral_act_{k}',
    'referral.referral.act_{k}',
    'ยอดกิจกรรมของค่าแนะนำเพื่อน — {label} (99999 = ปิดไม่ให้ผ่าน)',
  ),

  ONE(
    'products_coin_rate',
    'products.deposit_coin_rate',
    'เรตแลกเหรียญของกิจกรรม (ฝากกี่บาท : 1 เหรียญ)',
  ),

  ONE(
    'cashback_created_at',
    'cashback.cashback.created_at',
    'สร้างกติกาเงินคืนเมื่อ',
  ),
  ONE(
    'cashback_start_at',
    'cashback.cashback.start_at',
    'เริ่มคิดเงินคืนเมื่อ',
  ),
  ONE(
    'cashback_updated_at',
    'cashback.cashback.updated_at',
    'แก้ไขกติกาเงินคืนล่าสุด',
  ),
  ONE(
    'referral_created_at',
    'referral.referral.created_at',
    'สร้างกติกาแนะนำเพื่อนเมื่อ',
  ),
  ONE(
    'referral_updated_at',
    'referral.referral.updated_at',
    'แก้ไขกติกาแนะนำเพื่อนล่าสุด',
  ),
  ONE(
    'wallet_created_at',
    'wallet.wallet_setting.created_at',
    'สร้างตั้งค่ากระเป๋าเงินเมื่อ',
  ),
  ONE(
    'wallet_updated_at',
    'wallet.wallet_setting.updated_at',
    'แก้ไขตั้งค่ากระเป๋าเงินล่าสุด',
  ),

  ONE(
    'cashback_previous_process',
    'cashback.cashback.is_previous_process',
    'ใช้รอบก่อนหน้าในการคิดเงินคืนหรือไม่',
  ),
  ONE(
    'wd_transfer_group_open',
    'wallet.wallet_setting.withdraw_transfer_group_open',
    'เปิดโอนแบบกลุ่มหรือไม่',
  ),

  ONE(
    'wd_transfer_group_amount',
    'wallet.wallet_setting.withdraw_transfer_group_amount',
    'ยอดที่ใช้โอนแบบกลุ่ม (บาท)',
  ),
  ONE(
    'show_bank_deposit_mode',
    'wallet.wallet_setting.show_bank_member_deposit_mode',
    'โหมดแสดงบัญชีฝากให้สมาชิก',
  ),
  ONE(
    'deposit_sort',
    'wallet.wallet_setting.deposit_sort',
    'ลำดับช่องทางฝากที่โชว์',
  ),
  ONE(
    'cashback_activity_volume',
    'cashback.cashback.activity_volume',
    'ยอดกิจกรรมรวมของเงินคืน (99999 = ปิดไม่ให้ผ่าน)',
  ),
  ONE(
    'referral_activity_volume',
    'referral.referral.activity_volume',
    'ยอดกิจกรรมรวมของค่าแนะนำเพื่อน (99999 = ปิดไม่ให้ผ่าน)',
  ),

  EACH(
    PRODUCT_SLOTS,
    'product_{k}_name',
    'products.products[{k}].name',
    'ชื่อกิจกรรม — {label}',
  ),
  EACH(
    PRODUCT_SLOTS,
    'product_{k}_id',
    'products.products[{k}].id',
    'รหัสกิจกรรม — {label}',
  ),
  EACH(
    PRODUCT_SLOTS,
    'product_{k}_active',
    'products.products[{k}].is_active',
    'เปิดใช้งานกิจกรรมหรือไม่ — {label}',
  ),
  EACH(
    PRODUCT_SLOTS,
    'product_{k}_spend_asset',
    'products.products[{k}].default_config.spend_asset',
    'ใช้สกุลอะไรชำระ — {label}',
  ),
  EACH(
    PRODUCT_SLOTS,
    'product_{k}_spend_amount',
    'products.products[{k}].default_config.spend_amount',
    'แต้มที่ใช้ต่อครั้ง — {label}',
  ),
  EACH(
    PRODUCT_SLOTS,
    'product_{k}_limit_per_day',
    'products.products[{k}].default_config.limit_per_day',
    'ใช้ได้กี่ครั้งต่อวัน — {label}',
  ),
  EACH(
    PRODUCT_SLOTS,
    'product_{k}_layout_slot',
    'products.products[{k}].default_config.layout_slot',
    'จำนวนช่องของสมนาคุณ — {label}',
  ),

  ONE('promo_category', 'promotions.category', 'หมวดโปรที่กรองอยู่'),
  ONE('promo_total', 'promotions.page.total', 'จำนวนโปรทั้งหมด'),
  ONE('promo_page_size', 'promotions.page.size', 'จำนวนโปรต่อหน้า'),
  ONE('promo_page_from', 'promotions.page.from', 'เริ่มจากรายการที่'),
  ...PROMO_FIELDS.map(([suffix, path, desc]) =>
    EACH(
      PROMO_SLOTS,
      `promo_{k}_${suffix}`,
      `promotions.promotions[{k}].${path}`,
      `${desc} — {label}`,
    ),
  ),
];

/** Find the `shop` block in whatever shape the response arrived. */
