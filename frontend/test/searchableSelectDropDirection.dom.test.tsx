/**
 * [UI-20260826-DROPDIR] ทิศทางการกางเมนูของ `SearchableSelect` เป็น **ของแต่ละที่**
 * ============================================================================
 * เจ้าของแจ้ง 26/08 พร้อมภาพ 5 ใบ (handoff-history · webhook-logs · assign-history):
 * *"มันต้องลงข้างล่างไม่ใช่ขึ้นข้างบนแบบนี้ · ระวังไปขนหน้าที่ให้ขึ้นบน
 *   เฉพาะหน้า boardcast ที่ให้ขึ้นข้างบน · แยกตัวให้มัน มีแค่ boardcast ที่ reuse ไม่ได้"*
 *
 * 🔴 ต้นเหตุคือ**หนี้ออกแบบ** ไม่ใช่บั๊กตรรกะ: `021a8ac` (26/08 00:01) แก้ให้
 *    "ตัวเลือกแคมเปญหน้าประวัติ" กางขึ้นบน — ซึ่งถูกต้องตามที่สั่ง — แต่ไปแก้ที่
 *    **ค่าเริ่มต้นของคอมโพเนนต์** ⇒ call site ทั้ง 31 จุดใน 15 ไฟล์พลิกขึ้นบนตามไปด้วย
 *    ทั้งที่มีจุดเดียวที่ขอ · หน้าที่เจ้าของไม่ได้สั่งอะไรเลยจึงเปลี่ยนพฤติกรรมเงียบ ๆ
 *
 * ⇒ กติกาใหม่: **ลงล่างเป็นค่าเริ่มต้น** (เท่ากับพฤติกรรมที่ทุกจุดมีมาตลอดก่อน 25/08)
 *   ใครต้องการขึ้นบนต้อง **ขอเอง** ด้วย `dropUp` — เจตนาอ่านออกจาก call site
 *
 * เคสในไฟล์นี้แบ่งสองชั้นตามบทเรียนของ `multiCheckDropUp.value.test.ts`:
 *   ชั้น 1 คอมโพเนนต์ทำถูกไหม (DOM)
 *   ชั้น 2 **call site ขอถูกตัวไหม** (อ่าน source) — ชั้นนี้คือชั้นที่บั๊กเดิมอยู่
 *          ถ้ามีแต่ชั้น 1 ใครลบ `dropUp` ออกจากหน้า broadcast ก็ยังเขียวหมด
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SearchableSelect } from '../components/common';

const OPTIONS = [
  { value: 'a', label: 'ตัวเลือก ก' },
  { value: 'b', label: 'ตัวเลือก ข' },
];

/** เปิดเมนูแล้วคืนกล่องเมนูจริง (อยู่ที่ `document.body` เพราะ portal) */
const openMenu = (props: Partial<React.ComponentProps<typeof SearchableSelect>> = {}) => {
  const view = render(
    <SearchableSelect value="" onChange={() => {}} options={OPTIONS} {...props} />,
  );
  fireEvent.click(view.container.querySelector('button') as HTMLElement);
  return document.querySelector('[data-drop-up]') as HTMLElement;
};

describe('[DROPDIR] ชั้น 1 — คอมโพเนนต์กางไปทางที่ถูกสั่ง', () => {
  it('⭐⭐ (TARGET) ไม่ส่งอะไรมา = กาง **ลงล่าง** — ยึดใต้ปุ่ม ไม่ใช่ยึดขอบล่างจอ', () => {
    const menu = openMenu();
    expect(menu.getAttribute('data-drop-up')).toBe('no');
    /* ยึดด้วย `top` = ขอบบนของเมนูอยู่ใต้ปุ่ม ⇒ เมนูงอกลงล่าง */
    expect(menu.style.top).not.toBe('');
    expect(menu.style.bottom).toBe('');
  });

  it('⭐ (PIN) ส่ง dropUp = กาง **ขึ้นบน** เหมือนเดิมทุกประการ', () => {
    const menu = openMenu({ dropUp: true });
    expect(menu.getAttribute('data-drop-up')).toBe('yes');
    /* ยึดด้วย `bottom` = ขอบล่างของเมนูติดขอบบนของปุ่ม ⇒ เมนูงอกขึ้นบน
       ไม่ว่าเมนูจะสูงเท่าไหร่ — เหตุผลเดิมจาก [UI-20260826-PORTALMENU] */
    expect(menu.style.bottom).not.toBe('');
    expect(menu.style.top).toBe('');
  });

  it('⭐ (PIN) portal ยังอยู่ — เมนูไม่ได้เป็นลูกของกล่องตัวเอง', () => {
    /* กล่องแม่บางใบมี `zoom: 1.15` ซึ่งสร้าง stacking context ⇒ ยก z-index ไม่ช่วย
       ถ้าใครเอา portal ออก เมนูจะกลับไปโดนแถบบนทับอีก */
    const view = render(<SearchableSelect value="" onChange={() => {}} options={OPTIONS} />);
    fireEvent.click(view.container.querySelector('button') as HTMLElement);
    expect(view.container.querySelector('[data-drop-up]')).toBeNull();
    expect(document.querySelector('[data-drop-up]')).not.toBeNull();
  });
});

