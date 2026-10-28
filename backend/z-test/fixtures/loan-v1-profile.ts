/**
 * [FEAT-20260907-LOANV1PROVIDER] loan_v1 (installment-loan shape) profile blobs — REAL, masked, two shapes.
 *
 * Both are derived from the real upstream, never hand-invented (a fixture you
 * invent always agrees with the spec you invent):
 *
 * 1. `LOAN_V1_BLOB_PROD` — the stored `raw_profile_data` of one real prod
 *    customer (carried from the dev_custom archive's FE fixture). Numbers
 *    arrive as STRINGS ("23460"). Masked: customer_name/customer_tel replaced;
 *    device_imei/device_serial DELETED (device identifiers stay out of the
 *    repo — owner rule).
 * 2. `LOAN_V1_BLOB_LIVE` — the live demo answer captured 2026-09-06
 *    (docs/v2.md §12.0.4b, http 200). Numbers arrive as NUMBERS. Same mask
 *    rule applied (name/tel replaced, imei/serial deleted).
 *
 * The provider must serve BOTH shapes untouched — that is what the value spec
 * asserts. Money/term/date figures are kept real because they are what the
 * tests measure.
 */

export const LOAN_V1_BLOB_PROD = {
  success: true,
  status_code: '200',
  message: 'Customer profile retrieved successfully',
  timestamp: '2026-04-07 21:35:02',
  data: {
    customer: {
      customer_id: '20',
      customer_number: 'SRI001-00003',
      customer_name: 'ทดสอบ ระบบ',
      customer_tel: '0640000000',
    },
    contract: {
      contract_number: 'CT0226-SRI001-0020-01',
      contract_status: 'Active',
      contract_total_amount: '23460',
      down_payment: '3225',
      principal_amount: '9675',
    },
    product: {
      device_model: 'iPad Gen11 A16 WIFI 128 GB ชมพู',
      is_locked: false,
      device_type: 'General',
      warranty_expire_date: null,
    },
    installment: {
      total_terms: '12',
      current_term: '2',
      installment_amount: '1955',
      payment_status: 'Pending',
      due_date: '2026-04-05',
      overdue_days: '2',
      fine_amount: '0',
      unlock_fee: '0',
      total_due_amount: '1955',
      remaining_balance: '21505',
      last_payment_date: '2026-02-27 06:47:00',
      last_payment_amount: '1955',
    },
  },
} as const;

export const LOAN_V1_BLOB_LIVE = {
  success: true,
  status_code: 200,
  message: 'Customer profile retrieved successfully',
  timestamp: '2026-09-06 22:29:59',
  data: {
    customer: {
      customer_id: 20,
      customer_number: 'SRI001-00003',
      customer_name: 'ทดสอบ ระบบ',
      customer_tel: '0640000000',
    },
    contract: {
      contract_number: 'CT0226-SRI001-0020-01',
      contract_status: 'Active',
      contract_total_amount: 23460,
      down_payment: 3225,
      principal_amount: 9675,
    },
    product: {
      device_model: 'iPad Gen11 A16 WIFI 128 GB ชมพู',
      is_locked: false,
      device_type: 'General',
      warranty_expire_date: null,
    },
    installment: {
      total_terms: 12,
      current_term: 7,
      installment_amount: 1955,
      payment_status: 'Pending',
      due_date: '2026-09-05',
      overdue_days: 1,
      fine_amount: 0,
      unlock_fee: 0,
      total_due_amount: 1955,
      remaining_balance: 21505,
      last_payment_date: '2026-02-27 06:47:00',
      last_payment_amount: 1955,
    },
  },
} as const;
