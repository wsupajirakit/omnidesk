/**
 * [FIX-20260825-NATIDTAGS] สลิปที่โอนเข้า PromptPay แสดง N/A ทั้งชื่อแบงค์และเลขบัญชี
 *
 * เจ้าของแจ้ง 25/08 พร้อม rawSlip จริง: ผู้รับเป็น `proxy` ชนิด `NATID`
 *   receiver.account.proxy = { type: 'NATID', account: 'x-xxxx-xxxx0-66-4' }
 * และ **ไม่มี** `receiver.bank` กับ **ไม่มี** `receiver.account.bank` เลย
 * ⇒ `receiver_bank_name` และ `receiver_acc_no` ตกลง `'N/A'` ทั้งคู่บนการ์ดที่ลูกค้าเห็น
 *
 * เจ้าของสั่ง: *"ต้องการให้แสดง x-xxxx-xxxx0-66-4 ในเลข เหมือนแบงค์ปกติ
 * ชื่อแบงค์ ถ้าเจอ NATID = Promptpay"*
 *
 * 🔴 กติกานี้ **มีอยู่ในระบบแล้ว** ไม่ได้คิดใหม่ — `slip/slip-flow.service.ts:381-385`
 * ทำ fallback ไป `proxy.account` อยู่ก่อนแล้ว พร้อมคอมเมนต์ว่า
 *   *"Receiver falls back to the PROXY account (PromptPay); sender does not.
 *    That asymmetry is legacy's and is correct — a sender is always a real
 *    account, a receiver may be a proxy."*
 * ไฟล์ tag แค่ไม่ได้ตามกติกาเดียวกัน ⇒ แก้ให้ตรงกัน ไม่ใช่เพิ่มกฎใหม่
 *
 * ⚠️ ไฟล์ `flex-slip-tags.util.ts` เป็น **display-only** — แปลงสลิปที่ตรวจแล้ว
 *    เป็น tag ให้การ์ด · การตัดสินใจเรื่องเครดิต (topup / walletpay / swiftcheck)
 *    อ่าน `rawSlip` ตรง ไม่ผ่านไฟล์นี้ ⇒ การแก้ตรงนี้ **แตะได้แค่สิ่งที่ตาเห็น**
 */
import { buildSlipTagMap } from '@/modules/webhook/slip-flex/flex-slip-tags.util';

/* ⚠️ ลายเซ็นจริงคือ `buildSlipTagMap(ctx)` ตัวเดียว — ไม่ใช่ (slip, baseUrl)
   ลอกรูป ctx มาจาก `flex-slip-tags.spec.ts` ที่มีอยู่แล้ว ไม่ประดิษฐ์เอง */
const ctxFor = (vData: unknown) => ({
  vData: vData as never,
  baseUrl: 'https://example.invalid',
  slipCreatedAt: new Date('2026-08-24T15:28:22.000Z'),
  formatThaiDateTime: (d: unknown) => String(d),
});

/** สลิปจริงที่เจ้าของส่งมา — ตัดเหลือส่วนที่ tag อ่าน */
const natidSlip = () => ({
  transRef: '016236222822APP02688',
  date: '2026-08-24T22:28:22+07:00',
  amount: { amount: 1300 },
  sender: {
    bank: { id: '004', name: 'ธนาคารกสิกรไทย', short: 'KBANK' },
    account: {
      name: { th: 'นาย สงกรานต์ บ', en: 'Mr. Songkran B' },
      bank: { type: 'BANKAC', account: 'xxx-x-x8936-x' },
    },
  },
  receiver: {
    account: {
      name: { th: 'หจก. พลอยพันล้านคลินิก เ', en: 'PLOYPHANLAN C' },
      /* 🔴 ไม่มี `bank` เลย มีแต่ proxy — นี่คือรูปที่ทำให้เกิดบั๊ก */
      proxy: { type: 'NATID', account: 'x-xxxx-xxxx0-66-4' },
    },
    merchantId: '',
  },
});

