/**
 * [FEAT-20260907-LOANV1PROVIDER] `loan_v1` (installment-loan shape) — the port's fields, honestly empty.
 *
 * The port requires `deriveFields` to return `CustomerFields` — the shared
 * vocabulary whose names are shop-api's 26 values (deposits, promos, coins…).
 * the installment-loan shape HAS none of those. So this
 * provider returns a SUBTYPE: every shop-api field at its empty value, plus the
 * 23 `bp*` values its own view reads. TypeScript accepts the subtype where
 * `CustomerFields` is expected, and `build-view.ts` narrows it back — the
 * widening and the narrowing both live inside this folder, invisible outside.
 *
 * 🔴 PURE, like every provider hook: no fetch, no Mongo, no reshaping of the
 * stored blob. It reads only what the engine already resolved.
 *
 * revert: delete `providers/loan-v1/` and its registry line.
 */
import type { CustomerFields } from '../shopapi-v1/derive-fields';
import type { Sections } from '../engine/resolve-fields';

/** The shop-api vocabulary with nobody home — arrays empty, switches off. */
const EMPTY_SHOPAPI_FIELDS: CustomerFields = {
  depRows: [],
  wdRows: [],
  finCredit: undefined,
  finWallet: undefined,
  finDepTotal: undefined,
  finWdTotal: undefined,
  finAutoDep: false,
  finAutoWd: false,
  cbPending: undefined,
  cbClaimed: undefined,
  cbHistory: [],
  rfPending: undefined,
  rfClaimed: undefined,
  rfHistory: [],
  rfFriends: undefined,
  acCoinBal: undefined,
  acCoinHistory: [],
  acPointRoundHistory: [],
  promoCurrent: undefined,
  promoName: undefined,
  promoToDone: undefined,
  promoToReq: undefined,
  promoToUnit: undefined,
  promoToPercent: undefined,
  promoOutstanding: undefined,
  promoProducts: [],
  promoToBreakdown: [],
  promoOsBreakdown: [],
};

/** The 23 values the loan_v1 view draws — one per proven panel row. */
export interface LoanV1Fields extends CustomerFields {
  loanCustName: unknown;
  loanCustTel: unknown;
  loanCustNumber: unknown;
  loanContractNo: unknown;
  loanContractStatus: unknown;
  loanContractTotal: unknown;
  loanDownPayment: unknown;
  loanPrincipal: unknown;
  loanDeviceModel: unknown;
  loanDeviceType: unknown;
  loanLocked: unknown;
  loanWarrantyExpire: unknown;
  loanCurrentTerm: unknown;
  loanTotalTerms: unknown;
  loanInstallmentAmount: unknown;
  loanDueDate: unknown;
  loanPaymentStatus: unknown;
  loanLastPaymentDate: unknown;
  loanOverdueDays: unknown;
  loanTotalDue: unknown;
  loanFine: unknown;
  loanUnlockFee: unknown;
  loanRemainingBalance: unknown;
}

/**
 * Every `bp*` value is a plain lookup the path table already answered — zero
 * algorithms. (`sections` is part of the port signature; this shape has no rule
 * a path cannot express, which is the 80% case §5.1 of the flow doc promises.)
 */
export function deriveLoanV1Fields(
  _sections: Sections,
  resolved: Record<string, unknown>,
): LoanV1Fields {
  return {
    ...EMPTY_SHOPAPI_FIELDS,
    loanCustName: resolved['loanCustName'],
    loanCustTel: resolved['loanCustTel'],
    loanCustNumber: resolved['loanCustNumber'],
    loanContractNo: resolved['loanContractNo'],
    loanContractStatus: resolved['loanContractStatus'],
    loanContractTotal: resolved['loanContractTotal'],
    loanDownPayment: resolved['loanDownPayment'],
    loanPrincipal: resolved['loanPrincipal'],
    loanDeviceModel: resolved['loanDeviceModel'],
    loanDeviceType: resolved['loanDeviceType'],
    loanLocked: resolved['loanLocked'],
    loanWarrantyExpire: resolved['loanWarrantyExpire'],
    loanCurrentTerm: resolved['loanCurrentTerm'],
    loanTotalTerms: resolved['loanTotalTerms'],
    loanInstallmentAmount: resolved['loanInstallmentAmount'],
    loanDueDate: resolved['loanDueDate'],
    loanPaymentStatus: resolved['loanPaymentStatus'],
    loanLastPaymentDate: resolved['loanLastPaymentDate'],
    loanOverdueDays: resolved['loanOverdueDays'],
    loanTotalDue: resolved['loanTotalDue'],
    loanFine: resolved['loanFine'],
    loanUnlockFee: resolved['loanUnlockFee'],
    loanRemainingBalance: resolved['loanRemainingBalance'],
  };
}
