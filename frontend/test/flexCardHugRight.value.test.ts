/**
 * [UI-20260826-FLEXHUGRIGHT] การ์ด flex ของบอทต้องชิดขวา
 * ============================================================================
 * เจ้าของแจ้ง 26/08 พร้อมภาพ: *"flex ใน chat room ชิดขวาอีกได้ไหม
 * bubble flex มันออกห่างจากขวาเกินไป"*
 *
 * 🔴 ทำไมเทสอ่าน "ซอร์ส" ไม่ใช่เรนเดอร์ DOM: อาการนี้เป็นผลของกล่องครอบใน
 *    `ChatRoomView` (`max-w-[75%] w-fit`) คูณกับเพดานของการ์ด (`max-w-[380px]`)
 *    ซึ่ง jsdom วัดความกว้างไม่ได้เลย (ทุกอย่างกว้าง 0) ⇒ เทส DOM จะเขียวทั้งที่
 *    ของจริงพัง · สิ่งที่ตรึงได้จริงคือ **คลาสที่ตัดสินการจัดวาง** อยู่ครบทั้งสองเส้นทาง
 *
 * ⚠️ FlexSlipCard คืนค่าได้ 2 ทาง (ตัวเรนเดอร์ใหม่ `USE_FLEX_RENDER` และตัวเก่า)
 *    ถ้าใส่ทางเดียว การ์ดบางใบจะชิดขวา บางใบไม่ชิด — เคสนี้จึงนับให้ครบทั้งสอง
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '../components/chat/FlexSlipCard.tsx'), 'utf8');

describe('[FLEXHUGRIGHT] การ์ด flex ของบอทชิดขวา ของลูกค้ายังชิดซ้าย', () => {
  it('⭐ (TARGET) ราก **ทุกเส้นทาง** ที่มีเพดาน 380px ต้องพก ${hugRight}', () => {
    /* นับรากที่ประกาศ `max-w-[380px]` แล้วเทียบกับจำนวนที่พก hugRight
       ถ้าวันหลังมีเส้นทางที่สาม เคสนี้จะแดงทันทีแทนที่จะเงียบ */
    /* จับเฉพาะ "ราก JSX" ด้วย `w-full max-w-[380px]` · ถ้าจับแค่ `max-w-[380px]`
       เฉย ๆ จะไปนับคอมเมนต์ที่อ้างถึงคลาสนี้ด้วย แล้วเคสจะแดงแบบหลอก ๆ */
    const roots = src.match(/w-fit max-w-\[380px\]/g) ?? [];
    const hugged = src.match(/w-fit max-w-\[380px\][^`"]*\$\{hugRight\}/g) ?? [];
    expect({ roots: roots.length, hugged: hugged.length }).toEqual({
      roots: roots.length,
      hugged: roots.length,
    });
    expect(roots.length).toBeGreaterThanOrEqual(2);
  });

  it('⭐ (PIN) ฝั่งลูกค้าต้องไม่ถูกดันไปขวา', () => {
    /* `ml-auto` แบบไม่มีเงื่อนไขคือบั๊กที่เคสนี้กัน — การ์ดฝั่งลูกค้าต้องเกาะซ้าย */
    /* รอบ 4: `ml-auto` ถูกแทนด้วย flex+justify เพราะ `.flex-preview` ของไลบรารี
       เป็น block `width:auto` ที่กางเต็มกล่องเสมอ ⇒ margin auto ไม่มีที่ว่างให้ดัน
       (เหตุผลเต็มอยู่ในหัวไฟล์ FlexSlipCard.tsx) */
    expect(src).toContain("'flex justify-end tc-flex-right'");
  });

  it('⭐ (PIN) ความกว้างเดิมห้ามขยับ — เจ้าของขอให้ชิดขวา ไม่ได้ขอให้ใหญ่ขึ้น', () => {
    expect(src).toContain('max-w-[380px]');
    expect(src).not.toContain('max-w-[420px]');
  });

  it('⭐ (TARGET รอบ 2) รากต้อง `w-fit` ไม่ใช่ `w-full` — ไม่งั้น ml-auto ไม่มีที่ให้ดัน', () => {
    /* `w-full` = width:100% ⇒ กล่องกางเต็มกล่องครอบ margin auto จึงไม่ขยับอะไรเลย
       เคสนี้คือสิ่งที่จับได้ตอนเจ้าของแจ้งว่า "flex ยังไม่ชิดขวา" หลังแก้รอบแรก */
    expect(src).not.toContain('w-full max-w-[380px]');
  });

  it('⭐ (TARGET รอบ 5) ต้องมีกฎ CSS ที่เจาะถึง `.flex-preview` ด้วย', () => {
    /* คลาสฝั่ง React อย่างเดียวไม่พอ — ช่องว่างที่เหลือเกิด **ข้างใน** HTML ที่
       `flex-render` ปล่อยมาทาง dangerouslySetInnerHTML ซึ่ง React แตะไม่ถึง
       (`.flex-preview` กางเต็มกล่อง · `.LyMe` หยุดที่ max-width 300px แล้วชิดซ้าย)
       เคสนี้กันไม่ให้ใครลบกฎใน index.css ทิ้งแล้วอาการกลับมาแบบเงียบ ๆ */
    const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
    expect(css).toContain('.tc-flex-right .flex-preview');
    expect(css).toContain('justify-content: flex-end');
  });

  it('⭐ (TARGET รอบ 6) การ์ดแบบ carousel ต้องมีกฎของตัวเอง', () => {
    /* 🔴 "ทำไมมีปัญหาอยู่ใบเดียว" — เพราะการ์ดแจ้งสถานะเป็น `type: "carousel"`
       ซึ่งไลบรารีปล่อยโครงคนละแบบกับ bubble เดี่ยว:
         .flex-preview > .LySlider > .lyInner (display:flex; width:100%) > .lyItem
       `.lyInner` บังคับ `width:100%` ⇒ กฎที่ `.flex-preview` ดันอะไรไม่ได้เลย
       เคสนี้กันไม่ให้ใครลบกฎของ carousel ทิ้งเพราะคิดว่าซ้ำกับกฎด้านบน */
    const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
    expect(css).toContain('.LySlider .lyInner');
  });
});
