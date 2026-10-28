/**
 * [FEAT-20260829-NOTICEWORDSI18N] ตัวคัดกรอง notice รองรับ 5 ภาษา
 * ===========================================================================
 * เจ้าของสั่ง 29/08: *"แปลภาษา keyword ที่รองรับ notice … eng / พม่า / จีน /
 * ลาว / เขมร (แปลจากไทยเป็นหลัก)"* และ *"ภาษาเอาทั้งแบบย่อและแบบเต็มของภาษานั้น ๆ"*
 *
 * 🔴 เคส NEGATIVE สำคัญกว่าเคส POSITIVE ในไฟล์นี้
 *    match แล้วระบบ **ยิงการ์ดหาลูกค้าจริงอัตโนมัติ** ⇒ false positive คือ
 *    ลูกค้าได้การ์ดมั่ว ซึ่งเจ็บกว่าการพลาดคำไปหนึ่งคำ · matcher เป็น substring
 *    ล้วนและไม่มี word boundary ⇒ คำสั้นอันตรายเป็นพิเศษ
 *
 * 🔴 ไทยเดิมมีด่านของตัวเองแยกต่างหาก — `notice-words-thai-frozen.spec.ts`
 *    แช่คำตอบของข้อความไทย 16 แบบไว้ทั้งสองฝั่ง ไฟล์นี้จึงไม่ทดสอบไทยซ้ำ
 *
 * revert: ลบไฟล์นี้ + บล็อกภาษาใน `notice-word-match.ts` + คืน `matchAny`
 *         เป็น `text.includes(w)`
 */
import {
  DEPOSIT_WORDS,
  WITHDRAW_WORDS,
  matchDepositWord,
  matchWithdrawWord,
} from '../../src/modules/webhook/notice-runtime/notice-word-match';

describe('[NOTICEWORDSI18N] ฝั่งฝาก — ย่อและเต็มของแต่ละภาษา', () => {
  const DEP: Array<[string, string]> = [
    ['อังกฤษ ย่อ', 'deposit'],
    ['อังกฤษ ย่อ ในประโยค', 'how to deposit money'],
    ['อังกฤษ เต็ม', 'i want to top up'],
    ['อังกฤษ เต็ม ติดกัน', 'topup not working'],
    ['อังกฤษ เต็ม recharge', 'recharge failed'],
    ['พม่า ย่อ', 'သွင်း'],
    ['พม่า เต็ม', 'ငွေသွင်းလို့မရဘူး'],
    ['จีน ย่อ', '存款'],
    ['จีน เต็ม', '充值没有到账'],
    ['ลาว ย่อ', 'ຝາກ'],
    ['ลาว เต็ม', 'ຝາກເງິນບໍ່ເຂົ້າ'],
    ['เขมร ย่อ', 'ដាក់លុយ'],
    ['เขมร เต็ม', 'បញ្ចូលលុយមិនចូល'],
  ];
  it.each(DEP)('⭐⭐ %s → ฝั่งฝากติด', (_n, text) => {
    expect(matchDepositWord(text)).toBe(true);
  });
});

describe('[NOTICEWORDSI18N] ฝั่งถอน — ย่อและเต็มของแต่ละภาษา', () => {
  const WD: Array<[string, string]> = [
    ['อังกฤษ ย่อ', 'withdraw'],
    ['อังกฤษ เต็ม', 'my withdrawal is pending'],
    ['อังกฤษ เต็ม cash out', 'i cannot cash out'],
    ['อังกฤษ เต็ม payout', 'payout stuck'],
    ['พม่า ย่อ', 'ထုတ်'],
    ['พม่า เต็ม', 'ငွေထုတ်မရဘူး'],
    ['จีน ย่อ', '提款'],
    ['จีน เต็ม', '提现失败'],
    ['ลาว ย่อ', 'ຖອນ'],
    ['ลาว เต็ม', 'ຖອນບໍ່ໄດ້'],
    ['เขมร ย่อ', 'ដកលុយ'],
    ['เขมร เต็ม', 'ដកប្រាក់មិនបាន'],
  ];
  it.each(WD)('⭐⭐ %s → ฝั่งถอนติด', (_n, text) => {
    expect(matchWithdrawWord(text)).toBe(true);
  });
});

