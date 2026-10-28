/* [FEAT-20260808-PAYCUSTOOL] Payment-category custom tool — the two invariants that are
 * expensive to get wrong and cheap to protect. This is a money feature, so the rules below
 * are asserted directly rather than left to review.
 *
 * 1) statement_status: '' means "no status filter" — an INTENTIONAL operator choice.
 *    ถ้าโดนเด้งกลับเป็นค่า default ตอนโหลดฟอร์ม = ระบบจะกรองสถานะทั้งที่คนสั่งว่าไม่ให้กรอง
 *    → จับคู่สลิปพลาด → เงินเข้าผิด นี่คือเหตุผลที่ normalizePayment ใช้ `??` ไม่ใช่ `||`
 *
 * 2) A tool with no `category` from the BE must read back as 'generic' and carry NO payment
 *    object — tool เดิมทุกตัวต้องทำงานเหมือนเดิมเป๊ะ ๆ ไม่มีก้อน payment งอกขึ้นมา
 *
 * These exercise the real normalizeTool via the service's public list() path (fetch mocked),
 * so they break if anyone "tidies" the ?? into a || later.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// authFetch/handleApiResponse are the only network seams the service touches.
const listPayload: { data: any[] } = { data: [] };
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as any),
  handleApiResponse: () => Promise.resolve(listPayload),
}));

import { customToolService, PAYMENT_DEFAULTS } from '../services/hook/customToolService';

beforeEach(() => { listPayload.data = []; });

describe('payment custom tool — value contract', () => {
  it('keeps an intentionally-empty statement_status empty (must NOT fall back to the default)', async () => {
    listPayload.data = [{
      _id: 't1', name: 'Pay tool', category: 'payment',
      // the operator deliberately cleared the status filter
      payment: { statement_status: '', statement_provider_code: 'walletpay' },
    }];

    const res = await customToolService.listCustomTools({});
    const pay = res.data[0].payment!;

    expect(pay.statement_status).toBe('');
    // guard the exact regression: the default must not have been substituted
    expect(pay.statement_status).not.toBe(PAYMENT_DEFAULTS.statement_status);
    // ...while a genuinely absent key still picks up its default
    expect(pay.walletpay_ref_id_field).toBe(PAYMENT_DEFAULTS.walletpay_ref_id_field);
    // and a provided value is passed through untouched
    expect(pay.statement_provider_code).toBe('walletpay');
  });

  it('fills payment defaults for a payment tool that has no payment object yet', async () => {
    listPayload.data = [{ _id: 't2', name: 'Fresh pay tool', category: 'payment' }];

    const pay = (await customToolService.listCustomTools({})).data[0].payment!;

    expect(pay.statement_tx_path).toBe(PAYMENT_DEFAULTS.statement_tx_path);
    // '' is the default here and means "send the whole verify result"
    expect(pay.topup_payload_path).toBe('');
    expect(pay.topup_to_walletpay_map).toEqual({});
    // reply texts default to '' = use the backend's Thai default
    expect(pay.reply_success_text).toBe('');
    // [FEAT-20260809-PAYNOTLINK] the 7th reply state defaults the same way as the other six
    expect(pay.not_linked_reply_text).toBe('');
  });

  it('round-trips not_linked_reply_text (the 7th reply state) verbatim', async () => {
    // ⚠️ the BE whitelist drops unknown keys silently and still returns 200, so a typo in
    // this field name would vanish with no error anywhere. Pin the exact spelling.
    const custom = 'ผูกบัญชีก่อนนะครับ แล้วส่งสลิปมาใหม่';
    listPayload.data = [{ _id: 't5', name: 'Pay tool', category: 'payment',
      payment: { not_linked_reply_text: custom } }];

    const pay = (await customToolService.listCustomTools({})).data[0].payment!;

    expect(pay.not_linked_reply_text).toBe(custom);
    // และช่องอื่นต้องไม่ถูกกระทบ — เติมค่าว่างตามปกติ
    expect(pay.not_found_reply_text).toBe('');
  });

  it('treats a tool with no category as generic and gives it no payment object', async () => {
    // exactly what every pre-existing tool in the DB looks like
    listPayload.data = [{ _id: 't3', name: 'Old tool', base_url: 'https://x.test' }];

    const tool = (await customToolService.listCustomTools({})).data[0];

    expect(tool.category).toBe('generic');
    expect(tool.payment).toBeUndefined();
  });

  it('ignores a malformed topup_to_walletpay_map instead of crashing the form', async () => {
    // BE/hand-edited data could hand us an array or a scalar — the form indexes this object,
    // so a non-object here would break the whole editor rather than one field.
    listPayload.data = [{ _id: 't4', name: 'Odd tool', category: 'payment',
      payment: { topup_to_walletpay_map: ['not', 'an', 'object'] } }];

    const pay = (await customToolService.listCustomTools({})).data[0].payment!;

    expect(pay.topup_to_walletpay_map).toEqual({});
  });
});
