/**
 * [FEAT-20260907-LOANV1PROVIDER] `loan_v1` (installment-loan shape) — the 5 proven cards, as `view`.
 *
 * The layout is the dev_custom lane's panel, proven on a real customer and a
 * live fire (docs/v2.md §12.0.3): 5 sections / 23 rows, all `kv`. Section ids
 * are `loan_*` — verified against the dashboard's `panelOwned.ts` owned list
 * (no collision) and carry NO `group`, so the group all-or-nothing rule can
 * never hide them behind an shop-api card. They render through the dashboard's
 * generic renderers: **zero front-end files** is the whole point.
 *
 * Row rule carried from the lane: a row whose value is absent is NOT emitted
 * (`warranty_expire_date` is null on the real upstream) — but `0` and `"0"`
 * are real answers (`fine_amount: 0`) and always render. ค่า 0 ไม่ใช่ค่าว่าง
 *
 * 🔴 PURE: fields in, description out. No fetch, no Mongo, no request.
 * revert: delete `providers/loan-v1/` and its registry line.
 */
import type { LoanV1Fields } from './derive-fields';
import type { CustomerFields } from '../shopapi-v1/derive-fields';
import type { CustomerView, KvRow, Section } from '../engine/view.types';

/** Absent = undefined/null/'' only. Zero — number or string — is a value. */
const present = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== '';

/** Build kv rows, dropping absent values (the lane's proven empty-row rule). */
const kvRows = (
  rows: Array<{ key: string; label: string; value: unknown }>,
): KvRow[] => rows.filter((r) => present(r.value));

export function buildLoanV1View(fields: CustomerFields): CustomerView {
  /* Narrowing back what deriveLoanV1Fields widened — both casts live in
     this folder only (see derive-fields.ts for why the port forces this). */
  const f = fields as LoanV1Fields;

  const candidates: Section[] = [
    {
      id: 'loan_customer',
      type: 'kv',
      label: 'ข้อมูลลูกค้า',
      rows: kvRows([
        { key: 'loanCustName', label: 'ชื่อลูกค้า', value: f.loanCustName },
        { key: 'loanCustTel', label: 'เบอร์โทร', value: f.loanCustTel },
        { key: 'loanCustNumber', label: 'รหัสลูกค้า', value: f.loanCustNumber },
      ]),
    },
    {
      id: 'loan_contract',
      type: 'kv',
      label: 'สัญญา',
      rows: kvRows([
        {
          key: 'loanContractNo',
          label: 'เลขที่สัญญา',
          value: f.loanContractNo,
        },
        {
          key: 'loanContractStatus',
          label: 'สถานะสัญญา',
          value: f.loanContractStatus,
        },
        {
          key: 'loanContractTotal',
          label: 'ยอดจัดทั้งสัญญา',
          value: f.loanContractTotal,
        },
        {
          key: 'loanDownPayment',
          label: 'เงินดาวน์',
          value: f.loanDownPayment,
        },
        { key: 'loanPrincipal', label: 'เงินต้น', value: f.loanPrincipal },
      ]),
    },
    {
      id: 'loan_product',
      type: 'kv',
      label: 'เครื่อง',
      rows: kvRows([
        { key: 'loanDeviceModel', label: 'รุ่น', value: f.loanDeviceModel },
        { key: 'loanDeviceType', label: 'ประเภท', value: f.loanDeviceType },
        {
          key: 'loanLocked',
          label: 'ล็อกเครื่อง',
          /* The one transform in this file: a boolean would render as the
             English word; the card speaks Thai. Non-boolean upstream values
             pass through untouched rather than being guessed at. */
          value:
            typeof f.loanLocked === 'boolean'
              ? f.loanLocked
                ? 'ล็อกอยู่'
                : 'ไม่ล็อก'
              : f.loanLocked,
        },
        {
          key: 'loanWarrantyExpire',
          label: 'ประกันหมดอายุ',
          value: f.loanWarrantyExpire,
        },
      ]),
    },
    {
      id: 'loan_term',
      type: 'kv',
      label: 'งวดปัจจุบัน',
      rows: kvRows([
        { key: 'loanCurrentTerm', label: 'งวดที่', value: f.loanCurrentTerm },
        { key: 'loanTotalTerms', label: 'จากทั้งหมด', value: f.loanTotalTerms },
        {
          key: 'loanInstallmentAmount',
          label: 'ค่างวด',
          value: f.loanInstallmentAmount,
        },
        { key: 'loanDueDate', label: 'ครบกำหนด', value: f.loanDueDate },
        {
          key: 'loanPaymentStatus',
          label: 'สถานะชำระ',
          value: f.loanPaymentStatus,
        },
        {
          key: 'loanLastPaymentDate',
          label: 'ชำระล่าสุด',
          value: f.loanLastPaymentDate,
        },
      ]),
    },
    {
      id: 'loan_overdue',
      type: 'kv',
      label: 'ค้างชำระ',
      rows: kvRows([
        {
          key: 'loanOverdueDays',
          label: 'เกินกำหนด (วัน)',
          value: f.loanOverdueDays,
        },
        /* 🔴 "งวดนี้" vs "ทั้งสัญญา" — two different numbers that have been
           swapped before; the labels are the guard (v2.md §12.0.3). */
        { key: 'loanTotalDue', label: 'ต้องชำระงวดนี้', value: f.loanTotalDue },
        { key: 'loanFine', label: 'ค่าปรับ', value: f.loanFine },
        { key: 'loanUnlockFee', label: 'ค่าปลดล็อก', value: f.loanUnlockFee },
        {
          key: 'loanRemainingBalance',
          label: 'คงเหลือทั้งสัญญา',
          value: f.loanRemainingBalance,
        },
      ]),
    },
  ];

  /* A section with every row absent is dropped whole — an empty box titled
     "สัญญา" tells an admin nothing and the validator dislikes hollow sections. */
  return { sections: candidates.filter((s) => (s.rows?.length ?? 0) > 0) };
}
