/**
 * [FEAT-20261015-MEMBERDETAIL] The panel's hand-typed customer card ("ข้อมูลชั่วคราว").
 *
 * BEFORE (written on the unchanged code, 15/10/2026): shop-api's card exactly as it is —
 * shown only when there is no shop-api profile, three fields (ชื่อ-สกุล · เบอร์โทร · รหัสสมาชิก),
 * no nickname, saves `name|phone|code` through patchDetail. The markup is frozen by a
 * snapshot so the move into `components/profile-panel/member-detail/` and the loan rule
 * cannot change a byte of it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const envelope: { value: unknown } = { value: null };
const patchDetail = vi.fn((..._a: unknown[]) => Promise.resolve({}));
const patchNickname = vi.fn((..._a: unknown[]) => Promise.resolve());

vi.mock('../services/chat', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
  return {
    ...actual,
    ticketService: {
      getRawProfile: () => Promise.resolve(envelope.value),
      refreshRawProfile: () => Promise.resolve(envelope.value),
      clearRawProfile: () => Promise.resolve({ success: true }),
      getHookSiteRules: () => Promise.resolve(null),
      refreshHookSiteRules: () => Promise.resolve(null),
      getLinkCapabilities: () => Promise.resolve({}),
      getAdminLinkUrl: () => Promise.resolve({}),
      adminUnlinkCustomer: () => Promise.resolve({}),
      patchDetail: (...a: unknown[]) => patchDetail(...a),
      patchNickname: (...a: unknown[]) => patchNickname(...a),
    },
    dictLookup: (s: string) => s,
    loadTranslationDict: () => Promise.resolve(),
    subscribeDict: () => () => {},
  };
});
/* [FEAT-20261015-MEMBERDETAIL] the provider route — answers per test, everything else real */
const LOAN_RULE = { third_slot: 'contract', nickname: true, detail_only_unregistered: true };
const answer = vi.hoisted(() => ({ rule: null as unknown, fail: false }));
vi.mock('../services/apiClient', async () => {
  const actual = await vi.importActual<Record<string, any>>('../services/apiClient');
  return {
    ...actual,
    authFetch: (url: string, ...rest: unknown[]) =>
      String(url).endsWith('/api/customer-provider/member-detail')
        ? Promise.resolve(answer.fail
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, json: async () => ({ success: true, data: { member_detail: answer.rule } }) })
        : actual.authFetch(url, ...rest),
  };
});
vi.mock('../services/finance', () => ({
  bankService: { getDirectory: () => Promise.resolve([]), logoUrl: () => '', lookup: () => null },
}));
vi.mock('../services/authStorage', () => ({
  getStoredAuth: () => ({ user: { role: { name: 'admin' } }, token: 't' }),
}));
vi.mock('../pages/chat/chatOpenedRefresh', () => ({
  profileRefreshPlan: () => ({ shouldFetch: true }),
  useChatOpenedRefresh: () => {},
}));

import { I18nProvider } from '../i18n';
import { PersonalPanelNarrow } from '../components/profile-panel';
import ENVELOPES from './fixtures/loanV1RawProfileEnvelopes.json';
import { resetProviderMemberDetail } from '../services/chat/providerMemberDetail';

const MEMBER = 'a0d00000000000000000002b';
const SHOPAPI_PROFILE = { data: { profile: { full_name: 'ลูกค้า ทดสอบ' } } };

const mount = (rawProfile: unknown, detail = '') => {
  envelope.value = rawProfile;
  return render(
    <I18nProvider>
      <PersonalPanelNarrow
        source={{ line_user_data: { _id: MEMBER, line_user_id: 'U0', detail, nickname: 'เดิม' }, line_oa_hook_id: 'h1' } as never}
        room={null}
      />
    </I18nProvider>,
  );
};
/** the card's root, opened (it starts folded) */
const openCard = async (title = 'ข้อมูลชั่วคราว') => {
  const head = await screen.findByText(title);
  fireEvent.click(head);
  return head.closest('.rounded-lg') as HTMLElement;
};
const labelsIn = (card: HTMLElement) => Array.from(card.querySelectorAll('label')).map((l) => l.textContent);

// every test starts as shop-api (the route answers null) — a loan describe opts in with asLoan
beforeEach(() => { patchDetail.mockClear(); patchNickname.mockClear(); asShopapi(); });

