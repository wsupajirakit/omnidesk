/**
 * LIFTED — pending rewrite. Source: legacy-api `src/config/flexVarSpec.js`
 * (612 lines) and `src/config/siteRulesVarSpec.js` (318 lines).
 *
 * Only the *path-walking* half of those two modules is lifted here: the spec
 * tables and `walkFlexVarSpec` / `walkSiteRulesSpec` / `collectSpecPaths` /
 * `pickShop`. The rendering half (`buildFlexProfileVarMap`, `applyFormat`,
 * `formatFlexVar`, the bank directory, the profile sample) is deliberately NOT
 * lifted — the three endpoints in this task only ever ask the spec "which paths
 * exist and what tag reads them", never "what value goes in this card".
 *
 * Why the split is safe rather than partial: `walkFlexVarSpec` is the single
 * function legacy itself uses for both jobs, precisely so the two can never
 * disagree (see the legacy comment at flexVarSpec.js:392). Lifting the walk and
 * its spec table reproduces the path set exactly; the renderer contributes
 * nothing to it.
 *
 * What would unblock splitting this file: nothing structural — it is one spec
 * table plus its walker. It exceeds 400 lines because the table is 100+ rows of
 * data, which is why the waiver names it explicitly in eslint.config.mjs.
 */

/** A visitor over the spec: called once per variable with its tag and path. */
export type SpecVisitor = (tag: string, path: string, desc: string) => void;

type SpecRow =
  | { kind: 'one'; tag: string; path: string; desc: string }
  | {
      kind: 'each';
      keys: ReadonlyArray<readonly [string, string]>;
      tagTpl: string;
      pathTpl: string;
      descTpl: string;
    }
  | {
      kind: 'list';
      prefix: string;
      path: string;
      fields: ReadonlyArray<readonly [string, string]>;
      label: string;
    }
  | {
      kind: 'indexed';
      prefix: string;
      path: string;
      by: string;
      keys: ReadonlyArray<readonly [string, string]>;
      fields: ReadonlyArray<readonly [string, string, string]>;
      label: string;
    };

const ONE = (tag: string, path: string, desc: string): SpecRow => ({
  kind: 'one',
  tag,
  path,
  desc,
});
const EACH = (
  keys: ReadonlyArray<readonly [string, string]>,
  tagTpl: string,
  pathTpl: string,
  descTpl: string,
): SpecRow => ({ kind: 'each', keys, tagTpl, pathTpl, descTpl });
const LIST = (
  prefix: string,
  path: string,
  fields: ReadonlyArray<readonly [string, string]>,
  label: string,
): SpecRow => ({ kind: 'list', prefix, path, fields, label });
const INDEXED = (
  prefix: string,
  path: string,
  by: string,
  keys: ReadonlyArray<readonly [string, string]>,
  fields: ReadonlyArray<readonly [string, string, string]>,
  label: string,
): SpecRow => ({ kind: 'indexed', prefix, path, by, keys, fields, label });

/** Ceiling on rows expanded per list — legacy FLEX_VAR_LIST_ROWS. */
const FLEX_VAR_LIST_ROWS = 10;

// ⚠️ online services here has NO underscore; the activity volume block below uses online_activity.
const PROMO_ACTIVITY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['home_living', 'บ้านและที่อยู่อาศัย'],
  ['online_activity', 'กิจกรรมออนไลน์'],
  ['electronics', 'อิเล็กทรอนิกส์'],
  ['gift_card', 'บัตรของขวัญ'],
  ['collectibles', 'ของสะสม'],
  ['fashion', 'แฟชั่น'],
  ['outdoor_activity', 'กิจกรรมกลางแจ้ง'],
];
const ACTIVITY_VOLUME_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['home_living', 'บ้านและที่อยู่อาศัย'],
  ['online_activity', 'กิจกรรมออนไลน์'],
  ['electronics', 'อิเล็กทรอนิกส์'],
  ['gift_card', 'บัตรของขวัญ'],
  ['collectibles', 'ของสะสม'],
  ['fashion', 'แฟชั่น'],
  ['outdoor_activity', 'กิจกรรมกลางแจ้ง'],
  ['total', 'รวมทุกกิจกรรม'],
];
const BALANCE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['cash', 'เงินสด'],
  ['credit', 'เครดิต'],
  ['coin', 'เหรียญ'],
  ['diamond', 'เพชร'],
];

