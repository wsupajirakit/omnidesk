/**
 * [FIX-20260830-CLOSEMISSING] คำเตือน "ยังเลือกไม่ครบ" ต้องอยู่จนกว่าจะครบจริง
 *
 * เจ้าของแจ้ง 30/08/2026: กล่องยืนยันปิดเคส ถ้ามีตัวเลือกขึ้นมาแล้วไม่เลือก
 * ต้องเด้งแดงจนกว่าจะเลือกครบทุกหัวข้อ · **และเคสที่ไม่มีตัวเลือกต้องกดยืนยัน
 * ได้ปกติเหมือนเดิมทุกอย่าง**
 *
 * ── ต้นเหตุจริง ────────────────────────────────────────────────────────────
 * `TicketChat.tsx` เดิมสั่ง `setFollowUpMissing(false)` ทันทีที่แตะหัวข้อใด
 * หัวข้อหนึ่ง ⇒ เคสที่มีสองหัวข้อ (ฝาก + ถอน) พอเลือกไปข้างเดียว **แดงหายทั้ง
 * กล่อง** แอดมินจึงกดยืนยันซ้ำแล้วไม่เกิดอะไรขึ้น โดยไม่มีอะไรบอกว่าเหลืออะไร
 *
 * ── ทำไมเทสตรงนี้ ไม่ใช่ที่ component ────────────────────────────────────
 * `CloseCaseSections` ตัดสินสีรายหัวข้ออยู่แล้วถูกต้อง (`showMissing && picked
 * === undefined`) — ตัวที่ผิดคือ **ตอนไหนถึงจะล้างธง** ซึ่งอยู่ที่ผู้เรียก
 * เทสนี้จึงจำลองกฎนั้นตรง ๆ แล้วมี source census ยืนยันว่าโค้ดจริงใช้กฎเดียวกัน
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  missingTopics,
  type CloseCaseAnswers,
  type CloseCaseTopic,
} from '../components/member/follow-up/CloseCaseSections';

/** กฎที่ TicketChat ใช้: ล้างธงก็ต่อเมื่อไม่มีหัวข้อค้างแล้ว */
const shouldClearWarning = (
  topics: CloseCaseTopic[],
  answers: CloseCaseAnswers,
): boolean => missingTopics(topics, answers).length === 0;

/** กฎปุ่มยืนยัน: มีหัวข้อค้าง = ไม่ปิด */
const canConfirm = (
  topics: CloseCaseTopic[],
  answers: CloseCaseAnswers,
): boolean => missingTopics(topics, answers).length === 0;

describe('[CLOSEMISSING] ⭐⭐⭐ ไม่มีตัวเลือก = ต้องไม่กระทบอะไรเลย', () => {
  it('ไม่มีหัวข้อ ⇒ กดยืนยันได้ทันที', () => {
    /* นี่คือเคสส่วนใหญ่ของระบบ — ถ้าพังคือปิดเคสไม่ได้ทั้งระบบ */
    expect(canConfirm([], {})).toBe(true);
  });

  it('ไม่มีหัวข้อ ⇒ ไม่มีอะไรค้าง จึงไม่มีทางเด้งแดง', () => {
    expect(missingTopics([], {})).toEqual([]);
    expect(shouldClearWarning([], {})).toBe(true);
  });

  it('ไม่มีหัวข้อ แม้มี answers ค้างจากเคสก่อน ⇒ ยังยืนยันได้', () => {
    /* `closeAnswers` ถูก reset ตอนปิดกล่อง แต่ถ้าหลุดมาก็ต้องไม่ล็อกปุ่ม */
    expect(canConfirm([], { deposit: 'follow', withdraw: 'unfollow' })).toBe(true);
  });
});