describe('[MEMBERDETAIL] BEFORE — shop-api card as it is today', () => {
  it('⭐ no shop-api profile ⇒ the card shows: ชื่อ-สกุล · เบอร์โทร · รหัสสมาชิก, no nickname', async () => {
    mount(null);
    const card = await openCard();
    expect(labelsIn(card)).toEqual(['ชื่อ-สกุล', 'เบอร์โทร', 'รหัสสมาชิก']);
    expect(within(card).queryByText('ชื่อเล่น')).toBeNull();
  });
  it('⭐ markup frozen (shop-api)', async () => {
    mount(null, 'สมชาย|0811111111|M001');
    const card = await openCard();
    expect(card.outerHTML).toMatchSnapshot();
  });
  it('⭐ an shop-api profile ⇒ no card (the real data wins)', async () => {
    mount(SHOPAPI_PROFILE);
    await waitFor(() => expect(screen.queryByText('กำลังโหลดข้อมูลลูกค้า…')).toBeNull());
    expect(screen.queryByText('ข้อมูลชั่วคราว')).toBeNull();
  });
  it('⭐ OUT — pencil · type · บันทึก · ยืนยัน ⇒ patchDetail(member, "name|phone|code"), no nickname call', async () => {
    mount(null, '|0811111111|M001');
    const card = await openCard();
    fireEvent.click(within(card).getByTitle('แก้ไข'));
    fireEvent.change(within(card).getAllByRole('textbox')[0]!, { target: { value: 'สมหญิง' } });
    fireEvent.click(within(card).getByText('บันทึก'));
    fireEvent.click(within(card).getByText('ยืนยัน'));
    await waitFor(() => expect(patchDetail).toHaveBeenCalledWith(MEMBER, 'สมหญิง|0811111111|M001'));
    expect(patchNickname).not.toHaveBeenCalled();
  });
});

/* ── [FEAT-20261015-MEMBERDETAIL] the loan rule, from the customer provider ─────────────────
 * Owner 15/10/2026: on loan the admin edits the NAME and the CONTRACT of a customer the
 * partner does not know, and a NICKNAME for everyone — the old system's rule (legacy-api Ticket
 * Manager) · shop-api untouched. The rule comes from `GET /api/customer-provider/member-detail`;
 * "registered" is the provider's own verdict the raw-profile answer carries (`has_member_data`).
 */
const asLoan = () => { answer.rule = LOAN_RULE; answer.fail = false; resetProviderMemberDetail(); };
const asShopapi = () => { answer.rule = null; answer.fail = false; resetProviderMemberDetail(); };
const LOAN_TITLE = 'ข้อมูลที่แอดมินกรอก';

describe('[MEMBERDETAIL] loan — a customer the partner does not know', () => {
  beforeEach(asLoan);
  it('⭐ TARGET — ชื่อเล่น · ชื่อ-สกุล · เบอร์โทร · เลขที่สัญญา', async () => {
    mount(null);
    const card = await openCard(LOAN_TITLE);
    expect(labelsIn(card)).toEqual(['ชื่อเล่น', 'ชื่อ-สกุล', 'เบอร์โทร', 'เลขที่สัญญา']);
    expect(within(card).queryByText('รหัสสมาชิก')).toBeNull();
  });
  it('⭐ OUT — nickname + contract edited ⇒ patchNickname(trimmed) and patchDetail("name|phone|contract")', async () => {
    mount(null, '|0811111111|');
    const card = await openCard(LOAN_TITLE);
    fireEvent.click(within(card).getByTitle('แก้ไข'));
    const [nick, , , contract] = within(card).getAllByRole('textbox');
    fireEvent.change(nick!, { target: { value: '  น้องเอ  ' } });
    fireEvent.change(contract!, { target: { value: 'CT0226-SRI001-0020-01' } });
    fireEvent.click(within(card).getByText('บันทึก'));
    fireEvent.click(within(card).getByText('ยืนยัน'));
    await waitFor(() => expect(patchDetail).toHaveBeenCalledWith(MEMBER, '|0811111111|CT0226-SRI001-0020-01'));
    expect(patchNickname).toHaveBeenCalledWith(MEMBER, 'น้องเอ');
  });
  it('only what changed is written — detail alone ⇒ no nickname call', async () => {
    mount(null, 'ก|0811111111|');
    const card = await openCard(LOAN_TITLE);
    fireEvent.click(within(card).getByTitle('แก้ไข'));
    fireEvent.change(within(card).getAllByRole('textbox')[3]!, { target: { value: 'CT-1' } });
    fireEvent.click(within(card).getByText('บันทึก'));
    fireEvent.click(within(card).getByText('ยืนยัน'));
    await waitFor(() => expect(patchDetail).toHaveBeenCalledWith(MEMBER, 'ก|0811111111|CT-1'));
    expect(patchNickname).not.toHaveBeenCalled();
  });
  it('an emptied nickname is refused on screen (the back end refuses it too) — nothing is written', async () => {
    mount(null);
    const card = await openCard(LOAN_TITLE);
    fireEvent.click(within(card).getByTitle('แก้ไข'));
    fireEvent.change(within(card).getAllByRole('textbox')[0]!, { target: { value: '   ' } });
    fireEvent.click(within(card).getByText('บันทึก'));
    fireEvent.click(within(card).getByText('ยืนยัน'));
    await waitFor(() => expect(within(card).getByText('ชื่อเล่นว่างไม่ได้')).toBeTruthy());
    expect(patchNickname).not.toHaveBeenCalled();
    expect(patchDetail).not.toHaveBeenCalled();
  });
});

