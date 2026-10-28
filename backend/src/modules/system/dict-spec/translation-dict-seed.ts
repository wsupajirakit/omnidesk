/**
 * LIFTED — pending rewrite. Source: legacy-api `src/config/translationDictSeed.js`.
 *
 * The terminal fallback layer (tier 9) of the translation cache: the dictionary
 * that ships in the code, used when a key is absent from both Redis and Mongo.
 * Generated mechanically from the legacy module so the 217 entries are identical
 * rather than re-typed — a hand copy of a table this size is a silent-defect
 * factory, and a wrong word here reaches customers as a wrong LINE card.
 *
 * Not yet split because it is data, not logic; it is one exported constant.
 */

export interface SeedEntry {
  readonly th?: string;
  readonly en?: string;
  readonly desc?: string;
}

export const TRANSLATION_SEED: Readonly<
  Record<string, Readonly<Record<string, SeedEntry>>>
> = {
  site_rules_label: {
    promotions: {
      th: 'โปรโมชัน',
    },
    page: {
      th: 'การแบ่งหน้า',
    },
    promotion_config_info: {
      th: 'เงื่อนไขยอดกิจกรรมของโปร',
    },
    promotion_info: {
      th: 'รายละเอียดโบนัส',
    },
    activity_volume_open_info: {
      th: 'เปิดยอดกิจกรรมประเภทไหนบ้าง',
    },
    tier_accepts: {
      th: 'ระดับสมาชิกที่ร่วมได้',
    },
    category: {
      th: 'หมวดโปร',
    },
    from: {
      th: 'เริ่มจากรายการที่',
    },
    size: {
      th: 'จำนวนต่อหน้า',
    },
    total: {
      th: 'จำนวนทั้งหมด',
    },
    asset_code: {
      th: 'สกุลที่จ่าย',
    },
    coupon_code: {
      th: 'โค้ดคูปอง',
    },
    deposit_amount: {
      th: 'ยอดฝากที่ต้องใช้',
    },
    desc: {
      th: 'รายละเอียด',
    },
    start_date: {
      th: 'วันเริ่ม',
    },
    end_date: {
      th: 'วันสิ้นสุด',
    },
    status: {
      th: 'สถานะ',
    },
    is_cal_cashback: {
      th: 'คิดแคชแบ็กด้วยหรือไม่',
    },
    is_view: {
      th: 'แสดงหน้าเว็บหรือไม่',
    },
    max_per_user: {
      th: 'รับได้กี่ครั้งต่อคน',
    },
    max_user: {
      th: 'จำกัดจำนวนคน',
    },
    mtk_code: {
      th: 'รหัสการตลาด',
    },
    promotion_clear: {
      th: 'ค่าทำยอดกิจกรรมครบ',
    },
    promotion_mode: {
      th: 'โหมดโปร',
    },
    promotion_type: {
      th: 'ประเภทโปร',
    },
    promotion_type_clear: {
      th: 'วิธีทำยอดกิจกรรมครบ',
    },
    withdraw_max_amount: {
      th: 'ถอนสูงสุด',
    },
    withdraw_min_amount: {
      th: 'ถอนต่ำสุด',
    },
    withdraw_min_balance: {
      th: 'ยอดคงเหลือขั้นต่ำตอนถอน',
    },
    amount_bonus: {
      th: 'โบนัสที่ได้',
    },
    balance_amount: {
      th: 'ยอดคงเหลือที่กำหนด',
    },
    deposit_per_day: {
      th: 'ฝากได้กี่ครั้งต่อวัน',
    },
    max_bonus: {
      th: 'โบนัสสูงสุด',
    },
    percent_bonus: {
      th: 'เปอร์เซ็นต์โบนัส',
    },
    use_true_money: {
      th: 'ใช้ทรูวอลเล็ตได้หรือไม่',
    },
    withdraw_all_open: {
      th: 'ถอนได้ทั้งหมดหรือไม่',
    },
    withdraw_mode: {
      th: 'โหมดถอน',
    },
    act_home_living_open: {
      th: 'เปิดยอดกิจกรรมหมวดบ้านและที่อยู่อาศัยหรือไม่',
    },
    act_online_activity_open: {
      th: 'เปิดยอดกิจกรรมออนไลน์หรือไม่',
    },
    act_electronics_open: {
      th: 'เปิดยอดกิจกรรมหมวดอิเล็กทรอนิกส์หรือไม่',
    },
    act_gift_card_open: {
      th: 'เปิดยอดกิจกรรมหมวดบัตรของขวัญหรือไม่',
    },
    act_collectibles_open: {
      th: 'เปิดยอดกิจกรรมหมวดของสะสมหรือไม่',
    },
    act_fashion_open: {
      th: 'เปิดยอดกิจกรรมหมวดแฟชั่นหรือไม่',
    },
    act_outdoor_activity_open: {
      th: 'เปิดยอดกิจกรรมกลางแจ้งหรือไม่',
    },
    agent_id: {
      th: 'รหัสเอเจนต์',
    },
    id: {
      th: 'รหัสอ้างอิง',
    },
    amount: {
      th: 'จำนวน',
    },
    spend_amount: {
      th: 'แต้มที่ใช้ต่อครั้ง',
    },
    spend_asset: {
      th: 'ใช้สกุล',
    },
    cashback: {
      th: 'เงินคืน (แคชแบ็ก)',
    },
    cashback_type: {
      th: 'คิดเงินคืนจาก',
      desc: 'คิดเงินคืนจากอะไร (net result = ผลสุทธิ)',
    },
    clear_act: {
      th: 'ทำยอดกิจกรรมครบออกจากโปร',
      desc: 'ค่าทำยอดกิจกรรมครบตอนออกจากโปร',
    },
    color_theme: {
      th: 'สีธีม',
    },
    created_at: {
      th: 'สร้างเมื่อ',
    },
    default_config: {
      th: 'ค่าตั้งต้น',
    },
    deposit_amount_approve: {
      th: 'ฝากเกินยอดนี้ต้องอนุมัติ',
      desc: 'ฝากเกินยอดนี้ต้องรออนุมัติ (0 = ไม่ต้อง)',
    },
    deposit_amount_min: {
      th: 'ฝากขั้นต่ำ',
      desc: 'ฝากขั้นต่ำ (บาท)',
    },
    deposit_amount_mode: {
      th: 'โหมดการฝาก',
    },
    deposit_coin_rate: {
      th: 'ฝากกี่บาทได้ 1 เหรียญ',
    },
    deposit_min_delay: {
      th: 'เว้นระยะระหว่างฝาก (นาที)',
    },
    deposit_sort: {
      th: 'ลำดับช่องทางฝาก',
    },
    deposit_text: {
      th: 'ข้อความหน้าฝาก',
    },
    deposit_activity_volume: {
      th: 'ยอดกิจกรรมที่ผูกกับการฝาก',
    },
    products: {
      th: 'กิจกรรม / สินค้า',
    },
    image_path: {
      th: 'รูป',
    },
    img_bg: {
      th: 'รูปพื้นหลัง',
    },
    img_bg_reward: {
      th: 'รูปพื้นหลังของสมนาคุณ',
    },
    img_button: {
      th: 'รูปปุ่ม',
    },
    img_button_auto: {
      th: 'รูปปุ่มออโต้',
    },
    img_icon_point_round: {
      th: 'ไอคอนรอบสะสมแต้ม',
    },
    img_path: {
      th: 'รูป',
    },
    img_point: {
      th: 'รูปแต้ม',
    },
    img_quota: {
      th: 'รูปโควตา',
    },
    img_point_round: {
      th: 'รูปรอบสะสมแต้ม',
    },
    index_channel: {
      th: 'ช่องที่',
    },
    interval: {
      th: 'รอบการคืน (วัน)',
      desc: 'รอบการเงินคืน (วัน)',
    },
    is_active: {
      th: 'เปิดใช้งาน',
    },
    is_cashback_open: {
      th: 'เปิดเงินคืน',
      desc: 'เปิดเงินคืนหรือไม่',
    },
    is_open_credit_add: {
      th: 'เปิดเติมเครดิต',
      desc: 'เปิดเติมเครดิตหรือไม่',
    },
    is_open_deposit: {
      th: 'เปิดให้ฝาก',
      desc: 'เปิดให้ฝากหรือไม่',
    },
    is_open_register_truemoney: {
      th: 'สมัครทรูมันนี่ได้',
      desc: 'สมัครทรูมันนี่ได้หรือไม่',
    },
    is_previous_process: {
      th: 'ใช้รอบก่อนหน้า',
    },
    is_qr_open: {
      th: 'เปิดฝากด้วย QR',
      desc: 'เปิดฝากด้วย QR หรือไม่',
    },
    is_referral_open: {
      th: 'เปิดแนะนำเพื่อน',
      desc: 'เปิดระบบแนะนำเพื่อนหรือไม่',
    },
    is_withdraw_all: {
      th: 'ถอนได้ทั้งหมด',
      desc: 'ถอนได้ทั้งหมดหรือไม่',
    },
    is_withdraw_bank_verify: {
      th: 'ถอนต้องยืนยันบัญชี',
      desc: 'ถอนต้องยืนยันบัญชีธนาคารหรือไม่',
    },
    is_withdraw_new_user: {
      th: 'สมาชิกใหม่ถอนได้',
      desc: 'สมาชิกใหม่ถอนได้หรือไม่',
    },
    is_withdraw_open: {
      th: 'เปิดให้ถอน',
      desc: 'เปิดให้ถอนหรือไม่',
    },
    layout_slot: {
      th: 'จำนวนช่อง',
    },
    length_channel: {
      th: 'ความยาวช่อง',
    },
    limit_per_day: {
      th: 'ใช้สิทธิ์ได้ต่อวัน',
    },
    mark_bg_1: {
      th: 'สีมาร์ก 1',
    },
    mark_bg_2: {
      th: 'สีมาร์ก 2',
    },
    name: {
      th: 'ชื่อ',
    },
    percent: {
      th: 'เปอร์เซ็นต์ (รวม)',
      desc: 'เปอร์เซ็นต์เงินคืน (รวม)',
    },
    percent_home_living: {
      th: 'เปอร์เซ็นต์ — บ้านและที่อยู่อาศัย',
      desc: 'เปอร์เซ็นต์เงินคืน — บ้านและที่อยู่อาศัย',
    },
    percent_online_activity: {
      th: 'เปอร์เซ็นต์ — กิจกรรมออนไลน์',
      desc: 'เปอร์เซ็นต์เงินคืน — กิจกรรมออนไลน์',
    },
    percent_electronics: {
      th: 'เปอร์เซ็นต์ — อิเล็กทรอนิกส์',
      desc: 'เปอร์เซ็นต์เงินคืน — อิเล็กทรอนิกส์',
    },
    percent_gift_card: {
      th: 'เปอร์เซ็นต์ — บัตรของขวัญ',
      desc: 'เปอร์เซ็นต์เงินคืน — บัตรของขวัญ',
    },
    percent_collectibles: {
      th: 'เปอร์เซ็นต์ — ของสะสม',
      desc: 'เปอร์เซ็นต์เงินคืน — ของสะสม',
    },
    percent_fashion: {
      th: 'เปอร์เซ็นต์ — แฟชั่น',
      desc: 'เปอร์เซ็นต์เงินคืน — แฟชั่น',
    },
    percent_outdoor_activity: {
      th: 'เปอร์เซ็นต์ — กิจกรรมกลางแจ้ง',
      desc: 'เปอร์เซ็นต์เงินคืน — กิจกรรมกลางแจ้ง',
    },
    point_color: {
      th: 'สีแต้ม',
    },
    quota_color: {
      th: 'สีโควตา',
    },
    rate: {
      th: 'อัตรา',
    },
    rate_config: {
      th: 'ตั้งค่าของสมนาคุณ',
    },
    rate_text_color: {
      th: 'สีตัวอักษรอัตรา',
    },
    referral: {
      th: 'แนะนำเพื่อน',
    },
    reward_color: {
      th: 'สีของสมนาคุณ',
    },
    reward_type: {
      th: 'ประเภทของสมนาคุณ',
    },
    show_bank_member_deposit_mode: {
      th: 'โหมดแสดงบัญชีฝาก',
    },
    round_color: {
      th: 'สีปุ่มหมุน',
    },
    start_at: {
      th: 'เริ่มเมื่อ',
    },
    text_color: {
      th: 'สีตัวอักษร',
    },
    theme_config: {
      th: 'ธีม / รูปภาพ',
    },
    tier: {
      th: 'ระดับสมาชิก',
    },
    act_home_living: {
      th: 'ยอดกิจกรรม — บ้านและที่อยู่อาศัย',
      desc: 'ยอดกิจกรรมของเงินคืน — บ้านและที่อยู่อาศัย (99999 = ปิดไม่ให้ผ่าน)',
    },
    act_online_activity: {
      th: 'ยอดกิจกรรม — กิจกรรมออนไลน์',
      desc: 'ยอดกิจกรรมของเงินคืน — กิจกรรมออนไลน์ (99999 = ปิดไม่ให้ผ่าน)',
    },
    act_electronics: {
      th: 'ยอดกิจกรรม — อิเล็กทรอนิกส์',
      desc: 'ยอดกิจกรรมของเงินคืน — อิเล็กทรอนิกส์ (99999 = ปิดไม่ให้ผ่าน)',
    },
    act_gift_card: {
      th: 'ยอดกิจกรรม — บัตรของขวัญ',
      desc: 'ยอดกิจกรรมของเงินคืน — บัตรของขวัญ (99999 = ปิดไม่ให้ผ่าน)',
    },
    act_collectibles: {
      th: 'ยอดกิจกรรม — ของสะสม',
      desc: 'ยอดกิจกรรมของเงินคืน — ของสะสม (99999 = ปิดไม่ให้ผ่าน)',
    },
    act_fashion: {
      th: 'ยอดกิจกรรม — แฟชั่น',
      desc: 'ยอดกิจกรรมของเงินคืน — แฟชั่น (99999 = ปิดไม่ให้ผ่าน)',
    },
    act_outdoor_activity: {
      th: 'ยอดกิจกรรม — กิจกรรมกลางแจ้ง',
      desc: 'ยอดกิจกรรมของเงินคืน — กิจกรรมกลางแจ้ง (99999 = ปิดไม่ให้ผ่าน)',
    },
    activity_volume: {
      th: 'ยอดกิจกรรม (รวม)',
    },
    updated_at: {
      th: 'แก้ไขล่าสุด',
    },
    wallet: {
      th: 'ฝาก / ถอน',
    },
    wallet_setting: {
      th: 'ตั้งค่ากระเป๋าเงิน',
    },
    point_round_border_1: {
      th: 'ขอบรอบสะสมแต้ม 1',
    },
    point_round_border_2: {
      th: 'ขอบรอบสะสมแต้ม 2',
    },
    point_round_border_3: {
      th: 'ขอบรอบสะสมแต้ม 3',
    },
    withdraw_amount_approve: {
      th: 'ถอนเกินยอดนี้ต้องอนุมัติ',
      desc: 'ถอนเกินยอดนี้ต้องรอแอดมินอนุมัติ (บาท)',
    },
    withdraw_amount_min: {
      th: 'ถอนขั้นต่ำ',
      desc: 'ถอนขั้นต่ำ (บาท)',
    },
    withdraw_limit_per_day: {
      th: 'ถอนได้กี่ครั้งต่อวัน',
    },
    withdraw_max_per_bill: {
      th: 'ถอนสูงสุดต่อครั้ง',
      desc: 'ถอนสูงสุดต่อครั้ง (บาท)',
    },
    withdraw_transfer_group_amount: {
      th: 'ยอดโอนแบบกลุ่ม',
    },
    withdraw_transfer_group_open: {
      th: 'เปิดโอนแบบกลุ่ม',
    },
    withdraw_truemoney_mode: {
      th: 'โหมดถอนเข้าทรูมันนี่',
    },
  },
  bool: {
    true: {
      th: 'เปิด',
    },
    false: {
      th: 'ปิด',
    },
  },
  deposit_status: {
    success: {
      th: 'สำเร็จ',
      en: 'Success',
    },
    pending: {
      th: 'รอดำเนินการ',
      en: 'Pending',
    },
    'wait-approve': {
      th: 'รออนุมัติ',
      en: 'Waiting approval',
    },
    cancel: {
      th: 'ยกเลิก',
      en: 'Cancelled',
    },
    reject: {
      th: 'ไม่อนุมัติ',
      en: 'Rejected',
    },
    failed: {
      th: 'ไม่สำเร็จ',
      en: 'Failed',
    },
  },
  withdraw_status: {
    success: {
      th: 'สำเร็จ',
      en: 'Success',
    },
    pending: {
      th: 'รอดำเนินการ',
      en: 'Pending',
    },
    'wait-approve': {
      th: 'รออนุมัติ',
      en: 'Waiting approval',
    },
    cancel: {
      th: 'ยกเลิก',
      en: 'Cancelled',
    },
    reject: {
      th: 'ไม่อนุมัติ',
      en: 'Rejected',
    },
    failed: {
      th: 'ไม่สำเร็จ',
      en: 'Failed',
    },
  },
  cashback_status: {
    success: {
      th: 'สำเร็จ',
      en: 'Success',
    },
    pending: {
      th: 'รอดำเนินการ',
      en: 'Pending',
    },
    'wait-approve': {
      th: 'รออนุมัติ',
      en: 'Waiting approval',
    },
    cancel: {
      th: 'ยกเลิก',
      en: 'Cancelled',
    },
    reject: {
      th: 'ไม่อนุมัติ',
      en: 'Rejected',
    },
    failed: {
      th: 'ไม่สำเร็จ',
      en: 'Failed',
    },
  },
  acc_status: {
    enable: {
      th: 'เปิดใช้งาน',
      en: 'Active',
    },
    disable: {
      th: 'ถูกระงับ',
      en: 'Suspended',
    },
  },
  yesno: {
    true: {
      th: 'ใช่',
      en: 'Yes',
    },
    false: {
      th: 'ไม่ใช่',
      en: 'No',
    },
  },
  reward_type: {
    credit: {
      th: 'เครดิต',
      en: 'Credit',
    },
    coin: {
      th: 'เหรียญ',
      en: 'Coin',
    },
    diamond: {
      th: 'เพชร',
      en: 'Diamond',
    },
    cash: {
      th: 'เงินสด',
      en: 'Cash',
    },
    point: {
      th: 'แต้ม',
      en: 'Point',
    },
    item: {
      th: 'ของของสมนาคุณ',
      en: 'Item',
    },
    none: {
      th: 'ไม่ได้ของสมนาคุณ',
      en: 'None',
    },
  },
  asset_code: {
    credit: {
      th: 'เครดิต',
      en: 'Credit',
    },
    cash: {
      th: 'เงินสด',
      en: 'Cash',
    },
    coin: {
      th: 'เหรียญ',
      en: 'Coin',
    },
    diamond: {
      th: 'เพชร',
      en: 'Diamond',
    },
  },
  coin_action: {
    action_coin_deposit: {
      th: 'ได้จากการฝาก',
      en: 'From deposit',
    },
    action_coin_spend: {
      th: 'ใช้แต้ม/ร่วมกิจกรรมสะสมแต้ม',
      en: 'Play / point round',
    },
    action_coin_reward: {
      th: 'ได้จากของสมนาคุณ',
      en: 'Reward',
    },
    action_coin_admin: {
      th: 'แอดมินปรับให้',
      en: 'Admin adjust',
    },
    action_coin_expire: {
      th: 'หมดอายุ',
      en: 'Expired',
    },
    action_coin_refund: {
      th: 'คืนเหรียญ',
      en: 'Refund',
    },
  },
  promo_status: {
    open: {
      th: 'เปิดใช้งาน',
      en: 'Open',
    },
    close: {
      th: 'ปิดใช้งาน',
      en: 'Closed',
    },
    closed: {
      th: 'ปิดใช้งาน',
      en: 'Closed',
    },
    expired: {
      th: 'หมดอายุ',
      en: 'Expired',
    },
    pending: {
      th: 'รอเริ่ม',
      en: 'Pending',
    },
  },
  promo_mode: {
    'fix-deposit': {
      th: 'ฝากยอดคงที่',
      en: 'Fixed deposit',
    },
    percent: {
      th: 'คิดเป็นเปอร์เซ็นต์',
      en: 'Percent',
    },
    'fix-bonus': {
      th: 'โบนัสคงที่',
      en: 'Fixed bonus',
    },
    'first-deposit': {
      th: 'ฝากครั้งแรก',
      en: 'First deposit',
    },
  },
  promo_type: {
    forever: {
      th: 'ใช้ได้ตลอด',
      en: 'Forever',
    },
    period: {
      th: 'ตามช่วงเวลา',
      en: 'Period',
    },
    once: {
      th: 'ครั้งเดียว',
      en: 'Once',
    },
    daily: {
      th: 'รายวัน',
      en: 'Daily',
    },
  },
  promo_clear_type: {
    fix_value: {
      th: 'ยอดคงที่',
      en: 'Fixed value',
    },
  },
  cashback_type: {
    spend_total: {
      th: 'คิดจากยอดผลสุทธิ',
      en: 'Net result',
    },
    activity_volume: {
      th: 'คิดจากยอดยอดกิจกรรม',
      en: 'Activity volume',
    },
    deposit: {
      th: 'คิดจากยอดฝาก',
      en: 'Deposit',
    },
  },
  transaction_type: {
    deposit: {
      th: 'ฝาก',
      en: 'Deposit',
    },
    withdraw: {
      th: 'ถอน',
      en: 'Withdraw',
    },
  },
  deposit_mode: {
    all: {
      th: 'ทุกช่องทาง',
      en: 'All',
    },
    bank: {
      th: 'ธนาคารเท่านั้น',
      en: 'Bank only',
    },
    qr: {
      th: 'คิวอาร์เท่านั้น',
      en: 'QR only',
    },
    truemoney: {
      th: 'ทรูมันนี่เท่านั้น',
      en: 'TrueMoney only',
    },
  },
  show_bank_mode: {
    all: {
      th: 'แสดงทุกบัญชี',
      en: 'Show all',
    },
    random: {
      th: 'สุ่มบัญชี',
      en: 'Random',
    },
    single: {
      th: 'บัญชีเดียว',
      en: 'Single',
    },
    round_robin: {
      th: 'วนตามลำดับ',
      en: 'Round robin',
    },
  },
  withdraw_truemoney_mode: {
    withdraw_approve: {
      th: 'ต้องรออนุมัติ',
      en: 'Needs approval',
    },
    withdraw_auto: {
      th: 'ถอนอัตโนมัติ',
      en: 'Auto',
    },
    withdraw_close: {
      th: 'ปิดการถอน',
      en: 'Closed',
    },
  },
  promo_withdraw_mode: {
    'wait-approve': {
      th: 'ต้องรออนุมัติ',
      en: 'Needs approval',
    },
    auto: {
      th: 'ถอนอัตโนมัติ',
      en: 'Auto',
    },
  },
  product_type: {
    fashion: {
      th: 'แฟชั่น',
      en: 'Fashion',
    },
    electronics: {
      th: 'อิเล็กทรอนิกส์',
      en: 'Electronics',
    },
    home_living: {
      th: 'บ้านและที่อยู่อาศัย',
      en: 'Home & living',
    },
    outdoor_activity: {
      th: 'กิจกรรมกลางแจ้ง',
      en: 'outdoor_activity activity',
    },
    online_activity: {
      th: 'กิจกรรมออนไลน์',
      en: 'Online services',
    },
    collectibles: {
      th: 'ของสะสม',
      en: 'Collectibles',
    },
    gift_card: {
      th: 'บัตรของขวัญ',
      en: 'Gift card',
    },
  },
} as const;
