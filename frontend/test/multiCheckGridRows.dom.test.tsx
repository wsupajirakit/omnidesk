/**
 * [FEAT-2708-GRIDROWS] (ต่อจาก 5.3) เส้นแบ่งแถว + โดเมนอ่านง่ายขึ้น
 * เจ้าของ 27/08 พร้อมภาพ: "ตาราง grid hook ...แบ่งเส้นตรงกลางด้วย มันแยกไม่ออก
 * แถวไหน และ domain font ใหญ่ขึ้น"
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { MultiCheckGrid } from '../components/campaign/pickers/MultiCheckGrid';
import { I18nProvider } from '../i18n';

const options = [
  { value: 'a', label: 'omnidesk-dev-oa-three', hint: 'demo.demo.example.com' },
  { value: 'b', label: 'omnidesk-dev-oa', hint: 'demo.demo.example.com' },
  { value: 'c', label: '222', hint: '2.2.com' },
];

const mount = () =>
  render(
    <I18nProvider>
      <MultiCheckGrid testId="g" values={[]} onChange={vi.fn()} options={options} />
    </I18nProvider>,
  );

describe('[GRIDROWS] แถวแยกออกจากกัน', () => {
  it('⭐⭐ ทุกแถวมีเส้นแบ่ง (border) — ไม่ใช่ลอยติดกัน', () => {
    mount();
    const row = screen.getByTestId('g-opt-a').closest('label') as HTMLElement;
    expect(row.className).toMatch(/border/);
  });

  /* [UI-20260828-HINTINLINE] โดเมนย้ายมาต่อท้ายชื่อในวงเล็บ ไม่ใช่ชิดขวาสุดแล้ว
     เจ้าของ 28/08: *"ย้ายชื่อโดเมนไปต่อท้ายชื่อ hook เลย"*
     🔴 เดิม `ml-auto` ดันโดเมนไปติดขอบขวา ⇒ ชื่อ OA สั้น ๆ กับโดเมนของมันห่างกัน
        เกือบเต็มคอลัมน์ ตาต้องกระโดดข้ามที่ว่างแล้วเดาว่าอันไหนคู่กับอันไหน */
  it('⭐ โดเมนอยู่ในวงเล็บต่อท้ายชื่อ และตัวไม่จิ๋ว', () => {
    mount();
    const hint = screen.getByText('(2.2.com)');
    expect(hint.className).toContain('text-xs');
    expect(hint.className).not.toContain('text-[10px]');
    /* 🔴 ต้องอยู่ในก้อนเดียวกับชื่อ — ถ้าหลุดออกไปเป็นพี่น้องข้าง ๆ แปลว่ากลับไป
       ชิดขวาแล้ว · ปักด้วยความสัมพันธ์ ไม่ใช่ปักด้วยคลาส `ml-auto` ที่เปลี่ยนชื่อได้ */
    expect(hint.parentElement?.textContent).toBe('222(2.2.com)');
  });
});