describe('[NOTICEWORDSI18N] 🔴 NEGATIVE — ข้อความที่ต้องไม่ติดสักฝั่ง', () => {
  const NONE = [
    // อังกฤษทั่วไปที่มีคำสั้นซ่อนอยู่ — คำพวก in/top/out จึงถูกตัดออกตั้งแต่ต้น
    'hello',
    'good morning',
    'thank you very much',
    'what is your point', // มี "in" ข้างใน
    'nice outfit today', // มี "out" ข้างใน
    'top of the page', // มี "top" แต่ไม่ใช่ "top up"
    'i need help',
    'the topic is closed', // มี "top" ข้างใน
    // ภาษาอื่นที่ไม่เกี่ยวกับเงิน
    'မင်္ဂလာပါ', // พม่า: สวัสดี
    '你好', // จีน: สวัสดี
    '提供服务', // จีน: ให้บริการ — มี 提 แต่ไม่ใช่ 提款
    '存在问题', // จีน: มีปัญหา — มี 存 แต่ไม่ใช่ 存款
    'ສະບາຍດີ', // ลาว: สวัสดี
    'សួស្តី', // เขมร: สวัสดี
    'ដកដង្ហើម', // เขมร: หายใจ — มี ដក แต่ไม่ใช่ ដកលុយ
  ];
  it.each(NONE)('⭐⭐ 🔴 "%s" ⇒ ไม่ติดทั้งสองฝั่ง', (text) => {
    expect(matchDepositWord(text)).toBe(false);
    expect(matchWithdrawWord(text)).toBe(false);
  });
});

describe('[NOTICEWORDSI18N] คำเฉพาะฝั่งของภาษาใหม่ต้องไม่ข้ามฝั่ง', () => {
  /* 🔴 คำที่เลือกมาที่นี่ต้อง **ไม่มีคำร่วมฝังอยู่ข้างใน**
     ตอนแรกใส่ 'ငွေသွင်း' / 'ຝາກເງິນ' / 'ដាក់លុយ' แล้วแดงทั้งสามตัว เพราะข้างในมี
     'ငွေ' / 'ເງິນ' / 'លុយ' ซึ่งเป็นคำร่วมของทั้งสองฝั่ง — **ไม่ใช่บั๊ก** มันคือ
     พฤติกรรมเดียวกับภาษาไทยเป๊ะ: 'เงินเข้า' มี 'เงิน' อยู่ข้างใน จึงติดสองฝั่ง
     เหมือนกัน (ดู `notice-words-thai-frozen.spec.ts` แถว 'เงินไม่เข้า')
     ⇒ ปักพฤติกรรมนี้ไว้ใน describe ถัดไป แทนที่จะแก้โค้ดให้ตรงกับที่เข้าใจผิด */
  /* ⚠️ ต้องไม่มีคำร่วมฝังอยู่ — และตั้งแต่เติม "รูปธรรมดา" (cash/ប្រាក់/…) กลุ่มคำร่วม
     ก็โตขึ้น ⇒ 'cash out' (มี 'cash') และ 'ដាក់ប្រាក់' (มี 'ប្រាក់') ย้ายไปกลุ่มล่าง */
  /* เขมรไม่เหลือคำฝากที่ไม่มีคำร่วมฝังอยู่แล้ว (ทั้ง លុយ และ ប្រាក់ เป็นคำร่วม)
     ⇒ เขมรถูกคุมด้วยกลุ่ม "คำเต็มที่มีคำร่วมฝังใน" ด้านล่างแทน ซึ่งตรงความจริง */
  const DEP_ONLY = ['deposit', 'top up', 'recharge', '存款', '充值', 'ຝາກ'];
  const WD_ONLY = ['withdraw', 'payout', '提款', '提现', 'ຖອນ'];

  it.each(DEP_ONLY)(
    '⭐⭐ 🔴 "%s" เป็นคำฝั่งฝาก ต้องไม่ทำให้ฝั่งถอนติด',
    (w) => {
      expect(matchWithdrawWord(w)).toBe(false);
    },
  );
  it.each(WD_ONLY)('⭐⭐ 🔴 "%s" เป็นคำฝั่งถอน ต้องไม่ทำให้ฝั่งฝากติด', (w) => {
    expect(matchDepositWord(w)).toBe(false);
  });
});

