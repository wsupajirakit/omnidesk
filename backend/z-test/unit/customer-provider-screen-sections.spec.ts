/**
 * [FEAT-20261018-SCREENSECTIONS] Which dashboard sections a provider hides — one table, the BE decides.
 * ============================================================================
 * Owner 18/10/2026: "ถ้าเป็น loan ซ่อนหัวข้อ Customer Link ด้วย และต้องสามารถแก้ไขเงื่อนไขนี้ หรือ
 * กำหนดได้ว่า api xxxx อะไรให้ซ่อนได้อีก รวมทั้งของที่ซ่อนไปแล้วอย่างการ์ด cust".
 *
 * Before this the screen hid two things by asking for a WORLD (`useProviderWorldOff`), and the
 * knowledge "this section belongs to that world" lived only in the FE. Now one BE table names
 * every hideable section and its world; a provider can also name extra sections to hide.
 * The FE asks per section through `GET /api/customer-provider/features` → `data.hidden`.
 *
 * TARGET — loan hides the three sections its silenced worlds own.
 * PIN    — shop-api / unbound hides nothing; `silenced` is unchanged.
 */
import {
  CustomerProviderController,
  DEFAULT_CUSTOMER_PROVIDER,
  SCREEN_SECTIONS,
  bindActiveProvider,
  buildCustomerProviderRegistry,
  providerFeaturesOff,
  providerHiddenScreenSections,
  resetActiveProvider,
  resolveHiddenScreenSections,
  resolveProviderFeatures,
} from '@/modules/customer-provider';

const shopapiV1Provider = DEFAULT_CUSTOMER_PROVIDER;
const loanV1Provider = buildCustomerProviderRegistry().get('loan_v1')!;

afterEach(() => resetActiveProvider());

describe('[SCREENSECTIONS] the table', () => {
  it('names every hideable section, each with its world', () => {
    expect(SCREEN_SECTIONS).toEqual({
      'hook-form.site-rules': 'siteRules',
      'hook-form.customer-helper-card': 'register',
      'hook-form.customer-link': 'register',
      /* [FEAT-20261018-CLOSEFOLLOW] the close-case dialog's follow-up sections */
      'ticket-close.follow-registration': 'followUp',
      'ticket-close.follow-deposit': 'notice',
      'ticket-close.follow-withdraw': 'notice',
    });
  });
});

describe("[SCREENSECTIONS] resolveHiddenScreenSections — worlds AND the provider's own list", () => {
  const ALL_ON = resolveProviderFeatures(undefined);

  it('⭐ a silenced world hides every section it owns', () => {
    const noRegister = resolveProviderFeatures({ register: false });
    expect(resolveHiddenScreenSections(noRegister, undefined)).toEqual([
      'hook-form.customer-helper-card',
      'hook-form.customer-link',
    ]);
  });
  it('⭐ a provider can hide a section while its world stays on ("กำหนดได้ว่า api xxxx อะไรให้ซ่อน")', () => {
    expect(
      resolveHiddenScreenSections(ALL_ON, ['hook-form.customer-link']),
    ).toEqual(['hook-form.customer-link']);
  });
  it('🔴 PIN: all worlds on, nothing named ⇒ nothing hidden', () => {
    expect(resolveHiddenScreenSections(ALL_ON, undefined)).toEqual([]);
    expect(resolveHiddenScreenSections(ALL_ON, [])).toEqual([]);
  });
  it('a name that is not in the table hides nothing (a typo cannot hide an unknown section)', () => {
    expect(
      resolveHiddenScreenSections(ALL_ON, ['hook-form.nope' as never]),
    ).toEqual([]);
  });
});

describe('[SCREENSECTIONS] bound provider + GET /api/customer-provider/features', () => {
  const ctl = new CustomerProviderController();

  it('⭐ TARGET — loan_v1 hides Site Rules, the customer-helper card, Customer Link and the close-case follow-ups', () => {
    bindActiveProvider(loanV1Provider);
    expect(providerHiddenScreenSections()).toEqual([
      'hook-form.site-rules',
      'hook-form.customer-helper-card',
      'hook-form.customer-link',
      'ticket-close.follow-registration',
      'ticket-close.follow-deposit',
      'ticket-close.follow-withdraw',
    ]);
    expect(ctl.features()).toEqual({
      success: true,
      data: {
        silenced: providerFeaturesOff(),
        hidden: providerHiddenScreenSections(),
      },
    });
  });
  it('🔴 PIN — shop-api hides nothing and silences nothing', () => {
    bindActiveProvider(shopapiV1Provider);
    expect(ctl.features()).toEqual({
      success: true,
      data: { silenced: [], hidden: [] },
    });
  });
  it('🔴 PIN — unbound behaves as shop-api, and reset clears a bound list', () => {
    bindActiveProvider(loanV1Provider);
    resetActiveProvider();
    expect(providerHiddenScreenSections()).toEqual([]);
  });
});
