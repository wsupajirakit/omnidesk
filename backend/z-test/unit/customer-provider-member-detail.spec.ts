/**
 * [FEAT-20261015-MEMBERDETAIL] How the panel's hand-typed customer card behaves on a site —
 * declared by the customer provider, read by the screen through its own route.
 *
 * Owner 15/10/2026: on loan the admin must be able to edit the NAME and the CONTRACT of a
 * customer the partner does not know, plus a NICKNAME for everyone — the old system's rule
 * (legacy-api Ticket Manager: nickname always; name / phone / contract only while unregistered)
 * — "ห้ามกระทบ x api".
 *
 * Why a route and not a stamp on the raw-profile answer: for an unregistered customer the
 * screen's raw-profile reader returns null (no blob), so a stamp would never reach the card
 * in exactly the case it is for.
 *
 * TARGET: loan_v1 declares the rule · the route answers it in wire shape.
 * PIN (shop-api): no declaration ⇒ the route answers null ⇒ the card stays today's.
 */
import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  CustomerProviderController,
  providerMemberDetail,
  resetActiveProvider,
} from '@/modules/customer-provider';

const byName = (n: string) => {
  const p = CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n);
  if (!p) throw new Error('no provider ' + n);
  return p;
};
const loanV1Provider = byName('loan_v1');
const shopapiV1Provider = byName('shopapi_v1');

afterEach(() => resetActiveProvider());

describe('[MEMBERDETAIL] the declaration', () => {
  it('⭐ TARGET — loan_v1: third slot is the contract · nickname for all · detail only while unregistered', () => {
    bindActiveProvider(loanV1Provider);
    expect(providerMemberDetail()).toEqual({
      thirdSlot: 'contract',
      nickname: true,
      detailOnlyUnregistered: true,
    });
  });
  it('⭐ PIN — shop-api declares nothing ⇒ null; unbound ⇒ null', () => {
    bindActiveProvider(shopapiV1Provider);
    expect(providerMemberDetail()).toBeNull();
    resetActiveProvider();
    expect(providerMemberDetail()).toBeNull();
  });
  it('PIN — reset after loan_v1 forgets the rule (nothing leaks into the next binding)', () => {
    bindActiveProvider(loanV1Provider);
    resetActiveProvider();
    expect(providerMemberDetail()).toBeNull();
  });
});

describe('[MEMBERDETAIL] GET /api/customer-provider/member-detail', () => {
  const ctl = new CustomerProviderController();
  it('⭐ TARGET — loan_v1 ⇒ the rule, snake_case on the wire', () => {
    bindActiveProvider(loanV1Provider);
    expect(ctl.memberDetail()).toEqual({
      success: true,
      data: {
        member_detail: {
          third_slot: 'contract',
          nickname: true,
          detail_only_unregistered: true,
        },
      },
    });
  });
  it('⭐ PIN — shop-api ⇒ null', () => {
    bindActiveProvider(shopapiV1Provider);
    expect(ctl.memberDetail()).toEqual({
      success: true,
      data: { member_detail: null },
    });
  });
  it('PIN — the ticket-categories route is untouched by the new one', () => {
    bindActiveProvider(shopapiV1Provider);
    expect(ctl.ticketCategories()).toEqual({
      success: true,
      data: { ticket_categories: null },
    });
  });
});
