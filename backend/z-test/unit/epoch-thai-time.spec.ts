/**
 * [FEAT-20260829-EPOCHTHAI] epoch → เวลาไทย ในก้อนที่ส่งให้ AI
 *
 * ทำไมต้องมี: บรรทัดที่โมเดลได้รับคือ
 *   `Today is วันเสาร์ที่ 29 สิงหาคม 69 21:11:07 (Bangkok Time)`
 * แต่ข้อมูลในก้อนเป็น epoch ดิบ (`"date": 1788012184136`) ⇒ โมเดลต้องแปลงเอง
 * แล้วเทียบกับ พ.ศ. สองหลัก ซึ่งพลาดง่ายเวลาลูกค้าถาม "ฝากล่าสุดเมื่อไหร่".
 *
 * เคสที่คุ้มค่าที่จะเทส และเหตุผล:
 *  · **ห้ามพัง** — ปลายทางคือคำตอบที่ลูกค้ารอ. ก้อนที่ขาด/null/ว่าง/ผิดรูป
 *    ต้องผ่านได้เงียบ ๆ ไม่ throw. เจ้าของย้ำเรื่องนี้ 3 รอบ.
 *  · **ห้ามแตะของเดิม** — `profileData` ถูกอ่านต่อโดย flex vars / notice /
 *    ticket / _error_trigger อีก ~29 จุดใน webhook.service.ts. ถ้าเผลอแก้
 *    in-place ฟิลด์ที่งอกจะไปโผล่ในที่ที่ไม่มีใครคาด.
 *  · **ล็อกขอบเขต** — `date` / `updated_at` เป็นชื่อสามัญมาก. ถ้าจับจากชื่อ
 *    อย่างเดียว วันหนึ่ง API เพิ่ม `tier.date` มาก็จะถูกแปลงโดยไม่มีใครตัดสินใจ.
 *  · **หน่วยเวลา** — ก้อนนี้ปน 10 หลัก (วินาที) กับ 13 หลัก (มิลลิวินาที).
 *    ตีหน่วยผิดได้ปี 1970 หรือปี 58000 โดยไม่ error เลย.
 */
import {
  withThaiTime,
  toMillis,
  toThaiText,
  EPOCH_SCOPE,
  EPOCH_FIELDS,
  SUFFIX,
} from '@/modules/ai';

/** ก้อนย่อ ๆ ที่มีทุกกล่องที่ล็อกไว้ */
const realish = () => ({
  data: {
    profile: {
      finance: {
        total_deposit: 168924,
        balances: [{ amount: 0, updated_at: 1788012185 }],
        transactions: {
          deposit: [{ amount: 300, date: 1788012184136, type: 'deposit' }],
          withdraw: [{ amount: 1000, date: 1784249457304, type: 'withdraw' }],
        },
      },
      bonus: { cashback_history: [{ amount: 0.01, date: 1787776456713 }] },
      activity: {
        coin_received: [{ amount: 1, date: 1778357882929 }],
        coin_spent: [{ amount: 3, date: 1778224353829 }],
        point_round_history: [{ date: 1778224353827, reward_amount: 5 }],
        point_round_tickets: null,
      },
      promotion: {
        recent_products: [{ created_at: 1761982251, updated_at: 1761982251 }],
      },
    },
  },
  success: true,
});

