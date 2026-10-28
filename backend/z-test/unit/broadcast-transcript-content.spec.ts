/**
 * [FIX-20260828-TRANSCRIPTVARS] สำเนาในห้องแชท = ข้อความที่ส่งจริง
 * ===========================================================================
 * เจ้าของ 28/08: *"multicast แบบ tag profile/site (`_x`) ต้องเก็บ msg ที่ส่งจริง
 * เข้า chat msg · แอป LINE ฝั่งลูกค้าถูกแล้ว ได้ข้อความถูกแล้ว"*
 *
 * 🔴 บั๊กที่แก้: ตัวส่งอ่านข้อความจาก builder ที่แทนค่าแท็กต่อ OA ไว้แล้ว ส่วน
 *    ตัวเขียนสำเนาอ่านการ์ดที่เซฟไว้ ⇒ ลูกค้าเห็นข้อความถูก แต่ห้องแชทเก็บ
 *    `{{hook_domain}}` ดิบ · การส่งสำเร็จทุกประการ จึงไม่มีอะไรฟ้อง
 *
 * ⚠️ ไฟล์นี้เทส **ฟังก์ชันตรง ๆ** ไม่ขับทั้ง service — การขับทั้ง service ต้องสร้าง
 *    pager double ทั้งใบเพื่อพิสูจน์การแปลงสองบรรทัด ซึ่งบวมเกินกว่าสิ่งที่พิสูจน์
 *    ส่วน "เส้นส่งไม่ถูกกระทบ" ปักไว้ที่ `broadcast-new-send-service.spec.ts`
 */
import { transcriptContentFrom } from '@/modules/content/broadcast-transcript';

/** payload ตามรูปที่ `buildBroadcastMessage` สร้างจริง */
const textPayload = (text: string) => ({ type: 'text', text });
const imagePayload = (url: string) => ({
  type: 'image',
  originalContentUrl: url,
  previewImageUrl: url,
});
const flexPayload = (contents: unknown) => ({
  type: 'flex',
  altText: 'Broadcast message',
  contents,
});

describe('[TRANSCRIPTVARS] ข้อความ', () => {
  it('⭐⭐ 🔴 เก็บข้อความที่ส่งจริง ไม่ใช่ template ที่ยังมีแท็กดิบ', () => {
    const out = transcriptContentFrom(textPayload('สวัสดีชาว one.example'), {
      type: 'text',
      text: 'สวัสดีชาว {{hook_domain}}',
    });

    expect(out.content).toBe('สวัสดีชาว one.example');
    expect(out.content).not.toContain('{{');
  });

  it('⭐⭐ 🔴 ไม่มี payload (OA ที่ไม่ได้สร้าง / โหมด personal) ⇒ ตกกลับไปใช้การ์ด', () => {
    /* ข้อความที่ยังไม่แทนค่า ยังอ่านรู้เรื่องกว่าห้องแชทที่ว่างเปล่า */
    const out = transcriptContentFrom(undefined, {
      type: 'text',
      text: 'สวัสดีชาว {{hook_domain}}',
    });
    expect(out.content).toBe('สวัสดีชาว {{hook_domain}}');
  });

  it('⭐ การ์ดข้อความว่างและไม่มี payload ⇒ สตริงว่าง ไม่ใช่ undefined', () => {
    /* 🔴 `content` ต้องเป็น string เสมอ — หน้าแชทเรียก `.includes()` บนค่านี้
       ค่า undefined จะทำให้ทั้งหน้าแชทพัง (มีบันทึกไว้ที่ `transcript.writer.ts`) */
    const out = transcriptContentFrom(undefined, { type: 'text' });
    expect(out.content).toBe('');
    expect(typeof out.content).toBe('string');
  });
});

describe('[TRANSCRIPTVARS] รูปภาพ', () => {
  it('⭐⭐ เก็บ URL ที่ส่งจริง ไม่ใช่ URL ที่ยังไม่แทนค่า', () => {
    const out = transcriptContentFrom(
      imagePayload('https://cdn.example/one.png'),
      { type: 'image', image_url: 'https://cdn.example/{{hook_domain}}.png' },
    );
    expect(out.content).toBe('https://cdn.example/one.png');
  });

  it('⭐ ไม่มี payload ⇒ ใช้ URL จากการ์ด', () => {
    const out = transcriptContentFrom(undefined, {
      type: 'image',
      image_url: 'https://cdn.example/raw.png',
    });
    expect(out.content).toBe('https://cdn.example/raw.png');
  });
});

describe('[TRANSCRIPTVARS] flex', () => {
  it('⭐⭐ 🔴 การ์ดที่เก็บต้องเป็นตัวที่แทนค่าแล้ว', () => {
    const rendered = { type: 'bubble', body: { text: 'one.example' } };
    const out = transcriptContentFrom(flexPayload(rendered), {
      type: 'flex',
      flex_json: { type: 'bubble', body: { text: '{{hook_domain}}' } },
    });

    expect(out.flexJson).toEqual(rendered);
  });

  it('⭐⭐ 🔴 `content` ของ flex เป็นป้ายสตริง ไม่ใช่ตัวการ์ด', () => {
    /* 🔴 ยัด object ลง `content` = หน้าแชทพังทั้งหน้า (`ChatRoomView` เรียก
       `.includes()` บนค่านี้) · ตัวการ์ดต้องไปอยู่ `metadata.flex_json` */
    const out = transcriptContentFrom(
      flexPayload({ type: 'bubble' }),
      {
        type: 'flex',
        flex_json: { type: 'bubble' },
      },
      'august promo',
    );

    expect(typeof out.content).toBe('string');
    expect(out.content).toBe('[Flex] august promo');
  });

  it('⭐ ไม่มีชื่อแคมเปญ ⇒ ป้ายยังอ่านออก ไม่ใช่ undefined', () => {
    const out = transcriptContentFrom(undefined, { type: 'flex' });
    expect(out.content).toBe('[Flex] broadcast');
  });

  it('⭐ ไม่มี payload ⇒ ใช้การ์ดที่เซฟไว้', () => {
    const saved = { type: 'bubble', body: { text: '{{hook_domain}}' } };
    const out = transcriptContentFrom(undefined, {
      type: 'flex',
      flex_json: saved,
    });
    expect(out.flexJson).toEqual(saved);
  });
});

describe('[TRANSCRIPTVARS] ชนิดมาจากการ์ด ไม่ใช่จาก payload', () => {
  it('⭐⭐ 🔴 payload ชนิดหนึ่ง การ์ดอีกชนิด ⇒ ยึดการ์ด', () => {
    /* `chat_messages.message_type` เป็นคำศัพท์ของฝั่งแชท ไม่ใช่ของ LINE
       และชนิดไม่มีทางเปลี่ยนระหว่างแทนค่า ⇒ ยึดการ์ดคือคำตอบที่ถูก
       ถ้ายึด payload วันหนึ่งที่ LINE เปลี่ยนรูป สำเนาจะถูกจัดผิดชนิดเงียบ ๆ */
    const out = transcriptContentFrom(textPayload('เผลอเป็น text'), {
      type: 'image',
      image_url: 'https://cdn.example/raw.png',
    });
    /* การ์ดเป็น image ⇒ อ่าน originalContentUrl ซึ่ง payload text ไม่มี ⇒ ตกกลับ */
    expect(out.content).toBe('https://cdn.example/raw.png');
  });
});
