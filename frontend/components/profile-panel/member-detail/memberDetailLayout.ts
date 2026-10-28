/**
 * [FEAT-20261015-MEMBERDETAIL] What the hand-typed customer card shows on this site — pure.
 *
 * rule null (shop-api, or the route failed) ⇒ TODAY'S CARD, field for field: shown only without
 * an shop-api profile, ชื่อ-สกุล · เบอร์โทร · รหัสสมาชิก, no nickname.
 * A provider rule (loan) ⇒ the old system's rule: nickname for everyone; name / phone / the
 * third slot only while the partner does not know the customer (`registered` = the
 * provider's own `has_member_data` verdict).
 *
 * Adding a provider = a BE declaration; a new third-slot meaning = one row in THIRD_SLOT.
 */
import type { MemberDetailRule } from '../../../services/chat/providerMemberDetail';

export type DetailKey = 'name' | 'phone' | 'contract';
export interface DetailField { key: DetailKey; label: string; ph: string }

/** today's three fields — shop-api's card, unchanged */
const TODAY_FIELDS: readonly DetailField[] = [
  { key: 'name', label: 'ชื่อ-สกุล', ph: 'เช่น ธีรเมธ สุขสมบัติ' },
  { key: 'phone', label: 'เบอร์โทร', ph: 'เช่น 0700000303' },
  // [FEAT-20260729-TMPEDIT2] การ์ดนี้ (PersonalPanelNarrow) ตัด "เลขสัญญา / " ออก เหลือ
  // "รหัสสมาชิก" ตรง ๆ · LegacyPanel ที่เคยใช้คำว่าเลขสัญญาถูกลบแล้ว 14/10/2026
  { key: 'contract', label: 'รหัสสมาชิก', ph: 'เช่น sim_beta_0003' },
];

/** what the third `detail` slot is called, per the provider's `third_slot` */
const THIRD_SLOT: Readonly<Record<string, Pick<DetailField, 'label' | 'ph'>>> = {
  contract: { label: 'เลขที่สัญญา', ph: 'เช่น CT0226-SRI001-0020-01' },
};

export interface MemberDetailLayout {
  title: string;
  confirmText: string;
  nickname: boolean;
  detailFields: readonly DetailField[];
  /** shown instead of the detail fields when they are not editable */
  note: string | null;
}

const TODAY: MemberDetailLayout = {
  title: 'ข้อมูลชั่วคราว',
  confirmText: 'ยืนยันบันทึกข้อมูลชั่วคราวนี้?',
  nickname: false,
  detailFields: TODAY_FIELDS,
  note: null,
};

export const NICKNAME_FIELD = { label: 'ชื่อเล่น', ph: 'ชื่อเรียก...' } as const;
export const NICKNAME_EMPTY = 'ชื่อเล่นว่างไม่ได้';

export function memberDetailLayout(
  rule: MemberDetailRule | null | undefined,
  registered: boolean,
): MemberDetailLayout {
  if (!rule) return TODAY;
  const third = THIRD_SLOT[rule.thirdSlot] ?? TODAY_FIELDS[2]!;
  const locked = rule.detailOnlyUnregistered && registered;
  const thirdLabel = third.label;
  return {
    title: 'ข้อมูลที่แอดมินกรอก',
    confirmText: 'ยืนยันบันทึกข้อมูลนี้?',
    nickname: rule.nickname,
    detailFields: locked
      ? []
      : [TODAY_FIELDS[0]!, TODAY_FIELDS[1]!, { key: 'contract', ...third }],
    note: locked
      ? `ลูกค้าลงทะเบียนแล้ว — ชื่อ เบอร์ และ${thirdLabel}มาจากระบบต้นทาง แก้ได้เฉพาะชื่อเล่น`
      : null,
  };
}

/**
 * Whether the card renders at all. shop-api: exactly today's `!xp && !rawLoading`. A provider
 * rule with a nickname: for every customer once the profile has loaded (the nickname is
 * editable for everyone); without one, only while the provider says "not registered".
 */
export function showMemberDetailCard(
  rule: MemberDetailRule | null | undefined,
  s: { xp: unknown; rawLoading: boolean; registered: boolean },
): boolean {
  if (s.rawLoading) return false;
  if (!rule) return !s.xp;
  return rule.nickname || !(rule.detailOnlyUnregistered && s.registered);
}

/**
 * [FEAT-20261022-I18NTICKETEN] Every fixed Thai string this layout can hand the card, mapped
 * to its dictionary key. The layout stays pure Thai (its tests read it); the card translates
 * at render with `t(key, thai)` — a string not listed here is drawn as is.
 */
export const LAYOUT_COPY_KEYS: Readonly<Record<string, string>> = {
  'ชื่อ-สกุล': 'ticketui.panel.detail_full_name',
  'เช่น ธีรเมธ สุขสมบัติ': 'ticketui.panel.detail_full_name_ph',
  'เช่น 0700000303': 'ticketui.panel.detail_phone_ph',
  'เช่น sim_beta_0003': 'ticketui.panel.detail_member_id_ph',
  'เลขที่สัญญา': 'ticketui.panel.detail_contract_no',
  'เช่น CT0226-SRI001-0020-01': 'ticketui.panel.detail_contract_no_ph',
  'ข้อมูลชั่วคราว': 'ticketui.panel.detail_temp_info',
  'ยืนยันบันทึกข้อมูลชั่วคราวนี้?': 'ticketui.panel.detail_temp_confirm',
  'ชื่อเล่น': 'ticketui.panel.detail_nickname',
  'ชื่อเรียก...': 'ticketui.panel.detail_nickname_ph',
  'ชื่อเล่นว่างไม่ได้': 'ticketui.panel.detail_nickname_empty',
  'ข้อมูลที่แอดมินกรอก': 'ticketui.panel.detail_admin_info',
  'ยืนยันบันทึกข้อมูลนี้?': 'ticketui.panel.detail_admin_confirm',
  'ลูกค้าลงทะเบียนแล้ว — ชื่อ เบอร์ และเลขที่สัญญามาจากระบบต้นทาง แก้ได้เฉพาะชื่อเล่น': 'ticketui.panel.detail_locked_note_contract',
  'ลูกค้าลงทะเบียนแล้ว — ชื่อ เบอร์ และรหัสสมาชิกมาจากระบบต้นทาง แก้ได้เฉพาะชื่อเล่น': 'ticketui.panel.detail_locked_note_member',
  'เบอร์โทร': 'ticket.phone',
  'รหัสสมาชิก': 'ticket.member_id',
};
