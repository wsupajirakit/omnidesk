import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * [FIX-20260827-TKTMEMBERPARAM] float-up ต้องเรียกด้วยชื่อที่ตรงความหมาย
 * ============================================================================
 * 📖 omnidesk-api/todo/task/27082026/todo1_27082026_tickets-line-user-id-fix.md
 *
 * `tickets.line_user_id` เก็บ member `_id` **ไม่ใช่** LINE id — ชื่อโกหกมาจาก
 * legacy และ BE เคย**ตัดตัวกรองทิ้งเงียบ ๆ** เมื่อค่าไม่ใช่ ObjectId ⇒ การเรียก
 * ที่พึ่ง `limit:'all'` โดยมีตัวกรองนี้เป็นตัวจำกัด กลายเป็นดึงไม่จำกัดทันที
 * ตอนนี้ BE 400 เมื่อผิดรูป และ FE เรียกด้วย `member_id` ชื่อที่ตรงความหมาย
 *
 * ⚠️ เทสระดับซอร์สแบบเดียวกับ multiCheckDropUp call-site test — เพราะสิ่งที่พัง
 * ได้คือ "จุดเรียกส่งชื่ออะไร" ไม่ใช่ตรรกะที่ mount ได้ใน jsdom
 */
const TC = readFileSync(join(process.cwd(), 'pages/chat/TicketChat.tsx'), 'utf8');
const SVC = readFileSync(
  join(process.cwd(), 'services/chat/ticketService.ts'),
  'utf8',
);

describe('[FIX-20260827-TKTMEMBERPARAM] float-up ใช้ member_id', () => {
  it('⭐ จุดเรียก float-up ส่ง member_id ไม่ใช่ line_user_id', () => {
    /* 🔴 mutation: เปลี่ยนกลับเป็น `line_user_id: mid` — เทสอื่นเขียวหมด
       แต่ FE จะกลับไปพิงชื่อลวง และคนต่อไปที่ copy ท่านี้จะส่ง LINE id */
    expect(TC).toMatch(/member_id:\s*mid/);
    expect(TC).not.toMatch(/line_user_id:\s*mid[,\s]/);
  });

  it('service ส่ง member_id ขึ้น query จริง (ทั้งเส้น hook และ group)', () => {
    const hits = SVC.match(/searchParams\.append\('member_id', params\.member_id\)/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('⭐ float-up ประกาศบริบทด้วยรูปของค่า — 24hex→member_id · อื่น→channel_user_id', () => {
    /* [FIX-20260827-CHANNELUSERPARAM] proven live: the WS leg feeds `mid` an
       external `Uxxx…` id and the pinned leg feeds a Mongo _id. The two spaces
       are disjoint (24-hex vs 33-char U-prefixed), so the ternary's shape test
       IS the context declaration. Mutations this kills: dropping the ternary
       (always member_id → WS leg 400s again) or inverting it. */
    expect(TC).toMatch(/\/\^\[0-9a-f\]\{24\}\$\/i\.test\(mid\)/);
    expect(TC).toMatch(/\{ member_id: mid \}/);
    expect(TC).toMatch(/\{ channel_user_id: mid \}/);
    // service ส่งชื่อกลางขึ้น query จริงทั้งสองเส้น
    const hits = SVC.match(/searchParams\.append\('channel_user_id', params\.channel_user_id\)/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('line_user_id เดิมยังอยู่ — alias เก่าห้ามหายจนกว่า log ยืนยันไม่มีผู้เรียก', () => {
    const hits = SVC.match(/searchParams\.append\('line_user_id', params\.line_user_id\)/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
