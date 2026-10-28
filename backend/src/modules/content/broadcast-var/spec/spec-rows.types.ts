/**
 * [FEAT-20260822-BCASTSPECCLONE] Part of the cloned flex variable spec.
 *
 * Split across several files ONLY to stay under the 400-line rule — the
 * original keeps it in one file because that file carries a by-name waiver, and
 * `dev-local §6.1` says the waiver list may shrink, never grow. The content is
 * still a verbatim copy; see `broadcast-var-spec.ts` for why this clone exists
 * and what holds it to the original. แยกไฟล์เพราะกฏบรรทัด ไม่ใช่เพราะเนื้อหาต่างกัน.
 */

export type SpecRow =
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

export const ONE = (tag: string, path: string, desc: string): SpecRow => ({
  kind: 'one',
  tag,
  path,
  desc,
});
export const EACH = (
  keys: ReadonlyArray<readonly [string, string]>,
  tagTpl: string,
  pathTpl: string,
  descTpl: string,
): SpecRow => ({ kind: 'each', keys, tagTpl, pathTpl, descTpl });
export const LIST = (
  prefix: string,
  path: string,
  fields: ReadonlyArray<readonly [string, string]>,
  label: string,
): SpecRow => ({ kind: 'list', prefix, path, fields, label });
export const INDEXED = (
  prefix: string,
  path: string,
  by: string,
  keys: ReadonlyArray<readonly [string, string]>,
  fields: ReadonlyArray<readonly [string, string, string]>,
  label: string,
): SpecRow => ({ kind: 'indexed', prefix, path, by, keys, fields, label });

/** Ceiling on rows expanded per list — legacy FLEX_VAR_LIST_ROWS. */
export const FLEX_VAR_LIST_ROWS = 10;

// ⚠️ online services here has NO underscore; the activity volume block below uses online_activity.
export const PROMO_ACTIVITY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['home_living', 'บ้านและที่อยู่อาศัย'],
  ['online_activity', 'กิจกรรมออนไลน์'],
  ['electronics', 'อิเล็กทรอนิกส์'],
  ['gift_card', 'บัตรของขวัญ'],
  ['collectibles', 'ของสะสม'],
  ['fashion', 'แฟชั่น'],
  ['outdoor_activity', 'กิจกรรมกลางแจ้ง'],
];
export const ACTIVITY_VOLUME_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['home_living', 'บ้านและที่อยู่อาศัย'],
  ['online_activity', 'กิจกรรมออนไลน์'],
  ['electronics', 'อิเล็กทรอนิกส์'],
  ['gift_card', 'บัตรของขวัญ'],
  ['collectibles', 'ของสะสม'],
  ['fashion', 'แฟชั่น'],
  ['outdoor_activity', 'กิจกรรมกลางแจ้ง'],
  ['total', 'รวมทุกกิจกรรม'],
];
export const BALANCE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['cash', 'เงินสด'],
  ['credit', 'เครดิต'],
  ['coin', 'เหรียญ'],
  ['diamond', 'เพชร'],
];

export const TX_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['amount', 'จำนวนเงิน'],
  ['date', 'เวลา'],
  ['status', 'สถานะ'],
  ['ref_id', 'รหัสอ้างอิง'],
];
export const MONEY_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['amount', 'จำนวนเงิน'],
  ['date', 'เวลา'],
  ['status', 'สถานะ'],
];
export const PRODUCT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['catalog_name', 'ชื่อสินค้า'],
  ['product_name', 'แบรนด์สินค้า'],
  ['product_type', 'ประเภทสินค้า'],
  ['catalog_image_path', 'รูปสินค้า (ใส่ใน image ได้)'],
  ['updated_at', 'ซื้อล่าสุด'],
  ['created_at', 'ครั้งแรกที่ซื้อ'],
];
export const POINT_ROUND_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['reward_type', 'ประเภทของสมนาคุณ'],
  ['reward_amount', 'จำนวนของสมนาคุณ'],
  ['date', 'เวลา'],
  ['note', 'หมายเหตุ'],
];
export const COIN_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['action', 'ประเภทรายการ'],
  ['amount', 'จำนวนเหรียญ'],
  ['date', 'เวลา'],
  ['note', 'หมายเหตุ'],
];
export const REFERRAL_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['amount', 'ค่าแนะนำที่ได้'],
  ['status', 'สถานะ'],
  ['date', 'เวลา'],
  ['child_phone', 'เบอร์เพื่อนที่ชวน'],
  ['child_mtk_name', 'ชื่อสายงานเพื่อน'],
];
