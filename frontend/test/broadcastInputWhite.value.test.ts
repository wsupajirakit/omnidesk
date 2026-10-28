/**
 * [FEAT-2708-BCASTWHITE] (งาน 5.2) input ทุกช่องในฟอร์ม broadcast = ขาวล้วน (light)
 * ===========================================================================
 * ต้นเหตุที่วัดจริง: rule global ใน `index.html:72-78` ทาสี `#E2E8F0 !important`
 * ให้ input/select/textarea ทั้งแอปตอน light — Tailwind class ชนะไม่ได้ และ
 * `.bg-white` ก็ถูก `index.html:40-43` ทับเป็นสีการ์ด ⇒ ทางเดียวคือ rule scoped
 * `.bcast-form-lg` ใน `index.css` ที่ specificity สูงกว่าใน important layer เดียวกัน
 *
 * jsdom ไม่โหลด CSS ⇒ เทสนี้ปักที่ตัวไฟล์ (ท่าเดียวกับ noticeCardGate):
 * rule ต้องมีจริง · ต้องขาวแท้ · ต้อง scope light เท่านั้น · ต้องเว้น checkbox/radio
 * · และ trigger ที่หน้าตาเหมือน input (MultiCheckSelect ผ่าน inputClass ·
 * SearchableSelect ใน FlexCardPicker) ต้องติดคลาส `bcast-field` ให้ rule ครอบถึง
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');
const modal = readFileSync(
  join(__dirname, '..', 'components', 'campaign', 'BroadcastFormModal.tsx'),
  'utf8',
);
const flexPicker = readFileSync(
  join(__dirname, '..', 'components', 'campaign', 'flex', 'FlexCardPicker.tsx'),
  'utf8',
);

/** บล็อกที่งานนี้เพิ่ม — จับด้วย tag เพื่อไม่ผูกกับตำแหน่งบรรทัด */
const block = () => {
  const at = css.indexOf('[FEAT-2708-BCASTWHITE]');
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, at + 3500);
};

describe('[BCASTWHITE] rule ขาวล้วนของฟอร์ม broadcast', () => {
  it('⭐⭐ rule scoped light มีจริง ครอบ input/select/textarea ด้วย #ffffff !important', () => {
    const b = block();
    expect(b).toContain("html:not(.theme-dark) .bcast-form-lg input");
    expect(b).toContain('html:not(.theme-dark) .bcast-form-lg select');
    expect(b).toContain('html:not(.theme-dark) .bcast-form-lg textarea');
    expect(b).toMatch(/#ffffff\s*!important/);
  });

  it('⭐ checkbox/radio ถูกเว้น — พื้นหลัง checkbox ไม่ใช่โจทย์', () => {
    const b = block();
    expect(b).toContain(":not([type='checkbox'])");
    expect(b).toContain(":not([type='radio'])");
  });

  it('⭐ dark ไม่โดนแตะ — ทุก selector ในบล็อกผูก :not(.theme-dark)', () => {
    const b = block();
    /* เอาเฉพาะบรรทัด selector จริง (จบด้วย , หรือ {) — ไม่ใช่ comment ที่เอ่ยชื่อคลาส */
    const selectors = b
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.includes('.bcast-form-lg') && (l.endsWith(',') || l.endsWith('{')),
      );
    expect(selectors.length).toBeGreaterThanOrEqual(5);
    for (const line of selectors) {
      expect(line).toContain('html:not(.theme-dark)');
    }
  });

  it('⭐ trigger หน้าตาเหมือน input ติดคลาส bcast-field และ rule ครอบถึง', () => {
    // MultiCheckSelect triggers ใช้ inputClass — คลาสต้องอยู่ในสตริงกลางตัวเดียว
    expect(modal).toMatch(/const inputClass[\s\S]{0,200}bcast-field/);
    /* [FEAT-20260907-FLEXGALLERY] รูปแบบเปลี่ยน 07/09 — FlexCardPicker เลิกใช้
       `SearchableSelect` แล้ว (เจ้าของสั่งให้ตัวเลือกการ์ดเป็น gallery modal)
       ⇒ ไม่มี prop `className={invalid ? …}` ให้จับอีก
       สิ่งที่เคสนี้เฝ้าจริงไม่เปลี่ยน: **trigger ของช่องนี้ต้องติด `bcast-field`**
       ไม่งั้น rule ใน index.css ไม่ครอบ แล้วช่องจะเป็นสีเทาในโมดัลที่พื้นขาว
       ⚠️ ยังต้องรวมกับ border แดงตอน invalid ในสตริงเดียว — ประกาศ `className`
          สองครั้งบน element เดียวคือ TS17001 เหมือนเดิม */
    expect(flexPicker).toMatch(/data-testid="flex-card-open-gallery"/);
    expect(flexPicker).toMatch(/`bcast-field [\s\S]{0,400}invalid \? 'border-red-500'/);
    const b = block();
    expect(b).toContain('.bcast-field');
  });
});
