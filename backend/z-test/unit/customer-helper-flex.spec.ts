import {
  HELPER_ALT_TEXT,
  HELPER_BODY_TEXT,
  HELPER_BTN_ADMIN_LABEL,
  HELPER_BTN_ADMIN_TEXT,
  HELPER_BTN_CONNECT_LABEL,
  HELPER_FALLBACK_URI,
  buildCustomerHelperFlex,
} from '@/modules/webhook/hook-reply/customer-helper-flex';

/**
 * [FEAT-20260810-HELPERFLEX] สัญญาของการ์ด customer-helper
 *
 * สิ่งที่ล็อกไว้ที่นี่ และเหตุผลที่ต้องล็อก:
 *   (A) โครงการ์ด — LINE ปฏิเสธทั้งข้อความถ้ารูปไม่ถูก ลูกค้าจะไม่ได้อะไรเลย
 *   (B) FALLBACK — ปุ่มต้องมี uri ที่ใช้ได้เสมอ แม้ OA ยังไม่ได้ตั้ง landing url
 *   (C) ปุ่มที่สองเป็น `message` ไม่ใช่ postback — ถ้าเปลี่ยนเป็น postback
 *       จะไม่มี handler รับ ลูกค้ากดแล้วเงียบ
 * เทสนี้ต้องพังถ้ามีคนเปลี่ยนชนิดปุ่มหรือถอด fallback ออก.
 */

type Box = { contents: Array<Record<string, any>> };

const bubbleOf = (uri?: string | null) =>
  buildCustomerHelperFlex(uri) as unknown as {
    type: string;
    body: Box;
    footer: Box;
    hero?: unknown;
  };

describe('buildCustomerHelperFlex — โครงการ์ด', () => {
  it('เป็น bubble ที่มี body + footer และ **ไม่มี hero**', () => {
    const b = bubbleOf('https://landing.example/x?t=tok');
    expect(b.type).toBe('bubble');
    expect(b.body).toBeDefined();
    expect(b.footer).toBeDefined();
    // เจ้าของตัด hero ออกจาก JSON รอบสอง — ใส่กลับมาโดยไม่ตั้งใจต้องถูกจับได้
    expect(b.hero).toBeUndefined();
  });

  it('ข้อความบนการ์ดตรงกับที่ตกลงไว้ และ wrap เพื่อไม่ให้ตัดคำ', () => {
    const text = bubbleOf('https://a.test/x').body.contents[0]!;
    expect(text.type).toBe('text');
    expect(text.text).toBe(HELPER_BODY_TEXT);
    // ข้อความยาว ถ้า wrap หลุดจะโดนตัดท้ายบนมือถือ
    expect(text.wrap).toBe(true);
  });

  it('มี 2 ปุ่มเรียงตามลำดับ: เชื่อมต่อ แล้วค่อยติดต่อแอดมิน', () => {
    const contents = bubbleOf('https://a.test/x').footer.contents;
    const connect = contents[0]!;
    const admin = contents[1]!;
    expect(connect.action.label).toBe(HELPER_BTN_CONNECT_LABEL);
    expect(admin.action.label).toBe(HELPER_BTN_ADMIN_LABEL);
    // ปุ่มหลักต้องเด่นกว่า — ลูกค้าควรเห็นทางที่เราอยากให้ไปก่อน
    expect(connect.style).toBe('primary');
    expect(admin.style).toBe('secondary');
  });
});

describe('buildCustomerHelperFlex — ปุ่มเชื่อมต่อ (uri)', () => {
  it('ใช้ URL ที่ mint มาเมื่อค่าถูกต้อง', () => {
    const uri = 'https://customer.example.com/?t=ENCTOKEN';
    expect(bubbleOf(uri).footer.contents[0]!.action.uri).toBe(uri);
  });

  it('ตกไป FALLBACK เมื่อไม่มีค่า — OA ยังไม่ได้ตั้ง landing url', () => {
    for (const bad of [null, undefined, '']) {
      expect(bubbleOf(bad as never).footer.contents[0]!.action.uri).toBe(
        HELPER_FALLBACK_URI,
      );
    }
  });

  it('ตกไป FALLBACK เมื่อค่าไม่ใช่ http(s) — LINE ปฏิเสธทั้งข้อความถ้า uri เพี้ยน', () => {
    for (const bad of [
      'ftp://x.test',
      'javascript:alert(1)',
      'mint xxxx',
      '/relative',
    ]) {
      expect(bubbleOf(bad).footer.contents[0]!.action.uri).toBe(
        HELPER_FALLBACK_URI,
      );
    }
  });

  it('FALLBACK คือ google.com ตามที่เจ้าของสั่ง — ไม่ใช่ landing กลาง', () => {
    // ตั้งใจต่างจาก CUSTOMER_LANDING_DEFAULT_URL ของ customer-register:
    // เคสนี้ต้อง "ดูออกว่าลืมตั้งค่า" ไม่ใช่พาลูกค้าไป landing ของเจ้าอื่น
    expect(HELPER_FALLBACK_URI).toBe('https://google.com');
    expect(HELPER_FALLBACK_URI).not.toContain('omnidesk');
  });
});

describe('buildCustomerHelperFlex — ปุ่มติดต่อแอดมิน', () => {
  it('เป็น action ชนิด message ที่ส่งข้อความกลับเข้าระบบ', () => {
    const admin = bubbleOf('https://a.test/x').footer.contents[1]!;
    // ⚠️ ต้องเป็น 'message' — ถ้าเปลี่ยนเป็น postback จะไม่มี handler รับ
    // ลูกค้ากดแล้วเงียบ ซึ่งแย่กว่าไม่มีปุ่มเลย
    expect(admin.action.type).toBe('message');
    expect(admin.action.text).toBe(HELPER_BTN_ADMIN_TEXT);
  });
});

describe('buildCustomerHelperFlex — ค่าคงที่', () => {
  it('altText ไม่ว่าง — LINE ปฏิเสธข้อความที่ altText ว่าง', () => {
    expect(HELPER_ALT_TEXT.trim().length).toBeGreaterThan(0);
  });
});
