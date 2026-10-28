/**
 * [FEAT-20261014-BASETAGS] The six legacy `[[[name]]]` markers on the loan site — EDIT HERE.
 *
 * Old prompts (legacy-console) write `[[[total_due_amount]]]` and friends. The old system read
 * them from its literal `Path : …` keys; a custom-tool hook keys its answers by ENDPOINT KEY,
 * so on this site every marker came out empty. This table says, per marker, which endpoint
 * (`sub_type` = the tool's endpoint key) and which path (`value`) it reads — the same two
 * fields a dynamic tag has, resolved by the same engine, so a formula works too
 * (`a - b`, `+ - * /`, one operator).
 *
 * To change what a marker reads: edit its line. To add a marker: add a line (the name is
 * matched as `[[[name]]]`). Paths must exist in the partner's REAL answer, spelled as the
 * answer spells them — `z-test/fixtures/loan-v1-endpoints.ts` holds it.
 * A marker whose value is not found keeps legacy's answer (usually '').
 *
 * Only this provider declares a table; shop-api declares none and is unchanged.
 */
import type { ProviderBaseTags } from '../../features/provider-features';

export const LOAN_V1_BASE_TAGS: ProviderBaseTags = {
  /* ยอดที่ต้องจ่ายงวดนี้ (งวดปัจจุบัน — ไม่ใช่ยอดคงเหลือทั้งสัญญา) */
  total_due_amount: {
    sub_type: 'CUSTOMER_PROFILE',
    value: 'data.installment.total_due_amount',
  },
  /* วันครบกำหนดงวดนี้ */
  ins_due_date: {
    sub_type: 'CUSTOMER_PROFILE',
    value: 'data.installment.due_date',
  },
  due_date: {
    sub_type: 'CUSTOMER_PROFILE',
    value: 'data.installment.due_date',
  },
  /* งวดที่ (เช่น "2/12") */
  ins_number: {
    sub_type: 'INSTALLMENT_CURRENT',
    value: 'data.installment.number',
  },
  /* ยอดค้างชำระยกมา */
  ins_current_amount: {
    sub_type: 'INSTALLMENT_CURRENT',
    value: 'data.installment.current_amount',
  },
  /* งวดที่เหลือ = งวดทั้งหมด - งวดปัจจุบัน (ระบบเก่าอ่าน `Total_terms` ซึ่งไม่มีในคำตอบจริง) */
  Total_terms_remain: {
    sub_type: 'CUSTOMER_PROFILE',
    value: 'data.installment.total_terms - data.installment.current_term',
  },
};
