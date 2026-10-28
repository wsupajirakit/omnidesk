/**
 * [HOTFIX-20260826-THINK36] "ปิดความคิด" ต้องใช้คำที่ทั้ง 3.5 และ 3.6 ฟังรู้เรื่อง
 * ============================================================================
 * เคสทั้งหมดในไฟล์นี้อ้างอิง **ผลยิงจริง** ด้วยคีย์จริง 26/08 ไม่ใช่การอ่านเอกสาร:
 *
 *                          3.5-flash                3.6-flash
 *   thinkingBudget 0       ✅ 200 · ไม่คิด          🔴 400 INVALID_ARGUMENT
 *   thinkingBudget 512     ✅ 200 · thoughts 225    ✅ 200 · thoughts 227
 *   thinkingBudget -1      ✅                       ✅ 200 · thoughts 438
 *   thinkingLevel minimal  ✅ 200 · ไม่คิด (2/2)    ✅ 200 · ไม่คิด (2/2)
 *   ไม่ส่ง config เลย       ✅ 200 · thoughts 404    ✅ 200 · thoughts 469
 *
 * 🔴 ตัวที่พังมีช่องเดียว: budget 0 บน 3.6 · และ error ที่ได้กลับมาคือ
 *    `"Request contains an invalid argument."` ซึ่ง **ไม่มีคำว่า think**
 *    ⇒ ตาข่าย `em.includes('think')` ใน transport ไม่ติด ⇒ ลูกค้าไม่ได้คำตอบ
 *    วันนี้ 24/29 hook ตั้งค่า "ปิด" ไว้ ⇒ สลับไป 3.6 เมื่อไหร่ ตายพร้อมกัน 24 ตัว
 */
import {
  resolveThinkingConfig,
  isGemini3OrLater,
  OFF_LEVEL,
  OFF_LEVEL_FALLBACK,
} from '../../src/modules/webhook/ai-vendors/gemini/thinking-config';
import { readFileSync } from 'fs';
import { join } from 'path';

/** source ของ transport โดย**ตัดคอมเมนต์ทิ้งก่อน**
 *  🔴 บทเรียนสด ๆ 26/08: เคยเขียน pin ที่แมตช์ source ดิบ แล้วคอมเมนต์ที่เพิ่งเขียนเอง
 *     มีคำที่เทสมองหา ⇒ ลบโค้ดจริงออกก็ยังเขียว · ที่นี่คอมเมนต์พูดถึงทั้ง
 *     `thinkingBudget` และ `thinkingLevel` เต็มไปหมด ตัดทิ้งก่อนเท่านั้นจึงเชื่อได้ */
