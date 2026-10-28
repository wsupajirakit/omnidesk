/**
 * [FEAT-2708-SEARCHMIN4] (งาน 5.9) ค้นหา ticket + แชท ต้อง ≥4 ตัวอักษรถึงทำงาน
 * ===========================================================================
 * เจ้าของ 27/08: *"เซฟ request ด้วยการให้พิมพ์ ≥4 ตัวอักษร search ถึงจะทำงาน
 * ...บอกใน placeholder ด้วยว่า ค้นหาด้วย ชื่อ เบอร์ เลขที่บช (ขั้นต่ำ 4)
 * ...ช่อง search แชทข้อความด้วย"*
 *
 * จุดจริง (dive):
 *   · TicketChat: `debouncedSearch` คือตัวขับ request ฝั่ง server (serverSearch)
 *     — gate ที่ตัว setTimeout จุดเดียว = ทุก request ถูกเซฟ · ตัวกรองฝั่งจอ
 *     (memberMatchesSearch) ใช้ derived `activeSearch` ชุดเดียวกัน ให้ความหมาย
 *     "ต่ำกว่า 4 = ค้นหายังไม่ทำงานเลย" ตรงกันทุกชั้น
 *   · ChatRoomView: `runSearch` เดิม gate ที่ 2 ตัวอักษร + ปุ่ม disabled ที่ 2
 *     — ยกเป็น 4 ทั้งคู่ + placeholder บอกเลขจริง
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ticketChatSource } from './ticketChatSource';

// [REFACTOR-20261027-TCSPLIT] TICKET_SEARCH_MIN_CHARS moved to pages/chat/ticket-chat/ —
// read the page with its pieces (test/ticketChatSource.ts); assertions unchanged
const ticketChat = ticketChatSource();
const chatRoom = readFileSync(
  join(__dirname, '..', 'components', 'chat', 'ChatRoomView.tsx'),
  'utf8',
);

describe('[SEARCHMIN4] ticket search (TicketChat)', () => {
  it('⭐⭐ ตัวขับ request ถูก gate ที่ 4 ตรงจุด debounce', () => {
    expect(ticketChat).toMatch(
      /setDebouncedSearch\(\s*\w+\.length >= TICKET_SEARCH_MIN_CHARS \? \w+ : ''\s*\)/,
    );
    expect(ticketChat).toContain('const TICKET_SEARCH_MIN_CHARS = 4');
  });

  it('⭐ ตัวกรองฝั่งจอใช้ derived ตัวเดียวกัน — ต่ำกว่า 4 = ไม่กรองอะไรเลย', () => {
    expect(ticketChat).toContain('const activeSearch =');
    // ไม่มีจุดไหนกรองด้วย searchPhone ดิบอีก (state/setter/derive เองไม่นับ)
    const raw = (ticketChat.match(/searchPhone/g) ?? []).length;
    const allowed = (ticketChat.match(/setSearchPhone|\[searchPhone\]|useState|const activeSearch|value=\{searchPhone\}|searchPhone\.trim\(\)\.length/g) ?? []).length;
    expect(raw).toBeLessThanOrEqual(allowed + 2);
  });

  it('⭐ placeholder บอกขอบเขต + ขั้นต่ำ 4', () => {
    expect(ticketChat).toContain('ค้นหาด้วย ชื่อ เบอร์ เลขที่บช (ขั้นต่ำ 4 ตัวอักษร)');
    expect(ticketChat).toMatch(/Search name \/ phone \/ account no\. \(min 4 chars\)/);
  });
});

describe('[SEARCHMIN4] chat message search (ChatRoomView)', () => {
  it('⭐⭐ runSearch + ปุ่ม gate ที่ 4 — เลข 2 เดิมต้องหายทั้งคู่', () => {
    expect(chatRoom).toContain('CHAT_SEARCH_MIN_CHARS = 4');
    expect(chatRoom).toMatch(/q\.length < CHAT_SEARCH_MIN_CHARS/);
    expect(chatRoom).toMatch(/searchQ\.trim\(\)\.length < CHAT_SEARCH_MIN_CHARS/);
    expect(chatRoom).not.toMatch(/q\.length < 2/);
    expect(chatRoom).not.toMatch(/searchQ\.trim\(\)\.length < 2/);
  });

  it('⭐ placeholder บอก 4', () => {
    expect(chatRoom).toContain('ค้นหาข้อความในห้องนี้ (อย่างน้อย 4 ตัวอักษร)');
    expect(chatRoom).not.toContain('อย่างน้อย 2 ตัวอักษร');
  });
});
