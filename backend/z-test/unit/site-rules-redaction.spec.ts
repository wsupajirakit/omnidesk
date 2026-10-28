/**
 * [SEC-20260825-SITERULESMASK] เลขบัญชีและ ref_id ต้องไม่ออกจากเซิร์ฟเวอร์แบบเต็ม
 * ===========================================================================
 * เจ้าของ 25/08: *"เบลอเลขที่ บช 50% · เบลอ ref_id 70%"* และ
 * *"ต้องไม่หลุดใน get / response / inspect"*
 *
 * 🔴 ข้อสุดท้ายคือเหตุผลที่เคสชุดนี้อยู่ฝั่ง BE: การซ่อนบนหน้าจอผ่านทุกเทส DOM
 *    ได้สบาย ๆ ทั้งที่ค่าเต็มยังติดไปกับ response · เคสที่พิสูจน์เรื่องนี้ได้จริง
 *    ต้องดูสิ่งที่ "ถูกส่งออก" ไม่ใช่สิ่งที่ "ถูกวาด"
 *
 * ก้อนตัวอย่างคัดรูปมาจากของจริงที่เจ้าของส่งมา — เลขบัญชีถูกเปลี่ยนแล้ว
 */
import {
  redactSiteRules,
  maskValue,
  MASK_RATIO,
} from '../../src/modules/chat/site-rules/redact-site-rules';

const shop = () => ({
  bank_account: {
    accounts: [
      {
        account_name: 'test',
        account_number: '123456123456',
        account_type: 'deposit',
        ref_id: 'dragon-00000000-0000-4000-8000-000000000028',
        status: 'disable',
        is_view: false,
        balance: 289.69,
      },
      {
        account_name: 'Virexa',
        account_number: 'VIREXA-2VCAQ0',
        account_type: 'deposit',
        ref_id: 'virexa-01M0EZ5SGJKGRKDZ2M403BSF63',
        status: 'enable',
        is_view: true,
      },
    ],
  },
});

describe('[SITERULESMASK] สัดส่วนที่ปิด', () => {
  it('⭐ (T1) ตั้งไว้ตามที่สั่ง: บัญชี 50% · ref_id 70%', () => {
    expect(MASK_RATIO['account_number']).toBe(0.5);
    expect(MASK_RATIO['ref_id']).toBe(0.7);
  });

  it('⭐⭐ (T2) เก็บหัวไว้ ปิดท้าย และความยาวเท่าเดิม', () => {
    const out = maskValue('123456123456', 0.5) as string;
    expect(out).toHaveLength(12);
    expect(out.startsWith('123456')).toBe(true);
    expect(out.endsWith('******')).toBe(true);
  });

  it('⭐⭐ (T3) 70% ปิดมากกว่า 50% จริง', () => {
    const v = 'abcdefghij';
    const half = (maskValue(v, 0.5) as string).replace(/[^*]/g, '').length;
    const most = (maskValue(v, 0.7) as string).replace(/[^*]/g, '').length;
    expect(most).toBeGreaterThan(half);
  });

  it('⭐⭐ (T4) ค่าสั้นมากปิดทั้งหมด — เก็บ "ครึ่งแรก" ของสองตัวอักษรคือไม่ได้ปิดอะไร', () => {
    expect(maskValue('ab', 0.5)).toBe('**');
    expect(maskValue('a', 0.5)).toBe('*');
  });

  it('⭐ (T5) ค่าที่ไม่ใช่สตริง ปล่อยผ่านไม่แตะ', () => {
    expect(maskValue(123, 0.5)).toBe(123);
    expect(maskValue(null, 0.5)).toBeNull();
    expect(maskValue(undefined, 0.5)).toBeUndefined();
  });
});

describe('[SITERULESMASK] เดินทั้งก้อน', () => {
  it('⭐⭐⭐ (T6) ไม่มีเลขบัญชีเต็มหลงเหลือใน JSON ที่ส่งออก', () => {
    /* นี่คือเคสที่ตรงกับคำสั่งที่สุด — "ต้องไม่หลุดใน response" */
    const out = JSON.stringify(redactSiteRules(shop()));
    expect(out).not.toContain('123456123456');
    expect(out).not.toContain('VIREXA-2VCAQ0');
  });

  it('⭐⭐⭐ (T7) ไม่มี ref_id เต็มหลงเหลือเช่นกัน', () => {
    const out = JSON.stringify(redactSiteRules(shop()));
    expect(out).not.toContain('dragon-00000000-0000-4000-8000-000000000028');
    expect(out).not.toContain('virexa-01M0EZ5SGJKGRKDZ2M403BSF63');
  });

  it('⭐⭐ (T8) ฟิลด์อื่นไม่ถูกแตะ — ตรรกะ notice อ่าน status/is_view จากก้อนเดียวกัน', () => {
    const out = redactSiteRules(shop());
    const a = out.bank_account.accounts;
    expect(a[0]?.status).toBe('disable');
    expect(a[1]?.status).toBe('enable');
    expect(a[1]?.is_view).toBe(true);
    expect(a[0]?.balance).toBe(289.69);
    expect(a[0]?.account_name).toBe('test');
  });

  it('⭐⭐ (T9) ไม่แก้ของเดิมในที่ — ผู้เรียกอาจถือ document ที่ใช้ต่อที่อื่น', () => {
    const src = shop();
    redactSiteRules(src);
    expect(src.bank_account.accounts[0]?.account_number).toBe('123456123456');
  });

  it('⭐⭐ (T10) ปิดได้ทุกชั้น ไม่ใช่แค่ชั้นบนสุด', () => {
    const deep = { a: { b: { c: [{ ref_id: 'zzzzzzzzzzzzzzzzzzzz' }] } } };
    const out = JSON.stringify(redactSiteRules(deep));
    expect(out).not.toContain('zzzzzzzzzzzzzzzzzzzz');
  });

  it('⭐ (T11) ก้อนที่อ้างถึงตัวเองไม่ทำให้ค้าง', () => {
    const loop: Record<string, unknown> = { account_number: '1234567890' };
    loop['self'] = loop;
    expect(() => redactSiteRules(loop)).not.toThrow();
  });

  it('⭐ (T12) null / ค่าพื้นฐาน ผ่านได้ไม่ระเบิด', () => {
    expect(redactSiteRules(null)).toBeNull();
    expect(redactSiteRules(7)).toBe(7);
    expect(redactSiteRules('x')).toBe('x');
  });
});

describe('[SITERULESMASK] ต่อสายที่จุดคอขวดจริง', () => {
  it('⭐⭐⭐ (T13) `getHookSiteRules` เป็นตัวเรียก และคลุมเส้น refresh ด้วย', () => {
    /* ถ้ามีคนถอดการเรียกออก หรือเพิ่มเส้นที่สามที่ส่งคอลัมน์นี้โดยไม่ปิดบัง
       เคสนี้คือสิ่งเดียวที่จะบอก */
    const src = require('node:fs').readFileSync(
      require('node:path').resolve(
        __dirname,
        '../../src/modules/chat/members.service.ts',
      ),
      'utf8',
    );
    expect(src).toContain('redactSiteRules(');
    // เส้น refresh ต้องยังจบด้วยการเรียกเมธอดที่ปิดบังแล้ว ไม่ใช่อ่านคอลัมน์เอง
    expect(src).toContain('return this.getHookSiteRules(hookId)');
  });
});
