/**
 * [UI-20260831-DOCEXPAND] ปุ่มขยาย/ย่อของกล่อง Training Doc
 * ===========================================================================
 * เจ้าของสั่ง 31/08: สองกล่องนี้ต้องขยายความสูงได้ **+200% ของเดิม** ย่อกลับได้
 * และ **ปุ่มของใครของมัน**
 *
 * ⭐ เคสที่สำคัญที่สุดคือ "กดกล่องบนแล้วกล่องล่างต้องไม่ขยับ" — เป็นข้อที่พังง่าย
 * ที่สุดถ้าวันหนึ่งมีคนยุบ state สองตัวเหลือตัวเดียว แล้วจะไม่มีอะไรฟ้องเลย
 * นอกจากคนใช้งานจริง
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ExpandableTextarea, EXPAND_FACTOR } from '../components/hook/form/ExpandableTextarea';

const BASE = 6;

function twoBoxes() {
  return render(
    <>
      <ExpandableTextarea
        testId="btn-a"
        chips={<span>A</span>}
        rows={BASE}
        value="a"
        onChange={() => {}}
        expandLabel="ขยายกล่อง"
        collapseLabel="ย่อกล่อง"
      />
      <ExpandableTextarea
        testId="btn-b"
        chips={<span>B</span>}
        rows={BASE}
        value="b"
        onChange={() => {}}
        expandLabel="ขยายกล่อง"
        collapseLabel="ย่อกล่อง"
      />
    </>,
  );
}

const rowsOf = (i: number) =>
  Number(
    (document.querySelectorAll('textarea')[i] as HTMLTextAreaElement).getAttribute(
      'rows',
    ),
  );

describe('[DOCEXPAND] ปุ่มขยาย/ย่อ', () => {
  it('⭐⭐⭐ ขยายแล้วสูงขึ้น 200% ของเดิม', () => {
    twoBoxes();
    expect(rowsOf(0)).toBe(BASE);
    fireEvent.click(screen.getByTestId('btn-a'));
    expect(rowsOf(0)).toBe(Math.round(BASE * EXPAND_FACTOR)); // 6 → 18
    /* 3 เท่า = ของเดิม 100% + เพิ่มอีก 200% ตามที่สั่ง ไม่ใช่ 2 เท่า */
    expect(EXPAND_FACTOR).toBe(3);
  });

  it('⭐⭐⭐ ย่อกลับได้ และป้ายปุ่มสลับตามสถานะ', () => {
    twoBoxes();
    const btn = screen.getByTestId('btn-a');
    expect(btn.textContent).toBe('ขยายกล่อง');
    fireEvent.click(btn);
    expect(btn.textContent).toBe('ย่อกล่อง');
    fireEvent.click(btn);
    expect(rowsOf(0)).toBe(BASE);
    expect(btn.textContent).toBe('ขยายกล่อง');
  });

  it('⭐⭐⭐ ปุ่มของใครของมัน — กดกล่องบน กล่องล่างไม่ขยับ', () => {
    twoBoxes();
    fireEvent.click(screen.getByTestId('btn-a'));
    expect(rowsOf(0)).toBe(Math.round(BASE * EXPAND_FACTOR));
    expect(rowsOf(1)).toBe(BASE);

    fireEvent.click(screen.getByTestId('btn-b'));
    expect(rowsOf(0)).toBe(Math.round(BASE * EXPAND_FACTOR));
    expect(rowsOf(1)).toBe(Math.round(BASE * EXPAND_FACTOR));
  });

  it('⭐⭐ เป็นปุ่ม type=button — กดแล้วต้องไม่ submit ฟอร์ม', () => {
    /* ปุ่มใน <form> ที่ไม่ระบุ type จะเป็น submit โดยปริยาย ⇒ กดขยายกล่อง
       แล้วฟอร์มถูกส่งทันที ซึ่งในหน้านี้คือบันทึก hook โดยไม่ตั้งใจ */
    twoBoxes();
    expect(screen.getByTestId('btn-a').getAttribute('type')).toBe('button');
  });

  it('⭐ ข้อความปุ่มมาจากผู้เรียก — ตัวคอมโพเนนต์ไม่ผูกภาษา', () => {
    render(
      <ExpandableTextarea
        testId="btn-en"
        chips={null}
        value=""
        onChange={() => {}}
        expandLabel="Expand"
        collapseLabel="Collapse"
      />,
    );
    expect(screen.getByTestId('btn-en').textContent).toBe('Expand');
  });
});

