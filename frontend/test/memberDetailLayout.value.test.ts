/**
 * [FEAT-20261015-MEMBERDETAIL] The card's layout rule for ANY provider — not only loan.
 *
 * Owner 15/10/2026: "รองรับค่ายสาม สี่ อนาคต" — a third/fourth provider declares its own rule
 * and must get a correct card without code changes. These cases cover the combinations loan
 * does not exercise (mutation FM1 survived the DOM suite because loan always has a nickname).
 */
import { describe, it, expect } from 'vitest';

import { memberDetailLayout, showMemberDetailCard } from '../components/profile-panel/member-detail';

const LOAN = { thirdSlot: 'contract', nickname: true, detailOnlyUnregistered: true };
const NO_NICK = { thirdSlot: 'contract', nickname: false, detailOnlyUnregistered: true };
const OPEN_ALWAYS = { thirdSlot: 'contract', nickname: false, detailOnlyUnregistered: false };
const UNKNOWN_SLOT = { thirdSlot: 'account_no', nickname: true, detailOnlyUnregistered: true };

const labels = (l: ReturnType<typeof memberDetailLayout>) => l.detailFields.map((f) => f.label);

describe('[MEMBERDETAIL] showMemberDetailCard', () => {
  it('⭐ PIN shop-api (no rule) — exactly `!xp && !rawLoading`', () => {
    expect(showMemberDetailCard(null, { xp: null, rawLoading: false, registered: false })).toBe(true);
    expect(showMemberDetailCard(null, { xp: { profile: {} }, rawLoading: false, registered: false })).toBe(false);
    expect(showMemberDetailCard(null, { xp: null, rawLoading: true, registered: false })).toBe(false);
    // shop-api never stamps has_member_data — and even if something did, it is ignored without a rule
    expect(showMemberDetailCard(null, { xp: null, rawLoading: false, registered: true })).toBe(true);
  });
  it('⭐ a provider WITHOUT a nickname hides the card for a registered customer (nothing to edit)', () => {
    expect(showMemberDetailCard(NO_NICK, { xp: null, rawLoading: false, registered: true })).toBe(false);
    expect(showMemberDetailCard(NO_NICK, { xp: null, rawLoading: false, registered: false })).toBe(true);
  });
  it('a provider that lets admins edit registered customers too keeps the card', () => {
    expect(showMemberDetailCard(OPEN_ALWAYS, { xp: null, rawLoading: false, registered: true })).toBe(true);
  });
  it('loan — every customer once loaded (the nickname is for everyone); never while loading', () => {
    expect(showMemberDetailCard(LOAN, { xp: null, rawLoading: false, registered: true })).toBe(true);
    expect(showMemberDetailCard(LOAN, { xp: null, rawLoading: true, registered: false })).toBe(false);
  });
});

describe('[MEMBERDETAIL] memberDetailLayout', () => {
  it('⭐ PIN shop-api — today’s title, three fields, no nickname, no note', () => {
    const l = memberDetailLayout(null, false);
    expect([l.title, l.nickname, l.note]).toEqual(['ข้อมูลชั่วคราว', false, null]);
    expect(labels(l)).toEqual(['ชื่อ-สกุล', 'เบอร์โทร', 'รหัสสมาชิก']);
  });
  it('loan unregistered — the contract is named as such', () => {
    expect(labels(memberDetailLayout(LOAN, false))).toEqual(['ชื่อ-สกุล', 'เบอร์โทร', 'เลขที่สัญญา']);
  });
  it('detail stays editable for a registered customer when the provider allows it', () => {
    expect(labels(memberDetailLayout(OPEN_ALWAYS, true))).toEqual(['ชื่อ-สกุล', 'เบอร์โทร', 'เลขที่สัญญา']);
    expect(memberDetailLayout(OPEN_ALWAYS, true).note).toBeNull();
  });
  it('⭐ a third-slot meaning this screen does not know yet ⇒ today’s label, never a blank', () => {
    expect(labels(memberDetailLayout(UNKNOWN_SLOT, false))[2]).toBe('รหัสสมาชิก');
  });
});