describe('[NOTICEWORDSI18N] คำเต็มที่มีคำร่วมฝังอยู่ ⇒ ติดสองฝั่ง (เหมือนไทย)', () => {
  /* พฤติกรรมที่ตั้งใจ ไม่ใช่บั๊ก — ลิสต์ไทยเป็นแบบนี้มาตั้งแต่ 22/08 แล้ว
     ('เงินไม่เข้า' มี 'เงิน') · ตัวที่ตัดสินว่าลูกค้าได้การ์ดใบไหนคือ
     `NOTICE_CASE_ORDER` ไม่ใช่ลิสต์คำ · ถ้าวันหนึ่งอยากให้คำเต็มของภาษาหนึ่ง
     ผูกฝั่งเดียวจริง ๆ ต้องถอดคำร่วมของภาษานั้นออก ซึ่งเป็นการตัดสินใจคนละเรื่อง */
  const BOTH: Array<[string, string]> = [
    ['พม่า "ငွေသွင်း" มี "ငွေ"', 'ငွေသွင်း'],
    ['ลาว "ຝາກເງິນ" มี "ເງິນ"', 'ຝາກເງິນ'],
    ['เขมร "ដាក់លុយ" มี "លុយ"', 'ដាក់លុយ'],
    ['พม่า "ငွေထုတ်" มี "ငွေ"', 'ငွေထုတ်'],
    ['ลาว "ຖອນເງິນ" มี "ເງິນ"', 'ຖອນເງິນ'],
    ['เขมร "ដកលុយ" มี "លុយ"', 'ដកលុយ'],
    ['เขมร "ដាក់ប្រាក់" มี "ប្រាក់" (รูปธรรมดาที่เพิ่งเพิ่ม)', 'ដាក់ប្រាក់'],
    ['อังกฤษ "cash out" มี "cash" (รูปธรรมดาที่เพิ่งเพิ่ม)', 'cash out'],
  ];
  it.each(BOTH)('⭐⭐ %s ⇒ ติดทั้งสองฝั่ง', (_n, text) => {
    expect(matchDepositWord(text)).toBe(true);
    expect(matchWithdrawWord(text)).toBe(true);
  });
});

describe('[NOTICEWORDSI18N] ตัวพิมพ์ใหญ่-เล็ก', () => {
  it('⭐⭐ 🔴 "Deposit" / "WITHDRAW" ต้องติด — เดิม case-sensitive จึงหลุด', () => {
    expect(matchDepositWord('Deposit please')).toBe(true);
    expect(matchWithdrawWord('WITHDRAW NOW')).toBe(true);
    expect(matchDepositWord('Top Up')).toBe(true);
  });

  it('⭐⭐ 🔴 ทุกคำ Latin ในลิสต์ต้องเก็บเป็นตัวพิมพ์เล็ก ไม่งั้นเป็นคำตาย', () => {
    /* `matchAny` แปลงข้อความเป็นตัวเล็กก่อนเทียบ ⇒ คำในลิสต์ที่มีตัวใหญ่
       จะไม่มีวัน match · ด่านนี้จับคนที่เติมคำใหม่แล้วเผลอพิมพ์ตัวใหญ่ */
    const bad = [...DEPOSIT_WORDS, ...WITHDRAW_WORDS].filter(
      (w) => /[A-Za-z]/.test(w) && w !== w.toLowerCase(),
    );
    expect(bad).toEqual([]);
  });
});

describe('[NOTICEWORDSI18N] สุขภาพของลิสต์หลังเติม 5 ภาษา', () => {
  it('⭐⭐ ไม่มีคำตาย — ทุกคำต้องจับตัวเองได้', () => {
    for (const w of DEPOSIT_WORDS) expect(matchDepositWord(w)).toBe(true);
    for (const w of WITHDRAW_WORDS) expect(matchWithdrawWord(w)).toBe(true);
  });

  it('⭐⭐ ไม่มีคำซ้ำเป๊ะ และไม่มีคำที่มีช่องว่างหน้า-หลังหลงเหลือ', () => {
    /* เว้นวรรคนำหน้าทำให้คำกลายเป็นคำตายเงียบ ๆ — เจอมาแล้วตอนเติม '存款' */
    for (const w of [...DEPOSIT_WORDS, ...WITHDRAW_WORDS]) {
      expect(w).toBe(w.trim());
      expect(w.length).toBeGreaterThan(0);
    }
    expect(new Set(DEPOSIT_WORDS).size).toBe(DEPOSIT_WORDS.length);
    expect(new Set(WITHDRAW_WORDS).size).toBe(WITHDRAW_WORDS.length);
  });
});