/** สลิปโอนเข้าบัญชีธนาคารปกติ — ของเดิมห้ามขยับ */
const bankSlip = () => ({
  transRef: 'TX1',
  amount: { amount: 500 },
  sender: {
    bank: { id: '004', name: 'กสิกร' },
    account: { name: { th: 'ผู้ส่ง' }, bank: { account: '111' } },
  },
  receiver: {
    bank: { id: '014', name: 'ธนาคารไทยพาณิชย์', short: 'SCB' },
    account: { name: { th: 'ผู้รับ' }, bank: { account: 'xxx-x-x1234-x' } },
  },
});

describe('[NATIDTAGS] ผู้รับเป็น PromptPay (NATID)', () => {
  it('⭐⭐ เลขบัญชีต้องเป็นเลข proxy ไม่ใช่ N/A', () => {
    const t = buildSlipTagMap(ctxFor(natidSlip()));
    expect(t['receiver_acc_no']).toBe('x-xxxx-xxxx0-66-4');
  });

  it('⭐⭐ ชื่อแบงค์ต้องเป็น Promptpay ไม่ใช่ N/A', () => {
    const t = buildSlipTagMap(ctxFor(natidSlip()));
    expect(t['receiver_bank_name']).toBe('Promptpay');
  });

  it('⭐ ชื่อผู้รับยังอ่านได้เหมือนเดิม (ไม่ได้พังไปด้วย)', () => {
    const t = buildSlipTagMap(ctxFor(natidSlip()));
    expect(t['receiver_name']).toBe('หจก. พลอยพันล้านคลินิก เ');
  });

  it('⭐ ฝั่งผู้ส่งไม่ถูกแตะเลย — sender ไม่มี fallback ไป proxy ตามกติกาเดิม', () => {
    const t = buildSlipTagMap(ctxFor(natidSlip()));
    expect(t['sender_acc_no']).toBe('xxx-x-x8936-x');
    expect(t['sender_bank_name']).toBe('ธนาคารกสิกรไทย');
  });
});

describe('[NATIDTAGS] 🔴 PIN — สลิปธนาคารปกติต้องเหมือนเดิมทุกประการ', () => {
  it('⭐⭐ ชื่อแบงค์ยังเป็นชื่อธนาคารจริง ไม่ใช่ Promptpay', () => {
    const t = buildSlipTagMap(ctxFor(bankSlip()));
    expect(t['receiver_bank_name']).toBe('ธนาคารไทยพาณิชย์');
  });

  it('⭐⭐ เลขบัญชียังมาจาก account.bank เหมือนเดิม', () => {
    const t = buildSlipTagMap(ctxFor(bankSlip()));
    expect(t['receiver_acc_no']).toBe('xxx-x-x1234-x');
  });

  it('⭐ ไม่มีข้อมูลเลยทั้งสองทาง = ยังเป็น N/A เหมือนเดิม', () => {
    const bare = { amount: { amount: 1 }, receiver: { account: {} } };
    const t = buildSlipTagMap(ctxFor(bare));
    expect(t['receiver_acc_no']).toBe('N/A');
    expect(t['receiver_bank_name']).toBe('N/A');
  });

  /* ⚠️ proxy ชนิดอื่น (เช่น MSISDN = เบอร์มือถือ) ต้องยังโชว์เลขได้
     แต่ **ห้ามเรียกว่า Promptpay ทั้งที่ยังไม่รู้** — เจ้าของระบุเฉพาะ NATID */
  it('⭐⭐ proxy ชนิดอื่นโชว์เลขได้ แต่ชื่อแบงค์ไม่ถูกเดา', () => {
    const other = {
      amount: { amount: 1 },
      receiver: {
        account: { proxy: { type: 'MSISDN', account: '08x-xxx-1234' } },
      },
    };
    const t = buildSlipTagMap(ctxFor(other));
    expect(t['receiver_acc_no']).toBe('08x-xxx-1234');
    expect(t['receiver_bank_name']).toBe('N/A');
  });
});
