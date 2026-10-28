/**
 * [FIX-20260830-STICKERAVATAR] an incoming STICKER shows the customer's avatar,
 * exactly like every other incoming bubble.
 *
 * 🔴 The bug: the sticker branch returns before the normal bubble row, and only
 *    that row drew an avatar — so a customer sticker had none.
 * The fix is ONE shared element used by both rows, so they cannot drift apart.
 * These are source contracts: the avatar is markup, and the drift is what bites.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
  resolve(__dirname, '../components/chat/ChatRoomView.tsx'),
  'utf8',
);
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('one avatar definition, used twice', () => {
  it('the shared element exists', () => {
    expect(CODE).toMatch(/const customerAvatar =/);
  });

  it('⭐ it is used by BOTH rows — the sticker row and the text row', () => {
    const uses = CODE.match(/msg\.sender_type === 'customer' && customerAvatar/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it('🔴 the avatar markup exists exactly ONCE — that is how the rows drifted', () => {
    /* the old inline pair (picture_url ? <img w-8 h-8/> : <div bg-slate-300/>)
       lived in the text row only. Now it exists once — inside `customerAvatar` —
       and both rows point at it. Exactly 1, never 2: a second copy is the drift
       this file exists to stop. (0 would mean the avatar vanished entirely.) */
    const imgs = CODE.match(/activeRoom\.user_data\.picture_url\} className="w-8 h-8/g) ?? [];
    expect(imgs.length).toBe(1);
    const at = CODE.indexOf('const customerAvatar =');
    const defEnd = at + 420;
    expect(CODE.indexOf('activeRoom.user_data.picture_url} className="w-8 h-8')).toBeGreaterThan(at);
    expect(CODE.indexOf('activeRoom.user_data.picture_url} className="w-8 h-8')).toBeLessThan(defEnd);
  });

  it('the definition keeps the picture + the grey fallback circle', () => {
    const at = CODE.indexOf('const customerAvatar =');
    const body = CODE.slice(at, at + 420);
    expect(body).toContain('picture_url');
    expect(body).toContain('w-8 h-8 rounded-full');
    expect(body).toContain('bg-slate-300'); // no picture ⇒ still a circle, no gap
    expect(body).toContain('shrink-0 mt-1');
  });
});

describe('the sticker row lines up like the text row', () => {
  const stickerRow = (): string => {
    const at = CODE.indexOf("if (msg.message_type === 'sticker')");
    expect(at).toBeGreaterThan(-1);
    return CODE.slice(at, at + 1200);
  };

  it('it is a flex row with the same gap and top alignment', () => {
    expect(stickerRow()).toMatch(/flex gap-2 items-start/);
  });

  it('⭐ the avatar renders for the CUSTOMER only — a bot must not borrow it', () => {
    const row = stickerRow();
    expect(row).toContain("msg.sender_type === 'customer' && customerAvatar");
    // the side is still decided by isBot, unchanged
    expect(row).toMatch(/isBot \? 'justify-end' : 'justify-start'/);
  });

  it('the sticker image itself is untouched', () => {
    expect(stickerRow()).toMatch(/stickershop\.line-scdn\.net/);
    expect(stickerRow()).toMatch(/w-24 h-24 object-contain/);
  });
});

/**
 * [FIX-20260831-STICKERSENDER] สติกเกอร์ที่แอดมินส่ง ต้องเซ็นชื่อเหมือนบับเบิลอื่น
 *
 * 🔴 บั๊กเดียวกันกับไฟล์นี้ทั้งไฟล์ — แถวสติกเกอร์ `return` ก่อนถึงท้ายแถวข้อความปกติ
 *    คราวนั้นที่หายไปคือ "อวตารลูกค้า" คราวนี้คือ "ชื่อคนส่งฝั่งแอดมิน"
 *    เจ้าของเห็นในห้องจริง: ข้อความ/รูปมี `CS_viw` ใต้บับเบิล แต่สติกเกอร์ไม่มีอะไรเลย
 *    ⇒ ห้องที่มีแอดมินหลายคน อ่านไม่ออกว่าใครส่งสติกเกอร์นั้น
 *
 * BE เขียน `metadata.sender_name` ให้อยู่แล้วตั้งแต่ [FIX-20260808-ADMINSENDER]
 * (omnidesk-api `chat.service.ts` push-sticker) — ที่ขาดคือฝั่งแสดงผลล้วน ๆ
 */