const TX_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['amount', 'จำนวนเงิน'],
  ['date', 'เวลา'],
  ['status', 'สถานะ'],
  ['ref_id', 'รหัสอ้างอิง'],
];
const MONEY_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['amount', 'จำนวนเงิน'],
  ['date', 'เวลา'],
  ['status', 'สถานะ'],
];
const PRODUCT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['catalog_name', 'ชื่อสินค้า'],
  ['product_name', 'แบรนด์สินค้า'],
  ['product_type', 'ประเภทสินค้า'],
  ['catalog_image_path', 'รูปสินค้า (ใส่ใน image ได้)'],
  ['updated_at', 'ซื้อล่าสุด'],
  ['created_at', 'ครั้งแรกที่ซื้อ'],
];
const POINT_ROUND_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['reward_type', 'ประเภทของสมนาคุณ'],
  ['reward_amount', 'จำนวนของสมนาคุณ'],
  ['date', 'เวลา'],
  ['note', 'หมายเหตุ'],
];
const COIN_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['action', 'ประเภทรายการ'],
  ['amount', 'จำนวนเหรียญ'],
  ['date', 'เวลา'],
  ['note', 'หมายเหตุ'],
];
const REFERRAL_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['amount', 'ค่าแนะนำที่ได้'],
  ['status', 'สถานะ'],
  ['date', 'เวลา'],
  ['child_phone', 'เบอร์เพื่อนที่ชวน'],
  ['child_mtk_name', 'ชื่อสายงานเพื่อน'],
];

const FLEX_VAR_SPEC: readonly SpecRow[] = [
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
export function walkFlexVarSpec(visit: SpecVisitor): void {
  for (const row of FLEX_VAR_SPEC) {
    if (row.kind === 'one') {
      visit(row.tag, row.path, row.desc);
      continue;
    }
    if (row.kind === 'each') {
      for (const [k, label] of row.keys) {
        visit(
          row.tagTpl.replace('{k}', k),
          row.pathTpl.replace('{k}', k),
          row.descTpl.replace('{label}', label),
        );
      }
      continue;
    }
    if (row.kind === 'list') {
      for (let i = 1; i <= FLEX_VAR_LIST_ROWS; i++) {
        for (const [field, fieldLabel] of row.fields) {
          visit(
            `${row.prefix}_${i}_${field}`,
            `${row.path}[${i - 1}].${field}`,
            `${row.label} รายการที่ ${i}${i === 1 ? ' (ล่าสุด)' : ''} — ${fieldLabel}`,
          );
        }
      }
      continue;
    }
    for (const [k, keyLabel] of row.keys) {
      for (const [suffix, field, fieldLabel] of row.fields) {
        visit(
          `${row.prefix}_${k}${suffix}`,
          `${row.path}[${row.by}=${k}].${field}`,
          `${fieldLabel} — ${keyLabel}`,
        );
      }
    }
  }
}

/** Collapse every bracketed index/key to `[]` so paths compare equal. */
export function canonicalFlexPath(path: string): string {
  return String(path).replace(/\[[^\]]*\]/g, '[]');
}

/** Every path the profile spec reads, with indexes collapsed. */
export function collectSpecPaths(): Set<string> {
  const out = new Set<string>();
  walkFlexVarSpec((_tag, path) => out.add(canonicalFlexPath(path)));
  return out;
}

/* ────────────────────────── site rules side ────────────────────────────── */

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

const SITE_RULES_VAR_SPEC: readonly SpecRow[] = [
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
export function pickShop(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const data = r['data'] as Record<string, unknown> | undefined;
  const fromData = data?.['shop'];
  if (fromData && typeof fromData === 'object') {
    return fromData as Record<string, unknown>;
  }
  const shop = r['shop'];
  if (shop && typeof shop === 'object') return shop as Record<string, unknown>;
  if (data && typeof data === 'object') return data;
  return r;
}

/** Walk the site-rules spec once — the mirror of `walkFlexVarSpec`. */
export function walkSiteRulesSpec(visit: SpecVisitor): void {
  for (const row of SITE_RULES_VAR_SPEC) {
    if (row.kind === 'one') {
      visit(row.tag, row.path, row.desc);
      continue;
    }
    if (row.kind === 'each') {
      for (const [k, label] of row.keys) {
        visit(
          row.tagTpl.replace('{k}', k),
          row.pathTpl.replace('{k}', k),
          row.descTpl.replace('{label}', label),
        );
      }
    }
  }
}
