/**
 * [FIX-20261019-TAGDETAIL] The loan tags' descriptions say what their path really holds.
 * ============================================================================
 * Owner 19/10/2026: "บางตัวมีคำอธิบายไม่ตรงกับ path ที่อ่านจริง = แก้ไขคำอธิบาย · แก้แค่ detail".
 * Only `detail` changes — tag name, `sub_type` and `value` are pinned below, untouched.
 *
 * The meaning is read from the partner's REAL answers, not from the old labels:
 *   · `z-test/fixtures/loan-v1-endpoints.ts` (captured, masked) and three distinct live
 *     INSTALLMENT_CURRENT answers in the scratch DB's webhook_logs (8/12 not yet due, 11/12 and
 *     3/12 overdue) all satisfy  amount = current_amount + remain_amount + mulct_amount + locked_amount.
 *   · 8/12: balance_total 21,505 = remain 11,730 (instalments 2–7 unpaid) + current 1,955 (this
 *     instalment) + 7,820 (9–12 not due) ⇒ remain_amount = carried-over arrears, current_amount =
 *     this instalment, amount = everything payable now.
 *   · profile: customer_number = "CUST-…" (contract number is a different field), due_date is
 *     ISO "2026-09-05", total_terms = 12, overdue_days = 2.
 */
import { LOAN_V1_SEED_BUNDLE } from '@/cli/custom-tool-seed/bundles/loan-v1.bundle';

import { LOAN_V1_ENDPOINTS } from '../fixtures/loan-v1-endpoints';

const tags = LOAN_V1_SEED_BUNDLE.tags ?? [];
const byName = (n: string) => tags.find((t) => t.tag === n)!;

describe('[TAGDETAIL] the evidence the descriptions rest on (real captured answer)', () => {
  it('INSTALLMENT_CURRENT: amount = current + remain + mulct + locked', () => {
    const i = (
      LOAN_V1_ENDPOINTS as unknown as {
        INSTALLMENT_CURRENT: {
          success: { body: { data: { installment: Record<string, number> } } };
        };
      }
    ).INSTALLMENT_CURRENT.success.body.data.installment;
    expect(i['amount']).toBe(
      i['current_amount']! +
        i['remain_amount']! +
        i['mulct_amount']! +
        i['locked_amount']!,
    );
  });
});

describe('[TAGDETAIL] each description names what its path holds', () => {
  /* tag → [sub_type, value, how the description must start] — sub_type/value are the pin that
     nothing but the wording moved */
  const EXPECT: Record<string, [string, string, string]> = {
    ins_x_9000004: [
      'CUSTOMER_PROFILE',
      'data.installment.due_date',
      'วันครบกำหนดชำระงวดนี้ (รูปแบบ ปปปป-ดด-วว',
    ],
    ins_x_9000005: [
      'INSTALLMENT_CURRENT',
      'data.installment.due_date',
      'วันครบกำหนดชำระงวดนี้ (รูปแบบไทย',
    ],
    ins_x_9000006: [
      'INSTALLMENT_CURRENT',
      'data.installment.amount',
      'ยอดรวมทั้งหมดที่ต้องชำระตอนนี้',
    ],
    ins_x_9000007: [
      'CUSTOMER_PROFILE',
      'data.installment.total_terms',
      'จำนวนงวดทั้งหมดในสัญญา',
    ],
    ins_x_9000008: [
      'CUSTOMER_PROFILE',
      'data.customer.customer_number',
      'รหัสลูกค้า',
    ],
    ins_x_9000009: [
      'INSTALLMENT_CURRENT',
      'data.installment.status',
      'สถานะการชำระงวดนี้',
    ],
    ins_x_9000014: [
      'CUSTOMER_PROFILE',
      'data.product.device_type',
      'ประเภทเครื่อง',
    ],
    ins_x_9000015: [
      'CUSTOMER_PROFILE',
      'data.product.is_locked',
      'สถานะการล็อกเครื่อง',
    ],
    ins_x_9000016: [
      'CUSTOMER_PROFILE',
      'data.contract.down_payment',
      'เงินดาวน์',
    ],
    ins_x_9000017: [
      'CUSTOMER_PROFILE',
      'data.installment.overdue_days',
      'จำนวนวันที่เลยกำหนดชำระ',
    ],
    ins_x_9000018: [
      'INSTALLMENT_CURRENT',
      'data.installment.remain_amount',
      'ยอดค้างชำระยกมา',
    ],
    ins_x_9000019: [
      'INSTALLMENT_CURRENT',
      'data.installment.amount',
      'ยอดรวมทั้งหมดที่ต้องชำระตอนนี้',
    ],
    ins_x_9000021: [
      'INSTALLMENT_CURRENT',
      'data.installment.mulct_amount',
      'ค่าปรับกรณีชำระล่าช้า',
    ],
    ins_x_9000022: [
      'INSTALLMENT_CURRENT',
      'data.installment.current_amount',
      'ค่างวดของงวดนี้',
    ],
    ins_x_9000023: [
      'INSTALLMENT_CURRENT',
      'data.installment.current_amount',
      'ค่างวดของงวดนี้',
    ],
  };

  it('the bundle still has exactly these 15 tags', () => {
    expect(tags.map((t) => t.tag).sort()).toEqual(Object.keys(EXPECT).sort());
  });

  for (const [name, [subType, value, start]] of Object.entries(EXPECT)) {
    it(`${name} — ${value}`, () => {
      const t = byName(name);
      expect({ sub_type: t.sub_type, value: t.value }).toEqual({
        sub_type: subType,
        value,
      });
      expect(t.detail.startsWith(start)).toBe(true);
      /* the marker the "ผูก tag" button recognises a migrated tag by */
      expect(t.detail).toContain('[acme-migrated · sub_type เดิม:');
    });
  }

  it('🔴 none of the retired wrong labels survives', () => {
    const all = tags.map((t) => t.detail).join('\n');
    for (const wrong of [
      'Installment Number (e.g. 2/12)',
      'Remaining Terms (Calculated)',
      'Installment Amount',
      'Due Date (Thai Format)',
      'เงินต้นทั้งหมดที่ต้องผ่อน',
      'เงินต้นที่ชำระมาแล้วทั้งหมด',
      'เงินต้นคงเหลือที่ต้องชำระ',
      'งวดทั้งหมดที่ต้องผ่อน',
    ]) {
      expect({ wrong, present: all.includes(wrong) }).toEqual({
        wrong,
        present: false,
      });
    }
  });
});