describe('[STICKERSENDER] แถวสติกเกอร์เซ็นชื่อคนส่ง', () => {
  const stickerBranch = (): string => {
    const at = CODE.indexOf("if (msg.message_type === 'sticker')");
    expect(at).toBeGreaterThan(-1);
    // จบก้อนที่ `return (` ของแถวข้อความปกติซึ่งตามมาทันที
    const end = CODE.indexOf('return (', CODE.indexOf('</div>\n                );\n              }', at));
    return CODE.slice(at, end > at ? end : at + 2000);
  };

  it('⭐⭐ ใช้ helper ตัวเดียวกับแถวข้อความ ไม่ใช่อ่าน field เอง', () => {
    /* ถ้าใครมาอ่าน `msg.metadata.sender_name` ตรง ๆ ตรงนี้ สองแถวจะดริฟต์กันอีก
       — เหตุผลเดียวกับที่ avatar ถูกรวมเป็น `customerAvatar` ตัวเดียว */
    expect(stickerBranch()).toContain('adminSenderName(msg)');
  });

  it('⭐⭐ เซ็นเฉพาะฝั่งบอท/แอดมิน — ฝั่งลูกค้าต้องไม่มีชื่อโผล่', () => {
    expect(stickerBranch()).toMatch(/isBot && adminSenderName\(msg\)/);
  });

  it('⭐ สไตล์ตรงกับที่ใช้ใต้บับเบิลข้อความ (ตัวเล็กสีเทา)', () => {
    expect(stickerBranch()).toMatch(/text-\[10px\] text-slate-400/);
  });

  it('🔴 ต้องอยู่ใน**คอลัมน์**ของสติกเกอร์ ไม่ใช่หลุดออกไปนอกแถว', () => {
    /* ชื่อต้องอยู่หลังตัวสติกเกอร์และก่อนปิดคอลัมน์ ไม่งั้นจะไปแปะผิดที่
       (ก่อนแก้: ไม่มีเลย ⇒ indexOf คืน -1 ⇒ เทสนี้แดง) */
    const b = stickerBranch();
    const sticker = b.indexOf('[sticker]');
    const name = b.indexOf('adminSenderName(msg)');
    expect(sticker).toBeGreaterThan(-1);
    expect(name).toBeGreaterThan(sticker);
  });
});

/**
 * [FIX-20260831-STICKERSENDER] อวตารฝั่งเรา — ONE definition ใช้สองแถว
 *
 * ฝาแฝดของ describe แรกสุดในไฟล์นี้ (อวตารลูกค้า) · บั๊กเดียวกัน early return เดียวกัน
 * คราวนี้เป็นฝั่งขวา: สติกเกอร์ที่แอดมินส่งไม่มีวงกลมย่อชื่อ/ป้าย Bot
 */
describe('[STICKERSENDER] อวตารฝั่งเรา นิยามเดียว ใช้สองแถว', () => {
  it('the shared element exists', () => {
    expect(CODE).toMatch(/const botAvatar =/);
  });

  it('⭐⭐ ใช้ทั้งสองแถว — แถวสติกเกอร์ และแถวข้อความ', () => {
    const uses = CODE.match(/isBot && botAvatar|msg\.sender_type === 'bot' && botAvatar/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it('🔴 markup ของวงกลมมีชุดเดียว — นี่คือวิธีที่สองแถวเคยดริฟต์', () => {
    /* ก่อนแก้: IIFE ก้อนนี้ฝังอยู่ในแถวข้อความก้อนเดียว แถวสติกเกอร์เลยไม่มีอะไรเลย
       ถ้าใครก็อปไปแปะเป็นก้อนที่สอง = ดริฟต์รอบใหม่ ⇒ ต้องเป็น 1 เสมอ */
    const purple = CODE.match(/bg-purple-600 flex items-center justify-center shrink-0 mt-1/g) ?? [];
    const blue = CODE.match(/bg-blue-500 flex items-center justify-center shrink-0 mt-1/g) ?? [];
    expect(purple.length).toBe(1);
    expect(blue.length).toBe(1);
  });

  it('⭐ ไม่มีชื่อ → ป้าย Bot ม่วงเหมือนเดิม (บอทจริง/แถวเก่าไม่กระทบ)', () => {
    const at = CODE.indexOf('const botAvatar =');
    const body = CODE.slice(at, at + 700);
    expect(body).toContain('adminSenderName(msg)');
    expect(body).toContain('bg-purple-600');   // fallback
    expect(body).toContain('bg-blue-500');     // มีชื่อ → ตัวย่อ
    expect(body).toContain('sender.charAt(0)');
  });

  it('⭐ แถวสติกเกอร์วางอวตารไว้ **หลัง** คอลัมน์ (จึงอยู่ขวาสุด)', () => {
    const at = CODE.indexOf("if (msg.message_type === 'sticker')");
    const branch = CODE.slice(at, at + 2200);
    const col = branch.indexOf('adminSenderName(msg)');   // ท้ายคอลัมน์
    const av = branch.indexOf('isBot && botAvatar');
    expect(col).toBeGreaterThan(-1);
    expect(av).toBeGreaterThan(col);
  });
});
