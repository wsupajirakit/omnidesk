/**
 * [FEAT-20260907-LOANV1PROVIDER] `loan_v1` (installment-loan shape) — WHERE its values live. Data, no code.
 *
 * 📖 PLAN: `docs/v2.md` (dev checkout) §12.4 / §12.0.2 / §12.0.3.
 *
 * Every path below was proven against the REAL upstream twice: the archived
 * prod blob (omnidesk-console-custom fixture, masked) and a live fire of
 * `api/v1/customer/{{line_user_id}}` on the demo host (2026-09-06, http 200).
 * Nothing here is read off a schema or guessed from a name.
 *
 * ⚠️ VALUE SHAPES DIFFER BY SOURCE AND BOTH ARE REAL: the stored prod blob
 * carries numbers as STRINGS ("23460"); the live API answers NUMBERS (23460).
 * Paths pass values through untouched — no arithmetic, no parsing — so both
 * shapes reach the card as-is, exactly like the panel-spec this replaces.
 *
 * ⚠️ `device_imei` / `device_serial` are DELIBERATELY absent: device
 * identifiers must never reach a screen every admin can open (owner rule,
 * carried from the dev_custom lane). Do not add them with the other fields.
 *
 * The blob (from `raw_profile_data`, i.e. the CUSTOMER_PROFILE response):
 *   { success, status_code, message, timestamp,
 *     data: { customer{4} · contract{5} · product{6→4 used} · installment{12} } }
 *
 * revert: delete `providers/loan-v1/` and its line in `provider-entries.ts`.
 */
import type { PathDeclaration } from '../engine/resolve-fields';

export const LOAN_V1_PATHS: PathDeclaration = {
  /* The container is `data` — the blob root carries only envelope keys. */
  rootPaths: ['data'],

  sectionPaths: {
    /* 🔴 `profile` is the MANDATORY root marker (`resolveSections` throws
       without it): a candidate container with no `customer` object is not a
       loan-shape customer. It points at the SAME object as `customer` below —
       the duplicate is deliberate, so field paths can read the natural
       `customer.*` spelling while the marker keeps its required name. */
    profile: ['customer'],
    customer: ['customer'],
    contract: ['contract'],
    product: ['product'],
    installment: ['installment'],
  },

  /* One lookup per row of the proven 5-section / 23-row panel (v2.md §12.0.3).
     First path segment = the SECTION name above, exactly as shopapi-v1 does. */
  fieldPaths: {
    /* ── ข้อมูลลูกค้า ── */
    loanCustName: { paths: ['customer.customer_name'] },
    loanCustTel: { paths: ['customer.customer_tel'] },
    loanCustNumber: { paths: ['customer.customer_number'] },
    /* ── สัญญา ── */
    loanContractNo: { paths: ['contract.contract_number'] },
    loanContractStatus: { paths: ['contract.contract_status'] },
    loanContractTotal: { paths: ['contract.contract_total_amount'] },
    loanDownPayment: { paths: ['contract.down_payment'] },
    loanPrincipal: { paths: ['contract.principal_amount'] },
    /* ── เครื่อง ── */
    loanDeviceModel: { paths: ['product.device_model'] },
    loanDeviceType: { paths: ['product.device_type'] },
    loanLocked: { paths: ['product.is_locked'] },
    loanWarrantyExpire: { paths: ['product.warranty_expire_date'] },
    /* ── งวดปัจจุบัน ── */
    loanCurrentTerm: { paths: ['installment.current_term'] },
    loanTotalTerms: { paths: ['installment.total_terms'] },
    loanInstallmentAmount: { paths: ['installment.installment_amount'] },
    loanDueDate: { paths: ['installment.due_date'] },
    loanPaymentStatus: { paths: ['installment.payment_status'] },
    loanLastPaymentDate: { paths: ['installment.last_payment_date'] },
    /* ── ค้างชำระ ── */
    loanOverdueDays: { paths: ['installment.overdue_days'] },
    /* 🔴 total_due_amount = THIS TERM · remaining_balance = WHOLE CONTRACT.
       Different numbers; they have been swapped before in the dyntag line.
       The labels in build-view.ts say which is which — keep them apart. */
    loanTotalDue: { paths: ['installment.total_due_amount'] },
    loanFine: { paths: ['installment.fine_amount'] },
    loanUnlockFee: { paths: ['installment.unlock_fee'] },
    loanRemainingBalance: { paths: ['installment.remaining_balance'] },
  },
};
