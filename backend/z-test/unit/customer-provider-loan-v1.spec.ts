/**
 * [FEAT-20260907-LOANV1PROVIDER] loan_v1 provider — values, view, and INERTNESS.
 * ============================================================================
 * Three claims, ranked by what they protect:
 *   1. 🔴 INERTNESS — adding this entry moves NOTHING for shop-api: the default
 *      is still the shopapi_v1 object BY IDENTITY, and the registry still
 *      resolves it. This is iron rules 1/5 of docs/v2.md as a test.
 *   2. ⭐ VALUES — the real blob (both real shapes: prod strings, live
 *      numbers) comes out field-for-field through the SAME composeFields the
 *      runtime uses. No hand-rolled assembly, so green here is green there.
 *   3. VIEW — 5 loan_* kv sections, the proven 23-row layout, absent rows
 *      dropped (warranty null), zeros KEPT, imei/serial nowhere, and the
 *      whole thing survives validateView untouched.
 */
import { validateView } from '@/modules/customer-provider/providers/engine/validate-view';
import { composeFields } from '@/modules/customer-provider/providers/engine/resolve-fields';
import {
  buildCustomerProviderRegistry,
  CUSTOMER_PROVIDER_ENTRIES,
  DEFAULT_CUSTOMER_PROVIDER,
} from '@/modules/customer-provider/providers/provider-entries';
import { loanV1Provider } from '@/modules/customer-provider/providers/loan-v1';
import type { LoanV1Fields } from '@/modules/customer-provider/providers/loan-v1/derive-fields';
import { shopapiV1Provider } from '@/modules/customer-provider/providers/shopapi-v1';
import {
  LOAN_V1_BLOB_LIVE,
  LOAN_V1_BLOB_PROD,
} from '../fixtures/loan-v1-profile';

describe('[LOANV1PROVIDER] 🔴 inertness — shop-api does not move', () => {
  it('the default is still the shopapi_v1 provider, by IDENTITY', () => {
    expect(DEFAULT_CUSTOMER_PROVIDER).toBe(shopapiV1Provider);
  });

  it('the registry resolves both names, from the same entry list', () => {
    const reg = buildCustomerProviderRegistry(CUSTOMER_PROVIDER_ENTRIES);
    expect(reg.get('shopapi_v1')).toBe(shopapiV1Provider);
    expect(reg.get('loan_v1')).toBe(loanV1Provider);
  });

  it('loan_v1 declares NO tier and hides both tier controls', () => {
    expect(loanV1Provider.tierPaths).toEqual([]);
    expect(loanV1Provider.showTierBadge).toBe(false);
    expect(loanV1Provider.showTierFilter).toBe(false);
  });

  it('[PROVCONDS] loan declares its own conditions; shopapi declares NEITHER', () => {
    /* shopapi stamps nothing ⇒ the dashboard's legacy rules decide, byte-for-byte
       today — that IS the shop-api guarantee for these two switches. */
    expect(shopapiV1Provider.hasMemberData).toBeUndefined();
    expect(shopapiV1Provider.showWalletpayCard).toBeUndefined();
    expect(shopapiV1Provider.showFollowUps).toBeUndefined();
    expect(shopapiV1Provider.showRegisterAction).toBeUndefined();
    /* loan: WalletPay/follow-ups/register are shop-api's world;
       linked-marker = data.customer present. */
    expect(loanV1Provider.showWalletpayCard).toBe(false);
    expect(loanV1Provider.showFollowUps).toBe(false);
    expect(loanV1Provider.showRegisterAction).toBe(false);
    expect(loanV1Provider.hasMemberData?.(LOAN_V1_BLOB_LIVE)).toBe(true);
    expect(loanV1Provider.hasMemberData?.({ data: { finance: {} } })).toBe(
      false,
    );
    expect(loanV1Provider.hasMemberData?.(null)).toBe(false);
  });
});