describe('[CLOSEMISSING] ⭐⭐ มีตัวเลือก = ต้องเลือกครบก่อน', () => {
  it('หัวข้อเดียว ยังไม่เลือก ⇒ ยืนยันไม่ได้', () => {
    expect(canConfirm(['deposit'], {})).toBe(false);
  });

  it('หัวข้อเดียว เลือกแล้ว ⇒ ยืนยันได้ และแดงหาย', () => {
    expect(canConfirm(['deposit'], { deposit: 'follow' })).toBe(true);
    expect(shouldClearWarning(['deposit'], { deposit: 'follow' })).toBe(true);
  });

  it('⭐⭐⭐ สองหัวข้อ เลือกไปข้างเดียว ⇒ แดงต้อง "ยังอยู่" และยืนยันไม่ได้', () => {
    /* นี่คือบั๊กที่เจ้าของเจอ: เดิมล้างธงทันทีที่เลือกอันแรก
       ⇒ แดงหายทั้งที่ยังเหลืออีกหัวข้อ */
    const topics: CloseCaseTopic[] = ['deposit', 'withdraw'];
    const half: CloseCaseAnswers = { deposit: 'follow' };
    expect(shouldClearWarning(topics, half)).toBe(false);
    expect(canConfirm(topics, half)).toBe(false);
    expect(missingTopics(topics, half)).toEqual(['withdraw']);
  });

  it('สองหัวข้อ ครบทั้งคู่ ⇒ แดงหาย ยืนยันได้', () => {
    const topics: CloseCaseTopic[] = ['deposit', 'withdraw'];
    const full: CloseCaseAnswers = { deposit: 'follow', withdraw: 'unfollow' };
    expect(shouldClearWarning(topics, full)).toBe(true);
    expect(canConfirm(topics, full)).toBe(true);
  });

  it('สามหัวข้อ เลือกไปสอง ⇒ ยังค้างหนึ่ง', () => {
    const topics: CloseCaseTopic[] = ['registration', 'deposit', 'withdraw'];
    const two: CloseCaseAnswers = { registration: 'keep', deposit: 'follow' };
    expect(missingTopics(topics, two)).toEqual(['withdraw']);
    expect(canConfirm(topics, two)).toBe(false);
  });

  it('เลือกฝั่งไหนก็นับว่าตอบแล้ว ทั้งสองค่า', () => {
    /* "ไม่ติดตาม" คือคำตอบ ไม่ใช่การไม่ตอบ */
    for (const v of ['follow', 'unfollow'] as const) {
      expect(canConfirm(['deposit'], { deposit: v })).toBe(true);
    }
  });
});

describe('[CLOSEMISSING] โค้ดจริงใช้กฎเดียวกัน (source census)', () => {
  const src = () =>
    readFileSync(join(__dirname, '..', 'pages/chat/TicketChat.tsx'), 'utf8');

  it('⭐⭐⭐ ปุ่มยืนยันยังกันด้วย missingTopics เหมือนเดิม', () => {
    /* [FIX-20260830-SHAKEEVERYTIME] เดิมตรึงเป็นบรรทัดเดียวเป๊ะ ๆ · guard กลาย
       เป็นบล็อกหลายบรรทัดตอนเพิ่มตัวนับ attempt (กดยืนยันซ้ำต้องเด้งซ้ำ) ⇒ ตรึง
       "เจตนา" แทน "การสะกด": ยังเป็น missingTopics ตัวเดิมที่ตัดสิน, ยังยก
       followUpMissing, และยัง return ออกก่อนจะปิดอะไร */
    const code = src();
    const at = code.indexOf('missingTopics(closeTopics, closeAnswers).length > 0');
    expect(at).toBeGreaterThan(-1);
    const block = code.slice(at, at + 260);
    expect(block).toContain('setFollowUpMissing(true)');
    expect(block).toContain('return;');
  });

  it('⭐⭐ ล้างธงเมื่อครบเท่านั้น ไม่ใช่ทันทีที่แตะ', () => {
    /* บรรทัดเดิม `setCloseAnswers(...); setFollowUpMissing(false);` แบบเรียงกัน
       คือตัวบั๊ก — ถ้ากลับมาแบบนั้นเทสนี้ต้องแดง */
    const s = src();
    expect(s).toContain('if (missingTopics(closeTopics, next).length === 0) {');
    expect(s).not.toMatch(
      /setCloseAnswers\(\(prev\) => \(\{ \.\.\.prev, \[topic\]: value \}\)\);\s*\n\s*setFollowUpMissing\(false\);/,
    );
  });

  it('คำนวณจากค่าใหม่ (next) ไม่ใช่ค่าเก่าที่ยังไม่อัปเดต', () => {
    /* setState เป็น async — อ่าน closeAnswers นอก updater จะช้าไปหนึ่งคลิก
       ทำให้แดงหายช้ากว่าที่ควรหนึ่งจังหวะ */
    expect(src()).toContain('missingTopics(closeTopics, next)');
  });
});