describe('[MEMBERDETAIL] loan — a registered customer (the partner knows them)', () => {
  beforeEach(asLoan);
  it('⭐ TARGET — the card stays, nickname only, and says why', async () => {
    expect((ENVELOPES as any).live.has_member_data).toBe(true);
    mount((ENVELOPES as any).live);
    const card = await openCard(LOAN_TITLE);
    expect(labelsIn(card)).toEqual(['ชื่อเล่น']);
    expect(within(card).getByText('ลูกค้าลงทะเบียนแล้ว — ชื่อ เบอร์ และเลขที่สัญญามาจากระบบต้นทาง แก้ได้เฉพาะชื่อเล่น')).toBeTruthy();
  });
  it('⭐ OUT — nickname edited ⇒ patchNickname only; the partner’s data is never overwritten', async () => {
    mount((ENVELOPES as any).live, 'เก่า|0800000000|CT-OLD');
    const card = await openCard(LOAN_TITLE);
    fireEvent.click(within(card).getByTitle('แก้ไข'));
    fireEvent.change(within(card).getAllByRole('textbox')[0]!, { target: { value: 'ลูกค้าประจำ' } });
    fireEvent.click(within(card).getByText('บันทึก'));
    fireEvent.click(within(card).getByText('ยืนยัน'));
    await waitFor(() => expect(patchNickname).toHaveBeenCalledWith(MEMBER, 'ลูกค้าประจำ'));
    expect(patchDetail).not.toHaveBeenCalled();
  });
});

describe('[MEMBERDETAIL] shop-api — the route answers null, or fails ⇒ today’s card', () => {
  it('⭐ PIN — null rule: same labels, same markup snapshot as BEFORE', async () => {
    asShopapi();
    mount(null, 'สมชาย|0811111111|M001');
    const card = await openCard();
    expect(labelsIn(card)).toEqual(['ชื่อ-สกุล', 'เบอร์โทร', 'รหัสสมาชิก']);
    expect(card.outerHTML).toMatchSnapshot();
  });
  it('⭐ PIN — null rule + an shop-api profile ⇒ no card', async () => {
    asShopapi();
    mount(SHOPAPI_PROFILE);
    await waitFor(() => expect(screen.queryByText('กำลังโหลดข้อมูลลูกค้า…')).toBeNull());
    expect(screen.queryByText('ข้อมูลชั่วคราว')).toBeNull();
    expect(screen.queryByText(LOAN_TITLE)).toBeNull();
  });
  it('PIN — the route fails (older back end / 500) ⇒ today’s card', async () => {
    answer.fail = true; resetProviderMemberDetail();
    mount(null);
    const card = await openCard();
    expect(labelsIn(card)).toEqual(['ชื่อ-สกุล', 'เบอร์โทร', 'รหัสสมาชิก']);
  });
});