/**
 * อ่าน source ของ call site — ชั้นที่บั๊กเดิมอยู่
 *
 * 🔴 **ตัดคอมเมนต์ทิ้งก่อนเสมอ** — จับได้จาก mutation จริง: ลบ `dropUp` ตัวจริง
 *    ออกจาก `FlexCardPicker.tsx` แล้วเคสยัง**เขียว** เพราะคอมเมนต์เหนือมันเขียน
 *    คำว่า `dropUp` อยู่ · เทสจึงพิสูจน์แค่ "มีคนพูดถึง" ไม่ใช่ "โค้ดทำจริง"
 *    เอกสารในรีโปนี้ชอบพูดถึงสิ่งที่มันห้าม/สั่ง ⇒ อ่าน source ดิบตรง ๆ ไม่ได้
 */
const src = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comment + JSX {/* ... */}
    .replace(/^\s*\/\/.*$/gm, '');       // line comment

/** ทุกจุดของ broadcast ที่ต้องขึ้นบน พร้อมเหตุผลว่าทำไมจุดนั้นถึงต้องขึ้น */
const MUST_DROP_UP: ReadonlyArray<readonly [string, string]> = [
  ['components/campaign/history/BroadcastRunHistoryPanel.tsx',
    'ตัวเลือกแคมเปญหน้าประวัติ — จุดที่ 021a8ac สั่งให้ขึ้นบนตั้งแต่แรก อยู่เหนือตารางยาว'],
  ['pages/messaging/Broadcasts.tsx',
    'แถวตัวกรองหน้า broadcast — แถวเดียวกัน (zoom 1.15) เหนือตารางยาวเหมือนกัน'],
  ['components/campaign/audience/AudienceRuleBuilder.tsx',
    'ตัวเลือกเงื่อนไขในโมดัล — เกิดหลัง 021a8ac จึงไม่เคยกางลงเลย เปลี่ยน = เปลี่ยนของที่ไม่มีใครสั่ง'],
  /* [FEAT-20260907-FLEXGALLERY] `components/campaign/flex/FlexCardPicker.tsx` ถูก
     ถอดออกจากรายการนี้ 07/09 — **ไม่ใช่เพราะยอมให้กางลง** แต่เพราะมันเลิกใช้
     `SearchableSelect` แล้ว เจ้าของสั่งให้เปลี่ยนตัวเลือกการ์ดเป็น gallery modal
     ⇒ ไม่มี dropdown ให้กางไปทางไหนอีกต่อไป กฎ dropUp จึงใช้กับไฟล์นี้ไม่ได้
     ⚠️ ถ้าวันหนึ่งเอา combobox กลับมาในโมดัลนี้ ต้องใส่บรรทัดนี้กลับด้วย */
];

/** หน้าที่เจ้าของส่งภาพมาว่าต้องกางลง — ห้ามมี dropUp โผล่มาอีก */
const MUST_DROP_DOWN: readonly string[] = [
  'pages/handoff/HandoffHistory.tsx',
  'pages/handoff/AssignHistory.tsx',
  'pages/hook/WebhookLogs.tsx',
];

describe('[DROPDIR] ชั้น 2 — call site ขอถูกตัว', () => {
  it.each(MUST_DROP_UP)('⭐⭐ %s ต้องขอ dropUp เอง', (path, why) => {
    /* ถ้าเคสนี้แดง: จุดนั้นกลับไปกางลงล่างแล้ว — เหตุผลที่มันต้องขึ้น: ${why} */
    expect(why.length).toBeGreaterThan(0);
    /* ต้องเป็น **prop บนแท็ก** จริง ๆ ไม่ใช่คำว่า dropUp ที่ไหนก็ได้ในไฟล์ */
    expect(src(path)).toMatch(/<SearchableSelect[\s\S]{0,400}?\bdropUp\b/);
  });

  it.each(MUST_DROP_DOWN)('⭐⭐ %s ต้องไม่มี dropUp (เจ้าของส่งภาพมาว่าต้องลงล่าง)', (path) => {
    expect(src(path)).not.toMatch(/dropUp/);
  });

  it('⭐ ค่าเริ่มต้นของคอมโพเนนต์ต้องเป็น "ลงล่าง" — ห้ามกลับไปบังคับขึ้นบนที่ default', () => {
    /* นี่คือหนี้เดิมเป๊ะ ๆ: แก้ที่ default แทนที่จะแก้ที่จุดที่ขอ
       ⇒ ถ้าใครเขียน `dropUp = true` เป็นค่าเริ่มต้นอีก เคสนี้แดงทันที */
    expect(src('components/common/SearchableSelect.tsx')).toMatch(/dropUp\s*=\s*false/);
  });
});