const transportSrc = (): string =>
  readFileSync(
    join(
      process.cwd(),
      'src/modules/webhook/ai-vendors/gemini/gemini-reply.transport.ts',
    ),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('[THINK36] ⭐⭐ TARGET — "ปิด" ต้องออกมาเป็น thinkingLevel:minimal ทั้งสองรุ่น', () => {
  /* เจ้าของยืนยัน 26/08: "สรุปใช้ minimal ทั้งสองนะ" */
  it.each([['gemini-3.5-flash'], ['gemini-3.6-flash']])(
    '%s + ปิด(0) ⇒ { thinkingLevel: "minimal" }',
    (model) => {
      expect(resolveThinkingConfig(model, 0)).toEqual({
        thinkingLevel: 'minimal',
      });
    },
  );

  it('3.5 กับ 3.6 ต้องได้ผลลัพธ์ "เหมือนกันเป๊ะ" ไม่ใช่แค่คล้าย', () => {
    /* ถ้าวันหลังใครแยกทางสองรุ่นนี้ เคสนี้แดงทันที — doc จัดไว้คอลัมน์เดียวกัน
       ("Gemini 3.6 & 3.5 Flash") และผลยิงจริงก็ตรงกันทั้ง 4 รอบ */
    expect(resolveThinkingConfig('gemini-3.6-flash', 0)).toEqual(
      resolveThinkingConfig('gemini-3.5-flash', 0),
    );
  });

  it('hook ที่ไม่ได้เลือกรุ่น (null) = ค่าเริ่มต้นของค่าย = 3.5 ⇒ minimal เหมือนกัน', () => {
    /* 29/29 hook ในฐานเป็น ai_model: null ⇒ นี่คือเส้นทางที่ของจริงวิ่งวันนี้ */
    expect(resolveThinkingConfig(null, 0)).toEqual({
      thinkingLevel: 'minimal',
    });
    expect(resolveThinkingConfig(undefined, 0)).toEqual({
      thinkingLevel: 'minimal',
    });
    expect(resolveThinkingConfig('', 0)).toEqual({ thinkingLevel: 'minimal' });
  });

  it('ไม่ได้ตั้งค่าเลย (null/undefined) ก็คือ "ปิด" เท่ากับ 0', () => {
    /* 1 hook ในฐานเป็น null ⇒ resolveThinkingBudget เดิมก็ตกมาที่ 0 */
    expect(resolveThinkingConfig('gemini-3.5-flash', null)).toEqual({
      thinkingLevel: 'minimal',
    });
    expect(resolveThinkingConfig('gemini-3.6-flash', undefined)).toEqual({
      thinkingLevel: 'minimal',
    });
  });
});

describe('[THINK36] ⭐ PIN — ค่าที่ไม่ใช่ "ปิด" ต้องไม่ถูกแตะเลย', () => {
  /* ยิงจริงแล้วทั้ง 3.5 และ 3.6 รับ -1 และ 512 ได้ปกติ ⇒ ไม่มีเหตุให้เปลี่ยน
     และแปลว่า **ไม่ต้องรอเส้นแบ่งของ "กำหนดเอง" จากเจ้านาย** ก็ปล่อย hotfix ได้ */
  it.each([
    ['gemini-3.5-flash', -1],
    ['gemini-3.6-flash', -1],
    ['gemini-3.5-flash', 512],
    ['gemini-3.6-flash', 512],
    ['gemini-3.5-flash', 2048],
    ['gemini-3.6-flash', 24576],
  ])('%s + %i ⇒ ส่ง thinkingBudget เท่าเดิม', (model, budget) => {
    expect(resolveThinkingConfig(model, budget)).toEqual({
      thinkingBudget: budget,
    });
  });

  it('ตระกูล 2.5 ต้องได้ thinkingBudget เหมือนเดิม — doc: 2.5 ไม่รองรับ thinkingLevel', () => {
    expect(resolveThinkingConfig('gemini-2.5-flash', 0)).toEqual({
      thinkingBudget: 0,
    });
    expect(resolveThinkingConfig('gemini-2.5-pro', 0)).toEqual({
      thinkingBudget: 0,
    });
  });

  it('รุ่นที่อ่านไม่ออก = ทำเท่าที่เคยทำ (thinkingBudget) ไม่เดา', () => {
    expect(resolveThinkingConfig('my-custom-model', 0)).toEqual({
      thinkingBudget: 0,
    });
  });
});

describe('[THINK36] ⭐ PIN — ห้ามมีสองคีย์ในก้อนเดียว (ยิงจริงแล้ว 400)', () => {
  /* C10 (ยิงจริง): {"thinkingLevel":"minimal","thinkingBudget":0} → 400 INVALID_ARGUMENT
     ถ้าใครเผลอ spread สองอันมารวมกัน คำขอทุกใบตายทันที */
  const MODELS = [
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-2.5-flash',
    'weird',
    '',
  ];
  const BUDGETS = [0, -1, 1, 512, 24576];
  it('ทุกคู่ (รุ่น × ค่า) ต้องมีคีย์เดียวเสมอ', () => {
    for (const m of MODELS) {
      for (const b of BUDGETS) {
        const out = resolveThinkingConfig(m, b) as Record<string, unknown>;
        const keys = Object.keys(out).filter((k) => out[k] !== undefined);
        expect(keys).toHaveLength(1);
      }
    }
  });
});

describe('[THINK36] ⭐ รุ่นที่ minimal ใช้ไม่ได้ ต้องได้ low แทน (doc: Not supported = error)', () => {
  it.each([['gemini-3.7-flash'], ['gemini-3.1-pro-preview']])(
    '%s + ปิด ⇒ low ไม่ใช่ minimal',
    (model) => {
      expect(resolveThinkingConfig(model, 0)).toEqual({
        thinkingLevel: OFF_LEVEL_FALLBACK,
      });
      expect(OFF_LEVEL_FALLBACK).not.toBe(OFF_LEVEL);
    },
  );
});

describe('[THINK36] ⭐ ตัวแยกตระกูล', () => {
  it.each([
    ['gemini-3.5-flash', true],
    ['gemini-3.6-flash', true],
    ['gemini-3.7-flash', true],
    ['gemini-2.5-flash', false],
    ['gemini-2.5-pro', false],
    ['', true],
    ['ไม่ใช่ชื่อรุ่น', false],
  ])('%s ⇒ Gemini3+ = %s', (model, want) => {
    expect(isGemini3OrLater(model)).toBe(want);
  });

  it('null / undefined = ค่าเริ่มต้นของค่าย (3.5) ⇒ true', () => {
    expect(isGemini3OrLater(null)).toBe(true);
    expect(isGemini3OrLater(undefined)).toBe(true);
  });
});

describe('[THINK36] ⭐⭐ TARGET — transport ต้องเรียกตัวแปลง ไม่ใช่เขียนเงื่อนไขเองซ้ำ', () => {
  it('เรียก resolveThinkingConfig พร้อม modelId ของ call จริง', () => {
    /* 🔴 นี่คือชั้นที่บั๊กอยู่จริง: ตัวแปลงคิดถูกอย่างเดียวไม่พอ ถ้าคนเรียกไม่ได้ใช้
       หรือส่งรุ่นผิดเข้าไป ผลลัพธ์ก็ผิดทั้งที่เทสข้างบนเขียวหมด */
    const src = transportSrc();
    expect(src).toMatch(/resolveThinkingConfig\(/);
    expect(src).toMatch(/resolveThinkingConfig\(\s*call\.modelId/);
  });

  it('ต้องไม่มี thinkingBudget ดิบค้างอยู่ใน transport อีก', () => {
    /* ของเดิมคือ `thinkingConfig: { thinkingBudget: call.thinkingBudget ?? 0 }`
       ซึ่งคือบรรทัดที่ทำให้ 3.6 ตาย — ต้องไม่มีเหลือ */
    expect(transportSrc()).not.toMatch(
      /thinkingBudget:\s*call\.thinkingBudget/,
    );
  });

  it('ตาข่ายกู้ชีพ 400 ยังอยู่ครบ', () => {
    /* ⚠️ ตาข่ายนี้ไม่ได้ช่วยเคส 3.6 (error ไม่มีคำว่า think) แต่ยังต้องอยู่
       เพราะมันคุมเคสอื่นที่ endpoint ตอบเรื่อง thinking มาตรง ๆ */
    const src = transportSrc();
    expect(src).toMatch(/includes\('think'\)/);
    expect(src).toMatch(/delete body\.generationConfig\.thinkingConfig/);
  });
});
