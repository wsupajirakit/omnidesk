/**
 * [UI-20260828-DAYSRED] "ยังไม่เลือกวัน" ต้องอ่านเป็น error ไม่ใช่ข้อความเสริม
 * ===========================================================================
 * เจ้าของ 28/08: *"แดงกว่านี้ + แดงที่ label ด้วย"*
 *
 * 🔴 `amber-700` อ่านออกก็จริง แต่มันคือโทน "เตือน" ซึ่งสื่อว่า "รู้ไว้นะ" ·
 *    สถานะนี้คือ **เซฟไม่ผ่าน** ⇒ ต้องเป็นโทนเดียวกับ error อื่นของฟอร์ม
 *    ไม่งั้นผู้ใช้จะจัดมันเป็นข้อความเสริมแล้วกดเซฟต่อ
 * 🔴 หัวข้อต้องแดงด้วย เพราะข้อความเตือนอยู่ **ใต้** แถวปุ่ม — คนกวาดตาจากบนลงล่าง
 *    จะเห็นหัวข้อก่อนเสมอ · หัวข้อสีปกติ = อ่านผ่านไปเลย
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { RepeatRuleForm } from '../components/campaign/schedule/RepeatRuleForm';
import { I18nProvider } from '../i18n';

const mount = (days: number[]) =>
  render(
    <I18nProvider>
      {/* ⚠️ prop ชื่อ `value` ไม่ใช่ `rule` — เคยเดาผิดแล้วเทสแดงทั้งสามเคส
          เพราะคอมโพเนนต์อ่าน `value ?? null` ⇒ ได้ null ⇒ ไม่เข้าโหมดซ้ำเลย */}
      <RepeatRuleForm
        value={{ mode: 'repeat', days_of_week: days, at_time: '17:11' } as never}
        onChange={vi.fn()}
      />
    </I18nProvider>,
  );

const label = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').includes('วันไหนของสัปดาห์'),
  );

describe('[DAYSRED] ยังไม่เลือกวัน = สัญญาณสีแดง', () => {
  it('⭐⭐ 🔴 ข้อความเตือนเป็นแดง ไม่ใช่ส้ม', () => {
    const { getByTestId } = mount([]);
    const hint = getByTestId('repeat-days-all-hint');

    expect(hint.className).toContain('text-red-600');
    /* โทนส้มต้องไม่หลงเหลือ — มันอ่านเป็น "รู้ไว้นะ" ไม่ใช่ "เซฟไม่ผ่าน" */
    expect(hint.className).not.toContain('amber');
  });

  it('⭐⭐ 🔴 หัวข้อ "วันไหนของสัปดาห์" แดงตามด้วย', () => {
    const { container } = mount([]);
    expect(label(container as HTMLElement)?.className).toContain('text-red-600');
  });

  it('⭐⭐ เลือกวันแล้ว ⇒ หัวข้อกลับเป็นสีปกติ และไม่มีข้อความเตือน', () => {
    /* 🔴 สีแดงค้างทั้งที่แก้แล้ว = สัญญาณที่โกหก · ครั้งต่อไปผู้ใช้จะไม่เชื่อมันอีก */
    const { container, queryByTestId } = mount([1]);

    expect(label(container as HTMLElement)?.className).toContain('text-slate-800');
    expect(label(container as HTMLElement)?.className).not.toContain('text-red-600');
    expect(queryByTestId('repeat-days-all-hint')).toBeNull();
  });
});