/* [FIX-20260901-DOCEXPANDDRAG] ลากขอบกล่องเองแล้วปุ่มขยาย/ย่อต้องยังทำงาน
 * ===========================================================================
 * เจอจริง 01/09: แอดมินลากมุมล่างขวาของ textarea เพื่อปรับความสูงเอง แล้วหลังจาก
 * นั้นกดปุ่ม "ขยายกล่อง" / "ย่อกล่อง" ไม่มีอะไรขยับเลย
 *
 * ทำไม: การลากทำให้เบราว์เซอร์เขียน `style.height` ลงบน element โดยตรง และ
 * inline height **ทับ** `rows` เสมอ — `rows` เป็นแค่ความสูงตั้งต้นเมื่อไม่มีใคร
 * กำหนดความสูงไว้ ⇒ ปุ่มยังสลับ `rows` อยู่ (state เปลี่ยนจริง) แต่ไม่มีผลกับสิ่งที่ตาเห็น
 * ⇒ ปุ่มต้องล้าง inline height ทิ้งตอนถูกกด เพื่อคืนอำนาจให้ `rows`
 * ลากได้เหมือนเดิม ไม่ได้ปิด resize ทิ้ง
 */
describe('[FIX-20260901-DOCEXPANDDRAG] ลากเองแล้วปุ่มต้องยังใช้ได้', () => {
  it('ล้าง inline height ที่การลากทิ้งไว้ เมื่อกดขยาย', () => {
    render(
      <ExpandableTextarea
        testId="btn-drag"
        chips={<span>D</span>}
        rows={BASE}
        value="v"
        onChange={() => {}}
        expandLabel="ขยายกล่อง"
        collapseLabel="ย่อกล่อง"
      />,
    );
    const box = document.querySelector('textarea') as HTMLTextAreaElement;

    /* จำลองการลาก: เบราว์เซอร์เขียน inline height ลงไปแบบนี้ */
    box.style.height = '900px';
    expect(box.style.height).toBe('900px');

    fireEvent.click(screen.getByTestId('btn-drag'));

    /* rows ต้องเปลี่ยน และ inline height ต้องหายไป ไม่งั้นตาไม่เห็นอะไรขยับ */
    expect(box.rows).toBe(BASE * EXPAND_FACTOR);
    expect(box.style.height).toBe('');
  });

  it('ล้าง inline height ตอนย่อกลับด้วย ไม่ใช่เฉพาะตอนขยาย', () => {
    render(
      <ExpandableTextarea
        testId="btn-drag2"
        chips={<span>D</span>}
        rows={BASE}
        value="v"
        onChange={() => {}}
        expandLabel="ขยายกล่อง"
        collapseLabel="ย่อกล่อง"
      />,
    );
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    const btn = screen.getByTestId('btn-drag2');

    fireEvent.click(btn);              // ขยาย
    box.style.height = '1200px';       // ผู้ใช้ลากอีกรอบตอนขยายอยู่
    fireEvent.click(btn);              // ย่อ

    expect(box.rows).toBe(BASE);
    expect(box.style.height).toBe('');
  });

  it('ยังลากได้อยู่ — ไม่ได้ปิด resize ทิ้ง', () => {
    render(
      <ExpandableTextarea
        testId="btn-drag3"
        chips={<span>D</span>}
        rows={BASE}
        value="v"
        onChange={() => {}}
        expandLabel="ขยายกล่อง"
        collapseLabel="ย่อกล่อง"
      />,
    );
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    /* ถ้าวันหนึ่งมีคนแก้บั๊กนี้ด้วยการใส่ resize-none เทสนี้จะฟ้อง:
       การลากเป็นความสามารถที่ผู้ใช้ใช้อยู่ ห้ามเอาออกเพื่อความสะดวกของโค้ด */
    expect(box.className).not.toContain('resize-none');
  });
});