/** เก็บทุก field ที่ลงท้าย _th พร้อม path */
function stamped(o: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (n: unknown, p: string): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${p}[${i}]`));
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k.endsWith(SUFFIX) && typeof v === 'string') out[`${p}.${k}`] = v;
      else walk(v, `${p}.${k}`);
    }
  };
  walk(o, '');
  return out;
}

describe('[EPOCHTHAI] ⭐⭐⭐ ห้ามพัง — ทุกก้อนที่ผิดรูปต้องผ่านเงียบ ๆ', () => {
  /* ลูกค้าที่ยังไม่เคยฝาก/ถอน จะไม่มี key เหล่านี้เลย หรือได้ [] มา
     ทุกแบบต้องไม่ throw และไม่ทำให้ flow ตอบลูกค้าล้ม */
  const survive: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['ตัวเลข', 123],
    ['string', 'x'],
    ['array ว่าง', []],
    ['object ว่าง', {}],
    ['success:false ไม่มี data', { success: false }],
    ['ไม่มี finance', { data: { profile: { web_code: 'x' } } }],
    ['finance = null', { data: { profile: { finance: null } } }],
    [
      'ไม่มี transactions',
      { data: { profile: { finance: { total_deposit: 1 } } } },
    ],
    [
      'transactions = null',
      { data: { profile: { finance: { transactions: null } } } },
    ],
    [
      'deposit = null',
      { data: { profile: { finance: { transactions: { deposit: null } } } } },
    ],
    [
      'deposit = []',
      { data: { profile: { finance: { transactions: { deposit: [] } } } } },
    ],
    [
      'deposit = {} (ไม่ใช่ array)',
      { data: { profile: { finance: { transactions: { deposit: {} } } } } },
    ],
    [
      'item = null ใน array',
      { data: { profile: { finance: { transactions: { deposit: [null] } } } } },
    ],
    [
      'item = string ใน array',
      { data: { profile: { finance: { transactions: { deposit: ['x'] } } } } },
    ],
    [
      'array ซ้อน array',
      {
        data: {
          profile: { finance: { transactions: { deposit: [[{ date: 1 }]] } } },
        },
      },
    ],
  ];

  it.each(survive)('รอด: %s', (_label, input) => {
    expect(() => withThaiTime(input)).not.toThrow();
  });

  it('ค่าที่ไม่ใช่ object คืนตัวเดิมเป๊ะ', () => {
    expect(withThaiTime(null)).toBeNull();
    expect(withThaiTime(123 as never)).toBe(123);
    expect(withThaiTime('x' as never)).toBe('x');
  });

  it('⭐ โครงสร้างวนลูปไม่ทำให้ค้าง — คืนก้อนเดิมแทนที่จะแฮงก์', () => {
    const loop: Record<string, unknown> = {
      deposit: [{ date: 1788012184136 }],
    };
    loop['self'] = loop; // JSON.stringify จะ throw ⇒ ต้องตกกลับ
    expect(() => withThaiTime(loop)).not.toThrow();
    expect(withThaiTime(loop)).toBe(loop); // ก้อนเดิม ไม่ใช่สำเนา
  });
});

describe('[EPOCHTHAI] ค่าที่แปลงไม่ได้ ต้องไม่เติมอะไรเลย', () => {
  const skip: Array<[string, unknown]> = [
    ['date หายไป', { amount: 1 }],
    ['null', { date: null }],
    ['0', { date: 0 }],
    ['ติดลบ', { date: -1 }],
    ['เล็กเกิน (ไม่ใช่เวลา)', { date: 999 }],
    ['string ที่หน้าตาเหมือน epoch', { date: '1788012184136' }],
    ['NaN', { date: NaN }],
    ['Infinity', { date: Infinity }],
    ['object', { date: {} }],
    ['array', { date: [] }],
  ];

  it.each(skip)('ไม่เติมเมื่อ date = %s', (_label, row) => {
    const out = withThaiTime({ deposit: [row] }) as {
      deposit: Record<string, unknown>[];
    };
    expect('date' + SUFFIX in out.deposit[0]!).toBe(false);
  });

  it('⭐ ยอดเงินหลักแสนไม่ถูกแปลง (total_deposit = 168,924)', () => {
    /* เกณฑ์ EPOCH_MIN = 1e9 ห่างจากยอดจริงสูงสุด ~5,900 เท่า */
    const out = withThaiTime(realish());
    expect(JSON.stringify(out)).not.toContain('total_deposit_th');
  });
});

describe('[EPOCHTHAI] ⭐⭐⭐ ไม่แตะก้อนต้นทาง (copy-on-write)', () => {
  it('ก้อนที่ส่งเข้าไปต้องเหมือนเดิมทุกไบต์', () => {
    /* profileData ถูกอ่านต่ออีก ~29 จุด — flex vars, notice, ticket.
       ถ้าเผลอแก้ in-place ฟิลด์ที่งอกจะไปโผล่ในที่ที่ไม่มีใครคาด */
    const input = realish();
    const before = JSON.stringify(input);
    withThaiTime(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('ผลลัพธ์เป็นคนละ object กับต้นทาง', () => {
    const input = realish();
    expect(withThaiTime(input)).not.toBe(input);
  });
});

describe('[EPOCHTHAI] ⭐⭐ ล็อกขอบเขต — แปลงเฉพาะกล่องที่อนุญาต', () => {
  it('⭐⭐⭐ ชื่อ field ตรง + อยู่ใน ARRAY ที่ไม่ได้อนุญาต ⇒ ไม่แปลง', () => {
    /* เคสนี้คือหัวใจของ scope lock และเป็นเคสที่แยก "ล็อกกล่อง" ออกจาก
       "จับจากชื่อ" ได้จริง. เดิมเทสใช้ `tier.date` ซึ่งเป็น object เดี่ยว —
       mutation ที่ทิ้ง scope lock ยังเขียวอยู่ เพราะ stampList ไม่รับ object
       ธรรมดาอยู่แล้ว. ต้องเป็น ARRAY ของ row ที่หน้าตาเหมือน transactions
       ทุกอย่าง ต่างแค่ชื่อกล่อง — แบบนี้ถ้าใครถอด lock ออกจะแดงทันที.
       ตัวอย่างจริงที่อาจโผล่มาวันหน้า: `login_history`, `promotion_history` */
    const out = withThaiTime({
      data: {
        profile: {
          login_history: [{ date: 1788012184136, ip: '1.1.1.1' }],
          promotion_history: [{ created_at: 1788012184136, name: 'x' }],
        },
      },
    });
    expect(Object.keys(stamped(out))).toEqual([]);
  });

  it('ชื่อ field ตรงแต่อยู่ผิดกล่อง (object เดี่ยว) ⇒ ไม่แปลง', () => {
    /* `tier.date` / `promotion.updated_at` เป็นตัวอย่างที่ API อาจเพิ่มวันหน้า
       ถ้าจับจากชื่ออย่างเดียวมันจะถูกแปลงโดยไม่มีใครตัดสินใจ */
    const out = withThaiTime({
      data: {
        profile: {
          tier: { date: 1788012184136 },
          promotion: { updated_at: 1788012184136 },
          registered_at: 1788012184136,
        },
      },
    });
    expect(Object.keys(stamped(out))).toEqual([]);
  });

  it('อยู่ในกล่องที่อนุญาต แต่ชื่อ field ไม่อยู่ในลิสต์ ⇒ ไม่แปลง', () => {
    const out = withThaiTime({ deposit: [{ expired_at: 1788012184136 }] });
    expect(Object.keys(stamped(out))).toEqual([]);
  });

  it('ทุกกล่องใน EPOCH_SCOPE ถูกแปลงจริงครบ', () => {
    const got = Object.keys(stamped(withThaiTime(realish())));
    for (const box of Object.keys(EPOCH_SCOPE)) {
      expect(got.some((p) => p.includes(`.${box}[`))).toBe(true);
    }
  });

  it('EPOCH_FIELDS ได้มาจาก EPOCH_SCOPE ไม่เขียนซ้ำ (กัน drift)', () => {
    const derived = [...new Set(Object.values(EPOCH_SCOPE).flat())].sort();
    expect([...EPOCH_FIELDS].sort()).toEqual(derived);
  });
});

describe('[EPOCHTHAI] ⭐⭐ หน่วยเวลา — 10 หลักกับ 13 หลักต้องได้ผลเท่ากัน', () => {
  it('วินาที (10 หลัก) กับ มิลลิวินาที (13 หลัก) ของเวลาเดียวกัน ให้ข้อความเดียวกัน', () => {
    /* ตีหน่วยผิดจะได้ปี 1970 หรือปี 58000 โดยไม่ error — นี่คือเคสที่เงียบที่สุด */
    const sec = 1788012185;
    const ms = 1788012185000;
    expect(toThaiText(toMillis(sec)!)).toBe(toThaiText(toMillis(ms)!));
  });

  it('ปีที่ได้ต้องสมเหตุสมผล ไม่ใช่ 1970 และไม่ใช่ 58000', () => {
    const out = withThaiTime(realish());
    const all = Object.values(stamped(out)).join(' ');
    expect(all).not.toMatch(/\b13\b|\b2513\b/); // พ.ศ. ของปี 1970
    expect(all).toMatch(/\b6[6-9]\b|\b7[0-9]\b/); // พ.ศ. 66-79 = ค.ศ. 2023-2036
  });

  it('เวลาอนาคตไกลเกินจริง (ปี 9999+) ไม่ถูกแปลง', () => {
    expect(toMillis(99_999_999_999_999)).toBeNull();
  });
});

describe('[EPOCHTHAI] รูปแบบตรงกับบรรทัด `Today is` ที่โมเดลได้รับ', () => {
  it('⭐ ขึ้นต้นด้วยวันในสัปดาห์ภาษาไทย + พ.ศ. สองหลัก', () => {
    const text = toThaiText(1788012184136);
    /* รูปแบบเดียวกับ formatThaiDateTime() ที่ประกอบบรรทัด
       `Today is วันเสาร์ที่ 29 สิงหาคม 69 21:11:07 (Bangkok Time)` */
    expect(text).toMatch(/^วัน\S+ที่ \d{2} \S+ \d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('เป็นเวลาไทย ไม่ใช่ UTC', () => {
    /* 1788012184136 UTC = 14:03:04 · ไทย = 21:03:04 (+7) */
    expect(toThaiText(1788012184136)).toContain('21:03:04');
  });
});

describe('[EPOCHTHAI] ของต้นทางชนะ ไม่ทับ', () => {
  it('ถ้ามี date_th มาแล้ว ⇒ ไม่เขียนทับ', () => {
    const out = withThaiTime({
      deposit: [{ date: 1788012184136, date_th: 'ของเดิม' }],
    }) as { deposit: Record<string, unknown>[] };
    expect(out.deposit[0]!['date_th']).toBe('ของเดิม');
  });
});

describe('[EPOCHTHAI] ก้อนจริง — ครบ 24 จุด', () => {
  it('⭐⭐⭐ แปลงครบทุกจุดที่สแกนเจอ ไม่ขาดไม่เกิน', () => {
    const got = stamped(withThaiTime(realish()));
    /* ก้อนย่อนี้มีกล่องละ 1 รายการ ⇒ 9 path (recent_products มี 2 field) */
    expect(Object.keys(got).sort()).toEqual([
      '.data.profile.activity.coin_received[0].date_th',
      '.data.profile.activity.coin_spent[0].date_th',
      '.data.profile.activity.point_round_history[0].date_th',
      '.data.profile.bonus.cashback_history[0].date_th',
      '.data.profile.finance.balances[0].updated_at_th',
      '.data.profile.finance.transactions.deposit[0].date_th',
      '.data.profile.finance.transactions.withdraw[0].date_th',
      '.data.profile.promotion.recent_products[0].created_at_th',
      '.data.profile.promotion.recent_products[0].updated_at_th',
    ]);
  });

  it('เลข epoch เดิมยังอยู่ครบทุกจุด', () => {
    const s = JSON.stringify(withThaiTime(realish()));
    for (const n of [1788012184136, 1784249457304, 1788012185, 1761982251]) {
      expect(s).toContain(String(n));
    }
  });
});