/**
 * [FEAT-20260831-NOTICEWORDSLOW] "นาน" + คำแปล 5 ภาษา (เจ้าของสั่ง 31/08)
 *
 * *"เติม keyword notice ทั้ง withdraw และ deposit = นาน แปลภาษาด้วย"*
 * เป็น **คำร่วมสองฝั่ง** เหมือนบล็อกคำร่วมเดิม — ลูกค้าบ่นเรื่องเวลาโดยยังไม่บอกฝั่ง
 */
describe('[NOTICEWORDSLOW] คำว่า "นาน" และคำแปล — ต้องติดทั้งสองฝั่ง', () => {
  const BOTH = [
    'นาน',
    'รอนานมาก',
    'ทำไมนานจัง',
    'why so slow',
    'how long?',
    'payment delayed', // 'delayed' — ขอบคำทำให้ 'delay' ไม่ครอบ ต้องมีคู่
    'it is delay',
    'ငွေထုတ် ကြာတယ်', // พม่า
    'နှေးတယ်', // พม่า — ช้า
    '太慢了', // จีน
    '很久没到账', // จีน
    '多久', // จีน
    'ຊ້າຫຼາຍ', // ลาว
    'ດົນແລ້ວ', // ลาว
    'យូរណាស់', // เขมร
    'យឺតពេក', // เขมร
  ];

  it.each(BOTH)('⭐⭐ "%s" → ติดทั้งฝากและถอน', (text) => {
    expect(matchDepositWord(text)).toBe(true);
    expect(matchWithdrawWord(text)).toBe(true);
  });

  it('⭐⭐ 🔴 พม่า "ကြာသပတေး" (วันพฤหัสบดี) ต้องไม่ติด', () => {
    /* เหตุผลที่ลิสต์ใช้ 'ကြာတယ်' ไม่ใช่ 'ကြာ' เดี่ยว — 'ကြာ' อยู่ในคำว่าวันพฤหัสฯ
       ลูกค้าบอกว่าจะถอนวันพฤหัสก็จะโดนการ์ดทันที · เอาคำเดี่ยวกลับมาเมื่อไหร่ เทสนี้แดง */
    expect(matchDepositWord('ကြာသပတေး')).toBe(false);
    expect(matchWithdrawWord('ကြာသပတေး')).toBe(false);
  });

  it('⭐⭐ 🔴 กฎ "ฝากช้า = ฝาก · ถอนช้า = ถอน" ต้องไม่พังจากการเติมคำชุดนี้', () => {
    /* ถ้าใครเผลอเติม 'ช้า' เดี่ยวลงสองฝั่ง (ซึ่งดูสมเหตุผลเวลาแปลคำว่า slow)
       เทสนี้จะแดงทันที — เป็นบั๊กจริงที่เคยเกิดมาแล้วเมื่อ 22/08 */
    expect(matchDepositWord('ฝากช้า')).toBe(true);
    expect(matchWithdrawWord('ฝากช้า')).toBe(false);
    expect(matchDepositWord('ถอนช้า')).toBe(false);
    expect(matchWithdrawWord('ถอนช้า')).toBe(true);
  });

  it('⭐ ข้อความอังกฤษที่ไม่เกี่ยวกับเวลา ต้องไม่ติดเพราะคำชุดนี้', () => {
    /* 'slow' / 'long' ใช้ขอบคำ จึงไม่ไปตรงกลางคำอื่น */
    expect(matchDepositWord('belong to me')).toBe(false);
    expect(matchWithdrawWord('belong to me')).toBe(false);
    expect(matchDepositWord('slowdown')).toBe(false);
  });
});