describe('[LOANV1PROVIDER] ⭐ values — the real blob, both real shapes', () => {
  it('prod-shape blob (numbers as strings) resolves field-for-field', () => {
    const f = composeFields(loanV1Provider, LOAN_V1_BLOB_PROD) as LoanV1Fields;
    expect(f.loanCustNumber).toBe('SRI001-00003');
    expect(f.loanContractNo).toBe('CT0226-SRI001-0020-01');
    expect(f.loanContractTotal).toBe('23460'); // string passthrough, untouched
    expect(f.loanDeviceModel).toBe('iPad Gen11 A16 WIFI 128 GB ชมพู');
    expect(f.loanLocked).toBe(false);
    /* Upstream sends warranty_expire_date: null, but the engine's readChain is
       `??` over paths — null/undefined fall through, exhaustion = undefined
       (engine/read-path.ts:36-42; flow doc §5.1 "Missing ⇒ undefined, never
       null"). So the field arrives as undefined, and asserting null here was
       asserting a value the engine never produces. */
    expect(f.loanWarrantyExpire).toBeUndefined();
    expect(f.loanCurrentTerm).toBe('2');
    expect(f.loanTotalDue).toBe('1955');
    expect(f.loanFine).toBe('0'); // zero is an answer, not an absence
    expect(f.loanRemainingBalance).toBe('21505');
  });

  it('live-shape blob (real numbers) resolves field-for-field', () => {
    const f = composeFields(loanV1Provider, LOAN_V1_BLOB_LIVE) as LoanV1Fields;
    expect(f.loanContractTotal).toBe(23460); // number passthrough, untouched
    expect(f.loanCurrentTerm).toBe(7);
    expect(f.loanOverdueDays).toBe(1);
    expect(f.loanFine).toBe(0);
    expect(f.loanDueDate).toBe('2026-09-05');
  });

  it('the shop-api half of the vocabulary is honestly empty', () => {
    const f = composeFields(loanV1Provider, LOAN_V1_BLOB_LIVE);
    expect(f.depRows).toEqual([]);
    expect(f.promoToBreakdown).toEqual([]);
    expect(f.finAutoDep).toBe(false);
    expect(f.promoName).toBeUndefined();
  });
});

describe('[LOANV1PROVIDER] view — 5 loan_* kv sections through the runtime pipeline', () => {
  /* validateView returns ViewValidation {view, problems}, NOT the view itself
     (engine/validate-view.ts:158-160,96-101). Destructure — and assert the
     guard refused NOTHING: an empty `problems` proves every loan_* section
     passed the envelope schema, which is a claim of its own, not plumbing. */
  const viewOf = (blob: unknown) => {
    const { view, problems } = validateView(
      loanV1Provider.buildView(composeFields(loanV1Provider, blob)),
    );
    expect(problems).toEqual([]);
    return view;
  };

  it('emits the proven layout and validateView drops nothing', () => {
    const view = viewOf(LOAN_V1_BLOB_LIVE);
    expect(view.sections.map((s) => s.id)).toEqual([
      'loan_customer',
      'loan_contract',
      'loan_product',
      'loan_term',
      'loan_overdue',
    ]);
    expect(view.sections.every((s) => s.type === 'kv')).toBe(true);
    /* none of the ids collide with the dashboard's hand-built cards, and none
       carry a group — the all-or-nothing group rule can never hide them */
    expect(view.sections.every((s) => s.group === undefined)).toBe(true);
  });

  it('absent rows are dropped, zeros are kept — 22 rows on the real blob', () => {
    const view = viewOf(LOAN_V1_BLOB_PROD);
    const rows = view.sections.flatMap((s) => [...(s.rows ?? [])]);
    /* 23 declared rows − warranty_expire_date (null upstream) = 22 */
    expect(rows).toHaveLength(22);
    expect(rows.some((r) => r.key === 'loanWarrantyExpire')).toBe(false);
    const fine = rows.find((r) => r.key === 'loanFine');
    expect(fine?.value).toBe('0'); // "0" rendered, never treated as blank
  });

  it('the two-numbers trap stays labelled apart (งวดนี้ vs ทั้งสัญญา)', () => {
    const view = viewOf(LOAN_V1_BLOB_LIVE);
    const rows = view.sections.flatMap((s) => [...(s.rows ?? [])]);
    expect(rows.find((r) => r.key === 'loanTotalDue')?.label).toBe(
      'ต้องชำระงวดนี้',
    );
    expect(rows.find((r) => r.key === 'loanRemainingBalance')?.label).toBe(
      'คงเหลือทั้งสัญญา',
    );
  });

  it('🔴 device identifiers appear NOWHERE in the emitted view', () => {
    const text = JSON.stringify(viewOf(LOAN_V1_BLOB_LIVE));
    expect(text).not.toMatch(/imei/i);
    expect(text).not.toMatch(/serial/i);
  });

  it('a blob with no customer container is no customer — sections empty-safe', () => {
    /* resolveSections keys the root on the profile marker; a foreign blob must
       yield an empty view, never a throw (the panel shows nothing). */
    const view = viewOf({ data: { finance: { credit_balance: 1 } } });
    expect(view.sections).toEqual([]);
  });

  it('boolean lock renders as Thai text; non-boolean passes through', () => {
    const view = viewOf(LOAN_V1_BLOB_LIVE);
    const rows = view.sections.flatMap((s) => [...(s.rows ?? [])]);
    expect(rows.find((r) => r.key === 'loanLocked')?.value).toBe('ไม่ล็อก');
  });
});
