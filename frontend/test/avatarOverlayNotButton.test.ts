import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

/**
 * [FIX-20260826-AVATARCOVER] ตัวคลุม avatar ห้ามเป็น <button> เด็ดขาด
 * ===========================================================================
 * เจ้าของแจ้ง 26/08 พร้อมภาพ 3 รอบ: *"ซ้าย กลางขึ้น ขวาดันไม่มีรูป"* — รูปเดียวกัน
 * ขึ้นที่การ์ดซ้ายและหัวแชทกลาง แต่ panel ขวาเป็นวงกลมว่าง
 *
 * 🔴 ต้นเหตุ ไม่ใช่รูป ไม่ใช่ข้อมูล — ยิง URL จริงได้ HTTP 200 · 39,645 bytes
 * และ panel ก็โชว์ "ชื่อ" ถูกต้อง แปลว่า `line_user_data` มาครบ
 *
 * ตัวจริงคือกฎใน `index.html:495`:
 *     html:not(.theme-dark) .tc-col-right button:not(.text-primary)
 *       { background-color:#E2E8F0 !important }
 * ปุ่มคลุม avatar ของฟีเจอร์ strike เป็น `<button>` + `inset-0` + `z-10`
 * ⇒ โดนกฎนี้ยัดพื้นหลังเทาทึบทับรูปพอดี · เห็นเฉพาะ panel ขวาเพราะมีแต่คอลัมน์นี้
 * ที่ติดคลาส `tc-col-right` (`TicketChat.tsx:4058`)
 *
 * ⚠️ ห้ามแก้ด้วย `bg-transparent` — กฎนั้นเป็น `!important` และ specificity สูงกว่า
 * (0,3,2) คลาสเดี่ยวยังไงก็แพ้ · selector ยิงที่ **ตัว tag** ⇒ ทางเดียวคือไม่เป็น tag นั้น
 */
const SRC = ticketChatSource();

/** ก้อน JSX ของตัวคลุม avatar เท่านั้น ไม่ใช่ทั้งไฟล์ */
const overlay = (() => {
  const i = SRC.indexOf('data-testid="strike-avatar-button"');
  expect(i).toBeGreaterThan(-1);
  return SRC.slice(Math.max(0, i - 1200), i + 2600);
})();

describe('ตัวคลุม avatar ใน panel ขวา', () => {
  it('⭐ ต้องไม่ใช่ <button> — ไม่งั้นรูปโดนพื้นหลังทับหาย', () => {
    /* 🔴 mutation ที่เคสนี้ฆ่า: เปลี่ยน <span role="button"> กลับเป็น <button>
       แล้ว avatar จะกลายเป็นวงกลมว่างทันที โดยไม่มีเทสอื่นแดงเลย */
    expect(overlay).toMatch(/<span\s/);
    expect(overlay).not.toMatch(/<button\s[^>]*data-testid="strike-avatar-button"/);
    expect(overlay).not.toMatch(/type="button"[\s\S]{0,200}strike-avatar-button/);
  });

  it('ยังกดด้วยคีย์บอร์ดได้ (span ไม่ได้มาให้ฟรีเหมือน button)', () => {
    expect(overlay).toMatch(/role="button"/);
    expect(overlay).toMatch(/tabIndex=\{0\}/);
    expect(overlay).toMatch(/onKeyDown=/);
    expect(overlay).toMatch(/e\.key === 'Enter'/);
  });

  it('ยังคลุมเต็มวงและอยู่เหนือรูป (ไม่งั้นกดไม่โดน)', () => {
    expect(overlay).toMatch(/absolute inset-0/);
    expect(overlay).toMatch(/z-10/);
  });

  it('⭐ กฎที่ทำให้พังยังอยู่ใน index.html จริง — ไม่ได้กันบั๊กที่ไม่มีอยู่', () => {
    /* ถ้าวันหนึ่งกฎนี้ถูกลบ เทสนี้จะแดงและคนอ่านจะรู้ว่ากลับไปใช้ <button> ได้แล้ว
       แทนที่จะถือ span ไว้ตลอดกาลโดยไม่มีใครรู้ว่าทำไม */
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/\.tc-col-right button:not\(\.text-primary\)/);
    expect(html).toMatch(/background-color: #E2E8F0 !important/);
  });
});
