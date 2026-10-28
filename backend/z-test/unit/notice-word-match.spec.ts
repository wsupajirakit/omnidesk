/**
 * [FEAT-20260824-NOTICEWORDS] คำที่เจ้าของสั่งเพิ่ม — และกติกาการจับคำทั้งหมด
 * ===========================================================================
 * ⚠️ ไฟล์นี้เคยเป็น **ไฟล์ว่าง 0 ไบต์** อยู่ในโฟลเดอร์ ทำให้ jest แดงด้วย
 * "Your test suite must contain at least one test" ทุกครั้งที่รันทั้งชุด และ —
 * ที่แย่กว่า — แปลว่าคำที่เพิ่มเข้าไปเมื่อ 24/08 (`เติม` · `ลด` · `ปรับ`)
 * **ไม่มีอะไรคุมเลยสักตัว** ใครลบทิ้งก็ไม่มีเทสไหนรู้
 * ไฟล์ว่างอ่านเหมือน "มีเทสแล้ว" — อันตรายกว่าไม่มีไฟล์เลย.
 *
 * กติกาที่ตรึงไว้ที่นี่:
 *   · จับแบบ **substring** ไม่ใช่คำเต็ม (`text.includes(w)`) — ตั้งใจ เพราะลูกค้า
 *     พิมพ์ติดกันเป็นประโยคเดียว ไม่เว้นวรรค
 *   · ไม่ใช่ string หรือสตริงว่าง ⇒ `false` เสมอ (ห้าม throw — อยู่บนเส้น webhook)
 *   · คำที่อยู่ **ทั้งสองฝั่ง** ต้องจับได้ทั้งสองฝั่งจริง ๆ
 *
 * ⚠️ เพิ่ม/ลบคำเมื่อไหร่ ต้องมาเพิ่มเทสที่นี่ด้วย — และถ้าคำใหม่ไป**ชนฝั่งตรงข้าม**
 *   (เช่นคำที่มี 'เงิน' อยู่ข้างใน) เทส "ไม่ชนกัน" ข้างล่างจะแดงให้เห็นก่อนขึ้น prod
 *
 * revert: ลบไฟล์นี้ (จะกลับไปไม่มีอะไรคุมคำเหมือนเดิม)
 */
import {
  DEPOSIT_WORDS,
  WITHDRAW_WORDS,
  matchDepositWord,
  matchWithdrawWord,
} from '@/modules/webhook/notice-runtime';

describe('[FEAT-20260824-NOTICEWORDS] คำที่เจ้าของสั่งเพิ่ม 24/08', () => {
  it('⭐ "เติม" อยู่ฝั่งฝาก', () => {
    expect(DEPOSIT_WORDS).toContain('เติม');
    expect(matchDepositWord('พี่ครับผมเติมมาแล้วยังไม่เข้า')).toBe(true);
  });

  it('⭐ "ลด" อยู่ฝั่งถอน', () => {
    expect(WITHDRAW_WORDS).toContain('ลด');
    expect(matchWithdrawWord('ยอดลดไปแล้วแต่เงินยังไม่ออก')).toBe(true);
  });

  it('⭐ "ปรับ" อยู่ทั้งสองฝั่ง — เจ้าของสั่ง "เพิ่มเข้าไปทั้งสองฝั่ง"', () => {
    expect(DEPOSIT_WORDS).toContain('ปรับ');
    expect(WITHDRAW_WORDS).toContain('ปรับ');
    expect(matchDepositWord('รบกวนปรับให้หน่อย')).toBe(true);
    expect(matchWithdrawWord('รบกวนปรับให้หน่อย')).toBe(true);
  });
});

describe('[FEAT-20260822-NOTICERUNTIME] กติกาการจับคำ', () => {
  it('จับแบบ substring — ลูกค้าพิมพ์ติดกันก็ต้องเจอ', () => {
    expect(matchDepositWord('ฝากแล้วเงินไม่เข้าครับ')).toBe(true);
    expect(matchWithdrawWord('ถอนไม่ได้ทำไงดี')).toBe(true);
  });

  it('ข้อความที่ไม่มีคำไหนเลย ⇒ false ทั้งสองฝั่ง', () => {
    const chat = 'สวัสดีครับ';
    expect(matchDepositWord(chat)).toBe(false);
    expect(matchWithdrawWord(chat)).toBe(false);
  });

  it('ไม่ใช่ string / สตริงว่าง ⇒ false เสมอ ห้าม throw', () => {
    /* อยู่บนเส้นทาง webhook — พังที่นี่ = ลูกค้าไม่ได้รับคำตอบ */
    for (const bad of [undefined, null, '', 0, 123, {}, [], true]) {
      expect(matchDepositWord(bad)).toBe(false);
      expect(matchWithdrawWord(bad)).toBe(false);
    }
  });

  it('ทุกคำในลิสต์ต้องจับตัวเองได้ — ไม่มีคำตายในลิสต์', () => {
    /* กันคำที่พิมพ์ผิดจนไม่มีวัน match อะไรเลย (เช่นมีช่องว่างเกินมา) */
    for (const w of DEPOSIT_WORDS) expect(matchDepositWord(w)).toBe(true);
    for (const w of WITHDRAW_WORDS) expect(matchWithdrawWord(w)).toBe(true);
  });

  it('คำเฉพาะฝั่งต้องไม่ข้ามฝั่ง', () => {
    /* `ฝาก` ไม่ควรทำให้ฝั่งถอนติด และ `ถอน` ไม่ควรทำให้ฝั่งฝากติด
       ⚠️ ถ้าวันหนึ่งเทสนี้แดง แปลว่าคำที่เพิ่งเพิ่มไปมีคำร่วมซ่อนอยู่ข้างใน
          ให้ดูก่อนว่า "ตั้งใจ" หรือ "เผลอ" — อย่าลบเทสทิ้ง */
    expect(matchWithdrawWord('ฝาก')).toBe(false);
    expect(matchDepositWord('ถอน')).toBe(false);
  });
});
